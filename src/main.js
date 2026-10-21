// Orkestrasi: state machine IDLE → LISTENING → THINKING → SPEAKING → LISTENING.
import { Face3D } from './face3d.js';
import { STT, MicMonitor, sttSupported } from './stt.js';
import { TTSQueue } from './tts.js';
import { streamChat, SentenceSplitter } from './chat.js';

const $ = (id) => document.getElementById(id);
const el = {
  stateLabel: $('stateLabel'), clock: $('clock'), modelName: $('modelName'),
  micBtn: $('micBtn'), micBtnLabel: $('micBtnLabel'), interruptBtn: $('interruptBtn'),
  voiceInterrupt: $('voiceInterrupt'), sensitivity: $('sensitivity'), sensValue: $('sensValue'),
  micMeter: $('micMeter'), sensMarker: $('sensMarker'), voiceSelect: $('voiceSelect'), langSelect: $('langSelect'),
  logBtn: $('logBtn'), fullBtn: $('fullBtn'), logDrawer: $('logDrawer'), logList: $('logList'),
  clearLogBtn: $('clearLogBtn'), closeLogBtn: $('closeLogBtn'),
  cpuBar: $('cpuBar'), cpuVal: $('cpuVal'), ramBar: $('ramBar'), ramVal: $('ramVal'), netVal: $('netVal'),
  userLine: $('userLine'), aiLine: $('aiLine'), ttsMode: $('ttsMode'),
  wave: $('wave'), cmdForm: $('cmdForm'), cmdInput: $('cmdInput'), hint: $('hint'),
};

const MAX_HISTORY = 10;
const DEFAULT_HINT = sttSupported
  ? 'Tekan MICROPHONE lalu bicara, atau ketik perintah · ESC untuk interrupt'
  : 'Browser ini tidak mendukung Speech Recognition — pakai Chrome/Edge, atau ketik perintah';

// ---------- Penyimpanan sesi (aman bila storage diblokir) ----------
const store = {
  get(k, d) {
    try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ }
  },
};
const prefs = {
  get(k, d) {
    try { return localStorage.getItem(k) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* abaikan */ }
  },
};

// ---------- State ----------
let state = 'IDLE';
let micOn = false;
let history = store.get('supri-history', []);
let logEntries = store.get('supri-log', []);
let turn = null; // { id, controller, reply, streamDone, finished }
let turnSeq = 0;
let loudSince = 0;

const face = new Face3D($('scene'));
window.face = face;
const mic = new MicMonitor();

const tts = new TTSQueue({
  onStart: () => turn && !turn.finished && setState('SPEAKING'),
  onIdle: () => {
    if (!turn || turn.finished) return;
    if (turn.streamDone) finishTurn();
    else setState('THINKING'); // menunggu kalimat berikutnya dari LLM
  },
  onFallback: (reason) => {
    el.ttsMode.textContent = 'TTS: speechSynthesis (cadangan)';
    addLog('error', `Edge TTS gagal (${reason}), pakai suara browser.`);
  },
});

const stt = new STT({
  onInterim: (t) => {
    if (state === 'LISTENING') setLine(el.userLine, t + ' …', true);
  },
  onFinal: (t) => {
    if (state === 'LISTENING') handleUserText(t);
  },
  onError: (code) => {
    const msg = {
      'not-allowed': 'Izin mikrofon ditolak.',
      network: 'Speech recognition butuh koneksi internet.',
      'audio-capture': 'Mikrofon tidak ditemukan.',
    }[code] || `STT error: ${code}`;
    addLog('error', msg);
    showHint(msg, true);
    if (code === 'not-allowed' || code === 'audio-capture') setMic(false);
  },
});

function setState(s) {
  if (state === s) return;
  state = s;
  document.body.dataset.state = s;
  el.stateLabel.textContent = s;
  face.setState(s);
  el.interruptBtn.disabled = !(s === 'THINKING' || s === 'SPEAKING');
}

const restState = () => (micOn ? 'LISTENING' : 'IDLE');

function goRest() {
  setState(restState());
  if (micOn) stt.start();
}

// ---------- Alur percakapan ----------
async function handleUserText(raw) {
  const text = raw.trim();
  if (!text) return;
  if (turn && !turn.finished) interrupt({ silent: true });

  tts.unlock();
  stt.stop(); // jeda STT selama berpikir/bicara agar suara AI tidak ikut terekam
  setLine(el.userLine, text);
  setLine(el.aiLine, '…', true);
  addLog('user', text);
  history.push({ role: 'user', content: text });
  history = history.slice(-MAX_HISTORY);
  store.set('supri-history', history);

  const t = (turn = { id: ++turnSeq, controller: new AbortController(), reply: '', streamDone: false, finished: false });
  setState('THINKING');

  const splitter = new SentenceSplitter((sentence) => {
    if (turn === t) tts.enqueue(sentence);
  });

  try {
    await streamChat(history, {
      signal: t.controller.signal,
      onDelta: (d) => {
        t.reply += d;
        setLine(el.aiLine, t.reply);
        splitter.push(d);
      },
    });
    if (turn !== t) return;
    splitter.flush();
    t.streamDone = true;
    if (!t.reply.trim()) {
      addLog('error', 'Model tidak memberi jawaban.');
      return finishTurn();
    }
    if (!tts.busy) finishTurn();
  } catch (e) {
    if (e.name === 'AbortError' || turn !== t) return;
    const msg = /429|rate/i.test(e.message) ? 'Model gratis kena rate limit, coba lagi sebentar.' : `Gagal menghubungi AI: ${e.message}`;
    addLog('error', msg);
    showHint(msg, true);
    setLine(el.aiLine, '—', true);
    t.finished = true;
    turn = null;
    history.pop(); // pertanyaan gagal tidak disimpan di konteks
    store.set('supri-history', history);
    goRest();
  }
}

function finishTurn() {
  const t = turn;
  if (!t || t.finished) return;
  t.finished = true;
  turn = null;
  if (t.reply.trim()) {
    history.push({ role: 'assistant', content: t.reply.trim() });
    history = history.slice(-MAX_HISTORY);
    store.set('supri-history', history);
    addLog('assistant', t.reply.trim());
  }
  goRest();
}

function interrupt({ silent = false } = {}) {
  const t = turn;
  tts.stop();
  if (!t || t.finished) return;
  t.controller.abort();
  t.finished = true;
  turn = null;
  if (t.reply.trim()) {
    const partial = t.reply.trim() + ' …';
    history.push({ role: 'assistant', content: partial });
    history = history.slice(-MAX_HISTORY);
    store.set('supri-history', history);
    addLog('assistant', partial);
  } else {
    history.pop(); // belum ada jawaban → buang pertanyaan agar riwayat tetap berpasangan
    store.set('supri-history', history);
  }
  if (!silent) {
    addLog('system', 'Dipotong oleh user.');
    goRest();
  }
}

// ---------- Mikrofon ----------
async function setMic(on) {
  if (on && !sttSupported) {
    showHint(DEFAULT_HINT, true);
    return;
  }
  micOn = on;
  el.micBtn.setAttribute('aria-pressed', String(on));
  el.micBtnLabel.textContent = on ? 'MICROPHONE ON' : 'MICROPHONE OFF';
  if (on) {
    tts.unlock();
    try {
      await mic.open();
    } catch (e) {
      addLog('error', `Mikrofon tidak bisa dibuka: ${e.message}`);
      showHint('Izin mikrofon diperlukan.', true);
      return setMic(false);
    }
    if (!turn) goRest();
  } else {
    stt.stop();
    mic.close();
    if (!turn) setState('IDLE');
  }
}

// ---------- UI ----------
function setLine(node, text, muted = false) {
  node.textContent = text;
  node.classList.toggle('muted', muted);
  node.parentElement.scrollTop = node.parentElement.scrollHeight;
}

let hintTimer;
function showHint(text, isError = false) {
  el.hint.textContent = text;
  el.hint.classList.toggle('error', isError);
  clearTimeout(hintTimer);
  if (isError) hintTimer = setTimeout(() => showHint(DEFAULT_HINT), 6000);
}

const ROLE_NAME = { user: 'YOU', assistant: 'SUPRI', system: 'SYSTEM', error: 'ERROR' };
function addLog(role, text) {
  const entry = { role, text, time: new Date().toLocaleTimeString('id-ID', { hour12: false }) };
  logEntries.push(entry);
  logEntries = logEntries.slice(-200);
  store.set('supri-log', logEntries);
  renderLogEntry(entry);
}
function renderLogEntry({ role, text, time }) {
  const li = document.createElement('li');
  li.className = role;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = `${ROLE_NAME[role] ?? role} · ${time}`;
  const body = document.createElement('span');
  body.className = 'text';
  body.textContent = text;
  li.append(who, body);
  el.logList.append(li);
  el.logList.scrollTop = el.logList.scrollHeight;
}

function toggleLog(open = !el.logDrawer.classList.contains('open')) {
  el.logDrawer.classList.toggle('open', open);
  el.logDrawer.setAttribute('aria-hidden', String(!open));
}

const sensitivity = () => Number(el.sensitivity.value) / 100;
// Ambang suara: makin sensitif, makin kecil ambangnya.
const threshold = () => 0.6 - sensitivity() * 0.56;

function updateSensUI() {
  el.sensValue.textContent = `${el.sensitivity.value}%`;
  el.sensMarker.style.left = `${threshold() * 100}%`;
  prefs.set('supri-sens', el.sensitivity.value);
}

// ---------- Loop animasi: lip-sync, waveform, meter, voice interrupt ----------
const wctx = el.wave.getContext('2d');
function drawWave(data, color, gain) {
  const w = (el.wave.width = el.wave.clientWidth * devicePixelRatio);
  const h = (el.wave.height = el.wave.clientHeight * devicePixelRatio);
  wctx.clearRect(0, 0, w, h);
  wctx.lineWidth = 2 * devicePixelRatio;
  wctx.strokeStyle = color;
  wctx.shadowColor = color;
  wctx.shadowBlur = 10;
  wctx.beginPath();
  const n = 160;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const v = data ? data[Math.floor((i / n) * data.length)] * gain : 0;
    const env = Math.sin((i / (n - 1)) * Math.PI); // meruncing di ujung
    const y = h / 2 + Math.max(-1, Math.min(1, v)) * (h / 2 - 3) * env;
    i ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
  }
  wctx.stroke();
}

// Pratinjau visual tanpa mic/AI, mis. /?pose=SPEAKING (mulut disimulasikan).
const pose = new URLSearchParams(location.search).get('pose')?.toUpperCase();
const fakeWave = new Float32Array(256);
function frame(now) {
  const lvl = pose === 'SPEAKING' ? 0.5 + 0.5 * Math.sin(now / 90) : tts.level();
  face.setMouthTarget(lvl);

  const micLevel = mic.level();
  el.micMeter.style.width = `${micLevel * 100}%`;

  // Voice Interrupt: user bersuara di atas ambang selama ≥300 ms saat AI bicara.
  if (state === 'SPEAKING' && el.voiceInterrupt.checked && mic.active && micLevel > threshold()) {
    loudSince ||= now;
    if (now - loudSince > 300) {
      loudSince = 0;
      interrupt();
      addLog('system', 'Voice interrupt.');
    }
  } else loudSince = 0;

  if (state === 'SPEAKING') {
    let data = tts.waveform();
    if (!data) {
      for (let i = 0; i < fakeWave.length; i++) fakeWave[i] = Math.sin(i * 0.35 + now / 60) * lvl * 0.5 * Math.sin(i * 0.05 + now / 300);
      data = fakeWave;
    }
    drawWave(data, '#2aa8ff', 2.2);
  } else if (state === 'LISTENING' && mic.active) {
    drawWave(mic.waveform(), '#39ff88', 1 + sensitivity() * 5);
  } else {
    drawWave(null, state === 'THINKING' ? '#ffc24a' : 'rgba(42,168,255,0.5)', 1);
  }
  requestAnimationFrame(frame);
}

// ---------- Monitor sistem & jam ----------
async function pollSystem() {
  try {
    const r = await fetch('/api/system');
    if (!r.ok) throw new Error();
    const s = await r.json();
    el.cpuBar.style.width = `${s.cpu}%`;
    el.cpuVal.textContent = `${s.cpu}%`;
    el.ramBar.style.width = `${s.ram}%`;
    el.ramVal.textContent = `${s.ram}%`;
    el.netVal.textContent = `↓ ${s.rxKbs} KB/s · ↑ ${s.txKbs} KB/s`;
  } catch {
    el.netVal.textContent = 'server offline';
  }
}

function tickClock() {
  el.clock.textContent = new Date().toLocaleTimeString('id-ID', { hour12: false });
}

// ---------- Event ----------
el.micBtn.addEventListener('click', () => setMic(!micOn));
el.interruptBtn.addEventListener('click', () => interrupt());
el.cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.cmdInput.value;
  el.cmdInput.value = '';
  handleUserText(text);
});
el.sensitivity.addEventListener('input', updateSensUI);
el.voiceInterrupt.addEventListener('change', () => {
  prefs.set('supri-vi', el.voiceInterrupt.checked ? '1' : '0');
  if (el.voiceInterrupt.checked && !micOn) showHint('Voice Interrupt aktif saat mikrofon ON. Pakai headset agar suara AI tidak memicu interrupt.');
});
el.voiceSelect.addEventListener('change', () => {
  tts.voice = el.voiceSelect.value;
  const isClone = el.voiceSelect.value === 'clone';
  el.ttsMode.textContent = isClone
    ? 'TTS: Clone (FireRedTTS3)'
    : `TTS: Edge (${el.voiceSelect.selectedOptions[0]?.text?.split(' ')[0] ?? 'Ardi'})`;
  prefs.set('supri-voice', tts.voice);
});
el.langSelect.addEventListener('change', () => {
  stt.lang = el.langSelect.value;
  prefs.set('supri-lang', stt.lang);
  if (micOn && state === 'LISTENING') { stt.stop(); stt.start(); }
});
el.logBtn.addEventListener('click', () => toggleLog());
el.closeLogBtn.addEventListener('click', () => toggleLog(false));
el.clearLogBtn.addEventListener('click', () => {
  logEntries = [];
  history = [];
  store.set('supri-log', logEntries);
  store.set('supri-history', history);
  el.logList.replaceChildren();
});
el.fullBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (el.logDrawer.classList.contains('open')) toggleLog(false);
    else interrupt();
  }
});

// ---------- Init ----------
el.sensitivity.value = prefs.get('supri-sens', '60');
el.voiceInterrupt.checked = prefs.get('supri-vi', '0') === '1';
el.voiceSelect.value = prefs.get('supri-voice', 'clone');
el.langSelect.value = prefs.get('supri-lang', 'id-ID');
tts.voice = el.voiceSelect.value;
stt.lang = el.langSelect.value;
el.voiceSelect.dispatchEvent(new Event('change'));
updateSensUI();
logEntries.forEach(renderLogEntry);
showHint(DEFAULT_HINT);
fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    el.modelName.textContent = `MODEL ${c.model || '—'}`;
    if (!localStorage.getItem('supri-voice') && c.voice) {
      el.voiceSelect.value = c.voice;
      el.voiceSelect.dispatchEvent(new Event('change'));
    }
  })
  .catch(() => (el.modelName.textContent = 'SERVER OFFLINE'));
tickClock();
setInterval(tickClock, 1000);
pollSystem();
setInterval(pollSystem, 3000);
if (['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'].includes(pose)) setState(pose);
requestAnimationFrame(frame);
