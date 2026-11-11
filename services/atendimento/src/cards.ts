import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CARDS } from './tarot.js';

export type CardMedia = { path: string | null; caption: string };
export type DeliveryMedia = { shuffling: { path: string; caption: string } | null; cards: CardMedia[] };

export const SHUFFLING_CAPTION = 'Embaralhando as cartas para você... 🔮';

/** assets/cards/NN.jpg, com NN = índice da carta em CARDS (2 dígitos). null se a carta não existe. */
export function cardImageFileName(card: string): string | null {
  const index = CARDS.indexOf(card);
  return index < 0 ? null : `${String(index).padStart(2, '0')}.jpg`;
}

/**
 * Imagens da entrega: "embaralhando" (se o arquivo existir) e uma por carta, com a posição na legenda.
 * Carta sem arquivo vem com path null (quem envia cai para texto).
 */
export function buildDeliveryMedia(assetsDir: string, cards: readonly string[], positions: readonly string[]): DeliveryMedia {
  const shufflingPath = join(assetsDir, 'shuffling.jpg');
  return {
    shuffling: existsSync(shufflingPath) ? { path: shufflingPath, caption: SHUFFLING_CAPTION } : null,
    cards: cards.map((card, i) => {
      const file = cardImageFileName(card);
      const path = file ? join(assetsDir, 'cards', file) : null;
      return { path: path && existsSync(path) ? path : null, caption: `${positions[i] ?? `Carta ${i + 1}`} — ${card}` };
    }),
  };
}
