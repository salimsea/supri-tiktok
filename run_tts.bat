@echo off
title Supri Voice Cloning Service (FireRedTTS3)
cd /d "%~dp0"

echo ===================================================
echo   Menjalankan Supri Voice Cloning Service
echo ===================================================

where uv >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Menggunakan uv Python package runner...
    if not exist .venv (
        echo [INFO] Membuat virtual environment .venv...
        uv venv .venv
    )
    call .venv\Scripts\activate.bat
    echo [INFO] Memeriksa dependensi...
    uv pip install -r requirements-tts.txt
    uv run python tts_server.py
) else (
    echo [INFO] Menjalankan dengan Python sistem...
    python tts_server.py
)

pause
