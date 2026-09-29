import { describe, expect, it } from "vitest";
import {
  QUESTION_ID,
  buildValidatedRequest,
  mapAnswerToDecision,
  mapResponseToDecision,
} from "../../server/jev-request";
import { validateRequest } from "../../server/jev/vendor/validate.mjs";
import { TEMP_COLUMN_ID, TEMP_COLUMN_NAME } from "../../shared/types";

const columns = [
  { key: "empresa", name: "Empresa" },
  { key: "segmento", name: "Segmento" },
  { key: "valor_mensal", name: "Valor Mensal (R$)" },
];
const row = { id: "R1", empresa: "Marítima Norte", segmento: "Logística", valor_mensal: "4.310,75" };
const prompt = "A empresa demonstra risco de churn?";

describe("buildValidatedRequest", () => {
  it("inclui TODOS os nomes de colunas e TODOS os valores no state", () => {
    const { request } = buildValidatedRequest({ model: "typesafe/jev-1.13", prompt, columns, row });
    expect(Object.keys(request.state.row)).toEqual(["Empresa", "Segmento", "Valor Mensal (R$)"]);
    expect(request.state.row["Empresa"]).toBe("Marítima Norte");
    expect(request.state.row["Segmento"]).toBe("Logística");
    expect(request.state.row["Valor Mensal (R$)"]).toBe("4.310,75");
  });

  it("usa a primitiva noul com a afirmação do utilizador literal nas instruções", () => {
    const { request } = buildValidatedRequest({ model: "typesafe/jev-1.13", prompt, columns, row });
    const q = request.questions[QUESTION_ID];
    expect(q.type).toBe("noul");
    expect(q.instructions).toContain(prompt);
    expect(q.criteria.true).toBeTruthy();
    expect(q.criteria.false).toBeTruthy();
  });

  it("passa na validação offline da lib Jev (schema + conceitos + orçamento)", () => {
    const { request, report } = buildValidatedRequest({
      model: "typesafe/jev-1.13",
      prompt,
      columns,
      row,
    });
    expect(report.ok).toBe(true);
    expect(validateRequest(request).ok).toBe(true);
  });

  it("trunca valores muito longos para caber no orçamento de tokens", () => {
    const long = "x".repeat(5000);
    const { request } = buildValidatedRequest({
      model: "typesafe/jev-1.13",
      prompt,
      columns,
      row: { ...row, empresa: long },
      maxValueChars: 300,
    });
    expect(request.state.row["Empresa"].length).toBeLessThanOrEqual(300);
    expect(request.state.row["Empresa"]).toContain("[...]");
  });

  it("linha gigante (centenas de colunas) encolhe até caber, sem erro", () => {
    const manyCols = Array.from({ length: 300 }, (_, i) => ({ key: `c${i}`, name: `Coluna ${i}` }));
    const manyVals = Object.fromEntries(manyCols.map((c, i) => [c.key, `valor ${i} `.repeat(200)]));
    const { request, report } = buildValidatedRequest({
      model: "typesafe/jev-1.13",
      prompt,
      columns: manyCols,
      row: { id: "R2", ...manyVals },
    });
    expect(report.ok).toBe(true);
    expect(Object.keys(request.state.row)).toHaveLength(300);
    for (const v of Object.values(request.state.row)) {
      expect(v.length).toBeLessThanOrEqual(201);
    }
  });

  it("deduplica nomes de colunas repetidos em chaves únicas do state", () => {
    const dup = [
      { key: "a", name: "Total" },
      { key: "b", name: "Total" },
    ];
    const { request } = buildValidatedRequest({
      model: "typesafe/jev-1.13",
      prompt,
      columns: dup,
      row: { id: "R3", a: "10", b: "20" },
    });
    expect(request.state.row["Total"]).toBe("10");
    expect(request.state.row["Total (2)"]).toBe("20");
  });

  it("rejeita prompt vazio", () => {
    expect(() =>
      buildValidatedRequest({ model: "m", prompt: "   ", columns, row }),
    ).toThrow(/vazio/);
  });
});

describe("mapeamento de resposta para SIM/NÃO", () => {
  it("p ≥ 0.5 → SIM; p < 0.5 → NÃO", () => {
    expect(mapAnswerToDecision(0.72, "hitl")).toMatchObject({ verdict: "SIM", probability: 0.72 });
    expect(mapAnswerToDecision(0.31, "hitl")).toMatchObject({ verdict: "NÃO", probability: 0.31 });
    expect(mapAnswerToDecision(0.5, "hitl").verdict).toBe("SIM");
    expect(mapAnswerToDecision(0.499, "abstain").verdict).toBe("NÃO");
  });

  it("bandas vêm da lib Jev: 0.93 → auto, 0.72 → hitl (em noul a certeza ≥ 0.5 sempre)", () => {
    const req = buildValidatedRequest({ model: "m", prompt, columns, row }).request;
    const mk = (p: number) => ({
      model: "m",
      answers: { [QUESTION_ID]: { type: "noul", noul: p } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    expect(mapResponseToDecision(req, mk(0.93)).band).toBe("auto");
    expect(mapResponseToDecision(req, mk(0.72)).band).toBe("hitl");
    // noul: certeza = max(p, 1-p) — 0.62 tem certeza 0.62 → hitl
    expect(mapResponseToDecision(req, mk(0.62)).band).toBe("hitl");
    // 0.55 → certeza 0.55 → hitl (abstain nunca ocorre em noul: perto de 0.5 é
    // "indeciso", sinalizado pela lib como nota noul.ambiguous)
    expect(mapResponseToDecision(req, mk(0.55)).band).toBe("hitl");
  });

  it("resposta inválida lança erro (nunca inventa veredito)", () => {
    const req = buildValidatedRequest({ model: "m", prompt, columns, row }).request;
    expect(() => mapResponseToDecision(req, { answers: {} })).toThrow(/inválida|sem decisão/i);
    expect(() =>
      mapResponseToDecision(req, {
        answers: { [QUESTION_ID]: { type: "noul", noul: 1.7 } },
      }),
    ).toThrow(/inválida/i);
  });

  it("coluna temporária nunca entra no pedido (o builder recebe só colunas de dados)", () => {
    const cols = [...columns, { key: TEMP_COLUMN_ID, name: TEMP_COLUMN_NAME }];
    const { request } = buildValidatedRequest({
      model: "m",
      prompt,
      columns: cols,
      row: { ...row, [TEMP_COLUMN_ID]: "SIM" },
    });
    expect(request.state.row[TEMP_COLUMN_NAME]).toBeUndefined();
  });
});
