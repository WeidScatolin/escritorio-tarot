import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMetaAdSpend } from './ads/meta.js';
import { startAdSpendPolling } from './ads/tracker.js';
import { ConfigError, loadConfig } from './config.js';
import { createEvolutionClient } from './evolution/client.js';
import { createNimClient } from './llm/nim.js';
import { startPublisher } from './publish.js';
import { createFakePix } from './pix/fake.js';
import { buildServer } from './server.js';
import { createEdgeTts } from './tts/edge.js';
import { createStore } from './store.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

try {
  const config = loadConfig(process.env);
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

  // Provedor de Pix FALSO até o dono escolher um real: nenhum pagamento é de verdade.
  console.warn('ATENÇÃO: usando provedor de Pix FALSO (somente teste).');

  const store = createStore(config.dbPath);
  const app = buildServer({
    config,
    store,
    llm: createNimClient({
      apiKey: config.nimApiKey,
      baseUrl: config.nimBaseUrl,
      model: config.nimModel,
      timeoutMs: 20_000,
    }),
    pix: createFakePix(),
    evolution: createEvolutionClient({
      baseUrl: config.evolutionUrl,
      apiKey: config.evolutionApiKey,
      instance: config.instance,
    }),
    ...(config.tts ? { tts: createEdgeTts({ voice: config.tts.voice }) } : {}),
    now: Date.now,
    notifyOwner: (text) => console.warn(`[AVISO AO DONO] ${text}`),
  });

  // Gasto em anúncios (Meta, somente leitura): só liga se conta, token e data estiverem configurados.
  let stopAdSpend: () => void = () => undefined;
  if (config.meta) {
    stopAdSpend = startAdSpendPolling(
      {
        provider: createMetaAdSpend({
          adAccountId: config.meta.adAccountId,
          accessToken: config.meta.accessToken,
          apiVersion: config.meta.apiVersion,
        }),
        store,
        now: Date.now,
        sinceDate: config.meta.spendSince,
        notify: (text) => {
          store.addNotice(text, Date.now());
          console.warn(`[AVISO AO DONO] ${text}`);
        },
      },
      config.adSpendPollMinutes * 60_000,
    );
    console.log('Leitura do gasto em anúncios (Meta) ligada.');
  } else {
    console.log('Gasto em anúncios desligado (META_* não configurado): o painel mostra "—".');
  }

  // Resumo do painel para a Vercel (saída apenas): só liga com PUBLISH_URL e PUBLISH_SECRET.
  let stopPublisher: () => void = () => undefined;
  if (config.publish) {
    stopPublisher = startPublisher(
      {
        statsUrl: `http://127.0.0.1:${config.port}/api/stats/${encodeURIComponent(config.webhookToken)}`,
        pushUrl: config.publish.url,
        secret: config.publish.secret,
      },
      config.publish.intervalSeconds * 1000,
    );
    console.log(`Publicação do painel na Vercel ligada (a cada ${config.publish.intervalSeconds}s).`);
  }

  const stop = async () => {
    stopAdSpend();
    stopPublisher();
    await app.settled();
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`atendimento ouvindo na porta ${config.port}`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
