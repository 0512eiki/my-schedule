/* =========================================================
   📚 記録＝カレンダー・🎯 今月の重点・クラスの登録・📮 今週のお便り（10/28 追加③）
   見本：honbu/public/mockups/journal-records-calendar.html（本人 OK 済み）
   本人の言葉（10/28）：「見本通りに進めてください。今月の重点は詳細をタップすると各クラスの重点を見れるようにしておいて。
     デフォルトは自分で選べるように。各クラスの登録（クラスの名前と時間）は自分で入れますね。簡単に入れられるように造りもしっかりしておいてください。」
   前に決まっていること：週のプランは作らない。メニューの時間は書かない。選手の名前は入れない（イニシャル）
   ・iPhone の「📚 記録」・iPad / Mac の左の一覧の上：ふだんは月のカレンダー。「月／週」で週にも（どちらにしたかは端末に覚える）。‹ › で前後
     日の印 📋メニュー 💬振り返り ✍️手書き 🏆試合の反省、今日に枠。予定から入ってまだ項目のない練習は小さな点。日を押すとその日のページ
   ・上に「🎯 今月の重点」1行（ふだん出すクラス）。「詳細」で今月の全クラスの重点（その中で書く・直す・前後の月・ふだん出すクラスを選ぶ）
   ・クラス（名前・曜日・始まり・終わり）は本人が入れる（詳細の中の「⚙️ クラスの登録」）
   ・📮 お便りは本部が日曜に作って表に置く（ここでは見るだけ）。?letter=YYYY-MM-DD（その週の月曜）で直接開ける
   ・保存は Outbox（端末に入れてから送る）。形は ../supabase/journal.sql の jr_classes / jr_focus / jr_letters と同じ
   使っている部品（index.html 側）：$, state, openDate, today, parseD, WD, escapeHtml, toast, closeSide, hhmm, Outbox
   ========================================================= */
import { isoDay, mondayOf, addDaysTo, monthOf, daysLabel, weekLabel, classFor, focusId, isMonday, cleanLetter } from './rules.mjs';
const esc = (s) => escapeHtml(String(s ?? ''));
const isoNow = () => new Date().toISOString();
const rnd = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');
const clsId = () => `k-${Date.now().toString(36)}-${rnd()}`;
const KEY_VIEW = 'jr:recView';
const md = (d) => { const dt = parseD(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
const monthTitle = (mo) => { const [y, m] = mo.split('-').map(Number); return `${y}年${m}月`; };
const addMonths = (mo, n) => { const [y, m] = mo.split('-').map(Number); const dt = new Date(y, m - 1 + n, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`; };
const timeLabel = (c) => (c.start_time ? `${c.start_time}${c.end_time ? '〜' + c.end_time : '〜'}` : '');

export const Rec = {
  view: (() => { try { return localStorage.getItem(KEY_VIEW) === 'week' ? 'week' : 'month'; } catch { return 'month'; } })(),
  cursor: null,            // 月 = その月の1日、週 = その週の月曜
  days: new Map(),         // 日付 → まとめ（api/days）
  classes: [], focus: new Map(),   // focus: 月 → [{id, month, class_id, text}]
  letters: [],
};
const box = $('recBox');

/* ---------- 読みこみ ---------- */
function range() {
  if (Rec.view === 'week') return [Rec.cursor, addDaysTo(Rec.cursor, 6)];
  const first = Rec.cursor, last = addDaysTo(addMonths(first, 1), -1);
  return [mondayOf(first), addDaysTo(mondayOf(last), 6)];
}
const shownMonth = () => (Rec.view === 'week' ? monthOf(Rec.cursor) : Rec.cursor);
let daySeq = 0;
async function loadDays() {
  const my = ++daySeq, [from, to] = range();
  const rows = (await Outbox.get(`api/days?from=${from}&to=${to}`)) || [];
  if (my !== daySeq) return;
  const map = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.date, r]));
  overlayPending(map, from, to);
  Rec.days = map;
}
// まだ送っていないメニュー・振り返り（端末の中）も印に出す
function overlayPending(map, from, to) {
  const day = (d) => { if (!map.has(d)) map.set(d, { date: d, menus: [], refl: [], ink: false, text: false, reviews: [] }); return map.get(d); };
  for (const id of Outbox.deleted('menus')) for (const x of map.values()) x.menus = x.menus.filter((m) => m.id !== id);
  for (const m of Outbox.bodies('menus')) {
    if (!m.date || m.date < from || m.date > to) continue;
    for (const x of map.values()) x.menus = x.menus.filter((y) => y.id !== m.id);
    const names = (m.items || []).map((i) => String(i.name || '').trim()).filter(Boolean);
    day(m.date).menus.push({ id: m.id, title: m.title || '', start_time: m.start_time, end_time: m.end_time, from_kind: m.from_kind || '', n: names.length, names: names.slice(0, 6) });
  }
  for (const r of Outbox.bodies('reflections')) {
    if (!r.date || r.date < from || r.date > to) continue;
    const first = ((r.points || []).map((p) => String(p.text || '').trim()).find(Boolean) || String(r.said || '').trim().split(/\n|。/)[0] || '').slice(0, 80);
    const x = day(r.date); x.refl = x.refl.filter((y) => y.id !== r.id);
    if (first) x.refl.push({ id: r.id, about: r.about, first });
  }
}
async function loadClasses() {
  const rows = await Outbox.list('classes', 'api/classes');
  rows.sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created_at).localeCompare(String(b.created_at)));
  Rec.classes = rows;
  dispatchEvent(new CustomEvent('jr:classes', { detail: rows }));
}
async function loadFocus(mo) {
  const rows = await Outbox.list('focus', 'api/focus?month=' + mo, (b) => b.month === mo);
  Rec.focus.set(mo, rows.filter((r) => r.month === mo));
}
async function loadLetters() {
  const rows = await Outbox.get('api/letters');
  Rec.letters = Array.isArray(rows) ? rows : [];
}
let busy = null, again = false;
async function refresh() {
  if (busy) { again = true; return busy; }
  busy = (async () => {
    await Promise.all([loadDays(), loadClasses().catch(() => {}), loadFocus(shownMonth()).catch(() => {}), loadLetters().catch(() => {})]);
    render(); renderLetterList();
    if (!fov.hidden && OV.mode === 'focus') renderFocusOv();
  })();
  try { await busy; } finally { busy = null; }
  if (again) { again = false; return refresh(); }
}
let rT = 0;
const refreshSoon = () => { clearTimeout(rT); rT = setTimeout(refresh, 400); };

/* ---------- 「ふだん出す」クラス ---------- */
const defaultClass = () => Rec.classes.find((c) => c.is_default) || Rec.classes[0] || null;
const focusText = (mo, cid) => ((Rec.focus.get(mo) || []).find((f) => f.class_id === cid) || {}).text || '';

/* =========================================================
   画面（記録の上の部分）
   ========================================================= */
function render() {
  if (!box) return;
  const t = today(), mo = shownMonth(), isNow = mo === monthOf(t);
  const head = `<div class="rec-head"><b>📚 記録</b><button class="lnk" data-act="today" id="recToday">今日</button>
    <span class="seg2" role="tablist"><button data-act="view" data-v="month" class="${Rec.view === 'month' ? 'on' : ''}">月</button><button data-act="view" data-v="week" class="${Rec.view === 'week' ? 'on' : ''}">週</button></span></div>`;
  // 🎯 今月の重点（ふだんは1クラスの1行。詳細で全部）
  const dc = defaultClass(), lines = Rec.classes.map((c) => ({ c, text: focusText(mo, c.id) }));
  const any = lines.filter((l) => l.text.trim());
  let fl;
  if (!dc || !any.length) fl = `<span class="fx-add">＋ ${isNow ? '今月' : (+mo.slice(5, 7)) + '月'}の重点を書く</span>`;
  else {
    const mine = focusText(mo, dc.id).trim(), others = any.filter((l) => l.c.id !== dc.id).length;
    fl = `<span class="fx-l"><b>${esc(dc.name)}</b>：${mine ? esc(mine) : '<i>まだ書いていません</i>'}</span>${others ? `<span class="fx-more">ほか${others}つ</span>` : ''}`;
  }
  const focus = `<button class="fx" data-act="focus" id="focusLine"><span class="fx-h">🎯 ${isNow ? '今月' : (+mo.slice(5, 7)) + '月'}の重点<small>詳細 ›</small></span>${fl}</button>`;
  box.innerHTML = head + focus + (Rec.view === 'week' ? weekHTML(t) : monthHTML(t));
}
function icons(x) {
  if (!x) return { ic: '', p: false, plan: false, m: false };
  const real = x.menus.filter((m) => m.n > 0 || m.from_kind !== 'calendar');
  const plan = x.menus.some((m) => m.from_kind === 'calendar' && m.n === 0);
  const ic = (real.length ? '📋' : '') + (x.refl.length ? '💬' : '') + (x.ink ? '✍️' : '') + (x.reviews.length ? '🏆' : '');
  return { ic, p: !!ic, plan: plan && !ic, m: x.reviews.length > 0 };
}
function monthHTML(t) {
  const mo = Rec.cursor, [from, to] = range();
  let cells = '';
  for (let d = from; d <= to; d = addDaysTo(d, 1)) {
    const x = Rec.days.get(d), k = icons(x), other = d.slice(0, 8) !== mo.slice(0, 8);
    const cls = ['cd', other ? 'o' : '', k.p ? 'p' : '', k.plan ? 'plan' : '', k.m ? 'm' : '', d === t ? 't' : '', d === state.date ? 'on' : ''].filter(Boolean).join(' ');
    const ttl = `${md(d)}${k.ic ? ' ' + k.ic : ''}${k.plan ? ' 練習の予定' : ''}`;
    cells += `<button class="${cls}" data-d="${d}" title="${esc(ttl)}"><span class="n">${+d.slice(8)}</span><span class="ic">${k.ic || (k.plan ? '<i class="dot-plan">·</i>' : '')}</span></button>`;
  }
  return `<div class="cal" id="recCal"><div class="mh"><button class="ib sm" data-act="cal-prev" title="前の月">‹</button><b>${monthTitle(mo)}</b><button class="ib sm" data-act="cal-next" title="次の月">›</button></div>
    <div class="grid">${['月', '火', '水', '木', '金', '土', '日'].map((w, i) => `<span class="w${i > 4 ? ' we' : ''}">${w}</span>`).join('')}${cells}</div>
    <div class="cal-key"><span>📋メニュー</span> <span>💬振り返り</span> <span>✍️手書き</span> <span>🏆試合</span> <span><i class="dot-plan">·</i>予定</span></div></div>`;
}
function dayLines(d, x, t) {
  const out = [];
  for (const m of (x ? x.menus : [])) {
    const c = classFor({ ...m, date: d }, Rec.classes), tag = c ? `<span class="chip cls">${esc(c.name)}</span>` : '';
    if (m.n > 0) out.push(`<span class="ln">📋 ${tag}${esc(m.names.join('・'))}</span>`);
    else if (m.from_kind === 'calendar') out.push(`<span class="ln dim">${tag}（練習あり${d <= t ? '・まだ書いていない' : ''}）</span>`);
    else out.push(`<span class="ln">📋 ${tag}${esc(m.title || 'メニュー')}</span>`);
  }
  if (x) {
    const r = x.refl.find((y) => y.about === 'class') || x.refl[0];
    if (r) out.push(`<span class="ln">💬 ${esc(r.first)}</span>`);
    if (x.ink) out.push('<span class="ln">✍️ 手書き</span>');
    for (const v of x.reviews) out.push(`<span class="ln">🏆 ${esc(v.event || '試合の反省')}</span>`);
  }
  return out.length ? out.join('') : '<span class="ln dim">―</span>';
}
function weekHTML(t) {
  const w = Rec.cursor;
  let rows = '';
  for (let i = 0; i < 7; i++) {
    const d = addDaysTo(w, i), x = Rec.days.get(d);
    rows += `<button class="wd${d === t ? ' t' : ''}${d === state.date ? ' on' : ''}" data-d="${d}"><b>${+d.slice(8)} ${['月', '火', '水', '木', '金', '土', '日'][i]}</b><span class="x">${dayLines(d, x, t)}</span></button>`;
  }
  const lt = Rec.letters.find((l) => l.week === w);
  return `<div class="cal week" id="recWeek"><div class="mh"><button class="ib sm" data-act="cal-prev" title="前の週">‹</button><b>${weekLabel(w)}</b><button class="ib sm" data-act="cal-next" title="次の週">›</button></div>${rows}</div>
    ${lt ? `<button class="pg letter-btn" data-letter="${w}">📮 ${weekLabel(w)} のお便り<small>›</small></button>` : ''}`;
}

function setView(v) {
  if (v === Rec.view) return;
  const [from, to] = range(), inside = (d) => d && d >= from && d <= to;
  // 見ていた月・週の中の日（開いている日 → 今日 → 月の1日／週の木曜）を基にする
  const base = inside(state.date) ? state.date : inside(today()) ? today() : Rec.view === 'week' ? addDaysTo(Rec.cursor, 3) : Rec.cursor;
  Rec.view = v; try { localStorage.setItem(KEY_VIEW, v); } catch {}
  Rec.cursor = v === 'week' ? mondayOf(base) : monthOf(base);
  render(); refresh();
}
function move(n) {
  Rec.cursor = Rec.view === 'week' ? addDaysTo(Rec.cursor, 7 * n) : addMonths(Rec.cursor, n);
  render(); refresh();
}
if (box) box.addEventListener('click', (e) => {
  const day = e.target.closest('[data-d]');
  if (day) { openDate(day.dataset.d); return; }
  const lb = e.target.closest('[data-letter]'); if (lb) return openLetter(lb.dataset.letter);
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'view') return setView(b.dataset.v);
  if (a === 'cal-prev') return move(-1);
  if (a === 'cal-next') return move(1);
  if (a === 'today') { Rec.cursor = Rec.view === 'week' ? mondayOf(today()) : monthOf(today()); render(); refresh(); return; }
  if (a === 'focus') return openFocus(shownMonth());
});

/* =========================================================
   上に重ねる画面（🎯 今月の重点の詳細・⚙️ クラスの登録・📮 お便り）
   ========================================================= */
const fov = document.createElement('div');
fov.className = 'rv-ov rec-ov'; fov.hidden = true; document.body.appendChild(fov);
const OV = { mode: '', month: null, edit: null, letter: null };
function openOv(mode) { OV.mode = mode; fov.hidden = false; document.body.classList.add('rv-open'); }
function closeOv() { flushSaves(); fov.hidden = true; fov.innerHTML = ''; OV.mode = ''; OV.edit = null; document.body.classList.remove('rv-open'); render(); }
document.addEventListener('keydown', (e) => { if (!fov.hidden && e.key === 'Escape' && !e.isComposing) closeOv(); });
fov.addEventListener('click', (e) => { if (e.target === fov) closeOv(); });

/* ---------- 保存（少しまとめてから Outbox へ） ---------- */
const timers = new Map();
function saveLater(kind, row, ms = 600) {
  const k = kind + '/' + row.id; clearTimeout(timers.get(k)?.[0]);
  row.updated_at = isoNow();
  const go = () => { timers.delete(k); Outbox.put(kind, JSON.parse(JSON.stringify(row))).then(() => setOvSt(Outbox.pending(kind, row.id) ? '📴 端末に保存（つながったら送ります）' : '保存しました ' + hhmm(Date.now()), Outbox.pending(kind, row.id) ? 'wait' : 'ok')); };
  timers.set(k, [setTimeout(go, ms), go]);
  setOvSt('保存待ち…', '');
}
function flushSaves() { for (const [, [t, go]] of [...timers]) { clearTimeout(t); go(); } }
addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });
function setOvSt(msg, cls) { const el = fov.querySelector('.rv-save'); if (el) { el.textContent = msg; el.className = 'rv-save ' + cls; } }

/* ---------- 🎯 今月の重点（詳細） ---------- */
async function openFocus(mo) {
  OV.month = mo || monthOf(today());
  openOv('focus'); renderFocusOv();
  await Promise.all([loadClasses().catch(() => {}), loadFocus(OV.month).catch(() => {})]);
  if (OV.mode === 'focus') renderFocusOv();
}
function renderFocusOv() {
  const mo = OV.month, dc = defaultClass(), isNow = mo === monthOf(today());
  const ae = document.activeElement;
  if (ae && fov.contains(ae) && ae.matches('textarea, input')) return;   // 打っている途中は描き直さない
  const rows = Rec.classes.map((c) => `<section class="fo-row" data-c="${esc(c.id)}">
      <div class="fo-top"><b>${esc(c.name)}</b><small>${esc([daysLabel(c.days), timeLabel(c)].filter(Boolean).join(' '))}</small>
        <button class="fo-def${dc && dc.id === c.id ? ' on' : ''}" data-act="def" title="記録の上に、ふだんこのクラスの重点を出す">${dc && dc.id === c.id ? '★ ふだん出す' : '☆ ふだん出す'}</button></div>
      <textarea class="fo-tx" data-f="focus" rows="2" maxlength="300" placeholder="${isNow ? '今月' : (+mo.slice(5, 7)) + '月'}の重点（例：ケンカ四つの組み手）">${esc(focusText(mo, c.id))}</textarea>
    </section>`).join('');
  const none = `<div class="todo fo-none"><b>まずクラスを登録します</b><br>クラスの名前（例：月水金・土 −12）と曜日・時刻を入れると、クラスごとに重点を書けます。
      <div class="row"><button class="btn" data-act="cls-new">＋ クラスを足す</button></div></div>`;
  fov.innerHTML = `<div class="rv glass fo">
    <div class="rv-head"><b>🎯 クラスごとの重点</b><span class="rv-save"></span><button class="ib" data-act="close" title="閉じる">✕</button></div>
    <div class="fo-month"><button class="ib sm" data-act="m-prev" title="前の月">‹</button><b>${monthTitle(mo)}${isNow ? '<small>今月</small>' : ''}</b><button class="ib sm" data-act="m-next" title="次の月">›</button></div>
    <div class="rv-body">${Rec.classes.length ? rows + '<p class="fo-note">★ の付いたクラスの重点が、記録のいちばん上にふだん1行で出ます。書いた分は自動で保存します。</p>' : none}</div>
    <div class="rv-foot"><button class="btn sub" data-act="classes" id="clsOpen">⚙️ クラスの登録</button><button class="btn" data-act="close">閉じる</button></div></div>`;
}
function focusRow(mo, cid) {
  const list = Rec.focus.get(mo) || []; Rec.focus.set(mo, list);
  let f = list.find((x) => x.class_id === cid);
  if (!f) { f = { id: focusId(mo, cid), month: mo, class_id: cid, text: '' }; list.push(f); }
  return f;
}
async function setDefault(cid) {
  for (const c of Rec.classes) {
    const want = c.id === cid;
    if (!!c.is_default !== want) { c.is_default = want; saveLater('classes', c, 0); }
  }
  renderFocusOv(); render(); toast('記録の上に、ふだんこのクラスの重点を出します');
}

/* ---------- ⚙️ クラスの登録（名前・曜日・始まり・終わり） ---------- */
function openClasses(edit = null) { OV.edit = edit; openOv('classes'); renderClassesOv(); }
function renderClassesOv() {
  const e = OV.edit;
  const list = Rec.classes.map((c, i) => `<div class="cl-row" data-c="${esc(c.id)}">
      <div class="cl-txt"><b>${esc(c.name)}</b><small>${esc(daysLabel(c.days) || '曜日なし')}${c.start_time ? ' ・ ' + esc(timeLabel(c)) : ''}${c.is_default ? ' ・ ★ふだん出す' : ''}</small></div>
      <span class="ops"><button class="ib sm" data-act="cl-up" title="上へ" ${i === 0 ? 'disabled' : ''}>↑</button><button class="ib sm" data-act="cl-down" title="下へ" ${i === Rec.classes.length - 1 ? 'disabled' : ''}>↓</button><button class="ib sm" data-act="cl-edit" title="直す">✏️</button><button class="ib sm del" data-act="cl-del" title="消す（2回押す）">🗑</button></span>
    </div>`).join('');
  const form = e ? `<section class="cl-form" id="clForm">
      <h4>${e.id ? 'クラスを直す' : '＋ クラスを足す'}</h4>
      <label class="tp-name">クラスの名前<input data-f="name" value="${esc(e.name)}" placeholder="${esc(suggestName(e) || '例：月水金・土 −12')}" maxlength="40" autocomplete="off"></label>
      <div class="cl-lab">曜日（押して選ぶ・いくつでも）</div>
      <div class="cl-days">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button type="button" class="cl-day${e.days.includes(n) ? ' on' : ''}${n > 5 ? ' we' : ''}" data-act="cl-day" data-n="${n}" aria-pressed="${e.days.includes(n)}">${'　月火水木金土日'[n]}</button>`).join('')}</div>
      <div class="cl-time"><label>始まり<input type="time" data-f="start_time" value="${esc(e.start_time || '')}"></label><span>〜</span><label>終わり<input type="time" data-f="end_time" value="${esc(e.end_time || '')}"></label></div>
      <div class="cl-hint">時刻はなくてもOK。入れておくと、予定から入った練習のメニューにクラスの名前が付きます</div>
      <div class="row"><button class="btn" data-act="cl-save">保存</button><button class="btn sub" data-act="cl-cancel">やめる</button></div>
    </section>` : '';
  fov.innerHTML = `<div class="rv glass fo cl">
    <div class="rv-head"><b>⚙️ クラスの登録</b><span class="rv-save"></span><button class="ib" data-act="close" title="閉じる">✕</button></div>
    <div class="rv-body">${form}
      ${e && !e.id ? '' : `<div class="cl-list">${list || '<div class="rv-empty">まだクラスがありません</div>'}</div>
      ${e ? '' : '<div class="row"><button class="btn" data-act="cls-new" id="clsNew">＋ クラスを足す</button></div>'}`}
    </div>
    <div class="rv-foot"><button class="btn sub" data-act="back-focus">‹ 今月の重点へ</button><button class="btn" data-act="close">閉じる</button></div></div>`;
  if (e) setTimeout(() => { const i = fov.querySelector('#clForm [data-f=name]'); if (i && !e.id) i.focus({ preventScroll: true }); }, 30);
}
const suggestName = (e) => [daysLabel(e.days), e.start_time].filter(Boolean).join(' ');
function formRead() {
  const f = fov.querySelector('#clForm'); if (!f || !OV.edit) return;
  OV.edit.name = f.querySelector('[data-f=name]').value;
  OV.edit.start_time = f.querySelector('[data-f=start_time]').value || null;
  OV.edit.end_time = f.querySelector('[data-f=end_time]').value || null;
}
function saveClass() {
  formRead();
  const e = OV.edit, now = isoNow();
  if (!e.name.trim() && !e.days.length) { toast('クラスの名前か曜日を入れてください'); return; }
  if (e.start_time && e.end_time && e.end_time <= e.start_time) { toast('終わりは始まりより後にしてください'); return; }
  const name = e.name.trim() || suggestName(e);
  let c = e.id && Rec.classes.find((x) => x.id === e.id);
  if (c) Object.assign(c, { name, days: e.days.slice().sort((a, b) => a - b), start_time: e.start_time, end_time: e.end_time });
  else { c = { id: clsId(), name, days: e.days.slice().sort((a, b) => a - b), start_time: e.start_time, end_time: e.end_time, sort: Rec.classes.length ? Math.max(...Rec.classes.map((x) => x.sort || 0)) + 1 : 0, is_default: !Rec.classes.length, created_at: now }; Rec.classes.push(c); }
  saveLater('classes', c, 0);
  dispatchEvent(new CustomEvent('jr:classes', { detail: Rec.classes }));
  OV.edit = null; renderClassesOv(); render();
  toast(`「${name}」を保存しました`);
}
function sure(b, label) {
  if (b.dataset.sure) return true;
  b.dataset.sure = '1'; const was = b.textContent; b.textContent = label; b.classList.add('sure');
  setTimeout(() => { if (b.isConnected) { b.textContent = was; delete b.dataset.sure; b.classList.remove('sure'); } }, 3000);
  return false;
}

fov.addEventListener('input', (e) => {
  const t = e.target;
  if (OV.mode === 'focus' && t.dataset.f === 'focus') {
    const cid = t.closest('[data-c]').dataset.c, f = focusRow(OV.month, cid);
    f.text = t.value; saveLater('focus', f);
  }
  if (OV.mode === 'classes' && t.closest('#clForm')) {
    formRead();
    const n = fov.querySelector('#clForm [data-f=name]'); if (n) n.placeholder = suggestName(OV.edit) || '例：月水金・土 −12';
  }
});
fov.addEventListener('focusout', (e) => { if (e.target.matches && e.target.matches('.fo-tx')) setTimeout(render, 0); });
fov.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, row = b.closest('[data-c]'), cid = row && row.dataset.c;
  if (a === 'close') return closeOv();
  if (a === 'm-prev' || a === 'm-next') { flushSaves(); OV.month = addMonths(OV.month, a === 'm-prev' ? -1 : 1); renderFocusOv(); loadFocus(OV.month).then(() => { if (OV.mode === 'focus') renderFocusOv(); }); return; }
  if (a === 'def') return setDefault(cid);
  if (a === 'classes') { flushSaves(); return openClasses(null); }
  if (a === 'back-focus') { OV.edit = null; OV.mode = 'focus'; return renderFocusOv(); }
  if (a === 'cls-new') { if (OV.mode !== 'classes') openClasses(null); OV.edit = { id: '', name: '', days: [], start_time: null, end_time: null }; return renderClassesOv(); }
  if (a === 'cl-day') {
    formRead(); const n = +b.dataset.n, d = OV.edit.days;
    const i = d.indexOf(n); if (i >= 0) d.splice(i, 1); else d.push(n);
    b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', String(i < 0));
    const nm = fov.querySelector('#clForm [data-f=name]'); if (nm) nm.placeholder = suggestName(OV.edit) || '例：月水金・土 −12';
    return;
  }
  if (a === 'cl-save') return saveClass();
  if (a === 'cl-cancel') { OV.edit = null; return renderClassesOv(); }
  const c = cid && Rec.classes.find((x) => x.id === cid); if (!c) return;
  if (a === 'cl-edit') { OV.edit = { id: c.id, name: c.name, days: (c.days || []).slice(), start_time: c.start_time, end_time: c.end_time }; renderClassesOv(); fov.querySelector('.rv-body').scrollTop = 0; return; }
  if (a === 'cl-up' || a === 'cl-down') {
    const i = Rec.classes.indexOf(c), j = a === 'cl-up' ? i - 1 : i + 1;
    if (j < 0 || j >= Rec.classes.length) return;
    [Rec.classes[i], Rec.classes[j]] = [Rec.classes[j], Rec.classes[i]];
    Rec.classes.forEach((x, k) => { if (x.sort !== k) { x.sort = k; saveLater('classes', x, 0); } });
    renderClassesOv(); render(); dispatchEvent(new CustomEvent('jr:classes', { detail: Rec.classes })); return;
  }
  if (a === 'cl-del') {
    if (!sure(b, '消す？')) return;
    Rec.classes = Rec.classes.filter((x) => x !== c);
    clearTimeout(timers.get('classes/' + c.id)?.[0]); timers.delete('classes/' + c.id);
    Outbox.del('classes', c.id);
    if (c.is_default && Rec.classes[0]) { Rec.classes[0].is_default = true; saveLater('classes', Rec.classes[0], 0); }
    dispatchEvent(new CustomEvent('jr:classes', { detail: Rec.classes }));
    renderClassesOv(); render(); toast(`「${c.name}」を消しました`); return;
  }
});

/* ---------- 📮 今週のお便り（見るだけ） ---------- */
async function openLetter(week) {
  if (!isMonday(week)) return toast('お便りの日付がちがいます');
  OV.letter = week; openOv('letter');
  fov.innerHTML = `<div class="rv glass fo lt"><div class="rv-head"><b>📮 今週のお便り</b><span class="rv-save">${weekLabel(week)}</span><button class="ib" data-act="close" title="閉じる">✕</button></div><div class="rv-body"><div class="rv-empty">読みこみ中…</div></div></div>`;
  const raw = await Outbox.get('api/letters/' + week);
  if (OV.mode !== 'letter' || OV.letter !== week) return;
  const body = fov.querySelector('.rv-body');
  if (!raw || raw.error) { body.innerHTML = `<div class="rv-empty">${weekLabel(week)} のお便りはまだありません（本部が日曜に作ります）</div>`; return; }
  const l = cleanLetter(raw), c = l.body.counts;
  const ul = (a) => `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const num = [['練習', c.practice], ['振り返り', c.reflections], ['手書き', c.ink], ...(c.reviews ? [['試合の反省', c.reviews]] : [])];
  body.innerHTML = `<article class="letter">
    <h3>${esc(l.title)}</h3><div class="sub">柔道日誌から自動で作りました（名前はイニシャル）</div>
    <div class="num">${num.map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('')}</div>
    ${l.body.did.length ? `<h5>🥋 今週やったこと</h5>${ul(l.body.did)}` : ''}
    ${l.body.good.length ? `<h5>😀 よかったこと</h5>${ul(l.body.good)}` : ''}
    ${l.body.focus.length ? `<h5>🎯 今月の重点との関係</h5>${ul(l.body.focus)}` : ''}
    ${l.body.next.length ? `<div class="next"><b>➡️ 来週へ</b>：${l.body.next.map(esc).join(' ／ ')}</div>` : ''}
  </article>`;
}
function renderLetterList() {
  const el = $('letterList'); if (!el) return;
  el.innerHTML = Rec.letters.length ? Rec.letters.map((l) => `<button class="pg" data-letter="${esc(l.week)}">📮 ${weekLabel(l.week)} のお便り<small>${l.counts && l.counts.practice ? '練習' + l.counts.practice : ''}</small></button>`).join('')
    : '<div class="rv-empty">まだありません（本部が日曜に作ります）</div>';
  const cnt = document.querySelector('[data-fold=letters] .fold-n'); if (cnt) cnt.textContent = Rec.letters.length ? String(Rec.letters.length) : '';
}
$('letterList')?.addEventListener('click', (e) => { const b = e.target.closest('[data-letter]'); if (b) openLetter(b.dataset.letter); });

/* ---------- たたんだ一覧（開いたかどうかを覚える） ---------- */
for (const d of document.querySelectorAll('details.fold')) {
  try { d.open = localStorage.getItem('jr:fold:' + d.dataset.fold) === '1'; } catch {}
  d.addEventListener('toggle', () => { try { localStorage.setItem('jr:fold:' + d.dataset.fold, d.open ? '1' : '0'); } catch {} });
}

/* ---------- 起動 ---------- */
Rec.cursor = Rec.view === 'week' ? mondayOf(state.date || today()) : monthOf(state.date || today());
render();
addEventListener('jr:date', (e) => {
  // 開いた日が見ている月・週の外なら、そこへ動かす
  const d = e.detail, [from, to] = Rec.view === 'week' ? [Rec.cursor, addDaysTo(Rec.cursor, 6)] : [Rec.cursor, addDaysTo(addMonths(Rec.cursor, 1), -1)];
  if (d < from || d > to) Rec.cursor = Rec.view === 'week' ? mondayOf(d) : monthOf(d);
  render(); refreshSoon();
});
addEventListener('jr:changed', refreshSoon);
Outbox.on(() => refreshSoon());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshSoon(); });
refresh();
// 通知から開く：?letter=2026-10-26（その週の月曜）
{
  const q = new URLSearchParams(location.search), w = q.get('letter');
  if (w) {
    q.delete('letter');
    try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch {}
    openLetter(w);
  }
}

window.JournalRecords = { Rec, refresh, setView, move, openFocus, openClasses, openLetter, close: closeOv, classFor: (m) => classFor(m, Rec.classes), ready: () => busy || Promise.resolve() };
