import { describe, expect, it } from 'vitest';
import { CARDS, cardsToAvoid, drawCards } from '../src/tarot.js';

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

describe('drawCards com cartas a evitar', () => {
  it('nunca sorteia uma carta da lista a evitar', () => {
    const avoid = CARDS.slice(0, 70);
    for (let i = 0; i < 50; i++) {
      for (const card of drawCards(5, undefined, avoid)) expect(avoid).not.toContain(card);
    }
  });

  it('falha se não sobrar baralho suficiente', () => {
    expect(() => drawCards(5, undefined, CARDS.slice(0, 75))).toThrow(RangeError);
  });
});

describe('cardsToAvoid', () => {
  it('evita todas as cartas anteriores enquanto sobrar baralho', () => {
    const previous = [[CARDS[0]!, CARDS[1]!], [CARDS[2]!]];
    expect(cardsToAvoid(previous, 5).sort()).toEqual([CARDS[0], CARDS[1], CARDS[2]].sort());
  });

  it('sem histórico não evita nada', () => {
    expect(cardsToAvoid([], 3)).toEqual([]);
  });

  it('se o baralho não bastar, evita só a tiragem mais recente', () => {
    const previous = [[CARDS[0]!, CARDS[1]!], CARDS.slice(2, 77)];
    expect(cardsToAvoid(previous, 5)).toEqual([CARDS[0], CARDS[1]]);
  });
});
