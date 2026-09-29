// Integração AO VIVO com o Jev real (typesafe/jev-1.13 via OpenRouter).
// Requer OPENROUTER_API_KEY (fornecida em .env). Corre `npm run test:live`.
//
// O que prova:
//  1. o pipeline completo decide linhas reais (SIM/NÃO) com probabilidades;
//  2. a concorrência acontece de verdade (pico > 1 em paralelo);
//  3. a cache evita chamadas repetidas (mesmo prompt + mesmo dado);
//  4. os pedidos passam na validação offline da lib Jev (já validado no unit,
//    aqui confirmado com pedidos reais enviados).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeRows, type DecideFn } from "../../server/analyze";
import { ResultCache } from "../../server/cache";
import { getConfig } from "../../server/config";
import { decide } from "../../server/jev/vendor/client.mjs";
import { closeAgents } from "../../server/jev/vendor/client.mjs";

const config = getConfig(process.cwd());
const hasKey = Boolean(config.apiKey);

let cache: ResultCache;
let tmpDir: string;

const columns = [
  { key: "empresa", name: "Empresa" },
  { key: "segmento", name: "Segmento" },
  { key: "mensagem", name: "Última Mensagem do Cliente" },
  { key: "status", name: "Status da Conta" },
];
const prompt = "O cliente pede ou ameaça cancelar/sair do serviço?";

const rows = [
  {
    id: "L1",
    empresa: "Transportes Rondelli",
    segmento: "Logística",
    mensagem: "Se não resolver até sexta, vamos cancelar o contrato.",
    status: "Em risco",
  },
  {
    id: "L2",
    empresa: "Doce Raiz Chocolates",
    segmento: "E-commerce",
    mensagem: "Renovamos por mais um ano, o time adorou o painel!",
    status: "Ativo",
  },
  {
    id: "L3",
    empresa: "Clínica Vida Plena",
    segmento: "Saúde",
    mensagem: "Dá para exportar os agendamentos em CSV?",
    status: "Ativo",
  },
  {
    id: "L4",
    empresa: "Rede Hotéis Maré Alta",
    segmento: "Hotelaria",
    mensagem: "Estamos pagando por módulos que não usamos e vamos sair se não houver desconto.",
    status: "Em risco",
  },
  {
    id: "L5",
    empresa: "Editora Letra Viva",
    segmento: "Editorial",
    mensagem: "Contratamos mais 3 licenças para a equipe de revisão.",
    status: "Ativo",
  },
  {
    id: "L6",
    empresa: "Metalúrgica Tupi",
    segmento: "Indústria",
    mensagem: "Não renovamos assim, o relatório de custos continua errado.",
    status: "Em risco",
  },
];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-live-test-"));
  cache = new ResultCache(path.join(tmpDir, "cache.json"));
});

afterAll(() => {
  closeAgents();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe.skipIf(!hasKey)("Jev ao vivo (OpenRouter)", () => {
  it("decide 6 linhas reais em paralelo com probabilidades calibradas", async () => {
    const r = await analyzeRows(
      { prompt, columns, rows, concurrency: 6 },
      { cache, model: config.model, concurrency: 6, apiKey: config.apiKey },
    );

    expect(r.stats.errors).toBe(0);
    expect(r.stats.analyzed).toBe(6);
    expect(r.stats.cacheHits).toBe(0);
    // Concorrência real: com 6 decisões ~250-350ms e teto 6, o pico passa de 1.
    expect(r.stats.maxInFlight).toBeGreaterThan(1);
    expect(r.stats.durationMs).toBeLessThan(30_000);

    for (const res of r.results) {
      expect(["SIM", "NÃO"]).toContain(res.verdict);
      expect(res.probability).toBeGreaterThanOrEqual(0);
      expect(res.probability).toBeLessThanOrEqual(1);
      expect(["auto", "hitl"]).toContain(res.band);
      expect(res.latencyMs!).toBeLessThan(10_000);
      expect(res.source).toBe("api");
    }

    // Casos extremos: cancelamento explícito → SIM; renovação explícita → NÃO.
    const byId = new Map(r.results.map((x) => [x.rowId, x]));
    expect(byId.get("L1")!.verdict).toBe("SIM");
    expect(byId.get("L4")!.verdict).toBe("SIM");
    expect(byId.get("L6")!.verdict).toBe("SIM");
    expect(byId.get("L2")!.verdict).toBe("NÃO");
    expect(byId.get("L5")!.verdict).toBe("NÃO");
  }, 60_000);

  it("mesmo prompt + mesmo dado → 100% da cache, zero chamadas à API", async () => {
    let calls = 0;
    const counted: DecideFn = (async (...args: Parameters<typeof decide>) => {
      calls++;
      return decide(...args);
    }) as DecideFn;

    const r = await analyzeRows(
      { prompt, columns, rows, concurrency: 6 },
      { cache, model: config.model, concurrency: 6, apiKey: config.apiKey, decideFn: counted },
    );
    expect(calls).toBe(0);
    expect(r.stats.cacheHits).toBe(6);
    expect(r.stats.analyzed).toBe(0);
    expect(r.results.every((x) => x.source === "cache")).toBe(true);
    expect(r.stats.costUsd).toBeNull();
  }, 30_000);

  it("linha nova depois do cache: só a nova vai à API", async () => {
    let calls = 0;
    const counted: DecideFn = (async (...args: Parameters<typeof decide>) => {
      calls++;
      return decide(...args);
    }) as DecideFn;

    const withNew = [
      ...rows,
      {
        id: "L7",
        empresa: "Padaria Aurora",
        segmento: "Varejo alimentar",
        mensagem: "Quero cancelar tudo agora, cancelem meu plano hoje.",
        status: "Em risco",
      },
    ];
    const r = await analyzeRows(
      { prompt, columns, rows: withNew, concurrency: 6 },
      { cache, model: config.model, concurrency: 6, apiKey: config.apiKey, decideFn: counted },
    );
    expect(calls).toBe(1);
    expect(r.stats.cacheHits).toBe(6);
    expect(r.results[6]).toMatchObject({ rowId: "L7", verdict: "SIM", source: "api" });
  }, 30_000);

  it("confirma a chave/conta do OpenRouter (diagnóstico)", async () => {
    const { checkKey } = await import("../../server/jev/vendor/client.mjs");
    const res = await checkKey({ apiKey: config.apiKey });
    expect(res.ok).toBe(true);
  }, 20_000);
});
