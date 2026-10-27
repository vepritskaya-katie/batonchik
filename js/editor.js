// Редактор карточек: карточка ⇄ форма с полями ⇄ Markdown.
// Пользователь не пишет разметку заголовков: название, подпись, блоки и шаги — отдельные поля.

import { escapeHtml, splitHint } from './md.js';

// Блоки, которые предлагаются для новой карточки и кнопками «+ блок»
export const SUGGESTED_BLOCKS = {
  k: ['Зачем и что значит', 'Понадобится', 'Шаги', 'Освоено, когда', 'Как поддерживать', 'Важно'],
  g: ['Зачем и что значит', 'Понадобится', 'Шаги', 'Освоено, когда', 'Как поддерживать', 'Важно'],
  t: ['Почему так', 'Понадобится', 'Шаги', 'Что делать', 'Чего не делать', 'Получается, если', 'Когда к ветеринару', 'Подсказка'],
};

const isStepsTitle = (t) => /^шаги/i.test(t.trim());
export const DEFAULT_REPS = 5;
const REPS_TITLE = 'Повторов в день';
// Число повторов в день: только цифры, от 1 до 50
const cleanReps = (v) => { const n = parseInt(String(v || '').replace(/\D/g, ''), 10); return n ? Math.min(50, Math.max(1, n)) : ''; };

// «Советы» правятся свободно: название, подпись и один текст; блоки — подзаголовки «## …» внутри текста
const isFree = (tab) => tab === 't';

export function emptyForm(tab, group) {
  if (isFree(tab)) return { group: group || '', name: '', subtitle: '', free: true, text: '', lead: '', reps: '', result: false, blocks: [] };
  return {
    group: group || '',
    name: '',
    subtitle: '',
    reps: tab === 'k' ? DEFAULT_REPS : '',
    lead: '',
    result: tab !== 't',
    blocks: SUGGESTED_BLOCKS[tab].map((title) => (isStepsTitle(title)
      ? { title, type: 'steps', steps: [{ name: '', text: '', hint: '', label: '' }] }
      : { title, type: 'text', text: '' })),
  };
}

// Разобранная карточка (из md.js) → форма
export function cardToForm(card, group, tab) {
  if (isFree(tab)) {
    const parts = [card.leadRaw, ...card.blocks.map((b) => `## ${b.title}\n${b.raw}`.trim())].filter(Boolean);
    return { group: group || '', name: card.name, subtitle: card.subtitle, free: true, text: parts.join('\n\n'), lead: '', reps: '', result: false, blocks: [] };
  }
  const form = {
    group: group || '',
    name: card.name,
    subtitle: card.subtitle,
    reps: card.reps || (tab === 'k' ? DEFAULT_REPS : ''),
    lead: card.subtitleFromLead ? '' : card.leadRaw,
    result: false,
    blocks: [],
  };
  for (const b of card.blocks) {
    if (b.kind === 'reps') continue; // это поле формы, а не блок
    if (b.kind === 'result' && isSingleResult(b)) { form.result = true; continue; }
    const steps = b.kind === 'steps' ? stepsFromBlock(b) : null;
    if (steps) form.blocks.push({ title: b.title, type: 'steps', steps });
    else form.blocks.push({ title: b.title, type: 'text', text: b.raw });
  }
  return form;
}

function isSingleResult(b) {
  return b.content.length === 1 && b.content[0].type === 'list' && b.content[0].items.length === 1;
}

// Шаги разбираем на поля, только если в блоке нет ничего, кроме списка, а под шагами — ничего, кроме подсказки;
// иначе блок правится как текст, чтобы не потерять вложенные пункты
const HINT_ITEM_RE = /^((?:Дальше|Переход),?\s+когда)\s*:?\s*/i;
const onlyHintChildren = (it) => it.children.every((ch) => ch.type === 'list' && ch.items.every((s) => HINT_ITEM_RE.test(s.text)));
function stepsFromBlock(b) {
  if (!b.content.length || b.content.some((x) => x.type !== 'list')) return null;
  if (b.content.some((list) => list.items.some((it) => !onlyHintChildren(it)))) return null;
  return b.content.flatMap((list) => list.items.map((it) => {
    let text = it.text;
    let name = '';
    const bold = text.match(/^\*\*(.+?)\*\*\s*/);
    if (bold) {
      name = bold[1].replace(/^\d+\.\s*/, '').trim();
      text = text.slice(bold[0].length);
    }
    let { main, hint, label } = splitHint(text);
    // Старый формат: подсказка отдельным пунктом под шагом
    for (const child of it.children) {
      if (child.type !== 'list') continue;
      for (const sub of child.items) {
        const m = sub.text.match(HINT_ITEM_RE);
        if (m && !hint) { hint = sub.text.slice(m[0].length); label = m[1]; }
      }
    }
    return { name, text: main, hint, label };
  }));
}

// Форма → Markdown одной карточки
export function formToMd(form) {
  const clean = (t) => String(t || '').replace(/\r/g, '').replace(/^\s*#+\s*/gm, '').trim();
  const oneLine = (t) => clean(t).replace(/\s*\n\s*/g, ' ');
  const out = [`## ${oneLine(form.name) || 'Без названия'}`];
  if (oneLine(form.subtitle)) out.push(oneLine(form.subtitle));
  out.push('');
  if (form.free) {
    // Подзаголовок в тексте («# …», «## …» или «### …») — это блок карточки «### …»
    const body = String(form.text || '').replace(/\r/g, '').split('\n')
      .map((line) => {
        const m = line.match(/^\s{0,3}#{1,3}(?:\s+(.*?))?\s*#*\s*$/);
        return m ? (m[1] ? `### ${m[1]}` : '') : line; // пустой «##» без текста просто убираем
      }).join('\n').trim();
    if (body) out.push(body);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  if (clean(form.lead)) out.push(clean(form.lead), '');
  if (cleanReps(form.reps)) out.push(`### ${REPS_TITLE}`, String(cleanReps(form.reps)), '');
  for (const b of form.blocks) {
    const title = oneLine(b.title);
    if (!title) continue;
    out.push(`### ${title}`);
    if (b.type === 'steps') {
      b.steps.filter((st) => oneLine(st.name) || oneLine(st.text)).forEach((st, i) => {
        let name = oneLine(st.name);
        const text = oneLine(st.text);
        // Точка после названия — только если описание начинается новой фразой («**Лифт.** Встаньте…»),
        // а не продолжает её («**Рука у морды** → кусочек»)
        if (name && !/[.!?:…]$/.test(name) && (!text || /^\p{Lu}/u.test(text))) name += '.';
        const parts = [`- [ ] ${name ? `**${i + 1}. ${name}**` : `**${i + 1}.**`}`];
        if (text) parts.push(text);
        if (oneLine(st.hint)) parts.push(`**${oneLine(st.label) || 'Дальше, когда'}:** ${oneLine(st.hint)}`);
        out.push(parts.join(' '));
      });
    } else if (clean(b.text)) {
      out.push(clean(b.text));
    }
    out.push('');
  }
  if (form.result) out.push('### Итог', '- [ ] Освоено', '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- Разметка формы ----------

const field = (path, value, opts = {}) => (opts.area
  ? `<textarea data-path="${path}" rows="${opts.rows || 4}" maxlength="${opts.max || 8000}"${opts.ph ? ` placeholder="${escapeHtml(opts.ph)}"` : ''}>${escapeHtml(value || '')}</textarea>`
  : `<input data-path="${path}" value="${escapeHtml(value || '')}" maxlength="${opts.max || 200}"${opts.ph ? ` placeholder="${escapeHtml(opts.ph)}"` : ''}>`);

const moveBtns = (kind, i, n, extra = '') => `
  <button type="button" class="icon-btn" data-action="ed-move" data-kind="${kind}" data-i="${i}" data-dir="-1"${extra} aria-label="Выше"${i === 0 ? ' disabled' : ''}>↑</button>
  <button type="button" class="icon-btn" data-action="ed-move" data-kind="${kind}" data-i="${i}" data-dir="1"${extra} aria-label="Ниже"${i === n - 1 ? ' disabled' : ''}>↓</button>
  <button type="button" class="icon-btn danger" data-action="ed-remove" data-kind="${kind}" data-i="${i}"${extra} aria-label="Удалить">✕</button>`;

// Кнопки внизу формы: сохранить, вернуть как в файле, удалить
function actionsHtml(isNew, canReset) {
  return `<div class="form-actions"><button type="button" class="btn" data-action="ed-cancel">Отмена</button><button class="btn primary">Сохранить</button></div>
    ${isNew ? '' : `<div class="ed-danger">
      ${canReset ? '<button type="button" class="btn danger-outline wide" data-action="ed-reset">Вернуть как в файле</button>' : ''}
      <button type="button" class="btn danger-outline wide" data-action="ed-delete">Удалить карточку</button></div>`}`;
}

const groupSelect = (form, isNew, groups) => (isNew && groups.length > 1 ? `<label>Раздел <select data-path="group">${groups.map((g) =>
  `<option${g === form.group ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}</select></label>` : '');

// Совет — свободный текст: название, подпись и одно поле с кнопками оформления
function freeEditorHtml({ form, isNew, groups, canReset, title }) {
  return `<form class="form editor" data-editor="1">
    <h1>${escapeHtml(title)}</h1>
    ${groupSelect(form, isNew, groups)}
    <label>Название ${field('name', form.name, { ph: 'Например: Первая прогулка в новом месте' })}</label>
    <label>Подпись <span class="muted">(необязательно, коротко)</span> ${field('subtitle', form.subtitle, { max: 100, ph: 'Одна строка под названием' })}</label>
    <div class="ed-article">
      <span class="ed-label">Текст</span>
      <div class="ed-toolbar" role="toolbar" aria-label="Оформление текста">
        <button type="button" class="btn small" data-action="ed-fmt" data-fmt="h">Подзаголовок</button>
        <button type="button" class="btn small" data-action="ed-fmt" data-fmt="list">• Список</button>
        <button type="button" class="btn small" data-action="ed-fmt" data-fmt="bold"><b>Ж</b>ирный</button>
      </div>
      <textarea data-path="text" rows="16" maxlength="28000" aria-label="Текст совета" placeholder="Пишите как обычный текст. Абзацы — через пустую строку.">${escapeHtml(form.text || '')}</textarea>
    </div>
    <p class="muted small">Подзаголовок — строка, которая начинается с «## », пункт списка — с «- », **слово** — жирный шрифт.
      Подзаголовки «Почему так», «Что делать», «Чего не делать», «Получается, если», «Подсказка», «Когда к ветеринару» выделяются цветом, как раньше.</p>
    ${actionsHtml(isNew, canReset)}
  </form>`;
}

// Кнопка оформления в тексте совета: «Подзаголовок» и «Список» — для строк под курсором, «Жирный» — для выделения.
// Возвращает новый текст и где поставить курсор.
export function formatText(value, start, end, fmt) {
  if (fmt === 'bold') {
    const sel = value.slice(start, end);
    const text = `${value.slice(0, start)}**${sel}**${value.slice(end)}`;
    return sel ? { value: text, start, end: end + 4 } : { value: text, start: start + 2, end: start + 2 };
  }
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (to < 0) to = value.length;
  const lines = value.slice(from, to).split('\n');
  let out;
  if (fmt === 'h') {
    // Повторное нажатие на подзаголовке убирает «## »
    out = [/^##\s/.test(lines[0]) ? lines[0].replace(/^##\s+/, '') : `## ${lines[0].replace(/^#+\s*/, '')}`, ...lines.slice(1)];
  } else {
    const filled = lines.filter((l) => l.trim());
    const allList = filled.length && filled.every((l) => /^- /.test(l));
    out = !filled.length ? ['- '] : lines.map((l) => (!l.trim() ? l : allList ? l.replace(/^- /, '') : (/^- /.test(l) ? l : `- ${l}`)));
  }
  const block = out.join('\n');
  const pos = from + block.length;
  return { value: value.slice(0, from) + block + value.slice(to), start: pos, end: pos };
}

export function editorHtml({ tab, form, isNew, groups, canReset, title }) {
  if (form.free) return freeEditorHtml({ form, isNew, groups, canReset, title });
  const blocks = form.blocks.map((b, i) => {
    const body = b.type === 'steps'
      ? `<ol class="ed-steps">${b.steps.map((st, j) => `<li class="ed-step">
          <div class="ed-row"><span class="num">${j + 1}</span>${moveBtns('step', j, b.steps.length, ` data-b="${i}"`)}</div>
          <label>Название шага ${field(`b.${i}.s.${j}.name`, st.name, { ph: 'Например: Ладонь у носа' })}</label>
          <label>Что делать ${field(`b.${i}.s.${j}.text`, st.text, { area: true, rows: 3 })}</label>
          <label>${escapeHtml(st.label || 'Дальше, когда')} ${field(`b.${i}.s.${j}.hint`, st.hint, { max: 500, ph: 'Критерий перехода, например: 8 из 10' })}</label>
        </li>`).join('')}</ol>
        <button type="button" class="btn small" data-action="ed-add-step" data-b="${i}">+ Шаг</button>`
      : field(`b.${i}.text`, b.text, { area: true, rows: 5 });
    return `<fieldset class="ed-block">
      <div class="ed-row"><input class="ed-title" data-path="b.${i}.title" value="${escapeHtml(b.title)}" maxlength="100" aria-label="Название блока">
        ${moveBtns('block', i, form.blocks.length)}</div>
      ${body}
    </fieldset>`;
  }).join('');

  const have = new Set(form.blocks.map((b) => b.title.trim().toLowerCase()));
  const suggestions = SUGGESTED_BLOCKS[tab].filter((t) => !have.has(t.toLowerCase()))
    .map((t) => `<button type="button" class="btn small" data-action="ed-add-block" data-title="${escapeHtml(t)}">+ ${escapeHtml(t)}</button>`).join('');

  return `<form class="form editor" data-editor="1">
    <h1>${escapeHtml(title)}</h1>
    ${groupSelect(form, isNew, groups)}
    <label>Название ${field('name', form.name, { ph: 'Например: «Место»' })}</label>
    <label>Подпись <span class="muted">(необязательно, коротко)</span> ${field('subtitle', form.subtitle, { max: 100, ph: 'Например: с ~6 месяцев' })}</label>
    ${tab === 'k' ? `<label class="reps-field">Повторов в день <span class="muted">(цель на главном экране)</span>
      <input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="50" step="1" data-path="reps" value="${escapeHtml(String(form.reps || DEFAULT_REPS))}"></label>` : ''}
    <label>Вступление <span class="muted">(необязательно)</span> ${field('lead', form.lead, { area: true, rows: 2 })}</label>
    <p class="muted small">В тексте блоков: строка, начинающаяся с «- », — пункт списка; **слово** — жирный шрифт.</p>
    ${blocks}
    <div class="ed-add">${suggestions}<button type="button" class="btn small" data-action="ed-add-block" data-title="">+ Свой блок</button></div>
    <label class="check-row"><input type="checkbox" data-path="result"${form.result ? ' checked' : ''}> Кнопка «Освоено» для всей карточки</label>
    ${actionsHtml(isNew, canReset)}
  </form>`;
}

// Записать значение поля в форму по пути вида «b.2.s.0.name»
export function setPath(form, path, value) {
  const parts = path.split('.');
  let obj = form;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] === 'b' ? 'blocks' : parts[i] === 's' ? 'steps' : parts[i];
    obj = obj[key];
    if (obj == null) return;
  }
  obj[parts[parts.length - 1]] = value;
}

export function editorAction(form, action, data) {
  const swap = (list, i, dir) => {
    const j = i + dir;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  };
  const i = +data.i;
  if (action === 'ed-add-block') {
    const title = data.title || 'Новый блок';
    form.blocks.push(isStepsTitle(title)
      ? { title, type: 'steps', steps: [{ name: '', text: '', hint: '', label: '' }] }
      : { title, type: 'text', text: '' });
  } else if (action === 'ed-add-step') {
    form.blocks[+data.b].steps.push({ name: '', text: '', hint: '', label: '' });
  } else if (action === 'ed-move') {
    if (data.kind === 'block') swap(form.blocks, i, +data.dir);
    else swap(form.blocks[+data.b].steps, i, +data.dir);
  } else if (action === 'ed-remove') {
    if (data.kind === 'block') form.blocks.splice(i, 1);
    else form.blocks[+data.b].steps.splice(i, 1);
  }
}
