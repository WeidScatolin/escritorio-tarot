import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { agentJson, JID, makeHarness, ok, T0, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;

type StatsBody = {
  generatedAtMs: number;
  chats: { total: number; active24h: number; human: number; awaitingPayment: number };
  charges: { pending: number; paid: number };
  revenue: { totalCents: number; todayCents: number };
  spend: {
    status: 'disabled' | 'ok' | 'stale' | 'error';
    totalCents: number | null;
    todayCents: number | null;
    currency: string | null;
    fetchedAtMs: number | null;
    errorKind: string | null;
  };
  profit: { totalCents: number | null; todayCents: number | null };
  activity: { processing: number };
  notices: { atMs: number; text: string }[];
};

async function stats(app: ReturnType<typeof buildServer>): Promise<StatsBody> {
  const response = await app.inject({ method: 'GET', url: `/api/stats/${TOKEN}` });
  expect(response.statusCode).toBe(200);
  return response.json() as StatsBody;
}

async function lead(h: Harness, app: ReturnType<typeof buildServer>) {
  await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }) });
  await app.settled();
}

describe('GET /api/stats/:token', () => {
  it('sem movimento: tudo zerado, gasto sem dados e nenhum aviso', async () => {
    const h = makeHarness();
    const body = await stats(buildServer(h.deps));

    expect(body.generatedAtMs).toBe(T0);
    expect(body.chats).toEqual({ total: 0, active24h: 0, human: 0, awaitingPayment: 0 });
    expect(body.charges).toEqual({ pending: 0, paid: 0 });
    expect(body.revenue).toEqual({ totalCents: 0, todayCents: 0 });
    expect(body.spend).toEqual({ status: 'disabled', totalCents: null, todayCents: null, currency: null, fetchedAtMs: null, errorKind: null });
    expect(body.profit).toEqual({ totalCents: null, todayCents: null });
    expect(body.activity.processing).toBe(0);
    expect(body.notices).toEqual([]);
  });

  it('com um lead e uma cobrança aberta: conversa ativa e Pix pendente', async () => {
    const h = makeHarness({ llm: [agentJson('Segue!', { kind: 'charge', itemId: 'tiragem-3-cartas' })] });
    const app = buildServer(h.deps);
    await lead(h, app);

    const body = await stats(app);

    expect(body.chats).toMatchObject({ total: 1, active24h: 1, awaitingPayment: 1 });
    expect(body.charges).toEqual({ pending: 1, paid: 0 });
    expect(body.revenue.totalCents).toBe(0);
  });

  it('depois do pagamento: faturamento total e de hoje', async () => {
    const h = makeHarness({ llm: [agentJson('Segue!', { kind: 'charge', itemId: 'tiragem-3-cartas' }), ok('Leitura.')] });
    const app = buildServer(h.deps);
    await lead(h, app);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    h.pix.simulatePayment(chargeId);
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();

    const body = await stats(app);

    expect(body.charges).toEqual({ pending: 0, paid: 1 });
    expect(body.revenue).toEqual({ totalCents: 2900, todayCents: 2900 });
  });

  it('no dia seguinte (horário de Brasília) o faturamento de ontem sai de "hoje" mas fica no total', async () => {
    const h = makeHarness({ llm: [agentJson('Segue!', { kind: 'charge', itemId: 'tiragem-3-cartas' }), ok('Leitura.')] });
    const app = buildServer(h.deps);
    await lead(h, app);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    h.pix.simulatePayment(chargeId);
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();

    h.clock.t += 25 * 3_600_000;
    const body = await stats(app);

    expect(body.revenue).toEqual({ totalCents: 2900, todayCents: 0 });
  });

  it('inclui os avisos mais recentes ao dono', async () => {
    const h = makeHarness({ llm: [{ kind: 'timeout' }] });
    const app = buildServer(h.deps);
    await lead(h, app);

    const body = await stats(app);

    expect(body.notices).toHaveLength(1);
    expect(body.notices[0]!.text).toContain('IA indisponível');
  });

  it('enquanto uma resposta está sendo preparada, activity.processing > 0; depois volta a 0', async () => {
    const h = makeHarness();
    let release: (value: { kind: 'ok'; text: string }) => void = () => undefined;
    h.deps.llm = {
      complete: () => new Promise((resolve) => (release = resolve)),
    };
    const app = buildServer(h.deps);

    await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }) });
    await new Promise((r) => setTimeout(r, 20));
    expect((await stats(app)).activity.processing).toBe(1);

    release({ kind: 'ok', text: JSON.stringify({ reply: 'Oi!', action: { kind: 'none' } }) });
    await app.settled();
    expect((await stats(app)).activity.processing).toBe(0);
  });

  it('token errado: 404', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: '/api/stats/errado' });
    expect(response.statusCode).toBe(404);
  });
});

describe('gasto em anúncios e lucro no painel', () => {
  const MIN = 60_000;
  const record = (over: object = {}) => ({
    totalCents: 10_000,
    todayCents: 2_000,
    currency: 'BRL',
    fetchedAtMs: T0 - 5 * MIN,
    errorKind: null,
    ...over,
  });

  async function withRevenue(h: Harness) {
    // R$ 29,00 de faturamento (hoje e total), pagando uma cobrança de verdade.
    const app = buildServer(h.deps);
    await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }) });
    await app.settled();
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    h.pix.simulatePayment(chargeId);
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();
    return app;
  }
  const script = [agentJson('Segue!', { kind: 'charge', itemId: 'tiragem-3-cartas' }), ok('Leitura.')];

  it('dado recente: status ok com valores e lucro = faturamento - gasto (em BRL)', async () => {
    const h = makeHarness({ llm: script });
    const app = await withRevenue(h);
    h.store.saveAdSpend(record({ totalCents: 1_000, todayCents: 500 }));

    const body = await stats(app);

    expect(body.spend).toMatchObject({ status: 'ok', totalCents: 1_000, todayCents: 500, currency: 'BRL' });
    expect(body.profit).toEqual({ totalCents: 2_900 - 1_000, todayCents: 2_900 - 500 });
  });

  it('lucro pode ser negativo (gastou mais do que faturou)', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    h.store.saveAdSpend(record({ totalCents: 5_000, todayCents: 5_000 }));

    const body = await stats(app);

    expect(body.profit).toEqual({ totalCents: -5_000, todayCents: -5_000 });
  });

  it('dado com mais de 1 hora: status stale, mantém os valores mas NÃO calcula lucro', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    h.store.saveAdSpend(record({ fetchedAtMs: T0 - 2 * 60 * MIN }));

    const body = await stats(app);

    expect(body.spend).toMatchObject({ status: 'stale', totalCents: 10_000 });
    expect(body.profit).toEqual({ totalCents: null, todayCents: null });
  });

  it('última consulta com erro: status error com o tipo do erro, sem lucro', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    h.store.saveAdSpend(record({ errorKind: 'auth' }));

    const body = await stats(app);

    expect(body.spend).toMatchObject({ status: 'error', errorKind: 'auth' });
    expect(body.profit).toEqual({ totalCents: null, todayCents: null });
  });

  it('moeda diferente de BRL: mostra o gasto na moeda da conta, mas não mistura no lucro', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    h.store.saveAdSpend(record({ currency: 'USD' }));

    const body = await stats(app);

    expect(body.spend).toMatchObject({ status: 'ok', currency: 'USD', totalCents: 10_000 });
    expect(body.profit).toEqual({ totalCents: null, todayCents: null });
  });

  it('erro logo na primeira consulta (nunca teve valor): error com valores nulos', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    h.store.saveAdSpend(record({ totalCents: null, todayCents: null, currency: null, fetchedAtMs: null, errorKind: 'network' }));

    const body = await stats(app);

    expect(body.spend).toMatchObject({ status: 'error', totalCents: null, errorKind: 'network' });
  });
});

describe('GET /painel/:token', () => {
  it('serve a página do escritório (HTML com canvas)', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: `/painel/${TOKEN}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<canvas');
  });

  it('a página busca os dados em /api/stats (e não contém números fictícios fixos)', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: `/painel/${TOKEN}` });

    expect(response.body).toContain('/api/stats/');
    expect(response.body).not.toContain('1280');
  });

  it('token errado: 404', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: '/painel/errado' });
    expect(response.statusCode).toBe(404);
  });
});
