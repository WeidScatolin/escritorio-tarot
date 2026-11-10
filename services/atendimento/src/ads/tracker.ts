import { AdSpendError, type AdSpendProvider } from './meta.js';
import type { Store } from '../store.js';

const BRT_OFFSET_MS = 3 * 3_600_000;

/** Data (AAAA-MM-DD) no horário de Brasília (UTC-3, sem horário de verão). */
export function brtDate(nowMs: number): string {
  return new Date(nowMs - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export type AdSpendDeps = {
  provider: AdSpendProvider;
  store: Store;
  now: () => number;
  /** Primeiro dia da campanha (AAAA-MM-DD): o total é desde essa data. */
  sinceDate: string;
  notify: (text: string) => void | Promise<void>;
};

const ERROR_TEXT: Record<string, string> = {
  auth: 'o token de acesso é inválido ou venceu; gere um novo e atualize META_ACCESS_TOKEN',
  rate_limit: 'limite de chamadas atingido; tento de novo no próximo ciclo',
  network: 'falha de rede ao consultar o gasto',
  other: 'erro ao consultar o gasto',
};

/** Atualiza o gasto (total e de hoje). Em falha, mantém o último valor bom e avisa o dono uma vez por incidente. */
export async function refreshAdSpend(deps: AdSpendDeps): Promise<void> {
  const nowMs = deps.now();
  const today = brtDate(nowMs);
  const previous = deps.store.getAdSpend();
  try {
    const total = await deps.provider.fetchSpend({ since: deps.sinceDate, until: today });
    const day = await deps.provider.fetchSpend({ since: today, until: today });
    deps.store.saveAdSpend({
      totalCents: total.spendCents,
      todayCents: day.spendCents,
      currency: total.currency,
      fetchedAtMs: nowMs,
      errorKind: null,
    });
  } catch (error) {
    const kind = error instanceof AdSpendError ? error.kind : 'other';
    deps.store.saveAdSpend({
      totalCents: previous?.totalCents ?? null,
      todayCents: previous?.todayCents ?? null,
      currency: previous?.currency ?? null,
      fetchedAtMs: previous?.fetchedAtMs ?? null,
      errorKind: kind,
    });
    if (previous?.errorKind !== kind) {
      try {
        await deps.notify(`Meta Ads: ${ERROR_TEXT[kind] ?? ERROR_TEXT.other}.`);
      } catch {
        // Avisar nunca pode derrubar a atualização.
      }
    }
  }
}

/** Atualiza já e depois a cada `everyMs`. Devolve a função que para o ciclo. */
export function startAdSpendPolling(deps: AdSpendDeps, everyMs: number): () => void {
  void refreshAdSpend(deps);
  const timer = setInterval(() => void refreshAdSpend(deps), everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
