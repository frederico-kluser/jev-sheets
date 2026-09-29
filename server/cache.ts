import fs from "node:fs";
import path from "node:path";
import type { ActionBand, Verdict } from "../shared/types";

export interface CacheEntry {
  verdict: Verdict;
  probability: number;
  band: ActionBand | null;
  model: string;
  createdAt: string;
  latencyMs?: number;
}

interface CacheFileShape {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/**
 * Cache persistente de resultados Jev (ficheiro JSON, escrita atómica).
 *
 * Regras do produto:
 *  - mesmo prompt + mesma linha (incluindo nomes das colunas) → cache hit;
 *  - novas inserções analisam só as novas; prompt mudado reanalisa tudo;
 *  - resultados com ERRO nunca entram na cache (para poderem ser repetidos).
 */
export class ResultCache {
  private entries = new Map<string, CacheEntry>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CacheFileShape;
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        for (const [k, v] of Object.entries(parsed.entries)) {
          if (v && typeof v.verdict === "string" && typeof v.probability === "number") {
            this.entries.set(k, v);
          }
        }
      }
      // Forma inválida/corrompida: começa vazio em vez de rebentar.
    } catch {
      this.entries.clear();
    }
  }

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }

  setMany(records: Array<[string, CacheEntry]>): void {
    for (const [k, v] of records) this.entries.set(k, v);
    this.flush();
  }

  clear(): void {
    this.entries.clear();
    this.flush();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Escrita atómica: tmp + rename (nunca deixa o ficheiro a meio). */
  flush(): void {
    const payload: CacheFileShape = {
      version: 1,
      entries: Object.fromEntries(this.entries),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }
}
