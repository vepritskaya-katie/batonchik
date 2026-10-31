// Экраны приложения «Батончик»: Главная, День, Тренировки (с играми), Паспорт, Советы (с Каналами), Дневник и настройки.

import { parseBlocks, parseCatalog, parseCardMd, parseToday, renderBlocks, inline, escapeHtml, hash, plainText, stepKey as stepKeyFor } from './md.js';
import { createStore } from './store.js';
import { cardToForm, emptyForm, formToMd, editorHtml, editorAction, setPath, formatText } from './editor.js';
import {
  EVENT_TYPES, SUBS, TRAIN, dayKey, fmtTime, fmtDate, addDays, moscowDate, dayStats, eventRow, todaySummary, nightLine, nightFor, plural, mondayOf, dayTitle,
  rhythmHtml, weekStatsHtml, daySummaryLine, trainsLine, MONTHS_SHORT,
} from './diary.js';
import { HEALTH_KINDS, NEXT_OPTIONS, nextDate, suggestNext, dueText, ageText, upcoming, doneRecords, googleCalendarUrl, icsText, healthRowHtml, daysBetween, ageShort, ageMonths } from './passport.js';
import { pickPhotos, compressPhoto } from './photo.js';
import { fmtNum, parseNum, series, deltaText, lineChartSvg } from './growth.js';
import { RUBRICS, parseLibrary, quizOrder, readKey, readCount, readBtn, metaChips, articleBody, foldList, agesHtml, dictHtml, booksHtml, quizHtml, introHtml } from './library.js';
import { pickIdeas } from './ideas.js';
import { parseNotes, notesListHtml, noteHtml, noteMatches, countText } from './notes.js';

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
const DAY_START_HOUR = 6; // если «Легли вечером» не отметили, новый день начинается в 6:00
const moscowHour = (d = new Date()) => Number(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: 'numeric', hourCycle: 'h23' }).format(d));
const DIARY_STEP = 14; // вкладка «День»: две недели истории для сводки и графиков
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
  'k/zhdi': 'k/zhdat', // «Жди» → «Ждать»
};
// Здесь поменялось только слово, шаги прежние — отметки читаем и под старым id
const MARKS_FROM = {
  'g/tyagalka-beri-i-menyaemsya': 'g/tyagalka-beri-i-otday',
  'g/ischi-v-treh-korobkah': 'g/naydi-v-treh-korobkah',
  'k/zhdat': 'k/zhdi',
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
  day: startDay(),
  edit: { trainings: false },
  notes: null,        // вкладка «Каналы»: заметки из Telegram-каналов (только чтение)
  notesFilter: { q: '', now: false, future: false, sci: false, exp: false },
  pet: null,          // паспорт: { name, breed, birth, sex, chip, mdr1, weight }
  photo: '',          // фото Батончика (data:image/jpeg…)
  health: [],         // паспорт: прививки, обработки, таблетки, врач — { id, title, kind, date, done, note }
  growth: [],         // рост и вес: { id, date, weight (кг), height (см) }
  lib: null,          // Библиотека (content/biblioteka.md)
  reads: { items: {}, quiz: {} }, // что прочитано в Библиотеке и лучшие результаты тестов — у каждого свои
  quiz: { test: '', i: 0, picked: null, score: 0, done: false, order: null },
  vet: null,          // «Срочно к ветеринару»: круглосуточная клиника и наш ветеринар
  weeks: [],          // «Неделя Батончика»: { id: воскресенье, joy, choice, sleep, ribs, waist, notes }
  factShift: 0,       // «Факт дня» на главной: нажатие — следующий
  stories: {},        // дневник: заметки о днях { 'ГГГГ-ММ-ДД': { title, text, special, hasPhoto, photoCount, photoKey } } — все, без фото
  storyPhotos: {},    // фото к заметкам, загруженные по требованию: { день: { key, list: [data:image…], loading, failedAt } }
  cal: { month: '', sel: '', memShift: 0 }, // календарь в Дневнике: месяц ГГГГ-ММ, выбранный день, «другое воспоминание»
  months: {},         // журнал по месяцам для календаря: { 'ГГГГ-ММ': { events, loading, loadedAt } }
};

const DOG = () => (S.pet && S.pet.name) || 'Батончик';

// ---------- День приложения ----------
// Новый день начинается после «Легли вечером», а не в полночь: записи после полуночи, пока не легли спать,
// остаются во вчерашнем дне. Подстраховка, если «Легли» забыли нажать, — «Встали утром» или 6:00.
function startDay() {
  const now = new Date();
  return moscowHour(now) < DAY_START_HOUR ? addDays(dayKey(now), -1) : dayKey(now);
}

function appDay(now = new Date()) {
  const cal = dayKey(now);
  const stillYesterday = S.day === addDays(cal, -1) && moscowHour(now) < DAY_START_HOUR && !S.events.some((e) => e.type === 'bed');
  return stillYesterday ? S.day : cal;
}

// День для записи: всё, что после полуночи и до «Легли», — во вчерашний день; «Встали утром» — уже новый день
function eventDayFor(at, type) {
  const cal = dayKey(at);
  if (type !== 'wake' && cal === dayKey() && S.day < cal) return S.day;
  return cal;
}

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- Время по Москве ----------

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
  onEvents(list) {
    S.events = withNewRefs(list);
    render();
    if (appDay() !== S.day) setTimeout(checkDay, 0);
  },
  onCards(docs) { S.cardDocs = docs || {}; rebuildCatalogs(); render(); },
  onPet(pet) { S.pet = pet; render(); },
  onPhoto(data) { S.photo = data || ''; render(); },
  onHealth(list) { S.health = list || []; render(); },
  onGrowth(list) { S.growth = list || []; render(); },
  onReads(r) { S.reads = r || { items: {}, quiz: {} }; render(); },
  onVet(v) { S.vet = v; render(); },
  onWeeks(list) { S.weeks = list || []; render(); },
  onStories(map) { S.stories = map || {}; render(); },
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
  tasks.push(loadText('kanaly.md').then((t) => {
    try { S.notes = parseNotes(t); } catch (err) { console.error(err); S.notes = { error: true }; }
  }).catch(() => { S.notes = { error: true }; }));
  tasks.push(loadText('biblioteka.md').then((t) => {
    try { S.lib = parseLibrary(t); } catch (err) { console.error(err); S.lib = { error: true }; }
  }).catch(() => { S.lib = { error: true }; }));
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
    // Число «Повторов в день», заданное до переименования карточки, переходит к ней под новым id
    const have = new Set(docs.map((d) => d.cardId));
    docs.forEach((d) => {
      const to = RENAMED[`${tab}/${d.cardId}`];
      const id = to && to.split('/')[1];
      if (id && !have.has(id) && repsOnlyValue(d.md)) { docs.push({ ...d, cardId: id }); have.add(id); }
    });
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

const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

// Шапка страницы: надпись сверху, заголовок, подзаголовок и круглая кнопка «+»
function pageHead({ eyebrow = '', title, sub = '', plus = null }) {
  return `<div class="page-head">
    <div class="page-head-text">${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h1>${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
    ${plus && canWrite() ? `<button class="round-btn" data-action="${plus.action}" aria-label="${escapeHtml(plus.label)}">${PLUS_SVG}</button>` : ''}
  </div>`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
  return `<section class="card">
    <div class="card-head"><h2>Журнал</h2></div>
    <div class="ev-buttons">${buttons}</div>
    ${todaySummary(st)}
    ${nightLine(night)}
    ${list.length ? `<ul class="ev-list">${list.map((e) => eventRow(e, { editable: can })).join('')}</ul>`
      : '<p class="muted">Сегодня ещё ничего не записано. Нажмите кнопку, и запись появится здесь с временем и именем.</p>'}
  </section>`;
}

// Строка значков быстрых записей (на главной): одно нажатие — как кнопки журнала
function evIconsHtml() {
  const can = canWrite();
  return `<div class="ev-icons">${Object.entries(EVENT_TYPES).map(([type, t]) =>
    `<button class="ev-icon-btn" data-action="ev-add" data-type="${type}"${can ? '' : ' disabled'} aria-label="${t.label}">
      <span class="ev-icon" aria-hidden="true">${t.icon}</span><span>${t.short}</span></button>`).join('')}</div>`;
}

// «+» вверху главной и «Дня»: выбор, что записать
function evMenuSheet() {
  openSheet(`<div class="form"><h2>Новая запись</h2>
    ${Object.entries(EVENT_TYPES).map(([type, t]) => `<button type="button" class="pick big" data-action="ev-add" data-type="${type}" data-close="1">${t.icon} ${t.label}</button>`).join('')}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button></div></div>`, null);
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

function trainingsHtml(title = '') {
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
    <div class="section-head"><h2>${escapeHtml(title || t.title || 'Тренировки на сегодня')}</h2>${editBtn}</div>
    ${weekBanner}
    ${chosen ? `<p class="muted small">Неделя с ${dayTitle(week, { day: 'numeric', month: 'long' })}.</p>` : ''}
    ${t.intro && t.intro.length ? `<details class="intro"><summary>Как устроены занятия</summary><div class="prose">${renderBlocks(t.intro)}</div></details>` : ''}
    <p class="muted small">Одно нажатие на «+1» — один повтор. Сделали все повторы — строка станет зелёной и уйдёт вниз. Ошиблись — нажмите на счёт «2 из 5», чтобы убрать лишний повтор. Счёт начинается заново после «Легли вечером».</p>
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
  return html ? `<section class="section">
    <div class="section-head"><h2>Идеи на сегодня</h2></div>
    <p class="muted small">Игра и тренировка вне плана — если есть время и настроение.</p>
    <div class="ideas">${html}</div></section>` : '';
}

// Прогресс тренировок за день: сколько тренировок выполнено и сколько повторов сделано
function dayProgress() {
  const items = todayItems();
  const counts = todayTrains();
  const total = items.reduce((a, f) => a + targetOf(f), 0);
  const done = items.reduce((a, f) => a + Math.min(targetOf(f), counts[f.card] || 0), 0);
  const finished = items.filter((f) => (counts[f.card] || 0) >= targetOf(f)).length;
  return { items, counts, total, done, finished };
}

function greeting() {
  const h = moscowHour();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const PAW_SVG = '<svg class="ms" viewBox="0 -960 960 960" aria-hidden="true"><path d="M169.86-485Q132-485 106-511.14t-26-64Q80-613 106.14-639t64-26Q208-665 234-638.86t26 64Q260-537 233.86-511t-64 26ZM291-681.14q-26-26.14-26-64T291.14-809q26.14-26 64-26T419-808.86q26 26.14 26 64T418.86-681q-26.14 26-64 26T291-681.14Zm250 0q-26-26.14-26-64T541.14-809q26.14-26 64-26T669-808.86q26 26.14 26 64T668.86-681q-26.14 26-64 26T541-681.14ZM789.86-485Q752-485 726-511.14t-26-64Q700-613 726.14-639t64-26Q828-665 854-638.86t26 64Q880-537 853.86-511t-64 26ZM266-75q-42 0-69-31.53-27-31.52-27-74.47 0-42 25.5-74.5T250-318q22-22 41-46.5t36-50.5q29-44 65-82t88-38q52 0 88.5 38t65.5 83q17 26 35.5 50t40.5 46q29 30 54.5 62.5T790-181q0 42.95-27 74.47Q736-75 694-75q-54 0-107-9t-107-9q-54 0-107 9t-107 9Z"/></svg>';

// Фото Батончика и прогресс дня
function heroHtml() {
  const p = dayProgress();
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const age = ageText(S.pet && S.pet.birth, S.day);
  const headline = !p.items.length ? 'Новый день'
    : p.finished === p.items.length ? 'Все тренировки сделаны!' : `Тренировки: ${p.finished} из ${p.items.length}`;
  return `<section class="hero${S.photo ? '' : ' no-photo'}">
    ${S.photo ? `<img class="hero-img" src="${escapeHtml(S.photo)}" alt="${escapeHtml(DOG())}">` : `<div class="hero-empty">${PAW_SVG}</div>`}
    <span class="hero-pill"><i></i>${escapeHtml(DOG())}${age ? ` · ${age}` : ''}</span>
    ${!S.photo && canWrite() ? '<button class="hero-photo-btn" data-action="photo-pick">Добавить фото</button>' : ''}
    <div class="hero-copy">
      <h2>${headline}</h2>
      <p>${p.total ? `Повторы: ${p.done} из ${p.total}` : 'Выберите тренировки на неделю — и здесь появится прогресс.'}</p>
      <div class="hero-meta"><span>Прогресс дня</span><strong>${pct}%</strong></div>
      <div class="hero-track" role="img" aria-label="Прогресс дня ${pct}%"><span style="width:${pct}%"></span></div>
    </div>
  </section>`;
}

// Тренировки дня на главной: пять первых несделанных с «+1»; весь план — во вкладке «Тренировки»
const HOME_TRAININGS = 5;
function homeTrainingsHtml() {
  if (S.today && (S.today.raw || S.today.error)) return '';
  const can = canWrite();
  const p = dayProgress();
  const left = p.items.filter((it) => (p.counts[it.card] || 0) < targetOf(it));
  const list = left.slice(0, HOME_TRAININGS).map((it) => {
    const { tab, id, card } = cardByRef(it.card);
    const n = p.counts[it.card] || 0;
    const target = targetOf(it);
    const name = card ? card.name : 'Карточка не найдена';
    return `<li class="mini-row">
      ${card ? `<a class="mini-name" href="#/${tab}/${id}">${escapeHtml(name)}</a>` : `<span class="mini-name muted">${name}</span>`}
      ${n && can ? `<button class="mini-count" data-action="tr-reps" data-card="${it.card}" aria-label="Повторы за сегодня: ${n}. Нажмите, чтобы убрать лишний">${n} из ${target}</button>`
        : `<span class="mini-count">${n} из ${target}</span>`}
      <button class="mini-tap" data-action="tr-tap" data-card="${it.card}"${can && card ? '' : ' disabled'} aria-label="Отметить повтор: ${escapeHtml(name)}">+1</button>
    </li>`;
  }).join('');
  const more = left.length - HOME_TRAININGS;
  const chosen = weekChosen();
  const banner = can && !chosen && S.contentReady
    ? `<div class="banner week-banner"><span>Выберите ${WEEK_SIZE} тренировок на эту неделю.</span><button class="btn small primary" data-action="week-pick">Выбрать</button></div>` : '';
  let body;
  if (list) body = `<ul class="mini-list">${list}</ul>`;
  else if (p.items.length) body = '<p class="muted">Все тренировки на сегодня сделаны.</p>';
  else body = '<p class="muted">На сегодня тренировок нет. Выберите их во вкладке «Тренировки».</p>';
  return `<section class="card">
    <div class="card-head"><h2>Тренировки дня</h2></div>
    ${banner}
    ${body}
    <a class="text-link more" href="#/k">${more > 0 ? `Ещё ${more} — весь план` : 'Весь план'} ›</a>
  </section>`;
}

// «1 ч 40 мин назад»
function agoText(at, now = new Date()) {
  const m = Math.max(0, Math.floor((now - at) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h >= 24) return 'больше суток назад';
  return `${h} ч${m % 60 ? ` ${m % 60} мин` : ''} назад`;
}
// Время «назад» на главной обновляется само, без перерисовки экрана
function updateSince() {
  document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = agoText(new Date(el.dataset.since)); });
}

// Журнал на главной: значки записи, сколько прошло с последнего туалета и сколько еды отсыпали за сегодня
function homeJournalHtml() {
  const all = [...S.recent, ...S.events];
  const last = (types) => all.filter((e) => types.includes(e.type)).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  const toilet = last(['toilet', 'accident']);
  const meals = S.events.filter((e) => e.type === 'meal' && e.day === S.day);
  const grams = meals.reduce((a, e) => a + (e.grams || 0), 0);
  const noGrams = meals.filter((e) => !e.grams).length;
  const food = !meals.length ? 'ещё не кормили'
    : grams ? `${grams} г${noGrams ? ` + ${noGrams} без веса` : ''}` : `${meals.length} ${plural(meals.length, 'раз', 'раза', 'раз')}`;
  const home = toilet && toilet.type === 'accident';
  const cell = (label, value) => `<div class="since-cell"><span>${label}</span><strong${value.at ? ` data-since="${new Date(value.at).toISOString()}"` : ''}>${value.text}</strong></div>`;
  return `<section class="card">
    <div class="card-head"><h2>Журнал</h2><a class="text-link" href="#/day">Весь день ›</a></div>
    ${evIconsHtml()}
    <div class="since">
      ${cell(`${home ? EVENT_TYPES.accident.icon : EVENT_TYPES.toilet.icon} Туалет${home ? ' дома' : ''}`,
        toilet ? { at: toilet.at, text: agoText(new Date(toilet.at)) } : { text: 'ещё не было' })}
      ${cell(`${EVENT_TYPES.meal.icon} Еда сегодня`, { text: food })}
    </div>
  </section>`;
}

// Здоровье на главной: только если до события неделя или меньше (или оно просрочено)
function homeHealthHtml() {
  const soon = upcoming(S.health).filter((r) => daysBetween(S.day, r.date) <= 7).slice(0, 3);
  if (!soon.length) return '';
  return `<section class="health-strip">
    <div class="health-symbol" aria-hidden="true">🩺</div>
    <div><p class="eyebrow">Здоровье</p><strong>Скоро</strong></div>
    <ul class="health-list">${soon.map((r) => healthRowHtml(r, S.day)).join('')}</ul>
    <a class="btn small wide" href="#/pass">Открыть паспорт ›</a></section>`;
}

function renderHome() {
  return `${pageHead({ eyebrow: cap(dayTitle(S.day)), title: greeting() })}
    ${statusBanner()}
    ${heroHtml()}
    ${homeJournalHtml()}
    ${factHtml()}
    ${homeTrainingsHtml()}
    ${homeHealthHtml()}`;
}

// ---------- День ----------

function renderDayPage() {
  if (canWrite() && (!S.diary.from || (Date.now() - S.diary.loadedAt > 60000 && !S.diary.loading))) {
    if (!S.diary.loading) setTimeout(() => loadDiary(false), 0);
  }
  const st = dayStats(S.day, S.events, S.checks, 0);
  st.night = nightFor(S.day, [...S.recent, ...S.events]);
  const p = dayProgress();
  const days = diaryDays();
  return `${pageHead({ eyebrow: cap(dayTitle(S.day)), title: 'День', sub: 'Всё, что отметили за день. Новый день начнётся после «Легли вечером».', plus: { action: 'ev-menu', label: 'Новая запись' } })}
    ${statusBanner()}
    ${weekCardHtml()}
    ${journalHtml()}
    ${rhythmHtml(st, { trainsDone: p.done, trainsTotal: p.total })}
    ${canWrite() ? weekStatsHtml({ days, prevWeek: days.slice(7, 14), loading: S.diary.loading || !S.diary.from }) : ''}
    <a class="next-link weeks-link" href="#/weeks"><span class="muted small">По воскресеньям</span><strong>Неделя Батончика — история ›</strong></a>`;
}

// ---------- Тренировки (с играми) ----------

// «В течение дня» из rasporyadok.md: подсказки без отметок
function daySectionsHtml() {
  const t = S.today || {};
  return (t.sections || []).map((g) => `<section class="section">
      ${g.title ? `<h2>${inline(g.title)}</h2>` : ''}
      ${g.intro && g.intro.length ? `<div class="prose">${renderBlocks(g.intro)}</div>` : ''}
      <ul class="list">${g.items.map((it) => `<li class="item plain"><div class="item-body">${scheduleItemHtml(it)}</div></li>`).join('')}</ul>
    </section>`).join('');
}

function renderTrainingsPage() {
  const t = S.today || {};
  const week = mondayOf(S.day);
  return `${pageHead({ eyebrow: weekChosen() ? `Неделя с ${dayTitle(week, { day: 'numeric', month: 'long' })}` : 'Тренировки и игры', title: 'Тренировки', sub: 'План на неделю, подсказки на день и все тренировки и игры.', plus: { action: 'new-card-sheet', label: 'Добавить' } })}
    ${statusBanner()}
    ${t.raw ? `<div class="prose">${safe(() => renderBlocks(parseBlocks(t.raw)), t.raw)}</div>` : trainingsHtml('План на неделю')}
    ${t.error ? '<p class="empty">Не удалось загрузить план. Проверьте интернет.</p>' : ''}
    ${ideasHtml()}
    ${daySectionsHtml()}
    <h2 class="lib-title">Все тренировки и игры</h2>
    ${catalogBody('k')}
    ${catalogBody('g', { showTitle: true })}`;
}

// ---------- Советы и Каналы ----------

function tipsSwitch(on) {
  const a = (key, href, label) => `<a class="seg${on === key ? ' on' : ''}" href="${href}"${on === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="segmented three" aria-label="Разделы советов">${a('lib', '#/lib', 'Библиотека')}${a('t', '#/t', 'Практика')}${a('c', '#/c', 'Каналы')}</nav>`;
}
const TIPS_SUB = 'Почему это работает, что делать и заметки из каналов.';

function renderTipsPage() {
  return `${pageHead({ title: 'Советы', sub: TIPS_SUB, plus: { action: 'new-tip', label: 'Новый совет' } })}
    ${urgentBtn()}
    ${tipsSwitch('t')}
    ${catalogBody('t')}`;
}

function renderNotesPage() {
  const head = `${pageHead({ title: 'Советы', sub: TIPS_SUB })}${urgentBtn()}${tipsSwitch('c')}`;
  if (!S.notes) return `${head}<p class="muted">Загружаем…</p>`;
  if (S.notes.error) return `${head}<div class="banner warn">Не удалось загрузить заметки. Проверьте интернет.</div>`;
  return head + notesListHtml(S.notes, S.notesFilter);
}

// ---------- Неделя Батончика ----------

const WEEK_QS = [
  ['joy', 'Было что-то радостное (игра, поиск, новое место, друг)?'],
  ['choice', 'Было что-то, что он выбирал сам (маршрут, игрушку, с кем общаться)?'],
  ['sleep', 'Хватало тихого сна?'],
];
const FIGURE = [['ribs', 'Рёбра прощупываются легко'], ['waist', 'Сверху видна талия']];
const isSunday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
const lastSunday = (key) => addDays(key, -new Date(`${key}T00:00:00Z`).getUTCDay());
const weekOf = (day) => S.weeks.find((w) => w.id === day);
const weightOn = (day) => { const g = S.growth.find((x) => x.date === day && x.weight); return g ? g.weight : 0; };

function weekSummaryHtml(w, day) {
  const yes = WEEK_QS.filter(([k]) => w[k]).length;
  const fig = FIGURE.map(([k, label]) => (w[k] ? `${label.toLowerCase()}: ${w[k] === 'yes' ? 'да' : 'нет'}` : '')).filter(Boolean).join(' · ');
  const kg = weightOn(day);
  return `<p class="week-line"><strong>${yes} из 3</strong> «да» о благополучии${kg ? ` · вес ${fmtNum(kg)} кг` : ''}</p>
    ${fig ? `<p class="muted small">${escapeHtml(cap(fig))}</p>` : ''}${w.notes ? `<p class="week-notes">${inline(w.notes)}</p>` : ''}`;
}

// Карточка на «Дне» — только по воскресеньям
function weekCardHtml() {
  if (!isSunday(S.day)) return '';
  const w = weekOf(S.day);
  const can = canWrite();
  return `<section class="card week-card-sun">
    <div class="card-head"><h2>Неделя Батончика</h2><a class="text-link" href="#/weeks">История ›</a></div>
    ${w ? weekSummaryHtml(w, S.day) : '<p class="muted">Раз в неделю — три вопроса о благополучии, вес и фигура. Ответы сохранятся с датой.</p>'}
    ${can ? `<button class="btn${w ? '' : ' primary'} wide" data-action="week-edit" data-day="${S.day}">${w ? 'Изменить' : 'Заполнить'}</button>` : ''}
  </section>`;
}

function weekSheet(day) {
  const w = weekOf(day) || {};
  const kg = weightOn(day);
  const yn = (k) => `<div class="choices">${[['yes', 'Да'], ['no', 'Нет']].map(([v, l]) => `<label class="choice"><input type="radio" name="${k}" value="${v}"${w[k] === v ? ' checked' : ''}>${l}</label>`).join('')}</div>`;
  openSheet(`<form class="form"><h2>Неделя Батончика</h2><p class="muted">${escapeHtml(cap(dayTitle(day)))}</p>
    <fieldset><legend>Благополучие</legend>${WEEK_QS.map(([k, q]) => `<label class="check-row"><input type="checkbox" name="${k}"${w[k] ? ' checked' : ''}>${q}</label>`).join('')}</fieldset>
    <label>Вес, кг <span class="muted">(попадёт в «Рост и вес»)</span><input name="weight" inputmode="decimal" autocomplete="off" placeholder="Например: 13,3" value="${kg ? fmtNum(kg) : ''}"></label>
    ${FIGURE.map(([k, label]) => `<fieldset><legend>${label}</legend>${yn(k)}</fieldset>`).join('')}
    <label>Заметки <textarea name="notes" rows="3" maxlength="2000" placeholder="Что получилось на этой неделе, что было трудно, что пробуем дальше">${escapeHtml(w.notes || '')}</textarea></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const rec = { joy: fd.get('joy') === 'on', choice: fd.get('choice') === 'on', sleep: fd.get('sleep') === 'on',
      ribs: String(fd.get('ribs') || ''), waist: String(fd.get('waist') || ''), notes: String(fd.get('notes') || '').trim() };
    store.saveWeek(day, rec);
    const weight = parseNum(fd.get('weight'));
    if (weight && weight <= 150 && weight !== kg) {
      const g = S.growth.find((x) => x.date === day);
      store.saveGrowth(g ? g.id : null, { date: day, weight, height: g ? g.height || 0 : 0 });
    }
    toast('Неделя записана.');
  });
}

function renderWeeks() {
  const back = `<a class="back" href="#/day">${BACK_SVG}День</a>`;
  const list = [...S.weeks].sort((a, b) => (a.id < b.id ? 1 : -1));
  const pts = series(S.growth, 'weight');
  const sun = lastSunday(S.day);
  return `${back}${pageHead({ eyebrow: 'По воскресеньям', title: 'Неделя Батончика', sub: 'Что было радостного, выбирал ли он сам, хватало ли сна — и как меняются вес и фигура.' })}
    ${canWrite() ? `<button class="btn${weekOf(sun) ? '' : ' primary'} wide" data-action="week-edit" data-day="${sun}">${weekOf(sun) ? 'Изменить' : 'Заполнить'} за ${dayTitle(sun, { day: 'numeric', month: 'long' })}</button>` : ''}
    ${pts.length ? `<section class="growth-card weeks-weight"><p class="eyebrow">Вес</p>
      <div class="growth-now"><strong>${fmtNum(pts[pts.length - 1].value)}<small>кг</small></strong><span>${escapeHtml(deltaText(pts, 'кг'))}</span></div>
      <figure class="growth-chart">${lineChartSvg(pts, { unit: 'кг' })}</figure></section>` : ''}
    ${list.length ? `<section class="card"><div class="card-head"><h2>Все недели</h2></div><ul class="weeks-list">${list.map((w) => `<li>
      <p class="week-date">${escapeHtml(cap(dayTitle(w.id, { day: 'numeric', month: 'long', year: 'numeric' })))}</p>
      <p class="week-qs">${WEEK_QS.map(([k]) => `<span class="${w[k] ? 'yes' : 'no'}">${w[k] ? '✓' : '—'}</span>`).join('')}</p>
      ${weekSummaryHtml(w, w.id)}
      ${canWrite() ? `<button class="text-link" data-action="week-edit" data-day="${w.id}">Изменить</button>` : ''}</li>`).join('')}</ul></section>`
      : '<p class="empty">Записей пока нет. Первая карточка появится в воскресенье на вкладке «День».</p>'}`;
}

// ---------- Библиотека ----------

const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

// Подпись под рубрикой: сколько прочитано, текущий этап, лучший результат
function rubricNote(key) {
  const lib = S.lib;
  const r = RUBRICS.find((x) => x.key === key);
  if (r.read) { const c = readCount(lib, key, S.reads.items); return c.done ? `прочитано ${c.done} из ${c.total}` : `${c.total} ${key === 'a' ? plural(c.total, 'статья', 'статьи', 'статей') : key === 'qa' ? plural(c.total, 'вопрос', 'вопроса', 'вопросов') : plural(c.total, 'миф', 'мифа', 'мифов')}`; }
  if (key === 'ages') { const m = ageMonths(S.pet && S.pet.birth, S.day); const now = m != null && lib.ages.find((s) => s.range && m >= s.range.from && m < s.range.to); return now ? `сейчас: ${now.label}` : r.sub; }
  if (key === 'dict') return `${lib.dict.length} ${plural(lib.dict.length, 'термин', 'термина', 'терминов')}`;
  if (key === 'quiz') return `${lib.quizzes.length} ${plural(lib.quizzes.length, 'тест', 'теста', 'тестов')}, пройдено ${lib.quizzes.filter((t) => S.reads.quiz[t.id] != null).length}`;
  return r.sub;
}

// Красная кнопка в шапке «Советов»: «Срочно к ветеринару» в одно касание
const urgentBtn = () => `<a class="urgent-btn" href="#/lib/vet"><span aria-hidden="true">🚑</span><span><strong>Срочно к ветеринару</strong><small>когда нельзя ждать и куда звонить</small></span><span aria-hidden="true">›</span></a>`;

function renderLibrary(r) {
  const head = `${pageHead({ title: 'Советы', sub: TIPS_SUB })}${urgentBtn()}${tipsSwitch('lib')}`;
  if (!S.lib) return `${head}<p class="muted">Загружаем…</p>`;
  if (S.lib.error) return `${head}<div class="banner warn">Не удалось загрузить Библиотеку. Проверьте интернет.</div>`;
  const rubric = RUBRICS.find((x) => x.key === r.id);
  if (!rubric) {
    const tiles = RUBRICS.filter((x) => !x.urgent).map((x) => `<a class="lib-tile" href="#/lib/${x.key}"><span class="lib-icon" aria-hidden="true">${x.icon}</span>
      <strong>${x.title}</strong><span>${escapeHtml(rubricNote(x.key))}</span></a>`).join('');
    return `${head}<div class="prose lib-intro">${introHtml(S.lib)}</div><div class="lib-grid">${tiles}</div>`;
  }
  if (rubric.key === 'a' && r.sub) return renderArticle(r.sub);
  if (rubric.key === 'vet') return renderVet();
  const can = canWrite();
  const back = rubric.key === 'quiz' && r.sub ? `<a class="back" href="#/lib/quiz">${BACK_SVG}Проверь себя</a>` : `<a class="back" href="#/lib">${BACK_SVG}Библиотека</a>`;
  const top = `${back}<div class="page-head"><div class="page-head-text"><p class="eyebrow">Библиотека</p><h1>${rubric.title}</h1>
    <p class="page-sub">${escapeHtml(rubricNote(rubric.key))}${rubric.read && can ? ' · кружок справа — «прочитано»' : ''}</p></div></div>`;
  let body = '';
  if (rubric.key === 'a') {
    body = `<ul class="lib-list">${S.lib.a.map((c) => {
      const on = !!S.reads.items[readKey('a', c.id)];
      return `<li class="lib-row${on ? ' read' : ''}"><a class="lib-link" href="#/lib/a/${c.id}"><strong>${inline(c.title)}</strong>
        <span class="lib-chips">${metaChips(c)}</span></a>${readBtn('a', c.id, on, can)}</li>`;
    }).join('')}</ul>`;
  } else if (rubric.key === 'qa' || rubric.key === 'myths') body = foldList(S.lib, rubric.key, S.reads.items, can, r.sub);
  else if (rubric.key === 'ages') {
    const m = ageMonths(S.pet && S.pet.birth, S.day);
    body = `${m != null ? `<p class="muted">${escapeHtml(DOG())} сейчас ${ageText(S.pet.birth, S.day)}. Текущий этап открыт и отмечен.</p>` : ''}${agesHtml(S.lib, m)}`;
  } else if (rubric.key === 'body') body = S.lib.body.map((c) => `<div class="prose lib-sheet">${articleBody(c)}</div>`).join('');
  else if (rubric.key === 'dict') body = dictHtml(S.lib);
  else if (rubric.key === 'quiz') {
    const test = r.sub && S.lib.quizzes.find((t) => t.id === r.sub);
    if (!test) {
      body = `<ul class="lib-list">${S.lib.quizzes.map((t) => {
        const best = S.reads.quiz[t.id];
        return `<li class="lib-row"><a class="lib-link" href="#/lib/quiz/${t.id}"><strong>${inline(t.title)}</strong>
          <span class="muted small">${t.qs.length} ${plural(t.qs.length, 'вопрос', 'вопроса', 'вопросов')}${best != null ? ` · лучший результат ${best} из ${t.qs.length}` : ''}</span></a>
          <span class="chev-sm" aria-hidden="true">›</span></li>`;
      }).join('')}</ul>`;
    } else {
      if (S.quiz.test !== test.id) S.quiz = { test: test.id, i: 0, picked: null, score: 0, done: false, order: quizOrder(test) };
      body = quizHtml(test, S.quiz, S.reads.quiz[test.id]);
    }
  }
  else if (rubric.key === 'books') body = booksHtml(S.lib);
  return top + body;
}

// Телефон для ссылки «Позвонить»: только цифры и плюс
const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

function vetContactsHtml() {
  const v = S.vet || {};
  const has = v.clinicName || v.clinicPhone || v.vetName || v.vetPhone;
  const can = canWrite();
  if (!has) {
    return `<section class="vet-contacts empty-contacts"><p><strong>Впишите телефоны заранее</strong> — в панике искать некогда. Круглосуточная клиника и ваш ветеринар будут здесь, с кнопкой «Позвонить».</p>
      ${can ? '<button class="btn primary wide" data-action="vet-edit">Добавить телефоны</button>' : ''}</section>`;
  }
  const block = (label, name, extra, phone) => `<div class="vet-contact"><p class="eyebrow">${label}</p>
    ${name ? `<strong>${escapeHtml(name)}</strong>` : ''}${extra ? `<span class="muted">${escapeHtml(extra)}</span>` : ''}
    ${phone ? `<span class="vet-phone">${escapeHtml(phone)}</span><a class="btn primary call-btn" href="${escapeHtml(telHref(phone))}">📞 Позвонить</a>` : '<span class="muted">Телефон не указан</span>'}</div>`;
  return `<section class="vet-contacts">
    ${block('Круглосуточная клиника', v.clinicName, v.clinicAddress, v.clinicPhone)}
    ${block('Наш ветеринар', v.vetName, '', v.vetPhone)}
    ${can ? '<button class="text-link vet-edit" data-action="vet-edit">Изменить</button>' : ''}</section>`;
}

function renderVet() {
  const c = S.lib.vet[0];
  const back = `<a class="back" href="#/lib">${BACK_SVG}Библиотека</a>`;
  if (!c) return `${back}<p class="empty">Раздел не найден.</p>`;
  return `${back}<p class="eyebrow urgent-eyebrow">Библиотека · срочно</p>
    <h1 class="card-title">${inline(c.title)}</h1>
    ${vetContactsHtml()}
    <div class="prose article vet-article">${articleBody(c)}</div>`;
}

function vetSheet() {
  const v = S.vet || {};
  const f = (name, label, max, extra = '') => `<label>${label}<input name="${name}" maxlength="${max}" value="${escapeHtml(v[name] || '')}"${extra}></label>`;
  openSheet(`<form class="form"><h2>🚑 Куда звонить</h2>
    <h3>Круглосуточная клиника</h3>
    ${f('clinicName', 'Название', 80)}${f('clinicAddress', 'Адрес', 160)}${f('clinicPhone', 'Телефон', 30, ' type="tel" inputmode="tel" placeholder="+7 …"')}
    <h3>Наш ветеринар</h3>
    ${f('vetName', 'Имя', 80)}${f('vetPhone', 'Телефон', 30, ' type="tel" inputmode="tel" placeholder="+7 …"')}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const g = (k) => String(fd.get(k) || '').trim();
    store.saveVet({ clinicName: g('clinicName'), clinicAddress: g('clinicAddress'), clinicPhone: g('clinicPhone'), vetName: g('vetName'), vetPhone: g('vetPhone') });
    toast('Телефоны сохранены.');
  });
}

function renderArticle(id) {
  const list = S.lib.a;
  const i = list.findIndex((c) => c.id === id);
  const back = `<a class="back" href="#/lib/a">${BACK_SVG}Статьи</a>`;
  if (i < 0) return `${back}<p class="empty">Статья не найдена.</p>`;
  const c = list[i];
  const on = !!S.reads.items[readKey('a', c.id)];
  const next = list[i + 1];
  return `${back}
    <p class="eyebrow">Статья ${i + 1} из ${list.length}</p>
    <h1 class="card-title">${inline(c.title)}</h1>
    <div class="lib-chips big">${metaChips(c)}</div>
    <div class="prose article">${articleBody(c)}</div>
    <button class="btn wide read-toggle${on ? ' on' : ''}" data-action="lib-read" data-id="${readKey('a', c.id)}"${canWrite() ? '' : ' disabled'}>${on ? '✓ Прочитано' : 'Отметить прочитанной'}</button>
    ${next ? `<a class="next-link" href="#/lib/a/${next.id}"><span class="muted small">Следующая статья</span><strong>${inline(next.title)}</strong></a>` : ''}`;
}

// «Факт дня» на главной: каждый день следующий по кругу, по нажатию — ещё один
function factHtml() {
  const facts = S.lib && S.lib.facts;
  if (!facts || !facts.length) return '';
  const dayNum = Math.floor(Date.parse(`${S.day}T00:00:00Z`) / 86400000);
  const fact = facts[(((dayNum + S.factShift) % facts.length) + facts.length) % facts.length];
  return `<button type="button" class="fact-day" data-action="fact-next" aria-label="Факт дня. Нажмите, чтобы показать следующий">
    <span class="fact-head"><span aria-hidden="true">✨</span> Факт дня <span class="fact-more">ещё ›</span></span>
    <span class="fact-text">${inline(fact)}</span></button>`;
}

// Поиск по словарю — без перерисовки страницы
function filterDict(input) {
  const words = input.value.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  let shown = 0;
  let letter = null;
  let letterHas = false;
  const flush = () => { if (letter) letter.hidden = !letterHas; };
  view.querySelectorAll('.dict > li').forEach((li) => {
    if (li.hasAttribute('data-letter')) { flush(); letter = li; letterHas = false; return; }
    const ok = words.every((w) => li.dataset.search.includes(w));
    li.hidden = !ok;
    if (ok) { shown++; letterHas = true; }
  });
  flush();
  const empty = view.querySelector('.dict-empty');
  if (empty) empty.hidden = shown > 0;
}

// ---------- Каналы ----------

function renderNote(id) {
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const from = prevHash && pageTitle(prevHash);
  const back = from ? `<a class="back" href="${prevHash}" data-action="back">${arrow}${escapeHtml(from)}</a>`
    : `<a class="back" href="#/c">${arrow}Каналы</a>`;
  if (!S.notes) return `${back}<p class="muted">Загружаем…</p>`;
  const n = S.notes.byId && S.notes.byId.get(id);
  return n ? noteHtml(n, back) : `${back}<h1>Не найдено</h1><p class="muted">Возможно, заметку переименовали.</p>`;
}

// Поиск и фильтры прячут лишние заметки прямо на странице, без перерисовки: поле поиска не теряет курсор
function applyNotesFilter() {
  if (!S.notes || !S.notes.byId) return;
  let shown = 0;
  view.querySelectorAll('[data-note]').forEach((li) => {
    const ok = noteMatches(S.notes.byId.get(li.dataset.note), S.notesFilter);
    li.hidden = !ok;
    if (ok) shown++;
  });
  view.querySelectorAll('[data-topic]').forEach((el) => { el.hidden = !el.querySelector('[data-note]:not([hidden])'); });
  view.querySelectorAll('[data-section]').forEach((el) => { el.hidden = !el.querySelector('[data-note]:not([hidden])'); });
  const count = view.querySelector('.notes-count');
  if (count) count.textContent = countText(shown, S.notes.all.length);
  const empty = view.querySelector('.notes-empty');
  if (empty) empty.hidden = shown > 0;
}

view.addEventListener('input', (e) => { if (e.target.matches('.dict-search')) filterDict(e.target); });
view.addEventListener('input', (e) => {
  if (!e.target.matches('.notes-search')) return;
  S.notesFilter.q = e.target.value;
  applyNotesFilter();
});

// ---------- Каталоги ----------

function catalogBody(tab, { showTitle = false } = {}) {
  const cat = S.catalogs[tab];
  if (!cat) return '<p class="muted">Загружаем…</p>';
  const errors = cat.errors.map((e) => `<div class="banner warn">${escapeHtml(e)}</div>`).join('');
  // Один раздел в файле (советы) — без своего заголовка; игры на странице «Тренировки» — с заголовком
  const single = cat.groups.length === 1 && !!cat.groups[0].title && !showTitle;
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
      ? (plainText(g.intro).length > 220 || showTitle
        ? `<details class="intro"><summary>Вступление к разделу</summary><div class="prose">${blocksHtml(g.intro, tab, null)}</div></details>`
        : `<div class="prose">${blocksHtml(g.intro, tab, null)}</div>`)
      : '';
    return `<section class="group">
      ${g.title && !single ? `<h2>${inline(g.title)}</h2>` : ''}
      ${intro}
      ${cards ? `<ul class="cards">${cards}</ul>` : (g.intro.length ? '' : '<p class="empty">Здесь пока пусто.</p>')}
    </section>`;
  }).join('');
  return `${errors}${loose}${groups}`;
}

function renderCard(tab, id) {
  const card = findCard(tab, id);
  // «Назад» ведёт туда, откуда пришли (например, на «Сегодня» к тому же месту), иначе — в каталог
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const from = prevHash && pageTitle(prevHash);
  const back = from
    ? `<a class="back" href="${prevHash}" data-action="back">${arrow}${escapeHtml(from)}</a>`
    : `<a class="back" href="#/${TAB_OF[tab] || tab}">${arrow}${PAGE_TITLES[tab]}</a>`;
  if (!card) {
    return `${back}<h1>Не найдено</h1><p class="muted">${S.catalogs[tab] ? 'Возможно, карточку переименовали в памятке.' : 'Загружаем…'}</p>`;
  }
  const body = safe(() => {
    const lead = card.lead.length ? `<section class="blk blk-lead"><div class="prose">${blocksHtml(card.lead, tab, card)}</div></section>` : '';
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

// Дни дневника: сегодняшние записи — живые, остальное — из загруженной истории
function diaryDays() {
  const today = S.day;
  const events = [...S.diary.events.filter((e) => e.day !== today), ...S.events];
  const days = [];
  for (let k = today; S.diary.from && k >= S.diary.from; k = addDays(k, -1)) {
    days.push(dayStats(k, events, k === today ? S.checks : S.diary.days[k], 0));
  }
  return days;
}

// ---------- Дневник: календарь ----------

const isSpecial = (s) => !!s && (s.special != null ? s.special : !!s.title); // старые заметки с заголовком — памятные
const hasStory = (s) => !!s && !!(s.title || s.text || s.hasPhoto);
const monthOf = (day) => day.slice(0, 7);
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// Журнал месяца — один запрос на месяц; текущий месяц обновляем, если данные старше 5 минут
async function loadMonth(ym) {
  const m = S.months[ym];
  if (!canWrite() || (m && (m.loading || (m.loadedAt && (ym !== monthOf(S.day) || Date.now() - m.loadedAt < 300000))))) return;
  S.months[ym] = { events: m ? m.events : [], loading: true, loadedAt: m ? m.loadedAt : 0 };
  const from = `${ym}-01`;
  const last = `${ym}-${String(daysIn(ym)).padStart(2, '0')}`;
  const to = last < S.day ? last : S.day;
  try {
    const data = from <= to ? await store.loadHistory(from, to) : { events: [] };
    S.months[ym] = { events: withNewRefs(data.events), loading: false, loadedAt: Date.now() };
  } catch (err) {
    console.error(err);
    S.months[ym] = { events: [], loading: false, loadedAt: 0 };
    toast('Не удалось загрузить журнал за месяц. Проверьте интернет.');
  }
  render();
}
// Записи дня: сегодня — живые, остальное — из загруженного месяца
function eventsOfDay(day) {
  if (day === S.day) return S.events;
  const m = S.months[monthOf(day)];
  return m ? m.events.filter((e) => e.day === day) : [];
}

// Фото заметки — только когда их показываем. Ключ меняется, когда фото меняют (в том числе на другом телефоне)
const MAX_STORY_PHOTOS = 6;
const photoKeyOf = (s) => `${(s && s.photoCount) || 0}:${(s && s.photoKey) || ''}`;
function storyPhotosOf(day) {
  const s = S.stories[day];
  if (!s || !s.photoCount) return [];
  if (s.photo) return [s.photo]; // старые заметки: фото внутри
  const key = photoKeyOf(s);
  const c = S.storyPhotos[day];
  if (c && c.key === key && c.list) return c.list;
  // Не загрузились (нет интернета) — пробуем снова не чаще раза в 30 секунд
  if (!c || c.key !== key || (c.failedAt && Date.now() - c.failedAt > 30000)) {
    S.storyPhotos[day] = { key, list: c ? c.list : null, loading: true };
    store.loadStoryPhotos(day, s.photoCount)
      .then((list) => { if (S.storyPhotos[day] && S.storyPhotos[day].key === key) { S.storyPhotos[day] = { key, list }; render(); } })
      .catch(() => { if (S.storyPhotos[day] && S.storyPhotos[day].key === key) S.storyPhotos[day] = { key, list: null, failedAt: Date.now() }; });
  }
  return (c && c.list) || [];
}
// Для формы: дождаться фото заметки. null — не загрузились (например, нет интернета)
async function loadStoryPhotosNow(day) {
  const s = S.stories[day];
  if (!s || !s.photoCount) return [];
  if (s.photo) return [s.photo];
  const key = photoKeyOf(s);
  const c = S.storyPhotos[day];
  if (c && c.key === key && c.list) return c.list.slice();
  toast('Загружаем фото…');
  try {
    const list = await store.loadStoryPhotos(day, s.photoCount);
    S.storyPhotos[day] = { key, list };
    hideToast();
    return list.slice();
  } catch { return null; }
}

// Фото в заметке: одно — во всю ширину, несколько — лента, которую листают пальцем. Нажатие — на весь экран
function photosHtml(day) {
  const s = S.stories[day];
  const count = (s && s.photoCount) || 0;
  if (!count) return '';
  const list = storyPhotosOf(day);
  if (!list.length) return '<div class="story-photo ph"></div>';
  const item = (p, i) => `<button type="button" class="photo-open" data-action="photo-view" data-day="${day}" data-i="${i}" aria-label="Открыть фото ${i + 1} из ${list.length}">
    <img src="${escapeHtml(p)}" alt="">${list.length > 1 ? `<span class="photo-n">${i + 1}/${list.length}</span>` : ''}</button>`;
  return list.length === 1 ? `<div class="photo-one">${item(list[0], 0)}</div>` : `<div class="photo-strip">${list.map(item).join('')}</div>`;
}

// Просмотр фото на весь экран: листать пальцем, закрыть крестиком или нажатием на тёмный фон
function openViewer(list, start = 0) {
  closeViewer();
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-label', 'Фото');
  v.innerHTML = `<div class="viewer-track">${list.map((p) => `<figure><img src="${escapeHtml(p)}" alt=""></figure>`).join('')}</div>
    <button type="button" class="viewer-x" data-action="viewer-close" aria-label="Закрыть">×</button>
    ${list.length > 1 ? `<span class="viewer-n">${start + 1} / ${list.length}</span>` : ''}`;
  document.body.appendChild(v);
  const track = v.querySelector('.viewer-track');
  track.scrollLeft = start * track.clientWidth;
  const n = v.querySelector('.viewer-n');
  if (n) track.addEventListener('scroll', () => { n.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1} / ${list.length}`; }, { passive: true });
  v.addEventListener('click', (e) => { if (e.target.tagName !== 'IMG' && !e.target.closest('.viewer-x')) closeViewer(); });
}
function closeViewer() { const v = document.querySelector('.viewer'); if (v) v.remove(); }

function calendarHtml(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (first + 6) % 7; // понедельник — первый
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell blank"></span>');
  const monthReady = S.months[ym] && S.months[ym].loadedAt;
  for (let d = 1; d <= daysIn(ym); d++) {
    const day = `${ym}-${String(d).padStart(2, '0')}`;
    const past = day <= S.day;
    const st = past && (day === S.day || monthReady) ? dayStats(day, eventsOfDay(day), null, 0) : null;
    const story = S.stories[day];
    const health = S.health.some((r) => r.date === day);
    const marks = [
      st && (st.accident ? 'bad' : st.toilet ? 'ok' : ''),
      st && st.trains ? 'train' : '',
      health ? 'health' : '',
      hasStory(story) ? 'story' : '',
    ].filter(Boolean).map((k) => `<i class="mk mk-${k}"></i>`).join('');
    const cls = ['cal-cell', day === S.day && 'today', isSpecial(story) && hasStory(story) && 'special', day === S.cal.sel && 'sel', !past && 'future'].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-action="cal-pick" data-day="${day}" aria-label="${escapeHtml(dayTitle(day))}"${day === S.cal.sel ? ' aria-current="date"' : ''}>
      <span class="cal-num">${d}</span><span class="cal-marks">${marks}</span></button>`);
  }
  const canNext = ym < addMonths(monthOf(S.day), 3);
  return `<section class="cal">
    <div class="cal-head">
      <button type="button" class="cal-nav" data-action="cal-month" data-dir="-1" aria-label="Предыдущий месяц">‹</button>
      <h2>${MONTHS[m - 1]} ${y}</h2>
      <button type="button" class="cal-nav" data-action="cal-month" data-dir="1" aria-label="Следующий месяц"${canNext ? '' : ' disabled'}>›</button>
    </div>
    <div class="cal-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => `<span class="cal-dow">${w}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-legend">
      <span><i class="mk mk-ok"></i>туалет на улице</span><span><i class="mk mk-bad"></i>были аварии</span>
      <span><i class="mk mk-train"></i>тренировки</span><span><i class="mk mk-health"></i>здоровье</span>
      <span><i class="mk mk-story"></i>заметка</span><span><i class="ring-key"></i>день, который хочется помнить</span>
    </div>
  </section>`;
}

// Карточка выбранного дня под календарём
function selectedDayHtml(day) {
  const future = day > S.day;
  const can = canWrite();
  const st = !future && (day === S.day || (S.months[monthOf(day)] || {}).loadedAt) ? dayStats(day, eventsOfDay(day), null, 0) : null;
  const loading = !future && !st;
  const story = S.stories[day];
  const health = S.health.filter((r) => r.date === day);
  const line = st ? daySummaryLine(st) : '';
  const storyHtml = hasStory(story) ? `<div class="day-story${isSpecial(story) ? ' special' : ''}">
      ${isSpecial(story) ? '<p class="eyebrow">День, который хочется помнить</p>' : ''}
      ${story.title ? `<h3>${escapeHtml(story.title)}</h3>` : ''}
      ${photosHtml(day)}
      ${story.text ? `<p>${inline(story.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${can ? `<button class="btn small" data-action="story-edit" data-day="${day}">Изменить заметку</button>` : ''}</div>`
    : (!future && can ? `<button class="btn wide" data-action="story-edit" data-day="${day}">Написать о дне</button>` : '');
  return `<section class="card day-sel" id="day-sel">
    <div class="card-head"><h2>${escapeHtml(cap(dayTitle(day)))}</h2>${day === S.day ? '<span class="chip">сегодня</span>' : ''}</div>
    ${future ? '<p class="muted">Этот день ещё впереди.</p>' : ''}
    ${loading ? '<p class="muted">Загружаем…</p>' : ''}
    ${line ? `<p class="day-line">${line}</p>` : ''}
    ${st && !st.list.length && !st.trains && !hasStory(story) && !health.length ? '<p class="muted">В журнале за этот день записей нет.</p>' : ''}
    ${st ? trainsLine(st, cardName) : ''}
    ${health.length ? `<ul class="health-list">${health.map((r) => healthRowHtml(r, S.day)).join('')}</ul>` : ''}
    ${storyHtml}
    ${st && st.notes.length ? `<ul class="ev-list notes">${st.notes.map((e) => eventRow(e)).join('')}</ul>` : ''}
    ${st && st.list.length ? `<details class="intro"><summary>Все записи (${st.list.length})</summary><ul class="ev-list">${st.list.map((e) => eventRow(e)).join('')}</ul></details>` : ''}
  </section>`;
}

// Большая карточка вверху: заметка о сегодняшнем дне, а если её нет — воспоминание
function memoryPool() {
  const past = Object.keys(S.stories).filter((d) => d < S.day && (S.stories[d].title || S.stories[d].text)).sort();
  const special = past.filter((d) => isSpecial(S.stories[d]));
  return special.length ? special : past;
}
function featureHtml() {
  const can = canWrite();
  const today = S.stories[S.day];
  let day = hasStory(today) ? S.day : '';
  const pool = day ? [] : memoryPool();
  if (!day && pool.length) {
    const seed = Math.floor(Date.parse(`${S.day}T00:00:00Z`) / 86400000) + S.cal.memShift;
    day = pool[((seed % pool.length) + pool.length) % pool.length];
  }
  if (!day) {
    return `<article class="story-feature empty"><div class="story-body">
      <p class="eyebrow">День, который хочется помнить</p>
      <h2>Здесь будет запись сегодняшнего дня или воспоминание</h2>
      <div class="story-text">Выберите день в календаре и напишите о нём — например, о дне, когда ${escapeHtml(DOG())} приехал в город.</div>
      ${can ? `<button class="btn small ghost" data-action="story-edit" data-day="${S.day}">Написать о сегодня</button>` : ''}</div></article>`;
  }
  const s = S.stories[day];
  const [, mm, dd] = day.split('-').map(Number);
  const eyebrow = day === S.day ? (isSpecial(s) ? 'Сегодня · день, который хочется помнить' : 'Сегодня')
    : (isSpecial(s) ? 'День, который хочется помнить' : 'Воспоминание');
  return `<article class="story-feature">
    <div class="story-date"><strong>${dd}</strong><span>${MONTHS_SHORT[mm - 1]}</span></div>
    <div class="story-body">
      <p class="eyebrow">${eyebrow}</p>
      ${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ''}
      ${photosHtml(day)}
      ${s.text ? `<div class="story-text">${inline(s.text).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="story-actions">
        ${day === S.day ? (can ? `<button class="btn small ghost" data-action="story-edit" data-day="${day}">Изменить</button>` : '')
          : `<button class="btn small ghost" data-action="cal-pick" data-day="${day}" data-scroll="1">Открыть день</button>${pool.length > 1 ? '<button class="btn small ghost" data-action="memory-next">Другое воспоминание</button>' : ''}`}
      </div>
    </div></article>`;
}

// Дневник: большая карточка и календарь; день открывается под календарём только по нажатию на число
function renderDiary() {
  if (!S.cal.month) S.cal.month = monthOf(S.day);
  const sel = S.cal.sel;
  const head = pageHead({ eyebrow: DOG(), title: 'Дневник', sub: 'Календарь дней и ваши заметки. Нажмите на число, чтобы открыть день.',
    plus: !sel || sel <= S.day ? { action: 'story-edit', label: sel ? 'Написать о выбранном дне' : 'Написать о сегодняшнем дне' } : null });
  if (!canWrite()) return `${head}${statusBanner()}<p class="muted">Дневник появится после входа.</p>`;
  setTimeout(() => loadMonth(S.cal.month), 0);
  if (sel && monthOf(sel) !== S.cal.month) setTimeout(() => loadMonth(monthOf(sel)), 0);
  return `${head}${featureHtml()}${calendarHtml(S.cal.month)}${sel ? selectedDayHtml(sel) : ''}`;
}

// Заметка о дне: заголовок, текст, фото (до шести) и «день, который хочется помнить»
const storyForm = { day: '', photos: [], changed: false, locked: false, busy: 0, token: 0 };
async function storySheet(day) {
  const s = S.stories[day] || { title: '', text: '', special: null, hasPhoto: false, photoCount: 0 };
  const token = ++storyForm.token;
  const loaded = await loadStoryPhotosNow(day);
  if (token !== storyForm.token) return;
  Object.assign(storyForm, { day, photos: loaded || [], changed: false, locked: loaded === null, busy: 0 });
  const special = s.special != null ? s.special : !!s.title;
  openSheet(`<form class="form story-form"><h2>${escapeHtml(cap(dayTitle(day)))}</h2>
    <label>Заголовок <span class="muted">(необязательно)</span><input name="title" maxlength="120" value="${escapeHtml(s.title)}" placeholder="Например: первый раз сам вышел из лифта"></label>
    <label>Как прошёл день<textarea name="text" rows="6" maxlength="5000" placeholder="Что было хорошего, что получилось, что запомнилось">${escapeHtml(s.text)}</textarea></label>
    <div class="story-photo-field">${storyPhotoFieldHtml()}</div>
    <label class="check-row special-check"><input type="checkbox" name="special"${special ? ' checked' : ''}>День, который хочется помнить <span class="muted">— обведём в календаре</span></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
    ${hasStory(S.stories[day]) ? `<button type="button" class="btn danger-outline wide" data-action="story-delete" data-day="${day}">Удалить заметку</button>` : ''}
  </form>`, (fd) => {
    // Фото ещё сжимаются — не закрываем, иначе они пропадут
    if (storyForm.busy) { toast('Подождите пару секунд: фото ещё готовятся.'); return false; }
    const { photos, changed, locked } = storyForm;
    const story = { title: String(fd.get('title') || '').trim(), text: String(fd.get('text') || '').trim(), special: fd.get('special') === 'on',
      photos, photoKey: changed ? Date.now().toString(36) : s.photoKey || '' };
    const oldCount = s.photoCount || 0;
    if (!story.title && !story.text && !photos.length && !locked) {
      delete S.stories[day];
      delete S.storyPhotos[day];
      store.saveStory(day, null, { oldCount });
    } else {
      const count = changed ? photos.length : oldCount;
      S.stories[day] = { title: story.title, text: story.text, special: story.special, hasPhoto: count > 0, photoCount: count,
        photoKey: story.photoKey, photo: changed ? '' : s.photo || '' };
      if (changed) S.storyPhotos[day] = { key: photoKeyOf(S.stories[day]), list: photos.slice() };
      store.saveStory(day, story, { photosChanged: changed, oldCount });
    }
    render();
    toast('Заметка сохранена.');
  });
}

function storyPhotoFieldHtml() {
  const { photos, locked, busy } = storyForm;
  const n = photos.length;
  if (locked) return '<p class="muted small">Фото к этой заметке сейчас не загрузились — их можно будет изменить, когда появится интернет. Текст можно править.</p>';
  const thumbs = photos.map((p, i) => `<div class="thumb"><img src="${escapeHtml(p)}" alt="">
    <button type="button" class="thumb-x" data-action="story-photo-remove" data-i="${i}" aria-label="Убрать фото ${i + 1}">×</button></div>`).join('')
    + Array.from({ length: busy }, () => '<div class="thumb busy"><span>Готовим…</span></div>').join('');
  return `${n || busy ? `<div class="thumbs">${thumbs}</div>` : ''}
    <div class="edit-actions">${n + busy < MAX_STORY_PHOTOS ? `<button type="button" class="btn small" data-action="story-photo">${n ? 'Добавить ещё фото' : 'Добавить фото'}</button>` : ''}
    <span class="muted small">${n ? `${n} из ${MAX_STORY_PHOTOS}` : `можно до ${MAX_STORY_PHOTOS} фото`}</span></div>`;
}
function refreshStoryPhotos() {
  const box = sheet.querySelector('.story-photo-field');
  if (box) box.innerHTML = storyPhotoFieldHtml();
}

// ---------- Паспорт ----------

const SEX = ['Кобель', 'Сука'];
const MDR1 = ['Не проверяли', 'N/N — норма', 'N/m — носитель', 'm/m — мутация'];
const HEALTH_SUGGEST = ['Комплексная прививка', 'Прививка от бешенства', 'Обработка от клещей и блох', 'Глистогонное', 'Осмотр у ветеринара', 'Взвешивание'];

function petTitle() {
  return DOG() === 'Батончик' ? 'Паспорт Батончика' : `Паспорт · ${escapeHtml(DOG())}`;
}

// Последнее измерение величины; для веса, пока измерений нет, — число из старого поля паспорта
function latestGrowth(field) {
  const pts = series(S.growth, field);
  if (pts.length) return pts[pts.length - 1].value;
  return field === 'weight' && S.pet ? parseNum(S.pet.weight) : 0;
}

// Плитки внизу паспорта: вес, возраст, рост; вес и рост открывают «Рост и вес»
function idStatsHtml(pet) {
  const age = ageShort(pet.birth, S.day);
  const weight = latestGrowth('weight');
  const height = latestGrowth('height');
  const tile = (value, unit, label, href) => {
    const inner = value ? `<strong>${value}<small>${unit}</small></strong><span>${label}</span>`
      : `<strong class="id-stat-add">+</strong><span>${label}</span>`;
    return href ? `<a class="id-stat" href="${href}">${inner}</a>` : `<div class="id-stat">${inner}</div>`;
  };
  return `<div class="id-stats">
    ${tile(weight ? fmtNum(weight) : '', 'кг', 'вес', '#/growth')}
    ${tile(age ? age.n : '', age ? age.unit : '', 'возраст', '')}
    ${tile(height ? fmtNum(height) : '', 'см', 'рост', '#/growth')}
  </div>`;
}

function renderPassport() {
  const pet = S.pet || {};
  const field = (label, value, wide) => `<div${wide ? ' class="wide"' : ''}><dt>${label}</dt><dd>${value ? escapeHtml(value) : '—'}</dd></div>`;
  const next = upcoming(S.health);
  const done = doneRecords(S.health);
  const birth = pet.birth ? dayTitle(pet.birth, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return `${pageHead({ eyebrow: pet.chip ? `Чип ${pet.chip}` : 'Паспорт', title: petTitle(), sub: 'Данные, прививки, обработки и напоминания — в одном месте.', plus: { action: 'health-add', label: 'Новая запись о здоровье' } })}
    ${statusBanner()}
    <section class="id-card">
      <div class="id-top"><span>Паспорт собаки</span>${canWrite() ? '<button class="id-edit" data-action="pet-edit">Изменить</button>' : ''}</div>
      <div class="id-body">
        <button class="id-photo" data-action="photo-pick"${canWrite() ? '' : ' disabled'} aria-label="${S.photo ? 'Сменить фото' : 'Добавить фото'}">
          ${S.photo ? `<img src="${escapeHtml(S.photo)}" alt="${escapeHtml(DOG())}">` : `${PAW_SVG}<span>Добавить фото</span>`}</button>
        <p class="id-label">Кличка</p>
        <h2>${escapeHtml(DOG())}</h2>
        <dl class="id-grid">${field('Порода', pet.breed, true)}${field('Дата рождения', birth)}${field('Пол', pet.sex)}${field('Чип', pet.chip)}${field('MDR1', pet.mdr1)}</dl>
        ${idStatsHtml(pet)}
      </div>
      ${!S.pet && canWrite() ? '<button class="btn wide id-fill" data-action="pet-edit">Заполнить паспорт</button>' : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>Напоминания</h2></div>
      ${next.length ? `<ul class="health-list">${next.map((r) => healthRowHtml(r, S.day)).join('')}</ul>`
        : '<p class="muted">Запланированных событий нет. Нажмите «+», чтобы добавить прививку, обработку от клещей, глистогонное или визит к врачу.</p>'}
    </section>
    <section class="card">
      <div class="card-head"><h2>История</h2></div>
      ${done.length ? `<ul class="health-list">${done.map((r) => healthRowHtml(r, S.day)).join('')}</ul>`
        : '<p class="muted">Здесь появится всё, что уже сделано: прививки, обработки, таблетки, визиты к врачу.</p>'}
    </section>`;
}

function petSheet() {
  const pet = S.pet || { name: 'Батончик', breed: 'Австралийская овчарка (аусси)', birth: '2026-05-29', sex: 'Кобель', chip: '', mdr1: '', weight: '' };
  const opts = (list, value) => ['', ...list].map((v) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${v ? escapeHtml(v) : '—'}</option>`).join('');
  openSheet(`<form class="form"><h2>Паспорт</h2>
    <label>Кличка<input name="name" maxlength="40" value="${escapeHtml(pet.name || '')}"></label>
    <label>Порода<input name="breed" maxlength="60" value="${escapeHtml(pet.breed || '')}"></label>
    <label>Дата рождения<input type="date" name="birth" value="${escapeHtml(pet.birth || '')}"></label>
    <label>Пол<select name="sex">${opts(SEX, pet.sex)}</select></label>
    <label>Номер чипа<input name="chip" maxlength="40" inputmode="numeric" value="${escapeHtml(pet.chip || '')}"></label>
    <label>MDR1<select name="mdr1">${opts(MDR1.includes(pet.mdr1) || !pet.mdr1 ? MDR1 : [...MDR1, pet.mdr1], pet.mdr1)}</select></label>
    ${S.photo ? '<button type="button" class="btn danger-outline wide" data-action="photo-remove">Убрать фото</button>' : ''}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const v = (k) => String(fd.get(k) || '').trim();
    store.savePet({ name: v('name'), breed: v('breed'), birth: /^\d{4}-\d\d-\d\d$/.test(v('birth')) ? v('birth') : '', sex: v('sex'), chip: v('chip'), mdr1: v('mdr1'), weight: (S.pet && S.pet.weight) || '' });
    toast('Паспорт сохранён.');
  });
}

// ---------- Рост и вес ----------

function growthCardHtml(field, title, unit, empty) {
  const pts = series(S.growth, field);
  if (!pts.length) return `<section class="growth-card"><p class="eyebrow">${title}</p><p class="muted">${empty}</p></section>`;
  const last = pts[pts.length - 1];
  const delta = deltaText(pts, unit);
  return `<section class="growth-card">
    <p class="eyebrow">${title}</p>
    <div class="growth-now"><strong>${fmtNum(last.value)}<small>${unit}</small></strong>
      <span>${delta ? escapeHtml(delta) : `${dayTitle(last.date, { day: 'numeric', month: 'long' })}, первое измерение`}</span></div>
    <figure class="growth-chart">${lineChartSvg(pts, { unit })}</figure>
  </section>`;
}

function renderGrowth() {
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const rows = [...S.growth].sort((a, b) => (a.date < b.date ? 1 : -1));
  const birth = S.pet && S.pet.birth;
  const oldWeight = !series(S.growth, 'weight').length && S.pet && S.pet.weight;
  return `<a class="back" href="#/pass">${arrow}Паспорт</a>
    ${pageHead({ eyebrow: DOG(), title: 'Рост и вес', sub: 'Взвешивайте раз в одну-две недели, в одно время дня — так прибавка видна честнее.', plus: { action: 'growth-add', label: 'Новое измерение' } })}
    ${statusBanner()}
    ${oldWeight ? `<div class="banner"><span>В паспорте записан вес «${escapeHtml(S.pet.weight)}». Добавьте его с датой — и появится график.</span>
      ${canWrite() ? '<button class="btn small primary" data-action="growth-add">Добавить</button>' : ''}</div>` : ''}
    ${growthCardHtml('weight', 'Вес', 'кг', 'Взвешиваний пока нет. Нажмите «+», чтобы добавить первое.')}
    ${growthCardHtml('height', 'Рост в холке', 'см', 'Рост пока не измеряли. Меряют стоя, от пола до верхней точки лопаток.')}
    ${rows.length ? `<section class="card"><div class="card-head"><h2>Все измерения</h2></div>
      <ul class="growth-list">${rows.map((r) => {
        const age = birth ? ageText(birth, r.date) : '';
        return `<li><button class="growth-row" data-action="growth-edit" data-id="${r.id}"${canWrite() ? '' : ' disabled'}>
          <span class="growth-date">${dayTitle(r.date, { day: 'numeric', month: 'long' })}${age ? `<small>${age}</small>` : ''}</span>
          <span class="growth-val">${r.weight ? `${fmtNum(r.weight)} кг` : '—'}</span>
          <span class="growth-val">${r.height ? `${fmtNum(r.height)} см` : '—'}</span></button></li>`;
      }).join('')}</ul></section>` : ''}`;
}

// Новое измерение или правка: дата, вес и/или рост
function growthSheet(id) {
  const r = (id && S.growth.find((x) => x.id === id)) || { date: S.day, weight: id ? 0 : parseNum(S.pet && !series(S.growth, 'weight').length ? S.pet.weight : ''), height: 0 };
  const num = (v) => (v ? fmtNum(v) : '');
  openSheet(`<form class="form"><h2>${id ? 'Изменить измерение' : 'Новое измерение'}</h2>
    <label>Дата<input type="date" name="date" required value="${escapeHtml(r.date)}"></label>
    <label>Вес, кг<input name="weight" inputmode="decimal" autocomplete="off" placeholder="Например: 13,3" value="${num(r.weight)}"></label>
    <label>Рост в холке, см <span class="muted">(необязательно)</span><input name="height" inputmode="decimal" autocomplete="off" placeholder="Например: 48" value="${num(r.height)}"></label>
    <p class="muted small growth-err" hidden>Укажите вес или рост.</p>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
    ${id ? `<button type="button" class="btn danger-outline wide" data-action="growth-delete" data-id="${id}">Удалить измерение</button>` : ''}
  </form>`, (fd) => {
    const rec = { date: String(fd.get('date') || S.day), weight: parseNum(fd.get('weight')), height: parseNum(fd.get('height')) };
    if (rec.weight > 150) rec.weight = 0;
    if (rec.height > 150) rec.height = 0;
    if (!/^\d{4}-\d\d-\d\d$/.test(rec.date) || (!rec.weight && !rec.height)) {
      sheet.querySelector('.growth-err').hidden = false;
      return false;
    }
    store.saveGrowth(id || null, rec);
    toast('Измерение сохранено.');
  });
}

// Новая запись о здоровье или правка: что, вид, дата, сделано / запланировано, следующий раз
function healthFormSheet(id) {
  const r = (id && S.health.find((x) => x.id === id)) || { title: '', kind: 'vaccine', date: S.day, done: true, note: '' };
  openSheet(`<form class="form health-form"><h2>${id ? 'Изменить запись' : 'Новая запись о здоровье'}</h2>
    <label>Что<input name="title" maxlength="120" required list="health-suggest" value="${escapeHtml(r.title)}" placeholder="Например: обработка от клещей"></label>
    <datalist id="health-suggest">${HEALTH_SUGGEST.map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
    <fieldset><legend>Вид</legend><div class="choices">${Object.entries(HEALTH_KINDS).map(([k, v]) =>
      `<label class="choice"><input type="radio" name="kind" value="${k}"${k === r.kind ? ' checked' : ''}>${v.icon} ${v.label}</label>`).join('')}</div></fieldset>
    <fieldset><legend>Статус</legend><div class="choices">
      <label class="choice"><input type="radio" name="done" value="1"${r.done ? ' checked' : ''}>Уже сделано</label>
      <label class="choice"><input type="radio" name="done" value="0"${r.done ? '' : ' checked'}>Запланировать</label></div></fieldset>
    <label>Дата<input type="date" name="date" required value="${escapeHtml(r.date)}"></label>
    <div class="next-field"${r.done ? '' : ' hidden'}>${nextFieldHtml(suggestNext(r, S.health, S.pet && S.pet.birth))}</div>
    <label>Заметка <span class="muted">(необязательно)</span><textarea name="note" rows="2" maxlength="1000" placeholder="Препарат, доза, клиника">${escapeHtml(r.note)}</textarea></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
    ${id ? `<button type="button" class="btn danger-outline wide" data-action="health-delete" data-id="${id}">Удалить запись</button>` : ''}
  </form>`, (fd) => {
    const rec = {
      title: String(fd.get('title') || '').trim(), kind: String(fd.get('kind') || 'other'),
      date: String(fd.get('date') || S.day), done: fd.get('done') === '1', note: String(fd.get('note') || '').trim(),
    };
    if (!rec.title || !/^\d{4}-\d\d-\d\d$/.test(rec.date)) return;
    store.saveHealth(id || null, rec);
    const planned = rec.done ? planNext(rec, fd) : '';
    toast(planned ? `Сохранено. Следующий раз — ${dayTitle(planned, { day: 'numeric', month: 'long' })}.` : 'Сохранено.');
  });
  const form = sheet.querySelector('.health-form');
  const next = form.querySelector('select[name=next]');
  next.addEventListener('change', () => { next.dataset.touched = '1'; });
  form.addEventListener('change', () => {
    const fd = new FormData(form);
    form.querySelector('.next-field').hidden = fd.get('done') !== '1';
    if (!next.dataset.touched) {
      const rec = { id, title: String(fd.get('title') || ''), kind: String(fd.get('kind') || 'other'), date: String(fd.get('date') || S.day), done: true };
      next.value = suggestNext(rec, S.health, S.pet && S.pet.birth);
    }
    watchNextDate(form);
  });
}

// «Следующий раз» после выполненного: через месяц, 3 месяца, 12 недель, год или своя дата
function nextFieldHtml(selected = '') {
  return `<label>Следующий раз<select name="next">${NEXT_OPTIONS.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="next-date" hidden>Дата следующего раза<input type="date" name="nextDate"></label>`;
}
function watchNextDate(form) {
  const next = form.querySelector('select[name=next]');
  if (next) form.querySelector('.next-date').hidden = next.value !== 'date';
}

// Запланировать следующий раз; возвращает дату или ''
function planNext(rec, fd) {
  const opt = String(fd.get('next') || '');
  const date = opt === 'date' ? String(fd.get('nextDate') || '') : nextDate(rec.date, opt);
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return '';
  store.saveHealth(null, { title: rec.title, kind: rec.kind, date, done: false, note: rec.note });
  return date;
}

// Запись о здоровье: подробности, «Сделано», календарь, правка
function healthSheet(id) {
  const r = S.health.find((x) => x.id === id);
  if (!r) return;
  const k = HEALTH_KINDS[r.kind] || HEALTH_KINDS.other;
  const when = dayTitle(r.date, { day: 'numeric', month: 'long', year: 'numeric' });
  openSheet(`<div class="form"><h2>${k.icon} ${escapeHtml(r.title)}</h2>
    <p class="muted">${k.label} · ${r.done ? `сделано ${when}` : `${when} — ${dueText(r.date, S.day)}`}${r.updatedBy ? ` · записал(а) ${escapeHtml(r.updatedBy)}` : ''}</p>
    ${r.note ? `<p>${inline(r.note)}</p>` : ''}
    ${r.done ? '' : `<button type="button" class="btn primary wide" data-action="health-done" data-id="${r.id}">✓ Сделано</button>
      <p class="muted small">Напоминание на телефоне — через календарь:</p>
      <div class="edit-actions">
        <a class="btn small" href="${escapeHtml(googleCalendarUrl(r, DOG()))}" target="_blank" rel="noopener">Google Календарь</a>
        <button type="button" class="btn small" data-action="cal-ics" data-id="${r.id}">Календарь iPhone (.ics)</button>
      </div>`}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button><button type="button" class="btn" data-action="health-form" data-id="${r.id}">Изменить</button></div>
  </div>`, null);
}

// Отметить запланированное сделанным и сразу запланировать следующий раз
function healthDoneSheet(id) {
  const r = S.health.find((x) => x.id === id);
  if (!r) return;
  openSheet(`<form class="form"><h2>${escapeHtml(r.title)}</h2>
    <label>Когда сделали<input type="date" name="date" required value="${S.day}"></label>
    ${nextFieldHtml(suggestNext({ ...r, date: S.day }, S.health, S.pet && S.pet.birth))}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const date = String(fd.get('date') || S.day);
    const rec = { ...r, date, done: true };
    store.saveHealth(r.id, { title: rec.title, kind: rec.kind, date, done: true, note: rec.note });
    const planned = planNext(rec, fd);
    toast(planned ? `Отмечено. Следующий раз — ${dayTitle(planned, { day: 'numeric', month: 'long' })}.` : 'Отмечено.');
  });
  const form = sheet.querySelector('form');
  form.addEventListener('change', () => watchNextDate(form));
}

// Фото с телефона: выбрать (можно несколько) и сжать. onPicked(n) — сколько выбрано, пока они ещё сжимаются
async function choosePhotos(max = 1, onPicked = () => {}) {
  const picked = await pickPhotos({ multiple: max > 1 });
  const files = picked.slice(0, max);
  if (!files.length) return [];
  onPicked(files.length);
  toast(files.length > 1 ? `Готовим фото: ${files.length}…` : 'Готовим фото…');
  const out = [];
  for (const f of files) {
    try { out.push(await compressPhoto(f)); } catch (err) { console.error(err); }
  }
  const failed = files.length - out.length;
  if (failed) toast(out.length ? `Не получилось открыть ${failed} фото из ${files.length}. Попробуйте другие.` : 'Не получилось открыть фото. Попробуйте другое.');
  else if (picked.length > max) toast(`Добавили ${max} фото: больше в одну заметку не помещается.`);
  else hideToast();
  return out;
}
async function choosePhoto() { return (await choosePhotos(1))[0] || null; }

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
  return { page: parts[0] || 'today', tab: parts[0] || 'today', id: parts[1] || null, sub: parts[2] || null };
}

let lastRouteKey = '';

// Место на странице: при уходе запоминаем прокрутку, при возврате восстанавливаем.
// Карточки открываются сверху.
const scrollMemory = {};
let currentHash = location.hash || '#/';
let prevHash = null;
let pendingScroll = null; // { y, until } — дождаться, пока страница дорисуется до нужной высоты

// Ссылки для виджета «Быстрые команды» на iPhone: #/add/meal, #/add/toilet … — сразу окно записи
function takeAddLink() {
  const m = location.hash.match(/^#\/add\/([a-z]+)/);
  if (!m) return;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  if (EVENT_TYPES[m[1]]) S.pendingAdd = m[1];
}

function onHashChange() {
  takeAddLink();
  scrollMemory[currentHash] = window.scrollY;
  prevHash = currentHash;
  currentHash = location.hash || '#/';
  render();
}

// Название страницы для кнопки «Назад»; для правки карточки — нет (туда не возвращаемся)
const PAGE_TITLES = { today: 'Главная', day: 'День', k: 'Тренировки', g: 'Тренировки', pass: 'Паспорт', growth: 'Рост и вес', lib: 'Библиотека', weeks: 'Неделя Батончика', t: 'Советы', c: 'Каналы', d: 'Дневник', me: 'Настройки' };
// Какая вкладка внизу подсвечена: игры живут во вкладке «Тренировки», Каналы — в «Советах»
const TAB_OF = { today: 'today', day: 'day', k: 'k', g: 'k', pass: 'pass', growth: 'pass', lib: 't', weeks: 'day', t: 't', c: 't', d: 'd' };

function pageTitle(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return 'Главная';
  if (parts[0] === 'edit') return null;
  if (parts[1] && (TABS[parts[0]] || parts[0] === 'c')) return 'Назад';
  return PAGE_TITLES[parts[0]] || null;
}

function render(force) {
  const r = route();
  if (r.page !== 'edit') S.editor = null;
  // Открытую форму правки не перерисовываем от обновлений с сервера, чтобы не стереть набранный текст
  if (r.page === 'edit' && !force && S.editor && S.editor.key === editorKey(r) && view.querySelector('[data-editor]')) return;
  // То же для поиска в «Каналах», пока в нём печатают
  if (r.page === 'c' && !r.id && !force && document.activeElement && document.activeElement.matches('.notes-search')) return;
  if (r.page === 'lib' && r.id === 'dict' && !force && document.activeElement && document.activeElement.matches('.dict-search')) return;
  let html;
  if (r.page === 'me') html = renderMe();
  else if (r.page === 'edit') html = renderEditor(r);
  else if (r.page === 'day') html = renderDayPage();
  else if (r.page === 'pass') html = renderPassport();
  else if (r.page === 'growth') html = renderGrowth();
  else if (r.page === 'lib') html = renderLibrary(r);
  else if (r.page === 'weeks') html = renderWeeks();
  else if (r.page === 'd') html = renderDiary();
  else if (r.page === 'c') html = r.id ? renderNote(r.id) : renderNotesPage();
  else if (TABS[r.tab]) html = r.id ? renderCard(r.tab, r.id) : (r.tab === 't' ? renderTipsPage() : renderTrainingsPage());
  else html = renderHome();
  view.innerHTML = html;

  const routeKey = r.page + '/' + (r.tab || '') + '/' + (r.id || '') + '/' + (r.sub || '');
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    const saved = scrollMemory[currentHash];
    const isCard = !!((TABS[r.tab] || r.page === 'c') && r.id) || !!(r.page === 'lib' && r.sub);
    pendingScroll = !isCard && saved ? { y: saved, until: Date.now() + 2000 } : null;
    window.scrollTo(0, pendingScroll ? saved : 0);
    // Ссылка на вопрос или миф — раскрытый пункт сразу на экране
    const target = r.page === 'lib' && r.sub && r.id !== 'a' && document.getElementById(`lib-${r.id}-${r.sub}`);
    if (target) target.scrollIntoView({ block: 'start' });
  } else if (pendingScroll && Date.now() < pendingScroll.until) {
    // Страница дорисовалась (например, подгрузились данные) — дотягиваем до запомненного места
    window.scrollTo(0, pendingScroll.y);
  }
  if (pendingScroll && (Math.abs(window.scrollY - pendingScroll.y) < 2 || Date.now() >= pendingScroll.until)) pendingScroll = null;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const current = r.page === 'edit' ? TAB_OF[r.tab] : (TAB_OF[r.page] || (r.page === 'me' ? 'me' : 'today'));
    const on = a.dataset.tab === current;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Пришли по ссылке #/add/… — окно записи, как только можно записывать (после входа)
  if (S.pendingAdd && canWrite() && sheet.hidden) {
    const type = S.pendingAdd;
    S.pendingAdd = null;
    setTimeout(() => addEventFlow(type), 0);
  }
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
  // Сначала убираем курсор из поля: клавиатура закрывается обычным путём, а не вместе с исчезнувшим окном
  const focused = document.activeElement;
  if (focused && sheet.contains(focused)) focused.blur();
  sheet.hidden = true;
  sheetSubmit = null;
  document.body.classList.remove('no-scroll');
}

function saveEvent(type, extra = {}, at = new Date(), day = eventDayFor(at, type)) {
  const id = store.addEvent({ type, sub: '', text: '', ...extra, at, day });
  const t = EVENT_TYPES[type];
  // «Встали утром» после полуночи, когда «Легли» не отметили, — это уже новый день
  if (type === 'wake' && day === dayKey() && S.day < day) switchDay(day);
  // Запись в прошлый день в сегодняшний журнал не попадает — обновляем историю
  const past = day < S.day;
  if (past || type === 'wake') loadRecent(); // для ночного перерыва нужна вчерашняя запись «Легли»
  toast(`Записано: ${t.label.toLowerCase()}${extra.sub ? ` — ${SUBS[extra.sub]}` : ''}${extra.grams ? ` — ${extra.grams} г` : ''}, ${past ? `${dayTitle(day, { day: 'numeric', month: 'long' })}, ` : ''}${fmtTime(at)}`, {
    label: 'Отменить', onClick: () => { if (id) store.deleteEvent(id); if (past) loadRecent(); },
  });
}

// Время, указанное в окне записи: сегодня, а если оно ещё не наступило — вчера (записали после полуночи).
// День записи — по правилу «новый день после «Легли вечером»»
function pastTime(hm, type) {
  const now = new Date();
  const cal = dayKey(now);
  if (!/^\d\d:\d\d$/.test(hm)) return { at: now, day: eventDayFor(now, type) };
  let at = moscowDate(cal, hm);
  if (at - now > 5 * 60000) at = moscowDate(addDays(cal, -1), hm);
  return { at, day: eventDayFor(at, type) };
}

function saveTrain(ref) {
  const at = new Date();
  const n = (todayTrains()[ref] || 0) + 1; // считаем до записи: хранилище может обновить журнал сразу
  const id = store.addEvent({ type: 'train', card: ref, at, day: S.day });
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

// Подсказка в окне записи, если время ещё не наступило: запись уйдёт во вчерашний день
function watchPastTime(type) {
  const time = sheet.querySelector('input[name=time]');
  const when = sheet.querySelector('.ev-when');
  if (!time || !when) return;
  time.addEventListener('input', () => {
    const { day } = pastTime(time.value, type);
    when.hidden = day >= S.day;
    when.textContent = when.hidden ? '' : `Запишется в прошлый день, ${dayTitle(day, { day: 'numeric', month: 'long' })}.`;
  });
}

// Окно новой записи: что было (для туалета), время (по умолчанию сейчас), комментарий; в журнал — по «Сохранить»
function eventFormSheet(type) {
  const t = EVENT_TYPES[type];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  openSheet(`<form class="form"><h2>${t.icon} ${t.label}</h2>
    ${t.subs ? `<fieldset><legend>Что было</legend><div class="choices">${Object.entries(SUBS).map(([k, v]) =>
      `<label class="choice"><input type="radio" name="sub" value="${k}" required>${cap(v)}</label>`).join('')}</div></fieldset>` : ''}
    ${t.grams ? gramsFieldHtml(lastGrams()) : ''}
    <label>Время <input type="time" name="time" required value="${fmtTime(new Date())}"></label>
    <p class="muted small ev-when" hidden></p>
    <label>${t.text ? 'Что произошло' : 'Комментарий'} <textarea name="text" rows="${t.text ? 4 : 2}" maxlength="2000"${t.text
      ? ' required placeholder="Например: «Буп» на выходе из лифта получился 4 раза из 5"' : ' placeholder="Необязательно"'}></textarea></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const text = String(fd.get('text') || '').trim();
    if (t.text && !text) return;
    const sub = t.subs && SUBS[fd.get('sub')] ? String(fd.get('sub')) : '';
    const grams = t.grams ? gramsOf(fd) : 0;
    if (t.grams && !grams) return;
    const { at, day } = pastTime(String(fd.get('time') || ''), type);
    saveEvent(type, grams ? { sub, text, grams } : { sub, text }, at, day);
  });
  watchPastTime(type);
  if (t.text) setTimeout(() => { const ta = sheet.querySelector('textarea'); if (ta) ta.focus(); }, 50);
}

// Граммы корма: целое число от 1 до 5000
function gramsFieldHtml(value) {
  return `<label>Сколько отсыпали, г <input type="number" name="grams" inputmode="numeric" min="1" max="5000" step="1" required value="${value || ''}" placeholder="Например: 80"></label>`;
}
function gramsOf(fd) {
  const n = Math.round(Number(String(fd.get('grams') || '').replace(',', '.')));
  return n >= 1 && n <= 5000 ? n : 0;
}
// Сколько отсыпали в прошлый раз — чтобы не вводить одно и то же
function lastGrams() {
  const meals = [...S.recent, ...S.events].filter((e) => e.type === 'meal' && e.grams).sort((a, b) => new Date(b.at) - new Date(a.at));
  return meals.length ? meals[0].grams : '';
}

function editEvent(id) {
  const e = S.events.find((x) => x.id === id);
  if (!e) return;
  const t = EVENT_TYPES[e.type] || { label: e.type, icon: '' };
  openSheet(`<form class="form"><h2>${t.icon} ${t.label}</h2>
    <label>Время <input type="time" name="time" required value="${fmtTime(e.at)}"></label>
    ${e.day === S.day ? '<p class="muted small ev-when" hidden></p>' : ''}
    ${t.subs ? `<label>Что было <select name="sub">${Object.entries(SUBS).map(([k, v]) => `<option value="${k}"${e.sub === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
    ${t.grams ? gramsFieldHtml(e.grams) : ''}
    <label>${t.text ? 'Текст заметки' : 'Комментарий'} <textarea name="text" rows="3" maxlength="2000">${escapeHtml(e.text)}</textarea></label>
    <p class="muted small">Записал${e.name ? `: ${escapeHtml(e.name)}` : 'и'}</p>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
    <button type="button" class="btn danger-outline wide" data-action="ev-delete" data-id="${e.id}">Удалить запись</button>
  </form>`, (fd) => {
    const patch = { text: String(fd.get('text') || '').trim() };
    const hm = String(fd.get('time') || '');
    if (/^\d\d:\d\d$/.test(hm)) {
      // У сегодняшней записи время, которое ещё не наступило, — это вчера (например, «Легли» в 23:30, исправленное утром)
      const when = e.day === S.day ? pastTime(hm, e.type) : { at: moscowDate(e.day, hm), day: e.day };
      patch.at = when.at;
      if (when.day !== e.day) patch.day = when.day;
    }
    if (t.subs) patch.sub = String(fd.get('sub'));
    if (t.grams && gramsOf(fd)) patch.grams = gramsOf(fd);
    store.updateEvent(e.id, patch);
    if (patch.day) { loadRecent(); toast(`Запись перенесена на ${dayTitle(patch.day, { day: 'numeric', month: 'long' })}, ${fmtTime(patch.at)}.`); }
  });
  watchPastTime(e.type);
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
  'ev-add': (el) => { if (el.dataset.close) closeSheet(); addEventFlow(el.dataset.type); },
  'ev-menu': () => evMenuSheet(),
  'new-card-sheet': () => openSheet(`<div class="form"><h2>Добавить</h2>
    <a class="pick big" href="#/edit/k/new" data-action="sheet-close-link">🎯 Новая тренировка</a>
    <a class="pick big" href="#/edit/g/new" data-action="sheet-close-link">🎲 Новая игра</a>
    <button type="button" class="pick big" data-action="tr-add">📅 Тренировка или игра только на сегодня</button>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button></div></div>`, null),
  'sheet-close-link': (el) => { closeSheet(); location.hash = el.getAttribute('href'); },
  'new-tip': () => { location.hash = '#/edit/t/new'; },
  'photo-pick': async () => {
    if (!canWrite()) return;
    const data = await choosePhoto();
    if (data) { store.savePhoto(data); toast('Фото сохранено.'); }
  },
  'photo-remove': () => {
    if (!confirm('Убрать фото?')) return;
    closeSheet();
    store.savePhoto('');
  },
  'pet-edit': () => petSheet(),
  'growth-add': () => growthSheet(null),
  'growth-edit': (el) => growthSheet(el.dataset.id),
  'growth-delete': (el) => {
    if (!confirm('Удалить измерение?')) return;
    closeSheet();
    store.deleteGrowth(el.dataset.id);
  },
  'health-add': () => healthFormSheet(null),
  'health-edit': (el) => healthSheet(el.dataset.id),
  'health-form': (el) => healthFormSheet(el.dataset.id),
  'health-done': (el) => healthDoneSheet(el.dataset.id),
  'health-delete': (el) => {
    if (!confirm('Удалить запись?')) return;
    closeSheet();
    store.deleteHealth(el.dataset.id);
  },
  'cal-ics': (el) => {
    const r = S.health.find((x) => x.id === el.dataset.id);
    if (r) download('batonchik-napominanie.ics', icsText(r, DOG()), 'text/calendar');
  },
  'story-edit': (el) => storySheet(el.dataset.day || (route().page === 'd' && S.cal.sel && S.cal.sel <= S.day ? S.cal.sel : S.day)),
  // Нажатие на число — день под календарём; повторное нажатие на то же число — скрыть
  'cal-pick': (el) => {
    const day = el.dataset.day;
    S.cal.sel = S.cal.sel === day && !el.dataset.scroll ? '' : day;
    S.cal.month = monthOf(day);
    render();
    const card = S.cal.sel && document.getElementById('day-sel');
    if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  'cal-month': (el) => { S.cal.month = addMonths(S.cal.month, +el.dataset.dir); render(); },
  'memory-next': () => { S.cal.memShift++; render(); },
  'story-photo': async () => {
    const f = storyForm;
    const token = f.token;
    let n = 0;
    const list = await choosePhotos(MAX_STORY_PHOTOS - f.photos.length - f.busy, (k) => { n = k; f.busy += k; refreshStoryPhotos(); });
    if (token !== f.token) return; // форму уже закрыли и открыли другую
    f.busy = Math.max(0, f.busy - n);
    if (list.length) { f.photos = [...f.photos, ...list].slice(0, MAX_STORY_PHOTOS); f.changed = true; }
    refreshStoryPhotos();
  },
  'story-photo-remove': (el) => {
    storyForm.photos = storyForm.photos.filter((_, i) => i !== +el.dataset.i);
    storyForm.changed = true;
    refreshStoryPhotos();
  },
  'photo-view': (el) => {
    const list = storyPhotosOf(el.dataset.day);
    if (list.length) openViewer(list, +el.dataset.i || 0);
  },
  'viewer-close': () => closeViewer(),
  'story-delete': (el) => {
    if (!confirm('Удалить заметку о дне?')) return;
    const day = el.dataset.day;
    closeSheet();
    const oldCount = (S.stories[day] || {}).photoCount || 0;
    delete S.stories[day];
    delete S.storyPhotos[day];
    store.saveStory(day, null, { oldCount });
    render();
  },
  'ev-sub': (el) => { closeSheet(); saveEvent(el.dataset.type, { sub: el.dataset.sub }); },
  'ev-edit': (el) => editEvent(el.dataset.id),
  'ev-delete': (el) => {
    if (!confirm('Удалить запись?')) return;
    store.deleteEvent(el.dataset.id);
    closeSheet();
  },
  // Редактор карточек
  'notes-filter': (el) => {
    const key = el.dataset.f;
    S.notesFilter[key] = !S.notesFilter[key];
    el.setAttribute('aria-pressed', String(S.notesFilter[key]));
    applyNotesFilter();
  },
  'fact-next': () => { S.factShift++; render(); },
  // Библиотека
  'lib-read': (el) => {
    if (!canWrite()) return;
    const on = !S.reads.items[el.dataset.id];
    S.reads = { ...S.reads, items: { ...S.reads.items } };
    if (on) S.reads.items[el.dataset.id] = true; else delete S.reads.items[el.dataset.id];
    store.setRead(el.dataset.id, on);
    render();
  },
  'vet-edit': () => vetSheet(),
  'week-edit': (el) => weekSheet(el.dataset.day),
  'quiz-pick': (el) => {
    const test = S.lib.quizzes.find((t) => t.id === S.quiz.test);
    const q = test && test.qs[S.quiz.i];
    if (S.quiz.picked != null || !q) return;
    S.quiz.picked = +el.dataset.k;
    if (S.quiz.picked === q.answer) S.quiz.score++;
    render();
  },
  'quiz-next': () => {
    const test = S.lib.quizzes.find((t) => t.id === S.quiz.test);
    if (!test) return;
    if (S.quiz.i + 1 < test.qs.length) { S.quiz = { ...S.quiz, i: S.quiz.i + 1, picked: null }; render(); return; }
    S.quiz = { ...S.quiz, done: true };
    const best = S.reads.quiz[test.id];
    if (canWrite() && (best == null || S.quiz.score > best)) store.saveQuizBest(test.id, S.quiz.score);
    render();
    window.scrollTo(0, 0);
  },
  'quiz-restart': () => {
    const test = S.lib.quizzes.find((t) => t.id === S.quiz.test);
    if (test) S.quiz = { test: test.id, i: 0, picked: null, score: 0, done: false, order: quizOrder(test) };
    render();
  },
  // Оформление текста совета: подзаголовок, список, жирный
  'ed-fmt': (el) => {
    const ta = view.querySelector('[data-editor] textarea[data-path="text"]');
    if (!ta) return;
    const r = formatText(ta.value, ta.selectionStart, ta.selectionEnd, el.dataset.fmt);
    ta.value = r.value;
    ta.focus();
    ta.setSelectionRange(r.start, r.end);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  },
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
  // Обработчик вернул false — данные не подходят, окно остаётся открытым с подсказкой
  if (fn && fn(fd) === false) {
    sheetSubmit = fn;
    sheet.hidden = false;
    document.body.classList.add('no-scroll');
  }
});

// ---------- Экран iPhone после клавиатуры ----------
// Ошибка iOS 26: когда клавиатура спряталась, система иногда не возвращает экран на место
// (visualViewport.offsetTop остаётся больше нуля). Тогда всё закреплённое съезжает вверх:
// вкладки висят посреди экрана, шапка уходит за верхний край. Пока клавиатура закрыта,
// сдвигаем закреплённые элементы ровно на эту разницу; когда iOS исправится, сдвиг станет нулевым.
const isTyping = () => {
  const a = document.activeElement;
  return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'
    || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit'].includes(a.type)));
};
const vvShift = { top: 0, bottom: 0 };
function fitViewport() {
  const vv = window.visualViewport;
  let top = 0;
  let bottom = 0;
  if (vv && !isTyping() && Math.abs(vv.scale - 1) < 0.02) {
    top = Math.round(vv.offsetTop);
    bottom = Math.round(vv.offsetTop + vv.height - window.innerHeight);
    if (top < 2) top = 0;
    if (Math.abs(bottom) < 2) bottom = 0;
  }
  if (top === vvShift.top && bottom === vvShift.bottom) return;
  Object.assign(vvShift, { top, bottom });
  document.documentElement.style.setProperty('--vv-top', `${top}px`);
  document.documentElement.style.setProperty('--vv-bottom', `${bottom}px`);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fitViewport);
  window.visualViewport.addEventListener('scroll', fitViewport);
}
window.addEventListener('scroll', fitViewport, { passive: true });
window.addEventListener('resize', fitViewport);
window.addEventListener('pageshow', fitViewport);
document.addEventListener('visibilitychange', fitViewport);
document.addEventListener('focusin', fitViewport);
// Клавиатура уезжает с анимацией — проверяем ещё раз, когда она точно скрылась
document.addEventListener('focusout', () => { [60, 400, 900].forEach((ms) => setTimeout(fitViewport, ms)); });

// Если экран всё же съехал: пять нажатий подряд на открытую вкладку — размеры экрана в сообщении (для скриншота)
let diagTaps = [];
document.querySelector('.tabbar').addEventListener('click', (e) => {
  if (!e.target.closest('a[aria-current]')) return;
  const now = Date.now();
  diagTaps = [...diagTaps.filter((t) => now - t < 3000), now];
  if (diagTaps.length < 5) return;
  diagTaps = [];
  const vv = window.visualViewport || { width: 0, height: 0, offsetTop: 0, scale: 1 };
  const app = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'с экрана «Домой»' : 'в браузере';
  toast(`Экран: окно ${window.innerWidth}×${window.innerHeight}, видно ${Math.round(vv.width)}×${Math.round(vv.height)}, сдвиг ${Math.round(vv.offsetTop)}, масштаб ${(+vv.scale).toFixed(2)}, экран ${screen.width}×${screen.height}, поправка ${vvShift.top}/${vvShift.bottom}, ${app}`);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.viewer')) closeViewer();
  else if (!sheet.hidden) closeSheet();
});

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

function switchDay(k) {
  if (k === S.day) return;
  S.day = k;
  S.checks = {};
  S.recent = [...S.recent, ...S.events];
  S.events = [];
  S.ideaShift = { game: 0, training: 0 };
  S.factShift = 0;
  S.cal = { month: '', sel: '', memShift: 0 };
  store.setDay(k);
  render();
}

function checkDay() { switchDay(appDay()); }

applyTheme();
window.addEventListener('hashchange', onHashChange);
// Пользователь сам прокрутил страницу — больше не тянем её к запомненному месту
window.addEventListener('touchstart', () => { pendingScroll = null; }, { passive: true });
window.addEventListener('wheel', () => { pendingScroll = null; }, { passive: true });
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
let recentAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkDay();
  // «Легли» за вчера могли записать с другого телефона уже после полуночи — подгружаем вчерашние записи снова
  if (canWrite() && Date.now() - recentAt > 60000) { recentAt = Date.now(); loadRecent(); }
});
setInterval(checkDay, 30000);
setInterval(updateSince, 30000);
updateNet();
takeAddLink();
currentHash = location.hash || '#/';
renderHeader();
render();
store.setDay(S.day);
store.start();
loadContent();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
