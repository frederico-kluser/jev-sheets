import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiFilterBar } from "./components/AiFilterBar";
import { SheetGrid } from "./components/SheetGrid";
import { analyzeStream, clearServerCache, fetchHealth } from "./lib/api";
import { SAMPLE_COLUMNS, SAMPLE_ROWS, dataColumns } from "../shared/sample-data";
import { TEMP_COLUMN_ID } from "../shared/types";
import type { AnalyzeStats, HealthResponse, RowAnalysis, SheetRow } from "../shared/types";

const initialRows = (): SheetRow[] => SAMPLE_ROWS.map((r) => ({ ...r, [TEMP_COLUMN_ID]: "" }));

export default function App() {
  const [rows, setRows] = useState<SheetRow[]>(initialRows);
  const [results, setResults] = useState<Map<string, RowAnalysis>>(new Map());
  const [prompt, setPrompt] = useState("A empresa demonstra risco de churn (insatisfação, cancelamento ou queda de uso)?");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stats, setStats] = useState<AnalyzeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const refreshHealth = useCallback(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(refreshHealth, [refreshHealth]);

  const verdictCount = useMemo(() => {
    let sim = 0;
    let nao = 0;
    for (const r of results.values()) {
      if (r.verdict === "SIM") sim++;
      else if (r.verdict === "NÃO") nao++;
    }
    return { sim, nao };
  }, [results]);

  const applyResult = useCallback((result: RowAnalysis) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(result.rowId, result);
      return next;
    });
    setRows((prev) =>
      prev.map((r) => (r.id === result.rowId ? { ...r, [TEMP_COLUMN_ID]: result.verdict } : r)),
    );
  }, []);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setError(null);
    setStats(null);
    setResults(new Map());
    setRows(initialRows());
    try {
      await analyzeStream(
        {
          prompt,
          columns: dataColumns(),
          rows: rowsRef.current.map((r) => ({ ...r })),
          concurrency: undefined,
        },
        (event) => {
          if (event.type === "start") {
            setProgress({ done: 0, total: event.total });
          } else if (event.type === "result") {
            applyResult(event.result);
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          } else if (event.type === "done") {
            setStats(event.stats);
          } else if (event.type === "error") {
            setError(event.message);
          }
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setProgress(null);
      refreshHealth();
    }
  }, [prompt, applyResult, refreshHealth]);

  const clearColumn = useCallback(() => {
    setResults(new Map());
    setRows((prev) => prev.map((r) => ({ ...r, [TEMP_COLUMN_ID]: "" })));
  }, []);

  const onCellEdit = useCallback((rowId: string, key: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [key]: value, [TEMP_COLUMN_ID]: "" } : r)),
    );
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(rowId);
      return next;
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>jev-sheets</h1>
          <p className="subtitle">
            Planilha completa com filtro de IA: cada linha é decidida pelo Jev (System One, via
            OpenRouter) e marcada SIM ou NÃO.
          </p>
        </div>
        <dl className="health-chips">
          <div>
            <dt>Modelo</dt>
            <dd>{health?.model ?? "..."}</dd>
          </div>
          <div>
            <dt>Chave</dt>
            <dd className={health?.keyConfigured ? "chip-ok" : "chip-bad"}>
              {health ? (health.keyConfigured ? "configurada" : "em falta") : "..."}
            </dd>
          </div>
          <div>
            <dt>Cache</dt>
            <dd>{health ? `${health.cacheEntries} entradas` : "..."}</dd>
          </div>
          <div>
            <dt>Concorrência</dt>
            <dd>{health?.concurrencyDefault ?? "..."} máx.</dd>
          </div>
        </dl>
      </header>

      <AiFilterBar
        prompt={prompt}
        onPromptChange={setPrompt}
        onRun={runAnalysis}
        onClear={clearColumn}
        running={running}
        progress={progress}
        stats={stats}
        error={error}
      />

      <section className="grid-section" aria-label="Planilha">
        <div className="grid-toolbar">
          <span className="verdict-counts">
            {verdictCount.sim} SIM, {verdictCount.nao} NÃO na coluna temporária
          </span>
          <div className="grid-toolbar-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                void clearServerCache().then(refreshHealth);
              }}
            >
              Limpar cache do servidor
            </button>
          </div>
        </div>
        <SheetGrid
          columns={SAMPLE_COLUMNS}
          rows={rows}
          results={results}
          onCellEdit={onCellEdit}
        />
      </section>
    </div>
  );
}
