import express from "express";
import fs from "node:fs";
import path from "node:path";
import { analyzeRows, type AnalyzeDeps, type DecideFn } from "./analyze";
import type { ResultCache } from "./cache";
import type { AppConfig } from "./config";
import type { AnalyzeRequest, HealthResponse, StreamEvent } from "../shared/types";

export interface AppDeps {
  config: AppConfig;
  cache: ResultCache;
  decideFn?: DecideFn;
}

export function createApp({ config, cache, decideFn }: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: "16mb" }));

  function analyzeDeps(concurrency: number | undefined): AnalyzeDeps {
    return {
      cache,
      model: config.model,
      concurrency: concurrency ?? config.concurrency,
      apiKey: config.apiKey,
      decideFn,
    };
  }

  app.get("/api/health", (_req, res) => {
    const health: HealthResponse = {
      ok: true,
      model: config.model,
      keyConfigured: Boolean(config.apiKey),
      cacheEntries: cache.size,
      concurrencyDefault: config.concurrency,
    };
    res.json(health);
  });

  /** Análise completa num JSON só (usada pelos testes e clientes simples). */
  app.post("/api/analyze", async (req, res) => {
    try {
      const body = req.body as AnalyzeRequest;
      const response = await analyzeRows(body, analyzeDeps(body?.concurrency));
      res.json(response);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Análise com progresso em NDJSON (usada pela UI: enche a coluna linha a linha). */
  app.post("/api/analyze/stream", async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    const write = (event: StreamEvent) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const body = req.body as AnalyzeRequest;
      const response = await analyzeRows(body, {
        ...analyzeDeps(body?.concurrency),
        onEvent: write,
      });
      res.end();
      void response;
    } catch (err) {
      write({ type: "error", message: err instanceof Error ? err.message : String(err) });
      res.end();
    }
  });

  app.post("/api/cache/clear", (_req, res) => {
    cache.clear();
    res.json({ ok: true, cacheEntries: 0 });
  });

  // Produção: serve a app construída (vite build → dist/) com fallback SPA.
  const distDir = path.join(config.rootDir, "dist");
  if (process.env.NODE_ENV === "production" && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}
