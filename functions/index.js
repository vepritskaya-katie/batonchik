// Firebase Cloud Functions «Батончика»: уведомления на телефон.
// pushTick — раз в 5 минут проверяет, что пора прислать (см. core.js);
// sendTestPush — «Прислать проверочное» в настройках приложения.

import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { tick, testPush } from './core.js';

// Бельгия — ближайший к Москве регион; одна копия функции — больше не нужно
setGlobalOptions({ region: 'europe-west1', maxInstances: 1, memory: '256MiB' });
initializeApp();

export const pushTick = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Europe/Moscow', retryCount: 0 }, async () => {
  const sent = await tick({ db: getFirestore(), messaging: getMessaging(), now: new Date() });
  if (sent.length) console.log('Отправлено:', sent.map((m) => `${m.type}: ${m.title}`).join('; '));
});

// Только для тех, кто есть в списке допущенных (allowed), как и всё остальное в базе
export const sendTestPush = onCall(async (req) => {
  const auth = req.auth;
  const email = auth && auth.token && auth.token.email_verified && String(auth.token.email || '').toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Нужно войти через Google.');
  const db = getFirestore();
  if (!(await db.collection('allowed').doc(email).get()).exists) throw new HttpsError('permission-denied', 'Этого адреса нет в списке допущенных.');
  return testPush({ db, messaging: getMessaging(), uid: auth.uid });
});
