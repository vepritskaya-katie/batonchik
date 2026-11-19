// ИИ-помощник «Спросить» (#/ask): что отправить вместе с вопросом и как хранить разговор.
// Сам ответ даёт Gemini на сервере (functions/ai.js); здесь — только сборка данных, без обращений к сети.

import { queryWords, norm } from './search.js';
import { SUBS, fmtTime, dayTitle, plural } from './diary.js';

export const ASK_KEY = 'bt.ask';     // разговор на этом телефоне
export const KEEP = 30;              // сколько реплик хранить
export const SEND_HISTORY = 8;       // сколько прошлых реплик отправлять
export const DAILY_LIMIT = 30;       // как на сервере

// С чего начать: кнопки под пустым разговором
export const STARTERS = [
  'Как прошли последние дни?',
  'Почему бывают аварии дома и что с этим делать?',
  'Что тренировать на следующей неделе?',
  'Как идут дела с одиночеством?',
];

// ---------- Журнал за две недели — коротко, по дням ----------
// events: { type, sub, text, at, day, card, grams }; cardName(ref) → «Ко мне»
export function journalText(events, { today, cardName = (x) => x } = {}) {
  const byDay = new Map();
  events.forEach((e) => {
    if (!e || !e.day || e.day > today) return;
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  });
  const days = [...byDay.keys()].sort().reverse();
  return days.map((day) => {
    const list = byDay.get(day).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
    const t = (e) => fmtTime(new Date(e.at));
    const note = (e) => (e.text ? ` «${String(e.text).replace(/\s+/g, ' ').trim().slice(0, 300)}»` : '');
    const parts = [];
    const pick = (type) => list.filter((e) => e.type === type);
    const wake = pick('wake');
    if (wake.length) parts.push(`встали ${wake.map(t).join(', ')}`);
    const toilet = pick('toilet');
    if (toilet.length) parts.push(`туалет на улице ${toilet.length}: ${toilet.map((e) => `${t(e)}${e.sub && SUBS[e.sub] ? ` (${SUBS[e.sub]})` : ''}${note(e)}`).join(', ')}`);
    const acc = pick('accident');
    if (acc.length) parts.push(`аварии дома ${acc.length}: ${acc.map((e) => `${t(e)}${e.sub && SUBS[e.sub] ? ` (${SUBS[e.sub]})` : ''}${note(e)}`).join(', ')}`);
    const walks = pick('walk');
    if (walks.length) parts.push(`прогулки: ${walks.map((e) => `${t(e)}${note(e)}`).join(', ')}`);
    const meals = pick('meal');
    if (meals.length) {
      const grams = meals.reduce((a, e) => a + (e.grams || 0), 0);
      parts.push(`еда ${meals.length} ${plural(meals.length, 'раз', 'раза', 'раз')}${grams ? `, всего ${grams} г` : ''}: ${meals.map((e) => `${t(e)}${e.grams ? ` ${e.grams} г` : ''}${note(e)}`).join(', ')}`);
    }
    const trains = pick('train');
    if (trains.length) {
      const counts = new Map();
      trains.forEach((e) => counts.set(e.card, (counts.get(e.card) || 0) + 1));
      parts.push(`повторы: ${[...counts].map(([ref, n]) => `${cardName(ref)} ${n}`).join(', ')}`);
    }
    const notes = pick('note');
    if (notes.length) parts.push(`заметки: ${notes.map((e) => `${t(e)}${note(e)}`).join('; ')}`);
    const bed = pick('bed');
    if (bed.length) parts.push(`легли ${bed.map(t).join(', ')}`);
    const title = dayTitle(day, { weekday: 'short', day: 'numeric', month: 'short' });
    return `- ${title}${day === today ? ' (сегодня)' : ''}: ${parts.join('; ') || 'записей нет'}`;
  }).join('\n');
}

// ---------- Материалы приложения, подходящие к вопросу ----------
// Частые слова вопроса, по которым искать бессмысленно
const STOP = new Set(['почему', 'зачем', 'как', 'что', 'чем', 'чего', 'когда', 'где', 'куда', 'сколько', 'какой', 'какая', 'какие', 'какую', 'каких',
  'он', 'она', 'они', 'его', 'ему', 'ее', 'её', 'мы', 'нам', 'нас', 'наш', 'наше', 'наши', 'нашего', 'мне', 'меня', 'ты', 'тебе', 'это', 'этот', 'эта', 'эти', 'того', 'тот',
  'и', 'а', 'но', 'или', 'не', 'ни', 'ли', 'бы', 'же', 'уже', 'еще', 'ещё', 'так', 'там', 'тут', 'вот', 'да', 'нет', 'если', 'чтобы', 'то', 'все', 'всё', 'всех',
  'на', 'в', 'во', 'с', 'со', 'к', 'ко', 'по', 'за', 'из', 'от', 'до', 'для', 'при', 'про', 'об', 'о', 'у',
  'делать', 'сделать', 'можно', 'нужно', 'надо', 'быть', 'есть', 'был', 'была', 'было', 'были', 'будет', 'стал', 'стало',
  'сегодня', 'вчера', 'сейчас', 'очень', 'много', 'мало', 'часто', 'иногда', 'всегда', 'батончик', 'батончика', 'батончику', 'щенок', 'щенка', 'собака', 'собаки', 'собаку']);
// items — из buildIndex (search.js): { group, src, title, href, text, nt, nx }
export function pickMaterials(items, question, { n = 4, maxChars = 2500 } = {}) {
  const words = queryWords(question).filter((w) => w.length > 2 && !STOP.has(w));
  // Названия в кавычках («Ко мне», "Буп") — ищем целиком в названиях карточек
  const quoted = [...String(question).matchAll(/[«"“]([^»"”]{2,60})[»"”]/g)].map((m) => norm(m[1]).trim()).filter(Boolean);
  if (!words.length && !quoted.length) return [];
  const scored = [];
  for (const it of items) {
    let score = 0;
    let hit = 0;
    for (const q of quoted) if (it.nt.includes(q)) { score += 30; hit++; }
    for (const w of words) {
      const inTitle = it.nt.includes(w);
      const inText = it.nx.includes(w);
      if (!inTitle && !inText) continue;
      hit++;
      score += (inTitle ? 6 : 0) + (inText ? Math.min(it.nx.split(w).length - 1, 3) : 0);
    }
    // Одно слово из нескольких — слабое совпадение, кроме совпадения в названии
    if (!hit || (words.length >= 3 && hit < 2 && score < 6)) continue;
    scored.push({ it, score: score + hit * 4 });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return scored.filter(({ it }) => (seen.has(it.href) ? false : seen.add(it.href))).slice(0, n)
    .map(({ it }) => ({ title: it.title, href: it.href, group: it.group, text: it.text.length > maxChars ? `${it.text.slice(0, maxChars)}…` : it.text }));
}

// ---------- Разговор на этом телефоне ----------
// Миниатюра фото к вопросу хранится в разговоре на телефоне — только своя, JPEG из photo.js
export const isThumb = (s) => typeof s === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 200000;
export function loadChat(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((m) => m && (m.r === 'me' || m.r === 'ai' || m.r === 'err') && typeof m.t === 'string')
      .map((m) => (m.img && !isThumb(m.img) ? { ...m, img: '' } : m)).slice(-KEEP) : [];
  } catch { return []; }
}
// Что отправить серверу как прошлый разговор: без ошибок, последние реплики. Фото прошлых вопросов не отправляем — только отметку
export const historyFor = (chat) => chat.filter((m) => m.r === 'me' || m.r === 'ai').slice(-SEND_HISTORY)
  .map((m) => ({ r: m.r, t: m.img ? `${m.t ? `${m.t}\n` : ''}[к этому вопросу было приложено фото]` : m.t }))
  .filter((m) => m.t);

// ---------- Превью без сервера: примерный ответ ----------
// { t: текст, src: источники } — в превью нет ни сервера, ни поиска
export function demoAnswer(question, withPhoto = false) {
  const q = String(question || '').toLowerCase();
  if (withPhoto) {
    return { t: '**Это пример ответа на вопрос с фото** — в превью ИИ не подключён.\n\nВ приложении Gemini сначала коротко опишет, что видно на фото, потом ответит на вопрос. Диагнозов по фото не ставит: если увидит что-то похожее на срочное, посоветует ветеринара и даст ссылку на [«Срочно»](#/lib/vet). Если по фото не понять — подскажет, как переснять.' };
  }
  if (/авари|писает дома|лужа/.test(q)) {
    return { t: 'По журналу за две недели аварий дома **3**, и все — днём, примерно через **2 ч 30 мин** после прошлого туалета. Обычно между выходами у Батончика около 2 часов, так что дело скорее в том, что выход немного затягивается.\n\n- Выводи его через 1 ч 45 мин – 2 ч, не дожидаясь сигналов.\n- После сна, еды и игры — сразу на улицу.\n- Если авария всё же случилась — спокойно убрать ферментным средством, без ругани.\n\nПодробнее — в карточке [«Туалет: от пелёнки к улице»](#/k/tualet-ot-pelenki-k-ulice).' };
  }
  if (/одиноч|одного|оставать/.test(q)) {
    return { t: 'За неделю **3 сессии**, рекорд за входной дверью — **1 мин**, вынужденных уходов дольше рекорда не было. Это хороший темп.\n\nСейчас вы на шаге 5 — «Комната за закрытой дверью». Дальше можно, когда он 5 минут спокоен в двух сессиях подряд.\n\nВсё по шагам — в [«Учимся оставаться дома»](#/alone).' };
  }
  if (/клиник|метро|электрич|поезд|магазин|купить|цен|корм/.test(q)) {
    return {
      t: 'В приложении об этом пока нет — вот что известно в целом:\n\n**Это пример ответа с поиском.** В приложении Gemini поищет в Google свежие сведения, перескажет их и покажет источники под ответом — как ниже. В превью поиска нет, источники — для примера.',
      src: [{ title: 'example.org', uri: 'https://example.org/' }, { title: 'example.com', uri: 'https://example.com/' }],
    };
  }
  return { t: '**Это пример ответа в превью** — здесь нет сервера, поэтому ИИ не подключён.\n\nВ приложении на этот вопрос ответит Gemini: она увидит журнал за две недели, план тренировок, записи «Учимся оставаться дома», социализацию, уход и подходящие карточки — и сошлётся на них, например на [«Ко мне»](#/k/ko-mne). Если в приложении такой темы нет, ответит по общим знаниям, а свежие сведения поищет в Google.' };
}
