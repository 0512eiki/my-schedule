/* =========================================================
   手書きを文字にする（読み取り）
   ・手書きの原本（線）はそのまま残す。読み取った文字は「となり」に置くだけ
   ・読み取った文字は手書きのすぐ下に出す。本人が直せる（直したら自動では上書きしない）
   ・あとで探す・まとめる・メニューに活かす時は、この文字を使う
   ・いまの読み取り役：この Mac の中の Apple の文字読み取り（外には送らない）
   データの形： read = { text, by:'mac', at, inkHash, edited }
   ・公開版（JR.cloud）では、この端末では読み取らない。「読み取りは Mac（本部）が後でします」と出して、
     本部の Mac が読み取った read があれば出すだけ（直すことはできる。直したら Mac も上書きしない）
   ========================================================= */
'use strict';
const Reader = (() => {
  const CLOUD = !!(window.JR && window.JR.cloud);
  // 線の形から「指紋」を作る（手書きが変わったか分かるように）
  function inkHash(ink) {
    let h = 2166136261 >>> 0;
    const add = (v) => { h ^= (v * 10) | 0; h = Math.imul(h, 16777619) >>> 0; };
    add(ink.length);
    for (const s of ink) { add(s.p.length); for (let i = 0; i < s.p.length; i += 9) { add(s.p[i]); add(s.p[i + 1]); } }
    return h.toString(36);
  }
  // 線だけを白い紙に描いた画像にする（罫線や畳の下地は入れない＝読み間違いを減らす）
  function inkToPng(ink, W, H) {
    if (!ink.length) return null;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const s of ink) for (let i = 0; i < s.p.length; i += 3) { x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]); y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]); }
    const pad = 24; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W, x1 + pad); y1 = Math.min(H, y1 + pad);
    const k = Math.min(2, 1800 / Math.max(x1 - x0, y1 - y0, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((x1 - x0) * k)); c.height = Math.max(1, Math.round((y1 - y0) * k));
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    for (const s of ink) {
      if (s.t === 'hl') continue;                       // マーカーは文字ではないので入れない
      strokePath(x, { ...s, c: '#000', w: Math.max(s.w, 3.6) });
    }
    return { png: c.toDataURL('image/png').split(',')[1], x0, y0, cw: x1 - x0, ch: y1 - y0 };
  }
  async function read(ink, W, H) {
    const img = inkToPng(ink, W, H);
    if (!img) return { text: '', by: 'mac', at: Date.now(), inkHash: inkHash(ink), edited: false };
    const r = await JR.fetch('api/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: img.png }) });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    // 行の場所（画像の中の割合）→ ページの座標に戻す
    const lines = (j.lines || []).map((l) => ({ t: l.t, x: img.x0 + l.x * img.cw, y: img.y0 + l.y * img.ch, w: l.w * img.cw, h: l.h * img.ch }));
    return { text: j.text || '', lines, by: j.by || 'mac', at: Date.now(), inkHash: inkHash(ink), edited: false };
  }

  /* ---------- 画面の部品：手書きのすぐ下に出す「読み取った文字」欄 ----------
     opts: { getInk, getRead, setRead(read), W, H, compact } */
  class Box {
    constructor(el, opts) {
      this.el = el; this.o = opts; this.t = 0; this.busy = false; this.seq = 0;
      el.classList.add('rd');
      el.innerHTML = `<div class="rd-h"><span>🔤 手書きを読み取った文字</span><small class="rd-st"></small><button class="lnk rd-again" type="button">読み直す</button></div>
        <textarea class="rd-tx" rows="${opts.compact ? 2 : 3}" placeholder="手書きすると、ここに文字が出ます（まちがいは直せます）"></textarea>`;
      this.tx = el.querySelector('.rd-tx'); this.st = el.querySelector('.rd-st');
      if (CLOUD) { el.querySelector('.rd-again').hidden = true; this.tx.placeholder = '読み取りは Mac（本部）が後でします。ここに文字が出ます（まちがいは直せます）'; }
      this.tx.addEventListener('input', () => {
        const cur = this.o.getRead() || {};
        this.o.setRead({ ...cur, text: this.tx.value, edited: true, at: cur.at || Date.now(), inkHash: cur.inkHash || inkHash(this.o.getInk()) });
        this.status();
      });
      el.querySelector('.rd-again').addEventListener('click', () => {
        const cur = this.o.getRead();
        if (cur && cur.edited && cur.text && !confirm('直した文字を、読み取りし直した文字で置きかえますか？')) return;
        this.run(true);
      });
      this.refresh();
    }
    // 外から：表示を今のデータに合わせる
    refresh() {
      const ink = this.o.getInk(), r = this.o.getRead();
      this.el.hidden = !ink.length && !(r && r.text);
      if (document.activeElement !== this.tx) this.tx.value = (r && r.text) || '';
      this.status();
    }
    stale() { const r = this.o.getRead(); return !r || r.inkHash !== inkHash(this.o.getInk()); }
    status(msg) {
      const r = this.o.getRead();
      let s = msg || '';
      if (!s) {
        if (this.busy) s = '読み取り中…';
        else if (!this.o.getInk().length) s = '';
        else if (CLOUD && this.stale()) s = r && r.edited ? '手書きが変わりました（直した文字はそのまま）' : '読み取りは Mac（本部）が後でします';
        else if (CLOUD) s = r && r.edited ? '✓ 直しました' : 'Mac（本部）で読み取り済み';
        else if (this.stale()) s = r && r.edited ? '手書きが変わりました（直した文字はそのまま）' : '読み取り待ち…';
        else if (r && r.edited) s = '✓ 直しました';
        else if (r) s = 'Mac の中で読み取り（外には送っていません）';
      }
      this.st.textContent = s;
      this.el.classList.toggle('stale', !this.busy && this.stale() && !!this.o.getInk().length);
    }
    // 手書きが変わった時に呼ぶ → 少し待ってから自動で読む（直した文字は自動では上書きしない）
    inkChanged() {
      this.refresh();
      clearTimeout(this.t);
      const r = this.o.getRead();
      if (r && r.edited) return this.status();
      if (CLOUD) return this.status();                   // 公開版：この端末では読まない（本部の Mac が後で読む）
      this.t = setTimeout(() => this.run(false), 2500);
      this.status();
    }
    async run(force) {
      clearTimeout(this.t);
      const ink = this.o.getInk();
      if (!ink.length) { const r = this.o.getRead(); if (r && !r.edited) this.o.setRead(null); this.refresh(); return; }
      if (!force && !this.stale()) return this.status();
      if (CLOUD) return this.status();
      const my = ++this.seq; this.busy = true; this.status();
      try {
        const res = await read(ink, this.o.W, this.o.H);
        if (my !== this.seq) return;
        const cur = this.o.getRead();
        if (!force && cur && cur.edited) return;          // 読んでいる間に本人が直した → そちらを優先
        if (inkHash(this.o.getInk()) !== res.inkHash) return this.inkChanged();   // 読んでいる間に書き足した → 読み直し
        this.o.setRead(res);
        this.busy = false; this.refresh();
      } catch {
        this.busy = false; this.status('読み取りできませんでした（あとで「読み直す」）');
      } finally { if (my === this.seq) { this.busy = false; this.status(); } }
    }
  }
  return { inkHash, inkToPng, read, Box };
})();
window.Reader = Reader;
