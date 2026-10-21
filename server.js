// Supri server: proxy LLM (BeatAPI / 9router), Edge TTS, dan monitor sistem.
// API key hanya hidup di sini (.env), tidak pernah dikirim ke browser.
import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import si from "systeminformation";

const {
  ROUTER_URL = process.env.BEATAPI_URL || "https://api.beatapi.io/v1",
  ROUTER_KEY = "",
  BEATAPI_API_KEY = "",
  ROUTER_MODEL = "glm-5.3-flash-free",
  TTS_VOICE = "id-ID-ArdiNeural",
  TTS_ENGINE = "clone", // 'clone', 'elevenlabs', 'fish', atau 'edge'
  CLONE_URL = "http://127.0.0.1:8000/tts",
  CLONE_TIMEOUT_MS = "12000",
  FISH_AUDIO_API_KEY = "",
  FISH_AUDIO_MODEL = "s2.1-pro-free",
  FISH_AUDIO_VOICE_ID = "802e3bc2b27e49c2995d23ef70e6ac89",
  FISH_AUDIO_URL = "https://api.fish.audio/v1/tts",
  ELEVENLABS_API_KEY = "",
  ELEVENLABS_VOICE_ID = "RbNgJzKAV7jpYJNtCBpj",
  ELEVENLABS_MODEL_ID = "eleven_multilingual_v2",
  PORT = 3000,
} = process.env;

const elevenlabs = ELEVENLABS_API_KEY
  ? new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY })
  : null;
const ACTIVE_ROUTER_KEY = BEATAPI_API_KEY || ROUTER_KEY;
const ROUTER_ENDPOINT = ROUTER_URL.endsWith("/chat/completions")
  ? ROUTER_URL
  : `${ROUTER_URL.replace(/\/+$/, "")}/chat/completions`;

const CLONE_TIMEOUT = Math.max(1000, Number(CLONE_TIMEOUT_MS) || 12000);
const MODELS = ROUTER_MODEL.split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const VOICES = [
  "id-ID-ArdiNeural",
  "id-ID-GadisNeural",
  "en-US-GuyNeural",
  "en-US-JennyNeural",
];
const MAX_HISTORY = 10;
const DEFAULT_PERSONA =
  "Kamu Supri, asisten suara pribadi bergaya Jarvis. Jawab dalam bahasa yang sama dengan user, " +
  "singkat, santai, maksimal 3 kalimat. Jawabanmu akan dibacakan langsung oleh TTS, jadi jangan pakai markdown, " +
  "emoji, daftar berpoin, atau kode. Tuliskan angka, jam, tanggal, dan singkatan dalam bentuk ejaan kata " +
  '(contoh: "jam tujuh malam", "dua ribu dua puluh enam", "persen") agar pembacaan suara alami.';

const app = express();
app.use(express.json({ limit: "1mb" }));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- LLM chat (SSE passthrough atau non-streaming fallback) ----------
async function openUpstream(messages, signal) {
  const errors = [];
  // Setiap model dicoba; model pertama mendapat satu kali retry (rate limit sesaat).
  const attempts = MODELS.length
    ? [MODELS[0], ...MODELS]
    : ["glm-5.3-flash-free"];
  for (const model of attempts) {
    try {
      const r = await fetch(ROUTER_ENDPOINT, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(ACTIVE_ROUTER_KEY && {
            Authorization: `Bearer ${ACTIVE_ROUTER_KEY}`,
          }),
        },
        body: JSON.stringify({ model, stream: true, messages }),
      });
      if (r.ok && r.body) return { r, model };
      const text = await r.text().catch(() => "");
      errors.push(`${model}: HTTP ${r.status} ${text.slice(0, 200)}`);
    } catch (e) {
      if (signal.aborted) throw e;
      errors.push(`${model}: ${e.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

app.post("/api/chat", async (req, res) => {
  const { messages = [], persona } = req.body ?? {};
  const history = messages
    .filter(
      (m) =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string",
    )
    .slice(-MAX_HISTORY);
  const ac = new AbortController();
  res.on("close", () => ac.abort());

  try {
    const { r, model } = await openUpstream(
      [
        { role: "system", content: persona?.trim() || DEFAULT_PERSONA },
        ...history,
      ],
      ac.signal,
    );
    log(`chat → ${model}`);
    const contentType = r.headers.get("content-type") || "";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Model", model);

    if (contentType.includes("text/event-stream")) {
      for await (const chunk of r.body) res.write(chunk);
      res.end();
    } else {
      // Jika upstream mengembalikan JSON biasa (non-streaming)
      const data = await r.json().catch(() => null);
      const text =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.delta?.content ||
        "";
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (e) {
    if (ac.signal.aborted) return;
    log("chat error:", e.message);
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.end();
  }
});

// ---------- TTS (FireRedTTS3 Voice Cloning + Fish Audio + Edge TTS Fallback) ----------

/**
 * Sintesis audio suara sendiri via service Python FireRedTTS3 (FastAPI).
 * Mengembalikan { audio: Buffer, contentType: string }.
 */
async function synthesizeClone(text, signal) {
  const r = await fetch(CLONE_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Clone service HTTP ${r.status}: ${errText.slice(0, 150)}`);
  }

  const arrayBuffer = await r.arrayBuffer();
  const audio = Buffer.from(arrayBuffer);
  if (!audio.length) throw new Error("Audio hasil cloning kosong");

  const contentType = r.headers.get("content-type") || "audio/wav";
  return { audio, contentType };
}

/**
 * Sintesis audio via Fish Audio API (Tier gratis model: s2.1-pro-free).
 * Mengembalikan { audio: Buffer, contentType: string }.
 */
async function synthesizeFish(text, signal, voiceId) {
  if (!FISH_AUDIO_API_KEY) {
    throw new Error("FISH_AUDIO_API_KEY belum diisi di .env");
  }

  const chosenVoiceId =
    voiceId || FISH_AUDIO_VOICE_ID || "b8d594e696694b499aa12e32d0c1b618";

  const r = await fetch(FISH_AUDIO_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FISH_AUDIO_API_KEY}`,
      model: FISH_AUDIO_MODEL,
    },
    body: JSON.stringify({
      text,
      reference_id: chosenVoiceId,
      format: "mp3",
      model: FISH_AUDIO_MODEL,
    }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Fish Audio HTTP ${r.status}: ${errText.slice(0, 150)}`);
  }

  const arrayBuffer = await r.arrayBuffer();
  const audio = Buffer.from(arrayBuffer);
  if (!audio.length) throw new Error("Audio Fish Audio kosong");

  return { audio, contentType: "audio/mpeg" };
}

/**
 * Sintesis audio via ElevenLabs TTS SDK.
 * Mengembalikan { audio: Buffer, contentType: string }.
 */
async function synthesizeElevenLabs(text, voiceId) {
  if (!elevenlabs) {
    throw new Error("ELEVENLABS_API_KEY belum diisi di .env");
  }

  const chosenVoiceId =
    voiceId || ELEVENLABS_VOICE_ID || "RbNgJzKAV7jpYJNtCBpj";

  const audioStream = await elevenlabs.textToSpeech.convert(chosenVoiceId, {
    text,
    model_id: ELEVENLABS_MODEL_ID,
    output_format: "mp3_44100_128",
  });

  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  const audio = Buffer.concat(chunks);
  if (!audio.length) throw new Error("Audio ElevenLabs kosong");

  return { audio, contentType: "audio/mpeg" };
}

/**
 * Sintesis audio via Microsoft Edge TTS (cadangan cepat & gratis).
 * Mengembalikan { audio: Buffer, contentType: string }.
 */
async function synthesizeEdge(text, voice) {
  const chosenVoice =
    VOICES.includes(voice) ||
    (typeof voice === "string" && voice.includes("Neural"))
      ? voice
      : TTS_VOICE;
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(
      chosenVoice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    );
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Edge TTS timeout")),
        15000,
      );
      audioStream.on("data", (c) => chunks.push(c));
      audioStream.on("end", () => (clearTimeout(timer), resolve()));
      audioStream.on("error", (e) => (clearTimeout(timer), reject(e)));
    });
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error("Audio Edge TTS kosong");
    return { audio, contentType: "audio/mpeg" };
  } finally {
    tts.close();
  }
}

app.post("/api/tts", async (req, res) => {
  const text = String(req.body?.text ?? "")
    .trim()
    .slice(0, 1000);
  const voice = req.body?.voice;
  if (!text) return res.status(400).json({ error: "text kosong" });

  // 1. Opsi ElevenLabs jika dipilih di UI atau dijadikan default TTS_ENGINE='elevenlabs'
  const isElevenLabs =
    voice?.startsWith("elevenlabs") || (!voice && TTS_ENGINE === "elevenlabs");
  if (isElevenLabs) {
    try {
      let targetVoiceId = ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
      if (voice === "elevenlabs-sarah") {
        targetVoiceId = "EXAVITQu4vr4xnSDxMaL"; // Sarah (Premade / Free Tier compatible)
      } else if (voice === "elevenlabs-brian") {
        targetVoiceId = "nPczCjzI2devNBz1zQrb"; // Brian (Premade / Free Tier compatible)
      } else if (voice === "elevenlabs-citra") {
        targetVoiceId = "RbNgJzKAV7jpYJNtCBpj"; // Citra (Library / Paid Plan required)
      } else if (voice === "elevenlabs-rachel") {
        targetVoiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel
      } else if (voice?.startsWith("elevenlabs:")) {
        targetVoiceId = voice.slice("elevenlabs:".length);
      }

      const { audio, contentType } = await synthesizeElevenLabs(
        text,
        targetVoiceId,
      );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", audio.length);
      res.setHeader("X-TTS-Engine", "elevenlabs");
      return res.end(audio);
    } catch (e) {
      log(
        `TTS ElevenLabs gagal [${e.statusCode || e.message}]: ${e.body?.detail?.message || e.message}, otomatis fallback ke Edge TTS`,
      );
    }
  }

  // 2. Opsi Fish Audio jika dipilih di UI atau dijadikan default TTS_ENGINE='fish'
  const wantFish =
    voice === "fish" ||
    voice?.startsWith("fish:") ||
    (!voice && TTS_ENGINE === "fish");
  if (wantFish) {
    try {
      let targetVoiceId = FISH_AUDIO_VOICE_ID || "b8d594e696694b499aa12e32d0c1b618";
      if (voice?.startsWith("fish:")) {
        targetVoiceId = voice.slice("fish:".length);
      }
      const ac = new AbortController();
      const timer = setTimeout(
        () => ac.abort(new Error("Fish Audio timeout")),
        15000,
      );
      res.on("close", () => ac.abort());

      const { audio, contentType } = await synthesizeFish(
        text,
        ac.signal,
        targetVoiceId,
      );
      clearTimeout(timer);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", audio.length);
      res.setHeader("X-TTS-Engine", "fish");
      return res.end(audio);
    } catch (e) {
      log(
        `TTS Fish Audio offline/gagal (${e.message}), otomatis fallback ke Edge TTS`,
      );
    }
  }

  // 3. Prioritaskan clone jika voice eksplisit 'clone' atau setting default TTS_ENGINE='clone'
  const wantClone = voice === "clone" || (!voice && TTS_ENGINE === "clone");
  if (wantClone) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(
        () => ac.abort(new Error("Clone service timeout")),
        CLONE_TIMEOUT,
      );
      res.on("close", () => ac.abort());

      const { audio, contentType } = await synthesizeClone(text, ac.signal);
      clearTimeout(timer);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", audio.length);
      res.setHeader("X-TTS-Engine", "clone");
      return res.end(audio);
    } catch (e) {
      log(
        `TTS clone offline/gagal (${e.message}), otomatis fallback ke Edge TTS`,
      );
    }
  }

  // 4. Fallback atau mode Edge TTS biasa
  try {
    const edgeVoice =
      ["clone", "fish"].includes(voice) || voice?.startsWith("elevenlabs")
        ? TTS_VOICE
        : voice;
    const { audio, contentType } = await synthesizeEdge(text, edgeVoice);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", audio.length);
    res.setHeader(
      "X-TTS-Engine",
      wantClone || wantFish || isElevenLabs ? "edge-fallback" : "edge",
    );
    res.end(audio);
  } catch (e) {
    log("TTS error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ---------- Monitor sistem ----------
app.get("/api/system", async (_req, res) => {
  try {
    const [load, mem, net] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(),
    ]);
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

app.get("/api/config", (_req, res) => {
  res.json({
    model: MODELS[0] ?? "",
    voices: VOICES,
    voice: ["clone", "fish", "elevenlabs"].includes(TTS_ENGINE)
      ? TTS_ENGINE
      : TTS_VOICE,
    engine: TTS_ENGINE,
    cloneUrl: CLONE_URL,
    persona: DEFAULT_PERSONA,
  });
});

// Produksi: sajikan hasil build Vite.
if (existsSync("dist")) app.use(express.static("dist"));

app.listen(PORT, () => {
  log(
    `Supri server http://localhost:${PORT}  (endpoint ${ROUTER_ENDPOINT}, model ${MODELS.join(" > ") || "-"})`,
  );
  log(
    `TTS Engine: ${TTS_ENGINE} (clone: ${CLONE_URL}, elevenlabs: ${ELEVENLABS_VOICE_ID}, fish: ${FISH_AUDIO_MODEL}, edge: ${TTS_VOICE})`,
  );
});
