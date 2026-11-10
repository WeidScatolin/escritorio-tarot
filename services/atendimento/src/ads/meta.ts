// Leitura (SOMENTE leitura) do gasto em anúncios pela Marketing API da Meta.

export type AdSpend = { spendCents: number; currency: string };

export type AdSpendProvider = {
  fetchSpend(range: { since: string; until: string }): Promise<AdSpend>;
};

export type AdSpendErrorKind = 'auth' | 'rate_limit' | 'network' | 'other';

// A mensagem nunca carrega o token nem o corpo da resposta (que pode ecoá-lo).
export class AdSpendError extends Error {
  constructor(
    public readonly kind: AdSpendErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AdSpendError';
  }
}

export type MetaAdSpendOptions = {
  adAccountId: string;
  accessToken: string;
  apiVersion: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004]);

function classify(status: number, code: unknown): AdSpendErrorKind {
  if (status === 401 || code === 190) return 'auth';
  if (status === 429 || (typeof code === 'number' && RATE_LIMIT_CODES.has(code))) return 'rate_limit';
  return 'other';
}

export function createMetaAdSpend(opts: MetaAdSpendOptions): AdSpendProvider {
  const base = (opts.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const account = `act_${opts.adAccountId}`;

  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${base}/${opts.apiVersion}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
    } catch {
      throw new AdSpendError('network', 'Meta Ads API: falha de rede ao consultar o gasto');
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      throw new AdSpendError(classify(response.status, code), `Meta Ads API respondeu ${response.status}`);
    }
    return body;
  }

  return {
    async fetchSpend(range) {
      const body = (await get(`${account}/insights`, {
        fields: 'spend,account_currency',
        level: 'account',
        time_range: JSON.stringify({ since: range.since, until: range.until }),
      })) as { data?: { spend?: unknown; account_currency?: unknown }[] } | null;

      const row = body?.data?.[0];
      if (!row) {
        // Nenhum gasto no período: zero, e a moeda vem da própria conta.
        const info = (await get(account, { fields: 'currency' })) as { currency?: unknown } | null;
        if (typeof info?.currency !== 'string') throw new AdSpendError('other', 'Meta Ads API: moeda da conta ausente');
        return { spendCents: 0, currency: info.currency };
      }

      const amount = Number(row.spend);
      if (typeof row.spend !== 'string' || !Number.isFinite(amount) || amount < 0 || typeof row.account_currency !== 'string') {
        throw new AdSpendError('other', 'Meta Ads API: resposta com formato inesperado');
      }
      return { spendCents: Math.round(amount * 100), currency: row.account_currency };
    },
  };
}
