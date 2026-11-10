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

describe('conversa: última mensagem do cliente (janela de 24 h)', () => {
  it('grava e devolve lastInboundAtMs; sem informar, volta null', () => {
    const store = createStore(':memory:');
    const conv = { jid: 'a@s.whatsapp.net', mode: 'ai' as const, engagedAt: 1, openChargeId: null, stage: 'greeting' as const };

    store.saveConversation(conv);
    expect(store.getConversation(conv.jid)!.lastInboundAtMs).toBeNull();

    store.saveConversation({ ...conv, lastInboundAtMs: 1_700_000_123_000 });
    expect(store.getConversation(conv.jid)!.lastInboundAtMs).toBe(1_700_000_123_000);
  });

  it('migra banco antigo de conversas sem a coluna nova', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atendimento-'));
    try {
      const path = join(dir, 'old-conv.db');
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE conversations (
        jid TEXT PRIMARY KEY, mode TEXT NOT NULL, engaged_at INTEGER, open_charge_id TEXT, stage TEXT NOT NULL
      );
      INSERT INTO conversations VALUES ('velho@s.whatsapp.net', 'ai', 5, NULL, 'greeting');`);
      old.close();

      const store = createStore(path);
      expect(store.getConversation('velho@s.whatsapp.net')).toMatchObject({ engagedAt: 5, lastInboundAtMs: null });
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cobrança: horário do pagamento', () => {
  it('grava e devolve paidAtMs; sem informar, volta null', () => {
    const store = createStore(':memory:');
    store.saveCharge(base);
    expect(store.getCharge('c1')!.paidAtMs).toBeNull();

    store.saveCharge({ ...base, status: 'paid', paidAtMs: 1_700_000_999_000 });
    expect(store.getCharge('c1')!.paidAtMs).toBe(1_700_000_999_000);
  });

  it('migra banco antigo de cobranças sem paid_at', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atendimento-'));
    try {
      const path = join(dir, 'old-paid.db');
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE charges (
        charge_id TEXT PRIMARY KEY, jid TEXT NOT NULL, item_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, status TEXT NOT NULL, cards TEXT
      );
      INSERT INTO charges VALUES ('velha', 'a@s.whatsapp.net', 'tiragem-3-cartas', 2900, 'paid', NULL);`);
      old.close();

      const store = createStore(path);
      expect(store.getCharge('velha')).toMatchObject({ status: 'paid', paidAtMs: null });
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getStats (números do painel)', () => {
  const NOW = 1_700_000_000_000;
  const DAY_START = NOW - 6 * 3_600_000;
  const conv = (jid: string, over: object = {}) => ({
    jid,
    mode: 'ai' as const,
    engagedAt: 1,
    openChargeId: null,
    stage: 'greeting' as const,
    lastInboundAtMs: NOW - 1000,
    ...over,
  });

  it('banco vazio: tudo zerado', () => {
    expect(createStore(':memory:').getStats(NOW, DAY_START)).toEqual({
      chats: { total: 0, active24h: 0, human: 0, awaitingPayment: 0 },
      charges: { pending: 0, paid: 0 },
      revenue: { totalCents: 0, todayCents: 0 },
    });
  });

  it('conta conversas ativas nas últimas 24 h, humanas e aguardando pagamento', () => {
    const store = createStore(':memory:');
    store.saveConversation(conv('a@s.whatsapp.net'));
    store.saveConversation(conv('b@s.whatsapp.net', { mode: 'human' }));
    store.saveConversation(conv('c@s.whatsapp.net', { stage: 'awaiting_payment' }));
    store.saveConversation(conv('d@s.whatsapp.net', { lastInboundAtMs: NOW - 25 * 3_600_000 }));
    store.saveConversation(conv('e@s.whatsapp.net', { lastInboundAtMs: null }));

    expect(store.getStats(NOW, DAY_START).chats).toEqual({ total: 5, active24h: 3, human: 1, awaitingPayment: 1 });
  });

  it('faturamento soma só cobranças pagas; "hoje" usa o horário do pagamento', () => {
    const store = createStore(':memory:');
    const charge = (chargeId: string, over: object) => ({ ...base, chargeId, ...over });
    store.saveCharge(charge('p1', { status: 'paid', amountCents: 2900, paidAtMs: NOW - 3_600_000 }));
    store.saveCharge(charge('p2', { status: 'paid', amountCents: 4900, paidAtMs: NOW - 10 * 3_600_000 }));
    store.saveCharge(charge('p3', { status: 'pending', amountCents: 9900 }));

    const stats = store.getStats(NOW, DAY_START);

    expect(stats.charges).toEqual({ pending: 1, paid: 2 });
    expect(stats.revenue).toEqual({ totalCents: 7800, todayCents: 2900 });
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
