import type { AnalyzeStats } from "../../shared/types";

export interface Banner {
  kind: "error" | "info";
  message: string;
}

interface AiFilterBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onClear: () => void;
  running: boolean;
  progress: { done: number; total: number } | null;
  stats: AnalyzeStats | null;
  banner: Banner | null;
}

function StatsChips({ stats }: { stats: AnalyzeStats }) {
  const chips: Array<{ key: string; text: string; tone?: "warn" }> = [
    { key: "total", text: `${stats.total} linhas` },
    { key: "cache", text: `${stats.cacheHits} da cache` },
    { key: "analyzed", text: `${stats.analyzed} analisadas` },
  ];
  if (stats.errors > 0) {
    chips.push({ key: "errors", text: `${stats.errors} erros`, tone: "warn" });
  }
  chips.push({ key: "time", text: `${(stats.durationMs / 1000).toFixed(1)} s` });
  if (stats.costUsd !== null) chips.push({ key: "cost", text: `US$ ${stats.costUsd.toFixed(5)}` });
  chips.push({
    key: "par",
    text: `pico de ${stats.maxInFlight} em paralelo (teto ${stats.concurrency})`,
  });
  return (
    <ul className="stats-chips" aria-label="Estatísticas do último envio">
      {chips.map((c) => (
        <li key={c.key} className={c.tone === "warn" ? "chip chip-warn" : "chip"}>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

export function AiFilterBar({
  prompt,
  onPromptChange,
  onRun,
  onCancel,
  onClear,
  running,
  progress,
  stats,
  banner,
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
        aria-describedby="ai-prompt-help"
        placeholder="Ex.: A empresa demonstra risco de churn (insatisfação, cancelamento ou queda de uso)?"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={running}
      />
      <p id="ai-prompt-help" className="filter-help">
        Cada envio analisa só as linhas novas ou alteradas; o resto vem da cache. Os vereditos
        SIM/NÃO aparecem na coluna temporária. O Jev decide melhor em inglês; o corte é p ≥ 0.5,
        por isso valide com dados seus antes de confiar em decisões fronteiriças.
      </p>
      <div className="filter-actions">
        {running ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Parar
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRun}
            disabled={prompt.trim() === ""}
          >
            Enviar análise
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClear} disabled={running}>
          Limpar coluna
        </button>
        {running && progress ? (
          <span className="progress" role="status">
            {progress.done} de {progress.total} linhas concluídas
          </span>
        ) : null}
      </div>
      {banner ? (
        <p className={banner.kind === "error" ? "error-banner" : "info-banner"} role="alert">
          {banner.message}
        </p>
      ) : null}
      {stats && !running ? <StatsChips stats={stats} /> : null}
    </section>
  );
}
