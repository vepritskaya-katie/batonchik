// Серверная часть уведомлений «Батончика». Раз в 5 минут (функция pushTick в index.js) смотрит журнал,
// уход и здоровье и присылает уведомления на телефоны, где их включили (коллекция pushTokens).
// Подсказка «Пора в туалет», сроки ухода и даты — тем же кодом, что в приложении: перед выкладкой файлы
// js/diary.js, js/care.js, js/passport.js и js/md.js копируются в functions/shared (см. firebase.json).

import { toiletGaps, rhythmOf, toiletHint, plural, RHYTHM_SAMPLES } from './shared/diary.js';
import { CARE_ITEMS, careDue } from './shared/care.js';

export const APP_URL = 'https://vepritskaya-katie.github.io/batonchik/';
const ICON = `${APP_URL}icons/icon-192.png`;
const H = 3600000;
const MSK = 3 * H; // Москва круглый год UTC+3

// Дата и час по Москве
export const dayKey = (d) => new Date(d.getTime() + MSK).toISOString().slice(0, 10);
export const mskHour = (d) => new Date(d.getTime() + MSK).getUTCHours();
const isSunday = (d) => new Date(d.getTime() + MSK).getUTCDay() === 0;
const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// «2026-11-10» + «14:30» по Москве → Date
const moscowAt = (key, hm) => new Date(Date.parse(`${key}T${hm}:00Z`) - MSK);

// Типы уведомлений: в pushTokens.prefs у каждого телефона свои галочки
export const TYPES = ['toilet', 'care', 'week', 'game'];

const plain = (snap) => ({ id: snap.id, ...snap.data() });
const toDate = (v) => (v && typeof v.toDate === 'function' ? v.toDate() : new Date(v));
const event = (d) => ({ ...d, at: toDate(d.at) });

async function loadTokens(db) {
  return (await db.collection('pushTokens').get()).docs.map(plain).filter((t) => typeof t.token === 'string' && t.token);
}

// Одно уведомление на телефоны из списка. Отключённые телефоны (токен больше не действует) убираем из базы
export async function send(db, messaging, tokens, { title, body, link = '', tag = '' }) {
  if (!tokens.length) return 0;
  const messages = tokens.map((t) => ({
    token: t.token,
    data: { title, body, link, tag },
    webpush: {
      headers: { Urgency: 'high', TTL: String(2 * 3600) },
      notification: { title, body, icon: ICON, tag: tag || undefined },
      fcmOptions: { link: APP_URL + link },
    },
  }));
  const res = await messaging.sendEach(messages);
  const gone = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') gone.push(tokens[i].id);
  });
  await Promise.all(gone.map((id) => db.collection('pushTokens').doc(id).delete()));
  return res.successCount;
}

// «Пора в туалет»: как на главной — середина последних 30 дневных промежутков между туалетами, отсчёт от прошлого туалета.
// Промежутки прошлых дней (из журнала за 14 дней) берём раз в день и храним в push/state, сегодняшние — по записям за последние сутки.
// Присылаем один раз на каждую подсказку, если время подошло не больше часа назад и сейчас не ночь
async function toiletMessage(db, state, now, patch) {
  const today = dayKey(now);
  const hour = mskHour(now);
  if (hour < 6) return null;
  let before = state.rhythmGaps;
  if (!Array.isArray(before) || state.rhythmDay !== today) {
    const snap = await db.collection('events').where('day', '>=', addDays(today, -14)).where('day', '<', today).get();
    before = toiletGaps(snap.docs.map((d) => event(d.data()))).slice(-RHYTHM_SAMPLES);
    patch.rhythmGaps = before;
    patch.rhythmDay = today;
  }
  const snap = await db.collection('events').where('at', '>=', new Date(now.getTime() - 30 * H)).get();
  const recent = snap.docs.map((d) => event(d.data())).filter((e) => e.type !== 'train');
  if (!recent.length) return null;
  const rhythm = rhythmOf([...before, ...toiletGaps(recent.filter((e) => e.day === today))]);
  if (!rhythm.gap) return null;
  const latest = recent.reduce((a, b) => (b.at > a.at ? b : a));
  const hint = toiletHint(rhythm, recent, latest.day);
  if (!hint) return null;
  const key = hint.due.toISOString();
  if (now < hint.due || now - hint.due > H || state.toiletKey === key) return null;
  patch.toiletKey = key;
  return { title: 'Пора на улицу 🌳', body: hint.now.replace(/^Пора на улицу: /, '').replace(/^./, (c) => c.toUpperCase()), link: '#/', tag: 'toilet' };
}

// Утром в 10:00 — одним сообщением: что пора по уходу и что запланировано на сегодня и завтра
async function morningMessage(db, state, now, patch) {
  const today = dayKey(now);
  if (mskHour(now) < 10 || state.morningDay === today) return null;
  patch.morningDay = today;
  const [careSnap, healthSnap] = await Promise.all([
    db.collection('care').get(),
    db.collection('health').where('done', '==', false).get(),
  ]);
  const care = Object.fromEntries(careSnap.docs.map((d) => [d.id, cleanCare(d.data())]));
  const due = careDue(care, today).map(({ item, st }) => `${item.name.toLowerCase()} (${st.days} ${plural(st.days, 'день', 'дня', 'дней')})`);
  const health = healthSnap.docs.map(plain);
  const at = (r) => (r.time ? `, ${r.time}` : '');
  const lines = [
    ...health.filter((r) => r.date === today).map((r) => `Сегодня: ${r.title}${at(r)}`),
    ...health.filter((r) => r.date === addDays(today, 1)).map((r) => `Завтра: ${r.title}${at(r)}`),
    ...health.filter((r) => r.date < today).map((r) => `Просрочено: ${r.title}`),
    due.length ? `Пора: ${due.join(', ')}` : '',
  ].filter(Boolean);
  if (!lines.length) return null;
  return { title: 'Уход и здоровье 🩺', body: lines.join('\n'), link: '#/pass', tag: 'care' };
}

// Визит к врачу со временем — за 2 часа
async function vetMessages(db, state, now, patch) {
  const today = dayKey(now);
  const snap = await db.collection('health').where('date', '==', today).get();
  const sent = { ...(state.vetSent || {}) };
  const out = [];
  snap.docs.map(plain).filter((r) => !r.done && r.kind === 'vet' && /^\d\d:\d\d$/.test(r.time || '')).forEach((r) => {
    const visit = moscowAt(r.date, r.time);
    const key = `${r.id}_${r.date}_${r.time}`;
    if (now >= new Date(visit - 2 * H) && now < visit && !sent[key]) {
      sent[key] = true;
      out.push({ title: 'Через 2 часа — врач 🩺', body: `${r.title}, ${r.time}`, link: '#/pass', tag: `vet-${r.id}` });
    }
  });
  if (out.length) patch.vetSent = Object.fromEntries(Object.entries(sent).filter(([k]) => k.split('_')[1] >= addDays(today, -7)));
  return out;
}

// «Неделя Батончика»: в воскресенье в 19:00, если неделю ещё не заполнили
async function weekMessage(db, state, now, patch) {
  const today = dayKey(now);
  if (!isSunday(now) || mskHour(now) < 19 || state.weekDay === today) return null;
  patch.weekDay = today;
  if ((await db.collection('weeks').doc(today).get()).exists) return null;
  return { title: 'Неделя Батончика 🐾', body: 'Подведите неделю: три вопроса о благополучии, вес и заметки.', link: '#/', tag: 'week' };
}

// «Разминка дня»: в 20:00 — каждому, кто сегодня ещё не прошёл разминку (game/{uid}, см. js/game.js).
// Если второй уже прошёл — с его результатом. Один раз в день на человека
const roundDone = (g, day) => {
  const r = g && g.days && g.days[day];
  return !!(r && Array.isArray(r.q) && r.q.length && Array.isArray(r.p) && r.p.length >= r.q.length);
};
async function gameMessages(db, state, now, patch, tokens) {
  const today = dayKey(now);
  if (mskHour(now) < 20) return [];
  // gameSent: { uid: день, когда уже напомнили }
  const sent = {};
  const uids = [...new Set(tokens.map((t) => t.uid).filter((u) => typeof u === 'string' && u))]
    .filter((uid) => !(state.gameSent && state.gameSent[uid] === today));
  if (!uids.length) return [];
  const games = Object.fromEntries((await db.collection('game').get()).docs.map((d) => [d.id, d.data()]));
  const out = [];
  for (const uid of uids) {
    sent[uid] = today;
    if (roundDone(games[uid], today)) continue;
    const rival = Object.entries(games).find(([id, g]) => id !== uid && roundDone(g, today));
    let body = 'Сегодня ещё не сыграно: 5 вопросов на пару минут.';
    if (rival) {
      const r = rival[1].days[today];
      const right = (Array.isArray(r.ok) ? r.ok : []).filter(Boolean).length;
      body = `${String(rival[1].name || 'Второй игрок').slice(0, 40)}: ${right} из ${r.q.length}. Ваш ход!`;
    }
    out.push({ uid, msg: { title: 'Разминка дня 🧠', body, link: '#/game', tag: 'game' } });
  }
  patch.gameSent = sent;
  return out;
}

// Один проход: что пора прислать сейчас. Состояние (что уже прислали) — в push/state
export async function tick({ db, messaging, now = new Date() }) {
  const stateRef = db.collection('push').doc('state');
  const state = (await stateRef.get()).data() || {};
  const tokens = await loadTokens(db);
  const want = (type) => tokens.filter((t) => t.prefs && t.prefs[type] === true);
  const patch = {};
  const out = [];
  if (want('toilet').length) {
    const m = await toiletMessage(db, state, now, patch);
    if (m) out.push(['toilet', m]);
  }
  if (want('care').length) {
    const m = await morningMessage(db, state, now, patch);
    if (m) out.push(['care', m]);
    (await vetMessages(db, state, now, patch)).forEach((x) => out.push(['care', x]));
  }
  if (want('week').length) {
    const m = await weekMessage(db, state, now, patch);
    if (m) out.push(['week', m]);
  }
  // «Разминка дня» — каждому своё: только на его телефоны
  if (want('game').length) (await gameMessages(db, state, now, patch, want('game'))).forEach(({ uid, msg }) => out.push(['game', msg, uid]));
  for (const [type, m, uid] of out) await send(db, messaging, want(type).filter((t) => !uid || t.uid === uid), m);
  if (Object.keys(patch).length) await stateRef.set(patch, { merge: true });
  return out.map(([type, m, uid]) => ({ type, ...m, ...(uid ? { uid } : {}) }));
}

// Проверочное уведомление: на все телефоны этого человека
export async function testPush({ db, messaging, uid }) {
  const tokens = (await loadTokens(db)).filter((t) => t.uid === uid);
  const n = await send(db, messaging, tokens, { title: 'Уведомления работают ✓', body: 'Так будут выглядеть напоминания «Батончика».', link: '#/me', tag: 'test' });
  return { devices: tokens.length, delivered: n };
}

// Уход: { log: [дни], every } — как в приложении (store.js)
function cleanCare(v) {
  return {
    log: (Array.isArray(v.log) ? v.log : []).filter((d) => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)).sort(),
    every: Number.isInteger(v.every) ? v.every : null,
  };
}

export { CARE_ITEMS };
