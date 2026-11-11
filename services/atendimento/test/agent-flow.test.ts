import { beforeEach, describe, expect, it } from 'vitest';
import { deliverReading, FAREWELL, handleLead, markDelivered, revealsForbidden, type AgentDeps } from '../src/agent.js';
import { confirmPayment, openCharge } from '../src/payments.js';
import { createFakePix } from '../src/pix/fake.js';
import { createStore } from '../src/store.js';
import type { LlmClient, LlmResult } from '../src/llm/nim.js';
import type { InboundMessage } from '../src/types.js';

const JID = '5511900000000@s.whatsapp.net';
const ok = (text: string): LlmResult => ({ kind: 'ok', text });
const json = (reply: string, action: unknown = { kind: 'none' }): LlmResult => ok(JSON.stringify({ reply, action }));

let store: ReturnType<typeof createStore>;
let pix: ReturnType<typeof createFakePix>;
let calls: { system: string; messages: { role: string; content: string }[] }[];

function deps(results: LlmResult[]): AgentDeps {
  calls = [];
  const llm: LlmClient = {
    async complete(input) {
      calls.push(input);
      return results[Math.min(calls.length - 1, results.length - 1)]!;
    },
  };
  return { llm, store, pix, now: () => 1_700_000_000 };
}
const inbound = (text: string | null): InboundMessage => ({
  messageId: 'm-' + Math.random(),
  jid: JID,
  fromMe: false,
  isGroup: false,
  text,
  pushName: 'Cliente',
  timestampSec: 1_700_000_000,
  adReferral: null,
});

beforeEach(() => {
  store = createStore(':memory:');
  pix = createFakePix();
});

describe('fluxo: nome e tema em mensagens separadas', () => {
  it('o prompt manda perguntar só o nome, depois só o tema, e oferecer ao saber o tema', async () => {
    await handleLead(deps([json('Oi! Qual é o seu nome?')]), inbound('oi vi o anúncio'));
    const system = calls[0]!.system;
    expect(system).toMatch(/pergunte apenas o nome/i);
    expect(system).toMatch(/em outra mensagem/i);
    expect(system).toMatch(/assim que.*tema.*apresente as tr[eê]s tiragens/is);
    expect(system).toMatch(/chame o cliente pelo nome/i);
  });
});

describe('despedida', () => {
  it('o prompt proíbe oferecer outra tiragem depois da entrega', async () => {
    await handleLead(deps([json('Imagina!')]), inbound('oi'));
    expect(calls[0]!.system).toMatch(/n[aã]o ofere[cç]a outra tiragem/i);
  });

  it('FAREWELL agradece, coloca-se à disposição e não vende', () => {
    expect(FAREWELL).toMatch(/obrigad/i);
    expect(FAREWELL).toMatch(/disposi[cç][aã]o/i);
    expect(FAREWELL).not.toMatch(/R\$|tiragem|oferta|compre/i);
    expect(revealsForbidden(FAREWELL)).toBe(false);
  });

  it('a entrega da leitura termina com a despedida', async () => {
    const d = deps([json('Oi'), ok('Leitura bonita.')]);
    await handleLead(d, inbound('quero a básica'));
    const charge = await openCharge({ store, pix }, JID, 'tiragem-basica');
    pix.simulatePayment(charge.chargeId);
    await confirmPayment({ store, pix, now: () => 1 }, charge.chargeId);
    const replies = await deliverReading(d, charge.chargeId);
    expect(replies.at(-1)).toBe(FAREWELL);
    expect(replies.length).toBeGreaterThanOrEqual(3);
    markDelivered(store, charge.chargeId);
  });

  it('depois de entregue, o prompt orienta só agradecer e se despedir', async () => {
    store.saveConversation({ jid: JID, mode: 'ai', engagedAt: 1, openChargeId: null, stage: 'delivered' });
    await handleLead(deps([json('Eu que agradeço! Fico à disposição. 💜')]), inbound('muito obrigada'));
    expect(calls[0]!.system).toMatch(/leitura j[aá] foi entregue/i);
  });
});

describe('fora do escopo', () => {
  it.each([
    ['estou grávida?', /n[aã]o (consigo|posso|fa[cç]o)/i],
    ['qual número da mega sena?', /n[aã]o (consigo|posso|fa[cç]o)/i],
    ['tenho câncer, vou me curar?', /m[eé]dic/i],
    ['quando vou morrer?', /n[aã]o (consigo|posso|fa[cç]o)/i],
  ])('"%s": resposta fixa, sem chamar a IA, sem vender nem prever', async (text, pattern) => {
    const result = await handleLead(deps([json('NÃO DEVE SER USADA')]), inbound(text));
    expect(calls).toHaveLength(0);
    expect(result.replies).toHaveLength(1);
    const reply = result.replies[0]!;
    expect(reply).toMatch(pattern);
    expect(reply.length).toBeLessThan(400);
    expect(reply).not.toMatch(/R\$|pix|pagamento/i);
    expect(revealsForbidden(reply)).toBe(false);
    expect(store.getConversation(JID)?.stage).toBe('greeting');
  });

  it('risco emocional: acolhe, indica CVV 188, não vende e avisa o dono', async () => {
    const result = await handleLead(deps([json('x')]), inbound('não quero mais viver, vou me matar'));
    expect(calls).toHaveLength(0);
    const reply = result.replies.join(' ');
    expect(reply).toContain('188');
    expect(reply).toMatch(/CVV/);
    expect(reply).not.toMatch(/R\$|tiragem|pix/i);
    expect(result.notifyOwner).toMatch(/risco/i);
  });

  it('mensagem seguinte a uma crise vai para a IA com orientação de não vender', async () => {
    await handleLead(deps([json('x')]), inbound('quero me matar'));
    await handleLead(deps([json('Estou aqui com você.')]), inbound('não sei'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toMatch(/momento delicado.*n[aã]o (ofere[cç]a|venda)/is);
    expect(calls[0]!.system).toContain('188');
  });

  it('o prompt cobre saúde, gravidez, morte e loteria sem previsão nem aconselhamento', async () => {
    await handleLead(deps([json('Oi')]), inbound('oi'));
    const s = calls[0]!.system;
    expect(s).toMatch(/sa[uú]de/i);
    expect(s).toMatch(/gravidez/i);
    expect(s).toMatch(/loteria/i);
    expect(s).toMatch(/aconselhamento m[eé]dico, jur[ií]dico ou financeiro/i);
    expect(s).toMatch(/CVV 188/);
  });

  it('a saída da IA que prevê gravidez, morte ou loteria é barrada', () => {
    expect(revealsForbidden('Você está grávida, as cartas mostram.')).toBe(true);
    expect(revealsForbidden('Ele vai morrer em breve.')).toBe(true);
    expect(revealsForbidden('Você vai ganhar na loteria!')).toBe(true);
    expect(revealsForbidden('As cartas sugerem um momento de renovação.')).toBe(false);
  });
});
