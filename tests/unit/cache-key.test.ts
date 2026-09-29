import { describe, expect, it } from "vitest";
import { normalizePrompt, rowCacheKey } from "../../server/cache-key";

const columns = [
  { key: "empresa", name: "Empresa" },
  { key: "mensagem", name: "Última Mensagem do Cliente" },
];
const row = { id: "R1", empresa: "Marítima Norte", mensagem: "Vamos cancelar" };
const base = { model: "typesafe/jev-1.13", prompt: "Há risco de churn?", columns, row };

describe("rowCacheKey", () => {
  it("mesmo prompt + mesmo dado → mesma chave (cache hit)", () => {
    expect(rowCacheKey(base)).toBe(rowCacheKey({ ...base }));
  });

  it("só mudar espaços/quebras de linha no prompt não invalida a cache", () => {
    const a = rowCacheKey({ ...base, prompt: "Há risco de churn?" });
    const b = rowCacheKey({ ...base, prompt: "  Há   risco de\nchurn?  " });
    expect(a).toBe(b);
    expect(normalizePrompt("  Há   risco de\nchurn?  ")).toBe("Há risco de churn?");
  });

  it("mudar o prompt (texto) invalida a cache", () => {
    expect(rowCacheKey(base)).not.toBe(rowCacheKey({ ...base, prompt: "Há risco de fraude?" }));
  });

  it("mudar um VALOR da linha invalida a cache", () => {
    expect(rowCacheKey(base)).not.toBe(
      rowCacheKey({ ...base, row: { ...row, mensagem: "Renovamos por mais um ano" } }),
    );
  });

  it("mudar o NOME de uma coluna invalida a cache (nomes contam na avaliação)", () => {
    const renamed = columns.map((c) => (c.key === "empresa" ? { ...c, name: "Cliente" } : c));
    expect(rowCacheKey(base)).not.toBe(rowCacheKey({ ...base, columns: renamed }));
  });

  it("mudar a ORDEM das colunas invalida a cache (a avaliação muda)", () => {
    expect(rowCacheKey(base)).not.toBe(rowCacheKey({ ...base, columns: [...columns].reverse() }));
  });

  it("mudar o MODELO invalida a cache", () => {
    expect(rowCacheKey(base)).not.toBe(rowCacheKey({ ...base, model: "typesafe/jev-1.14" }));
  });

  it("a posição da linha na planilha é irrelevante (só o conteúdo)", () => {
    expect(rowCacheKey(base)).toBe(rowCacheKey({ ...base, row: { ...row } }));
  });

  it("ignora o id/colunas fora da avaliação (não entram na chave)", () => {
    const withExtra = { ...row, extra: "lixo" };
    expect(rowCacheKey({ ...base, row: withExtra })).toBe(rowCacheKey(base));
  });
});
