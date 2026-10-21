// Speech-to-Text (Web Speech API) + monitor level mic (waveform, sensitivitas, voice interrupt).

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = Boolean(SR);

export class STT {
  /**
   * @param {{onInterim?:(t:string)=>void, onFinal?:(t:string)=>void, onError?:(code:string)=>void}} hooks
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.lang = 'id-ID';
    this.wanted = false; // apakah kita ingin recognizer berjalan
    this.running = false;
    if (!SR) return;
    this.rec = new SR();
    this.rec.interimResults = true;
    this.rec.continuous = false;
    this.rec.maxAlternatives = 1;
    this.rec.onstart = () => (this.running = true);
    this.rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) this.hooks.onInterim?.(interim);
      if (final.trim()) this.hooks.onFinal?.(final.trim());
    };
    this.rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.wanted = false;
      this.hooks.onError?.(e.error);
    };
    this.rec.onend = () => {
      this.running = false;
      // Chrome menghentikan recognizer setelah satu ucapan/hening; nyalakan lagi bila masih diminta.
      if (this.wanted) setTimeout(() => this.wanted && this.#safeStart(), 150);
    };
  }

  start() {
    if (!this.rec) return;
    this.wanted = true;
    this.rec.lang = this.lang;
    if (!this.running) this.#safeStart();
  }

  stop() {
    this.wanted = false;
    if (this.rec && this.running) this.rec.abort();
  }

  #safeStart() {
    try {
      this.rec.lang = this.lang;
      this.rec.start();
    } catch {
      /* sudah berjalan */
    }
  }
}

/** Analisis level mic lewat getUserMedia (dengan echo cancellation). */
export class MicMonitor {
  async open() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    src.connect(this.analyser);
    this.data = new Float32Array(this.analyser.fftSize);
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = this.ctx = this.analyser = null;
  }

  get active() {
    return Boolean(this.analyser);
  }

  /** @returns {Float32Array|null} */
  waveform() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.data);
    return this.data;
  }

  /** Level RMS ternormalisasi 0..1. */
  level() {
    const d = this.waveform();
    if (!d) return 0;
    let sum = 0;
    for (const v of d) sum += v * v;
    return Math.min(1, Math.sqrt(sum / d.length) * 6);
  }
}
