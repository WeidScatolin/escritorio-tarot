import { describe, expect, it } from 'vitest';
import { CARDS, drawCards } from '../src/tarot.js';

describe('baralho', () => {
  it('tem 78 cartas distintas', () => {
    expect(CARDS).toHaveLength(78);
    expect(new Set(CARDS).size).toBe(78);
  });
});

describe('drawCards', () => {
  it('sorteia 3 cartas distintas', () => {
    const cards = drawCards(3);
    expect(cards).toHaveLength(3);
    expect(new Set(cards).size).toBe(3);
    for (const card of cards) expect(CARDS).toContain(card);
  });

  it('sorteia 1 carta', () => {
    expect(drawCards(1)).toHaveLength(1);
  });

  it('é determinístico com um rng fixo e respeita a sequência', () => {
    const sequence = [0, 0, 0];
    let i = 0;
    const rng = () => sequence[i++ % sequence.length]!;
    expect(drawCards(3, rng)).toEqual([CARDS[0], CARDS[1], CARDS[2]]);
  });

  it('nunca repete carta mesmo com rng que sempre devolve o último índice', () => {
    const cards = drawCards(3, () => 0.999999);
    expect(new Set(cards).size).toBe(3);
  });
});
