// Pipeline de análise do filtro de IA: linha → cache? → Jev em paralelo → SIM/NÃO.
//
// Garantias:
//  - MESMO prompt + MESMOS dados (nomes de colunas incluídos) → sai da cache,
//    zero chamadas à API;
//  - novas linhas → analisadas; prompt mudado → reanalisa tudo (chave muda);
//  - máximo de concorrência simultânea (pool com teto configurável);
//  - erro nunca é cacheado (pode ser repetido no envio seguinte).

import { decide } from "./jev/vendor/client.mjs";
import { rowCacheKey } from "./cache-key";
import type { CacheEntry, ResultCache } from "./cache";
import { mapPool } from "./pool";
import { buildValidatedRequest, mapResponseToDecision } from "./jev-request";
import {
  TEMP_COLUMN_ID,
  TEMP_COLUMN_NAME,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AnalyzeStats,
  type ColumnMeta,
  type RowAnalysis,
  type SheetRow,
  type StreamEvent,
} from "../shared/types";

export type DecideFn = typeof decide;

export interface AnalyzeDeps {
  cache: ResultCache;
  model: string;
  /** Teto de concorrência por omissão ("máximo simultâneo"). */
  concurrency: number;
  apiKey?: string | null;
  /** Injetável para testes offline; por omissão usa o cliente Jev real. */
  decideFn?: DecideFn;
  onEvent?: (event: StreamEvent) => void;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Valida e saneia o corpo do pedido; remove a coluna temporária da avaliação. */
export function sanitizeRequest(body: AnalyzeRequest): {
  prompt: string;
  columns: ColumnMeta[];
  rows: SheetRow[];
} {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("O prompt (afirmação/pergunta) está vazio.");
  if (prompt.length > 4000) throw new Error("O prompt excede 4000 caracteres.");

  const columns = (Array.isArray(body?.columns) ? body.columns : [])
    .filter((c) => c && typeof c.key === "string" && typeof c.name === "string")
    .filter((c) => c.key !== TEMP_COLUMN_ID)
    .map((c) => ({ key: c.key, name: c.name }));
  if (columns.length === 0) throw new Error("Sem colunas de dados para avaliar.");

  const rows = (Array.isArray(body?.rows) ? body.rows : []).filter(
    (r) => r && typeof r === "object" && typeof r.id === "string",
  );
  if (rows.length === 0) throw new Error("Sem linhas para avaliar.");
  if (rows.length > 5000) throw new Error("Máximo de 5000 linhas por envio.");

  return { prompt, columns, rows };
}

export async function analyzeRows(body: AnalyzeRequest, deps: AnalyzeDeps): Promise<AnalyzeResponse> {
  const started = Date.now();
  const { prompt, columns, rows } = sanitizeRequest(body);
  const emit = deps.onEvent ?? (() => {});
  const concurrency = Math.max(1, Math.min(64, Math.floor(body.concurrency ?? deps.concurrency)));

  // Chave de cache por linha; duplicados idênticos partilham uma única análise.
  const keyByRowIndex = rows.map((row) => rowCacheKey({ model: deps.model, prompt, columns, row }));
  const uniqueKeys = [...new Set(keyByRowIndex)];
  const keyToRow = new Map<string, SheetRow>();
  rows.forEach((row, i) => {
    if (!keyToRow.has(keyByRowIndex[i])) keyToRow.set(keyByRowIndex[i], row);
  });

  // 1) cache: mesmo prompt + mesmo dado → resposta imediata, sem API.
  const cachedByKey = new Map<string, RowAnalysis>();
  const toAnalyze: string[] = [];
  for (const key of uniqueKeys) {
    const entry = deps.cache.get(key);
    if (entry) {
      cachedByKey.set(key, {
        rowId: "",
        verdict: entry.verdict,
        probability: entry.probability,
        band: entry.band,
        source: "cache",
      });
    } else {
      toAnalyze.push(key);
    }
  }

  const rowCountWithCache = keyByRowIndex.filter((k) => cachedByKey.has(k)).length;
  emit({
    type: "start",
    total: rows.length,
    cacheHits: rowCountWithCache,
    toAnalyze: rows.length - rowCountWithCache,
    concurrency,
  });
  for (const [key, analysis] of cachedByKey) {
    emit({ type: "result", result: { ...analysis, rowId: keyToRow.get(key)?.id ?? "" } });
  }

  // 2) faltas: Jev em paralelo, máximo simultâneo.
  let costUsd = 0;
  let inputTokens = 0;
  let sawUsage = false;
  const decideFn: DecideFn = deps.decideFn ?? decide;

  const { results: apiResults, maxInFlight } = await mapPool(
    toAnalyze,
    async (key) => {
      const row = keyToRow.get(key)!;
      const t0 = Date.now();
      try {
        const { request } = buildValidatedRequest({ model: deps.model, prompt, columns, row });
        const { response, telemetry } = await decideFn(request, {
          apiKey: deps.apiKey ?? undefined,
          retries: 2,
          timeoutMs: 15_000,
        });
        const decision = mapResponseToDecision(request, response);
        if (typeof telemetry?.cost_usd === "number") {
          costUsd += telemetry.cost_usd;
          sawUsage = true;
        }
        if (typeof telemetry?.input_tokens === "number") inputTokens += telemetry.input_tokens;
        const analysis: RowAnalysis = {
          rowId: row.id,
          verdict: decision.verdict,
          probability: decision.probability,
          band: decision.band,
          source: "api",
          latencyMs: telemetry?.latency_ms ?? Date.now() - t0,
        };
        emit({ type: "result", result: analysis });
        return analysis;
      } catch (err) {
        const analysis: RowAnalysis = {
          rowId: row.id,
          verdict: "ERRO",
          probability: null,
          band: null,
          source: "erro",
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        };
        emit({ type: "result", result: analysis });
        return analysis;
      }
    },
    concurrency,
  );

  const apiByKey = new Map<string, RowAnalysis>();
  toAnalyze.forEach((key, i) => apiByKey.set(key, apiResults[i]));

  // 3) cacheia só o que foi decisão válida (ERRO nunca entra).
  const entries: Array<[string, CacheEntry]> = [];
  for (const key of toAnalyze) {
    const a = apiByKey.get(key);
    if (a && a.source === "api" && a.probability !== null && a.verdict !== "ERRO") {
      entries.push([
        key,
        {
          verdict: a.verdict as CacheEntry["verdict"],
          probability: a.probability,
          band: a.band,
          model: deps.model,
          createdAt: new Date().toISOString(),
          latencyMs: a.latencyMs,
        },
      ]);
    }
  }
  if (entries.length > 0) deps.cache.setMany(entries);

  // 4) devolve os resultados pela ordem original das linhas (duplicados repetem).
  const finalByKey = new Map<string, RowAnalysis>();
  for (const [k, v] of cachedByKey) finalByKey.set(k, v);
  for (const [k, v] of apiByKey) finalByKey.set(k, v);

  const results: RowAnalysis[] = rows.map((row, i) => {
    const base = finalByKey.get(keyByRowIndex[i]);
    return { ...(base ?? { rowId: row.id, verdict: "ERRO" as const, probability: null, band: null, source: "erro" as const, error: "sem resultado" }), rowId: row.id };
  });

  const stats: AnalyzeStats = {
    total: rows.length,
    cacheHits: rowCountWithCache,
    analyzed: results.filter((r) => r.source === "api").length,
    errors: results.filter((r) => r.source === "erro").length,
    durationMs: Date.now() - started,
    costUsd: sawUsage ? round6(costUsd) : null,
    inputTokens: sawUsage ? inputTokens : null,
    concurrency,
    maxInFlight,
  };
  emit({ type: "done", stats, results });
  return { column: { id: TEMP_COLUMN_ID, name: TEMP_COLUMN_NAME }, results, stats };
}
