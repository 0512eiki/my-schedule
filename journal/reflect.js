/* =========================================================
   💬 練習の振り返り（帰り道に話す）
   ・上で「🧒 生徒・メニュー／🥋 自分の稽古」を切りかえ（about = class / self）
   ・話している間は「💡 話すヒント（参考だけ）」を出す。チェックや順番はつけない（本人の決まり：話す内容の参考だけ）
   ・声は voice.js。使えない時（iPad・iPhone の http の画面）は「キーボードの🎤」をすすめる。文字で打つ欄は必ずある
   ・「話し終わった」→ まとめ。この画面では、話した言葉を文ごと（。や改行）に分けるだけ。status は heard のまま
     （summarized は本部の秘書がまとめ直した時だけ付く。秘書は memo/heard の行だけまとめ直し、ok の行は上書きしない）
     秘書のまとめが届いたら、日を開き直した時・画面に戻った時に読みこみ直す
     決まった見出しの型にはしない（本人の決まり）。「次は／次回」などをふくむ文には、最初から「次へ」の印
   ・まとめは直せる・消せる・「次へ」を付け外し・「これでOK」・「言い足す」
     言い足した時は、今のまとめ（本人が直した文）はそのままにして、新しく話した分の文だけを後ろに足す
   ・status：memo（打っただけ・録音だけ）→ heard（声が文字になった・文で区切った）→ summarized（本部の秘書がまとめた）→ ok（本人が OK）
   ・形は ../supabase/journal.sql の jr_reflections と同じ。保存は Outbox（端末に入れてから送る）
   使っている部品（index.html 側）：$, escapeHtml, toast, hhmm, Outbox, JournalVoice
   ========================================================= */
import { findNameLike } from './review-parse.mjs';
import { Day } from './practice.js';

const esc = (s) => escapeHtml(String(s ?? ''));
const isoNow = () => new Date().toISOString();
const newId = (date) => `${date}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
const NEXT = /次は|次回|次の練習|次こそ|今度は|来週は/;
const box = $('vRefl');

// 話した言葉 → まとめの文 [{text, next}]（文ごとに分けるだけ。話した順のまま）
export function toPoints(said) {
  return String(said || '').replace(/\r\n?/g, '\n').split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.replace(/^[\s・\-*●]+/, '').replace(/[。．]+$/, '').trim())
    .filter((s) => s && !/^[、。．，,.!！?？]+$/.test(s))
    .map((text) => ({ text, next: NEXT.test(text) }));
}
// 声が使えるか（iPad・iPhone は https でないとマイクが使えない。Mac の localhost は使える）
const canMic = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname));

let list = [], about = 'class', R = null, adding = false, addText = '', seq = 0, loading = Promise.resolve(), saveT = 0;

async function load(d) {
  const my = ++seq;
  flushSave();
  const rows = await Outbox.list('reflections', 'api/reflections?date=' + d, (b) => b.date === d);
  if (my !== seq) return;
  list = rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  pick();
  if (Day.view === 'refl') render();
}
function pick() { const mine = list.filter((r) => r.about === about); R = mine[mine.length - 1] || null; adding = false; addText = ''; }
// まとめの上の一言（だれがまとめたか）
const byLine = () => (R.status === 'summarized' ? '<span class="chip">本部の秘書がまとめました</span> ' : R.status === 'heard' ? '<span class="chip w">文で区切っただけ（本部の秘書があとでまとめます）</span> ' : '');
Day.on((why) => {
  if (why === 'date') loading = load(Day.date);
  else if (why === 'view' && Day.view === 'refl') render();
});

/* ---------- 保存 ---------- */
function ensure() {
  if (R) return R;
  const now = isoNow(), m = Day.menus[Day.menus.length - 1];
  R = { id: newId(Day.date), date: Day.date, menu_id: about === 'class' && m ? m.id : null, about, said: '', audio: '', points: [],
    status: 'memo', name_warn: false, created_at: now, updated_at: now };
  list.push(R);
  return R;
}
function save(ms = 600) {
  if (!R) return;
  R.name_warn = names().length > 0;
  R.updated_at = isoNow();
  st('保存待ち…', '');
  clearTimeout(saveT);
  const row = R;
  saveT = setTimeout(() => { saveT = 0; Outbox.put('reflections', JSON.parse(JSON.stringify(row))).then(() => after(row.id)); }, ms);
}
function flushSave() { if (saveT) { clearTimeout(saveT); saveT = 0; if (R) Outbox.put('reflections', JSON.parse(JSON.stringify(R))); } }
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
function after(id) {
  if (!R || R.id !== id) return;
  if (Outbox.pending('reflections', id)) st('📴 端末に保存（つながったら送ります）', 'wait');
  else st('保存しました ' + hhmm(Date.now()), 'ok');
  renderList();
}
function st(msg, cls) { const el = box.querySelector('.rf-st'); if (el) { el.textContent = msg; el.className = 'rf-st ' + cls; } }
Outbox.on((it) => { if (it.kind === 'reflections' && R && it.id === R.id && !saveT) after(it.id); });

// 名前らしい言葉（〇〇くん・〇〇さん 等。試合の反省と同じ見分け方）
function names() {
  if (!R && !addText) return [];
  return findNameLike([R?.said || '', addText, ...(R?.points || []).map((p) => p.text)].join('\n'));
}
// まとめを直しても「話した言葉（もとの文）」に名前が残っている時は、伏せるボタンを出す（〇〇 にする）
function warnText() {
  const n = names(); if (!n.length) return '';
  const inSaidOnly = R && !adding && R.points.length > 0 && ['heard', 'summarized', 'ok'].includes(R.status) && !findNameLike(R.points.map((p) => p.text).join('\n')).length;
  return `⚠️ 名前はイニシャルに（例：K.T.）：${n.map(esc).join('、')}`
    + (inSaidOnly ? `<br><small>まとめは直っています。話した言葉（もとの文）に残っています</small> <button class="lnk" data-act="mask">もとの文の名前も伏せる</button>` : '');
}
function updateWarn() { const w = box.querySelector('.warnname'); if (w) w.innerHTML = warnText(); }

/* ---------- 画面 ---------- */
function render() {
  if (!Day.date) return;
  const seg = `<div class="seg sm" id="rfAbout"><button data-about="class" class="${about === 'class' ? 'on' : ''}">🧒 生徒・メニュー</button><button data-about="self" class="${about === 'self' ? 'on' : ''}">🥋 自分の稽古</button></div>`;
  // まとめ（points）がまだない間は「話す」画面。文で区切ったまとめがあれば、status が heard でも、まとめを見せる
  const talking = !R || adding || (['memo', 'heard'].includes(R.status) && !R.points.length);
  let body;
  if (talking) {
    const menuNames = [...new Set(Day.menus.flatMap((m) => m.items.map((it) => it.name.trim())).filter(Boolean))];
    body = `<section class="card glass rf rf-talk">
      <h3>${adding ? '🎙 言い足す' : about === 'class' ? '💬 今日の練習、どうだった？' : '🥋 自分の稽古、どうだった？'} <span class="rf-st"></span></h3>
      <div class="hint"><h4>💡 話すヒント<small>参考だけ</small></h4>
        ${menuNames.length ? `<div class="hint-chips">${menuNames.map((n) => `<span>${esc(n)}</span>`).join('')}</div>` : ''}
        <ul><li>メニューはどうだった？</li><li>生徒の様子<small>名前はイニシャルで</small></li><li>次はこうしたい</li><li>気づいたこと・思いついたこと</li><li>自分の稽古のこと</li></ul>
        <p>ぜんぶ話さなくてOK。ほかの話もOK</p></div>
      <textarea class="rv-text rf-said" rows="4" placeholder="${adding ? '言い足すこと（話す・打つ）' : '話した言葉がここに入ります。打ってもOK（メモだけでも保存されます）'}">${esc(adding ? addText : R?.said || '')}</textarea>
      ${canMic() ? '<div class="row"><button class="btn sub" data-act="mic">🎙 話す</button></div>'
        : '<div class="rf-kb row">⌨️ キーボードの🎤（音声入力）で話せます。上の欄を押してから、キーボードの🎤を押してください</div>'}
      <div class="warnname">${warnText()}</div>
      <div class="row"><button class="btn" data-act="talk-done">話し終わった</button>${adding ? '<button class="btn sub" data-act="add-cancel">やめる</button>' : ''}</div>
    </section>`;
  } else {
    const pts = R.points.map((p, i) => `<div class="pt" data-i="${i}"><textarea rows="1" data-f="text" aria-label="${i + 1}つ目の文">${esc(p.text)}</textarea>
      <button class="nx ${p.next ? 'on' : ''}" data-act="nx" aria-pressed="${p.next}" title="次の練習の日に出す">次へ</button><button class="ib sm" data-act="rm-pt" title="この文を消す">✕</button></div>`).join('');
    body = `<section class="card glass rf rf-sum">
      <h3>📝 ${about === 'class' ? '今日の振り返り' : '自分の稽古の振り返り'} <span class="rf-st"></span></h3>
      <div class="rf-by">${byLine()}</div>
      <div class="pts">${pts || '<div class="mn-empty">まとめる文がありませんでした。「言い足す」で話せます</div>'}</div>
      <div class="rf-note">${about === 'class' ? '<span class="chip w">次へ</span> の所は、次の練習の日のメニューの上に出ます（押して付け外し）。文は直せます' : '自分の稽古の振り返りは、次の日のメニューの上には出しません'}</div>
      <div class="warnname">${warnText()}</div>
      <div class="row"><button class="btn" data-act="ok" ${R.status === 'ok' ? 'disabled' : ''}>${R.status === 'ok' ? '✓ OK にしました' : 'これでOK'}</button><button class="btn sub" data-act="add">🎙 言い足す</button></div>
      <details class="rf-said-view"><summary>話した言葉（もとの文）</summary><p>${esc(R.said)}</p></details>
    </section>`;
  }
  box.innerHTML = seg + body;
  box.querySelectorAll('.pt textarea').forEach(fit);
  if (R && Outbox.pending('reflections', R.id)) st('📴 端末に保存（つながったら送ります）', 'wait');
}
function fit(t) { if (!t.offsetParent) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
function renderList() { if (typeof window.renderList === 'function') window.renderList(); }

/* ---------- 入力 ---------- */
box.addEventListener('input', (e) => {
  const t = e.target;
  if (t.classList.contains('rf-said')) {
    if (adding) { addText = t.value; updateWarn(); return; }
    ensure(); R.said = t.value;
    // 声（voice.js）から入った文字 → heard。打っただけ → memo のまま
    const fromVoice = window.JournalVoice && window.JournalVoice.state().mode !== 'idle';
    if (fromVoice && R.status === 'memo') R.status = 'heard';
    save(); updateWarn(); return;
  }
  const row = t.closest('.pt');
  if (row && R) { R.points[+row.dataset.i].text = t.value; fit(t); save(); updateWarn(); }
});
box.addEventListener('click', (e) => {
  const b = e.target.closest('[data-about],[data-act]'); if (!b) return;
  if (b.dataset.about) { if (b.dataset.about !== about) { flushSave(); about = b.dataset.about; pick(); render(); } return; }
  const act = b.dataset.act;
  if (act === 'mic') return;                 // pointerdown で始める（下）
  if (act === 'talk-done') {
    if (adding) {
      const t = addText.trim();
      if (t) { R.said = (R.said.trim() ? R.said.trim() + '\n' : '') + t; R.points.push(...toPoints(t)); }
      adding = false; addText = ''; R.status = 'heard';    // 言い足した分は、本部の秘書がまとめ直す（OK は外れる）
    } else {
      if (!R || !R.said.trim()) return toast('まだ何も話していません（打ってもOK）');
      R.points = toPoints(R.said); R.status = 'heard';    // summarized は本部の秘書がまとめた時だけ
      if (!R.points.length) return toast('まとめる文がありませんでした（もう少し話す・打つ）');
    }
    save(0); render(); box.querySelector('.rf')?.scrollIntoView({ block: 'nearest' }); return;
  }
  if (act === 'add-cancel') { adding = false; addText = ''; render(); return; }
  if (!R) return;
  if (act === 'add') { adding = true; addText = ''; render(); box.querySelector('.rf-said')?.focus({ preventScroll: true }); return; }
  if (act === 'mask') { for (const n of names()) R.said = R.said.split(n).join('〇〇' + n.match(/(さん|くん|君|ちゃん|選手)$/)[0]); save(); render(); return; }
  if (act === 'ok') { R.status = 'ok'; save(0); render(); toast('これでOK にしました'); return; }
  const i = +(b.closest('.pt')?.dataset.i ?? -1); if (i < 0) return;
  if (act === 'nx') { R.points[i].next = !R.points[i].next; b.classList.toggle('on', R.points[i].next); b.setAttribute('aria-pressed', R.points[i].next); save(); return; }
  if (act === 'rm-pt') { R.points.splice(i, 1); save(); render(); }
});
// 🎙 は指を置いた瞬間に始める（voice.js と同じ理由）
box.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-act=mic]'); if (!b) return;
  e.preventDefault();
  window.JournalVoice?.open(box.querySelector('.rf-said'), { label: '振り返り', done: '振り返りの欄に入れました。続けて話すか「話し終わった」へ。' });
});

/* ---------- ほかから開く（さがす） ---------- */
async function open(id) {
  await Day.loading; await loading;
  const r = list.find((x) => x.id === id);
  if (r) { about = r.about; R = r; adding = false; }
  Day.show('refl');
  const c = box.querySelector('.rf'); if (c) { c.scrollIntoView({ block: 'center' }); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
}

// 画面に戻った時：本部の秘書のまとめが届いていれば読みこみ直す（打っている途中・保存待ちの時は読みこまない）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !Day.date || saveT || adding || box.contains(document.activeElement)) return;
  loading = load(Day.date);
});
if (Day.date) loading = load(Day.date);
window.JournalReflect = { open, current: () => R, toPoints, ready: () => loading };
