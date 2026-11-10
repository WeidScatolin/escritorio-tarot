export type EvolutionClient = {
  sendText(jid: string, text: string): Promise<void>;
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

  return {
    async sendText(jid, text) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: opts.apiKey },
          body: JSON.stringify({ number: jid, text }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        });
      } catch {
        throw new Error('Evolution API: falha de rede ao enviar mensagem');
      }
      if (!response.ok) {
        throw new Error(`Evolution API respondeu ${response.status} ao enviar mensagem`);
      }
    },
  };
}
