// Работа без интернета: файлы приложения и памятки хранятся на телефоне.
// При наличии сети всегда берётся свежая версия, без сети — сохранённая.

const VERSION = 'batonchik-v5';
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const APP_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/md.js', 'js/store.js', 'js/editor.js', 'js/diary.js', 'js/firebase-config.js',
  'content/komandy.md', 'content/igry.md', 'content/sovety.md', 'content/rasporyadok.md',
  'content/priuchenie-k-kletke-14-dney.pdf',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const SDK_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => SDK + f);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // По одному файлу: если что-то не скачалось, остальное всё равно сохранится
    await Promise.all([...APP_FILES, ...SDK_FILES].map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    // Мимо HTTP-кэша браузера: GitHub Pages разрешает держать старую копию до 10 минут
    const fresh = request.mode === 'navigate' ? request : new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    const response = await fetchWithTimeout(fresh, 5000);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (request.url.startsWith(SDK)) event.respondWith(cacheFirst(request));
});
