// Ritmo humano nas respostas: atraso de digitação e limite de mensagens por minuto.

const MIN_DELAY_MS = 700;
const BASE_DELAY_MS = 900;
const PER_CHAR_MS = 38;
const MAX_DELAY_MS = 9000;
const PASTED_CODE_MIN_LENGTH = 40;

// Código colado (ex.: Pix copia e cola): longo e sem espaços. Ninguém "digita" isso, só cola.
function looksLikePastedCode(text: string): boolean {
  return text.length >= PASTED_CODE_MIN_LENGTH && !/\s/.test(text);
}

/** Atraso (ms) antes de enviar `text`, como se uma pessoa estivesse digitando. Varia ±20% com o rng. */
export function typingDelayMs(text: string, rng: () => number = Math.random): number {
  if (looksLikePastedCode(text)) return Math.round(700 + 300 * rng());
  const base = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, BASE_DELAY_MS + PER_CHAR_MS * text.length));
  return Math.round(base * (0.8 + 0.4 * rng()));
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
