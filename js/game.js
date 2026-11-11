// Игра «Разминка дня» (вкладка «Советы» → «Игра»): вопросы из content/igra.md, очки, серии, рейтинг недели.
// Только расчёты — без страниц и хранения, чтобы их можно было проверить отдельно.
//
// Данные игрока (game/{uid} в Firestore, bt.game в локальном режиме):
//   days:  { 'YYYY-MM-DD': { q: [id вопросов], p: [выбранный вариант], ok: [верно ли], fix, r } } — разминка дня;
//          fix — сколько ошибок исправлено в этот день (+5 за каждую), r — сколько повторов ошибок сделано
//   rep:   { id: { box, due, paid } } — ошибки, которые вернутся: box 0 → через 1 день, 1 → через 3, 2 → через 7
//   known: { id: 1 } — вопросы, на которые хоть раз ответили верно (прогресс по темам)
//   read:  { 'a_статья': 'YYYY-MM-DD' } — когда впервые отметили «Прочитано» в Библиотеке (очки за чтение)

import { stripComments, hash } from './md.js';
import { addDays, mondayOf } from './diary.js';

export const FORMATS = [
  { key: 'myth', title: 'Правда или миф?', icon: '🔍', defaults: ['Правда', 'Миф'] },
  { key: 'do', title: 'Что делать?', icon: '💡' },
  { key: 'safe', title: 'Можно или опасно?', icon: '⚠️', defaults: ['Можно', 'Опасно'] },
  { key: 'feel', title: 'Что он чувствует?', icon: '🐾' },
  { key: 'word', title: 'Что значит слово?', icon: '🔤' },
];
export const TOPICS = ['Поведение', 'Тренировки и игры', 'Здоровье', 'Питание', 'Уход и амуниция', 'Город и поездки', 'Активность и спорт'];

export const DAILY = 5;      // вопросов в разминке
export const REPEAT_MAX = 3; // повторов ошибок в день
export const POINTS = { right: 10, perfect: 10, fix: 5 };
// Очки за «Прочитано» в Библиотеке: статья — 5, вопрос-ответ и миф — 2
export const READ_POINTS = { a: 5, qa: 2, myths: 2 };
export const LEVELS = [[0, 'Щенок'], [200, 'Подросток'], [600, 'Пастух'], [1200, 'Знаток породы'], [2400, 'Мастер аусси']];
const REPEAT_GAPS = [1, 3, 7];

const FIELD_RE = /^\*\*(Тема|Ответ|Пояснение|Подробнее):\*\*\s*(.*)$/;
const norm = (s) => String(s).trim().toLowerCase().replace(/ё/g, 'е');

// ---------- Вопросы ----------

export function parseQuestions(source) {
  const qs = [];
  const errors = [];
  let format = null;
  let q = null;
  let field = null;
  const finish = () => {
    if (!q) return;
    const where = `«${q.text.slice(0, 60)}»`;
    if (!q.options.length && format && format.defaults) {
      q.options = format.defaults.slice();
      q.answer = q.answerText ? q.options.findIndex((o) => norm(o) === norm(q.answerText)) : -1;
    } else if (q.answer < 0 && q.answerText) q.answer = q.options.findIndex((o) => norm(o) === norm(q.answerText));
    if (q.options.length < 2) errors.push(`Вопрос ${where}: нужно хотя бы два варианта ответа.`);
    else if (q.answer < 0) errors.push(`Вопрос ${where}: не отмечен правильный ответ («- * » или «**Ответ:**»).`);
    else if (q.topic && !TOPICS.includes(q.topic)) errors.push(`Вопрос ${where}: неизвестная тема «${q.topic}».`);
    else {
      let id = hash(`${q.format}|${norm(q.text)}`);
      if (qs.some((x) => x.id === id)) errors.push(`Вопрос ${where} повторяется.`);
      else qs.push({ id, format: q.format, text: q.text, topic: q.topic || TOPICS[0], options: q.options, answer: q.answer, why: q.why.trim(), more: q.more });
    }
    q = null;
  };
  for (const raw of stripComments(source).split('\n')) {
    const line = raw.trim();
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      finish();
      format = FORMATS.find((f) => norm(f.title) === norm(h1[1])) || null;
      if (!format) errors.push(`Неизвестный формат «${h1[1]}» — вопросы под ним пропущены.`);
      continue;
    }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      finish();
      if (format) q = { format: format.key, text: h2[1], topic: '', options: [], answer: -1, answerText: '', why: '', more: null };
      field = null;
      continue;
    }
    if (!q || !line) continue;
    const f = line.match(FIELD_RE);
    if (f) {
      field = null;
      if (f[1] === 'Тема') q.topic = f[2].trim();
      else if (f[1] === 'Ответ') q.answerText = f[2].trim();
      else if (f[1] === 'Пояснение') { q.why = f[2]; field = 'why'; }
      else {
        const m = f[2].match(/\[([^\]]+)\]\((#\/[^)\s]+)\)/);
        if (m) q.more = { title: m[1], href: m[2] };
      }
      continue;
    }
    const opt = line.match(/^-\s+(\*\s+)?(.*)$/);
    if (opt) {
      if (opt[1]) q.answer = q.options.length;
      q.options.push(opt[2].trim());
      field = null;
      continue;
    }
    if (field === 'why') q.why += ` ${line}`;
  }
  finish();
  return { qs, byId: new Map(qs.map((x) => [x.id, x])), errors };
}

export const formatOf = (q) => FORMATS.find((f) => f.key === q.format) || FORMATS[0];
// «Правда / Миф» и «Можно / Опасно» — всегда в этом порядке, остальные варианты перемешаны (одинаково весь день)
export function optionOrder(q, salt) {
  const order = q.options.map((_, k) => k);
  if (formatOf(q).defaults && q.options.length === 2) return order;
  const r = (k) => parseInt(hash(`${q.id}:${k}:${salt}`), 36);
  return order.sort((a, b) => r(a) - r(b));
}

// ---------- Разминка дня ----------

// Когда вопрос в последний раз попадал в разминку — у кого угодно из игроков (до сегодняшнего дня)
export function lastUsed(players, today) {
  const used = new Map();
  for (const p of players) {
    for (const [day, rec] of Object.entries(p.days || {})) {
      if (day >= today || !rec || !Array.isArray(rec.q)) continue;
      rec.q.forEach((id) => { if (!used.has(id) || used.get(id) < day) used.set(id, day); });
    }
  }
  return used;
}

// 5 вопросов, у всех игроков одинаковые: сначала те, что ещё никому не попадались, по одному каждого формата.
// Когда новые кончатся — те, что попадались давнее всего. Порядок «случайный», но одинаковый на обоих телефонах
export function pickDaily(qs, used, n = DAILY) {
  const rank = (q) => parseInt(hash(`${q.id}:v1`), 36);
  const fresh = qs.filter((q) => !used.has(q.id)).sort((a, b) => rank(a) - rank(b));
  const old = qs.filter((q) => used.has(q.id)).sort((a, b) => {
    const da = used.get(a.id);
    const db = used.get(b.id);
    return da < db ? -1 : da > db ? 1 : rank(a) - rank(b);
  });
  const out = [];
  const take = (list, oneEach) => {
    for (const q of list) {
      if (out.length >= n) return;
      if (out.includes(q) || (oneEach && out.some((x) => x.format === q.format))) continue;
      out.push(q);
    }
  };
  take(fresh, true); take(fresh, false); take(old, true); take(old, false);
  const pos = (q) => FORMATS.findIndex((f) => f.key === q.format);
  return out.sort((a, b) => pos(a) - pos(b));
}

// Вопросы разминки на сегодня: свои начатые, иначе — те же, что уже у другого игрока, иначе — новые
export function todayIds(qs, me, players, today) {
  const mine = me && me.days && me.days[today];
  if (mine && Array.isArray(mine.q)) return mine.q;
  const other = players.find((p) => p !== me && p.days && p.days[today] && Array.isArray(p.days[today].q));
  if (other) return other.days[today].q;
  return pickDaily(qs, lastUsed(players, today)).map((q) => q.id);
}

export const answered = (rec) => (rec && Array.isArray(rec.p) ? rec.p.length : 0);
export const finished = (rec) => !!(rec && Array.isArray(rec.q) && rec.q.length && answered(rec) >= rec.q.length);
export const rightCount = (rec) => (rec && Array.isArray(rec.ok) ? rec.ok.filter(Boolean).length : 0);

// ---------- Очки ----------

export function roundPoints(rec) {
  if (!rec) return 0;
  const right = rightCount(rec);
  const perfect = finished(rec) && rec.q.length >= DAILY && right === rec.q.length;
  return right * POINTS.right + (perfect ? POINTS.perfect : 0) + (rec.fix || 0) * POINTS.fix;
}
export const readPoints = (key) => READ_POINTS[String(key).split('_')[0]] || 0;

// Очки по дням: разминка, исправленные ошибки и чтение
export function pointsByDay(player) {
  const out = {};
  for (const [day, rec] of Object.entries((player && player.days) || {})) out[day] = (out[day] || 0) + roundPoints(rec);
  for (const [key, day] of Object.entries((player && player.read) || {})) if (typeof day === 'string') out[day] = (out[day] || 0) + readPoints(key);
  return out;
}
const sum = (byDay, from = '', to = '9999') => Object.entries(byDay).reduce((a, [d, v]) => (d >= from && d <= to ? a + v : a), 0);
export const totalPoints = (player) => sum(pointsByDay(player));
export const weekPoints = (player, monday) => sum(pointsByDay(player), monday, addDays(monday, 6));

export function level(total) {
  let i = 0;
  while (i + 1 < LEVELS.length && total >= LEVELS[i + 1][0]) i++;
  const [from, name] = LEVELS[i];
  const next = LEVELS[i + 1];
  return { i, name, next: next ? next[1] : null, toNext: next ? next[0] - total : 0, frac: next ? (total - from) / (next[0] - from) : 1 };
}

// Серия: дни подряд с пройденной разминкой. Один пропуск в неделю (пн–вс) серию не обрывает.
// Сегодня ещё не сыграли — серия считается от вчера и пока не сгорела
export function streak(played, today) {
  const days = [...played].sort();
  if (!days.length) return 0;
  const first = days[0];
  const has = new Set(days);
  let d = has.has(today) ? today : addDays(today, -1);
  let n = 0;
  const frozen = new Set();
  while (d >= first) {
    if (has.has(d)) n++;
    else {
      const w = mondayOf(d);
      if (frozen.has(w)) break;
      frozen.add(w);
    }
    d = addDays(d, -1);
  }
  return n;
}
export const playedDays = (player) => Object.entries((player && player.days) || {}).filter(([, rec]) => finished(rec)).map(([d]) => d);
// Общая серия: дни, когда разминку прошли все игроки
export function sharedDays(players) {
  if (players.length < 2) return [];
  const sets = players.map((p) => new Set(playedDays(p)));
  return [...sets[0]].filter((d) => sets.every((s) => s.has(d)));
}

// Кубки: за каждую прошедшую неделю — тому, у кого больше очков (при ничьей — никому)
export function trophies(players, today) {
  const out = new Map(players.map((p) => [p, 0]));
  if (players.length < 2) return out;
  const byDay = players.map((p) => pointsByDay(p));
  const firstDay = byDay.flatMap((b) => Object.keys(b)).sort()[0];
  if (!firstDay) return out;
  const thisWeek = mondayOf(today);
  for (let w = mondayOf(firstDay); w < thisWeek; w = addDays(w, 7)) {
    const pts = byDay.map((b) => sum(b, w, addDays(w, 6)));
    const max = Math.max(...pts);
    if (max > 0 && pts.filter((x) => x === max).length === 1) {
      const p = players[pts.indexOf(max)];
      out.set(p, out.get(p) + 1);
    }
  }
  return out;
}

// ---------- Повтор ошибок ----------

// Какие ошибки пора повторить сегодня (не больше трёх в день, если вопрос ещё есть в файле)
export function dueRepeats(player, byId, today) {
  const rec = player && player.days && player.days[today];
  const left = REPEAT_MAX - ((rec && rec.r) || 0);
  if (left <= 0) return [];
  return Object.entries((player && player.rep) || {})
    .filter(([id, v]) => v && typeof v.due === 'string' && v.due <= today && byId.has(id))
    .sort((a, b) => (a[1].due < b[1].due ? -1 : a[1].due > b[1].due ? 1 : a[0] < b[0] ? -1 : 1))
    .slice(0, left).map(([id]) => id);
}

// Ответ на повтор: верно — вопрос вернётся реже (1 → 3 → 7 дней) и потом уйдёт из повторов;
// ошибка — снова через день. Очки (+5) — только за первое исправление
export function afterRepeat(entry, ok, today) {
  const e = entry || { box: 0, paid: false };
  if (!ok) return { entry: { box: 0, due: addDays(today, REPEAT_GAPS[0]), paid: !!e.paid }, paid: false };
  const box = (e.box || 0) + 1;
  const paid = !e.paid;
  if (box >= REPEAT_GAPS.length) return { entry: null, paid };
  return { entry: { box, due: addDays(today, REPEAT_GAPS[box]), paid: true }, paid };
}
export const newMistake = (today) => ({ box: 0, due: addDays(today, REPEAT_GAPS[0]), paid: false });

// ---------- Прогресс по темам ----------

export function topicProgress(qs, known) {
  return TOPICS.map((topic) => {
    const list = qs.filter((q) => q.topic === topic);
    return { topic, total: list.length, known: list.filter((q) => known && known[q.id]).length };
  }).filter((t) => t.total);
}
