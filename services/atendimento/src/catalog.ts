export type CatalogItem = { id: string; name: string; priceCents: number };

// PROVISÓRIO: escopo ainda não definido pelo dono
export const PLACEHOLDER_CATALOG: CatalogItem[] = [
  { id: 'tiragem-3-cartas', name: 'Tiragem de 3 cartas', priceCents: 2900 },
  { id: 'tiragem-completa', name: 'Tiragem completa', priceCents: 4900 },
];

export function getItem(id: string): CatalogItem | undefined {
  return PLACEHOLDER_CATALOG.find((item) => item.id === id);
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
