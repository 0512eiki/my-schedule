// 柔道日誌：データの形をそろえる決まり（Mac の試作サーバー server.mjs と、公開版（Supabase）の cloud.js の両方で使う）
// 形と項目名は ../supabase/journal.sql の jr_pages / jr_reviews / jr_menus / jr_templates / jr_reflections と同じ
// ブラウザでも Node でも動く（ほかのファイルを読みこまない）

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isRid = (s) => /^\d{4}-\d{2}-\d{2}-[a-z0-9]{4,12}$/.test(s);   // 反省・メニュー・振り返りの id
export const isTid = (s) => /^[a-z0-9-]{4,40}$/.test(s);                     // 型の id（jr_templates と同じ決まり）
export const isNid = (s) => /^[A-Za-z0-9-]{8,64}$/.test(s);                  // Notion のページの番号
export const clip = (v, n) => String(v ?? '').slice(0, n);
export const isoNow = () => new Date().toISOString();
export const isoOr = (v, d) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : d);

// 手書きから読み取った文字（原本の線とは別に、となりに置く）
export function cleanRead(r) {
  if (!r || typeof r !== 'object') return null;
  const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : 0);
  // lines = 読み取った行と、ページの中の場所（検索で手書きの場所に飛ぶため）
  const lines = Array.isArray(r.lines) ? r.lines.slice(0, 300).map((l) => ({ t: String(l.t ?? '').slice(0, 500), x: num(l.x), y: num(l.y), w: num(l.w), h: num(l.h) })) : [];
  return { text: String(r.text ?? '').slice(0, 20000), by: String(r.by || 'mac').slice(0, 20), at: Number(r.at) || Date.now(),
    inkHash: String(r.inkHash || '').slice(0, 40), edited: !!r.edited, lines };
}
// 送られてきた反省ページを、決まった形にそろえる（変な項目は入れない）
export function cleanReview(id, b, cur) {
  const ans = {};
  for (const k of ['where', 'good', 'bad', 'feel']) {
    const a = (b.answers && b.answers[k]) || {};
    ans[k] = { text: clip(a.text, 5000), ink: Array.isArray(a.ink) ? a.ink : [], read: cleanRead(a.read) };
  }
  const fixes = (Array.isArray(b.fixes) ? b.fixes : []).slice(0, 3).map((f) => clip(f, 300));
  while (fixes.length < 3) fixes.push('');
  return {
    id, date: isDate(b.date) ? b.date : id.slice(0, 10),
    event: clip(b.event, 120), match: clip(b.match, 200), answers: ans, fixes,
    step: Math.max(0, Math.min(5, Number(b.step) || 0)), done: !!b.done,
    source: clip(b.source || (cur && cur.source) || 'app', 40), sourceHash: clip(b.sourceHash || (cur && cur.sourceHash) || '', 80),
    createdAt: (cur && cur.createdAt) || Date.now(), updatedAt: Date.now(),
  };
}
// メニューの項目 [{name, note}]（並び順のまま）。10/27 追加③：時間は書かない（本人の決まり）
// 前のデータの minutes は消さずにそのまま持つ（ある時だけ。新しく作る項目には入れない）
const mins = (v) => (v === null || v === '' ? null : Math.max(0, Math.min(600, Math.round(Number(v) || 0))));
export const cleanItems = (a) => (Array.isArray(a) ? a : []).slice(0, 60).map((it) => ({
  name: clip(it && it.name, 120), ...(it && it.minutes !== undefined ? { minutes: mins(it.minutes) } : {}), note: clip(it && it.note, 500) }));
export const FROM_KINDS = ['', 'template', 'notion', 'page', 'calendar'];
export function cleanMenu(id, b, cur) {
  const hm = (v) => (/^\d{2}:\d{2}$/.test(v || '') ? v : null);
  return { id, date: isDate(b.date) ? b.date : id.slice(0, 10), title: clip(b.title, 120),
    start_time: hm(b.start_time), end_time: hm(b.end_time), items: cleanItems(b.items),
    from_kind: FROM_KINDS.includes(b.from_kind) ? b.from_kind : '', from_id: clip(b.from_id, 80),
    created_at: (cur && cur.created_at) || isoOr(b.created_at, isoNow()), updated_at: isoNow() };
}

/* ---------- 予定（Google カレンダー）から先に作るメニュー（10/27 追加②） ----------
   本部の bridge（calendarMenus → SQL）と、試作の server.mjs（honbu/data/calendar.json）の両方で使う */
// 本部の calendar.mjs の NOT_PRACTICE と routines.mjs の JUDO と同じ（本部の作業タイムなどは練習ではない）
export const NOT_PRACTICE = /^(🏯|☕|🍙|📝)|柔道ノート|柔道日誌|judo ?note/i;
export const PRACTICE_RE = /judo|柔道|練習|クラス|class|lesson|レッスン|乱取/i;
export const isPracticeTitle = (t = '') => PRACTICE_RE.test(String(t)) && !NOT_PRACTICE.test(String(t).trim());
// 短いハッシュ（英小文字と数字7文字。同じ文字なら必ず同じ）
export function hash7(s) {
  let h = 2166136261 >>> 0;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36).padStart(7, '0').slice(-7);
}
export const eventKey = (e) => String((e && e.id) || `${e && e.title}|${e && e.start}`);
export const calendarMenuId = (date, e) => `${date}-c${hash7(eventKey(e))}`;
export const isCalId = (id) => /^\d{4}-\d{2}-\d{2}-c[a-z0-9]{7}$/.test(String(id || ''));
// その場所の時刻帯での「日付」と「時:分」（tz を渡さなければ、この機械の設定）
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
/**
 * カレンダーの予定 → 先に作っておくメニュー（items は空）
 * events: [{id, title, start, end, allDay}]（本部の calendar().events）
 * 今日（その場所の日付）から days 日後までに始まる、柔道の練習だけ。同じ予定は同じ id
 */
export function calendarRows(events, { days = 14, now = Date.now(), tz, isPractice = isPracticeTitle } = {}) {
  const today = localParts(now, tz).date, until = now + days * 864e5, out = new Map();
  for (const e of events || []) {
    if (!e || e.allDay || !isPractice(e.title || '')) continue;
    const s = Date.parse(e.start), en = Date.parse(e.end);
    if (isNaN(s) || s >= until) continue;
    const a = localParts(s, tz);
    if (a.date < today) continue;
    const id = calendarMenuId(a.date, e);
    if (!out.has(id)) out.set(id, { id, date: a.date, title: clip(String(e.title || '').trim(), 120), start_time: a.hm,
      end_time: isNaN(en) || en <= s ? null : localParts(en, tz).hm, items: [], from_kind: 'calendar', from_id: clip(eventKey(e), 80) });
  }
  return [...out.values()].sort((x, y) => (x.date + x.start_time).localeCompare(y.date + y.start_time));
}

/* ---------- 手書き（読み取った文字）→ メニューの項目（10/27 追加②・③） ----------
   1行 = 1項目（名前だけ）。行の頭の・－数字などは取る。「15分」なども名前にそのまま残す（時間は取り出さない）。空の行・見出しっぽい行は飛ばす */
const HEAD_RE = /^(?:(?:今日|本日|きょう)の)?(?:練習|稽古)?(?:メニュー|menu|内容|予定|練習|稽古)(?:\s*[(（].*[)）])?$/i;
const DATE_RE = /^(?:\d{4}[\/.年-])?\d{1,2}[\/.月-]\d{1,2}日?\s*(?:[(（]?[日月火水木金土][曜]?[日]?[)）]?)?$/;
export function menuFromLines(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    let l = raw.trim().replace(/^[①-⑳⑴-⒇⒈-⒛❶-❿]\s*/, '');                 // 丸数字は先に（NFKC で「1」になるため）
    l = l.normalize('NFKC').replace(/\s+/g, ' ').trim();
    l = l.replace(/^\d{1,2}:\d{2}(?:\s*[~〜-]\s*\d{1,2}:\d{2})?\s*/, '');           // 行の頭の時刻（19:00 など）
    l = l.replace(/^(?:[-−–—―ー~〜*•·∙‧・●○◦◯□■☐✓✔→▶>]+|\(?\d{1,2}[.)．、:：])\s*/, '').trim();
    l = l.replace(/^(?:[-−–—―*•·∙‧・●○◦]+)\s*/, '').trim();
    if (!l || /^[\p{P}\p{S}\s]+$/u.test(l)) continue;
    const bare = l.replace(/[:：]$/, '').trim();
    if (HEAD_RE.test(bare) || DATE_RE.test(bare)) continue;
    let name = l.replace(/\s+/g, ' ').replace(/[(（]\s*[)）]/g, '').replace(/^[\s:：・\-、,]+|[\s:：・\-、,（(]+$/g, '').trim();
    if (!name) continue;
    name = name.replace(/\(/g, '（').replace(/\)/g, '）');                       // かっこは日本語の形に戻す（NFKC で半角になるため）
    out.push({ name: name.slice(0, 120), note: '' });
    if (out.length >= 60) break;
  }
  return out;
}
/* 昔の記録（Notion から）の写真の印：1行に [[写真:archive/<notion_id>/<番号>.jpg]]。写真は jr-files の {本人 uid}/ の下に置いてある */
export const ARC_PHOTO_RE = /^\s*\[\[写真:(archive\/[A-Za-z0-9-]{8,64}\/\d{1,3}\.jpg)\]\]\s*$/;
// 文 → 部品の並び（{ text } か { photo: 置き場所 }）。改行はそのまま text に残す
export function arcParts(text) {
  const out = [];
  for (const l of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = l.match(ARC_PHOTO_RE);
    if (m) { out.push({ photo: m[1] }); continue; }
    const last = out[out.length - 1];
    if (last && 'text' in last) last.text += '\n' + l; else out.push({ text: l });
  }
  return out.map((p) => ('text' in p ? { text: p.text.replace(/^\n+|\n+$/g, '') } : p)).filter((p) => !('text' in p) || p.text.trim());
}
// 写真の置き場所の並び（props.images。なければ文の中の印から）
export function arcPhotos(a) {
  const im = a && a.props && Array.isArray(a.props.images) ? a.props.images.filter((p) => /^archive\/[A-Za-z0-9-]{8,64}\/\d{1,3}\.jpg$/.test(p)) : null;
  if (im && im.length) return im;
  return [...arcParts(a && a.menu), ...arcParts(a && a.body)].filter((p) => p.photo).map((p) => p.photo);
}
// 一覧に返す形（📋 メニューあり・📷 写真の枚数）
export const arcListRow = (a) => ({ notion_id: a.notion_id, date: a.date || null, title: a.title || '', hasMenu: !!String(a.menu || '').replace(/^\s*\[\[写真:[^\]]*\]\]\s*$/gm, '').trim(), photos: arcPhotos(a).length });
// 写真の印を取った文（メニューを今日に写す・さがすとき）
export const arcPlain = (t) => String(t || '').replace(/^\s*\[\[写真:[^\]]*\]\]\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

export function cleanTemplate(id, b, cur) {
  return { id, name: clip(b.name, 60).trim() || '名前のない型', items: cleanItems(b.items), sort: Math.round(Number(b.sort) || 0),
    created_at: (cur && cur.created_at) || isoOr(b.created_at, isoNow()), updated_at: isoNow() };
}
// 振り返りの status：memo（打っただけ）→ heard（声・文字を文で区切った）→ summarized（本部の秘書がまとめた）→ ok（本人が「これでOK」）
export function cleanReflection(id, b, cur) {
  const points = (Array.isArray(b.points) ? b.points : []).slice(0, 200).map((p) => ({ text: clip(p && p.text, 1000), next: !!(p && p.next) }));
  return { id, date: isDate(b.date) ? b.date : id.slice(0, 10), menu_id: isRid(b.menu_id || '') ? b.menu_id : null,
    about: b.about === 'self' ? 'self' : 'class', said: clip(b.said, 40000), audio: clip(b.audio, 300), points,
    status: ['memo', 'heard', 'summarized', 'ok'].includes(b.status) ? b.status : 'memo', name_warn: !!b.name_warn,
    created_at: (cur && cur.created_at) || isoOr(b.created_at, isoNow()), updated_at: isoNow() };
}
export const byTime = (a, b) => (a.start_time || '99').localeCompare(b.start_time || '99') || String(a.created_at).localeCompare(String(b.created_at));
// 「前回の振り返りから」：その日より前で一番新しい振り返り（生徒・メニュー、まとめ済み）の「次へ」の所だけ（本番の jr_carry_over と同じ決まり）
export function carryOver(all, d) {
  const last = all.filter((r) => r.date < d && r.about === 'class' && ['summarized', 'ok'].includes(r.status))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  return last ? { from_date: last.date, items: last.points.filter((p) => p.next && p.text.trim()).map((p) => p.text) } : { from_date: null, items: [] };
}

/* =========================================================
   10/28 追加③：記録のカレンダー・今月の重点・クラス・今週のお便り
   見本：honbu/public/mockups/journal-records-calendar.html（本人 OK 済み）
   形と項目名は ../supabase/journal.sql の「2026-10-28 追加③」（jr_classes / jr_focus / jr_letters）と同じ
   ========================================================= */
export const isCid = (s) => /^[a-z0-9-]{4,40}$/.test(String(s || ''));          // クラスの id（型と同じ決まり。例 k-mh2x1a-ab12cd）
export const isMonth = (s) => isDate(s) && String(s).slice(8) === '01';           // その月の1日
export const monthOf = (d) => String(d).slice(0, 8) + '01';
const pd = (n) => String(n).padStart(2, '0');
const ymdOf = (dt) => `${dt.getUTCFullYear()}-${pd(dt.getUTCMonth() + 1)}-${pd(dt.getUTCDate())}`;
const utc = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
export const addDaysTo = (d, n) => { const t = utc(d); t.setUTCDate(t.getUTCDate() + n); return ymdOf(t); };
export const isoDay = (d) => { const w = utc(d).getUTCDay(); return w === 0 ? 7 : w; };          // 1=月 … 7=日（jr_classes.days と同じ）
export const mondayOf = (d) => addDaysTo(d, 1 - isoDay(d));
export const isMonday = (d) => isDate(d) && isoDay(d) === 1 && ymdOf(utc(d)) === d;
export const DAY_NAMES = ['', '月', '火', '水', '木', '金', '土', '日'];
// [1,3,5] → 「月水金」（並びは月→日）
export const daysLabel = (days) => [...new Set((days || []).map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b).map((n) => DAY_NAMES[n]).join('');
// 来週の月曜〜日曜の見出し「10/26〜11/1」
export const weekLabel = (week) => { const a = utc(week), b = utc(addDaysTo(week, 6)); return `${a.getUTCMonth() + 1}/${a.getUTCDate()}〜${b.getUTCMonth() + 1}/${b.getUTCDate()}`; };

// クラス（本人が入れる：名前・曜日・始まり・終わり）
export function cleanClass(id, b, cur) {
  const hm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : null);
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((x, y) => x - y);
  const name = clip(b.name, 40).trim() || [daysLabel(days), hm(b.start_time)].filter(Boolean).join(' ') || 'クラス';
  return { id, name, days, start_time: hm(b.start_time), end_time: hm(b.end_time), sort: Math.round(Number(b.sort) || 0), is_default: !!b.is_default,
    created_at: (cur && cur.created_at) || isoOr(b.created_at, isoNow()), updated_at: isoNow() };
}
// 今月の重点（1クラス × 1か月 = 1つ）。id は「月の1日-クラスの id」（例 2026-10-01-k-mh2x1a-ab12cd）
export const focusId = (month, classId) => `${month}-${classId}`;
export function parseFocusId(id) {
  const s = String(id || ''), month = s.slice(0, 10), cls = s.slice(11);
  return isMonth(month) && s[10] === '-' && isCid(cls) ? { month, class_id: cls } : null;
}
export function cleanFocus(b) {
  return { month: b.month, class_id: b.class_id, text: clip(b.text, 300), updated_at: isoNow() };
}
// 今週のお便り（本部が作る。アプリは見るだけ）。body = {counts:{practice,reflections,ink,reviews}, did:[], good:[], focus:[], next:[]}
export function cleanLetter(l) {
  const b = (l && l.body) || {}, c = b.counts || {};
  const list = (a) => (Array.isArray(a) ? a : []).map((x) => clip(typeof x === 'string' ? x : x && x.text, 300).trim()).filter(Boolean).slice(0, 12);
  const n = (v) => Math.max(0, Math.min(99, Math.round(Number(v) || 0)));
  return { week: l && l.week, title: clip(l && l.title, 80).trim() || '今週もおつかれさまでした',
    body: { counts: { practice: n(c.practice), reflections: n(c.reflections), ink: n(c.ink), reviews: n(c.reviews) }, did: list(b.did), good: list(b.good), focus: list(b.focus), next: list(b.next) },
    made_at: (l && l.made_at) || null };
}

// 予定から入ったメニュー（from_kind='calendar'）→ どのクラスか（曜日が合い、始まりの時刻が30分以内。時刻のないクラスは、その曜日にほかの候補がない時だけ）
export function classFor(menu, classes) {
  if (!menu || menu.from_kind !== 'calendar' || !isDate(menu.date) || !Array.isArray(classes)) return null;
  const wd = isoDay(menu.date), min = (t) => (/^\d{2}:\d{2}/.test(t || '') ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
  const at = min(menu.start_time);
  const cands = classes.filter((c) => (c.days || []).includes(wd));
  let best = null, bestD = Infinity;
  for (const c of cands) {
    const s = min(c.start_time);
    if (s == null || at == null) continue;
    const d = Math.abs(s - at);
    if (d <= 30 && d < bestD) { best = c; bestD = d; }
  }
  if (best) return best;
  const loose = cands.filter((c) => min(c.start_time) == null);
  return loose.length === 1 && cands.length === 1 ? loose[0] : null;
}

// 振り返りの1行目（まとめがあればその最初の文、なければ話した言葉の最初の行）
export const reflFirst = (r) => {
  const p = (r && Array.isArray(r.points) ? r.points : []).map((x) => String((x && x.text) || '').trim()).find(Boolean);
  return clip(p || String((r && r.said) || '').trim().split(/\n|。/)[0] || '', 80).trim();
};
/**
 * 記録のカレンダー用：その間の1日ごとのまとめ（Mac の server.mjs と公開版の cloud.js で同じ）
 * pages: [{date, ink(数か true), text}]  menus: jr_menus の形  reflections: jr_reflections の形  reviews: [{id, date, event, match}]
 * → [{date, menus:[{id,title,start_time,end_time,from_kind,n,names}], refl:[{id,about,first}], ink, text, reviews:[{id,event}]}]（何かある日だけ・日付順）
 */
export function daySummary({ pages = [], menus = [], reflections = [], reviews = [] }, from, to) {
  const out = new Map(), inR = (d) => isDate(d) && d >= from && d <= to;
  const day = (d) => { if (!out.has(d)) out.set(d, { date: d, menus: [], refl: [], ink: false, text: false, reviews: [] }); return out.get(d); };
  for (const p of pages) if (inR(p.date) && (p.ink || p.text)) { const x = day(p.date); x.ink = x.ink || !!p.ink; x.text = x.text || !!String(p.text || '').trim(); }
  for (const m of [...menus].sort(byTime)) if (inR(m.date)) {
    const items = Array.isArray(m.items) ? m.items : [];
    const names = items.map((i) => String((i && i.name) || '').trim()).filter(Boolean);
    day(m.date).menus.push({ id: m.id, title: m.title || '', start_time: m.start_time ? String(m.start_time).slice(0, 5) : null, end_time: m.end_time ? String(m.end_time).slice(0, 5) : null,
      from_kind: m.from_kind || '', n: names.length, names: names.slice(0, 6).map((s) => s.slice(0, 30)) });
  }
  for (const r of reflections) if (inR(r.date)) { const f = reflFirst(r); if (f) day(r.date).refl.push({ id: r.id, about: r.about === 'self' ? 'self' : 'class', first: f }); }
  for (const v of reviews) if (inR(v.date)) day(v.date).reviews.push({ id: v.id, event: clip(v.event, 60) });
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}
