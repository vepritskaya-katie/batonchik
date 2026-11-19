// Экраны приложения «Батончик»: Главная, День, Тренировки (с играми), Паспорт, Советы (с Каналами), Дневник и настройки.

import { parseBlocks, parseCatalog, parseCardMd, parseToday, renderBlocks, inline, escapeHtml, hash, plainText, stepKey as stepKeyFor } from './md.js';
import { createStore } from './store.js';
import { cardToForm, emptyForm, formToMd, editorHtml, editorAction, setPath, formatText } from './editor.js';
import {
  EVENT_TYPES, ADD_TYPES, SUBS, TRAIN, dayKey, fmtTime, fmtDate, addDays, moscowDate, dayStats, eventRow, todaySummary, nightLine, nightFor, plural, mondayOf, dayTitle,
  rhythmHtml, weekStatsHtml, daySummaryLine, trainsLine, MONTHS_SHORT, toiletRhythm, toiletHint, fmtDuration,
} from './diary.js';
import { HEALTH_KINDS, NEXT_OPTIONS, nextDate, suggestNext, dueText, ageText, upcoming, doneRecords, googleCalendarUrl, icsText, healthRowHtml, daysBetween, ageShort, ageMonths, hasTime, TIME_RE } from './passport.js';
import { pickPhotos, pickPhoto, compressPhoto } from './photo.js';
import { fmtNum, parseNum, series, deltaText, lineChartSvg } from './growth.js';
import { buildIndex, resultsHtml, entryItems } from './search.js';
import * as ASK from './ask.js';
import { RUBRICS, parseLibrary, readKey, readCount, readBtn, metaChips, articleBody, foldList, agesHtml, dictHtml, booksHtml, introHtml, casesHtml, healthBody, fillBlocks, fillItems } from './library.js';
import {
  FORMATS, DAILY, POINTS, READ_POINTS, LEVELS, parseQuestions, formatOf, optionOrder, todayIds, answered, finished, rightCount, readPoints,
  totalPoints, weekPoints, level, streak, playedDays, sharedDays, trophies, dueRepeats, afterRepeat, newMistake, topicProgress, seasons, seasonPoints, seasonLeft,
} from './game.js';
import { pickIdeas } from './ideas.js';
import { parseNotes, noteItemHtml, noteHtml, noteMatches, NOTE_FILTERS } from './notes.js';
import {
  CARE_ITEMS, EVERY_OPTIONS, everyText, careState, daysAgoText, careDue, REACTIONS, SOCIAL_GROUPS, SOCIAL_ITEMS, isOwnSocial, socialState, addReaction, checklistMapper,
  socialSummary, reactionLine, LOST_STEPS, hasLostPhones, lostLines, lostText, lostPosterHtml, lostPosterImage,
} from './care.js';
import * as AL from './alone.js';

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
const DIARY_STEP = 14; // страница «День»: две недели истории для сводки и графиков
const MIN_REPS = 5;   // цель по умолчанию для тренировки на сегодня: не меньше 5 повторов
const MAX_REPS = 50;
// Версия списка тренировок (v у пункта): 2 — цели подняты до MIN_REPS, 3 — добавлены ежедневные
// «Протокол расслабления» и «Спокойно, пока мы едим», 4 — пояснения из памятки с охраной ресурсов,
// 5 — новое пояснение у «Оставаться одному» (бывшее «Одиночество»), если прежнее не меняли
const PLAN_VERSION = 5;
const NOTES_V5 = { 'k/ostavatsya-odnomu': 'во время одного из дневных снов' };
const ADDED_IN_V3 = ['k/protokol-rasslableniya', 'k/spokoyno-poka-my-edim'];
// Карточки, переименованные в файлах: старая ссылка → новая (план, журнал, дневник)
const RENAMED = {
  'k/otday': 'k/menyaemsya', // «Отдай» → «Меняемся»
  'k/naydi': 'k/ischi', // «Найди!» → «Ищи»
  'k/namordnik-korzinka': 'k/korzinochnyy-namordnik',
  'g/tyagalka-beri-i-otday': 'g/tyagalka-beri-i-menyaemsya',
  'g/naydi-v-treh-korobkah': 'g/ischi-v-treh-korobkah',
  'k/zhdi': 'k/zhdat', // «Жди» → «Ждать»
  'k/odinochestvo': 'k/ostavatsya-odnomu', // «Одиночество» → «Оставаться одному» (13 шагов вместо 3)
};
// Здесь поменялось только слово, шаги прежние — отметки читаем и под старым id
const MARKS_FROM = {
  'g/tyagalka-beri-i-menyaemsya': 'g/tyagalka-beri-i-otday',
  'g/ischi-v-treh-korobkah': 'g/naydi-v-treh-korobkah',
  'k/zhdat': 'k/zhdi',
  // Шаги новые, но «Освоено», «Где получается» и общие галочки — те же
  'k/ostavatsya-odnomu': 'k/odinochestvo',
};
// Шаги прежней версии карточки, которых больше нет: если у них стояли галочки, показываем их под шагами
const OLD_STEPS = {
  'k/ostavatsya-odnomu': ['Выход из комнаты', 'Выход из квартиры', 'Дольше'],
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
  today: null,        // разобранный rasporyadok.md: вступление, тренировки по умолчанию, «Одиночество» и другие разделы подсказок
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
  notesFilter: { q: '', p: false, c: false, now: false, future: false, sci: false, exp: false }, // «Практика»: свои советы / каналы и фильтры заметок
  searchQ: '',        // поиск (лупа в шапке): ваши записи, советы, тренировки и игры
  entries: { list: null, loading: false, loadedAt: 0, failed: false }, // для поиска: записи журнала с текстом за все дни
  searchMore: {},     // разделы результатов, где нажали «Показать ещё»
  searchFrom: '',     // откуда открыли поиск — туда ведёт «Отмена»
  pet: null,          // паспорт: { name, breed, birth, sex, chip, mdr1, weight }
  photo: '',          // фото Батончика (data:image/jpeg…)
  health: [],         // паспорт: прививки, обработки, таблетки, врач — { id, title, kind, date, time (у врача, «ЧЧ:ММ» или пусто), done, note }
  growth: [],         // рост и вес: { id, date, weight (кг), height (см) }
  lib: null,          // Библиотека (content/biblioteka.md)
  reads: { items: {}, quiz: {} }, // что прочитано в Библиотеке — у каждого своё
  questions: null,    // вопросы игры (content/igra.md)
  gamePlayers: [],    // игроки: свой документ и чужие (для рейтинга)
  gameUi: { reveal: null, rep: null }, // разминка: открытое пояснение; повтор ошибок: { day, ids, i, picked }
  vet: null,          // «Срочно»: круглосуточная клиника, наш ветеринар и база, где зарегистрирован чип
  fields: {},         // поля «___» в карточках «Здоровья» («Норма Батончика»): { ключ: { v: значение, d: дата } }
  weeks: [],          // «Неделя Батончика»: { id: воскресенье, joy, choice, sleep, ribs, waist, notes, coat, stool, vigor, ticks, lastTicks, lastWorms }
  factShift: 0,       // «Факт дня» на главной: нажатие — следующий
  stories: {},        // дневник: заметки о днях { 'ГГГГ-ММ-ДД': { title, text, special, hasPhoto, photoCount, photoKey } } — все, без фото
  storyPhotos: {},    // фото к заметкам, загруженные по требованию: { день: { key, list: [data:image…], loading, failedAt } }
  cal: { month: '', sel: '', feat: '', memShift: 0, hit: '', jump: false }, // календарь в Дневнике: месяц ГГГГ-ММ, выбранный день, выбранный «день, который хочется помнить» (наверху), «другое воспоминание», запись из поиска
  months: {},         // журнал по месяцам для календаря: { 'ГГГГ-ММ': { events, loading, loadedAt } }
  lost: null,         // «Если потерялся»: { name1, phone1, name2, phone2, signs, note }
  social: {},         // социализация: { пункт: { title (у своих), log: [{ d, r }] } }
  socialFilter: 'all', // 'all' | 'new' — ещё не встречали | 'again' — повторить
  care: {},           // уход: { nails: { log: [дни], every } … }
  monthDates: null,   // фото месяца: { 5: 'ГГГГ-ММ-ДД' } — за какие месяцы есть фото и когда снято (null — ещё не знаем)
  monthPhotos: { all: null, loading: false, thumbs: {}, thumbLoading: {} }, // все фото (для «Как рос») и уменьшенные — для календаря дневника
  alone: [],          // «Учимся оставаться дома»: записи { id, type: train|check|forced, stage, food, reps: [{ s, r, o, c }], did, prep, note, at, day, uid, name }
  aloneUi: { chart: '', more: false }, // ступень на графике, «Показать ещё» в списке записей
  aloneFrom: '',      // откуда пришли в дневник — туда ведёт «Назад»
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
    if (becameReady) { loadRecent(); setTimeout(pushRefresh, 3000); }
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
  onFields(map) { S.fields = map || {}; render(); },
  onWeeks(list) { S.weeks = list || []; render(); },
  onStories(map) { S.stories = map || {}; render(); },
  onLost(v) { S.lost = v; render(); },
  onSocial(map) { S.social = map || {}; render(); },
  onCare(map) { S.care = map || {}; render(); },
  onGame(players) { S.gamePlayers = players || []; S.gameLoaded = true; render(); },
  onAlone(list) {
    S.alone = (list || []).map((v) => AL.cleanRecord(v, v.id)).filter(Boolean).sort((a, b) => a.at - b.at);
    render();
  },
  onMonths(dates) {
    // Список фото месяца изменился (в том числе на другом телефоне): «Как рос» перечитает фото,
    // а уменьшенные копии с другой датой или убранные — забываем
    const mp = S.monthPhotos;
    const next = dates || {};
    Object.keys(mp.thumbs).forEach((n) => { if (!S.monthDates || S.monthDates[n] !== next[n]) delete mp.thumbs[n]; });
    if (mp.all) mp.stale = true;
    S.monthDates = next;
    render();
  },
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
  // пояснения из обновлённой памятки (v4), пояснение у «Оставаться одному» (v5)
  if (S.plan.focus.some((f) => f.v < PLAN_VERSION)) {
    S.migrated = true;
    const needsV3 = S.plan.focus.some((f) => f.v < 3);
    const notes = new Map(S.defaultPlan.focus.map((f) => [f.card, f.note]));
    savePlan((p) => {
      p.focus.forEach((f) => {
        if (f.v < 2) f.target = Math.max(MIN_REPS, f.target);
        if (f.v < 4 && !f.day && notes.has(f.card)) f.note = notes.get(f.card);
        else if (f.v < 5 && !f.day && notes.has(f.card) && NOTES_V5[f.card] === f.note) f.note = notes.get(f.card);
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
  tasks.push(loadText('igra.md').then((t) => {
    try { S.questions = parseQuestions(t); } catch (err) { console.error(err); S.questions = { error: true }; }
  }).catch(() => { S.questions = { error: true }; }));
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

// Отметки под прежним id: переименованные карточки (MARKS_FROM) и карточки,
// перенесённые из «Советов», — их отметки раньше хранились с вкладкой t
function legacyIds(id) {
  const m = id.match(/^(step|task|card|lvl)_([kgt])_([^_]+)(.*)$/);
  if (!m) return [];
  const out = [];
  const from = MARKS_FROM[`${m[2]}/${m[3]}`];
  if (from) out.push(`${m[1]}_${from.replace('/', '_')}${m[4]}`);
  const [tab, cid] = from ? from.split('/') : [m[2], m[3]];
  if (tab === 'k') out.push(`${m[1]}_${MOVED_FROM}_${cid}${m[4]}`);
  return out;
}
function getMark(id) {
  if (S.marks[id]) return S.marks[id];
  const old = legacyIds(id).find((x) => S.marks[x]);
  return old ? S.marks[old] : null;
}

// «В прежней версии карточки было отмечено: «Выход из комнаты» (Катя · 3 нояб.)»
function oldStepsHtml(tab, card) {
  const titles = OLD_STEPS[`${tab}/${card.id}`];
  if (!titles) return '';
  const done = titles.map((t) => {
    const id = stepId(tab, card, stepKeyFor(`**${t}**`));
    return [t, getMark(id)];
  }).filter(([, m]) => m);
  if (!done.length) return '';
  return `<p class="muted small old-marks">В прежней версии карточки было отмечено: ${done.map(([t, m]) => `«${escapeHtml(t)}» (${byLine(m, true)})`).join(', ')}.</p>`;
}

function markButton(id, label = 'Освоено') {
  const m = getMark(id);
  return `<div class="mark${m ? ' on' : ''}">
    <button class="mark-btn" data-action="mark" data-id="${id}" data-confirm="1" aria-pressed="${!!m}"${canWrite() ? '' : ' disabled'}>
      ${m ? '✓ ' : ''}${label}</button>
    ${m ? `<span class="mark-by">${byLine(m, true)}</span>` : ''}
  </div>`;
}

// hint — пункт уже выполнен по «Дневнику одиночества»: подсвечиваем, отметку ставит человек
function taskButton(id, text, hint = false) {
  const m = getMark(id);
  return `<button class="task-btn${m ? ' on' : hint ? ' hinted' : ''}" data-action="mark" data-id="${id}" aria-pressed="${!!m}"${canWrite() ? '' : ' disabled'}>
    <span class="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <span class="task-text">${inline(text)}${m ? `<span class="mark-by">${byLine(m, true)}</span>` : hint ? '<span class="diary-hint">по дневнику ✓ — можно отметить</span>' : ''}</span></button>`;
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

// Рисунки линией в цвет раздела: у заголовков разделов и в пустых местах
const DOODLES = {
  paw: '<path d="M8.2 15.7c.9-2 2.3-3.1 3.8-3.1s2.9 1.1 3.8 3.1c.7 1.6.3 3.4-1.4 3.4-.9 0-1.5-.4-2.4-.4s-1.5.4-2.4.4c-1.7 0-2.1-1.8-1.4-3.4z"/><ellipse cx="6.3" cy="10.8" rx="1.6" ry="2.1" transform="rotate(-22 6.3 10.8)"/><ellipse cx="9.6" cy="7" rx="1.7" ry="2.2" transform="rotate(-6 9.6 7)"/><ellipse cx="14.4" cy="7" rx="1.7" ry="2.2" transform="rotate(6 14.4 7)"/><ellipse cx="17.7" cy="10.8" rx="1.6" ry="2.1" transform="rotate(22 17.7 10.8)"/>',
  ball: '<circle cx="12" cy="12" r="8"/><path d="M5.6 7.4c3 1.8 3.8 7 0 9.4M18.4 7.4c-3 1.8-3.8 7 0 9.4"/>',
  bone: '<path transform="rotate(-30 12 12)" d="M8.86 10.6H15.14A2.3 2.3 0 1 1 17.97 12A2.3 2.3 0 1 1 15.14 13.4H8.86A2.3 2.3 0 1 1 6.03 12A2.3 2.3 0 1 1 8.86 10.6Z"/>',
  leash: '<ellipse cx="6.2" cy="6.2" rx="2.9" ry="2.6" transform="rotate(-45 6.2 6.2)"/><path d="M8.3 8.3c2.4 1.6 3.4 3.9 4.6 5.8.7 1.1 1.4 1.7 2.3 2.1"/><rect x="15.3" y="15.2" width="3.4" height="5.4" rx="1.7" transform="rotate(-45 17 17.9)"/>',
  bowl: '<path d="M3.5 12.5h17l-1.7 4.9a2 2 0 0 1-1.9 1.4H7.1a2 2 0 0 1-1.9-1.4z"/><path d="M7.5 12.5c.6-2.4 2.4-3.8 4.5-3.8s3.9 1.4 4.5 3.8"/><path d="M10.6 6.2l.4-1.2M13.4 6.2l-.4-1.2"/>',
  house: '<path d="M3.8 11.2 12 4.6l8.2 6.6"/><path d="M6 9.5v9.5h12V9.5"/><path d="M10 19v-3.8a2 2 0 0 1 4 0V19"/>',
};
const doodle = (name, cls = '') => `<svg class="doodle${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${DOODLES[name]}</svg>`;
// Пусто: рисунок и текст по центру
const emptyArt = (text, name = 'paw', tag = 'p') => `<${tag} class="empty empty-art">${doodle(name)}<span>${text}</span></${tag}>`;

// Шапка страницы: надпись сверху, заголовок, подзаголовок и круглая кнопка «+»
function pageHead({ eyebrow = '', title, sub = '', plus = null, h1Class = '' }) {
  return `<div class="page-head">
    <div class="page-head-text">${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h1${h1Class ? ` class="${h1Class}"` : ''}>${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
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
  return renderBlocks(blocks, { task: (text) => taskButton(taskId(tab, card, text), text, tab === 't' && aloneHint(text)), ...opts });
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
  const buttons = ADD_TYPES.map(([type, t]) =>
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
      : emptyArt('Сегодня ещё ничего не записано. Нажмите кнопку, и запись появится здесь с временем и именем.', 'paw')}
  </section>`;
}

// Строка значков быстрых записей (на главной): одно нажатие — как кнопки журнала
function evIconsHtml() {
  const can = canWrite();
  return `<div class="ev-icons">${ADD_TYPES.map(([type, t]) =>
    `<button class="ev-icon-btn" data-action="ev-add" data-type="${type}"${can ? '' : ' disabled'} aria-label="${t.label}">
      <span class="ev-icon" aria-hidden="true">${t.icon}</span><span>${t.short}</span></button>`).join('')}</div>`;
}

// «+» вверху главной и «Дня»: выбор, что записать
function evMenuSheet() {
  openSheet(`<div class="form"><h2>Новая запись</h2>
    ${ADD_TYPES.map(([type, t]) => `<button type="button" class="pick big" data-action="ev-add" data-type="${type}" data-close="1">${t.icon} ${t.label}</button>`).join('')}
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

// Дорожка следов: сделанные повторы — закрашенные лапки (до 6 повторов; больше — обычная полоска)
const PAW_PATH = 'M169.86-485Q132-485 106-511.14t-26-64Q80-613 106.14-639t64-26Q208-665 234-638.86t26 64Q260-537 233.86-511t-64 26ZM291-681.14q-26-26.14-26-64T291.14-809q26.14-26 64-26T419-808.86q26 26.14 26 64T418.86-681q-26.14 26-64 26T291-681.14Zm250 0q-26-26.14-26-64T541.14-809q26.14-26 64-26T669-808.86q26 26.14 26 64T668.86-681q-26.14 26-64 26T541-681.14ZM789.86-485Q752-485 726-511.14t-26-64Q700-613 726.14-639t64-26Q828-665 854-638.86t26 64Q880-537 853.86-511t-64 26ZM266-75q-42 0-69-31.53-27-31.52-27-74.47 0-42 25.5-74.5T250-318q22-22 41-46.5t36-50.5q29-44 65-82t88-38q52 0 88.5 38t65.5 83q17 26 35.5 50t40.5 46q29 30 54.5 62.5T790-181q0 42.95-27 74.47Q736-75 694-75q-54 0-107-9t-107-9q-54 0-107 9t-107 9Z';
const pawIcon = (cls = '') => `<svg class="paw-ico${cls ? ` ${cls}` : ''}" viewBox="0 -960 960 960" aria-hidden="true"><path d="${PAW_PATH}"/></svg>`;
function pawTrail(n, target) {
  if (target > 6) return `<span class="mini-bar"><span style="width:${Math.min(100, Math.round(n / target * 100))}%"></span></span>`;
  return `<span class="paw-trail" aria-hidden="true">${Array.from({ length: target }, (_, j) => pawIcon(j < n ? 'on' : '')).join('')}</span>`;
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
    // Плитка (по две в ряд): название, шаг, счёт и «+1». В режиме правки — строки, как раньше: там стрелки и «Убрать»
    if (!edit) {
      const count = `<span class="tr-count">${n} из ${target}</span>${pawTrail(n, target)}`;
      return `<li class="item tr tr-tile${done ? ' done' : ''}">
        <div class="tr-tile-top">
          ${card ? `<a class="item-title link" href="#/${tab}/${id}">${escapeHtml(name)}</a>` : `<span class="item-title muted">${name}</span>`}
          ${it.day ? '<span class="chip today-only">только сегодня</span>' : ''}
          ${card && tab === 'k' ? `<span class="tr-step">${escapeHtml(currentStep(tab, card))}</span>` : ''}
        </div>
        <div class="tr-tile-foot">
          ${n && can ? `<button class="tr-progress-btn tr-tile-prog" data-action="tr-reps" data-card="${it.card}" aria-label="Повторы за сегодня: ${n}. Нажмите, чтобы убрать лишний">${count}</button>`
            : `<span class="tr-tile-prog">${count}</span>`}
          <button class="tr-tap${done ? ' on' : ''}" data-action="tr-tap" data-card="${it.card}"${can && card ? '' : ' disabled'}
            aria-label="Отметить повтор: ${escapeHtml(name)}, сделано ${n} из ${target}">
            ${done ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<span class="tr-plus">+1</span>'}</button>
        </div></li>`;
    }
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
    <details class="intro"><summary>Как устроены занятия</summary><div class="prose">${t.intro && t.intro.length ? renderBlocks(t.intro) : ''}
      <p>Одно нажатие на «+1» — один повтор. Сделали все повторы — плитка станет зелёной и уйдёт вниз. Ошиблись — нажмите на счёт «2 из 5», чтобы убрать лишний повтор. Счёт начинается заново после «Легли вечером».</p></div></details>
    <ul class="list${edit ? '' : ' tr-tiles'}">${items || emptyArt('Список пуст. Нажмите «Изменить», чтобы добавить тренировки.', 'ball', 'li')}</ul>
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
  // Плитка (по две в ряд, как план на неделю): вид, название, почему именно она, «+1» — повтор;
  // у тренировки — «В план», у обеих — «Другая» (↻), если есть из чего выбрать
  const row = (kind, icon, label, idea, count) => {
    if (!idea) return '';
    const n = counts[idea.ref] || 0;
    const name = idea.card.name;
    return `<div class="item tr-tile idea idea-tile">
      <div class="tr-tile-top">
        <div class="idea-top"><span class="idea-kind">${icon} ${label}</span>
          ${count > 1 ? `<button class="idea-next" data-action="idea-next" data-kind="${kind}" aria-label="${kind === 'game' ? 'Другая игра' : 'Другая тренировка'}">↻</button>` : ''}</div>
        <a class="item-title link" href="#/${idea.tab}/${idea.card.id}">${escapeHtml(name)}</a>
        <span class="idea-reason">${escapeHtml(idea.reason)}</span>
      </div>
      <div class="tr-tile-foot">
        ${kind === 'training' ? `<button class="idea-plan" data-action="idea-plan" data-card="${idea.ref}">В план</button>` : `<span class="tr-count">${n ? `сегодня ${n}` : ''}</span>`}
        <button class="tr-tap" data-action="tr-tap" data-card="${idea.ref}" aria-label="${kind === 'game' ? 'Сыграли' : 'Сделали'}: ${escapeHtml(name)}${n ? `, сегодня ${n}` : ''}"><span class="tr-plus">+1</span></button>
      </div></div>`;
  };
  const html = row('game', '🎲', 'Игра', ideas.game, ideas.gameCount) + row('training', '🎯', 'Тренировка', ideas.training, ideas.trainingCount);
  return html ? `<section class="section">
    <div class="section-head"><h2>Идеи на сегодня</h2></div>
    <p class="muted small">Игра и тренировка вне плана — если есть время и настроение. «+1» — сыграли или сделали, ↻ — другая идея.</p>
    <div class="ideas tr-tiles">${html}</div></section>` : '';
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

const PAW_SVG = `<svg class="ms" viewBox="0 -960 960 960" aria-hidden="true"><path d="${PAW_PATH}"/></svg>`;

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
      <div class="hero-trackwrap"><div class="hero-track" role="img" aria-label="Прогресс дня ${pct}%"><span style="width:${pct}%"></span></div>
        <span class="hero-paw" style="left:${pct}%">${pawIcon()}</span></div>
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
  // «Пора в туалет»: подсказка меняется, когда подошло обычное время
  document.querySelectorAll('[data-due]').forEach((el) => {
    const due = new Date(el.dataset.due) <= new Date();
    el.classList.toggle('due', due);
    el.textContent = due ? el.dataset.now : el.dataset.wait;
  });
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
  const hint = toiletHint(toiletRhythm(all), all, S.day);
  const hintDue = hint && hint.due <= new Date();
  const cell = (label, value) => `<div class="since-cell"><span>${label}</span><strong${value.at ? ` data-since="${new Date(value.at).toISOString()}"` : ''}>${value.text}</strong></div>`;
  return `<section class="card">
    <div class="card-head"><h2>Журнал</h2><a class="text-link" href="#/day">Весь день ›</a></div>
    ${evIconsHtml()}
    <div class="since">
      ${cell(`${home ? EVENT_TYPES.accident.icon : EVENT_TYPES.toilet.icon} Туалет${home ? ' дома' : ''}`,
        toilet ? { at: toilet.at, text: agoText(new Date(toilet.at)) } : { text: 'ещё не было' })}
      ${cell(`${EVENT_TYPES.meal.icon} Еда сегодня`, { text: food })}
    </div>
    ${hint ? `<p class="toilet-hint${hintDue ? ' due' : ''}" data-due="${hint.due.toISOString()}" data-wait="${escapeHtml(hint.wait)}" data-now="${escapeHtml(hint.now)}">${escapeHtml(hintDue ? hint.now : hint.wait)}</p>` : ''}
  </section>`;
}

// Здоровье на главной: только если до события неделя или меньше (или оно просрочено)
function homeHealthHtml() {
  const soon = upcoming(S.health).filter((r) => daysBetween(S.day, r.date) <= 7).slice(0, 3);
  const care = careDue(S.care, S.day).slice(0, 3);
  if (!soon.length && !care.length) return '';
  return `<section class="health-strip">
    <div class="health-symbol" aria-hidden="true">🩺</div>
    <div><p class="eyebrow">Здоровье и уход</p><strong>${soon.length ? 'Скоро' : 'Пора'}</strong></div>
    <ul class="health-list">${soon.map((r) => healthRowHtml(r, S.day)).join('')}${care.map(({ item, st }) => careRowHtml(item, st)).join('')}</ul>
    <a class="btn small wide" href="#/pass">Открыть паспорт ›</a></section>`;
}

function renderHome() {
  return `${pageHead({ eyebrow: cap(dayTitle(S.day)), title: greeting(), h1Class: 'greet' })}
    ${statusBanner()}
    ${heroHtml()}
    ${weekCardHtml()}
    ${gameInviteHtml()}
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
  return `<a class="back" href="#/">${BACK_SVG}Главная</a>
    ${pageHead({ eyebrow: cap(dayTitle(S.day)), title: 'День', sub: 'Всё, что отметили за день. Новый день начнётся после «Легли вечером».', plus: { action: 'ev-menu', label: 'Новая запись' } })}
    ${statusBanner()}
    ${journalHtml()}
    ${rhythmHtml(st, { trainsDone: p.done, trainsTotal: p.total })}
    ${canWrite() ? weekStatsHtml({ days, prevWeek: days.slice(7, 14), loading: S.diary.loading || !S.diary.from }) : ''}
    <a class="next-link weeks-link" href="#/weeks"><span class="muted small">По воскресеньям</span><strong>Неделя Батончика — история ›</strong></a>`;
}

// ---------- Тренировки (с играми) ----------

// Разделы подсказок без отметок из rasporyadok.md (сейчас их нет — «В течение дня» убран).
// Раздел «# Одиночество» показывается не здесь, а наверху страницы «Учимся оставаться дома» (блок «Как заниматься»)
const ALONE_SECTION = 'Одиночество';
function daySectionsHtml() {
  const t = S.today || {};
  return (t.sections || []).filter((g) => g.title !== ALONE_SECTION).map((g) => `<section class="section">
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
    <div class="entry-cards">${socialEntryHtml()}${aloneEntryHtml()}</div>
    ${ideasHtml()}
    ${daySectionsHtml()}
    <h2 class="lib-title">${doodle('ball')}Все тренировки и игры</h2>
    ${catalogBody('k', { fold: true })}
    ${catalogBody('g', { showTitle: true, fold: true })}`;
}

// ---------- Спросить (ИИ-помощник) ----------
// Кнопка ✨ в шапке. Вопрос, коротко о Батончике и подходящие материалы уходят на сервер (функция askAi),
// там отвечает Gemini. Разговор хранится только на этом телефоне. Без сервера (превью) — примерный ответ

const SPARK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3.5l1.7 4.6 4.6 1.7-4.6 1.7L11 16.1l-1.7-4.6L4.7 9.8l4.6-1.7z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
const CAMERA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>';
const AI_NAMES = { 'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'gemini-3.8-flash': 'Gemini 3.8 Flash' };
const modelLabel = (m) => AI_NAMES[m] || String(m || '').replace(/^gemini-/, 'Gemini ').replace(/-preview$/, '');

function askState() {
  // photo — фото, приложенное к следующему вопросу: { full, thumb } (data:image/jpeg); lastPhoto — для «Спросить ещё раз»
  if (!S.ask) S.ask = { chat: ASK.loadChat(lsGet(ASK.ASK_KEY)), busy: false, left: null, draft: '', photo: null, lastPhoto: null, photoBusy: false };
  return S.ask;
}
const saveChat = () => lsSet(ASK.ASK_KEY, JSON.stringify(askState().chat.slice(-ASK.KEEP)));

function renderAsk() {
  const a = askState();
  const can = canWrite();
  return `${pageHead({ eyebrow: 'ИИ-помощник', title: 'Спросить', sub: 'Отвечает Gemini — по записям Батончика, материалам приложения, а где их нет — по общим знаниям о собаках. Это подсказка, а не ветеринар.' })}
    ${statusBanner()}
    <div class="ask-log" id="ask-log" aria-live="polite">${askLogHtml()}</div>
    <form class="ask-form" data-ask-form>
      <div class="ask-att" id="ask-att"${a.photo || a.photoBusy ? '' : ' hidden'}>${askAttachHtml()}</div>
      <div class="ask-row">
        <button class="ask-attach" type="button" data-action="ask-photo" aria-label="Приложить фото"${can && !a.busy ? '' : ' disabled'}>${CAMERA_SVG}</button>
        <textarea class="ask-input" name="q" rows="1" maxlength="2000" placeholder="Ваш вопрос о Батончике" aria-label="Вопрос"${can ? '' : ' disabled'}>${escapeHtml(a.draft)}</textarea>
        <button class="ask-send" type="submit" aria-label="Отправить"${can && !a.busy ? '' : ' disabled'}>${SEND_SVG}</button>
      </div>
    </form>
    <p class="muted small ask-foot" id="ask-foot">${askFootHtml()}</p>`;
}

function askLogHtml() {
  const a = askState();
  if (!a.chat.length && !a.busy) {
    return `<div class="ask-empty">${doodle('ball')}<p>Спросите о Батончике. Например:</p>
      <div class="ask-starters">${ASK.STARTERS.map((t) => `<button type="button" class="ask-chip" data-action="ask-starter" data-q="${escapeHtml(t)}"${canWrite() ? '' : ' disabled'}>${escapeHtml(t)}</button>`).join('')}</div>
      <p class="muted small">Можно приложить фото — кнопка с фотоаппаратом слева от поля: «что у него на лапе?», «нормальный ли стул?»</p></div>`;
  }
  const msgs = a.chat.map((m, i) => {
    if (m.r === 'me') {
      return `<div class="ask-msg me${m.img ? ' has-img' : ''}">${m.img && ASK.isThumb(m.img) ? `<img class="ask-img" src="${m.img}" alt="Фото к вопросу">` : ''}${m.t ? `<p>${escapeHtml(m.t)}</p>` : ''}</div>`;
    }
    if (m.r === 'err') {
      const last = i === a.chat.length - 1;
      return `<div class="ask-msg err"><p>${escapeHtml(m.t)}</p>${last && !a.busy ? '<button type="button" class="text-link" data-action="ask-retry">Спросить ещё раз</button>' : ''}</div>`;
    }
    return `<div class="ask-msg ai"><div class="prose">${safe(() => mdHtml(m.t), m.t)}</div>${askSourcesHtml(m)}
      <span class="ask-model">${m.demo ? 'пример ответа — в превью ИИ не подключён' : `${escapeHtml(modelLabel(m.model))}${m.src && m.src.length ? ' · с поиском Google' : ''}`}</span></div>`;
  }).join('');
  const busy = a.busy ? `<div class="ask-msg ai busy"><span class="ask-typing" role="status" aria-label="Думаю">${pawIcon()}${pawIcon()}${pawIcon()}</span></div>` : '';
  return msgs + busy;
}

// Источники из поиска Google и блок поисковых подсказок Google (его показывать обязательно — условие Google).
// Блок подсказок — в отдельной рамке без скриптов: его оформление не смешивается с приложением
const SEARCH_DOC = (html) => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><meta name="color-scheme" content="light dark">
  <style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${html}</body></html>`;
function askSourcesHtml(m) {
  const src = (m.src || []).filter((x) => x && /^https:\/\//.test(x.uri || ''));
  const list = src.length ? `<p class="ask-sources"><span>Источники:</span> ${src.map((x) => `<a href="${escapeHtml(x.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(x.title || 'источник')}</a>`).join(' · ')}</p>` : '';
  const chips = m.sh ? `<iframe class="ask-search" title="Поиск Google" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc="${escapeHtml(SEARCH_DOC(m.sh))}"></iframe>` : '';
  return list + chips;
}
// Высота рамки — по содержимому
function fitSearchFrame(f) {
  try { const h = f.contentDocument && f.contentDocument.documentElement.scrollHeight; if (h) f.style.height = `${Math.min(h, 240)}px`; } catch { /* нет доступа — оставляем как есть */ }
}
view.addEventListener('load', (e) => { if (e.target && e.target.matches && e.target.matches('iframe.ask-search')) fitSearchFrame(e.target); }, true);

function askFootHtml() {
  const a = askState();
  const left = a.left != null ? ` Осталось сегодня: ${a.left} из ${ASK.DAILY_LIMIT}.` : '';
  return `Вопрос, фото и записи Батончика уходят в Gemini (Google Cloud) через наш сервер; для свежих сведений Gemini может искать в Google. Фото на сервере не сохраняются.${left}
    ${a.chat.length && !a.busy ? '<button type="button" class="text-link" data-action="ask-new">Новый разговор</button>' : ''}`;
}

// Фото к следующему вопросу: миниатюра и «убрать»
function askAttachHtml() {
  const a = askState();
  if (a.photoBusy) return '<span class="muted small">Готовим фото…</span>';
  if (!a.photo) return '';
  return `<img src="${a.photo.thumb}" alt="Фото к вопросу"><span class="muted small">Фото уйдёт вместе с вопросом</span>
    <button type="button" class="ask-att-x" data-action="ask-photo-remove" aria-label="Убрать фото">✕</button>`;
}
function updateAskAttach() {
  const el = $('#ask-att');
  if (!el) return;
  const a = askState();
  el.innerHTML = askAttachHtml();
  el.hidden = !a.photo && !a.photoBusy;
  const btn = view.querySelector('.ask-attach');
  if (btn) btn.disabled = !canWrite() || a.busy;
}

// Обновить разговор, не трогая поле ввода (в нём может быть начатый вопрос).
// scroll: 'last' — показать последнюю реплику над полем ввода; 'answer' — начало нового ответа; false — не прокручивать
function updateAsk({ scroll = 'last' } = {}) {
  const log = $('#ask-log');
  if (!log) return;
  log.innerHTML = askLogHtml();
  const foot = $('#ask-foot');
  if (foot) foot.innerHTML = askFootHtml();
  const send = view.querySelector('.ask-send');
  if (send) send.disabled = !canWrite() || askState().busy;
  updateAskAttach();
  if (scroll) scrollAsk(scroll);
}
// Фото и блоки поиска догружаются уже после прокрутки и меняют высоту — ещё секунду держим разговор на месте
let askPin = { how: '', until: 0 };
function scrollAsk(how = 'last', smooth = true) {
  const last = $('#ask-log') && $('#ask-log').lastElementChild;
  if (!last) return;
  askPin = { how, until: Date.now() + 1500 };
  last.scrollIntoView({ block: how === 'answer' ? 'start' : 'end', behavior: smooth && !calmMotion() ? 'smooth' : 'auto' });
}
view.addEventListener('load', (e) => {
  const t = e.target;
  if (!t || !t.closest || !t.closest('#ask-log') || Date.now() > askPin.until) return;
  const last = $('#ask-log').lastElementChild;
  if (last) last.scrollIntoView({ block: askPin.how === 'answer' ? 'start' : 'end' });
}, true);
['touchstart', 'wheel'].forEach((ev) => window.addEventListener(ev, () => { askPin.until = 0; }, { passive: true }));

// Что знает модель: коротко о Батончике, журнал за две недели, план, одиночество, социализация, уход, здоровье,
// последние заметки о днях и материалы приложения, подходящие к вопросу
function askContext(question) {
  const pet = S.pet || {};
  const L = [];
  const d = (key, opts = { day: 'numeric', month: 'long' }) => dayTitle(key, opts);
  L.push(`Сегодня: ${d(S.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(new Date())} по Москве. Спрашивает: ${(S.store.user && S.store.user.name) || 'хозяин'}.`);
  const age = ageText(pet.birth, S.day);
  const w = [...S.growth].filter((g) => g.weight).sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
  const h = [...S.growth].filter((g) => g.height).sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
  L.push(`${DOG()}: ${pet.breed || 'австралийская овчарка (аусси)'}, ${(pet.sex || 'кобель').toLowerCase()}${age ? `, ${age}` : ''}${pet.birth ? ` (родился ${d(pet.birth, { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}`
    + `${w ? `, вес ${w.weight} кг (${d(w.date)})` : ''}${h ? `, рост в холке ${h.height} см` : ''}${pet.mdr1 ? `, MDR1: ${pet.mdr1}` : ''}.`);
  const all = [...S.recent, ...S.events];
  const hint = toiletHint(toiletRhythm(all), all, S.day);
  if (hint) L.push(`Туалет: ${hint.due <= new Date() ? hint.now : hint.wait} (по будням; выходные не считаются).`);
  L.push(`\nЖурнал за две недели (сначала новые; повторы — сколько раз за день сделали упражнение):\n${ASK.journalText(all, { today: S.day, cardName: (ref) => cardName(ref) }) || 'записей нет'}`);
  // План на неделю и прогресс по карточкам
  const p = dayProgress();
  if (p.items.length) {
    L.push(`\nПлан на неделю (сегодня сделано повторов из цели; текущий шаг):\n${p.items.map((it) => {
      const { tab, id, card } = cardByRef(it.card);
      const n = p.counts[it.card] || 0;
      return `- [${card ? card.name : it.card}](#/${tab}/${id}): ${n} из ${targetOf(it)}${card && tab === 'k' ? `; ${currentStep(tab, card)}` : ''}`;
    }).join('\n')}`);
  }
  const mastered = commandCards().filter((c) => { const q = cardProgress('k', c); return q.mastered || (q.total && q.done === q.total); }).map((c) => c.name);
  if (mastered.length) L.push(`Освоено: ${mastered.join(', ')}.`);
  // Учимся оставаться дома
  if (S.alone.length) {
    const step = AL.currentStep(aloneDone(), S.alone);
    const rec = AL.allRecords(S.alone);
    const ws = AL.weekStats(S.alone, mondayOf(S.day), S.day);
    const recs = AL.STAGES.filter(([k]) => rec[k]).map(([k]) => `${AL.STAGE_LABEL[k] || k} — ${AL.fmtDur(rec[k])}`);
    L.push(`\n[Учимся оставаться дома](#/alone): ${step ? `шаг ${step} из 13` : 'все шаги отмечены'}; сессий на этой неделе ${ws.sessions}; вынужденных уходов дольше рекорда ${ws.forcedOver || 0}${recs.length ? `; рекорды спокойного ожидания: ${recs.join(', ')}` : ''}.`);
  }
  // Социализация
  const soc = socialSummary(S.social);
  const again = Object.keys(S.social).filter((id) => socialState(S.social[id]).again).map((id) => socialName(id));
  L.push(`[Социализация](#/social): встретили ${soc.met} из ${soc.total}${again.length ? `; повторить спокойнее: ${again.slice(0, 10).join(', ')}` : ''}.`);
  // Уход, здоровье
  const care = careDue(S.care, S.day).map(({ item, st }) => `${item.name.toLowerCase()} (${daysAgoText(st.days)})`);
  if (care.length) L.push(`Уход — пора: ${care.join(', ')}.`);
  const soon = upcoming(S.health).slice(0, 5).map((r) => `${r.title} — ${d(r.date)}`);
  if (soon.length) L.push(`Здоровье — впереди: ${soon.join('; ')}.`);
  const past = doneRecords(S.health).slice(0, 5).map((r) => `${r.title} — ${d(r.date)}`);
  if (past.length) L.push(`Здоровье — было: ${past.join('; ')}.`);
  const wk = [...S.weeks].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (wk) L.push(`Последняя «Неделя Батончика» (${d(wk.id)}): радовался жизни — ${wk.joy ? 'да' : 'нет'}, выбор — ${wk.choice ? 'да' : 'нет'}, спал хорошо — ${wk.sleep ? 'да' : 'нет'}${wk.notes ? `; заметки: «${String(wk.notes).slice(0, 400)}»` : ''}.`);
  const stories = Object.entries(S.stories).filter(([day, st]) => day <= S.day && st && (st.title || st.text)).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3);
  if (stories.length) L.push(`\nЗаметки о днях (Дневник):\n${stories.map(([day, st]) => `- ${d(day)}: ${st.title ? `${st.title}. ` : ''}${String(st.text || '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')}`);
  // Материалы приложения по вопросу
  const src = { lib: S.lib, cat: S.catalogs.t, notes: S.notes, k: S.catalogs.k, g: S.catalogs.g };
  if (!searchIndex || Object.keys(src).some((key) => searchIndex[key] !== src[key])) searchIndex = { ...src, items: buildIndex(src) };
  const mats = ASK.pickMaterials(searchIndex.items, question);
  if (mats.length) L.push(`\nМатериалы приложения по вопросу:\n${mats.map((m) => `### [${m.title}](${m.href}) — ${m.group}\n${m.text}`).join('\n\n')}`);
  const cards = ['k', 'g'].flatMap((tab) => (S.catalogs[tab] ? S.catalogs[tab].groups.flatMap((g) => g.cards.map((c) => `[${c.name}](#/${tab}/${c.id})`)) : []));
  if (cards.length) L.push(`\nВсе тренировки и игры в приложении (для ссылок): ${cards.join(', ')}.`);
  return L.join('\n');
}

function askErrorText(err) {
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || '');
  if (/unavailable|resource-exhausted|permission-denied|unauthenticated|invalid-argument/.test(code) && msg) return msg;
  if (/deadline-exceeded/.test(code)) return 'Ответ готовился слишком долго. Попробуйте ещё раз или спросите короче.';
  if (!navigator.onLine) return 'Нет интернета. Вопрос не отправлен.';
  return 'Сервер не ответил. Если ИИ-помощника только что подключили, проверьте, что GitHub выложил сервер (README, «ИИ-помощник»), и попробуйте ещё раз.';
}

async function askSend(text, photo = askState().photo) {
  const a = askState();
  const q = String(text || '').trim();
  if ((!q && !photo) || a.busy || a.photoBusy) return;
  if (!canWrite()) { toast('Чтобы спросить, войдите в приложение.'); return; }
  // Неудачная попытка перед этим вопросом не нужна в разговоре
  if (a.chat.length && a.chat[a.chat.length - 1].r === 'err') a.chat.pop();
  const history = ASK.historyFor(a.chat);
  a.chat.push({ r: 'me', t: q, at: Date.now(), ...(photo ? { img: photo.thumb } : {}) });
  a.busy = true;
  a.draft = '';
  a.photo = null;
  a.lastPhoto = photo || null;
  saveChat();
  const input = view.querySelector('.ask-input');
  if (input) { input.value = ''; fitAskInput(input); }
  updateAsk();
  let msg;
  try {
    const image = photo ? { mime: 'image/jpeg', data: photo.full.slice(photo.full.indexOf(',') + 1) } : null;
    const res = await store.askAi({ question: q, context: askContext(q || 'фото'), history, ...(image ? { image } : {}) });
    if (!res) {
      await new Promise((ok) => { setTimeout(ok, 900); });
      const demo = ASK.demoAnswer(q, !!photo);
      msg = { r: 'ai', t: demo.t, src: demo.src || [], at: Date.now(), demo: true };
    } else {
      msg = { r: 'ai', t: String(res.text || ''), at: Date.now(), model: res.model || '', src: Array.isArray(res.sources) ? res.sources.slice(0, 6) : [], sh: typeof res.searchHtml === 'string' ? res.searchHtml : '' };
      if (res.left != null) a.left = res.left;
    }
  } catch (err) {
    console.error(err);
    msg = { r: 'err', t: askErrorText(err), at: Date.now() };
  }
  a.chat.push(msg);
  a.busy = false;
  saveChat();
  if (route().page === 'ask') updateAsk({ scroll: msg.r === 'ai' ? 'answer' : 'last' });
}

// Поле вопроса растёт по тексту, но не выше трети экрана
function fitAskInput(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, Math.round(innerHeight / 3))}px`;
}
view.addEventListener('input', (e) => {
  if (!e.target.matches('.ask-input')) return;
  askState().draft = e.target.value;
  fitAskInput(e.target);
});
view.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-ask-form]')) return;
  e.preventDefault();
  const input = e.target.querySelector('.ask-input');
  askSend(input ? input.value : '');
});

// ---------- Советы и Каналы ----------

function tipsSwitch(on) {
  const a = (key, href, label) => `<a class="seg${on === key ? ' on' : ''}" href="${href}"${on === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="segmented three" aria-label="Разделы советов">${a('lib', '#/lib', 'Библиотека')}${a('t', '#/t', 'Практика')}${a('game', '#/game', 'Игра')}</nav>`;
}
const TIPS_SUB = 'Почему это работает, что делать в жизни — и игра на знания.';

// Страница «Советов»: шапка, «Срочно», переключатель разделов и раздел
function tipsPage(on, body, plus) {
  return `${pageHead({ title: 'Советы', sub: TIPS_SUB, plus })}${urgentBtn()}${tipsSwitch(on)}${body}`;
}

// ---------- Поиск (лупа в шапке) ----------
// Отдельный экран #/search: поле, под ним — найденное в советах, тренировках и играх

// Что искать: собирается один раз, заново — когда обновились файлы или правки карточек
let searchIndex = null;
function searchResultsHtml() {
  const src = { lib: S.lib, cat: S.catalogs.t, notes: S.notes, k: S.catalogs.k, g: S.catalogs.g };
  if (!searchIndex || Object.keys(src).some((key) => searchIndex[key] !== src[key])) searchIndex = { ...src, items: buildIndex(src) };
  // Ваши записи: загруженные за все дни, а за текущий день — живые, со всеми свежими правками
  const events = [...(S.entries.list || []).filter((e) => e.day !== S.day), ...S.events];
  const items = canWrite() ? [...entryItems({ events, stories: S.stories, today: S.day }), ...searchIndex.items] : searchIndex.items;
  const loading = Object.values(src).some((x) => !x);
  const mineLoading = canWrite() && !S.entries.list && !S.entries.failed;
  return `${resultsHtml(items, S.searchQ, S.searchMore)}${mineLoading ? '<p class="muted small">Загружаем ваши записи из журнала…</p>' : ''}
    ${S.entries.failed && !S.entries.list ? '<p class="muted small">Записи журнала за прошлые дни не загрузились — проверьте интернет.</p>' : ''}
    ${loading ? '<p class="muted small">Ещё загружаем часть текстов…</p>' : ''}`;
}

// Записи журнала с текстом за все дни — при каждом открытии поиска (не чаще раза в 30 секунд)
function loadEntries() {
  if (!canWrite() || S.entries.loading || Date.now() - S.entries.loadedAt < 30000) return;
  S.entries.loading = true;
  store.loadNotes()
    .then((list) => { S.entries = { list, loading: false, loadedAt: Date.now(), failed: false }; })
    .catch((err) => { console.error(err); S.entries = { ...S.entries, loading: false, loadedAt: Date.now(), failed: true }; })
    .finally(() => { if (route().page === 'search') applySearch(); });
}

const SEARCH_HINT = `<div class="search-hint muted"><p>Ищет в ваших записях — заметках и комментариях в журнале и заметках в Дневнике, — а ещё в советах (Библиотека и Практика вместе с заметками из каналов), тренировках и играх.</p>
  <p>Ваши записи — первыми, от новых к старым: сразу видно, когда это было в прошлый раз. Нажмите на запись — откроется этот день в Дневнике.</p>
  <p>Можно писать часть слова: «вырв» найдёт и «вырвало», и «вырвал». Несколько слов — найдутся места, где есть все.</p></div>`;

function renderSearch() {
  setTimeout(loadEntries, 0);
  const q = S.searchQ.trim();
  return `<div class="search-bar"><div class="search-box"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
      <input class="search-input" type="search" enterkeyhint="search" autocomplete="off" placeholder="Найти" aria-label="Поиск" value="${escapeHtml(S.searchQ)}">
      <button type="button" class="search-clear" data-action="search-clear" aria-label="Очистить"${q ? '' : ' hidden'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8l8 8M16 8l-8 8"/></svg></button></div>
    <button type="button" class="search-cancel" data-action="search-cancel">Отмена</button></div>
    <div class="search-results">${q ? searchResultsHtml() : SEARCH_HINT}</div>`;
}

// Пока печатают, обновляются только результаты: поле не теряет курсор
function applySearch() {
  const q = S.searchQ.trim();
  const results = view.querySelector('.search-results');
  if (!results) return;
  results.innerHTML = q ? searchResultsHtml() : SEARCH_HINT;
  view.querySelector('.search-clear').hidden = !q;
}

// Лупа: поиск с чистого листа. Клавиатура на iPhone открывается, только если поле получило курсор
// прямо во время нажатия, — поэтому сразу ставим курсор во временное поле, а после перехода переносим в настоящее
function openSearch(e) {
  if (route().page === 'search') { e.preventDefault(); const input = view.querySelector('.search-input'); if (input) input.focus(); return; }
  S.searchFrom = currentHash;
  S.searchQ = '';
  S.searchMore = {};
  const tmp = document.createElement('input');
  tmp.className = 'focus-bridge';
  tmp.style.fontSize = '16px'; // меньше 16 px — iPhone приближает страницу
  tmp.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tmp);
  tmp.focus();
  S.searchFocus = tmp;
}

// Пришли из поиска — «Назад» возвращает к найденному
const fromSearch = () => prevHash === '#/search';
const searchBack = (fallback) => (fromSearch() ? `<a class="back" href="#/search" data-action="back">${BACK_SVG}Поиск</a>` : fallback);

// ---------- Практика: наши советы и заметки из каналов ----------
// По темам (# в sovety.md и ## в kanaly.md): сначала наши правила и протоколы 🧭, потом заметки из Telegram-каналов 📣

const SRC_FILTERS = [['p', '🧭 Практика'], ['c', '📣 Каналы и чат']];
const NOTE_ONLY = NOTE_FILTERS.map(([k]) => k);
// Внутри пары («Практика» / «Каналы», «сейчас» / «на будущее», ✅ / 💬) — «или», между парами — «и».
// Фильтры заметок (сейчас, на будущее, ✅, 💬) оставляют только заметки
const tipShown = (f) => (!(f.p || f.c) || f.p) && !NOTE_ONLY.some((k) => f[k]);
const noteShown = (n, f) => !!n && (!(f.p || f.c) || f.c) && noteMatches(n, f);
const CHEV_SVG = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

function practiceThemes() {
  const themes = [];
  const byTitle = new Map();
  const theme = (title) => {
    if (!byTitle.has(title)) { const t = { title, cards: [], topics: [] }; byTitle.set(title, t); themes.push(t); }
    return byTitle.get(title);
  };
  (S.catalogs.t ? S.catalogs.t.groups : []).forEach((g) => { if (!g.raw) theme(g.title || 'Главное').cards.push(...g.cards); });
  if (S.notes && !S.notes.error) S.notes.sections.forEach((s) => theme(s.title || 'Разное').topics.push(...s.topics));
  return themes;
}

function practiceCount(shown, tips, notes) {
  return shown === tips + notes
    ? `Советов: ${tips}${notes ? ` · заметок из каналов и чата: ${notes}` : ''}`
    : `Найдено: ${shown} из ${tips + notes}`;
}

function renderTipsPage() {
  const plus = { action: 'new-tip', label: 'Новый совет' };
  const cat = S.catalogs.t;
  if (!cat) return tipsPage('t', '<p class="muted">Загружаем…</p>', plus);
  const f = S.notesFilter;
  let tips = 0;
  let notes = 0;
  let shown = 0;
  const sections = practiceThemes().map((t) => {
    let visible = 0;
    const cards = t.cards.map((c) => {
      const ok = tipShown(f);
      tips++;
      if (ok) visible++;
      return `<li data-tip${ok ? '' : ' hidden'}><a class="card-link" href="#/t/${c.id}">
        <span class="card-name">${inline(c.name)}</span>
        ${c.subtitle ? `<span class="card-sub">${inline(c.subtitle)}</span>` : ''}
        <span class="src-line"><span class="src-mark own">🧭 Практика</span>${isRead(readKey('tip', c.id)) ? READ_MARK : ''}</span>${CHEV_SVG}</a></li>`;
    }).join('');
    const topics = t.topics.map((tp) => {
      let n = 0;
      const items = tp.notes.map((note) => {
        const ok = noteShown(note, f);
        notes++;
        if (ok) n++;
        return noteItemHtml(note, ok, isRead(readKey('note', note.id)));
      }).join('');
      visible += n;
      return `<div class="note-topic" data-topic${n ? '' : ' hidden'}>${tp.title ? `<h3>${inline(tp.title)}</h3>` : ''}<ul class="cards">${items}</ul></div>`;
    }).join('');
    shown += visible;
    return foldHtml(`t:${t.title}`, inline(t.title), `<span data-count>${countText(visible)}</span>`,
      `${cards ? `<ul class="cards tips-list">${cards}</ul>` : ''}${topics}`, { cls: 'group note-section', attrs: ` data-section${visible ? '' : ' hidden'}` });
  }).join('');
  const chips = [...SRC_FILTERS, ...NOTE_FILTERS].map(([key, label]) =>
    `<button type="button" class="filter-chip" data-action="notes-filter" data-f="${key}" aria-pressed="${!!f[key]}">${label}</button>`).join('');
  const errors = cat.errors.map((e) => `<div class="banner warn">${escapeHtml(e)}</div>`).join('');
  const intro = cat.loose.length ? `<div class="prose notes-intro">${blocksHtml(cat.loose, 't', null)}</div>` : '';
  const notesState = !S.notes ? '<p class="muted small">Загружаем заметки из каналов…</p>'
    : S.notes.error ? '<div class="banner warn">Не удалось загрузить заметки из каналов. Проверьте интернет.</div>' : '';
  return tipsPage('t', `${errors}${intro}
    <p class="muted small practice-legend">🧭 <b>Практика</b> — наши правила и протоколы. 📣 <b>Канал</b> и 👥 <b>Чат</b> — заметки из Telegram-каналов и чата Aussie Moscow: ✅ наука и консенсус или 💬 опыт, который подходит не всем собакам.
      <a href="#/lib/a/kak-proveryat-sovety-nauka-mnenie-i-marketing">Как проверять советы ›</a></p>
    <div class="notes-tools"><div class="filter-chips">${chips}</div>
      <p class="muted small notes-count" aria-live="polite" data-tips="${tips}" data-notes="${notes}">${practiceCount(shown, tips, notes)}</p></div>
    ${notesState}${sections}
    <p class="empty notes-empty"${shown ? ' hidden' : ''}>Ничего не нашлось. Снимите часть фильтров.</p>`, plus);
}

// ---------- Игра ----------
// «Разминка дня»: 5 вопросов, у обоих одинаковые; очки, серии, рейтинг недели и повтор ошибок (расчёты — в game.js).
// День игры — календарный по Москве, одинаковый на обоих телефонах

const gameDay = () => dayKey();
const LEVEL_ICONS = ['🐶', '🐕', '🐑', '🎓', '🏅'];

function gamePlayers() {
  const user = S.store.user || {};
  const list = S.gamePlayers || [];
  const me = list.find((p) => p.me) || { uid: user.uid || '', me: true, name: user.name || '', photo: '', days: {}, rep: {}, known: {}, read: {} };
  // В рейтинге — только те, кто уже играл или читал
  const others = list.filter((p) => !p.me && (Object.keys(p.days || {}).length || Object.keys(p.read || {}).length));
  return { me, others, all: [me, ...others] };
}
const playerName = (p) => (p.me ? 'Вы' : p.name || 'Второй игрок');
function playerAva(p) {
  const user = S.store.user || {};
  const photo = p.me ? p.photo || user.photo || '' : p.photo;
  const name = (p.me ? user.name || p.name || 'Вы' : p.name) || '?';
  return /^https:\/\//.test(photo || '')
    ? `<span class="avatar ava-img"><img src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer"></span>`
    : `<span class="avatar">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
}
// Батончик в игре — иконка приложения: она квадратная и всегда есть, в отличие от фото из паспорта
const dogAva = (mood, big) => `<span class="game-dog${big ? ' big' : ''}"><img src="icons/icon-192.png" alt="" width="72" height="72">${mood ? `<span class="game-dog-mood" aria-hidden="true">${mood}</span>` : ''}</span>`;
const daysText = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const ptsText = (n) => `${n} ${plural(n, 'очко', 'очка', 'очков')}`;

function renderGame(r) {
  const Q = S.questions;
  if (!Q) return tipsPage('game', '<p class="muted">Загружаем…</p>');
  if (Q.error) return tipsPage('game', '<div class="banner warn">Не удалось загрузить вопросы. Проверьте интернет.</div>');
  if (r.id === 'play') return gameRoundHtml();
  if (r.id === 'repeat') return gameRepeatHtml();
  return tipsPage('game', gameMainHtml());
}

// Вопросы разминки на сегодня (без убранных из файла)
function gameTodayIds(me, all, today) {
  const rec = me.days[today];
  return rec ? rec.q : todayIds(S.questions.qs, me, all, today).filter((id) => S.questions.byId.has(id));
}

function gameMainHtml() {
  const today = gameDay();
  const { me, others, all } = gamePlayers();
  const can = canWrite();
  const rec = me.days[today];
  const ids = gameTodayIds(me, all, today);
  const done = finished(rec);
  const n = answered(rec);
  let title;
  let sub;
  let btn = '';
  if (done) {
    title = `Сегодня: ${rightCount(rec)} из ${rec.q.length}`;
    sub = 'Новая разминка — завтра.';
    btn = '<a class="btn wide" href="#/game/play">Посмотреть ответы</a>';
  } else if (n) {
    title = `Отвечено ${n} из ${ids.length}`;
    sub = 'Ответы сохраняются сразу — можно продолжить в любой момент.';
    btn = can ? '<a class="btn primary wide" href="#/game/play">Продолжить</a>' : '';
  } else {
    title = `${ids.length} ${plural(ids.length, 'вопрос', 'вопроса', 'вопросов')} на пару минут`;
    sub = can ? `+${POINTS.right} за верный ответ и +${POINTS.perfect} сверху, если все верные.` : 'Войдите в приложение, чтобы играть.';
    btn = can ? '<a class="btn primary wide" href="#/game/play">Начать разминку</a>' : '';
  }
  const mine = streak(playedDays(me), today);
  const together = others.length ? streak(sharedDays(all), today) : 0;
  const chips = `<span class="game-chip">🔥 ${mine ? `Серия: ${daysText(mine)}` : 'Начните серию сегодня'}</span>
    ${others.length ? `<span class="game-chip">🤝 Вместе: ${daysText(together)}</span>` : ''}`;
  // Результат второго — только после своей разминки
  const rivals = others.map((p) => {
    const pr = p.days[today];
    const text = !finished(pr) ? 'разминка ещё впереди'
      : done ? `${rightCount(pr)} из ${pr.q.length}` : 'разминка пройдена ✓ Результат откроется после вашей';
    return `<p class="game-rival">${playerAva(p)}<span><b>${escapeHtml(playerName(p))}:</b> ${text}</span></p>`;
  }).join('');
  const due = done && can ? dueRepeats(me, S.questions.byId, today) : [];
  const repeat = due.length ? `<section class="card game-repeat">
      <div class="card-head"><h2>Повтор ошибок</h2><span class="muted small">${due.length} ${plural(due.length, 'вопрос', 'вопроса', 'вопросов')}</span></div>
      <p class="muted">Вопросы, где вы ошиблись раньше. +${POINTS.fix} за каждую исправленную ошибку.</p>
      <a class="btn wide" href="#/game/repeat">Повторить</a></section>` : '';
  const mood = done ? (rightCount(rec) === rec.q.length ? '🎉' : '👍') : '🎯';
  const allSeasons = seasons(all, { day: today, q: ids });
  const season = allSeasons[allSeasons.length - 1];
  return `<section class="card game-hero">
      <div class="game-hero-top">${dogAva(mood, true)}
        <div class="game-hero-text"><p class="eyebrow">Разминка дня${season && season.n > 1 ? ` · сезон ${season.n}` : ''}</p><h2 class="game-title">${title}</h2><p class="muted small">${sub}</p></div></div>
      <div class="game-chips">${chips}</div>
      ${rivals}
      ${btn}
    </section>
    ${repeat}
    ${leagueHtml(me, others, today)}
    ${seasonHtml(me, others, allSeasons)}
    ${levelHtml(me)}
    ${topicsHtml(me)}
    ${gameRulesHtml()}`;
}

function weekRange(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return `${dayTitle(monday, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} – ${dayTitle(sunday, { day: 'numeric', month: 'long' })}`;
}

function leagueHtml(me, others, today) {
  const monday = mondayOf(today);
  const players = [me, ...others];
  const cups = trophies(players, today);
  const rows = players.map((p) => ({ p, pts: weekPoints(p, monday), total: totalPoints(p) }))
    .sort((a, b) => b.pts - a.pts || (a.p.me ? -1 : 1));
  const max = Math.max(1, ...rows.map((x) => x.pts));
  const list = rows.map((x, i) => `<li class="league-row${x.p.me ? ' me' : ''}">
      <span class="league-place">${others.length ? i + 1 : ''}</span>${playerAva(x.p)}
      <span class="league-who"><strong>${escapeHtml(playerName(x.p))}</strong>
        <small>${LEVEL_ICONS[level(x.total).i]} ${escapeHtml(level(x.total).name)}${cups.get(x.p) ? ` · 🏆 ${cups.get(x.p)}` : ''}</small>
        <span class="mini-bar"><span style="width:${Math.round((x.pts / max) * 100)}%"></span></span></span>
      <b class="league-pts">${x.pts}</b></li>`).join('');
  return `<section class="card game-league"><div class="card-head"><h2>Неделя</h2><span class="muted small">${weekRange(monday)}</span></div>
    <ol class="league">${list}</ol>
    <p class="muted small">${others.length ? 'Кубок 🏆 — тому, у кого за неделю больше очков. Каждый понедельник счёт с нуля.'
      : 'Когда второй из вас пройдёт первую разминку, здесь появится соревнование.'}</p></section>`;
}

// Сезон: пока не кончатся новые вопросы; дальше — по второму кругу. Итоги прошлых сезонов остаются
function seasonHtml(me, others, list) {
  if (!list.length) return '';
  const players = [me, ...others];
  const cur = list[list.length - 1];
  const left = seasonLeft(S.questions.qs, cur);
  const short = { day: 'numeric', month: 'short' };
  // Медаль 🥇 — только за закончившийся сезон
  const score = (s, done) => {
    const pts = players.map((p) => ({ p, v: seasonPoints(p, s) })).sort((a, b) => b.v - a.v || (a.p.me ? -1 : 1));
    const win = done && pts.length > 1 && pts[0].v > pts[1].v ? pts[0].p : null;
    return pts.map((x) => `<span>${x.p === win ? '🥇 ' : ''}${escapeHtml(playerName(x.p))}: <b>${x.v}</b></span>`).join('');
  };
  const what = cur.n === 1
    ? (left ? `Новых вопросов осталось ${left} — примерно на ${daysText(Math.ceil(left / DAILY))}. Потом начнётся сезон 2: вопросы пойдут по второму кругу, сначала самые давние. Повтор через пару месяцев закрепляет знания.`
      : 'Новые вопросы закончились — со следующей разминки начнётся сезон 2: вопросы по второму кругу.')
    : (left ? `Вопросы идут по ${cur.n === 2 ? 'второму' : 'новому'} кругу. В этом сезоне ещё не было ${left} ${plural(left, 'вопроса', 'вопросов', 'вопросов')} — примерно на ${daysText(Math.ceil(left / DAILY))}.`
      : `Сезон подходит к концу — со следующей разминки начнётся сезон ${cur.n + 1}.`);
  const past = list.slice(0, -1).reverse().map((s) => `<li><span class="season-name">Сезон ${s.n} <small>${dayTitle(s.from, short)} – ${dayTitle(s.to, short)}</small></span>
    <span class="season-score">${score(s, true)}</span></li>`).join('');
  return `<section class="card game-season"><div class="card-head"><h2>Сезон ${cur.n}</h2><span class="muted small">с ${dayTitle(cur.from, { day: 'numeric', month: 'long' })}</span></div>
    <p class="season-score now">${score(cur)}</p>
    <p class="muted small">${what}</p>
    ${past ? `<h3 class="season-past-title">Прошлые сезоны</h3><ul class="season-past">${past}</ul>` : ''}</section>`;
}

function levelHtml(me) {
  const total = totalPoints(me);
  const L = level(total);
  return `<section class="card game-level"><div class="card-head"><h2>Ваш уровень</h2><span class="muted small">${ptsText(total)}</span></div>
    <p class="level-name"><span aria-hidden="true">${LEVEL_ICONS[L.i]}</span> ${escapeHtml(L.name)}</p>
    <span class="level-bar"><span style="width:${Math.round(L.frac * 100)}%"></span></span>
    <p class="muted small">${L.next ? `До уровня «${escapeHtml(L.next)}» — ${ptsText(L.toNext)}.` : 'Высший уровень. Так держать!'}</p></section>`;
}

function topicsHtml(me) {
  const rows = topicProgress(S.questions.qs, me.known).map((t) => `<li class="topic-row"><span class="topic-name">${escapeHtml(t.topic)}</span>
    <span class="mini-bar"><span style="width:${Math.round((t.known / t.total) * 100)}%"></span></span><small>${t.known} из ${t.total}</small></li>`).join('');
  return `<section class="card game-topics"><div class="card-head"><h2>Что вы уже знаете</h2></div>
    <p class="muted small">Вопросы по темам, на которые вы хоть раз ответили верно.</p><ul class="topic-list">${rows}</ul></section>`;
}

function gameRulesHtml() {
  const formats = FORMATS.map((f) => `${f.icon} ${escapeHtml(f.title)}`).join(', ');
  return `<details class="card game-rules"><summary>Как устроена игра</summary><div class="prose"><ul>
    <li><b>Разминка дня</b> — ${DAILY} вопросов, по одному каждого формата: ${formats} Вопросы у вас обоих одинаковые и новые, пока не кончатся.</li>
    <li><b>Очки:</b> +${POINTS.right} за верный ответ, +${POINTS.perfect} за все верные, +${POINTS.fix} за исправленную ошибку. В Библиотеке за отметку «Прочитано»: статья, карточка «Здоровья» или разбор ситуации — +${READ_POINTS.a}, вопрос-ответ или миф — +${READ_POINTS.qa}. В «Практике» — +${READ_POINTS.note} за каждый совет или заметку.</li>
    <li><b>Ошибки</b> возвращаются через 1, 3 и 7 дней, пока не запомнятся, — до трёх в день.</li>
    <li><b>Серия 🔥</b> — дни подряд с разминкой; один пропуск в неделю её не обрывает. <b>Вместе 🤝</b> — дни, когда сыграли оба.</li>
    <li><b>Сезон</b> длится, пока не кончатся новые вопросы, потом они идут по второму кругу — начинается следующий сезон. Медаль 🥇 — тому, у кого за сезон больше очков. Новые вопросы, добавленные в игру, попадают в ближайшую разминку.</li>
    <li><b>Неделя</b> — с понедельника по воскресенье, кубок 🏆 — тому, у кого больше очков. Уровни: ${LEVELS.map(([pts, name], i) => `${LEVEL_ICONS[i]} ${escapeHtml(name)}${pts ? ` (${pts})` : ''}`).join(' → ')}.</li>
    <li>Ответы второго видны только после своей разминки. Свободной игры нет — чтобы вопросы за очки не попадались заранее.</li>
  </ul></div></details>`;
}

// Карточка вопроса: до ответа — варианты, после — что верно, пояснение и «Подробнее»
function questionHtml(q, { pos, total, picked, salt, eyebrow, points }) {
  const f = formatOf(q);
  const done = picked != null;
  const ok = done && picked === q.answer;
  const opts = optionOrder(q, salt).map((k) => {
    const cls = !done ? '' : k === q.answer ? ' right' : k === picked ? ' wrong' : ' dim';
    return `<button type="button" class="quiz-opt${cls}" data-action="game-pick" data-k="${k}"${done ? ' disabled' : ''}>${inline(q.options[k])}</button>`;
  }).join('');
  const after = !done ? '' : `<div class="game-verdict ${ok ? 'right' : 'wrong'}">${dogAva(ok ? '🎉' : '🤔')}
      <p><strong>${ok ? 'Верно!' : 'Не совсем.'}</strong>${ok && points ? ` <span class="game-plus">+${points}</span>` : ''}${ok ? '' : ` Правильно: «${inline(q.options[q.answer])}».`}</p></div>
    ${q.why ? `<p class="quiz-why">${inline(q.why)}</p>` : ''}
    ${q.more ? `<a class="game-more" href="${escapeHtml(q.more.href)}">Подробнее: ${escapeHtml(q.more.title)} ›</a>` : ''}
    <button class="btn primary wide" data-action="game-next">${pos + 1 < total ? 'Дальше' : 'Итог'}</button>`;
  return `<section class="card quiz game-q">
    <div class="quiz-top"><span class="eyebrow">${escapeHtml(eyebrow)} · ${pos + 1} из ${total}</span></div>
    <div class="quiz-track"><span style="width:${Math.round(((pos + (done ? 1 : 0)) / total) * 100)}%"></span></div>
    <p class="game-format"><span aria-hidden="true">${f.icon}</span> ${escapeHtml(f.title)}</p>
    <p class="quiz-q">${inline(q.text)}</p>
    <div class="quiz-opts${f.defaults && q.options.length === 2 ? ' two' : ''}">${opts}</div>
    ${after}
  </section>`;
}

function gameRoundHtml() {
  const today = gameDay();
  const { me, others, all } = gamePlayers();
  const back = `<a class="back" href="#/game">${BACK_SVG}Игра</a>`;
  const rec = me.days[today];
  if (!canWrite() && !rec) return `${back}<p class="muted">Войдите в приложение, чтобы играть.</p>`;
  const ids = gameTodayIds(me, all, today);
  const ui = S.gameUi;
  const revealing = ui.reveal != null && ui.revealDay === today;
  const i = revealing ? ui.reveal : answered(rec);
  if (!ids.length) return `${back}<p class="muted">Вопросов пока нет.</p>`;
  if (i >= ids.length) return back + gameResultHtml(me, others, rec, today);
  const q = S.questions.byId.get(ids[i]);
  if (!q) {
    return `${back}<section class="card"><p class="muted">Этот вопрос убрали из игры.</p>
      <button class="btn primary wide" data-action="game-pick" data-k="-1">Дальше</button></section>`;
  }
  const picked = rec && rec.p[i] != null ? rec.p[i] : revealing ? ui.revealPick : null;
  return back + questionHtml(q, { pos: i, total: ids.length, picked, salt: today, eyebrow: 'Разминка дня', points: POINTS.right });
}

function gameResultHtml(me, others, rec, today) {
  const right = rightCount(rec);
  const total = rec.q.length;
  const perfect = right === total && total >= DAILY;
  const pts = right * POINTS.right + (perfect ? POINTS.perfect : 0);
  const mine = streak(playedDays(me), today);
  const rivals = others.filter((p) => finished(p.days[today]));
  const rows = rec.q.map((id, k) => {
    const q = S.questions.byId.get(id);
    if (!q) return '';
    const ok = !!rec.ok[k];
    const yours = rec.p[k];
    const theirs = rivals.map((p) => {
      const j = p.days[today].q.indexOf(id);
      return j < 0 ? '' : `<span>${escapeHtml(playerName(p))}: ${p.days[today].ok[j] ? '✓' : '✗'}</span>`;
    }).join('');
    return `<li class="${ok ? 'right' : 'wrong'}"><span class="rv-mark" aria-label="${ok ? 'верно' : 'ошибка'}">${ok ? '✓' : '✗'}</span><div>
      <p class="rv-q">${inline(q.text)}</p>
      <p class="rv-a">Ответ: «${inline(q.options[q.answer])}»${!ok && q.options[yours] != null ? ` · ваш: «${inline(q.options[yours])}»` : ''}</p>
      ${theirs ? `<p class="rv-rivals">${theirs}</p>` : ''}
      ${q.more ? `<a class="game-more" href="${escapeHtml(q.more.href)}">Подробнее ›</a>` : ''}</div></li>`;
  }).join('');
  const due = canWrite() ? dueRepeats(me, S.questions.byId, today) : [];
  const waiting = others.filter((p) => !finished(p.days[today])).map((p) => `<p class="muted small">${escapeHtml(playerName(p))}: разминка ещё впереди.</p>`).join('');
  return `<section class="card game-result">
      ${dogAva(perfect ? '🎉' : right >= total - 1 ? '👍' : '💪', true)}
      <p class="quiz-score">${right}<small> из ${total}</small></p>
      <p class="game-plus big">+${ptsText(pts)}${perfect ? ' — все верные!' : ''}</p>
      <p class="muted">🔥 Серия: ${daysText(mine)}</p>
      ${due.length ? `<a class="btn primary wide" href="#/game/repeat">Повторить ошибки (${due.length})</a>` : ''}
      <a class="btn wide" href="#/game">К игре</a>
    </section>
    <section class="card"><div class="card-head"><h2>Ответы</h2></div>${waiting}<ol class="game-review">${rows}</ol></section>`;
}

function gameRepeatHtml() {
  const today = gameDay();
  const { me } = gamePlayers();
  const back = `<a class="back" href="#/game">${BACK_SVG}Игра</a>`;
  if (!canWrite()) return `${back}<p class="muted">Войдите в приложение, чтобы играть.</p>`;
  if (!finished(me.days[today])) return `${back}<p class="muted">Сначала — разминка дня.</p><a class="btn primary" href="#/game/play">К разминке</a>`;
  let st = S.gameUi.rep;
  if (!st || st.day !== today) st = S.gameUi.rep = { day: today, ids: dueRepeats(me, S.questions.byId, today), i: 0, picked: null, fixed: 0, paid: 0 };
  if (!st.ids.length) return `${back}<section class="card"><p class="muted">Сегодня повторять нечего. Ошибки вернутся через несколько дней.</p><a class="btn wide" href="#/game">К игре</a></section>`;
  if (st.i >= st.ids.length) {
    return `${back}<section class="card game-result">${dogAva(st.fixed === st.ids.length ? '🎉' : '💪', true)}
      <p class="quiz-score">${st.fixed}<small> из ${st.ids.length}</small></p>
      <p class="muted">${st.fixed ? 'исправлено' : 'пока не получилось — вопросы вернутся завтра'}${st.paid ? ` · <span class="game-plus">+${st.paid * POINTS.fix}</span>` : ''}</p>
      <a class="btn wide" href="#/game">К игре</a></section>`;
  }
  const q = S.questions.byId.get(st.ids[st.i]);
  return back + questionHtml(q, { pos: st.i, total: st.ids.length, picked: st.picked, salt: `${today}:r`, eyebrow: 'Повтор ошибок', points: st.lastPaid ? POINTS.fix : 0 });
}

// Ответ в разминке или в повторе: сразу сохраняем — продолжить можно с любого телефона
function gamePick(k) {
  if (!canWrite() || !S.questions || S.questions.error) return;
  const today = gameDay();
  const { me, all } = gamePlayers();
  if (route().id === 'repeat') {
    const st = S.gameUi.rep;
    const rec = me.days[today];
    if (!st || st.picked != null || !finished(rec)) return;
    const id = st.ids[st.i];
    const q = S.questions.byId.get(id);
    if (!q) return;
    const ok = k === q.answer;
    const res = afterRepeat(me.rep[id], ok, today);
    Object.assign(st, { picked: k, lastPaid: res.paid, fixed: st.fixed + (ok ? 1 : 0), paid: st.paid + (res.paid ? 1 : 0) });
    store.saveGame({
      days: { [today]: { ...rec, fix: rec.fix + (res.paid ? 1 : 0), r: rec.r + 1 } },
      rep: { [id]: res.entry },
      known: ok ? { [id]: 1 } : {},
    });
    render();
    return;
  }
  const rec = me.days[today];
  const ids = gameTodayIds(me, all, today);
  const i = answered(rec);
  if (i >= ids.length || (S.gameUi.reveal != null && S.gameUi.revealDay === today)) return;
  const q = S.questions.byId.get(ids[i]);
  const ok = !!q && k === q.answer;
  const day = { q: ids, p: [...(rec ? rec.p : []), k], ok: [...(rec ? rec.ok : []), ok], fix: rec ? rec.fix : 0, r: rec ? rec.r : 0 };
  const patch = { days: { [today]: day } };
  if (q && ok) patch.known = { [q.id]: 1 };
  // Ошибка вернётся завтра; если за неё уже давали очки за исправление, второй раз не дадут
  if (q && !ok) patch.rep = { [q.id]: { ...newMistake(today), paid: !!(me.rep[q.id] && me.rep[q.id].paid) } };
  store.saveGame(patch);
  if (q) Object.assign(S.gameUi, { reveal: i, revealDay: today, revealPick: k });
  render();
}

function gameNext() {
  if (route().id === 'repeat') {
    const st = S.gameUi.rep;
    if (st) Object.assign(st, { i: st.i + 1, picked: null, lastPaid: false });
  } else S.gameUi.reveal = null;
  render();
  window.scrollTo(0, 0);
}

// ---------- Что нового и приглашение в игру ----------
// Один раз на телефоне — окно с коротким списком больших обновлений и кнопкой «Попробовать игру».
// На главной — плашка «Новое: игра», пока человек не начал играть (или не скрыл её)
const NEWS_VERSION = '2026-11-game';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* память недоступна */ } };

function newsSheet() {
  lsSet('bt.news', NEWS_VERSION);
  openSheet(`<div class="news"><p class="eyebrow">Обновление</p><h2>Что нового в «Батончике»</h2>
    <ul class="news-list">
      <li><span aria-hidden="true">🏆</span><p><b>Игра «Разминка дня».</b> Каждый день 5 вопросов на пару минут — у вас двоих одинаковые. Очки, серия, рейтинг недели и кубки.</p></li>
      <li><span aria-hidden="true">🧭</span><p><b>Практика.</b> Наши советы и заметки из каналов теперь вместе, по темам.</p></li>
      <li><span aria-hidden="true">🧩</span><p><b>Разбор ситуаций</b> и 9 новых статей в Библиотеке.</p></li>
      <li><span aria-hidden="true">🚑</span><p><b>«Срочно».</b> Что делать, если собака потерялась: чип, фото, объявление.</p></li>
      <li><span aria-hidden="true">🔔</span><p><b>Напоминание о разминке</b> в 20:00 — включается в «Настройках» → «Уведомления».</p></li>
    </ul>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Позже</button><a class="btn primary" href="#/game" data-action="sheet-close-link">Попробовать игру</a></div></div>`);
}
// Показываем после входа, на главной, когда ничего другого не открыто
function maybeShowNews() {
  if (S.newsShown || lsGet('bt.news') === NEWS_VERSION) return;
  if (!canWrite() || !S.contentReady || route().page !== 'today' || !sheet.hidden || S.pendingAdd) return;
  S.newsShown = true;
  setTimeout(() => { if (sheet.hidden && route().page === 'today') newsSheet(); else S.newsShown = false; }, 700);
}

function gameInviteHtml() {
  if (!canWrite() || !S.gameLoaded || !S.questions || S.questions.error || lsGet('bt.gameInvite') === 'off') return '';
  const { me, others } = gamePlayers();
  if (Object.keys(me.days || {}).length) return '';
  const rival = others.find((p) => Object.keys(p.days || {}).length);
  const sub = rival ? `${escapeHtml(playerName(rival))} уже играет — 5 вопросов на пару минут` : '5 вопросов на пару минут — кто из вас знает о собаках больше?';
  return `<section class="game-invite"><a class="game-invite-link" href="#/game">${dogAva('🏆')}
      <span class="game-invite-text"><strong>Новое: игра «Разминка дня»</strong><small>${sub}</small></span><span class="chev-sm" aria-hidden="true">›</span></a>
    <button type="button" class="game-invite-x" data-action="game-invite-off" aria-label="Скрыть">×</button></section>`;
}

// ---------- Неделя Батончика ----------

const WEEK_QS = [
  ['joy', 'Было что-то радостное (игра, поиск, новое место, друг)?'],
  ['choice', 'Было что-то, что он выбирал сам (маршрут, игрушку, с кем общаться)?'],
  ['sleep', 'Хватало тихого сна?'],
];
const FIGURE = [['ribs', 'Рёбра прощупываются легко'], ['waist', 'Сверху видна талия']];
// «Здоровье за неделю» (после «Фигуры»): три галочки, найденные клещи, последние обработки
const WEEK_HEALTH = [
  ['coat', 'Уши, лапы и кожа без нового запаха, покраснения и расчёсов'],
  ['stool', 'Стул нормальный всю неделю'],
  ['vigor', 'Ест с аппетитом и бодрый'],
];
// Последняя сделанная обработка из паспорта (kind: ticks, worms) не позже дня day
const lastTreat = (kind, day) => S.health.filter((r) => r.kind === kind && r.done && r.date <= day).map((r) => r.date).sort().pop() || '';
const hasWeekHealth = (w) => WEEK_HEALTH.some(([k]) => w[k]) || !!(w.ticks || w.lastTicks || w.lastWorms);
const isSunday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
const lastSunday = (key) => addDays(key, -new Date(`${key}T00:00:00Z`).getUTCDay());
const weekOf = (day) => S.weeks.find((w) => w.id === day);
const weightOn = (day) => { const g = S.growth.find((x) => x.date === day && x.weight); return g ? g.weight : 0; };

function weekSummaryHtml(w, day) {
  const yes = WEEK_QS.filter(([k]) => w[k]).length;
  const fig = FIGURE.map(([k, label]) => (w[k] ? `${label.toLowerCase()}: ${w[k] === 'yes' ? 'да' : 'нет'}` : '')).filter(Boolean).join(' · ');
  const kg = weightOn(day);
  const short = (d) => dayTitle(d, { day: 'numeric', month: 'long' });
  const health = hasWeekHealth(w) ? [`здоровье: ${WEEK_HEALTH.filter(([k]) => w[k]).length} из 3`, w.ticks && `клещи: ${w.ticks}`,
    w.lastTicks && `от клещей — ${short(w.lastTicks)}`, w.lastWorms && `от глистов — ${short(w.lastWorms)}`].filter(Boolean).join(' · ') : '';
  const alone = 'aloneBest' in w ? [`одиночество: рекорд ${w.aloneBest ? `${AL.fmtDur(w.aloneBest)}${w.aloneStage ? ` (${AL.STAGE_LABEL[w.aloneStage].toLowerCase()})` : ''}` : '—'}`,
    `вынужденных дольше рекорда: ${w.aloneForced || 0}`, `день отдыха: ${w.aloneRest ? 'был' : 'не было'}`].join(' · ') : '';
  return `<p class="week-line"><strong>${yes} из 3</strong> «да» о благополучии${kg ? ` · вес ${fmtNum(kg)} кг` : ''}</p>
    ${fig ? `<p class="muted small">${escapeHtml(cap(fig))}</p>` : ''}${health ? `<p class="muted small">${escapeHtml(cap(health))}</p>` : ''}${alone ? `<p class="muted small">${escapeHtml(cap(alone))}</p>` : ''}${w.notes ? `<p class="week-notes">${inline(w.notes)}</p>` : ''}`;
}

// Карточка на главной — только по воскресеньям и только пока неделя не заполнена; заполненная уходит в историю
function weekCardHtml() {
  if (!isSunday(S.day) || weekOf(S.day)) return '';
  return `<section class="card week-card-sun">
    <div class="card-head"><h2>Неделя Батончика</h2><a class="text-link" href="#/weeks">История ›</a></div>
    <p class="week-invite">Сегодня воскресенье — время подвести неделю.</p>
    <p class="muted">Три вопроса о благополучии, вес, фигура и здоровье — пара минут. Ответы сохранятся с датой, вес попадёт в «Рост и вес».</p>
    ${canWrite() ? `<button class="btn primary wide" data-action="week-edit" data-day="${S.day}">Заполнить</button>` : ''}
  </section>`;
}

// «Одиночество» за неделю: рекорд и вынужденные уходы — из записей «Учимся оставаться дома», день отдыха — галочка
// (заранее отмечена, если по дневнику был день без тренировки)
function weekAlone(day, w) {
  const ws = AL.weekStats(S.alone, addDays(day, -6), S.day);
  return { ...ws, rest: 'aloneRest' in w ? !!w.aloneRest : ws.sessions > 0 && ws.restDay };
}

function weekSheet(day) {
  const w = weekOf(day) || {};
  const kg = weightOn(day);
  const wa = weekAlone(day, w);
  const yn = (k) => `<div class="choices">${[['yes', 'Да'], ['no', 'Нет']].map(([v, l]) => `<label class="choice"><input type="radio" name="${k}" value="${v}"${w[k] === v ? ' checked' : ''}>${l}</label>`).join('')}</div>`;
  openSheet(`<form class="form"><h2>Неделя Батончика</h2><p class="muted">${escapeHtml(cap(dayTitle(day)))}</p>
    <fieldset><legend>Благополучие</legend>${WEEK_QS.map(([k, q]) => `<label class="check-row"><input type="checkbox" name="${k}"${w[k] ? ' checked' : ''}>${q}</label>`).join('')}</fieldset>
    <label>Вес, кг <span class="muted">(попадёт в «Рост и вес»)</span><input name="weight" inputmode="decimal" autocomplete="off" placeholder="Например: 13,3" value="${kg ? fmtNum(kg) : ''}"></label>
    ${FIGURE.map(([k, label]) => `<fieldset><legend>${label}</legend>${yn(k)}</fieldset>`).join('')}
    <fieldset><legend>Здоровье за неделю</legend>${WEEK_HEALTH.map(([k, q]) => `<label class="check-row"><input type="checkbox" name="${k}"${w[k] ? ' checked' : ''}>${q}</label>`).join('')}
      <label>Найденные клещи (дата)<input name="ticks" maxlength="200" autocomplete="off" placeholder="Например: 8 ноября, за ухом" value="${escapeHtml(w.ticks || '')}"></label>
      <label>Последняя обработка от клещей<input type="date" name="lastTicks" value="${escapeHtml(w.lastTicks ?? lastTreat('ticks', day))}"></label>
      <label>Последняя обработка от глистов<input type="date" name="lastWorms" value="${escapeHtml(w.lastWorms ?? lastTreat('worms', day))}"></label>
      <p class="muted small">Даты обработок подставлены из паспорта, если они там есть.</p></fieldset>
    <fieldset class="week-alone"><legend>Одиночество</legend>
      <p>Рекорд недели: <strong>${wa.best ? AL.fmtDur(wa.best) : '—'}</strong>${wa.best ? ` <span class="muted">(${escapeHtml(AL.STAGE_LABEL[wa.bestStage])})</span>` : ''}</p>
      <p>Вынужденных уходов дольше рекорда: <strong>${wa.forcedOver}</strong></p>
      <label class="check-row"><input type="checkbox" name="aloneRest"${wa.rest ? ' checked' : ''}>Был хотя бы один день отдыха от тренировок</label>
      <p class="muted small">Рекорд и вынужденные уходы подставлены из записей <a href="#/alone" data-action="sheet-close-link">«Учимся оставаться дома»</a>.</p></fieldset>
    <label>Заметки <textarea name="notes" rows="3" maxlength="2000" placeholder="Что получилось на этой неделе, что было трудно, что пробуем дальше">${escapeHtml(w.notes || '')}</textarea></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const rec = { joy: fd.get('joy') === 'on', choice: fd.get('choice') === 'on', sleep: fd.get('sleep') === 'on',
      ribs: String(fd.get('ribs') || ''), waist: String(fd.get('waist') || ''), notes: String(fd.get('notes') || '').trim(),
      coat: fd.get('coat') === 'on', stool: fd.get('stool') === 'on', vigor: fd.get('vigor') === 'on', ticks: String(fd.get('ticks') || '').trim().slice(0, 200),
      lastTicks: /^\d{4}-\d{2}-\d{2}$/.test(fd.get('lastTicks') || '') ? fd.get('lastTicks') : '',
      lastWorms: /^\d{4}-\d{2}-\d{2}$/.test(fd.get('lastWorms') || '') ? fd.get('lastWorms') : '',
      aloneBest: wa.best, aloneStage: wa.bestStage, aloneForced: wa.forcedOver, aloneRest: fd.get('aloneRest') === 'on' };
    store.saveWeek(day, rec);
    const weight = parseNum(fd.get('weight'));
    if (weight && weight <= 150 && weight !== kg) {
      const g = S.growth.find((x) => x.date === day);
      store.saveGrowth(g ? g.id : null, { date: day, weight, height: g ? g.height || 0 : 0 });
    }
    toast(route().page === 'weeks' ? 'Неделя записана.' : 'Неделя записана. История недель — в «Весь день», внизу.');
  });
}

function renderWeeks() {
  const back = `<a class="back" href="#/day">${BACK_SVG}День</a>`;
  const list = [...S.weeks].sort((a, b) => (a.id < b.id ? 1 : -1));
  const pts = series(S.growth, 'weight');
  const sun = lastSunday(S.day);
  return `${back}${pageHead({ eyebrow: 'По воскресеньям', title: 'Неделя Батончика', sub: 'Что было радостного, выбирал ли он сам, хватало ли сна — и как меняются вес, фигура и здоровье.' })}
    ${canWrite() ? `<button class="btn${weekOf(sun) ? '' : ' primary'} wide" data-action="week-edit" data-day="${sun}">${weekOf(sun) ? 'Изменить' : 'Заполнить'} за ${dayTitle(sun, { day: 'numeric', month: 'long' })}</button>` : ''}
    ${pts.length ? `<section class="growth-card weeks-weight"><p class="eyebrow">Вес</p>
      <div class="growth-now"><strong>${fmtNum(pts[pts.length - 1].value)}<small>кг</small></strong><span>${escapeHtml(deltaText(pts, 'кг'))}</span></div>
      <figure class="growth-chart">${lineChartSvg(pts, { unit: 'кг' })}</figure></section>` : ''}
    ${list.length ? `<section class="card"><div class="card-head"><h2>Все недели</h2></div><ul class="weeks-list">${list.map((w) => `<li>
      <p class="week-date">${escapeHtml(cap(dayTitle(w.id, { day: 'numeric', month: 'long', year: 'numeric' })))}</p>
      <p class="week-qs">${WEEK_QS.map(([k]) => `<span class="${w[k] ? 'yes' : 'no'}">${w[k] ? '✓' : '—'}</span>`).join('')}</p>
      ${weekSummaryHtml(w, w.id)}
      ${canWrite() ? `<button class="text-link" data-action="week-edit" data-day="${w.id}">Изменить</button>` : ''}</li>`).join('')}</ul></section>`
      : emptyArt('Записей пока нет. Первая карточка появится в воскресенье на главной.', 'paw')}`;
}

// ---------- Учимся оставаться дома (дневник тренировки «Оставаться одному») ----------
// Страница #/alone: сводка, подсказки, график, неделя, записи и выгрузка. Сессия тренировки — #/alone/go, на весь экран.
// Ход сессии (какой повтор, когда ушли, пауза) хранится на этом телефоне: если приложение закрылось, сессия продолжится.
// Повторы сразу записываются в общую базу — второй телефон видит их в реальном времени.

const ALONE_ID = AL.ALONE_CARD.split('/')[1];
const aloneCard = () => findCard('k', ALONE_ID);
const myUid = () => (S.store.user && S.store.user.uid) || 'local';
const isMine = (rec) => rec.uid === myUid();
// Номера отмеченных шагов карточки «Оставаться одному» (1…13)
function aloneDone() {
  const card = aloneCard();
  const done = new Set();
  if (card) card.steps.forEach((key, i) => { if (getMark(stepId('k', card, key))) done.add(i + 1); });
  return done;
}
const aloneStepTitle = (n) => { const c = aloneCard(); const key = c && c.steps[n - 1]; return key ? c.stepTitles[key] : ''; };
const aloneStage = () => { const step = AL.currentStep(aloneDone(), S.alone); return (step && AL.STEP_STAGE[step]) || 'gate'; };
// «Признаки прогресса»: что уже выполнено по дневнику — считаем один раз на набор записей
let hintsCache = { list: null, map: {} };
function aloneHint(text) {
  if (hintsCache.list !== S.alone) hintsCache = { list: S.alone, map: AL.checklistHints(S.alone) };
  return !!hintsCache.map[String(text).replace(/\*\*/g, '').trim()];
}

// ---- Сессия ----
const SESSION_KEY = 'bt.aloneSession';
let sess = (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; } })();
function saveSession() {
  try { if (sess) localStorage.setItem(SESSION_KEY, JSON.stringify(sess)); else localStorage.removeItem(SESSION_KEY); } catch { /* ничего */ }
}
const sessOthers = () => S.alone.filter((r) => !sess || r.id !== sess.id);
const sessActive = () => !!(sess && sess.phase !== 'done' && (sess.at || sess.phase !== 'setup'));
// Запись сессии в базе: создаём при первом повторе, дальше обновляем
function saveSessRecord() {
  if (!sess || !sess.reps.length) return;
  const rec = { type: 'train', stage: sess.stage, food: sess.food, reps: sess.reps, did: [], prep: [], note: sess.note || '', at: new Date(sess.at), day: sess.day };
  if (!sess.id) { sess.id = store.newAloneId(); store.saveAlone(sess.id, rec, { isNew: true }); } else store.saveAlone(sess.id, rec);
  saveSession();
}
function toReady() {
  const sug = AL.suggest(sessOthers(), sess.stage, sess.reps);
  sess.next = null;
  if (sug.done) { sess.phase = 'done'; sess.doneText = sug.done; keepAwake(false); } else { sess.phase = 'ready'; sess.plan = sug.s; sess.sugText = sug.text; }
  saveSession();
}
// Выйти со страницы сессии в дневник, не оставляя её в истории «назад»
function leaveSession() {
  if (prevHash === '#/alone') history.back();
  else { history.replaceState(null, '', '#/alone'); onHashChange(); }
}

// Экран не гаснет, пока идёт сессия (если телефон это умеет): на iPhone веб-приложение засыпает при блокировке
let wakeLock = null;
const canWake = () => 'wakeLock' in navigator;
async function keepAwake(on) {
  try {
    if (on && canWake() && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !sessActive()) return;
  keepAwake(true);
  aloneTick();
  render();
});
// Короткий звук «пора возвращаться». Звук включается нажатием «Ухожу» — без нажатия телефоны его не дают
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}
function beep() {
  try {
    if (audioCtx) {
      const t0 = audioCtx.currentTime;
      [0, 0.35, 0.7].forEach((d) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.25);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + d);
        o.stop(t0 + d + 0.27);
      });
    }
  } catch { /* без звука */ }
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch { /* ничего */ }
}
// Таймеры считают от времени старта, а не «тиканьем»: после блокировки экрана время верное
function aloneTick() {
  if (!sess) return;
  const now = Date.now();
  const onPage = () => { const r = route(); return r.page === 'alone' && r.id === 'go'; };
  if (sess.phase === 'away') {
    const left = sess.plan - (now - sess.awayAt) / 1000;
    if (left <= 0) {
      sess.phase = 'back';
      sess.backSec = null;
      saveSession();
      beep();
      if (!onPage()) toast('Пора возвращаться', { label: 'Открыть', onClick: () => goTo('#/alone/go') });
      render();
      return;
    }
    document.querySelectorAll('[data-left]').forEach((el) => { el.textContent = AL.fmtClock(Math.ceil(left)); });
    document.querySelectorAll('[data-ring]').forEach((el) => { el.style.setProperty('--p', String(Math.round((1 - left / sess.plan) * 100))); });
  } else if (sess.phase === 'pause') {
    const left = AL.PAUSE_SEC - (now - sess.pauseAt) / 1000;
    if (left <= 0) {
      if (isTyping()) return; // дописывают подробности — подождём
      toReady();
      render();
      return;
    }
    document.querySelectorAll('[data-pause-left]').forEach((el) => { el.textContent = AL.fmtClock(Math.ceil(left)); });
  }
}
setInterval(aloneTick, 250);

const reactLine = (reps) => reps.map((x) => `<span class="ss-rep" title="${escapeHtml(AL.REACT[x.r].label)}">${AL.REACT[x.r].icon} ${AL.fmtDur(x.s)}</span>`).join('');

function renderAloneSession() {
  if (!sess) {
    return `<div class="ss"><p class="muted">Сессии сейчас нет.</p><a class="btn wide" href="#/alone">К «Учимся оставаться дома»</a></div>`;
  }
  const n = sess.reps.length;
  const repNo = Math.min(n + (['ready', 'away', 'back'].includes(sess.phase) ? 1 : 0), AL.MAX_REPS);
  const head = `<div class="ss-head"><span><strong>${escapeHtml(AL.STAGE_LABEL[sess.stage])}</strong>${sess.phase !== 'setup' && sess.phase !== 'done' ? ` · Повтор ${repNo} из ${AL.MAX_REPS}` : ''}</span>
    ${sess.phase === 'done' ? '' : '<button class="ss-x" data-action="as-end">Закончить</button>'}</div>`;
  const strip = n ? `<div class="ss-reps">${reactLine(sess.reps)}</div>` : '';
  const wakeNote = canWake() ? '' : '<p class="ss-note">Не блокируйте экран: пока он погашен, таймер и звук не работают.</p>';
  let body = '';
  if (sess.phase === 'setup') {
    const recs = AL.allRecords(S.alone);
    body = `<h1 class="ss-title">Новая сессия</h1>
      <p class="ss-label">Ступень</p>
      <div class="ss-stages">${AL.STAGES.map(([k, label]) => `<button class="ss-stage${sess.stage === k ? ' on' : ''}" data-action="as-stage" data-stage="${k}">
        <strong>${escapeHtml(label)}</strong><span>${recs[k] ? `рекорд ${AL.fmtDur(recs[k])}` : 'рекорда пока нет'}</span></button>`).join('')}</div>
      <p class="ss-label">Еда</p>
      <div class="choices">${Object.entries(AL.FOOD).map(([k, label]) => `<button class="choice${sess.food === k ? ' on' : ''}" data-action="as-food" data-food="${k}" aria-pressed="${sess.food === k}">${escapeHtml(label)}</button>`).join('')}</div>
      <p class="ss-note">Только когда дома никого, кроме тренирующего. Перед сессией — туалет, нюхательная прогулка и 15–20 минут покоя.</p>
      <button class="btn primary ss-go" data-action="as-begin">Начать</button>`;
  } else if (sess.phase === 'ready') {
    body = `<p class="ss-label">Уходим на</p>
      <div class="ss-adj"><button class="ss-pm" data-action="as-adj" data-d="-1" aria-label="Короче">−</button>
        <p class="ss-big">${AL.fmtDur(sess.plan)}</p>
        <button class="ss-pm" data-action="as-adj" data-d="1" aria-label="Дольше">+</button></div>
      ${sess.sugText ? `<p class="ss-why">${escapeHtml(sess.sugText)}</p>` : ''}
      ${strip}
      <button class="btn primary ss-go" data-action="as-go">Ухожу</button>
      ${wakeNote}`;
  } else if (sess.phase === 'away') {
    const left = Math.max(0, sess.plan - (Date.now() - sess.awayAt) / 1000);
    body = `<p class="ss-label">До возвращения</p>
      <div class="ss-ring" data-ring style="--p:${Math.round((1 - left / sess.plan) * 100)}"><p class="ss-big" data-left>${AL.fmtClock(Math.ceil(left))}</p></div>
      <p class="ss-why">Уход на ${AL.fmtDur(sess.plan)}. Когда время выйдет, прозвучит сигнал.</p>
      ${wakeNote}
      <button class="btn ss-early" data-action="as-early">Вернулась раньше</button>`;
  } else if (sess.phase === 'back') {
    const early = sess.backSec && sess.backSec < sess.plan;
    body = `<p class="ss-back">${early ? `Вернулись через ${AL.fmtClock(sess.backSec)}` : 'Пора возвращаться'}</p>
      <p class="ss-label">Как он был?</p>
      <div class="ss-react">${Object.entries(AL.REACT).map(([k, x]) => `<button class="ss-r ss-r-${k}" data-action="as-react" data-r="${k}">
        <span class="ss-r-icon" aria-hidden="true">${x.icon}</span><span><strong>${x.label}</strong><small>${escapeHtml(x.hint)}</small></span></button>`).join('')}</div>`;
  } else if (sess.phase === 'pause') {
    const last = sess.reps[n - 1];
    const left = Math.max(0, AL.PAUSE_SEC - (Date.now() - sess.pauseAt) / 1000);
    const details = last.r === 'calm' ? '' : `<div class="ss-details">
      <label>Беспокойство началось через, с <span class="muted">(необязательно)</span><input name="as-onset" inputmode="numeric" autocomplete="off" value="${last.o ?? ''}"></label>
      <p class="ss-label">Успокоился сам</p>
      <div class="choices">${[['yes', 'да'], ['no', 'нет']].map(([k, label]) => `<button class="choice${last.c === k ? ' on' : ''}" data-action="as-self" data-c="${k}" aria-pressed="${last.c === k}">${label}</button>`).join('')}</div></div>`;
    body = `<p class="ss-saved">Записано: ${AL.REACT[last.r].icon} ${AL.fmtDur(last.s)}</p>
      ${strip}
      ${details}
      <p class="ss-label">Пауза</p><p class="ss-big small" data-pause-left>${AL.fmtClock(Math.ceil(left))}</p>
      ${sess.next ? `<p class="ss-why">Дальше: <strong>${AL.fmtDur(sess.next.s)}</strong>. ${escapeHtml(sess.next.text || '')}</p>` : ''}
      <button class="btn primary ss-go" data-action="as-next">Дальше</button>`;
  } else {
    const others = sessOthers();
    const before = AL.stageRecord(others, sess.stage);
    const best = AL.bestCalm({ reps: sess.reps });
    body = `<h1 class="ss-title">Итог сессии</h1>
      ${sess.doneText ? `<p class="ss-done">${escapeHtml(sess.doneText)}</p>` : ''}
      ${n ? `${strip}<p>Повторов: <strong>${n}</strong>${best ? ` · лучший спокойный — <strong>${AL.fmtDur(best)}</strong>` : ''}</p>
      ${best > before ? `<p class="ss-record">Новый рекорд ступени «${escapeHtml(AL.STAGE_LABEL[sess.stage])}»: ${AL.fmtDur(best)}${before ? ` (был ${AL.fmtDur(before)})` : ''}</p>` : `<p class="muted">Рекорд ступени — ${before ? AL.fmtDur(before) : 'пока нет'}.</p>`}
      <label class="ss-note-field">Заметка <span class="muted">(необязательно)</span><textarea name="as-note" rows="3" maxlength="2000" placeholder="Что заметили: звуки в подъезде, как встретил, что поменять">${escapeHtml(sess.note || '')}</textarea></label>` : '<p class="muted">Повторов не было — запись не сохранена.</p>'}
      <button class="btn primary ss-go" data-action="as-finish">Готово</button>`;
  }
  return `<div class="ss ss-phase-${sess.phase}">${head}${body}</div>`;
}

// ---- Страница дневника ----
function aloneRowHtml(r) {
  const when = `${dayTitle(r.day, { day: 'numeric', month: 'short' }).replace('.', '')}, ${fmtTime(r.at)}`;
  const what = r.type === 'forced' ? AL.TYPES.forced.label : `${AL.TYPES[r.type].label} · ${AL.STAGE_LABEL[r.stage]}`;
  const best = AL.bestCalm(r);
  const tail = r.type === 'train' ? (best ? `лучший спокойный ${AL.fmtDur(best)}` : 'спокойных не было') : AL.fmtDur(AL.recDuration(r));
  return `<li><button class="alone-row" data-action="alone-open" data-id="${escapeHtml(r.id)}">
    <span class="ar-icon" aria-hidden="true">${AL.TYPES[r.type].icon}</span>
    <span class="ar-main"><strong>${escapeHtml(what)}</strong>
      <span class="ar-reps">${r.reps.map((x) => AL.REACT[x.r].icon).join('')} · ${escapeHtml(tail)}</span>
      <span class="ar-by">${escapeHtml(when)}${r.name ? ` · ${escapeHtml(r.name)}` : ''}${r.note ? ' · 📝' : ''}</span></span></button></li>`;
}

function renderAlone() {
  if (prevHash && !prevHash.startsWith('#/alone')) S.aloneFrom = prevHash;
  const fromTitle = S.aloneFrom === `#/${AL.ALONE_CARD}` ? 'Оставаться одному' : S.aloneFrom && pageTitle(S.aloneFrom);
  const back = `<a class="back" href="${fromTitle ? S.aloneFrom : '#/k'}">${BACK_SVG}${escapeHtml(fromTitle || 'Тренировки')}</a>`;
  const recs = S.alone;
  const done = aloneDone();
  const step = AL.currentStep(done, recs);
  const stage = (step && AL.STEP_STAGE[step]) || 'front';
  const records = AL.allRecords(recs);
  const can = canWrite();

  const active = sessActive() ? `<a class="banner alone-live" href="#/alone/go">Сессия идёт: ${escapeHtml(AL.STAGE_LABEL[sess.stage])}${sess.reps.length ? `, повторов ${sess.reps.length}` : ''} — вернуться ›</a>` : '';
  const now = step ? `<p class="alone-now"><span class="muted">Сейчас</span><strong>Шаг ${step} · ${escapeHtml(aloneStepTitle(step) || '')}</strong>
      <span class="muted">Ступень: ${escapeHtml(AL.STAGE_LABEL[stage])}</span></p>`
    : '<p class="alone-now"><strong>Все шаги карточки отмечены 🎉</strong><span class="muted">Поддерживайте: 2–3 раза в неделю короткие будничные уходы.</span></p>';
  const tiles = `<div class="alone-recs">${AL.STAGES.map(([k, label]) => `<div class="alone-rec${k === stage && step ? ' on' : ''}">
      <span>${escapeHtml(label)}</span><strong>${records[k] ? AL.fmtDur(records[k]) : '—'}</strong></div>`).join('')}</div>`;

  // Подсказки
  const hints = [];
  if (!recs.length) hints.push('<p class="hint-box">Начните с проверок на камеру (шаги 1–2 карточки): кнопка «Проверка» ниже. По ним дневник подскажет, с какого шага начинать.</p>');
  const roomCalm = AL.roomCheckCalm(recs);
  if (roomCalm !== null && !done.has(4) && !done.has(6) && (!step || step <= 6)) {
    hints.push(`<p class="hint-box">${roomCalm ? 'Проверка в комнате прошла спокойно — начинайте с <b>шага 6</b> карточки, шаги 4–5 можно пропустить.' : 'В проверке в комнате он беспокоился — начинайте с <b>шага 4</b> карточки: комната за воротами.'}</p>`);
  }
  if (step && AL.stepMet(step, recs)) {
    hints.push(`<div class="hint-box alone-go"><p><b>Можно переходить к следующему шагу.</b> Условие шага ${step} «${escapeHtml(aloneStepTitle(step))}» выполнено.</p>
      ${can ? `<button class="btn small" data-action="alone-step" data-n="${step}">Отметить шаг ${step} в карточке</button>` : ''}</div>`);
  }
  const stuck = step ? AL.stuckOn(recs, stage) : null;
  if (stuck) {
    hints.push(`<div class="hint-box warn alone-stuck"><p><b>Похоже, застряли.</b> ${stuck === 'red' ? 'Три сессии подряд был голос.' : 'За 21 день рекорд на этой ступени не вырос.'} Вернитесь на ступень ниже. Если не помогает — консультация специалиста.</p>
      <a href="#/${AL.ALONE_CARD}/vazhno">Что важно знать ›</a></div>`);
  }

  const actions = can ? `<div class="alone-actions">
      <button class="btn primary wide alone-start" data-action="alone-start">${sessActive() ? 'Вернуться к сессии' : 'Начать сессию'}</button>
      <div class="alone-two"><button class="btn" data-action="alone-new" data-type="check">📹 Проверка</button><button class="btn" data-action="alone-new" data-type="forced">🚪 Вынужденный уход</button></div>
    </div>` : '';

  // График
  const chartStage = S.aloneUi.chart || stage;
  const pts = AL.dailyBest(recs, chartStage);
  const reds = AL.forcedRed(recs);
  const chart = `<section class="card alone-chart-card"><div class="card-head"><h2>Спокойно — дольше всего за день</h2></div>
    <div class="segmented alone-seg">${AL.STAGES.map(([k]) => `<button class="seg${k === chartStage ? ' on' : ''}" data-action="alone-chart" data-stage="${k}" aria-pressed="${k === chartStage}">${escapeHtml(AL.STAGE_SHORT[k])}</button>`).join('')}</div>
    ${pts.length || reds.length ? `<figure class="growth-chart">${AL.aloneChartSvg(pts, reds)}</figure>
      <p class="alone-legend"><span class="lg-line" aria-hidden="true"></span>тренировки: лучшая спокойная длительность${reds.length ? ' <span class="lg-red" aria-hidden="true"></span>вынужденный уход с голосом' : ''}</p>
      <p class="muted small">Шкала растянута для коротких уходов: на одном графике видны и секунды, и часы. Нажмите на точку — появится значение.</p>`
      : `<p class="muted">Здесь появится график, когда будут тренировки на ступени «${escapeHtml(AL.STAGE_LABEL[chartStage])}».</p>`}
  </section>`;

  const ws = AL.weekStats(recs, mondayOf(S.day), S.day);
  const week = `<section class="card"><div class="card-head"><h2>Эта неделя</h2><span class="muted small">с понедельника</span></div>
    <div class="alone-week">
      <div><span>Сессий</span><strong>${ws.sessions}</strong></div>
      <div><span>Рекорд недели</span><strong>${ws.best ? AL.fmtDur(ws.best) : '—'}</strong>${ws.best ? `<small>${escapeHtml(AL.STAGE_LABEL[ws.bestStage])}</small>` : ''}</div>
      <div><span>Вынужденных дольше рекорда</span><strong>${ws.forcedOver}</strong></div>
    </div></section>`;

  const sorted = [...recs].sort((a, b) => b.at - a.at);
  const shown = S.aloneUi.more ? sorted : sorted.slice(0, 15);
  const list = sorted.length ? `<section class="card"><div class="card-head"><h2>Записи</h2>${can ? '<button class="text-link" data-action="alone-export">Выгрузить</button>' : ''}</div>
    <ul class="alone-list">${shown.map(aloneRowHtml).join('')}</ul>
    ${sorted.length > shown.length ? `<button class="btn small wide" data-action="alone-more">Показать ещё ${sorted.length - shown.length}</button>` : ''}
    <p class="muted small">Свою запись можно открыть, исправить или удалить. Выгрузка — файл CSV для специалиста: одна строка — один повтор.</p></section>` : '';

  // «Как заниматься» — раздел «# Одиночество» из rasporyadok.md
  const howSec = ((S.today && S.today.sections) || []).find((g) => g.title === ALONE_SECTION);
  const how = howSec && howSec.items.length ? `<details class="intro alone-how"><summary>Как заниматься</summary>
      ${howSec.items.map((it) => `<div class="item-body">${scheduleItemHtml(it)}</div>`).join('')}</details>` : '';
  return `${back}${pageHead({ eyebrow: 'Одиночество', title: 'Учимся оставаться дома', sub: 'Подсказывает, на сколько уходить, и хранит проверки, сессии и вынужденные уходы. Видно обоим.' })}
    ${statusBanner()}${active}
    ${how}
    ${linkCard(`#/${AL.ALONE_CARD}`, '🐾', 'Тренировка «Оставаться одному»', escapeHtml(step ? `13 шагов · сейчас шаг ${step}` : '13 шагов'), 'alone-card-link')}
    <section class="card alone-sum">${now}${tiles}</section>
    ${hints.join('')}
    ${actions}
    ${chart}
    ${week}
    ${list}`;
}

// ---- Формы: проверка, вынужденный уход, правка записи ----
const radioChoices = (name, map, val) => `<div class="choices">${Object.entries(map).map(([k, label]) => `<label class="choice"><input type="radio" name="${name}" value="${k}"${val === k ? ' checked' : ''}>${escapeHtml(label)}</label>`).join('')}</div>`;
const checkChoices = (name, map, vals) => `<div class="choices">${Object.entries(map).map(([k, label]) => `<label class="choice"><input type="checkbox" name="${name}" value="${k}"${vals.includes(k) ? ' checked' : ''}>${escapeHtml(label)}</label>`).join('')}</div>`;
// Длительность — тремя полями: ч, мин, с (у повторов — мин и с)
function durFields(name, sec, hours = true) {
  const h = hours ? Math.floor(sec / 3600) : 0;
  const m = Math.floor((sec - h * 3600) / 60);
  const ss = sec % 60;
  const f = (k, v, label) => `<label><input name="${name}_${k}" inputmode="numeric" autocomplete="off" maxlength="3" value="${v || ''}" placeholder="0"><span>${label}</span></label>`;
  return `<div class="dur">${hours ? f('h', h, 'ч') : ''}${f('m', m, 'мин')}${f('s', ss, 'с')}</div>`;
}
const readDur = (fd, name) => {
  const n = (k) => Math.max(0, parseInt(String(fd.get(`${name}_${k}`) || '').replace(/\D/g, ''), 10) || 0);
  return n('h') * 3600 + n('m') * 60 + n('s');
};
const readOnset = (v) => { const t = String(v || '').replace(/\D/g, ''); return t ? parseInt(t, 10) : null; };
const reactRadios = (name, val) => `<div class="react-row">${Object.entries(AL.REACT).map(([k, x]) => `<label class="react-btn react-pick">
  <input type="radio" name="${name}" value="${k}"${val === k ? ' checked' : ''} required><span aria-hidden="true">${x.icon}</span>${x.label}</label>`).join('')}</div>`;
const REACT_HINT = `<p class="muted small">${Object.values(AL.REACT).map((x) => `${x.icon} ${escapeHtml(x.label.toLowerCase())} — ${escapeHtml(x.hint)}`).join('. ')}.</p>`;
const CHECK_STAGES = { gate: 'Комната · ворота', door: 'Комната · дверь', front: 'Подъезд (входная дверь)' };

function aloneRecordText(r) {
  const rows = r.reps.map((x, i) => `<li>${r.type === 'train' ? `${i + 1}. ` : ''}${AL.REACT[x.r].icon} ${AL.fmtDur(x.s)}${x.o != null ? ` · беспокойство через ${x.o} с` : ''}${x.c && x.c !== 'na' ? ` · успокоился сам: ${AL.SELF[x.c]}` : ''}</li>`).join('');
  return `<ul class="react-hist">${rows}</ul>
    <p class="muted">Еда: ${escapeHtml(AL.FOOD[r.food])}${r.did.length ? ` · перед беспокойством: ${escapeHtml(r.did.map((k) => AL.DID[k]).join(', '))}` : ''}${r.prep.length ? ` · было: ${escapeHtml(r.prep.map((k) => AL.PREP[k]).join(', '))}` : ''}</p>
    ${r.note ? `<p>${inline(r.note)}</p>` : ''}`;
}

function aloneSheet(type, id) {
  const rec = id ? S.alone.find((r) => r.id === id) : null;
  if (id && !rec) return;
  const t = rec ? rec.type : type;
  const title = `${AL.TYPES[t].icon} ${AL.TYPES[t].label}`;
  if (rec && (!isMine(rec) || !canWrite())) {
    openSheet(`<div class="form"><h2>${title}</h2><p class="muted">${escapeHtml(cap(dayTitle(rec.day)))}, ${fmtTime(rec.at)}${rec.type !== 'forced' ? ` · ${escapeHtml(AL.STAGE_LABEL[rec.stage])}` : ''}</p>
      ${aloneRecordText(rec)}
      <p class="muted small">Записал(а) ${escapeHtml(rec.name || 'другой человек')}. Исправить или удалить запись может только автор.</p>
      <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button></div></div>`, null);
    return;
  }
  const at = rec ? rec.at : new Date();
  const day = rec ? rec.day : dayKey(at);
  const time = fmtTime(at);
  const food = rec ? rec.food : 'none';
  const note = rec ? rec.note : '';
  const head = `<h2>${title}</h2>
    <div class="date-time"><label>Дата<input type="date" name="day" value="${day}" required></label><label>Время<input type="time" name="time" value="${time}" required></label></div>`;
  const tail = `<label>Заметка<textarea name="note" rows="3" maxlength="2000" placeholder="Что заметили на камере, что было вокруг">${escapeHtml(note)}</textarea></label>
    ${rec ? `<button type="button" class="btn small danger" data-action="alone-del" data-id="${escapeHtml(rec.id)}">Удалить запись</button>` : ''}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>`;
  let body;
  if (t === 'train') {
    body = `<fieldset><legend>Ступень</legend>${radioChoices('stage', AL.STAGE_LABEL, rec.stage)}</fieldset>
      <fieldset><legend>Еда</legend>${radioChoices('food', AL.FOOD, food)}</fieldset>
      <fieldset><legend>Повторы</legend><div class="rep-edits">${rec.reps.map((x, i) => `<div class="rep-edit">
        <p class="rep-n">Повтор ${i + 1}</p>
        ${durFields(`d${i}`, x.s, x.s >= 3600)}
        <label>Реакция<select name="r${i}">${Object.entries(AL.REACT).map(([k, y]) => `<option value="${k}"${x.r === k ? ' selected' : ''}>${y.icon} ${y.label}</option>`).join('')}</select></label>
        <div class="rep-more"><label>Беспокойство через, с<input name="o${i}" inputmode="numeric" autocomplete="off" value="${x.o ?? ''}"></label>
        <label>Успокоился сам<select name="c${i}"><option value="">—</option>${Object.entries(AL.SELF).map(([k, label]) => `<option value="${k}"${x.c === k ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>
        <label class="check-row"><input type="checkbox" name="x${i}">Удалить этот повтор</label></div>`).join('')}</div></fieldset>`;
  } else {
    const x = rec ? rec.reps[0] : { s: t === 'check' ? 120 : 3600, r: '', o: null, c: '' };
    body = `${t === 'check' ? `<fieldset><legend>Где</legend>${radioChoices('stage', CHECK_STAGES, rec ? rec.stage : 'gate')}</fieldset>` : ''}
      <fieldset><legend>${t === 'check' ? 'Сколько был один' : 'Сколько вас не было'}</legend>${durFields('dur', x.s)}</fieldset>
      <fieldset><legend>Реакция</legend>${reactRadios('r', x.r)}${REACT_HINT}</fieldset>
      <label>Беспокойство началось через, с <span class="muted">(необязательно)</span><input name="onset" inputmode="numeric" autocomplete="off" value="${x.o ?? ''}"></label>
      <fieldset><legend>Успокоился сам</legend>${radioChoices('c', AL.SELF, x.c)}</fieldset>
      <fieldset><legend>Еда</legend>${radioChoices('food', AL.FOOD, food)}</fieldset>
      ${t === 'check' ? `<fieldset><legend>Что делал перед беспокойством</legend>${checkChoices('did', AL.DID, rec ? rec.did : [])}</fieldset>` : ''}
      ${t === 'forced' ? `<fieldset><legend>Что было</legend>${checkChoices('prep', AL.PREP, rec ? rec.prep : [])}</fieldset>` : ''}`;
  }
  openSheet(`<form class="form alone-form">${head}${body}${tail}</form>`, (fd) => {
    const d = String(fd.get('day') || '');
    const hm = String(fd.get('time') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !TIME_RE.test(hm)) { toast('Укажите дату и время.'); return false; }
    let reps;
    if (t === 'train') {
      reps = rec.reps.map((x, i) => (fd.get(`x${i}`) === 'on' ? null : AL.cleanRep({ s: readDur(fd, `d${i}`), r: fd.get(`r${i}`), o: readOnset(fd.get(`o${i}`)), c: fd.get(`c${i}`) || '' }))).filter(Boolean);
      if (!reps.length) { toast('Оставьте хотя бы один повтор — или удалите всю запись.'); return false; }
    } else {
      const s = readDur(fd, 'dur');
      if (!s) { toast('Укажите, сколько он был один.'); return false; }
      const rep = AL.cleanRep({ s, r: fd.get('r'), o: readOnset(fd.get('onset')), c: fd.get('c') || '' });
      if (!rep) { toast('Выберите реакцию.'); return false; }
      reps = [rep];
    }
    const out = {
      type: t, stage: t === 'forced' ? 'front' : String(fd.get('stage') || (rec && rec.stage) || 'gate'), food: String(fd.get('food') || 'none'), reps,
      did: t === 'check' ? fd.getAll('did').map(String) : [], prep: t === 'forced' ? fd.getAll('prep').map(String) : [],
      note: String(fd.get('note') || '').trim().slice(0, 2000), at: moscowDate(d, hm), day: d,
    };
    if (rec) store.saveAlone(rec.id, out);
    else store.saveAlone(store.newAloneId(), out, { isNew: true });
    toast(rec ? 'Запись исправлена.' : `${AL.TYPES[t].label}: записано.`);
    return true;
  });
}

// Выгрузка CSV за период: на телефоне — через «Поделиться», на компьютере — скачать файл
function aloneExportSheet() {
  const to = dayKey();
  const first = S.alone.length ? S.alone[0].day : to;
  openSheet(`<form class="form"><h2>Выгрузить записи</h2>
    <p class="muted">Файл CSV: одна строка — один повтор, с датой, ступенью, реакцией и заметками. Открывается в Excel, Numbers и Google Таблицах.</p>
    <fieldset><legend>За какой срок</legend>${radioChoices('period', { 7: '7 дней', 30: '30 дней', all: 'всё время', custom: 'выбрать даты' }, '30')}</fieldset>
    <div class="date-time"><label>С<input type="date" name="from" value="${addDays(to, -29)}"></label><label>По<input type="date" name="to" value="${to}"></label></div>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Выгрузить</button></div></form>`, (fd) => {
    const p = String(fd.get('period'));
    let from = p === 'all' ? first : p === 'custom' ? String(fd.get('from') || first) : addDays(to, -(Number(p) - 1));
    let till = p === 'custom' ? String(fd.get('to') || to) : to;
    if (from > till) [from, till] = [till, from];
    const n = S.alone.filter((r) => r.day >= from && r.day <= till).length;
    if (!n) { toast('За этот срок записей нет.'); return false; }
    shareCsv(AL.toCsv(S.alone, from, till), `ostavatsya-doma_${from}_${till}.csv`);
    return true;
  });
}
async function shareCsv(csv, name) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  try {
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: 'Учимся оставаться дома' });
      return;
    }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Подробности последнего повтора в паузе: «беспокойство через … с» пишется сразу, в базу — когда поле отпустили
view.addEventListener('input', (e) => {
  if (!e.target.matches('[name="as-onset"]') || !sess || !sess.reps.length) return;
  sess.reps[sess.reps.length - 1].o = readOnset(e.target.value);
  saveSession();
});
view.addEventListener('change', (e) => {
  if (e.target.matches('[name="as-onset"]') && sess) saveSessRecord();
  if (e.target.matches('[name="as-note"]') && sess) { sess.note = e.target.value.trim().slice(0, 2000); saveSession(); }
});

// ---------- Библиотека ----------

const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

// Подпись под рубрикой: сколько прочитано, текущий этап, лучший результат
function rubricNote(key) {
  const lib = S.lib;
  const r = RUBRICS.find((x) => x.key === key);
  if (r.read) { const c = readCount(lib, key, S.reads.items); return c.done ? `прочитано ${c.done} из ${c.total}` : `${c.total} ${key === 'a' ? plural(c.total, 'статья', 'статьи', 'статей') : key === 'qa' ? plural(c.total, 'вопрос', 'вопроса', 'вопросов') : key === 'cases' ? plural(c.total, 'разбор', 'разбора', 'разборов') : key === 'health' ? plural(c.total, 'карточка', 'карточки', 'карточек') : plural(c.total, 'миф', 'мифа', 'мифов')}`; }
  if (key === 'ages') { const m = ageMonths(S.pet && S.pet.birth, S.day); const now = m != null && lib.ages.find((s) => s.range && m >= s.range.from && m < s.range.to); return now ? `сейчас: ${now.label}` : r.sub; }
  if (key === 'dict') return `${lib.dict.length} ${plural(lib.dict.length, 'термин', 'термина', 'терминов')}`;
  return r.sub;
}

// Красная кнопка в шапке «Советов»: «Срочно» в одно касание — к ветеринару и если собака потерялась
const urgentBtn = () => `<a class="urgent-btn" href="#/lib/vet"><span aria-hidden="true">🚑</span><span><strong>Срочно</strong><small>к ветеринару и если собака потерялась</small></span><span aria-hidden="true">›</span></a>`;

function renderLibrary(r) {
  if (!S.lib) return tipsPage('lib', '<p class="muted">Загружаем…</p>');
  if (S.lib.error) return tipsPage('lib', '<div class="banner warn">Не удалось загрузить Библиотеку. Проверьте интернет.</div>');
  const rubric = RUBRICS.find((x) => x.key === r.id && !x.href);
  if (!rubric) {
    const feature = RUBRICS.filter((x) => x.feature).map((x) => `<a class="lib-feature" href="#/lib/${x.key}"><span aria-hidden="true">${x.icon}</span>
      <span><strong>${x.title}</strong><small>${escapeHtml(x.sub)} · ${escapeHtml(rubricNote(x.key))}</small></span><span aria-hidden="true">›</span></a>`).join('');
    const tiles = RUBRICS.filter((x) => !x.urgent && !x.feature).map((x) => `<a class="lib-tile" href="${x.href || `#/lib/${x.key}`}"><span class="lib-icon" aria-hidden="true">${x.icon}</span>
      <strong>${x.title}</strong><span>${escapeHtml(rubricNote(x.key))}</span></a>`).join('');
    return tipsPage('lib', `<div class="prose lib-intro">${introHtml(S.lib)}</div>${feature}<div class="lib-grid">${tiles}</div>`);
  }
  if (rubric.key === 'a' && r.sub) return renderArticle(r.sub);
  if (rubric.key === 'health' && r.sub) return renderHealthCard(r.sub);
  if (rubric.key === 'vet') return renderVet();
  const can = canWrite();
  const back = searchBack(`<a class="back" href="#/lib">${BACK_SVG}Библиотека</a>`);
  const top = `${back}<div class="page-head"><div class="page-head-text"><p class="eyebrow">Библиотека</p><h1>${rubric.title}</h1>
    <p class="page-sub">${escapeHtml(rubricNote(rubric.key))}${rubric.read && can ? ' · кружок справа — «прочитано»' : ''}</p></div></div>`;
  let body = '';
  if (rubric.key === 'a') {
    body = `<ul class="lib-list">${S.lib.a.map((c) => {
      const on = !!S.reads.items[readKey('a', c.id)];
      return `<li class="lib-row${on ? ' read' : ''}"><a class="lib-link" href="#/lib/a/${c.id}"><strong>${inline(c.title)}</strong>
        <span class="lib-chips">${metaChips(c)}</span></a>${readBtn('a', c.id, on, can)}</li>`;
    }).join('')}</ul>`;
  } else if (rubric.key === 'health') {
    body = `${S.lib.healthIntro.length ? `<div class="prose lib-intro">${renderBlocks(S.lib.healthIntro)}</div>` : ''}
      <ul class="lib-list">${S.lib.health.map((c) => {
      const on = !!S.reads.items[readKey('health', c.id)];
      return `<li class="lib-row${on ? ' read' : ''}"><a class="lib-link" href="#/lib/health/${c.id}"><strong>${inline(c.title)}</strong>
        <span class="lib-chips">${metaChips(c)}</span></a>${readBtn('health', c.id, on, can)}</li>`;
    }).join('')}</ul>`;
  } else if (rubric.key === 'qa' || rubric.key === 'myths') body = foldList(S.lib, rubric.key, S.reads.items, can, r.sub);
  else if (rubric.key === 'cases') body = casesHtml(S.lib, S.reads.items, can, r.sub);
  else if (rubric.key === 'ages') {
    const m = ageMonths(S.pet && S.pet.birth, S.day);
    body = `${m != null ? `<p class="muted">${escapeHtml(DOG())} сейчас ${ageText(S.pet.birth, S.day)}. Текущий этап открыт и отмечен.</p>` : ''}${agesHtml(S.lib, m, r.sub)}`;
  } else if (rubric.key === 'body') {
    // У каждого подраздела шпаргалки — свой адрес (#/lib/body/карточка-номер), чтобы поиск вёл прямо к нему
    body = S.lib.body.map((c) => { let k = 0; return `<div class="prose lib-sheet">${articleBody(c).replace(/<h3>/g, () => `<h3 id="lib-body-${c.id}-${++k}">`)}</div>`; }).join('');
  }
  else if (rubric.key === 'dict') body = dictHtml(S.lib);
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

// Чип для карточки «Собака потерялась»: номер — из паспорта, база — рядом с телефонами клиники (pet/vet)
function chipHtml() {
  const chip = (S.pet && S.pet.chip) || '';
  const base = (S.vet && S.vet.chipBase) || '';
  return `<section class="vet-contacts lost-head">
    <div class="vet-contact"><p class="eyebrow">Номер чипа</p>${chip ? `<strong class="chip-num">${escapeHtml(chip)}</strong>` : '<span class="muted">Не указан</span>'}</div>
    <div class="vet-contact"><p class="eyebrow">База, где он зарегистрирован</p>${base ? `<strong>${escapeHtml(base)}</strong>` : '<span class="muted">Не указана. Проверьте, что в базе ваш актуальный телефон.</span>'}</div>
    <div class="lost-actions"><a class="btn primary" href="#/pass/months">📷 Открыть фото Батончика</a><a class="btn" href="#/pass/lost">🔎 Объявление «Если потерялся»</a></div>
    ${canWrite() ? '<button class="text-link vet-edit" data-action="chip-edit">Изменить</button>' : ''}</section>`;
}

function chipSheet() {
  const chip = (S.pet && S.pet.chip) || '';
  const base = (S.vet && S.vet.chipBase) || '';
  openSheet(`<form class="form"><h2>🔎 Чип</h2>
    <label>Номер чипа<input name="chip" maxlength="40" inputmode="numeric" value="${escapeHtml(chip)}"></label>
    <label>База, где он зарегистрирован<input name="chipBase" maxlength="120" placeholder="Название базы или сайт" value="${escapeHtml(base)}"></label>
    <p class="muted small">Чип — это номер, а не GPS: он помогает, только если в базе ваш актуальный телефон.</p>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const newChip = String(fd.get('chip') || '').trim();
    const newBase = String(fd.get('chipBase') || '').trim();
    if (newChip !== chip) store.savePet({ ...(S.pet || {}), chip: newChip });
    if (newBase !== base) store.saveVet({ ...(S.vet || {}), chipBase: newBase });
    toast('Сохранено.');
  });
}

// «Срочно»: к ветеринару (телефоны клиники) и если собака потерялась (чип, фото, объявление)
function renderVet() {
  const cards = S.lib.vet;
  const back = searchBack(`<a class="back" href="#/lib">${BACK_SVG}Библиотека</a>`);
  if (!cards.length) return `${back}<p class="empty">Раздел не найден.</p>`;
  const jump = cards.length > 1 ? `<nav class="urgent-jump">${cards.map((c, i) => `<button type="button" class="filter-chip" data-action="jump-to" data-id="lib-vet-${c.id}">${i ? '🔎' : '🚑'} ${escapeHtml(i ? 'Собака потерялась' : 'К ветеринару')}</button>`).join('')}</nav>` : '';
  const sections = cards.map((c, i) => `<section class="urgent-card" id="lib-vet-${c.id}">
      <h2 class="urgent-title">${inline(c.title)}</h2>
      ${i === 0 ? vetContactsHtml() : i === 1 ? chipHtml() : ''}
      <div class="prose article vet-article">${articleBody(c)}</div></section>`).join('');
  return `${back}<p class="eyebrow urgent-eyebrow">Библиотека · срочно</p>
    <h1 class="card-title">Срочно</h1><p class="page-sub">Здоровье и потеря собаки</p>
    ${jump}${sections}`;
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
    store.saveVet({ ...(S.vet || {}), clinicName: g('clinicName'), clinicAddress: g('clinicAddress'), clinicPhone: g('clinicPhone'), vetName: g('vetName'), vetPhone: g('vetPhone') });
    toast('Телефоны сохранены.');
  });
}

function renderArticle(id) {
  const list = S.lib.a;
  const i = list.findIndex((c) => c.id === id);
  const back = searchBack(`<a class="back" href="#/lib/a">${BACK_SVG}Статьи</a>`);
  if (i < 0) return `${back}<p class="empty">Статья не найдена.</p>`;
  const c = list[i];
  const next = list[i + 1];
  return `${back}
    <p class="eyebrow">Статья ${i + 1} из ${list.length}</p>
    <h1 class="card-title">${inline(c.title)}</h1>
    <div class="lib-chips big">${metaChips(c)}</div>
    <div class="prose article">${articleBody(c)}</div>
    ${readToggle(readKey('a', c.id))}
    ${next ? `<a class="next-link" href="#/lib/a/${next.id}"><span class="muted small">Следующая статья</span><strong>${inline(next.title)}</strong></a>` : ''}`;
}

// Карточка рубрики «Здоровье»: метки срочности — цветными плашками, поля «___» — с кнопкой «Заполнить»
function renderHealthCard(id) {
  const list = S.lib.health;
  const i = list.findIndex((c) => c.id === id);
  const back = searchBack(`<a class="back" href="#/lib/health">${BACK_SVG}Здоровье</a>`);
  if (i < 0) return `${back}<p class="empty">Карточка не найдена.</p>`;
  const c = list[i];
  const next = list[i + 1];
  return `${back}
    <p class="eyebrow">Здоровье · ${i + 1} из ${list.length}</p>
    <h1 class="card-title">${inline(c.title)}</h1>
    <div class="lib-chips big">${metaChips(c)}</div>
    <div class="prose article">${healthBody(c, (items, n) => fillBoxHtml(c, items, n))}</div>
    ${readToggle(readKey('health', c.id))}
    ${next ? `<a class="next-link" href="#/lib/health/${next.id}"><span class="muted small">Следующая карточка</span><strong>${inline(next.title)}</strong></a>` : ''}`;
}

const fillDate = (d) => dayTitle(d, { day: 'numeric', month: 'long', year: 'numeric' });

// Большая кнопка «Прочитано» внизу статьи (Библиотека) и в «Практике» (совет — tip_…, заметка — note_…).
// Первая отметка даёт очки в игре — см. READ_POINTS
const isRead = (key) => !!S.reads.items[key];
function readToggle(key, word = 'прочитанной') {
  const on = isRead(key);
  return `<button class="btn wide read-toggle${on ? ' on' : ''}" data-action="lib-read" data-id="${key}"${canWrite() ? '' : ' disabled'}>${on ? '✓ Прочитано' : `Отметить ${word}`}</button>`;
}
const READ_MARK = '<span class="src-mark read">✓ прочитано</span>';
function fillBoxHtml(card, items, n) {
  const rows = items.map((f) => {
    const x = S.fields[f.key];
    return `<li><span class="fill-label">${escapeHtml(f.label)}</span>
      <span class="fill-val">${x ? escapeHtml(`${x.v}${f.unit ? ` ${f.unit}` : ''}`) : '<span class="muted">—</span>'}</span>
      ${x ? `<span class="fill-date">записали ${escapeHtml(fillDate(x.d))}</span>` : ''}</li>`;
  }).join('');
  const any = items.some((f) => S.fields[f.key]);
  return `<div class="fill-box"><ul class="fill-list">${rows}</ul>
    ${canWrite() ? `<button type="button" class="btn small" data-action="fill-edit" data-card="${card.id}" data-n="${n}">${any ? 'Изменить' : 'Заполнить'}</button>` : ''}</div>`;
}

// Последний вес из «Роста и веса» — подсказка для поля «Вес»
const lastWeight = () => { const pts = series(S.growth, 'weight'); return pts.length ? pts[pts.length - 1].value : 0; };

function fillSheet(cardId, n) {
  const card = S.lib && S.lib.health.find((c) => c.id === cardId);
  const block = card && fillBlocks(card)[+n];
  if (!block) return;
  const at = card.blocks.indexOf(block);
  const head = card.blocks.slice(0, at).reverse().find((b) => b.type === 'heading');
  const items = fillItems(block);
  const kg = lastWeight();
  openSheet(`<form class="form"><h2>${escapeHtml(head ? head.text : card.title)}</h2>
    <p class="muted small">Каждое новое значение сохранится с сегодняшней датой. Видно вам обоим.</p>
    ${items.map((f) => {
      const x = S.fields[f.key];
      const val = x ? x.v : (/^вес$/i.test(f.label) && kg ? fmtNum(kg) : '');
      const num = /°C|в минуту|кг/.test(f.unit);
      return `<label>${escapeHtml(f.label)}${f.unit ? ` <span class="muted">(${escapeHtml(f.unit)})</span>` : ''}
        <input name="${f.key}" maxlength="60" autocomplete="off"${num ? ' inputmode="decimal"' : ''} value="${escapeHtml(val)}"></label>`;
    }).join('')}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const next = { ...S.fields };
    let changed = 0;
    items.forEach((f) => {
      const val = String(fd.get(f.key) || '').trim().slice(0, 60);
      const old = S.fields[f.key];
      if (val === (old ? old.v : '')) return;
      changed++;
      if (val) next[f.key] = { v: val, d: S.day }; else delete next[f.key];
    });
    if (changed) store.saveFields(next);
    toast(changed ? 'Сохранено.' : 'Ничего не изменилось.');
  });
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
    : `<a class="back" href="#/t">${arrow}Практика</a>`;
  if (!S.notes) return `${back}<p class="muted">Загружаем…</p>`;
  const n = S.notes.byId && S.notes.byId.get(id);
  if (!n) return `${back}<h1>Не найдено</h1><p class="muted">Возможно, заметку переименовали.</p>`;
  // Чек-лист социализации: каждая строка — пункт «Нового для Батончика», отметка общая на двоих, с датой и реакцией
  const toSocial = checklistMapper();
  const task = (text) => {
    const sid = toSocial(text);
    if (!sid) return `<span class="li-text">${inline(text)}</span>`;
    const st = socialState(S.social[sid]);
    const meta = st.last ? `${REACTIONS[st.last.r].label.toLowerCase()} · ${dayTitle(st.last.d, { day: 'numeric', month: 'long' })}${st.count > 1 ? ` · встреч: ${st.count}` : ''}` : '';
    return `<button type="button" class="check-social${st.last ? ' on' : ''}${st.again ? ' again' : ''}" data-action="social-open" data-id="${sid}"${canWrite() ? '' : ' disabled'}>
      <span class="cs-box" aria-hidden="true">${st.last ? REACTIONS[st.last.r].icon : ''}</span>
      <span class="cs-text">${inline(text)}${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span></button>`;
  };
  const isChecklist = n.text.some((b) => b.type === 'list' && b.items.some((it) => it.task !== null));
  const hint = isChecklist ? `<p class="hint-box checklist-hint">Нажмите на пункт и отметьте, как он отреагировал. Отметка общая на двоих, с датой — та же, что в <a href="#/social">«Новом для ${escapeHtml(DOG() === 'Батончик' ? 'Батончика' : DOG())}»</a>.</p>` : '';
  return noteHtml(n, back, { task }).replace('<section class="blk"><div class="prose">', `${hint}<section class="blk"><div class="prose">`)
    + readToggle(readKey('note', n.id));
}

// Фильтры «Практики» прячут лишнее прямо на странице, без перерисовки
// Сколько внутри темы «Практики»: советы и заметки вместе
const countText = (n) => `${n} ${plural(n, 'материал', 'материала', 'материалов')}`;
function applyNotesFilter() {
  const f = S.notesFilter;
  let shown = 0;
  view.querySelectorAll('[data-tip]').forEach((li) => { li.hidden = !tipShown(f); if (!li.hidden) shown++; });
  view.querySelectorAll('[data-note]').forEach((li) => {
    li.hidden = !noteShown(S.notes && S.notes.byId && S.notes.byId.get(li.dataset.note), f);
    if (!li.hidden) shown++;
  });
  view.querySelectorAll('[data-topic]').forEach((el) => { el.hidden = !el.querySelector('[data-note]:not([hidden])'); });
  view.querySelectorAll('[data-section]').forEach((el) => {
    const n = el.querySelectorAll('[data-note]:not([hidden]), [data-tip]:not([hidden])').length;
    el.hidden = !n;
    const c = el.querySelector('[data-count]');
    if (c) c.textContent = countText(n);
  });
  const count = view.querySelector('.notes-count');
  if (count) count.textContent = practiceCount(shown, +count.dataset.tips, +count.dataset.notes);
  const empty = view.querySelector('.notes-empty');
  if (empty) empty.hidden = shown > 0;
}

view.addEventListener('input', (e) => { if (e.target.matches('.dict-search')) filterDict(e.target); });
view.addEventListener('input', (e) => {
  if (!e.target.matches('.search-input')) return;
  S.searchQ = e.target.value;
  S.searchMore = {};
  applySearch();
});
// «Найти» на клавиатуре — убрать клавиатуру, чтобы были видны результаты
view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.search-input')) e.target.blur(); });

// ---------- Каталоги ----------

function catalogBody(tab, { showTitle = false, fold = false } = {}) {
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
        ${prog}${tab === 'k' ? placesMini(tab, c) : ''}
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></a></li>`;
    }).join('');
    const intro = g.intro.length
      ? (plainText(g.intro).length > 220 || showTitle
        ? `<details class="intro"><summary>Вступление к разделу</summary><div class="prose">${blocksHtml(g.intro, tab, null)}</div></details>`
        : `<div class="prose">${blocksHtml(g.intro, tab, null)}</div>`)
      : '';
    const list = cards ? `<ul class="cards">${cards}</ul>` : (g.intro.length ? '' : emptyArt('Здесь пока пусто.', 'bone'));
    if (fold && g.title) {
      const done = g.cards.filter((c) => { const p = cardProgress(tab, c); return p.mastered || (p.total > 0 && p.done === p.total); }).length;
      const n = g.cards.length;
      const meta = `${n} ${tab === 'g' ? plural(n, 'игра', 'игры', 'игр') : plural(n, 'карточка', 'карточки', 'карточек')}${done ? ` · освоено ${done}` : ''}`;
      return foldHtml(`${tab}:${g.title}`, inline(g.title), meta, `${intro}${list}`, { cls: 'group' });
    }
    return `<section class="group">
      ${g.title && !single ? `<h2>${inline(g.title)}</h2>` : ''}
      ${intro}
      ${list}
    </section>`;
  }).join('');
  return `${errors}${loose}${groups}`;
}

function renderCard(tab, id) {
  // Старая ссылка на переименованную карточку (#/k/odinochestvo) открывает новую
  const card = findCard(tab, id) || findCard(...newRef(`${tab}/${id}`).split('/'));
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
      // Освоенный шаг свёрнут до названия и «Освоено · кто · когда»
      const opts = b.kind === 'steps' || b.kind === 'how'
        ? {
          step: (item) => markButton(stepId(tab, card, stepKeyFor(item.text))),
          stepDone: (item) => { const m = getMark(stepId(tab, card, stepKeyFor(item.text))); return m ? `Освоено · ${byLine(m, true)}` : ''; },
        } : {};
      const old = b.kind === 'steps' ? oldStepsHtml(tab, card) : '';
      const anchor = b.kind === 'important' ? ' id="blk-vazhno"' : b.kind === 'steps' ? ' id="blk-shagi"' : '';
      // «Зачем и что значит» и «Понадобится» читают один раз — они свёрнуты, чтобы шаги были ближе.
      // Навык освоен («Итог» отмечен) — свёрнуты и шаги: на виду «Как поддерживать»
      const masteredSteps = (b.kind === 'steps' || b.kind === 'how') && cardProgress(tab, card).mastered;
      if (b.kind === 'why' || b.kind === 'need' || masteredSteps) {
        return `<details class="blk blk-${b.kind} blk-fold"${anchor}><summary><span class="fold-head"><h2>${inline(b.title)}</h2>${masteredSteps ? '<span class="fold-meta">навык освоен</span>' : ''}</span>${FOLD_CHEV}</summary><div class="prose">${blocksHtml(b.content, tab, card, opts)}</div>${old}</details>`;
      }
      return `<section class="blk blk-${b.kind}"${anchor}><h2>${inline(b.title)}</h2><div class="prose">${blocksHtml(b.content, tab, card, opts)}</div>${old}</section>`;
    }).join('');
  }, card.title + '\n\n' + card.blocks.map((b) => b.title + '\n' + plainText(b.content)).join('\n\n'));

  const p = cardProgress(tab, card);
  const prog = p.mastered ? '<p class="card-prog ok big">✓ Освоено</p>'
    : (p.total ? `<p class="muted">Освоено шагов: ${p.done} из ${p.total}</p>` : '');
  return `${back}
    <div class="page-head"><h1 class="card-title">${inline(card.name)}</h1>
      ${canWrite() ? `<a class="btn small" href="#/edit/${tab}/${card.id}">Изменить</a>` : ''}</div>
    ${card.subtitle ? `<p class="card-sub big">${inline(card.subtitle)}</p>` : ''}
    ${`${tab}/${card.id}` === AL.ALONE_CARD ? '<a class="btn primary card-diary" href="#/alone">🏠 Учимся оставаться дома</a>' : ''}
    ${tab === 'k' ? `<p class="reps-line">🎯 Повторов в день: <b>${card.reps || MIN_REPS}</b>${canWrite() ? ` <a href="#/edit/k/${card.id}">изменить</a>` : ''}</p>` : ''}
    ${prog}
    ${tab === 'k' ? placesHtml(tab, card) : ''}
    ${card.steps.length || card.hasResult ? statusBanner() : ''}
    ${body}
    ${tab === 't' ? readToggle(readKey('tip', card.id), 'прочитанным') : ''}`;
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
  const [type, tab0, cid0, key] = id.split('_');
  // Карточки, перенесённые из «Советов», и переименованные — подписываем нынешним названием
  const moved = tab0 === MOVED_FROM && !findCard(tab0, cid0) ? 'k' : tab0;
  const [tab, cid] = newRef(`${moved}/${cid0}`).split('/');
  const card = findCard(tab, cid);
  if (!card) return null;
  if (type === 'card') return `${card.name} — вся карточка`;
  if (type === 'step') {
    const old = (OLD_STEPS[`${tab}/${cid}`] || []).find((t) => stepKeyFor(`**${t}**`) === key);
    const title = card.stepTitles[key] || old;
    return title ? `${card.name}: ${title}` : card.name;
  }
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
  pushOverlay('viewer');
  const track = v.querySelector('.viewer-track');
  track.scrollLeft = start * track.clientWidth;
  const n = v.querySelector('.viewer-n');
  if (n) track.addEventListener('scroll', () => { n.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1} / ${list.length}`; }, { passive: true });
  v.addEventListener('click', (e) => { if (e.target.tagName !== 'IMG' && !e.target.closest('.viewer-x')) closeViewer(); });
  swipeDownToClose(v, track);
}
// fromHistory — фото закрыл свайп или кнопка «назад»
function closeViewer(fromHistory) {
  const v = document.querySelector('.viewer');
  if (!v) return;
  v.remove();
  if (!fromHistory) dropOverlaySoon();
}
// Фото смахивается вниз (или вверх), как в «Фото» на iPhone; вбок — листаются фото
function swipeDownToClose(v, track) {
  let x0 = 0, y0 = 0, dy = 0, mode = '';
  v.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { mode = 'skip'; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dy = 0; mode = '';
  }, { passive: true });
  v.addEventListener('touchmove', (e) => {
    if (mode === 'skip' || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - x0;
    dy = e.touches[0].clientY - y0;
    if (!mode && Math.hypot(dx, dy) > 10) mode = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
    if (mode !== 'v') return;
    e.preventDefault();
    track.style.transform = `translateY(${dy}px)`;
    v.style.backgroundColor = `rgba(0, 0, 0, ${Math.max(0.2, 0.94 - Math.abs(dy) / 500)})`;
  }, { passive: false });
  v.addEventListener('touchend', () => {
    if (mode !== 'v') return;
    if (Math.abs(dy) > 90) { closeViewer(); return; }
    track.style.transition = 'transform .2s';
    track.style.transform = '';
    v.style.backgroundColor = '';
    setTimeout(() => { track.style.transition = ''; }, 220);
  });
}

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
    const mn = monthOnDay(day);
    const thumb = mn ? monthThumb(mn) : '';
    const cls = ['cal-cell', day === S.day && 'today', isSpecial(story) && hasStory(story) && 'special', day === S.cal.sel && 'sel', !past && 'future', mn && 'month-photo'].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-action="cal-pick" data-day="${day}" aria-label="${escapeHtml(dayTitle(day))}${mn ? `, фото месяца: ${monthsText(mn)}` : ''}"${day === S.cal.sel ? ' aria-current="date"' : ''}>
      <span class="cal-num"${thumb ? ` style="background-image:url('${thumb}')"` : ''}>${d}</span><span class="cal-marks">${marks}</span></button>`);
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
      ${S.monthDates && Object.keys(S.monthDates).length ? '<span><i class="photo-key"></i>фото месяца</span>' : ''}
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
  const mn = monthOnDay(day);
  const thumb = mn ? monthThumb(mn) : '';
  const monthHtml = mn ? `<div class="day-month">
      <button type="button" class="day-month-img" data-action="month-day-view" data-n="${mn}" aria-label="Открыть фото месяца">${thumb ? `<img src="${thumb}" alt="">` : ''}</button>
      <div><p class="eyebrow">Фото месяца</p><strong>${escapeHtml(DOG())}: ${monthsText(mn)}</strong><a class="text-link" href="#/pass/months">Все месяцы ›</a></div></div>` : '';
  const storyHtml = hasStory(story) ? `<div class="day-story${isSpecial(story) ? ' special' : ''}">
      ${isSpecial(story) ? '<p class="eyebrow">День, который хочется помнить</p>' : ''}
      ${story.title ? `<h3><a class="story-link" href="#/d/${day}">${escapeHtml(story.title)}</a></h3>` : ''}
      ${photosHtml(day)}
      ${story.text ? `<p>${inline(story.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${can ? `<button class="btn small" data-action="story-edit" data-day="${day}">Изменить заметку</button>` : ''}</div>`
    : (!future && can ? `<button class="btn wide" data-action="story-edit" data-day="${day}">Написать о дне</button>` : '');
  return `<section class="card day-sel" id="day-sel">
    <div class="card-head"><h2>${escapeHtml(cap(dayTitle(day)))}</h2>${day === S.day ? '<span class="chip">сегодня</span>' : ''}</div>
    ${future ? '<p class="muted">Этот день ещё впереди.</p>' : ''}
    ${loading ? '<p class="muted">Загружаем…</p>' : ''}
    ${line ? `<p class="day-line">${line}</p>` : ''}
    ${st && !st.list.length && !st.trains && !hasStory(story) && !health.length && !mn ? '<p class="muted">В журнале за этот день записей нет.</p>' : ''}
    ${st ? trainsLine(st, cardName) : ''}
    ${health.length ? `<ul class="health-list">${health.map((r) => healthRowHtml(r, S.day)).join('')}</ul>` : ''}
    ${monthHtml}
    ${storyHtml}
    ${st && st.notes.length ? `<ul class="ev-list notes">${st.notes.map((e) => (e.id === S.cal.hit ? eventRow(e).replace('<li>', '<li class="found">') : eventRow(e))).join('')}</ul>` : ''}
    ${st && st.list.length ? `<details class="intro"><summary>Все записи (${st.list.length})</summary><ul class="ev-list">${st.list.map((e) => eventRow(e)).join('')}</ul></details>` : ''}
  </section>`;
}

// Большая карточка вверху: выбранный в календаре «день, который хочется помнить»,
// иначе заметка о сегодняшнем дне, а если её нет — воспоминание
function memoryPool() {
  const past = Object.keys(S.stories).filter((d) => d < S.day && (S.stories[d].title || S.stories[d].text)).sort();
  const special = past.filter((d) => isSpecial(S.stories[d]));
  return special.length ? special : past;
}
const isMemorable = (day) => !!day && hasStory(S.stories[day]) && isSpecial(S.stories[day]);
function featureDay() {
  if (isMemorable(S.cal.feat)) return S.cal.feat;
  if (hasStory(S.stories[S.day])) return S.day;
  const pool = memoryPool();
  if (!pool.length) return '';
  const seed = Math.floor(Date.parse(`${S.day}T00:00:00Z`) / 86400000) + S.cal.memShift;
  return pool[((seed % pool.length) + pool.length) % pool.length];
}
function featureHtml() {
  const can = canWrite();
  const day = featureDay();
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
  // Есть ли что показать вместо этой записи
  const others = memoryPool().filter((d) => d !== day).length + (day !== S.day && hasStory(S.stories[S.day]) ? 1 : 0);
  // Дата, заголовок и «Открыть день» открывают запись целиком — как страницу дневника
  return `<article class="story-feature">
    <a class="story-date" href="#/d/${day}" aria-label="Открыть запись за ${escapeHtml(dayTitle(day, { day: 'numeric', month: 'long' }))}"><strong>${dd}</strong><span>${MONTHS_SHORT[mm - 1]}</span></a>
    <div class="story-body">
      <p class="eyebrow">${eyebrow}</p>
      ${s.title ? `<h2><a class="story-link" href="#/d/${day}">${escapeHtml(s.title)}</a></h2>` : ''}
      ${photosHtml(day)}
      ${s.text ? `<div class="story-text">${inline(s.text).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="story-actions">
        ${day === S.day ? (can ? `<button class="btn small ghost" data-action="story-edit" data-day="${day}">Изменить</button>` : '')
          : `<a class="btn small ghost" href="#/d/${day}">Открыть день</a>${others ? '<button class="btn small ghost" data-action="memory-next">Другое воспоминание</button>' : ''}`}
      </div>
    </div></article>`;
}

// Страница записи (#/d/ГГГГ-ММ-ДД): открывается из большой карточки по дате или заголовку.
// Дата, заголовок, текст абзацами и фото друг под другом во всю ширину; внизу — соседние записи
const storyParagraphs = (text) => String(text || '').trim().split(/\n\s*\n/)
  .map((p) => `<p>${inline(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
const storyLabel = (s) => s.title || String(s.text || '').trim().split('\n')[0].slice(0, 70) || 'Фото дня';
function storyNeighbors(day) {
  const days = Object.keys(S.stories).filter((d) => hasStory(S.stories[d])).sort();
  const i = days.indexOf(day);
  return { prev: i > 0 ? days[i - 1] : '', next: i >= 0 && i < days.length - 1 ? days[i + 1] : '' };
}
function renderStoryPage(day) {
  const back = `<a class="back" href="#/d">${BACK_SVG}Дневник</a>`;
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return `${back}<p class="empty">Такой записи нет.</p>`;
  if (!canWrite()) return `${back}${statusBanner()}<p class="muted">Дневник появится после входа.</p>`;
  const s = S.stories[day];
  const date = cap(dayTitle(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (!hasStory(s)) {
    return `${back}<h1 class="story-page-title">${escapeHtml(date)}</h1>${emptyArt('Записи об этом дне пока нет.', 'paw')}
      ${day <= S.day ? `<button class="btn primary wide" data-action="story-edit" data-day="${day}">Написать о дне</button>` : ''}`;
  }
  const age = ageText(S.pet && S.pet.birth, day);
  const count = s.photoCount || 0;
  const list = count ? storyPhotosOf(day) : [];
  const photos = list.length
    ? list.map((p, i) => `<button type="button" class="page-photo" data-action="photo-view" data-day="${day}" data-i="${i}" aria-label="Открыть фото ${i + 1} из ${list.length}"><img src="${escapeHtml(p)}" alt=""></button>`).join('')
    : Array.from({ length: count }, () => '<div class="page-photo ph"></div>').join('');
  const { prev, next } = storyNeighbors(day);
  const nav = (d, label) => (d ? `<a class="next-link" href="#/d/${d}"><span class="muted small">${label} · ${escapeHtml(dayTitle(d, { day: 'numeric', month: 'long' }))}</span>
    <strong>${escapeHtml(storyLabel(S.stories[d]))}</strong></a>` : '');
  return `${back}<article class="story-page">
    <header class="story-page-head">
      <p class="eyebrow">${isSpecial(s) ? 'День, который хочется помнить' : day === S.day ? 'Сегодня' : 'Запись в дневнике'}</p>
      <p class="story-page-date">${escapeHtml(date)}${age ? ` · ${escapeHtml(DOG())}: ${escapeHtml(age)}` : ''}</p>
      ${s.title ? `<h1 class="story-page-title">${escapeHtml(s.title)}</h1>` : ''}
    </header>
    ${s.text ? `<div class="story-page-text">${storyParagraphs(s.text)}</div>` : ''}
    ${photos ? `<div class="story-page-photos">${photos}</div>` : ''}
    <button class="btn wide" data-action="story-edit" data-day="${day}">Изменить запись</button>
  </article>
  ${prev || next ? `<nav class="story-page-nav" aria-label="Соседние записи">${nav(prev, 'Раньше')}${nav(next, 'Позже')}</nav>` : ''}`;
}

// Плавно к большой карточке наверху или к выбранному дню под календарём
function scrollDiaryTo(where, smooth = true) {
  const el = where === 'top' ? view.querySelector('.story-feature') : document.getElementById('day-sel');
  if (!el) return;
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: smooth && !calm ? 'smooth' : 'auto' });
}

// Дневник: большая карточка и календарь. Нажатие на число: «день, который хочется помнить» — наверх, в большую
// карточку (и под календарём), остальные дни — под календарём, страница едет к ним
function renderDiary() {
  if (!S.cal.month) S.cal.month = monthOf(S.day);
  const sel = S.cal.sel;
  const head = pageHead({ eyebrow: DOG(), title: 'Дневник', sub: 'Календарь дней и ваши заметки. Нажмите на число, чтобы открыть день.',
    plus: !sel || sel <= S.day ? { action: 'story-edit', label: sel ? 'Написать о выбранном дне' : 'Написать о сегодняшнем дне' } : null });
  if (!canWrite()) return `${head}${statusBanner()}<p class="muted">Дневник появится после входа.</p>`;
  setTimeout(() => loadMonth(S.cal.month), 0);
  if (sel && monthOf(sel) !== S.cal.month) setTimeout(() => loadMonth(monthOf(sel)), 0);
  if (S.cal.jump && sel) {
    S.cal.jump = false;
    setTimeout(() => scrollDiaryTo('day', false), 60);
  }
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
    ${tile(age ? age.n : '', age ? age.unit : '', 'возраст', '#/pass/months')}
    ${tile(height ? fmtNum(height) : '', 'см', 'рост', '#/growth')}
  </div>`;
}

function renderPassport() {
  const pet = S.pet || {};
  const field = (label, value, wide, extra = '') => `<div${wide ? ' class="wide"' : ''}><dt>${label}</dt><dd>${value ? escapeHtml(value) : '—'}</dd>${extra}</div>`;
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
        <dl class="id-grid">${field('Порода', pet.breed, true)}${field('Дата рождения', birth)}${field('Пол', pet.sex)}${field('Чип', pet.chip)}${field('MDR1', pet.mdr1, false, '<a class="id-link" href="#/t/opasnye-lekarstva-pri-mdr1">опасные лекарства ›</a>')}</dl>
        ${idStatsHtml(pet)}
      </div>
      ${!S.pet && canWrite() ? '<button class="btn wide id-fill" data-action="pet-edit">Заполнить паспорт</button>' : ''}
    </section>
    <div class="link-cards">
      ${linkCard('#/pass/months', '📸', 'Как рос', 'фото по месяцам — они же в календаре дневника')}
      ${linkCard('#/pass/summary', '🩺', 'Для ветеринара', 'сводка на одной странице')}
      ${linkCard('#/pass/lost', '📣', 'Если потерялся', 'объявление и что делать', 'alarm')}
    </div>
    <section class="card">
      <div class="card-head"><h2>Напоминания</h2></div>
      ${next.length ? `<ul class="health-list">${next.map((r) => healthRowHtml(r, S.day)).join('')}</ul>`
        : '<p class="muted">Запланированных событий нет. Нажмите «+», чтобы добавить прививку, обработку от клещей, глистогонное или визит к врачу.</p>'}
    </section>
    ${foldHtml('pass:care', `${doodle('bone')}Уход`, careMeta(false), `<ul class="health-list care-list">${careRows(false)}</ul>
      <p class="muted small care-note">«Сегодня» — отметить, что сделали. Нажмите на строку, чтобы выбрать другой день или как часто напоминать.</p>`, { cls: 'pass-fold' })}
    ${foldHtml('pass:clean', `${doodle('bowl')}Чистота`, careMeta(true), `<ul class="health-list care-list">${careRows(true)}</ul>
      <p class="muted small care-note">Миски, игрушки, лежанка и амуниция. Напоминания — как в «Уходе». <a href="#/t/chistota-miski-igrushki-lezhanka">Что мыть и как ›</a></p>`, { cls: 'pass-fold', attrs: ' id="clean"' })}
    ${foldHtml('pass:history', 'История', done.length ? `${done.length} ${plural(done.length, 'запись', 'записи', 'записей')}` : 'пока пусто',
      done.length ? `<ul class="health-list">${done.map((r) => healthRowHtml(r, S.day)).join('')}</ul>`
        : '<p class="muted">Здесь появится всё, что уже сделано: прививки, обработки, таблетки, визиты к врачу.</p>', { cls: 'pass-fold' })}`;
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

// ---------- Ссылка-карточка (паспорт, дневник, тренировки) ----------

// ---------- Свёрнутые разделы ----------
// Длинные списки (группы «Все тренировки и игры», темы «Практики», группы «Нового для Батончика») свёрнуты:
// видно название и сколько внутри. Что раскрыто — запоминается на этом телефоне, чтобы после карточки вернуться к тому же
const FOLD_KEY = 'bt.open';
const openFolds = new Set((() => { try { return JSON.parse(lsGet(FOLD_KEY) || '[]'); } catch { return []; } })());
view.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches || !d.matches('details[data-fold]')) return;
  if (d.open) openFolds.add(d.dataset.fold); else openFolds.delete(d.dataset.fold);
  lsSet(FOLD_KEY, JSON.stringify([...openFolds]));
}, true);
const FOLD_CHEV = '<svg class="fold-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
function foldHtml(key, title, meta, body, { cls = '', attrs = '', open = false } = {}) {
  return `<details class="fold${cls ? ` ${cls}` : ''}" data-fold="${escapeHtml(key)}"${attrs}${open || openFolds.has(key) ? ' open' : ''}>
    <summary><span class="fold-head"><h2>${title}</h2>${meta ? `<span class="fold-meta">${meta}</span>` : ''}</span>${FOLD_CHEV}</summary>
    <div class="fold-body">${body}</div></details>`;
}

// Плитка раздела: надпись сверху (как у страницы раздела), название, строка с итогами
function entryCard(href, icon, eyebrow, title, sub) {
  return `<a class="link-card entry-card" href="${href}"><span class="link-icon" aria-hidden="true">${icon}</span>
    <span><small class="entry-eyebrow">${eyebrow}</small><strong>${title}</strong><small>${sub}</small></span><span class="link-arrow" aria-hidden="true">›</span></a>`;
}

function linkCard(href, icon, title, sub, cls = '') {
  return `<a class="link-card${cls ? ` ${cls}` : ''}" href="${href}"><span class="link-icon" aria-hidden="true">${icon}</span>
    <span><strong>${title}</strong><small>${sub}</small></span><span class="link-arrow" aria-hidden="true">›</span></a>`;
}

// ---------- Уход и чистота ----------

// Строка в заголовке свёрнутого «Ухода» и «Чистоты»: что пора сделать
function careMeta(home) {
  const due = CARE_ITEMS.filter((item) => !!item.home === home)
    .filter((item) => { const st = careState(item, S.care[item.id], S.day); return st.due && st.last; });
  return due.length ? `<span class="fold-due">пора: ${due.map((item) => escapeHtml(item.name.toLowerCase())).join(', ')}</span>` : 'всё вовремя';
}
const careRows = (home) => CARE_ITEMS.filter((item) => !!item.home === home)
  .map((item) => careRowHtml(item, careState(item, S.care[item.id], S.day))).join('');
function careRowHtml(item, st) {
  const today = st.last === S.day;
  const when = `${daysAgoText(st.days)}${st.due && st.last ? ' · пора' : ''}`;
  return `<li class="care-li"><button class="health-row care-row${st.due && st.last ? ' overdue' : ''}" data-action="care-open" data-id="${item.id}">
      <span class="health-icon" aria-hidden="true">${item.icon}</span>
      <span class="health-main"><strong>${item.name}</strong><span>${escapeHtml(when)}</span></span></button>
    ${canWrite() ? `<button class="care-done${today ? ' on' : ''}" data-action="care-done" data-id="${item.id}" aria-label="${item.name}: ${today ? 'отмечено сегодня' : 'сделали сегодня'}"${today ? ' disabled' : ''}>${today ? '✓' : 'Сегодня'}</button>` : ''}</li>`;
}

const careItem = (id) => CARE_ITEMS.find((x) => x.id === id);
function careSave(id, patch) {
  const item = careItem(id);
  const st = careState(item, S.care[id], S.day);
  const data = { log: patch.log || st.log, every: patch.every != null ? patch.every : st.every };
  S.care = { ...S.care, [id]: data };
  store.saveCare(id, data);
  return data;
}
function careMark(id, day) {
  const item = careItem(id);
  const before = careState(item, S.care[id], S.day).log;
  if (before.includes(day)) return;
  careSave(id, { log: [...before, day].sort() });
  render();
  toast(`Отмечено: ${item.name.toLowerCase()} — ${day === S.day ? 'сегодня' : dayTitle(day, { day: 'numeric', month: 'long' })}.`, {
    label: 'Отменить', onClick: () => { careSave(id, { log: before }); render(); },
  });
}
function careSheet(id) {
  const item = careItem(id);
  if (!item) return;
  const st = careState(item, S.care[id], S.day);
  const recent = st.log.slice(-6).reverse();
  const every = EVERY_OPTIONS.includes(st.every) ? EVERY_OPTIONS : [...EVERY_OPTIONS, st.every].sort((a, b) => a - b);
  openSheet(`<form class="form"><h2>${item.icon} ${item.name}</h2>
    <p class="muted">${escapeHtml(cap(item.what))}.${item.card ? ` <a href="#/k/${item.card}" data-action="sheet-close-link">Как приучить ›</a>` : ''}${item.tip ? ` <a href="#/t/${item.tip}" data-action="sheet-close-link">Подробнее ›</a>` : ''}</p>
    <label>Напоминать<select name="every">${every.map((n) => `<option value="${n}"${n === st.every ? ' selected' : ''}>${everyText(n)}</option>`).join('')}</select></label>
    ${canWrite() ? `<label>Когда сделали <input type="date" name="date" value="${S.day}" max="${S.day}" required></label>` : ''}
    ${recent.length ? `<p class="care-hist"><b>Последние разы:</b> ${recent.map((d) => escapeHtml(dayTitle(d, { day: 'numeric', month: 'short' }))).join(', ')}</p>` : '<p class="muted">Пока ни разу не отмечали.</p>'}
    ${recent.length && canWrite() ? `<button type="button" class="btn small" data-action="care-undo" data-id="${id}">Убрать отметку за ${escapeHtml(dayTitle(recent[0], { day: 'numeric', month: 'long' }))}</button>` : ''}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button>${canWrite() ? '<button class="btn primary">Отметить</button>' : ''}</div>
  </form>`, (fd) => {
    const day = String(fd.get('date') || '');
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || day > S.day) return toast('Выберите день не позже сегодняшнего.');
    careMark(id, day);
  });
  const sel = sheet.querySelector('select[name=every]');
  if (sel) sel.addEventListener('change', () => {
    if (!canWrite()) return;
    careSave(id, { every: +sel.value });
    render();
    toast(`${item.name}: ${everyText(+sel.value)}.`);
  });
}

// ---------- Где команда получается ----------

const PLACES = [['home', '🏠', 'Дома'], ['yard', '🌳', 'Во дворе'], ['street', '🏙️', 'Среди отвлечений']];
const placeId = (tab, card, p) => `lvl_${tab}_${card.id}_${p}`;
function placesHtml(tab, card) {
  return `<section class="places">
    <p class="places-title">Где уже получается</p>
    <div class="places-row">${PLACES.map(([p, icon, label]) => {
      const on = !!getMark(placeId(tab, card, p));
      return `<button class="place-btn${on ? ' on' : ''}" data-action="mark" data-id="${placeId(tab, card, p)}" aria-pressed="${on}"${canWrite() ? '' : ' disabled'}>
        <span aria-hidden="true">${on ? '✓' : icon}</span>${label}</button>`;
    }).join('')}</div>
    <p class="muted small">Отмечайте, когда получается 8 раз из 10. Сначала дома, потом во дворе, потом там, где люди, собаки и запахи.</p>
  </section>`;
}
function placesMini(tab, card) {
  const on = PLACES.filter(([p]) => getMark(placeId(tab, card, p)));
  return on.length ? `<span class="card-places" aria-label="Получается: ${on.map(([, , l]) => l.toLowerCase()).join(', ')}">${on.map(([, icon]) => icon).join(' ')}</span>` : '';
}

// ---------- Социализация ----------

function socialEntryHtml() {
  const sum = socialSummary(S.social);
  return entryCard('#/social', '🧭', 'Социализация', `Новое для ${escapeHtml(DOG() === 'Батончик' ? 'Батончика' : DOG())}`,
    `встретили ${sum.met} из ${sum.total}${sum.again ? ` · повторить ${sum.again}` : ''}`);
}

// Тренировки → плитка «Одиночество · Учимся оставаться дома» (рядом с «Социализация · Новое для Батончика»)
function aloneEntryHtml() {
  const step = AL.currentStep(aloneDone(), S.alone);
  const rec = AL.allRecords(S.alone);
  const ws = AL.weekStats(S.alone, mondayOf(S.day), S.day);
  const sub = S.alone.length
    ? [sessActive() ? 'идёт сессия' : '', step ? `шаг ${step} из 13` : 'все шаги отмечены', `сессий за неделю: ${ws.sessions}`, rec.front ? `за входной дверью — ${AL.fmtDur(rec.front)}` : ''].filter(Boolean).join(' · ')
    : 'проверки, сессии с подсказкой длительности, записи';
  return entryCard('#/alone', '🏠', 'Одиночество', 'Учимся оставаться дома', escapeHtml(sub));
}

const socialName = (id) => (isOwnSocial(id) ? (S.social[id] && S.social[id].title) || 'Своё' : (SOCIAL_ITEMS.find((x) => x.id === id) || {}).name || id);

function renderSocial() {
  const back = `<a class="back" href="#/k">${BACK_SVG}Тренировки</a>`;
  const sum = socialSummary(S.social);
  const f = S.socialFilter;
  const own = Object.keys(S.social).filter(isOwnSocial).map((id) => ({ id, name: socialName(id), card: '' }));
  const groups = [...SOCIAL_GROUPS, ...(own.length ? [{ title: 'Своё', items: own }] : [])];
  const fits = (st) => f === 'all' || (f === 'new' ? !st.count : st.again);
  const body = groups.map((g) => {
    const rows = g.items.map((item) => ({ item, st: socialState(S.social[item.id]) })).filter(({ st }) => fits(st));
    if (!rows.length) return '';
    const list = `<ul class="social-list">${rows.map(({ item, st }) => `<li>
      <button class="social-row${st.again ? ' again' : ''}" data-action="social-open" data-id="${item.id}">
        <span class="social-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(reactionLine(st))}</span></span>
        <span class="social-mark" aria-hidden="true">${st.last ? REACTIONS[st.last.r].icon : '＋'}</span></button></li>`).join('')}</ul>`;
    const met = rows.filter(({ st }) => st.count).length;
    return foldHtml(`social:${g.title}`, escapeHtml(g.title), f === 'all' ? `встретили ${met} из ${rows.length}` : `${rows.length}`, list, { cls: 'group', open: f !== 'all' });
  }).join('');
  const chip = (key, label, n) => `<button class="filter-chip${f === key ? ' on' : ''}" data-action="social-filter" data-f="${key}" aria-pressed="${f === key}">${label} <b>${n}</b></button>`;
  return `${back}${pageHead({ eyebrow: 'Социализация', title: `Новое для ${escapeHtml(DOG() === 'Батончик' ? 'Батончика' : DOG())}`,
    sub: 'Отмечайте, что он уже встретил и как отреагировал. Важно не количество, а чтобы встречи были спокойными.', plus: canWrite() ? { action: 'social-add', label: 'Своё новое' } : null })}
    ${statusBanner()}
    <details class="intro social-how"><summary>Как знакомить с новым</summary><div class="prose">
      <p>Держите расстояние, на котором он может спокойно есть и смотреть. Посмотрел на новое — «Да!» и кусочек, как в игре «Посмотри на это».</p>
      <p>Насторожился — отойдите подальше, дайте понюхать землю, похвалите. Испугался — уходите спокойно, без утешений и рывков поводка. В следующий раз начните издалека.</p>
      <p>Не тяните ближе и не держите, «чтобы привык». Пусть он сам решает, подойти или нет.</p>
      <p>Примерно с 6 до 14 месяцев у многих собак бывает второй период страхов: знакомое вдруг пугает. Это нормально — вернитесь к расстоянию, где ему спокойно.</p>
      <p><a href="#/k/posmotri-na-eto">«Посмотри на это» ›</a></p>
      <p>Весь список — по чек-листу социализации Екатерины Усовой: <a href="#/c/kak-polzovatsya-chek-listom-socializacii">как им пользоваться ›</a></p></div></details>
    <div class="filter-chips">${chip('all', 'Все', sum.total)}${chip('new', 'Ещё не было', sum.total - sum.met)}${chip('again', 'Повторить', sum.again)}</div>
    ${body || emptyArt(f === 'again' ? 'Повторять пока нечего: последние встречи прошли спокойно.' : 'Всё из списка уже встречали. Добавьте своё через «+».', 'leash')}`;
}

function socialSheet(id) {
  const item = SOCIAL_ITEMS.find((x) => x.id === id) || { id, name: socialName(id), card: '' };
  const st = socialState(S.social[id]);
  const todayMark = st.log.find((x) => x.d === S.day);
  const hist = st.log.slice(-8).reverse();
  openSheet(`<div class="form"><h2>${escapeHtml(item.name)}</h2>
    ${canWrite() ? `<p class="muted">Как он отреагировал${todayMark ? ' сегодня (можно изменить)' : ' сегодня'}?</p>
    <div class="react-row">${Object.entries(REACTIONS).map(([r, x]) => `<button type="button" class="react-btn${todayMark && todayMark.r === r ? ' on' : ''}" data-action="social-react" data-id="${id}" data-r="${r}">
      <span aria-hidden="true">${x.icon}</span>${x.label}</button>`).join('')}</div>` : ''}
    ${st.again ? '<p class="hint-box">В прошлый раз было непросто. Начните издалека: там, где он может есть и смотреть, и уходите, пока ему ещё спокойно.</p>' : ''}
    ${item.card ? `<p><a href="#/k/${item.card}" data-action="sheet-close-link">Тренировка по теме ›</a></p>` : ''}
    ${hist.length ? `<ul class="react-hist">${hist.map((x) => `<li><span>${escapeHtml(dayTitle(x.d, { day: 'numeric', month: 'long' }))}</span><span>${REACTIONS[x.r].icon} ${REACTIONS[x.r].label}</span></li>`).join('')}</ul>` : ''}
    ${todayMark && canWrite() ? `<button type="button" class="btn small" data-action="social-unreact" data-id="${id}">Убрать сегодняшнюю отметку</button>` : ''}
    ${isOwnSocial(id) && canWrite() ? `<button type="button" class="btn small danger" data-action="social-del" data-id="${id}">Удалить пункт</button>` : ''}
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button></div></div>`, null);
}

function socialSave(id, log) {
  const title = isOwnSocial(id) ? socialName(id) : '';
  const data = { title, log };
  S.social = { ...S.social, [id]: data };
  store.saveSocial(id, data);
}

function socialAddSheet() {
  openSheet(`<form class="form"><h2>Своё новое</h2>
    <label>Что он встретил<input name="title" maxlength="80" required placeholder="Например: человек в костюме Деда Мороза"></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Добавить</button></div>
  </form>`, (fd) => {
    const title = String(fd.get('title') || '').trim().slice(0, 80);
    if (!title) return;
    const id = `my-${rid()}`;
    S.social = { ...S.social, [id]: { title, log: [] } };
    store.saveSocial(id, { title, log: [] });
    S.socialFilter = 'all';
    toast(`Добавлено: ${title}. Нажмите на пункт, чтобы отметить встречу.`);
  });
}

// ---------- Сводка для ветеринара ----------

function summaryData() {
  const pet = S.pet || {};
  const age = pet.birth ? ageText(pet.birth, S.day) : '';
  const weights = series(S.growth, 'weight');
  const lastW = weights[weights.length - 1];
  const done = doneRecords(S.health);
  const lastOf = (kind) => done.find((r) => r.kind === kind);
  const fmt = (d) => dayTitle(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const all = [...S.recent, ...S.events];
  const days = Array.from({ length: 7 }, (_, i) => addDays(S.day, -i));
  const stats = days.map((d) => dayStats(d, all, {}, 0)).filter((st) => st.list.length);
  const avg = (f) => (stats.length ? stats.reduce((a, st) => a + f(st), 0) / stats.length : 0);
  const round1 = (x) => (Math.round(x * 10) / 10).toLocaleString('ru-RU');
  const nights = stats.map((st) => st.night && st.night.ms).filter(Boolean);
  const fed = stats.filter((st) => st.mealGrams);
  const notes = all.filter((e) => days.includes(e.day) && e.text && e.type !== 'train')
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12)
    .map((e) => `${dayTitle(e.day, { day: 'numeric', month: 'short' })}, ${fmtTime(new Date(e.at))} — ${EVENT_TYPES[e.type] ? EVENT_TYPES[e.type].label.toLowerCase() : e.type}: ${e.text}`);
  const care = CARE_ITEMS.filter((item) => !item.home).map((item) => ({ item, st: careState(item, S.care[item.id], S.day) })).filter(({ st }) => st.last)
    .map(({ item, st }) => `${item.name}: ${daysAgoText(st.days)}`);
  return {
    title: `${DOG()}${pet.breed ? ` — ${pet.breed.toLowerCase()}` : ''}`,
    about: [
      [pet.sex, age && `возраст ${age}`, pet.birth && `дата рождения ${fmt(pet.birth)}`].filter(Boolean).join(', '),
      pet.chip && `Чип: ${pet.chip}`,
      pet.mdr1 && `MDR1: ${pet.mdr1}`,
      lastW && `Вес: ${fmtNum(lastW.value)} кг (${dayTitle(lastW.date, { day: 'numeric', month: 'long' })})${weights.length > 1 ? `, ${deltaText(weights, 'кг')}` : ''}`,
    ].filter(Boolean),
    health: [
      ...done.filter((r) => r.kind === 'vaccine').slice(0, 4).map((r) => `${r.title}: ${fmt(r.date)}`),
      ...['ticks', 'worms', 'pill'].map(lastOf).filter(Boolean).map((r) => `${r.title}: ${fmt(r.date)}`),
      ...((lastOf('vet') && [`Последний визит к врачу: ${fmt(lastOf('vet').date)}${lastOf('vet').note ? ` — ${lastOf('vet').note}` : ''}`]) || []),
    ],
    soon: upcoming(S.health).slice(0, 4).map((r) => `${r.title}: ${dayTitle(r.date, { day: 'numeric', month: 'long' })}`),
    week: stats.length ? [
      `Записано дней: ${stats.length} из 7`,
      `Туалет на улице: в среднем ${round1(avg((st) => st.toilet))} в день`,
      `Дома: ${stats.reduce((a, st) => a + st.accident, 0)} за неделю`,
      `Стул: в среднем ${round1(avg((st) => st.toiletPoo + st.accidentPoo))} в день`,
      fed.length && `Еда: в среднем ${Math.round(fed.reduce((a, st) => a + st.mealGrams, 0) / fed.length)} г в день`,
      nights.length && `Ночной сон: в среднем ${fmtDuration(nights.reduce((a, b) => a + b, 0) / nights.length)}`,
    ].filter(Boolean) : [],
    notes,
    care,
  };
}

function summaryText(d) {
  const block = (title, list) => (list.length ? `\n${title}\n${list.map((x) => `• ${x}`).join('\n')}` : '');
  return `${d.title}\n${d.about.join('\n')}${block('Здоровье', d.health)}${block('Запланировано', d.soon)}${block('Последние 7 дней (по журналу)', d.week)}${block('Заметки из журнала', d.notes)}${block('Уход', d.care)}\n`;
}

function renderSummary() {
  const d = summaryData();
  const list = (title, items, empty) => `<section class="sum-block"><h2>${title}</h2>${items.length
    ? `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`}</section>`;
  return `<a class="back" href="#/pass">${BACK_SVG}Паспорт</a>
    ${pageHead({ eyebrow: dayTitle(S.day, { day: 'numeric', month: 'long', year: 'numeric' }), title: 'Для ветеринара', sub: 'Всё главное на одной странице. Покажите с телефона или отправьте заранее.' })}
    <div class="sum-actions">
      <button class="btn primary" data-action="summary-share">Отправить</button>
      <button class="btn" data-action="summary-print">Сохранить PDF</button>
    </div>
    <article class="card summary">
      <h2 class="sum-title">${escapeHtml(d.title)}</h2>
      <ul class="sum-about">${d.about.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      ${list('Здоровье', d.health, 'Прививок и обработок в паспорте пока нет.')}
      ${d.soon.length ? list('Запланировано', d.soon, '') : ''}
      ${list('Последние 7 дней', d.week, 'В журнале за неделю нет записей.')}
      ${d.notes.length ? list('Заметки из журнала', d.notes, '') : ''}
      ${d.care.length ? list('Уход', d.care, '') : ''}
    </article>
    <p class="muted small">Вопросы к врачу удобно записать заранее заметкой в журнале — они попадут сюда.</p>`;
}

// ---------- Если потерялся ----------

function lostData() {
  const pet = S.pet || {};
  return lostLines(pet, S.lost, pet.birth ? ageText(pet.birth, S.day) : '');
}

function renderLost() {
  const lines = lostData();
  const ready = hasLostPhones(S.lost);
  return `<a class="back" href="#/pass">${BACK_SVG}Паспорт</a>
    ${pageHead({ eyebrow: DOG(), title: 'Если потерялся', sub: 'Объявление собрано заранее: в панике некогда искать фото и телефоны.' })}
    ${statusBanner()}
    ${!ready ? `<div class="banner warn"><span>Добавьте телефоны — без них объявление не поможет.</span>${canWrite() ? '<button class="btn small primary" data-action="lost-edit">Добавить</button>' : ''}</div>` : ''}
    ${lostPosterHtml(lines, S.photo)}
    <div class="lost-actions">
      <button class="btn primary wide" data-action="lost-share"${ready ? '' : ' disabled'}>Отправить объявление картинкой</button>
      <button class="btn wide" data-action="lost-text"${ready ? '' : ' disabled'}>Отправить текстом</button>
      ${canWrite() ? '<button class="btn wide" data-action="lost-edit">Изменить телефоны и приметы</button>' : ''}
    </div>
    <section class="card">
      <div class="card-head"><h2>Что делать сразу</h2></div>
      <ol class="lost-steps">${LOST_STEPS.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>
    </section>
    <p class="muted small">Фото для объявления — из паспорта. Лучше, если на нём он виден целиком, сбоку и при дневном свете.</p>`;
}

function lostSheet() {
  const l = S.lost || {};
  const v = (k) => escapeHtml(l[k] || '');
  openSheet(`<form class="form"><h2>Объявление</h2>
    <fieldset><legend>Первый телефон</legend>
      <label>Имя<input name="name1" maxlength="40" value="${v('name1')}" placeholder="Катя"></label>
      <label>Телефон<input name="phone1" type="tel" maxlength="30" value="${v('phone1')}" placeholder="+7 900 000-00-00"></label></fieldset>
    <fieldset><legend>Второй телефон</legend>
      <label>Имя<input name="name2" maxlength="40" value="${v('name2')}"></label>
      <label>Телефон<input name="phone2" type="tel" maxlength="30" value="${v('phone2')}"></label></fieldset>
    <label>Приметы<textarea name="signs" rows="3" maxlength="400" placeholder="Окрас, пятна, цвет ошейника или шлейки, хвост">${v('signs')}</textarea></label>
    <label>Приписка<textarea name="note" rows="2" maxlength="300" placeholder="Например: «Боится, не ловите — позвоните нам» или «Вознаграждение»">${v('note')}</textarea></label>
    <p class="muted small">Телефоны хранятся в вашей базе и видны только вам двоим — пока вы сами не отправите объявление.</p>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
  </form>`, (fd) => {
    const x = Object.fromEntries(['name1', 'phone1', 'name2', 'phone2', 'signs', 'note'].map((k) => [k, String(fd.get(k) || '').trim()]));
    S.lost = x;
    store.saveLost(x);
    toast('Объявление сохранено.');
  });
}

async function shareFile(blob, name, text) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); } catch (err) { if (err && err.name !== 'AbortError') toast('Не получилось отправить. Попробуйте ещё раз.'); }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Картинка сохранена в загрузки.');
}

async function shareText(text, title) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Текст скопирован — вставьте его в сообщение.'); } catch { toast('Не получилось скопировать текст.'); }
}

// ---------- Фото месяца ----------

const monthsText = (n) => (n < 12 ? `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
  : `${Math.floor(n / 12)} ${plural(Math.floor(n / 12), 'год', 'года', 'лет')}${n % 12 ? ` и ${n % 12} ${plural(n % 12, 'месяц', 'месяца', 'месяцев')}` : ''}`);

// День, когда исполняется n месяцев: то же число, а если его в месяце нет — последний день месяца
function monthBirthday(birth, n) {
  const [y, m, d] = birth.split('-').map(Number);
  const total = (m - 1) + n;
  const yy = y + Math.floor(total / 12);
  const mm = total % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// Уменьшенное фото месяца (квадрат 240 точек) — для календаря дневника; грузится один раз по запросу
function monthThumb(n) {
  const mp = S.monthPhotos;
  if (mp.thumbs[n] || mp.thumbLoading[n] || !S.monthDates || !S.monthDates[n]) return mp.thumbs[n] || '';
  mp.thumbLoading[n] = true;
  const full = mp.all && mp.all[n] && mp.all[n].data;
  (full ? Promise.resolve({ data: full }) : store.loadMonthPhoto(n))
    .then((p) => (p && p.data ? squareThumb(p.data, 240) : ''))
    .then((t) => { if (t) { mp.thumbs[n] = t; render(); } })
    .catch(() => {})
    .finally(() => { mp.thumbLoading[n] = false; });
  return '';
}

function squareThumb(src, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const k = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = src;
  });
}

// День → номер месяца, если в этот день снято фото месяца
function monthOnDay(day) {
  const d = S.monthDates || {};
  const n = Object.keys(d).find((k) => d[k] === day);
  return n ? +n : 0;
}

async function loadAllMonthPhotos() {
  const mp = S.monthPhotos;
  if (mp.loading) return;
  mp.loading = true;
  mp.stale = false;
  try { mp.all = await store.loadMonthPhotos(); } catch { mp.all = mp.all || {}; }
  mp.loading = false;
  render();
}

function renderMonths() {
  const back = `<a class="back" href="#/pass">${BACK_SVG}Паспорт</a>`;
  const head = pageHead({ eyebrow: DOG(), title: 'Как рос', sub: 'По фото на каждый месяц. Снимайте в одном месте и в одной позе — так разница виднее. Фото видны и в календаре дневника.' });
  const birth = S.pet && S.pet.birth;
  if (!canWrite()) return `${back}${head}${statusBanner()}<p class="muted">Фото появятся после входа.</p>`;
  if (!/^\d{4}-\d\d-\d\d$/.test(birth || '')) return `${back}${head}<p class="muted">Укажите дату рождения в <a href="#/pass">паспорте</a> — тогда здесь появятся месяцы.</p>`;
  const mp = S.monthPhotos;
  if (!mp.all || mp.stale) setTimeout(loadAllMonthPhotos, 0);
  if (!mp.all) return `${back}${head}<p class="muted">Загружаем фото…</p>`;
  const age = ageMonths(birth, S.day) || 0;
  const max = Math.max(age, ...Object.keys(mp.all).map(Number));
  const tiles = [];
  for (let n = 1; n <= max; n++) {
    const p = mp.all[n];
    const label = `<span class="month-label">${monthsText(n)}${p && p.date ? `<small>${escapeHtml(dayTitle(p.date, { day: 'numeric', month: 'short' }))}</small>` : ''}</span>`;
    tiles.push(p ? `<button class="month-tile" data-action="month-open" data-n="${n}"><img src="${escapeHtml(p.data)}" alt="${escapeHtml(monthsText(n))}">${label}</button>`
      : `<button class="month-tile empty" data-action="month-add" data-n="${n}"><span class="month-plus" aria-hidden="true">+</span>${label}</button>`);
  }
  return `${back}${head}${tiles.length ? `<div class="month-grid">${tiles.join('')}</div>` : '<p class="muted">Первый месяц ещё не исполнился.</p>'}`;
}

// Дата снимка: за текущий месяц — сегодня, за прошлые — день, когда тому месяцу исполнилось
function monthPhotoDate(n) {
  const birth = S.pet && S.pet.birth;
  if (!/^\d{4}-\d\d-\d\d$/.test(birth || '') || n >= (ageMonths(birth, S.day) || 0)) return S.day;
  return monthBirthday(birth, n);
}

async function addMonthPhoto(n) {
  const data = await choosePhoto();
  if (!data) return;
  const photo = { data, date: monthPhotoDate(n) };
  const mp = S.monthPhotos;
  delete mp.thumbs[n];
  if (mp.all) mp.all = { ...mp.all, [n]: photo };
  S.monthDates = { ...(S.monthDates || {}), [n]: photo.date };
  render();
  await store.saveMonthPhoto(n, photo);
  toast(`Фото за ${monthsText(n)} сохранено — оно и в календаре дневника, ${dayTitle(photo.date, { day: 'numeric', month: 'long' })}.`);
}

function monthSheet(n) {
  const p = S.monthPhotos.all && S.monthPhotos.all[n];
  if (!p) return;
  openSheet(`<div class="form"><h2>${monthsText(n)}</h2>
    <button type="button" class="month-big" data-action="month-view" data-n="${n}"><img src="${escapeHtml(p.data)}" alt=""></button>
    ${p.date ? `<p class="muted">Снято ${escapeHtml(dayTitle(p.date, { day: 'numeric', month: 'long', year: 'numeric' }))}</p>` : ''}
    <button type="button" class="btn wide" data-action="month-replace" data-n="${n}">Заменить фото</button>
    <button type="button" class="btn wide danger" data-action="month-remove" data-n="${n}">Убрать фото</button>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Закрыть</button></div></div>`, null);
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
  const r = (id && S.health.find((x) => x.id === id)) || { title: '', kind: 'vaccine', date: S.day, time: '', done: true, note: '' };
  openSheet(`<form class="form health-form"><h2>${id ? 'Изменить запись' : 'Новая запись о здоровье'}</h2>
    <label>Что<input name="title" maxlength="120" required list="health-suggest" value="${escapeHtml(r.title)}" placeholder="Например: обработка от клещей"></label>
    <datalist id="health-suggest">${HEALTH_SUGGEST.map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
    <fieldset><legend>Вид</legend><div class="choices">${Object.entries(HEALTH_KINDS).map(([k, v]) =>
      `<label class="choice"><input type="radio" name="kind" value="${k}"${k === r.kind ? ' checked' : ''}>${v.icon} ${v.label}</label>`).join('')}</div></fieldset>
    <fieldset><legend>Статус</legend><div class="choices">
      <label class="choice"><input type="radio" name="done" value="1"${r.done ? ' checked' : ''}>Уже сделано</label>
      <label class="choice"><input type="radio" name="done" value="0"${r.done ? '' : ' checked'}>Запланировать</label></div></fieldset>
    <div class="date-time"><label>Дата<input type="date" name="date" required value="${escapeHtml(r.date)}"></label>
      <label class="time-field"${r.kind === 'vet' ? '' : ' hidden'}>Время<input type="time" name="time" value="${escapeHtml(hasTime(r) ? r.time : '')}"></label></div>
    <div class="next-field"${r.done ? '' : ' hidden'}>${nextFieldHtml(suggestNext(r, S.health, S.pet && S.pet.birth))}</div>
    <label>Заметка <span class="muted">(необязательно)</span><textarea name="note" rows="2" maxlength="1000" placeholder="Препарат, доза, клиника">${escapeHtml(r.note)}</textarea></label>
    <div class="form-actions"><button type="button" class="btn" data-action="sheet-close">Отмена</button><button class="btn primary">Сохранить</button></div>
    ${id ? `<button type="button" class="btn danger-outline wide" data-action="health-delete" data-id="${id}">Удалить запись</button>` : ''}
  </form>`, (fd) => {
    const rec = {
      title: String(fd.get('title') || '').trim(), kind: String(fd.get('kind') || 'other'),
      date: String(fd.get('date') || S.day), done: fd.get('done') === '1', note: String(fd.get('note') || '').trim(),
    };
    // Время — только у визита к врачу
    const time = String(fd.get('time') || '').slice(0, 5);
    rec.time = rec.kind === 'vet' && TIME_RE.test(time) ? time : '';
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
    form.querySelector('.time-field').hidden = fd.get('kind') !== 'vet';
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
  const when = `${dayTitle(r.date, { day: 'numeric', month: 'long', year: 'numeric' })}${hasTime(r) ? `, ${r.time}` : ''}`;
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
    store.saveHealth(r.id, { title: rec.title, kind: rec.kind, date, time: date === r.date ? r.time || '' : '', done: true, note: rec.note });
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

// ---------- Уведомления ----------
// Каждый телефон включает свои: токен телефона и галочки — в pushTokens/{id}, копия — в памяти телефона (bt.push).
// Присылает их сервер (папка functions), раз в 5 минут.

const PUSH_TYPES = [
  ['toilet', '🌳', '«Пора в туалет»', 'когда по журналу подошло обычное время; ночью и после «Легли» — нет'],
  ['care', '🩺', 'Уход и здоровье', 'в 10:00 — что пора по уходу, прививки и обработки сегодня и завтра; врач — за 2 часа'],
  ['week', '🐾', '«Неделя Батончика»', 'в воскресенье в 19:00, если неделю ещё не заполнили'],
  ['game', '🧠', '«Разминка дня»', 'в 20:00, если вы сегодня ещё не сыграли; если второй уже сыграл — с его результатом'],
];
const readPush = () => { try { return JSON.parse(localStorage.getItem('bt.push') || 'null'); } catch { return null; } };
const writePush = (v) => { try { if (v) localStorage.setItem('bt.push', JSON.stringify(v)); else localStorage.removeItem('bt.push'); } catch { /* память недоступна */ } };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function pushSupport() {
  if (S.store.mode !== 'firebase') return 'local';
  if (!(firebaseConfig && firebaseConfig.vapidKey)) return 'nokey';
  if (isIOS() && !isApp()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}
const pushOn = () => pushSupport() === 'ok' && Notification.permission === 'granted' && !!readPush();

async function tokenId(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
const pushPrefsFromPage = () => Object.fromEntries(PUSH_TYPES.map(([k]) => {
  const box = view.querySelector(`[data-push="${k}"]`);
  return [k, !!(box && box.checked)];
}));

function pushPanelHtml() {
  const sup = pushSupport();
  if (sup === 'local') return '';
  const saved = readPush();
  const on = pushOn();
  const prefs = (saved && saved.prefs) || S.pushDraft || { toilet: true, care: true, week: true, game: true };
  let body;
  if (!canWrite()) body = '<p class="muted">Уведомления можно включить после входа.</p>';
  else if (sup === 'nokey') body = '<p class="muted">Уведомления ещё не настроены: не хватает ключа в настройках приложения (README, раздел «Уведомления»).</p>';
  else if (sup === 'install') {
    body = `<p>На iPhone уведомления приходят, только если «Батончик» открыт с экрана «Домой».</p>
      <p class="muted">Откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Потом запустите «Батончик» с экрана «Домой» и включите уведомления здесь.</p>`;
  } else if (sup === 'unsupported') body = '<p class="muted">Этот браузер не умеет показывать уведомления. На Android откройте приложение в Chrome.</p>';
  else if (sup === 'denied') {
    body = `<p>Уведомления для «Батончика» запрещены в настройках телефона.</p>
      <p class="muted">${isIOS() ? 'Настройки iPhone → Уведомления → Батончик → «Допуск уведомлений».' : 'Chrome → ⋮ → Настройки → Настройки сайтов → Уведомления → разрешите для этого сайта.'} Потом вернитесь сюда.</p>`;
  } else {
    body = `<p class="muted">${on ? 'Включены на этом телефоне. Что присылать сюда:' : 'Отметьте, что присылать на этот телефон, и нажмите «Включить». На втором телефоне — свой выбор.'}</p>
      <div class="push-list">${PUSH_TYPES.map(([k, icon, label, sub]) => `<label class="push-opt">
        <input type="checkbox" data-push="${k}"${prefs[k] ? ' checked' : ''}>
        <span><strong>${icon} ${label}</strong><small>${sub}</small></span></label>`).join('')}</div>
      ${on ? `<div class="edit-actions"><button class="btn small" data-action="push-test">Прислать проверочное</button>
        <button class="btn small danger" data-action="push-off">Выключить на этом телефоне</button></div>`
        : '<button class="btn primary wide" data-action="push-on">Включить уведомления на этом телефоне</button>'}`;
  }
  return `<section class="section panel" id="push"><h2>Уведомления</h2>${body}</section>`;
}

async function pushEnable() {
  const prefs = pushPrefsFromPage();
  if (!Object.values(prefs).some(Boolean)) { toast('Отметьте хотя бы одно уведомление.'); return; }
  // Разрешение спрашиваем сразу по нажатию: iPhone спрашивает только в ответ на нажатие
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    render();
    toast(perm === 'denied' ? 'Уведомления запрещены. Их можно разрешить в настройках телефона.' : 'Уведомления не включены.');
    return;
  }
  toast('Включаем уведомления…');
  try {
    const reg = await navigator.serviceWorker.ready;
    const token = await store.pushToken(firebaseConfig.vapidKey, reg);
    const id = await tokenId(token);
    await store.pushSave(id, token, prefs);
    writePush({ id, token, prefs });
    render();
    toast('Уведомления включены. Нажмите «Прислать проверочное», чтобы проверить.');
  } catch (err) {
    console.error(err);
    toast('Не получилось включить уведомления. Проверьте интернет и попробуйте ещё раз.');
  }
}

// Галочки на включённом телефоне сохраняются сразу
async function pushPrefsChanged() {
  const saved = readPush();
  const prefs = pushPrefsFromPage();
  // Ещё не включено — запоминаем выбор, чтобы он не сбросился, если экран перерисуется
  if (!saved || !pushOn()) { S.pushDraft = prefs; return; }
  writePush({ ...saved, prefs });
  try { await store.pushSave(saved.id, saved.token, prefs); toast('Сохранено.'); } catch (err) { console.error(err); toast('Не получилось сохранить. Проверьте интернет.'); }
}

// При запуске: токен телефона иногда меняется — обновляем запись в базе
async function pushRefresh() {
  const saved = readPush();
  if (!saved || !pushOn()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const token = await store.pushToken(firebaseConfig.vapidKey, reg);
    const id = await tokenId(token);
    await store.pushSave(id, token, saved.prefs);
    if (id !== saved.id) await store.pushRemove(saved.id, { unsubscribe: false });
    writePush({ ...saved, id, token });
  } catch (err) { console.error(err); }
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
    ${pushPanelHtml()}
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
      <button class="btn wide" data-action="reload">Загрузить свежую версию</button></section>
    ${viewportPanelHtml()}`;
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
  if (EVENT_TYPES[m[1]] && !EVENT_TYPES[m[1]].retired) S.pendingAdd = m[1];
}

// Найденная запись журнала: #/d/day/ГГГГ-ММ-ДД/id → Дневник с этим днём под календарём, запись подсвечена
function takeDayLink() {
  const m = location.hash.match(/^#\/d\/day\/(\d{4}-\d{2}-\d{2})(?:\/([^/]+))?/);
  if (!m) return;
  S.cal.sel = m[1];
  S.cal.month = monthOf(m[1]);
  S.cal.hit = m[2] ? decodeURIComponent(m[2]) : '';
  S.cal.feat = '';
  S.cal.jump = true;
  history.replaceState(null, '', `${location.pathname}${location.search}#/d`);
}

function onHashChange() {
  takeAddLink();
  takeDayLink();
  scrollMemory[currentHash] = window.scrollY;
  prevHash = currentHash;
  currentHash = location.hash || '#/';
  render();
}

// Название страницы для кнопки «Назад»; для правки карточки — нет (туда не возвращаемся)
const PAGE_TITLES = { search: 'Поиск', today: 'Главная', day: 'День', k: 'Тренировки', g: 'Тренировки', pass: 'Паспорт', growth: 'Рост и вес', lib: 'Библиотека', weeks: 'Неделя Батончика', t: 'Практика', c: 'Практика', game: 'Игра', d: 'Дневник', me: 'Настройки', ask: 'Спросить', social: 'Новое для Батончика', alone: 'Учимся оставаться дома' };
// Вложенные страницы со своим названием для «Назад»
const SUB_TITLES = { 'pass/summary': 'Для ветеринара', 'pass/lost': 'Если потерялся', 'pass/months': 'Как рос', 'game/play': 'Разминка', 'game/repeat': 'Повтор ошибок', 'alone/go': 'Сессия' };
// Какая вкладка внизу подсвечена: игры с собакой живут во вкладке «Тренировки», Практика, заметки каналов и игра на знания — в «Советах»
// «День» и «Неделя Батончика» — страницы главной (вкладки «День» внизу нет)
const TAB_OF = { search: 'search', ask: 'ask', today: 'today', day: 'today', k: 'k', g: 'k', pass: 'pass', growth: 'pass', lib: 't', weeks: 'today', t: 't', c: 't', game: 't', d: 'd', social: 'k', alone: 'k' };

function pageTitle(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return 'Главная';
  if (parts[0] === 'edit') return null;
  if (SUB_TITLES[`${parts[0]}/${parts[1]}`]) return SUB_TITLES[`${parts[0]}/${parts[1]}`];
  if (parts[1] && (TABS[parts[0]] || parts[0] === 'c')) return 'Назад';
  return PAGE_TITLES[parts[0]] || null;
}

function render(force) {
  const r = route();
  if (r.page !== 'edit') S.editor = null;
  // Открытую форму правки не перерисовываем от обновлений с сервера, чтобы не стереть набранный текст
  if (r.page === 'edit' && !force && S.editor && S.editor.key === editorKey(r) && view.querySelector('[data-editor]')) return;
  // То же для поиска, пока в нём печатают
  if (r.page === 'search' && !force && document.activeElement && document.activeElement.matches('.search-input')) return;
  // «Спросить»: пока пишут вопрос, экран не перерисовываем — разговор обновляется отдельно (updateAsk)
  if (r.page === 'ask' && !force && isTyping() && view.contains(document.activeElement)) return;
  if (r.page === 'lib' && r.id === 'dict' && !force && document.activeElement && document.activeElement.matches('.dict-search')) return;
  // Сессия «Учимся оставаться дома»: пока дописывают подробности или заметку, экран не перерисовываем
  if (r.page === 'alone' && !force && isTyping() && view.contains(document.activeElement)) return;
  document.body.classList.toggle('session-on', r.page === 'alone' && r.id === 'go');
  // Тесты «Проверь себя» переехали в игру
  if (r.page === 'lib' && r.id === 'quiz') {
    history.replaceState(null, '', '#/game');
    currentHash = '#/game';
    return render(force);
  }
  let html;
  if (r.page === 'search') html = renderSearch();
  else if (r.page === 'me') html = renderMe();
  else if (r.page === 'ask') html = renderAsk();
  else if (r.page === 'edit') html = renderEditor(r);
  else if (r.page === 'day') html = renderDayPage();
  else if (r.page === 'pass') html = r.id === 'summary' ? renderSummary() : r.id === 'lost' ? renderLost() : r.id === 'months' ? renderMonths() : renderPassport();
  else if (r.page === 'social') html = renderSocial();
  else if (r.page === 'growth') html = renderGrowth();
  else if (r.page === 'lib') html = renderLibrary(r);
  else if (r.page === 'weeks') html = renderWeeks();
  else if (r.page === 'd') html = r.id ? renderStoryPage(r.id) : renderDiary();
  else if (r.page === 'c') html = r.id ? renderNote(r.id) : renderTipsPage();
  else if (r.page === 'game') html = renderGame(r);
  else if (r.page === 'alone') html = r.id === 'go' ? renderAloneSession() : renderAlone();
  else if (TABS[r.tab]) html = r.id ? renderCard(r.tab, r.id) : (r.tab === 't' ? renderTipsPage() : renderTrainingsPage());
  else html = renderHome();
  view.innerHTML = html;
  // Открыли поиск лупой — курсор из временного поля переходит в настоящее, клавиатура остаётся
  if (S.searchFocus) {
    const input = r.page === 'search' && view.querySelector('.search-input');
    if (input) input.focus();
    S.searchFocus.remove();
    S.searchFocus = null;
  }
  const sb = $('#search-btn');
  if (sb) { sb.classList.toggle('on', r.page === 'search'); if (r.page === 'search') sb.setAttribute('aria-current', 'page'); else sb.removeAttribute('aria-current'); }
  const ab = $('#ask-btn');
  if (ab) { ab.classList.toggle('on', r.page === 'ask'); if (r.page === 'ask') ab.setAttribute('aria-current', 'page'); else ab.removeAttribute('aria-current'); }
  if (r.page === 'ask') { const inp = view.querySelector('.ask-input'); if (inp) fitAskInput(inp); }

  const routeKey = r.page + '/' + (r.tab || '') + '/' + (r.id || '') + '/' + (r.sub || '');
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    const saved = scrollMemory[currentHash];
    const isCard = !!((TABS[r.tab] || r.page === 'c' || r.page === 'd') && r.id) || !!(r.page === 'lib' && r.sub);
    pendingScroll = !isCard && saved ? { y: saved, until: Date.now() + 2000 } : null;
    window.scrollTo(0, pendingScroll ? saved : 0);
    // Открыли «Спросить» с прошлым разговором — сразу последние реплики над полем ввода
    if (r.page === 'ask' && askState().chat.length) { pendingScroll = null; scrollAsk('last', false); }
    // Ссылка на вопрос или миф — раскрытый пункт сразу на экране
    const target = r.page === 'lib' && r.sub && r.id !== 'a' && document.getElementById(`lib-${r.id}-${r.sub}`);
    if (target) target.scrollIntoView({ block: 'start' });
    if (target && fromSearch()) target.classList.add('lib-hit');
    // Ссылка на блок карточки: #/k/ostavatsya-odnomu/vazhno
    const blk = TABS[r.tab] && r.id && r.sub && document.getElementById(`blk-${r.sub}`);
    if (blk && blk.tagName === 'DETAILS') blk.open = true;
    if (blk) blk.scrollIntoView({ block: 'start' });
  } else if (pendingScroll && Date.now() < pendingScroll.until) {
    // Страница дорисовалась (например, подгрузились данные) — дотягиваем до запомненного места
    window.scrollTo(0, pendingScroll.y);
  }
  if (pendingScroll && (Math.abs(window.scrollY - pendingScroll.y) < 2 || Date.now() >= pendingScroll.until)) pendingScroll = null;
  const current = r.page === 'edit' ? TAB_OF[r.tab] : (TAB_OF[r.page] || (r.page === 'me' ? 'me' : 'today'));
  if (document.body.dataset.tab !== current) { document.body.dataset.tab = current; updateThemeColor(); }
  updateTopbar(current);
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const on = a.dataset.tab === current;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  maybeShowNews();
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

// Цвет строки состояния телефона — как шапка раздела (Android; в Safari — цвет панели браузера)
let colorProbe = null;
function updateThemeColor() {
  if (!colorProbe) {
    colorProbe = document.createElement('i');
    colorProbe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;background:var(--wash)';
    colorProbe.setAttribute('aria-hidden', 'true');
    document.body.append(colorProbe);
  }
  const v = getComputedStyle(colorProbe).backgroundColor;
  const m = v.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/);
  const color = m ? `#${m.slice(1, 4).map((x) => Math.max(0, Math.min(255, Math.round(+x * 255))).toString(16).padStart(2, '0')).join('')}` : v;
  if (color) document.querySelectorAll('meta[name="theme-color"]').forEach((el) => { el.content = color; });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);

// ---------- Шапка: где ты ----------
// Пока заголовок страницы на экране, в шапке — «Батончик». Заголовок уехал вверх — шапка показывает название
// страницы, а на вложенных страницах ещё стрелку «назад» и куда она ведёт (то же, что ссылка «‹ …» над заголовком).
// На главной всегда «Батончик». Нажатие на название — наверх страницы
let titleObserver = null;
function updateTopbar(tab) {
  const h1 = view.querySelector('h1');
  const back = view.querySelector('a.back');
  const title = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
  if (titleObserver) { titleObserver.disconnect(); titleObserver = null; }
  if (!h1 || !title || (tab === 'today' && !back)) { document.body.classList.remove('tb-on'); return; }
  $('#tb-title').textContent = title;
  $('#tb-where').classList.toggle('inner', !!back);
  if (back) {
    const tb = $('#tb-back');
    const label = back.textContent.replace(/\s+/g, ' ').trim();
    tb.setAttribute('href', back.getAttribute('href'));
    if (back.dataset.action) tb.dataset.action = back.dataset.action; else delete tb.dataset.action;
    tb.setAttribute('aria-label', `Назад: ${label}`);
    $('#tb-parent').textContent = label;
  }
  const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
  titleObserver = new IntersectionObserver(([en]) => {
    document.body.classList.toggle('tb-on', !en.isIntersecting && en.boundingClientRect.top < top);
  }, { rootMargin: `-${Math.round(top)}px 0px 0px 0px` });
  titleObserver.observe(h1);
}

// ---------- Окно правки ----------

const sheet = $('#sheet');
let sheetSubmit = null;

function openSheet(html, onSubmit) {
  sheet.querySelector('.sheet-body').innerHTML = html;
  sheetSubmit = onSubmit;
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
  pushOverlay('sheet');
}
// fromHistory — окно закрыл свайп или кнопка «назад»: запись в истории уже снята
function closeSheet(fromHistory) {
  // Сначала убираем курсор из поля: клавиатура закрывается обычным путём, а не вместе с исчезнувшим окном
  const focused = document.activeElement;
  if (focused && sheet.contains(focused)) focused.blur();
  sheet.hidden = true;
  sheetSubmit = null;
  document.body.classList.remove('no-scroll');
  if (!fromHistory) dropOverlaySoon();
}

// ---------- Свайп и кнопка «назад» ----------
// Окно и фото на весь экран добавляют запись в историю (адрес тот же). Поэтому свайп «назад» на iPhone
// и кнопка или жест «назад» на Android сначала закрывают окно или фото, а не листают страницы под ним
// и не закрывают приложение.
const overlayTop = () => (history.state && history.state.overlay) || '';
function pushOverlay(kind) {
  if (overlayTop() === kind) return; // окно сменило содержимое — запись та же
  history.pushState({ overlay: kind }, '', location.href);
}
// Окно закрыли кнопкой — снимаем его запись, если сразу не открыли новое и не ушли на другую страницу
function dropOverlaySoon() {
  setTimeout(() => {
    const top = overlayTop();
    if ((top === 'viewer' && !document.querySelector('.viewer')) || (top === 'sheet' && sheet.hidden)) history.back();
  }, 0);
}
window.addEventListener('popstate', () => {
  const top = overlayTop();
  if (top !== 'viewer' && document.querySelector('.viewer')) closeViewer(true);
  if (!top && !sheet.hidden) closeSheet(true);
  dropOverlaySoon(); // под фото было окно, которое уже закрыто, — снимаем и его запись
});
// Переход на другую страницу из окна: запись окна заменяется новой страницей, лишнего шага «назад» нет
// Переход из открытого окна: запись окна наверху истории сразу подменяем адресом страницы.
// Через location.replace Safari переходит не сразу — и «закрытое окно = шаг назад» успевало переход отменить
function goTo(hash) {
  if (overlayTop()) { history.replaceState(null, '', hash); onHashChange(); } else location.hash = hash;
}
// Открыли приложение заново, а наверху истории осталась запись окна — окна уже нет
if (overlayTop()) history.replaceState(null, '', location.href);

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

function saveTrain(ref, allDone = false) {
  const at = new Date();
  const n = (todayTrains()[ref] || 0) + 1; // считаем до записи: хранилище может обновить журнал сразу
  const id = store.addEvent({ type: 'train', card: ref, at, day: S.day });
  const it = todayItems().find((f) => f.card === ref);
  toast(allDone ? 'Все тренировки на сегодня сделаны! Батончик молодец 🐾' : `${TRAIN.label}: ${cardName(ref)}${it ? ` — ${Math.min(n, 99)} из ${targetOf(it)}` : ''}`, {
    label: 'Отменить', onClick: () => { if (id) store.deleteEvent(id); },
  });
}

// ---------- Маленькие радости ----------
// «+1» оставляет отпечаток лапы, последний повтор тренировки и «Освоено» — россыпь лапок, телефон коротко вздрагивает
// (Android). Если в телефоне включено «Уменьшить движение», анимаций нет
const calmMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function haptic(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* нет вибрации */ } }
function joyAt(rect, cls, html, life) {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
  el.innerHTML = html;
  document.body.append(el);
  setTimeout(() => el.remove(), life);
  return el;
}
function pawStamp(rect, text = '+1') {
  if (calmMotion() || !rect) return;
  const el = joyAt(rect, 'paw-stamp', `${pawIcon()}${text ? `<b>${text}</b>` : ''}`, 1000);
  el.style.setProperty('--rot', `${Math.round(Math.random() * 40 - 20)}deg`);
}
function pawBurst(rect, count = 10) {
  if (calmMotion() || !rect) return;
  const colors = ['var(--accent)', '#a65c36', '#d8a47b', 'var(--ok)'];
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const d = 56 + Math.random() * 56;
    const el = joyAt(rect, 'paw-fly', pawIcon(), 1300);
    el.style.setProperty('--dx', `${Math.round(Math.cos(a) * d)}px`);
    el.style.setProperty('--dy', `${Math.round(Math.sin(a) * d - 28)}px`);
    el.style.setProperty('--rot', `${Math.round(Math.random() * 120 - 60)}deg`);
    el.style.setProperty('--size', `${14 + Math.round(Math.random() * 10)}px`);
    el.style.color = colors[i % colors.length];
    el.style.animationDelay = `${i * 14}ms`;
  }
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
  // Уведомления
  'push-on': () => pushEnable(),
  'push-off': async () => {
    const saved = readPush();
    writePush(null);
    render();
    if (saved) await store.pushRemove(saved.id, { unsubscribe: true });
    toast('Уведомления на этом телефоне выключены.');
  },
  'push-test': async () => {
    toast('Отправляем…');
    try {
      const r = await store.pushTest();
      toast(r && r.devices ? 'Отправили. Уведомление придёт через несколько секунд.' : 'Этот телефон не найден на сервере. Выключите и снова включите уведомления.');
    } catch (err) {
      console.error(err);
      toast('Не получилось: сервер уведомлений ещё не выложен или нет интернета.');
    }
  },
  // Уход
  'care-open': (el) => careSheet(el.dataset.id),
  'care-done': (el) => careMark(el.dataset.id, S.day),
  'care-undo': (el) => {
    const item = careItem(el.dataset.id);
    const st = careState(item, S.care[item.id], S.day);
    careSave(item.id, { log: st.log.slice(0, -1) });
    closeSheet();
    render();
    toast('Отметка убрана.');
  },
  // Социализация
  'social-filter': (el) => { S.socialFilter = el.dataset.f; render(); },
  'social-open': (el) => socialSheet(el.dataset.id),
  'social-add': () => socialAddSheet(),
  'social-react': (el) => {
    const id = el.dataset.id;
    const st = socialState(S.social[id]);
    socialSave(id, addReaction(st.log, S.day, el.dataset.r));
    closeSheet();
    render();
    toast(`${socialName(id)}: ${REACTIONS[el.dataset.r].label.toLowerCase()}.`);
  },
  'social-unreact': (el) => {
    const id = el.dataset.id;
    socialSave(id, socialState(S.social[id]).log.filter((x) => x.d !== S.day));
    closeSheet();
    render();
  },
  'social-del': (el) => {
    const id = el.dataset.id;
    if (!confirm(`Удалить «${socialName(id)}» вместе с отметками?`)) return;
    const rest = { ...S.social };
    delete rest[id];
    S.social = rest;
    store.saveSocial(id, null);
    closeSheet();
    render();
  },
  // Сводка для ветеринара
  'summary-share': () => shareText(summaryText(summaryData()), `${DOG()} — для ветеринара`),
  'summary-print': () => window.print(),
  // Если потерялся
  'lost-edit': () => lostSheet(),
  'lost-text': () => shareText(lostText(lostData()), 'Потерялась собака'),
  'lost-share': async () => {
    toast('Готовим картинку…');
    const lines = lostData();
    const blob = await lostPosterImage(lines, S.photo);
    hideToast();
    if (blob) shareFile(blob, 'poteryalas-sobaka.jpg', lostText(lines));
  },
  // Фото месяца
  'month-add': (el) => addMonthPhoto(+el.dataset.n),
  'month-open': (el) => monthSheet(+el.dataset.n),
  'month-view': (el) => {
    const all = S.monthPhotos.all || {};
    const ns = Object.keys(all).map(Number).sort((a, b) => a - b);
    closeSheet();
    setTimeout(() => openViewer(ns.map((n) => all[n].data), Math.max(0, ns.indexOf(+el.dataset.n))), 0);
  },
  'month-replace': (el) => { closeSheet(); addMonthPhoto(+el.dataset.n); },
  'month-day-view': async (el) => {
    const n = +el.dataset.n;
    const p = (S.monthPhotos.all && S.monthPhotos.all[n]) || await store.loadMonthPhoto(n).catch(() => null);
    if (p && p.data) openViewer([p.data]);
  },
  'month-remove': async (el) => {
    const n = +el.dataset.n;
    if (!confirm(`Убрать фото за ${monthsText(n)}?`)) return;
    closeSheet();
    await store.saveMonthPhoto(n, null);
    const all = { ...(S.monthPhotos.all || {}) };
    delete all[n];
    S.monthPhotos.all = all;
    delete S.monthPhotos.thumbs[n];
    const dates = { ...(S.monthDates || {}) };
    delete dates[n];
    S.monthDates = dates;
    render();
  },
  'mark': (el) => {
    const id = el.dataset.id;
    const on = !!getMark(id);
    if (on && el.dataset.confirm && !confirm('Снять отметку «Освоено»?')) return;
    if (on) {
      if (S.marks[id]) store.setMark(id, false);
      legacyIds(id).filter((x) => S.marks[x]).forEach((x) => store.setMark(x, false));
    } else {
      store.setMark(id, true);
      // «Освоено» — россыпь лапок; галочка в списке — отпечаток
      haptic(el.classList.contains('mark-btn') ? [12, 60, 18] : 10);
      if (el.classList.contains('mark-btn')) pawBurst(el.getBoundingClientRect(), 12); else pawStamp(el.getBoundingClientRect(), '');
    }
  },
  'edit-toggle': (el) => { S.edit[el.dataset.section] = !S.edit[el.dataset.section]; render(); },
  // Тренировки на сегодня
  'tr-tap': (el) => {
    const ref = el.dataset.card;
    const p = dayProgress();
    const it = p.items.find((f) => f.card === ref);
    const n = (p.counts[ref] || 0) + 1;
    const rect = el.getBoundingClientRect();
    // Эта тренировка добралась до цели — и, может быть, последняя на сегодня
    const finished = !!it && n === targetOf(it);
    const allDone = finished && p.items.every((f) => f === it || (p.counts[f.card] || 0) >= targetOf(f));
    haptic(finished ? [12, 60, 18] : 10);
    pawStamp(rect);
    saveTrain(ref, allDone);
    if (finished) pawBurst(rect, allDone ? 18 : 9);
  },
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
  // Ссылка из окна: окно закрываем без шага назад — его запись в истории станет страницей, куда ведёт ссылка
  'sheet-close-link': (el) => { closeSheet(true); goTo(el.getAttribute('href')); },
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
  // Нажатие на число — день под календарём; повторное нажатие на то же число — скрыть.
  // «День, который хочется помнить» ещё и встаёт наверх в большую карточку — страница едет вверх, остальные — вниз к дню
  'cal-pick': (el) => {
    const day = el.dataset.day;
    S.cal.sel = S.cal.sel === day ? '' : day;
    S.cal.hit = '';
    S.cal.month = monthOf(day);
    S.cal.feat = isMemorable(S.cal.sel) ? day : '';
    render();
    if (S.cal.sel) scrollDiaryTo(S.cal.feat ? 'top' : 'day');
  },
  'cal-month': (el) => { S.cal.month = addMonths(S.cal.month, +el.dataset.dir); render(); },
  // Другое воспоминание: выбранный особый день уходит из большой карточки; если выпал тот же день — следующее
  'memory-next': () => {
    const was = featureDay();
    S.cal.feat = '';
    S.cal.memShift++;
    if (featureDay() === was) S.cal.memShift++;
    render();
  },
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
    const key = el.dataset.id;
    const on = !S.reads.items[key];
    S.reads = { ...S.reads, items: { ...S.reads.items } };
    if (on) S.reads.items[key] = true; else delete S.reads.items[key];
    store.setRead(key, on);
    // Очки в игре — за первую отметку; снятая и снова поставленная отметка их не добавляет
    const pts = readPoints(key);
    if (on && pts && !gamePlayers().me.read[key]) {
      store.saveGame({ read: { [key]: gameDay() } });
      toast(`Прочитано · +${pts} в игре`);
    }
    render();
  },
  'game-pick': (el) => gamePick(+el.dataset.k),
  'game-invite-off': () => { lsSet('bt.gameInvite', 'off'); render(); },
  'game-next': () => gameNext(),
  'vet-edit': () => vetSheet(),
  'fill-edit': (el) => fillSheet(el.dataset.card, el.dataset.n),
  'chip-edit': () => chipSheet(),
  'jump-to': (el) => { const t = document.getElementById(el.dataset.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'week-edit': (el) => weekSheet(el.dataset.day),
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
  'ask-starter': (el) => askSend(el.dataset.q),
  // Ещё раз тот же вопрос: убираем его и ошибку после него, отправляем заново
  'ask-retry': () => {
    const a = askState();
    const i = a.chat.map((m) => m.r).lastIndexOf('me');
    if (i < 0 || a.busy) return;
    const { t, img } = a.chat[i];
    a.chat = a.chat.slice(0, i);
    askSend(t, img && a.lastPhoto ? a.lastPhoto : null);
  },
  // Фото к вопросу: большое — для Gemini, маленькое — для разговора на телефоне
  'ask-photo': async () => {
    const a = askState();
    if (!canWrite() || a.busy || a.photoBusy) return;
    const file = await pickPhoto();
    if (!file) return;
    a.photoBusy = true;
    updateAskAttach();
    try {
      const full = await compressPhoto(file, { max: 1280, quality: 0.82, limit: 1100000 });
      const thumb = await compressPhoto(file, { max: 360, quality: 0.72, limit: 90000 });
      a.photo = { full, thumb };
    } catch (err) {
      console.error(err);
      toast('Не получилось открыть фото. Попробуйте другое.');
    }
    a.photoBusy = false;
    updateAskAttach();
  },
  'ask-photo-remove': () => { askState().photo = null; updateAskAttach(); },
  'ask-new': () => {
    const a = askState();
    if (a.busy) return;
    a.chat = [];
    saveChat();
    updateAsk({ scroll: false });
  },
  'to-top': () => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }),
  // Учимся оставаться дома
  'alone-start': () => {
    if (!canWrite()) return;
    if (!sess || sess.phase === 'done') {
      sess = { phase: 'setup', stage: aloneStage(), food: 'none', reps: [], id: null, at: null, day: null, note: '' };
      saveSession();
    }
    location.hash = '#/alone/go';
  },
  'alone-new': (el) => { if (canWrite()) aloneSheet(el.dataset.type); },
  'alone-open': (el) => aloneSheet(null, el.dataset.id),
  'alone-del': (el) => {
    if (!confirm('Удалить эту запись?')) return;
    store.deleteAlone(el.dataset.id);
    closeSheet();
    toast('Запись удалена.');
  },
  'alone-chart': (el) => { S.aloneUi.chart = el.dataset.stage; render(); },
  'alone-more': () => { S.aloneUi.more = true; render(); },
  'alone-export': () => aloneExportSheet(),
  'alone-step': (el) => {
    const card = aloneCard();
    const n = Number(el.dataset.n);
    const key = card && card.steps[n - 1];
    if (!key || !confirm(`Отметить шаг ${n} «${aloneStepTitle(n)}» в карточке «Оставаться одному»?`)) return;
    store.setMark(stepId('k', card, key), true);
    toast(`Шаг ${n} отмечен.`);
  },
  'as-stage': (el) => { if (!sess) return; sess.stage = el.dataset.stage; saveSession(); render(); },
  'as-food': (el) => { if (!sess) return; sess.food = el.dataset.food; saveSession(); render(); },
  'as-begin': () => {
    if (!sess) return;
    sess.at = new Date().toISOString();
    sess.day = S.day;
    unlockAudio();
    keepAwake(true);
    toReady();
    render();
  },
  'as-adj': (el) => { if (!sess) return; sess.plan = AL.stepLadder(sess.plan, Number(el.dataset.d)); sess.sugText = 'Длительность изменена вручную.'; saveSession(); render(); },
  'as-go': () => {
    if (!sess) return;
    unlockAudio();
    keepAwake(true);
    sess.phase = 'away';
    sess.awayAt = Date.now();
    saveSession();
    render();
  },
  'as-early': () => {
    if (!sess) return;
    sess.backSec = Math.max(1, Math.min(sess.plan, Math.round((Date.now() - sess.awayAt) / 1000)));
    sess.phase = 'back';
    saveSession();
    render();
  },
  'as-react': (el) => {
    if (!sess || sess.phase !== 'back') return;
    const r = el.dataset.r;
    sess.reps.push({ s: sess.backSec || sess.plan, r, o: null, c: r === 'calm' ? 'na' : '' });
    sess.backSec = null;
    saveSessRecord();
    // Повтор засчитывается и в «Тренировки дня»
    store.addEvent({ type: 'train', card: AL.ALONE_CARD, at: new Date(), day: S.day });
    const sug = AL.suggest(sessOthers(), sess.stage, sess.reps);
    if (sug.done) { sess.phase = 'done'; sess.doneText = sug.done; keepAwake(false); } else {
      sess.phase = 'pause';
      sess.pauseAt = Date.now();
      sess.next = { s: sug.s, text: sug.text };
    }
    saveSession();
    render();
  },
  'as-self': (el) => {
    if (!sess || !sess.reps.length) return;
    const last = sess.reps[sess.reps.length - 1];
    last.c = last.c === el.dataset.c ? '' : el.dataset.c;
    saveSessRecord();
    render();
  },
  'as-next': () => { if (sess) { toReady(); render(); } },
  'as-end': () => {
    if (!sess) return;
    if (!sess.reps.length) {
      if (sess.phase === 'away' && !confirm('Закончить? Этот уход не запишется.')) return;
      sess = null;
      saveSession();
      keepAwake(false);
      leaveSession();
      return;
    }
    if (!confirm(sess.phase === 'away' ? 'Закончить сессию? Текущий уход не запишется.' : 'Закончить сессию?')) return;
    sess.phase = 'done';
    sess.doneText = 'Сессия закончена.';
    keepAwake(false);
    saveSession();
    render();
  },
  'as-finish': () => {
    if (!sess) return;
    const field = view.querySelector('[name="as-note"]');
    const note = field ? field.value.trim().slice(0, 2000) : sess.note || '';
    if (sess.id && note !== (S.alone.find((r) => r.id === sess.id) || {}).note) { sess.note = note; saveSessRecord(); }
    if (sess.reps.length) toast('Сессия записана в дневник.');
    sess = null;
    saveSession();
    keepAwake(false);
    leaveSession();
  },
  'vv-clear': () => {
    try { localStorage.removeItem(VV_LOG); } catch { /* ничего */ }
    render(true);
  },
  'search-clear': () => {
    S.searchQ = '';
    S.searchMore = {};
    const input = view.querySelector('.search-input');
    if (input) { input.value = ''; input.focus(); }
    applySearch();
  },
  'search-more': (el) => {
    S.searchMore[el.dataset.group] = true;
    applySearch();
  },
  // «Отмена» — туда, откуда открыли поиск
  'search-cancel': () => {
    const input = view.querySelector('.search-input');
    if (input) input.blur();
    location.hash = S.searchFrom && S.searchFrom !== '#/search' ? S.searchFrom : '#/';
  },
  'toast-action': () => { const fn = toastAction; hideToast(); if (fn) fn(); },
  'sheet-close': () => closeSheet(),
  'sign-in': () => store.signIn(),
  // Выходя, отписываем этот телефон от уведомлений: иначе они приходили бы и после выхода
  'sign-out': async () => {
    const saved = readPush();
    if (saved) { writePush(null); await store.pushRemove(saved.id, { unsubscribe: true }).catch(() => {}); }
    store.signOut();
  },
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
view.addEventListener('change', (e) => { if (e.target.matches('[data-push]')) pushPrefsChanged(); });
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
// Ошибка iOS 26 (и, по сообщениям, снова в iOS 27): когда клавиатура спряталась, система иногда
// оставляет страницу сдвинутой. Тогда всё закреплённое съезжает вверх: вкладки висят посреди экрана,
// шапка уходит за верхний край — особенно заметно при прокрутке вверх.
// 1. Главное средство: прокрутка «на то же место». После неё iOS сбрасывает застрявший сдвиг —
//    так это лечат в других веб-приложениях, проверено на iPhone. Делаем это, когда поле ввода теряет
//    курсор, когда клавиатура уехала и когда прокрутка остановилась, а сдвиг виден.
// 2. Запасное: если iOS сообщает сдвиг (visualViewport.offsetTop), смещаем шапку и вкладки
//    на эту разницу — только вниз, вверх никогда.
// 3. Что видел телефон, записывается (последние 8 случаев) — это видно в «Настройках» → «Экран iPhone».
const isField = (a) => !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'
  || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color'].includes(a.type)));
const isTyping = () => isField(document.activeElement);
const vvShift = { top: 0, bottom: 0 };
const VV_LOG = 'bt.vvlog';
function viewportNow() {
  const vv = window.visualViewport || { width: window.innerWidth, height: window.innerHeight, offsetTop: 0, scale: 1 };
  return { iw: window.innerWidth, ih: window.innerHeight, vw: Math.round(vv.width), vh: Math.round(vv.height), top: Math.round(vv.offsetTop), scale: +vv.scale || 1, y: Math.round(window.scrollY) };
}
const viewportText = (v) => `окно ${v.iw}×${v.ih}, видно ${v.vw}×${v.vh}, сдвиг ${v.top}, масштаб ${v.scale.toFixed(2)}, прокрутка ${v.y}`;
const isApp = () => window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
const iosVersion = () => { const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); return m ? `iOS ${m[1]}.${m[2]}` : ''; };
let vvLoggedAt = 0;
function logViewport(what, v = viewportNow()) {
  if (what === 'сдвиг' && Date.now() - vvLoggedAt < 15000) return; // одно и то же при прокрутке — не чаще раза в 15 секунд
  vvLoggedAt = Date.now();
  const at = new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  try {
    const list = JSON.parse(localStorage.getItem(VV_LOG) || '[]');
    list.unshift(`${at} · ${what}: ${viewportText(v)}, поправка ${vvShift.top}/${vvShift.bottom}`);
    localStorage.setItem(VV_LOG, JSON.stringify(list.slice(0, 8)));
  } catch { /* ничего */ }
}
// Видна ли ошибка: страница сдвинута или видимая часть меньше окна, хотя клавиатуры нет
const looksShifted = (v) => !isTyping() && Math.abs(v.scale - 1) < 0.02 && (v.top >= 2 || v.ih - v.vh >= 2);

function fitViewport() {
  const vv = window.visualViewport;
  let top = 0;
  let bottom = 0;
  if (vv && !isTyping() && Math.abs(vv.scale - 1) < 0.02) {
    top = Math.round(vv.offsetTop);
    bottom = Math.round(vv.offsetTop + vv.height - window.innerHeight);
    if (top < 2) top = 0;
    if (bottom < 2) bottom = 0;
  }
  if (top === vvShift.top && bottom === vvShift.bottom) return;
  Object.assign(vvShift, { top, bottom });
  document.documentElement.style.setProperty('--vv-top', `${top}px`);
  document.documentElement.style.setProperty('--vv-bottom', `${bottom}px`);
  if (top || bottom) logViewport('сдвиг');
}

// Прокрутка на то же место: iOS пересчитывает экран и сбрасывает застрявший сдвиг
let lastHealAt = 0;
function healViewport(why) {
  if (isTyping()) return;
  const before = viewportNow();
  lastHealAt = Date.now();
  window.scrollTo(window.scrollX, window.scrollY);
  requestAnimationFrame(() => {
    fitViewport();
    if (looksShifted(before)) {
      const after = viewportNow();
      logViewport(`${why}: было`, before);
      if (looksShifted(after)) logViewport('и осталось', after);
    }
  });
}

if (window.visualViewport) {
  let vvHeight = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    fitViewport();
    // Клавиатура уехала (видимая часть выросла), а курсора в поле уже нет
    const h = window.visualViewport.height;
    if (h > vvHeight + 60 && !isTyping()) setTimeout(() => healViewport('клавиатура скрылась'), 80);
    vvHeight = h;
  });
  window.visualViewport.addEventListener('scroll', fitViewport);
}
// Прокрутка остановилась, а страница сдвинута — лечим (во время прокрутки не трогаем, чтобы не сбить её)
let scrollIdle = 0;
let lastScrollAt = 0;
window.addEventListener('scroll', () => {
  lastScrollAt = Date.now();
  fitViewport();
  clearTimeout(scrollIdle);
  scrollIdle = setTimeout(() => {
    if (looksShifted(viewportNow()) && Date.now() - lastHealAt > 1500) healViewport('после прокрутки');
  }, 250);
}, { passive: true });
window.addEventListener('resize', fitViewport);
window.addEventListener('pageshow', () => { fitViewport(); healViewport('открыли снова'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { fitViewport(); healViewport('вернулись в приложение'); } });
document.addEventListener('focusin', fitViewport);
// Поле ввода потеряло курсор и другое его не взяло — клавиатура уезжает. Лечим сразу и когда она точно скрылась.
// Кнопка — не поле: на Android нажатая кнопка получает фокус и теряет его при перерисовке, клавиатуры не было,
// а прокрутка «на то же место» оборвала бы плавную прокрутку (например, к дню под календарём)
document.addEventListener('focusout', (e) => {
  if (!isField(e.target)) return;
  setTimeout(() => healViewport('поле закрыто'), 50);
  // Второй раз — если уже не листают: прокрутка «на место» остановила бы движение пальцем
  setTimeout(() => { if (Date.now() - lastScrollAt > 300) healViewport('поле закрыто'); }, 450);
  [60, 900].forEach((ms) => setTimeout(fitViewport, ms));
});

document.querySelector('#search-btn').addEventListener('click', openSearch);

// Если экран всё же съехал: пять нажатий подряд на открытую вкладку — размеры экрана в сообщении (для скриншота)
let diagTaps = [];
document.querySelector('.tabbar').addEventListener('click', (e) => {
  if (!e.target.closest('a[aria-current]')) return;
  const now = Date.now();
  diagTaps = [...diagTaps.filter((t) => now - t < 3000), now];
  if (diagTaps.length < 5) return;
  diagTaps = [];
  const v = viewportNow();
  logViewport('5 нажатий', v);
  toast(`Экран: ${viewportText(v)}, экран ${screen.width}×${screen.height}, поправка ${vvShift.top}/${vvShift.bottom}, ${isApp() ? 'с экрана «Домой»' : 'в браузере'}${iosVersion() ? `, ${iosVersion()}` : ''}`);
});

// «Настройки» → «Экран iPhone»: что сейчас и последние сбои
function viewportPanelHtml() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(VV_LOG) || '[]'); } catch { /* ничего */ }
  return `<section class="section panel"><h2>Экран iPhone</h2>
    <p class="muted">Если вкладки внизу снова повиснут посреди экрана, сделайте снимок этого раздела и пришлите его: по этим цифрам видно, что сделал телефон.</p>
    <p class="vv-now small">Сейчас: ${escapeHtml(viewportText(viewportNow()))}, ${isApp() ? 'с экрана «Домой»' : 'в браузере'}${iosVersion() ? `, ${iosVersion()}` : ''}</p>
    ${list.length ? `<ul class="vv-log small">${list.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      <button class="btn small" data-action="vv-clear">Очистить список</button>` : '<p class="muted small">Сбоев пока не замечено.</p>'}
  </section>`;
}

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
  if (document.body.dataset.tab) updateThemeColor();
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
takeDayLink();
currentHash = location.hash || '#/';
renderHeader();
render();
store.setDay(S.day);
store.start();
loadContent();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
