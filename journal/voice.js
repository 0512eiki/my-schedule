/* =========================================================
   声で書き足す（ブラウザの音声認識）
   本部・柔道ノートで出た不具合を、最初から避ける作り：
   ・黙っても切れない …… 認識が勝手に終わっても、それまでの文字を残して、すぐ次を始める。
                           止まるのは「終わって文字にする」「やめる」を押した時だけ。
   ・一時停止・再開が効く … 一時停止は abort（遅れて届く文字は捨てる）。再開は、押したその場で新しく作り直して start。
                           ボタンは指を置いた瞬間（pointerdown）に反応する（キーボードが動いて押し損ねるのを防ぐ）。
   ・「録音中」と出るのは、マイクが本当につながってから（audiostart の後）。
   ・つながらない／文字が出ない時は、自動で作り直す。3回だめなら止めて、文字は残す。
   ・同じ文が2回入る iPhone のくせを取りのぞく。
   ・画面を離れたら自動で一時停止して「つづける」を出す。
   ・使えない時（http の画面・許可なし）は、キーボードの🎤をすすめる。
   文字はすぐ保存せず、書き足す欄に入れる → 本人が見てから「追加」。
   ========================================================= */
(() => {
  'use strict';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const el = (id) => document.getElementById(id);
  const box = el('voice'), stateEl = el('vState'), timeEl = el('vTime'), msgEl = el('vMsg');
  const pauseBtn = el('vPause'), stopBtn = el('vStop'), cancelBtn = el('vCancel'), openBtn = el('voiceBtn');
  document.body.appendChild(box);   // 画面のいちばん上に置く（試合の反省の画面の上でも見えるように）

  const V = {
    mode: 'idle',          // idle | starting | listening | paused | finishing
    committed: '',         // 確定した文字（認識を作り直しても消えない）
    session: '',           // いまの認識の文字
    interim: '',
    rec: null, recId: 0,
    fails: 0, watchdog: 0, heardAt: 0, gotTextAt: 0,
    elapsed: 0, tickAt: 0, timer: 0, wake: null,
    target: null,          // 文字を入れる欄（ふつうは「書き足す」欄。試合の反省では、いまの質問の欄）
  };

  const log = (...a) => { try { console.debug('[voice]', ...a); } catch {} };
  // 10/29 本人「記録するところでボタン同士が邪魔をして押しづらい」→ 声のパネルが出ている間は、下にパネルの分のすき間を空ける
  function shown(on) {
    box.classList.toggle('show', on);
    document.body.classList.toggle('voice-open', on);
    if (on) requestAnimationFrame(() => document.body.style.setProperty('--voice-h', box.offsetHeight + 'px'));
  }
  function setUI(mode, msg) {
    V.mode = mode;
    clearTimeout(V.hideAt);
    shown(true);
    box.classList.toggle('rec', mode === 'listening');
    box.classList.toggle('paused', mode === 'paused');
    stateEl.textContent = { starting: 'マイク準備中…', listening: '● 聞いています', paused: '一時停止中', finishing: '文字にしています…', idle: '待機中' }[mode];
    pauseBtn.textContent = mode === 'paused' ? '▶ つづける' : '一時停止';
    pauseBtn.disabled = mode === 'finishing' || mode === 'idle';
    stopBtn.disabled = mode === 'finishing' || mode === 'idle';
    if (msg !== undefined) msgEl.textContent = msg;
    else showText();
  }
  function showText() {
    const all = joinText(V.committed, V.session) + (V.interim ? '｜' + V.interim : '');
    msgEl.textContent = all ? all.slice(-120) : (V.mode === 'listening' ? '話してください。黙っても止まりません。' : '');
  }
  function joinText(a, b) { a = a.trim(); b = b.trim(); if (!a) return b; if (!b) return a; return /[。、．，!?！？\s]$/.test(a) ? a + b : a + '。' + b; }

  // iPhone は同じ文を2回返すことがある → 前の結果の続き（または同じ）なら置きかえる
  function sessionText(results) {
    const parts = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].isFinal) continue;
      const t = results[i][0].transcript.trim();
      if (!t) continue;
      const last = parts[parts.length - 1];
      if (last && (t.startsWith(last) || last === t)) parts[parts.length - 1] = t;
      else if (last && last.endsWith(t)) continue;
      else parts.push(t);
    }
    return parts.join(' ');
  }

  /* ---------- 時間 ---------- */
  function tick() {
    if (V.mode === 'listening') { const now = Date.now(); V.elapsed += now - V.tickAt; V.tickAt = now; }
    const s = Math.floor(V.elapsed / 1000);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  async function keepAwake(on) {
    try {
      if (on && !V.wake && navigator.wakeLock) V.wake = await navigator.wakeLock.request('screen');
      if (!on && V.wake) { await V.wake.release(); V.wake = null; }
    } catch {}
  }

  /* ---------- 認識を1つ作って始める（必ずボタンを押したその場か、勝手に終わった直後に呼ぶ） ---------- */
  function startRec() {
    const id = ++V.recId;
    let rec;
    try { rec = new SR(); } catch (e) { return giveUp('この画面では声入力が使えません。キーボードの🎤を使ってください。'); }
    V.rec = rec; V.session = ''; V.interim = '';
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    setUI('starting');

    rec.onaudiostart = () => {
      if (id !== V.recId) return;
      V.fails = 0; V.heardAt = Date.now(); V.tickAt = Date.now();
      setUI('listening');
    };
    rec.onspeechstart = () => { if (id === V.recId) V.heardAt = Date.now(); };
    rec.onresult = (e) => {
      if (id !== V.recId || V.mode === 'paused') return;     // 一時停止の後に遅れて届いた文字は捨てる
      V.session = sessionText(e.results);
      let im = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (!e.results[i].isFinal) im += e.results[i][0].transcript;
      V.interim = im; V.gotTextAt = Date.now();
      showText();
    };
    rec.onerror = (e) => {
      if (id !== V.recId) return;
      log('error', e.error);
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
        return giveUp(location.protocol === 'https:' || location.hostname === 'localhost'
          ? 'マイクが使えません（許可されていない）。キーボードの🎤を使ってください。'
          : 'この試作（http）の画面ではマイクが使えません。公開版（https）で使えます。今はキーボードの🎤を使ってください。');
      }
      rec._err = true;
    };
    rec.onend = () => {
      if (id !== V.recId) return;
      commitSession();
      if (V.mode === 'listening' || V.mode === 'starting') {
        // 黙った・時間切れ・Safari の都合で勝手に終わった → 文字は残して、すぐ次を始める
        log('auto-restart');
        setTimeout(() => { if (id === V.recId && (V.mode === 'listening' || V.mode === 'starting')) startRec(); }, rec._err ? 600 : 150);
      } else if (V.mode === 'finishing') {
        finish();
      }
    };

    // 見張り：5秒たってもマイクがつながらない／声はあるのに6秒文字が出ない → 作り直す
    clearInterval(V.watchdog);
    const startedAt = Date.now();
    V.watchdog = setInterval(() => {
      if (id !== V.recId) return clearInterval(V.watchdog);
      const now = Date.now();
      const noAudio = V.mode === 'starting' && now - startedAt > 5000;
      const stuck = V.mode === 'listening' && V.heardAt > (V.gotTextAt || 0) && now - V.heardAt > 6000;
      if (noAudio || stuck) {
        V.fails++; log('watchdog', { noAudio, stuck, fails: V.fails });
        if (V.fails >= 3) return giveUp('⚠️ マイクがうまく動きません。ここまでの文字は残しました。キーボードの🎤も使えます。');
        V.heardAt = 0; restartNow();
      }
    }, 1000);

    try { rec.start(); }
    catch (e) { log('start failed', e); V.fails++; if (V.fails >= 3) giveUp('⚠️ マイクを始められません。キーボードの🎤を使ってください。'); else setTimeout(() => id === V.recId && startRec(), 600); }
  }
  function commitSession() {
    if (V.session) V.committed = joinText(V.committed, V.session);
    V.session = ''; V.interim = '';
  }
  function dropRec(abort = true) {
    const r = V.rec; V.rec = null; V.recId++;               // 番号を進める → 古い認識から届くものは全部無視
    clearInterval(V.watchdog);
    if (r) { try { abort ? r.abort() : r.stop(); } catch {} }
  }
  function restartNow() { commitSession(); dropRec(true); startRec(); }

  /* ---------- ボタン ---------- */
  function open(target, opts = {}) {
    V.target = target || el('addText');
    msgEl.dataset.label = opts.label || '';
    msgEl.dataset.done = opts.done || '';                     // 文字にした後の一言（振り返りなど、欄ごとに変える）
    if (!SR) {
      setUI('idle', 'この端末のブラウザは声入力に対応していません。キーボードの🎤を使ってください。');
      el('addText').focus(); return;
    }
    if (V.mode !== 'idle') return;
    V.committed = ''; V.session = ''; V.interim = ''; V.elapsed = 0; V.fails = 0;
    clearInterval(V.timer); V.timer = setInterval(tick, 500); tick();
    keepAwake(true);
    startRec();                                              // 押したその場で始める
  }
  function pauseOrResume() {
    if (V.mode === 'listening' || V.mode === 'starting') {
      commitSession(); dropRec(true); keepAwake(false);
      setUI('paused', (V.committed ? V.committed.slice(-120) + '\n' : '') + '一時停止中。▶ で続きから話せます。');
    } else if (V.mode === 'paused') {
      V.fails = 0; keepAwake(true);
      startRec();                                            // 押したその場で、新しく作って始める
    }
  }
  function stop() {
    if (V.mode === 'idle' || V.mode === 'finishing') return;
    if (!V.rec) { commitSession(); return finish(); }
    setUI('finishing');
    const r = V.rec;
    try { r.stop(); } catch { commitSession(); return finish(); }
    clearInterval(V.watchdog);
    setTimeout(() => { if (V.mode === 'finishing' && V.rec === r) { commitSession(); dropRec(true); finish(); } }, 1500); // 最後の文字を最大1.5秒待つ
  }
  function finish() {
    dropRec(true);
    clearInterval(V.timer); keepAwake(false);
    const txt = V.committed.trim();
    V.committed = '';
    if (txt) putText(txt, true);
    setUI('idle', txt ? msgEl.dataset.done || (V.target && V.target.id !== 'addText' ? '答えの欄に入れました。直してから「次へ」へ。' : '書き足す欄に入れました。直してから「追加」を押してください。') : '文字になりませんでした。');
    // 文字にし終わったら、少し見せてからパネルを閉じる（下の「これでOK」などのボタンにかぶらないように）
    if (txt) V.hideAt = setTimeout(() => { if (V.mode === 'idle') shown(false); }, 2500);
  }
  // 文字を欄に入れて、input イベントを出す（試合の反省などが自動保存できるように）
  function putText(txt, focus) {
    const ta = (V.target && document.contains(V.target)) ? V.target : el('addText');
    const sep = ta.tagName === 'INPUT' ? ' ' : '\n';
    ta.value = ta.value.trim() ? ta.value.trim() + sep + txt : txt;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (focus) ta.focus({ preventScroll: true });
  }
  function cancel() {
    dropRec(true); clearInterval(V.timer); keepAwake(false);
    V.committed = ''; V.session = ''; V.interim = '';
    setUI('idle', ''); shown(false);
  }
  function giveUp(msg) {
    commitSession(); const kept = V.committed;
    dropRec(true); clearInterval(V.timer); keepAwake(false);
    if (kept) putText(kept, false);
    V.committed = '';
    setUI('idle', msg);
  }

  // 指を置いた瞬間に反応（キーボードが動いても押し損ねない）。マウスはクリックでもよい
  const onPress = (btn, fn) => btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  onPress(openBtn, () => open(el('addText')));
  onPress(pauseBtn, pauseOrResume);
  onPress(stopBtn, stop);
  onPress(cancelBtn, cancel);

  // 画面を離れたら一時停止（戻ったら「つづける」で再開）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (V.mode === 'listening' || V.mode === 'starting')) pauseOrResume();
  });

  window.JournalVoice = { open, state: () => ({ ...V, rec: !!V.rec, target: V.target && (V.target.id || V.target.dataset.a || 'field') }) };
})();
