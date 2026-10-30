/* =========================================================
   柔道日誌（公開版）：保存先を Supabase にする部品
   ・画面と動き（index.html・practice.js など）は Mac の試作と同じファイル。保存先だけをここで差しかえる
     → 画面のファイルは JR.fetch('api/...') で出し入れする。試作ではそれが Mac のサーバー、公開版ではこのファイルが受けて Supabase に送る
     （api の形は ../server.mjs と同じ。データの決まりは rules.mjs を共通で使う）
   ・つなぎ方は My schedule（../index.html）と同じ：公開してよい鍵・storageKey 'my-schedule-auth'（ログインを共有）・25 秒で打ち切る fetchT
   ・見られる・書けるのは「本人 かつ コーチ」の行だけ（表の決まり＝RLS）。owner は本人の id
   ・電波がない時：書く分は outbox.js が端末にためて、つながったら同じ id で送る（upsert なので2回入らない）
     読む分は、前に読みこんだもの（端末の IndexedDB）を見せる
   ・手書きの文字の読み取りは、この端末ではしない（本部の Mac が後で読む）
   ・写真・声のファイルは jr-files の棚の {uid}/... に置く（JR.files）
   ・10/28 追加③：クラス（jr_classes）・今月の重点（jr_focus）・今週のお便り（jr_letters。見るだけ）・カレンダー用の1日ごとのまとめ（api/days）
     journal.sql の「追加③」を本番に流す前は、その表がない → クラス・重点は端末に残して（送信待ち）、表ができたら送る。お便りは「まだない」
   ========================================================= */
'use strict';
(() => {
  const SUPABASE_URL = 'https://ktwunswfyxozcultprnq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_P_UMeGV4gB54MjRBfjUIrA_E7drptd5';   // 公開用のキー（アプリに入れてよい値。My schedule と同じ）
  const ID_DOMAIN = 'players.judo-note.app';   // 柔道ノートと同じ ID でログインする
  const AUTH_KEY = 'my-schedule-auth';         // My schedule と同じ → どちらかでログインすれば、もう片方も入れる
  const idToEmail = (id) => `${id.trim().toLowerCase()}@${ID_DOMAIN}`;
  /* 通信は25秒で打ち切る（電波が弱いと「保存中…」のまま固まって見えるため） */
  function fetchT(url, opts = {}) {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 25000);
    if (opts.signal) { if (opts.signal.aborted) c.abort(); else opts.signal.addEventListener('abort', () => c.abort(), { once: true }); }
    return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(tm));
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY }, global: { fetch: fetchT } });
  // 何が起きたかの控え（柔道ノートと同じ client_errors。声の不具合などをあとで調べるため。中身の文字は入れない・1回の起動で20件まで）
  let logN = 0; const logSeen = new Set();
  window.JRLog = (kind, msg) => {
    try {
      const key = kind + '|' + String(msg).slice(0, 120); if (logN >= 20 || logSeen.has(key)) return; logSeen.add(key); logN++;
      const standalone = window.matchMedia && matchMedia('(display-mode: standalone)').matches ? 'home' : 'browser';
      sb.from('client_errors').insert({ kind: String(kind).slice(0, 40), msg: String(msg).slice(0, 800), place: ('journal/' + standalone).slice(0, 120), ua: navigator.userAgent.slice(0, 300) }).then(() => {}, () => {});
    } catch {}
  };
  const mods = Promise.all([import('./rules.mjs'), import('./search.mjs')]).then(([rules, s]) => ({ ...rules, search: s.search }));

  /* ---------- 端末の中の控え（IndexedDB。手書きは大きいので localStorage ではなくこちら） ---------- */
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('jr-cloud', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
    }));
    return {
      get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
      set: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => {}),
      clear: () => tx('readwrite', (s) => s.clear()).catch(() => {}),
    };
  })();

  /* ---------- ログイン（柔道ノートのコーチの ID とパスワード） ---------- */
  let ME = null, readyRes = null, ready = new Promise((r) => { readyRes = r; });
  const rawSession = () => { try { const j = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); return j && j.refresh_token && j.user ? j : null; } catch { return null; } };
  const gate = document.createElement('div');
  gate.className = 'jr-gate';
  document.body.appendChild(gate);
  const st = document.createElement('style');
  st.textContent = `.jr-gate{position:fixed;inset:0;z-index:200;display:grid;place-items:start center;padding:calc(12vh + env(safe-area-inset-top)) 16px 16px;background:var(--base);overflow:auto}
.jr-gate::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(900px 620px at 6% -10%,var(--b1),transparent 58%),radial-gradient(820px 640px at 108% 8%,var(--b2),transparent 55%),radial-gradient(760px 600px at 50% 118%,var(--b3),transparent 58%)}
.jr-gate[hidden]{display:none}
.jr-login{width:min(380px,100%);display:grid;gap:14px}
.jr-login .brand{justify-content:center;font-size:28px}
.jr-login .card{display:grid;gap:12px;padding:18px}
.jr-login label{display:grid;gap:4px;font-size:13px;color:var(--dim)}
.jr-login input{height:48px;border-radius:12px;border:1px solid var(--line2);background:rgba(255,255,255,.85);padding:0 12px;font-size:16px;outline:none;color:var(--text)}
.jr-login input:focus{border-color:var(--acc)}
.jr-login .btn{width:100%;height:48px}
.jr-login .err{color:var(--bad);font-size:14px;font-weight:700}
.jr-login p{margin:0;font-size:12.5px;color:var(--dim);line-height:1.6}
.jr-login .wait{text-align:center;color:var(--dim);font-size:14px}
body.jr-locked{overflow:hidden}
#jrWho{font-weight:700}`;
  document.head.appendChild(st);
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function showGate(mode, err = '') {
    gate.hidden = false; document.body.classList.add('jr-locked');
    const brand = '<div class="brand"><i></i>柔道日誌</div>';
    if (mode === 'loading') { gate.innerHTML = `<div class="jr-login">${brand}<div class="wait">ひらいています…</div></div>`; return; }
    gate.innerHTML = `<div class="jr-login">${brand}
      <section class="card glass">
        <label for="jrId">ID（柔道ノートと同じ）<input id="jrId" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label for="jrPw">パスワード<input id="jrPw" type="password" autocomplete="current-password"></label>
        ${err ? `<div class="err" id="jrErr">${escH(err)}</div>` : ''}
        <button class="btn" id="jrLogin">ログイン</button>
        <p>柔道ノートのコーチのIDとパスワードで入れます（My schedule と同じ）。選手・保護者のIDでは入れません。</p>
      </section></div>`;
  }
  function hideGate() { gate.hidden = true; gate.innerHTML = ''; document.body.classList.remove('jr-locked'); }
  async function doLogin() {
    const id = (gate.querySelector('#jrId')?.value || '').trim(), pw = gate.querySelector('#jrPw')?.value || '';
    if (!id || !pw) return showGate('login', 'IDとパスワードを入れてください');
    const b = gate.querySelector('#jrLogin'); b.disabled = true; b.textContent = 'ログイン中…';
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: idToEmail(id), password: pw });
      if (error) { showGate('login', /invalid/i.test(error.message) ? 'IDかパスワードが違います' : 'ログインできませんでした。電波を確認してください。'); gate.querySelector('#jrId').value = id; return; }
      await enter(data.user);
    } catch { showGate('login', 'ログインできませんでした。電波を確認してください。'); gate.querySelector('#jrId').value = id; }
  }
  gate.addEventListener('click', (e) => { if (e.target.closest('#jrLogin')) doLogin(); });
  gate.addEventListener('keydown', (e) => { if ((e.target.id === 'jrId' || e.target.id === 'jrPw') && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doLogin(); } });

  // 別の人がこの端末で入った時は、前の人の控え・送信待ちを残さない
  async function clearLocal() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('jr:')) localStorage.removeItem(k); } catch {}
    await idb.clear();
  }
  async function enter(user) {
    let me = null; try { me = JSON.parse(localStorage.getItem('jr:me') || 'null'); } catch {}
    if (me && me.uid !== user.id) await clearLocal();
    let prof = null, net = false, status = 0;
    try { const r = await sb.from('profiles').select('id,role,login_id').eq('id', user.id); status = r.status; if (r.error) net = !r.status || r.status >= 500; else prof = (r.data || [])[0] || null; }
    catch { net = true; }
    if (status === 401) return showGate('login', 'もう一度ログインしてください');
    if (!net && (!prof || prof.role !== 'coach')) { await sb.auth.signOut().catch(() => {}); return showGate('login', '柔道日誌はコーチだけが使えます。'); }
    const login = (prof && prof.login_id) || (me && me.uid === user.id && me.login) || '';
    try { localStorage.setItem('jr:me', JSON.stringify({ uid: user.id, login })); } catch {}
    ME = { uid: user.id, login };
    const who = document.getElementById('jrWho'); if (who) who.textContent = login;
    hideGate(); readyRes(ME);
  }
  // ログインが切れた（ほかのアプリでログアウトした等）→ ログイン画面。書いた分は端末に残して、入り直したら送る
  function needLogin(msg = 'もう一度ログインしてください') {
    if (!ME) return;
    ME = null; ready = new Promise((r) => { readyRes = r; });
    showGate('login', msg);
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') setTimeout(() => { if (!rawSession()) needLogin('ログアウトしました'); }, 0); });
  async function start() {
    showGate('loading');
    let session = null;
    try { ({ data: { session } } = await sb.auth.getSession()); } catch {}
    // 電波がない時は、前のログインのまま使う（送るのは、つながってから）
    const user = (session && session.user) || (rawSession() && rawSession().user);
    if (!user) return showGate('login');
    await enter(user);
  }
  async function logout() {
    const n = typeof Outbox !== 'undefined' ? Outbox.count() : 0;
    if (n && !confirm(`まだ送っていない分が ${n} 件あります。ログアウトすると、この端末から消えます。ログアウトしますか？`)) return;
    if (!confirm('ログアウトしますか？（My schedule もログアウトされます）')) return;
    await sb.auth.signOut().catch(() => {});
    await clearLocal();
    location.reload();
  }
  document.addEventListener('click', (e) => { if (e.target.closest('#jrLogout')) logout(); });

  /* ---------- 🔔 練習のあとの通知（10/29 本人が C：通知は柔道日誌のアプリから出す）----------
     この端末の通知の宛先を jr_push に入れる → 本部が練習の15〜20分後にここへ送る → 押すと柔道日誌のアプリで振り返りが開く
     iPhone は、ホーム画面に追加した柔道日誌から開いた時だけ通知を受けられる */
  const PUSH_KEY = 'BBUqyBZ6I7GbeUH4m53lmuLcbO9Lqz6qzsbBxnxtNeMHr2ef9l1PXyWLAC8KdgKfPpYnhhHG25bJicYls828qe0';
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const b64u = (s) => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  const say = (m) => (typeof toast === 'function' ? toast(m) : alert(m));
  function pushLabel(on) { const b = document.getElementById('jrPush'); if (b) b.textContent = on ? '🔔 練習のあとの通知：オン' : '🔔 練習のあとの通知をオンにする'; }
  async function pushState() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return pushLabel(false);
      const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
      pushLabel(!!sub);
    } catch { pushLabel(false); }
  }
  async function pushOn() {
    if (isIOS && !standalone()) return say('iPhone は、ホーム画面に追加した柔道日誌から開いた時だけ、通知をオンにできます');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return say('この端末・ブラウザでは通知が使えません');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return say('通知が許可されませんでした（設定 → 通知 から変えられます）');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(PUSH_KEY) });
      const j = sub.toJSON();
      const { error } = await sb.from('jr_push').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: (isIOS ? 'iPhone/iPad ' : '') + (standalone() ? 'ホーム画面' : 'ブラウザ') }, { onConflict: 'owner,endpoint' });
      if (error) throw error;
      pushLabel(true); say('🔔 通知をオンにしました。練習のあと「今日の練習どうだった？」が届きます');
    } catch (e) { say('通知をオンにできませんでした（電波を確かめて、もう一度）'); }
  }
  document.addEventListener('click', (e) => { if (e.target.closest('#jrPush')) pushOn(); });
  ready.then(pushState);
  // 通知を押した時、この画面へ移れなかった時の控え（sw.js から）
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'jr-open' && typeof e.data.url === 'string' && e.data.url.startsWith(location.origin)) location.href = e.data.url; });

  /* ---------- Supabase への出し入れ ---------- */
  class Offline extends Error {}
  class Bad extends Error {}
  class Auth extends Error {}
  class NotReady extends Error {}                                  // 表がまだない（journal.sql の追加③を流す前）
  async function q(builder) {
    const { data, error, status } = await builder;
    if (!error) return data;
    if (/PGRST205|42P01|Could not find the table|does not exist/.test(`${error.code || ''} ${error.message || ''}`)) throw new NotReady(error.message);
    if (!status) throw new Offline(error.message);                // 電波がない・25 秒で打ち切り
    if (status === 401 || status === 403) {                       // ログインが切れた／見てはいけない
      let s = null; try { ({ data: { session: s } } = await sb.auth.getSession()); } catch {}
      if (!s && !rawSession()) needLogin();
      throw new Auth(error.message);
    }
    if (status >= 500) throw new Offline(error.message);
    throw new Bad(error.message);                                 // 形がおかしい（決まりに合わない）
  }
  const ms = (t) => (t ? Date.parse(String(t).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')) || 0 : 0);
  const hm = (t) => (t ? String(t).slice(0, 5) : null);          // time 型 '19:00:00' → '19:00'
  const resp = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  let searchData = null, searchAt = 0;
  const changed = () => { searchAt = 0; };
  // 読む：つながらない時は、前に読みこんだ控えを返す
  async function cached(key, fn) {
    try { const v = await fn(); idb.set(key, v); return v; }
    catch (e) { if (e instanceof Bad) throw e; const v = await idb.get(key); if (v !== undefined) return v; throw e; }
  }
  const pageOf = (r) => ({ date: r.date, title: r.title || '', bg: r.bg || 'lined', ink: Array.isArray(r.ink) ? r.ink : [], text: r.text || '', read: r.read || null, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) });
  const menuOf = (r) => ({ id: r.id, date: r.date, title: r.title, start_time: hm(r.start_time), end_time: hm(r.end_time), items: r.items || [], from_kind: r.from_kind || '', from_id: r.from_id || '', class_id: r.class_id || '', created_at: r.created_at, updated_at: r.updated_at });
  const tplOf = (r) => ({ id: r.id, name: r.name, items: r.items || [], sort: r.sort || 0, created_at: r.created_at, updated_at: r.updated_at });
  const reflOf = (r) => ({ id: r.id, date: r.date, menu_id: r.menu_id, about: r.about, said: r.said || '', audio: r.audio || '', points: r.points || [], status: r.status, name_warn: !!r.name_warn, created_at: r.created_at, updated_at: r.updated_at });
  const pendingBodies = (kind) => { try { return Object.values(JSON.parse(localStorage.getItem('jr:outbox') || '{}')).filter((it) => it.kind === kind && it.op === 'put').map((it) => it.body); } catch { return []; } };

  async function handle(method, path, sp, body, uid) {
    const R = await mods;
    let m;
    // ---- 日誌のページ ----
    if (path === '/api/pages' && method === 'GET') {
      const list = await cached('pages', async () => {
        const [pg, mn, rf] = await Promise.all([
          q(sb.from('jr_pages').select('date,title,bg,text,read_text:read->>text,ink0:ink->0->>t,updated_at').eq('owner', uid)),
          q(sb.from('jr_menus').select('date').eq('owner', uid)),
          q(sb.from('jr_reflections').select('date').eq('owner', uid)),
        ]);
        const out = pg.map((p) => ({ date: p.date, title: p.title || '', bg: p.bg, strokes: p.ink0 ? true : 0, readLen: (p.read_text || '').length, textLen: (p.text || '').length, updatedAt: ms(p.updated_at) }));
        const day = (d) => { let x = out.find((p) => p.date === d); if (!x) { x = { date: d, title: '', strokes: 0, readLen: 0, textLen: 0 }; out.push(x); } return x; };
        for (const r of mn) { const x = day(r.date); x.menus = (x.menus || 0) + 1; }
        for (const r of rf) { const x = day(r.date); x.refl = (x.refl || 0) + 1; }
        return out.sort((a, b) => b.date.localeCompare(a.date));
      });
      return [200, list];
    }
    if ((m = path.match(/^\/api\/pages\/(\d{4}-\d{2}-\d{2})$/))) {
      const d = m[1];
      if (method === 'GET') {
        const pg = await cached('page:' + d, async () => {
          const rows = await q(sb.from('jr_pages').select('date,title,bg,ink,text,read,created_at,updated_at').eq('owner', uid).eq('date', d));
          return rows[0] ? pageOf(rows[0]) : 'none';   // 'none' = まだないページ（それも控えておく）
        });
        return pg === 'none' ? [404, { error: 'not found' }] : [200, pg];
      }
      if (method === 'PATCH') {
        // 送られてきた項目だけ上書き（iPad の手書きとスマホの文字が消し合わない）。保存の前の時刻も返す（ほかの端末の変更に気づけるように）
        const before = (await q(sb.from('jr_pages').select('text,updated_at').eq('owner', uid).eq('date', d)))[0];
        const prev = before ? ms(before.updated_at) : 0;
        let text = before ? before.text : '', updatedAt = prev;
        const cols = {};
        if ('title' in body) cols.title = R.clip(body.title, 200);
        if ('bg' in body) cols.bg = ['blank', 'lined', 'tatami', 'court', 'pair', 'photo'].includes(body.bg) ? body.bg : 'lined';
        if ('ink' in body) cols.ink = Array.isArray(body.ink) ? body.ink : [];
        if ('text' in body) cols.text = R.clip(body.text, 20000);
        if ('read' in body) cols.read = R.cleanRead(body.read);
        if (Object.keys(cols).length) {
          const r = (await q(sb.from('jr_pages').upsert({ owner: uid, date: d, ...cols }, { onConflict: 'owner,date' }).select('text,updated_at')))[0];
          text = r.text; updatedAt = ms(r.updated_at);
        }
        // 文字の書き足しは DB の中で末尾に足す（jr_append_text）。前に返事が来なかった分は、もう入っていれば足さない
        if (typeof body.appendText === 'string' && body.appendText.trim()) {
          const dup = body._retry && String(text || '').replace(/\s+$/, '').endsWith(body.appendText.trim());
          if (!dup) { const r = (await q(sb.rpc('jr_append_text', { p_date: d, p_text: body.appendText.slice(0, 20000) })))[0]; text = r.text; updatedAt = ms(r.updated_at); }
        }
        // 端末の控えも新しくしておく（電波がない時に開き直しても、送った分が見える）
        const c = await idb.get('page:' + d);
        const pg = c && c !== 'none' ? c : { date: d, title: '', bg: 'lined', ink: [], text: '', read: null, createdAt: Date.now() };
        Object.assign(pg, cols, { text, updatedAt }); idb.set('page:' + d, pg);
        changed();
        return [200, { ok: true, updatedAt, prevUpdatedAt: prev, text }];
      }
    }
    if (path === '/api/read') return [501, { error: '読み取りは Mac（本部）が後でします' }];

    // ---- 試合の反省 ----
    if (path === '/api/reviews' && method === 'GET') {
      const rows = await q(sb.from('jr_reviews').select('id,date,event,match,done,step,source,source_hash,updated_at').eq('owner', uid));
      return [200, rows.map((r) => ({ id: r.id, date: r.date, event: r.event, match: r.match, done: r.done, step: r.step, source: r.source, sourceHash: r.source_hash, updatedAt: ms(r.updated_at) }))
        .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))];
    }
    if ((m = path.match(/^\/api\/reviews\/([0-9a-z-]+)$/)) && R.isRid(m[1])) {
      const id = m[1];
      if (method === 'GET') {
        const rv = await cached('review:' + id, async () => {
          const r = (await q(sb.from('jr_reviews').select('*').eq('owner', uid).eq('id', id)))[0];
          if (!r) return 'none';
          return { ...R.cleanReview(id, { ...r, sourceHash: r.source_hash }), createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) };
        });
        return rv === 'none' ? [404, { error: 'not found' }] : [200, rv];
      }
      if (method === 'PUT') {
        const c = R.cleanReview(id, body, null);
        const r = (await q(sb.from('jr_reviews').upsert({ owner: uid, id, date: c.date, event: c.event, match: c.match, answers: c.answers, fixes: c.fixes,
          step: c.step, done: c.done, source: c.source, source_hash: c.sourceHash }, { onConflict: 'owner,id' }).select('updated_at')))[0];
        idb.set('review:' + id, { ...c, updatedAt: ms(r.updated_at) }); changed();
        return [200, { ok: true, updatedAt: ms(r.updated_at) }];
      }
    }

    // ---- 練習メニュー・型・振り返り（GET = 一覧、PUT = id で上書き、DELETE = 消す） ----
    if ((m = path.match(/^\/api\/(menus|templates|reflections)(?:\/([0-9a-z-]+))?$/))) {
      const [, kind, id] = m, table = { menus: 'jr_menus', templates: 'jr_templates', reflections: 'jr_reflections' }[kind];
      if (!id && method === 'GET') {
        let b = sb.from(table).select('*').eq('owner', uid);
        const d = sp.get('date'); if (d && R.isDate(d)) b = b.eq('date', d);
        const rows = await q(b);
        if (kind === 'menus') return [200, rows.map(menuOf).sort(R.byTime)];
        if (kind === 'templates') return [200, rows.map(tplOf).sort((a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)))];
        return [200, rows.map(reflOf).sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at).localeCompare(String(b.created_at)))];
      }
      if (id && (kind === 'templates' ? R.isTid(id) : R.isRid(id))) {
        if (method === 'PUT') {
          let row;
          if (kind === 'menus') {
            const c = R.cleanMenu(id, body, null);
            row = { id, date: c.date, title: c.title, start_time: c.start_time, items: c.items, from_kind: c.from_kind, from_id: c.from_id, created_at: c.created_at };
            // end_time は予定から入った行（本部が作る）だけにある。それ以外は送らない（journal.sql の追加②を流す前でも保存できるように）
            if (c.end_time || R.isCalId(id)) row.end_time = c.end_time;
            row.class_id = c.class_id;   // 10/28 追加④（journal.sql の追加④を本番に流してから公開する）
          }
          else if (kind === 'templates') { const c = R.cleanTemplate(id, body, null); row = { id, name: c.name, items: c.items, sort: c.sort, created_at: c.created_at }; }
          else { const c = R.cleanReflection(id, body, null); row = { id, date: c.date, menu_id: c.menu_id, about: c.about, said: c.said, audio: c.audio, points: c.points, status: c.status, name_warn: c.name_warn, created_at: c.created_at }; }
          const r = (await q(sb.from(table).upsert({ owner: uid, ...row }, { onConflict: 'owner,id' }).select('updated_at')))[0];
          changed();
          return [200, { ok: true, updated_at: r.updated_at }];
        }
        if (method === 'DELETE') { await q(sb.from(table).delete().eq('owner', uid).eq('id', id)); changed(); return [200, { ok: true }]; }
      }
      return [400, { error: 'bad id' }];
    }
    // 前回の振り返りから（jr_carry_over）。まだ送っていない振り返りの方が新しければ、そちらを使う
    if (path === '/api/carry-over' && method === 'GET') {
      const d = sp.get('date') || '';
      if (!R.isDate(d)) return [400, { error: 'bad date' }];
      const rows = await q(sb.rpc('jr_carry_over', { p_date: d }));
      let out = { from_date: rows[0] ? rows[0].from_date : null, items: rows.map((r) => r.text).filter((t) => String(t || '').trim()) };
      const local = R.carryOver(pendingBodies('reflections'), d);
      if (local.from_date && (!out.from_date || local.from_date >= out.from_date)) out = local;
      return [200, out];
    }
    // ---- 10/28 追加③：クラス（jr_classes） ----
    if ((m = path.match(/^\/api\/classes(?:\/([0-9a-z-]+))?$/))) {
      const id = m[1];
      if (!id && method === 'GET') {
        const rows = await cached('classes', () => q(sb.from('jr_classes').select('id,name,days,start_time,end_time,sort,is_default,created_at,updated_at').eq('owner', uid)));
        return [200, rows.map((r) => ({ ...r, days: r.days || [], start_time: hm(r.start_time), end_time: hm(r.end_time) })).sort((a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)))];
      }
      if (id && R.isCid(id)) {
        if (method === 'PUT') {
          const c = R.cleanClass(id, body, null);
          const r = (await q(sb.from('jr_classes').upsert({ owner: uid, id, name: c.name, days: c.days, start_time: c.start_time, end_time: c.end_time, sort: c.sort, is_default: c.is_default, created_at: c.created_at }, { onConflict: 'owner,id' }).select('updated_at')))[0];
          return [200, { ok: true, updated_at: r.updated_at }];
        }
        if (method === 'DELETE') { await q(sb.from('jr_classes').delete().eq('owner', uid).eq('id', id)); return [200, { ok: true }]; }
      }
      return [400, { error: 'bad id' }];
    }
    // ---- 今月の重点（jr_focus。id = 月の1日-クラスの id） ----
    if ((m = path.match(/^\/api\/focus(?:\/([0-9a-z-]+))?$/))) {
      const id = m[1];
      if (!id && method === 'GET') {
        const mo = sp.get('month');
        const rows = await cached('focus:' + (mo || ''), () => { let b = sb.from('jr_focus').select('month,class_id,text,updated_at').eq('owner', uid); if (mo && R.isMonth(mo)) b = b.eq('month', mo); return q(b); });
        return [200, rows.map((r) => ({ id: R.focusId(r.month, r.class_id), ...r }))];
      }
      const k = id && R.parseFocusId(id);
      if (k) {
        if (method === 'PUT') {
          const f = R.cleanFocus({ ...body, ...k });
          const r = (await q(sb.from('jr_focus').upsert({ owner: uid, month: f.month, class_id: f.class_id, text: f.text }, { onConflict: 'owner,month,class_id' }).select('updated_at')))[0];
          return [200, { ok: true, updated_at: r.updated_at }];
        }
        if (method === 'DELETE') { await q(sb.from('jr_focus').delete().eq('owner', uid).eq('month', k.month).eq('class_id', k.class_id)); return [200, { ok: true }]; }
      }
      return [400, { error: 'bad id' }];
    }
    // ---- 今週のお便り（jr_letters。本部が置く。ここでは見るだけ） ----
    if (path === '/api/letters' && method === 'GET') {
      let rows;
      try { rows = await cached('letters', () => q(sb.from('jr_letters').select('week,title,made_at,counts:body->counts').eq('owner', uid))); }
      catch (e) { if (e instanceof NotReady) return [200, []]; throw e; }
      return [200, rows.filter((r) => R.isMonday(r.week)).map((r) => { const l = R.cleanLetter({ ...r, body: { counts: r.counts } }); return { week: l.week, title: l.title, made_at: l.made_at, counts: l.body.counts }; })
        .sort((a, b) => b.week.localeCompare(a.week))];
    }
    if ((m = path.match(/^\/api\/letters\/(\d{4}-\d{2}-\d{2})$/)) && method === 'GET') {
      if (!R.isMonday(m[1])) return [404, { error: 'not found' }];
      let l;
      try { l = await cached('letter:' + m[1], async () => (await q(sb.from('jr_letters').select('week,title,body,made_at').eq('owner', uid).eq('week', m[1])))[0] || 'none'); }
      catch (e) { if (e instanceof NotReady) return [404, { error: 'not found' }]; throw e; }
      return l === 'none' ? [404, { error: 'not found' }] : [200, R.cleanLetter(l)];
    }
    // ---- 記録のカレンダー：from〜to の1日ごとのまとめ ----
    if (path === '/api/days' && method === 'GET') {
      const from = sp.get('from') || '', to = sp.get('to') || '';
      if (!R.isDate(from) || !R.isDate(to) || from > to || to > R.addDaysTo(from, 62)) return [400, { error: 'bad range' }];
      const out = await cached(`days:${from}:${to}`, async () => {
        const rng = (t, cols) => q(sb.from(t).select(cols).eq('owner', uid).gte('date', from).lte('date', to));
        const [pages, menus, refl, reviews] = await Promise.all([
          rng('jr_pages', 'date,ink0:ink->0->>t,text'), rng('jr_menus', 'id,date,title,start_time,end_time,items,from_kind,class_id,created_at'),
          rng('jr_reflections', 'id,date,about,said,points,status'), rng('jr_reviews', 'id,date,event'),
        ]);
        return R.daySummary({ pages: pages.map((p) => ({ date: p.date, ink: !!p.ink0, text: p.text })), menus: menus.map(menuOf), reflections: refl, reviews }, from, to);
      });
      return [200, out];
    }
    // ---- 昔の記録（Notion から。見るだけ） ----
    if (path === '/api/archive' && method === 'GET') {
      const rows = await q(sb.from('jr_archive').select('notion_id,date,title,menu,props').eq('owner', uid));
      rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      return [200, rows.map(R.arcListRow)];
    }
    if ((m = path.match(/^\/api\/archive\/([A-Za-z0-9-]+)$/)) && method === 'GET') {
      const a = (await q(sb.from('jr_archive').select('*').eq('owner', uid).eq('notion_id', m[1])))[0];
      return a ? [200, a] : [404, { error: 'not found' }];
    }
    // ---- さがす：読みこんだデータを、この端末の中でさがす（決まりは search.mjs） ----
    if (path === '/api/search' && method === 'GET') {
      const qs = (sp.get('q') || '').slice(0, 100);
      if (!searchData || Date.now() - searchAt > 30000) {
        searchData = await cached('search', async () => {
          const K = ['where', 'good', 'bad', 'feel'];
          const [pages, rv, menus, refl, archive] = await Promise.all([
            q(sb.from('jr_pages').select('date,title,text,read').eq('owner', uid)),
            q(sb.from('jr_reviews').select(['id,date,event,match,fixes', ...K.map((k) => `${k}_t:answers->${k}->>text,${k}_r:answers->${k}->read`)].join(',')).eq('owner', uid)),
            q(sb.from('jr_menus').select('*').eq('owner', uid)),
            q(sb.from('jr_reflections').select('*').eq('owner', uid)),
            q(sb.from('jr_archive').select('notion_id,date,title,menu,body').eq('owner', uid)),
          ]);
          const reviews = rv.map((r) => ({ id: r.id, date: r.date, event: r.event, match: r.match, fixes: r.fixes || [], answers: Object.fromEntries(K.map((k) => [k, { text: r[k + '_t'] || '', read: r[k + '_r'] || null }])) }));
          return { pages, reviews, menus: menus.map(menuOf), reflections: refl.map(reflOf), archive };
        });
        searchAt = Date.now();
      }
      // まだ送っていない分も、さがせるように重ねる
      const over = (rows, kind) => { const out = rows.slice(); for (const b of pendingBodies(kind)) { const i = out.findIndex((x) => x.id === b.id); if (i >= 0) out[i] = b; else out.push(b); } return out; };
      const D = searchData;
      return [200, { q: qs, hits: R.search(qs, D.pages, over(D.reviews, 'reviews'), { menus: over(D.menus, 'menus'), reflections: over(D.reflections, 'reflections'), archive: D.archive }) }];
    }
    return [404, { error: 'not found' }];
  }

  // 画面のファイルからの出し入れ（試作の Mac のサーバーと同じ api の形で受ける）
  async function route(url, opts = {}) {
    const u = new URL(url, 'http://jr.local/');
    const method = (opts.method || 'GET').toUpperCase();
    let body = {};
    try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}
    const me = await ready;                                    // ログインするまで待つ
    try {
      const [status, out] = await handle(method, u.pathname, u.searchParams, body, me.uid);
      return resp(status, out);
    } catch (e) {
      if (e instanceof Offline) throw new TypeError('Failed to fetch');   // fetch と同じ形（outbox.js が「送信待ち」にする）
      if (e instanceof Auth) return resp(503, { error: 'login' });       // 送信待ちに残す（入り直したら送る）
      if (e instanceof NotReady) return resp(503, { error: 'not-ready' }); // 表がまだない：送信待ちに残す（表ができたら送る）
      if (e instanceof Bad) return resp(400, { error: e.message });
      if (e instanceof TypeError) throw e;
      console.error(e);
      return resp(500, { error: String(e.message || e) });
    }
  }

  // 写真・声のファイル（jr-files の棚。本人の {uid}/ の中だけ）
  const files = {
    async put(name, blob, type) { const me = await ready; const p = `${me.uid}/${name}`; const { error } = await sb.storage.from('jr-files').upload(p, blob, { upsert: true, contentType: type || blob.type }); if (error) throw error; return p; },
    async url(p, sec = 3600) { const { data, error } = await sb.storage.from('jr-files').createSignedUrl(p, sec); if (error) throw error; return data.signedUrl; },
  };

  window.JR = { cloud: true, fetch: route, files, ready: () => ready, me: () => ME, _sb: sb };
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
  start();
})();
