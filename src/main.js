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
  liveModeBtn: $('liveModeBtn'), liveModeLabel: $('liveModeLabel'),
  zoomBtn: $('zoomBtn'), zoomLabel: $('zoomLabel'), obsCleanBtn: $('obsCleanBtn'),
  stageRoomInfo: $('stageRoomInfo'), stageViewerInfo: $('stageViewerInfo'),
  sultanList: $('sultanList'), streamLikeCount: $('streamLikeCount'), likeHeartIcon: $('likeHeartIcon'),
  recentTapFlash: $('recentTapFlash'), recentTapText: $('recentTapText'),
  tappersList: $('tappersList'), floatingHearts: $('floatingHearts'),
  streamCaptionText: $('streamCaptionText'),
  autoNewsToggle: $('autoNewsToggle'), autoNewsLabel: $('autoNewsLabel'),
  testGiftBtn: $('testGiftBtn'), testLikeBtn: $('testLikeBtn'), testNewsBtn: $('testNewsBtn'), resetStatsBtn: $('resetStatsBtn'),
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

let lastChatActivityTime = Date.now();
let isSpeakingNews = false;
function recordChatActivity() {
  lastChatActivityTime = Date.now();
}

const restState = () => (isMusicPlaying ? 'MOSHING' : micOn ? 'LISTENING' : 'IDLE');

function goRest() {
  setState(restState());
  recordChatActivity();
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

  const introText = customIntro || 'Anjay lagu iphonekupi! Gas moshpit level sigma chat no cap! Tap-tap layar sambil joget!';
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

  // Deteksi perintah joget atau lagu iphonekupi
  const isJoget = /\bjoget\b|\bmosh\b|\bmoshpit\b|\bgoyang\b|\bdance\b/i.test(text);
  const isIphonekupi = /stel.*iphonekupi|setel.*iphonekupi|putar.*iphonekupi|mainkan.*iphonekupi|nyalain.*iphonekupi|play.*iphonekupi|\biphonekupi\b/i.test(text);
  const isStopMusic = isMusicPlaying && /stop|berhenti|pause|matiin|cukup/i.test(text);

  if (isStopMusic) {
    stopIphonekupiMosh();
    setLine(el.userLine, text);
    recordChatActivity();
    return;
  }

  if (isJoget || isIphonekupi) {
    setLine(el.userLine, text);
    addLog('user', text);
    if (isMusicPlaying) {
      const shoutText = 'Asoy! Ini udah moshpit lagu iphonekupi level sigma chat! Gas terus no cap!';
      setLine(el.aiLine, `🎵 ${shoutText}`);
      addLog('assistant', shoutText);
      tts.unlock();
      face.triggerLaugh(2.0);
      tts.enqueue(shoutText);
      recordChatActivity();
      return;
    }
    const customIntro = isJoget
      ? 'Wanjay riil! Ada yang minta joget nih chat! Lagu iphonekupi langsung kita gas moshpit level sigma fiks no counter!'
      : undefined;
    startIphonekupiMosh({ intro: true, customIntro });
    recordChatActivity();
    return;
  }

  recordChatActivity();

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

function interrupt({ silent = false, stopMusic = false } = {}) {
  if (stopMusic && isMusicPlaying) stopIphonekupiMosh();
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
  if (node === el.aiLine && el.streamCaptionText) {
    el.streamCaptionText.textContent = text && text !== '…' && text !== '—' ? text : 'Siap menemani live streaming TikTok!';
  }
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
    musicAudio.volume = (state === 'SPEAKING' || tts.busy) ? 0.25 : 1.0;

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

// ---------- 9:16 Live Stream Mode & Zoom Controller ----------
let isLiveMode916 = prefs.get('supri-live-916', 'true') === 'true';
let isZoomOut = prefs.get('supri-zoom-out', 'true') === 'true';
let isObsClean = new URLSearchParams(location.search).get('stream') === '1' || new URLSearchParams(location.search).get('clean') === '1';

function setLiveMode916(active) {
  isLiveMode916 = !!active;
  prefs.set('supri-live-916', isLiveMode916 ? 'true' : 'false');
  document.body.classList.toggle('live-9-16-active', isLiveMode916);
  if (el.liveModeBtn) {
    el.liveModeBtn.classList.toggle('active', isLiveMode916);
    if (el.liveModeLabel) el.liveModeLabel.textContent = isLiveMode916 ? 'FRAME 9:16' : 'FULL SCREEN';
  }
  face.setStreamMode(isLiveMode916);
  face.setZoomOut(isZoomOut);
  setTimeout(() => face.resize(), 60);
}

function setZoomOut(active) {
  isZoomOut = !!active;
  prefs.set('supri-zoom-out', isZoomOut ? 'true' : 'false');
  if (el.zoomBtn) {
    el.zoomBtn.classList.toggle('active', isZoomOut);
    if (el.zoomLabel) el.zoomLabel.textContent = isZoomOut ? '🔍 ZOOM OUT' : '🔍 ZOOM CLOSE';
  }
  face.setZoomOut(isZoomOut);
}

function setObsClean(active) {
  isObsClean = !!active;
  document.body.classList.toggle('obs-clean-mode', isObsClean);
  if (el.obsCleanBtn) {
    el.obsCleanBtn.classList.toggle('active', isObsClean);
  }
  setTimeout(() => face.resize(), 60);
}

function formatCount(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('id-ID');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSultanList(topGifters) {
  if (!el.sultanList) return;
  if (!topGifters || topGifters.length === 0) {
    el.sultanList.innerHTML = '<div class="sultan-empty">Menunggu Sultan... 💎</div>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  const html = topGifters.map((g, idx) => {
    const rank = idx + 1;
    const rankClass = `rank-${rank}`;
    const medal = medals[idx] || `${rank}.`;
    const name = g.nickname || g.user || 'Sultan';
    const diamonds = formatCount(g.totalDiamonds || g.totalGifts || 0);
    const giftDesc = g.lastGift ? `${g.lastGift} x${g.totalGifts || 1}` : 'Saweran';

    return `
      <div class="sultan-item ${rankClass}">
        <div class="sultan-rank-badge">${medal}</div>
        <div class="sultan-user-col">
          <div class="sultan-name" title="@${escapeHtml(g.user)}">${escapeHtml(name)}</div>
          <div class="sultan-gift-desc">${escapeHtml(giftDesc)}</div>
        </div>
        <div class="sultan-diamonds">💎 ${diamonds}</div>
      </div>
    `;
  }).join('');

  el.sultanList.innerHTML = html;
}

function renderTappersList(topTappers) {
  if (!el.tappersList) return;
  if (!topTappers || topTappers.length === 0) {
    el.tappersList.innerHTML = '<div class="tapper-empty">Yuk bantu tap-tap layar! ✨</div>';
    return;
  }

  const html = topTappers.slice(0, 3).map((t, idx) => {
    const rank = idx + 1;
    const name = t.nickname || t.user || 'Kawan';
    const count = formatCount(t.totalLikes || 0);
    return `
      <div class="tapper-item">
        <span class="tapper-name" title="@${escapeHtml(t.user)}">#${rank} ${escapeHtml(name)}</span>
        <span class="tapper-count">❤️ ${count}</span>
      </div>
    `;
  }).join('');

  el.tappersList.innerHTML = html;
}

function updateLikesUI(totalLikes) {
  if (el.streamLikeCount) {
    el.streamLikeCount.textContent = formatCount(totalLikes);
  }
}

function spawnFloatingHearts(count = 2) {
  if (!el.floatingHearts) return;
  const hearts = ['❤️', '💖', '💘', '✨', '🔥'];
  const num = Math.min(Math.max(1, count), 4);
  for (let i = 0; i < num; i++) {
    const span = document.createElement('span');
    span.className = 'floating-heart';
    span.textContent = hearts[Math.floor(Math.random() * hearts.length)];
    const leftPercent = 68 + Math.random() * 26;
    span.style.left = `${leftPercent}%`;
    span.style.fontSize = `${14 + Math.random() * 12}px`;
    span.style.animationDuration = `${1.4 + Math.random() * 0.7}s`;
    el.floatingHearts.appendChild(span);
    setTimeout(() => span.remove(), 2100);
  }
}

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
      el.tiktokViewerCount.textContent = status.viewerCount ? `👁 ${formatCount(status.viewerCount)}` : '';
    }
    if (el.stageRoomInfo) {
      el.stageRoomInfo.textContent = `@${status.username}`;
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
    if (el.stageRoomInfo) {
      el.stageRoomInfo.textContent = status.error ? 'ERROR' : 'OFFLINE';
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

  tiktokEventSource.addEventListener('leaderboard', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.topGifters) renderSultanList(data.topGifters);
      if (data.topTappers) renderTappersList(data.topTappers);
      if (data.totalLikes !== undefined) updateLikesUI(data.totalLikes);
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
        el.tiktokViewerCount.textContent = `👁 ${formatCount(data.viewerCount)}`;
      }
      if (el.stageViewerInfo) {
        el.stageViewerInfo.textContent = `👁 ${formatCount(data.viewerCount)}`;
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
      if (data.totalLikes !== undefined) {
        updateLikesUI(data.totalLikes);
      }
      if (el.likeHeartIcon) {
        el.likeHeartIcon.classList.remove('beat');
        void el.likeHeartIcon.offsetWidth;
        el.likeHeartIcon.classList.add('beat');
      }
      if (el.recentTapFlash && (data.user || data.nickname)) {
        el.recentTapFlash.style.display = 'flex';
        if (el.recentTapText) {
          const userStr = data.nickname || data.user || 'Kawan';
          const tapCount = data.likeCount ? ` (+${data.likeCount} tap)` : '';
          el.recentTapText.textContent = `@${userStr}${tapCount}`;
        }
      }
      spawnFloatingHearts(Math.min(4, Math.ceil((data.likeCount || 1) / 3)));

      if (data.likeCount >= 10 || (data.totalLikes && data.totalLikes % 50 === 0)) {
        if (state === 'IDLE' && !isMusicPlaying) {
          face.triggerLaugh(1.2);
        }
      }
    } catch (_) {}
  });
}

// ---------- Smart Chat Queue Management ----------
const MAX_SMART_QUEUE = 6;
const CHAT_STALE_MS = 25000; // Komentar lebih dari 25 detik dianggap basi saat antrean padat

function scoreTiktokComment(item) {
  const comment = (item.comment || '').toLowerCase().trim();
  let score = 0;

  // 1. Perintah aksi (joget / mosh / musik) = Prioritas Tertinggi (+10)
  if (/\bjoget\b|\bmosh\b|\bmoshpit\b|\bgoyang\b|\bdance\b|iphonekupi/i.test(comment)) {
    score += 10;
  }

  // 2. Pertanyaan interaktif (ada tanda tanya atau kata tanya) = Prioritas Tinggi (+6)
  if (/\?|kenapa|mengapa|bagaimana|gimana|apa|siapa|kapan|dimana|kok|bisa|apakah|beneran/i.test(comment)) {
    score += 6;
  }

  // 3. Pesan bermakna / panjang kalimat cukup (bukan spam) = (+3)
  if (comment.length >= 10) {
    score += 3;
  }

  // 4. Pengurang untuk pesan spam pendek / satu huruf ("p", "halo", "hai", single emoji) = (-3)
  if (comment.length <= 3 || /^(p+|halo+|hai+|tes+|test+|y+|ok+|oke+|wkwk+)$/i.test(comment)) {
    score -= 3;
  }

  // 5. Bonus kesegaran: komentar lebih baru dapat sedikit bobot tambahan (+2)
  const ageSec = (Date.now() - (item.timestamp || Date.now())) / 1000;
  if (ageSec < 10) score += 2;

  return score;
}

function cleanStaleChatQueue() {
  const now = Date.now();
  // Jika antrean mulai menumpuk (> 3), buang komentar yang sudah basi (> 25 detik)
  if (tiktokChatQueue.length > 3) {
    const initialLen = tiktokChatQueue.length;
    for (let i = tiktokChatQueue.length - 1; i >= 0; i--) {
      if (now - (tiktokChatQueue[i].timestamp || now) > CHAT_STALE_MS) {
        tiktokChatQueue.splice(i, 1);
      }
    }
    if (tiktokChatQueue.length < initialLen) {
      addLog('system', `[Smart Queue] Memangkas ${initialLen - tiktokChatQueue.length} chat basi agar Supri tetap responsif.`);
    }
  }
}

function enqueueTiktokChat({ user, comment, nickname }) {
  const cleanComment = (comment || '').trim();
  if (!cleanComment) return;

  recordChatActivity();

  // 1. Anti-Spam: Cek apakah user yang sama mengirim chat identik berturut-turut
  const existingIndex = tiktokChatQueue.findIndex((item) => item.user === user);
  if (existingIndex !== -1) {
    const existing = tiktokChatQueue[existingIndex];
    if (existing.comment.toLowerCase() === cleanComment.toLowerCase()) {
      // Spam komentar sama persis dari user yang sama diabaikan
      return;
    }
    // Jika user mengirim komentar baru, ganti komentar lamanya dengan yang terbaru
    tiktokChatQueue[existingIndex] = {
      user,
      comment: cleanComment,
      nickname: nickname || user,
      timestamp: Date.now(),
    };
    addLog('user', `[Live @${user}]: ${cleanComment}`);
    updateTiktokQueueUI();
    tryProcessNextTiktokChat();
    return;
  }

  addLog('user', `[Live @${user}]: ${cleanComment}`);

  // 2. Bersihkan chat basi
  cleanStaleChatQueue();

  // 3. Batasi antrean agar tidak menumpuk berlebihan (Maksimal MAX_SMART_QUEUE = 6)
  if (tiktokChatQueue.length >= MAX_SMART_QUEUE) {
    // Cari dan buang komentar dengan skor terendah
    let lowestIdx = 0;
    let lowestScore = Infinity;
    tiktokChatQueue.forEach((item, idx) => {
      const sc = scoreTiktokComment(item);
      if (sc < lowestScore) {
        lowestScore = sc;
        lowestIdx = idx;
      }
    });
    tiktokChatQueue.splice(lowestIdx, 1);
  }

  tiktokChatQueue.push({
    user,
    comment: cleanComment,
    nickname: nickname || user,
    timestamp: Date.now(),
  });
  updateTiktokQueueUI();
  tryProcessNextTiktokChat();
}

function handleTiktokGift({ user, giftName, repeatCount }) {
  recordChatActivity();
  const countStr = repeatCount && repeatCount > 1 ? ` x${repeatCount}` : '';
  const giftDisplay = giftName || 'saweran';
  const giftMsg = `🎁 @${user} kirim ${giftDisplay}${countStr}!`;
  addLog('system', giftMsg);

  // Jika lagu moshing belum berputar: langsung nyalakan lagu moshing iphonekupi!
  if (!isMusicPlaying) {
    const thankIntro = `Wanjay saweran masuk dari ${user}! Kirim ${giftDisplay}! Fiks aura lu nambah sejuta! Gas moshpit lagu iphonekupi level sigma!`;
    startIphonekupiMosh({
      intro: false,
      customIntro: thankIntro,
      userLabel: `🎁 Saweran @${user}: ${giftDisplay}${countStr}`,
      aiLabel: `🎵 SAWERAN DARI @${user} · IPHONEKUPI MOSH 🤘`,
    });
  } else {
    // Jika musik sudah menyala, serukan terima kasih sambil terus joget moshing!
    const shoutOut = `Mantap lagi dari ${user} sawer ${giftDisplay}! Aura lu makin tak terbatas no cap!`;
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

  // Supri bisa merespons chat saat IDLE maupun saat sedang MOSHING joget!
  if (state !== 'IDLE' && state !== 'MOSHING') return;

  // Bersihkan komentar basi jika antrean numpuk
  cleanStaleChatQueue();
  if (tiktokChatQueue.length === 0) {
    updateTiktokQueueUI();
    return;
  }

  // SMART SELECTION:
  // Jika antrean santai (1-2 item): ambil sesuai urutan FIFO
  // Jika antrean numpuk (>= 3 item): pilih chat paling menarik / prioritas tertinggi!
  let selectedIndex = 0;
  if (tiktokChatQueue.length >= 3) {
    let bestScore = -Infinity;
    tiktokChatQueue.forEach((item, idx) => {
      const sc = scoreTiktokComment(item);
      if (sc > bestScore) {
        bestScore = sc;
        selectedIndex = idx;
      }
    });
  }

  const [item] = tiktokChatQueue.splice(selectedIndex, 1);

  // Jika setelah mengambil masih ada lebih dari 3 chat yang numpuk,
  // sortir dan pertahankan maksimal 3 chat teratas, buang sisanya agar tidak delay berlarut-larut
  if (tiktokChatQueue.length > 3) {
    tiktokChatQueue.sort((a, b) => scoreTiktokComment(b) - scoreTiktokComment(a));
    const droppedCount = tiktokChatQueue.length - 3;
    tiktokChatQueue.length = 3;
    addLog('system', `[Smart Queue] Antrean padat: memprioritaskan chat terbaik, memangkas ${droppedCount} chat basi.`);
  }

  updateTiktokQueueUI();
  isProcessingTiktokChat = true;
  recordChatActivity();

  // Deteksi perintah joget dari penonton TikTok Live
  const commentLower = (item.comment || '').toLowerCase();
  const isJogetRequest = /\bjoget\b|\bmosh\b|\bmoshpit\b|\bgoyang\b|\bdance\b/i.test(commentLower);

  if (isJogetRequest) {
    const senderName = item.nickname || item.user;
    if (isMusicPlaying) {
      // Jika lagu joget sudah menyala, beri seruan heboh tanpa memutus lagu
      const jogetShout = `Wanjay kak ${senderName}! Ini kita udah lagi moshpit gaspol lagu iphonekupi level sigma! Aura lu nambah seribu no cap!`;
      tts.unlock();
      face.triggerLaugh(2.2);
      setLine(el.userLine, `@${item.user}: ${item.comment}`);
      setLine(el.aiLine, `🎵 ${jogetShout}`);
      addLog('assistant', jogetShout);
      tts.enqueue(jogetShout);
    } else {
      const jogetIntro = `Wanjay riil! Kak ${senderName} minta joget! Lagu iphonekupi langsung kita gas moshpit level sigma fiks no counter!`;
      startIphonekupiMosh({
        intro: true,
        customIntro: jogetIntro,
        userLabel: `💬 @${item.user}: ${item.comment}`,
        aiLabel: `🎵 JOGET REQUEST DARI @${item.user} · MOSHPIT ON 🤘`,
      });
    }
    isProcessingTiktokChat = false;
    setTimeout(() => {
      if (tiktokChatQueue.length > 0) {
        tryProcessNextTiktokChat();
      } else {
        tryProcessNextJoinGreeting();
      }
    }, 1500);
    return;
  }

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
    }, 1500);
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
  (name) => `Halo bro ${name}! Selamat datang di live stream! Aura lu fiks langsung nambah seribu no cap! Lu bisa gift atau ketik joget biar gue joget ya!`,
  (name) => `Waduh ada bro ${name} nih chat! Welcome to the stream! Ketik joget di chat atau sawer gift biar kita moshpit skibidi!`,
  (name) => `Halo bro ${name}, fiks sigma abis udah mampir! Mau liat gue moshpit? Ketik joget di chat atau kirim gift ya bro!`,
  (name) => `Halo bro ${name}! Salam kenal sang rizzler! Ketik joget di kolom chat atau kirim gift biar rizz kita makin menyala!`,
  (name) => `Halo bro ${name}! Riil ga sih chat bro ${name} dateng! Tap-tap layarnya atau ketik joget biar gue langsung moshpit!`,
  (name) => `Halo bro ${name}, apa kabar nih sang sigma dari Ohio? Lu bisa kirim gift atau ketik joget di chat biar kita goyang!`,
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

  // Jangan menyela jika Supri sedang berbicara atau berpikir
  if (state !== 'IDLE' && state !== 'MOSHING') return;
  // Jika ada antrean komentar chat, prioritaskan merespons chat
  if (tiktokChatQueue.length > 0) return;

  isGreetingJoin = true;
  recordChatActivity();

  // Jika ada 2 atau lebih penonton dalam antrean, sapa berpasangan agar lebih efisien
  let greetText = '';
  if (tiktokJoinQueue.length >= 2) {
    const name1 = tiktokJoinQueue.shift();
    const name2 = tiktokJoinQueue.shift();
    greetText = `Halo bro ${name1} dan bro ${name2}, selamat datang di live chat! Aura kalian fiks nambah sejuta! Lu bisa gift atau ketik joget biar gue joget ya!`;
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

// ---------- Idle Auto-News Monologue (Scraped Top Indonesian News) ----------
let isMonologueRunning = false;
let cachedNewsList = [];
let newsPointer = 0;
let lastNewsFetchTime = 0;

const NEWS_MONOLOGUE_TEMPLATES = [
  (title, summary, source) => `Chat, dengerin berita panas dari ${source} nih! ${title}. Ringkasannya, ${summary}. Riil no cap kan chat? Btw yang baru join, sawer gift atau ketik joget biar aura lu nambah seribu dan gue langsung moshpit!`,
  (title, summary, source) => `Waduh chat, ada info gokil dari ${source}! ${title}. Kabarnya, ${summary}. Gimana menurut kalian para sigma di chat? Komen dong! Mau liat gue moshpit? Ketik joget di chat sekarang!`,
  (title, summary, source) => `Chat is this real? Liat update berita dari ${source} barusan! ${title}. ${summary}. Fiks no counter sih ini. Yang mau naikin aura, yuk tap tap layar atau ketik joget biar gue goyang!`,
  (title, summary, source) => `Sambil jeda mewing sebentar, dengerin kabar dari ${source} nih chat! ${title}. ${summary}. Gede banget auranya! Ketik joget di chat atau kirim gift biar kita gas moshpit lagu iphonekupi!`,
  (title, summary, source) => `Breaking news dari ${source} nih chat, let him cook! ${title}. ${summary}. Gokil abis no cap! Jangan lupa sawer gift atau ketik joget biar gue joget moshpit!`,
];

const IDLE_BANTER_TEMPLATES = [
  () => `Chat, kok pada diem aja sih? Lagi pada fokus mewing ya? Ketik joget di kolom chat atau kirim gift dong biar gue langsung moshpit lagu iphonekupi!`,
  () => `Sepi banget live stream kita nih chat, jangan sampai aura kita minus! Yuk tap tap layar dan ketik joget di chat biar kita goyang level sigma!`,
  () => `Waduh chat, jangan cuma jadi silent watcher di Ohio dong! Sawer gift atau ketik joget biar gue moshpit dan aura lu langsung nambah sejuta no cap!`,
];

async function fetchLatestNews() {
  try {
    const res = await fetch('/api/news/latest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.news || []);
    if (list.length > 0) {
      cachedNewsList = list;
      lastNewsFetchTime = Date.now();
      return cachedNewsList;
    }
  } catch (err) {
    console.warn('[auto-news] gagal ambil berita:', err);
  }
  return cachedNewsList;
}

async function triggerAutoNewsMonologue(force = false) {
  if (isMonologueRunning) return;
  if (!force) {
    if (state !== 'IDLE') return;
    if (isMusicPlaying) return;
    if (isProcessingTiktokChat) return;
    if (tiktokChatQueue.length > 0) return;
  }

  isMonologueRunning = true;
  isSpeakingNews = true;
  recordChatActivity();

  try {
    if (cachedNewsList.length === 0 || Date.now() - lastNewsFetchTime > 120000) {
      await fetchLatestNews();
    }

    let speechText = '';
    let headlineSource = 'ANTARA News';

    if (cachedNewsList.length > 0) {
      const item = cachedNewsList[newsPointer % cachedNewsList.length];
      newsPointer++;
      headlineSource = item.source || 'ANTARA News';
      const template = NEWS_MONOLOGUE_TEMPLATES[Math.floor(Math.random() * NEWS_MONOLOGUE_TEMPLATES.length)];
      speechText = template(item.cleanTitle || item.title, item.summary || item.title, headlineSource);
    } else {
      const template = IDLE_BANTER_TEMPLATES[Math.floor(Math.random() * IDLE_BANTER_TEMPLATES.length)];
      speechText = template();
    }

    setLine(el.userLine, `📰 Berita Terkini (${headlineSource})`);
    setLine(el.aiLine, speechText);
    addLog('system', `[Auto-News] ${headlineSource}: ${speechText}`);
    addLog('assistant', speechText);

    face.setGrin(0.42);
    face.triggerLaugh(1.5);
    setTimeout(() => {
      if (!face.isMoshing) face.setGrin(0);
    }, 3500);

    tts.unlock();
    tts.enqueue(speechText);
  } catch (err) {
    console.error('[triggerAutoNewsMonologue error]', err);
  } finally {
    setTimeout(() => {
      isMonologueRunning = false;
      isSpeakingNews = false;
      recordChatActivity();
    }, 5000);
  }
}

function checkIdleAutoNews() {
  const isEnabled = el.autoNewsToggle ? el.autoNewsToggle.checked : (prefs.get('supri-auto-news', '1') === '1');
  if (!isEnabled) {
    if (el.autoNewsLabel) el.autoNewsLabel.textContent = 'Auto-berita (OFF)';
    return;
  }

  const idleSeconds = Math.floor((Date.now() - lastChatActivityTime) / 1000);
  const remaining = Math.max(0, 10 - idleSeconds);

  if (isMonologueRunning || isSpeakingNews) {
    if (el.autoNewsLabel) el.autoNewsLabel.textContent = 'Membacakan Berita 🎙️';
    return;
  }

  if (state === 'MOSHING' || isMusicPlaying) {
    if (el.autoNewsLabel) el.autoNewsLabel.textContent = 'Sedang Joget 🎵';
    return;
  }

  if (state !== 'IDLE') {
    if (el.autoNewsLabel) el.autoNewsLabel.textContent = `Supri ${state}...`;
    return;
  }

  if (tiktokChatQueue.length > 0 || isProcessingTiktokChat) {
    if (el.autoNewsLabel) el.autoNewsLabel.textContent = 'Memproses Chat...';
    return;
  }

  if (el.autoNewsLabel) {
    el.autoNewsLabel.textContent = `Auto-berita (${remaining}s)`;
  }

  // 10 detik hening tanpa ada chat yang masuk
  if (idleSeconds >= 10) {
    triggerAutoNewsMonologue();
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
el.interruptBtn.addEventListener('click', () => interrupt({ stopMusic: true }));
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
if (el.liveModeBtn) {
  el.liveModeBtn.addEventListener('click', () => setLiveMode916(!isLiveMode916));
}
if (el.zoomBtn) {
  el.zoomBtn.addEventListener('click', () => setZoomOut(!isZoomOut));
}
if (el.obsCleanBtn) {
  el.obsCleanBtn.addEventListener('click', () => setObsClean(!isObsClean));
}

// Simulasi Test Buttons (Gift, Tap, Reset)
if (el.testGiftBtn) {
  el.testGiftBtn.addEventListener('click', async () => {
    const mockGifts = [
      { name: 'Paus Menyelam 🐳', diamonds: 1000, user: 'Sultan_Kemang' },
      { name: 'Singa Emas 🦁', diamonds: 500, user: 'Bos_Tambang' },
      { name: 'Topi & Kacamata 🕶️', diamonds: 150, user: 'Juragan_Kopi' },
      { name: 'Mawar Merah 🌹', diamonds: 10, user: 'Kak_Cantik' },
      { name: 'Kucing Hoki 🐱', diamonds: 50, user: 'Raja_Sawer' },
    ];
    const pick = mockGifts[Math.floor(Math.random() * mockGifts.length)];
    try {
      await fetch('/api/tiktok/test-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'gift',
          user: pick.user,
          nickname: pick.user.replace(/_/g, ' '),
          giftName: pick.name,
          repeatCount: Math.floor(Math.random() * 5) + 1,
          diamondCount: pick.diamonds,
        }),
      });
    } catch (err) {
      console.warn('Test gift error:', err);
    }
  });
}

if (el.testLikeBtn) {
  el.testLikeBtn.addEventListener('click', async () => {
    const mockUsers = ['andi_tap', 'budi_like', 'siti_loveyou', 'doni_semangat', 'rizky_tap'];
    const user = mockUsers[Math.floor(Math.random() * mockUsers.length)];
    try {
      await fetch('/api/tiktok/test-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'like',
          user,
          nickname: user.replace(/_/g, ' '),
          likeCount: Math.floor(Math.random() * 15) + 5,
        }),
      });
    } catch (err) {
      console.warn('Test like error:', err);
    }
  });
}

if (el.resetStatsBtn) {
  el.resetStatsBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/tiktok/test-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reset' }),
      });
    } catch (err) {
      console.warn('Reset error:', err);
    }
  });
}

if (el.testNewsBtn) {
  el.testNewsBtn.addEventListener('click', () => {
    triggerAutoNewsMonologue(true);
  });
}

if (el.autoNewsToggle) {
  el.autoNewsToggle.checked = prefs.get('supri-auto-news', '1') === '1';
  el.autoNewsToggle.addEventListener('change', () => {
    prefs.set('supri-auto-news', el.autoNewsToggle.checked ? '1' : '0');
    showHint(el.autoNewsToggle.checked ? 'Auto berita saat hening 10s AKTIF' : 'Auto berita NONAKTIF');
  });
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isObsClean) {
      setObsClean(false);
      return;
    }
    if (el.cmdForm && el.cmdForm.style.display !== 'none') {
      toggleChatInput(false);
      return;
    }
    if (el.logDrawer.classList.contains('open')) toggleLog(false);
    else interrupt({ stopMusic: true });
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

const unlockAudioOnGesture = () => {
  tts.unlock();
  window.removeEventListener('click', unlockAudioOnGesture);
  window.removeEventListener('keydown', unlockAudioOnGesture);
  window.removeEventListener('touchstart', unlockAudioOnGesture);
};
window.addEventListener('click', unlockAudioOnGesture);
window.addEventListener('keydown', unlockAudioOnGesture);
window.addEventListener('touchstart', unlockAudioOnGesture);

// ---------- Init ----------
setLiveMode916(isLiveMode916);
setZoomOut(isZoomOut);
if (isObsClean) setObsClean(true);

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
setInterval(checkIdleAutoNews, 1000);
initTiktokSSE();
if (['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'].includes(pose)) setState(pose);
requestAnimationFrame(frame);
