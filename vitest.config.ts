import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Ambiente padrão: node (servidor, cache, runner, integração ao vivo).
// Os testes de UI usam o docblock `@vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
