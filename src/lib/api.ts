import type {
  AnalyzeRequest,
  AnalyzeResponse,
  HealthResponse,
  StreamEvent,
} from "../../shared/types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return jsonOrThrow<HealthResponse>(await fetch("/api/health"));
}

export async function analyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
  return jsonOrThrow<AnalyzeResponse>(
    await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Análise com progresso em NDJSON: cada evento deixa a coluna temporária a
 * encher linha a linha enquanto o servidor dispara o Jev em paralelo.
 */
export async function analyzeStream(
  body: AnalyzeRequest,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch("/api/analyze/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Falha ao contactar o servidor (HTTP ${res.status}).`);
  }
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
