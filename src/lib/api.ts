import type {
  AnalyzeRequest,
  AnalyzeResponse,
  HealthResponse,
  StreamEvent,
} from "../../shared/types";

/** Erro com mensagem pronta para mostrar ao utilizador (nunca um 502 nu). */
export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE_MESSAGE =
  "O servidor da API não está a responder. Com `npm run dev` sobe UI + API juntos; " +
  "se estiver a correr só a UI (`npm run dev:web`), inicie também `npm run dev:api`.";

function friendlyError(status: number, bodyError?: string): ApiError {
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError(OFFLINE_MESSAGE, status);
  }
  return new ApiError(bodyError || `Falha ao contactar o servidor (HTTP ${status}).`, status);
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let bodyError: string | undefined;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) bodyError = body.error;
    } catch {
      /* corpo não-JSON */
    }
    throw friendlyError(res.status, bodyError);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  try {
    return await jsonOrThrow<HealthResponse>(await fetch("/api/health"));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(OFFLINE_MESSAGE);
  }
}

export async function analyze(body: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
  try {
    return await jsonOrThrow<AnalyzeResponse>(
      await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    );
  } catch (err) {
    if (err instanceof ApiError || err instanceof DOMException) throw err;
    throw new ApiError(OFFLINE_MESSAGE);
  }
}

/**
 * Análise com progresso em NDJSON: cada evento deixa a coluna temporária a
 * encher linha a linha enquanto o servidor dispara o Jev em paralelo.
 * `signal` permite cancelar (os resultados parciais já emitidos são mantidos).
 */
export async function analyzeStream(
  body: AnalyzeRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/analyze/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(OFFLINE_MESSAGE);
  }
  if (!res.ok) throw friendlyError(res.status);
  if (!res.body) throw new ApiError(OFFLINE_MESSAGE, res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as StreamEvent);
    }
  }
  const tail = buffer.trim();
  if (tail) onEvent(JSON.parse(tail) as StreamEvent);
}

export async function clearServerCache(): Promise<void> {
  await jsonOrThrow(await fetch("/api/cache/clear", { method: "POST" }));
}
