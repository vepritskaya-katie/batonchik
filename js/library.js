// Вкладка «Советы» → «Библиотека» (файл content/biblioteka.md), только чтение.
// # — рубрика, ## — карточка, ### — блок, #### — подпункт. Подробности — в комментарии в начале файла.

import { parseBlocks, renderBlocks, inline, escapeHtml, slug, stripComments } from './md.js';

// Рубрики в порядке показа; key — часть адреса (#/lib/a, #/lib/qa …), read — у карточек есть «Прочитано»
export const RUBRICS = [
  { key: 'vet', title: 'Срочно', icon: '🚑', urgent: true, sub: 'Здоровье и потеря собаки' },
  { key: 'a', title: 'Статьи', icon: '📖', read: true, sub: 'Почему это работает' },
  { key: 'qa', title: 'Вопрос — ответ', icon: '❓', read: true, sub: 'Короткие ответы' },
  { key: 'myths', title: 'Мифы и факты', icon: '🔍', read: true, sub: 'Что устарело' },
  { key: 'cases', title: 'Разбор ситуаций', icon: '🧩', read: true, sub: 'Подумать, потом открыть' },
  { key: 'ages', title: 'Календарь взросления', icon: '🌱', sub: 'Этапы по возрасту' },
  { key: 'body', title: 'Язык тела', icon: '🐾', sub: 'Шпаргалка' },
  { key: 'dict', title: 'Словарь', icon: '🔤', sub: 'Термины' },
  { key: 'game', title: 'Игра', icon: '🏆', sub: 'Разминка дня', href: '#/game' },
  { key: 'books', title: 'Что почитать', icon: '📚', sub: 'Книги и сайты' },
];
const SECTION_KEY = {
  'Библиотека': 'intro', 'Срочно': 'vet', 'Срочно к ветеринару': 'vet', 'Разбор ситуаций': 'cases', 'Статьи': 'a', 'Вопрос — ответ': 'qa', 'Мифы и факты': 'myths', 'Календарь взросления': 'ages',
  'Язык тела': 'body', 'Словарь': 'dict', 'Что почитать': 'books', 'Факт дня': 'facts',
};
const META_RE = /^\*\*(Время чтения|Когда актуально):\*\*\s*(.*)$/;

// Строка, которая начинается с жирной подписи («**Что делать:** …»), — отдельный абзац
const splitLabels = (lines) => lines.flatMap((l, i) => (i && /^\*\*[^*]+:\*\*/.test(l) && lines[i - 1].trim() ? ['', l] : [l]));

function splitCards(lines) {
  const cards = [];
  const used = new Set();
  let card = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.*?)\s*$/);
    if (h) {
      let id = slug(h[1]);
      for (let n = 2; used.has(id); n++) id = `${slug(h[1])}-${n}`;
      used.add(id);
      card = { id, title: h[1], lines: [] };
      cards.push(card);
    } else if (card) card.lines.push(line);
  }
  return cards.map((c) => {
    const meta = {};
    const body = c.lines.filter((l) => { const m = l.match(META_RE); if (m) meta[m[1]] = m[2]; return !m; });
    const text = splitLabels(body).join('\n').trim();
    return { id: c.id, title: c.title, time: meta['Время чтения'] || '', when: meta['Когда актуально'] || '', text, blocks: parseBlocks(text) };
  });
}

// «5–6 месяцев · до 29 ноября 2026» → с 5 по 6 месяц; «2–3 года» → с 24 по 36
function ageRange(title) {
  const m = title.match(/^(\d+)\s*[–-]\s*(\d+)\s+(месяц|месяца|месяцев|год|года|лет)/);
  if (!m) return null;
  const k = /^(год|года|лет)$/.test(m[3]) ? 12 : 1;
  return { from: +m[1] * k, to: +m[2] * k };
}

function parseDict(lines) {
  return lines.map((l) => l.match(/^-\s+\*\*(.+?)\*\*\s*—\s*(.*)$/)).filter(Boolean).map((m) => {
    const t = m[1].match(/^(.*?)\s*\((.+)\)$/);
    return { term: t ? t[1] : m[1], en: t ? t[2] : '', def: m[2] };
  }).sort((a, b) => {
    const lat = (x) => /^[A-Za-z]/.test(x.term);
    return lat(a) - lat(b) || a.term.localeCompare(b.term, 'ru');
  });
}

export function parseLibrary(source) {
  const sections = {};
  let cur = null;
  for (const line of stripComments(source).split('\n')) {
    const h = line.match(/^#\s+(.*?)\s*$/);
    if (h) { cur = SECTION_KEY[h[1]] || null; if (cur) sections[cur] = []; continue; }
    if (cur) sections[cur].push(line);
  }
  const lib = { intro: parseBlocks(splitLabels(sections.intro || []).join('\n')) };
  for (const key of ['vet', 'a', 'qa', 'myths', 'cases', 'ages', 'body', 'books']) lib[key] = splitCards(sections[key] || []);
  // У «Разбора ситуаций» — вводный текст до первой карточки
  const casesLines = sections.cases || [];
  const firstCase = casesLines.findIndex((l) => /^##\s/.test(l));
  lib.casesIntro = parseBlocks(splitLabels(firstCase < 0 ? casesLines : casesLines.slice(0, firstCase)).join('\n'));
  lib.ages.forEach((s) => { s.range = ageRange(s.title); const [label, dates] = s.title.split(' · '); s.label = label; s.dates = dates || ''; });
  lib.dict = parseDict(sections.dict || []);
  lib.facts = (sections.facts || []).map((l) => l.match(/^\s*\d+[.)]\s+(.*)$/)).filter(Boolean).map((m) => m[1]);
  return lib;
}

// Сколько карточек рубрики прочитано (у тех, где есть «Прочитано»)
export const readKey = (rubric, id) => `${rubric}_${id}`;
export function readCount(lib, rubric, items) {
  const list = lib[rubric] || [];
  return { done: list.filter((c) => items[readKey(rubric, c.id)]).length, total: list.length };
}

// Абзацы с «💬» — опыт кинолога: выделяем мягким фоном
const prose = (blocks) => renderBlocks(blocks).replace(/<p>💬/g, '<p class="exp">💬');

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
export function readBtn(rubric, id, on, can) {
  return `<button type="button" class="read-btn${on ? ' on' : ''}" data-action="lib-read" data-id="${readKey(rubric, id)}" aria-pressed="${on}"${can ? '' : ' disabled'}
    aria-label="${on ? 'Прочитано — снять отметку' : 'Отметить прочитанным'}">${CHECK_SVG}</button>`;
}

export function metaChips(card) {
  return [card.time && `<span class="lib-chip">⏱ ${escapeHtml(card.time)}</span>`, card.when && `<span class="lib-chip">${escapeHtml(card.when)}</span>`]
    .filter(Boolean).join('');
}

export function articleBody(card) { return prose(card.blocks); }

// Вопрос — ответ и мифы: заголовок, по нажатию раскрывается ответ
export function foldList(lib, rubric, items, can, open) {
  return `<ul class="fold-list">${lib[rubric].map((c) => {
    const on = !!items[readKey(rubric, c.id)];
    return `<li class="fold${on ? ' read' : ''}" id="lib-${rubric}-${c.id}"><details${c.id === open ? ' open' : ''}>
      <summary>${inline(c.title)}</summary><div class="prose fold-body">${prose(c.blocks)}</div></details>
      ${readBtn(rubric, c.id, on, can)}</li>`;
  }).join('')}</ul>`;
}

// Календарь взросления: текущий этап — по возрасту в месяцах; open — этап, открытый по ссылке (из поиска)
export function agesHtml(lib, months, open) {
  return `<ol class="ages">${lib.ages.map((s) => {
    const now = months != null && s.range && months >= s.range.from && months < s.range.to;
    const past = months != null && s.range && months >= s.range.to;
    return `<li class="age${now ? ' now' : ''}${past ? ' past' : ''}" id="lib-ages-${s.id}"><details${now || s.id === open ? ' open' : ''}>
      <summary><span class="age-label">${escapeHtml(s.label)}</span>${now ? '<span class="age-now">сейчас</span>' : ''}
        ${s.dates ? `<span class="age-dates">${escapeHtml(s.dates)}</span>` : ''}</summary>
      <div class="prose fold-body">${prose(s.blocks)}</div></details></li>`;
  }).join('')}</ol>`;
}

export function dictHtml(lib, q = '') {
  let letter = '';
  const rows = lib.dict.map((d) => {
    const first = d.term.charAt(0).toUpperCase();
    const head = /[А-ЯЁ]/.test(first) && first !== letter ? `<li class="dict-letter" data-letter>${(letter = first)}</li>` : '';
    const search = `${d.term} ${d.en} ${d.def}`.toLowerCase().replace(/ё/g, 'е');
    return `${head}<li class="dict-item" id="lib-dict-${slug(d.term)}" data-search="${escapeHtml(search)}"><strong>${escapeHtml(d.term)}</strong>${d.en ? ` <span class="dict-en">${escapeHtml(d.en)}</span>` : ''}
      <p>${inline(d.def)}</p></li>`;
  }).join('');
  return `<input class="notes-search dict-search" type="search" enterkeyhint="search" placeholder="Поиск по-русски или по-английски" aria-label="Поиск по словарю" value="${escapeHtml(q)}">
    <ul class="dict">${rows}</ul><p class="empty dict-empty" hidden>Такого термина нет.</p>`;
}

// Книги и сайты: «- ✅ **Название** (оригинал) · язык · о чём»
export const bookLines = (c) => c.text.split('\n').filter((l) => /^-\s+/.test(l)).map((l) => l.replace(/^-\s+/, '').split(' · '));
export function booksHtml(lib) {
  return lib.books.map((c) => {
    const items = bookLines(c).map(([title, lang, ...about], k) => {
      const linked = inline(title).replace(/\(([a-z0-9.-]+\.[a-z]{2,})\)/, '(<a href="https://$1" target="_blank" rel="noopener">$1</a>)');
      return `<li class="book" id="lib-books-${c.id}-${k + 1}"><div class="book-title">${linked}</div>${lang ? `<div class="book-lang">${escapeHtml(lang)}</div>` : ''}
        ${about.length ? `<p>${inline(about.join(' · '))}</p>` : ''}</li>`;
    }).join('');
    return `<section class="section"><h2>${inline(c.title)}</h2><ul class="books">${items}</ul></section>`;
  }).join('');
}

export function introHtml(lib) { return prose(lib.intro); }

// «Разбор ситуаций»: сначала только «Ситуация» — подумать самой, — потом по кнопке весь разбор
export function casesHtml(lib, items, can, open) {
  const list = lib.cases.map((c) => {
    const on = !!items[readKey('cases', c.id)];
    const cut = c.blocks.findIndex((b, k) => k > 0 && b.type === 'heading');
    const situation = cut > 0 ? c.blocks.slice(0, cut) : c.blocks;
    const rest = cut > 0 ? c.blocks.slice(cut) : [];
    return `<li class="case${on ? ' read' : ''}" id="lib-cases-${c.id}">
      <div class="case-head"><h2>${inline(c.title)}</h2>${readBtn('cases', c.id, on, can)}</div>
      <div class="prose case-situation">${prose(situation)}</div>
      ${rest.length ? `<details class="case-more"${c.id === open ? ' open' : ''}><summary><span class="case-show">Подумать самой → Показать разбор</span><span class="case-hide">Скрыть разбор</span></summary>
        <div class="prose">${prose(rest)}</div></details>` : ''}</li>`;
  }).join('');
  return `${lib.casesIntro && lib.casesIntro.length ? `<div class="prose lib-intro">${prose(lib.casesIntro)}</div>` : ''}<ul class="case-list">${list}</ul>`;
}
