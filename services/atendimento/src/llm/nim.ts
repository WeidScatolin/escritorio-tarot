export type LlmResult =
  /** `truncated`: o modelo parou por bater no limite de tokens (o texto veio cortado). */
  | { kind: 'ok'; text: string; truncated?: true }
  | { kind: 'blocked' }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

export type LlmClient = {
  complete(input: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    /** Limite de tokens da resposta. Padrão: o da conversa (curta). A leitura das cartas pede mais. */
    maxTokens?: number;
  }): Promise<LlmResult>;
};

export type NimClientOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

// Limite padrão, pensado para a conversa. A leitura das cartas passa o próprio limite (maxTokens).
const MAX_TOKENS = 900;
const TEMPERATURE = 0.3;
const HTTP_CONTENT_FILTERED = 422;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;

const BLOCKED: LlmResult = { kind: 'blocked' };
const TIMEOUT: LlmResult = { kind: 'timeout' };
const UNAVAILABLE: LlmResult = { kind: 'unavailable' };

type Choice = { message?: { content?: unknown }; finish_reason?: unknown };

function firstChoice(payload: unknown): Choice | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  return (choices[0] as Choice | undefined) ?? null;
}

function extractContent(choice: Choice | null): string | null {
  const content = choice?.message?.content;
  if (typeof content !== 'string') return null;
  return content.trim() === '' ? null : content;
}

// "length" (padrão OpenAI) ou "max_tokens" (como alguns provedores repassam o motivo do Claude).
function wasTruncated(choice: Choice | null): boolean {
  return choice?.finish_reason === 'length' || choice?.finish_reason === 'max_tokens';
}

async function readResponse(response: Response): Promise<LlmResult> {
  if (response.status === HTTP_CONTENT_FILTERED) return BLOCKED;
  if (response.status === HTTP_NOT_FOUND || response.status === HTTP_GONE) return UNAVAILABLE;
  if (!response.ok) return UNAVAILABLE;
  const choice = firstChoice(await response.json());
  const text = extractContent(choice);
  if (text === null) return UNAVAILABLE;
  return wasTruncated(choice) ? { kind: 'ok', text, truncated: true } : { kind: 'ok', text };
}

// Claude recusa `temperature` (HTTP 400) e, com o raciocínio ligado, gasta o limite de tokens pensando e devolve
// conteúdo vazio: nesses modelos o raciocínio é desligado.
const isClaude = (model: string): boolean => /(^|\/)claude/i.test(model);

export function createNimClient(opts: NimClientOptions): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async complete(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const aborted = new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason));
        });
        const request = fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [{ role: 'system', content: input.system }, ...input.messages],
            max_tokens: input.maxTokens ?? MAX_TOKENS,
            // Os modelos Claude recentes recusam `temperature` (HTTP 400): nesses, o parâmetro é omitido.
            ...(isClaude(opts.model) ? { thinking: { type: 'disabled' } } : { temperature: TEMPERATURE }),
          }),
          signal: controller.signal,
        });
        // Garante o timeout mesmo se o fetch ignorar o sinal de abort.
        request.catch(() => undefined);
        const response = await Promise.race([request, aborted]);
        return await Promise.race([readResponse(response), aborted]);
      } catch {
        // Nunca propagar a causa: pode conter detalhes da requisicao (incluindo a chave).
        return controller.signal.aborted ? TIMEOUT : UNAVAILABLE;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
