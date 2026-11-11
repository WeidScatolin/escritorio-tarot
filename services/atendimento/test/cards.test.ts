import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDeliveryMedia, cardImageFileName } from '../src/cards.js';
import { CARDS } from '../src/tarot.js';

function assetsWith(files: string[], shuffling = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'));
  mkdirSync(join(dir, 'cards'));
  for (const f of files) writeFileSync(join(dir, 'cards', f), 'x');
  if (shuffling) writeFileSync(join(dir, 'shuffling.jpg'), 'x');
  return dir;
}

describe('cardImageFileName', () => {
  it('usa o índice da carta em CARDS com 2 dígitos', () => {
    expect(cardImageFileName(CARDS[0]!)).toBe('00.jpg');
    expect(cardImageFileName(CARDS[22]!)).toBe('22.jpg');
    expect(cardImageFileName(CARDS[77]!)).toBe('77.jpg');
  });
  it('carta desconhecida: null', () => {
    expect(cardImageFileName('Carta Inventada')).toBeNull();
  });
});

describe('buildDeliveryMedia', () => {
  it('monta embaralhando + uma imagem por carta com a posição na legenda', () => {
    const dir = assetsWith(['00.jpg', '01.jpg'], true);
    const media = buildDeliveryMedia(dir, [CARDS[0]!, CARDS[1]!], ['Passado', 'Presente']);
    expect(media.shuffling?.path).toBe(join(dir, 'shuffling.jpg'));
    expect(media.cards).toHaveLength(2);
    expect(media.cards[0]).toEqual({ path: join(dir, 'cards', '00.jpg'), caption: `Passado — ${CARDS[0]}` });
    expect(media.cards[1]!.caption).toBe(`Presente — ${CARDS[1]}`);
  });
  it('sem shuffling.jpg: shuffling null (não trava)', () => {
    const dir = assetsWith(['00.jpg']);
    expect(buildDeliveryMedia(dir, [CARDS[0]!], ['A carta do momento']).shuffling).toBeNull();
  });
  it('imagem da carta ausente: entrada com path null', () => {
    const dir = assetsWith(['00.jpg']);
    const media = buildDeliveryMedia(dir, [CARDS[0]!, CARDS[36]!], ['Passado', 'Presente']);
    expect(media.cards[0]!.path).not.toBeNull();
    expect(media.cards[1]!.path).toBeNull();
  });
  it('sem posição definida usa "Carta N"', () => {
    const dir = assetsWith(['00.jpg']);
    expect(buildDeliveryMedia(dir, [CARDS[0]!], []).cards[0]!.caption).toBe(`Carta 1 — ${CARDS[0]}`);
  });
});
