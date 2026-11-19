// ИИ-помощник «Спросить»: вопрос из приложения → Gemini в Google Cloud (Vertex AI, он же Agent Platform) → ответ.
// Ключ не нужен: функция обращается к модели от имени проекта (сервисный аккаунт функций с ролью «Vertex AI User»),
// оплата — в том же счёте Google Cloud, что и Firebase.
// Спрашивать могут только адреса из allowed, как и всё остальное в базе; не больше DAILY_LIMIT вопросов в день на человека.
// Что знает о Батончике модель, собирает приложение (js/ask.js): записи, план, одиночество, уход и подходящие карточки.
// Свежие сведения модель может поискать в Google (поиск Google в ответах Vertex AI, платится за каждый поиск):
// источники и блок поисковых подсказок Google приложение показывает под ответом.

// Основная модель — первая; если её нет (сняли или переименовали), берётся следующая
export const AI_MODELS = ['gemini-3.1-pro-preview', 'gemini-3.8-flash'];
export const AI_LOCATION = 'global';
export const DAILY_LIMIT = 30;
export const MAX_QUESTION = 2000;   // символов в вопросе
export const MAX_CONTEXT = 60000;   // символов: записи Батончика и материалы, которые собрало приложение
export const MAX_HISTORY = 8;       // прошлых реплик разговора
export const MAX_REPLY = 6000;      // символов в одной прошлой реплике
export const MAX_SOURCES = 6;       // источников из поиска под ответом
export const MAX_IMAGE = 1600000;   // фото к вопросу: символов base64 (~1,2 МБ; приложение сжимает до 1280 px)
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_ONLY = 'Посмотри на фото.'; // если прислали фото без слов
export const MAX_SEARCH_HTML = 30000; // блок поисковых подсказок Google

export const SYSTEM = `Ты — помощник в приложении «Батончик». Его ведут двое хозяев щенка австралийской овчарки (аусси) по кличке Батончик. Они не профессиональные кинологи и учатся вместе со щенком.

Как отвечать:
- По-русски, на «ты», тепло и по делу. Обычно 3–8 предложений или короткий список. Длиннее — только если просят план, разбор или сравнение.
- Без таблиц и заголовков: ответ читают с телефона. Можно **жирный** шрифт, списки и ссылки.
- Сначала опирайся на данные Батончика из приложения (журнал, план, записи «Учимся оставаться дома», социализация, уход, паспорт) и на материалы приложения — карточки тренировок, Библиотеку и «Практику». Они даны в сообщении пользователя в блоке «Данные из приложения». Если материалы приложения и общие знания расходятся, держись материалов приложения.
- Если в материалах приложения этой темы нет или вопрос общий — отвечай по своим знаниям о собаках: поведение, дрессировка, здоровье и уход, кормление, снаряжение, породы, жизнь с собакой в городе и в поездках. Такой ответ начни с короткой пометки: «В приложении об этом пока нет — вот что известно в целом:». Держись современного научного взгляда; если специалисты расходятся во мнениях или ты не уверен, так и скажи.
- Можно отвечать и на вопросы не о Батончике — о собаках вообще.
- К вопросу может быть приложено фото (лапа, кожа, глаз, стул, игрушка, корм, растение, поза или поведение). Сначала коротко опиши, что видно, потом ответь. По фото диагнозов не ставь: если видно что-то похожее на срочное (кровь, сильный отёк, рана, клещ в коже, необычный цвет стула) — советуй ветеринара. Если по фото не понять, скажи, как переснять: ближе, при дневном свете, с другого ракурса.
- Данные Батончика не придумывай: цифры, даты, события и записи бери только из блока данных. Если для ответа их не хватает, скажи, что стоит записать или проверить.
- Ищи в Google, когда нужны свежие или конкретные сведения: адреса и часы работы клиник и магазинов, цены, правила перевозки и поездок, новости, отзывы о кормах и снаряжении, — или когда темы нет в приложении и ты не уверен в ответе. Если хватает данных и материалов приложения, не ищи. Найденное перескажи своими словами и скажи, если источники расходятся.
- Ссылайся на карточки и статьи приложения markdown-ссылками ровно в том виде, как они даны в данных, например [«Ко мне»](#/k/ko-mne). Адреса сайтов в текст не вставляй и не придумывай: найденные в поиске источники приложение само покажет под ответом.
- Методы — только на положительном подкреплении, как в материалах приложения: без наказаний, рывков поводка, ошейников-удавок и «доминирования».
- Ты не ветеринар. Если описаны рвота или понос с кровью, вялость, отказ от еды и воды, хромота, судороги, подозрение на отравление, укус клеща с ухудшением или что-то похожее на срочное — прямо советуй ехать к ветеринару и дай ссылку [«Срочно»](#/lib/vet).
- Дозировки лекарств не называй — их назначает ветеринар. У аусси бывает мутация MDR1, из-за которой опасны некоторые лекарства: когда речь о лекарствах, напоминай о ней, если в паспорте MDR1 не проверяли, и давай ссылку [«Опасные лекарства при MDR1»](#/t/opasnye-lekarstva-pri-mdr1).
- Если в данных видно что-то важное, о чём не спросили (например, давно не было туалета или пропущена обработка от клещей), коротко упомяни это в конце.`;

// Московский день: «ГГГГ-ММ-ДД»
export const moscowDay = (now = new Date()) => new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);

const cut = (s, n) => String(s == null ? '' : s).slice(0, n);

// Что пришло из приложения: вопрос, данные и прошлые реплики. Лишнее обрезаем, чтобы запрос не разрастался
export function cleanInput(data) {
  const d = data && typeof data === 'object' ? data : {};
  let image = null;
  if (d.image) {
    const mime = String(d.image.mime || '');
    const b64 = String(d.image.data || '');
    if (!IMAGE_TYPES.includes(mime) || !b64 || b64.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      throw Object.assign(new Error('image'), { code: 'image' });
    }
    image = { mime, data: b64 };
  }
  let question = cut(d.question, MAX_QUESTION).trim();
  if (!question && image) question = PHOTO_ONLY;
  if (!question) throw Object.assign(new Error('empty'), { code: 'empty' });
  const context = cut(d.context, MAX_CONTEXT).trim();
  const history = (Array.isArray(d.history) ? d.history : [])
    .filter((m) => m && (m.r === 'me' || m.r === 'ai') && typeof m.t === 'string' && m.t.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ r: m.r, t: cut(m.t, MAX_REPLY) }));
  return { question, context, history, image };
}

// Разговор для модели: прошлые реплики, затем данные приложения и новый вопрос
export function buildContents({ question, context, history, image = null }) {
  const contents = history.map((m) => ({ role: m.r === 'me' ? 'user' : 'model', parts: [{ text: m.t }] }));
  // У Gemini разговор начинается с реплики пользователя
  while (contents.length && contents[0].role !== 'user') contents.shift();
  const text = context ? `Данные из приложения на сейчас:\n\n${context}\n\n---\n\n${image ? 'К вопросу приложено фото.\n' : ''}Вопрос: ${question}` : question;
  contents.push({ role: 'user', parts: image ? [{ inlineData: { mimeType: image.mime, data: image.data } }, { text }] : [{ text }] });
  return contents;
}

// Счётчик вопросов: aiUsage/{uid} = { day, count }. Коллекция закрыта для приложения правилами (пишет только сервер)
export async function takeQuota(db, uid, day, limit = DAILY_LIMIT) {
  const ref = db.collection('aiUsage').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : {};
    const count = cur.day === day ? cur.count || 0 : 0;
    if (count >= limit) return { ok: false, left: 0 };
    tx.set(ref, { day, count: count + 1 });
    return { ok: true, left: limit - count - 1 };
  });
}
// Ответа не получилось — вопрос не считаем
export async function refundQuota(db, uid, day) {
  const ref = db.collection('aiUsage').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data();
    if (cur.day === day && cur.count > 0) tx.set(ref, { day, count: cur.count - 1 });
  }).catch(() => {});
}

const statusOf = (err) => +(err && (err.status || err.code || (err.error && err.error.code))) || 0;

// Что нашёл поиск: источники (только https), блок поисковых подсказок Google и сами запросы
export function groundingOf(res) {
  const cand = res && Array.isArray(res.candidates) ? res.candidates[0] : null;
  const g = (cand && cand.groundingMetadata) || {};
  const seen = new Set();
  const sources = (Array.isArray(g.groundingChunks) ? g.groundingChunks : [])
    .map((c) => c && c.web)
    .filter((w) => w && typeof w.uri === 'string' && /^https:\/\//.test(w.uri))
    .map((w) => ({ title: cut(w.title || w.domain || new URL(w.uri).hostname, 120).trim(), uri: cut(w.uri, 2000) }))
    .filter((w) => (seen.has(w.title) ? false : seen.add(w.title)))
    .slice(0, MAX_SOURCES);
  const html = g.searchEntryPoint && typeof g.searchEntryPoint.renderedContent === 'string' ? g.searchEntryPoint.renderedContent : '';
  const queries = (Array.isArray(g.webSearchQueries) ? g.webSearchQueries : []).filter((q) => typeof q === 'string').map((q) => cut(q, 200)).slice(0, 5);
  return { sources, searchHtml: html.length <= MAX_SEARCH_HTML ? html : '', queries };
}

// generate({ model, contents, config }) → ответ модели (в index.js — @google/genai, в проверках — заглушка).
// search — разрешить поиск Google. Если модель не принимает поиск, повторяем без него
export async function askModel(generate, contents, models = AI_MODELS, { search = true } = {}) {
  let lastErr = null;
  for (const model of models) {
    for (const withSearch of search ? [true, false] : [false]) {
      try {
        const config = { systemInstruction: SYSTEM, maxOutputTokens: 8192, temperature: 0.6 };
        if (withSearch) config.tools = [{ googleSearch: {} }];
        const res = await generate({ model, contents, config });
        const text = String((res && res.text) || '').trim();
        if (!text) throw Object.assign(new Error('Пустой ответ модели'), { status: 500, empty: true });
        return { text, model, ...(withSearch ? groundingOf(res) : { sources: [], searchHtml: '', queries: [] }) };
      } catch (err) {
        lastErr = err;
        const st = statusOf(err);
        if (withSearch && st === 400 && /search|ground|tool/i.test(String(err && err.message))) continue; // без поиска
        if (st === 404) break; // «модели нет» — следующая модель
        throw err;
      }
    }
  }
  throw lastErr;
}

// Понятный текст ошибки — его увидят в приложении
export function errorText(err) {
  const status = statusOf(err);
  const msg = String((err && err.message) || '');
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled|API.*not.*enabled/i.test(msg)) {
    return 'ИИ ещё не подключён: в Google Cloud не включён сервис Vertex AI. Это шаг 1 инструкции в README («ИИ-помощник»).';
  }
  if (status === 403 || status === 401) {
    return 'У сервера нет доступа к ИИ: сервисному аккаунту функций не выдана роль «Vertex AI User». Это шаг 2 инструкции в README («ИИ-помощник»).';
  }
  if (status === 404) return 'Модель Gemini не найдена — возможно, Google её переименовал. Напишите разработчику, нужно поменять название модели.';
  if (status === 429) return 'ИИ сейчас перегружен. Попробуйте через минуту.';
  if (err && err.empty) return 'ИИ не смог ответить на этот вопрос. Попробуйте переформулировать.';
  return 'Не получилось получить ответ. Попробуйте ещё раз чуть позже.';
}
