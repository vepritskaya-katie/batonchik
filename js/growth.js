// Рост и вес: измерения { id, date: 'ГГГГ-ММ-ДД', weight (кг), height (см) }, прибавка и график.
// График — одна величина на график (вес и рост отдельно): линия, точки, лёгкая заливка, тонкая сетка.

import { dayTitle, plural } from './diary.js';
import { daysBetween } from './passport.js';
import { escapeHtml } from './md.js';

export const fmtNum = (x) => (Math.round(x * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

// «13,3» или «13.3» → 13.3; пустое или кривое → 0
export function parseNum(s) {
  const n = Number(String(s || '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
}

// Точки одной величины по возрастанию даты
export function series(records, field) {
  return records.filter((r) => r[field] > 0)
    .map((r) => ({ id: r.id, date: r.date, value: r[field] }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// «+0,8 кг за 2 недели» — изменение с прошлого измерения
export function deltaText(points, unit) {
  if (points.length < 2) return '';
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const d = Math.round((b.value - a.value) * 10) / 10;
  const days = Math.max(1, daysBetween(a.date, b.date));
  const w = Math.round(days / 7);
  const m = Math.round(days / 30.4);
  const span = days < 14 ? `${days} ${plural(days, 'день', 'дня', 'дней')}`
    : days < 60 ? `${w} ${plural(w, 'неделю', 'недели', 'недель')}` : `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `${sign}${fmtNum(Math.abs(d))} ${unit} за ${span}`;
}

// Шаг делений: 0,5 / 1 / 2 / 5 / 10 …
function niceStep(range) {
  const raw = range / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

const shortDate = (key) => dayTitle(key, { day: 'numeric', month: 'short' }).replace('.', '');

// SVG-график. Подписи — цветом текста, данные — цветом акцента (классы lc-* в style.css)
export function lineChartSvg(points, { unit }) {
  if (!points.length) return '';
  const W = 340, H = 190, L = 30, R = 8, T = 34, B = 30;
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const step = niceStep(Math.max(hi - lo, hi * 0.08, 0.5));
  const y0 = Math.floor((lo - step * 0.4) / step) * step;
  const y1 = Math.ceil((hi + step * 0.4) / step) * step;
  const first = points[0].date;
  const span = Math.max(1, daysBetween(first, points[points.length - 1].date));
  const PAD = 12; // точки не прижимаются к подписям слева и к краю справа
  const x = (p) => (points.length === 1 ? (L + W - R) / 2 : L + PAD + (daysBetween(first, p.date) / span) * (W - L - R - 2 * PAD));
  const y = (v) => T + (1 - (v - Math.max(0, y0)) / (y1 - Math.max(0, y0))) * (H - T - B);
  const ticks = [];
  for (let v = Math.max(0, y0); v <= y1 + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  const grid = ticks.map((v) => `<line class="lc-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="lc-tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`).join('');
  const xy = points.map((p) => [x(p), y(p.value)]);
  const line = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
  const area = points.length > 1 ? `<path class="lc-area" d="${line}L${xy[xy.length - 1][0].toFixed(1)},${H - B}L${xy[0][0].toFixed(1)},${H - B}Z"/>` : '';
  const last = xy[xy.length - 1];
  const dots = points.map((p, i) => {
    const [cx, cy] = xy[i];
    const label = `${shortDate(p.date)} · ${fmtNum(p.value)} ${unit}`;
    const w = label.length * 7.2 + 18;
    const tx = Math.min(Math.max(cx - w / 2, 2), W - w - 2);
    return `<g class="lc-pt" tabindex="0" role="img" aria-label="${escapeHtml(dayTitle(p.date, { day: 'numeric', month: 'long' }))}: ${fmtNum(p.value)} ${unit}">
      <circle class="lc-hit" cx="${cx}" cy="${cy}" r="16"/>
      <circle class="lc-dot" cx="${cx}" cy="${cy}" r="${i === points.length - 1 ? 5.5 : 4.5}"/>
      <g class="lc-tip"><rect x="${tx}" y="${cy - 36}" width="${w}" height="24" rx="8"/><text x="${tx + w / 2}" y="${cy - 19.5}" text-anchor="middle">${escapeHtml(label)}</text></g>
    </g>`;
  }).join('');
  const endLabel = `<text class="lc-end" x="${Math.min(last[0], W - R)}" y="${last[1] - 12}" text-anchor="${last[0] > W - 60 ? 'end' : 'middle'}">${fmtNum(points[points.length - 1].value)}</text>`;
  const xLabels = points.length > 1
    ? `<text class="lc-tick" x="${L}" y="${H - 8}">${shortDate(first)}</text><text class="lc-tick" x="${W - R}" y="${H - 8}" text-anchor="end">${shortDate(points[points.length - 1].date)}</text>`
    : `<text class="lc-tick" x="${last[0]}" y="${H - 8}" text-anchor="middle">${shortDate(first)}</text>`;
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="group">${grid}${area}
    ${points.length > 1 ? `<path class="lc-line" d="${line}"/>` : ''}${endLabel}${dots}${xLabels}</svg>`;
}
