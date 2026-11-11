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
// Cartas que o cliente já recebeu e não devem repetir. Evita todas as anteriores enquanto sobrar
// baralho suficiente; se não sobrar, evita só as da tiragem mais recente (previous[0]).
export function cardsToAvoid(previous: readonly (readonly string[])[], count: number): string[] {
  const all = new Set(previous.flat());
  if (CARDS.length - all.size >= count) return [...all];
  return [...(previous[0] ?? [])];
}

export function drawCards(count: number, rng: () => number = defaultRng, avoid: readonly string[] = []): string[] {
  const avoided = new Set(avoid);
  const deck = CARDS.filter((card) => !avoided.has(card));
  if (!Number.isInteger(count) || count < 1 || count > deck.length) {
    throw new RangeError(`Quantidade de cartas inválida: ${count}`);
  }
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.min(deck.length - 1, Math.floor(rng() * deck.length));
    drawn.push(deck.splice(index, 1)[0]!);
  }
  return drawn;
}
