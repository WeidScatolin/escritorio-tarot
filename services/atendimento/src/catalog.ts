export type CatalogItem = {
  id: string;
  name: string;
  priceCents: number;
  /** Quantas cartas o sistema sorteia nesta tiragem. */
  cardCount: number;
  /** Posição de cada carta na tiragem (mesmo tamanho de cardCount). */
  positions: readonly string[];
  /** Instrução de estilo e tamanho da leitura, usada no prompt da IA. */
  readingStyle: string;
};

export const CATALOG: readonly CatalogItem[] = [
  {
    id: 'tiragem-basica',
    name: 'Tiragem básica (1 carta)',
    priceCents: 1500,
    cardCount: 1,
    positions: ['A carta do momento'],
    readingStyle:
      'Leitura curta e direta, de 3 a 5 frases, com um olhar objetivo sobre a pergunta do cliente a partir dessa única carta.',
  },
  {
    id: 'tiragem-intermediaria',
    name: 'Tiragem intermediária (3 cartas: passado, presente e futuro)',
    priceCents: 2500,
    cardCount: 3,
    positions: ['Passado', 'Presente', 'Futuro'],
    readingStyle:
      'Interprete cada carta na sua posição (passado, presente, futuro) em um parágrafo curto cada e feche com uma síntese de 2 a 3 frases.',
  },
  {
    id: 'tiragem-completa',
    name: 'Tiragem completa (5 cartas, com conselho final)',
    priceCents: 3500,
    cardCount: 5,
    positions: ['Situação atual', 'O desafio', 'O que influencia', 'O conselho', 'A tendência'],
    readingStyle:
      'Interprete cada carta na sua posição em um parágrafo curto, relacione as cartas entre si e feche com um conselho final prático e acolhedor.',
  },
];

export function getItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

export function formatBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${sign}R$ ${reais},${centavos}`;
}
