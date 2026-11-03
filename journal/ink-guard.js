/* 手書きの紙で画面を動かさない（11/2 本人「iPad で Apple Pencil で書くと画面が揺れてめちゃめちゃ書きにくい」）
   これまで：紙は touch-action:pan-y（指でスクロールできるように）→ iPad の Safari は、ペンで書き始めた瞬間にも
   ページを少し動かしてしまう（スクロール・引っぱり・左右の揺れ）。
   これから：
   ・紙は touch-action:none（ペン・指どちらでも、ブラウザは紙の上でページを動かさない）
   ・指1本のスクロールだけ、ここで自分で動かす（上下だけ・左右は動かさない・ズームしない）
   ・ペンが触れている間と、離してから 0.8 秒は、指（手のひら）では動かさない
   ・大きな接触（手のひら）は無視する
   使い方：inkGuard(紙の要素, () => 書いている途中か) */
(function () {
  const PALM_R = 22;          // これより大きい接触は手のひら
  const PEN_QUIET = 1500;     // ペンを離してから指で動かせるまで（ms）。考えている間の手のひらで動かないように少し長め（11/3）
  const HOLD_MS = 6000;       // ペンを離してから、紙の位置を押さえておく長さ（ms）
  let lastPen = -1e9;          // まだペンを使っていない（開いた直後に「ペンのすぐあと」と見なさない）

  function scroller(el) {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  window.inkGuard = function (el, busy) {
    el.style.touchAction = 'none';
    el.style.overscrollBehavior = 'none';
    let pan = null, coast = 0;

    const penNow = () => (busy && busy()) || (performance.now() - lastPen < PEN_QUIET);
    const stopCoast = () => { if (coast) cancelAnimationFrame(coast); coast = 0; };

    // 11/3：書いている間と離してから少しの間は、紙の画面の上の位置を押さえる。
    // iPad の Safari は、上の方の物の高さが変わった時に（保存の文字・読み取った文字など）スクロールの位置を直してくれないので、紙が上下に動いて見える
    let hold = null;
    const holdStart = () => {
      const sc = scroller(el);
      if (!hold) { hold = { sc, top: el.getBoundingClientRect().top, st: sc.scrollTop, until: 0, raf: 0 }; }
      hold.until = performance.now() + HOLD_MS;
      if (!hold.raf) hold.raf = requestAnimationFrame(holdTick);
    };
    const holdStop = () => { if (hold) { cancelAnimationFrame(hold.raf); hold = null; } };
    function holdTick(now) {
      if (!hold) return;
      // だれかがスクロールした（スクロールの位置そのものが変わった）→ その動きは本物なので、押さえるのをやめる
      if (Math.abs(hold.sc.scrollTop - hold.st) > 1) { holdStop(); return; }
      const d = el.getBoundingClientRect().top - hold.top;
      if (Math.abs(d) >= 0.5) { hold.sc.scrollTop += d; hold.st = hold.sc.scrollTop; }   // 上の物の高さが変わってずれた分だけ戻す（見た目は動かない）
      if (now > hold.until) { holdStop(); return; }
      hold.raf = requestAnimationFrame(holdTick);
    }
    // 指でスクロールし始めたら押さえるのをやめる（紙の外・帯・一覧などで動かした時も）
    const userScroll = () => holdStop();
    window.addEventListener('wheel', userScroll, { passive: true });
    document.addEventListener('touchstart', (e) => { if (![...e.touches].some((t) => t.touchType === 'stylus') && !el.contains(e.target)) holdStop(); }, { passive: true, capture: true });
    window.JR_inkHold = { stop: holdStop, active: () => !!hold };

    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'pen') { lastPen = performance.now(); stopCoast(); pan = null; holdStart(); } }, true);
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'pen') lastPen = performance.now(); }, true);
    el.addEventListener('pointerup', (e) => { if (e.pointerType === 'pen') { lastPen = performance.now(); holdStart(); } }, true);

    el.addEventListener('touchstart', (e) => {
      const ts = [...e.touches];
      // ペン：スクロールと「スクリブル（手書き文字入力）」を止める
      if (ts.some((t) => t.touchType === 'stylus')) { e.preventDefault(); lastPen = performance.now(); pan = null; return; }
      stopCoast();
      if (ts.length !== 1 || penNow()) { pan = null; return; }
      const t = ts[0];
      if ((t.radiusX || 0) > PALM_R || (t.radiusY || 0) > PALM_R) { pan = null; return; }
      holdStop();
      pan = { id: t.identifier, y: t.clientY, sc: scroller(el), v: 0, at: performance.now() };
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
      e.preventDefault();                         // 紙の上ではブラウザに動かさせない（ペン・指とも）
      if (!pan || penNow() || e.touches.length !== 1) { pan = null; return; }
      const t = [...e.touches].find((x) => x.identifier === pan.id);
      if (!t) return;
      if ((t.radiusX || 0) > PALM_R) { pan = null; return; }
      const dy = t.clientY - pan.y, now = performance.now();
      pan.sc.scrollTop -= dy;
      pan.v = 0.8 * (dy / Math.max(1, now - pan.at)) + 0.2 * pan.v;
      pan.y = t.clientY; pan.at = now;
    }, { passive: false });

    const end = () => {
      if (!pan) return;
      const p = pan; pan = null;
      if (penNow() || Math.abs(p.v) < 0.15) return;
      // 指を離したあと、少しだけすべる（ほかのアプリと同じ感じ）
      let v = p.v * 16, last = performance.now();
      const step = (now) => {
        const dt = Math.min(32, now - last); last = now;
        p.sc.scrollTop -= v * dt / 16;
        v *= Math.pow(0.95, dt / 16);
        coast = Math.abs(v) > 0.3 && !penNow() ? requestAnimationFrame(step) : 0;
      };
      coast = requestAnimationFrame(step);
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', () => { pan = null; });
  };
})();
