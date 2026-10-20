// Чтение Markdown-файлов памятки: разбор на блоки, вывод в HTML и сборка каталога.
// Всё написано так, чтобы при непонятной разметке показывать текст как есть, а не падать.

const ITEM_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TASK_RE = /^\[([ xXхХ])\]\s+(.*)$/;

export function stripComments(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(-->|$)/g, '');
}

// Строка вида «Oct 14, 2026 · @Katherine» — служебная, в приложении её не показываем.
function isBylineLine(line) {
  return /·\s*@\S+/.test(line) && /\d{4}/.test(line);
}

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const isBlank = (line) => !line.trim();
const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function dedent(lines) {
  const indents = lines.filter((l) => !isBlank(l)).map(indentOf);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.replace(/\t/g, '    ').slice(Math.min(min, indentOf(l))));
}

// Разбор текста на блоки: heading, para, list, table, quote, hr.
export function parseBlocks(text) {
  const lines = stripComments(text).split('\n');
  return parseLines(lines);
}

function parseLines(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i++; continue; }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { inner.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ type: 'quote', blocks: parseLines(inner) });
      continue;
    }

    if (ITEM_RE.test(line)) {
      const res = parseList(lines, i);
      blocks.push(res.block);
      i = res.next;
      continue;
    }

    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !ITEM_RE.test(lines[i]) &&
           !/^\s{0,3}#{1,6}\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) &&
           !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      para.push(lines[i].trim());
      i++;
    }
    const ptext = para.join(' ');
    if (!isBylineLine(ptext)) blocks.push({ type: 'para', text: ptext });
  }
  return blocks;
}

function parseList(lines, start) {
  const first = lines[start].match(ITEM_RE);
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const block = { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  let item = null;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(ITEM_RE);
    if (m && indentOf(line) === base && /\d/.test(m[2]) === ordered) {
      if (item) block.items.push(finishItem(item));
      item = { first: m[3], rest: [] };
      i++;
      continue;
    }
    if (isBlank(line)) {
      // Пустая строка: список продолжается, если дальше идёт пункт или текст с отступом.
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && indentOf(lines[j]) > base) { item.rest.push(''); i++; continue; }
      const mj = j < lines.length && lines[j].match(ITEM_RE);
      if (mj && indentOf(lines[j]) === base && /\d/.test(mj[2]) === ordered) { i = j; continue; }
      break;
    }
    if (indentOf(line) > base) { item.rest.push(line); i++; continue; }
    // Продолжение строки пункта без отступа
    if (!m && item.rest.length === 0 && !/^\s{0,3}#{1,6}\s/.test(line) && !isTableRow(line)) {
      item.first += ' ' + line.trim();
      i++;
      continue;
    }
    break;
  }
  if (item) block.items.push(finishItem(item));
  return { block, next: i };
}

function finishItem({ first, rest }) {
  let text = first;
  let task = null;
  const t = text.match(TASK_RE);
  if (t) { task = t[1] !== ' '; text = t[2]; }
  // Строки сразу после пункта без пустой строки и не являющиеся пунктами — продолжение текста
  const restLines = dedent(rest);
  let k = 0;
  while (k < restLines.length && !isBlank(restLines[k]) && !ITEM_RE.test(restLines[k])) {
    text += ' ' + restLines[k].trim();
    k++;
  }
  return { text, task, children: parseLines(restLines.slice(k)) };
}

// ---------- Вывод в HTML ----------

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    if (/^https?:\/\//i.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
    // Ссылка на файл рядом с памяткой, например PDF в папке content
    if (/^[\w.\-\/]+$/.test(url) && !url.startsWith('/') && !url.includes('..')) {
      return `<a href="content/${url}" target="_blank" rel="noopener">${label}</a>`;
    }
    return m;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[n]}</code>`);
  return s;
}

// Подсказки «Дальше, когда…» и «Переход, когда…» выделяем отдельно.
export function isHint(text) {
  return /^(дальше|переход)[^.]{0,20}когда/i.test(text.trim());
}

const HINT_RE = /\s*(?:\*\*)?((?:Дальше|Переход),?\s+когда)\s*:?\s*(?:\*\*)?\s*:?\s*/i;

// «Текст шага. **Дальше, когда:** критерий» → { main: 'Текст шага.', hint: 'критерий' }
export function splitHint(text) {
  const m = text.match(HINT_RE);
  if (!m || m.index === 0) return { main: text, hint: '', label: '' };
  return { main: text.slice(0, m.index).trim(), hint: text.slice(m.index + m[0].length).trim(), label: m[1] };
}

const hintHtml = (label, hint) => `<div class="hint-box"><strong>${escapeHtml(label)}:</strong> ${inline(hint)}</div>`;

// opts.task(text) → {key, html} — разметка общей галочки вместо «[ ]»
// opts.step(item, index) → html — кнопка «Освоено» у пункта нумерованного списка верхнего уровня
export function renderBlocks(blocks, opts = {}, depth = 0) {
  return blocks.map((b) => renderBlock(b, opts, depth)).join('\n');
}

function renderBlock(b, opts, depth) {
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(6, b.level + (opts.headingShift || 0));
      return `<h${lvl}>${inline(b.text)}</h${lvl}>`;
    }
    case 'para': return `<p>${inline(b.text)}</p>`;
    case 'hr': return '<hr>';
    case 'quote': return `<blockquote>${renderBlocks(b.blocks, opts, depth)}</blockquote>`;
    case 'table': return renderTable(b);
    case 'list': return renderList(b, opts, depth);
    default: return '';
  }
}

function renderSteps(b, opts, depth) {
  const items = b.items.map((it, idx) => {
    let text = it.text;
    let num = b.ordered ? b.start + idx : idx + 1;
    const nm = text.match(/^\*\*(\d+)\.\s*/);
    if (nm) {
      num = +nm[1];
      text = ('**' + text.slice(nm[0].length)).replace(/^\*\*\*\*\s*/, '');
    }
    const { main, hint, label } = splitHint(text);
    return `<li class="step"><span class="num">${num}</span><div class="step-body">
      <div class="li-text">${inline(main)}</div>${hint ? hintHtml(label, hint) : ''}
      ${renderBlocks(it.children, opts, depth + 1)}${opts.step(it, idx)}</div></li>`;
  }).join('');
  return `<ol class="steps">${items}</ol>`;
}

function renderList(b, opts, depth) {
  const hasTasks = b.items.some((it) => it.task !== null);
  if (depth === 0 && typeof opts.step === 'function' && (b.ordered || hasTasks)) return renderSteps(b, opts, depth);
  const isSteps = false;
  const tag = b.ordered ? 'ol' : 'ul';
  const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
  const cls = isSteps ? ' class="steps"' : (hasTasks ? ' class="tasks"' : '');
  const items = b.items.map((it) => {
    const children = renderBlocks(it.children, opts, depth + 1);
    if (it.task !== null && typeof opts.task === 'function') {
      return `<li class="task">${opts.task(it.text)}${children}</li>`;
    }
    const hint = isHint(it.text) ? ' class="hint"' : '';
    const split = hint ? { hint: '' } : splitHint(it.text);
    const text = split.hint ? `${inline(split.main)}${hintHtml(split.label, split.hint)}` : inline(it.text);
    return `<li${hint}><div class="li-text">${text}</div>${children}</li>`;
  }).join('');
  return `<${tag}${startAttr}${cls}>${items}</${tag}>`;
}

function renderTable(b) {
  // На телефоне таблица превращается в стопку карточек: у каждой ячейки подпись из шапки.
  const rows = b.rows.map((r) => `<div class="trow">${b.head.map((h, i) =>
    `<div class="tcell${i === 0 ? ' tfirst' : ''}"><span class="tlabel">${inline(h)}</span><span class="tval">${inline(r[i] || '')}</span></div>`
  ).join('')}</div>`).join('');
  return `<div class="table">${rows}</div>`;
}

// ---------- Каталог ----------

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

export function slug(text) {
  const s = String(text).toLowerCase().split('').map((c) => (c in TRANSLIT ? TRANSLIT[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 60) || 'item';
}

export function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Название «"Ко мне" (подзыв, recall)» → имя «Ко мне» и подпись «подзыв, recall».
export function splitTitle(title) {
  const i = title.indexOf(' (');
  const dash = title.match(/^(«[^»]+»)\s+—\s+(.+)$/);
  if (i < 0 && dash) return { name: dash[1], subtitle: dash[2].trim() };
  if (i < 0) return { name: title.trim(), subtitle: '' };
  let rest = title.slice(i + 1).trim();
  const close = rest.indexOf(')');
  if (rest.startsWith('(') && close > 0) rest = (rest.slice(1, close) + rest.slice(close + 1)).trim();
  return { name: title.slice(0, i).trim(), subtitle: rest };
}

const KINDS = [
  ['now', /^тренируем сейчас/],
  ['why', /^(зачем|почему так)/],
  ['need', /^понадобится/],
  ['steps', /^шаги/],
  ['how', /^как тренировать/],
  ['success', /^(считается успехом|готово, когда|освоено, когда|получается, если)/],
  ['keep', /^как поддерживать/],
  ['important', /^(важно|чего не делать)/],
  ['tip', /^подсказка/],
  ['doctor', /^когда (к |нужен)/],
  ['result', /^итог/],
  ['play', /^как играть/],
];

export function blockKind(title) {
  const t = title.toLowerCase().replace(/[«»"]/g, '').trim();
  const found = KINDS.find(([, re]) => re.test(t));
  return found ? found[0] : 'other';
}

export function plainText(blocks) {
  return blocks.map((b) => {
    if (b.type === 'para' || b.type === 'heading') return b.text;
    if (b.type === 'list') return b.items.map((it) => it.text + ' ' + plainText(it.children)).join(' ');
    if (b.type === 'quote') return plainText(b.blocks);
    if (b.type === 'table') return b.rows.map((r) => r.join(' ')).join(' ');
    return '';
  }).join(' ').replace(/\*\*|\*/g, '').replace(/\s+/g, ' ').trim();
}

// Файл каталога: # группа, ## карточка, ### блок. Возвращает {groups, loose}.
// loose — текст до первой группы (показывается сверху как есть).
export function parseCatalog(text, usedIds = new Set()) {
  const blocks = parseBlocks(text);
  const groups = [];
  const loose = [];
  let group = null;
  let card = null;
  let block = null;

  const newGroup = (title) => { group = { title, intro: [], cards: [] }; groups.push(group); card = null; block = null; };

  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 1) { newGroup(b.text); continue; }
    if (b.type === 'heading' && b.level === 2) {
      if (!group) newGroup('');
      const { name, subtitle } = splitTitle(b.text);
      let id = slug(name);
      let n = 2;
      while (usedIds.has(id)) id = `${slug(name)}-${n++}`;
      usedIds.add(id);
      card = { id, title: b.text, name, subtitle, lead: [], blocks: [] };
      group.cards.push(card);
      block = null;
      continue;
    }
    if (b.type === 'heading' && b.level === 3 && card) {
      block = { title: b.text, kind: blockKind(b.text), content: [] };
      card.blocks.push(block);
      continue;
    }
    if (block) block.content.push(b);
    else if (card) card.lead.push(b);
    else if (group) group.intro.push(b);
    else loose.push(b);
  }

  for (const g of groups) {
    for (const c of g.cards) {
      // Короткая строка сразу под заголовком карточки — это подпись
      if (!c.subtitle && c.lead.length === 1 && c.lead[0].type === 'para' && c.lead[0].text.length <= 100) {
        c.subtitle = c.lead[0].text;
        c.lead = [];
      }
      c.steps = [];
      for (const blk of c.blocks) {
        if (blk.kind !== 'steps' && blk.kind !== 'how') continue;
        for (const b of blk.content) {
          if (b.type === 'list' && (b.ordered || b.items.some((it) => it.task !== null))) {
            b.items.forEach((it) => c.steps.push(stepKey(it.text)));
          }
        }
      }
      c.hasResult = c.blocks.some((x) => x.kind === 'result');
      const now = c.blocks.find((x) => x.kind === 'now');
      c.nowText = now ? plainText(now.content) : '';
    }
  }
  return { groups, loose };
}

// Ключ шага: жирное начало пункта (или первые слова), чтобы правка подробностей не сбрасывала отметку.
export function stepKey(text) {
  const bold = text.match(/^\*\*(.+?)\*\*/);
  const base = (bold ? bold[1] : text.slice(0, 60)).replace(/^\d+\.\s*/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return hash(base);
}

// Расписание дня. Устройство файла:
//   # Расписание дня          — пункты с отметками; текст под заголовком — вступление
//   ## Утренняя прогулка      — пункт; строка под ним — ярлычок длительности
//   ### Что делаем / ### Подсказка
//   # В течение дня            — следующие группы показываются без отметок
// Старый формат (одна таблица «Когда | Сколько | Что тренируем») тоже понимаем.
export function parseSchedule(text) {
  const clean = stripComments(text);
  if (/^##\s/m.test(clean)) return parseScheduleSections(clean);

  const blocks = parseBlocks(clean);
  const ti = blocks.findIndex((b) => b.type === 'table');
  if (ti < 0) return null;
  const t = blocks[ti];
  const col = (re, fallback) => {
    const i = t.head.findIndex((h) => re.test(h.toLowerCase()));
    return i >= 0 ? i : fallback;
  };
  const cWhen = col(/когда|время/, 0);
  const cLong = col(/сколько|длит/, 1);
  const cWhat = col(/что|трениру/, 2);
  return {
    title: '',
    intro: blocks.slice(0, ti).filter((b) => !(b.type === 'heading' && b.level === 1)),
    footer: blocks.slice(ti + 1),
    rows: t.rows.map((r) => ({ title: r[cWhen] || '', duration: r[cLong] || '', note: r[cWhat] || '', tip: '' })),
    extra: [],
  };
}

function parseScheduleSections(clean) {
  const groups = [];
  let group = null;
  let item = null;
  let block = null;
  for (const line of clean.split('\n')) {
    const h = line.match(/^(#{1,3})\s+(.*?)\s*$/);
    if (h && h[1].length === 1) {
      group = { title: h[2], intro: [], items: [] };
      groups.push(group);
      item = null; block = null;
    } else if (h && h[1].length === 2) {
      if (!group) { group = { title: '', intro: [], items: [] }; groups.push(group); }
      item = { title: h[2], lead: [], blocks: [] };
      group.items.push(item);
      block = null;
    } else if (h && item) {
      block = { title: h[2], lines: [] };
      item.blocks.push(block);
    } else if (block) block.lines.push(line);
    else if (item) item.lead.push(line);
    else if (group) group.intro.push(line);
  }
  const text = (lines) => lines.join('\n').trim();
  const toRow = (it) => {
    const note = [];
    let tip = '';
    for (const b of it.blocks) {
      const name = b.title.toLowerCase();
      if (/^подсказка/.test(name)) tip = text(b.lines);
      else if (/^что (делаем|тренируем)/.test(name)) note.unshift(text(b.lines));
      else if (text(b.lines)) note.push(`**${b.title}.** ${text(b.lines)}`);
    }
    return { title: it.title, duration: text(it.lead).split('\n')[0].trim(), note: note.filter(Boolean).join('\n\n'), tip };
  };
  const [main, ...rest] = groups;
  return {
    title: main ? main.title : '',
    intro: main ? parseBlocks(text(main.intro)) : [],
    footer: [],
    rows: main ? main.items.map(toRow) : [],
    extra: rest.map((g) => ({ title: g.title, intro: parseBlocks(text(g.intro)), items: g.items.map(toRow) })),
  };
}
