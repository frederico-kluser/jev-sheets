#!/usr/bin/env node
// Orquestrador de desenvolvimento: sobe a API (tsx watch) e o Vite JUNTOS,
// para `npm run dev` funcionar sozinho (UI em 5173, API em 8787, proxy /api).
// Zero dependências: só node:child_process + node:http.

import { spawn } from "node:child_process";
import http from "node:http";

const API_PORT = Number(process.env.PORT) || 8787;
const children = [];
let shuttingDown = false;

function prefix(tag, chunk) {
  return String(chunk)
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `${tag} ${line}`)
    .join("\n") + "\n";
}

function run(name, command, args) {
  const tag = `[${name}]`;
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: false,
  });
  child.stdout.on("data", (d) => {
    process.stdout.write(prefix(tag, d));
    if (name === "web") detectViteUrl(String(d));
  });
  child.stderr.on("data", (d) => process.stderr.write(prefix(tag, d)));
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.log(`${tag} terminou com código ${code} — a encerrar tudo.`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

// O Vite pode saltar de porta silenciosamente (5173 ocupada por outro projeto).
// Capturamos o URL real e avisamos, para o utilizador nunca abrir a app errada.
function detectViteUrl(output) {
  const match = output.match(/Local:\s+(http:\/\/[^\s]+)/);
  if (!match) return;
  const url = match[1];
  const port = Number(new URL(url).port || 80);
  if (port !== 5173) {
    console.log(
      `\n[dev] ⚠ A porta 5173 está ocupada por OUTRO processo/projeto. ` +
        `A UI do jev-sheets ficou em ${url}\n`,
    );
  }
  console.log(`\n[dev] ✔ Abrir a app: ${url}  (API em http://127.0.0.1:${API_PORT})\n`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function waitForApi(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get(`http://127.0.0.1:${API_PORT}/api/health`, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(left);
      });
      req.on("error", () => retry(left));
    };
    const retry = (left) => {
      if (left <= 0) return reject(new Error(`API não respondeu na porta ${API_PORT}.`));
      setTimeout(() => attempt(left - 1), 250);
    };
    attempt(retries);
  });
}

run("api", "npx", ["tsx", "watch", "server/index.ts"]);
console.log(`[dev] a aguardar a API em http://127.0.0.1:${API_PORT} ...`);
waitForApi()
  .then(() => {
    run("web", "npx", ["vite"]);
  })
  .catch((err) => {
    console.error(`[dev] ${err.message}`);
    shutdown(1);
  });
