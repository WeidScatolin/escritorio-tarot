import { describe, expect, it } from 'vitest';
import { createStore, type Charge, type Conversation } from '../src/store.js';

describe('store', () => {
  it('markSeen devolve true so na primeira vez', () => {
    const store = createStore(':memory:');
    expect(store.markSeen('a')).toBe(true);
    expect(store.markSeen('a')).toBe(false);
    expect(store.markSeen('b')).toBe(true);
  });

  it('getConversation de jid desconhecido devolve null', () => {
    const store = createStore(':memory:');
    expect(store.getConversation('x@s.whatsapp.net')).toBeNull();
  });

  it('salva e le conversa, e atualiza ao salvar de novo', () => {
    const store = createStore(':memory:');
    const c: Conversation = {
      jid: '5511@s.whatsapp.net',
      mode: 'ai',
      engagedAt: 1700000000000,
      openChargeId: null,
      stage: 'greeting',
    };
    // Sem lastInboundAtMs informado, volta null (padrão).
    const defaults = { lastInboundAtMs: null };
    store.saveConversation(c);
    expect(store.getConversation(c.jid)).toEqual({ ...c, ...defaults });

    const updated: Conversation = { ...c, mode: 'human', openChargeId: 'ch1', stage: 'awaiting_payment' };
    store.saveConversation(updated);
    expect(store.getConversation(c.jid)).toEqual({ ...updated, ...defaults });
  });

  it('recentMessages devolve em ordem cronologica e respeita o limit', () => {
    const store = createStore(':memory:');
    store.appendMessage('j', 'user', 'um');
    store.appendMessage('j', 'assistant', 'dois');
    store.appendMessage('j', 'user', 'tres');
    store.appendMessage('outro', 'user', 'nao deve aparecer');

    expect(store.recentMessages('j', 10)).toEqual([
      { role: 'user', content: 'um' },
      { role: 'assistant', content: 'dois' },
      { role: 'user', content: 'tres' },
    ]);
    expect(store.recentMessages('j', 2)).toEqual([
      { role: 'assistant', content: 'dois' },
      { role: 'user', content: 'tres' },
    ]);
    expect(store.recentMessages('vazio', 5)).toEqual([]);
  });

  it('saveCharge e getCharge fazem round-trip, com e sem cards', () => {
    const store = createStore(':memory:');
    const pending: Charge = {
      chargeId: 'c1',
      jid: 'j',
      itemId: 'tarot-3',
      amountCents: 4990,
      status: 'pending',
      cards: null,
    };
    // Sem copyPaste/delivered informados, voltam os valores padrão (null e false).
    const defaults = { copyPaste: null, delivered: false };
    store.saveCharge(pending);
    expect(store.getCharge('c1')).toEqual({ ...pending, ...defaults });

    const paid: Charge = { ...pending, status: 'paid', cards: ['O Louco', 'A Lua'] };
    store.saveCharge(paid);
    expect(store.getCharge('c1')).toEqual({ ...paid, ...defaults });
    expect(store.getCharge('nao-existe')).toBeNull();
  });

  it('trata valores com aspas como dados, nao como SQL', () => {
    const store = createStore(':memory:');
    store.appendMessage("j'; DROP TABLE messages; --", 'user', "x'y");
    expect(store.recentMessages("j'; DROP TABLE messages; --", 5)).toEqual([{ role: 'user', content: "x'y" }]);
  });
});
