import { describe, expect, it } from 'vitest';
import { AdSpendError } from '../src/ads/meta.js';
import { brtDate, refreshAdSpend } from '../src/ads/tracker.js';
import type { AdSpendProvider } from '../src/ads/meta.js';
import { createStore } from '../src/store.js';

// 2026-11-10 12:00 em Brasília (UTC-3) = 15:00 UTC
const NOW = Date.UTC(2026, 10, 10, 15, 0, 0);

describe('brtDate', () => {
  it('usa o horário de Brasília (UTC-3): 01:00 UTC ainda é o dia anterior', () => {
    expect(brtDate(Date.UTC(2026, 10, 10, 1, 0, 0))).toBe('2026-11-09');
    expect(brtDate(Date.UTC(2026, 10, 10, 3, 0, 0))).toBe('2026-11-10');
    expect(brtDate(NOW)).toBe('2026-11-10');
  });
});

describe('store: gasto em anúncios', () => {
  it('sem registro devolve null; grava e lê de volta', () => {
    const store = createStore(':memory:');
    expect(store.getAdSpend()).toBeNull();

    store.saveAdSpend({ totalCents: 5000, todayCents: 1200, currency: 'BRL', fetchedAtMs: NOW, errorKind: null });

    expect(store.getAdSpend()).toEqual({ totalCents: 5000, todayCents: 1200, currency: 'BRL', fetchedAtMs: NOW, errorKind: null });
  });

  it('gravar de novo substitui o registro (é sempre o último)', () => {
    const store = createStore(':memory:');
    store.saveAdSpend({ totalCents: 1, todayCents: 1, currency: 'BRL', fetchedAtMs: 1, errorKind: null });
    store.saveAdSpend({ totalCents: 2, todayCents: 2, currency: 'BRL', fetchedAtMs: 2, errorKind: 'auth' });
    expect(store.getAdSpend()).toMatchObject({ totalCents: 2, errorKind: 'auth' });
  });
});

describe('refreshAdSpend', () => {
  function setup(provider: AdSpendProvider) {
    const store = createStore(':memory:');
    const notices: string[] = [];
    const deps = { provider, store, now: () => NOW, sinceDate: '2026-11-01', notify: (t: string) => void notices.push(t) };
    return { store, notices, deps };
  }

  it('busca o total (desde o início da campanha) e o de hoje, e grava', async () => {
    const ranges: { since: string; until: string }[] = [];
    const provider: AdSpendProvider = {
      async fetchSpend(range) {
        ranges.push(range);
        return range.since === range.until ? { spendCents: 1000, currency: 'BRL' } : { spendCents: 9000, currency: 'BRL' };
      },
    };
    const { store, deps } = setup(provider);

    await refreshAdSpend(deps);

    expect(ranges).toEqual([
      { since: '2026-11-01', until: '2026-11-10' },
      { since: '2026-11-10', until: '2026-11-10' },
    ]);
    expect(store.getAdSpend()).toEqual({ totalCents: 9000, todayCents: 1000, currency: 'BRL', fetchedAtMs: NOW, errorKind: null });
  });

  it('falha: guarda o tipo do erro, mantém o último valor bom e avisa o dono UMA vez', async () => {
    const good: AdSpendProvider = { fetchSpend: async () => ({ spendCents: 700, currency: 'BRL' }) };
    const { store, notices, deps } = setup(good);
    await refreshAdSpend(deps);

    const bad: AdSpendProvider = {
      fetchSpend: async () => {
        throw new AdSpendError('auth', 'token vencido');
      },
    };
    await refreshAdSpend({ ...deps, provider: bad });
    await refreshAdSpend({ ...deps, provider: bad });

    expect(store.getAdSpend()).toMatchObject({ totalCents: 700, errorKind: 'auth' });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/Meta/i);
  });

  it('um erro de tipo diferente avisa de novo; ao se recuperar, limpa o erro', async () => {
    const { store, notices, deps } = setup({ fetchSpend: async () => ({ spendCents: 1, currency: 'BRL' }) });
    const fail = (kind: 'auth' | 'rate_limit'): AdSpendProvider => ({
      fetchSpend: async () => {
        throw new AdSpendError(kind, 'x');
      },
    });

    await refreshAdSpend({ ...deps, provider: fail('auth') });
    await refreshAdSpend({ ...deps, provider: fail('rate_limit') });
    expect(notices).toHaveLength(2);

    await refreshAdSpend(deps);
    expect(store.getAdSpend()!.errorKind).toBeNull();
  });

  it('erro inesperado (não é AdSpendError) também é tratado, sem derrubar', async () => {
    const { store, deps } = setup({
      fetchSpend: async () => {
        throw new Error('boom');
      },
    });
    await expect(refreshAdSpend(deps)).resolves.toBeUndefined();
    expect(store.getAdSpend()).toMatchObject({ errorKind: 'other' });
  });
});
