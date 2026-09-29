// Construção da requisição Jev para UMA linha + mapeamento da resposta.
//
// Usamos a lib testada da skill jev-agent-skill (vendor, ver PROVENANCE.md):
// `validateRequest` valida offline o pedido (schema + conceitos + orçamento de
// tokens) antes de gastar tokens, e `validateResponse` extrai a decisão com a
// banda de ação calibrada.

import { validateRequest, validateResponse, DEFAULT_THRESHOLDS } from "./jev/vendor/validate.mjs";
import { TEMP_COLUMN_ID } from "../shared/types";
import type { ActionBand, ColumnMeta, SheetRow, Verdict } from "../shared/types";

export const QUESTION_ID = "aderente";

export interface JevQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface JevDecisionRequest {
  model: string;
  state: { row: Record<string, string> };
  questions: Record<string, JevQuestion>;
}

export interface BuildOptions {
  model: string;
  prompt: string;
  columns: Array<Pick<ColumnMeta, "key" | "name">>;
  row: SheetRow;
  /** Teto de caracteres por valor de célula (o state tem limite de tokens). */
  maxValueChars?: number;
}

export interface MappedDecision {
  verdict: Verdict;
  probability: number;
  band: ActionBand;
}

const ELLIPSIS = " [...]";

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, Math.max(0, max - ELLIPSIS.length)) + ELLIPSIS;
}

/**
 * Instruções em inglês de propósito: a documentação da TypeSafe indica que a
 * precisão do Jev é maior em inglês (regra #10 da skill). A afirmação/pergunta
 * do utilizador entra literalmente, delimitada, tratada como dado a decidir.
 */
function buildInstructions(prompt: string): string {
  return [
    "You are the AI filter of a spreadsheet tool. Decide whether the data row given in the state is ADHERENT to the assertion/question stated by the user below.",
    "",
    "User's assertion/question (decide against it literally):",
    '"""',
    prompt,
    '"""',
    "",
    'The state field "row" holds exactly ONE spreadsheet row: each key is a COLUMN NAME and each value is that column\'s cell value. Consider EVERY column name and EVERY value.',
  ].join("\n");
}

/**
 * Constrói o pedido Jev para uma linha. TODOS os nomes de colunas e TODOS os
 * valores entram no `state` (um por um). Valores longos são truncados para o
 * pedido caber no orçamento de tokens; se ainda assim transbordar, encolhe-se
 * o teto até caber (600 → 200 → 80 caracteres) ou lança erro explícito.
 */
export function buildValidatedRequest(opts: BuildOptions): {
  request: JevDecisionRequest;
  report: ReturnType<typeof validateRequest>;
} {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("O prompt (afirmação/pergunta) está vazio.");
  // Invariante do produto: a coluna temporária NUNCA é avaliada pela IA.
  const columns = opts.columns.filter((c) => c.key !== TEMP_COLUMN_ID);
  if (columns.length === 0) throw new Error("A linha não tem colunas para avaliar.");

  const attempts = opts.maxValueChars ? [opts.maxValueChars] : [600, 200, 80];
  let lastReport: ReturnType<typeof validateRequest> | null = null;

  for (const maxChars of attempts) {
    // Chaves do state = NOMES das colunas (deduplicadas), valores = células.
    const row: Record<string, string> = {};
    const used = new Set<string>();
    for (const col of columns) {
      let name = col.name.trim() || col.key;
      if (used.has(name)) {
        let n = 2;
        while (used.has(`${name} (${n})`)) n++;
        name = `${name} (${n})`;
      }
      used.add(name);
      row[name] = truncate(String(opts.row[col.key] ?? ""), maxChars);
    }

    const request: JevDecisionRequest = {
      model: opts.model,
      state: { row },
      questions: {
        [QUESTION_ID]: {
          type: "noul",
          instructions: buildInstructions(prompt),
          criteria: {
            true: "The row matches, or is consistent with, the user's assertion/question when considering all column names and all values.",
            false: "The row does not match the user's assertion/question (including rows with missing, contradictory or irrelevant data).",
          },
        },
      },
    };

    const report = validateRequest(request);
    lastReport = report;
    if (report.ok) return { request, report };

    const onlyBudget = report.errors.every((e) => e.code.startsWith("budget."));
    if (!onlyBudget) {
      throw new Error(
        `Requisição Jev inválida: ${report.errors.map((e) => `${e.code} (${e.message})`).join("; ")}`,
      );
    }
    // Só transbordou de orçamento → tenta de novo com valores mais curtos.
  }

  throw new Error(
    `Linha demasiado grande para o orçamento do Jev mesmo com truncagem: ${
      lastReport ? lastReport.errors.map((e) => e.message).join("; ") : "sem relatório"
    }`,
  );
}

export interface VerboseAnswer {
  noul: number;
  type: string;
}

/** Converte `answers.aderente` (noul p) em SIM/NÃO + banda de ação. */
export function mapAnswerToDecision(p: number, band: ActionBand): MappedDecision {
  return {
    verdict: p >= 0.5 ? "SIM" : "NÃO",
    probability: Math.round(p * 1e3) / 1e3,
    band,
  };
}

/**
 * Valida a resposta do Jev contra o pedido e extrai o veredito da linha.
 * Lança erro se a resposta não for coerente (nunca "adivinha" um valor).
 */
export function mapResponseToDecision(
  request: JevDecisionRequest,
  response: unknown,
  thresholds: { auto: number; hitl: number } = DEFAULT_THRESHOLDS,
): MappedDecision {
  const rv = validateResponse(request, response, thresholds as typeof DEFAULT_THRESHOLDS);
  // A lib vendorizada é JS puro: `decisions` é preenchido dinamicamente.
  const decisions = rv.decisions as Record<string, { value: number | string; band: string }>;
  const decision = decisions[QUESTION_ID];
  if (!rv.ok || !decision) {
    throw new Error(
      `Resposta Jev inválida: ${rv.errors.map((e) => `${e.code} (${e.message})`).join("; ") || "sem decisão"}`,
    );
  }
  const p = Number(decision.value);
  if (!Number.isFinite(p)) throw new Error(`Resposta Jev sem probabilidade válida: ${String(decision.value)}`);
  return mapAnswerToDecision(p, decision.band as ActionBand);
}
