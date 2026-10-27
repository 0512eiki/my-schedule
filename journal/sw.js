// 柔道日誌（公開版）：電波がない時も開けるように、画面のファイルを端末にとっておく
// ・範囲は /my-schedule/journal/ だけ（My schedule の sw.js とは別。My schedule の画面・通知には触らない）
// ・画面のファイルは「まずネット → だめなら端末の控え」（直した分がすぐ届くように）。Supabase の部品（版の決まった CDN）は控えを先に使う
// ・Supabase とのやりとり（データ）はここでは扱わない（cloud.js と outbox.js が受け持つ）
const VERSION = 'jr-3e6cb8a1db';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.min.js';
const FILES = ['./', 'index.html', 'cloud.js', 'rules.mjs', 'search.mjs', 'review-parse.mjs', 'reader.js', 'voice.js', 'search-ui.js', 'outbox.js',
  'review.js', 'practice.js', 'reflect.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(FILES);
    try { await c.put(CDN, await fetch(CDN, { mode: 'no-cors' })); } catch {}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('jr-') && k !== VERSION) await caches.delete(k);   // 柔道日誌の古い控えだけ消す
    await self.clients.claim();
  })());
});

const scopePath = new URL('./', self.location.href).pathname;   // /my-schedule/journal/
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href === CDN) {
    e.respondWith(caches.match(CDN).then((hit) => hit || fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(CDN, cp)); return r; })));
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath) || url.pathname.endsWith('/sw.js')) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
      if (r.ok) c.put(req.mode === 'navigate' ? 'index.html' : url.pathname.slice(scopePath.length) || './', r.clone());
      return r;
    } catch {
      const key = req.mode === 'navigate' ? 'index.html' : url.pathname.slice(scopePath.length) || './';
      return (await c.match(key)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
