import { describe, expect, it } from 'vitest';
import { openCharge } from '../src/payments.js';
import { buildServer } from '../src/server.js';
import { agentJson, JID, makeHarness, ok, T0, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;

async function fire(h: Harness, app: ReturnType<typeof buildServer>, url: string, payload: unknown) {
  const response = await app.inject({ method: 'POST', url, payload: payload as object });
  await app.settled();
  return response;
}

async function leadFirstMessage(h: Harness) {
  const app = buildServer(h.deps);
  await fire(h, app, EVO, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));
  return app;
}

describe('F4: eco do bot reconhecido pelo id, não só pelo tempo', () => {
  it('eco com o id que o bot enviou, mesmo 10 minutos depois, não desliga a IA', async () => {
    const h = makeHarness();
    const app = await leadFirstMessage(h);
    h.clock.t += 10 * 60_000;

    await fire(h, app, EVO, upsert({ id: h.sent[0]!.messageId!, text: 'Oi!', fromMe: true }));

    expect(h.store.getConversation(JID)!.mode).toBe('ai');
  });

  it('dono que digita logo depois da resposta do bot (id diferente) assume na hora', async () => {
    const h = makeHarness();
    const app = await leadFirstMessage(h);
    h.clock.t += 500;

    await fire(h, app, EVO, upsert({ id: 'dono-1', text: 'Oi, sou eu', fromMe: true }));

    expect(h.store.getConversation(JID)!.mode).toBe('human');
  });

  it('se a Evolution não devolver o id do envio, vale a janela de tempo como plano B', async () => {
    const h = makeHarness({ sendReturnsNoId: true });
    const app = await leadFirstMessage(h);

    h.clock.t += 500;
    await fire(h, app, EVO, upsert({ id: 'eco-sem-id', text: 'Oi!', fromMe: true }));
    expect(h.store.getConversation(JID)!.mode).toBe('ai');

    h.clock.t += 60_000;
    await fire(h, app, EVO, upsert({ id: 'dono-2', text: 'assumi', fromMe: true }));
    expect(h.store.getConversation(JID)!.mode).toBe('human');
  });
});

describe('F3: leitura paga não se perde quando o envio falha', () => {
  const script = [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' }), ok('Uma leitura bonita.')];

  it('envio falha na primeira vez, a repetição do webhook reentrega uma única vez', async () => {
    const h = makeHarness({ llm: script });
    const app = await leadFirstMessage(h);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    const before = h.sent.length;

    h.pix.simulatePayment(chargeId);
    h.flags.sendFails = true;
    await fire(h, app, PIX, { chargeId });
    expect(h.sent.length).toBe(before);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(false);
    expect(h.notices.length).toBeGreaterThan(0);

    h.flags.sendFails = false;
    await fire(h, app, PIX, { chargeId });
    const delivered = h.sent.length - before;
    expect(delivered).toBeGreaterThan(0);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);

    await fire(h, app, PIX, { chargeId });
    expect(h.sent.length - before).toBe(delivered);
  });
});

describe('F12: mensagens antigas', () => {
  it('mensagem com mais de 10 minutos é ignorada (ex.: histórico após reconexão)', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);

    await fire(h, app, EVO, upsert({ id: 'old-1', text: 'Vi o anúncio', ad: true, tsSec: T0 / 1000 - 3600 }));

    expect(h.llmCalls).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('mensagem de 1 minuto atrás ainda é atendida', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);

    await fire(h, app, EVO, upsert({ id: 'new-1', text: 'Vi o anúncio', ad: true, tsSec: T0 / 1000 - 60 }));

    expect(h.sent).toHaveLength(1);
  });
});

describe('janela de 24 h na entrega da leitura', () => {
  const script = [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' }), ok('Uma leitura bonita.')];

  async function paidAfter(hoursLater: number) {
    const h = makeHarness({ llm: script });
    const app = await leadFirstMessage(h);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    const before = h.sent.length;
    h.clock.t += hoursLater * 3_600_000;
    h.pix.simulatePayment(chargeId);
    await fire(h, app, PIX, { chargeId });
    return { h, delivered: h.sent.length - before, chargeId };
  }

  it('pagou fora das 24 h: entrega mesmo assim e avisa o dono', async () => {
    const { h, delivered, chargeId } = await paidAfter(25);

    expect(delivered).toBeGreaterThan(0);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
    expect(h.notices.some((n) => n.includes('24'))).toBe(true);
  });

  it('pagou dentro das 24 h: entrega sem aviso de janela', async () => {
    const { h, delivered } = await paidAfter(2);

    expect(delivered).toBeGreaterThan(0);
    expect(h.notices.some((n) => n.includes('24'))).toBe(false);
  });
});

describe('ritmo humano nas respostas', () => {
  it('cada mensagem vai com um atraso de digitação maior que zero', async () => {
    const h = makeHarness({ llm: [agentJson('Olá! Posso te ajudar com uma tiragem de 3 cartas hoje?')] });
    await leadFirstMessage(h);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.delayMs).toBeGreaterThanOrEqual(600);
  });

  it('o código de Pix colado vai com atraso curto, o texto longo com atraso maior', async () => {
    const h = makeHarness({ llm: [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' })] });
    await leadFirstMessage(h);

    const [intro, code] = h.sent;
    expect(code!.delayMs!).toBeLessThanOrEqual(1500);
    expect(intro!.delayMs!).toBeGreaterThan(code!.delayMs!);
  });

  it('espera um tempo "pensando" ANTES da primeira mensagem, uma vez só por resposta', async () => {
    const h = makeHarness({
      llm: [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' })],
      config: { replyThinkSeconds: 14 },
    });
    await leadFirstMessage(h);

    expect(h.sent).toHaveLength(3);
    expect(h.sleeps).toHaveLength(1);
    expect(h.sleeps[0]!).toBeGreaterThanOrEqual(8_400);
    expect(h.sleeps[0]!).toBeLessThanOrEqual(19_600);
  });

  it('uma resposta normal leva ~15 a 35 s no total (pensar + digitar)', async () => {
    const h = makeHarness({
      llm: [agentJson('Olá! Posso te ajudar com uma tiragem de 3 cartas hoje? Me conta o que você quer saber.')],
      config: { replyThinkSeconds: 14 },
    });
    await leadFirstMessage(h);

    const total = h.sleeps.reduce((a, b) => a + b, 0) + (h.sent[0]!.delayMs ?? 0);
    expect(total).toBeGreaterThanOrEqual(12_000);
    expect(total).toBeLessThanOrEqual(35_000);
  });

  it('REPLY_THINK_SECONDS=0: sem espera inicial', async () => {
    const h = makeHarness({ llm: [agentJson('Olá!')], config: { replyThinkSeconds: 0 } });
    await leadFirstMessage(h);
    expect(h.sleeps).toEqual([]);
  });

  it('acima do limite por minuto por conversa, o envio espera em vez de disparar tudo junto', async () => {
    const h = makeHarness({
      llm: [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' })],
      config: { maxMsgsPerMinuteChat: 2 },
    });
    await leadFirstMessage(h);

    expect(h.sent).toHaveLength(3);
    expect(h.sleeps.length).toBeGreaterThan(0);
  });

  it('abaixo do limite não há espera', async () => {
    const h = makeHarness({ llm: [agentJson('Olá!')] });
    await leadFirstMessage(h);
    expect(h.sleeps).toEqual([]);
  });
});

describe('grupos: nunca respondem', () => {
  const GROUP = '120363000000000000@g.us';

  it('mensagem de grupo, mesmo com marca de anúncio, não gera resposta nem chama a IA', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);

    await fire(h, app, EVO, upsert({ id: 'g1', text: 'Vi o anúncio', ad: true, jid: GROUP }));

    expect(h.sent).toEqual([]);
    expect(h.llmCalls).toEqual([]);
    expect(h.store.getConversation(GROUP)).toBeNull();
  });

  it('defesa no envio: cobrança ligada a um jid de grupo, mesmo paga, não envia nada e avisa o dono', async () => {
    const h = makeHarness({ llm: [ok('Uma leitura.')] });
    const app = buildServer(h.deps);
    const charge = await openCharge({ store: h.store, pix: h.pix }, GROUP, 'tiragem-intermediaria');
    h.pix.simulatePayment(charge.chargeId);

    await fire(h, app, PIX, { chargeId: charge.chargeId });

    expect(h.sent).toEqual([]);
    expect(h.notices.some((n) => n.includes(GROUP))).toBe(true);
  });

  it.each(['status@broadcast', '120363000000000000@newsletter', '5511999990000-1600000000@g.us'])(
    'destino %s nunca recebe envio',
    async (jid) => {
      const h = makeHarness({ llm: [ok('Uma leitura.')] });
      const app = buildServer(h.deps);
      const charge = await openCharge({ store: h.store, pix: h.pix }, jid, 'tiragem-intermediaria');
      h.pix.simulatePayment(charge.chargeId);

      await fire(h, app, PIX, { chargeId: charge.chargeId });

      expect(h.sent).toEqual([]);
    },
  );
});

describe('nenhuma mensagem proativa', () => {
  it('sem gatilho (mensagem de entrada ou pagamento confirmado) nada é enviado', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    await app.settled();
    h.clock.t += 48 * 3_600_000;
    await app.settled();
    expect(h.sent).toEqual([]);
    expect(h.llmCalls).toEqual([]);
  });

  it('contato comum, grupo, dono falando e pagamento pendente não geram envio', async () => {
    const h = makeHarness({ llm: [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' })] });
    const app = await leadFirstMessage(h);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    const before = h.sent.length;

    await fire(h, app, EVO, upsert({ id: 'x1', text: 'oi, tudo bem?', jid: '5511777770000@s.whatsapp.net' }));
    await fire(h, app, EVO, upsert({ id: 'x2', text: 'oi pessoal', jid: '120363000000000000@g.us' }));
    await fire(h, app, EVO, upsert({ id: 'x3', text: 'conversa minha', fromMe: true, jid: '5511666660000@s.whatsapp.net' }));
    await fire(h, app, PIX, { chargeId });

    expect(h.sent.length).toBe(before);
  });
});

describe('F2: avisos ao dono ficam gravados e consultáveis', () => {
  it('um aviso gera registro no banco e aparece em GET /notices/:token', async () => {
    const h = makeHarness({ llm: [{ kind: 'timeout' }] });
    const app = await leadFirstMessage(h);

    expect(h.store.recentNotices(10)).toHaveLength(1);
    const response = await app.inject({ method: 'GET', url: `/notices/${TOKEN}` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { notices: { text: string; atMs: number }[] };
    expect(body.notices).toHaveLength(1);
    expect(body.notices[0]!.text).toContain('IA indisponível');
  });

  it('GET /notices com token errado: 404', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: '/notices/errado' });
    expect(response.statusCode).toBe(404);
  });
});
