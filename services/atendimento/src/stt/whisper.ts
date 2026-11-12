export type SttClient = {
  /** Texto falado no áudio, ou null se não deu (erro, vazio). Nunca lança. */
  transcribe(audio: Buffer, mimetype: string): Promise<string | null>;
};

export type WhisperOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const EXT: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav' };

// API compatível com a da OpenAI (/v1/audio/transcriptions): serve para o Whisper local (speaches), Groq ou OpenAI.
export function createWhisperStt(opts: WhisperOptions): SttClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`;
  return {
    async transcribe(audio, mimetype) {
      try {
        const type = mimetype.split(';')[0]!.trim().toLowerCase();
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audio)], { type }), `audio.${EXT[type] ?? 'ogg'}`);
        form.append('model', opts.model);
        form.append('language', 'pt');
        form.append('response_format', 'json');
        const response = await doFetch(url, {
          method: 'POST',
          headers: opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {},
          body: form,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
        if (!response.ok) return null;
        const json = (await response.json()) as { text?: unknown };
        const text = typeof json.text === 'string' ? json.text.trim() : '';
        return text === '' ? null : text;
      } catch {
        return null;
      }
    },
  };
}
