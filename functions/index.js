// Firebase Cloud Functions «Батончика»: уведомления на телефон и ИИ-помощник.
// pushTick — раз в 5 минут проверяет, что пора прислать (см. core.js);
// sendTestPush — «Прислать проверочное» в настройках приложения;
// askAi — «Спросить» в приложении: ответ Gemini (см. ai.js).

import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { GoogleGenAI } from '@google/genai';
import { tick, testPush } from './core.js';
import { AI_LOCATION, cleanInput, buildContents, takeQuota, refundQuota, askModel, errorText, moscowDay } from './ai.js';

// Бельгия — ближайший к Москве регион; одна копия функции — больше не нужно
setGlobalOptions({ region: 'europe-west1', maxInstances: 1, memory: '256MiB' });
initializeApp();

export const pushTick = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Europe/Moscow', retryCount: 0 }, async () => {
  const sent = await tick({ db: getFirestore(), messaging: getMessaging(), now: new Date() });
  if (sent.length) console.log('Отправлено:', sent.map((m) => `${m.type}: ${m.title}`).join('; '));
});

// Только для тех, кто есть в списке допущенных (allowed), как и всё остальное в базе
async function allowedUser(req) {
  const auth = req.auth;
  const email = auth && auth.token && auth.token.email_verified && String(auth.token.email || '').toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Нужно войти через Google.');
  const db = getFirestore();
  if (!(await db.collection('allowed').doc(email).get()).exists) throw new HttpsError('permission-denied', 'Этого адреса нет в списке допущенных.');
  return { db, uid: auth.uid };
}

export const sendTestPush = onCall(async (req) => {
  const { db, uid } = await allowedUser(req);
  return testPush({ db, messaging: getMessaging(), uid });
});

// «Спросить»: Gemini в Google Cloud от имени проекта — без ключа; может искать в Google. Нужны включённый сервис Vertex AI
// и роль «Vertex AI User» у сервисного аккаунта функций (README, «ИИ-помощник»)
let genai = null;
export const askAi = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const { db, uid } = await allowedUser(req);
  let input;
  try { input = cleanInput(req.data); } catch (err) {
    throw new HttpsError('invalid-argument', err && err.code === 'image' ? 'Не получилось прочитать фото — попробуйте другое.' : 'Пустой вопрос.');
  }
  const day = moscowDay();
  const quota = await takeQuota(db, uid, day);
  if (!quota.ok) throw new HttpsError('resource-exhausted', 'На сегодня вопросы закончились — завтра можно снова.');
  if (!genai) genai = new GoogleGenAI({ enterprise: true, project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT, location: AI_LOCATION });
  try {
    const { text, model, sources, searchHtml, queries } = await askModel((params) => genai.models.generateContent(params), buildContents(input));
    return { text, model, sources, searchHtml, queries, left: quota.left };
  } catch (err) {
    console.error('askAi:', err && err.status, err && err.message);
    await refundQuota(db, uid, day);
    throw new HttpsError('unavailable', errorText(err));
  }
});
