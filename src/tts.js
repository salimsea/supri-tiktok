// Antrian TTS: Edge TTS via server (utama, bisa dianalisis untuk lip-sync akurat)
// dengan cadangan speechSynthesis browser (lip-sync simulasi).

export class TTSQueue {
  /**
   * @param {{onStart?:()=>void, onIdle?:()=>void, onFallback?:(reason:string)=>void}} hooks
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.voice = 'id-ID-ArdiNeural';
    this.queue = []; // { text, audio: Promise<string|null> }
    this.playing = false;
    this.gen = 0;
    this.controllers = new Set();
    this.fakeLevel = 0;
    this.boundaryKick = 0;
    this.speakingFallback = false;

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.ctx = null;
  }

  /** AudioContext harus dibuat/di-resume setelah gesture user. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.3;
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get busy() {
    return this.playing || this.queue.length > 0;
  }

  enqueue(text) {
    const gen = this.gen;
    // Prefetch audio segera supaya kalimat berikutnya siap saat kalimat sekarang selesai.
    const item = { text, audio: this.#fetchAudio(text, gen) };
    this.queue.push(item);
    if (!this.playing) this.#playNext(gen);
  }

  /** Hentikan semua suara seketika (Interrupt). */
  stop() {
    this.gen++;
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    for (const q of this.queue) q.audio.then((url) => url && URL.revokeObjectURL(url));
    this.queue = [];
    this.audio.pause();
    this.audio.removeAttribute('src');
    speechSynthesis.cancel();
    this.speakingFallback = false;
    this.playing = false;
    this.fakeLevel = 0;
    this.smoothLevel = 0;
  }

  /** Level amplitudo 0..1 untuk lip-sync artikulatif dan ekspresif. */
  level() {
    if (this.speakingFallback) return this.#simulatedLevel();
    if (!this.analyser || this.audio.paused) {
      this.smoothLevel = Math.max(0, (this.smoothLevel || 0) * 0.75);
      return this.smoothLevel;
    }
    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = this.timeData[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.timeData.length);

    if (!this.freqData || this.freqData.length !== this.analyser.frequencyBinCount) {
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getByteFrequencyData(this.freqData);

    // Frekuensi vokal manusia (formants F1-F2: ~180 Hz - ~2400 Hz)
    let vocalSum = 0;
    const binStart = 4;
    const binEnd = Math.min(32, this.freqData.length);
    for (let i = binStart; i < binEnd; i++) {
      vocalSum += this.freqData[i];
    }
    const vocalAvg = vocalSum / ((binEnd - binStart) * 255);

    // Respon terkalibrasi untuk Edge TTS & vokal manusia
    const rmsComp = Math.min(1, Math.max(0, (rms - 0.005) * 15));
    const vocalComp = Math.min(1, Math.max(0, (vocalAvg - 0.04) * 2.8));
    const raw = Math.max(rmsComp * 0.65 + vocalComp * 0.35, rmsComp);

    // Fast-attack, smooth-decay envelope follower
    if (this.smoothLevel === undefined) this.smoothLevel = 0;
    if (raw > this.smoothLevel) {
      this.smoothLevel += (raw - this.smoothLevel) * 0.82;
    } else {
      this.smoothLevel += (raw - this.smoothLevel) * 0.28;
    }

    return Math.min(1, Math.max(0, this.smoothLevel));
  }

  /** Data gelombang untuk visualisasi waveform saat SPEAKING. */
  waveform() {
    if (!this.analyser || this.audio.paused) return null;
    this.analyser.getFloatTimeDomainData(this.timeData);
    return this.timeData;
  }

  async #fetchAudio(text, gen) {
    const ac = new AbortController();
    this.controllers.add(ac);
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: this.voice }),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const blob = await r.blob();
      if (gen !== this.gen) return null;
      return URL.createObjectURL(blob);
    } catch (e) {
      if (e.name !== 'AbortError') this.hooks.onFallback?.(e.message);
      return null;
    } finally {
      this.controllers.delete(ac);
    }
  }

  async #playNext(gen) {
    if (gen !== this.gen) return;
    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      this.hooks.onIdle?.();
      return;
    }
    this.playing = true;
    const url = await item.audio;
    if (gen !== this.gen) return;

    if (url) await this.#playUrl(url, gen);
    else await this.#speakFallback(item.text, gen);
    if (url) URL.revokeObjectURL(url);
    this.#playNext(gen);
  }

  #playUrl(url, gen) {
    return new Promise((resolve) => {
      const done = () => {
        this.audio.onended = this.audio.onerror = this.audio.onpause = null;
        resolve();
      };
      this.audio.onended = done;
      this.audio.onerror = done;
      this.audio.onpause = () => gen !== this.gen && done();
      this.audio.src = url;
      this.audio
        .play()
        .then(() => gen === this.gen && this.hooks.onStart?.())
        .catch(done);
    });
  }

  #speakFallback(text, gen) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const lang = this.voice.slice(0, 5);
      u.lang = lang;
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang?.replace('_', '-') === lang) || voices.find((x) => x.lang?.startsWith(lang.slice(0, 2)));
      if (v) u.voice = v;
      u.rate = 1.05;
      u.onstart = () => {
        if (gen !== this.gen) return;
        this.speakingFallback = true;
        this.fakeStart = performance.now();
        this.hooks.onStart?.();
      };
      u.onboundary = () => (this.boundaryKick = 1);
      const finish = () => {
        this.speakingFallback = false;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    });
  }

  // Suara speechSynthesis tidak bisa dianalisis langsung → gelombang artikulatif
  // dengan pola suku kata manusiawi (~3.5 suku kata/dtk) dan lonjakan di setiap batas kata.
  #simulatedLevel() {
    const t = (performance.now() - (this.fakeStart ?? 0)) / 1000;
    const syllable = Math.sin(t * 18);
    const intonation = 0.52 + 0.28 * Math.sin(t * 3.8);
    const base = Math.max(0, syllable * 0.40 + intonation * 0.60);
    const noise = (Math.random() - 0.5) * 0.12;
    this.boundaryKick *= 0.85;
    return Math.min(1, Math.max(0, base + noise + this.boundaryKick * 0.45));
  }
}
