import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiFilterBar, type Banner } from "./components/AiFilterBar";
import { SheetGrid } from "./components/SheetGrid";
import { analyzeStream, clearServerCache, fetchHealth } from "./lib/api";
import { SAMPLE_COLUMNS, SAMPLE_ROWS, dataColumns } from "../shared/sample-data";
import { TEMP_COLUMN_ID } from "../shared/types";
import type { AnalyzeStats, HealthResponse, RowAnalysis, SheetRow } from "../shared/types";

const initialRows = (): SheetRow[] =>
  SAMPLE_ROWS.map((r) => ({ ...r, [TEMP_COLUMN_ID]: "", __ai_meta: undefined }));

interface UndoSnapshot {
  rows: SheetRow[];
  results: Map<string, RowAnalysis>;
}

export default function App() {
  const [rows, setRows] = useState<SheetRow[]>(initialRows);
  const [results, setResults] = useState<Map<string, RowAnalysis>>(new Map());
  const [prompt, setPrompt] = useState(
    "A empresa demonstra risco de churn (insatisfação, cancelamento ou queda de uso)?",
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stats, setStats] = useState<AnalyzeStats | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthOffline, setHealthOffline] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [cacheConfirm, setCacheConfirm] = useState(false);
  const rowsRef = useRef(rows);
  const abortRef = useRef<AbortController | null>(null);
  rowsRef.current = rows;

  const refreshHealth = useCallback(() => {
    fetchHealth()
      .then((h) => {
        setHealth(h);
        setHealthOffline(false);
      })
      .catch(() => {
        setHealth(null);
        setHealthOffline(true);
      });
  }, []);

  useEffect(refreshHealth, [refreshHealth]);

  // O toast de desfazer desaparece sozinho passados 6 s.
  useEffect(() => {
    if (!undoSnapshot) return;
    const timer = setTimeout(() => setUndoSnapshot(null), 6000);
    return () => clearTimeout(timer);
  }, [undoSnapshot]);

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
      prev.map((r) =>
        r.id === result.rowId
          ? { ...r, [TEMP_COLUMN_ID]: result.verdict, __ai_meta: result }
          : r,
      ),
    );
  }, []);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setBanner(null);
    setStats(null);
    setUndoSnapshot(null);
    setResults(new Map());
    // Limpa SÓ a coluna temporária. `initialRows()` aqui devolvia a grade aos
    // dados de exemplo a cada envio: a edição sumia da tela, mas a API recebia
    // a linha editada (via rowsRef) — o veredito novo aparecia ao lado do
    // texto VELHO.
    setRows((prev) => prev.map((r) => ({ ...r, [TEMP_COLUMN_ID]: "", __ai_meta: undefined })));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await analyzeStream(
        {
          prompt,
          columns: dataColumns(),
          rows: rowsRef.current.map((r) => ({ ...r })),
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
            setBanner({ kind: "error", message: event.message });
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setBanner({
          kind: "info",
          message: "Análise interrompida. Os resultados parciais foram mantidos na coluna.",
        });
      } else {
        setBanner({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
      refreshHealth();
    }
  }, [prompt, applyResult, refreshHealth]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearColumn = useCallback(() => {
    setUndoSnapshot({ rows, results: new Map(results) });
    setResults(new Map());
    setRows((prev) =>
      prev.map((r) => ({ ...r, [TEMP_COLUMN_ID]: "", __ai_meta: undefined })),
    );
  }, [rows, results]);

  const undoClear = useCallback(() => {
    setUndoSnapshot((snap) => {
      if (snap) {
        setRows(snap.rows);
        setResults(snap.results);
      }
      return null;
    });
  }, []);

  const onCellEdit = useCallback((rowId: string, key: string, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, [key]: value, [TEMP_COLUMN_ID]: "", __ai_meta: undefined }
          : r,
      ),
    );
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(rowId);
      return next;
    });
  }, []);

  const onClearServerCache = useCallback(() => {
    if (!cacheConfirm) {
      setCacheConfirm(true);
      setTimeout(() => setCacheConfirm(false), 4000);
      return;
    }
    setCacheConfirm(false);
    void clearServerCache().then(refreshHealth);
  }, [cacheConfirm, refreshHealth]);

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
            <dt>API</dt>
            <dd className={healthOffline ? "chip-bad" : "chip-ok"}>
              {healthOffline ? "offline" : health ? "ligada" : "..."}
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
        onCancel={cancelAnalysis}
        onClear={clearColumn}
        running={running}
        progress={progress}
        stats={stats}
        banner={banner}
      />

      <section className="grid-section" aria-label="Planilha">
        <div className="grid-toolbar">
          <span className="verdict-counts">
            {verdictCount.sim} SIM, {verdictCount.nao} NÃO na coluna temporária
          </span>
          <div className="grid-toolbar-actions">
            <button
              type="button"
              className={cacheConfirm ? "btn btn-danger-soft" : "btn btn-ghost"}
              onClick={onClearServerCache}
            >
              {cacheConfirm
                ? `Confirmar limpeza (${health?.cacheEntries ?? 0} entradas)?`
                : "Limpar cache do servidor"}
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

      {undoSnapshot ? (
        <div className="undo-toast" role="status">
          <span>Coluna temporária limpa.</span>
          <button type="button" className="btn btn-ghost" onClick={undoClear}>
            Desfazer
          </button>
        </div>
      ) : null}
    </div>
  );
}
