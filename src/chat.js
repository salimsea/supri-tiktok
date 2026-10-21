// Streaming chat ke server (/api/chat), format SSE OpenAI-compatible.

/**
 * @param {{role:string, content:string}[]} messages
 * @param {{signal?: AbortSignal, onDelta?: (text:string)=>void}} opts
 * @returns {Promise<string>} teks jawaban lengkap
 */
export async function streamChat(messages, { signal, onDelta } = {}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const json = JSON.parse(data);
        if (json.error) throw new Error(json.error.message || 'upstream error');
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // potongan JSON tidak lengkap, abaikan
        throw e;
      }
    }
  }
  return full;
}

/**
 * Pemotong kalimat untuk streaming: kumpulkan delta, keluarkan kalimat utuh
 * begitu ketemu `.`, `?`, `!` (diikuti spasi) atau baris baru.
 */
export class SentenceSplitter {
  constructor(onSentence) {
    this.buf = '';
    this.onSentence = onSentence;
  }
  push(text) {
    this.buf += text;
    const re = /[.!?…]+["')\]]*\s+|\n+/g;
    let m, last = 0;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      const sentence = this.buf.slice(last, end);
      // Hindari potongan terlalu pendek (mis. "Dr. ") — gabung ke kalimat berikutnya.
      if (sentence.trim().length < 12 && !/\n/.test(m[0])) continue;
      this.#emit(sentence);
      last = end;
    }
    this.buf = this.buf.slice(last);
  }
  flush() {
    this.#emit(this.buf);
    this.buf = '';
  }
  #emit(s) {
    const clean = cleanForSpeech(s);
    if (clean) this.onSentence(clean);
  }
}

/** Buang markdown/emoji agar enak dibacakan. */
export function cleanForSpeech(s) {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>~|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\p{Extended_Pictographic}️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
