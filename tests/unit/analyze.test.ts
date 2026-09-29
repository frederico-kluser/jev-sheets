import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeRows, sanitizeRequest, type DecideFn } from "../../server/analyze";
import { ResultCache } from "../../server/cache";
import { QUESTION_ID, type JevDecisionRequest } from "../../server/jev-request";
import { TEMP_COLUMN_ID, TEMP_COLUMN_NAME, type StreamEvent } from "../../shared/types";

const tmpDirs: string[] = [];
function tmpCache(): ResultCache {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-analyze-test-"));
  tmpDirs.push(dir);
  return new ResultCache(path.join(dir, "cache.json"));
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const columns = [
  { key: "empresa", name: "Empresa" },
  { key: "mensagem", name: "Última Mensagem do Cliente" },
];
const rows = [
  { id: "1", empresa: "Marítima Norte", mensagem: "Vamos cancelar, preço subiu demais" },
  { id: "2", empresa: "Doce Raiz", mensagem: "Renovamos por mais um ano, obrigado!" },
  { id: "3", empresa: "Clínica Vida Plena", mensagem: "Dá para exportar em CSV?" },
];
const prompt = "O cliente demonstra risco de churn (cancelamento ou insatisfação)?";

function fakeDecide(p: number, seenRequests: JevDecisionRequest[] = []): DecideFn {
  return (async (req: JevDecisionRequest) => {
    seenRequests.push(req);
    return {
      response: {
        model: "fake",
        answers: { [QUESTION_ID]: { type: "noul", noul: p } },
        usage: { input_tokens: 42, output_tokens: 0 },
      },
      telemetry: {
        latency_ms: 7,
        attempts: 1,
        socket_reused: true,
        endpoint: "fake",
        surface: "custom",
        model_requested: "fake",
        model_resolved: "fake",
        provider: null,
        cost_usd: 0.0001,
        input_tokens: 42,
        output_tokens: 0,
      },
    };
  }) as DecideFn;
}

const deps = (cache: ResultCache, decideFn: DecideFn) => ({
  cache,
  model: "typesafe/jev-1.13",
  concurrency: 32,
  decideFn,
});

describe("analyzeRows · cache incremental", () => {
  it("1ª execução analisa todas; 2ª execução idêntica sai toda da cache (0 chamadas)", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.91, seen);
    const body = { prompt, columns, rows };

    const r1 = await analyzeRows(body, deps(cache, decideFn));
    expect(seen).toHaveLength(3);
    expect(r1.stats).toMatchObject({ total: 3, cacheHits: 0, analyzed: 3, errors: 0 });
    expect(r1.results.every((x) => x.source === "api" && x.verdict === "SIM")).toBe(true);

    const r2 = await analyzeRows(body, deps(cache, decideFn));
    expect(seen).toHaveLength(3); // nenhuma chamada nova
    expect(r2.stats).toMatchObject({ total: 3, cacheHits: 3, analyzed: 0, errors: 0 });
    expect(r2.results.every((x) => x.source === "cache" && x.verdict === "SIM")).toBe(true);
  });

  it("novas inserções: analisa SÓ as linhas novas", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.2, seen);
    await analyzeRows({ prompt, columns, rows }, deps(cache, decideFn));
    expect(seen).toHaveLength(3);

    const withNew = [...rows, { id: "4", empresa: "AgroCampo", mensagem: "Quando sai o app Android?" }];
    const r = await analyzeRows({ prompt, columns, rows: withNew }, deps(cache, decideFn));
    expect(seen).toHaveLength(4); // só a linha nova
    expect(r.stats).toMatchObject({ total: 4, cacheHits: 3, analyzed: 1 });
    expect(r.results[3]).toMatchObject({ rowId: "4", verdict: "NÃO", source: "api" });
    expect(r.results[0]).toMatchObject({ rowId: "1", source: "cache" });
  });

  it("mudar o prompt reanalisa TUDO (chave muda)", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.5, seen);
    await analyzeRows({ prompt, columns, rows }, deps(cache, decideFn));
    const r = await analyzeRows(
      { prompt: "A empresa está sediada em Santa Catarina?", columns, rows },
      deps(cache, decideFn),
    );
    expect(seen).toHaveLength(6);
    expect(r.stats).toMatchObject({ cacheHits: 0, analyzed: 3 });
  });

  it("editar um valor da linha reanalisa só essa linha", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.8, seen);
    await analyzeRows({ prompt, columns, rows }, deps(cache, decideFn));
    const edited = rows.map((r) => (r.id === "2" ? { ...r, mensagem: "Vamos encerrar o contrato" } : r));
    const r = await analyzeRows({ prompt, columns, rows: edited }, deps(cache, decideFn));
    expect(seen).toHaveLength(4);
    expect(r.stats).toMatchObject({ cacheHits: 2, analyzed: 1 });
  });

  it("linhas duplicadas partilham uma única decisão", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.95, seen);
    const dup = [...rows, { ...rows[0], id: "9" }];
    const r = await analyzeRows({ prompt, columns, rows: dup }, deps(cache, decideFn));
    expect(seen).toHaveLength(3); // 4 linhas, 3 conteúdos distintos
    expect(r.results[3]).toMatchObject({ rowId: "9", verdict: "SIM", source: "api" });
  });

  it("só spaces no prompt não reanalisa (normalização), prompt real diferente sim", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.7, seen);
    await analyzeRows({ prompt, columns, rows }, deps(cache, decideFn));
    await analyzeRows({ prompt: `  ${prompt}  `, columns, rows }, deps(cache, decideFn));
    expect(seen).toHaveLength(3);
    await analyzeRows({ prompt: `${prompt} Considere também o NPS.`, columns, rows }, deps(cache, decideFn));
    expect(seen).toHaveLength(6);
  });
});

describe("analyzeRows · erros e limites", () => {
  it("ERRO não entra na cache e é repetido no envio seguinte", async () => {
    const cache = tmpCache();
    let fail = true;
    let calls = 0;
    const decideFn = (async () => {
      calls++;
      if (fail) throw new Error("HTTP 503: sem provider");
      return {
        response: {
          model: "fake",
          answers: { [QUESTION_ID]: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 1, output_tokens: 0 },
        },
        telemetry: {
          latency_ms: 1,
          attempts: 1,
          socket_reused: false,
          endpoint: "fake",
          surface: "custom",
          model_requested: "fake",
          model_resolved: "fake",
          provider: null,
          cost_usd: null,
          input_tokens: 1,
          output_tokens: 0,
        },
      };
    }) as DecideFn;

    const r1 = await analyzeRows({ prompt, columns, rows: rows.slice(0, 2) }, deps(cache, decideFn));
    expect(r1.stats.errors).toBe(2);
    expect(r1.results.every((x) => x.verdict === "ERRO" && x.source === "erro")).toBe(true);

    fail = false;
    const r2 = await analyzeRows({ prompt, columns, rows: rows.slice(0, 2) }, deps(cache, decideFn));
    expect(calls).toBe(4); // retry real, nada veio da cache
    expect(r2.stats).toMatchObject({ cacheHits: 0, analyzed: 2, errors: 0 });
  });

  it("respeita o teto de concorrência pedido", async () => {
    const cache = tmpCache();
    let inFlight = 0;
    let peak = 0;
    const decideFn = (async (req: JevDecisionRequest) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return {
        response: {
          model: "fake",
          answers: { [QUESTION_ID]: { type: "noul", noul: 0.8 } },
          usage: { input_tokens: 1, output_tokens: 0 },
        },
        telemetry: {
          latency_ms: 15,
          attempts: 1,
          socket_reused: true,
          endpoint: "fake",
          surface: "custom",
          model_requested: "fake",
          model_resolved: "fake",
          provider: null,
          cost_usd: null,
          input_tokens: 1,
          output_tokens: 0,
        },
      };
    }) as DecideFn;

    const many = Array.from({ length: 12 }, (_, i) => ({ ...rows[i % 3], id: `r${i}`, empresa: `Empresa ${i}` }));
    const r = await analyzeRows({ prompt, columns, rows: many }, { ...deps(cache, decideFn), concurrency: 3 });
    expect(r.stats.maxInFlight).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
    expect(r.stats.concurrency).toBe(3);
    expect(r.stats.analyzed).toBe(12);
  });

  it("a coluna temporária NÃO é avaliada (nem aparece no state do Jev)", async () => {
    const cache = tmpCache();
    const seen: JevDecisionRequest[] = [];
    const decideFn = fakeDecide(0.9, seen);
    const body = {
      prompt,
      columns: [...columns, { key: TEMP_COLUMN_ID, name: TEMP_COLUMN_NAME }],
      rows: rows.map((r) => ({ ...r, [TEMP_COLUMN_ID]: "SIM" })),
    };
    await analyzeRows(body, deps(cache, decideFn));
    for (const req of seen) {
      expect(Object.keys(req.state.row)).toEqual(["Empresa", "Última Mensagem do Cliente"]);
    }
  });

  it("emite eventos de progresso (start/result/done) para a UI", async () => {
    const cache = tmpCache();
    const events: StreamEvent[] = [];
    const decideFn = fakeDecide(0.6);
    await analyzeRows(
      { prompt, columns, rows },
      { ...deps(cache, decideFn), onEvent: (e) => events.push(e) },
    );
    expect(events[0]).toMatchObject({ type: "start", total: 3, cacheHits: 0, toAnalyze: 3 });
    expect(events.filter((e) => e.type === "result")).toHaveLength(3);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("sanitizeRequest valida o corpo do pedido", () => {
    expect(() => sanitizeRequest({ prompt: "", columns, rows })).toThrow(/vazio/);
    expect(() =>
      sanitizeRequest({ prompt: "x", columns: [{ key: TEMP_COLUMN_ID, name: TEMP_COLUMN_NAME }], rows }),
    ).toThrow(/colunas/);
    expect(() => sanitizeRequest({ prompt: "x", columns, rows: [] })).toThrow(/linhas/);
    const ok = sanitizeRequest({
      prompt: "  p  ",
      columns: [...columns, { key: TEMP_COLUMN_ID, name: TEMP_COLUMN_NAME }],
      rows,
    });
    expect(ok.columns).toHaveLength(2);
    expect(ok.prompt).toBe("p");
  });

  it("ordem dos resultados acompanha a ordem das linhas", async () => {
    const cache = tmpCache();
    const decideFn = fakeDecide(0.9);
    const r = await analyzeRows({ prompt, columns, rows }, deps(cache, decideFn));
    expect(r.results.map((x) => x.rowId)).toEqual(["1", "2", "3"]);
  });
});
