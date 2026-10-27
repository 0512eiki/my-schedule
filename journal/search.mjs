// 日誌全体の検索（ふつうの日誌・試合の反省・練習メニュー・振り返り・昔の記録）。手書きから読み取った文字も探す。
// ・全角/半角、カタカナ/ひらがな、大文字/小文字、空白の違いは気にせず探す
// ・言葉を空白で区切ると「全部ふくむもの」を探す
// 結果には「どこに飛べばよいか」（日付・反省の質問・手書きの行の場所）を入れる

const KANA = /[ァ-ヶ]/g;
// 1文字ずつそろえて、元の文字の位置も覚えておく（見つけた所の前後を、元の文字で見せるため）
export function normMap(src) {
  let out = ''; const map = [];
  const s = String(src ?? '');
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (/\s/.test(c)) continue;
    // 半角カナの濁点・半濁点（ﾞﾟ）は前の字とまとめてから直す（ﾋﾞ → ビ）
    if (/[\uff9e\uff9f]/.test(s[i + 1] || '')) { c += s[i + 1]; i++; }
    c = c.normalize('NFKC').toLowerCase().replace(KANA, (k) => String.fromCharCode(k.charCodeAt(0) - 0x60));
    for (const ch of c) { out += ch; map.push(c.length > 1 && /[\uff9e\uff9f]/.test(c[1]) ? i - 1 : i); }
  }
  return { out, map };
}
export const norm = (s) => normMap(s).out;
export function terms(q) { return String(q ?? '').split(/[\s　]+/).map(norm).filter(Boolean).slice(0, 6); }

function snippet(text, idx, len) {
  const s = String(text);
  const a = Math.max(0, idx - 18), b = Math.min(s.length, idx + len + 30);
  return { pre: (a > 0 ? '…' : '') + s.slice(a, idx), hit: s.slice(idx, idx + len), post: s.slice(idx + len, b) + (b < s.length ? '…' : '') };
}
// text の中で最初の term の場所（元の文字の位置）
function findIn(text, ts) {
  const { out, map } = normMap(text);
  for (const t of ts) {
    const i = out.indexOf(t);
    if (i >= 0) { const st = map[i], en = map[i + t.length - 1] + 1; return snippet(text, st, en - st); }
  }
  return null;
}
// 手書きの行（読み取った時の場所つき）の中から、言葉がある行を探す
function findLine(read, ts) {
  const lines = (read && Array.isArray(read.lines)) ? read.lines : [];
  for (const l of lines) { const n = norm(l.t); if (ts.some((t) => n.includes(t))) return l; }
  // 本人が文字を直していて行と合わない時は、いちばん近そうな行（言葉の1文字目を多くふくむ行）
  let best = null, score = 0;
  for (const l of lines) { const n = norm(l.t); const sc = ts.reduce((a, t) => a + [...t].filter((ch) => n.includes(ch)).length, 0); if (sc > score) { score = sc; best = l; } }
  return best;
}

const QLABEL = { where: '① 大会・試合', good: '② よかったこと', bad: '③ うまくいかなかったこと', feel: '④ 気持ち・体の調子', fix: '⑤ 直すこと' };
const STEP = { where: 0, good: 1, bad: 2, feel: 3, fix: 4 };

// pages: 日誌のページの配列、reviews: 試合の反省の配列 → 見つかったものの配列（新しい日付から）
// menus / reflections / archive（10/27 追加）：練習メニュー・振り返り・昔の記録（Notion から）
export function search(q, pages, reviews, { limit = 60, menus = [], reflections = [], archive = [] } = {}) {
  const ts = terms(q);
  if (!ts.length) return [];
  const hits = [];
  const allIn = (parts) => { const n = norm(parts.join('\n')); return ts.every((t) => n.includes(t)); };

  for (const pg of pages) {
    const fields = [
      { field: 'title', label: '見出し', text: pg.title },
      { field: 'read', label: '🔤 手書き', text: pg.read?.text },
      { field: 'text', label: '📝 文字のメモ', text: pg.text },
    ].filter((f) => f.text);
    if (!fields.length || !allIn(fields.map((f) => f.text))) continue;
    for (const f of fields) {
      const sn = findIn(f.text, ts); if (!sn) continue;
      const line = f.field === 'read' ? findLine(pg.read, ts) : null;
      hits.push({ kind: 'page', date: pg.date, title: pg.title || '', field: f.field, label: f.label, ...sn,
        box: line ? { x: line.x, y: line.y, w: line.w, h: line.h } : null });
    }
  }
  for (const r of reviews) {
    const a = r.answers || {};
    const fields = [
      { q: 'where', field: 'event', label: '大会', text: r.event },
      { q: 'where', field: 'match', label: '試合', text: r.match },
      ...['where', 'good', 'bad', 'feel'].flatMap((k) => [
        { q: k, field: 'text', label: `${QLABEL[k]}・📝`, text: a[k]?.text },
        { q: k, field: 'read', label: `${QLABEL[k]}・🔤 手書き`, text: a[k]?.read?.text, read: a[k]?.read },
      ]),
      ...(r.fixes || []).map((f, i) => ({ q: 'fix', field: 'fix' + i, label: `${QLABEL.fix} ${i + 1}`, text: f })),
    ].filter((f) => f.text);
    if (!fields.length || !allIn(fields.map((f) => f.text))) continue;
    for (const f of fields) {
      const sn = findIn(f.text, ts); if (!sn) continue;
      const line = f.field === 'read' ? findLine(f.read, ts) : null;
      hits.push({ kind: 'review', id: r.id, date: r.date, event: r.event || '', match: r.match || '', q: f.q, step: STEP[f.q], field: f.field, label: f.label, ...sn,
        box: line ? { x: line.x, y: line.y, w: line.w, h: line.h } : null });
    }
  }
  // 練習メニュー（名前・項目・項目のメモ）
  for (const m of menus) {
    const fields = [
      { field: 'title', label: '📋 メニューの名前', text: m.title },
      ...(m.items || []).map((it, i) => ({ field: 'item' + i, label: `📋 メニュー ${i + 1}つ目`, text: [it.name, it.note].filter(Boolean).join('・') })),
    ].filter((f) => f.text);
    if (!fields.length || !allIn(fields.map((f) => f.text))) continue;
    for (const f of fields) {
      const sn = findIn(f.text, ts); if (!sn) continue;
      hits.push({ kind: 'menu', id: m.id, date: m.date, title: m.title || '', field: f.field, label: f.label, ...sn, box: null });
    }
  }
  // 振り返り（まとめの文。まとめで見つからない時だけ、話した言葉そのもの）
  for (const r of reflections) {
    const pts = (r.points || []).map((p, i) => ({ field: 'pt' + i, label: `💬 まとめ${p.next ? '（次へ）' : ''}`, text: p.text })).filter((f) => f.text);
    if (!allIn([r.said || '', ...pts.map((f) => f.text)])) continue;
    let fields = pts.filter((f) => findIn(f.text, ts));
    if (!fields.length && r.said) fields = [{ field: 'said', label: '💬 話した言葉', text: r.said }];
    for (const f of fields) {
      const sn = findIn(f.text, ts); if (!sn) continue;
      hits.push({ kind: 'refl', id: r.id, date: r.date, about: r.about, title: '', field: f.field, label: f.label, ...sn, box: null });
    }
  }
  // 昔の記録（Notion から。題・メニュー・残りの文）
  for (const a of archive) {
    const fields = [
      { field: 'title', label: '📦 題', text: a.title },
      { field: 'menu', label: '📦 メニュー', text: a.menu },
      { field: 'body', label: '📦 メモ', text: a.body },
    ].filter((f) => f.text);
    if (!fields.length || !allIn(fields.map((f) => f.text))) continue;
    for (const f of fields) {
      const sn = findIn(f.text, ts); if (!sn) continue;
      hits.push({ kind: 'archive', id: a.notion_id, date: a.date || '', title: a.title || '', field: f.field, label: f.label, ...sn, box: null });
    }
  }
  const ORD = { page: 0, menu: 1, refl: 2, review: 3, archive: 4 };
  hits.sort((x, y) => (y.date || '').localeCompare(x.date || '') || ORD[x.kind] - ORD[y.kind]);
  return hits.slice(0, limit);
}
