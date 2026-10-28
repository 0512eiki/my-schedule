/* =========================================================
   送信待ち（つながらない時は端末にためて、つながったら送る）
   ・メニュー・型・振り返りは、まず端末の中（localStorage）に入れてから送る → 電波がなくても必ず書ける
   ・同じ id は上書き（あとの方だけ残す）。サーバーも id で上書きするので、2回送っても1件のまま
   ・手書きのページの「一時保存」（jr:pending:<日付>）も、件数に数える（送るのは今まで通り index.html の save）
   ・画面の上に「📴 つながっていません・送信待ち ◯件」→ 送れたら「✓ 送りました（◯件）」
   ・読みこめない時は、前に読みこんだ分＋まだ送っていない分を見せる
   ・文字のメモの「書き足し」（op = append）もためる。同じ日に何回でも足せる（足した順に送る）
   ・試合の反省（reviews）も、まず端末に入れてから送る
   ・10/28 追加③：クラス（classes）・今月の重点（focus）も同じ（お便りは見るだけなので、ここには入らない）
   ・送り先は JR.fetch（試作 = この Mac のサーバー、公開版 = cloud.js が Supabase に送る）
   使っている部品（index.html 側）：state（手書きの保存がうまくいっていないか）, hhmm
   ========================================================= */
'use strict';
const Outbox = (() => {
  const KEY = 'jr:outbox', CACHE = 'jr:cache:';
  const PATH = { menus: 'api/menus/', templates: 'api/templates/', reflections: 'api/reflections/', reviews: 'api/reviews/', pages: 'api/pages/', classes: 'api/classes/', focus: 'api/focus/' };
  let offline = false, peak = 0, busy = null, again = false, okT = 0;
  const subs = new Set();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const keep = (q) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch {} };
  function pagePending() {
    let n = 0;
    try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith('jr:pending:')) n++; } catch {}
    return n;
  }
  const count = () => Object.keys(load()).length + pagePending();
  const pending = (kind, id) => !!load()[kind + '/' + id];

  // 入れる・消す（まず端末へ。そのあと送ってみる）
  function put(kind, body) {
    const q = load(); q[kind + '/' + body.id] = { kind, id: body.id, op: 'put', body, at: Date.now(), n: Math.random() }; keep(q);
    show(); return flush();
  }
  // 文字のメモの書き足し（同じ日に何回も足せるように、1回ごとに別の番号）
  function append(date, text) {
    const q = load(); q[`append/${date}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`] = { kind: 'pages', id: date, op: 'append', text, at: Date.now() }; keep(q);
    show(); return flush();
  }
  const appendsOf = (date) => Object.values(load()).filter((it) => it.op === 'append' && it.id === date);
  // 送れていない書き足しを、文字のメモの後ろにつなげて見せる
  function withAppends(date, text) {
    let t = text || '';
    for (const it of appendsOf(date)) t = (t ? t.replace(/\s+$/, '') + '\n' : '') + it.text;
    return t;
  }
  // 全文を直した時：直した全文に入っているので、送信待ちの書き足しは捨てる
  function dropAppends(date) { const q = load(); for (const [k, it] of Object.entries(q)) if (it.op === 'append' && it.id === date) delete q[k]; keep(q); show(); }
  // まだ送っていない中身（あれば）
  function peek(kind, id) { const it = load()[kind + '/' + id]; return it && it.op === 'put' ? JSON.parse(JSON.stringify(it.body)) : null; }
  function del(kind, id) {
    const q = load(); q[kind + '/' + id] = { kind, id, op: 'delete', at: Date.now(), n: Math.random() }; keep(q);
    show(); return flush();
  }

  async function flush() {
    if (busy) { again = true; return busy; }
    busy = (async () => {
      for (const [k, it] of Object.entries(load())) {
        let r;
        try {
          r = await JR.fetch(PATH[it.kind] + it.id, it.op === 'delete' ? { method: 'DELETE' }
            // 書き足し：前に送って返事が来なかった分（tries）は、もう入っていないか確かめてから足す（2回入らないように）
            : it.op === 'append' ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appendText: it.text, _retry: !!it.tries }) }
            : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it.body) });
        } catch { offline = true; markTry(k); break; }
        if (r.status >= 500) { offline = true; markTry(k); break; }
        // 送れた（形の悪いもの＝400 などは、いつまでも残らないように捨てる）。送っている間に直した分は残す
        const q = load(); if (q[k] && q[k].at === it.at && q[k].n === it.n) { delete q[k]; keep(q); }   // n = 同じ 1/1000 秒に直した分も取りちがえない
        offline = false;
        const j = r.ok ? await r.json().catch(() => ({})) : {};
        subs.forEach((fn) => { try { fn(it, j); } catch {} });
      }
    })();
    try { await busy; } finally { busy = null; show(); }
    if (again) { again = false; return flush(); }
  }

  function markTry(k) { const q = load(); if (q[k]) { q[k].tries = (q[k].tries || 0) + 1; keep(q); } }

  // 一覧を読む。読めない時は前の分。まだ送っていない分（端末の方が新しい）をかぶせる
  async function list(kind, url, match = () => true, key = 'id') {
    let rows;
    try {
      const r = await JR.fetch(url); if (!r.ok) throw new Error(r.status);
      rows = await r.json(); offline = false;
      try { localStorage.setItem(CACHE + url, JSON.stringify(rows)); } catch {}
    } catch {
      offline = true;
      try { rows = JSON.parse(localStorage.getItem(CACHE + url) || '[]'); } catch { rows = []; }
    }
    for (const it of Object.values(load())) {
      if (it.kind !== kind || it.op === 'append') continue;
      const i = rows.findIndex((x) => x[key] === it.id);
      if (it.op === 'delete') { if (i >= 0) rows.splice(i, 1); }
      else if (match(it.body)) { if (i >= 0) rows[i] = it.body; else rows.push(it.body); }
    }
    show();
    return rows;
  }
  // 1件だけ読む（読めない時は前に読んだ分）
  async function get(url) {
    try { const r = await JR.fetch(url); if (!r.ok) throw new Error(r.status); const j = await r.json(); try { localStorage.setItem(CACHE + url, JSON.stringify(j)); } catch {} return j; }
    catch { try { return JSON.parse(localStorage.getItem(CACHE + url) || 'null'); } catch { return null; } }
  }

  /* ---------- 画面の表示（つながっていない・送信待ち ◯件 → 送りました） ---------- */
  function show() {
    const el = document.getElementById('sendq'); if (!el) return;
    const n = count();
    const off = offline || !navigator.onLine || (typeof state !== 'undefined' && state.failed);
    if (n && off) {
      peak = Math.max(peak, n); clearTimeout(okT);
      el.hidden = false; el.className = 'sendq'; el.textContent = `📴 つながっていません ・ 送信待ち ${n}件`; return;
    }
    if (n && peak) { el.hidden = false; el.className = 'sendq'; el.textContent = `↻ 送っています ・ 送信待ち ${n}件`; return; }
    if (!n && peak) {
      el.hidden = false; el.className = 'sendq ok'; el.textContent = `✓ 送りました（${peak}件） ・ ${hhmm(Date.now())}`; peak = 0;
      clearTimeout(okT); okT = setTimeout(() => { el.hidden = true; }, 6000); return;
    }
  }
  addEventListener('online', () => { offline = false; flush(); });
  addEventListener('offline', () => { offline = true; show(); });
  setInterval(() => { if (Object.keys(load()).length) flush(); else show(); }, 2500);
  addEventListener('load', () => { show(); if (Object.keys(load()).length) flush(); });

  // まだ送っていない分の中身（カレンダーの印に重ねる）・消した id
  const bodies = (kind) => Object.values(load()).filter((it) => it.kind === kind && it.op === 'put').map((it) => JSON.parse(JSON.stringify(it.body)));
  const deleted = (kind) => Object.values(load()).filter((it) => it.kind === kind && it.op === 'delete').map((it) => it.id);
  return { bodies, deleted, put, del, append, withAppends, dropAppends, peek, flush, list, get, count, pending, show, on: (fn) => subs.add(fn), isOffline: () => offline || !navigator.onLine };
})();
window.Outbox = Outbox;
