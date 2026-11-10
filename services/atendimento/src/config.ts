import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type Config = {
  port: number;
  evolutionUrl: string;
  evolutionApiKey: string;
  instance: string;
  webhookToken: string;
  nimApiKey: string;
  nimBaseUrl: string;
  nimModel: string;
  triggerPhrases: string[];
  blocklist: string[];
  dbPath: string;
};

const REQUIRED = ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'WEBHOOK_TOKEN', 'NIM_API_KEY'] as const;

const portSchema = z.coerce.number().int().min(1).max(65535);

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  }

  const port = portSchema.safeParse(env.PORT?.trim() || '3100');
  if (!port.success) {
    throw new ConfigError('PORT inválida: use um número entre 1 e 65535');
  }

  return {
    port: port.data,
    evolutionUrl: env.EVOLUTION_URL!.trim(),
    evolutionApiKey: env.EVOLUTION_API_KEY!.trim(),
    instance: env.EVOLUTION_INSTANCE?.trim() || 'tarot',
    webhookToken: env.WEBHOOK_TOKEN!.trim(),
    nimApiKey: env.NIM_API_KEY!.trim(),
    nimBaseUrl: env.NIM_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
    nimModel: env.NIM_MODEL?.trim() || 'google/gemma-4-31b-it',
    triggerPhrases: csv(env.TRIGGER_PHRASES),
    blocklist: csv(env.BLOCKLIST),
    dbPath: env.DB_PATH?.trim() || './data/atendimento.db',
  };
}
