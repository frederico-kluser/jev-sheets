import { expect, test } from "@playwright/test";

// E2E com a app real e o Jev REAL (18 linhas do dataset de demonstração).
// Prova o fluxo completo do produto: prompt → Enviar análise → coluna
// temporária SIM/NÃO → cache → Limpar coluna.

const PROMPT = "O cliente pede ou ameaça cancelar/sair do serviço?";

test("fluxo completo do filtro de IA na planilha", async ({ page }) => {
  await page.goto("/");

  // app carregada com a planilha e a coluna temporária limpa
  await expect(page.getByRole("heading", { name: "jev-sheets" })).toBeVisible();
  await expect(page.getByText("Filtro IA (temporário)")).toBeVisible();
  await expect(page.getByText("Padaria Aurora")).toBeVisible();
  await expect(page.getByText("0 SIM, 0 NÃO na coluna temporária")).toBeVisible();

  // estado limpo e determinístico para a prova
  await page.getByRole("button", { name: "Limpar cache do servidor" }).click();
  await expect(page.getByText("0 entradas")).toBeVisible();

  // 1) envio com concorrência máxima: 18 decisões Jev reais
  await page.getByLabel("Afirmação ou pergunta para filtrar as linhas").fill(PROMPT);
  await page.getByRole("button", { name: "Enviar análise" }).click();
  await expect(page.getByText(/18 linhas, 0 da cache, 18 analisadas/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/pico de \d+ em paralelo \(teto 32\)/)).toBeVisible();

  // a coluna temporária ficou preenchida com SIM e NÃO
  const simCells = page.locator(".ag-cell.ai-sim");
  const naoCells = page.locator(".ag-cell.ai-nao");
  expect(await simCells.count()).toBeGreaterThan(0);
  expect(await naoCells.count()).toBeGreaterThan(0);
  // hover mostra probabilidade e banda (o detalhe do Jev por linha)
  await simCells.first().hover();
  await expect(page.getByText(/p\(aderente\) = 0\.\d+/)).toBeVisible();

  // 2) mesmo prompt + mesmos dados → cache, zero reanálise
  await page.getByRole("button", { name: "Enviar análise" }).click();
  await expect(page.getByText(/18 linhas, 18 da cache, 0 analisadas/)).toBeVisible({
    timeout: 60_000,
  });
  expect(await page.locator(".ag-cell.ai-sim").count()).toBeGreaterThan(0);

  // 3) Limpar coluna deixa a coluna temporária limpa de novo
  await page.getByRole("button", { name: "Limpar coluna" }).click();
  await expect(page.getByText("0 SIM, 0 NÃO na coluna temporária")).toBeVisible();
  await expect(page.locator(".ag-cell.ai-sim")).toHaveCount(0);
  await expect(page.locator(".ag-cell.ai-nao")).toHaveCount(0);
});

test("editar uma célula limpa o resultado daquela linha", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Limpar cache do servidor" }).click();
  await expect(page.getByText("0 entradas")).toBeVisible();

  await page.getByLabel("Afirmação ou pergunta para filtrar as linhas").fill(PROMPT);
  await page.getByRole("button", { name: "Enviar análise" }).click();
  await expect(page.getByText(/18 linhas, 0 da cache, 18 analisadas/)).toBeVisible({
    timeout: 60_000,
  });

  const before = await page.locator(".ag-cell.ai-sim, .ag-cell.ai-nao").count();
  expect(before).toBeGreaterThan(0);

  // edição de célula (double-click → edita → Enter) remove o veredito da linha
  await page.getByText("Padaria Aurora").dblclick();
  await expect(page.locator(".ag-cell-inline-editing")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Cliente cancelou o plano");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Cliente cancelou o plano")).toBeVisible();

  await expect
    .poll(() => page.locator(".ag-cell.ai-sim, .ag-cell.ai-nao").count(), { timeout: 10_000 })
    .toBe(before - 1);
});
