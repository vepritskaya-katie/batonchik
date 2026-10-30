// Хранение отметок, расписания, журнала, правок карточек, паспорта и заметок дневника.
// Если Firebase настроен — общие данные в Firestore, обновления в реальном времени.
// Если нет — всё хранится только на этом телефоне (localStorage), чтобы приложением можно было пользоваться сразу.

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

export function isConfigured(config) {
  return !!(config && typeof config.apiKey === 'string' && config.apiKey && !/ВСТАВЬТЕ/i.test(config.apiKey));
}

// Состояние: mode 'local' | 'firebase'; status 'loading' | 'signed-out' | 'denied' | 'ready' | 'error'
export function createStore(handlers, config) {
  return isConfigured(config) ? firebaseStore(handlers, config) : localStore(handlers);
}

const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* память переполнена или запрещена */ }
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Только этот телефон ----------

function localStore({ onState, onPlan, onDay, onMarks, onEvents, onCards, onPet = () => {}, onPhoto = () => {}, onHealth = () => {}, onGrowth = () => {} }) {
  let day = null;
  const state = { mode: 'local', status: 'ready', user: { name: '' } };
  const mark = () => ({ uid: 'local', name: '', at: new Date().toISOString() });
  const revive = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, at: v.at ? new Date(v.at) : null }]));
  const allEvents = () => read('bt.events', []).map((e) => ({ ...e, at: new Date(e.at) }));
  const saveEvents = (list) => {
    write('bt.events', list.map((e) => ({ ...e, at: e.at.toISOString() })));
    onEvents(allEvents().filter((e) => e.day === day));
  };

  return {
    start() {
      onState(state);
      onPlan(read('bt.plan', null), { fromServer: true });
      onMarks(revive(read('bt.marks', {})));
      onCards(read('bt.cards', {}));
      onPet(read('bt.pet', null));
      onPhoto(read('bt.photo', ''));
      onHealth(Object.entries(read('bt.health', {})).map(([id, r]) => ({ id, ...r })));
      onGrowth(Object.entries(read('bt.growth', {})).map(([id, r]) => ({ id, ...r })));
    },
    setDay(key) {
      day = key;
      onDay(revive(read('bt.day.' + key, {})));
      onEvents(allEvents().filter((e) => e.day === key));
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
    addEvent(ev) {
      const id = newId();
      saveEvents([...allEvents(), { ...ev, id, uid: 'local', name: '' }]);
      return id;
    },
    updateEvent(id, patch) { saveEvents(allEvents().map((e) => (e.id === id ? { ...e, ...patch } : e))); },
    deleteEvent(id) { saveEvents(allEvents().filter((e) => e.id !== id)); },
    saveCard(tab, cardId, data) {
      const all = read('bt.cards', {});
      all[`${tab}__${cardId}`] = { tab, cardId, ...data, updatedBy: '' };
      write('bt.cards', all);
      onCards(all);
    },
    removeCard(tab, cardId) {
      const all = read('bt.cards', {});
      delete all[`${tab}__${cardId}`];
      write('bt.cards', all);
      onCards(all);
    },
    async loadHistory(from, to) {
      const days = {};
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('bt.day.')).forEach((k) => {
          const key = k.slice(7);
          if (key >= from && key <= to) days[key] = revive(read(k, {}));
        });
      } catch { /* ничего */ }
      return { events: allEvents().filter((e) => e.day >= from && e.day <= to), days };
    },
    async exportAll() {
      const days = {};
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('bt.day.')).forEach((k) => { days[k.slice(7)] = read(k, {}); });
      } catch { /* ничего */ }
      return {
        plan: read('bt.plan', null), marks: read('bt.marks', {}), days, events: read('bt.events', []), cards: read('bt.cards', {}),
        pet: read('bt.pet', null), health: read('bt.health', {}), stories: read('bt.stories', {}), growth: read('bt.growth', {}),
      };
    },
    // Паспорт и дневник
    savePet(profile) { write('bt.pet', profile); onPet(profile); },
    savePhoto(data) { write('bt.photo', data || ''); onPhoto(data || ''); },
    saveHealth(id, rec) {
      const all = read('bt.health', {});
      const key = id || newId();
      all[key] = { ...rec };
      write('bt.health', all);
      onHealth(Object.entries(all).map(([k, r]) => ({ id: k, ...r })));
      return key;
    },
    deleteHealth(id) {
      const all = read('bt.health', {});
      delete all[id];
      write('bt.health', all);
      onHealth(Object.entries(all).map(([k, r]) => ({ id: k, ...r })));
    },
    // Рост и вес: {date, weight (кг), height (см)}
    saveGrowth(id, rec) {
      const all = read('bt.growth', {});
      all[id || newId()] = { ...rec };
      write('bt.growth', all);
      onGrowth(Object.entries(all).map(([k, r]) => ({ id: k, ...r })));
    },
    deleteGrowth(id) {
      const all = read('bt.growth', {});
      delete all[id];
      write('bt.growth', all);
      onGrowth(Object.entries(all).map(([k, r]) => ({ id: k, ...r })));
    },
    async loadStories(from, to) {
      return Object.fromEntries(Object.entries(read('bt.stories', {})).filter(([k]) => k >= from && k <= to));
    },
    async saveStory(day, story) {
      const all = read('bt.stories', {});
      if (story) all[day] = story; else delete all[day];
      write('bt.stories', all);
    },
    signIn() {}, signOut() {},
  };
}

// ---------- Firebase ----------

function firebaseStore({ onState, onPlan, onDay, onMarks, onEvents, onCards, onError, onPet = () => {}, onPhoto = () => {}, onHealth = () => {}, onGrowth = () => {} }, firebaseConfig) {
  const state = { mode: 'firebase', status: 'loading', user: null, message: '' };
  let fb = null; // модули SDK
  let db = null;
  let auth = null;
  let day = null;
  let unsubs = [];
  let dayUnsubs = [];

  const emit = (patch) => { Object.assign(state, patch); onState({ ...state }); };
  const fail = (err) => onError && onError(explain(err));
  const toDate = (v) => (v && v.toDate ? v.toDate() : null);
  const toMark = (v) => ({ uid: v.uid, name: v.name || '', at: toDate(v.at) });
  const toEvent = (d) => {
    const v = d.data({ serverTimestamps: 'estimate' });
    return {
      id: d.id, type: v.type, sub: v.sub || '', text: v.text || '', card: v.card || '', grams: typeof v.grams === 'number' ? v.grams : 0,
      at: toDate(v.at) || new Date(), day: v.day, uid: v.uid, name: v.name || '',
    };
  };

  function stopListeners() {
    unsubs.forEach((u) => u());
    unsubs = [];
    dayUnsubs.forEach((u) => u());
    dayUnsubs = [];
  }

  function listenDay() {
    dayUnsubs.forEach((u) => u());
    dayUnsubs = [];
    if (!day || state.status !== 'ready') return;
    const { doc, collection, query, where, onSnapshot } = fb.fs;
    dayUnsubs.push(onSnapshot(doc(db, 'days', day), (snap) => {
      const checks = (snap.data({ serverTimestamps: 'estimate' }) || {}).checks || {};
      onDay(Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, toMark(v)])));
    }, fail));
    dayUnsubs.push(onSnapshot(query(collection(db, 'events'), where('day', '==', day)), (snap) => {
      onEvents(snap.docs.map(toEvent));
    }, fail));
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
    unsubs.push(onSnapshot(collection(db, 'cards'), (snap) => {
      const cards = {};
      snap.forEach((d) => { cards[d.id] = d.data(); });
      onCards(cards);
    }, fail));
    unsubs.push(onSnapshot(doc(db, 'pet', 'profile'), (snap) => { onPet(snap.exists() ? plainPet(snap.data()) : null); }, fail));
    unsubs.push(onSnapshot(doc(db, 'pet', 'photo'), (snap) => { onPhoto(snap.exists() ? String(snap.data().data || '') : ''); }, fail));
    unsubs.push(onSnapshot(collection(db, 'health'), (snap) => {
      onHealth(snap.docs.map((d) => { const v = d.data(); return { id: d.id, title: v.title, kind: v.kind, date: v.date, done: !!v.done, note: v.note || '', updatedBy: v.updatedBy || '' }; }));
    }, fail));
    unsubs.push(onSnapshot(collection(db, 'growth'), (snap) => {
      onGrowth(snap.docs.map((d) => { const v = d.data(); return { id: d.id, date: v.date, weight: v.weight || 0, height: v.height || 0 }; }));
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

  const ready = () => state.status === 'ready';

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
          onEvents([]);
          onCards({});
          onPet(null);
          onPhoto('');
          onHealth([]);
          onGrowth([]);
          return emit({ status: 'signed-out', user: null });
        }
        checkAccess(user);
      });
    },

    setDay(key) { day = key; onDay({}); onEvents([]); if (fb) listenDay(); },

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
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp, deleteField } = fb.fs;
      const value = on ? { uid: state.user.uid, name: state.user.name, at: serverTimestamp() } : deleteField();
      setDoc(doc(db, 'days', day), { checks: { [key]: value } }, { merge: true }).catch(fail);
    },

    setMark(id, on) {
      if (!ready()) return;
      const { doc, setDoc, deleteDoc, serverTimestamp } = fb.fs;
      const ref = doc(db, 'marks', id);
      (on ? setDoc(ref, { uid: state.user.uid, name: state.user.name, at: serverTimestamp() }) : deleteDoc(ref)).catch(fail);
    },

    savePlan(plan) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'settings', 'plan'), {
        schedule: plan.schedule, focus: plan.focus, updatedAt: serverTimestamp(), updatedBy: state.user.name,
      }).catch(fail);
    },

    // Первый запуск: заполнить расписание из памятки, если на сервере его ещё нет
    async seedPlan(plan) {
      if (!ready()) return;
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

    // Журнал: {type, sub, text, card, grams, at: Date, day}; возвращает id записи (для «Отменить»).
    // card — карточка тренировки или игры («k/ko-mne»), только у повторов тренировок (type 'train');
    // grams — сколько граммов корма отсыпали, только у кормления
    addEvent(ev) {
      if (!ready()) return null;
      const { doc, collection, setDoc, serverTimestamp, Timestamp } = fb.fs;
      const ref = doc(collection(db, 'events'));
      const data = {
        type: ev.type, sub: ev.sub || '', text: ev.text || '', at: Timestamp.fromDate(ev.at), day: ev.day,
        uid: state.user.uid, name: state.user.name, createdAt: serverTimestamp(),
      };
      if (ev.card) data.card = ev.card;
      if (ev.grams) data.grams = ev.grams;
      setDoc(ref, data).catch(fail);
      return ref.id;
    },

    updateEvent(id, patch) {
      if (!ready()) return;
      const { doc, updateDoc, Timestamp } = fb.fs;
      const data = { ...patch };
      if (data.at) data.at = Timestamp.fromDate(data.at);
      updateDoc(doc(db, 'events', id), data).catch(fail);
    },

    deleteEvent(id) {
      if (!ready()) return;
      const { doc, deleteDoc } = fb.fs;
      deleteDoc(doc(db, 'events', id)).catch(fail);
    },

    // Правка карточки поверх файла: {group, md, deleted}
    saveCard(tab, cardId, data) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'cards', `${tab}__${cardId}`), {
        tab, cardId, group: data.group || '', md: data.md || '', deleted: !!data.deleted,
        updatedAt: serverTimestamp(), updatedBy: state.user.name,
      }).catch(fail);
    },

    removeCard(tab, cardId) {
      if (!ready()) return;
      const { doc, deleteDoc } = fb.fs;
      deleteDoc(doc(db, 'cards', `${tab}__${cardId}`)).catch(fail);
    },

    // История для дневника: записи журнала и отметки расписания за дни from…to (включительно)
    async loadHistory(from, to) {
      if (!ready()) return { events: [], days: {} };
      const { collection, query, where, getDocs, documentId } = fb.fs;
      const [ev, dd] = await Promise.all([
        getDocs(query(collection(db, 'events'), where('day', '>=', from), where('day', '<=', to))),
        getDocs(query(collection(db, 'days'), where(documentId(), '>=', from), where(documentId(), '<=', to))),
      ]);
      const days = {};
      dd.forEach((d) => {
        const checks = (d.data({ serverTimestamps: 'estimate' }) || {}).checks || {};
        days[d.id] = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, toMark(v)]));
      });
      return { events: ev.docs.map(toEvent), days };
    },

    // Всё содержимое базы для резервной копии
    async exportAll() {
      if (!ready()) return null;
      const { collection, doc, getDocs, getDoc } = fb.fs;
      const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x.toDate === 'function' ? x.toDate().toISOString() : x)));
      const all = async (name) => {
        const out = {};
        (await getDocs(collection(db, name))).forEach((d) => { out[d.id] = plain(d.data()); });
        return out;
      };
      const plan = await getDoc(doc(db, 'settings', 'plan'));
      return {
        plan: plan.exists() ? plain(plan.data()) : null,
        marks: await all('marks'), days: await all('days'), events: await all('events'), cards: await all('cards'),
        pet: await all('pet'), health: await all('health'), stories: await all('stories'), growth: await all('growth'),
      };
    },

    // ---------- Паспорт ----------
    savePet(profile) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'pet', 'profile'), { ...plainPet(profile), updatedAt: serverTimestamp(), updatedBy: state.user.name }).catch(fail);
    },
    savePhoto(data) {
      if (!ready()) return;
      const { doc, setDoc, deleteDoc, serverTimestamp } = fb.fs;
      const ref = doc(db, 'pet', 'photo');
      (data ? setDoc(ref, { data, updatedAt: serverTimestamp(), updatedBy: state.user.name }) : deleteDoc(ref)).catch(fail);
    },
    // Запись о здоровье: {title, kind, date, done, note}; возвращает id
    saveHealth(id, rec) {
      if (!ready()) return null;
      const { doc, collection, setDoc, serverTimestamp } = fb.fs;
      const ref = id ? doc(db, 'health', id) : doc(collection(db, 'health'));
      setDoc(ref, {
        title: rec.title, kind: rec.kind, date: rec.date, done: !!rec.done, note: rec.note || '',
        updatedAt: serverTimestamp(), updatedBy: state.user.name,
      }).catch(fail);
      return ref.id;
    },
    deleteHealth(id) {
      if (!ready()) return;
      const { doc, deleteDoc } = fb.fs;
      deleteDoc(doc(db, 'health', id)).catch(fail);
    },
    // Измерение: {date, weight (кг), height (см)}; пустое поле не сохраняется
    saveGrowth(id, rec) {
      if (!ready()) return;
      const { doc, collection, setDoc, serverTimestamp } = fb.fs;
      const ref = id ? doc(db, 'growth', id) : doc(collection(db, 'growth'));
      const data = { date: rec.date, updatedAt: serverTimestamp(), updatedBy: state.user.name };
      if (rec.weight) data.weight = rec.weight;
      if (rec.height) data.height = rec.height;
      setDoc(ref, data).catch(fail);
    },
    deleteGrowth(id) {
      if (!ready()) return;
      const { doc, deleteDoc } = fb.fs;
      deleteDoc(doc(db, 'growth', id)).catch(fail);
    },

    // ---------- Заметки о днях (дневник) ----------
    async loadStories(from, to) {
      if (!ready()) return {};
      const { collection, query, where, getDocs, documentId } = fb.fs;
      const snap = await getDocs(query(collection(db, 'stories'), where(documentId(), '>=', from), where(documentId(), '<=', to)));
      const out = {};
      snap.forEach((d) => { const v = d.data(); out[d.id] = { title: v.title || '', text: v.text || '', photo: v.photo || '' }; });
      return out;
    },
    async saveStory(day, story) {
      if (!ready()) return;
      const { doc, setDoc, deleteDoc, serverTimestamp } = fb.fs;
      const ref = doc(db, 'stories', day);
      try {
        if (story) await setDoc(ref, { title: story.title || '', text: story.text || '', photo: story.photo || '', updatedAt: serverTimestamp(), updatedBy: state.user.name });
        else await deleteDoc(ref);
      } catch (err) { fail(err); }
    },
  };
}

// Карточка собаки: только известные поля, строками
const PET_FIELDS = ['name', 'breed', 'birth', 'sex', 'chip', 'mdr1', 'weight'];
function plainPet(v) {
  return Object.fromEntries(PET_FIELDS.map((k) => [k, typeof v[k] === 'string' ? v[k] : '']));
}

function explain(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/unauthorized-domain') {
    return 'Этот адрес сайта не добавлен в Firebase: Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable') return 'Нет связи с сервером. Отметки сохранятся, когда появится интернет.';
  if (code === 'permission-denied') {
    return 'Нет доступа. Проверьте, что адрес есть в списке допущенных и что в Firebase вставлены свежие правила из файла firestore.rules.';
  }
  if (code === 'auth/popup-blocked') return 'Браузер не открыл окно входа. Разрешите всплывающие окна и попробуйте ещё раз.';
  return 'Что-то пошло не так' + (code ? ` (${code})` : '') + '. Попробуйте ещё раз.';
}
