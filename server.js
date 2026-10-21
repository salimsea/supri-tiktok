// Supri server: proxy LLM (9router), Edge TTS, dan monitor sistem.
// API key hanya hidup di sini (.env), tidak pernah dikirim ke browser.
import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import si from 'systeminformation';

const {
  ROUTER_URL = 'http://127.0.0.1:20128/v1',
  ROUTER_KEY = '',
  ROUTER_MODEL = '',
  TTS_VOICE = 'id-ID-ArdiNeural',
  TTS_ENGINE = 'clone', // 'clone' (suara sendiri via FireRedTTS3) atau 'edge'
  CLONE_URL = 'http://127.0.0.1:8000/tts',
  CLONE_TIMEOUT_MS = '12000',
  PORT = 3000,
} = process.env;

const CLONE_TIMEOUT = Math.max(1000, Number(CLONE_TIMEOUT_MS) || 12000);
const MODELS = ROUTER_MODEL.split(',').map((m) => m.trim()).filter(Boolean);
const VOICES = ['id-ID-ArdiNeural', 'id-ID-GadisNeural'];
const ALL_VOICES = ['clone', ...VOICES];
const MAX_HISTORY = 10;
const DEFAULT_PERSONA =
  'Kamu Supri, asisten suara pribadi bergaya Jarvis. Jawab dalam bahasa yang sama dengan user, ' +
  'singkat, santai, maksimal 3 kalimat. Jawabanmu akan dibacakan langsung oleh TTS, jadi jangan pakai markdown, ' +
  'emoji, daftar berpoin, atau kode. Tuliskan angka, jam, tanggal, dan singkatan dalam bentuk ejaan kata ' +
  '(contoh: "jam tujuh malam", "dua ribu dua puluh enam", "persen") agar pembacaan suara alami.';

const app = express();
app.use(express.json({ limit: '1mb' }));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- LLM chat (SSE passthrough, fallback antar model + retry sekali) ----------
async function openUpstream(messages, signal) {
  const errors = [];
  // Setiap model dicoba; model pertama mendapat satu kali retry (rate limit sesaat).
  const attempts = MODELS.length ? [MODELS[0], ...MODELS] : [''];
  for (const model of attempts) {
    try {
      const r = await fetch(`${ROUTER_URL}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(ROUTER_KEY && { Authorization: `Bearer ${ROUTER_KEY}` }),
        },
        body: JSON.stringify({ model, stream: true, messages }),
      });
      if (r.ok && r.body) return { r, model };
      const text = await r.text().catch(() => '');
      errors.push(`${model}: HTTP ${r.status} ${text.slice(0, 200)}`);
    } catch (e) {
      if (signal.aborted) throw e;
      errors.push(`${model}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

app.post('/api/chat', async (req, res) => {
  const { messages = [], persona } = req.body ?? {};
  const history = messages
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-MAX_HISTORY);
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  try {
    const { r, model } = await openUpstream(
      [{ role: 'system', content: persona?.trim() || DEFAULT_PERSONA }, ...history],
      ac.signal,
    );
    log(`chat → ${model}`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Model', model);
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return;
    log('chat error:', e.message);
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.end();
  }
});

// ---------- TTS (FireRedTTS3 Voice Cloning + Edge TTS Fallback) ----------

/**
 * Sintesis audio suara sendiri via service Python FireRedTTS3 (FastAPI).
 * Mengembalikan { audio: Buffer, contentType: string }.
 */
async function synthesizeClone(text, signal) {
  const r = await fetch(CLONE_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Clone service HTTP ${r.status}: ${errText.slice(0, 150)}`);
  }

  const arrayBuffer = await r.arrayBuffer();
  const audio = Buffer.from(arrayBuffer);
  if (!audio.length) throw new Error('Audio hasil cloning kosong');

  const contentType = r.headers.get('content-type') || 'audio/wav';
  return { audio, contentType };
}

/**
 * Sintesis audio via Microsoft Edge TTS (cadangan cepat & gratis).
 * Mengembalikan { audio: Buffer, contentType: string }.
 */
async function synthesizeEdge(text, voice) {
  const chosenVoice = VOICES.includes(voice) ? voice : TTS_VOICE;
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(chosenVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Edge TTS timeout')), 15000);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => (clearTimeout(timer), resolve()));
      audioStream.on('error', (e) => (clearTimeout(timer), reject(e)));
    });
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('Audio Edge TTS kosong');
    return { audio, contentType: 'audio/mpeg' };
  } finally {
    tts.close();
  }
}

app.post('/api/tts', async (req, res) => {
  const text = String(req.body?.text ?? '').trim().slice(0, 1000);
  const voice = req.body?.voice;
  if (!text) return res.status(400).json({ error: 'text kosong' });

  // Prioritaskan clone jika voice eksplisit 'clone' atau setting default TTS_ENGINE='clone'
  const wantClone = voice === 'clone' || (!voice && TTS_ENGINE === 'clone');

  if (wantClone) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('Clone service timeout')), CLONE_TIMEOUT);
      res.on('close', () => ac.abort());

      const { audio, contentType } = await synthesizeClone(text, ac.signal);
      clearTimeout(timer);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audio.length);
      res.setHeader('X-TTS-Engine', 'clone');
      return res.end(audio);
    } catch (e) {
      log(`TTS clone offline/gagal (${e.message}), otomatis fallback ke Edge TTS`);
    }
  }

  // Fallback atau mode Edge TTS biasa
  try {
    const edgeVoice = voice === 'clone' ? TTS_VOICE : voice;
    const { audio, contentType } = await synthesizeEdge(text, edgeVoice);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', audio.length);
    res.setHeader('X-TTS-Engine', wantClone ? 'edge-fallback' : 'edge');
    res.end(audio);
  } catch (e) {
    log('TTS error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ---------- Monitor sistem ----------
app.get('/api/system', async (_req, res) => {
  try {
    const [load, mem, net] = await Promise.all([si.currentLoad(), si.mem(), si.networkStats()]);
    const n = net[0] ?? {};
    res.json({
      cpu: Math.round(load.currentLoad),
      ram: Math.round((mem.active / mem.total) * 100),
      ramUsedGb: +(mem.active / 1e9).toFixed(1),
      ramTotalGb: +(mem.total / 1e9).toFixed(1),
      rxKbs: Math.round((n.rx_sec ?? 0) / 1024),
      txKbs: Math.round((n.tx_sec ?? 0) / 1024),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({
    model: MODELS[0] ?? '',
    voices: ALL_VOICES,
    voice: TTS_ENGINE === 'clone' ? 'clone' : TTS_VOICE,
    engine: TTS_ENGINE,
    cloneUrl: CLONE_URL,
    persona: DEFAULT_PERSONA,
  });
});

// Produksi: sajikan hasil build Vite.
if (existsSync('dist')) app.use(express.static('dist'));

app.listen(PORT, () => {
  log(`Supri server http://localhost:${PORT}  (router ${ROUTER_URL}, model ${MODELS.join(' > ') || '-'})`);
  log(`TTS Engine: ${TTS_ENGINE} (clone: ${CLONE_URL}, edge: ${TTS_VOICE})`);
});
