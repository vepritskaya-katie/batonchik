// Экраны приложения «Батончик»: Сегодня, Команды, Игры, Советы и настройки.

import { parseBlocks, parseCatalog, parseCardMd, parseToday, renderBlocks, inline, escapeHtml, hash, plainText, stepKey as stepKeyFor } from './md.js';
import { createStore } from './store.js';
import { cardToForm, emptyForm, formToMd, editorHtml, editorAction, setPath } from './editor.js';
import {
  EVENT_TYPES, SUBS, TRAIN, dayKey, fmtTime, fmtDate, addDays, moscowDate, dayStats, eventRow, todaySummary, nightLine, nightFor, diaryHtml, plural, mondayOf, dayTitle,
} from './diary.js';
import { pickIdeas } from './ideas.js';

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
const MIN_REPS = 5;   // цель по умолчанию для тренировки на сегодня: не меньше 5 повторов
const MAX_REPS = 50;
// Версия списка тренировок (v у пункта): 2 — цели подняты до MIN_REPS, 3 — добавлены ежедневные
// «Протокол расслабления» и «Спокойно, пока мы едим», 4 — пояснения из памятки с охраной ресурсов
const PLAN_VERSION = 4;
const ADDED_IN_V3 = ['k/protokol-rasslableniya', 'k/spokoyno-poka-my-edim'];
// Карточки, переименованные в файлах: старая ссылка → новая (план, журнал, дневник)
const RENAMED = {
  'k/otday': 'k/menyaemsya', // «Отдай» → «Меняемся»
  'k/naydi': 'k/ischi', // «Найди!» → «Ищи»
  'k/namordnik-korzinka': 'k/korzinochnyy-namordnik',
  'g/tyagalka-beri-i-otday': 'g/tyagalka-beri-i-menyaemsya',
  'g/naydi-v-treh-korobkah': 'g/ischi-v-treh-korobkah',
};
// В этих играх поменялось только слово, шаги прежние — отметки читаем и под старым id
const MARKS_FROM = {
  'g/tyagalka-beri-i-menyaemsya': 'g/tyagalka-beri-i-otday',
  'g/ischi-v-treh-korobkah': 'g/naydi-v-treh-korobkah',
};
const newRef = (ref) => RENAMED[ref] || ref;
const withNewRefs = (events) => (events || []).map((e) => (RENAMED[e.card] ? { ...e, card: RENAMED[e.card] } : e));
const WEEK_SIZE = 10; // столько тренировок предлагается выбрать на неделю
const TABS = {
  k: { title: 'Тренировки', heading: 'Каталог тренировок', files: ['komandy.md'], sorted: true },
  g: { title: 'Игры', files: ['igry.md'], sorted: true },
  t: { title: 'Советы', files: ['sovety.md'], sorted: true },
};

const S = {
  base: {},           // k, g, t → каталог из файлов
  cardDocs: {},       // правки карточек из приложения: «k__ko-mne» → { md, group, deleted }
  catalogs: {},       // k, g, t → { groups, loose } — файлы с правками поверх
  today: null,        // разобранный rasporyadok.md: вступление, тренировки по умолчанию, «В течение дня»
  contentReady: false,
  defaultPlan: null,
  plan: null,
  needSeed: false,
  checks: {},
  marks: {},
  events: [],         // журнал за сегодня
  recent: [],         // журнал за 2 недели до сегодня — для ночного перерыва и «Идеи на сегодня»
  ideaShift: { game: 0, training: 0 },
  migrated: false,
  diary: { from: null, events: [], days: {}, loading: false, loadedAt: 0 },
  editor: null,       // { tab, id, form, isNew } — открытая форма правки карточки
  store: { mode: 'local', status: 'loading' },
  day: dayKey(),
  edit: { trainings: false },
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
    if (becameReady) loadRecent();
    if (st.status !== 'ready') S.edit.trainings = false;
    renderHeader();
    render();
  },
  onPlan(plan, { fromServer }) {
    S.plan = plan ? cleanPlan(plan) : null;
    if (!plan && fromServer && S.store.status === 'ready') {
      if (S.contentReady) store.seedPlan(S.defaultPlan); else S.needSeed = true;
    }
    migratePlan();
    render();
  },
  onDay(checks) { S.checks = checks || {}; render(); },
  onMarks(marks) { S.marks = marks || {}; render(); },
  onEvents(list) { S.events = withNewRefs(list); render(); },
  onCards(docs) { S.cardDocs = docs || {}; rebuildCatalogs(); render(); },
  onError(message) { toast(message); },
}, firebaseConfig);

const canWrite = () => S.store.status === 'ready';

function loadRecent() {
  store.loadHistory(addDays(S.day, -14), addDays(S.day, -1)).then((d) => { S.recent = withNewRefs(d.events); render(); }).catch(() => {});
}

function cleanPlan(p) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  return {
    schedule: list(p.schedule).slice(0, 60), // старое расписание: нужно только, чтобы понять, что пора перейти на тренировки
    // Тренировки на сегодня: карточка («k/ko-mne»), сколько повторов в день, пояснение
    focus: list(p.focus).map((x) => {
      const card = str(x.card, 120);
      return {
        id: str(x.id, 20) || rid(),
        card: newRef(card.includes('/') ? card : 'k/' + card),
        target: Math.min(MAX_REPS, Math.max(1, parseInt(x.target, 10) || 1)),
        note: str(x.note, 300),
        v: parseInt(x.v, 10) || 1,
        // week — понедельник недели, на которую выбрана тренировка; day — добавлена только на этот день
        week: /^\d{4}-\d\d-\d\d$/.test(x.week) ? x.week : '',
        day: /^\d{4}-\d\d-\d\d$/.test(x.day) ? x.day : '',
      };
    }).filter((x) => x.card.length > 2)
      // После переименования карточки в списке мог оказаться повтор — оставляем первый
      .filter((x, i, all) => all.findIndex((y) => y.card === x.card && y.week === x.week && y.day === x.day) === i),
  };
}

// Переход со старого расписания: если тренировок ещё нет, а расписание было — заполнить тренировки из памятки
function migratePlan() {
  if (S.migrated || !canWrite() || !S.contentReady || !S.plan) return;
  if (!S.plan.focus.length && S.plan.schedule.length && S.defaultPlan.focus.length) {
    S.migrated = true;
    savePlan((p) => { p.schedule = []; p.focus = S.defaultPlan.focus; });
    return;
  }
  // Обновления списка, по одному разу: цели не меньше MIN_REPS (v2), новые ежедневные тренировки (v3),
  // пояснения из обновлённой памятки (v4)
  if (S.plan.focus.some((f) => f.v < PLAN_VERSION)) {
    S.migrated = true;
    const needsV3 = S.plan.focus.some((f) => f.v < 3);
    const notes = new Map(S.defaultPlan.focus.map((f) => [f.card, f.note]));
    savePlan((p) => {
      p.focus.forEach((f) => {
        if (f.v < 2) f.target = Math.max(MIN_REPS, f.target);
        if (f.v < 4 && !f.day && notes.has(f.card)) f.note = notes.get(f.card);
        f.v = PLAN_VERSION;
      });
      if (!needsV3) return;
      for (const ref of ADDED_IN_V3) {
        const item = S.defaultPlan.focus.find((f) => f.card === ref);
        if (!item || p.focus.some((f) => f.card === ref)) continue;
        // На то же место, что в памятке: после предыдущего пункта списка по умолчанию, если он есть
        const order = S.defaultPlan.focus.map((f) => f.card);
        const before = order.slice(0, order.indexOf(ref)).reverse().find((c) => p.focus.some((f) => f.card === c));
        const at = before ? p.focus.findIndex((f) => f.card === before) + 1 : p.focus.length;
        p.focus.splice(at, 0, { ...item, id: rid(), v: PLAN_VERSION });
      }
    });
  }
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
    try { S.today = parseToday(t); } catch { S.today = { raw: t }; }
  }).catch(() => { S.today = { error: true }; }));
  await Promise.all(tasks);

  rebuildCatalogs();
  S.defaultPlan = buildDefaultPlan();
  S.contentReady = true;
  if (S.needSeed) { S.needSeed = false; store.seedPlan(S.defaultPlan); }
  migratePlan();
  render();
}

// Карточки из файлов, поверх — правки из приложения (по id карточки), в конце — новые карточки
function rebuildCatalogs() {
  for (const tab of Object.keys(TABS)) {
    const base = S.base[tab];
    if (!base) continue;
    let docs = Object.values(S.cardDocs).filter((d) => d && d.tab === tab);
    if (tab === 'k') docs = docs.concat(movedDocs(base, docs));
    const byId = new Map(docs.map((d) => [d.cardId, d]));
    const baseIds = new Set();
    const groups = base.groups.map((g) => ({
      ...g,
      cards: g.cards.flatMap((c) => {
        baseIds.add(c.id);
        const d = byId.get(c.id);
        if (!d) return [{ ...c, source: 'file' }];
        if (d.deleted) return [];
        const repsOnly = repsOnlyValue(d.md);
        if (repsOnly) {
          const raw = c.raw.replace(/(### Повторов в день\n)\d+/, `$1${repsOnly}`);
          return [{ ...c, raw, reps: repsOnly, source: 'file' }];
        }
        const edited = d.md && safeParseCard(d.md, c.id);
        return edited ? [{ ...edited, source: 'edited' }] : [{ ...c, source: 'file' }];
      }),
    }));
    // Правки старых карточек, переименованных в файлах, не показываем отдельными карточками
    docs.filter((d) => !baseIds.has(d.cardId) && !d.deleted && !RENAMED[`${tab}/${d.cardId}`]).sort((a, b) => (a.cardId < b.cardId ? -1 : 1)).forEach((d) => {
      const card = safeParseCard(d.md, d.cardId);
      if (!card) return;
      let g = groups.find((x) => x.title === d.group) || groups[0];
      if (!g) { g = { title: '', intro: [], introRaw: '', cards: [] }; groups.push(g); }
      g.cards.push({ ...card, source: 'new' });
    });
    // Тренировки и игры — по алфавиту внутри каждого раздела, без учёта кавычек
    if (TABS[tab].sorted) {
      const key = (c) => c.name.replace(/[«»„“"']/g, '').trim();
      groups.forEach((g) => g.cards.sort((a, b) => key(a).localeCompare(key(b), 'ru')));
    }
    S.catalogs[tab] = { ...base, groups };
  }
}

// Карточки, перенесённые из «Советов» (t) в «Тренировки» (k): их прежние правки из приложения хранятся под t
const MOVED_FROM = 't';
function movedDocs(base, kDocs) {
  const have = new Set(kDocs.map((d) => d.cardId));
  const kIds = new Set(base.groups.flatMap((g) => g.cards.map((c) => c.id)));
  const tIds = new Set(S.base.t ? S.base.t.groups.flatMap((g) => g.cards.map((c) => c.id)) : []);
  return Object.values(S.cardDocs).filter((d) => d && d.tab === MOVED_FROM && kIds.has(d.cardId) && !tIds.has(d.cardId) && !have.has(d.cardId));
}

// Правка только числа «Повторов в день» кнопками «−» / «+» на главном экране хранится короткой пометкой,
// чтобы текст карточки по-прежнему брался из файла и получал обновления
const REPS_ONLY = /^<!-- reps:(\d{1,2}) -->$/;
const repsOnlyValue = (md) => { const m = String(md || '').trim().match(REPS_ONLY); return m ? +m[1] : null; };

function setCardReps(ref, value) {
  const { tab, id, card } = cardByRef(ref);
  if (!card) return;
  const n = Math.min(MAX_REPS, Math.max(1, value));
  const group = (groupOf(tab, id) || {}).title || '';
  if (card.source === 'file') {
    store.saveCard(tab, id, { group, md: `<!-- reps:${n} -->` });
  } else {
    // Карточка уже исправлена в приложении — меняем число в её тексте
    const form = cardToForm(card, group, tab);
    form.reps = n;
    store.saveCard(tab, id, { group, md: formToMd(form) });
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

// «k/ko-mne» → { tab, id, card }
function cardByRef(ref) {
  const [tab, id] = newRef(String(ref)).split('/');
  return { tab, id, card: findCard(tab, id) };
}
const cardName = (ref) => { const r = cardByRef(ref); return r.card ? r.card.name : ref; };

// Карточка по названию из файла: «"Ко мне"», «Одиночество» — без учёта регистра и знаков
function findCardByName(name) {
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  for (const tab of ['k', 'g']) {
    const card = S.catalogs[tab] && S.catalogs[tab].groups.flatMap((g) => g.cards).find((c) => norm(c.name) === norm(name));
    if (card) return { tab, card };
  }
  return null;
}

function buildDefaultPlan() {
  const defaults = (S.today && S.today.defaults) || [];
  return {
    schedule: [],
    focus: defaults.map((d) => {
      const found = findCardByName(d.name);
      return found ? { id: rid(), card: `${found.tab}/${found.card.id}`, target: d.target || MIN_REPS, note: d.note, v: PLAN_VERSION } : null;
    }).filter(Boolean),
  };
}

// ---------- Отметки ----------

function byLine(m, withDate) {
  if (!m) return '';
  const when = m.at ? (withDate ? fmtDate(m.at) : fmtTime(m.at)) : 'только что';
  return [m.name, when].filter(Boolean).map(escapeHtml).join(' · ');
}

// Отметки под прежним id: игры, где поменялось только слово (MARKS_FROM), и карточки,
// перенесённые из «Советов», — их отметки раньше хранились с вкладкой t
function legacyId(id) {
  const m = id.match(/^(step|task|card)_([kgt])_([^_]+)(.*)$/);
  if (!m) return null;
  const from = MARKS_FROM[`${m[2]}/${m[3]}`];
  if (from) return `${m[1]}_${from.replace('/', '_')}${m[4]}`;
  return m[2] === 'k' ? `${m[1]}_${MOVED_FROM}_${m[3]}${m[4]}` : null;
}
function getMark(id) {
  const old = legacyId(id);
  return S.marks[id] || (old && S.marks[old]) || null;
}

function markButton(id, label = 'Освоено') {
  const m = getMark(id);
  return `<div class="mark${m ? ' on' : ''}">
    <button class="mark-btn" data-action="mark" data-id="${id}" data-confirm="1" aria-pressed="${!!m}"${canWrite() ? '' : ' disabled'}>
      ${m ? '✓ ' : ''}${label}</button>
    ${m ? `<span class="mark-by">${byLine(m, true)}</span>` : ''}
  </div>`;
}

function taskButton(id, text) {
  const m = getMark(id);
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
    done: card.steps.filter((k) => getMark(stepId(tab, card, k))).length,
    total: card.steps.length,
    mastered: card.hasResult && !!getMark(cardId(tab, card)),
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
  const night = nightFor(S.day, [...S.recent, ...S.events]);
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

// Цель на день: у тренировки — поле «Повторов в день» в карточке (по умолчанию 5), у игры — число в списке
function targetOf(item) {
  const { tab, card } = cardByRef(item.card);
  return tab === 'k' && card ? (card.reps || MIN_REPS) : item.target;
}

// Подходы за сегодня по карточкам: { 'k/ko-mne': 2 }
function todayTrains() {
  const counts = {};
  S.events.filter((e) => e.type === 'train').forEach((e) => { counts[e.card] = (counts[e.card] || 0) + 1; });
  return counts;
}

// Текущий шаг тренировки — первый неосвоенный
function currentStep(tab, card) {
  const p = cardProgress(tab, card);
  if (p.mastered || (p.total && p.done === p.total)) return 'освоено — поддерживаем';
  const i = card.steps.findIndex((k) => !getMark(stepId(tab, card, k)));
  return i >= 0 ? `шаг ${i + 1}: ${card.stepTitles[card.steps[i]] || ''}` : '';
}

// Что на главной сегодня: тренировки, выбранные на эту неделю, и добавленные только на сегодня.
// Пока выбор на неделю не сделан, показывается прежний список (без пометки недели).
function todayItems(plan = currentPlan()) {
  const week = mondayOf(S.day);
  // Новая неделя ещё не выбрана — показываем последнюю выбранную, а если её нет — прежний список
  const shown = plan.focus.some((f) => f.week === week) ? week
    : plan.focus.map((f) => f.week).filter((w) => w && w < week).sort().pop() || '';
  const isBase = (f) => (shown ? f.week === shown : !f.week && !f.day);
  return plan.focus.filter((f) => isBase(f) || f.day === S.day); // в сохранённом порядке
}
const weekChosen = (plan = currentPlan()) => plan.focus.some((f) => f.week === mondayOf(S.day));

function trainingsHtml() {
  const plan = currentPlan();
  const edit = S.edit.trainings;
  const can = canWrite();
  const counts = todayTrains();
  const visible = todayItems(plan);
  const rows = visible.map((it, i) => {
    const { tab, id, card } = cardByRef(it.card);
    const n = counts[it.card] || 0;
    const target = targetOf(it);
    return { it, i, tab, id, card, n, target, done: n >= target };
  });
  // Выполненные — вниз (в режиме правки — в своём порядке, чтобы работали стрелки)
  if (!edit) rows.sort((a, b) => a.done - b.done || a.i - b.i);
  const items = rows.map(({ it, i, tab, id, card, n, target, done }) => {
    const name = card ? card.name : 'Карточка не найдена';
    const segs = target <= 10
      ? `<span class="segs">${Array.from({ length: target }, (_, j) => `<span class="seg-dot${j < n ? ' on' : ''}"></span>`).join('')}</span>`
      : `<span class="mini-bar"><span style="width:${Math.min(100, Math.round(n / target * 100))}%"></span></span>`;
    const progress = `${segs}<span class="tr-count">${n} из ${target}</span>`;
    return `<li class="item tr${done ? ' done' : ''}">
      ${edit ? '' : `<button class="tr-tap${done ? ' on' : ''}" data-action="tr-tap" data-card="${it.card}"${can && card ? '' : ' disabled'}
        aria-label="Отметить повтор: ${escapeHtml(name)}, сделано ${n} из ${target}">
        ${done ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : `<span class="tr-plus">+1</span>`}</button>`}
      <div class="item-body">
        <div class="item-head">${card ? `<a class="item-title link" href="#/${tab}/${id}">${escapeHtml(name)}</a>` : `<span class="item-title muted">${name}</span>`}
          ${it.day ? '<span class="chip today-only">только сегодня</span>' : ''}</div>
        ${card && tab === 'k' ? `<div class="tr-step">${escapeHtml(currentStep(tab, card))}</div>` : ''}
        ${it.note ? `<div class="muted small">${inline(it.note)}</div>` : ''}
        ${n && can && !edit
          ? `<button class="tr-progress tr-progress-btn" data-action="tr-reps" data-card="${it.card}" aria-label="Повторы за сегодня: ${n}. Нажмите, чтобы убрать лишний">${progress}</button>`
          : `<div class="tr-progress">${progress}</div>`}
        ${edit ? `<div class="edit-row">
          <button class="icon-btn" data-action="tr-target" data-id="${it.id}" data-dir="-1" aria-label="Меньше повторов"${target <= 1 ? ' disabled' : ''}>−</button>
          <button class="icon-btn" data-action="tr-target" data-id="${it.id}" data-dir="1" aria-label="Больше повторов"${target >= MAX_REPS ? ' disabled' : ''}>+</button>
          <button class="icon-btn" data-action="tr-move" data-id="${it.id}" data-dir="-1" aria-label="Выше"${i === 0 ? ' disabled' : ''}>↑</button>
          <button class="icon-btn" data-action="tr-move" data-id="${it.id}" data-dir="1" aria-label="Ниже"${i === visible.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="btn small danger" data-action="tr-remove" data-id="${it.id}">Убрать</button>
        </div>` : ''}
      </div></li>`;
  }).join('');
  const t = S.today || {};
  const week = mondayOf(S.day);
  const chosen = weekChosen(plan);
  const editBtn = can ? `<button class="btn small${edit ? ' primary' : ''}" data-action="edit-toggle" data-section="trainings">${edit ? 'Готово' : 'Изменить'}</button>` : '';
  const weekBanner = can && !chosen && S.contentReady
    ? `<div class="banner week-banner"><span>${week === S.day ? 'Понедельник — ' : ''}выберите ${WEEK_SIZE} тренировок на эту неделю. Они будут на главной до воскресенья.</span>
        <button class="btn primary" data-action="week-pick">Выбрать</button></div>` : '';
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(t.title || 'Тренировки на сегодня')}</h2>${editBtn}</div>
    ${weekBanner}
    ${chosen ? `<p class="muted small">Неделя с ${dayTitle(week, { day: 'numeric', month: 'long' })}.</p>` : ''}
    ${t.intro && t.intro.length ? `<details class="intro"><summary>Как устроены занятия</summary><div class="prose">${renderBlocks(t.intro)}</div></details>` : ''}
    <p class="muted small">Одно нажатие на «+1» — один повтор. Сделали все повторы — строка станет зелёной и уйдёт вниз. Ошиблись — нажмите на счёт «2 из 5», чтобы убрать лишний повтор.</p>
    <ul class="list">${items || '<li class="empty">Список пуст. Нажмите «Изменить», чтобы добавить тренировки.</li>'}</ul>
    ${edit ? `<div class="edit-actions">
      <button class="btn" data-action="tr-add">+ Добавить на сегодня</button>
      <button class="btn" data-action="week-pick">${chosen ? 'Изменить выбор на неделю' : 'Выбрать на неделю'}</button>
    </div>` : ''}
  </section>`;
}

// Тренировки для выбора на неделю: сначала незаконченные с прошлой недели, потом из памятки, потом начатые
function weekRanking() {
  const plan = currentPlan();
  const week = mondayOf(S.day);
  const prev = new Set(plan.focus.filter((f) => f.week !== week && !f.day).map((f) => f.card));
  const defaults = S.defaultPlan.focus.map((f) => f.card);
  return commandCards().map((c) => {
    const ref = `k/${c.id}`;
    const p = cardProgress('k', c);
    const mastered = p.mastered || (p.total > 0 && p.done === p.total);
    let rank = 4;
    if (mastered) rank = 5;
    else if (prev.has(ref)) rank = 0;
    else if (defaults.includes(ref)) rank = 1;
    else if (p.done > 0) rank = 2;
    const di = defaults.indexOf(ref);
    return { ref, card: c, rank, order: di < 0 ? 999 : di, p, mastered };
  }).sort((a, b) => a.rank - b.rank || a.order - b.order || a.card.name.localeCompare(b.card.name, 'ru'));
}

function weekPickSheet() {
  const plan = currentPlan();
  const week = mondayOf(S.day);
  const ranking = weekRanking();
  const current = plan.focus.filter((f) => f.week === week).map((f) => f.card);
  const selected = new Set(current.length ? current : ranking.filter((x) => !x.mastered).slice(0, WEEK_SIZE).map((x) => x.ref));
  const info = new Map(ranking.map((x) => [x.ref, x]));
  const groups = S.catalogs.k.groups.map((g) => `<h3>${escapeHtml(g.title)}</h3>${g.cards.map((c) => {
    const x = info.get(`k/${c.id}`);
    const status = x.mastered ? 'освоено' : x.p.done ? `освоено шагов ${x.p.done} из ${x.p.total}` : 'ещё не начинали';
    return `<label class="choice-row"><input type="checkbox" name="cards" value="k/${c.id}"${selected.has(`k/${c.id}`) ? ' checked' : ''}>
      <span><span class="choice-name">${escapeHtml(c.name)}</span><span class="muted small">${status}</span></span></label>`;
  }).join('')}`).join('');
  openSheet(`<form class="form week-pick">
    <h2>Тренировки на неделю</h2>
    <p class="muted">Неделя с ${dayTitle(week, { day: 'numeric', month: 'long' })}. Отметьте ${WEEK_SIZE} тренировок — они будут на главной до воскресенья.
      Заранее отмечены незаконченные с прошлой недели и из памятки. Добавить что-то на один день можно в любой момент.</p>
    <p class="pick-count" aria-live="polite">Выбрано: <b>${selected.size}</b> из ${WEEK_SIZE}</p>
    ${groups}
    <div class="form-actions sticky"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить на неделю</button></div>
  </form>`, (fd) => {
    const chosen = new Set(fd.getAll('cards'));
    if (!chosen.size) { toast('Отметьте хотя бы одну тренировку.'); return; }
    const notes = new Map(S.defaultPlan.focus.map((f) => [f.card, f.note]));
    const order = ranking.map((x) => x.ref).filter((ref) => chosen.has(ref));
    savePlan((p) => {
      const old = new Map(p.focus.filter((f) => f.week === week).map((f) => [f.card, f]));
      // Оставляем только добавленное на сегодня и позже; прошлые недели и старый список больше не нужны
      const keepDays = p.focus.filter((f) => f.day && f.day >= S.day && !chosen.has(f.card));
      p.schedule = [];
      p.focus = [
        ...order.map((ref) => old.get(ref) || { id: rid(), card: ref, target: MIN_REPS, note: notes.get(ref) || '', v: PLAN_VERSION, week, day: '' }),
        ...keepDays,
      ];
    });
    toast(`На неделю выбрано: ${order.length}.`);
  });
  const count = () => { sheet.querySelector('.pick-count b').textContent = sheet.querySelectorAll('input[name=cards]:checked').length; };
  sheet.querySelector('.week-pick').addEventListener('change', count);
}

// Повторы за сегодня по одной тренировке — чтобы убрать ошибочный, даже если «Отменить» уже пропало
function repsSheet(ref) {
  const list = S.events.filter((e) => e.type === 'train' && e.card === ref).sort((a, b) => b.at - a.at);
  if (!list.length) return;
  openSheet(`<div class="form"><h2>${escapeHtml(cardName(ref))}</h2>
    <p class="muted">Повторы за сегодня. Лишний можно убрать — например, если отметили уже после полуночи.</p>
    <ul class="ev-list">${list.map((e) => `<li><div class="ev-row"><span class="ev-time">${fmtTime(e.at)}</span>
      <span class="ev-main"><span class="ev-label">Повтор</span>${e.name ? `<span class="ev-by">${escapeHtml(e.name)}</span>` : ''}</span>
      <button class="btn small danger" data-action="tr-rep-del" data-id="${e.id}">Убрать</button></div></li>`).join('')}</ul>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button></div></div>`, null);
}

function ideasHtml() {
  if (!canWrite() || !S.catalogs.k || !S.catalogs.g) return '';
  const plan = currentPlan();
  const refs = new Set(todayItems(plan).map((f) => f.card));
  const all = (tab) => S.catalogs[tab].groups.flatMap((g) => g.cards);
  const ideas = pickIdeas({
    day: S.day, games: all('g'), trainings: all('k'), inPlan: (ref) => refs.has(ref),
    events: [...S.recent, ...S.events], progress: (c) => cardProgress('k', c), shift: S.ideaShift,
  });
  const counts = todayTrains();
  const row = (kind, icon, label, idea, count) => {
    if (!idea) return '';
    const n = counts[idea.ref] || 0;
    return `<div class="idea">
      <div class="idea-head"><span class="idea-kind">${icon} ${label}</span>
        <a class="idea-name" href="#/${idea.tab}/${idea.card.id}">${escapeHtml(idea.card.name)}</a></div>
      <div class="muted small">${escapeHtml(idea.reason)}${n ? ` · сегодня ${n} ${plural(n, 'повтор', 'повтора', 'повторов')}` : ''}</div>
      <div class="idea-actions">
        <button class="btn small primary" data-action="tr-tap" data-card="${idea.ref}">${kind === 'game' ? 'Сыграли' : 'Сделали'}</button>
        ${kind === 'training' ? `<button class="btn small" data-action="idea-plan" data-card="${idea.ref}">В план на сегодня</button>` : ''}
        ${count > 1 ? `<button class="btn small" data-action="idea-next" data-kind="${kind}">Другая</button>` : ''}
      </div></div>`;
  };
  const html = row('game', '🎲', 'Игра', ideas.game, ideas.gameCount) + row('training', '🎯', 'Тренировка', ideas.training, ideas.trainingCount);
  return html ? `<section class="section"><div class="section-head"><h2>Идея на сегодня</h2></div><div class="ideas">${html}</div></section>` : '';
}

function renderToday() {
  const items = todayItems();
  const counts = todayTrains();
  const total = items.reduce((a, f) => a + targetOf(f), 0);
  const done = items.reduce((a, f) => a + Math.min(targetOf(f), counts[f.card] || 0), 0);
  const t = S.today || {};

  // «В течение дня» — из файла, без отметок
  const sections = (t.sections || []).map((g) => `<section class="section">
      ${g.title ? `<h2>${inline(g.title)}</h2>` : ''}
      ${g.intro && g.intro.length ? `<div class="prose">${renderBlocks(g.intro)}</div>` : ''}
      <ul class="list">${g.items.map((it) => `<li class="item plain"><div class="item-body">${scheduleItemHtml(it)}</div></li>`).join('')}</ul>
    </section>`).join('');

  return `
    <div class="dayhead">
      <h1>${todayTitle()}</h1>
      ${total ? `<div class="progress" role="img" aria-label="Подходов ${done} из ${total}"><span style="width:${Math.round(done / total * 100)}%"></span></div>
      <p class="muted">Тренировки: ${done} из ${total} ${plural(total, 'повтора', 'повторов', 'повторов')}. Счёт обнуляется в полночь по Москве.</p>` : ''}
    </div>
    ${statusBanner()}
    ${journalHtml()}
    ${ideasHtml()}
    ${t.raw ? `<div class="prose">${safe(() => renderBlocks(parseBlocks(t.raw)), t.raw)}</div>` : trainingsHtml()}
    ${t.error ? '<p class="empty">Не удалось загрузить главный экран. Проверьте интернет.</p>' : ''}
    ${sections}`;
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
  return `<div class="page-head"><h1>${single ? inline(cat.groups[0].title) : escapeHtml(TABS[tab].heading || title)}</h1>${addBtn}</div>${errors}${loose}${groups}`;
}

function renderCard(tab, id) {
  const card = findCard(tab, id);
  // «Назад» ведёт туда, откуда пришли (например, на «Сегодня» к тому же месту), иначе — в каталог
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const from = prevHash && pageTitle(prevHash);
  const back = from
    ? `<a class="back" href="${prevHash}" data-action="back">${arrow}${escapeHtml(from)}</a>`
    : `<a class="back" href="#/${tab}">${arrow}${TABS[tab].title}</a>`;
  if (!card) {
    return `${back}<h1>Не найдено</h1><p class="muted">${S.catalogs[tab] ? 'Возможно, карточку переименовали в памятке.' : 'Загружаем…'}</p>`;
  }
  const body = safe(() => {
    const lead = card.lead.length ? `<div class="prose">${blocksHtml(card.lead, tab, card)}</div>` : '';
    return lead + card.blocks.filter((b) => b.content.length && b.kind !== 'reps').map((b) => {
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
    ${tab === 'k' ? `<p class="reps-line">🎯 Повторов в день: <b>${card.reps || MIN_REPS}</b>${canWrite() ? ` <a href="#/edit/k/${card.id}">изменить</a>` : ''}</p>` : ''}
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
      S.editor = { key: editorKey(r), tab, id: card.id, isNew, source: card.source, form: cardToForm(card, g ? g.title : '', tab) };
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
    S.diary = { from, events: withNewRefs(data.events), days: data.days, loading: false, loadedAt: Date.now() };
  } catch (err) {
    console.error(err);
    S.diary.loading = false;
    toast('Не удалось загрузить дневник. Проверьте интернет.');
  }
  render();
}

// Подпись отметки «Освоено» для дневника: «"Буп": Ладонь у носа»
function markLabel(id) {
  const [type, tab0, cid, key] = id.split('_');
  const tab = tab0 === MOVED_FROM && !findCard(tab0, cid) && findCard('k', cid) ? 'k' : tab0;
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
  const total = 0;
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
  return diaryHtml({ days, prevWeek: days.slice(7, 14), markLabels, cardName, hasMore: !!S.diary.from && !S.diary.loading, loading: S.diary.loading || !S.diary.from });
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
      <p class="muted">Карточки скачиваются в том же формате, что файлы в папке content, вместе с вашими правками. Журнал, отметки и список тренировок — одним файлом .json.</p>
      <div class="edit-actions">
        <button class="btn small" data-action="backup-md" data-tab="k">Тренировки (.md)</button>
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

// Место на странице: при уходе запоминаем прокрутку, при возврате восстанавливаем.
// Карточки открываются сверху.
const scrollMemory = {};
let currentHash = location.hash || '#/';
let prevHash = null;
let pendingScroll = null; // { y, until } — дождаться, пока страница дорисуется до нужной высоты

function onHashChange() {
  scrollMemory[currentHash] = window.scrollY;
  prevHash = currentHash;
  currentHash = location.hash || '#/';
  render();
}

// Название страницы для кнопки «Назад»; для правки карточки — нет (туда не возвращаемся)
function pageTitle(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length || parts[0] === 'today') return 'Сегодня';
  if (parts[0] === 'edit') return null;
  if (parts[0] === 'd') return 'Дневник';
  if (parts[0] === 'me') return 'Настройки';
  if (TABS[parts[0]]) return parts[1] ? 'Назад' : TABS[parts[0]].title;
  return null;
}

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
    const saved = scrollMemory[currentHash];
    const isCard = !!(TABS[r.tab] && r.id);
    pendingScroll = !isCard && saved ? { y: saved, until: Date.now() + 2000 } : null;
    window.scrollTo(0, pendingScroll ? saved : 0);
  } else if (pendingScroll && Date.now() < pendingScroll.until) {
    // Страница дорисовалась (например, подгрузились данные) — дотягиваем до запомненного места
    window.scrollTo(0, pendingScroll.y);
  }
  if (pendingScroll && (Math.abs(window.scrollY - pendingScroll.y) < 2 || Date.now() >= pendingScroll.until)) pendingScroll = null;
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

function saveEvent(type, extra = {}, at = new Date(), day = dayKey(at)) {
  const id = store.addEvent({ type, sub: '', text: '', ...extra, at, day });
  const t = EVENT_TYPES[type];
  // Запись за вчера (сделали после полуночи) в сегодняшний журнал не попадает — обновляем историю
  const past = day !== dayKey(new Date());
  if (past) loadRecent();
  toast(`Записано: ${t.label.toLowerCase()}${extra.sub ? ` — ${SUBS[extra.sub]}` : ''}, ${past ? 'вчера ' : ''}${fmtTime(at)}`, {
    label: 'Отменить', onClick: () => { if (id) store.deleteEvent(id); if (past) loadRecent(); },
  });
}

// Время, указанное в окне записи: сегодня, а если оно ещё не наступило — вчера (записали после полуночи)
function pastTime(hm) {
  const now = new Date();
  const today = dayKey(now);
  if (!/^\d\d:\d\d$/.test(hm)) return { at: now, day: today };
  const at = moscowDate(today, hm);
  if (at - now <= 5 * 60000) return { at, day: today };
  const day = addDays(today, -1);
  return { at: moscowDate(day, hm), day };
}

function saveTrain(ref) {
  const at = new Date();
  const n = (todayTrains()[ref] || 0) + 1; // считаем до записи: хранилище может обновить журнал сразу
  const id = store.addEvent({ type: 'train', card: ref, at, day: dayKey(at) });
  const it = todayItems().find((f) => f.card === ref);
  toast(`${TRAIN.label}: ${cardName(ref)}${it ? ` — ${Math.min(n, 99)} из ${targetOf(it)}` : ''}`, {
    label: 'Отменить', onClick: () => { if (id) store.deleteEvent(id); },
  });
}

// Добавить тренировку или игру только на сегодня
function addForToday(ref) {
  if (todayItems().some((f) => f.card === ref)) return;
  savePlan((p) => p.focus.push({ id: rid(), card: ref, target: MIN_REPS, note: '', v: PLAN_VERSION, week: '', day: S.day }));
}

function addTrainingSheet() {
  const used = new Set(todayItems().map((f) => f.card));
  const groups = ['k', 'g'].flatMap((tab) => (S.catalogs[tab] ? S.catalogs[tab].groups : []).map((g) => {
    const cards = g.cards.filter((c) => !used.has(`${tab}/${c.id}`));
    if (!cards.length) return '';
    return `<h3>${escapeHtml(g.title || TABS[tab].title)}</h3>${cards.map((c) =>
      `<button type="button" class="pick" data-action="tr-pick" data-card="${tab}/${c.id}">${escapeHtml(c.name)}${c.subtitle ? `<span class="muted">${escapeHtml(c.subtitle)}</span>` : ''}</button>`).join('')}`;
  })).join('');
  openSheet(`<div class="form"><h2>Добавить на сегодня</h2>
    <p class="muted">Тренировка или игра появится на главной только сегодня. Чтобы заниматься ею всю неделю, выберите её в «Изменить выбор на неделю».</p>
    ${groups || '<p class="muted">Всё уже в списке.</p>'}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button></div></div>`, null);
}

function addEventFlow(type) {
  const t = EVENT_TYPES[type];
  if (!t) return;
  if (t.form) {
    eventFormSheet(type);
  } else if (t.subs) {
    openSheet(`<div class="form"><h2>${t.icon} ${t.label}</h2>
      ${Object.entries(SUBS).map(([k, v]) => `<button type="button" class="pick big" data-action="ev-sub" data-type="${type}" data-sub="${k}">${v.charAt(0).toUpperCase() + v.slice(1)}</button>`).join('')}
      <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button></div></div>`, null);
  } else {
    saveEvent(type);
  }
}

// Окно новой записи: что было (для туалета), время (по умолчанию сейчас), комментарий; в журнал — по «Сохранить»
function eventFormSheet(type) {
  const t = EVENT_TYPES[type];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  openSheet(`<form class="form"><h2>${t.icon} ${t.label}</h2>
    ${t.subs ? `<fieldset><legend>Что было</legend><div class="choices">${Object.entries(SUBS).map(([k, v]) =>
      `<label class="choice"><input type="radio" name="sub" value="${k}" required>${cap(v)}</label>`).join('')}</div></fieldset>` : ''}
    <label>Время <input type="time" name="time" required value="${fmtTime(new Date())}"></label>
    <p class="muted small ev-when" hidden></p>
    <label>${t.text ? 'Что произошло' : 'Комментарий'} <textarea name="text" rows="${t.text ? 4 : 2}" maxlength="2000"${t.text
      ? ' required placeholder="Например: «Буп» на выходе из лифта получился 4 раза из 5"' : ' placeholder="Необязательно"'}></textarea></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const text = String(fd.get('text') || '').trim();
    if (t.text && !text) return;
    const sub = t.subs && SUBS[fd.get('sub')] ? String(fd.get('sub')) : '';
    const { at, day } = pastTime(String(fd.get('time') || ''));
    saveEvent(type, { sub, text }, at, day);
  });
  // Подсказка, если время ещё не наступило: запись уйдёт во вчерашний день
  const time = sheet.querySelector('input[name=time]');
  const when = sheet.querySelector('.ev-when');
  time.addEventListener('input', () => {
    const { day } = pastTime(time.value);
    when.hidden = day === dayKey(new Date());
    when.textContent = when.hidden ? '' : `Запишется на вчера, ${dayTitle(day, { day: 'numeric', month: 'long' })}.`;
  });
  if (t.text) setTimeout(() => { const ta = sheet.querySelector('textarea'); if (ta) ta.focus(); }, 50);
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
  'mark': (el) => {
    const id = el.dataset.id;
    const on = !!getMark(id);
    if (on && el.dataset.confirm && !confirm('Снять отметку «Освоено»?')) return;
    if (on) {
      if (S.marks[id]) store.setMark(id, false);
      const old = legacyId(id);
      if (old && S.marks[old]) store.setMark(old, false);
    } else store.setMark(id, true);
  },
  'edit-toggle': (el) => { S.edit[el.dataset.section] = !S.edit[el.dataset.section]; render(); },
  // Тренировки на сегодня
  'tr-tap': (el) => saveTrain(el.dataset.card),
  'tr-target': (el) => {
    const item = currentPlan().focus.find((x) => x.id === el.dataset.id);
    if (!item) return;
    const { tab, card } = cardByRef(item.card);
    // У тренировки число хранится в карточке («Повторов в день»), у игры — в списке
    if (tab === 'k' && card) setCardReps(item.card, targetOf(item) + +el.dataset.dir);
    else savePlan((p) => {
      const it = p.focus.find((x) => x.id === el.dataset.id);
      if (it) it.target = Math.min(MAX_REPS, Math.max(1, it.target + +el.dataset.dir));
    });
  },
  // Стрелки двигают пункт среди тех, что видны сегодня
  'tr-move': (el) => savePlan((p) => {
    const ids = todayItems(p).map((f) => f.id);
    const i = ids.indexOf(el.dataset.id);
    const j = i + +el.dataset.dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const a = p.focus.findIndex((f) => f.id === ids[i]);
    const b = p.focus.findIndex((f) => f.id === ids[j]);
    [p.focus[a], p.focus[b]] = [p.focus[b], p.focus[a]];
  }),
  'tr-remove': (el) => {
    const it = currentPlan().focus.find((x) => x.id === el.dataset.id);
    if (!it) return;
    const name = cardName(it.card).replace(/[«»]/g, '');
    const where = it.day ? 'из тренировок на сегодня' : it.week ? 'из плана на неделю' : 'из списка';
    if (confirm(`Убрать «${name}» ${where}?`)) savePlan((p) => { p.focus = p.focus.filter((x) => x.id !== it.id); });
  },
  'week-pick': () => weekPickSheet(),
  'tr-reps': (el) => repsSheet(el.dataset.card),
  'tr-rep-del': (el) => {
    store.deleteEvent(el.dataset.id);
    closeSheet();
    toast('Повтор убран.');
  },
  'tr-add': () => addTrainingSheet(),
  'tr-pick': (el) => { addForToday(el.dataset.card); closeSheet(); },
  'idea-plan': (el) => {
    addForToday(el.dataset.card);
    toast(`${cardName(el.dataset.card)} — в тренировках на сегодня.`);
  },
  'idea-next': (el) => { S.ideaShift[el.dataset.kind] = (S.ideaShift[el.dataset.kind] || 0) + 1; render(); },
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
    if (e.tab === 'k') store.removeCard(MOVED_FROM, e.id); // правка, сделанная, пока карточка была в «Советах»
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
  'back': () => history.back(),
  'toast-action': () => { const fn = toastAction; hideToast(); if (fn) fn(); },
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
  if (el.dataset.path === 'reps' && /\D/.test(el.value)) el.value = el.value.replace(/\D/g, '');
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
    S.recent = [...S.recent, ...S.events];
    S.events = [];
    S.ideaShift = { game: 0, training: 0 };
    store.setDay(k);
    render();
  }
}

applyTheme();
window.addEventListener('hashchange', onHashChange);
// Пользователь сам прокрутил страницу — больше не тянем её к запомненному месту
window.addEventListener('touchstart', () => { pendingScroll = null; }, { passive: true });
window.addEventListener('wheel', () => { pendingScroll = null; }, { passive: true });
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
