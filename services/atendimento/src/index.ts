import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import { createEvolutionClient } from './evolution/client.js';
import { createNimClient } from './llm/nim.js';
import { createFakePix } from './pix/fake.js';
import { buildServer } from './server.js';
import { createStore } from './store.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

try {
  const config = loadConfig(process.env);
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

  // Provedor de Pix FALSO até o dono escolher um real: nenhum pagamento é de verdade.
  console.warn('ATENÇÃO: usando provedor de Pix FALSO (somente teste).');

  const app = buildServer({
    config,
    store: createStore(config.dbPath),
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
    now: Date.now,
    notifyOwner: (text) => console.warn(`[AVISO AO DONO] ${text}`),
  });

  const stop = async () => {
    await app.settled();
    await app.close();
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
