# PRD: Supri – Voice AI Assistant dengan Wajah 3D

Versi 0.1 · Stack: JavaScript · LLM: gratis via 9router

## 1. Ringkasan

Supri (Personal AI Assistant) adalah aplikasi web bergaya HUD sci-fi ala Jarvis. Di tengah layar ada kepala 3D wireframe berwarna biru neon. User bicara (atau ketik), AI menjawab dengan suara, dan mulut kepala 3D bergerak sinkron seperti sedang telepon. Otak AI memakai model gratis lewat 9router, jadi biaya operasional nol.

## 2. Tujuan dan Non-Tujuan

**Tujuan**

- Percakapan suara real-time: bicara, dijawab suara, dengan jeda kurang dari 3 detik.
- Wajah 3D wireframe dengan status visual yang jelas (idle, listening, thinking, speaking) dan lip-sync mulut.
- Input teks sebagai alternatif suara (command input).
- Seluruh komponen memakai layanan gratis.
- Satu bahasa pemrograman: JavaScript.

**Non-Tujuan (versi 1)**

- Tidak ada akun/login multi-user.
- Tidak ada aplikasi mobile native.
- Tidak ada kontrol PC (buka aplikasi, file) di v1; ini masuk roadmap.
- Tidak ada clone suara.

## 3. Target Pengguna

Pengguna pribadi (kamu sendiri) yang ingin asisten AI lokal dengan tampilan keren dan interaksi seperti ngobrol di telepon.

## 4. User Stories

- Sebagai user, saya menekan tombol Microphone, lalu bicara, dan AI mendengarkan (status LISTENING + waveform bergerak).
- Sebagai user, saya mengetik pertanyaan di Command Input lalu Enter, dan AI menjawab.
- Sebagai user, saya melihat mulut kepala 3D bergerak saat AI berbicara.
- Sebagai user, saya bisa memotong AI yang sedang bicara (Interrupt / Voice Interrupt).
- Sebagai user, saya bisa mengatur sensitivitas mic.
- Sebagai user, saya bisa melihat log percakapan.

## 5. Fitur dan Kebutuhan Fungsional

### 5.1 Alur utama (state machine)

`IDLE → LISTENING → THINKING → SPEAKING → LISTENING (loop)`

| State | Visual | Aksi sistem |
| --- | --- | --- |
| IDLE | Kepala diam, bernapas pelan, mata redup | Menunggu mic ON atau teks |
| LISTENING | Label "LISTENING", waveform mengikuti suara mic, mata hijau | Speech-to-text berjalan |
| THINKING | Wireframe berdenyut, mata berkedip | Kirim teks ke LLM via 9router |
| SPEAKING | Mulut bergerak sinkron, label "SPEAKING" | Putar TTS, animasi lip-sync |

### 5.2 Fitur wajib (MVP)

1. **Wajah 3D wireframe** (Three.js): model kepala dengan material wireframe biru, mata menyala hijau, rotasi halus mengikuti mouse.
2. **Speech-to-Text**: Web Speech API (`SpeechRecognition`), bahasa `id-ID` (bisa diganti `en-US`). Gratis, berjalan di browser Chrome/Edge.
3. **LLM chat**: kirim teks ke endpoint 9router (format OpenAI-compatible), dengan streaming (SSE) agar jawaban cepat muncul.
4. **Text-to-Speech**: Microsoft Edge TTS lewat server Node (gratis, tanpa API key), suara Indonesia Ardi (cowok) atau Gadis (cewek). Cadangan: `speechSynthesis` browser (gratis). Dipakai kalau Edge TTS gagal.
5. **Lip-sync**: mulut terbuka-tutup mengikuti amplitudo audio (lihat bagian 7).
6. **Command Input**: kolom teks untuk kirim pertanyaan manual.
7. **Kontrol**: tombol Microphone ON/OFF, Interrupt, Voice Interrupt, slider Mic Sensitivity.
8. **Log percakapan**: panel yang bisa dibuka, menyimpan riwayat sesi.

### 5.3 Fitur tambahan (setelah MVP)

- Panel System Monitor (CPU, RAM, jaringan) memakai `systeminformation` di server Node.
- Upload file / gambar untuk ditanyakan ke AI.
- Wake word ("Halo Supri").
- Persona dan system prompt yang bisa diganti.
- Mode fullscreen dan tema warna.

## 6. Arsitektur

```
Browser (Frontend)
 ├─ UI HUD (HTML/CSS)
 ├─ Three.js  → render kepala 3D + lip-sync
 ├─ Web Speech API → mic ke teks (STT)
 ├─ speechSynthesis / audio → TTS
 └─ fetch (SSE) ──► Server Node.js (Express)
                        └─ proxy ──► 9router (OpenAI-compatible) ──► model gratis
```

Server Node dipakai sebagai perantara supaya API key tidak terekspos di browser, dan sebagai tempat monitor sistem serta TTS server-side jika dibutuhkan.

## 7. Desain Lip-Sync

Ini bagian paling krusial. Ada dua pendekatan:

**Opsi A – Sederhana (cadangan)**: pakai `speechSynthesis` bawaan browser. Masalahnya audio-nya tidak bisa dianalisis lewat Web Audio. Solusinya: saat event `start` aktif sampai `end`, generate nilai buka-mulut palsu berbentuk gelombang (kombinasi sinus + noise) dan tambahkan lonjakan di event `boundary` (per kata). Hasilnya cukup meyakinkan untuk gaya wireframe.

**Opsi B – Akurat (default)**: TTS menghasilkan file/stream audio (Edge TTS via server Node, endpoint /api/tts). Audio diputar lewat `<audio>` yang dihubungkan ke `AudioContext` + `AnalyserNode`. Setiap frame hitung RMS amplitudo, lalu mapping ke nilai `mouthOpen` 0 sampai 1 dengan smoothing (lerp).

**Penerapan ke model 3D**

- Jika model punya morph target / blendshape (`jawOpen`, `mouthOpen`), set `morphTargetInfluences[idx] = mouthOpen`.
- Jika tidak ada, gerakkan vertex area rahang bawah di vertex shader atau rotasi bone rahang (`jaw.rotation.x = mouthOpen * 0.3`).
- Tambahan: kedip mata acak, gerak kepala kecil (idle sway), dan mata menyala lebih terang saat bicara.

**Aset model**: gunakan model kepala low-poly gratis berformat `.glb` (lisensi harus memperbolehkan pemakaian bebas) yang punya blendshape. Render dengan `MeshBasicMaterial({ wireframe: true, color: 0x2aa8ff })` plus bloom ringan (`UnrealBloomPass`) untuk efek neon.

## 8. Integrasi 9router

9router berfungsi sebagai router/proxy yang menyediakan endpoint kompatibel OpenAI dan meneruskan ke berbagai provider model, termasuk tier gratis dengan fallback otomatis. Detail yang perlu dikonfirmasi saat setup (cek dokumentasi 9router versi yang dipakai):

- Base URL (biasanya lokal, misal `http://localhost:<port>/v1`).
- API key dan nama model/combo yang tersedia.
- Format request: `POST /chat/completions` dengan `stream: true`.

Contoh server proxy minimal:

```js
// server.js
import express from 'express';
const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const r = await fetch(`${process.env.ROUTER_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.ROUTER_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: 'Kamu Supri, asisten suara. Jawab singkat, santai, maksimal 3 kalimat.' },
        ...messages,
      ],
    }),
  });
  res.setHeader('Content-Type', 'text/event-stream');
  for await (const chunk of r.body) res.write(chunk);
  res.end();
});

app.listen(3000);
```

System prompt wajib menyuruh jawaban singkat karena output akan dibacakan, bukan dibaca.

### Endpoint TTS (Edge TTS, gratis)

Suara Indonesia dari Microsoft: `id-ID-ArdiNeural` (cowok) dan `id-ID-GadisNeural` (cewek). Server Node memanggil layanan baca-suara Edge lewat paket npm (misal `msedge-tts`), lalu mengirim audio MP3 ke browser. Browser memutarnya lewat `<audio>` yang disambung ke `AnalyserNode`, sehingga lip-sync memakai amplitudo suara asli. Cek README paket yang dipakai karena nama fungsinya bisa beda antar versi.

```js
// tambahan di server.js (sketsa, sesuaikan dengan versi paket)
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

app.post('/api/tts', async (req, res) => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata('id-ID-ArdiNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(req.body.text);
  res.setHeader('Content-Type', 'audio/mpeg');
  audioStream.pipe(res);
});
```

Catatan: Edge TTS gratis tapi tidak resmi dan butuh internet, jadi bisa berubah sewaktu-waktu. Karena itu `speechSynthesis` tetap disiapkan sebagai cadangan.

## 9. Tech Stack

| Lapisan | Pilihan |
| --- | --- |
| Bahasa | JavaScript (ES Modules) |
| Build tool | Vite |
| Frontend | Vanilla JS atau React (pilih salah satu; vanilla cukup untuk MVP) |
| 3D | Three.js (GLTFLoader, EffectComposer, UnrealBloomPass) |
| STT | Web Speech API `SpeechRecognition` |
| TTS | `speechSynthesis` (cadangan); utama Edge TTS via Node, suara id-ID-ArdiNeural atau id-ID-GadisNeural |
| Server | Node.js + Express |
| LLM | 9router (endpoint OpenAI-compatible, model gratis) |
| Monitor sistem | `systeminformation` (opsional) |

## 10. Optimasi Latensi

- Streaming jawaban LLM, lalu potong per kalimat (deteksi `.`, `?`, `!`) dan langsung kirim kalimat pertama ke TTS tanpa menunggu jawaban penuh.
- Antrian TTS: kalimat berikutnya diputar otomatis setelah kalimat sebelumnya selesai.
- Pakai model ringan/cepat di 9router untuk percakapan suara.
- Batasi riwayat percakapan (misal 10 pesan terakhir) agar prompt tidak membengkak.

## 11. Kebutuhan Non-Fungsional

- Performa: render 3D minimal 30 FPS di laptop menengah.
- Latensi: dari akhir ucapan sampai mulai suara jawaban kurang dari 3 detik (target, tergantung model gratis).
- Kompatibilitas: Chrome/Edge desktop (Web Speech API belum konsisten di browser lain).
- Privasi: API key hanya di server (`.env`), tidak di kode frontend.
- Ketahanan: tangani error jaringan dan rate limit model gratis dengan pesan di log serta retry sekali.

## 12. Struktur Proyek

```
supri/
 ├─ server.js
 ├─ .env            # ROUTER_URL, ROUTER_KEY, ROUTER_MODEL
 ├─ package.json
 └─ public/ (atau src/ jika Vite)
     ├─ index.html
     ├─ main.js        # state machine + orkestrasi
     ├─ face3d.js      # scene Three.js + lip-sync
     ├─ stt.js         # SpeechRecognition
     ├─ tts.js         # antrian audio Edge TTS + cadangan speechSynthesis
     ├─ chat.js        # fetch SSE ke /api/chat
     ├─ hud.css
     └─ assets/head.glb
```

## 13. Milestone

| Fase | Isi | Estimasi |
| --- | --- | --- |
| 1 | Setup Vite + Express, koneksi ke 9router, chat teks berjalan | 1 hari |
| 2 | Scene Three.js: kepala wireframe, mata, idle animation | 1–2 hari |
| 3 | STT + TTS + state machine (listening, thinking, speaking) | 1–2 hari |
| 4 | Lip-sync + streaming per kalimat + interrupt | 1–2 hari |
| 5 | HUD (panel kontrol, waveform, log, monitor) dan polish neon | 2 hari |

## 14. Kriteria Penerimaan MVP

- User bisa bicara dan mendapat jawaban suara tanpa mengetik.
- User bisa mengetik di Command Input dan mendapat jawaban suara.
- Mulut kepala 3D bergerak selama AI berbicara dan diam saat tidak berbicara.
- Tombol Interrupt menghentikan suara AI seketika.
- Tidak ada API key di kode frontend.
- Seluruh layanan yang dipakai gratis.

## 15. Risiko dan Mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Model gratis kena rate limit atau lambat | Konfigurasi fallback combo di 9router, pakai model ringan |
| Web Speech API hanya optimal di Chrome/Edge dan butuh internet | Sediakan input teks; opsi lanjutan Whisper lokal |
| Suara `speechSynthesis` kaku dan tidak bisa dianalisis; endpoint Edge TTS tidak resmi dan bisa berubah | Pakai Edge TTS (Opsi B) dengan cadangan speechSynthesis + lip-sync simulasi (Opsi A) |
| Mic menangkap suara AI sendiri (feedback/echo) | Pause STT saat SPEAKING, atau pakai headset; aktifkan echo cancellation |
| Lisensi model 3D | Pakai aset berlisensi bebas (CC0/MIT) atau buat sendiri di Blender |

## 16. Roadmap Lanjutan

- Kontrol PC lewat function calling (buka aplikasi, cari file).
- Memori jangka panjang (simpan ringkasan percakapan di file/SQLite).
- Wake word dan mode selalu mendengarkan.
- Ekspresi wajah berdasarkan emosi jawaban.
- Whisper lokal untuk STT offline.
