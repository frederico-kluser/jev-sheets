// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import type { AnalyzeStats, StreamEvent } from "../../shared/types";

const encoder = new TextEncoder();

function ndjsonResponse(events: StreamEvent[]): Response {
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

const statsFixture: AnalyzeStats = {
  total: 18,
  cacheHits: 0,
  analyzed: 18,
  errors: 0,
  durationMs: 1234,
  costUsd: 0.00021,
  inputTokens: 3400,
  concurrency: 32,
  maxInFlight: 12,
};

const streamFixture: StreamEvent[] = [
  { type: "start", total: 18, cacheHits: 0, toAnalyze: 18, concurrency: 32 },
  {
    type: "result",
    result: { rowId: "CTA-4102", verdict: "SIM", probability: 0.91, band: "auto", source: "api" },
  },
  {
    type: "result",
    result: { rowId: "CTA-4107", verdict: "NÃO", probability: 0.18, band: "hitl", source: "cache" },
  },
  { type: "done", stats: statsFixture, results: [] },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/health")) {
      return new Response(
        JSON.stringify({
          ok: true,
          model: "typesafe/jev-1.13",
          keyConfigured: true,
          cacheEntries: 7,
          concurrencyDefault: 32,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/analyze/stream") && init?.method === "POST") {
      return ndjsonResponse(streamFixture);
    }
    if (url.includes("/api/cache/clear")) {
      return new Response(JSON.stringify({ ok: true, cacheEntries: 0 }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "rota desconhecida" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App · filtro de IA na planilha", () => {
  it("mostra a coluna temporária sempre presente e limpa antes de qualquer envio", async () => {
    render(<App />);
    expect(await screen.findByText(/Filtro IA \(tempor[áa]rio\)/)).toBeInTheDocument();
    expect(await screen.findByText("Padaria Aurora")).toBeInTheDocument();
    expect(screen.getByText("0 SIM, 0 NÃO na coluna temporária")).toBeInTheDocument();
  });

  it("Enviar análise enche a coluna com SIM/NÃO e mostra estatísticas em chips", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");

    await user.click(screen.getByRole("button", { name: "Enviar análise" }));

    expect(await screen.findByText("1 SIM, 1 NÃO na coluna temporária")).toBeInTheDocument();
    const grid = document.querySelector(".grid-shell")!;
    expect(within(grid as HTMLElement).getByText("SIM")).toBeInTheDocument();
    expect(within(grid as HTMLElement).getByText("NÃO")).toBeInTheDocument();
    // detalhe da decisão sempre visível (não só em hover)
    expect(within(grid as HTMLElement).getByText(/p 0\.910 · auto/)).toBeInTheDocument();
    expect(within(grid as HTMLElement).getByText(/p 0\.180 · hitl · cache/)).toBeInTheDocument();
    // estatísticas do envio
    expect(screen.getByText("18 linhas", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("0 da cache", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("18 analisadas", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("US$ 0.00021", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("pico de 12 em paralelo (teto 32)", { exact: true })).toBeInTheDocument();
  });

  it("Limpar coluna volta a deixar a coluna limpa e permite desfazer", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");
    await user.click(screen.getByRole("button", { name: "Enviar análise" }));
    await screen.findByText("1 SIM, 1 NÃO na coluna temporária");

    await user.click(screen.getByRole("button", { name: "Limpar coluna" }));

    expect(screen.getByText("0 SIM, 0 NÃO na coluna temporária")).toBeInTheDocument();
    const grid = document.querySelector(".grid-shell")!;
    expect(within(grid as HTMLElement).queryByText("SIM")).not.toBeInTheDocument();

    // toast de desfazer restaura os vereditos
    expect(screen.getByText("Coluna temporária limpa.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(screen.getByText("1 SIM, 1 NÃO na coluna temporária")).toBeInTheDocument();
  });

  it("desativa o botão Enviar com prompt vazio; durante a análise oferece Parar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");

    const promptBox = screen.getByLabelText("Afirmação ou pergunta para filtrar as linhas");
    await user.clear(promptBox);
    expect(screen.getByRole("button", { name: "Enviar análise" })).toBeDisabled();

    await user.type(promptBox, "Há risco de churn?");
    expect(screen.getByRole("button", { name: "Enviar análise" })).toBeEnabled();
  });

  it("Parar cancela a análise e avisa que os parciais foram mantidos", async () => {
    // fetch que nunca responde até ser abortado (simula execução longa)
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const url = String(input);
          if (url.includes("/api/health")) {
            _resolve(
              new Response(
                JSON.stringify({
                  ok: true,
                  model: "typesafe/jev-1.13",
                  keyConfigured: true,
                  cacheEntries: 0,
                  concurrencyDefault: 32,
                }),
                { status: 200 },
              ),
            );
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");
    await user.click(screen.getByRole("button", { name: "Enviar análise" }));

    const stopButton = await screen.findByRole("button", { name: "Parar" });
    await user.click(stopButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Análise interrompida/);
    expect(screen.getByRole("button", { name: "Enviar análise" })).toBeEnabled();
  });

  it("mostra estado offline e banner amigável quando a API está em baixo (502)", async () => {
    fetchMock.mockImplementation(async () => new Response("Bad Gateway", { status: 502 }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");

    await waitFor(() => {
      expect(screen.getByText("offline")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Enviar análise" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/não está a responder/);
    expect(alert).toHaveTextContent(/npm run dev/);
  });

  it("mostra banner de erro quando o servidor falha no stream", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/analyze/stream")) {
        return new Response(JSON.stringify({ error: "Sem créditos na chave (HTTP 402)" }), {
          status: 500,
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          model: "typesafe/jev-1.13",
          keyConfigured: true,
          cacheEntries: 0,
          concurrencyDefault: 32,
        }),
        { status: 200 },
      );
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");
    await user.click(screen.getByRole("button", { name: "Enviar análise" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Sem créditos|HTTP 500/);
  });

  it("exibe a saúde do servidor (modelo, chave, API, cache, concorrência)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("typesafe/jev-1.13")).toBeInTheDocument();
    });
    expect(screen.getByText("configurada")).toBeInTheDocument();
    expect(screen.getByText("ligada")).toBeInTheDocument();
    expect(screen.getByText("7 entradas")).toBeInTheDocument();
    expect(screen.getByText("32 máx.")).toBeInTheDocument();
  });
});
