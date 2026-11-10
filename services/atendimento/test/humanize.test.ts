import { describe, expect, it } from 'vitest';
import { createRateLimiter, typingDelayMs } from '../src/humanize.js';

describe('typingDelayMs', () => {
  const middle = () => 0.5;

  it('texto maior demora mais para "digitar"', () => {
    expect(typingDelayMs('Oi!', middle)).toBeLessThan(typingDelayMs('Oi! Posso te ajudar com uma tiragem de 3 cartas hoje?', middle));
  });

  it('nunca é instantâneo nem passa do teto', () => {
    expect(typingDelayMs('', middle)).toBeGreaterThanOrEqual(600);
    expect(typingDelayMs('x'.repeat(5000), middle)).toBeLessThanOrEqual(9000 * 1.2);
  });

  it('varia com o rng em até ±20% (nunca fica igual toda vez)', () => {
    const text = 'Quer que eu te explique as opções de tiragem?';
    const low = typingDelayMs(text, () => 0);
    const high = typingDelayMs(text, () => 0.999999);
    const mid = typingDelayMs(text, middle);
    expect(low).toBeLessThan(mid);
    expect(high).toBeGreaterThan(mid);
    expect(low).toBeGreaterThanOrEqual(mid * 0.79);
    expect(high).toBeLessThanOrEqual(mid * 1.21);
  });

  it('código de Pix colado (sem espaços, longo) não "demora digitando"', () => {
    const copyPaste = '00020126FAKE0014BR.GOV.BCB.PIXfake_3f2a9c1d5303986540429005802BR6304FAKE'.repeat(3);
    expect(typingDelayMs(copyPaste, middle)).toBeLessThanOrEqual(1500);
  });
});

describe('createRateLimiter', () => {
  function make(over: { perChat?: number; global?: number } = {}) {
    const clock = { t: 1_000_000 };
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      perChat: over.perChat ?? 3,
      global: over.global ?? 100,
      windowMs: 60_000,
      now: () => clock.t,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
    });
    return { limiter, clock, sleeps };
  }

  it('abaixo do limite não espera', async () => {
    const { limiter, sleeps } = make();
    await limiter.acquire('a');
    await limiter.acquire('a');
    await limiter.acquire('a');
    expect(sleeps).toEqual([]);
  });

  it('acima do limite por conversa espera a mensagem mais antiga sair da janela de 1 minuto', async () => {
    const { limiter, clock, sleeps } = make({ perChat: 3 });
    for (let i = 0; i < 3; i++) await limiter.acquire('a');
    clock.t += 10_000;

    await limiter.acquire('a');

    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBe(50_000);
  });

  it('o limite por conversa não atrapalha outra conversa', async () => {
    const { limiter, sleeps } = make({ perChat: 2 });
    await limiter.acquire('a');
    await limiter.acquire('a');
    await limiter.acquire('b');
    expect(sleeps).toEqual([]);
  });

  it('o limite global vale entre conversas diferentes', async () => {
    const { limiter, sleeps } = make({ perChat: 10, global: 2 });
    await limiter.acquire('a');
    await limiter.acquire('b');
    await limiter.acquire('c');
    expect(sleeps).toHaveLength(1);
  });

  it('depois de passar a janela, volta a liberar sem esperar', async () => {
    const { limiter, clock, sleeps } = make({ perChat: 1 });
    await limiter.acquire('a');
    clock.t += 61_000;
    await limiter.acquire('a');
    expect(sleeps).toEqual([]);
  });
});
