// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import type { AnalyzeStats, StreamEvent } from "../../shared/types";

const encoder = new TextEncoder();

function ndjsonResponse(events: StreamEvent[]): Response {
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  }), { status: 200 });
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

  it("Enviar análise enche a coluna com SIM/NÃO e mostra estatísticas", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");

    await user.click(screen.getByRole("button", { name: "Enviar análise" }));

    expect(await screen.findByText("1 SIM, 1 NÃO na coluna temporária")).toBeInTheDocument();
    const grid = document.querySelector(".grid-shell")!;
    expect(within(grid as HTMLElement).getByText("SIM")).toBeInTheDocument();
    expect(within(grid as HTMLElement).getByText("NÃO")).toBeInTheDocument();
    // estatísticas do envio (conc. real, custo, cache)
    expect(await screen.findByText(/18 linhas, 0 da cache, 18 analisadas/)).toBeInTheDocument();
    expect(screen.getByText(/US\$ 0\.00021/)).toBeInTheDocument();
    expect(screen.getByText(/pico de 12 em paralelo \(teto 32\)/)).toBeInTheDocument();
  });

  it("Limpar coluna volta a deixar a coluna limpa", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");
    await user.click(screen.getByRole("button", { name: "Enviar análise" }));
    await screen.findByText("1 SIM, 1 NÃO na coluna temporária");

    await user.click(screen.getByRole("button", { name: "Limpar coluna" }));

    expect(screen.getByText("0 SIM, 0 NÃO na coluna temporária")).toBeInTheDocument();
    const grid = document.querySelector(".grid-shell")!;
    expect(within(grid as HTMLElement).queryByText("SIM")).not.toBeInTheDocument();
    expect(within(grid as HTMLElement).queryByText("NÃO")).not.toBeInTheDocument();
  });

  it("desativa o botão Enviar com prompt vazio ou durante a análise", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Padaria Aurora");

    const promptBox = screen.getByLabelText("Afirmação ou pergunta para filtrar as linhas");
    await user.clear(promptBox);
    expect(screen.getByRole("button", { name: "Enviar análise" })).toBeDisabled();

    await user.type(promptBox, "Há risco de churn?");
    expect(screen.getByRole("button", { name: "Enviar análise" })).toBeEnabled();
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

  it("exibe a saúde do servidor (modelo, chave, cache, concorrência)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("typesafe/jev-1.13")).toBeInTheDocument();
    });
    expect(screen.getByText("configurada")).toBeInTheDocument();
    expect(screen.getByText("7 entradas")).toBeInTheDocument();
    expect(screen.getByText("32 máx.")).toBeInTheDocument();
  });
});
