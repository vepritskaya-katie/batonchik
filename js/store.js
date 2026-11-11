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

// Заметки без фото (фото — по запросу): { день: { title, text, special, hasPhoto, photoCount } }
const localPhotos = (s) => (s.photos && s.photos.length ? s.photos : s.photo ? [s.photo] : []);
function localStories() {
  return Object.fromEntries(Object.entries(read('bt.stories', {})).map(([d, s]) => [d, {
    title: s.title || '', text: s.text || '', special: typeof s.special === 'boolean' ? s.special : null,
    hasPhoto: localPhotos(s).length > 0, photoCount: localPhotos(s).length, photoKey: s.photoKey || '',
  }]));
}

// ---------- Игра ----------

// Данные игрока: days — разминки по дням, rep — ошибки на повтор, known — на что отвечали верно, read — очки за чтение
const GAME_MAPS = ['days', 'rep', 'known', 'read'];
const GAME_DAY_RE = /^\d{4}-\d\d-\d\d$/;
function cleanGame(v) {
  const src = v || {};
  const map = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const days = {};
  for (const [d, r] of Object.entries(map(src.days))) {
    if (!GAME_DAY_RE.test(d) || !r || !Array.isArray(r.q)) continue;
    days[d] = {
      q: r.q.filter((x) => typeof x === 'string'),
      p: (Array.isArray(r.p) ? r.p : []).map(Number),
      ok: (Array.isArray(r.ok) ? r.ok : []).map(Boolean),
      fix: Number.isInteger(r.fix) ? r.fix : 0,
      r: Number.isInteger(r.r) ? r.r : 0,
    };
  }
  const rep = {};
  for (const [id, e] of Object.entries(map(src.rep))) {
    if (e && GAME_DAY_RE.test(e.due)) rep[id] = { box: Number.isInteger(e.box) ? e.box : 0, due: e.due, paid: !!e.paid };
  }
  const read = Object.fromEntries(Object.entries(map(src.read)).filter(([, d]) => GAME_DAY_RE.test(d)));
  return { name: typeof src.name === 'string' ? src.name : '', photo: typeof src.photo === 'string' ? src.photo : '', days, rep, known: { ...map(src.known) }, read };
}
// Изменения поверх сохранённого: null — убрать запись
function mergeGame(cur, patch) {
  const out = cleanGame(cur);
  for (const key of GAME_MAPS) {
    for (const [k, v] of Object.entries(patch[key] || {})) {
      if (v === null) delete out[key][k]; else out[key][k] = v;
    }
  }
  return out;
}
// Локальный режим: играете вы одни; другие игроки бывают только в примере (bt.gamePlayers)
const localPlayers = () => [
  { ...cleanGame(read('bt.game', {})), uid: 'local', me: true },
  ...read('bt.gamePlayers', []).map((p, i) => ({ ...cleanGame(p), uid: `other${i + 1}`, me: false })),
];

// Фото месяца: только даты — { 5: '2026-10-29' } (сами фото — по запросу)
const localMonthDates = () => Object.fromEntries(Object.entries(read('bt.monthPhotos', {})).map(([n, p]) => [n, p.date || '']));

function localStore({ onState, onPlan, onDay, onMarks, onEvents, onCards, onPet = () => {}, onPhoto = () => {}, onHealth = () => {}, onGrowth = () => {}, onReads = () => {}, onVet = () => {}, onWeeks = () => {}, onStories = () => {}, onLost = () => {}, onSocial = () => {}, onCare = () => {}, onMonths = () => {}, onGame = () => {}, onFields = () => {} }) {
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
      onReads(read('bt.reads', { items: {}, quiz: {} }));
      onVet(read('bt.vet', null));
      onFields(read('bt.fields', {}));
      onWeeks(Object.entries(read('bt.weeks', {})).map(([id, w]) => ({ id, ...w })));
      onStories(localStories());
      onLost(read('bt.lost', null));
      onSocial(cleanSocial(read('bt.social', {})));
      onCare(cleanCare(read('bt.care', {})));
      onGame(localPlayers());
      onMonths(localMonthDates());
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
        weeks: read('bt.weeks', {}), lost: read('bt.lost', null), social: read('bt.social', {}), care: read('bt.care', {}),
        game: read('bt.game', {}), fields: read('bt.fields', {}),
      };
    },
    // Игра: свои ответы, повторы ошибок и очки за чтение
    saveGame(patch) {
      write('bt.game', mergeGame(read('bt.game', {}), patch));
      onGame(localPlayers());
    },
    // Паспорт и дневник
    savePet(profile) { write('bt.pet', profile); onPet(profile); },
    savePhoto(data) { write('bt.photo', data || ''); onPhoto(data || ''); },
    saveVet(v) { write('bt.vet', v); onVet(v); },
    // Поля «___» в карточках Библиотеки («Норма Батончика»): { ключ: { v: значение, d: дата } }
    saveFields(values) { write('bt.fields', values); onFields(values); },
    // «Если потерялся»: телефоны и приметы для объявления
    saveLost(v) { const x = plainLost(v); write('bt.lost', x); onLost(x); },
    // Социализация: { title (только у своих пунктов), log: [{ d: день, r: реакция }] }; null — удалить
    saveSocial(id, item) {
      const all = read('bt.social', {});
      if (item) all[id] = { ...(item.title ? { title: item.title } : {}), log: item.log || [] }; else delete all[id];
      write('bt.social', all);
      onSocial(cleanSocial(all));
    },
    // Уход: { log: [дни], every: раз в сколько дней напоминать }
    saveCare(id, item) {
      const all = read('bt.care', {});
      all[id] = { log: item.log || [], every: item.every || 0 };
      write('bt.care', all);
      onCare(cleanCare(all));
    },
    // Фото месяца: { 6: { data, date } }
    async loadMonthPhotos() { return read('bt.monthPhotos', {}); },
    async loadMonthPhoto(n) { return read('bt.monthPhotos', {})[n] || null; },
    async saveMonthPhoto(n, photo) {
      const all = read('bt.monthPhotos', {});
      if (photo) all[n] = { data: photo.data, date: photo.date }; else delete all[n];
      write('bt.monthPhotos', all);
      onMonths(localMonthDates());
    },
    // «Неделя Батончика»: ответы за воскресенье day
    saveWeek(day, w) {
      const all = read('bt.weeks', {});
      all[day] = { ...w };
      write('bt.weeks', all);
      onWeeks(Object.entries(all).map(([id, x]) => ({ id, ...x })));
    },
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
    // Библиотека: что прочитано — у каждого своё
    setRead(key, on) {
      const r = read('bt.reads', { items: {}, quiz: {} });
      if (on) r.items[key] = true; else delete r.items[key];
      write('bt.reads', r);
      onReads(r);
    },
    // Заметки о днях: здесь фото хранятся прямо в заметке
    async loadStoryPhotos(day) { return localPhotos(read('bt.stories', {})[day] || {}); },
    async saveStory(day, story) {
      const all = read('bt.stories', {});
      if (story) all[day] = { title: story.title || '', text: story.text || '', special: !!story.special, photos: story.photos || [], photoKey: story.photoKey || '' };
      else delete all[day];
      write('bt.stories', all);
      onStories(localStories());
    },
    signIn() {}, signOut() {},
    // Уведомления — только с общей базой (Firebase)
    async pushToken() { throw new Error('local'); },
    async pushSave() {}, async pushRemove() {}, async pushTest() { return null; },
  };
}

// ---------- Firebase ----------

function firebaseStore({ onState, onPlan, onDay, onMarks, onEvents, onCards, onError, onPet = () => {}, onPhoto = () => {}, onHealth = () => {}, onGrowth = () => {}, onReads = () => {}, onVet = () => {}, onWeeks = () => {}, onStories = () => {}, onLost = () => {}, onSocial = () => {}, onCare = () => {}, onMonths = () => {}, onGame = () => {}, onFields = () => {} }, firebaseConfig) {
  const state = { mode: 'firebase', status: 'loading', user: null, message: '' };
  let fb = null; // модули SDK
  let db = null;
  let auth = null;
  let day = null;
  let unsubs = [];
  let fbApp = null;
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
    // Заметки о днях — лёгкие (фото лежит отдельно, в storyPhotos); старые заметки могли хранить фото внутри
    unsubs.push(onSnapshot(collection(db, 'stories'), (snap) => {
      const out = {};
      snap.forEach((d) => {
        const v = d.data();
        const count = typeof v.photoCount === 'number' ? v.photoCount : (v.hasPhoto || v.photo ? 1 : 0);
        out[d.id] = { title: v.title || '', text: v.text || '', special: typeof v.special === 'boolean' ? v.special : null, hasPhoto: count > 0, photoCount: count, photoKey: v.photoKey || '', photo: v.photo || '' };
      });
      onStories(out);
    }, fail));
    unsubs.push(onSnapshot(collection(db, 'weeks'), (snap) => {
      onWeeks(snap.docs.map((d) => {
        const v = d.data();
        const w = { id: d.id, joy: !!v.joy, choice: !!v.choice, sleep: !!v.sleep, ribs: v.ribs || '', waist: v.waist || '', notes: v.notes || '', updatedBy: v.updatedBy || '' };
        // Здоровье за неделю — только у недель, где его уже заполняли
        WEEK_HEALTH_KEYS.forEach((k) => { if (k in v) w[k] = v[k]; });
        return w;
      }));
    }, fail));
    unsubs.push(onSnapshot(doc(db, 'pet', 'fields'), (snap) => {
      onFields(cleanFields(snap.exists() ? snap.data().values : null));
    }, fail));
    unsubs.push(onSnapshot(doc(db, 'pet', 'vet'), (snap) => {
      const v = snap.exists() ? snap.data() : null;
      onVet(v && Object.fromEntries(VET_FIELDS.map((k) => [k, String(v[k] || '')])));
    }, fail));
    unsubs.push(onSnapshot(doc(db, 'pet', 'photo'), (snap) => { onPhoto(snap.exists() ? String(snap.data().data || '') : ''); }, fail));
    unsubs.push(onSnapshot(doc(db, 'pet', 'lost'), (snap) => { onLost(snap.exists() ? plainLost(snap.data()) : null); }, fail));
    // Даты фото месяца — лёгкий документ: по нему календарь знает, где есть фото, не загружая сами фото
    unsubs.push(onSnapshot(doc(db, 'pet', 'months'), (snap) => {
      const dates = (snap.exists() && snap.data().dates) || {};
      onMonths(Object.fromEntries(Object.entries(dates).filter(([n, d]) => /^[1-9][0-9]?$/.test(n) && DAY_RE.test(d))));
    }, fail));
    unsubs.push(onSnapshot(collection(db, 'social'), (snap) => {
      const out = {};
      snap.forEach((d) => { out[d.id] = d.data(); });
      onSocial(cleanSocial(out));
    }, fail));
    unsubs.push(onSnapshot(collection(db, 'care'), (snap) => {
      const out = {};
      snap.forEach((d) => { out[d.id] = d.data(); });
      onCare(cleanCare(out));
    }, fail));
    unsubs.push(onSnapshot(collection(db, 'health'), (snap) => {
      onHealth(snap.docs.map((d) => { const v = d.data(); return { id: d.id, title: v.title, kind: v.kind, date: v.date, time: v.time || '', done: !!v.done, note: v.note || '', updatedBy: v.updatedBy || '' }; }));
    }, fail));
    unsubs.push(onSnapshot(doc(db, 'reads', state.user.uid), (snap) => {
      const v = snap.exists() ? snap.data() : {};
      onReads({ items: v.items || {}, quiz: v.quiz || {} });
    }, fail));
    // Игра: у каждого свой документ game/{uid}, видят оба — для рейтинга
    unsubs.push(onSnapshot(collection(db, 'game'), (snap) => {
      const list = snap.docs.map((d) => ({ ...cleanGame(d.data()), uid: d.id, me: d.id === state.user.uid }));
      if (!list.some((p) => p.me)) list.unshift({ ...cleanGame({ name: state.user.name }), uid: state.user.uid, me: true });
      onGame(list);
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
      emit({ status: 'ready', user: { name, email, uid: user.uid, photo: user.photoURL || '' } });
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
        const { vapidKey, ...appOptions } = firebaseConfig; // ключ уведомлений — не настройка приложения Firebase
        const firebaseApp = app.initializeApp(appOptions);
        fbApp = firebaseApp;
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
          onReads({ items: {}, quiz: {} });
          onVet(null);
          onFields({});
          onWeeks([]);
          onStories({});
          onLost(null);
          onSocial({});
          onCare({});
          onMonths({});
          onGame([]);
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
        weeks: await all('weeks'), social: await all('social'), care: await all('care'), game: await all('game'),
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
    // Запись о здоровье: {title, kind, date, time (необязательно, «ЧЧ:ММ»), done, note}; возвращает id
    saveHealth(id, rec) {
      if (!ready()) return null;
      const { doc, collection, setDoc, serverTimestamp } = fb.fs;
      const ref = id ? doc(db, 'health', id) : doc(collection(db, 'health'));
      setDoc(ref, {
        title: rec.title, kind: rec.kind, date: rec.date, done: !!rec.done, note: rec.note || '',
        ...(rec.time ? { time: rec.time } : {}),
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
    // Игра: game/{uid} — свои ответы, повторы ошибок и очки за чтение. null в patch — убрать запись
    saveGame(patch) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp, deleteField } = fb.fs;
      const data = { name: state.user.name || '', photo: state.user.photo || '', updatedAt: serverTimestamp() };
      for (const key of GAME_MAPS) {
        if (patch[key]) data[key] = Object.fromEntries(Object.entries(patch[key]).map(([k, v]) => [k, v === null ? deleteField() : v]));
      }
      setDoc(doc(db, 'game', state.user.uid), data, { merge: true }).catch(fail);
    },
    // Библиотека: документ reads/{uid} — что прочитал этот человек
    setRead(key, on) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp, deleteField } = fb.fs;
      setDoc(doc(db, 'reads', state.user.uid), { items: { [key]: on ? true : deleteField() }, updatedAt: serverTimestamp() }, { merge: true }).catch(fail);
    },
    // «Неделя Батончика»: weeks/{воскресенье} — вопросы о благополучии, фигура, заметки (вес — в growth)
    saveWeek(day, w) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'weeks', day), {
        joy: !!w.joy, choice: !!w.choice, sleep: !!w.sleep, ribs: w.ribs || '', waist: w.waist || '', notes: w.notes || '',
        coat: !!w.coat, stool: !!w.stool, vigor: !!w.vigor, ticks: String(w.ticks || '').slice(0, 200),
        lastTicks: DATE_RE.test(w.lastTicks || '') ? w.lastTicks : '', lastWorms: DATE_RE.test(w.lastWorms || '') ? w.lastWorms : '',
        updatedAt: serverTimestamp(), updatedBy: state.user.name,
      }).catch(fail);
    },
    // Поля «___» в карточках Библиотеки: pet/fields — значение и дата, общие для двоих
    saveFields(values) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'pet', 'fields'), { values: cleanFields(values), updatedAt: serverTimestamp(), updatedBy: state.user.name }).catch(fail);
    },
    // «Срочно»: телефоны клиники и ветеринара и база чипа — общие для двоих
    saveVet(v) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      const data = Object.fromEntries(VET_FIELDS.map((k) => [k, String(v[k] || '')]));
      setDoc(doc(db, 'pet', 'vet'), { ...data, updatedAt: serverTimestamp(), updatedBy: state.user.name }).catch(fail);
    },

    // «Если потерялся»: pet/lost — телефоны и приметы для объявления, общие для двоих
    saveLost(v) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'pet', 'lost'), { ...plainLost(v), updatedAt: serverTimestamp(), updatedBy: state.user.name }).catch(fail);
    },
    // Социализация: social/{пункт} — { title (только у своих пунктов), log: [{ d, r }] }; null — удалить
    saveSocial(id, item) {
      if (!ready()) return;
      const { doc, setDoc, deleteDoc, serverTimestamp } = fb.fs;
      const ref = doc(db, 'social', id);
      if (!item) { deleteDoc(ref).catch(fail); return; }
      const data = { log: (item.log || []).slice(-LOG_MAX), updatedAt: serverTimestamp(), updatedBy: state.user.name };
      if (item.title) data.title = String(item.title).slice(0, 80);
      setDoc(ref, data).catch(fail);
    },
    // Уход: care/{пункт} — { log: [дни], every }
    saveCare(id, item) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      setDoc(doc(db, 'care', id), {
        log: (item.log || []).slice(-LOG_MAX), every: Math.max(0, Math.min(120, Math.round(item.every || 0))),
        updatedAt: serverTimestamp(), updatedBy: state.user.name,
      }).catch(fail);
    },
    // Фото месяца: monthPhotos/{возраст в месяцах} — { data, date }. Грузятся по запросу, а не при запуске
    async loadMonthPhotos() {
      if (!ready()) return {};
      const { collection, getDocs } = fb.fs;
      const out = {};
      (await getDocs(collection(db, 'monthPhotos'))).forEach((d) => { const v = d.data(); out[d.id] = { data: String(v.data || ''), date: v.date || '' }; });
      return out;
    },
    async loadMonthPhoto(n) {
      if (!ready()) return null;
      const { doc, getDoc } = fb.fs;
      const snap = await getDoc(doc(db, 'monthPhotos', String(n)));
      return snap.exists() ? { data: String(snap.data().data || ''), date: snap.data().date || '' } : null;
    },
    // Фото и его дата в pet/months — одним пакетом: либо всё вместе, либо ничего
    async saveMonthPhoto(n, photo) {
      if (!ready()) return;
      const { doc, writeBatch, serverTimestamp, deleteField } = fb.fs;
      const ref = doc(db, 'monthPhotos', String(n));
      const meta = { updatedAt: serverTimestamp(), updatedBy: state.user.name };
      const batch = writeBatch(db);
      if (photo) batch.set(ref, { data: photo.data, date: photo.date, ...meta });
      else batch.delete(ref);
      batch.set(doc(db, 'pet', 'months'), { dates: { [String(n)]: photo ? photo.date : deleteField() }, ...meta }, { merge: true });
      try { await batch.commit(); } catch (err) { fail(err); }
    },

    // ---------- Уведомления ----------
    // Токен этого телефона для уведомлений (Firebase Cloud Messaging). sw — регистрация sw.js: он и показывает уведомления
    async pushToken(vapidKey, sw) {
      const stub = window.__BT_PUSH_STUB__; // только для автоматической проверки на компьютере разработчика
      if (stub) return stub.token;
      const m = await import(SDK + 'firebase-messaging.js');
      if (!(await m.isSupported())) throw new Error('unsupported');
      return m.getToken(m.getMessaging(fbApp), { vapidKey, serviceWorkerRegistration: sw });
    },
    // pushTokens/{id}: токен, чей телефон и какие уведомления на нём включены
    async pushSave(id, token, prefs) {
      if (!ready()) return;
      const { doc, setDoc, serverTimestamp } = fb.fs;
      const platform = /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'other';
      await setDoc(doc(db, 'pushTokens', id), {
        token, uid: state.user.uid, name: state.user.name, platform,
        prefs: { toilet: !!prefs.toilet, care: !!prefs.care, week: !!prefs.week, game: !!prefs.game }, updatedAt: serverTimestamp(),
      });
    },
    // unsubscribe — ещё и отписать телефон от уведомлений (при «Выключить»; при смене токена — нет)
    async pushRemove(id, { unsubscribe = true } = {}) {
      if (!ready() || !id) return;
      const { doc, deleteDoc } = fb.fs;
      await deleteDoc(doc(db, 'pushTokens', id)).catch(() => {});
      if (!unsubscribe || window.__BT_PUSH_STUB__) return;
      try { const m = await import(SDK + 'firebase-messaging.js'); await m.deleteToken(m.getMessaging(fbApp)); } catch { /* уже нет */ }
    },
    // «Прислать проверочное» — функция sendTestPush на сервере
    async pushTest() {
      const stub = window.__BT_PUSH_STUB__;
      if (stub) return stub.test || { devices: 1, delivered: 1 };
      const f = await import(SDK + 'firebase-functions.js');
      const res = await f.httpsCallable(f.getFunctions(fbApp, 'europe-west1'), 'sendTestPush')();
      return res.data;
    },

    // ---------- Заметки о днях (дневник) ----------
    // Фото к заметке: storyPhotos/{день}, {день}_2, {день}_3 …
    async loadStoryPhotos(day, count) {
      if (!ready() || !count) return [];
      const { doc, getDoc } = fb.fs;
      const snaps = await Promise.all(Array.from({ length: count }, (_, i) => getDoc(doc(db, 'storyPhotos', storyPhotoId(day, i)))));
      return snaps.filter((x) => x.exists()).map((x) => String(x.data().data || '')).filter(Boolean);
    },
    // story: { title, text, special, photos: [] }; photosChanged: false — фото не трогаем (не перезаписываем их при правке текста).
    // Всё одним пакетом: заметка и фото сохраняются вместе, даже если телефон заблокировали, пока фото ещё отправлялись
    async saveStory(day, story, { photosChanged = true, oldCount = 0 } = {}) {
      if (!ready()) return;
      const { doc, writeBatch, serverTimestamp } = fb.fs;
      const ref = doc(db, 'stories', day);
      const photoRef = (i) => doc(db, 'storyPhotos', storyPhotoId(day, i));
      const meta = { updatedAt: serverTimestamp(), updatedBy: state.user.name };
      const batch = writeBatch(db);
      const photos = story ? story.photos || [] : [];
      if (!story) batch.delete(ref);
      else {
        const data = { title: story.title || '', text: story.text || '', special: !!story.special, ...meta };
        if (!photosChanged) batch.set(ref, data, { merge: true });
        else batch.set(ref, { ...data, photo: '', hasPhoto: photos.length > 0, photoCount: photos.length, photoKey: String(story.photoKey || '').slice(0, 24) });
      }
      if (!story || photosChanged) {
        photos.forEach((p, i) => batch.set(photoRef(i), { data: p, ...meta }));
        for (let i = photos.length; i < Math.max(oldCount, 1); i++) batch.delete(photoRef(i));
      }
      try { await batch.commit(); } catch (err) { fail(err); }
    },
  };
}

// Карточка собаки: только известные поля, строками
const PET_FIELDS = ['name', 'breed', 'birth', 'sex', 'chip', 'mdr1', 'weight'];
// «Если потерялся»: два контакта, приметы, приписка к объявлению
const LOST_FIELDS = { name1: 40, phone1: 30, name2: 40, phone2: 30, signs: 400, note: 300 };
const plainLost = (v) => Object.fromEntries(Object.entries(LOST_FIELDS).map(([k, n]) => [k, typeof v[k] === 'string' ? v[k].slice(0, n) : '']));
// Сколько последних отметок хранить у пункта социализации и ухода
const LOG_MAX = 60;
const DAY_RE = /^\d{4}-\d\d-\d\d$/;
const REACTIONS = ['calm', 'alert', 'scared'];
function cleanSocial(all) {
  return Object.fromEntries(Object.entries(all || {}).map(([id, v]) => [id, {
    title: typeof v.title === 'string' ? v.title : '',
    log: (Array.isArray(v.log) ? v.log : []).filter((x) => x && DAY_RE.test(x.d) && REACTIONS.includes(x.r)).map((x) => ({ d: x.d, r: x.r })),
  }]));
}
function cleanCare(all) {
  return Object.fromEntries(Object.entries(all || {}).map(([id, v]) => [id, {
    log: (Array.isArray(v.log) ? v.log : []).filter((d) => typeof d === 'string' && DAY_RE.test(d)).sort(),
    every: Number.isInteger(v.every) ? v.every : null,
  }]));
}
// Поля «___»: { ключ: { v: строка до 60 знаков, d: 'ГГГГ-ММ-ДД' } }, не больше 40
function cleanFields(map) {
  const out = {};
  Object.entries(map && typeof map === 'object' ? map : {}).slice(0, 40).forEach(([k, x]) => {
    if (/^[a-z0-9-]{1,40}$/.test(k) && x && typeof x.v === 'string' && x.v && /^\d{4}-\d{2}-\d{2}$/.test(String(x.d))) out[k] = { v: x.v.slice(0, 60), d: x.d };
  });
  return out;
}
// «Неделя Батончика» → «Здоровье за неделю»: три галочки, найденные клещи, последние обработки
const WEEK_HEALTH_KEYS = ['coat', 'stool', 'vigor', 'ticks', 'lastTicks', 'lastWorms'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VET_FIELDS = ['clinicName', 'clinicAddress', 'clinicPhone', 'vetName', 'vetPhone', 'chipBase'];
// Первое фото заметки — под датой дня, следующие — с номером: 2026-10-04, 2026-10-04_2 …
const storyPhotoId = (day, i) => (i ? `${day}_${i + 1}` : day);

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
