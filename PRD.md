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

| State     | Visual                                                      | Aksi sistem                   |
| --------- | ----------------------------------------------------------- | ----------------------------- |
| IDLE      | Kepala diam, bernapas pelan, mata redup                     | Menunggu mic ON atau teks     |
| LISTENING | Label "LISTENING", waveform mengikuti suara mic, mata hijau | Speech-to-text berjalan       |
| THINKING  | Wireframe berdenyut, mata berkedip                          | Kirim teks ke LLM via 9router |
| SPEAKING  | Mulut bergerak sinkron, label "SPEAKING"                    | Putar TTS, animasi lip-sync   |

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
import express from "express";
const app = express();
app.use(express.json());
app.use(express.static("public"));

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  const r = await fetch(`${process.env.ROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.ROUTER_MODEL,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "Kamu Supri, asisten suara. Jawab singkat, santai, maksimal 3 kalimat.",
        },
        ...messages,
      ],
    }),
  });
  res.setHeader("Content-Type", "text/event-stream");
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
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

app.post("/api/tts", async (req, res) => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(
    "id-ID-ArdiNeural",
    OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
  );
  const { audioStream } = tts.toStream(req.body.text);
  res.setHeader("Content-Type", "audio/mpeg");
  audioStream.pipe(res);
});
```

Catatan: Edge TTS gratis tapi tidak resmi dan butuh internet, jadi bisa berubah sewaktu-waktu. Karena itu `speechSynthesis` tetap disiapkan sebagai cadangan.

## 9. Tech Stack

| Lapisan        | Pilihan                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Bahasa         | JavaScript (ES Modules)                                                                              |
| Build tool     | Vite                                                                                                 |
| Frontend       | Vanilla JS atau React (pilih salah satu; vanilla cukup untuk MVP)                                    |
| 3D             | Three.js (GLTFLoader, EffectComposer, UnrealBloomPass)                                               |
| STT            | Web Speech API `SpeechRecognition`                                                                   |
| TTS            | `speechSynthesis` (cadangan); utama Edge TTS via Node, suara id-ID-ArdiNeural atau id-ID-GadisNeural |
| Server         | Node.js + Express                                                                                    |
| LLM            | 9router (endpoint OpenAI-compatible, model gratis)                                                   |
| Monitor sistem | `systeminformation` (opsional)                                                                       |

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

| Fase | Isi                                                          | Estimasi |
| ---- | ------------------------------------------------------------ | -------- |
| 1    | Setup Vite + Express, koneksi ke 9router, chat teks berjalan | 1 hari   |
| 2    | Scene Three.js: kepala wireframe, mata, idle animation       | 1–2 hari |
| 3    | STT + TTS + state machine (listening, thinking, speaking)    | 1–2 hari |
| 4    | Lip-sync + streaming per kalimat + interrupt                 | 1–2 hari |
| 5    | HUD (panel kontrol, waveform, log, monitor) dan polish neon  | 2 hari   |

## 14. Kriteria Penerimaan MVP

- User bisa bicara dan mendapat jawaban suara tanpa mengetik.
- User bisa mengetik di Command Input dan mendapat jawaban suara.
- Mulut kepala 3D bergerak selama AI berbicara dan diam saat tidak berbicara.
- Tombol Interrupt menghentikan suara AI seketika.
- Tidak ada API key di kode frontend.
- Seluruh layanan yang dipakai gratis.

## 15. Risiko dan Mitigasi

| Risiko                                                                                                 | Mitigasi                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Model gratis kena rate limit atau lambat                                                               | Konfigurasi fallback combo di 9router, pakai model ringan                            |
| Web Speech API hanya optimal di Chrome/Edge dan butuh internet                                         | Sediakan input teks; opsi lanjutan Whisper lokal                                     |
| Suara `speechSynthesis` kaku dan tidak bisa dianalisis; endpoint Edge TTS tidak resmi dan bisa berubah | Pakai Edge TTS (Opsi B) dengan cadangan speechSynthesis + lip-sync simulasi (Opsi A) |
| Mic menangkap suara AI sendiri (feedback/echo)                                                         | Pause STT saat SPEAKING, atau pakai headset; aktifkan echo cancellation              |
| Lisensi model 3D                                                                                       | Pakai aset berlisensi bebas (CC0/MIT) atau buat sendiri di Blender                   |

## 16. Roadmap Lanjutan

- Kontrol PC lewat function calling (buka aplikasi, cari file).
- Memori jangka panjang (simpan ringkasan percakapan di file/SQLite).
- Wake word dan mode selalu mendengarkan.
- Ekspresi wajah berdasarkan emosi jawaban.
- Whisper lokal untuk STT offline.

## 17. Tambahan: Suara Sendiri (Voice Cloning dengan FireRedTTS3)

Supri berbicara dengan suara pemiliknya: jawaban dari AI dibacakan oleh FireRedTTS3-Base, model open source berlisensi Apache-2.0 yang bisa meniru suara dari satu rekaman pendek dan mendukung bahasa Indonesia. Edge TTS (bagian 8) tetap dipakai sebagai cadangan.

### 17.1 Yang perlu kamu siapkan: sampel suara

Model butuh dua hal sebagai "contoh": rekaman suaramu **dan teks persis yang kamu ucapkan** di rekaman itu (`prompt_audio` + `prompt_text`).

- Rekam suara sendiri berbahasa Indonesia, durasi sekitar 10 sampai 30 detik (README tidak menyebut durasi pasti, jadi uji beberapa panjang).
- Output meniru gaya bicara rekaman, jadi ucapkan dengan nada dan tempo seperti ngobrol biasa, bukan membaca kaku.
- Ruangan sepi, mic dekat mulut, tanpa musik atau gema, format WAV mono.
- Tulis transkrip kata per kata dan simpan: `voice/supri.wav` dan `voice/supri.txt`.
- Buat 2 atau 3 versi (santai, tegas) lalu pilih yang hasilnya paling mirip.

### 17.2 Arsitektur

```
Browser ──► Node (Express) ──► 9router (LLM, teks jawaban)
                 │
                 └─ /api/tts ──► Python FastAPI (FireRedTTS3, suara kamu)
                         └─ gagal/timeout ──► Edge TTS (cadangan)
```

FireRedTTS3 ditulis dengan Python (PyTorch), jadi dijalankan sebagai service terpisah di PC yang sama. Stack JavaScript tidak berubah: Node hanya meneruskan teks ke service itu lewat HTTP dan mengembalikan audionya ke browser.

### 17.3 Kebutuhan fungsional

1. Service TTS Python memuat model satu kali saat start, lalu menerima `POST /tts` berisi teks dan mengembalikan audio WAV.
2. Sampel suara (`supri.wav` + `supri.txt`) dimuat saat start dan dipakai di setiap permintaan.
3. Node `/api/tts` memanggil service cloning dengan timeout. Jika gagal atau melewati batas, otomatis pindah ke Edge TTS tanpa mengubah alur UI.
4. Jawaban LLM dipotong per kalimat dan dikirim ke TTS satu per satu, diputar berurutan supaya suara mulai terdengar sebelum seluruh jawaban selesai.
5. Audio hasil cloning diputar lewat `AnalyserNode` yang sama dengan Opsi B (bagian 7), jadi lip-sync mulut 3D tidak berubah.
6. Pengaturan di `.env`: `CLONE_URL`, `CLONE_TIMEOUT_MS`, dan pilihan engine (`clone` atau `edge`).

### 17.4 Sketsa service Python

```python
# tts_server.py (sketsa, cocokkan dengan README FireRedTTS3)
import io, torchaudio
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from fireredtts3.core import FireRedTTS3

app = FastAPI()
tts = FireRedTTS3("pretrained_models", use_wetext=True, use_llm_tn=False)
prompt_audio, prompt_sr = torchaudio.load("voice/supri.wav")
prompt_text = open("voice/supri.txt", encoding="utf-8").read().strip()

class Req(BaseModel):
    text: str

@app.post("/tts")
def synth(r: Req):
    audio, sr = tts.generate(
        language=None,            # None = deteksi otomatis; cek format tag bahasa di README
        prompt_text=prompt_text,
        prompt_audio=prompt_audio,
        prompt_audio_sr=prompt_sr,
        text=r.text,
        do_tn=True,
    )
    buf = io.BytesIO()
    torchaudio.save(buf, audio.cpu(), sr, format="wav")
    return Response(buf.getvalue(), media_type="audio/wav")
```

Instalasi dan unduh model mengikuti README: `pip install -r requirements.txt`, lalu `hf download FireRedTeam/FireRedTTS3 --local-dir pretrained_models/`. Jalankan dengan `uvicorn tts_server:app --port 8000`.

### 17.5 Angka, tanggal, dan singkatan

Normalisasi teks bawaan (`wetext`) hanya mendukung Mandarin dan Inggris. Untuk Indonesia, angka seperti "2026" atau "19:30" berisiko terbaca aneh. Solusi bertahap:

1. Tambahkan ke system prompt LLM: tulis angka, jam, dan singkatan dengan huruf seperti diucapkan (misal "jam tujuh malam").
2. Jika masih sering salah, aktifkan `use_llm_tn=True`. README meminta endpoint kompatibel OpenAI dan model berukuran 30B ke atas, yang bisa diarahkan ke 9router lewat `.env`.

### 17.6 Batasan lisensi

Lisensi kode dan model adalah Apache-2.0, tetapi README menyatakan fitur voice cloning ditujukan untuk riset akademik dan tidak boleh dipakai untuk aktivitas ilegal. Supri hanya memakai suara pemiliknya sendiri untuk keperluan pribadi; sampel suara orang lain tidak boleh dipakai tanpa izin.

### 17.7 Risiko khusus fitur ini

| Risiko                                                               | Mitigasi                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Model berat dan lambat tanpa GPU (kebutuhan VRAM belum diverifikasi) | Tes di PC kamu di Fase 1; kalau terlalu lambat, pakai Edge TTS sebagai default |
| Logat atau intonasi Indonesia kurang pas                             | Rekam ulang sampel dengan bahasa Indonesia santai, coba beberapa versi sampel  |
| Angka dan singkatan salah dibaca                                     | Prompt LLM + opsi `use_llm_tn` (17.5)                                          |
| Jeda sebelum suara keluar terlalu lama                               | Potong per kalimat, kalimat pertama pendek; cadangan Edge TTS                  |
| Repo dan API model baru dan bisa berubah                             | Kunci versi repo, bungkus pemanggilan model di satu file                       |

### 17.8 Milestone

| Fase | Isi                                                                                   | Estimasi |
| ---- | ------------------------------------------------------------------------------------- | -------- |
| 1    | Rekam sampel, pasang FireRedTTS3, tes generate satu kalimat dari terminal, ukur waktu | 1 hari   |
| 2    | Bungkus FastAPI, sambung ke Node `/api/tts`, fallback ke Edge TTS                     | 1 hari   |
| 3    | Antrian per kalimat + sambung ke lip-sync                                             | 1 hari   |
| 4    | Tuning sampel suara, normalisasi angka, uji kenyamanan percakapan                     | 1 hari   |

### 17.9 Kriteria penerimaan

- Suara jawaban Supri terdengar mirip suaramu dan dapat dipahami dalam bahasa Indonesia.
- Mulut 3D bergerak sinkron dengan suara hasil cloning.
- Jika service cloning mati, Supri otomatis memakai Edge TTS tanpa error di layar.
- Waktu dari akhir ucapan sampai suara pertama keluar diukur dan dicatat (target ditetapkan setelah Fase 1).
