/* WorldSense OS — service worker.
   Оболочка (index.html и пр.): сеть с таймаутом 2.5с → иначе кэш. Ответ сети всегда
   обновляет кэш, так что обновления подхватываются, а на плохом мобильном интернете
   приложение не висит на белом экране.
   SDK Supabase (jsdelivr) и Google Fonts: из кэша мгновенно, фоном обновляются.
   Запросы к Supabase API не трогаем.
   При изменении файлов повышай версию CACHE — старый кэш удалится сам. */
const CACHE = 'ws-os-v15';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png'];
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const NET_TIMEOUT = 2500;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).then(() => c.add(new Request(SDK, { mode: 'cors' })).catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  /* только нормальные ответы; opaque (no-cors) в кэш не кладём — их нельзя отдать на CORS-запрос */
  if (res && res.ok && res.type !== 'opaque') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

/* свои файлы: сеть, но не дольше NET_TIMEOUT, если в кэше что-то есть */
function networkFirst(e) {
  const net = fetch(e.request).then((res) => put(e.request, res));
  e.waitUntil(net.catch(() => {}));
  const cached = caches.match(e.request, { ignoreSearch: true })
    .then((m) => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => cached.then((m) => { if (!done && m) { done = true; resolve(m); } });
    const timer = setTimeout(fallback, NET_TIMEOUT);
    net.then((res) => { if (!done) { done = true; clearTimeout(timer); resolve(res); } })
       .catch(() => { clearTimeout(timer); cached.then((m) => { if (!done) { done = true; resolve(m || Response.error()); } }); });
  });
}

/* CDN: кэш сразу, обновление фоном */
function staleWhileRevalidate(e) {
  const net = fetch(e.request).then((res) => put(e.request, res));
  e.waitUntil(net.catch(() => {}));
  return caches.match(e.request).then((m) => m || net);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) { e.respondWith(networkFirst(e)); return; }
  if (url.href.startsWith(SDK) || url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(e));
  }
});
