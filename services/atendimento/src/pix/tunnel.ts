// O túnel gratuito da Cloudflare muda de endereço a cada reinício. Ele expõe o endereço atual em
// `<metrics>/quicktunnel` (`{"hostname":"x.trycloudflare.com"}`); lemos isso a cada link criado para que a
// webhook_url nunca fique velha. `fallbackBase` é um endereço fixo opcional (ex.: túnel nomeado).
export type TunnelResolverOptions = {
  metricsUrl?: string | null;
  fallbackBase?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function createTunnelResolver(opts: TunnelResolverOptions): () => Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const fallback = opts.fallbackBase ? opts.fallbackBase.replace(/\/+$/, '') : null;

  async function fromTunnel(): Promise<string | null> {
    if (!opts.metricsUrl) return null;
    try {
      const response = await doFetch(opts.metricsUrl, { signal: AbortSignal.timeout(opts.timeoutMs ?? 3000) });
      if (!response.ok) return null;
      const body = (await response.json()) as { hostname?: unknown };
      const host = typeof body.hostname === 'string' ? body.hostname.trim() : '';
      return HOSTNAME.test(host) ? `https://${host.toLowerCase()}` : null;
    } catch {
      return null;
    }
  }

  return async () => {
    const resolved = (await fromTunnel()) ?? fallback;
    if (!resolved) throw new Error('endereço público do serviço indisponível (túnel fora do ar e PUBLIC_BASE_URL não definida)');
    return resolved;
  };
}
