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
  PORT = 3000,
} = process.env;

const MODELS = ROUTER_MODEL.split(',').map((m) => m.trim()).filter(Boolean);
const VOICES = ['id-ID-ArdiNeural', 'id-ID-GadisNeural'];
const MAX_HISTORY = 10;
const DEFAULT_PERSONA =
  'Kamu Supri, asisten suara pribadi bergaya Jarvis. Jawab dalam bahasa yang sama dengan user, ' +
  'singkat, santai, maksimal 3 kalimat. Jawabanmu akan dibacakan, jadi jangan pakai markdown, ' +
  'emoji, daftar berpoin, atau kode.';

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

// ---------- TTS (Edge TTS, gratis) ----------
// Audio di-buffer penuh dulu agar kegagalan bisa dilaporkan dengan status error,
// sehingga browser bisa jatuh ke speechSynthesis.
app.post('/api/tts', async (req, res) => {
  const text = String(req.body?.text ?? '').trim().slice(0, 1000);
  const voice = VOICES.includes(req.body?.voice) ? req.body.voice : TTS_VOICE;
  if (!text) return res.status(400).json({ error: 'text kosong' });

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TTS timeout')), 15000);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => (clearTimeout(timer), resolve()));
      audioStream.on('error', (e) => (clearTimeout(timer), reject(e)));
    });
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('audio kosong');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audio.length);
    res.end(audio);
  } catch (e) {
    log('tts error:', e.message);
    res.status(502).json({ error: e.message });
  } finally {
    tts.close();
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
  res.json({ model: MODELS[0] ?? '', voices: VOICES, voice: TTS_VOICE, persona: DEFAULT_PERSONA });
});

// Produksi: sajikan hasil build Vite.
if (existsSync('dist')) app.use(express.static('dist'));

app.listen(PORT, () => {
  log(`Supri server http://localhost:${PORT}  (router ${ROUTER_URL}, model ${MODELS.join(' > ') || '-'})`);
});
