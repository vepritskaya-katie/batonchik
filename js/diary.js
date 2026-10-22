// Журнал событий и дневник: типы записей, подсчёты за день, ночной перерыв и сводка за неделю.

import { escapeHtml, inline } from './md.js';

export const TZ = 'Europe/Moscow';
const MSK_OFFSET_H = 3; // Москва круглый год UTC+3, без перехода на летнее время

export const EVENT_TYPES = {
  toilet: { icon: '🌳', label: 'Туалет на улице', subs: true },
  accident: { icon: '💦', label: 'Авария дома', subs: true },
  walk: { icon: '🦮', label: 'Прогулка' },
  meal: { icon: '🍽', label: 'Кормление' },
  wake: { icon: '☀️', label: 'Встали утром' },
  bed: { icon: '🌙', label: 'Легли вечером' },
  note: { icon: '✏️', label: 'Заметка', text: true },
};
export const SUBS = { pee: 'пописал', poo: 'покакал', both: 'пописал и покакал' };
// Повтор тренировки или игры: записывается кнопками «Тренировки на сегодня», в ленте журнала не показывается
export const TRAIN = { icon: '🎯', label: 'Повтор' };

// ---------- Время по Москве ----------

export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const fmtTime = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
export const fmtDate = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' }).format(d);

const keyToUTC = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12 - MSK_OFFSET_H);
};
export function addDays(key, n) {
  return dayKey(new Date(keyToUTC(key) + n * 86400000));
}
// Понедельник недели, в которую входит день key
export function mondayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 — воскресенье
  return addDays(key, -((weekday + 6) % 7));
}

// «2026-10-21» + «07:30» по Москве → Date
export function moscowDate(key, hm) {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - MSK_OFFSET_H, mm));
}
export function dayTitle(key, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const s = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, ...opts }).format(new Date(keyToUTC(key)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const weekdayShort = (key) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'short' }).format(new Date(keyToUTC(key)));

export function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

// ---------- Подсчёты ----------

const byTime = (a, b) => a.at - b.at;

// Ночной перерыв, который закончился утром дня key: от последнего «Легли» до первого «Встали»
export function nightFor(key, events) {
  const wake = events.filter((e) => e.type === 'wake' && e.day === key).sort(byTime)[0];
  if (!wake) return null;
  const bed = events.filter((e) => e.type === 'bed' && e.at < wake.at && wake.at - e.at < 16 * 3600000).sort(byTime).pop();
  if (!bed) return { wake: wake.at };
  return { bed: bed.at, wake: wake.at, ms: wake.at - bed.at };
}

export function dayStats(key, events, checks, scheduleTotal) {
  const all = events.filter((e) => e.day === key).sort(byTime);
  const list = all.filter((e) => e.type !== 'train');
  const trains = all.filter((e) => e.type === 'train');
  const trainsByCard = {};
  trains.forEach((e) => { trainsByCard[e.card] = (trainsByCard[e.card] || 0) + 1; });
  const count = (type, sub) => list.filter((e) => e.type === type && (!sub || e.sub === sub || e.sub === 'both')).length;
  const done = Object.keys(checks || {}).filter((k) => k.startsWith('s_')).length;
  return {
    key,
    list,
    toilet: count('toilet'), toiletPee: count('toilet', 'pee'), toiletPoo: count('toilet', 'poo'),
    accident: count('accident'), accidentPee: count('accident', 'pee'), accidentPoo: count('accident', 'poo'),
    walk: count('walk'), meal: count('meal'),
    notes: list.filter((e) => e.text),
    night: nightFor(key, events),
    trains: trains.length, trainsByCard,
    done, total: scheduleTotal,
    empty: !all.length && !done,
  };
}

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
const num = (x) => (Math.round(x * 10) / 10).toLocaleString('ru-RU');

// Сводка: последние 7 дней против 7 дней до них. Средние — только по дням, когда что-то записывали.
export function weekSummary(thisWeek, prevWeek) {
  const logged = (w) => w.filter((d) => d.list.length || d.trains);
  const cur = logged(thisWeek);
  const prev = logged(prevWeek);
  const lines = [];
  if (!cur.length) return lines;
  const cmp = (curVal, prevVal, unit = '') => (prevVal == null ? '' : ` (неделей раньше — ${num(prevVal)}${unit})`);

  const tCur = avg(cur.map((d) => d.toilet));
  const tPrev = prev.length ? avg(prev.map((d) => d.toilet)) : null;
  lines.push(`Туалет на улице: в среднем ${num(tCur)} раза в день${cmp(tCur, tPrev)}.`);
  const maxDay = cur.reduce((a, b) => (b.toilet > a.toilet ? b : a));
  if (cur.length > 2 && maxDay.toilet > tCur * 1.3) {
    lines.push(`Больше всего выходов в туалет — ${dayTitle(maxDay.key, { weekday: 'long' }).toLowerCase()}, ${maxDay.toilet}.`);
  }
  const aCur = cur.reduce((a, d) => a + d.accident, 0);
  const aPrev = prev.length ? prev.reduce((a, d) => a + d.accident, 0) : null;
  lines.push(aCur ? `Аварий дома: ${aCur} за неделю${aPrev != null ? ` (неделей раньше — ${aPrev})` : ''}.` : 'Аварий дома не было.');
  const wCur = avg(cur.map((d) => d.walk));
  if (wCur) lines.push(`Прогулок: в среднем ${num(wCur)} в день${cmp(wCur, prev.length ? avg(prev.map((d) => d.walk)) : null)}.`);
  const trCur = avg(cur.map((d) => d.trains));
  if (trCur) lines.push(`Повторов на тренировках: в среднем ${num(trCur)} в день${cmp(trCur, prev.length ? avg(prev.map((d) => d.trains)) : null)}.`);
  const nights = thisWeek.map((d) => d.night && d.night.ms).filter(Boolean);
  if (nights.length) lines.push(`Ночной перерыв: в среднем ${fmtDuration(avg(nights))} (записано ночей: ${nights.length}).`);
  return lines;
}

// ---------- Разметка ----------

export function eventLabel(e) {
  const t = EVENT_TYPES[e.type] || { icon: '•', label: e.type };
  return `${t.icon} ${t.label}${e.sub && SUBS[e.sub] ? ` — ${SUBS[e.sub]}` : ''}`;
}

export function eventRow(e, { editable } = {}) {
  const body = `<span class="ev-time">${fmtTime(e.at)}</span>
    <span class="ev-main"><span class="ev-label">${escapeHtml(eventLabel(e))}</span>
      ${e.text ? `<span class="ev-text">${inline(e.text)}</span>` : ''}
      ${e.name ? `<span class="ev-by">${escapeHtml(e.name)}</span>` : ''}</span>`;
  return editable
    ? `<li><button class="ev-row" data-action="ev-edit" data-id="${e.id}">${body}</button></li>`
    : `<li><div class="ev-row">${body}</div></li>`;
}

function chips(st) {
  const sub = (pee, poo) => (pee || poo ? ` <span class="muted">(${[pee && `пописал ${pee}`, poo && `покакал ${poo}`].filter(Boolean).join(', ')})</span>` : '');
  return [
    st.toilet ? `<span class="stat">🌳 Туалет на улице: <b>${st.toilet}</b>${sub(st.toiletPee, st.toiletPoo)}</span>` : '',
    st.accident ? `<span class="stat">💦 Аварии дома: <b>${st.accident}</b>${sub(st.accidentPee, st.accidentPoo)}</span>` : '',
    st.walk ? `<span class="stat">🦮 Прогулки: <b>${st.walk}</b></span>` : '',
    st.meal ? `<span class="stat">🍽 Кормления: <b>${st.meal}</b></span>` : '',
  ].filter(Boolean).join('');
}

export function nightLine(night) {
  if (!night) return '';
  if (!night.ms) return `<p class="night">☀️ Встали в ${fmtTime(night.wake)} <span class="muted">— время «Легли вечером» не записано</span></p>`;
  return `<p class="night">🌙 Ночь: ${fmtTime(night.bed)} → ${fmtTime(night.wake)}, <b>${fmtDuration(night.ms)}</b></p>`;
}

export function todaySummary(st) {
  const c = chips(st);
  return c ? `<div class="stats">${c}</div>` : '';
}

// Маленький столбчатый график одной величины за 7 дней. Число видно над самым высоким столбиком
// и по нажатию на любой столбик.
function miniChart(title, days, field) {
  const max = Math.max(1, ...days.map((d) => d[field]));
  const top = days.reduce((a, b) => (b[field] > a[field] ? b : a), days[0]);
  const bars = days.map((d) => {
    const v = d[field];
    const h = v ? Math.max(6, Math.round((v / max) * 100)) : 0;
    return `<button class="bar-col${d === top && v ? ' top' : ''}" aria-label="${dayTitle(d.key, { weekday: 'long', day: 'numeric', month: 'long' })}: ${v}">
      <span class="bar-val">${v}</span>
      <span class="bar-track"><span class="bar" style="height:${h}%"></span></span>
      <span class="bar-day">${weekdayShort(d.key)}</span></button>`;
  }).join('');
  return `<figure class="mini-chart"><figcaption>${title}</figcaption><div class="bars">${bars}</div></figure>`;
}

function trainsLine(st, cardName) {
  if (!st.trains) return '';
  const parts = Object.entries(st.trainsByCard).sort((a, b) => b[1] - a[1])
    .map(([card, n]) => `${escapeHtml(cardName(card))} ${n}`);
  return `<p class="trains">${TRAIN.icon} Тренировки: <b>${st.trains}</b> ${plural(st.trains, 'повтор', 'повтора', 'повторов')} — ${parts.join(', ')}</p>`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function diaryHtml({ days, prevWeek, markLabels, hasMore, loading, cardName }) {
  const week = days.slice(0, 7).reverse(); // слева направо — от старых к новым
  const summary = weekSummary(days.slice(0, 7), prevWeek);
  const dayCards = days.filter((d) => !d.empty || (markLabels[d.key] || []).length).map((d) => {
    const mastered = markLabels[d.key] || [];
    return `<article class="day-card">
      <h3>${dayTitle(d.key)}</h3>
      ${chips(d) ? `<div class="stats">${chips(d)}</div>` : ''}
      ${nightLine(d.night)}
      ${trainsLine(d, cardName)}
      ${mastered.length ? `<p class="mastered">✓ Освоено: ${mastered.map(escapeHtml).join('; ')}</p>` : ''}
      ${d.notes.length ? `<ul class="ev-list notes">${d.notes.map((e) => eventRow(e)).join('')}</ul>` : ''}
      ${d.list.length ? `<details class="intro"><summary>Все записи (${d.list.length})</summary>
        <ul class="ev-list">${d.list.map((e) => eventRow(e)).join('')}</ul></details>` : ''}
    </article>`;
  }).join('');

  return `<h1>Дневник</h1>
    <section class="section panel">
      <h2>Последние 7 дней</h2>
      ${summary.length ? `<ul class="summary">${summary.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
        : `<p class="muted">${loading ? 'Загружаем…' : 'Записей пока нет. Отмечайте туалет, прогулки и кормления кнопками на вкладке «Сегодня» — здесь появится сводка.'}</p>`}
      ${summary.length ? `<div class="charts">
        ${miniChart('🌳 Туалет на улице', week, 'toilet')}
        ${miniChart('💦 Аварии дома', week, 'accident')}
        ${miniChart('🦮 Прогулки', week, 'walk')}
        ${miniChart('🎯 Повторы на тренировках', week, 'trains')}
      </div>` : ''}
    </section>
    <section class="section">
      <h2>По дням</h2>
      ${dayCards || `<p class="muted">${loading ? 'Загружаем…' : 'Пока пусто.'}</p>`}
      ${hasMore ? '<button class="btn wide" data-action="diary-more">Показать ещё 4 недели</button>' : ''}
    </section>`;
}
