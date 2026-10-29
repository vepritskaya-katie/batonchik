// Паспорт: виды записей о здоровье, возраст, «через 3 дня», напоминания в календаре телефона.
// Даты — строки «ГГГГ-ММ-ДД» по Москве, как и дни журнала.

import { addDays, dayTitle } from './diary.js';
import { escapeHtml } from './md.js';

export const HEALTH_KINDS = {
  vaccine: { icon: '💉', label: 'Прививка' },
  ticks: { icon: '🛡️', label: 'Клещи и блохи' },
  worms: { icon: '🪱', label: 'Глисты' },
  pill: { icon: '💊', label: 'Таблетки' },
  vet: { icon: '🩺', label: 'Врач' },
  other: { icon: '📌', label: 'Другое' },
};

// «Следующий раз» после выполненной записи
export const NEXT_OPTIONS = [
  ['', 'Не повторять'],
  ['1m', 'Через месяц'],
  ['3m', 'Через 3 месяца'],
  ['12w', 'Через 12 недель'],
  ['1y', 'Через год'],
  ['date', 'Выбрать дату'],
];

const toUTC = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

// Дата через N месяцев: 31 января + 1 месяц = 28 (29) февраля
function addMonths(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

export function nextDate(from, option) {
  if (option === '1m') return addMonths(from, 1);
  if (option === '3m') return addMonths(from, 3);
  if (option === '12w') return addDays(from, 84);
  if (option === '1y') return addMonths(from, 12);
  return '';
}

export const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / 86400000);

// Срок по виду записи. Глисты: до 6 месяцев — раз в месяц, потом — раз в 3 месяца
function kindNext(kind, birth, date) {
  if (kind === 'ticks') return '1m';
  if (kind === 'vaccine') return '1y';
  if (kind === 'worms') return birth && addMonths(birth, 6) > date ? '1m' : '3m';
  return '';
}

// «Следующий раз» по умолчанию: как в прошлый раз (если это один из сроков в списке), иначе — по виду записи
export function suggestNext(rec, records, birth) {
  const same = (r) => r.done && r.id !== rec.id && r.kind === rec.kind
    && String(r.title || '').trim().toLowerCase() === String(rec.title || '').trim().toLowerCase() && r.date < rec.date;
  const prev = records.filter(same).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (prev) {
    const n = daysBetween(prev.date, rec.date);
    if (n >= 26 && n <= 35) return '1m';
    if (n >= 80 && n <= 87) return '12w';
    if (n >= 88 && n <= 95) return '3m';
    if (n >= 355 && n <= 375) return '1y';
  }
  return kindNext(rec.kind, birth, rec.date);
}

// «сегодня», «завтра», «через 3 дня», «просрочено на 2 дня»
export function dueText(date, today) {
  const n = daysBetween(today, date);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n > 1) return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
  return `просрочено на ${-n} ${plural(-n, 'день', 'дня', 'дней')}`;
}

// Возраст: «5 месяцев», «1 год 2 месяца»
export function ageText(birth, today) {
  if (!/^\d{4}-\d\d-\d\d$/.test(birth || '')) return '';
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) return '';
  if (months < 3) {
    const w = Math.floor(daysBetween(birth, today) / 7);
    return `${w} ${plural(w, 'неделя', 'недели', 'недель')}`;
  }
  const years = Math.floor(months / 12);
  months %= 12;
  return [years && `${years} ${plural(years, 'год', 'года', 'лет')}`, months && `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`]
    .filter(Boolean).join(' ');
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Запланированное — по дате, ближайшее первым; сделанное — свежее первым
export function upcoming(records) {
  return records.filter((r) => !r.done).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
export function doneRecords(records) {
  return records.filter((r) => r.done).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const calDate = (key) => key.replace(/-/g, '');

// Событие на весь день в Google Календаре
export function googleCalendarUrl(rec, petName) {
  const title = `${petName || 'Батончик'}: ${rec.title}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: title,
    dates: `${calDate(rec.date)}/${calDate(addDays(rec.date, 1))}`,
    details: rec.note || 'Напоминание из приложения «Батончик»',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// Файл календаря (.ics) с напоминанием в 10:00 в этот день — открывается календарём iPhone
export function icsText(rec, petName) {
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Batonchik//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${rec.id || stamp}@batonchik`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${calDate(rec.date)}`, `DTEND;VALUE=DATE:${calDate(addDays(rec.date, 1))}`,
    `SUMMARY:${esc(`${petName || 'Батончик'}: ${rec.title}`)}`,
    `DESCRIPTION:${esc(rec.note || 'Напоминание из приложения «Батончик»')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(rec.title)}`, 'TRIGGER:PT10H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

// Строка записи о здоровье: значок, название, дата и «через 3 дня» / «сделано»
export function healthRowHtml(rec, today, { action = 'health-edit' } = {}) {
  const k = HEALTH_KINDS[rec.kind] || HEALTH_KINDS.other;
  const n = daysBetween(today, rec.date);
  const state = rec.done ? 'done' : n < 0 ? 'overdue' : n <= 7 ? 'soon' : 'planned';
  const when = rec.done ? dayTitle(rec.date, { day: 'numeric', month: 'long', year: 'numeric' })
    : `${dayTitle(rec.date, { day: 'numeric', month: 'long' })} · ${dueText(rec.date, today)}`;
  return `<li><button class="health-row ${state}" data-action="${action}" data-id="${rec.id}">
    <span class="health-icon" aria-hidden="true">${k.icon}</span>
    <span class="health-main"><strong>${escapeHtml(rec.title)}</strong><span>${escapeHtml(when)}</span></span>
    ${rec.done ? '<span class="health-done" aria-label="Сделано">✓</span>' : ''}
  </button></li>`;
}
