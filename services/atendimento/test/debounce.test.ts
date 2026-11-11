import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from '../src/debounce.js';

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('junta mensagens do mesmo chat e entrega uma vez, depois do silêncio', () => {
    const flushed: [string, string[]][] = [];
    const d = createDebouncer<string>({ waitMs: 8000, onFlush: (k, items) => flushed.push([k, items]) });
    d.push('a', 'oi');
    vi.advanceTimersByTime(3000);
    d.push('a', 'meu nome é Ana');
    vi.advanceTimersByTime(7999);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([['a', ['oi', 'meu nome é Ana']]]);
  });

  it('cada mensagem nova reinicia a espera', () => {
    const flushed: string[][] = [];
    const d = createDebouncer<string>({ waitMs: 8000, onFlush: (_k, items) => flushed.push(items) });
    d.push('a', '1');
    vi.advanceTimersByTime(7000);
    d.push('a', '2');
    vi.advanceTimersByTime(7000);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(flushed).toEqual([['1', '2']]);
  });

  it('chats diferentes não se misturam', () => {
    const flushed: [string, string[]][] = [];
    const d = createDebouncer<string>({ waitMs: 1000, onFlush: (k, items) => flushed.push([k, items]) });
    d.push('a', 'x');
    d.push('b', 'y');
    vi.advanceTimersByTime(1000);
    expect(flushed).toEqual([
      ['a', ['x']],
      ['b', ['y']],
    ]);
  });

  it('has() indica buffer pendente e some depois de entregar', () => {
    const d = createDebouncer<string>({ waitMs: 1000, onFlush: () => {} });
    expect(d.has('a')).toBe(false);
    d.push('a', 'x');
    expect(d.has('a')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(d.has('a')).toBe(false);
  });

  it('waitMs 0 entrega na hora, sem timer', () => {
    const flushed: string[][] = [];
    const d = createDebouncer<string>({ waitMs: 0, onFlush: (_k, items) => flushed.push(items) });
    d.push('a', 'x');
    expect(flushed).toEqual([['x']]);
  });

  it('clear() descarta timers pendentes', () => {
    const flushed: string[][] = [];
    const d = createDebouncer<string>({ waitMs: 1000, onFlush: (_k, items) => flushed.push(items) });
    d.push('a', 'x');
    d.clear();
    vi.advanceTimersByTime(5000);
    expect(flushed).toEqual([]);
  });
});
