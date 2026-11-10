import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createStore, type Charge } from '../src/store.js';

const base: Charge = {
  chargeId: 'c1',
  jid: 'a@s.whatsapp.net',
  itemId: 'tiragem-3-cartas',
  amountCents: 2900,
  status: 'pending',
  cards: null,
};

describe('cobrança: copyPaste e entrega', () => {
  it('grava e devolve copyPaste e delivered', () => {
    const store = createStore(':memory:');
    store.saveCharge({ ...base, copyPaste: 'PIX-CODE', delivered: true });
    expect(store.getCharge('c1')).toMatchObject({ copyPaste: 'PIX-CODE', delivered: true });
  });

  it('sem os campos novos: copyPaste null e delivered false', () => {
    const store = createStore(':memory:');
    store.saveCharge(base);
    expect(store.getCharge('c1')).toMatchObject({ copyPaste: null, delivered: false });
  });
});

describe('avisos ao dono', () => {
  it('grava e lista do mais novo para o mais antigo, respeitando o limite', () => {
    const store = createStore(':memory:');
    store.addNotice('primeiro', 1000);
    store.addNotice('segundo', 2000);
    store.addNotice('terceiro', 3000);

    const notices = store.recentNotices(2);

    expect(notices.map((n) => n.text)).toEqual(['terceiro', 'segundo']);
    expect(notices[0]!.atMs).toBe(3000);
  });

  it('banco vazio lista nada', () => {
    expect(createStore(':memory:').recentNotices(10)).toEqual([]);
  });
});

describe('migração de banco antigo (sem as colunas novas)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('abre um banco criado antes das colunas e preserva os dados', () => {
    dir = mkdtempSync(join(tmpdir(), 'atendimento-'));
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE charges (
      charge_id TEXT PRIMARY KEY, jid TEXT NOT NULL, item_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL, status TEXT NOT NULL, cards TEXT
    );
    INSERT INTO charges VALUES ('velha', 'a@s.whatsapp.net', 'tiragem-3-cartas', 2900, 'pending', NULL);`);
    old.close();

    const store = createStore(path);

    expect(store.getCharge('velha')).toMatchObject({ amountCents: 2900, copyPaste: null, delivered: false });
    store.saveCharge({ ...base, chargeId: 'nova', copyPaste: 'X', delivered: false });
    expect(store.getCharge('nova')!.copyPaste).toBe('X');
    store.close();
  });
});
