/* =========================================================
   🔍 さがす（日誌・試合の反省・練習メニュー・振り返り・昔の記録の全部から。手書きから読み取った文字も）
   言葉を入れる → 見つかった所の一覧 → 押すと、その日・その質問・手書きの場所に飛んで光らせる
   （メニュー・振り返りは、その日のページの切りかえを合わせてから光らせる。昔の記録はそのまま開く）
   使っている部品（index.html 側）：$, openDate, state, scale, W, H, xLive, drawing, escapeHtml, parseD, WD, closeSide
   ========================================================= */
'use strict';
(() => {
  const input = document.getElementById('q'), res = document.getElementById('searchRes'), normal = document.getElementById('sideNormal');
  let seq = 0, t = 0, last = [];
  const esc = (s) => escapeHtml(String(s ?? ''));
  const dl = (d) => { if (!d) return '日付なし'; const dt = parseD(d); return `${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）`; };
  const KIND = { page: ['📓 日誌', ''], review: ['🏆 反省', 'rv'], menu: ['📋 メニュー', ''], refl: ['💬 振り返り', ''], archive: ['📦 昔の記録', ''] };
  const sub = (h) => h.kind === 'review' ? [h.event, h.match].filter(Boolean).join(' ') : h.kind === 'refl' ? (h.about === 'self' ? '自分の稽古' : '生徒・メニュー') : h.title;

  async function run() {
    const q = input.value.trim();
    res.hidden = !q; normal.hidden = !!q;
    if (!q) { res.innerHTML = ''; return; }
    const my = ++seq;
    let data;
    try { data = await (await JR.fetch('api/search?q=' + encodeURIComponent(q))).json(); } catch { res.innerHTML = '<div class="sr-none">さがせませんでした（つながっていない？）</div>'; return; }
    if (my !== seq) return;
    last = data.hits || [];
    res.innerHTML = `<div class="sr-count">${last.length ? `${last.length} 件` : '見つかりませんでした'}</div>` + last.map((h, i) => `
      <button class="sr" data-i="${i}">
        <div class="sr-top"><b>${dl(h.date)}</b><span class="chip ${KIND[h.kind][1]}">${KIND[h.kind][0]}</span><small>${esc(sub(h))}</small></div>
        <div class="sr-lab">${esc(h.label)}${h.box ? ' ・ 手書きの場所へ' : ''}</div>
        <div class="sr-sn">${esc(h.pre)}<mark>${esc(h.hit)}</mark>${esc(h.post)}</div>
      </button>`).join('');
  }
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 220); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); run().then(() => last[0] && go(last[0])); } if (e.key === 'Escape') { input.value = ''; run(); } });
  res.addEventListener('click', (e) => { const b = e.target.closest('.sr'); if (b) go(last[+b.dataset.i]); });

  /* ---------- 飛ぶ ---------- */
  async function go(h) {
    if (!h) return;
    closeSide();
    if (h.kind === 'review') { window.JournalReview?.open(h.id, { step: h.step, box: h.box, q: input.value.trim() }); return; }
    if (h.kind === 'archive') { window.JournalPractice?.openArchive(h.id); return; }
    if (state.date !== h.date) await openDate(h.date);
    if (h.kind === 'refl') { window.JournalReflect?.open(h.id); return; }
    if (h.kind === 'menu') {
      window.JournalDay?.show('menu'); await window.JournalPractice?.ready();
      const card = document.querySelector(`[data-menu="${h.id}"]`); if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); return;
    }
    window.JournalDay?.show('ink');      // 日誌の見出し・手書き・文字のメモは「手書き」の所にある
    if (h.field === 'read' && h.box) return flashPage(h.box);
    // 場所の分からない手書き（前に読み取った分）は、読み取った文字の欄を光らせる
    const el = h.field === 'text' ? document.getElementById('textBody').closest('.card') : h.field === 'read' ? document.getElementById('pageRead') : document.getElementById('title').closest('.top');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  // 日誌のページ：手書きの行のまわりを光らせる（線そのものは変えない。上の透明な板に描くだけ）
  function flashPage(b) {
    const paper = document.getElementById('paper'), main = document.getElementById('main');
    const pad = 16;
    const top = paper.offsetTop + (b.y - pad) * scale;
    main.scrollTo({ top: Math.max(0, top - main.clientHeight / 3), behavior: 'smooth' });
    let n = 0;
    const draw = () => {
      if (drawing) return;                       // 書いている最中はじゃましない
      xLive.clearRect(0, 0, W, H);
      if (n >= 8) return;
      if (n % 2 === 0) {
        xLive.save();
        xLive.fillStyle = 'rgba(255,214,0,.28)'; xLive.strokeStyle = 'rgba(230,150,0,.95)'; xLive.lineWidth = 4;
        xLive.beginPath(); xLive.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 14); xLive.fill(); xLive.stroke();
        xLive.restore();
      }
      n++; setTimeout(draw, n === 1 ? 900 : 350);
    };
    setTimeout(draw, 250);
    window.__lastFlash = { ...b, at: Date.now() };   // 動作確認用
  }
  window.JournalSearch = { run, go, hits: () => last };
})();
