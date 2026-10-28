/* =========================================================
   練習メニュー・メニューの型・昔の記録（Notion から）
   ・その日のページの上で「📋 メニュー／✍️ 手書き／💬 振り返り」を切りかえる（画面は増やさない）
   ・メニューは本人が作る（1回の練習 = 1つ。1日に2つも作れる）。型・昔の記録から1回押すだけで入る
   ・秘書のメニューの案は出さない（本人の決まり：困った時だけ聞く）
   ・上に「🔁 前回の振り返りから」（その日より前の一番新しい振り返りの「次へ」の所だけ。メニューは勝手に変えない）
   ・iPhone は下にタブ3つ（今日・記録・さがす）
   ・保存はすべて Outbox（端末に入れてから送る）。形は ../supabase/journal.sql の jr_menus / jr_templates / jr_archive と同じ
   ・10/27 追加②：予定（カレンダー）から本部が先に作ったメニュー（from_kind='calendar'）は「📅 予定から 20:00〜23:00」と出すだけ
     （「時刻を直す」で今まで通りの入力欄。時刻か題を直すと from_kind='' になり、もう予定には合わせない）
   ・10/27 追加②：「✍️ 手書きからメニューにする」…その日の手書きを読み取った文字を、1行＝1項目にして後ろに一度で足す（「戻す」あり）
   ・10/27 追加③（本人「それぞれのメニューに対する時間は必要ない。記録したいのはメニュー」）：項目は名前とメモだけ。分の欄・各項目の時刻・合計の分は出さない
     （前のデータの minutes は消さずにそのまま持つ。新しく作る項目には入れない）
   ・10/28 追加③：予定から入ったメニュー（from_kind='calendar'）の曜日・時刻が、本人の入れたクラスに合えば、題の横に小さくクラスの名前（records.js から jr:classes で受け取る）
   ・10/28 追加④（本人「どのクラスに対しての練習メニューかを選べるように。選べたら自動的に時間も」・見本 honbu/public/mockups/journal-menu-class.html・A＝クラスの登録から）
     メニューの上に「どのクラス？」：その曜日のクラス（＋ほかのクラス…）。押すと class_id・題・始まり・終わりが入る（rules.mjs の pickClass）。
     予定から入って、まだ選んでいないメニューは、時間が近いクラスに「予定に近い」の印だけ（勝手には決めない）。2つ目のメニューは残りのクラスを先に選ぶ
   使っている部品（index.html 側）：$, state, openDate, today, parseD, WD, hhmm, escapeHtml, toast, closeSide, renderList, layout, Outbox, pageRead
   ========================================================= */
import { menuFromLines, isCalId, arcParts, arcPhotos, arcPlain, classFor, classesOn, minutesBetween, pickClass, monthOf } from './rules.mjs';
const CLOUD = !!(window.JR && window.JR.cloud);
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
   メニューの項目（メニューと型で同じ部品）。名前とメモだけ（時間は書かない）
   ========================================================= */
function itemsHTML(items) {
  if (!items.length) return '<div class="mn-empty">まだ項目がありません。「＋ 足す」で入れます</div>';
  return items.map((it, i) => `<div class="mi" data-i="${i}">
    <input class="nm" data-f="name" value="${esc(it.name)}" placeholder="例：打ち込み（背負い）" maxlength="120">
    <input type="hidden" class="note" data-f="note" value="${esc(it.note)}">
    <button type="button" class="note-btn${it.note ? '' : ' empty'}">${it.note ? esc(it.note) : 'メモ（なくてもOK）'}</button>
    <span class="ops"><button class="ib sm" data-act="up" title="上へ" ${i === 0 ? 'disabled' : ''}>↑</button><button class="ib sm" data-act="down" title="下へ" ${i === items.length - 1 ? 'disabled' : ''}>↓</button><button class="ib sm" data-act="rm" title="この項目を消す">✕</button></span>
  </div>`).join('');
}
const count = (items) => `${items.length}つ`;
// 項目の入力 → 中身を直す（並びは変えないので、描き直さない）
function itemInput(items, t) {
  const row = t.closest('.mi'); if (!row || !t.dataset.f) return false;
  const it = items[+row.dataset.i]; if (!it) return false;
  if (t.dataset.f !== 'name' && t.dataset.f !== 'note') return false;
  it[t.dataset.f] = t.value;
  if (t.dataset.f === 'note') showNote(row.querySelector('.note-btn'), t.value);
  return true;
}
// メモは押すと大きな入力画面が出る（全文が見える・10/27 本人の希望）。一覧では全文を折り返して出す
function showNote(b, v) {
  if (!b) return;
  b.textContent = v || 'メモ（なくてもOK）'; b.classList.toggle('empty', !v);
}
const nov = document.createElement('div');
nov.className = 'rv-ov note-ov'; nov.hidden = true;
nov.innerHTML = '<div class="note-pop"><div class="note-head"><b class="note-ttl"></b><button type="button" class="btn note-done">完了</button></div><textarea class="note-tx" maxlength="500" placeholder="メモ（なくてもOK）"></textarea></div>';
document.body.appendChild(nov);
const ntx = nov.querySelector('.note-tx');
let noteIn = null;   // いま直しているメモ（項目の hidden の欄）
let composing = false;   // 日本語の変換の途中（この間は保存しない。途中で触ると変換の候補が出ずにひらがなで確定してしまう）
// iPhone のキーボードが出ても、入力画面が見えている所にぴったり入るように
const vv = window.visualViewport;
function fitNote() {
  if (nov.hidden) return;
  nov.style.top = (vv ? vv.offsetTop : 0) + 'px';
  nov.style.height = (vv ? vv.height : innerHeight) + 'px';
}
if (vv) { vv.addEventListener('resize', fitNote); vv.addEventListener('scroll', fitNote); }
function pushNote() {
  if (!noteIn || noteIn.value === ntx.value) return;
  noteIn.value = ntx.value; noteIn.dispatchEvent(new Event('input', { bubbles: true }));
}
function openNote(b) {
  const row = b.closest('.mi'); noteIn = row.querySelector('input.note');
  nov.querySelector('.note-ttl').textContent = (row.querySelector('.nm').value || '').trim() || 'メモ';
  ntx.value = noteIn.value; nov.hidden = false; fitNote();
  ntx.focus({ preventScroll: true }); ntx.setSelectionRange(ntx.value.length, ntx.value.length);
}
function closeNote() { composing = false; pushNote(); nov.hidden = true; noteIn = null; ntx.blur(); }
// 打つたびに項目へ（いつもの保存の流れにのせる）。変換の途中は待って、決まってから
ntx.addEventListener('compositionstart', () => { composing = true; });
ntx.addEventListener('compositionend', () => { composing = false; pushNote(); });
ntx.addEventListener('input', (e) => { if (composing || e.isComposing) return; pushNote(); });
ntx.addEventListener('blur', () => { if (!composing) pushNote(); });
nov.querySelector('.note-done').addEventListener('click', closeNote);
nov.addEventListener('click', (e) => { if (e.target === nov) closeNote(); });
document.addEventListener('keydown', (e) => { if (!nov.hidden && e.key === 'Escape' && !e.isComposing) closeNote(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.mi .note-btn'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); openNote(b);
}, true);
// 足す・消す・並べかえ → true なら描き直す
function itemAct(items, act, i) {
  if (act === 'add-item') { items.push({ name: '', note: '' }); return true; }
  if (act === 'up' && i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; return true; }
  if (act === 'down' && i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; return true; }
  if (act === 'rm') { items.splice(i, 1); return true; }
  return false;
}
function refreshCount(box, items) {
  const sub = box.querySelector('.mn-count'); if (sub) sub.textContent = count(items);
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
let classes = [];
addEventListener('jr:classes', (e) => {
  const next = Array.isArray(e.detail) ? e.detail : [], key = (a) => JSON.stringify(a.map((c) => [c.id, c.name, c.days, c.start_time, c.end_time]));
  if (key(next) === key(classes)) return;            // 変わっていなければ描き直さない（メモを打っている途中などに消えないように）
  classes = next.map((c) => ({ ...c })); if (Day.view === 'menu') renderMenus();
});
const fromLabel = (m) => fromLabel0(m);   // クラスは上の「どのクラス？」に出す
// どのクラス？（10/28 追加④）
const others = new Set();                 // 「ほかのクラス…」を開いているメニュー
const clsTime = (c) => (c.start_time ? `${c.start_time}${c.end_time ? '〜' + c.end_time : ''}` : '時間なし');
function classHTML(m) {
  if (!classes.length) return `<div class="mn-cls"><button class="lnk" data-act="cls-setup">⚙️ クラスを登録すると、ここで選べます（時間も自動で入ります）</button></div>`;
  const on = m.class_id ? classes.find((c) => c.id === m.class_id) || null : null;
  const guess = on ? null : classFor(m, classes);
  const day = classesOn(m.date, classes), open = others.has(m.id);
  let list = open ? classes.slice() : day.slice();
  for (const c of [guess, on]) if (c && !list.includes(c)) list.unshift(c);
  const chip = (c) => `<button class="cls-ch${c === on ? ' on' : ''}${c === guess ? ' sug' : ''}" data-act="cls-pick" data-c="${esc(c.id)}">${c === on ? '✓ ' : ''}${esc(c.name)}${c === guess ? '<span class="cls-badge">予定に近い</span>' : ''}<i>${esc(clsTime(c))}</i></button>`;
  const more = open ? '<button class="cls-ch ghost" data-act="cls-setup">⚙️ クラスの登録</button>'
    : (classes.some((c) => !list.includes(c)) ? '<button class="cls-ch ghost" data-act="cls-more">ほかのクラス…</button>' : '');
  const none = on || (m.class_id && !on) ? '<button class="cls-ch ghost" data-act="cls-pick" data-c="">なし</button>' : '';
  const wd = WD[parseD(m.date).getDay()];
  const sub = on ? '押すと変えられる' : (day.length ? `${wd}曜のクラス` : `${wd}曜のクラスはありません`);
  const fo = on && window.JournalRecords && JournalRecords.focusOf ? String(JournalRecords.focusOf(monthOf(m.date), on.id) || '').trim() : '';
  return `<div class="mn-cls"><div class="mn-cls-h">どのクラス？<small>${sub}</small></div><div class="cls-chips">${list.map(chip).join('')}${more}${none}</div>
    ${fo ? `<div class="mn-focus">🎯 今月の重点：${esc(fo)}</div>` : ''}</div>`;
}
// 2つ目からのメニュー：ほかのメニューでクラスを選んでいれば、その曜日の残りのクラスを先に選んでおく
function withNextClass(nm) {
  if (!Day.menus.some((x) => x.class_id)) return nm;
  const rest = classesOn(nm.date, classes).filter((c) => !Day.menus.some((x) => x.class_id === c.id));
  return rest.length ? pickClass(nm, rest[0]) : nm;
}
function fromLabel0(m) {
  if (m.from_kind === 'template') { const t = Day.templates.find((x) => x.id === m.from_id); return `<span class="chip">型「${esc(t ? t.name : '…')}」から</span>`; }
  if (m.from_kind === 'notion') return '<span class="chip">昔の記録（Notion）から</span>';
  if (m.from_kind === 'page') return '<span class="chip">✍️ 手書きから</span>';
  if (!m.from_kind && isCalId(m.id) && !m.class_id) return '<span class="chip">📅 予定から（手で直したので予定とは別）</span>';
  return '';
}
// 開始時刻：予定から入っている時は表示だけ（「時刻を直す」で入力欄）
const fixing = new Set();
const isCal = (m) => m.from_kind === 'calendar' && !!m.start_time;
function atHTML(m) {
  if ((isCal(m) || (m.class_id && m.start_time)) && !fixing.has(m.id)) {
    const n = minutesBetween(m.start_time, m.end_time);
    return `<div class="mn-at cal"><span class="mn-cal">${isCal(m) ? '📅 予定から' : '🕒'} ${esc(m.start_time)}${m.end_time ? '〜' + esc(m.end_time) : ''}${n ? `<small>・${n}分</small>` : ''}</span><button class="lnk" data-act="fix-time">時刻を直す</button></div>`;
  }
  return `<div class="mn-at-row"><label class="mn-at">開始<input type="time" data-k="start_time" value="${esc(m.start_time || '')}"></label><label class="mn-at">終わり<input type="time" data-k="end_time" value="${esc(m.end_time || '')}"></label></div>`;
}
function renderMenus() {
  const d = Day.date; if (!d) return;
  const ae = document.activeElement;
  if (ae && vMenu.contains(ae) && ae.matches('input, textarea')) return;   // 打っている途中は描き直さない（文字が消えないように）
  if (!nov.hidden) return;                 // メモの大きな入力画面を開いている間も描き直さない
  const co = carry.items.length ? `<div class="todo" id="carry"><b>🔁 前回の振り返りから（${dlabel(carry.from_date)}）</b>
      <ul>${carry.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><small>「次へ」の印をつけた所だけ。メニューは自分で決めます（勝手には変えません）</small></div>` : '';
  const cards = Day.menus.map((m) => `<section class="card glass mn" data-menu="${m.id}">
      ${classHTML(m)}
      <div class="mn-head">
        <input class="mn-title" data-k="title" value="${esc(m.title)}" placeholder="練習の名前（例：練習・小学生クラス）" maxlength="120">
        ${atHTML(m)}
      </div>
      <div class="mn-sub"><span class="mn-count">${count(m.items)}</span>${fromLabel(m)}<span class="mn-st"></span></div>
      <div class="mn-items">${itemsHTML(m.items)}</div>
      ${m.items.length ? '' : tplChips('fill')}
      <div class="row"><button class="btn sub" data-act="add-item">＋ 足す</button><button class="btn sub" data-act="from-ink">✍️ 手書きからメニューにする</button><button class="btn sub" data-act="to-tpl">📋 型として保存</button><button class="lnk del" data-act="del-menu">このメニューを消す</button></div>
    </section>`).join('');
  const create = `<section class="card glass mn-new">
      <h3>${Day.menus.length ? '＋ もう1つメニューを作る <span>1日に2回の練習など</span>' : '📋 この日のメニューはまだありません'}</h3>
      ${tplChips('new')}
      ${Day.menus.length ? '' : '<div class="tpl-chips"><button class="tpl-chip" data-act="new-from-ink">✍️ 手書きからメニューにする</button></div>'}
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
  return { id: newId(d), date: d, title: title || (Day.menus.length ? '練習（2回目）' : '練習'), start_time: null, end_time: null,
    items: items ? clone(items) : [{ name: '', note: '' }], from_kind, from_id, class_id: '', created_at: now, updated_at: now };
}
function addMenu(m) {
  if (m.date === Day.date) { Day.menus.push(m); document.activeElement?.blur?.(); renderMenus(); }
  saveLater('menus', m, 0);
}
const menuOf = (el) => { const c = el.closest('[data-menu]'); return c && Day.menus.find((m) => m.id === c.dataset.menu); };

vMenu.addEventListener('input', (e) => {
  const t = e.target, m = menuOf(t); if (!m) return;
  if (t.dataset.k) {
    m[t.dataset.k] = /_time$/.test(t.dataset.k) ? (t.value || null) : t.value;
    // 予定から入ったメニューの時刻・題を本人が直した → もう予定には合わせない（本部の calendarMenus は from_kind='calendar' の行だけ直す）
    if (m.from_kind === 'calendar') { m.from_kind = ''; fixing.delete(m.id); }
  }
  else if (!itemInput(m.items, t)) return;
  refreshCount(t.closest('[data-menu]'), m.items);
  saveLater('menus', m);
});
vMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, m = menuOf(b);
  if (act === 'ask') { $('askMsg').hidden = false; return; }
  if (act === 'cls-setup') { window.JournalRecords?.openClasses(); return; }
  if (act === 'new-blank') { const nm = withNextClass(newMenu(Day.date)); addMenu(nm); setTimeout(() => vMenu.querySelector(`[data-menu="${nm.id}"] .nm`)?.focus(), 30); return; }
  if (act === 'new-tpl') { const t = Day.templates.find((x) => x.id === b.dataset.t); if (t) addMenu(withNextClass(newMenu(Day.date, { items: t.items, from_kind: 'template', from_id: t.id }))); return; }
  if (act === 'new-from-ink') return fromInk(null, b);
  if (!m) return;
  if (act === 'from-ink') return fromInk(m, b);
  if (act === 'cls-more') { others.add(m.id); document.activeElement?.blur?.(); renderMenus(); return; }
  if (act === 'cls-pick') {
    const c = classes.find((x) => x.id === b.dataset.c) || null, prev = classes.find((x) => x.id === m.class_id) || null;
    Object.assign(m, pickClass(m, c, prev)); others.delete(m.id); fixing.delete(m.id);
    Day.menus.sort((a, b2) => (a.start_time || '99').localeCompare(b2.start_time || '99') || String(a.created_at).localeCompare(String(b2.created_at)));
    saveLater('menus', m, 0); document.activeElement?.blur?.(); renderMenus(); return;
  }
  if (act === 'fix-time') { fixing.add(m.id); document.activeElement?.blur?.(); renderMenus(); setTimeout(() => vMenu.querySelector(`[data-menu="${m.id}"] [data-k=start_time]`)?.focus(), 30); return; }
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
   ✍️ 手書き → メニュー（ボタンひとつ）
   ・その日の手書きを読み取った文字（本人が直した文字ならそれ）を、1行＝1項目にして、今のメニューの後ろに一度で足す
   ・まだ文字になっていない時：試作はその場で読む（reader.js）。公開版は本部の Mac が読むのを待つ
   ========================================================= */
async function inkText() {
  const pg = state.page;
  if (!pg || pg.date !== Day.date) return { none: true };
  const r = pg.read, ink = pg.ink || [], has = (x) => !!(x && String(x.text || '').trim());
  if (r && r.edited && has(r)) return { text: r.text };                  // 本人が直した文字
  if (!ink.length) return has(r) ? { text: r.text } : { none: true };
  if (has(r) && !pageRead.stale()) return { text: r.text };
  if (CLOUD) return { wait: true };
  await pageRead.run(false);                                              // 試作：その場で読む（この Mac の中だけ）
  const r2 = state.page.read;
  if (has(r2) && !pageRead.stale()) return { text: r2.text };
  return r2 && !pageRead.stale() ? { empty: true } : { fail: true };
}
let inkBusy = false;
async function fromInk(m, btn) {
  if (inkBusy) return;
  inkBusy = true; const was = btn.textContent; btn.disabled = true; btn.textContent = '✍️ 読み取り中…';
  let got;
  try { got = await inkText(); } finally { inkBusy = false; btn.disabled = false; btn.textContent = was; }
  if (got.none) return bar('この日の手書きがまだありません（✍️ 手書き で書いてから押します）');
  if (got.wait) return bar('まだ文字になっていません（本部の Mac が数分で読み取ります）');
  if (got.fail) return bar('読み取りできませんでした（✍️ 手書き の「読み直す」のあとで、もう一度）');
  const items = menuFromLines(got.text || '');
  if (!items.length) return bar('手書きの中に、メニューにできる行がありませんでした');
  if (!m) {
    const nm = newMenu(Day.date, { items, from_kind: 'page', from_id: Day.date });
    addMenu(nm);
    return bar(`手書きから ${items.length}つ入れました`, () => {
      Day.menus = Day.menus.filter((x) => x !== nm); clearTimeout(timers.get('menus/' + nm.id)?.[0]); timers.delete('menus/' + nm.id);
      Outbox.del('menus', nm.id).then(() => renderList()); renderMenus();
    });
  }
  const before = clone(m.items);
  const blank = m.items.every((it) => !String(it.name || '').trim() && !String(it.note || '').trim());   // 白紙の項目だけなら、置きかえる
  m.items = (blank ? [] : m.items).concat(items);
  saveLater('menus', m, 0); document.activeElement?.blur?.(); renderMenus();
  bar(`手書きから ${items.length}つ足しました`, () => { m.items = before; saveLater('menus', m, 0); renderMenus(); });
}
// 下に数秒だけ出す知らせ（「戻す」つき）
const undoBar = document.createElement('div');
undoBar.className = 'undo-bar'; undoBar.hidden = true; undoBar.innerHTML = '<span></span><button class="lnk" type="button">戻す</button>';
document.body.appendChild(undoBar);
let undoFn = null, undoT = 0;
function bar(msg, undo) {
  undoBar.querySelector('span').textContent = msg;
  undoBar.querySelector('button').hidden = !undo; undoFn = undo || null;
  undoBar.hidden = false; clearTimeout(undoT);
  undoT = setTimeout(() => { undoBar.hidden = true; undoFn = null; }, undo ? 6000 : 5000);
}
undoBar.querySelector('button').addEventListener('click', () => { const f = undoFn; undoFn = null; undoBar.hidden = true; clearTimeout(undoT); if (f) { f(); toast('戻しました'); } });

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
      <div class="mn-sub"><span class="mn-count">${count(t.items)}</span><span>メニューを作る時に「型から」1回押すだけで入ります</span></div>
      <div class="mn-items">${itemsHTML(t.items)}</div>
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
  refreshCount(tov, t.items);
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
  const now = isoNow(), t = { id: tplId(), name: '新しい型', items: [{ name: '', note: '' }], sort: Day.templates.length, created_at: now, updated_at: now };
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
  box.innerHTML = arcRows.length ? arcRows.map((a) => `<button class="pg" data-arc="${esc(a.notion_id)}">📦 ${a.date ? a.date.replace(/-/g, '/').replace(/\/0/g, '/') : '日付なし'} ${esc(a.title)}<small>${a.photos ? '📷' : ''}${a.hasMenu ? '📋' : ''}</small></button>`).join('')
    : '<div class="rv-empty">まだありません（引っ越しの道具はこれから）</div>';
}
async function openArchive(id) {
  const a = await Outbox.get('api/archive/' + encodeURIComponent(id));
  if (!a) return toast('読みこめませんでした');
  TP = { kind: 'arc', row: a };
  tov.hidden = false; document.body.classList.add('rv-open');
  // 上には日付と「練習メニュー」くらい（Notion の項目名は出さない）。写真の印のところに写真を出す
  const kind = a.props && typeof a.props.kind === 'string' && a.props.kind ? `<span class="chip">${esc(a.props.kind)}</span>` : '';
  const nPh = arcPhotos(a).length;
  const block = (t) => arcParts(t).map((p) => p.photo
    ? (CLOUD ? `<button class="ar-ph" data-ph="${esc(p.photo)}" title="押すと大きく見られます"><span class="ar-ph-wait">📷 写真を読みこみ中…</span></button>`
      : '<div class="ar-ph ar-ph-none">📷 写真（公開版で見られます）</div>')
    : `<p class="ar-pre">${esc(p.text)}</p>`).join('');
  tov.innerHTML = `<div class="rv glass">
    <div class="rv-head"><b>📦 昔の記録</b><span class="chip">Notion から</span><span class="rv-save">見るだけ</span><button class="ib" data-act="close" title="閉じる">✕</button></div>
    <div class="rv-body"><div class="rv-sum">
      <div class="rv-sum-top">${ylabel(a.date)} ${kind}${nPh ? ` <span class="chip">📷 ${nPh}枚</span>` : ''}</div>
      <section><p class="big">${esc(a.title || '（題なし）')}</p></section>
      ${a.menu ? `<section><h4>📋 メニュー</h4>${block(a.menu)}</section>` : ''}
      ${a.body ? `<section><h4>📝 メモ</h4>${block(a.body)}</section>` : ''}
    </div></div>
    <div class="rv-foot">${arcPlain(a.menu) ? '<button class="btn" data-act="arc-use">📋 このメニューを今日に使う</button>' : '<span></span>'}<button class="btn sub" data-act="close">閉じる</button></div></div>`;
  if (CLOUD) loadArcPhotos(tov);
}
// 写真：jr-files の鍵つきの棚から、1時間だけ見られる URL を作って出す（本人の {uid}/ の下）
async function loadArcPhotos(box) {
  let uid = '';
  try { uid = (await window.JR.ready()).uid; } catch {}
  for (const b of box.querySelectorAll('.ar-ph[data-ph]')) {
    try {
      const url = await window.JR.files.url(`${uid}/${b.dataset.ph}`, 3600);
      // loading='lazy' にしない（画面に出す前に読みこみを待つので、lazy だといつまでも読まれない）
      const img = new Image(); img.alt = '写真'; img.decoding = 'async';
      img.onload = () => { b.replaceChildren(img); b.dataset.url = url; };
      img.onerror = () => { b.innerHTML = '<span class="ar-ph-wait">📷 写真を読みこめませんでした</span>'; };
      img.src = url;
    } catch { b.innerHTML = '<span class="ar-ph-wait">📷 写真を読みこめませんでした（電波を確かめてください）</span>'; }
  }
}
// 押すと大きく見る（押すか ✕ で閉じる）
// 10/28 本人「写真は2本指で拡大できてほしい。ダブルタップのズームだけ無くして」→ 画面全体は固定のまま、写真だけを2本指で拡大・1本指で動かす
function showPhoto(url) {
  const v = document.createElement('div'); v.className = 'ph-view'; v.setAttribute('role', 'dialog');
  v.innerHTML = `<img alt="写真" src="${esc(url)}"><button class="ib" title="閉じる">✕</button>`;
  const img = v.querySelector('img');
  let sc = 1, x = 0, y = 0, start = null, moved = false;
  const put = () => { img.style.transform = `translate(${x}px,${y}px) scale(${sc})`; };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  v.addEventListener('touchstart', (e) => {
    const t = e.touches;
    if (t.length === 2) { moved = true; start = { d: dist(t), m: mid(t), sc, x, y }; }
    else if (t.length === 1) start = { p: { x: t[0].clientX, y: t[0].clientY }, x, y };
  }, { passive: true });
  v.addEventListener('touchmove', (e) => {
    const t = e.touches; if (!start) return;
    e.preventDefault();
    if (t.length === 2 && start.d) {
      const k = Math.min(6, Math.max(1, start.sc * dist(t) / start.d)), m = mid(t);
      x = start.x + (m.x - start.m.x); y = start.y + (m.y - start.m.y); sc = k; put();
    } else if (t.length === 1 && start.p) {
      const dx = t[0].clientX - start.p.x, dy = t[0].clientY - start.p.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
      if (sc > 1) { x = start.x + dx; y = start.y + dy; put(); }
    }
  }, { passive: false });
  v.addEventListener('touchend', (e) => {
    if (e.touches.length === 1) start = { p: { x: e.touches[0].clientX, y: e.touches[0].clientY }, x, y };
    else if (!e.touches.length) { start = null; if (sc <= 1.02) { sc = 1; x = 0; y = 0; put(); } }
  });
  // 押しただけ（動かしていない）なら閉じる。拡大・移動のあとの指を離した時は閉じない
  v.addEventListener('click', (e) => { if (moved && !e.target.closest('.ib')) { moved = false; return; } v.remove(); });
  document.body.appendChild(v);
}
tov.addEventListener('click', (e) => { const b = e.target.closest('.ar-ph[data-url]'); if (b) { e.stopPropagation(); showPhoto(b.dataset.url); } });
// 昔のメニューの文 → 項目（1行 = 1つ。名前だけ。「15分」なども名前にそのまま残す）
function menuFromText(text) {
  return arcPlain(text).split('\n').map((l) => l.replace(/^\s*(?:[-*・●○◦]|\d{1,2}[.)．、])\s*/, '').trim()).filter(Boolean).slice(0, 60)
    .map((l) => ({ name: l.slice(0, 120), note: '' }));
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
  if (t === 'rec') { renderArcList(); window.JournalRecords?.refresh(); }   // 昔の記録・カレンダーは開くたびに読み直す（アプリを開いたあとで入った分も出す）
});

/* ---------- 起動 ---------- */
show(document.body.dataset.view || 'ink');
loadTemplates().then(() => renderMenus());
renderArcList();
reload();

window.JournalDay = Day;
window.JournalPractice = { openArchive, showPhoto, fromInk: (i = 0) => fromInk(Day.menus[i] || null, document.createElement('button')), openTemplate: (id) => { const t = Day.templates.find((x) => x.id === id); if (t) openTemplate(t); }, ready: () => Day.loading, reload, menuFromText,
  _menus: () => Day.menus, _templates: () => Day.templates };   // _ は動作確認用
