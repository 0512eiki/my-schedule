/* =========================================================
   練習メニュー・メニューの型・昔の記録（Notion から）
   ・その日のページの上で「📋 メニュー／✍️ 手書き／💬 振り返り」を切りかえる（画面は増やさない）
   ・メニューは本人が作る（1回の練習 = 1つ。1日に2つも作れる）。型・昔の記録から1回押すだけで入る
   ・秘書のメニューの案は出さない（本人の決まり：困った時だけ聞く）
   ・上に「🔁 前回の振り返りから」（その日より前の一番新しい振り返りの「次へ」の所だけ。メニューは勝手に変えない）
   ・iPhone は下にタブ3つ（今日・記録・さがす）
   ・保存はすべて Outbox（端末に入れてから送る）。形は ../supabase/journal.sql の jr_menus / jr_templates / jr_archive と同じ
   使っている部品（index.html 側）：$, state, openDate, today, parseD, WD, hhmm, escapeHtml, toast, closeSide, renderList, layout, Outbox
   ========================================================= */
const esc = (s) => escapeHtml(String(s ?? ''));
const isoNow = () => new Date().toISOString();
const rnd = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');
const newId = (date) => `${date}-${rnd()}`;
const tplId = () => `t-${Date.now().toString(36)}-${rnd()}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const dlabel = (d) => { if (!d) return '日付なし'; const dt = parseD(d); return `${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）`; };
const ylabel = (d) => { if (!d) return '日付なし'; const dt = parseD(d); return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${WD[dt.getDay()]}）`; };

/* ---------- その日（ほかの部品＝振り返り・さがすから使う） ---------- */
const subs = new Set();
export const Day = {
  date: null, menus: [], templates: [], loading: Promise.resolve(),
  get view() { return document.body.dataset.view; },
  on(fn) { subs.add(fn); },
  show,
};
const notify = (why) => subs.forEach((fn) => { try { fn(why); } catch (e) { console.error(e); } });

function show(view) {
  document.body.dataset.view = view;
  document.querySelectorAll('#daySeg [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'ink') layout();             // 隠れていた間は手書きの大きさが分からないので、測り直す
  notify('view');
}
$('daySeg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });

/* ---------- 読みこみ ---------- */
let seq = 0, carry = { from_date: null, items: [] };
async function loadDay(d) {
  const my = ++seq;
  flushAll();
  Day.date = d;
  const [menus, co] = await Promise.all([
    Outbox.list('menus', 'api/menus?date=' + d, (b) => b.date === d),
    Outbox.get('api/carry-over?date=' + d),
  ]);
  if (my !== seq) return;
  menus.sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99') || String(a.created_at).localeCompare(String(b.created_at)));
  Day.menus = menus; carry = co || { from_date: null, items: [] };
  renderMenus(); notify('date');
}
async function loadTemplates() {
  Day.templates = await Outbox.list('templates', 'api/templates');
  Day.templates.sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created_at).localeCompare(String(b.created_at)));
  renderTplList();
}
function reload(d) { Day.loading = loadDay(d || state.date || today()); return Day.loading; }
addEventListener('jr:date', (e) => reload(e.detail));

/* ---------- 保存（少しまとめてから Outbox へ） ---------- */
const timers = new Map();          // 'menus/<id>' → [タイマー, 送る関数]
function saveLater(kind, row, ms = 500) {
  row.updated_at = isoNow();
  const k = kind + '/' + row.id;
  clearTimeout(timers.get(k)?.[0]);
  const go = () => { timers.delete(k); Outbox.put(kind, clone(row)).then(() => afterSave(kind, row.id)); };
  timers.set(k, [setTimeout(go, ms), go]);
  setSt(kind, row.id, '保存待ち…', '');
}
function flushAll() { for (const [, [t, go]] of [...timers]) { clearTimeout(t); go(); } }
addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
function afterSave(kind, id) {
  if (Outbox.pending(kind, id)) setSt(kind, id, '📴 端末に保存（つながったら送ります）', 'wait');
  else setSt(kind, id, '保存しました ' + hhmm(Date.now()), 'ok');
  if (kind === 'menus') renderList();
  if (kind === 'templates') renderTplList();
}
function setSt(kind, id, msg, cls) {
  const el = kind === 'menus' ? document.querySelector(`[data-menu="${id}"] .mn-st`) : kind === 'templates' ? tov.querySelector('.rv-save') : null;
  if (el) { el.textContent = msg; el.className = (kind === 'menus' ? 'mn-st ' : 'rv-save ') + cls; }
}
// 送れたら表示を「保存しました」に（電波が戻った時）
Outbox.on((it) => { if (it.op === 'put' && !timers.has(it.kind + '/' + it.id)) afterSave(it.kind, it.id); });

/* =========================================================
   メニューの項目（メニューと型で同じ部品）
   ========================================================= */
function times(items, start) {
  if (!start) return items.map(() => '');
  let [h, m] = start.split(':').map(Number), t = h * 60 + m;
  return items.map((it) => { const s = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; t += it.minutes || 0; return s; });
}
function itemsHTML(items, start) {
  if (!items.length) return '<div class="mn-empty">まだ項目がありません。「＋ 足す」で入れます</div>';
  const ts = times(items, start);
  return items.map((it, i) => `<div class="mi" data-i="${i}">
    <span class="t">${ts[i]}</span>
    <input class="nm" data-f="name" value="${esc(it.name)}" placeholder="例：打ち込み（背負い）" maxlength="120">
    <label class="mins"><input data-f="minutes" type="number" inputmode="numeric" min="0" max="600" value="${it.minutes || 0}">分</label>
    <input class="note" data-f="note" value="${esc(it.note)}" placeholder="メモ（なくてもOK）" maxlength="500">
    <span class="ops"><button class="ib sm" data-act="up" title="上へ" ${i === 0 ? 'disabled' : ''}>↑</button><button class="ib sm" data-act="down" title="下へ" ${i === items.length - 1 ? 'disabled' : ''}>↓</button><button class="ib sm" data-act="rm" title="この項目を消す">✕</button></span>
  </div>`).join('');
}
const total = (items) => items.reduce((a, it) => a + (it.minutes || 0), 0);
// 項目の入力 → 中身を直す（並びは変えないので、描き直さない）
function itemInput(items, t) {
  const row = t.closest('.mi'); if (!row || !t.dataset.f) return false;
  const it = items[+row.dataset.i]; if (!it) return false;
  it[t.dataset.f] = t.dataset.f === 'minutes' ? Math.max(0, Math.min(600, Math.round(Number(t.value) || 0))) : t.value;
  return true;
}
// 足す・消す・並べかえ → true なら描き直す
function itemAct(items, act, i) {
  if (act === 'add-item') { items.push({ name: '', minutes: 10, note: '' }); return true; }
  if (act === 'up' && i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; return true; }
  if (act === 'down' && i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; return true; }
  if (act === 'rm') { items.splice(i, 1); return true; }
  return false;
}
function refreshTimes(box, items, start) {
  const ts = times(items, start);
  box.querySelectorAll('.mi').forEach((r, i) => { const t = r.querySelector('.t'); if (t) t.textContent = ts[i] || ''; });
  const sub = box.querySelector('.mn-count'); if (sub) sub.textContent = `${items.length}つ・${total(items)}分`;
}
// 消すボタンは2回押し（1回目で「本当に消す」に変わる）
function sure(b, label) {
  if (b.dataset.sure) return true;
  b.dataset.sure = '1'; const was = b.textContent; b.textContent = label;
  setTimeout(() => { b.textContent = was; delete b.dataset.sure; }, 3000);
  return false;
}

/* =========================================================
   📋 メニュー（その日のページの中）
   ========================================================= */
const vMenu = $('vMenu');
function fromLabel(m) {
  if (m.from_kind === 'template') { const t = Day.templates.find((x) => x.id === m.from_id); return `<span class="chip">型「${esc(t ? t.name : '…')}」から</span>`; }
  if (m.from_kind === 'notion') return '<span class="chip">昔の記録（Notion）から</span>';
  return '';
}
function renderMenus() {
  const d = Day.date; if (!d) return;
  const ae = document.activeElement;
  if (ae && vMenu.contains(ae) && ae.matches('input, textarea')) return;   // 打っている途中は描き直さない（文字が消えないように）
  const co = carry.items.length ? `<div class="todo" id="carry"><b>🔁 前回の振り返りから（${dlabel(carry.from_date)}）</b>
      <ul>${carry.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><small>「次へ」の印をつけた所だけ。メニューは自分で決めます（勝手には変えません）</small></div>` : '';
  const cards = Day.menus.map((m) => `<section class="card glass mn" data-menu="${m.id}">
      <div class="mn-head">
        <input class="mn-title" data-k="title" value="${esc(m.title)}" placeholder="練習の名前（例：練習・小学生クラス）" maxlength="120">
        <label class="mn-at">開始<input type="time" data-k="start_time" value="${esc(m.start_time || '')}"></label>
      </div>
      <div class="mn-sub"><span class="mn-count">${m.items.length}つ・${total(m.items)}分</span>${fromLabel(m)}<span class="mn-st"></span></div>
      <div class="mn-items">${itemsHTML(m.items, m.start_time)}</div>
      ${m.items.length ? '' : tplChips('fill')}
      <div class="row"><button class="btn sub" data-act="add-item">＋ 足す</button><button class="btn sub" data-act="to-tpl">📋 型として保存</button><button class="lnk del" data-act="del-menu">このメニューを消す</button></div>
    </section>`).join('');
  const create = `<section class="card glass mn-new">
      <h3>${Day.menus.length ? '＋ もう1つメニューを作る <span>1日に2回の練習など</span>' : '📋 この日のメニューはまだありません'}</h3>
      ${tplChips('new')}
      <div class="mn-help"><button class="lnk" data-act="ask">💡 困った時は秘書に聞く</button><span id="askMsg" hidden>本部の秘書に聞いてください（本番で本部とつなぎます）</span></div>
    </section>`;
  vMenu.innerHTML = co + cards + create;
  Day.menus.forEach((m) => { if (Outbox.pending('menus', m.id)) setSt('menus', m.id, '📴 端末に保存（つながったら送ります）', 'wait'); });
}
// 型のボタン（1回押すだけで入る）。new = 新しいメニューを作る／fill = 空のメニューに入れる
function tplChips(mode) {
  const ts = Day.templates;
  return `<div class="tpl-chips">${mode === 'new' ? '<button class="tpl-chip blank" data-act="new-blank">＋ 白紙から作る</button>' : ''}
    ${ts.map((t) => `<button class="tpl-chip" data-act="${mode}-tpl" data-t="${t.id}">📋 ${esc(t.name)}から<small>${t.items.length}つ</small></button>`).join('')}
    ${!ts.length && mode === 'new' ? '<span class="mn-empty">型はまだありません（左の「練習メニューの型」で作る・メニューを「型として保存」）</span>' : ''}</div>`;
}
function newMenu(d, { items, from_kind = '', from_id = '', title } = {}) {
  const now = isoNow();
  return { id: newId(d), date: d, title: title || (Day.menus.length ? '練習（2回目）' : '練習'), start_time: null,
    items: items ? clone(items) : [{ name: '', minutes: 10, note: '' }], from_kind, from_id, created_at: now, updated_at: now };
}
function addMenu(m) {
  if (m.date === Day.date) { Day.menus.push(m); document.activeElement?.blur?.(); renderMenus(); }
  saveLater('menus', m, 0);
}
const menuOf = (el) => { const c = el.closest('[data-menu]'); return c && Day.menus.find((m) => m.id === c.dataset.menu); };

vMenu.addEventListener('input', (e) => {
  const t = e.target, m = menuOf(t); if (!m) return;
  if (t.dataset.k) m[t.dataset.k] = t.dataset.k === 'start_time' ? (t.value || null) : t.value;
  else if (!itemInput(m.items, t)) return;
  refreshTimes(t.closest('[data-menu]'), m.items, m.start_time);
  saveLater('menus', m);
});
vMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, m = menuOf(b);
  if (act === 'ask') { $('askMsg').hidden = false; return; }
  if (act === 'new-blank') { const nm = newMenu(Day.date); addMenu(nm); setTimeout(() => vMenu.querySelector(`[data-menu="${nm.id}"] .nm`)?.focus(), 30); return; }
  if (act === 'new-tpl') { const t = Day.templates.find((x) => x.id === b.dataset.t); if (t) addMenu(newMenu(Day.date, { items: t.items, from_kind: 'template', from_id: t.id })); return; }
  if (!m) return;
  if (act === 'fill-tpl') { const t = Day.templates.find((x) => x.id === b.dataset.t); if (!t) return; m.items = clone(t.items); m.from_kind = 'template'; m.from_id = t.id; }
  else if (act === 'to-tpl') { return saveAsTemplate(m); }
  else if (act === 'del-menu') {
    if (!sure(b, '本当に消す？（もう一度押す）')) return;
    Day.menus = Day.menus.filter((x) => x !== m); clearTimeout(timers.get('menus/' + m.id)?.[0]); timers.delete('menus/' + m.id);
    Outbox.del('menus', m.id).then(() => renderList()); renderMenus(); return;
  }
  else if (!itemAct(m.items, act, +(b.closest('.mi')?.dataset.i ?? -1))) return;
  saveLater('menus', m);
  document.activeElement?.blur?.(); renderMenus();
  if (act === 'add-item') vMenu.querySelector(`[data-menu="${m.id}"] .mi:last-child .nm`)?.focus();
});

/* =========================================================
   練習メニューの型（左の一覧。開くと上に重ねて出す）
   ========================================================= */
const tov = document.createElement('div');
tov.className = 'rv-ov'; tov.hidden = true; document.body.appendChild(tov);
let TP = null;           // 開いている型（または昔の記録）
function renderTplList() {
  const box = $('tplList'); if (!box) return;
  box.innerHTML = Day.templates.length ? Day.templates.map((t) => `<button class="pg" data-tpl="${t.id}">📋 ${esc(t.name)}<small>${t.items.length}</small></button>`).join('')
    : '<div class="rv-empty">まだありません</div>';
  if (Day.view === 'menu') renderMenus();
}
function openTemplate(t) {
  TP = { kind: 'tpl', row: t };
  tov.hidden = false; document.body.classList.add('rv-open');
  tov.innerHTML = `<div class="rv glass">
    <div class="rv-head"><b>📋 練習メニューの型</b><span class="rv-save"></span><button class="ib" data-act="close" title="閉じる">✕</button></div>
    <div class="rv-body">
      <label class="tp-name">型の名前<input data-k="name" value="${esc(t.name)}" placeholder="例：いつもの火曜" maxlength="60"></label>
      <div class="mn-sub"><span class="mn-count">${t.items.length}つ・${total(t.items)}分</span><span>メニューを作る時に「型から」1回押すだけで入ります</span></div>
      <div class="mn-items">${itemsHTML(t.items, null)}</div>
      <div class="row"><button class="btn sub" data-act="add-item">＋ 足す</button></div>
      <div class="row"><button class="lnk del" data-act="del-tpl">この型を消す</button></div>
    </div>
    <div class="rv-foot"><button class="btn sub" data-act="use-tpl">${Day.date ? dlabel(Day.date) + ' に使う' : 'この日に使う'}</button><button class="btn" data-act="close">閉じる</button></div></div>`;
  if (Outbox.pending('templates', t.id)) setSt('templates', t.id, '📴 端末に保存（つながったら送ります）', 'wait');
}
function closeOv() { flushAll(); tov.hidden = true; tov.innerHTML = ''; TP = null; document.body.classList.remove('rv-open'); }
function saveAsTemplate(m) {
  const now = isoNow();
  const t = { id: tplId(), name: (m.title && m.title !== '練習' ? m.title : `${dlabel(m.date)}のメニュー`).slice(0, 60), items: clone(m.items).map((it) => ({ ...it })),
    sort: Day.templates.length, created_at: now, updated_at: now };
  Day.templates.push(t); renderTplList(); saveLater('templates', t, 0);
  openTemplate(t);
  setTimeout(() => { const i = tov.querySelector('[data-k=name]'); if (i) { i.focus(); i.select(); } }, 30);
  toast('型として保存しました。名前を変えられます');
}
tov.addEventListener('input', (e) => {
  if (!TP || TP.kind !== 'tpl') return;
  const t = TP.row, el = e.target;
  if (el.dataset.k === 'name') t.name = el.value;
  else if (!itemInput(t.items, el)) return;
  refreshTimes(tov, t.items, null);
  saveLater('templates', t);
  if (el.dataset.k === 'name') renderTplList();
});
tov.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !TP) return;
  const act = b.dataset.act;
  if (act === 'close') return closeOv();
  if (TP.kind === 'arc') return arcAct(act);
  const t = TP.row;
  if (act === 'del-tpl') {
    if (!sure(b, '本当に消す？（もう一度押す）')) return;
    Day.templates = Day.templates.filter((x) => x !== t); clearTimeout(timers.get('templates/' + t.id)?.[0]); timers.delete('templates/' + t.id);
    Outbox.del('templates', t.id); closeOv(); renderTplList(); toast('型を消しました'); return;
  }
  if (act === 'use-tpl') { closeOv(); show('menu'); addMenu(newMenu(Day.date, { items: t.items, from_kind: 'template', from_id: t.id })); toast(`「${t.name}」を${dlabel(Day.date)}のメニューに入れました`); return; }
  if (!itemAct(t.items, act, +(b.closest('.mi')?.dataset.i ?? -1))) return;
  saveLater('templates', t); renderTplList();
  const sc = tov.querySelector('.rv-body').scrollTop; openTemplate(t); tov.querySelector('.rv-body').scrollTop = sc;
  if (act === 'add-item') tov.querySelector('.mi:last-child .nm')?.focus();
});
$('tplList').addEventListener('click', (e) => { const b = e.target.closest('[data-tpl]'); if (!b) return; closeSide(); const t = Day.templates.find((x) => x.id === b.dataset.tpl); if (t) openTemplate(t); });
$('tplNew').addEventListener('click', () => {
  closeSide();
  const now = isoNow(), t = { id: tplId(), name: '新しい型', items: [{ name: '', minutes: 10, note: '' }], sort: Day.templates.length, created_at: now, updated_at: now };
  Day.templates.push(t); renderTplList(); saveLater('templates', t, 0); openTemplate(t);
  setTimeout(() => { const i = tov.querySelector('[data-k=name]'); if (i) { i.focus(); i.select(); } }, 30);
});

/* =========================================================
   📦 昔の記録（Notion から。見るだけ・さがせる。メニューの部分は今日に写せる）
   ========================================================= */
let arcRows = [];
async function renderArcList() {
  const box = $('arcList'); if (!box) return;
  arcRows = await Outbox.list('archive', 'api/archive', () => false, 'notion_id');
  box.innerHTML = arcRows.length ? arcRows.map((a) => `<button class="pg" data-arc="${esc(a.notion_id)}">📦 ${a.date ? a.date.replace(/-/g, '/').replace(/\/0/g, '/') : '日付なし'} ${esc(a.title)}<small>${a.hasMenu ? '📋' : ''}</small></button>`).join('')
    : '<div class="rv-empty">まだありません（引っ越しの道具はこれから）</div>';
}
async function openArchive(id) {
  const a = await Outbox.get('api/archive/' + encodeURIComponent(id));
  if (!a) return toast('読みこめませんでした');
  TP = { kind: 'arc', row: a };
  tov.hidden = false; document.body.classList.add('rv-open');
  const tags = Object.entries(a.props || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<span class="chip">${esc(k)}：${esc(Array.isArray(v) ? v.join('・') : v)}</span>`).join(' ');
  tov.innerHTML = `<div class="rv glass">
    <div class="rv-head"><b>📦 昔の記録</b><span class="chip">Notion から</span><span class="rv-save">見るだけ</span><button class="ib" data-act="close" title="閉じる">✕</button></div>
    <div class="rv-body"><div class="rv-sum">
      <div class="rv-sum-top">${ylabel(a.date)} ${tags}</div>
      <section><p class="big">${esc(a.title || '（題なし）')}</p></section>
      ${a.menu ? `<section><h4>📋 メニュー</h4><p class="ar-pre">${esc(a.menu)}</p></section>` : ''}
      ${a.body ? `<section><h4>📝 メモ</h4><p class="ar-pre">${esc(a.body)}</p></section>` : ''}
    </div></div>
    <div class="rv-foot">${a.menu ? '<button class="btn" data-act="arc-use">📋 このメニューを今日に使う</button>' : '<span></span>'}<button class="btn sub" data-act="close">閉じる</button></div></div>`;
}
// 昔のメニューの文 → 項目（1行 = 1つ。「15分」があれば時間に）
function menuFromText(text) {
  return String(text || '').split('\n').map((l) => l.replace(/^\s*(?:[-*・●○◦]|\d{1,2}[.)．、])\s*/, '').trim()).filter(Boolean).slice(0, 60).map((l) => {
    const mm = l.match(/(\d{1,3})\s*分/);
    return { name: (mm ? l.replace(mm[0], '') : l).replace(/[\s　・:：（(）)]+$/, '').trim().slice(0, 120) || l.slice(0, 120), minutes: mm ? Math.min(600, +mm[1]) : 0, note: '' };
  });
}
async function arcAct(act) {
  if (act !== 'arc-use') return;
  const a = TP.row, d = today();
  closeOv();
  if (state.date !== d) await openDate(d);
  await Day.loading;
  show('menu');
  addMenu(newMenu(d, { items: menuFromText(a.menu), from_kind: 'notion', from_id: a.notion_id, title: '練習' }));
  toast('昔のメニューを今日に写しました（直せます）');
}
$('arcList').addEventListener('click', (e) => { const b = e.target.closest('[data-arc]'); if (b) { closeSide(); openArchive(b.dataset.arc); } });

/* =========================================================
   iPhone の下のタブ（📅 今日・📚 記録・🔍 さがす）
   ========================================================= */
const side = $('side'), tabs = [...document.querySelectorAll('#tabbar [data-tab]')];
function markTabs() {
  const open = side.classList.contains('open');
  if (!open && side.classList.contains('only-search')) side.classList.remove('only-search');
  const cur = !open ? 'today' : side.classList.contains('only-search') ? 'search' : 'rec';
  tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
}
new MutationObserver(markTabs).observe(side, { attributes: true, attributeFilter: ['class'] });
$('tabbar').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  const t = b.dataset.tab;
  if (t === 'today') { closeSide(); if (state.date !== today()) await openDate(today()); show('menu'); return; }
  side.classList.toggle('only-search', t === 'search');
  side.classList.add('open'); $('scrim').classList.add('show');
  if (t === 'search') setTimeout(() => $('q').focus(), 60);
});

/* ---------- 起動 ---------- */
show(document.body.dataset.view || 'ink');
loadTemplates().then(() => renderMenus());
renderArcList();
reload();

window.JournalDay = Day;
window.JournalPractice = { openArchive, openTemplate: (id) => { const t = Day.templates.find((x) => x.id === id); if (t) openTemplate(t); }, ready: () => Day.loading, reload, menuFromText,
  _menus: () => Day.menus, _templates: () => Day.templates };   // _ は動作確認用
