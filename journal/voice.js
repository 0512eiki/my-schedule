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
   10/29 本人「振り返りを声で入れたのに入らなかった」（記録に何も残っていなかった）→ 直したこと：
   ・文字になった分は、話している途中でもすぐ欄に入れる（振り返り・試合の反省は、その場で保存される）。
     前は「終わって文字にする」まで欄に入れず、画面を離れる・アプリが閉じると消えていた。端末にも控え（jr:voice-last）。
   ・マイクがつながらない（audio-capture。車の Bluetooth などにマイクを取られている時）→ すぐあきらめず、
     前の認識が終わるのを待って2回までやり直す。だめなら一時停止にして「▶ つづける」で続きから（柔道ノートと同じ直し）。
   ・聞いているのに声が届かない（12秒たっても文字が1つも出ない）→「⚠️ 声が届いていません」と大きく出す。
   ・文字が空のまま終わったら「❌ 入っていません」と赤く出し、パネルを閉じない。
   ・何が起きたかを client_errors に残す（柔道ノートと同じ表。公開版だけ。中身の文字は送らない）。
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
    base: '',              // 声を入れ始める前から欄にあった文字（この後ろに、文字になった分をその場で入れる）
    shown: '',             // 最後に欄へ入れた声の文字
    anyText: false, audioOk: false, listenAt: 0, warned: false, prev: null,
  };

  const log = (...a) => { try { console.debug('[voice]', ...a); } catch {} };
  // 何が起きたかを残す（公開版は cloud.js の JRLog → client_errors。中身の文字は送らない）
  const report = (msg) => { log('report', msg); try { window.JRLog && window.JRLog('journal-mic', msg); } catch {} };
  const where = () => (V.target && (V.target.id || V.target.dataset.a || V.target.className.split(' ').pop())) || '';
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
    box.classList.remove('vbad');
    if (mode !== 'listening') box.classList.remove('vwarn');
    stateEl.textContent = { starting: 'マイク準備中…', listening: '● 聞いています', paused: '一時停止中', finishing: '文字にしています…', idle: '待機中' }[mode];
    pauseBtn.textContent = mode === 'paused' ? '▶ つづける' : '一時停止';
    pauseBtn.disabled = mode === 'finishing' || mode === 'idle';
    stopBtn.disabled = mode === 'finishing' || mode === 'idle';
    if (msg !== undefined) msgEl.textContent = msg;
    else showText();
  }
  function showText() {
    const all = joinText(V.committed, V.session) + (V.interim ? '｜' + V.interim : '');
    if (V.warned && !all) return;                          // 「声が届いていません」を出している間は消さない
    msgEl.textContent = all ? all.slice(-120) : (V.mode === 'listening' ? '話してください。黙っても止まりません。' : '');
  }
  // 文字になった分を、その場で欄に入れる（「終わって文字にする」を待たない → 画面を離れても・アプリが閉じても消えない）
  function live() {
    const txt = joinText(V.committed, V.session);
    if (txt === V.shown) return;
    V.shown = txt;
    if (txt) try { localStorage.setItem('jr:voice-last', JSON.stringify({ at: Date.now(), where: where(), text: txt })); } catch {}
    const ta = (V.target && document.contains(V.target)) ? V.target : el('addText');
    const sep = ta.tagName === 'INPUT' ? ' ' : '\n';
    ta.value = V.base && txt ? V.base + sep + txt : (V.base || txt);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // 本人が欄を打って直した時：その文字を新しい土台にして、声の分はその後ろに足す
  function rebase() {
    const ta = (V.target && document.contains(V.target)) ? V.target : el('addText');
    commitSession(); live();
    V.base = ta.value.trim(); V.committed = ''; V.shown = '';
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
      V.fails = 0; V.heardAt = Date.now(); V.tickAt = Date.now(); V.audioOk = true;
      if (!V.listenAt) V.listenAt = Date.now();
      setUI('listening');
    };
    rec.onspeechstart = () => { if (id === V.recId) V.heardAt = Date.now(); };
    rec.onresult = (e) => {
      if (id !== V.recId || V.mode === 'paused') return;     // 一時停止の後に遅れて届いた文字は捨てる
      V.session = sessionText(e.results);
      let im = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (!e.results[i].isFinal) im += e.results[i][0].transcript;
      V.interim = im; V.gotTextAt = Date.now();
      if (V.session || im) { V.anyText = true; if (V.warned) { V.warned = false; box.classList.remove('vwarn'); } }
      live(); showText();
    };
    rec.onerror = (e) => {
      if (id !== V.recId) return;
      log('error', e.error);
      if (!['no-speech', 'aborted'].includes(e.error)) report(`${e.error} fails=${V.fails} ${where()} ${document.activeElement === V.target ? 'kb' : ''}`);
      if (['not-allowed', 'service-not-allowed'].includes(e.error)) {
        return giveUp(location.protocol === 'https:' || location.hostname === 'localhost'
          ? '❌ マイクが使えません（許可されていない）。ここまでの文字は残しました。キーボードの🎤を使ってください。'
          : 'この試作（http）の画面ではマイクが使えません。公開版（https）で使えます。今はキーボードの🎤を使ってください。', true);
      }
      if (e.error === 'audio-capture') {
        // マイクが一瞬つながらない（前の認識が終わりきっていない・Bluetooth に取られている など）→ 2回までやり直す（onend で）
        V.fails++;
        if (V.fails > 2) {
          rec._gaveUp = true;
          commitSession(); live(); dropRec(true); keepAwake(false);
          setUI('paused', '⚠️ マイクがつながりません（車の Bluetooth・イヤホンにマイクを取られているかも）。ここまでの文字は残しました。少し待って「▶ つづける」か、キーボードの🎤で。');
          box.classList.add('vbad');
          return;
        }
        if (V.fails === 2 && document.activeElement === V.target) V.target.blur();   // 2回目はキーボードを閉じてから（柔道ノートと同じ）
        rec._wait = V.fails === 1 ? 500 : 1200;
      }
      rec._err = true;
    };
    rec.onend = () => {
      rec._done = true; if (rec._wake) rec._wake();
      if (id !== V.recId) return;
      commitSession();
      if (V.mode === 'listening' || V.mode === 'starting') {
        // 黙った・時間切れ・Safari の都合で勝手に終わった → 文字は残して、すぐ次を始める
        log('auto-restart');
        setTimeout(() => { if (id === V.recId && (V.mode === 'listening' || V.mode === 'starting')) startRec(); }, rec._wait || (rec._err ? 600 : 150));
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
      // 聞いているのに、12秒たっても文字が1つも出ない → マイクに音が来ていないかも（止めずに、はっきり知らせる）
      if (V.mode === 'listening' && !V.anyText && !V.warned && V.listenAt && now - V.listenAt > 12000) {
        V.warned = true; box.classList.add('vwarn');
        msgEl.textContent = '⚠️ 声が届いていません（まだ1文字も入っていません）。マイクに音が来ていないかも。車の Bluetooth・イヤホンを外すか、キーボードの🎤で。';
        report(`no-text-12s ${where()}`);
      }
      const noAudio = V.mode === 'starting' && now - startedAt > 5000;
      const stuck = V.mode === 'listening' && V.heardAt > (V.gotTextAt || 0) && now - V.heardAt > 6000;
      if (noAudio || stuck) {
        V.fails++; log('watchdog', { noAudio, stuck, fails: V.fails });
        if (V.fails >= 3) { report(`watchdog noAudio=${noAudio} ${where()}`); return giveUp('⚠️ マイクがうまく動きません。ここまでの文字は残しました。キーボードの🎤も使えます。', true); }
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
    if (r) { V.prev = r; try { abort ? r.abort() : r.stop(); } catch {} }
  }
  // 前の認識が終わりきるまで待つ（すぐ始めると iPhone・iPad でマイクがつながらないことがある。最大 0.7 秒）
  const prevGone = () => new Promise((res) => { const r = V.prev; if (!r || r._done) return res(); r._wake = res; setTimeout(res, 700); });
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
    V.base = (V.target && document.contains(V.target) ? V.target : el('addText')).value.trim(); V.shown = '';
    V.anyText = false; V.audioOk = false; V.listenAt = 0; V.warned = false;
    clearInterval(V.timer); V.timer = setInterval(tick, 500); tick();
    keepAwake(true);
    startRec();                                              // 押したその場で始める
  }
  function pauseOrResume() {
    if (V.mode === 'listening' || V.mode === 'starting') {
      commitSession(); live(); dropRec(true); keepAwake(false);
      setUI('paused', (V.committed ? V.committed.slice(-120) + '\n' : '') + '一時停止中。▶ で続きから話せます。');
    } else if (V.mode === 'paused') {
      V.fails = 0; keepAwake(true);
      rebase();                                              // 一時停止の間に打って直した分は、そのまま残す
      if (V.prev && !V.prev._done) { setUI('starting'); prevGone().then(() => { if (V.mode === 'starting' && !V.rec) startRec(); }); }
      else startRec();                                       // 止まりきっていれば、押したその場で新しく作って始める
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
    commitSession(); live();                                 // 最後の分も欄へ（入れたあとで番号を進める）
    dropRec(true);
    clearInterval(V.timer); keepAwake(false);
    const txt = V.committed.trim();
    const secs = Math.round(V.elapsed / 1000);
    V.committed = ''; V.shown = '';
    if (txt) { const ta = (V.target && document.contains(V.target)) ? V.target : el('addText'); ta.focus({ preventScroll: true }); }
    if (!txt) report(`empty secs=${secs} audio=${V.audioOk} ${where()}`);
    setUI('idle', txt ? msgEl.dataset.done || (V.target && V.target.id !== 'addText' ? '答えの欄に入れました。直してから「次へ」へ。' : '書き足す欄に入れました。直してから「追加」を押してください。')
      : `❌ 入っていません。声が文字になりませんでした${secs >= 3 ? `（${secs}秒 聞いていました）` : ''}。${V.audioOk ? 'マイクに音が来ていないかも（車の Bluetooth・イヤホンを外す）。' : 'マイクがつながりませんでした。'}もう一度 🎙 か、キーボードの🎤で。`);
    if (!txt) { box.classList.add('vbad'); return; }          // 入っていない時はパネルを閉じない（気づけるように）
    // 文字にし終わったら、少し見せてからパネルを閉じる（下の「これでOK」などのボタンにかぶらないように）
    V.hideAt = setTimeout(() => { if (V.mode === 'idle') shown(false); }, 2500);
  }
  // やめる：声で入れた分を欄から取りのぞいて、始める前に戻す（控えの jr:voice-last は残す）
  function cancel() {
    const had = V.mode !== 'idle';
    dropRec(true); clearInterval(V.timer); keepAwake(false);
    V.committed = ''; V.session = ''; V.interim = '';
    if (had && V.shown) { V.shown = '#'; live(); }
    V.shown = '';
    setUI('idle', ''); shown(false);
  }
  function giveUp(msg, bad) {
    commitSession(); live();
    dropRec(true); clearInterval(V.timer); keepAwake(false);
    V.committed = ''; V.shown = '';
    setUI('idle', msg);
    if (bad) box.classList.add('vbad');
  }
  // 「話し終わった」などを押した時：聞いている途中なら、最後の文字まで欄に入れてから進む
  function finishNow() {
    if (V.mode === 'idle') return Promise.resolve();
    if (V.mode === 'paused') { commitSession(); live(); finish(); return Promise.resolve(); }
    stop();
    return new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { if (V.mode === 'idle' || Date.now() - t0 > 2500) { clearInterval(iv); res(); } }, 50); });
  }

  // 指を置いた瞬間に反応（キーボードが動いても押し損ねない）。マウスはクリックでもよい
  const onPress = (btn, fn) => btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  onPress(openBtn, () => open(el('addText')));
  onPress(pauseBtn, pauseOrResume);
  onPress(stopBtn, stop);
  onPress(cancelBtn, cancel);

  // 聞いている途中に、本人が欄を打って直した → 声を一度止めて、手を止めたら続きから（打った字が消えないように）
  document.addEventListener('input', (e) => {
    if (!e.isTrusted || V.mode === 'idle' || e.target !== V.target) return;
    if (V.mode === 'listening' || V.mode === 'starting') { pauseOrResume(); V.typing = true; }
    if (V.typing) { clearTimeout(V.typeT); V.typeT = setTimeout(() => { if (V.typing && V.mode === 'paused') { V.typing = false; pauseOrResume(); } }, 1500); }
  }, true);

  // 画面を離れたら一時停止（戻ったら「つづける」で再開）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (V.mode === 'listening' || V.mode === 'starting')) pauseOrResume();
  });

  window.JournalVoice = { open, finishNow, state: () => ({ ...V, rec: !!V.rec, prev: !!V.prev, target: V.target && (V.target.id || V.target.dataset.a || 'field') }) };
})();
