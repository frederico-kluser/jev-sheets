import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `vite` (porta 5173) com proxy /api -> servidor Jev (porta 8787).
// Produção: `vite build` gera dist/ e o servidor Express serve a app + API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
  },
});
