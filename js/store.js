// Хранение отметок и распорядка.
// Если Firebase настроен — общие данные в Firestore, обновления в реальном времени.
// Если нет — всё хранится только на этом телефоне (localStorage), чтобы приложением можно было пользоваться сразу.

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

export function isConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !/ВСТАВЬТЕ/i.test(firebaseConfig.apiKey));
}

// Состояние: mode 'local' | 'firebase'; status 'loading' | 'signed-out' | 'denied' | 'ready' | 'error'
export function createStore(handlers) {
  return isConfigured() ? firebaseStore(handlers) : localStore(handlers);
}

const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* память переполнена или запрещена */ }
};

// ---------- Только этот телефон ----------

function localStore({ onState, onPlan, onDay, onMarks }) {
  let day = null;
  const state = { mode: 'local', status: 'ready', user: { name: '' } };
  const mark = () => ({ uid: 'local', name: '', at: new Date().toISOString() });
  const revive = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, at: v.at ? new Date(v.at) : null }]));

  return {
    start() {
      onState(state);
      onPlan(read('bt.plan', null), { fromServer: true });
      onMarks(revive(read('bt.marks', {})));
    },
    setDay(key) {
      day = key;
      onDay(revive(read('bt.day.' + key, {})));
      // Старые дни на телефоне не храним
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('bt.day.') && k !== 'bt.day.' + key)
          .forEach((k) => localStorage.removeItem(k));
      } catch { /* ничего */ }
    },
    setCheck(key, on) {
      const all = read('bt.day.' + day, {});
      if (on) all[key] = mark(); else delete all[key];
      write('bt.day.' + day, all);
      onDay(revive(all));
    },
    setMark(id, on) {
      const all = read('bt.marks', {});
      if (on) all[id] = mark(); else delete all[id];
      write('bt.marks', all);
      onMarks(revive(all));
    },
    savePlan(plan) { write('bt.plan', plan); onPlan(plan, { fromServer: true }); },
    seedPlan(plan) { this.savePlan(plan); },
    signIn() {}, signOut() {},
  };
}

// ---------- Firebase ----------

function firebaseStore({ onState, onPlan, onDay, onMarks, onError }) {
  const state = { mode: 'firebase', status: 'loading', user: null, message: '' };
  let fb = null; // модули SDK
  let db = null;
  let auth = null;
  let day = null;
  let unsubs = [];
  let dayUnsub = null;

  const emit = (patch) => { Object.assign(state, patch); onState({ ...state }); };
  const fail = (err) => onError && onError(explain(err));

  const toMark = (v) => ({ uid: v.uid, name: v.name || '', at: v.at && v.at.toDate ? v.at.toDate() : null });

  function stopListeners() {
    unsubs.forEach((u) => u());
    unsubs = [];
    if (dayUnsub) { dayUnsub(); dayUnsub = null; }
  }

  function listenDay() {
    if (dayUnsub) { dayUnsub(); dayUnsub = null; }
    if (!day || state.status !== 'ready') return;
    const { doc, onSnapshot } = fb.fs;
    dayUnsub = onSnapshot(doc(db, 'days', day), (snap) => {
      const checks = (snap.data({ serverTimestamps: 'estimate' }) || {}).checks || {};
      onDay(Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, toMark(v)])));
    }, fail);
  }

  function startListeners() {
    const { doc, collection, onSnapshot } = fb.fs;
    unsubs.push(onSnapshot(doc(db, 'settings', 'plan'), (snap) => {
      const d = snap.data();
      onPlan(d ? { schedule: d.schedule || [], focus: d.focus || [] } : null, { fromServer: !snap.metadata.fromCache });
    }, fail));
    unsubs.push(onSnapshot(collection(db, 'marks'), (snap) => {
      const marks = {};
      snap.forEach((d) => { marks[d.id] = toMark(d.data({ serverTimestamps: 'estimate' })); });
      onMarks(marks);
    }, fail));
    listenDay();
  }

  // Сверка со списком допущенных. Если этот телефон уже проходил проверку,
  // приложение открывается сразу (в том числе без интернета), а сверка идёт в фоне.
  async function checkAccess(user) {
    const { doc, getDoc } = fb.fs;
    const email = (user.email || '').toLowerCase();
    const cacheKey = 'bt.allowed.' + user.uid;
    const fallbackName = (user.displayName || email.split('@')[0] || '').split(' ')[0];
    const ready = (name) => {
      const wasReady = state.status === 'ready';
      emit({ status: 'ready', user: { name, email, uid: user.uid } });
      if (!wasReady) startListeners();
    };
    const cached = read(cacheKey, null);
    if (cached) ready(cached.name);
    else emit({ status: 'loading', user: { name: fallbackName, email } });
    try {
      const snap = await getDoc(doc(db, 'allowed', email));
      if (auth.currentUser !== user) return;
      if (!snap.exists()) {
        write(cacheKey, null);
        stopListeners();
        return emit({ status: 'denied', user: { name: fallbackName, email } });
      }
      const name = String(snap.data().name || fallbackName).slice(0, 40);
      write(cacheKey, { name });
      if (state.status !== 'ready' || state.user.name !== name) ready(name);
    } catch (err) {
      if (state.status === 'ready' || auth.currentUser !== user) return;
      if (err && err.code === 'permission-denied') return emit({ status: 'denied', user: { name: fallbackName, email } });
      emit({ status: 'error', message: explain(err), user: { name: fallbackName, email } });
    }
  }

  return {
    async start() {
      onState({ ...state });
      try {
        const [app, authMod, fs] = await Promise.all([
          import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
        ]);
        fb = { app, auth: authMod, fs };
        const firebaseApp = app.initializeApp(firebaseConfig);
        db = fs.initializeFirestore(firebaseApp, {
          localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
        });
        auth = authMod.getAuth(firebaseApp);
        auth.languageCode = 'ru';
        // Только для автоматической проверки на компьютере разработчика (эмулятор Firebase)
        const emu = window.__BT_EMULATOR__;
        if (emu) {
          authMod.connectAuthEmulator(auth, emu.auth, { disableWarnings: true });
          fs.connectFirestoreEmulator(db, emu.host, emu.port);
        }
        authMod.getRedirectResult(auth).catch((err) => fail(err));
      } catch (err) {
        emit({ status: 'error', message: 'Не удалось загрузить Firebase. Проверьте интернет и откройте приложение ещё раз.' });
        return;
      }
      fb.auth.onAuthStateChanged(auth, async (user) => {
        stopListeners();
        if (!user) {
          onPlan(null, { fromServer: false });
          onMarks({});
          onDay({});
          return emit({ status: 'signed-out', user: null });
        }
        checkAccess(user);
      });
    },

    setDay(key) { day = key; onDay({}); if (fb) listenDay(); },

    async signIn() {
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = fb.auth;
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        const code = err && err.code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          return signInWithRedirect(auth, provider).catch(fail);
        }
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') fail(err);
      }
    },

    signOut() { if (auth) fb.auth.signOut(auth); },

    setCheck(key, on) {
      if (state.status !== 'ready') return;
      const { doc, setDoc, serverTimestamp, deleteField } = fb.fs;
      const value = on ? { uid: state.user.uid, name: state.user.name, at: serverTimestamp() } : deleteField();
      setDoc(doc(db, 'days', day), { checks: { [key]: value } }, { merge: true }).catch(fail);
    },

    setMark(id, on) {
      if (state.status !== 'ready') return;
      const { doc, setDoc, deleteDoc, serverTimestamp } = fb.fs;
      const ref = doc(db, 'marks', id);
      (on ? setDoc(ref, { uid: state.user.uid, name: state.user.name, at: serverTimestamp() }) : deleteDoc(ref)).catch(fail);
    },

    savePlan(plan) {
      if (state.status !== 'ready') return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'settings', 'plan'), {
        schedule: plan.schedule, focus: plan.focus, updatedAt: serverTimestamp(), updatedBy: state.user.name,
      }).catch(fail);
    },

    // Первый запуск: заполнить распорядок из памятки, если на сервере его ещё нет
    async seedPlan(plan) {
      if (state.status !== 'ready') return;
      const { doc, runTransaction, serverTimestamp } = fb.fs;
      const ref = doc(db, 'settings', 'plan');
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) {
            tx.set(ref, { schedule: plan.schedule, focus: plan.focus, updatedAt: serverTimestamp(), updatedBy: state.user.name });
          }
        });
      } catch (err) { fail(err); }
    },
  };
}

function explain(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/unauthorized-domain') {
    return 'Этот адрес сайта не добавлен в Firebase: Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable') return 'Нет связи с сервером. Отметки сохранятся, когда появится интернет.';
  if (code === 'permission-denied') return 'Нет доступа: этого адреса нет в списке допущенных.';
  if (code === 'auth/popup-blocked') return 'Браузер не открыл окно входа. Разрешите всплывающие окна и попробуйте ещё раз.';
  return 'Что-то пошло не так' + (code ? ` (${code})` : '') + '. Попробуйте ещё раз.';
}
