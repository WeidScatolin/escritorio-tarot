export type EvolutionClient = {
  /** Devolve o id da mensagem enviada (para reconhecer o eco no webhook), ou null se a resposta não trouxer. */
  sendText(jid: string, text: string, opts?: { delayMs?: number }): Promise<{ messageId: string | null }>;
  /** Nota de voz (PTT) via sendWhatsAppAudio da Evolution v2. `audio` = bytes ogg/opus. */
  sendAudio(jid: string, audio: Buffer, opts?: { delayMs?: number }): Promise<{ messageId: string | null }>;
};

export type EvolutionClientOptions = {
  baseUrl: string;
  apiKey: string;
  instance: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

// Mensagens de erro nunca incluem a apikey, nem a causa original (que pode carregá-la).
export function createEvolutionClient(opts: EvolutionClientOptions): EvolutionClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${base}/message/sendText/${encodeURIComponent(opts.instance)}`;
  const audioUrl = `${base}/message/sendWhatsAppAudio/${encodeURIComponent(opts.instance)}`;

  return {
    async sendText(jid, text, sendOpts) {
      // `delay` (ms) é um campo opcional do sendText da Evolution: ela mostra "digitando..." por esse tempo.
      const delayMs = sendOpts?.delayMs && sendOpts.delayMs > 0 ? Math.round(sendOpts.delayMs) : undefined;
      const body = delayMs ? { number: jid, text, delay: delayMs } : { number: jid, text };
      // O pedido fica aberto durante o atraso: o tempo limite precisa cobrir o atraso.
      const timeout = Math.max(opts.timeoutMs ?? 15_000, (delayMs ?? 0) + 10_000);
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        throw new Error('Evolution API: falha de rede ao enviar mensagem');
      }
      if (!response.ok) {
        throw new Error(`Evolution API respondeu ${response.status} ao enviar mensagem`);
      }
      try {
        const body = (await response.json()) as { key?: { id?: unknown } };
        return { messageId: typeof body.key?.id === 'string' && body.key.id ? body.key.id : null };
      } catch {
        return { messageId: null };
      }
    },

    // Evolution v2 (SendAudioDto): `audio` aceita URL ou base64 puro (sem prefixo data:). `encoding: true`
    // pede que a Evolution reconverta para PTT; `delay` mostra "gravando áudio..." pelo tempo informado.
    // Formato do payload conferido só na documentação/fonte oficial: ainda NÃO testado contra uma instância real.
    async sendAudio(jid, audio, sendOpts) {
      const delayMs = sendOpts?.delayMs && sendOpts.delayMs > 0 ? Math.round(sendOpts.delayMs) : undefined;
      const body = { number: jid, audio: audio.toString('base64'), encoding: true, ...(delayMs ? { delay: delayMs } : {}) };
      const timeout = Math.max(opts.timeoutMs ?? 15_000, (delayMs ?? 0) + 20_000);
      let response: Response;
      try {
        response = await doFetch(audioUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        throw new Error('Evolution API: falha de rede ao enviar áudio');
      }
      if (!response.ok) {
        throw new Error(`Evolution API respondeu ${response.status} ao enviar áudio`);
      }
      try {
        const parsed = (await response.json()) as { key?: { id?: unknown } };
        return { messageId: typeof parsed.key?.id === 'string' && parsed.key.id ? parsed.key.id : null };
      } catch {
        return { messageId: null };
      }
    },
  };
}
