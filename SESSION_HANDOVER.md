# DOKUMEN HANDOVER & PANDUAN SESI PROYEK SUPRI
**Tanggal Pembuatan**: 21 Oktober 2026  
**Repositori**: `supri-tiktok`  
**Tujuan Dokumen**: Menyimpan seluruh riwayat percakapan, keputusan desain, arsitektur kode, status fitur, dan instruksi setup agar agent AI di laptop baru bisa langsung melanjutkan tugas tanpa kehilangan konteks sama sekali.

---

## 1. Ringkasan & Identitas Proyek
- **Nama Proyek**: SUPRI (Personal AI Assistant)
- **Konsep**: Asisten AI bergaya Jarvis dengan antarmuka visual wajah manusia wireframe 3D futuristik (cyberpunk/scifi neon).
- **Alur Utama**: `IDLE → LISTENING → THINKING → SPEAKING → LISTENING (loop)`
- **Tech Stack**:
  - **Frontend**: Vanilla JavaScript (ES Modules), HTML5, Vanilla CSS (`hud.css`).
  - **3D Graphics**: Three.js (Three core, `GLTFLoader`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`). Model dasar wajah: `LeePerrySmith.glb` (atau fallback kepala prosedural).
  - **Backend Server**: Node.js + Express (`server.js`) pada port `3000`.
  - **Build Tool**: Vite (`vite.config.js`) pada port `5173` (proxy `/api` ke `localhost:3000`).
  - **LLM**: BeatAPI (OpenAI-compatible di `https://api.beatapi.io/v1`, model default `glm-5.3-flash-free`) dengan fallback opsi 9router (`http://127.0.0.1:20128/v1`).
  - **STT**: Web Speech API (`SpeechRecognition`).
  - **TTS**: Multi Engine — **FireRedTTS3-Base** (lokal, suara sendiri hasil kloning) + **Fish Audio** (cloud API, model gratis `s2.1-pro-free`) + **Microsoft Edge TTS** (`id-ID-ArdiNeural` / `id-ID-GadisNeural`) + fallback browser `speechSynthesis`.
  - **Voice Cloning Service**: Python FastAPI (`tts_server.py`) pada port `8000`.

---

## 2. Aturan Penting Pengguna (User Rules & Constraints)
1. **DILARANG BUILD PROYEK**:
   - `dont build this project example: dotnet build`
   - Jangan jalankan build bundle produksi jika tidak diminta secara eksplisit.
2. **Karakter & Bahasa**:
   - Gaya komunikasi santai, responsif, bahasa Indonesia wajar.
3. **Estetika Wajah 3D**:
   - Garis wireframe kepala warna biru neon tajam (`0x2aa8ff` / `0x44c0ff`).
   - Mata hijau zamrud menyala (`0x00ff66`) dengan pupil hitam pekat bulat manusia (`0x000000`) dan pantulan titik putih (*specular glint*).
   - Mulut harus simetris sejajar dengan ujung hidung, filtrum, dan dagu.
   - Tidak boleh ada ornamen/garis mengambang di luar kepala yang mengganggu estetika.
   - Kepala menghadap ke tengah (center), hanya melakukan gerakan lirikan (*idle head sway/look*) halus acak, dan kembali ke tengah saat berbicara.

---

## 3. Status Terkini Fitur & Modul

### A. Wajah 3D & Lip-Sync (`src/face3d.js`, `src/tts.js`)
- **Model 3D**: Menggunakan `public/head.glb` (model kepala 3D manusia LeePerrySmith) dengan fallback kepala prosedural.
- **Koreksi Simetri**: Dilakukan penambahan `FINAL_OFFSET_X = 0.032` pada vertex mesh agar ujung hidung, filtrum, dan mulut berada tepat di sumbu tengah $X = 0.0004$.
- **Mata & Tatapan Hidup**: Sumbu soket mata diselaraskan presisi simetris pada $X = \pm 0.240$, ketinggian dinaikkan ke $Y = 0.123$ (sejajar sempurna dengan bukaan kelopak mata 3D model), kontur kelopak mata almond parametrik tertutup, pupil hitam bulat pekat manusia, serta dilengkapi mikro-lirikan (*micro-saccades*) halus dinamis agar mata tampak hidup berinteraksi dengan penonton live.
- **Artikulasi Mulut & Mimik Wajah Manusiawi Saat Berbicara (`SPEAKING`)**:
  - **Kurva Bibir Dinamis & Celah Mulut**: Sudut mulut terhubung kontinu tanpa robek (`cornerW, cornerY, cornerZ`). Bibir atas terangkat di bagian tengah (*Cupid's bow lift*) memperlihatkan barisan gigi atas, dan bibir bawah membuka turun secara dalam (*open drop*) seiring artikulasi vokal.
  - **Dental Arch Ribbon (Gigi Cyber Pearl White)**: Barisan gigi 3D pearl white atas dan bawah dengan aksen berkilau bersih di dalam rongga mulut, tampil jelas dan kontras saat berbicara maupun saat tersenyum/nyengir.
  - **Rongga Mulut Hitam Pekat (Depth Interior Cavity)**: Menghubungkan bibir dalam atas dan bawah ke kedalaman $Z$, memberikan ilusi rongga mulut 3D yang nyata dan kontras tinggi dari sudut pandang penonton.
  - **Deformasi Rahang Bawah**: Faktor rotasi rahang bawah ditingkatkan menjadi $0.38$ radian sehingga struktur dagu dan pipi wireframe bergerak turun secara tegas dan dinamis.
  - **Alis Dinamis (Conversational Eyebrow Gestures)**: Alis kiri dan kanan bergerak naik-turun selaras dengan intonasi suku kata bicara dan sedikit asimetris alami manusia (`setBrows`), mengernyit saat berpikir (`THINKING`), dan terangkat riang saat tersenyum/tertawa.
  - **Bahasa Tubuh & Gestur Presenter Saat Bicara (Dynamic Presenter Sway & Gaze Shifts)**:
    - **Anti-Kaku Satu Arah**: Kepala dan tubuh tidak lagi terpaku menghadap lurus ke depan, melainkan menoleh dinamis ke kiri dan kanan menyapa berbagai sudut audiens stream layaknya presenter panggung / host TikTok live yang ekspresif.
    - **Audience Focus Yaw Switching**: Mengubah target sudut toleh secara berkala (tiap 1.8 - 3.4 detik) bergantian antara penonton sisi kiri ($-15^\circ$ s/d $-22^\circ$), tengah, dan kanan ($+15^\circ$ s/d $+22^\circ$) berpadu dengan osilasi mikro ritmis artikulasi suara.
    - **Translasi Tubuh & Goyang Badan (Horizontal Body Sway)**: Seluruh badan dan rig kepala berayun horizontal luwes ($X \approx \pm 0.12$ unit) mengikuti pergeseran berat badan pembicara.
    - **Kemiringan Kepala Luwes (Roll / Head Tilt)**: Kemiringan leher otomatis menyeimbangkan ayunan badan dengan aksen gestur santai.
    - **Anggukan Artikulasi (Pitch Nod)**: Anggukan ritmis penekanan suku kata dan kata penting yang terhubung dengan bukaan mulut.
    - **Gaze Direction Following**: Tatapan mata (pupil) secara cerdas ikut mengarahkan fokus ke sudut audiens yang sedang disapa.
    - **Transisi Mulus (Zero Snapping)**: Damping eksponensial (`smoothRate`) menjamin peralihan sudut toleh sangat luwes dan otomatis meluncur kembali ke posisi tengah netral saat kembali ke status `IDLE`.
  - **Lip-Sync Audio Formant Processing (`src/tts.js`)**: `level()` menggabungkan analisis domain waktu (RMS) dengan analisis domain frekuensi vokal manusia (formants F1-F2: 180 Hz - 2400 Hz) serta envelope follower (*fast-attack, smooth-decay*), menghasilkan respons bukaan mulut yang proporsional dan ekspresif ($0.45 - 0.85$ saat berbicara normal).

### B. Backend Node.js (`server.js`)
- **Port**: `3000`.
- **Router LLM (`/api/chat`)**: SSE stream passthrough atau SSE wrapper untuk upstream JSON, mendukung BeatAPI (`glm-5.3-flash-free`) maupun 9router dengan auto-retry model.
- **Multi-Engine TTS (`/api/tts`)**:
  - **Local Cloning**: Memanggil service Python FireRedTTS3 di `http://127.0.0.1:8000/tts`.
  - **ElevenLabs TTS**: Memanggil `@elevenlabs/elevenlabs-js` dengan model `eleven_multilingual_v2`. Mendukung prefix dinamis `elevenlabs:<voice_id>`. Akun free tier mendukung 21 suara kategori *Premade* (Sarah, Brian, Jessica, Roger, Bella, Eric, dll.). Suara library/professional (seperti Citra, Abyasa, Putra) membutuhkan saldo/langganan berbayar (error 402 dicegah dengan fallback halus ke Edge TTS).
  - **Fish Audio**: Memanggil `https://api.fish.audio/v1/tts` dengan model gratis `s2.1-pro-free`.
  - **Microsoft Edge TTS**: Cadangan gratis & responsif (`id-ID-ArdiNeural`, `id-ID-GadisNeural`, `en-US-GuyNeural`, `en-US-JennyNeural`).
  - **Fallback Cerdas**: Jika provider eksternal offline atau limit tercapai, otomatis dialihkan ke Edge TTS tanpa membuat audio macet di UI.
- **Persona Host TikTok Live (Gen Alpha / Sigma Brainrot)**: `DEFAULT_PERSONA` diatur sebagai **Supri, AI Streamer Paling Sigma & Ber-Aura Tak Terbatas** dengan gaya bicara khas bocah Gen Alpha & Sigma streamer TikTok (panggilan "gue" dan "lu", selalu menyapa penonton dengan sebutan "chat", slang "sigma", "skibidi", "rizz/rizzler", "mewing", "looksmaxxing", "aura", "plus seribu aura", "minus sepuluh ribu aura", "no cap", "fiks no counter", "let him cook", "Ohio"). Dilengkapi **Pantangan Mutlak**: Supri dilarang *break character* atau beralasan teknis seperti *"gue cuma wireframe/gambar/program"* atau *"omongan gue ngarang"*; ia harus percaya diri menganggap dirinya benar-benar punya suara dan sedang live stream di TikTok. Respons singkat 1-2 kalimat (maksimal 3), tanpa emoji, tanpa markdown, dan angka/simbol wajib dieja dengan kata (contoh: *"plus seribu aura"*).
- **Monitor Sistem (`/api/system`)**: Membaca CPU, RAM, dan statistik transfer jaringan via `systeminformation`.
- **Konfigurasi (`/api/config`)**: Menyediakan konfigurasi model aktif dan status TTS engine.

### C. Frontend & HUD (`src/main.js`, `src/index.html`, `src/hud.css`)
- Menu dropdown **SUARA** dikelompokkan secara rapi dengan `<optgroup>`:
  1. `🌟 LOCAL / CLONE` (FireRedTTS3)
  2. `⚡ ELEVENLABS (FREE PREMADE)` (21 suara siap pakai: Sarah, Brian, Jessica, Roger, Eric, Bella, Charlie, George, dll.)
  3. `🔒 ELEVENLABS (LIBRARY - BUTUH SALDO)` (Citra, Abyasa, Putra, Deandra Putri, Dakocan)
  4. `🐟 FISH AUDIO` (Raffi Ahmad `ca7021b2022d4b0fa84f53b67511b2c0`, Prabowo `b8d594e696694b499aa12e32d0c1b618`, Narator Berita Olahraga `d0b314896b3a479aa5cb04c29a8e9e25`, Ola Narator `666f0c8d71484f1980523d00141629a0`, & Fish Default via model gratis `s2.1-pro-free`)
  5. `🌐 MICROSOFT EDGE TTS` (Ardi, Gadis, Guy, Jenny)
- Teks HUD status TTS diperbarui secara dinamis mengikuti nama suara terpilih (misal: `TTS: 11Labs (Roger)`, `TTS: Fish (Raffi Ahmad)`, `TTS: Fish (Narator Berita Olahraga)`).
- **Lip-Sync & Mimik Wajah Ekspresif**: `AnalyserNode` di `src/tts.js` membaca audio buffer untuk menggerakkan bibir 3D dan waveform neon. Dilengkapi mimik tawa otomatis: saat kalimat terdeteksi tertawa (*"wkwk"*, *"haha"*, *"kocak"*, *"lucu"*, dll.), mata menyipit senang (*eyes squinting/sipit*) dan sudut mulut tertarik lebar tersenyum/nyengir (*grin*) menampakkan gigi cyber mutiara putih dengan getaran tawa halus. Terdapat juga senyum acak berkala saat IDLE agar mimik wajah hidup dan seru.
- **Fitur Lagu Iphonekupi & Joget Mosing**:
  - File audio: `assets/music/song-iphonekupi.mp3` (disajikan via `public/music/song-iphonekupi.mp3` dan `/music/song-iphonekupi.mp3`).
  - Trigger: user berbicara atau mengetik perintah seperti *"stel lagu iphonekupi"*, *"putar lagu iphonekupi"*, *"iphonekupi"*, atau klik tombol HUD `[🎵 IPHONEKUPI MOSH]`.
  - Animasi: kepala 3D melakukan gerakan *moshpit / headbanging* energetik (goyang miring kiri-kanan, angguk headbang naik-turun cepat, lompat mantul) dengan mata sipit dan senyum nyengir gembira, lampu neon berubah magenta/pink berpendar, dan waveform neon merespons musik.
  - **Background Iklan Moshing Warna Solid Bergerak Kiri-Kanan (`MoshBackdrop` di `src/face3d.js`)**:
    - Ditempatkan tepat di belakang wajah 3D ($Z = -1.6$) dengan multi-layer parallax 3D.
    - **Visual Pop Art & Iklan Komersial**: Menggunakan panel split-color blocking warna solid cerah (lebar 24 unit, tinggi 16 unit), divider kontras, central pop graphic disc berputar di belakang kepala, dynamic accent stripes miring, dan dua pita horizontal *kinetic typography marquee banner* (`"★ IPHONEKUPI ★ MOSHPIT PARTY ★ SUPRI LIVE ★ DROP THE BASS ★"` dan `"/// HEADBANG /// SENGGOL DONG /// TAP TAP LAYAR /// GASKEUN ///"`).
    - **Sinkronisasi Gerak Kiri-Kanan**: Background berayun ke kiri dan kanan secara dramatis ($X \approx \pm 0.85$ unit) selaras dengan beat lagu dan goyangan kepala, lengkap dengan tilt rotasi $Z$ dinamis dan beat kick scale pulse.
    - **Color Cycling 5 Palet Solid**: Otomatis berganti snap-cut tiap 16 beat antara 5 palet warna solid iklan (Hot Pink & Electric Yellow, Neon Cyan & Pop Orange, Cyber Violet & Lime Acid, Crimson & Cobalt Blue, Monochrome High-Contrast).
    - **Transisi Mulus**: Fade-in halus saat musik dimulai dan fade-out otomatis kembali ke background sci-fi gelap saat moshing selesai.
  - Audio Ducking: saat Supri berbicara di tengah lagu, volume musik mengecil otomatis menjadi 25% agar suara TTS tetap terdengar jelas. Musik bisa dihentikan kapan saja via perintah suara (*"stop lagu"*, *"berhenti"*) atau tombol `INTERRUPT` / `ESC`.
- **Modul TikTok Live Connector, Smart Chat Queue & Auto-Sapa Penonton Join**:
  - Library: `tiktok-live-connector` (Node.js).
  - Backend Endpoints (`server.js`):
    - `POST /api/tiktok/connect`: Memulai koneksi real-time ke room streamer TikTok (`uniqueId`).
    - `POST /api/tiktok/disconnect`: Memutus koneksi stream.
    - `GET /api/tiktok/status`: Status room, username, jumlah penonton, error.
    - `GET /api/tiktok/events`: Server-Sent Events (SSE) stream (`chat`, `gift`, `member`, `viewers`, `like`, `connected`, `disconnected`).
    - `POST /api/tiktok/test-event`: Endpoint simulasi testing untuk gift, chat, dan member join.
  - Frontend (`src/main.js`, `src/index.html`, `src/hud.css`):
    - Widget kontrol live di panel kanan (`.tiktok-box`): input `@username_live`, tombol `[CONNECT]` / `[DISCONNECT]`, badge status (`OFFLINE` / `CONNECTING` / `LIVE`), live viewer count, toggle checkbox `Sapa penonton baru join`, dan notifikasi antrean chat.
    - **Fitur Sapa Penonton Baru Join (`member` event)**:
      - Begitu ada penonton baru bergabung ke live stream, Supri otomatis menyapa: *"Halo ka [nama], selamat datang di live!"* dengan variasi template ramah khas host Gen Z.
      - **Pembersihan Nama Cerdas (`cleanViewerName`)**: Menghilangkan emoji, tagar, dan simbol agar ucapan TTS terdengar jelas dan natural.
      - **Anti-Spam Deduplication (60s)**: Penonton yang sama tidak akan disapa berulang kali dalam jeda 60 detik.
      - **Smart Batching**: Jika beberapa penonton masuk berdekatan, Supri menggabungkan sapaan (*"Halo ka Budi dan ka Siti, selamat datang di live!"*) agar tidak terjadi penumpukan suara.
      - **Prioritas Chat & Anti-Tumpang-Tindih**: Sapaan hanya dijalankan saat Supri dalam kondisi santai (`IDLE`), tidak memotong obrolan chat, dan tidak menyela saat musik moshing berputar.
    - **Smart Chat Queue**: Komentar penonton ditampung di antrean dan diproses satu per satu saat Supri dalam kondisi `IDLE` dengan jeda santai 2 detik antar komentar untuk mencegah tumpang-tindih suara.
    - **Penanganan Hadiah/Gift & Auto Moshing**: Begitu ada penonton yang mengirim gift/saweran apa pun (Mawar, Donat, Paus, dll.), sistem otomatis memutar lagu iPhonekupi dan mengaktifkan mode moshing joget heboh kepala 3D beserta background iklan warna solid bergerak. Supri langsung berseru menyapa nama penyawer (*"Wanjay saweran masuk dari [user]! Kirim [gift]! Gas moshpit lagu iphonekupi bro senggol dong!"*). Audio ducking otomatis mengecilkan volume musik saat Supri berbicara dan kembali kencang saat joget berlanjut.
    - Interaksi Nama Penonton: Komentar dikirimkan ke LLM dengan format `[nama_penonton]: [komentar]`, di mana Supri secara otomatis menyapa nama penonton dengan gaya Gen Z.
    - **Minimalist Collapsible Chat Input Dock**:
      - Form input ketikan komentar disembunyikan secara default (`display: none;`) demi menjaga layar live stream tetap bersih, futuristik, dan fokus ke visual kepala 3D Supri.
      - Ditampilkan tombol pemicu ringkas bergaya cyberpunk: `[ 💬 KETIK KOMENTAR ]` di dock bawah.
      - Saat tombol diklik (atau menekan tombol keyboard `C`), kolom input komentar meluncur naik (*slide-up animation*) dan langsung fokus siap ketik.
      - Dilengkapi tombol tutup `✕`, auto-hide otomatis saat komentar dikirim (`submit`), serta dukungan tombol `Escape` untuk menutup kembali kotak ketikan.

### D. Fitur Voice Cloning (PRD Bagian 17)
- **Sampel Suara**:
  - File: `voice/supri.wav` (durasi 11.37 detik, format **RIFF WAV PCM 16-bit 24.000 Hz Mono**).
  - Cadangan file asli: `voice/supri_original.m4a`.
  - Transkrip persis: `voice/supri.txt` berisi:
    `Halo, kenalkan saya Supri. Saya adalah asisten kecerdasan buatan pribadi yang siap membantu aktivitas sehari-hari, menjawab pertanyaan, dan mengontrol sistem komputer kamu kapan saja.`
- **Microservice Python (`tts_server.py`)**:
  - Dibuat menggunakan FastAPI.
  - Endpoint `GET /health` untuk memeriksa kesiapan sampel suara dan bobot model.
  - Endpoint `POST /tts` untuk menghasilkan audio WAV hasil kloning suara user.
- **Helper Scripts**:
  - `requirements-tts.txt`: Kebutuhan paket Python (`fastapi`, `uvicorn`, `torch`, `torchaudio`, dll).
  - `run_tts.bat`: Script 1-klik untuk Windows (menggunakan runner cepat `uv`).

---

## 4. Konfigurasi Lingkungan (`.env`)

File `.env` di root project memiliki konfigurasi berikut:
```env
# LLM Endpoint (BeatAPI / 9router)
ROUTER_URL=https://api.beatapi.io/v1
BEATAPI_API_KEY=
ROUTER_KEY=
ROUTER_MODEL=glm-5.3-flash-free

# Opsi alternatif jika ingin kembali ke 9router lokal:
# ROUTER_URL=http://127.0.0.1:20128/v1
# ROUTER_KEY=sk-xxxx
# ROUTER_MODEL=ag/gemini-3.8-flash-low,ag/gemini-3.7-flash-low

TTS_VOICE=id-ID-ArdiNeural

# Konfigurasi Voice Cloning (PRD Bagian 17)
TTS_ENGINE=clone
CLONE_URL=http://127.0.0.1:8000/tts
CLONE_TIMEOUT_MS=12000

PORT=3000
```

---

## 5. Panduan Menjalankan Proyek di Laptop Baru

### Langkah 1: Clone / Copy Folder
Pastikan seluruh direktori `supri-tiktok` disalin ke laptop baru, termasuk folder `voice/` dan model jika sudah ada.

### Langkah 2: Install Dependensi Node.js & Jalankan Server
Buka terminal di root project:
```powershell
npm install
npm run dev
```
Perintah `npm run dev` akan menjalankan dua service sekaligus secara paralel via `concurrently`:
1. Node Express Backend: `http://localhost:3000`
2. Vite Frontend Server: `http://localhost:5173` (atau `5174`)

### Langkah 3: Mengaktifkan Voice Cloning (Python Service)
Pastikan di laptop baru terpasang Python 3.10/3.11 atau `uv`.

1. **Unduh Model Bobot FireRedTTS3**:
   Unduh model dari Hugging Face ke folder `pretrained_models/`:
   ```powershell
   # Install CLI huggingface_hub jika belum ada
   uv pip install "huggingface_hub[cli]"
   # Unduh model
   hf download FireRedTeam/FireRedTTS3 --local-dir pretrained_models/
   ```

2. **Jalankan Service TTS**:
   Cukup klik dua kali `run_tts.bat` atau jalankan lewat terminal:
   ```powershell
   ./run_tts.bat
   # atau via uv:
   uv run python tts_server.py
   ```
   Service akan standby di `http://127.0.0.1:8000`.

### Catatan Penting Saat Menjalankan:
- Jika service Python belum dinyalakan, Supri **tetap bisa dipakai** secara normal karena `server.js` otomatis beralih ke Edge TTS tanpa error.
- Jika port `3000` atau `5173` bentrok karena proses lama yang belum tertutup, cek PID dengan:
  ```powershell
  Get-NetTCPConnection -LocalPort 3000, 5173 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
  Stop-Process -Id <PID> -Force
  ```

---

## 6. Daftar File Penting dalam Repositori

```
supri-tiktok/
├── .env                         # Konfigurasi API key 9router dan endpoint TTS
├── .env.example                 # Template environment variables
├── package.json                 # Dependensi Node (express, three, msedge-tts, vite, dll)
├── server.js                    # Backend Express: proxy chat, dual-engine TTS, monitor
├── vite.config.js               # Konfigurasi Vite & proxy /api ke server.js
├── tts_server.py                # Service Python FastAPI untuk voice cloning FireRedTTS3
├── requirements-tts.txt         # Dependensi Python untuk service TTS
├── run_tts.bat                  # Skrip runner cepat service TTS di Windows
├── PRD.md                       # Product Requirement Document (termasuk Bagian 17)
├── SESSION_HANDOVER.md          # Dokumen ini (riwayat & panduan handover)
├── public/
│   └── LeePerrySmith.glb        # Model 3D scan kepala manusia
├── voice/
│   ├── README.md                # Panduan spesifikasi rekaman suara
│   ├── supri.wav                # Audio sampel suara user (RIFF WAV 24kHz mono)
│   ├── supri.txt                # Transkrip persis teks yang diucapkan user
│   └── supri_original.m4a       # File rekaman asli cadangan
└── src/
    ├── index.html               # Antarmuka HUD cyberpunk & canvas 3D
    ├── hud.css                  # Styling neon cyberpunk, scanlines, responsive HUD
    ├── main.js                  # State machine (IDLE, LISTENING, THINKING, SPEAKING)
    ├── face3d.js                # Render Three.js, bloom pass, mesh sculpt & lip-sync
    ├── tts.js                   # Antrian audio, fetcher /api/tts, Web Audio AnalyserNode
    ├── stt.js                   # Web Speech API recognition controller
    └── chat.js                  # Streaming chat parser & sentence splitter
```

---
*Dokumen ini dibuat otomatis sebagai panduan definitif agar siapapun agent yang melanjutkan sesi di lingkungan baru dapat langsung bekerja dengan konteks 100% akurat.*
