// Экраны приложения «Батончик»: Сегодня, Команды, Игры, Советы и настройки.

import { parseBlocks, parseCatalog, parseCardMd, parseSchedule, renderBlocks, inline, escapeHtml, hash, plainText, stepKey as stepKeyFor } from './md.js';
import { createStore } from './store.js';
import { cardToForm, emptyForm, formToMd, editorHtml, editorAction, setPath } from './editor.js';
import {
  EVENT_TYPES, SUBS, dayKey, fmtTime, fmtDate, addDays, moscowDate, dayStats, eventRow, todaySummary, nightLine, nightFor, diaryHtml,
} from './diary.js';

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
const DIARY_STEP = 28; // дневник подгружает историю по 4 недели
const TABS = {
  k: { title: 'Команды', files: ['komandy.md'] },
  g: { title: 'Игры', files: ['igry.md'] },
  t: { title: 'Советы', files: ['sovety.md'] },
};

const S = {
  base: {},           // k, g, t → каталог из файлов
  cardDocs: {},       // правки карточек из приложения: «k__ko-mne» → { md, group, deleted }
  catalogs: {},       // k, g, t → { groups, loose } — файлы с правками поверх
  schedule: null,     // разобранный rasporyadok.md
  contentReady: false,
  defaultPlan: null,
  plan: null,
  needSeed: false,
  checks: {},
  marks: {},
  events: [],         // журнал за сегодня
  yesterday: [],      // журнал за вчера — для ночного перерыва, если легли до полуночи
  diary: { from: null, events: [], days: {}, loading: false, loadedAt: 0 },
  editor: null,       // { tab, id, form, isNew } — открытая форма правки карточки
  store: { mode: 'local', status: 'loading' },
  day: dayKey(),
  edit: { schedule: false },
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- Время по Москве ----------

function todayTitle() {
  const s = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const rid = () => Math.random().toString(36).slice(2, 10);

// ---------- Хранилище ----------

const store = createStore({
  onState(st) {
    const becameReady = st.status === 'ready' && S.store.status !== 'ready';
    S.store = st;
    if (becameReady) loadYesterday();
    if (st.status !== 'ready') S.edit.schedule = false;
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
  onEvents(list) { S.events = list || []; render(); },
  onCards(docs) { S.cardDocs = docs || {}; rebuildCatalogs(); render(); },
  onError(message) { toast(message); },
}, firebaseConfig);

const canWrite = () => S.store.status === 'ready';

function loadYesterday() {
  const y = addDays(S.day, -1);
  store.loadHistory(y, y).then((d) => { S.yesterday = d.events; render(); }).catch(() => {});
}

function cleanPlan(p) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  return {
    schedule: list(p.schedule).map((x) => ({
      id: str(x.id, 20) || rid(),
      time: /^\d\d:\d\d$/.test(x.time) ? x.time : '',
      title: str(x.title, 200),
      duration: str(x.duration, 60),
      note: str(x.note, 4000),
      tip: str(x.tip, 2000),
      cards: Array.isArray(x.cards) ? x.cards.filter((c) => typeof c === 'string').slice(0, 30) : [],
    })),
    focus: [], // список «Тренируем сейчас» больше не используется
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
    S.base[key] = cat;
  });
  tasks.push(loadText('rasporyadok.md').then((t) => {
    try { S.schedule = parseSchedule(t) || { raw: t }; } catch { S.schedule = { raw: t }; }
  }).catch(() => { S.schedule = { error: true }; }));
  await Promise.all(tasks);

  rebuildCatalogs();
  S.defaultPlan = buildDefaultPlan();
  S.contentReady = true;
  if (S.needSeed) { S.needSeed = false; store.seedPlan(S.defaultPlan); }
  render();
}

// Карточки из файлов, поверх — правки из приложения (по id карточки), в конце — новые карточки
function rebuildCatalogs() {
  for (const tab of Object.keys(TABS)) {
    const base = S.base[tab];
    if (!base) continue;
    const docs = Object.values(S.cardDocs).filter((d) => d && d.tab === tab);
    const byId = new Map(docs.map((d) => [d.cardId, d]));
    const baseIds = new Set();
    const groups = base.groups.map((g) => ({
      ...g,
      cards: g.cards.flatMap((c) => {
        baseIds.add(c.id);
        const d = byId.get(c.id);
        if (!d) return [{ ...c, source: 'file' }];
        if (d.deleted) return [];
        const edited = d.md && safeParseCard(d.md, c.id);
        return edited ? [{ ...edited, source: 'edited' }] : [{ ...c, source: 'file' }];
      }),
    }));
    docs.filter((d) => !baseIds.has(d.cardId) && !d.deleted).sort((a, b) => (a.cardId < b.cardId ? -1 : 1)).forEach((d) => {
      const card = safeParseCard(d.md, d.cardId);
      if (!card) return;
      let g = groups.find((x) => x.title === d.group) || groups[0];
      if (!g) { g = { title: '', intro: [], introRaw: '', cards: [] }; groups.push(g); }
      g.cards.push({ ...card, source: 'new' });
    });
    S.catalogs[tab] = { ...base, groups };
  }
}

function safeParseCard(md, id) {
  try { return parseCardMd(md, id); } catch (err) { console.error(err); return null; }
}

// Скрытые карточки из файлов (для восстановления в настройках)
function hiddenCards() {
  return Object.values(S.cardDocs).filter((d) => d && d.deleted).map((d) => {
    const base = S.base[d.tab] && S.base[d.tab].groups.flatMap((g) => g.cards).find((c) => c.id === d.cardId);
    return base ? { tab: d.tab, id: d.cardId, name: base.name } : null;
  }).filter(Boolean);
}

const groupOf = (tab, id) => (S.catalogs[tab] ? S.catalogs[tab].groups.find((g) => g.cards.some((c) => c.id === id)) : null);

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
  return {
    schedule: rows.map((r) => ({
      id: rid(), time: '', title: r.title, duration: r.duration, note: r.note, tip: r.tip, cards: detectCards(r.note),
    })),
    focus: [],
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
// Галочка привязана к карточке: одинаковый текст в разных карточках — разные отметки
const taskId = (tab, card, text) => `task_${tab}_${card ? card.id : 'x'}_${hash(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))}`;

function cardProgress(tab, card) {
  return {
    done: card.steps.filter((k) => S.marks[stepId(tab, card, k)]).length,
    total: card.steps.length,
    mastered: card.hasResult && !!S.marks[cardId(tab, card)],
  };
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

function blocksHtml(blocks, tab, card, opts = {}) {
  return renderBlocks(blocks, { task: (text) => taskButton(taskId(tab, card, text), text), ...opts });
}

const mdHtml = (text) => (text ? renderBlocks(parseBlocks(text)) : '');

function safe(fn, fallbackText) {
  try { return fn(); } catch (err) {
    console.error(err);
    return `<div class="raw">${escapeHtml(fallbackText || '')}</div>`;
  }
}

// ---------- Экран «Сегодня» ----------

function scheduleItemHtml(it, opts = {}) {
  const chips = (it.cards || []).map((id) => findCard('k', id)).filter(Boolean)
    .map((c) => `<a class="tag" href="#/k/${c.id}">${escapeHtml(c.name)}</a>`).join('');
  return `
    <div class="item-head">${it.time ? `<span class="time">${it.time}</span>` : ''}<span class="item-title">${inline(it.title)}</span></div>
    ${it.duration ? `<span class="chip">${inline(it.duration)}</span>` : ''}
    ${it.note ? `<div class="note prose">${safe(() => mdHtml(it.note), it.note)}</div>` : ''}
    ${it.tip ? `<div class="tip prose"><strong>Подсказка.</strong> ${safe(() => mdHtml(it.tip), it.tip)}</div>` : ''}
    ${chips ? `<div class="tags">${chips}</div>` : ''}
    ${opts.after || ''}`;
}

// Журнал: кнопки быстрых записей и лента за сегодня
function journalHtml() {
  const can = canWrite();
  const buttons = Object.entries(EVENT_TYPES).map(([type, t]) =>
    `<button class="ev-btn" data-action="ev-add" data-type="${type}"${can ? '' : ' disabled'}><span class="ev-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span></button>`).join('');
  const st = dayStats(S.day, S.events, S.checks, 0);
  const night = nightFor(S.day, [...S.yesterday, ...S.events]);
  const list = [...st.list].reverse();
  return `<section class="section">
    <div class="section-head"><h2>Журнал</h2><a class="btn small" href="#/d">Дневник</a></div>
    <div class="ev-buttons">${buttons}</div>
    ${todaySummary(st)}
    ${nightLine(night)}
    ${list.length ? `<ul class="ev-list">${list.map((e) => eventRow(e, { editable: can })).join('')}</ul>`
      : '<p class="muted">Сегодня ещё ничего не записано. Нажмите кнопку, и запись появится здесь с временем и именем.</p>'}
  </section>`;
}

function renderToday() {
  const plan = currentPlan();
  const editS = S.edit.schedule;
  const done = plan.schedule.filter((it) => S.checks['s_' + it.id]).length;
  const total = plan.schedule.length;
  const sch = S.schedule || {};

  const items = plan.schedule.map((it, i) => {
    const m = S.checks['s_' + it.id];
    const after = `${m && !editS ? `<div class="by">✓ ${byLine(m)}</div>` : ''}
      ${editS ? `<div class="edit-row">
        <button class="icon-btn" data-action="item-move" data-id="${it.id}" data-dir="-1" aria-label="Выше"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="item-move" data-id="${it.id}" data-dir="1" aria-label="Ниже"${i === total - 1 ? ' disabled' : ''}>↓</button>
        <button class="btn small" data-action="item-edit" data-id="${it.id}">Изменить</button>
        <button class="btn small danger" data-action="item-delete" data-id="${it.id}">Удалить</button>
      </div>` : ''}`;
    return `<li class="item${m ? ' done' : ''}">
      ${editS ? '' : checkButton('s_' + it.id, it.title)}
      <div class="item-body">${scheduleItemHtml(it, { after })}</div></li>`;
  }).join('');

  // «В течение дня» и другие группы после первой — из файла, без отметок
  const extra = (sch.extra || []).map((g) => `<section class="section">
      ${g.title ? `<h2>${inline(g.title)}</h2>` : ''}
      ${g.intro && g.intro.length ? `<div class="prose">${renderBlocks(g.intro)}</div>` : ''}
      <ul class="list">${g.items.map((it) => `<li class="item plain"><div class="item-body">${scheduleItemHtml(it)}</div></li>`).join('')}</ul>
    </section>`).join('');

  const editBtn = canWrite()
    ? `<button class="btn small${editS ? ' primary' : ''}" data-action="edit-toggle" data-section="schedule">${editS ? 'Готово' : 'Изменить'}</button>` : '';

  let scheduleBody;
  if (sch.raw) scheduleBody = `<div class="prose">${safe(() => renderBlocks(parseBlocks(sch.raw)), sch.raw)}</div>`;
  else if (sch.error && !total) scheduleBody = '<p class="empty">Не удалось загрузить расписание. Проверьте интернет.</p>';
  else scheduleBody = `<ul class="list">${items || '<li class="empty">В расписании пока нет пунктов.</li>'}</ul>`;

  return `
    <div class="dayhead">
      <h1>${todayTitle()}</h1>
      ${total ? `<div class="progress" role="img" aria-label="Сделано ${done} из ${total}"><span style="width:${Math.round(done / total * 100)}%"></span></div>
      <p class="muted">Сделано ${done} из ${total}. Отметки обнуляются в полночь по Москве.</p>` : ''}
    </div>
    ${statusBanner()}
    ${journalHtml()}
    <section class="section">
      <div class="section-head"><h2>${escapeHtml(sch.title || 'Расписание дня')}</h2>${editBtn}</div>
      ${sch.intro && sch.intro.length ? `<details class="intro"><summary>Как устроено расписание</summary><div class="prose">${renderBlocks(sch.intro)}</div></details>` : ''}
      ${scheduleBody}
      ${editS ? `<div class="edit-actions">
        <button class="btn" data-action="item-add">+ Добавить пункт</button>
        <button class="btn" data-action="sort-time">Расставить по времени</button>
        <button class="btn danger-outline" data-action="reset-plan">Вернуть как в памятке</button>
      </div>` : ''}
    </section>
    ${extra}
    ${sch.footer && sch.footer.length ? `<div class="prose footnote">${renderBlocks(sch.footer)}</div>` : ''}`;
}

// ---------- Каталоги ----------

function renderCatalog(tab) {
  const cat = S.catalogs[tab];
  const title = TABS[tab].title;
  if (!cat) return `<h1>${title}</h1><p class="muted">Загружаем…</p>`;
  const errors = cat.errors.map((e) => `<div class="banner warn">${escapeHtml(e)}</div>`).join('');
  // Один раздел в файле — его название становится заголовком страницы
  const single = cat.groups.length === 1 && !!cat.groups[0].title;
  const loose = cat.loose.length ? `<div class="prose">${blocksHtml(cat.loose, tab, null)}</div>` : '';
  const groups = cat.groups.map((g) => {
    if (g.raw) return `<section class="group"><div class="raw">${escapeHtml(g.raw)}</div></section>`;
    const cards = g.cards.map((c) => {
      const p = cardProgress(tab, c);
      let prog = '';
      if (p.mastered) prog = '<span class="card-prog ok">✓ Освоено</span>';
      else if (p.total) {
        prog = `<span class="card-prog"><span class="mini-bar"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></span>${p.done} из ${p.total}</span>`;
      }
      return `<li><a class="card-link" href="#/${tab}/${c.id}">
        <span class="card-name">${inline(c.name)}</span>
        ${c.subtitle ? `<span class="card-sub">${inline(c.subtitle)}</span>` : ''}
        ${prog}
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></a></li>`;
    }).join('');
    const intro = g.intro.length
      ? (plainText(g.intro).length > 220
        ? `<details class="intro"><summary>Вступление к разделу</summary><div class="prose">${blocksHtml(g.intro, tab, null)}</div></details>`
        : `<div class="prose">${blocksHtml(g.intro, tab, null)}</div>`)
      : '';
    return `<section class="group">
      ${g.title && !single ? `<h2>${inline(g.title)}</h2>` : ''}
      ${intro}
      ${cards ? `<ul class="cards">${cards}</ul>` : (g.intro.length ? '' : '<p class="empty">Здесь пока пусто.</p>')}
    </section>`;
  }).join('');
  const addBtn = canWrite() ? `<a class="btn small" href="#/edit/${tab}/new">+ Новая карточка</a>` : '';
  return `<div class="page-head"><h1>${single ? inline(cat.groups[0].title) : title}</h1>${addBtn}</div>${errors}${loose}${groups}`;
}

function renderCard(tab, id) {
  const card = findCard(tab, id);
  const back = `<a class="back" href="#/${tab}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${TABS[tab].title}</a>`;
  if (!card) {
    return `${back}<h1>Не найдено</h1><p class="muted">${S.catalogs[tab] ? 'Возможно, карточку переименовали в памятке.' : 'Загружаем…'}</p>`;
  }
  const body = safe(() => {
    const lead = card.lead.length ? `<div class="prose">${blocksHtml(card.lead, tab, card)}</div>` : '';
    return lead + card.blocks.filter((b) => b.content.length).map((b) => {
      if (b.kind === 'result') return resultHtml(tab, card, b);
      const opts = b.kind === 'steps' || b.kind === 'how'
        ? { step: (item) => markButton(stepId(tab, card, stepKeyFor(item.text))) } : {};
      return `<section class="blk blk-${b.kind}"><h2>${inline(b.title)}</h2><div class="prose">${blocksHtml(b.content, tab, card, opts)}</div></section>`;
    }).join('');
  }, card.title + '\n\n' + card.blocks.map((b) => b.title + '\n' + plainText(b.content)).join('\n\n'));

  const p = cardProgress(tab, card);
  const prog = p.mastered ? '<p class="card-prog ok big">✓ Освоено</p>'
    : (p.total ? `<p class="muted">Освоено шагов: ${p.done} из ${p.total}</p>` : '');
  return `${back}
    <div class="page-head"><h1 class="card-title">${inline(card.name)}</h1>
      ${canWrite() ? `<a class="btn small" href="#/edit/${tab}/${card.id}">Изменить</a>` : ''}</div>
    ${card.subtitle ? `<p class="card-sub big">${inline(card.subtitle)}</p>` : ''}
    ${prog}
    ${card.steps.length || card.hasResult ? statusBanner() : ''}
    ${body}`;
}

// Блок «Итог»: одна галочка «Освоено» — большая кнопка на всю карточку, несколько — общие галочки
function resultHtml(tab, card, b) {
  const items = b.content.filter((x) => x.type === 'list').flatMap((x) => x.items);
  const single = items.length === 1 && b.content.length === 1;
  const inner = single
    ? markButton(cardId(tab, card), escapeHtml(items[0].text.replace(/\*\*/g, '')) || 'Освоено')
    : `<div class="prose">${blocksHtml(b.content, tab, card)}</div>`;
  return `<section class="blk blk-result"><h2>${inline(b.title)}</h2>${inner}</section>`;
}

// ---------- Редактор карточки ----------

function editorKey(r) { return `${r.tab}/${r.id}`; }

function renderEditor(r) {
  const tab = r.tab;
  if (!TABS[tab] || !S.catalogs[tab]) return '<p class="muted">Загружаем…</p>';
  if (!canWrite()) return `<p class="muted">Чтобы править карточки, войдите в приложение.</p><a class="btn" href="#/${tab}">Назад</a>`;
  const isNew = r.id === 'new';
  if (!S.editor || S.editor.key !== editorKey(r)) {
    const groups = S.catalogs[tab].groups.map((g) => g.title).filter(Boolean);
    if (isNew) S.editor = { key: editorKey(r), tab, id: null, isNew, form: emptyForm(tab, groups[0] || '') };
    else {
      const card = findCard(tab, r.id);
      if (!card) return `<p class="muted">Карточка не найдена.</p><a class="btn" href="#/${tab}">Назад</a>`;
      const g = groupOf(tab, card.id);
      S.editor = { key: editorKey(r), tab, id: card.id, isNew, source: card.source, form: cardToForm(card, g ? g.title : '') };
    }
  }
  const e = S.editor;
  return editorHtml({
    tab, form: e.form, isNew,
    groups: S.catalogs[tab].groups.map((g) => g.title).filter(Boolean),
    canReset: e.source === 'edited',
    title: isNew ? `Новая карточка · ${TABS[tab].title}` : 'Изменить карточку',
  });
}

function saveEditor() {
  const e = S.editor;
  if (!e) return;
  if (!e.form.name.trim()) { toast('Впишите название карточки.'); return; }
  const id = e.isNew ? 'n' + Date.now().toString(36) : e.id;
  const group = e.isNew ? e.form.group : ((groupOf(e.tab, id) || {}).title || '');
  store.saveCard(e.tab, id, { group, md: formToMd(e.form) });
  S.editor = null;
  location.hash = `#/${e.tab}/${id}`;
  toast('Карточка сохранена.');
}

// ---------- Дневник ----------

async function loadDiary(more) {
  const today = S.day;
  const from = more && S.diary.from ? addDays(S.diary.from, -DIARY_STEP) : addDays(today, -(DIARY_STEP - 1));
  S.diary.loading = true;
  render();
  try {
    const data = await store.loadHistory(from, today);
    S.diary = { from, events: data.events, days: data.days, loading: false, loadedAt: Date.now() };
  } catch (err) {
    console.error(err);
    S.diary.loading = false;
    toast('Не удалось загрузить дневник. Проверьте интернет.');
  }
  render();
}

// Подпись отметки «Освоено» для дневника: «"Буп": Ладонь у носа»
function markLabel(id) {
  const [type, tab, cid, key] = id.split('_');
  const card = findCard(tab, cid);
  if (!card) return null;
  if (type === 'card') return `${card.name} — вся карточка`;
  if (type === 'step') return card.stepTitles[key] ? `${card.name}: ${card.stepTitles[key]}` : card.name;
  if (type === 'task') {
    for (const b of card.blocks) for (const x of b.content) {
      if (x.type !== 'list') continue;
      const it = x.items.find((i) => i.task !== null && taskId(tab, card, i.text) === id);
      if (it) return `${card.name}: ${it.text.replace(/\*\*/g, '')}`;
    }
    return card.name;
  }
  return null;
}

function renderDiary() {
  if (!canWrite()) return `<h1>Дневник</h1>${statusBanner()}<p class="muted">Дневник появится после входа.</p>`;
  if (!S.diary.from || (Date.now() - S.diary.loadedAt > 60000 && !S.diary.loading)) {
    if (!S.diary.loading) setTimeout(() => loadDiary(false), 0);
  }
  const today = S.day;
  // Сегодняшние записи — живые, остальное — из загруженной истории
  const events = [...S.diary.events.filter((e) => e.day !== today), ...S.events];
  const total = currentPlan().schedule.length;
  const days = [];
  for (let k = today; S.diary.from && k >= S.diary.from; k = addDays(k, -1)) {
    days.push(dayStats(k, events, k === today ? S.checks : S.diary.days[k], total));
  }
  const markLabels = {};
  for (const [id, m] of Object.entries(S.marks)) {
    if (!m.at) continue;
    const label = markLabel(id);
    if (label) (markLabels[dayKey(m.at)] = markLabels[dayKey(m.at)] || []).push(label);
  }
  return diaryHtml({ days, prevWeek: days.slice(7, 14), markLabels, hasMore: !!S.diary.from && !S.diary.loading, loading: S.diary.loading || !S.diary.from });
}

// ---------- Резервная копия ----------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Каталог вкладки в том же формате, что файлы в папке content (с правками из приложения)
function catalogMd(tab) {
  const cat = S.catalogs[tab];
  return cat.groups.map((g) => [g.title ? `# ${g.title}` : '', g.introRaw || '', ...g.cards.map((c) => c.raw)]
    .filter(Boolean).join('\n\n')).join('\n\n') + '\n';
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
    ${hiddenCards().length ? `<section class="section panel"><h2>Удалённые карточки</h2>
      <p class="muted">Эти карточки из файлов скрыты в приложении. Их можно вернуть.</p>
      <ul class="plain-list">${hiddenCards().map((c) => `<li><span>${escapeHtml(c.name)} <span class="muted">· ${TABS[c.tab].title}</span></span>
        <button class="btn small" data-action="card-restore" data-tab="${c.tab}" data-id="${c.id}"${canWrite() ? '' : ' disabled'}>Вернуть</button></li>`).join('')}</ul></section>` : ''}
    <section class="section panel"><h2>Резервная копия</h2>
      <p class="muted">Карточки скачиваются в том же формате, что файлы в папке content, вместе с вашими правками. Журнал, отметки и расписание — одним файлом .json.</p>
      <div class="edit-actions">
        <button class="btn small" data-action="backup-md" data-tab="k">Команды (.md)</button>
        <button class="btn small" data-action="backup-md" data-tab="g">Игры (.md)</button>
        <button class="btn small" data-action="backup-md" data-tab="t">Советы (.md)</button>
        <button class="btn small" data-action="backup-json"${canWrite() ? '' : ' disabled'}>Журнал и отметки (.json)</button>
      </div></section>
    <section class="section panel"><h2>Содержание</h2>
      <p class="muted">Тексты берутся из файлов в папке content. После замены файла на GitHub нажмите кнопку ниже.</p>
      <button class="btn wide" data-action="reload">Загрузить свежую версию</button></section>`;
}

// ---------- Маршруты и отрисовка ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'edit') return { page: 'edit', tab: parts[1], id: parts[2] || 'new' };
  return { page: parts[0] || 'today', tab: parts[0] || 'today', id: parts[1] || null };
}

let lastRouteKey = '';

function render(force) {
  const r = route();
  if (r.page !== 'edit') S.editor = null;
  // Открытую форму правки не перерисовываем от обновлений с сервера, чтобы не стереть набранный текст
  if (r.page === 'edit' && !force && S.editor && S.editor.key === editorKey(r) && view.querySelector('[data-editor]')) return;
  let html;
  if (r.page === 'me') html = renderMe();
  else if (r.page === 'edit') html = renderEditor(r);
  else if (r.page === 'd') html = renderDiary();
  else if (TABS[r.tab]) html = r.id ? renderCard(r.tab, r.id) : renderCatalog(r.tab);
  else html = renderToday();
  view.innerHTML = html;

  const routeKey = r.page + '/' + (r.tab || '') + '/' + (r.id || '');
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const current = r.page === 'edit' ? r.tab : (TABS[r.tab] || r.page === 'me' || r.page === 'd' ? r.page : 'today');
    const on = a.dataset.tab === current;
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
  const it = id ? currentPlan().schedule.find((x) => x.id === id) : { time: '', title: '', duration: '', note: '', tip: '', cards: [] };
  if (!it) return;
  openSheet(`<form class="form">
    <h2>${id ? 'Пункт расписания' : 'Новый пункт'}</h2>
    <label>Время <span class="muted">(можно оставить пустым)</span>
      <span class="time-row"><input type="time" name="time" value="${it.time}">
      <button type="button" class="btn small" data-action="clear-time">Без времени</button></span></label>
    <label>Когда <input name="title" required maxlength="200" value="${escapeHtml(it.title)}" placeholder="Например: Утренняя прогулка"></label>
    <label>Сколько <input name="duration" maxlength="60" value="${escapeHtml(it.duration)}" placeholder="Например: 5 минут"></label>
    <label>Что делаем <span class="muted">(строка, начинающаяся с «- », — пункт списка)</span>
      <textarea name="note" rows="6" maxlength="4000">${escapeHtml(it.note)}</textarea></label>
    <label>Подсказка <textarea name="tip" rows="3" maxlength="2000">${escapeHtml(it.tip || '')}</textarea></label>
    <fieldset><legend>Команды из каталога</legend><div class="choices">${cardChoices(it.cards)}</div></fieldset>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const value = {
      time: fd.get('time') || '', title: String(fd.get('title')).trim(), duration: String(fd.get('duration')).trim(),
      note: String(fd.get('note')).trim(), tip: String(fd.get('tip')).trim(), cards: fd.getAll('cards'),
    };
    savePlan((p) => {
      if (id) Object.assign(p.schedule.find((x) => x.id === id) || {}, value);
      else p.schedule.push({ id: rid(), ...value });
    });
  });
}

function saveEvent(type, extra = {}) {
  const at = new Date();
  const id = store.addEvent({ type, sub: '', text: '', ...extra, at, day: dayKey(at) });
  const t = EVENT_TYPES[type];
  toast(`Записано: ${t.label.toLowerCase()}${extra.sub ? ` — ${SUBS[extra.sub]}` : ''}, ${fmtTime(at)}`, {
    label: 'Отменить', onClick: () => { if (id) store.deleteEvent(id); },
  });
}

function addEventFlow(type) {
  const t = EVENT_TYPES[type];
  if (!t) return;
  if (t.subs) {
    openSheet(`<div class="form"><h2>${t.icon} ${t.label}</h2>
      ${Object.entries(SUBS).map(([k, v]) => `<button type="button" class="pick big" data-action="ev-sub" data-type="${type}" data-sub="${k}">${v.charAt(0).toUpperCase() + v.slice(1)}</button>`).join('')}
      <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button></div></div>`, null);
  } else if (t.text) {
    openSheet(`<form class="form"><h2>${t.icon} ${t.label}</h2>
      <label>Что произошло <textarea name="text" rows="4" maxlength="2000" required placeholder="Например: «Буп» на выходе из лифта получился 4 раза из 5"></textarea></label>
      <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Записать</button></div>
    </form>`, (fd) => {
      const text = String(fd.get('text')).trim();
      if (text) saveEvent(type, { text });
    });
    setTimeout(() => { const ta = sheet.querySelector('textarea'); if (ta) ta.focus(); }, 50);
  } else {
    saveEvent(type);
  }
}

function editEvent(id) {
  const e = S.events.find((x) => x.id === id);
  if (!e) return;
  const t = EVENT_TYPES[e.type] || { label: e.type, icon: '' };
  openSheet(`<form class="form"><h2>${t.icon} ${t.label}</h2>
    <label>Время <input type="time" name="time" required value="${fmtTime(e.at)}"></label>
    ${t.subs ? `<label>Что было <select name="sub">${Object.entries(SUBS).map(([k, v]) => `<option value="${k}"${e.sub === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
    <label>${t.text ? 'Текст заметки' : 'Комментарий'} <textarea name="text" rows="3" maxlength="2000">${escapeHtml(e.text)}</textarea></label>
    <p class="muted small">Записал${e.name ? `: ${escapeHtml(e.name)}` : 'и'}</p>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
    <button type="button" class="btn danger-outline wide" data-action="ev-delete" data-id="${e.id}">Удалить запись</button>
  </form>`, (fd) => {
    const patch = { text: String(fd.get('text') || '').trim() };
    const hm = String(fd.get('time') || '');
    if (/^\d\d:\d\d$/.test(hm)) patch.at = moscowDate(e.day, hm);
    if (t.subs) patch.sub = String(fd.get('sub'));
    store.updateEvent(e.id, patch);
  });
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
    if (!confirm('Вернуть расписание как в памятке? Ваши правки и сегодняшние отметки расписания пропадут.')) return;
    S.defaultPlan = buildDefaultPlan();
    savePlan((p) => { p.schedule = S.defaultPlan.schedule; p.focus = []; });
  },
  // Журнал
  'ev-add': (el) => addEventFlow(el.dataset.type),
  'ev-sub': (el) => { closeSheet(); saveEvent(el.dataset.type, { sub: el.dataset.sub }); },
  'ev-edit': (el) => editEvent(el.dataset.id),
  'ev-delete': (el) => {
    if (!confirm('Удалить запись?')) return;
    store.deleteEvent(el.dataset.id);
    closeSheet();
  },
  // Редактор карточек
  'ed-add-block': (el) => { editorAction(S.editor.form, 'ed-add-block', el.dataset); render(true); },
  'ed-add-step': (el) => { editorAction(S.editor.form, 'ed-add-step', el.dataset); render(true); },
  'ed-move': (el) => { editorAction(S.editor.form, 'ed-move', el.dataset); render(true); },
  'ed-remove': (el) => {
    const what = el.dataset.kind === 'block' ? 'блок' : 'шаг';
    if (!confirm(`Удалить ${what}?`)) return;
    editorAction(S.editor.form, 'ed-remove', el.dataset);
    render(true);
  },
  'ed-cancel': () => {
    const e = S.editor;
    S.editor = null;
    location.hash = e && e.id ? `#/${e.tab}/${e.id}` : `#/${e ? e.tab : ''}`;
  },
  'ed-delete': () => {
    const e = S.editor;
    if (!confirm('Удалить карточку? Отметки «Освоено» по ней сохранятся, но карточка исчезнет из списка.')) return;
    if (e.source === 'new') store.removeCard(e.tab, e.id);
    else store.saveCard(e.tab, e.id, { deleted: true, md: '', group: (groupOf(e.tab, e.id) || {}).title || '' });
    S.editor = null;
    location.hash = `#/${e.tab}`;
    toast(e.source === 'new' ? 'Карточка удалена.' : 'Карточка удалена. Вернуть её можно в настройках.');
  },
  'ed-reset': () => {
    const e = S.editor;
    if (!confirm('Вернуть карточку как в файле? Ваши правки в приложении пропадут.')) return;
    store.removeCard(e.tab, e.id);
    S.editor = null;
    location.hash = `#/${e.tab}/${e.id}`;
  },
  'card-restore': (el) => { store.removeCard(el.dataset.tab, el.dataset.id); toast('Карточка вернулась.'); },
  // Резервная копия
  'backup-md': (el) => {
    const tab = el.dataset.tab;
    if (!S.catalogs[tab]) return;
    download(`batonchik-${({ k: 'komandy', g: 'igry', t: 'sovety' })[tab]}-${S.day}.md`, catalogMd(tab), 'text/markdown;charset=utf-8');
  },
  'backup-json': async () => {
    try {
      const data = await store.exportAll();
      if (!data) return;
      download(`batonchik-dannye-${S.day}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2), 'application/json');
    } catch (err) {
      console.error(err);
      toast('Не удалось собрать резервную копию. Проверьте интернет.');
    }
  },
  'diary-more': () => loadDiary(true),
  'toast-action': () => { const fn = toastAction; hideToast(); if (fn) fn(); },
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

// Поля редактора карточки пишут прямо в черновик формы
function onEditorInput(e) {
  const el = e.target;
  if (!S.editor || !el.dataset || !el.dataset.path || !el.closest('[data-editor]')) return;
  setPath(S.editor.form, el.dataset.path, el.type === 'checkbox' ? el.checked : el.value);
}
view.addEventListener('input', onEditorInput);
view.addEventListener('change', onEditorInput);
view.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-editor]')) return;
  e.preventDefault();
  saveEditor();
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
let toastAction = null;
function toast(text, action) {
  const t = $('#toast');
  toastAction = action ? action.onClick : null;
  t.innerHTML = `<span>${escapeHtml(text)}</span>${action ? `<button class="toast-btn" data-action="toast-action">${escapeHtml(action.label)}</button>` : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 7000 : 5000);
}
function hideToast() {
  $('#toast').hidden = true;
  toastAction = null;
}

// ---------- Запуск ----------

function checkDay() {
  const k = dayKey();
  if (k !== S.day) {
    S.day = k;
    S.checks = {};
    S.yesterday = S.events;
    S.events = [];
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
