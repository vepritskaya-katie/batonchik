// «Дневник одиночества»: записи тренировок «Оставаться одному», подсказка длительности, рекорды,
// условия шагов карточки, сводка за неделю и выгрузка CSV. Здесь только расчёты — без экрана и хранилища.

import { addDays, fmtTime, dayTitle, TZ } from './diary.js';
import { escapeHtml } from './md.js';

export const ALONE_CARD = 'k/ostavatsya-odnomu';

// Ступени: где он остаётся один
export const STAGES = [
  ['gate', 'Комната · ворота'],
  ['door', 'Комната · дверь'],
  ['front', 'Входная дверь'],
  ['both', 'Уходим вдвоём'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
// Коротко — для переключателя графика
export const STAGE_SHORT = { gate: 'Ворота', door: 'Дверь', front: 'Входная', both: 'Вдвоём' };
export const TYPES = {
  train: { icon: '🎯', label: 'Тренировка' },
  check: { icon: '📹', label: 'Проверка' },
  forced: { icon: '🚪', label: 'Вынужденный уход' },
};
export const REACT = {
  calm: { icon: '🟢', label: 'Спокоен', hint: 'лежит или занимается своим, без звуков' },
  worry: { icon: '🟡', label: 'Беспокоится', hint: 'ходит, смотрит на дверь, прислушивается, но молчит' },
  voice: { icon: '🔴', label: 'Голос', hint: 'скулит, воет, лает, царапает дверь' },
};
export const SELF = { yes: 'да', no: 'нет', na: 'не нужно было' };
export const FOOD = { none: 'без еды', kong: 'конг', lick: 'лизательный коврик' };
// Только для проверки: что делал перед беспокойством
export const DID = { door: 'смотрел на дверь', listen: 'прислушивался к подъезду', walk: 'ходил', lay: 'лёг' };
// Только для вынужденного ухода: что было
export const PREP = { walk: 'прогулка перед уходом', quiet: 'тихая комната', noise: 'белый шум', kong: 'конг или коврик' };

export const MAX_REPS = 8;     // повторов в сессии
export const LONG = 600;       // после 10 минут — один уход за сессию
export const PAUSE_SEC = 90;   // пауза между повторами
const REPS_LIMIT = 30;         // столько повторов помещается в одну запись

// Лестница длительностей, секунды: 1–45 с, 1–60 мин, дальше +15 минут до 4 часов
export const LADDER = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45,
  60, 90, 120, 180, 240, 300, 420, 600, 720, 900, 1200, 1500, 1800, 2400, 3000, 3600];
for (let s = 3600 + 900; s <= 4 * 3600; s += 900) LADDER.push(s);

// Номер ступеньки лестницы: самая длинная, что не длиннее sec (42 с → 30 с)
export function floorIdx(sec) {
  let i = 0;
  for (let k = 0; k < LADDER.length; k++) if (LADDER[k] <= sec) i = k;
  return i;
}

// ---------- Время ----------

// «45 с», «1,5 мин», «5 мин», «1 мин 20 с», «1 ч 15 мин»
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s} с`;
  if (s < 3600) {
    if (s % 60 === 0) return `${s / 60} мин`;
    if (s % 30 === 0) return `${String(s / 60).replace('.', ',')} мин`;
    return `${Math.floor(s / 60)} мин ${s % 60} с`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
// Часы таймера: «0:45», «12:05», «1:00:00»
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---------- Записи ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pick = (v, map, dflt) => (typeof v === 'string' && v in map ? v : dflt);
const list = (v, map) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x in map))] : []);

// Повтор: s — секунды, r — реакция, o — через сколько секунд началось беспокойство (null — не записано),
// c — успокоился сам: yes / no / na (не нужно было) / '' (не записано)
export function cleanRep(x) {
  if (!x || typeof x !== 'object') return null;
  const s = Math.round(Number(x.s));
  if (!Number.isFinite(s) || s < 1 || s > 24 * 3600) return null;
  if (!(x.r in REACT)) return null;
  const o = Number.isFinite(Number(x.o)) && x.o !== null && x.o !== '' ? Math.max(0, Math.min(s, Math.round(Number(x.o)))) : null;
  return { s, r: x.r, o, c: pick(x.c, SELF, '') };
}

// Запись: { id, type, stage, food, reps, did, prep, note, at: Date, day, uid, name }
export function cleanRecord(v, id) {
  if (!v || typeof v !== 'object' || !(v.type in TYPES)) return null;
  const at = v.at instanceof Date ? v.at : new Date(v.at);
  if (Number.isNaN(at.getTime()) || !DAY_RE.test(v.day || '')) return null;
  const reps = (Array.isArray(v.reps) ? v.reps : []).map(cleanRep).filter(Boolean).slice(0, REPS_LIMIT);
  if (!reps.length) return null;
  return {
    id: String(id || v.id || ''), type: v.type, stage: pick(v.stage, STAGE_LABEL, v.type === 'forced' ? 'front' : 'gate'),
    food: pick(v.food, FOOD, 'none'), reps,
    did: v.type === 'check' ? list(v.did, DID) : [], prep: v.type === 'forced' ? list(v.prep, PREP) : [],
    note: typeof v.note === 'string' ? v.note.slice(0, 2000) : '',
    at, day: v.day, uid: typeof v.uid === 'string' ? v.uid : '', name: typeof v.name === 'string' ? v.name : '',
  };
}

const byAt = (a, b) => a.at - b.at;
const trains = (recs, stage) => recs.filter((r) => r.type === 'train' && (!stage || r.stage === stage)).sort(byAt);
// Лучшая спокойная длительность в записи (0 — спокойных повторов не было)
export const bestCalm = (rec) => rec.reps.reduce((m, x) => (x.r === 'calm' && x.s > m ? x.s : m), 0);
// Длительность записи: у сессии — самый долгий повтор, у проверки и вынужденного ухода — единственный
export const recDuration = (rec) => rec.reps.reduce((m, x) => Math.max(m, x.s), 0);

// Рекорд ступени — самая длинная длительность с 🟢 на тренировках (до момента before, если задан)
export function stageRecord(recs, stage, before = null) {
  return trains(recs, stage).filter((r) => !before || r.at < before).reduce((m, r) => Math.max(m, bestCalm(r)), 0);
}
export const allRecords = (recs) => Object.fromEntries(STAGES.map(([k]) => [k, stageRecord(recs, k)]));

// ---------- Подсказка длительности ----------

export const KIND_TEXT = {
  start: 'Первый повтор — с самого короткого.',
  warm: 'Разминка: на два шага ниже рекорда.',
  halfFront: 'Вдвоём — начинаем с половины рекорда за входной дверью.',
  up: 'Был спокоен — чуть дольше.',
  same: 'Беспокоился — ещё раз столько же.',
  down: 'Дважды подряд беспокоился — на шаг короче.',
  easy: 'Лёгкий повтор: после двух удлинений — короче.',
  resume: 'Продолжаем с того места, где остановились.',
  half: 'Был голос — вдвое короче.',
  next: 'Продолжаем с прошлой сессии.',
};
export const FINISH_ON_SUCCESS = 'Закончите на успехе: ещё один спокойный повтор — и на сегодня всё.';

// Следующая ступенька по повторам seq (от старых к новым). capIdx — выше этого номера не подсказываем
function nextFrom(seq, capIdx) {
  const n = seq.length;
  const I = seq.map((x) => floorIdx(x.s));
  const last = seq[n - 1];
  const li = I[n - 1];
  let i;
  let kind;
  if (last.r === 'voice') {
    i = floorIdx(last.s / 2);
    kind = 'half';
  } else if (last.r === 'worry') {
    let k = 0;
    for (let j = n - 1; j >= 0 && seq[j].r === 'worry'; j--) k++;
    if (k % 2 === 0) { i = li - 1; kind = 'down'; } else { i = li; kind = 'same'; }
  } else {
    const up = (j) => j > 0 && seq[j].r === 'calm' && I[j] > I[j - 1];
    let ups = 0;
    for (let j = n - 1; j >= 0 && up(j); j--) ups++;
    if (ups >= 2) { i = li - 3; kind = 'easy'; } else if (n >= 2 && seq[n - 2].r === 'calm' && I[n - 1] < I[n - 2]) {
      i = I[n - 2] + 1; kind = 'resume';
    } else { i = li + 1; kind = 'up'; }
  }
  i = Math.max(0, Math.min(i, capIdx));
  return { s: LADDER[i], kind };
}

// Подсказка для следующего повтора сессии на ступени stage.
// recs — все записи, кроме текущей сессии; reps — повторы текущей сессии.
// Ответ: { s, kind, text } или { done: 'почему на сегодня всё' }
export function suggest(recs, stage, reps = []) {
  const prior = trains(recs, stage);
  const before = prior.reduce((m, r) => Math.max(m, bestCalm(r)), 0);
  const record = Math.max(before, bestCalm({ reps }));
  const capIdx = record ? floorIdx(record) + 1 : 0;
  const n = reps.length;
  let redAt = -1;
  reps.forEach((x, i) => { if (x.r === 'voice') redAt = i; });
  if (redAt >= 0 && reps.slice(redAt + 1).some((x) => x.r === 'calm')) return { done: 'Закончили на спокойном повторе — на сегодня всё.' };
  if (redAt < 0 && reps.some((x) => x.s >= LONG)) return { done: 'После 10 минут — один уход за сессию. На сегодня всё.' };
  if (n >= MAX_REPS) return { done: `${MAX_REPS} повторов — на сегодня всё.` };
  let out;
  if (!n) {
    if (before >= LONG && prior.length) {
      // Длинные уходы: один за сессию, длительность — по тому, как прошли прошлые сессии
      const nx = nextFrom(prior.map((r) => r.reps[r.reps.length - 1]), capIdx);
      out = { ...nx, kind: nx.kind === 'up' ? 'next' : nx.kind };
    } else if (!before) {
      const front = stage === 'both' ? stageRecord(recs, 'front') : 0;
      out = front ? { s: LADDER[floorIdx(front / 2)], kind: 'halfFront' } : { s: LADDER[0], kind: 'start' };
    } else out = { s: LADDER[Math.max(0, floorIdx(before) - 2)], kind: 'warm' };
  } else out = nextFrom(reps, capIdx);
  const text = redAt >= 0 ? FINISH_ON_SUCCESS : KIND_TEXT[out.kind];
  return { ...out, text: out.s >= LONG ? `${text} После 10 минут — один уход за сессию.` : text, red: redAt >= 0 };
}

// Ступенька выше или ниже: «−» и «+» на экране повтора
export const stepLadder = (sec, d) => LADDER[Math.max(0, Math.min(LADDER.length - 1, floorIdx(sec) + d))];

// ---------- Шаги карточки ----------

// Номер шага → условие «Дальше, когда» по дневнику. Шаг 3 («сигналы ухода») идёт параллельно — в дневнике его нет
const STEP_RULES = {
  1: { check: 'room' }, 2: { check: 'front' },
  4: { stage: 'gate', sec: 300, n: 2 }, 5: { stage: 'door', sec: 300, n: 2 },
  6: { stage: 'front', run: 3 },
  7: { stage: 'front', sec: 60, n: 2 }, 8: { stage: 'front', sec: 300, n: 2 },
  9: { stage: 'front', sec: 900, n: 2 }, 10: { stage: 'front', sec: 1800, n: 2 },
  11: { stage: 'both', match: 'front' },
  12: { stage: 'front', sec: 3600, n: 2 }, 13: { stage: 'front', sec: 3 * 3600, n: 3 },
};
export const STEP_STAGE = { 1: 'gate', 2: 'front', 4: 'gate', 5: 'door', 6: 'front', 7: 'front', 8: 'front', 9: 'front', 10: 'front', 11: 'both', 12: 'front', 13: 'front' };
const ORDER = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const ROOM = ['gate', 'door'];

const checks = (recs, where) => recs.filter((r) => r.type === 'check' && (where === 'room' ? ROOM.includes(r.stage) : r.stage === 'front')).sort(byAt);
// Последняя проверка в комнате: true — спокоен во всех повторах, false — нет, null — проверки не было
export function roomCheckCalm(recs) {
  const last = checks(recs, 'room').pop();
  return last ? last.reps.every((x) => x.r === 'calm') : null;
}
export const hasChecks = (recs) => checks(recs, 'room').length > 0 && checks(recs, 'front').length > 0;

// Выполнено ли условие «Дальше, когда» шага num
export function stepMet(num, recs) {
  const rule = STEP_RULES[num];
  if (!rule) return false;
  if (rule.check) return checks(recs, rule.check).length > 0;
  if (rule.match) {
    const both = stageRecord(recs, rule.stage);
    return both > 0 && both >= stageRecord(recs, rule.match);
  }
  const list = trains(recs, rule.stage);
  if (rule.run) {
    const reps = list.flatMap((r) => r.reps);
    let k = 0;
    for (let j = reps.length - 1; j >= 0 && reps[j].r === 'calm'; j--) k++;
    return k >= rule.run;
  }
  const last = list.slice(-rule.n);
  return last.length === rule.n && last.every((r) => bestCalm(r) >= rule.sec);
}

// Текущий шаг — первый неотмеченный (без шага 3). Если проверка в комнате прошла спокойно, шаги 4–5 пропускаем
export function currentStep(done, recs) {
  const skipRoom = roomCheckCalm(recs) === true;
  return ORDER.find((n) => !done.has(n) && !(skipRoom && (n === 4 || n === 5))) || null;
}

// «Застряли»: три сессии подряд на ступени с 🔴 или рекорд не вырос за 21 день
export function stuckOn(recs, stage, now = new Date()) {
  const list = trains(recs, stage);
  if (list.length >= 3 && list.slice(-3).every((r) => r.reps.some((x) => x.r === 'voice'))) return 'red';
  const from = new Date(now.getTime() - 21 * 86400000);
  if (!list.length || list[0].at > from) return null;
  if (list.filter((r) => r.at >= from).length < 3) return null;
  return stageRecord(recs, stage) <= stageRecord(recs, stage, from) ? 'flat' : null;
}

// ---------- Сводка ----------

// Неделя с понедельника monday по воскресенье: сессии, рекорд недели, вынужденные уходы дольше рекорда, день отдыха
export function weekStats(recs, monday, today) {
  const sunday = addDays(monday, 6);
  const inWeek = (r) => r.day >= monday && r.day <= sunday;
  const tr = trains(recs).filter(inWeek);
  let best = 0;
  let bestStage = '';
  tr.forEach((r) => { const b = bestCalm(r); if (b > best) { best = b; bestStage = r.stage; } });
  const forced = recs.filter((r) => r.type === 'forced' && inWeek(r));
  const forcedOver = forced.filter((r) => recDuration(r) > stageRecord(recs, 'front', r.at)).length;
  const last = today < sunday ? today : sunday;
  let restDay = false;
  for (let d = monday; d <= last; d = addDays(d, 1)) if (!tr.some((r) => r.day === d)) { restDay = true; break; }
  return { sessions: tr.length, best, bestStage, forced: forced.length, forcedOver, restDay };
}

// Для графика: лучшая спокойная длительность по дням (только тренировки на ступени) и вынужденные уходы с 🔴
export function dailyBest(recs, stage) {
  const out = new Map();
  trains(recs, stage).forEach((r) => { const b = bestCalm(r); if (b && b > (out.get(r.day) || 0)) out.set(r.day, b); });
  return [...out].map(([day, s]) => ({ day, s })).sort((a, b) => (a.day < b.day ? -1 : 1));
}
export const forcedRed = (recs) => recs.filter((r) => r.type === 'forced' && r.reps.some((x) => x.r === 'voice'))
  .map((r) => ({ day: r.day, s: recDuration(r) })).sort((a, b) => (a.day < b.day ? -1 : 1));

// Пункты «Признаков прогресса», которые по дневнику уже выполнены (отметку ставит человек)
export function checklistHints(recs) {
  const rec = allRecords(recs);
  const f = rec.front;
  return {
    'Проверки на камеру сделаны и записаны': hasChecks(recs),
    '1 минута один за входной дверью — спокойно': f >= 60,
    '5 минут один — спокойно': f >= 300,
    '15 минут один — спокойно': f >= 900,
    '30 минут один — спокойно': f >= 1800,
    'Спокоен, когда уходим вдвоём': rec.both > 0,
    '1 час один — спокойно': f >= 3600,
    '3 часа один — спокойно': f >= 3 * 3600,
  };
}

// ---------- Выгрузка ----------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmtDay = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

// CSV для специалиста: строка — повтор. Разделитель «;» и BOM — чтобы Excel на русском открыл без вопросов
export function toCsv(recs, from, to) {
  const head = ['Дата', 'Время', 'Кто', 'Тип', 'Ступень', 'Повтор', 'Длительность, с', 'Длительность', 'Реакция',
    'Беспокойство через, с', 'Успокоился сам', 'Еда', 'Перед беспокойством', 'Что было перед уходом', 'Заметка'];
  const rows = [head];
  recs.filter((r) => r.day >= from && r.day <= to).sort(byAt).forEach((r) => {
    r.reps.forEach((x, i) => rows.push([
      fmtDay(r.at), fmtTime(r.at), r.name, TYPES[r.type].label, r.type === 'forced' ? '' : STAGE_LABEL[r.stage],
      r.type === 'train' ? i + 1 : '', x.s, fmtDur(x.s), `${REACT[x.r].icon} ${REACT[x.r].label}`,
      x.o ?? '', x.c ? SELF[x.c] : '', FOOD[r.food], r.did.map((k) => DID[k]).join(', '), r.prep.map((k) => PREP[k]).join(', '),
      i === 0 ? r.note : '',
    ]));
  });
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// ---------- График ----------

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const shortDay = (d) => dayTitle(d, { day: 'numeric', month: 'short' }).replace('.', '');
// Отметки шкалы — примерно через равные шаги по логарифмической шкале; берём те, что попадают в диапазон
const TICKS = [1, 10, 60, 600, 3600, 4 * 3600];

// Лучшая спокойная длительность по дням — линия, вынужденные уходы с 🔴 — красные точки.
// Шкала логарифмическая: на одном графике видны и секунды, и часы
export function aloneChartSvg(points, reds = []) {
  const all = [...points, ...reds];
  if (!all.length) return '';
  const W = 340, H = 200, L = 54, R = 10, T = 30, B = 28, PAD = 12;
  const lo = Math.max(1, Math.min(...all.map((p) => p.s)) / 1.6);
  const hi = Math.max(...all.map((p) => p.s)) * 1.6;
  const ly = (v) => Math.log10(v);
  const y = (v) => T + (1 - (ly(v) - ly(lo)) / Math.max(1e-6, ly(hi) - ly(lo))) * (H - T - B);
  const days = all.map((p) => p.day).sort();
  const first = days[0];
  const span = Math.max(1, daysBetween(first, days[days.length - 1]));
  const one = days[0] === days[days.length - 1];
  const x = (d) => (one ? (L + W - R) / 2 : L + PAD + (daysBetween(first, d) / span) * (W - L - R - 2 * PAD));
  const ticks = TICKS.filter((v) => v >= lo && v <= hi);
  const grid = ticks.map((v) => `<line class="lc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
    <text class="lc-tick" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmtDur(v)}</text>`).join('');
  const xy = points.map((p) => [x(p.day), y(p.s)]);
  const line = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
  const tip = (cx, cy, label) => {
    const w = label.length * 7.2 + 18;
    const tx = Math.min(Math.max(cx - w / 2, 2), W - w - 2);
    const ty = cy - 36 < 2 ? cy + 12 : cy - 36;
    return `<g class="lc-tip"><rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${w.toFixed(1)}" height="24" rx="8"/><text x="${(tx + w / 2).toFixed(1)}" y="${(ty + 16.5).toFixed(1)}" text-anchor="middle">${escapeHtml(label)}</text></g>`;
  };
  const dot = (p, cx, cy, cls, label, aria) => `<g class="lc-pt" tabindex="0" role="img" aria-label="${escapeHtml(aria)}">
      <circle class="lc-hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="16"/>
      <circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5"/>${tip(cx, cy, label)}</g>`;
  const dots = points.map((p, i) => dot(p, xy[i][0], xy[i][1], 'lc-dot', `${shortDay(p.day)} · ${fmtDur(p.s)}`,
    `${dayTitle(p.day, { day: 'numeric', month: 'long' })}: спокойно ${fmtDur(p.s)}`)).join('');
  const redDots = reds.map((p) => dot(p, x(p.day), y(p.s), 'ac-red', `${shortDay(p.day)} · 🔴 ${fmtDur(p.s)}`,
    `${dayTitle(p.day, { day: 'numeric', month: 'long' })}: вынужденный уход ${fmtDur(p.s)}, был голос`)).join('');
  const last = xy[xy.length - 1];
  const endLabel = last ? `<text class="lc-end" x="${Math.min(last[0], W - R).toFixed(1)}" y="${(last[1] - 12).toFixed(1)}" text-anchor="${last[0] > W - 60 ? 'end' : 'middle'}">${fmtDur(points[points.length - 1].s)}</text>` : '';
  const xLabels = one ? `<text class="lc-tick" x="${x(first).toFixed(1)}" y="${H - 8}" text-anchor="middle">${shortDay(first)}</text>`
    : `<text class="lc-tick" x="${L}" y="${H - 8}">${shortDay(first)}</text><text class="lc-tick" x="${W - R}" y="${H - 8}" text-anchor="end">${shortDay(days[days.length - 1])}</text>`;
  return `<svg class="line-chart alone-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Лучшая спокойная длительность по дням">${grid}
    ${points.length > 1 ? `<path class="lc-line" d="${line}"/>` : ''}${endLabel}${dots}${redDots}${xLabels}</svg>`;
}
