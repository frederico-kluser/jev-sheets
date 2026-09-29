import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  apiKey: string | null;
  model: string;
  /** Concorrência máxima de decisões Jev simultâneas (o "máximo simultâneo"). */
  concurrency: number;
  port: number;
  cachePath: string;
  rootDir: string;
}

/**
 * Carrega `.env` (KEY=VALUE) sem dependências. Nunca sobrescreve variáveis já
 * existentes no processo — o ambiente manda.
 */
export function loadEnvFile(file: string, env: NodeJS.ProcessEnv = process.env): void {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return;
  for (const rawLine of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

const MAX_CONCURRENCY = 64;

export function clampConcurrency(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(n)));
}

export function getConfig(rootDir = process.cwd()): AppConfig {
  loadEnvFile(path.join(rootDir, ".env"));
  const env = process.env;
  return {
    apiKey: env.OPENROUTER_API_KEY || env.JEV_API_KEY || env.TYPESAFE_API_KEY || null,
    model: env.JEV_MODEL || "typesafe/jev-1.13",
    // Máximo simultâneo por omissão: 32 decisões em paralelo (o transporte da
    // lib Jev mantém até 50 sockets quentes). Ajustável por JEV_CONCURRENCY.
    concurrency: clampConcurrency(env.JEV_CONCURRENCY, 32),
    port: Number(env.PORT) || 8787,
    cachePath: env.JEV_CACHE_PATH || path.join(rootDir, "data", "jev-cache.json"),
    rootDir,
  };
}
