import { createApp } from "./app";
import { ResultCache } from "./cache";
import { getConfig } from "./config";
import { closeAgents } from "./jev/vendor/client.mjs";

const config = getConfig();
const cache = new ResultCache(config.cachePath);
const app = createApp({ config, cache });

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(
    `[jev-sheets] API em http://127.0.0.1:${config.port} · modelo=${config.model} · concorrência=${config.concurrency} · cache=${cache.size} entradas · chave=${config.apiKey ? "configurada" : "EM FALTA"}`,
  );
});

function shutdown(): void {
  server.close(() => {
    cache.flush();
    closeAgents();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
