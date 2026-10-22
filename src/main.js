// Orkestrasi: state machine IDLE → LISTENING → THINKING → SPEAKING → LISTENING.
import { Face3D } from './face3d.js';
import { STT, MicMonitor, sttSupported } from './stt.js';
import { TTSQueue } from './tts.js';
import { streamChat, SentenceSplitter } from './chat.js';

const $ = (id) => document.getElementById(id);
const el = {
  stateLabel: $('stateLabel'), clock: $('clock'), modelName: $('modelName'),
  micBtn: $('micBtn'), micBtnLabel: $('micBtnLabel'), interruptBtn: $('interruptBtn'),
  moshBtn: $('moshBtn'), moshBtnLabel: $('moshBtnLabel'),
  voiceInterrupt: $('voiceInterrupt'), sensitivity: $('sensitivity'), sensValue: $('sensValue'),
  micMeter: $('micMeter'), sensMarker: $('sensMarker'), voiceSelect: $('voiceSelect'), langSelect: $('langSelect'),
  logBtn: $('logBtn'), fullBtn: $('fullBtn'), logDrawer: $('logDrawer'), logList: $('logList'),
  clearLogBtn: $('clearLogBtn'), closeLogBtn: $('closeLogBtn'),
  cpuBar: $('cpuBar'), cpuVal: $('cpuVal'), ramBar: $('ramBar'), ramVal: $('ramVal'), netVal: $('netVal'),
  userLine: $('userLine'), aiLine: $('aiLine'), ttsMode: $('ttsMode'),
  tiktokUser: $('tiktokUser'), tiktokBtn: $('tiktokBtn'), tiktokDot: $('tiktokDot'),
  tiktokStatusText: $('tiktokStatusText'), tiktokViewerCount: $('tiktokViewerCount'),
  tiktokInfo: $('tiktokInfo'), tiktokQueueNotice: $('tiktokQueueNotice'), tiktokQueueCount: $('tiktokQueueCount'),
  tiktokAutoGreet: $('tiktokAutoGreet'),
  chatToggleRow: $('chatToggleRow'), openChatBtn: $('openChatBtn'), closeChatBtn: $('closeChatBtn'),
  wave: $('wave'), cmdForm: $('cmdForm'), cmdInput: $('cmdInput'), hint: $('hint'),
};

const MAX_HISTORY = 10;
const DEFAULT_HINT = sttSupported
  ? 'Tekan MICROPHONE lalu bicara, atau ketik komentar TikTok · ESC untuk interrupt'
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
  onStart: () => setState('SPEAKING'),
  onIdle: () => {
    if (turn && !turn.finished) {
      if (turn.streamDone) finishTurn();
      else setState('THINKING'); // menunggu kalimat berikutnya dari LLM
    } else {
      goRest();
    }
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
  el.interruptBtn.disabled = !(s === 'THINKING' || s === 'SPEAKING' || s === 'MOSHING');
}

const restState = () => (isMusicPlaying ? 'MOSHING' : micOn ? 'LISTENING' : 'IDLE');

function goRest() {
  setState(restState());
  if (micOn) stt.start();
  // Periksa apakah ada antrean komentar atau sapaan penonton yang menunggu
  setTimeout(() => {
    if (tiktokChatQueue.length > 0) {
      tryProcessNextTiktokChat();
    } else {
      tryProcessNextJoinGreeting();
    }
  }, 1000);
}

// ---------- Musik & Joget Mosing Iphonekupi ----------
const musicAudio = new Audio('/music/song-iphonekupi.mp3');
musicAudio.preload = 'auto';
let isMusicPlaying = false;
let musicSource = null;
let musicAnalyser = null;
const musicWaveData = new Float32Array(512);

function initMusicAnalyser() {
  tts.unlock();
  if (!musicSource && tts.ctx) {
    try {
      musicSource = tts.ctx.createMediaElementSource(musicAudio);
      musicAnalyser = tts.ctx.createAnalyser();
      musicAnalyser.fftSize = 1024;
      musicAnalyser.smoothingTimeConstant = 0.3;
      musicSource.connect(musicAnalyser);
      musicAnalyser.connect(tts.ctx.destination);
    } catch (err) {
      console.warn('[music] MediaElementSource init:', err);
    }
  }
  return musicAnalyser;
}

function startIphonekupiMosh({
  intro = true,
  customIntro = null,
  userLabel = 'stel lagu iphonekupi',
  aiLabel = '🎵 PLAYING: SONG IPHONEKUPI · MOSHPIT PARTY ON 🤘',
} = {}) {
  tts.unlock();
  initMusicAnalyser();
  isMusicPlaying = true;
  musicAudio.currentTime = 0;
  musicAudio.volume = 1.0;
  musicAudio.play().catch((err) => console.warn('[music] play error:', err));
  face.setMoshing(true);
  setState('MOSHING');
  if (el.moshBtn) el.moshBtn.classList.add('active');
  if (el.moshBtnLabel) el.moshBtnLabel.textContent = '⏹ STOP MOSHING';
  el.interruptBtn.disabled = false;
  setLine(el.userLine, userLabel);
  setLine(el.aiLine, aiLabel);

  const introText = customIntro || 'Anjay lagu iphonekupi! Gas moshpit bro senggol dong! Tap-tap layar sambil joget!';
  addLog('assistant', introText);
  if (intro || customIntro) {
    tts.enqueue(introText);
  }
}

function stopIphonekupiMosh() {
  if (!isMusicPlaying) return;
  isMusicPlaying = false;
  musicAudio.pause();
  musicAudio.currentTime = 0;
  face.setMoshing(false);
  if (el.moshBtn) el.moshBtn.classList.remove('active');
  if (el.moshBtnLabel) el.moshBtnLabel.textContent = '🎵 IPHONEKUPI MOSH';
  setLine(el.aiLine, 'Musik iphonekupi distop.');
  addLog('system', 'Musik iphonekupi dihentikan.');
  goRest();
}

musicAudio.onended = () => {
  stopIphonekupiMosh();
};

// ---------- Alur percakapan ----------
const LAUGH_REGEX = /wkwk|haha|hehe|hihi|xixi|kocak|ngakak|lucu|canda|roasting|bjir|anjir|lawak|gokil|mikir keras/i;

async function handleUserText(raw) {
  const text = raw.trim();
  if (!text) return;

  // Deteksi perintah lagu iphonekupi
  const isIphonekupi = /stel.*iphonekupi|setel.*iphonekupi|putar.*iphonekupi|mainkan.*iphonekupi|nyalain.*iphonekupi|play.*iphonekupi|\biphonekupi\b/i.test(text);
  const isStopMusic = isMusicPlaying && /stop|berhenti|pause|matiin|cukup/i.test(text);

  if (isStopMusic) {
    stopIphonekupiMosh();
    setLine(el.userLine, text);
    return;
  }

  if (isIphonekupi) {
    setLine(el.userLine, text);
    addLog('user', text);
    startIphonekupiMosh({ intro: true });
    return;
  }

  // Jika teks user ada tawa, aktifkan ekspresi nyengir & sipit
  if (LAUGH_REGEX.test(text)) {
    face.triggerLaugh(2.5);
  }

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
    if (turn === t) {
      if (LAUGH_REGEX.test(sentence)) {
        face.triggerLaugh(Math.max(2.8, sentence.length * 0.09));
      }
      tts.enqueue(sentence);
    }
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
  if (isMusicPlaying) stopIphonekupiMosh();
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
let nextFunTime = performance.now() + 12000;
function frame(now) {
  const lvl = pose === 'SPEAKING' ? 0.5 + 0.5 * Math.sin(now / 90) : tts.level();
  face.setMouthTarget(lvl);

  const micLevel = mic.level();
  el.micMeter.style.width = `${micLevel * 100}%`;

  // Mimik muka seru acak sesekali saat IDLE
  if (state === 'IDLE' && !isMusicPlaying) {
    if (now > nextFunTime) {
      face.setGrin(0.38 + Math.random() * 0.25);
      face.setSquint(0.32 + Math.random() * 0.25);
      setTimeout(() => {
        if (!face.isMoshing && face.laughTimer <= 0) {
          face.setGrin(0);
          face.setSquint(0);
        }
      }, 1800);
      nextFunTime = now + 15000 + Math.random() * 15000;
    }
  }

  // Voice Interrupt: user bersuara di atas ambang selama ≥300 ms saat AI bicara.
  if (state === 'SPEAKING' && el.voiceInterrupt.checked && mic.active && micLevel > threshold()) {
    loudSince ||= now;
    if (now - loudSince > 300) {
      loudSince = 0;
      interrupt();
      addLog('system', 'Voice interrupt.');
    }
  } else loudSince = 0;

  if (isMusicPlaying) {
    // Audio ducking: saat Supri ngomong, kecilkan volume lagu agar suara AI jelas
    musicAudio.volume = state === 'SPEAKING' ? 0.25 : 1.0;

    let musicLvl = 0;
    if (musicAnalyser) {
      musicAnalyser.getFloatTimeDomainData(musicWaveData);
      let sum = 0;
      for (const v of musicWaveData) sum += v * v;
      const rms = Math.sqrt(sum / musicWaveData.length);
      musicLvl = Math.min(1, Math.max(0, (rms - 0.01) * 6));
      drawWave(musicWaveData, '#ff007f', 2.2);
    }
    if (state !== 'SPEAKING') face.setMouthTarget(musicLvl * 0.45);
  } else if (state === 'SPEAKING') {
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

// ---------- TikTok Live Streaming Controller & Queue ----------
let tiktokEventSource = null;
const tiktokChatQueue = [];
let isProcessingTiktokChat = false;

function updateTiktokQueueUI() {
  if (!el.tiktokQueueNotice) return;
  const count = tiktokChatQueue.length;
  if (count > 0) {
    el.tiktokQueueNotice.style.display = 'flex';
    if (el.tiktokQueueCount) el.tiktokQueueCount.textContent = count;
  } else {
    el.tiktokQueueNotice.style.display = 'none';
  }
}

function updateTiktokStatusUI(status) {
  if (!el.tiktokStatusText) return;
  if (status.connected) {
    el.tiktokStatusText.textContent = 'LIVE';
    el.tiktokStatusText.style.color = 'var(--green)';
    if (el.tiktokDot) {
      el.tiktokDot.className = 'tiktok-dot active';
    }
    if (el.tiktokBtn) {
      el.tiktokBtn.textContent = 'DISCONNECT';
      el.tiktokBtn.classList.add('connected');
      el.tiktokBtn.disabled = false;
    }
    if (el.tiktokInfo) {
      el.tiktokInfo.textContent = `Room ID: ${status.roomId || '—'} · @${status.username}`;
    }
    if (el.tiktokViewerCount) {
      el.tiktokViewerCount.textContent = status.viewerCount ? `👁 ${status.viewerCount}` : '';
    }
  } else {
    el.tiktokStatusText.textContent = status.error ? 'ERROR' : 'OFFLINE';
    el.tiktokStatusText.style.color = status.error ? 'var(--red)' : 'var(--muted)';
    if (el.tiktokDot) {
      el.tiktokDot.className = 'tiktok-dot';
    }
    if (el.tiktokBtn) {
      el.tiktokBtn.textContent = 'CONNECT';
      el.tiktokBtn.classList.remove('connected');
      el.tiktokBtn.disabled = false;
    }
    if (el.tiktokInfo) {
      el.tiktokInfo.textContent = status.error || 'Belum terhubung ke room.';
    }
    if (el.tiktokViewerCount) {
      el.tiktokViewerCount.textContent = '';
    }
  }
}

function initTiktokSSE() {
  if (tiktokEventSource) {
    try { tiktokEventSource.close(); } catch (_) {}
  }

  tiktokEventSource = new EventSource('/api/tiktok/events');

  tiktokEventSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateTiktokStatusUI(data);
    } catch (_) {}
  });

  tiktokEventSource.addEventListener('connected', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateTiktokStatusUI({ connected: true, username: data.username, roomId: data.roomId });
      addLog('system', `[TikTok Live] Terhubung ke room @${data.username} (${data.roomId})`);
      showHint(`TikTok Live terhubung ke @${data.username}! Siap menjawab komentar penonton.`);
    } catch (_) {}
  });

  tiktokEventSource.addEventListener('disconnected', () => {
    updateTiktokStatusUI({ connected: false });
    addLog('system', '[TikTok Live] Koneksi terputus.');
  });

  tiktokEventSource.addEventListener('streamEnd', () => {
    updateTiktokStatusUI({ connected: false, error: 'Siaran live telah berakhir.' });
    addLog('system', '[TikTok Live] Siaran live telah berakhir.');
  });

  tiktokEventSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateTiktokStatusUI({ connected: false, error: data.error });
    } catch (_) {}
  });

  tiktokEventSource.addEventListener('viewers', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (el.tiktokViewerCount) {
        el.tiktokViewerCount.textContent = `👁 ${data.viewerCount}`;
      }
    } catch (_) {}
  });

  tiktokEventSource.addEventListener('chat', (e) => {
    try {
      const data = JSON.parse(e.data);
      enqueueTiktokChat(data);
    } catch (err) {
      console.warn('[tiktok sse] chat parse error:', err);
    }
  });

  tiktokEventSource.addEventListener('gift', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleTiktokGift(data);
    } catch (err) {
      console.warn('[tiktok sse] gift parse error:', err);
    }
  });

  tiktokEventSource.addEventListener('member', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleTiktokMemberJoin(data);
    } catch (err) {
      console.warn('[tiktok sse] member parse error:', err);
    }
  });

  tiktokEventSource.addEventListener('like', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.likeCount >= 10 || (data.totalLikes && data.totalLikes % 50 === 0)) {
        if (state === 'IDLE' && !isMusicPlaying) {
          face.triggerLaugh(1.2);
        }
      }
    } catch (_) {}
  });
}

function enqueueTiktokChat({ user, comment, nickname }) {
  const cleanComment = (comment || '').trim();
  if (!cleanComment) return;

  addLog('user', `[Live @${user}]: ${cleanComment}`);

  if (tiktokChatQueue.length > 25) {
    tiktokChatQueue.shift();
  }

  tiktokChatQueue.push({ user, comment: cleanComment, nickname: nickname || user });
  updateTiktokQueueUI();
  tryProcessNextTiktokChat();
}

function handleTiktokGift({ user, giftName, repeatCount }) {
  const countStr = repeatCount && repeatCount > 1 ? ` x${repeatCount}` : '';
  const giftDisplay = giftName || 'saweran';
  const giftMsg = `🎁 @${user} kirim ${giftDisplay}${countStr}!`;
  addLog('system', giftMsg);

  // Jika lagu moshing belum berputar: langsung nyalakan lagu moshing iphonekupi!
  if (!isMusicPlaying) {
    const thankIntro = `Wanjay saweran masuk dari ${user}! Kirim ${giftDisplay}! Gas moshpit lagu iphonekupi bro senggol dong!`;
    startIphonekupiMosh({
      intro: false,
      customIntro: thankIntro,
      userLabel: `🎁 Saweran @${user}: ${giftDisplay}${countStr}`,
      aiLabel: `🎵 SAWERAN DARI @${user} · IPHONEKUPI MOSH 🤘`,
    });
  } else {
    // Jika musik sudah menyala, serukan terima kasih sambil terus joget moshing!
    const shoutOut = `Mantap lagi dari ${user} sawer ${giftDisplay}! Menyala bro!`;
    tts.unlock();
    face.triggerLaugh(2.5);
    setLine(el.aiLine, `🎵 ${shoutOut}`);
    addLog('assistant', shoutOut);
    tts.enqueue(shoutOut);
  }
}

async function tryProcessNextTiktokChat() {
  if (isProcessingTiktokChat) return;
  if (tiktokChatQueue.length === 0) return;

  if (state !== 'IDLE') return;
  if (isMusicPlaying) return;

  const item = tiktokChatQueue.shift();
  updateTiktokQueueUI();
  isProcessingTiktokChat = true;

  try {
    setLine(el.userLine, `@${item.user}: ${item.comment}`);
    await handleUserText(`${item.user}: ${item.comment}`);
  } catch (err) {
    console.error('[tiktok chat error]', err);
  } finally {
    isProcessingTiktokChat = false;
    setTimeout(() => {
      if (tiktokChatQueue.length > 0) {
        tryProcessNextTiktokChat();
      } else {
        tryProcessNextJoinGreeting();
      }
    }, 2000);
  }
}

// ---------- TikTok Join Greet Queue & Deduplication ----------
const tiktokJoinQueue = [];
const recentlyGreeted = new Map(); // username/displayId -> timestamp
let isGreetingJoin = false;

function cleanViewerName(rawName) {
  if (!rawName) return 'kawan';
  let cleaned = String(rawName)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}]/gu, '')
    .replace(/[@#_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) {
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length > 2) {
      cleaned = parts.slice(0, 2).join(' ');
    }
    if (/[a-zA-Z0-9]/.test(cleaned)) {
      return cleaned.slice(0, 20);
    }
  }
  return String(rawName).slice(0, 15) || 'kawan';
}

const GREETING_TEMPLATES = [
  (name) => `Halo ka ${name}, selamat datang di live!`,
  (name) => `Halo ka ${name}, welcome! Tap-tap layarnya ya!`,
  (name) => `Halo ka ${name}, selamat bergabung! Santuy bareng kita di sini!`,
  (name) => `Halo ka ${name}! Salam kenal, thank you udah mampir!`,
  (name) => `Halo ka ${name}! Welcome to the stream bro!`,
  (name) => `Halo ka ${name}, apa kabar nih? Selamat datang di live!`,
];

function handleTiktokMemberJoin(data) {
  const autoGreetOn = el.tiktokAutoGreet ? el.tiktokAutoGreet.checked : true;
  if (!autoGreetOn) return;

  const user = (data.user || '').trim();
  const nickname = (data.nickname || '').trim();
  const key = (user || nickname).toLowerCase();
  if (!key) return;

  const now = Date.now();
  // Cegah spam: jika user yang sama sudah disapa dalam 60 detik terakhir, abaikan
  if (recentlyGreeted.has(key) && (now - recentlyGreeted.get(key) < 60000)) {
    return;
  }
  recentlyGreeted.set(key, now);

  // Bersihkan data lama di Map jika menumpuk
  if (recentlyGreeted.size > 200) {
    for (const [k, time] of recentlyGreeted.entries()) {
      if (now - time > 120000) recentlyGreeted.delete(k);
    }
  }

  const displayName = cleanViewerName(nickname || user);
  addLog('system', `[Live Join] @${user || nickname} bergabung.`);

  // Batasi antrean agar tidak menumpuk saat penonton membludak
  if (tiktokJoinQueue.length < 8) {
    tiktokJoinQueue.push(displayName);
  }

  tryProcessNextJoinGreeting();
}

async function tryProcessNextJoinGreeting() {
  if (isGreetingJoin) return;
  if (tiktokJoinQueue.length === 0) return;

  // Jangan menyela jika Supri sedang berbicara, berpikir, atau musik mosh menyala
  if (state !== 'IDLE') return;
  if (isMusicPlaying) return;
  // Jika ada antrean komentar chat, prioritaskan merespons chat
  if (tiktokChatQueue.length > 0) return;

  isGreetingJoin = true;

  // Jika ada 2 atau lebih penonton dalam antrean, sapa berpasangan agar lebih efisien
  let greetText = '';
  if (tiktokJoinQueue.length >= 2) {
    const name1 = tiktokJoinQueue.shift();
    const name2 = tiktokJoinQueue.shift();
    greetText = `Halo ka ${name1} dan ka ${name2}, selamat datang di live! Tap-tap layarnya ya!`;
  } else {
    const name = tiktokJoinQueue.shift();
    const template = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
    greetText = template(name);
  }

  // Tampilkan sapaan di HUD UI
  setLine(el.aiLine, greetText);
  addLog('assistant', greetText);

  // Wajah senyum ramah
  face.setGrin(0.48);
  setTimeout(() => {
    if (!face.isMoshing && face.laughTimer <= 0) face.setGrin(0);
  }, 2200);

  // Suarakan via TTS
  tts.unlock();
  tts.enqueue(greetText);

  // Berikan jeda setelah menyapa sebelum memproses antrean berikutnya
  setTimeout(() => {
    isGreetingJoin = false;
    if (tiktokChatQueue.length > 0) {
      tryProcessNextTiktokChat();
    } else {
      tryProcessNextJoinGreeting();
    }
  }, 3200);
}

async function toggleTiktokConnection() {
  if (!el.tiktokUser || !el.tiktokBtn) return;
  const isConnected = el.tiktokBtn.classList.contains('connected');

  if (isConnected) {
    el.tiktokBtn.disabled = true;
    try {
      await fetch('/api/tiktok/disconnect', { method: 'POST' });
    } catch (err) {
      console.warn('Disconnect error:', err);
    } finally {
      el.tiktokBtn.disabled = false;
    }
  } else {
    let username = el.tiktokUser.value.trim();
    if (!username) {
      showHint('Masukkan username TikTok streamer yang sedang LIVE!');
      el.tiktokUser.focus();
      return;
    }
    username = username.replace(/^@/, '');
    prefs.set('supri-tiktok-user', username);

    el.tiktokBtn.disabled = true;
    if (el.tiktokDot) el.tiktokDot.className = 'tiktok-dot connecting';
    if (el.tiktokStatusText) el.tiktokStatusText.textContent = 'CONNECTING...';
    if (el.tiktokInfo) el.tiktokInfo.textContent = `Menghubungkan ke @${username}...`;

    try {
      const res = await fetch('/api/tiktok/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal konek');
      updateTiktokStatusUI({ connected: true, username: data.username, roomId: data.roomId });
    } catch (err) {
      updateTiktokStatusUI({ connected: false, error: err.message });
      showHint(`Gagal konek ke @${username}: ${err.message}`);
    } finally {
      el.tiktokBtn.disabled = false;
    }
  }
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
if (el.moshBtn) {
  el.moshBtn.addEventListener('click', () => {
    if (isMusicPlaying) stopIphonekupiMosh();
    else startIphonekupiMosh({ intro: true });
  });
}
if (el.tiktokBtn) {
  el.tiktokBtn.addEventListener('click', () => toggleTiktokConnection());
}
if (el.tiktokUser) {
  el.tiktokUser.value = prefs.get('supri-tiktok-user', '');
  el.tiktokUser.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      toggleTiktokConnection();
    }
  });
}
function toggleChatInput(show = el.cmdForm.style.display === 'none') {
  if (show) {
    el.cmdForm.style.display = 'flex';
    if (el.chatToggleRow) el.chatToggleRow.style.display = 'none';
    el.cmdInput.focus();
    showHint('Ketik komentar TikTok lalu tekan ENTER atau SEND · ESC untuk tutup');
  } else {
    el.cmdForm.style.display = 'none';
    if (el.chatToggleRow) el.chatToggleRow.style.display = 'flex';
    el.cmdInput.blur();
    showHint(DEFAULT_HINT);
  }
}

if (el.openChatBtn) {
  el.openChatBtn.addEventListener('click', () => toggleChatInput(true));
}
if (el.closeChatBtn) {
  el.closeChatBtn.addEventListener('click', () => toggleChatInput(false));
}

el.cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.cmdInput.value;
  el.cmdInput.value = '';
  toggleChatInput(false);
  handleUserText(text);
});
el.sensitivity.addEventListener('input', updateSensUI);
el.voiceInterrupt.addEventListener('change', () => {
  prefs.set('supri-vi', el.voiceInterrupt.checked ? '1' : '0');
  if (el.voiceInterrupt.checked && !micOn) showHint('Voice Interrupt aktif saat mikrofon ON. Pakai headset agar suara AI tidak memicu interrupt.');
});
el.voiceSelect.addEventListener('change', () => {
  tts.voice = el.voiceSelect.value;
  const val = el.voiceSelect.value;
  const opt = el.voiceSelect.selectedOptions[0];
  const optText = opt?.text || '';

  if (val === 'clone') {
    el.ttsMode.textContent = 'TTS: Clone (FireRedTTS3)';
  } else if (val.startsWith('fish')) {
    const shortName = optText.split('(')[0].split('–')[0].trim() || 'Fish';
    el.ttsMode.textContent = `TTS: Fish (${shortName})`;
  } else if (val.startsWith('elevenlabs')) {
    const shortName = optText.split('(')[0].split('–')[0].trim() || 'ElevenLabs';
    el.ttsMode.textContent = `TTS: 11Labs (${shortName})`;
  } else {
    const shortName = optText.split('(')[0].trim() || 'Edge';
    el.ttsMode.textContent = `TTS: Edge (${shortName})`;
  }
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
    if (el.cmdForm && el.cmdForm.style.display !== 'none') {
      toggleChatInput(false);
      return;
    }
    if (el.logDrawer.classList.contains('open')) toggleLog(false);
    else interrupt();
  }
  // Tekan 'c' / 'C' saat tidak sedang fokus di text input untuk cepat buka kolom komentar
  if (
    (e.key === 'c' || e.key === 'C') &&
    document.activeElement !== el.cmdInput &&
    document.activeElement !== el.tiktokUser
  ) {
    if (el.cmdForm && el.cmdForm.style.display === 'none') {
      e.preventDefault();
      toggleChatInput(true);
    }
  }
});

// ---------- Init ----------
el.sensitivity.value = prefs.get('supri-sens', '60');
el.voiceInterrupt.checked = prefs.get('supri-vi', '0') === '1';
let savedVoice = prefs.get('supri-voice', 'clone');
if (savedVoice === 'elevenlabs-sarah') savedVoice = 'elevenlabs:EXAVITQu4vr4xnSDxMaL';
if (savedVoice === 'elevenlabs-brian') savedVoice = 'elevenlabs:nPczCjzI2devNBz1zQrb';
if (savedVoice === 'elevenlabs-citra') savedVoice = 'elevenlabs:RbNgJzKAV7jpYJNtCBpj';
if (savedVoice === 'fish') savedVoice = 'fish:b8d594e696694b499aa12e32d0c1b618';

el.voiceSelect.value = savedVoice;
if (!el.voiceSelect.value) {
  el.voiceSelect.value = 'elevenlabs:EXAVITQu4vr4xnSDxMaL';
  if (!el.voiceSelect.value) el.voiceSelect.value = 'clone';
}
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
initTiktokSSE();
if (['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'].includes(pose)) setState(pose);
requestAnimationFrame(frame);
