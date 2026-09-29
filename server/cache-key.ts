import { createHash } from "node:crypto";
import type { ColumnMeta, SheetRow } from "../shared/types";

/**
 * Identidade de cache de uma avaliação: MESMO prompt + MESMOS dados → mesma
 * chave → resultado reaproveitado sem tocar na API.
 *
 * A chave considera explicitamente os NOMES das colunas e TODOS os valores da
 * linha (regra do produto: a avaliação é individual e usa todas as colunas),
 * além do modelo Jev usado. Mudar qualquer um destes elementos invalida a
 * entrada; mudar só espaços em branco do prompt não invalida (normalização).
 */
export interface CacheKeyInput {
  model: string;
  prompt: string;
  columns: Array<Pick<ColumnMeta, "key" | "name">>;
  row: SheetRow;
}

/** Normalização leve: espaços consecutivos e pontas não mudam o significado. */
export function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

export function rowCacheKey({ model, prompt, columns, row }: CacheKeyInput): string {
  const payload = {
    v: 1,
    model,
    prompt: normalizePrompt(prompt),
    // Nome + chave de cada coluna, na ordem da planilha.
    columns: columns.map((c) => [c.key, c.name]),
    // Todos os valores da linha, pela mesma ordem.
    values: columns.map((c) => String(row[c.key] ?? "")),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
