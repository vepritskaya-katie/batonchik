// Вкладка «Каналы»: заметки из Telegram-каналов (файл content/kanaly.md), только чтение.
// ## Тема → ### Подтема → #### Заметка. В заметке — строки «**Пометка:**», «**Когда актуально:**»,
// текст, «**Комментарий кинолога:**» и «**Источники:**» со ссылками; ▶ в подписи ссылки — в посте есть видео.

import { parseBlocks, renderBlocks, inline, escapeHtml, slug, stripComments } from './md.js';

const FIELD_RE = /^\*\*(Пометка|Когда актуально|Комментарий кинолога|Источники):\*\*\s*(.*)$/;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function parseNotes(source) {
  const sections = [];
  const introLines = [];
  const used = new Set();
  let section = null;
  let topic = null;
  let note = null;
  let field = 'text';

  const ensureSection = () => { if (!section) { section = { title: '', topics: [] }; sections.push(section); } };
  const ensureTopic = () => { ensureSection(); if (!topic) { topic = { title: '', notes: [] }; section.topics.push(topic); } };

  for (const line of stripComments(source).split('\n')) {
    const h = line.match(/^(#{2,4})\s+(.*?)\s*$/);
    if (h && h[1].length === 2) { section = { title: h[2], topics: [] }; sections.push(section); topic = null; note = null; continue; }
    if (h && h[1].length === 3) { ensureSection(); topic = { title: h[2], notes: [] }; section.topics.push(topic); note = null; continue; }
    if (h) {
      ensureTopic();
      let id = slug(h[2]);
      for (let n = 2; used.has(id); n++) id = `${slug(h[2])}-${n}`;
      used.add(id);
      note = { id, title: h[2], section: section.title, topic: topic.title, mark: '', markText: '', when: [], text: [], comment: [], sources: [] };
      topic.notes.push(note);
      field = 'text';
      continue;
    }
    if (!note) { if (!section) introLines.push(line); continue; }
    const f = line.match(FIELD_RE);
    if (f) {
      const value = f[2].trim();
      if (f[1] === 'Пометка') {
        note.markText = value;
        note.mark = value.includes('💬') ? 'exp' : 'sci';
        field = 'text';
      } else if (f[1] === 'Когда актуально') {
        note.when = value.split(',').map((s) => s.trim()).filter(Boolean);
        field = 'text';
      } else if (f[1] === 'Комментарий кинолога') {
        note.comment.push(value);
        field = 'comment';
      } else {
        addSources(note, value);
        field = 'sources';
      }
      continue;
    }
    if (field === 'sources') addSources(note, line);
    else note[field].push(line);
  }

  for (const s of sections) {
    for (const t of s.topics) {
      for (const n of t.notes) {
        const text = n.text.join('\n').trim();
        const comment = n.comment.join('\n').trim();
        n.text = parseBlocks(text);
        n.comment = parseBlocks(comment);
        n.search = [n.title, n.section, n.topic, text, comment].join(' ').toLowerCase().replace(/ё/g, 'е');
      }
    }
  }
  const all = sections.flatMap((s) => s.topics.flatMap((t) => t.notes));
  return { intro: parseBlocks(introLines.join('\n').trim()), sections, all, byId: new Map(all.map((n) => [n.id, n])) };
}

function addSources(note, text) {
  for (const m of text.matchAll(LINK_RE)) {
    const video = m[1].includes('▶');
    note.sources.push({ label: m[1].replace('▶', '').trim(), url: m[2], video });
  }
}

// Фильтры вкладки: { q, now, future, sci, exp }. Внутри пары («сейчас» / «на будущее», ✅ / 💬) — «или», между парами — «и»
export function noteMatches(n, f) {
  const now = n.when.some((w) => /сейчас/i.test(w));
  const future = n.when.some((w) => /будущ/i.test(w));
  if ((f.now || f.future) && !((f.now && now) || (f.future && future))) return false;
  if ((f.sci || f.exp) && !((f.sci && n.mark === 'sci') || (f.exp && n.mark === 'exp'))) return false;
  const words = String(f.q || '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  return words.every((w) => n.search.includes(w));
}

const markBadge = (n) => (n.markText ? `<span class="badge ${n.mark}">${escapeHtml(n.markText)}</span>` : '');
// В списке пометка — строкой без рамки: «💬 Опыт автора — подходит не всем собакам» в рамку на телефоне не помещается
const markLine = (n) => (n.markText ? `<span class="note-mark ${n.mark}">${escapeHtml(n.markText)}</span>` : '');
const whenBadges = (n) => n.when.map((w) => `<span class="badge when">${escapeHtml(w)}</span>`).join('');

const FILTERS = [['now', 'Актуально сейчас'], ['future', 'На будущее'], ['sci', '✅ Наука'], ['exp', '💬 Опыт']];

export function notesListHtml(data, f) {
  const chev = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  let shown = 0;
  const sections = data.sections.map((s) => {
    let sectionShown = 0;
    const topics = s.topics.map((t) => {
      let topicShown = 0;
      const items = t.notes.map((n) => {
        const ok = noteMatches(n, f);
        if (ok) topicShown++;
        return `<li data-note="${n.id}"${ok ? '' : ' hidden'}><a class="card-link note-link" href="#/c/${n.id}">
          <span class="card-name">${inline(n.title)}</span>
          ${markLine(n)}${n.when.length ? `<span class="note-badges">${whenBadges(n)}</span>` : ''}${chev}</a></li>`;
      }).join('');
      sectionShown += topicShown;
      return `<div class="note-topic" data-topic${topicShown ? '' : ' hidden'}>${t.title ? `<h3>${inline(t.title)}</h3>` : ''}<ul class="cards">${items}</ul></div>`;
    }).join('');
    shown += sectionShown;
    return `<section class="group note-section" data-section${sectionShown ? '' : ' hidden'}>${s.title ? `<h2>${inline(s.title)}</h2>` : ''}${topics}</section>`;
  }).join('');
  const chips = FILTERS.map(([key, label]) =>
    `<button type="button" class="filter-chip" data-action="notes-filter" data-f="${key}" aria-pressed="${!!f[key]}">${label}</button>`).join('');
  return `${data.intro.length ? `<div class="prose notes-intro">${renderBlocks(data.intro)}</div>` : ''}
    <div class="notes-tools">
      <input class="notes-search" type="search" enterkeyhint="search" placeholder="Поиск: страх, поводок, клещ…" aria-label="Поиск по заметкам" value="${escapeHtml(f.q || '')}">
      <div class="filter-chips">${chips}</div>
      <p class="muted small notes-count" aria-live="polite">${countText(shown, data.all.length)}</p>
    </div>
    ${sections}
    <p class="empty notes-empty"${shown ? ' hidden' : ''}>Ничего не нашлось. Попробуйте другое слово или снимите фильтры.</p>`;
}

export function countText(shown, total) {
  return shown === total ? `Заметок: ${total}` : `Найдено: ${shown} из ${total}`;
}

export function noteHtml(n, back) {
  const sources = n.sources.map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>${s.video ? ' <span class="badge video">▶ видео</span>' : ''}</li>`).join('');
  return `${back}
    <h1 class="card-title">${inline(n.title)}</h1>
    <p class="muted note-path">${[n.section, n.topic].filter(Boolean).map(escapeHtml).join(' · ')}</p>
    <div class="note-badges big">${markBadge(n)}${n.when.length ? `<span class="muted small">Когда актуально:</span>${whenBadges(n)}` : ''}</div>
    ${n.text.length ? `<section class="blk"><div class="prose">${renderBlocks(n.text)}</div></section>` : ''}
    ${n.comment.length ? `<section class="blk blk-comment"><h2>Комментарий кинолога</h2><div class="prose">${renderBlocks(n.comment)}</div></section>` : ''}
    ${sources ? `<section class="blk"><h2>Источники</h2><ul class="sources">${sources}</ul></section>` : ''}`;
}
