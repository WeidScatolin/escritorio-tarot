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
  /** Teto de mensagens enviadas por minuto, por conversa e no total (ritmo humano e proteção do número). */
  maxMsgsPerMinuteChat: number;
  maxMsgsPerMinute: number;
  /** Segundos "lendo e pensando" antes de começar a responder (0 desliga). */
  replyThinkSeconds: number;
  /** Segundos de silêncio do cliente antes de a IA responder; as mensagens do intervalo são juntas (0 desliga). */
  messageDebounceSeconds: number;
  /** Milissegundos de "digitação" por caractere da resposta. */
  typingMsPerChar: number;
  /** Leitura do gasto em anúncios pela Meta (somente leitura). null = desligado. */
  meta: MetaConfig | null;
  /** De quantos em quantos minutos o gasto é atualizado. */
  adSpendPollMinutes: number;
  /** Envio do resumo do painel para a Vercel. null = desligado. */
  publish: PublishConfig | null;
};

export type PublishConfig = { url: string; secret: string; intervalSeconds: number };

export type MetaConfig = { adAccountId: string; accessToken: string; apiVersion: string; spendSince: string };

const REQUIRED = ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'WEBHOOK_TOKEN', 'NIM_API_KEY'] as const;

const portSchema = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

function readPositiveInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = positiveInt.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`${name} inválida: use um número inteiro maior que zero`);
  return parsed.data;
}

function readNonNegativeInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = nonNegativeInt.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`${name} inválida: use um número inteiro (0 ou mais)`);
  return parsed.data;
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// Tudo ou nada: ligar a Meta exige conta, token e data de início. As mensagens de erro nunca citam o token.
function readMeta(env: Record<string, string | undefined>): MetaConfig | null {
  const account = env.META_AD_ACCOUNT_ID?.trim() ?? '';
  const token = env.META_ACCESS_TOKEN?.trim() ?? '';
  const since = env.META_SPEND_SINCE?.trim() ?? '';
  if (!account && !token && !since) return null;

  const missing = [
    ['META_AD_ACCOUNT_ID', account],
    ['META_ACCESS_TOKEN', token],
    ['META_SPEND_SINCE', since],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new ConfigError(`Meta parcialmente configurada: faltam ${missing.join(', ')}`);

  const accountId = account.replace(/^act_/i, '');
  if (!/^\d+$/.test(accountId)) throw new ConfigError('META_AD_ACCOUNT_ID inválida: use só os números da conta (com ou sem "act_")');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new ConfigError('META_SPEND_SINCE inválida: use o formato AAAA-MM-DD');
  const apiVersion = env.META_API_VERSION?.trim() || 'v25.0';
  if (!/^v\d+\.\d+$/.test(apiVersion)) throw new ConfigError('META_API_VERSION inválida: use algo como v25.0');
  return { adAccountId: accountId, accessToken: token, apiVersion, spendSince: since };
}

// Tudo ou nada: URL e segredo. A URL tem de ser https (o segredo viaja no cabeçalho).
function readPublish(env: Record<string, string | undefined>): PublishConfig | null {
  const url = env.PUBLISH_URL?.trim() ?? '';
  const secret = env.PUBLISH_SECRET?.trim() ?? '';
  if (!url && !secret) return null;
  const missing = [
    ['PUBLISH_URL', url],
    ['PUBLISH_SECRET', secret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new ConfigError(`Publicação na Vercel parcialmente configurada: faltam ${missing.join(', ')}`);
  if (!url.startsWith('https://')) throw new ConfigError('PUBLISH_URL inválida: use um endereço https://');
  return { url, secret, intervalSeconds: readPositiveInt(env, 'PUBLISH_INTERVAL_SECONDS', 60) };
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
    maxMsgsPerMinuteChat: readPositiveInt(env, 'MAX_MSGS_PER_MIN_CHAT', 6),
    maxMsgsPerMinute: readPositiveInt(env, 'MAX_MSGS_PER_MIN', 20),
    replyThinkSeconds: readNonNegativeInt(env, 'REPLY_THINK_SECONDS', 14),
    messageDebounceSeconds: readNonNegativeInt(env, 'MESSAGE_DEBOUNCE_SECONDS', 8),
    typingMsPerChar: readPositiveInt(env, 'TYPING_MS_PER_CHAR', 90),
    meta: readMeta(env),
    adSpendPollMinutes: readPositiveInt(env, 'AD_SPEND_POLL_MINUTES', 10),
    publish: readPublish(env),
  };
}
