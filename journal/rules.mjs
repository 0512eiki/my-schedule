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
// メニューの項目 [{name, minutes, note}]（並び順のまま）
export const cleanItems = (a) => (Array.isArray(a) ? a : []).slice(0, 60).map((it) => ({
  name: clip(it && it.name, 120), minutes: Math.max(0, Math.min(600, Math.round(Number(it && it.minutes) || 0))), note: clip(it && it.note, 500) }));
export function cleanMenu(id, b, cur) {
  return { id, date: isDate(b.date) ? b.date : id.slice(0, 10), title: clip(b.title, 120),
    start_time: /^\d{2}:\d{2}$/.test(b.start_time || '') ? b.start_time : null, items: cleanItems(b.items),
    from_kind: ['', 'template', 'notion', 'page'].includes(b.from_kind) ? b.from_kind : '', from_id: clip(b.from_id, 80),
    created_at: (cur && cur.created_at) || isoOr(b.created_at, isoNow()), updated_at: isoNow() };
}
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
