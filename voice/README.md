# Panduan Sampel Suara (Voice Cloning FireRedTTS3)

Folder ini digunakan untuk menyimpan sampel suara pribadi kamu untuk fitur voice cloning di Supri AI Assistant.

## Format File yang Dibutuhkan:
1. **`supri.wav`**
   - Format: **WAV (PCM 16-bit atau 24-bit), Mono (1 channel)**
   - Durasi ideal: **10 s/d 20 detik**
   - Frekuensi sampling: disarankan **24.000 Hz (24kHz)** atau **44.100 Hz (44.1kHz)**
   - Kondisi rekaman: Ruangan hening/sepi, mic dekat dengan mulut (10–15 cm), tanpa musik latar, tanpa noise/gema berlebih.
   - Gaya bicara: Berbicaralah secara santai, wajar, dan jelas seperti sedang mengobrol biasa (jangan kaku seperti membaca buku).

2. **`supri.txt`**
   - Format: File teks biasa (UTF-8).
   - Isi: **Transkrip persis kata-per-kata** yang kamu ucapkan di dalam file `supri.wav`.
   - Huruf kapital dan tanda baca (titik, koma) sebaiknya sesuai dengan jeda intonasi bicaramu.

---

## Contoh Naskah Rekaman:
Kamu bisa membaca teks di bawah ini saat merekam `supri.wav` dan menyimpannya di `supri.txt`:

> "Halo, kenalkan saya Supri. Saya adalah asisten kecerdasan buatan pribadi yang siap membantu aktivitas sehari-hari, menjawab pertanyaan, dan mengontrol sistem komputer kamu kapan saja."

---

## Cara Menjalankan Service Cloning:
1. Taruh `supri.wav` dan `supri.txt` di dalam folder ini.
2. Jalankan `run_tts.bat` (atau `python tts_server.py`) di root project.
3. Service akan berjalan di `http://127.0.0.1:8000`. Supri server (`server.js`) otomatis menyambung ke service ini!
