import { defineConfig } from "@playwright/test";

// E2E contra a app real: servidor Express a servir o build de produção + API
// Jev ao vivo (chave no .env). Cache separada para não interferir com dev.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8790",
    headless: true,
  },
  webServer: {
    command: "npx tsx server/index.ts",
    url: "http://127.0.0.1:8790/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: "production",
      PORT: "8790",
      JEV_CACHE_PATH: "data/jev-cache-e2e.json",
    },
  },
});
