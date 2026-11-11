// Envia o resumo do painel (o mesmo JSON de /api/stats) para a Vercel, para o dono ver pelo celular.
// Só este serviço chama a Vercel (saída): não abre porta nem precisa de túnel. Nunca envia dados de cliente.
const REQUEST_TIMEOUT_MS = 10_000;

export type PublisherDeps = {
  /** Endereço do próprio /api/stats (loopback). */
  statsUrl: string;
  /** Função da Vercel que recebe o resumo. */
  pushUrl: string;
  secret: string;
  fetchFn?: typeof fetch;
  log?: (text: string) => void;
};

export async function publishOnce(deps: PublisherDeps): Promise<boolean> {
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? ((text: string) => console.warn(text));
  try {
    const local = await fetchFn(deps.statsUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!local.ok) {
      log(`Publicação na Vercel pulada: resumo local respondeu HTTP ${local.status}.`);
      return false;
    }
    const body = await local.text();
    const remote = await fetchFn(deps.pushUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.secret}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!remote.ok) {
      log(`Publicação na Vercel recusada: HTTP ${remote.status}.`);
      return false;
    }
    return true;
  } catch (error) {
    // Só o tipo do erro: a mensagem poderia conter o endereço ou o segredo.
    log(`Publicação na Vercel falhou (${error instanceof Error ? error.name : 'erro'}).`);
    return false;
  }
}

/** Publica ao iniciar e depois a cada intervalo. Loga só quando o estado muda (cai ou volta). */
export function startPublisher(deps: PublisherDeps, intervalMs: number): () => void {
  const log = deps.log ?? ((text: string) => console.warn(text));
  let lastOk: boolean | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const ok = await publishOnce({ ...deps, log: lastOk === false ? () => undefined : log });
      if (ok && lastOk === false) log('Publicação na Vercel voltou a funcionar.');
      lastOk = ok;
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
