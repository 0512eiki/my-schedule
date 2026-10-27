// 「試合の反省」の文章（秘書がチャットで聞いてノートに残したもの等）を、反省ページの形に読みかえる。
// ブラウザ（貼り付けて取り込む）と Mac の取り込みスクリプトの両方で使う。
// 書き方がゆれても読めるように、①〜⑤ の番号か、質問の言葉（よかったこと 等）で区切る。

export const QUESTIONS = [
  { key: 'where', no: '①', q: 'どの大会・どの試合？', hint: '大会名、何回戦、相手（選手はイニシャルで。例：K.T.）' },
  { key: 'good',  no: '②', q: 'よかったことは？', hint: '技・組み手・作戦・声かけ…小さなことでもOK' },
  { key: 'bad',   no: '③', q: 'うまくいかなかったことは？', hint: 'どの場面で、何が起きたか' },
  { key: 'feel',  no: '④', q: 'そのときの気持ち・体の調子は？', hint: '緊張・疲れ・痛み・集中など' },
  { key: 'fix',   no: '⑤', q: '次の練習で直すこと（3つまで）', hint: '1つずつ短く' },
];

const MARKERS = {
  where: { circ: '①', words: /(どの大会|どの試合|大会・試合|大会と試合)/ },
  good:  { circ: '②', words: /(よかった|良かった|うまくいった)/ },
  bad:   { circ: '③', words: /(うまくいかなかった|上手くいかなかった|よくなかった|悪かった|課題)/ },
  feel:  { circ: '④', words: /(気持ち|体の調子|からだの調子|コンディション)/ },
  fix:   { circ: '⑤', words: /(次の練習|直すこと|なおすこと)/ },
};
const ORDER = ['where', 'good', 'bad', 'feel', 'fix'];
const BULLET = /^\s*(?:[-*・●○◦]|\d{1,2}[.)．、]|[①-⑨]|[（(]\d[)）])\s*/;

// 1行が「質問の見出し」かどうか → {key, rest}（rest = 同じ行に書かれた答え）
function markerOf(line) {
  const s = line.replace(/^[\s#>*【\[]+/, '').replace(/\*\*/g, '');
  for (const key of ORDER) {
    const m = MARKERS[key];
    const qn = new RegExp(`^(?:Q|Ｑ|問)\\s*${ORDER.indexOf(key) + 1}\\s*[.:：)）]?`);
    let rest = null, strong = true;
    if (s.startsWith(m.circ)) rest = s.slice(1);
    else if (qn.test(s)) rest = s.replace(qn, '');
    else if (m.words.test(s)) {
      // 言葉だけの時は「見出しらしい行」に限る（答えの中の「よかった」を見出しと間違えない）
      const head = s.split(/[:：？?]/)[0];
      const looksHead = /[:：？?]/.test(s) || s.length <= 24 || /^[#【\[]/.test(line.trim());
      if (looksHead && m.words.test(head)) { rest = s; strong = false; }
    }
    if (rest === null) continue;
    // 見出しの言葉を取りのぞいて、コロンの後ろを答えにする
    const ci = rest.search(/[:：？?】\]]/);
    rest = ci >= 0 ? rest.slice(ci + 1) : (m.words.test(rest) ? '' : rest);
    return { key, strong, rest: rest.replace(/^[\s:：】\]]+/, '').trim() };
  }
  return null;
}

function findDate(text, fallback) {
  let m = text.match(/(20\d\d)\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  const pad = (n) => String(n).padStart(2, '0');
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = text.match(/(?:^|[^\d])(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return `${(fallback || '').slice(0, 4) || new Date().getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  return fallback;
}

// ①の答えから「大会」と「試合」を分ける（分けられなければ1行目を大会、残りを試合）
function splitWhere(text) {
  const lines = text.split('\n').map((l) => l.replace(BULLET, '').trim()).filter(Boolean);
  let event = '', match = '';
  for (const l of lines) {
    const ev = l.match(/^(?:大会名?|大会)\s*[:：]\s*(.+)$/), mt = l.match(/^(?:試合|対戦|相手)\s*[:：]\s*(.+)$/);
    if (ev) event = ev[1]; else if (mt) match = match ? match + '／' + mt[1] : mt[1];
  }
  if (!event && lines.length) {
    const first = lines[0];
    const i = first.search(/大会|杯|選手権|リーグ|記録会|練習試合/);
    if (i >= 0) {
      const end = first.slice(i).search(/[\s　、,（(]/);
      const cut = end >= 0 ? i + end : first.length;
      event = first.slice(0, cut).trim();
      const restFirst = first.slice(cut).replace(/^[\s　、,]+/, '');
      match = match || [restFirst, ...lines.slice(1)].filter(Boolean).join('／');
    } else { event = first; match = match || lines.slice(1).join('／'); }
  }
  return { event: event.trim(), match: match.trim() };
}

// 選手の名前らしきもの（イニシャルにしてほしい所）を見つける
export function findNameLike(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/([一-龥々]{1,4}|[ァ-ヶー]{2,8}|[ぁ-ん]{2,4})(さん|くん|君|ちゃん|選手)/g)) {
    if (!/^(選手|相手|自分|みんな|全員|先生|監督|コーチ|審判|先輩|後輩|お母|お父|親御)/.test(m[1])) out.add(m[0]);
  }
  return [...out];
}

export function emptyReview(date) {
  return { date, event: '', match: '', answers: { where: { text: '', ink: [] }, good: { text: '', ink: [] }, bad: { text: '', ink: [] }, feel: { text: '', ink: [] } }, fixes: ['', '', ''], step: 0, done: false };
}

// 文章 → 反省ページの配列（1つの文章に複数の試合があってもよい）
export function parseReviewText(text, { fallbackDate } = {}) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const fb = findDate(src, fallbackDate || new Date().toISOString().slice(0, 10));
  const reviews = [];
  let cur = null, curKey = null;
  const buf = {};
  const flush = () => {
    if (!cur) return;
    for (const k of ORDER) {
      const t = (buf[k] || []).join('\n').trim();
      if (k === 'fix') {
        const items = (buf[k] || []).map((l) => l.replace(BULLET, '').trim()).filter(Boolean);
        cur.fixes = [...items.slice(0, 3), '', '', ''].slice(0, 3);
        cur._extraFixes = items.slice(3);
      } else cur.answers[k].text = t;
    }
    const w = splitWhere(cur.answers.where.text);
    cur.event = w.event; cur.match = w.match;
    cur.date = findDate(cur.answers.where.text, fb);
    if (ORDER.some((k) => k === 'fix' ? cur.fixes.some(Boolean) : cur.answers[k].text)) reviews.push(cur);
    for (const k of ORDER) delete buf[k];
  };
  for (const raw of src.split('\n')) {
    let mk = markerOf(raw);
    // 言葉だけの見出しは、まだ出ていない・先の質問の時だけ見出しとみなす（答えの中の「よかった」等は答えのまま）
    if (mk && !mk.strong && cur && (buf[mk.key] || ORDER.indexOf(mk.key) <= ORDER.indexOf(curKey))) mk = null;
    if (mk) {
      const started = cur && ORDER.some((k) => (buf[k] || []).some((l) => l.trim()));
      if (!cur || (mk.key === 'where' && started)) { flush(); cur = emptyReview(fb); }
      curKey = mk.key; buf[curKey] = buf[curKey] || [];
      if (mk.rest) buf[curKey].push(mk.rest);
      continue;
    }
    // 反省と関係ない見出し・区切り線が来たら、そこで答えの読みこみをやめる（ノートのほかの話を混ぜない）
    if (/^\s*(#{1,4}\s|---+\s*$|===+\s*$)/.test(raw)) { curKey = null; continue; }
    if (cur && curKey) {
      buf[curKey].push(raw.replace(/^\s*>\s?/, '').trimEnd());
    }
  }
  flush();
  for (const r of reviews) {
    r.step = QUESTIONS.length; r.done = true; r.source = 'import';
    r.warnings = findNameLike([r.match, r.answers.where.text, r.answers.good.text, r.answers.bad.text, r.answers.feel.text, ...r.fixes].join('\n'));
    if (r._extraFixes?.length) r.warnings.push(`直すことが4つ以上ありました（4つ目から：${r._extraFixes.join('／')}）`);
    delete r._extraFixes;
  }
  return reviews;
}
