// Экраны приложения «Батончик»: Сегодня, Команды, Игры, Советы и настройки.

import { parseBlocks, parseCatalog, parseSchedule, renderBlocks, inline, escapeHtml, hash, plainText, stepKey as stepKeyFor } from './md.js';
import { createStore } from './store.js';

// Настройки Firebase читаем отдельно: если в файле ошибка, приложение всё равно откроется
let firebaseConfig = null;
let configBroken = false;
try {
  ({ firebaseConfig } = await import('./firebase-config.js'));
  if (!firebaseConfig || typeof firebaseConfig !== 'object') configBroken = true;
} catch (err) {
  console.error(err);
  configBroken = true;
}

const TZ = 'Europe/Moscow';
const TABS = {
  k: { title: 'Команды', files: ['komandy.md'] },
  g: { title: 'Игры', files: ['igry.md'] },
  t: { title: 'Советы', files: ['osnovy.md', 'sovety.md'] },
};

const S = {
  catalogs: {},       // k, g, t → { groups, loose }
  schedule: null,     // разобранный rasporyadok.md
  contentReady: false,
  defaultPlan: null,
  plan: null,
  needSeed: false,
  checks: {},
  marks: {},
  store: { mode: 'local', status: 'loading' },
  day: dayKey(),
  edit: { schedule: false, focus: false },
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- Время по Москве ----------

function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
const fmtTime = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
const fmtDate = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' }).format(d);
function todayTitle() {
  const s = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const rid = () => Math.random().toString(36).slice(2, 10);

// ---------- Хранилище ----------

const store = createStore({
  onState(st) {
    S.store = st;
    if (st.status !== 'ready') { S.edit.schedule = false; S.edit.focus = false; }
    renderHeader();
    render();
  },
  onPlan(plan, { fromServer }) {
    S.plan = plan ? cleanPlan(plan) : null;
    if (!plan && fromServer && S.store.status === 'ready') {
      if (S.contentReady) store.seedPlan(S.defaultPlan); else S.needSeed = true;
    }
    render();
  },
  onDay(checks) { S.checks = checks || {}; render(); },
  onMarks(marks) { S.marks = marks || {}; render(); },
  onError(message) { toast(message); },
}, firebaseConfig);

const canWrite = () => S.store.status === 'ready';

function cleanPlan(p) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  return {
    schedule: list(p.schedule).map((x) => ({
      id: str(x.id, 20) || rid(),
      time: /^\d\d:\d\d$/.test(x.time) ? x.time : '',
      title: str(x.title, 200),
      duration: str(x.duration, 60),
      note: str(x.note, 2000),
      cards: Array.isArray(x.cards) ? x.cards.filter((c) => typeof c === 'string').slice(0, 30) : [],
    })),
    focus: list(p.focus).map((x) => ({ id: str(x.id, 20) || rid(), card: str(x.card, 80), norm: str(x.norm, 1000) })),
  };
}

const currentPlan = () => S.plan || S.defaultPlan || { schedule: [], focus: [] };

function savePlan(mutator) {
  const plan = structuredClone(currentPlan());
  mutator(plan);
  S.plan = plan;
  store.savePlan(plan);
  render();
}

// ---------- Содержание ----------

async function loadText(name) {
  const res = await fetch('content/' + name, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function loadContent() {
  const tasks = Object.entries(TABS).map(async ([key, tab]) => {
    const ids = new Set();
    const cat = { groups: [], loose: [], errors: [] };
    for (const file of tab.files) {
      let text;
      try { text = await loadText(file); } catch {
        cat.errors.push(`Не удалось загрузить файл ${file}. Проверьте интернет.`);
        continue;
      }
      try {
        const c = parseCatalog(text, ids);
        cat.groups.push(...c.groups);
        cat.loose.push(...c.loose);
      } catch {
        // Разметка не распозналась — показываем текст файла как есть
        cat.groups.push({ title: '', intro: [], cards: [], raw: text });
      }
    }
    S.catalogs[key] = cat;
  });
  tasks.push(loadText('rasporyadok.md').then((t) => {
    try { S.schedule = parseSchedule(t) || { raw: t }; } catch { S.schedule = { raw: t }; }
  }).catch(() => { S.schedule = { error: true }; }));
  await Promise.all(tasks);

  S.defaultPlan = buildDefaultPlan();
  S.contentReady = true;
  if (S.needSeed) { S.needSeed = false; store.seedPlan(S.defaultPlan); }
  render();
}

const commandCards = () => (S.catalogs.k ? S.catalogs.k.groups.flatMap((g) => g.cards) : []);
const findCard = (tab, id) => (S.catalogs[tab] ? S.catalogs[tab].groups.flatMap((g) => g.cards).find((c) => c.id === id) : null);

// Команды, упомянутые в тексте пункта распорядка: по словам в «ёлочках» или по названию упражнения.
function detectCards(text) {
  const low = text.toLowerCase();
  return commandCards().filter((c) => {
    const quoted = c.name.match(/«[^»]+»/g) || [];
    if (quoted.length) return quoted.some((q) => text.includes(q));
    return low.includes(c.name.toLowerCase());
  }).map((c) => c.id);
}

function buildDefaultPlan() {
  const rows = (S.schedule && S.schedule.rows) || [];
  const first = S.catalogs.k && S.catalogs.k.groups[0];
  return {
    schedule: rows.map((r) => ({ id: rid(), time: '', title: r.when, duration: r.howlong, note: r.what, cards: detectCards(r.what) })),
    focus: (first ? first.cards : []).map((c) => ({ id: rid(), card: c.id, norm: c.nowText })),
  };
}

// ---------- Отметки ----------

function byLine(m, withDate) {
  if (!m) return '';
  const when = m.at ? (withDate ? fmtDate(m.at) : fmtTime(m.at)) : 'только что';
  return [m.name, when].filter(Boolean).map(escapeHtml).join(' · ');
}

function checkButton(key, label) {
  const m = S.checks[key];
  return `<button class="check${m ? ' on' : ''}" data-action="check" data-key="${key}" aria-pressed="${!!m}"
    aria-label="${m ? 'Снять отметку' : 'Отметить'}: ${escapeHtml(label)}"${canWrite() ? '' : ' disabled'}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`;
}

function markButton(id, label = 'Освоено') {
  const m = S.marks[id];
  return `<div class="mark${m ? ' on' : ''}">
    <button class="mark-btn" data-action="mark" data-id="${id}" data-confirm="1" aria-pressed="${!!m}"${canWrite() ? '' : ' disabled'}>
      ${m ? '✓ ' : ''}${label}</button>
    ${m ? `<span class="mark-by">${byLine(m, true)}</span>` : ''}
  </div>`;
}

function taskButton(id, text) {
  const m = S.marks[id];
  return `<button class="task-btn${m ? ' on' : ''}" data-action="mark" data-id="${id}" aria-pressed="${!!m}"${canWrite() ? '' : ' disabled'}>
    <span class="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <span class="task-text">${inline(text)}${m ? `<span class="mark-by">${byLine(m, true)}</span>` : ''}</span></button>`;
}

const stepId = (tab, card, key) => `step_${tab}_${card.id}_${key}`;
const cardId = (tab, card) => `card_${tab}_${card.id}`;
const taskId = (tab, text) => `task_${tab}_${hash(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))}`;

function cardProgress(tab, card) {
  if (tab !== 'k') return null;
  if (!card.steps.length) return { done: S.marks[cardId(tab, card)] ? 1 : 0, total: 1 };
  return { done: card.steps.filter((k) => S.marks[stepId(tab, card, k)]).length, total: card.steps.length };
}

// ---------- Общие куски разметки ----------

const CONFIG_BROKEN = `В файле js/firebase-config.js ошибка, поэтому отметки сохраняются только на этом телефоне.
  Как исправить — README.md, шаг 8.`;

function statusBanner() {
  const st = S.store;
  if (st.mode === 'local') return configBroken ? `<div class="banner warn">${CONFIG_BROKEN}</div>` : '';
  if (st.status === 'loading') return '<div class="banner">Подключаемся…</div>';
  if (st.status === 'signed-out') {
    return `<div class="banner">Войдите, чтобы отмечать и видеть общий прогресс.
      <button class="btn primary" data-action="sign-in">Войти через Google</button></div>`;
  }
  if (st.status === 'denied') {
    return `<div class="banner warn">У адреса ${escapeHtml(st.user.email)} нет доступа к отметкам. <a href="#/me">Подробнее</a></div>`;
  }
  if (st.status === 'error') return `<div class="banner warn">${escapeHtml(st.message)}</div>`;
  return '';
}

function blocksHtml(blocks, tab, opts = {}) {
  return renderBlocks(blocks, { task: (text) => taskButton(taskId(tab, text), text), ...opts });
}

function safe(fn, fallbackText) {
  try { return fn(); } catch (err) {
    console.error(err);
    return `<div class="raw">${escapeHtml(fallbackText || '')}</div>`;
  }
}

// ---------- Экран «Сегодня» ----------

function renderToday() {
  const plan = currentPlan();
  const editS = S.edit.schedule;
  const editF = S.edit.focus;
  const done = plan.schedule.filter((it) => S.checks['s_' + it.id]).length;
  const total = plan.schedule.length;
  const sch = S.schedule || {};

  const items = plan.schedule.map((it, i) => {
    const m = S.checks['s_' + it.id];
    const chips = it.cards.map((id) => findCard('k', id)).filter(Boolean)
      .map((c) => `<a class="tag" href="#/k/${c.id}">${escapeHtml(c.name)}</a>`).join('');
    return `<li class="item${m ? ' done' : ''}">
      ${editS ? '' : checkButton('s_' + it.id, it.title)}
      <div class="item-body">
        <div class="item-head">${it.time ? `<span class="time">${it.time}</span>` : ''}<span class="item-title">${inline(it.title)}</span></div>
        ${it.duration ? `<span class="chip">${inline(it.duration)}</span>` : ''}
        ${it.note ? `<p class="note">${inline(it.note)}</p>` : ''}
        ${chips ? `<div class="tags">${chips}</div>` : ''}
        ${m && !editS ? `<div class="by">✓ ${byLine(m)}</div>` : ''}
        ${editS ? `<div class="edit-row">
          <button class="icon-btn" data-action="item-move" data-id="${it.id}" data-dir="-1" aria-label="Выше"${i === 0 ? ' disabled' : ''}>↑</button>
          <button class="icon-btn" data-action="item-move" data-id="${it.id}" data-dir="1" aria-label="Ниже"${i === total - 1 ? ' disabled' : ''}>↓</button>
          <button class="btn small" data-action="item-edit" data-id="${it.id}">Изменить</button>
          <button class="btn small danger" data-action="item-delete" data-id="${it.id}">Удалить</button>
        </div>` : ''}
      </div></li>`;
  }).join('');

  const focus = plan.focus.map((f, i) => {
    const card = findCard('k', f.card);
    const m = S.checks['f_' + f.id];
    const name = card ? card.name : 'Команда не найдена в каталоге';
    return `<li class="item${m ? ' done' : ''}">
      ${editF ? '' : checkButton('f_' + f.id, name)}
      <div class="item-body">
        <div class="item-head">${card ? `<a class="item-title link" href="#/k/${card.id}">${escapeHtml(name)}</a>` : `<span class="item-title muted">${name}</span>`}</div>
        ${f.norm ? `<p class="note">${inline(f.norm)}</p>` : ''}
        ${m && !editF ? `<div class="by">✓ ${byLine(m)}</div>` : ''}
        ${editF ? `<div class="edit-row">
          <button class="icon-btn" data-action="focus-move" data-id="${f.id}" data-dir="-1" aria-label="Выше"${i === 0 ? ' disabled' : ''}>↑</button>
          <button class="icon-btn" data-action="focus-move" data-id="${f.id}" data-dir="1" aria-label="Ниже"${i === plan.focus.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="btn small" data-action="focus-edit" data-id="${f.id}">Изменить</button>
          <button class="btn small danger" data-action="focus-delete" data-id="${f.id}">Убрать</button>
        </div>` : ''}
      </div></li>`;
  }).join('');

  const editBtn = (section, on) => (canWrite()
    ? `<button class="btn small${on ? ' primary' : ''}" data-action="edit-toggle" data-section="${section}">${on ? 'Готово' : 'Изменить'}</button>` : '');

  let scheduleBody;
  if (sch.raw) scheduleBody = `<div class="prose">${safe(() => renderBlocks(parseBlocks(sch.raw)), sch.raw)}</div>`;
  else if (sch.error && !total) scheduleBody = '<p class="empty">Не удалось загрузить распорядок. Проверьте интернет.</p>';
  else scheduleBody = `<ul class="list">${items || '<li class="empty">В распорядке пока нет пунктов.</li>'}</ul>`;

  return `
    <div class="dayhead">
      <h1>${todayTitle()}</h1>
      ${total ? `<div class="progress" role="img" aria-label="Сделано ${done} из ${total}"><span style="width:${Math.round(done / total * 100)}%"></span></div>
      <p class="muted">Сделано ${done} из ${total}. Отметки обнуляются в полночь по Москве.</p>` : ''}
    </div>
    ${statusBanner()}
    <section class="section">
      <div class="section-head"><h2>Распорядок дня</h2>${editBtn('schedule', editS)}</div>
      ${sch.intro && sch.intro.length ? `<details class="intro"><summary>Как устроен распорядок</summary><div class="prose">${renderBlocks(sch.intro)}</div></details>` : ''}
      ${scheduleBody}
      ${editS ? `<div class="edit-actions">
        <button class="btn" data-action="item-add">+ Добавить пункт</button>
        <button class="btn" data-action="sort-time">Расставить по времени</button>
        <button class="btn danger-outline" data-action="reset-plan">Вернуть как в памятке</button>
      </div>` : ''}
    </section>
    <section class="section">
      <div class="section-head"><h2>Тренируем сейчас</h2>${editBtn('focus', editF)}</div>
      <ul class="list">${focus || '<li class="empty">Список пуст. Нажмите «Изменить», чтобы добавить команды.</li>'}</ul>
      ${editF ? '<div class="edit-actions"><button class="btn" data-action="focus-add">+ Добавить команду</button></div>' : ''}
    </section>
    ${sch.footer && sch.footer.length ? `<div class="prose footnote">${renderBlocks(sch.footer)}</div>` : ''}`;
}

// ---------- Каталоги ----------

function renderCatalog(tab) {
  const cat = S.catalogs[tab];
  const title = TABS[tab].title;
  if (!cat) return `<h1>${title}</h1><p class="muted">Загружаем…</p>`;
  const errors = cat.errors.map((e) => `<div class="banner warn">${escapeHtml(e)}</div>`).join('');
  const loose = cat.loose.length ? `<div class="prose">${blocksHtml(cat.loose, tab)}</div>` : '';
  const groups = cat.groups.map((g) => {
    if (g.raw) return `<section class="group"><div class="raw">${escapeHtml(g.raw)}</div></section>`;
    const cards = g.cards.map((c) => {
      const p = cardProgress(tab, c);
      let prog = '';
      if (p && p.total > 1) {
        prog = `<span class="card-prog"><span class="mini-bar"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></span>${p.done} из ${p.total}</span>`;
      } else if (p && p.done) prog = '<span class="card-prog ok">✓ Освоено</span>';
      return `<li><a class="card-link" href="#/${tab}/${c.id}">
        <span class="card-name">${inline(c.name)}</span>
        ${c.subtitle ? `<span class="card-sub">${inline(c.subtitle)}</span>` : ''}
        ${prog}
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></a></li>`;
    }).join('');
    const intro = g.intro.length
      ? (plainText(g.intro).length > 220
        ? `<details class="intro"><summary>Вступление к разделу</summary><div class="prose">${blocksHtml(g.intro, tab)}</div></details>`
        : `<div class="prose">${blocksHtml(g.intro, tab)}</div>`)
      : '';
    return `<section class="group">
      ${g.title ? `<h2>${inline(g.title)}</h2>` : ''}
      ${intro}
      ${cards ? `<ul class="cards">${cards}</ul>` : (g.intro.length ? '' : '<p class="empty">Здесь пока пусто.</p>')}
    </section>`;
  }).join('');
  return `<h1>${title}</h1>${errors}${loose}${groups}`;
}

function renderCard(tab, id) {
  const card = findCard(tab, id);
  const back = `<a class="back" href="#/${tab}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${TABS[tab].title}</a>`;
  if (!card) {
    return `${back}<h1>Не найдено</h1><p class="muted">${S.catalogs[tab] ? 'Возможно, карточку переименовали в памятке.' : 'Загружаем…'}</p>`;
  }
  const body = safe(() => {
    const lead = card.lead.length ? `<div class="prose">${blocksHtml(card.lead, tab)}</div>` : '';
    const blocks = card.blocks.filter((b) => b.content.length).map((b) => {
      const opts = tab === 'k' && b.kind === 'how'
        ? { step: (item) => markButton(stepId(tab, card, stepKeyFor(item.text))) } : {};
      return `<section class="blk blk-${b.kind}"><h2>${inline(b.title)}</h2><div class="prose">${blocksHtml(b.content, tab, opts)}</div></section>`;
    }).join('');
    const whole = tab === 'k' && !card.steps.length
      ? `<section class="blk blk-mastered"><h2>Навык освоен?</h2>${markButton(cardId(tab, card))}</section>` : '';
    return lead + blocks + whole;
  }, card.title + '\n\n' + card.blocks.map((b) => b.title + '\n' + plainText(b.content)).join('\n\n'));

  const p = cardProgress(tab, card);
  const prog = p && p.total > 1 ? `<p class="muted">Освоено шагов: ${p.done} из ${p.total}</p>` : '';
  return `${back}
    <h1 class="card-title">${inline(card.name)}</h1>
    ${card.subtitle ? `<p class="card-sub big">${inline(card.subtitle)}</p>` : ''}
    ${prog}
    ${tab === 'k' ? statusBanner() : ''}
    ${body}`;
}

// ---------- Настройки ----------

function renderMe() {
  const st = S.store;
  let account = '';
  if (st.mode === 'local' && configBroken) {
    account = `<p>${CONFIG_BROKEN}</p>`;
  } else if (st.mode === 'local') {
    account = `<p>Общий прогресс пока не настроен, поэтому отметки сохраняются только на этом телефоне.</p>
      <p class="muted">Чтобы отмечать вдвоём, настройте Firebase по инструкции в файле README.md в репозитории.</p>`;
  } else if (st.status === 'loading') account = '<p>Подключаемся…</p>';
  else if (st.status === 'signed-out') {
    account = `<p>Войдите, чтобы отмечать и видеть общий прогресс.</p>
      <button class="btn primary wide" data-action="sign-in">Войти через Google</button>`;
  } else if (st.status === 'denied') {
    account = `<p>Вы вошли как <strong>${escapeHtml(st.user.email)}</strong>, но этого адреса нет в списке допущенных.</p>
      <p class="muted">Добавьте его в Firestore: коллекция <code>allowed</code>, документ с ID, равным адресу почты (см. README).</p>
      <button class="btn wide" data-action="sign-out">Выйти</button>`;
  } else if (st.status === 'error') {
    account = `<p>${escapeHtml(st.message)}</p><button class="btn wide" data-action="reload">Попробовать снова</button>`;
  } else {
    account = `<p>Вы вошли как <strong>${escapeHtml(st.user.name)}</strong><br><span class="muted">${escapeHtml(st.user.email)}</span></p>
      <button class="btn wide" data-action="sign-out">Выйти</button>`;
  }
  const theme = getTheme();
  const opt = (v, label) => `<button class="seg${theme === v ? ' on' : ''}" data-action="theme" data-value="${v}" aria-pressed="${theme === v}">${label}</button>`;
  return `<h1>Настройки</h1>
    <section class="section panel"><h2>Аккаунт</h2>${account}</section>
    <section class="section panel"><h2>Тема</h2><div class="segmented">${opt('auto', 'Как в телефоне')}${opt('light', 'Светлая')}${opt('dark', 'Тёмная')}</div></section>
    <section class="section panel"><h2>Содержание</h2>
      <p class="muted">Тексты берутся из файлов в папке content. После замены файла на GitHub нажмите кнопку ниже.</p>
      <button class="btn wide" data-action="reload">Загрузить свежую версию</button></section>`;
}

// ---------- Маршруты и отрисовка ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { tab: parts[0] || 'today', id: parts[1] || null };
}

let lastRouteKey = '';

function render() {
  const r = route();
  let html;
  if (r.tab === 'me') html = renderMe();
  else if (TABS[r.tab]) html = r.id ? renderCard(r.tab, r.id) : renderCatalog(r.tab);
  else html = renderToday();
  view.innerHTML = html;

  const routeKey = r.tab + '/' + (r.id || '');
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const on = a.dataset.tab === (TABS[r.tab] || r.tab === 'me' ? r.tab : 'today');
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function renderHeader() {
  const st = S.store;
  const me = $('#me-btn');
  const name = st.user && st.user.name;
  me.innerHTML = name && st.status === 'ready'
    ? `<span class="avatar">${escapeHtml(name.charAt(0).toUpperCase())}</span>`
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
}

function updateNet() { $('#net').hidden = navigator.onLine; }

// ---------- Окно правки ----------

const sheet = $('#sheet');
let sheetSubmit = null;

function openSheet(html, onSubmit) {
  sheet.querySelector('.sheet-body').innerHTML = html;
  sheetSubmit = onSubmit;
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
}
function closeSheet() {
  sheet.hidden = true;
  sheetSubmit = null;
  document.body.classList.remove('no-scroll');
}

function cardChoices(selected) {
  return commandCards().map((c) => `<label class="choice"><input type="checkbox" name="cards" value="${c.id}"${selected.includes(c.id) ? ' checked' : ''}>
    <span>${escapeHtml(c.name)}</span></label>`).join('');
}

function editItem(id) {
  const it = id ? currentPlan().schedule.find((x) => x.id === id) : { time: '', title: '', duration: '', note: '', cards: [] };
  if (!it) return;
  openSheet(`<form class="form">
    <h2>${id ? 'Пункт распорядка' : 'Новый пункт'}</h2>
    <label>Время <span class="muted">(можно оставить пустым)</span>
      <span class="time-row"><input type="time" name="time" value="${it.time}">
      <button type="button" class="btn small" data-action="clear-time">Без времени</button></span></label>
    <label>Когда <input name="title" required maxlength="200" value="${escapeHtml(it.title)}" placeholder="Например: Утренняя прогулка"></label>
    <label>Сколько <input name="duration" maxlength="60" value="${escapeHtml(it.duration)}" placeholder="Например: 5 мин"></label>
    <label>Что тренируем <textarea name="note" rows="4" maxlength="2000">${escapeHtml(it.note)}</textarea></label>
    <fieldset><legend>Команды из каталога</legend><div class="choices">${cardChoices(it.cards)}</div></fieldset>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const value = {
      time: fd.get('time') || '', title: String(fd.get('title')).trim(), duration: String(fd.get('duration')).trim(),
      note: String(fd.get('note')).trim(), cards: fd.getAll('cards'),
    };
    savePlan((p) => {
      if (id) Object.assign(p.schedule.find((x) => x.id === id) || {}, value);
      else p.schedule.push({ id: rid(), ...value });
    });
  });
}

function editFocus(id) {
  const f = currentPlan().focus.find((x) => x.id === id);
  if (!f) return;
  const card = findCard('k', f.card);
  openSheet(`<form class="form">
    <h2>${card ? escapeHtml(card.name) : 'Команда'}</h2>
    <label>Сколько и как тренировать сейчас <textarea name="norm" rows="5" maxlength="1000">${escapeHtml(f.norm)}</textarea></label>
    ${card && card.nowText ? `<button type="button" class="btn small" data-action="norm-default" data-text="${escapeHtml(card.nowText)}">Вернуть текст из памятки</button>` : ''}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    savePlan((p) => { const x = p.focus.find((y) => y.id === id); if (x) x.norm = String(fd.get('norm')).trim(); });
  });
}

function addFocus() {
  const used = new Set(currentPlan().focus.map((f) => f.card));
  const groups = (S.catalogs.k ? S.catalogs.k.groups : []).map((g) => {
    const cards = g.cards.filter((c) => !used.has(c.id));
    if (!cards.length) return '';
    return `<h3>${inline(g.title)}</h3>${cards.map((c) =>
      `<button type="button" class="pick" data-action="focus-pick" data-card="${c.id}">${escapeHtml(c.name)}${c.nowText ? `<span class="muted">${escapeHtml(c.nowText)}</span>` : ''}</button>`).join('')}`;
  }).join('');
  openSheet(`<div class="form"><h2>Добавить команду</h2>${groups || '<p class="muted">Все команды из каталога уже в списке.</p>'}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button></div></div>`, null);
}

function move(list, id, dir) {
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

// ---------- Нажатия ----------

const actions = {
  'check': (el) => { const key = el.dataset.key; store.setCheck(key, !S.checks[key]); },
  'mark': (el) => {
    const id = el.dataset.id;
    const on = !!S.marks[id];
    if (on && el.dataset.confirm && !confirm('Снять отметку «Освоено»?')) return;
    store.setMark(id, !on);
  },
  'edit-toggle': (el) => { S.edit[el.dataset.section] = !S.edit[el.dataset.section]; render(); },
  'item-move': (el) => savePlan((p) => move(p.schedule, el.dataset.id, +el.dataset.dir)),
  'item-edit': (el) => editItem(el.dataset.id),
  'item-add': () => editItem(null),
  'item-delete': (el) => {
    const it = currentPlan().schedule.find((x) => x.id === el.dataset.id);
    if (it && confirm(`Удалить пункт «${it.title}»?`)) savePlan((p) => { p.schedule = p.schedule.filter((x) => x.id !== it.id); });
  },
  'sort-time': () => savePlan((p) => {
    const timed = p.schedule.filter((x) => x.time).sort((a, b) => a.time.localeCompare(b.time));
    const rest = p.schedule.filter((x) => !x.time);
    p.schedule = [...timed, ...rest];
  }),
  'reset-plan': () => {
    if (!confirm('Вернуть распорядок и список «Тренируем сейчас» как в памятке? Ваши правки и сегодняшние отметки распорядка пропадут.')) return;
    S.defaultPlan = buildDefaultPlan();
    savePlan((p) => { p.schedule = S.defaultPlan.schedule; p.focus = S.defaultPlan.focus; });
  },
  'focus-move': (el) => savePlan((p) => move(p.focus, el.dataset.id, +el.dataset.dir)),
  'focus-edit': (el) => editFocus(el.dataset.id),
  'focus-delete': (el) => {
    const f = currentPlan().focus.find((x) => x.id === el.dataset.id);
    const card = f && findCard('k', f.card);
    if (f && confirm(`Убрать «${card ? card.name : 'команду'}» из списка?`)) savePlan((p) => { p.focus = p.focus.filter((x) => x.id !== f.id); });
  },
  'focus-add': () => addFocus(),
  'focus-pick': (el) => {
    const card = findCard('k', el.dataset.card);
    if (card) savePlan((p) => p.focus.push({ id: rid(), card: card.id, norm: card.nowText }));
    closeSheet();
  },
  'norm-default': (el) => { sheet.querySelector('textarea[name=norm]').value = el.dataset.text; },
  'clear-time': () => { sheet.querySelector('input[name=time]').value = ''; },
  'sheet-close': () => closeSheet(),
  'sign-in': () => store.signIn(),
  'sign-out': () => store.signOut(),
  'theme': (el) => { setTheme(el.dataset.value); render(); },
  'reload': () => location.reload(),
};

document.addEventListener('click', (e) => {
  if (e.target === sheet) return closeSheet();
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const fn = sheetSubmit;
  closeSheet();
  if (fn) fn(fd);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

// ---------- Тема ----------

function getTheme() { try { return localStorage.getItem('bt.theme') || 'auto'; } catch { return 'auto'; } }
function setTheme(v) {
  try { localStorage.setItem('bt.theme', v); } catch { /* ничего */ }
  applyTheme();
}
function applyTheme() {
  const v = getTheme();
  if (v === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
}

// ---------- Уведомления ----------

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// ---------- Запуск ----------

function checkDay() {
  const k = dayKey();
  if (k !== S.day) {
    S.day = k;
    S.checks = {};
    store.setDay(k);
    render();
  }
}

applyTheme();
window.addEventListener('hashchange', render);
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
setInterval(checkDay, 30000);
updateNet();
renderHeader();
render();
store.setDay(S.day);
store.start();
loadContent();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
