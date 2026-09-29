import type { AnalyzeStats } from "../../shared/types";

interface AiFilterBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onClear: () => void;
  running: boolean;
  progress: { done: number; total: number } | null;
  stats: AnalyzeStats | null;
  error: string | null;
}

function StatsLine({ stats }: { stats: AnalyzeStats }) {
  const parts = [
    `${stats.total} linhas`,
    `${stats.cacheHits} da cache`,
    `${stats.analyzed} analisadas`,
  ];
  if (stats.errors > 0) parts.push(`${stats.errors} erros`);
  parts.push(`${(stats.durationMs / 1000).toFixed(1)} s`);
  if (stats.costUsd !== null) parts.push(`US$ ${stats.costUsd.toFixed(5)}`);
  parts.push(`pico de ${stats.maxInFlight} em paralelo (teto ${stats.concurrency})`);
  return <p className="stats-line">{parts.join(", ")}.</p>;
}

export function AiFilterBar({
  prompt,
  onPromptChange,
  onRun,
  onClear,
  running,
  progress,
  stats,
  error,
}: AiFilterBarProps) {
  return (
    <section className="filter-bar" aria-label="Filtro de IA">
      <label className="filter-label" htmlFor="ai-prompt">
        Afirmação ou pergunta para filtrar as linhas
      </label>
      <textarea
        id="ai-prompt"
        className="filter-input"
        rows={2}
        placeholder="Ex.: A empresa demonstra risco de churn (insatisfação, cancelamento ou queda de uso)?"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={running}
      />
      <div className="filter-actions">
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={running || prompt.trim() === ""}>
          {running ? "A analisar..." : "Enviar análise"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClear} disabled={running}>
          Limpar coluna
        </button>
        {running && progress ? (
          <span className="progress" role="status">
            {progress.done} de {progress.total} linhas concluídas
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {stats && !running ? <StatsLine stats={stats} /> : null}
    </section>
  );
}
