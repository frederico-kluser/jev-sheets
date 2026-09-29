// Tipos partilhados entre servidor (pipeline Jev) e frontend (AG Grid).

/** Valor de célula tratado como texto (a planilha PoC é textual). */
export type CellValue = string;

/**
 * Linha da planilha. `id` é estável e serve de chave de UI; o resto são colunas.
 * `__ai_meta` carrega o resultado Jev da linha para a célula da coluna temporária.
 */
export interface SheetRow {
  id: string;
  __ai_meta?: RowAnalysis;
  [key: string]: CellValue | RowAnalysis | undefined;
}

/** Metadado de coluna: `key` identifica o campo, `name` é o nome visível (avaliado pela IA). */
export interface ColumnMeta {
  key: string;
  name: string;
}

/** Coluna temporária do filtro IA: já existe no grid, mas fica sempre limpa até uma análise. */
export const TEMP_COLUMN_ID = "__ai_filter";
export const TEMP_COLUMN_NAME = "Filtro IA (temporário)";

export type Verdict = "SIM" | "NÃO";
export type ResultSource = "cache" | "api" | "erro";
export type ActionBand = "auto" | "hitl" | "abstain";

/** Resultado da avaliação Jev de UMA linha. */
export interface RowAnalysis {
  rowId: string;
  verdict: Verdict | "ERRO";
  /** P(linha adere à afirmação) em [0,1] — resposta `noul` do Jev. */
  probability: number | null;
  /** Banda de ação do Jev (auto ≥0.90 · hitl ≥0.50 · abstain <0.50 em certeza). */
  band: ActionBand | null;
  source: ResultSource;
  latencyMs?: number;
  error?: string;
}

export interface AnalyzeRequest {
  prompt: string;
  columns: ColumnMeta[];
  rows: SheetRow[];
  concurrency?: number;
}

export interface AnalyzeStats {
  total: number;
  cacheHits: number;
  analyzed: number;
  errors: number;
  durationMs: number;
  costUsd: number | null;
  inputTokens: number | null;
  concurrency: number;
  maxInFlight: number;
}

export interface AnalyzeResponse {
  column: { id: string; name: string };
  results: RowAnalysis[];
  stats: AnalyzeStats;
}

/** Eventos do endpoint NDJSON (/api/analyze/stream) — progresso linha a linha. */
export type StreamEvent =
  | { type: "start"; total: number; cacheHits: number; toAnalyze: number; concurrency: number }
  | { type: "result"; result: RowAnalysis }
  | { type: "done"; stats: AnalyzeStats; results: RowAnalysis[] }
  | { type: "error"; message: string };

export interface HealthResponse {
  ok: boolean;
  model: string;
  keyConfigured: boolean;
  cacheEntries: number;
  concurrencyDefault: number;
}
