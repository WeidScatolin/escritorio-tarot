// Ritmo humano nas respostas: atraso de digitação e limite de mensagens por minuto.

const MIN_DELAY_MS = 1500;
const BASE_DELAY_MS = 1500;
const DEFAULT_PER_CHAR_MS = 90;
const MAX_DELAY_MS = 20_000;
const PASTED_CODE_MIN_LENGTH = 40;

// Código colado (ex.: Pix copia e cola): longo e sem espaços. Ninguém "digita" isso, só cola.
function looksLikePastedCode(text: string): boolean {
  return text.length >= PASTED_CODE_MIN_LENGTH && !/\s/.test(text);
}

/**
 * Atraso (ms) "digitando" antes de enviar `text`: ~1,5 s + perCharMs por caractere (teto de 20 s),
 * variando ±20% com o rng. Código colado (ex.: Pix copia e cola) sai quase na hora.
 */
export function typingDelayMs(
  text: string,
  rng: () => number = Math.random,
  opts: { perCharMs?: number } = {},
): number {
  if (looksLikePastedCode(text)) return Math.round(700 + 300 * rng());
  const perChar = opts.perCharMs ?? DEFAULT_PER_CHAR_MS;
  const base = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, BASE_DELAY_MS + perChar * text.length));
  return Math.round(base * (0.8 + 0.4 * rng()));
}

/** Tempo (ms) "lendo e pensando" antes de começar a responder: 60% a 140% do configurado. 0 = sem espera. */
export function thinkDelayMs(seconds: number, rng: () => number = Math.random): number {
  if (seconds <= 0) return 0;
  return Math.round(seconds * 1000 * (0.6 + 0.8 * rng()));
}

export type RateLimiterOptions = {
  perChat: number;
  global: number;
  windowMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type RateLimiter = {
  /** Espera, se preciso, até haver vaga na janela (por conversa e no total) e então reserva a vaga. */
  acquire(jid: string): Promise<void>;
};

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const perChat = new Map<string, number[]>();
  const all: number[] = [];
  // Serializa as reservas: duas conversas não furam o limite global ao mesmo tempo.
  let tail: Promise<void> = Promise.resolve();

  const prune = (list: number[], cutoff: number): void => {
    while (list.length > 0 && list[0]! <= cutoff) list.shift();
  };

  async function reserve(jid: string): Promise<void> {
    const now = opts.now();
    const chat = perChat.get(jid) ?? [];
    prune(chat, now - opts.windowMs);
    prune(all, now - opts.windowMs);

    let releaseAt = now;
    if (chat.length >= opts.perChat) releaseAt = Math.max(releaseAt, chat[chat.length - opts.perChat]! + opts.windowMs);
    if (all.length >= opts.global) releaseAt = Math.max(releaseAt, all[all.length - opts.global]! + opts.windowMs);

    const wait = releaseAt - now;
    if (wait > 0) await opts.sleep(wait);

    chat.push(releaseAt);
    all.push(releaseAt);
    perChat.set(jid, chat);
  }

  return {
    acquire(jid) {
      const run = tail.then(() => reserve(jid));
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
