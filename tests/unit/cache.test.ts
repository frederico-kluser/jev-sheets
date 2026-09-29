import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResultCache, type CacheEntry } from "../../server/cache";

const tmpDirs: string[] = [];
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-cache-test-"));
  tmpDirs.push(dir);
  return path.join(dir, "cache.json");
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const entry = (verdict: "SIM" | "NÃO" = "SIM"): CacheEntry => ({
  verdict,
  probability: 0.93,
  band: "auto",
  model: "typesafe/jev-1.13",
  createdAt: new Date().toISOString(),
});

describe("ResultCache", () => {
  it("guarda e recupera entradas", () => {
    const cache = new ResultCache(tmpFile());
    cache.set("k1", entry("SIM"));
    cache.set("k2", entry("NÃO"));
    expect(cache.get("k1")?.verdict).toBe("SIM");
    expect(cache.get("k2")?.verdict).toBe("NÃO");
    expect(cache.size).toBe(2);
  });

  it("persiste entre instâncias (processos) — cache de verdade", () => {
    const file = tmpFile();
    const a = new ResultCache(file);
    a.setMany([
      ["k1", entry("SIM")],
      ["k2", entry("NÃO")],
    ]);
    const b = new ResultCache(file);
    expect(b.size).toBe(2);
    expect(b.get("k2")?.verdict).toBe("NÃO");
  });

  it("clear() esvazia e persiste", () => {
    const file = tmpFile();
    const a = new ResultCache(file);
    a.set("k1", entry());
    a.clear();
    expect(new ResultCache(file).size).toBe(0);
  });

  it("ficheiro corrompido não rebenta: começa vazio", () => {
    const file = tmpFile();
    fs.writeFileSync(file, "{isto não é json", "utf8");
    const cache = new ResultCache(file);
    expect(cache.size).toBe(0);
    cache.set("k1", entry());
    expect(cache.size).toBe(1);
  });

  it("escrita atómica: não fica ficheiro .tmp para trás", () => {
    const file = tmpFile();
    const cache = new ResultCache(file);
    cache.set("k1", entry());
    cache.flush();
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});
