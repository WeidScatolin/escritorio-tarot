import { existsSync } from 'node:fs';
import { ConfigError, loadConfig } from './config.js';
import { buildServer } from './server.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

try {
  const config = loadConfig(process.env);
  const app = buildServer({ config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`atendimento ouvindo na porta ${config.port}`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
