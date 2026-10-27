/* =========================================================
   試合の反省（型）
   ・質問が1つずつ出る → 手書き・声・文字で答える → 「次へ」で次の質問
   ・答えは1枚のまとめになり、左の一覧から大会ごとに見返せる
   ・秘書のノートなどの文章を「貼り付けて取り込む」こともできる
   使っている部品（index.html 側）：$, toast, strokePath, r1, r2, escapeHtml, parseD, WD, today, hhmm
   ========================================================= */
import { QUESTIONS, parseReviewText, findNameLike, emptyReview } from './review-parse.mjs';

const RW = 1000, RH = 520;                  // 答えの手書き欄の大きさ（ページ座標）
const Api = {
  async list() { const r = await JR.fetch('api/reviews'); if (!r.ok) throw new Error(r.status); return r.json(); },
  async get(id) { const r = await JR.fetch('api/reviews/' + id); if (!r.ok) throw new Error(r.status); return r.json(); },
  async put(id, body) { const r = await JR.fetch('api/reviews/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.status); return r.json(); },
};
const newId = (date) => `${date}-${Math.random().toString(36).slice(2, 8)}`;
const esc = (s) => escapeHtml(String(s ?? ''));
const dlabel = (d) => { const dt = parseD(d); return `${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）`; };
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/* ---------- 小さな手書き欄（ペン・マウスで書く／指は書かない） ---------- */
class Pad {
  constructor(wrap, ink, { readOnly = false, onChange } = {}) {
    this.wrap = wrap; this.ink = ink; this.readOnly = readOnly; this.onChange = onChange;
    this.undo = []; this.tool = 'pen'; this.cur = null;
    this.c = document.createElement('canvas'); this.x = this.c.getContext('2d');
    wrap.appendChild(this.c);
    this.layout();
    if (readOnly) return;
    const c = this.c;
    c.addEventListener('pointerdown', (e) => {
      if (!(e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.button === 0))) return;
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      const [x, y] = this.pt(e);
      if (this.tool === 'eraser') { this.cur = { id: e.pointerId, erase: true, before: this.ink.slice(), hit: false }; this.eraseAt(x, y); return; }
      this.cur = { id: e.pointerId, s: { t: 'pen', c: '#16181f', w: 3.4, p: [r1(x), r1(y), r2(this.pr(e))] } };
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.cur || e.pointerId !== this.cur.id) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = this.pt(ev);
        if (this.cur.erase) { this.eraseAt(x, y); continue; }
        const p = this.cur.s.p, lx = p[p.length - 3], ly = p[p.length - 2];
        if ((x - lx) ** 2 + (y - ly) ** 2 < 0.6) continue;
        p.push(r1(x), r1(y), r2(this.pr(ev)));
      }
      if (!this.cur.erase) this.draw(this.cur.s);
    });
    const end = (e) => {
      if (!this.cur || e.pointerId !== this.cur.id) return;
      const cur = this.cur; this.cur = null;
      if (cur.erase) { if (cur.hit) { this.undo.push(cur.before); this.onChange?.(); } return; }
      this.undo.push(this.ink.slice()); this.ink.push(cur.s); this.render(); this.onChange?.();
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('touchstart', (e) => { if ([...e.touches].some((t) => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
    c.addEventListener('touchmove', (e) => { if (this.cur || [...e.touches].some((t) => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
  }
  pr(e) { return e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5; }
  pt(e) { const r = this.c.getBoundingClientRect(); return [(e.clientX - r.left) / this.s, (e.clientY - r.top) / this.s]; }
  layout() {
    const w = this.wrap.clientWidth || 600, dpr = Math.min(devicePixelRatio || 1, 3);
    this.s = w / RW; const h = Math.round(RH * this.s);
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
    this.x.setTransform(dpr * this.s, 0, 0, dpr * this.s, 0, 0);
    this.render();
  }
  render() {
    const x = this.x; x.clearRect(0, 0, RW, RH);
    x.fillStyle = '#fffdf8'; x.fillRect(0, 0, RW, RH);
    x.strokeStyle = 'rgba(53,82,212,.12)'; x.lineWidth = 1.2;
    for (let y = 70; y < RH - 10; y += 52) { x.beginPath(); x.moveTo(30, y); x.lineTo(RW - 30, y); x.stroke(); }
    for (const s of this.ink) strokePath(x, s);
  }
  draw(s) { this.render(); strokePath(this.x, s); }
  eraseAt(x, y) {
    let hit = false;
    for (let i = this.ink.length - 1; i >= 0; i--) {
      const p = this.ink[i].p;
      for (let j = 0; j < p.length; j += 3) if ((p[j] - x) ** 2 + (p[j + 1] - y) ** 2 < 16 * 16) { this.ink.splice(i, 1); hit = true; break; }
    }
    if (hit) { this.cur.hit = true; this.render(); }
  }
  // 検索から来た時：手書きの行のまわりを光らせる（線そのものは変えない）
  flash(b) {
    const pad = 14; let n = 0;
    const tick = () => {
      if (this.cur) return;
      this.render();
      if (n >= 8) return;
      if (n % 2 === 0) { const x = this.x; x.save(); x.fillStyle = 'rgba(255,214,0,.28)'; x.strokeStyle = 'rgba(230,150,0,.95)'; x.lineWidth = 4;
        x.beginPath(); x.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 12); x.fill(); x.stroke(); x.restore(); }
      n++; setTimeout(tick, n === 1 ? 900 : 350);
    };
    tick();
  }
  back() { if (!this.undo.length) return; const prev = this.undo.pop(); this.ink.length = 0; this.ink.push(...prev); this.render(); this.onChange?.(); }
}

/* ---------- 画面 ---------- */
const ov = document.createElement('div');
ov.className = 'rv-ov'; ov.hidden = true;
document.body.appendChild(ov);
let R = null;          // いま開いている反省ページ
let pad = null, readBox = null, saveT = 0, saving = Promise.resolve();
const STEPS = QUESTIONS.length;   // 0..4 = 質問、5 = まとめ

function close() { flushSave(); ov.hidden = true; ov.innerHTML = ''; R = null; pad = null; document.body.classList.remove('rv-open'); renderReviewList(); }
function status(msg, kind = '') { const el = ov.querySelector('.rv-save'); if (el) { el.textContent = msg; el.className = 'rv-save ' + kind; } }
function scheduleSave() { clearTimeout(saveT); status('保存待ち…'); saveT = setTimeout(doSave, 600); }
// 保存は、まず端末に入れてから送る（outbox.js）。つながらない時は、つながったら自動で送る
function doSave() {
  clearTimeout(saveT); if (!R) return saving;
  const body = JSON.parse(JSON.stringify(R));
  saving = saving.then(() => Outbox.put('reviews', body)).then(() => saved(body.id)).catch(() => { status('保存できません（あとでもう一度）', 'err'); });
  return saving;
}
function saved(id) {
  if (!R || R.id !== id) return;
  if (Outbox.pending('reviews', id)) status('📴 端末に保存（つながったら送ります）', 'wait');
  else status('保存しました ' + hhmm(Date.now()), 'ok');
}
Outbox.on((it) => { if (it.kind === 'reviews' && it.op === 'put') { if (!saveT) saved(it.id); if (ov.hidden) renderReviewList(); } });
function flushSave() { if (saveT) { clearTimeout(saveT); saveT = 0; doSave(); } }

function nameWarn() {
  if (!R) return '';
  const readTx = ['where', 'good', 'bad', 'feel'].map((k) => R.answers[k].read?.text || '');
  const hits = findNameLike([R.match, R.answers.where.text, R.answers.good.text, R.answers.bad.text, R.answers.feel.text, ...R.fixes, ...readTx].join('\n'));
  return hits.length ? `⚠️ 名前はイニシャルに（例：K.T.）：${hits.map(esc).join('、')}` : '';
}

function render() {
  const step = R.step;
  const dots = QUESTIONS.map((q, i) => `<button class="rv-dot ${i === step ? 'on' : ''} ${isAnswered(i) ? 'done' : ''}" data-go="${i}" title="${esc(q.q)}">${q.no}</button>`).join('')
    + `<button class="rv-dot ${step === STEPS ? 'on' : ''}" data-go="${STEPS}" title="まとめ">✓</button>`;
  let body = '';
  if (step < STEPS) {
    const q = QUESTIONS[step];
    body = `<div class="rv-q"><span>${q.no}</span>${esc(q.q)}</div><div class="rv-hint">${esc(q.hint)}</div>`;
    if (q.key === 'where') {
      body += `<div class="rv-fields">
        <label>大会<input data-f="event" value="${esc(R.event)}" placeholder="例：秋季県大会"></label>
        <label>試合<input data-f="match" value="${esc(R.match)}" placeholder="例：個人戦2回戦（K.T.）"></label>
        <label class="d">日付<input type="date" data-f="date" value="${esc(R.date)}"></label></div>`;
    }
    if (q.key === 'fix') {
      body += `<div class="rv-fixes">${R.fixes.map((f, i) => `<label><b>${i + 1}</b><input data-fix="${i}" value="${esc(f)}" placeholder="${['例：えび・逆えびを毎日10分', '例：組み手の左手', '例：試合前のアップ'][i]}"></label>`).join('')}</div>`;
    } else {
      body += `<textarea class="rv-text" data-a="${q.key}" rows="3" placeholder="${q.key === 'where' ? 'ほかに書いておくこと（なくてもOK）' : '文字で書く・🎙で話す・下に手書き'}">${esc(R.answers[q.key].text)}</textarea>
        <div class="rv-padbar"><span>✒️ 手書き（Pencil）</span><button class="ib sm" data-pt="pen" title="ペン">✒️</button><button class="ib sm" data-pt="eraser" title="消しゴム">🧽</button><button class="ib sm" data-pt="back" title="戻す">↶</button></div>
        <div class="rv-pad"></div><div class="rv-read"></div>`;
    }
  } else {
    body = summaryHTML(R, true);
  }
  ov.innerHTML = `<div class="rv glass">
    <div class="rv-head"><b>🏆 試合の反省</b><span class="rv-step">${step < STEPS ? `${step + 1} / ${STEPS}` : 'まとめ'}</span><span class="rv-save"></span><button class="ib" data-act="close" title="閉じる">✕</button></div>
    <div class="rv-dots">${dots}</div>
    <div class="rv-body">${body}<div class="rv-warn">${nameWarn()}</div></div>
    <div class="rv-foot">
      <button class="btn sub" data-act="prev" ${step === 0 ? 'disabled' : ''}>‹ 戻る</button>
      ${step < STEPS ? `<button class="btn sub" data-act="voice">🎙 声で答える</button>` : ''}
      ${step < STEPS - 1 ? `<button class="btn" data-act="next">次へ ›</button>` : step === STEPS - 1 ? `<button class="btn" data-act="next">まとめを見る ›</button>` : `<button class="btn" data-act="done">保存して閉じる</button>`}
    </div></div>`;
  const pw = ov.querySelector('.rv-pad');
  if (pw) {
    const key = QUESTIONS[step].key;
    const ans = R.answers[key];
    readBox = new Reader.Box(ov.querySelector('.rv-read'), {
      getInk: () => ans.ink, getRead: () => ans.read, W: RW, H: RH, compact: true,
      setRead: (r) => { ans.read = r; scheduleSave(); markDots(); if (R && R.step === STEPS && R.answers[key] === ans) render(); },
    });
    pad = new Pad(pw, ans.ink, { onChange: () => { scheduleSave(); markDots(); readBox.inkChanged(); } });
    if (ans.ink.length && readBox.stale() && !(ans.read && ans.read.edited)) readBox.inkChanged();
    if (!matchMedia('(max-width:760px)').matches) {} // スマホでも Pencil がなければ書けないだけ（指では書かない）
  } else pad = null;
  ov.querySelectorAll('.rv-sum canvas[data-k]').forEach((c) => drawThumb(c, R.answers[c.dataset.k].ink));
  const first = ov.querySelector('.rv-text, .rv-fields input, .rv-fixes input');
  if (first && !matchMedia('(pointer:coarse)').matches) first.focus({ preventScroll: true });
}
function isAnswered(i) {
  const k = QUESTIONS[i].key;
  if (k === 'fix') return R.fixes.some((f) => f.trim());
  if (k === 'where' && (R.event || R.match)) return true;
  return !!(R.answers[k].text.trim() || R.answers[k].ink.length);
}
function markDots() { ov.querySelectorAll('.rv-dot[data-go]').forEach((d) => { const i = +d.dataset.go; if (i < STEPS) d.classList.toggle('done', isAnswered(i)); }); const w = ov.querySelector('.rv-warn'); if (w) w.innerHTML = nameWarn(); }
function go(step) {
  // 読み取り待ちの手書きがあれば、次へ進む前にすぐ読む（まとめに文字が出るように）
  if (readBox && readBox.t && readBox.stale()) readBox.run(false);
  flushSave(); R.step = Math.max(0, Math.min(STEPS, step)); scheduleSave(); render(); ov.querySelector('.rv-body')?.scrollTo(0, 0); }

function drawThumb(c, ink) {
  // まとめでは、書いてある所の上下だけを切り出して小さく見せる（1枚に収める）
  let y0 = RH, y1 = 0;
  for (const st of ink) for (let i = 1; i < st.p.length; i += 3) { y0 = Math.min(y0, st.p[i]); y1 = Math.max(y1, st.p[i]); }
  y0 = Math.max(0, y0 - 30); y1 = Math.min(RH, Math.max(y1 + 30, y0 + 120));
  const w = c.clientWidth || 300, dpr = Math.min(devicePixelRatio || 1, 2), s = w / RW, hh = y1 - y0;
  c.width = Math.round(w * dpr); c.height = Math.round(hh * s * dpr); c.style.height = Math.round(hh * s) + 'px';
  const x = c.getContext('2d'); x.setTransform(dpr * s, 0, 0, dpr * s, 0, -y0 * dpr * s);
  x.fillStyle = '#fffdf8'; x.fillRect(0, y0, RW, hh);
  for (const st of ink) strokePath(x, st);
}
// 1枚のまとめ
function summaryHTML(r, editable) {
  const sec = (i) => {
    const q = QUESTIONS[i], a = r.answers[q.key];
    if (q.key === 'fix') {
      const fx = r.fixes.filter((f) => f.trim());
      return `<section><h4>${q.no} 次の練習で直すこと ${editable ? `<button class="lnk" data-go="${i}">直す</button>` : ''}</h4>${fx.length ? `<ol>${fx.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>` : '<p class="nil">まだ書いていません</p>'}</section>`;
    }
    const txt = a.text.trim();
    return `<section><h4>${q.no} ${esc(q.q.replace(/[？?]$/, ''))} ${editable ? `<button class="lnk" data-go="${i}">直す</button>` : ''}</h4>
      ${q.key === 'where' ? `<p class="big">${esc(r.event || '（大会名なし）')}　${esc(r.match)}</p>` : ''}
      ${txt ? `<p>${esc(txt).replace(/\n/g, '<br>')}</p>` : (a.ink.length || q.key === 'where' ? '' : '<p class="nil">まだ書いていません</p>')}
      ${a.ink.length ? `<canvas data-k="${q.key}"></canvas>${a.read?.text ? `<div class="rv-readtx">🔤 ${esc(a.read.text)}</div>` : '<div class="rv-readtx">🔤（まだ読み取っていません）</div>'}` : ''}</section>`;
  };
  return `<div class="rv-sum"><div class="rv-sum-top">${dlabel(r.date)}　${r.source === 'import' ? '<span class="chip">チャットから取り込み</span>' : ''}</div>${QUESTIONS.map((_, i) => sec(i)).join('')}</div>`;
}

/* ---------- 入力 ---------- */
ov.addEventListener('input', (e) => {
  if (!R) return;
  const t = e.target;
  if (t.dataset.f) R[t.dataset.f] = t.value;
  else if (t.dataset.fix !== undefined) R.fixes[+t.dataset.fix] = t.value;
  else if (t.dataset.a) R.answers[t.dataset.a].text = t.value;
  scheduleSave(); markDots();
});
// 声で入った文字も同じように保存する（voice.js が input イベントを出す）
ov.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act],[data-go],[data-pt]'); if (!b || !R) return;
  if (b.dataset.go !== undefined) return go(+b.dataset.go);
  if (b.dataset.pt) {
    if (!pad) return;
    if (b.dataset.pt === 'back') return pad.back();
    pad.tool = b.dataset.pt; ov.querySelectorAll('[data-pt=pen],[data-pt=eraser]').forEach((x) => x.classList.toggle('on', x === b)); return;
  }
  const act = b.dataset.act;
  if (act === 'close') close();
  if (act === 'prev') go(R.step - 1);
  if (act === 'next') go(R.step + 1);
  if (act === 'done') { R.done = true; doSave().then(close); }
});
// 🎙 は指を置いた瞬間に始める（voice.js と同じ理由）。答えを入れる先は、いま選んでいる欄
let lastField = null;
ov.addEventListener('focusin', (e) => { if (e.target.matches('textarea, input:not([type=date])')) lastField = e.target; });
ov.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-act=voice]'); if (!b || !R) return;
  e.preventDefault();
  let target = lastField && ov.contains(lastField) ? lastField : ov.querySelector('.rv-text, .rv-fixes input:placeholder-shown, .rv-fixes input, .rv-fields input');
  window.JournalVoice?.open(target, { label: QUESTIONS[R.step]?.q });
});

async function openReview(id, opts = {}) {
  if (R) close();
  try { R = Outbox.peek('reviews', id) || await Api.get(id); } catch { return toast('読みこめませんでした'); }
  if (Number.isInteger(opts.step)) R.step = opts.step;   // 検索から来た時は、見つかった質問を開く
  else if (R.done) R.step = STEPS;                         // 書き終わったものは、まとめから開く
  ov.hidden = false; document.body.classList.add('rv-open'); render();
  if (opts.box && pad) { ov.querySelector('.rv-pad')?.scrollIntoView({ block: 'center' }); setTimeout(() => pad && pad.flash(opts.box), 200); window.__lastFlash = { ...opts.box, at: Date.now(), review: true }; }
  else if (opts.q) {
    // 文字の欄で見つかった時：その欄を光らせる
    const el = ov.querySelector('.rv-text, .rv-fields input, .rv-fixes input');
    const all = [...ov.querySelectorAll('.rv-text, .rv-fields input, .rv-fixes input')];
    const hit = all.find((e) => e.value.includes(opts.q)) || el;
    if (hit) { hit.scrollIntoView({ block: 'center' }); hit.classList.add('flash'); }
  }
}
function newReview() {
  const d = (typeof state !== 'undefined' && state.date) || today();
  R = { ...emptyReview(d), id: newId(d), source: 'app' };
  ov.hidden = false; document.body.classList.add('rv-open'); render(); scheduleSave();
}

/* ---------- 貼り付けて取り込む ---------- */
function openImport() {
  ov.hidden = false; document.body.classList.add('rv-open');
  ov.innerHTML = `<div class="rv glass">
    <div class="rv-head"><b>📥 試合の反省を取り込む</b><span class="rv-save"></span><button class="ib" data-imp="close" title="閉じる">✕</button></div>
    <div class="rv-body">
      <div class="rv-hint">秘書のノートなどに残した反省（①〜⑤）を、ここに貼り付けてください。試合が2つ以上あっても分けて読みます。選手の名前はイニシャルで。</div>
      <textarea class="rv-text" id="impText" rows="10" placeholder="①どの大会・どの試合か：秋季県大会 個人戦2回戦（K.T.）&#10;②よかったこと：…&#10;③うまくいかなかったこと：…&#10;④そのときの気持ち・体の調子：…&#10;⑤次の練習で直すこと：&#10;1. …"></textarea>
      <div id="impPrev"></div>
    </div>
    <div class="rv-foot"><button class="btn sub" data-imp="read">読みこむ</button><button class="btn" data-imp="save" disabled>取り込む</button></div></div>`;
  let parsed = [];
  ov.onclick = async (e) => {
    const b = e.target.closest('[data-imp]'); if (!b) return;
    if (b.dataset.imp === 'close') { ov.onclick = null; close(); return; }
    if (b.dataset.imp === 'read') {
      parsed = parseReviewText(ov.querySelector('#impText').value, { fallbackDate: (typeof state !== 'undefined' && state.date) || today() });
      let have = []; try { have = await Api.list(); } catch {}
      for (const r of parsed) { r.sourceHash = hash(JSON.stringify([r.date, r.event, r.match, r.answers, r.fixes])); r._dup = have.some((h) => h.sourceHash === r.sourceHash); }
      ov.querySelector('#impPrev').innerHTML = parsed.length ? parsed.map((r, i) => `<label class="imp-card"><input type="checkbox" data-i="${i}" ${r._dup || r.warnings.some((w) => !w.startsWith('直すこと')) ? '' : 'checked'}>
        <div><b>${esc(r.event || '（大会名なし）')}</b>　${esc(r.match)}　<small>${dlabel(r.date)}</small><br>
        <small>②${r.answers.good.text ? '✓' : '―'} ③${r.answers.bad.text ? '✓' : '―'} ④${r.answers.feel.text ? '✓' : '―'} ⑤直すこと ${r.fixes.filter(Boolean).length}つ</small>
        ${r._dup ? '<div class="rv-warn">もう取り込み済みです</div>' : ''}${r.warnings.map((w) => `<div class="rv-warn">⚠️ ${esc(w)}</div>`).join('')}</div></label>`).join('')
        : '<div class="rv-warn">①〜⑤ が見つかりませんでした。「①どの大会…」「②よかったこと…」のような見出しがあると読めます。</div>';
      ov.querySelector('[data-imp=save]').disabled = !parsed.length;
      return;
    }
    if (b.dataset.imp === 'save') {
      const picks = [...ov.querySelectorAll('#impPrev input:checked')].map((x) => parsed[+x.dataset.i]);
      if (!picks.length) return toast('取り込むものを選んでください');
      let n = 0;
      for (const r of picks) { const { warnings, _dup, ...body } = r; try { await Api.put(newId(r.date), body); n++; } catch {} }
      ov.onclick = null; close(); toast(`${n} 試合ぶん取り込みました`);
    }
  };
}

/* ---------- 左の一覧（大会ごと） ---------- */
async function renderReviewList() {
  const box = document.getElementById('rvList'); if (!box) return;
  const list = await Outbox.list('reviews', 'api/reviews');   // 読めない時は前の分＋まだ送っていない分
  list.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (!list.length) { box.innerHTML = '<div class="rv-empty">まだありません</div>'; return; }
  const groups = new Map();
  for (const r of list) { const k = r.event || '（大会名なし）'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  box.innerHTML = [...groups].map(([ev, rs]) => `<div class="rv-grp"><div class="rv-grp-h">🏆 ${esc(ev)}<small>${dlabel(rs[rs.length - 1].date)}</small></div>
    ${rs.map((r) => `<button class="pg" data-rv="${r.id}">${esc(r.match || '試合')}<small>${r.done ? '' : '書きかけ'}${r.source === 'import' ? ' 📥' : ''}</small></button>`).join('')}</div>`).join('');
}
document.getElementById('rvList')?.addEventListener('click', (e) => { const b = e.target.closest('[data-rv]'); if (b) { closeSide?.(); openReview(b.dataset.rv); } });
document.getElementById('rvNew')?.addEventListener('click', () => { closeSide?.(); newReview(); });
document.getElementById('rvImport')?.addEventListener('click', () => { closeSide?.(); openImport(); });
addEventListener('resize', () => { if (pad) pad.layout(); });
renderReviewList();

window.JournalReview = { open: openReview, create: newReview, import: openImport, current: () => R, list: renderReviewList, _parts: () => ({ pad, readBox }) };   // _parts は動作確認用
