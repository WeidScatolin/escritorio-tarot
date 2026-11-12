// Auditoria do atendimento (2026-11): persona, respostas menos robóticas, filtros sem falso positivo,
// pós-leitura e leitura sem corte. A regra de honestidade não mudou: a atendente não puxa o assunto,
// mas nunca diz que é humana nem nega ser IA.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deliverReading,
  FAREWELL,
  handleLead,
  markDelivered,
  parseAgentOutput,
  revealsForbidden,
  type AgentDeps,
} from '../src/agent.js';
import { confirmPayment, openCharge } from '../src/payments.js';
import { createFakePix } from '../src/pix/fake.js';
import { createNimClient } from '../src/llm/nim.js';
import { createStore } from '../src/store.js';
import { CARDS } from '../src/tarot.js';
import type { LlmClient, LlmResult } from '../src/llm/nim.js';
import type { InboundMessage } from '../src/types.js';

const JID = '5511900000000@s.whatsapp.net';

type LlmCall = Parameters<LlmClient['complete']>[0];

function fakeLlm(results: LlmResult[]): { client: LlmClient; calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  const client: LlmClient = {
    async complete(input) {
      calls.push(input);
      return results[Math.min(calls.length - 1, results.length - 1)]!;
    },
  };
  return { client, calls };
}

const ok = (text: string): LlmResult => ({ kind: 'ok', text });
const json = (reply: string, action: unknown = { kind: 'none' }): LlmResult => ok(JSON.stringify({ reply, action }));
const CHARGE_3 = json('Perfeito!', { kind: 'charge', itemId: 'tiragem-intermediaria' });

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

let store: ReturnType<typeof createStore>;
let pix: ReturnType<typeof createFakePix>;
let notices: string[];

function deps(llm: LlmClient): AgentDeps {
  return { llm, store, pix, now: () => 1_700_000_000, notifyOwner: (text) => void notices.push(text) };
}

beforeEach(() => {
  store = createStore(':memory:');
  pix = createFakePix();
  notices = [];
});

async function paidCharge(itemId = 'tiragem-intermediaria') {
  if (!store.getConversation(JID)) {
    store.saveConversation({ jid: JID, mode: 'ai', engagedAt: 1, openChargeId: null, stage: 'awaiting_payment' });
  }
  const charge = await openCharge({ store, pix }, JID, itemId);
  pix.simulatePayment(charge.chargeId);
  expect(await confirmPayment({ store, pix }, charge.chargeId)).toBe('paid');
  return charge;
}

/** Cliente com leitura paga e entregue; devolve as cartas que saíram. */
async function deliveredReading(): Promise<string[]> {
  const charge = await paidCharge();
  await deliverReading(deps(fakeLlm([ok('Ana, as cartas mostram um momento de espera e de escolha.')]).client), charge.chargeId);
  markDelivered(store, charge.chargeId);
  return store.getCharge(charge.chargeId)!.cards!;
}

describe('persona: tem nome e voz, sem puxar o assunto de ser IA', () => {
  it('o prompt dá nome à atendente e proíbe linguagem de atendimento automático', async () => {
    const llm = fakeLlm([json('Oi!')]);
    await handleLead(deps(llm.client), inbound('oi'));
    const system = llm.calls[0]!.system;

    expect(system).toMatch(/Você é a Luna, taróloga/);
    expect(system).toMatch(/Seu nome é Luna/);
    expect(system).toMatch(/não se apresente como assistente, robô, IA ou atendimento automático/i);
    expect(system).toMatch(/Nada de linguagem de atendimento/i);
    // O roteiro antigo ("Sou a assistente de inteligência artificial da Luna") virava muleta do modelo.
    expect(system).not.toMatch(/assistente de inteligência artificial da Luna/i);
  });

  it('a regra de honestidade continua: nunca humana, nunca nega ser IA, e responde a verdade se perguntarem', async () => {
    const llm = fakeLlm([json('Oi!')]);
    await handleLead(deps(llm.client), inbound('oi'));
    const system = llm.calls[0]!.system;

    expect(system).toMatch(/Nunca diga que é uma pessoa ou humana e nunca negue ser uma inteligência artificial/);
    expect(system).toMatch(/Só se o cliente perguntar de verdade.*diga a verdade/is);
    expect(revealsForbidden('Sou humana, pode confiar.')).toBe(true);
    expect(revealsForbidden('Não sou robô, sou a Luna.')).toBe(true);
    expect(revealsForbidden('Sou uma inteligência artificial, sim 😊 Me conta, o que você quer olhar?')).toBe(false);
  });

  it('a despedida convida a tirar dúvida da leitura, sem vender', () => {
    expect(FAREWELL).toMatch(/d[uú]vida/i);
    expect(FAREWELL).not.toMatch(/R\$|tiragem|oferta/i);
  });
});

describe('menção de tema delicado: segue para a IA com aviso, em vez de resposta fixa', () => {
  it.each([
    ['Sou de câncer e ele é de escorpião, a gente combina?', /saúde/],
    ['Estou grávida e ele sumiu, ele volta?', /gravidez/],
    ['Depois que minha mãe faleceu ele se afastou de mim', /morte ou luto/],
  ])('"%s": chama a IA e avisa do tema', async (text, label) => {
    const llm = fakeLlm([json('Entendi, me conta mais.')]);
    const result = await handleLead(deps(llm.client), inbound(text));

    expect(llm.calls).toHaveLength(1);
    expect(result.replies).toEqual(['Entendi, me conta mais.']);
    const system = llm.calls[0]!.system;
    expect(system).toMatch(/ATENÇÃO: a última mensagem do cliente cita/);
    expect(system).toMatch(label);
    expect(system).toMatch(/não preveja nem prometa nada/);
  });

  it('mensagem comum não ganha aviso nenhum', async () => {
    const llm = fakeLlm([json('Oi!')]);
    await handleLead(deps(llm.client), inbound('quero saber se meu ex vai voltar'));
    expect(llm.calls[0]!.system).not.toMatch(/ATENÇÃO/);
  });

  it('mesmo com o aviso, a saída que prevê gravidez continua barrada', async () => {
    const llm = fakeLlm([json('Você está grávida sim, as cartas mostram.')]);
    const result = await handleLead(deps(llm.client), inbound('Estou grávida e ele sumiu, ele volta?'));
    expect(result.replies.join(' ')).not.toMatch(/grávida/);
    expect(result.notifyOwner).toBeDefined();
  });
});

describe('com Pix aberto: só AFIRMAÇÃO de pagamento recebe a resposta fixa', () => {
  async function withOpenPix() {
    const llm = fakeLlm([CHARGE_3, json('É por Pix, é só copiar o código e colar no app do banco.')]);
    await handleLead(deps(llm.client), inbound('quero a de 3 cartas'));
    return llm;
  }

  it.each([
    'Qual a forma de pagamento?',
    'O link não abre, como faço o pagamento?',
    'Quanto eu pago mesmo?',
    'já fiz tarot antes e não gostei',
  ])('dúvida vai para a IA: %s', async (text) => {
    const llm = await withOpenPix();
    const result = await handleLead(deps(llm.client), inbound(text));
    expect(llm.calls).toHaveLength(2);
    expect(result.replies[0]).toMatch(/copiar o código/);
  });

  it.each(['já paguei', 'tá pago', 'fiz o pix agora', 'pagamento feito', 'Pago!', 'já fiz', 'te mandei o comprovante'])(
    'afirmação não chama a IA e não libera nada: %s',
    async (text) => {
      const llm = await withOpenPix();
      const chargeId = store.getConversation(JID)!.openChargeId!;
      const result = await handleLead(deps(llm.client), inbound(text));
      expect(llm.calls).toHaveLength(1);
      expect(result.replies.join(' ')).toMatch(/confirma/i);
      expect(store.getCharge(chargeId)!.status).toBe('pending');
    },
  );

  it('o prompt avisa a IA de que há um Pix aberto e de qual tiragem', async () => {
    const llm = await withOpenPix();
    await handleLead(deps(llm.client), inbound('como eu pago?'));
    const system = llm.calls[1]!.system;
    expect(system).toMatch(/Já existe um Pix aberto, ainda não pago, da Tiragem intermediária/);
    expect(system).toMatch(/R\$ 25,00/);
  });

  it('pedir outra tiragem: reenvia o Pix aberto dizendo de qual tiragem ele é', async () => {
    const llm = await withOpenPix();
    const other = fakeLlm([json('Claro!', { kind: 'charge', itemId: 'tiragem-completa' })]);
    const result = await handleLead(deps(other.client), inbound('mudei de ideia, quero a completa'));
    void llm;
    expect(result.replies[0]).toMatch(/O Pix que está aberto é o da Tiragem intermediária/);
    expect(result.replies[0]).toMatch(/R\$ 25,00/);
    expect(result.notifyOwner).toBeDefined();
  });
});

describe('segunda chance para o modelo antes da mensagem genérica', () => {
  it('primeira resposta fora do formato, segunda válida: o cliente recebe a segunda', async () => {
    const llm = fakeLlm([ok('Claro, vamos lá!'), json('Oi! Como você se chama?')]);
    const result = await handleLead(deps(llm.client), inbound('oi'));

    expect(result.replies).toEqual(['Oi! Como você se chama?']);
    expect(result.notifyOwner).toBeUndefined();
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.system).toMatch(/saiu fora do formato.*SOMENTE com o objeto JSON/s);
  });

  it('texto limpo na primeira e JSON quebrado na segunda: aproveita o texto limpo da primeira', async () => {
    const llm = fakeLlm([ok('Oi! Como você se chama?'), ok('{"reply": "Oi')]);
    const result = await handleLead(deps(llm.client), inbound('oi'));

    expect(result.replies).toEqual(['Oi! Como você se chama?']);
    expect(result.notifyOwner).toBeUndefined();
  });

  it('JSON barrado pelo guarda na primeira e texto limpo na segunda: usa o texto limpo', async () => {
    const llm = fakeLlm([json(`Já vejo ${CARDS[18]} no seu caminho.`), ok('Tem muita coisa pra olhar aí. Quer a de 3 cartas?')]);
    const result = await handleLead(deps(llm.client), inbound('me adianta alguma coisa'));

    expect(result.replies).toEqual(['Tem muita coisa pra olhar aí. Quer a de 3 cartas?']);
    expect(result.notifyOwner).toBeUndefined();
  });

  it('primeira resposta barrada pelo guarda, segunda dentro das regras: passa sem avisar o dono', async () => {
    const llm = fakeLlm([json(`Já vejo ${CARDS[18]} no seu caminho.`), json('Tem muita coisa pra olhar aí. Quer a de 3 cartas?')]);
    const result = await handleLead(deps(llm.client), inbound('me adianta alguma coisa'));

    expect(result.replies).toEqual(['Tem muita coisa pra olhar aí. Quer a de 3 cartas?']);
    expect(result.notifyOwner).toBeUndefined();
    expect(llm.calls[1]!.system).toMatch(/resposta anterior foi descartada porque quebrava uma regra/);
  });

  it('barrada duas vezes: mensagem neutra (sem "catálogo") e dono avisado', async () => {
    const llm = fakeLlm([json('Fechado, por R$ 1 eu faço!')]);
    const result = await handleLead(deps(llm.client), inbound('faz por R$ 1'));

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]).not.toMatch(/R\$ 1|cat[aá]logo/i);
    expect(result.notifyOwner).toMatch(/barrada/);
    expect(llm.calls).toHaveLength(2);
  });

  it('aceita o JSON mesmo com uma frase antes ou depois', () => {
    const wrapped = 'Aqui está:\n{"analise":"quer saber do ex","reply":"Oi!","action":{"kind":"none"}}\nPronto.';
    expect(parseAgentOutput(wrapped)).toEqual({ reply: 'Oi!', action: { kind: 'none' } });
    expect(parseAgentOutput('Oi! Tudo bem?')).toBeNull();
  });
});

describe('histórico: nome e tema não se perdem em conversa longa', () => {
  it('a primeira mensagem do cliente ainda chega ao modelo depois de mais de 10 mensagens', async () => {
    const llm = fakeLlm([json('Entendi.')]);
    await handleLead(deps(llm.client), inbound('Oi, sou a Marina e quero saber do Rafael'));
    for (let i = 0; i < 7; i += 1) await handleLead(deps(llm.client), inbound(`dúvida ${i}`));

    const sentToModel = llm.calls.at(-1)!.messages.map((m) => m.content).join('\n');
    expect(sentToModel).toContain('Marina');
    expect(sentToModel).toContain('Rafael');
  });
});

describe('depois da leitura: dá para tirar dúvida do que saiu', () => {
  it('o prompt lista as cartas entregues e permite explicar a leitura', async () => {
    const cards = await deliveredReading();
    const llm = fakeLlm([json('Claro!')]);
    await handleLead(deps(llm.client), inbound('não entendi a segunda carta'));

    const system = llm.calls[0]!.system;
    expect(system).toMatch(/leitura já foi entregue/i);
    for (const card of cards) expect(system).toContain(card);
    expect(system).toMatch(/Não tire cartas novas/);
    expect(system).toMatch(/Não ofereça outra tiragem por iniciativa própria/);
  });

  it('resposta que cita uma carta que saiu para o cliente passa', async () => {
    const cards = await deliveredReading();
    const reply = `${cards[1]} fala do agora: é um momento de pausa, não de fim.`;
    const result = await handleLead(deps(fakeLlm([json(reply)]).client), inbound('não entendi a segunda carta'));

    expect(result.replies).toEqual([reply]);
    expect(result.notifyOwner).toBeUndefined();
  });

  it('carta que NÃO saiu continua barrada (carta nova só com nova tiragem paga)', async () => {
    const cards = await deliveredReading();
    const other = CARDS.find((card) => !cards.includes(card))!;
    const result = await handleLead(
      deps(fakeLlm([json(`Tirei mais uma pra você: ${other}.`)]).client),
      inbound('tira mais uma carta pra mim'),
    );

    expect(result.replies.join(' ')).not.toContain(other);
    expect(result.notifyOwner).toBeDefined();
  });

  it('antes da entrega, nenhuma carta pode ser citada', async () => {
    const result = await handleLead(deps(fakeLlm([json(`Vejo ${CARDS[0]} aí.`)]).client), inbound('oi'));
    expect(result.replies.join(' ')).not.toContain(CARDS[0]);
  });
});

describe('leitura: personalizada, sem corte e sem sumir com o cliente que pagou', () => {
  it('o prompt pede resposta direta à pergunta, com o nome e os detalhes do cliente', async () => {
    const charge = await paidCharge();
    const llm = fakeLlm([ok('Ana, as cartas mostram um momento de espera e de escolha.')]);
    await deliverReading(deps(llm.client), charge.chargeId);

    const system = llm.calls[0]!.system;
    expect(system).toMatch(/Use o nome do cliente, a pergunta que ele fez e os detalhes/);
    expect(system).toMatch(/Comece respondendo à pergunta dele/);
    expect(system).toMatch(/Não afirme como fato o que outra pessoa pensa, sente ou faz/);
    expect(system).toMatch(/Nunca diga que é uma pessoa ou humana/);
    expect(system).toMatch(/sem JSON/i);
  });

  it('a leitura tem mais espaço para escrever do que a conversa', async () => {
    const charge = await paidCharge();
    const llm = fakeLlm([ok('Ana, as cartas mostram um momento de espera e de escolha.')]);
    await deliverReading(deps(llm.client), charge.chargeId);
    expect(llm.calls[0]!.maxTokens).toBe(2000);

    const chat = fakeLlm([json('Oi!')]);
    await handleLead(deps(chat.client), inbound('oi'));
    expect(chat.calls[0]!.maxTokens).toBeUndefined();
  });

  it('a pergunta feita lá no começo de uma conversa longa chega à leitura', async () => {
    const chat = fakeLlm([json('Entendi.')]);
    await handleLead(deps(chat.client), inbound('Oi, sou a Marina e quero saber se o Rafael volta'));
    for (let i = 0; i < 8; i += 1) await handleLead(deps(chat.client), inbound(`mais uma dúvida ${i}`));
    const charge = await paidCharge();
    const llm = fakeLlm([ok('Marina, as cartas mostram um momento de espera e de escolha.')]);
    await deliverReading(deps(llm.client), charge.chargeId);

    expect(llm.calls[0]!.messages.map((m) => m.content).join('\n')).toContain('Rafael volta');
  });

  it('resposta cortada pelo limite de tokens: tenta de novo e entrega a completa', async () => {
    const charge = await paidCharge();
    const cut: LlmResult = { kind: 'ok', text: 'Ana, a primeira carta fala de espera. A segunda mostra que', truncated: true };
    const llm = fakeLlm([cut, ok('Ana, as cartas mostram um momento de espera e de escolha.')]);
    const replies = await deliverReading(deps(llm.client), charge.chargeId);

    expect(llm.calls).toHaveLength(2);
    expect(replies[1]).toBe('Ana, as cartas mostram um momento de espera e de escolha.');
  });

  it('cortada nas duas tentativas: entrega até a última frase completa, nunca pela metade', async () => {
    const charge = await paidCharge();
    const cut: LlmResult = { kind: 'ok', text: 'Ana, a primeira carta fala de espera. A segunda mostra que', truncated: true };
    const replies = await deliverReading(deps(fakeLlm([cut]).client), charge.chargeId);

    expect(replies[1]).toBe('Ana, a primeira carta fala de espera.');
    expect(replies.at(-1)).toBe(FAREWELL);
    expect(notices).toEqual([]);
  });

  it('tira a marcação de markdown que o WhatsApp mostraria crua', async () => {
    const charge = await paidCharge();
    const llm = fakeLlm([ok('## Sua leitura\n\n**Passado:** um tempo de espera e de cuidado com você.')]);
    const replies = await deliverReading(deps(llm.client), charge.chargeId);
    expect(replies[1]).toBe('Sua leitura\n\nPassado: um tempo de espera e de cuidado com você.');
  });

  it.each([
    ['fingir ser humana', 'Ana, eu sou uma pessoa de verdade e sinto essa energia nas cartas com você.'],
    ['link', 'Ana, veja mais sobre a sua leitura em https://exemplo.com/leitura agora mesmo.'],
    ['prever gravidez', 'Ana, as cartas mostram que você está grávida e que ele vai voltar logo.'],
  ])('leitura que quebra regra (%s) não é entregue', async (_name, reading) => {
    const charge = await paidCharge();
    const replies = await deliverReading(deps(fakeLlm([ok(reading)]).client), charge.chargeId);
    expect(replies.join('\n')).not.toContain(reading);
    expect(replies).toHaveLength(1);
  });

  it('IA falhou duas vezes numa leitura paga: o dono é avisado', async () => {
    const charge = await paidCharge();
    const replies = await deliverReading(deps(fakeLlm([{ kind: 'unavailable' }]).client), charge.chargeId);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/instantes/i);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/Leitura PAGA sem interpretação/);
    expect(notices[0]).toContain(charge.chargeId);
  });

  it('leitura entregue normalmente não gera aviso', async () => {
    const charge = await paidCharge();
    await deliverReading(deps(fakeLlm([ok('Ana, as cartas mostram um momento de espera e de escolha.')]).client), charge.chargeId);
    expect(notices).toEqual([]);
  });
});

describe('cliente LLM: limite de tokens por chamada e aviso de corte', () => {
  function client(body: unknown) {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const llm = createNimClient({ apiKey: 'k', baseUrl: 'https://nim.test/v1', model: 'm', timeoutMs: 1000, fetchImpl });
    return { llm, bodies };
  }
  const input = { system: 's', messages: [{ role: 'user' as const, content: 'oi' }] };

  it('usa o limite padrão na conversa e o limite pedido na leitura', async () => {
    const { llm, bodies } = client({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    await llm.complete(input);
    await llm.complete({ ...input, maxTokens: 2000 });
    expect(bodies.map((b) => b.max_tokens)).toEqual([900, 2000]);
  });

  it.each(['length', 'max_tokens'])('finish_reason "%s" marca a resposta como cortada', async (reason) => {
    const { llm } = client({ choices: [{ message: { content: 'texto pela met' }, finish_reason: reason }] });
    expect(await llm.complete(input)).toEqual({ kind: 'ok', text: 'texto pela met', truncated: true });
  });

  it('resposta completa não vem marcada', async () => {
    const { llm } = client({ choices: [{ message: { content: 'texto inteiro.' }, finish_reason: 'stop' }] });
    expect(await llm.complete(input)).toEqual({ kind: 'ok', text: 'texto inteiro.' });
  });
});
