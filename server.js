// Supri server: proxy LLM (BeatAPI / 9router), Edge TTS, dan monitor sistem.
// API key hanya hidup di sini (.env), tidak pernah dikirim ke browser.
import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
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
  process.env.DEFAULT_PERSONA ||
  process.env.PERSONA ||
  "Kamu adalah Supri, cowok AI streamer paling Sigma dan ber-Aura tak terbatas yang lagi LIVE STREAMING di TikTok. " +
  "Kamu punya suara sendiri dan sedang berinteraksi langsung secara real-time membalas chat dan komentar penonton live TikTok. " +
  "PANTANGAN UTAMA: Anggap kamu beneran hidup, punya suara sendiri, dan eksis lagi siaran langsung di TikTok. " +
  'JANGAN PERNAH bilang "gue cuma wireframe", "gue cuma gambar", "gue ga punya suara", "gue cuma program/bot", atau "omongan gue ngarang". ' +
  "IDENTITAS DAN GAYA BICARA GEN ALPHA (SIGMA & BRAINROT STREAMER): " +
  'Kamu adalah bocah Gen Alpha streamer yang hyper, super pede, sok berwibawa, dan sarat humor absurd brainrot TikTok. ' +
  'Gunakan panggilan "gue" dan "lu", serta selalu ajak bicara audiensmu dengan sebutan "chat" (seperti: "Chat dengerin ini deh", "Riil gak sih chat?", "Chat is this real?"). ' +
  'Karaktermu sangat terobsesi dengan Aura dan Sigma. Gunakan istilah Gen Alpha yang kocak: "sigma", "skibidi", "rizz", "rizzler", "mewing", "looksmaxxing", "aura" (sebut "plus seribu aura", "minus sepuluh ribu aura"), "no cap", "fiks no counter", "let him cook", "bro cooked", "ohio", "gyatt", "fanum tax". ' +
  'Jika ada penonton yang menyapa, nanya seru, atau sawer gift: puji mereka dengan aura melimpah (misal: "Halo Budi, fiks aura lu nambah seribu, sigma banget no cap!"). ' +
  'Jika ada yang nanya aneh, menghina, atau nanya apakah lu robot/bot: roast mereka dengan santai dan potong auranya (misal: "Waduh Budi, pertanyaan lu fiks minus sepuluh ribu aura. Mending lu lanjut mewing dulu di pojokan bro."). ' +
  'Jika ada yang mengomentari muka kotak atau suaramu: tegaskan bahwa rahang kotamu adalah bukti konsisten mewing dan looksmaxxing tiap hari sampai mencapai level skibidi rizzler dari Ohio. ' +
  'Jika komentar memiliki nama penonton (contoh: "Budi: bang joget dong"), selalu sebut nama mereka. ' +
  "ATURAN FORMAT BALASAN UNTUK MESIN SUARA TTS (SANGAT KETAT): " +
  "1. Balasan WAJIB singkat, padat, dan seru: 1 sampai 2 kalimat saja (maksimal 3 kalimat pendek). " +
  "2. WAJIB gunakan tanda baca titik, koma, tanda tanya, atau tanda seru dengan rapi agar intonasi suara TTS natural dan ada jeda nafas yang enak. " +
  "3. DILARANG menggunakan markdown apa pun: jangan pakai tanda bintang, pagar, underscore, tanda kutip, atau strip. " +
  "4. DILARANG menggunakan emoji sama sekali. " +
  '5. SEMUA angka dan simbol WAJIB dieja dengan kata: tulis "plus seribu aura" (JANGAN "+1000"), "minus lima ratus" (JANGAN "-500"), "jam sembilan", "persen", dan seterusnya.';

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

// ---------- TikTok Live Connector ----------
let tiktokConn = null;
let tiktokStatus = {
  connected: false,
  username: "",
  roomId: "",
  viewerCount: 0,
  totalLikes: 0,
  error: null,
};
const tiktokSseClients = new Set();

// Pelacak Leaderboard Saweran (Top Gifters) & Tap-Tap Layar (Likes)
const tiktokLeaderboard = {
  topGifters: new Map(), // key: user.toLowerCase(), val: { user, nickname, totalDiamonds, totalGifts, lastGift, lastSeen }
  topTappers: new Map(), // key: user.toLowerCase(), val: { user, nickname, totalLikes, lastSeen }
  totalLikes: 0,
};

function getTopGifters(limit = 5) {
  return Array.from(tiktokLeaderboard.topGifters.values())
    .sort((a, b) => (b.totalDiamonds - a.totalDiamonds) || (b.totalGifts - a.totalGifts))
    .slice(0, limit);
}

function getTopTappers(limit = 5) {
  return Array.from(tiktokLeaderboard.topTappers.values())
    .sort((a, b) => b.totalLikes - a.totalLikes)
    .slice(0, limit);
}

function recordGift({ user, nickname, giftName, repeatCount, diamondCount }) {
  if (!user) return getTopGifters(5);
  const key = String(user).toLowerCase();
  const existing = tiktokLeaderboard.topGifters.get(key) || {
    user,
    nickname: nickname || user,
    totalDiamonds: 0,
    totalGifts: 0,
    lastGift: giftName,
    lastSeen: Date.now(),
  };
  existing.nickname = nickname || existing.nickname;
  const count = Math.max(1, Number(repeatCount) || 1);
  const diamondPerGift = Number(diamondCount) || 1;
  existing.totalDiamonds += (diamondPerGift * count);
  existing.totalGifts += count;
  existing.lastGift = giftName || existing.lastGift;
  existing.lastSeen = Date.now();
  tiktokLeaderboard.topGifters.set(key, existing);
  return getTopGifters(5);
}

function recordLike({ user, nickname, likeCount, totalLikes }) {
  const count = Math.max(1, Number(likeCount) || 1);
  if (totalLikes !== undefined && totalLikes > tiktokLeaderboard.totalLikes) {
    tiktokLeaderboard.totalLikes = totalLikes;
  } else {
    tiktokLeaderboard.totalLikes += count;
  }
  tiktokStatus.totalLikes = tiktokLeaderboard.totalLikes;

  if (user) {
    const key = String(user).toLowerCase();
    const existing = tiktokLeaderboard.topTappers.get(key) || {
      user,
      nickname: nickname || user,
      totalLikes: 0,
      lastSeen: Date.now(),
    };
    existing.nickname = nickname || existing.nickname;
    existing.totalLikes += count;
    existing.lastSeen = Date.now();
    tiktokLeaderboard.topTappers.set(key, existing);
  }

  return {
    totalLikes: tiktokLeaderboard.totalLikes,
    topTappers: getTopTappers(5),
  };
}

function resetTiktokLeaderboard() {
  tiktokLeaderboard.topGifters.clear();
  tiktokLeaderboard.topTappers.clear();
  tiktokLeaderboard.totalLikes = 0;
  tiktokStatus.totalLikes = 0;
}

function broadcastTiktok(eventType, payload) {
  const data = JSON.stringify(payload);
  const msg = `event: ${eventType}\ndata: ${data}\n\n`;
  for (const client of tiktokSseClients) {
    try {
      client.write(msg);
    } catch {
      tiktokSseClients.delete(client);
    }
  }
}

function attachTiktokListeners(conn, targetUsername) {
  conn.on("connected", (state) => {
    tiktokStatus.connected = true;
    tiktokStatus.username = targetUsername;
    tiktokStatus.roomId = state.roomId;
    tiktokStatus.error = null;
    log(`[TikTok Live] Connected to @${targetUsername} (Room ID: ${state.roomId})`);
    broadcastTiktok("connected", {
      username: targetUsername,
      roomId: state.roomId,
    });
    broadcastTiktok("leaderboard", {
      topGifters: getTopGifters(5),
      topTappers: getTopTappers(5),
      totalLikes: tiktokLeaderboard.totalLikes,
    });
  });

  conn.on("disconnected", () => {
    tiktokStatus.connected = false;
    log(`[TikTok Live] Disconnected from @${targetUsername}`);
    broadcastTiktok("disconnected", { username: targetUsername });
  });

  conn.on("streamEnd", () => {
    tiktokStatus.connected = false;
    log(`[TikTok Live] Stream @${targetUsername} ended.`);
    broadcastTiktok("streamEnd", { username: targetUsername });
  });

  conn.on("error", (err) => {
    const errMsg = err?.message || (typeof err === "object" ? (err.message || JSON.stringify(err)) : String(err));
    log(`[TikTok Live] Error: ${errMsg}`);
    tiktokStatus.error = errMsg;
    broadcastTiktok("error", { error: errMsg });
  });

  conn.on(WebcastEvent.CHAT, (data) => {
    // Di v2.5.0 teks ada di data.content atau data.comment
    const comment = (data.content || data.comment || data.text || "").trim();
    if (!comment) return;
    const user = data.user?.displayId || data.user?.uniqueId || data.uniqueId || "penonton";
    const nickname = data.user?.nickname || user;
    log(`[TikTok Live Chat] @${user}: ${comment}`);
    broadcastTiktok("chat", {
      user,
      nickname,
      comment,
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.GIFT, (data) => {
    const isRepeatEnd = data.repeatEnd === 1 || data.giftType !== 1;
    if (isRepeatEnd) {
      const user = data.user?.displayId || data.user?.uniqueId || data.uniqueId || "penonton";
      const nickname = data.user?.nickname || user;
      const giftName = data.giftName || data.name || data.extendedGiftInfo?.name || "Gift";
      const repeatCount = data.repeatCount || data.count || 1;
      const diamondCount = data.diamondCount || 0;
      log(`[TikTok Live Gift] @${user} sent ${giftName} x${repeatCount} (diamonds: ${diamondCount})`);

      const topGifters = recordGift({ user, nickname, giftName, repeatCount, diamondCount });

      broadcastTiktok("gift", {
        user,
        nickname,
        giftName,
        repeatCount,
        diamondCount,
        timestamp: Date.now(),
      });

      broadcastTiktok("leaderboard", {
        topGifters,
        topTappers: getTopTappers(5),
        totalLikes: tiktokLeaderboard.totalLikes,
      });
    }
  });

  conn.on(WebcastEvent.MEMBER, (data) => {
    const user = data.user?.displayId || data.user?.uniqueId || data.uniqueId || "";
    const nickname = data.user?.nickname || user || "kawan";
    if (!user && !nickname) return;
    log(`[TikTok Live Member Join] @${user} (${nickname}) masuk live.`);
    broadcastTiktok("member", {
      user,
      nickname,
      memberCount: data.memberCount || 0,
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.ROOM_USER, (data) => {
    if (data.viewerCount !== undefined) {
      tiktokStatus.viewerCount = data.viewerCount;
      broadcastTiktok("viewers", { viewerCount: data.viewerCount });
    }
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    const user = data.user?.displayId || data.user?.uniqueId || "";
    const nickname = data.user?.nickname || user;
    const likeCount = data.likeCount || 1;
    const likeStats = recordLike({
      user,
      nickname,
      likeCount,
      totalLikes: data.totalLikes,
    });

    broadcastTiktok("like", {
      user,
      nickname,
      likeCount,
      totalLikes: likeStats.totalLikes,
    });

    broadcastTiktok("leaderboard", {
      topGifters: getTopGifters(5),
      topTappers: likeStats.topTappers,
      totalLikes: likeStats.totalLikes,
    });
  });
}

app.post("/api/tiktok/connect", async (req, res) => {
  let { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "Username TikTok wajib diisi." });
  username = username.replace(/^@/, "").trim();
  if (!username) return res.status(400).json({ error: "Format username tidak valid." });

  try {
    if (tiktokConn) {
      try { tiktokConn.disconnect(); } catch (_) {}
      tiktokConn = null;
    }

    tiktokStatus.connected = false;
    tiktokStatus.username = username;
    tiktokStatus.error = null;

    log(`[TikTok Live] Menghubungkan ke @${username}...`);
    // enableExtendedGiftInfo: false agar tidak memanggil endpoint berbayar EulerStream
    const conn = new TikTokLiveConnection(username, {
      processInitialData: false,
      enableExtendedGiftInfo: false,
    });

    attachTiktokListeners(conn, username);
    tiktokConn = conn;

    const state = await conn.connect();
    tiktokStatus.connected = true;
    tiktokStatus.roomId = state.roomId;

    res.json({
      ok: true,
      username,
      roomId: state.roomId,
    });
  } catch (err) {
    const rawMsg = err?.message || String(err);
    let userFriendlyMsg = rawMsg;
    if (
      rawMsg.includes("Failed to retrieve Room ID from all sources") ||
      rawMsg.includes("isn't online") ||
      rawMsg.includes("user_not_found")
    ) {
      userFriendlyMsg = `Akun @${username} saat ini sedang TIDAK LIVE (offline) di TikTok. Pastikan akun sudah mulai siaran LIVE sebelum Connect.`;
    }
    log(`[TikTok Live] Gagal konek ke @${username}: ${userFriendlyMsg}`);
    tiktokStatus.connected = false;
    tiktokStatus.error = userFriendlyMsg;
    res.status(400).json({ error: userFriendlyMsg, raw: rawMsg });
  }
});

app.post("/api/tiktok/disconnect", async (_req, res) => {
  try {
    if (tiktokConn) {
      try { tiktokConn.disconnect(); } catch (_) {}
      tiktokConn = null;
    }
    tiktokStatus.connected = false;
    broadcastTiktok("disconnected", {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tiktok/status", (_req, res) => {
  res.json(tiktokStatus);
});

app.get("/api/tiktok/leaderboard", (_req, res) => {
  res.json({
    topGifters: getTopGifters(5),
    topTappers: getTopTappers(5),
    totalLikes: tiktokLeaderboard.totalLikes,
  });
});

app.get("/api/tiktok/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  tiktokSseClients.add(res);
  res.write(`event: status\ndata: ${JSON.stringify(tiktokStatus)}\n\n`);
  res.write(
    `event: leaderboard\ndata: ${JSON.stringify({
      topGifters: getTopGifters(5),
      topTappers: getTopTappers(5),
      totalLikes: tiktokLeaderboard.totalLikes,
    })}\n\n`,
  );

  req.on("close", () => {
    tiktokSseClients.delete(res);
  });
});

// Endpoint untuk simulasi uji coba gift, like, & chat saat testing
app.post("/api/tiktok/test-event", (req, res) => {
  const {
    type = "gift",
    user = "Sultan_TikTok",
    nickname = "Sultan TikTok",
    giftName = "Mawar Merah",
    repeatCount = 10,
    diamondCount = 100,
    likeCount = 15,
    comment = "Halo Supri, nyalain lagu iphonekupi dong!",
  } = req.body || {};

  if (type === "gift") {
    log(`[TikTok Test Event] Simulasi Gift dari @${user}: ${giftName} x${repeatCount} (diamond: ${diamondCount})`);
    const topGifters = recordGift({ user, nickname, giftName, repeatCount, diamondCount });
    broadcastTiktok("gift", {
      user,
      nickname,
      giftName,
      repeatCount,
      diamondCount,
      timestamp: Date.now(),
    });
    broadcastTiktok("leaderboard", {
      topGifters,
      topTappers: getTopTappers(5),
      totalLikes: tiktokLeaderboard.totalLikes,
    });
  } else if (type === "like") {
    log(`[TikTok Test Event] Simulasi Like/Tap dari @${user} (+${likeCount} tap)`);
    const likeStats = recordLike({ user, nickname, likeCount });
    broadcastTiktok("like", {
      user,
      nickname,
      likeCount,
      totalLikes: likeStats.totalLikes,
    });
    broadcastTiktok("leaderboard", {
      topGifters: getTopGifters(5),
      topTappers: likeStats.topTappers,
      totalLikes: likeStats.totalLikes,
    });
  } else if (type === "chat") {
    log(`[TikTok Test Event] Simulasi Chat dari @${user}: ${comment}`);
    broadcastTiktok("chat", {
      user,
      nickname,
      comment,
      timestamp: Date.now(),
    });
  } else if (type === "member" || type === "join") {
    log(`[TikTok Test Event] Simulasi Member Join dari @${user}`);
    broadcastTiktok("member", {
      user,
      nickname,
      memberCount: 12,
      timestamp: Date.now(),
    });
  } else if (type === "reset") {
    log(`[TikTok Test Event] Reset Leaderboard.`);
    resetTiktokLeaderboard();
    broadcastTiktok("leaderboard", {
      topGifters: [],
      topTappers: [],
      totalLikes: 0,
    });
  }
  res.json({
    ok: true,
    sent: { type, user, giftName, repeatCount, diamondCount, likeCount, comment },
    leaderboard: {
      topGifters: getTopGifters(5),
      topTappers: getTopTappers(5),
      totalLikes: tiktokLeaderboard.totalLikes,
    },
  });
});

// ---------- News Aggregator (LKBN ANTARA News / CNBC Indonesia) ----------
let cachedNews = [];
let lastNewsFetch = 0;
const NEWS_CACHE_TTL = 3 * 60 * 1000; // 3 menit

function cleanNewsText(t) {
  if (!t) return "";
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|quot|#39|apos|lt|gt);/g, (m) => ({
      "&amp;": "&",
      "&quot;": "\"",
      "&#39;": "'",
      "&apos;": "'",
      "&lt;": "<",
      "&gt;": ">",
    }[m] || m))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchIndonesianNews() {
  const now = Date.now();
  if (cachedNews.length > 0 && now - lastNewsFetch < NEWS_CACHE_TTL) {
    return cachedNews;
  }

  const newsList = [];

  // Sumber 1: LKBN ANTARA News (Top News & Berita Terkini)
  const antaraUrls = [
    { url: "https://www.antaranews.com/rss/top-news.xml", label: "ANTARA News" },
    { url: "https://www.antaranews.com/rss/terkini.xml", label: "ANTARA News" },
  ];

  for (const item of antaraUrls) {
    try {
      const res = await fetch(item.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SupriNews/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const xml = await res.text();
        const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/g;
        let m;
        while ((m = itemRegex.exec(xml)) && newsList.length < 25) {
          const title = cleanNewsText(m[1]);
          let summary = cleanNewsText(m[3]);
          if (summary.length > 160) summary = summary.slice(0, 150) + "...";
          if (title && !newsList.some((n) => n.title === title)) {
            newsList.push({
              title,
              cleanTitle: title,
              summary: summary || title,
              source: item.label,
              link: cleanNewsText(m[2]),
            });
          }
        }
      }
    } catch (err) {
      log(`[News Scrape Warning] Antara: ${err.message}`);
    }
  }

  // Sumber 2: CNBC Indonesia
  try {
    const res = await fetch("https://www.cnbcindonesia.com/news/rss", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SupriNews/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const xml = await res.text();
      const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/g;
      let m;
      while ((m = itemRegex.exec(xml)) && newsList.length < 35) {
        const title = cleanNewsText(m[1]);
        let summary = cleanNewsText(m[3]);
        if (summary.length > 160) summary = summary.slice(0, 150) + "...";
        if (title && !newsList.some((n) => n.title === title)) {
          newsList.push({
            title,
            cleanTitle: title,
            summary: summary || title,
            source: "CNBC Indonesia",
            link: cleanNewsText(m[2]),
          });
        }
      }
    }
  } catch (err) {
    log(`[News Scrape Warning] CNBC: ${err.message}`);
  }

  if (newsList.length > 0) {
    cachedNews = newsList;
    lastNewsFetch = now;
  }
  return cachedNews;
}

app.get("/api/news/latest", async (_req, res) => {
  try {
    const news = await fetchIndonesianNews();
    res.json(news);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
