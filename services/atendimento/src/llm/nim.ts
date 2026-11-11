export type LlmResult =
  | { kind: 'ok'; text: string }
  | { kind: 'blocked' }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

export type LlmClient = {
  complete(input: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<LlmResult>;
};

export type NimClientOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const MAX_TOKENS = 400;
const TEMPERATURE = 0.3;
const HTTP_CONTENT_FILTERED = 422;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;

const BLOCKED: LlmResult = { kind: 'blocked' };
const TIMEOUT: LlmResult = { kind: 'timeout' };
const UNAVAILABLE: LlmResult = { kind: 'unavailable' };

function extractContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
  const content = message?.content;
  if (typeof content !== 'string') return null;
  return content.trim() === '' ? null : content;
}

async function readResponse(response: Response): Promise<LlmResult> {
  if (response.status === HTTP_CONTENT_FILTERED) return BLOCKED;
  if (response.status === HTTP_NOT_FOUND || response.status === HTTP_GONE) return UNAVAILABLE;
  if (!response.ok) return UNAVAILABLE;
  const payload: unknown = await response.json();
  const text = extractContent(payload);
  return text === null ? UNAVAILABLE : { kind: 'ok', text };
}

const rejectsTemperature = (model: string): boolean => /(^|\/)claude/i.test(model);

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
            max_tokens: MAX_TOKENS,
            // Os modelos Claude recentes recusam `temperature` (HTTP 400): nesses, o parâmetro é omitido.
            ...(rejectsTemperature(opts.model) ? {} : { temperature: TEMPERATURE }),
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
