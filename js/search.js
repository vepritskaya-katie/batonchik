// Поиск (лупа в шапке): советы — Библиотека и Практика (наши советы и заметки из каналов), — а также тренировки и игры.
// Ищет слова и части слов: без учёта регистра и «ё»; у длинных слов отбрасывает окончание,
// поэтому «собаки» находит и «собака», и «собаку». Несколько слов — должны встретиться все.

import { escapeHtml, plainText, slug } from './md.js';
import { bookLines } from './library.js';

// Строчные буквы и «е» вместо «ё». Длина строки не меняется — места совпадений совпадают с исходным текстом
export function norm(s) {
  const str = String(s || '');
  let low = str.toLowerCase();
  if (low.length !== str.length) low = Array.from(str, (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; }).join('');
  return low.replace(/ё/g, 'е');
}

const ENDINGS = ['иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ых', 'их', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ую', 'юю',
  'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев', 'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь', 'й'];
// «собаки» → «собак», «поводком» → «поводк»; слова короче 5 букв — как есть
export function stem(word) {
  if (word.length < 5 || !/^[а-я]+$/.test(word)) return word;
  for (const e of ENDINGS) if (word.endsWith(e) && word.length - e.length >= 4) return word.slice(0, -e.length);
  return word;
}

export function queryWords(q) {
  return [...new Set(norm(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 || /\d/.test(w)).map(stem))];
}

// Текст из разметки: без звёздочек, ссылки — только подписью
const clean = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

const item = (group, src, title, href, text) => {
  const t = clean(title);
  const x = clean(text);
  return { group, src, title: t, href, text: x, nt: norm(t), nx: norm(x) };
};

// Текст карточки без служебного блока «Повторов в день»
const cardText = (c) => [c.subtitle, plainText(c.lead || []), ...(c.blocks || []).filter((b) => b.kind !== 'reps')
  .map((b) => `${b.title}. ${plainText(b.content)}`)].join(' ');

// Всё, что можно найти. lib — Библиотека, cat — каталог «Практики», k и g — тренировки и игры
// (каталоги — с правками из приложения), notes — Каналы
export function buildIndex({ lib, cat, notes, k, g }) {
  const out = [];
  if (lib && !lib.error) {
    const L = 'Библиотека';
    (lib.vet || []).forEach((c, i) => out.push(item(L, 'Срочно', c.title, i ? `#/lib/vet/${c.id}` : '#/lib/vet', plainText(c.blocks))));
    (lib.health || []).forEach((c) => out.push(item(L, 'Здоровье', c.title, `#/lib/health/${c.id}`, plainText(c.blocks))));
    (lib.a || []).forEach((c) => out.push(item(L, 'Статьи', c.title, `#/lib/a/${c.id}`, plainText(c.blocks))));
    (lib.qa || []).forEach((c) => out.push(item(L, 'Вопрос — ответ', c.title, `#/lib/qa/${c.id}`, plainText(c.blocks))));
    (lib.myths || []).forEach((c) => out.push(item(L, 'Мифы и факты', c.title, `#/lib/myths/${c.id}`, plainText(c.blocks))));
    (lib.cases || []).forEach((c) => out.push(item(L, 'Разбор ситуаций', c.title, `#/lib/cases/${c.id}`, plainText(c.blocks))));
    (lib.ages || []).forEach((c) => out.push(item(L, 'Календарь взросления', c.label || c.title, `#/lib/ages/${c.id}`, plainText(c.blocks))));
    // Шпаргалка «Язык тела» — по подразделам (### …), номер — по порядку, как в renderLibrary
    (lib.body || []).forEach((c) => {
      let k = 0;
      let cur = null;
      c.blocks.forEach((b) => {
        if (b.type === 'heading' && b.level === 3) { cur = { title: b.text.replace(/\s*✅\s*$/, ''), n: ++k, blocks: [] }; out.push(cur); }
        else if (cur) cur.blocks.push(b);
      });
      for (let i = out.length - 1; i >= 0 && out[i].blocks; i--) {
        const sec = out[i];
        out[i] = item(L, 'Язык тела', sec.title, `#/lib/body/${c.id}-${sec.n}`, plainText(sec.blocks));
      }
    });
    (lib.dict || []).forEach((d) => out.push(item(L, 'Словарь', d.en ? `${d.term} (${d.en})` : d.term, `#/lib/dict/${slug(d.term)}`, d.def)));
    (lib.books || []).forEach((c) => bookLines(c).forEach(([title, ...rest], k) => {
      out.push(item(L, `Что почитать · ${c.title}`, title.replace(/^[✅💬]\s*/u, ''), `#/lib/books/${c.id}-${k + 1}`, rest.join(' · ')));
    }));
  }
  if (cat && cat.groups) {
    cat.groups.forEach((grp) => (grp.cards || []).forEach((c) => out.push(item('Практика', grp.title || 'Советы', c.name, `#/t/${c.id}`, cardText(c)))));
  }
  for (const [tab, name, cg] of [['k', 'Тренировки', k], ['g', 'Игры', g]]) {
    if (cg && cg.groups) cg.groups.forEach((grp) => (grp.cards || []).forEach((c) => out.push(item(name, grp.title || name, c.name, `#/${tab}/${c.id}`, cardText(c)))));
  }
  if (notes && notes.all) {
    notes.all.forEach((n) => out.push(item('Каналы', [n.section, n.topic].filter(Boolean).join(' · '), n.title, `#/c/${n.id}`,
      `${plainText(n.text)} ${plainText(n.comment)}`)));
  }
  return out;
}

// Совпадения: сначала те, где слова есть в названии, потом — где их больше в тексте
export function search(index, q) {
  const words = queryWords(q);
  if (!words.length) return { words, hits: [] };
  const hits = [];
  for (const it of index) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inTitle = it.nt.includes(w);
      if (!inTitle && !it.nx.includes(w)) { ok = false; break; }
      if (inTitle) score += new RegExp(`(^|[^\\p{L}])${escapeRe(w)}`, 'u').test(it.nt) ? 12 : 8;
      score += Math.min(count(it.nx, w), 5);
    }
    if (ok) hits.push({ it, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return { words, hits };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function count(text, w) {
  let n = 0;
  for (let i = text.indexOf(w); i !== -1 && n < 5; i = text.indexOf(w, i + w.length)) n++;
  return n;
}

// Подсвечиваем найденное — целыми словами. Короткие слова (1–2 буквы) не подсвечиваем, если есть длиннее
const isLetter = (c) => /[\p{L}\p{N}]/u.test(c || '');
function marks(text, words) {
  const n = norm(text);
  const long = words.filter((w) => w.length > 2);
  const use = long.length ? long : words;
  const ranges = [];
  for (const w of use) {
    for (let i = n.indexOf(w); i !== -1; i = n.indexOf(w, i + w.length)) {
      let a = i;
      let b = i + w.length;
      while (a > 0 && isLetter(text[a - 1])) a--;
      while (b < text.length && isLetter(text[b])) b++;
      ranges.push([a, b]);
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  return merged;
}

export function highlight(text, words) {
  let out = '';
  let pos = 0;
  for (const [a, b] of marks(text, words)) {
    out += `${escapeHtml(text.slice(pos, a))}<mark>${escapeHtml(text.slice(a, b))}</mark>`;
    pos = b;
  }
  return out + escapeHtml(text.slice(pos));
}

// Отрывок текста вокруг первого совпадения
export function snippet(text, words, before = 50, after = 120) {
  const m = marks(text, words)[0];
  if (!m) return text.length > before + after ? `${text.slice(0, before + after).replace(/\s+\S*$/, '')}…` : text;
  let a = Math.max(0, m[0] - before);
  let b = Math.min(text.length, m[1] + after);
  if (a > 0) { const sp = text.indexOf(' ', a); a = sp !== -1 && sp < m[0] ? sp + 1 : a; }
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); b = sp > m[1] ? sp : b; }
  return `${a > 0 ? '…' : ''}${text.slice(a, b)}${b < text.length ? '…' : ''}`;
}

const GROUPS = ['Библиотека', 'Практика', 'Каналы', 'Тренировки', 'Игры'];
const PAGE = 20; // столько находок в разделе показываем сразу, остальные — по кнопке

// Результаты, по разделам. Раздел с лучшим совпадением — первым. more — разделы, где нажали «Показать все»
export function resultsHtml(index, q, more = {}) {
  const { words, hits } = search(index, q);
  if (!words.length) return '';
  if (!hits.length) {
    return `<p class="empty search-empty">Ничего не нашлось. Попробуйте другое слово или его начало: «повод» найдёт и «поводок», и «поводке».</p>`;
  }
  const chev = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  const groups = GROUPS.map((g) => hits.filter((h) => h.it.group === g)).filter((list) => list.length);
  groups.sort((a, b) => b[0].score - a[0].score);
  const html = groups.map((list) => {
    const g = list[0].it.group;
    const shown = more[g] ? list : list.slice(0, PAGE);
    const rows = shown.map(({ it }) => `<li><a class="card-link search-hit" href="${escapeHtml(it.href)}">
        <span class="hit-src">${escapeHtml(it.src)}</span>
        <span class="card-name">${highlight(it.title, words)}</span>
        ${it.text ? `<span class="hit-snip">${highlight(snippet(it.text, words), words)}</span>` : ''}${chev}</a></li>`).join('');
    const rest = list.length - shown.length;
    return `<section class="group search-group"><h2>${g} <span class="search-n">${list.length}</span></h2>
      <ul class="cards">${rows}</ul>
      ${rest ? `<button type="button" class="btn wide search-more" data-action="search-more" data-group="${g}">Показать ещё ${rest}</button>` : ''}</section>`;
  }).join('');
  return `<p class="muted small search-count" aria-live="polite">Найдено: ${hits.length}</p>${html}`;
}
