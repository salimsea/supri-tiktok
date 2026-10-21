"""
tts_server.py
FireRedTTS3 Voice Cloning Service (FastAPI)
Menyediakan endpoint HTTP POST /tts untuk Supri AI Assistant.
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

app = FastAPI(
    title="Supri Voice Cloning Service",
    description="Local Zero-Shot TTS powered by FireRedTTS3",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Konfigurasi path
ROOT_DIR = Path(__file__).resolve().parent
VOICE_DIR = ROOT_DIR / "voice"
WAV_PATH = VOICE_DIR / "supri.wav"
TXT_PATH = VOICE_DIR / "supri.txt"
MODEL_DIR = ROOT_DIR / "pretrained_models"

# State global
_tts_instance = None
_prompt_audio = None
_prompt_sr = None
_prompt_text = ""


class SynthesizeRequest(BaseModel):
    text: str


def get_prompt_text() -> str:
    """Baca transkrip teks sampel suara user."""
    global _prompt_text
    if TXT_PATH.exists():
        _prompt_text = TXT_PATH.read_text(encoding="utf-8").strip()
    return _prompt_text


def load_prompt_audio():
    """Muat file audio rekaman sampel suara user."""
    global _prompt_audio, _prompt_sr
    if not WAV_PATH.exists():
        return None, None
    try:
        import torchaudio

        audio, sr = torchaudio.load(str(WAV_PATH))
        # Jika stereo, ubah ke mono (1 channel)
        if audio.shape[0] > 1:
            audio = audio.mean(dim=0, keepdim=True)
        _prompt_audio = audio
        _prompt_sr = sr
        return _prompt_audio, _prompt_sr
    except Exception as e:
        print(f"[ERROR] Gagal memuat audio {WAV_PATH}: {e}", file=sys.stderr)
        return None, None


def get_tts():
    """Inisialisasi lazy model FireRedTTS3."""
    global _tts_instance
    if _tts_instance is not None:
        return _tts_instance

    if not MODEL_DIR.exists():
        return None

    try:
        from fireredtts3.core import FireRedTTS3

        print(f"[INFO] Memuat model FireRedTTS3 dari {MODEL_DIR}...")
        _tts_instance = FireRedTTS3(str(MODEL_DIR), use_wetext=True, use_llm_tn=False)
        print("[INFO] Model FireRedTTS3 berhasil dimuat!")
        return _tts_instance
    except ImportError:
        print("[WARNING] Paket 'fireredtts3' belum terpasang.", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[ERROR] Gagal inisialisasi FireRedTTS3: {e}", file=sys.stderr)
        return None


@app.on_event("startup")
def on_startup():
    """Pemeriksaan status file saat service dinyalakan."""
    print("=" * 60)
    print("  SUPRI VOICE CLONING SERVICE (FireRedTTS3)")
    print("=" * 60)

    has_wav = WAV_PATH.exists()
    has_txt = TXT_PATH.exists()
    has_model = MODEL_DIR.exists()

    print(f" Sampel Audio ({WAV_PATH.name}): {'[OK]' if has_wav else '[BELUM ADA]'}")
    print(f" Transkrip Teks ({TXT_PATH.name}): {'[OK]' if has_txt else '[BELUM ADA]'}")
    print(f" Model Weights ({MODEL_DIR.name}): {'[OK]' if has_model else '[BELUM ADA]'}")
    print("=" * 60)

    if has_wav:
        load_prompt_audio()
    if has_txt:
        get_prompt_text()
    if has_model:
        get_tts()


@app.get("/")
def index():
    return {
        "service": "Supri Voice Cloning (FireRedTTS3)",
        "endpoints": {
            "health": "/health",
            "tts": "POST /tts",
        },
    }


@app.get("/health")
def health():
    """Cek kesiapan model dan sampel suara."""
    has_wav = WAV_PATH.exists()
    has_txt = TXT_PATH.exists()
    has_model = MODEL_DIR.exists()
    prompt_txt = get_prompt_text()

    ready = has_wav and has_txt and (_prompt_audio is not None) and (_tts_instance is not None)

    return {
        "status": "ready" if ready else "pending_setup",
        "has_sample_wav": has_wav,
        "has_sample_txt": has_txt,
        "sample_text_length": len(prompt_txt),
        "model_downloaded": has_model,
        "model_initialized": _tts_instance is not None,
    }


@app.post("/tts")
def synthesize(req: SynthesizeRequest):
    """
    Sintesis teks menjadi audio WAV menggunakan kloning suara user.
    """
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Parameter 'text' tidak boleh kosong")

    if not WAV_PATH.exists():
        raise HTTPException(
            status_code=400,
            detail=f"File rekaman suaramu '{WAV_PATH}' belum ada. Silakan rekam suaramu (10-20 detik format WAV) sesuai panduan di voice/README.md",
        )

    prompt_txt = get_prompt_text()
    if not prompt_txt:
        raise HTTPException(
            status_code=400,
            detail=f"File transkrip '{TXT_PATH}' kosong atau belum ada. Tuliskan teks persis dari rekaman suaramu.",
        )

    audio_prompt, sr_prompt = load_prompt_audio()
    if audio_prompt is None:
        raise HTTPException(status_code=500, detail="Gagal membaca file audio sampel voice/supri.wav")

    tts = get_tts()
    if tts is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Model FireRedTTS3 belum siap. Pastikan dependensi terpasang dan model telah diunduh: "
                "hf download FireRedTeam/FireRedTTS3 --local-dir pretrained_models/"
            ),
        )

    try:
        import torchaudio

        # Generate audio cloning
        audio, out_sr = tts.generate(
            language="id",
            prompt_text=prompt_txt,
            prompt_audio=audio_prompt,
            prompt_audio_sr=sr_prompt,
            text=text,
            do_tn=True,
        )

        buf = io.BytesIO()
        torchaudio.save(buf, audio.cpu(), out_sr, format="wav")
        wav_bytes = buf.getvalue()

        return Response(content=wav_bytes, media_type="audio/wav")

    except Exception as e:
        print(f"[ERROR] Sintesis gagal: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Sintesis suara gagal: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("tts_server:app", host="127.0.0.1", port=port, reload=True)
