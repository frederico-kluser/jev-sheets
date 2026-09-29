import type { ICellRendererParams } from "ag-grid-community";
import type { RowAnalysis, SheetRow } from "../../shared/types";

/**
 * Célula do veredito na coluna temporária: SIM/NÃO + o detalhe da decisão do
 * Jev SEMPRE visível (p(aderente), banda de ação e fonte), não só em hover —
 * transparência da IA acessível a teclado e touch.
 */
export function VerdictCell(params: ICellRendererParams<SheetRow>) {
  const meta = (params.data?.__ai_meta ?? null) as RowAnalysis | null;
  if (!meta || !meta.verdict) {
    return <span className="ai-empty" aria-label="sem análise" />;
  }
  const cls = meta.verdict === "SIM" ? "ai-sim" : meta.verdict === "NÃO" ? "ai-nao" : "ai-erro";
  const detail =
    meta.probability !== null
      ? `p ${meta.probability.toFixed(3)} · ${meta.band ?? "?"}${meta.source === "cache" ? " · cache" : ""}`
      : (meta.error ?? "").slice(0, 60);
  const title =
    meta.probability !== null
      ? `p(aderente) = ${meta.probability} · banda ${meta.band} · fonte ${meta.source}`
      : `erro: ${meta.error ?? "desconhecido"}`;
  return (
    <span className={`ai-verdict-chip ${cls}`} title={title}>
      <strong>{meta.verdict}</strong>
      <small className="ai-detail">{detail}</small>
    </span>
  );
}
