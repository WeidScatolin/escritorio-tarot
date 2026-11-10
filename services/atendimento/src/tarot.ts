import { randomInt } from 'node:crypto';

const MAJOR = [
  'O Louco', 'O Mago', 'A Sacerdotisa', 'A Imperatriz', 'O Imperador', 'O Hierofante',
  'Os Enamorados', 'O Carro', 'A Força', 'O Eremita', 'A Roda da Fortuna', 'A Justiça',
  'O Enforcado', 'A Morte', 'A Temperança', 'O Diabo', 'A Torre', 'A Estrela',
  'A Lua', 'O Sol', 'O Julgamento', 'O Mundo',
];
const RANKS = ['Ás', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez', 'Valete', 'Cavaleiro', 'Rainha', 'Rei'];
const SUITS = ['de Copas', 'de Ouros', 'de Espadas', 'de Paus'];

export const CARDS: readonly string[] = [
  ...MAJOR,
  ...SUITS.flatMap((suit) => RANKS.map((rank) => `${rank} ${suit}`)),
];

const defaultRng = (): number => randomInt(0, 2 ** 31) / 2 ** 31;

// As cartas são sorteadas pelo código (nunca pela IA). O rng é injetável só para teste.
export function drawCards(count: 1 | 3, rng: () => number = defaultRng): string[] {
  const deck = [...CARDS];
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.min(deck.length - 1, Math.floor(rng() * deck.length));
    drawn.push(deck.splice(index, 1)[0]!);
  }
  return drawn;
}
