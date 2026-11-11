export type MediaPayload = {
  /** Conteúdo do arquivo em base64 (sem prefixo data:). */
  base64: string;
  mimetype: string;
  fileName: string;
  caption?: string;
};

export type EvolutionClient = {
  /** Devolve o id da mensagem enviada (para reconhecer o eco no webhook), ou null se a resposta não trouxer. */
  sendText(jid: string, text: string, opts?: { delayMs?: number }): Promise<{ messageId: string | null }>;
  /** Envia uma imagem com legenda opcional. Mesmo contrato de erro e de id do sendText. */
  sendMedia(jid: string, media: MediaPayload, opts?: { delayMs?: number }): Promise<{ messageId: string | null }>;
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
  const endpoint = (name: string): string => `${base}/message/${name}/${encodeURIComponent(opts.instance)}`;

  async function post(url: string, body: Record<string, unknown>, delayMs: number | undefined) {
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
      const json = (await response.json()) as { key?: { id?: unknown } };
      return { messageId: typeof json.key?.id === 'string' && json.key.id ? json.key.id : null };
    } catch {
      return { messageId: null };
    }
  }

  // `delay` (ms) é um campo opcional da Evolution: ela mostra "digitando..." por esse tempo.
  const delayOf = (sendOpts?: { delayMs?: number }): number | undefined =>
    sendOpts?.delayMs && sendOpts.delayMs > 0 ? Math.round(sendOpts.delayMs) : undefined;

  return {
    sendText(jid, text, sendOpts) {
      const delayMs = delayOf(sendOpts);
      const body = delayMs ? { number: jid, text, delay: delayMs } : { number: jid, text };
      return post(endpoint('sendText'), body, delayMs);
    },
    sendMedia(jid, media, sendOpts) {
      const delayMs = delayOf(sendOpts);
      const body = {
        number: jid,
        mediatype: 'image',
        mimetype: media.mimetype,
        media: media.base64,
        fileName: media.fileName,
        ...(media.caption ? { caption: media.caption } : {}),
        ...(delayMs ? { delay: delayMs } : {}),
      };
      return post(endpoint('sendMedia'), body, delayMs);
    },
  };
}
