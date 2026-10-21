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
  - **LLM**: 9router (OpenAI-compatible endpoint di `http://127.0.0.1:20128/v1`).
  - **STT**: Web Speech API (`SpeechRecognition`).
  - **TTS**: Dual Engine — **FireRedTTS3-Base** (lokal, suara sendiri hasil kloning) + **Microsoft Edge TTS** (`id-ID-ArdiNeural` / `id-ID-GadisNeural`) + fallback browser `speechSynthesis`.
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

### A. Wajah 3D & Lip-Sync (`src/face3d.js`)
- **Model 3D**: Menggunakan `public/LeePerrySmith.glb` dan `src/public/LeePerrySmith.glb`.
- **Koreksi Simetri**: Dilakukan penambahan `FINAL_OFFSET_X = 0.032` pada vertex mesh agar ujung hidung berada tepat di sumbu tengah $X = 0.0004$.
- **Mata**: Sumbu soket mata diselaraskan pada $X = \pm 0.265$.
- **Bibir & Rongga Mulut**: Kurva spline bibir atas (*Cupid's bow*), celah mulut, dan bibir bawah sejajar lurus dengan ujung hidung. Saat berbicara, rahang turun membuka rongga mulut hitam alami dengan pergerakan simetris.

### B. Backend Node.js (`server.js`)
- **Port**: `3000`.
- **Router LLM (`/api/chat`)**: SSE stream passthrough ke 9router dengan auto-retry model.
- **Dual-Engine TTS (`/api/tts`)**:
  - Jika dipilih `Suara Saya (Clone)`: Memanggil service Python di `http://127.0.0.1:8000/tts` dengan timeout (`CLONE_TIMEOUT_MS`).
  - Jika service cloning offline/timeout/gagal: **Otomatis fallback ke Edge TTS** (`id-ID-ArdiNeural`) tanpa menghasilkan error di layar browser.
- **Normalisasi Ejaan Angka**: `DEFAULT_PERSONA` diatur agar LLM menuliskan angka, tanggal, dan singkatan sebagai kata/ejaan (misal *"jam tujuh malam"*, bukan *"19:00"*) sesuai PRD 17.5.
- **Monitor Sistem (`/api/system`)**: Membaca CPU, RAM, dan statistik transfer jaringan via `systeminformation`.
- **Konfigurasi (`/api/config`)**: Menyediakan daftar model, daftar suara (`clone`, `id-ID-ArdiNeural`, `id-ID-GadisNeural`), dan status engine.

### C. Frontend & HUD (`src/main.js`, `src/index.html`, `src/hud.css`)
- Menu dropdown **SUARA** mendukung opsi:
  1. `Suara Saya (Clone)`
  2. `Ardi (cowok)`
  3. `Gadis (cewek)`
- Teks HUD status TTS menampilkan mode aktif: `TTS: Clone (FireRedTTS3)` atau `TTS: Edge (Ardi)`.
- **Lip-Sync**: `AnalyserNode` di `src/tts.js` membaca audio buffer (baik WAV maupun MP3) secara langsung untuk menggerakkan bibir 3D dan gelombang *waveform* di dock bawah.

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
ROUTER_URL=http://127.0.0.1:20128/v1
ROUTER_KEY=sk-2f7d55d9ea82944d-mltxcq-2ede9333
# Daftar model dipisah koma: model pertama utama, sisanya fallback otomatis
ROUTER_MODEL=ag/gemini-3.8-flash-low,ag/gpt-oss-120b-medium,ag/gemini-3.7-flash-low
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
