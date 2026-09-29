# Aprendizados da construção (2026-09-29)

Correções e surpresas reais encontradas ao construir o PoC, para não os repetir.

## Jev / jev-agent-skill

1. **Em `noul`, a banda `abstain` é inalcançável.** A certeza é `max(p, 1-p) ≥ 0.5`
   sempre, logo toda a decisão `noul` cai em `auto` (≥ 0.90) ou `hitl` (≥ 0.50).
   Perto de 0.5 o modelo está *indeciso* (a lib sinaliza `noul.ambiguous`), não
   "pouco intenso". Fonte: `decideBand` em `scripts/lib/validate.mjs`.
2. **`validateRequest` devolve `budget` (não `token_budget`)** e os erros de
   orçamento têm código `budget.state` / `budget.total` — dá para reagir a eles
   encolhendo o state (foi assim que implementámos o truncagem progressivo
   600 → 200 → 80 caracteres por valor).
3. **Deduplicar linhas por conteúdo poupa dinheiro sem comportamento extra:** o
   Jev é determinístico para o mesmo pedido, então linhas iguais podem partilhar
   uma única decisão (provado pelo `latencyMs` idêntico no demo `curl`).
4. A lib da skill aceita `opts.transport` injetável — foi o que tornou os testes
   unitários 100% offline sem reimplementar nada.

## AG Grid v36

5. `enableCellChangeFlash` é opção de **ColDef**, não do grid.
6. `cellSelection` é **Enterprise** na v36 (o `AllCommunityModule` não o inclui);
   passar a opção sem registar o módulo devolve o erro #200.
7. Em `CellValueChangedEvent` não existe `colId` — usar `event.column.getColId()`.

## Testes

8. Em jsdom a AG Grid renderiza bem (com `ResizeObserver` em stub), mas queries
   por texto do header têm de ser tolerantes: o texto pode estar partido por
   elementos filhos.
9. Matchers vagos tipo `/18 linhas/` apanham também textos de progresso
   ("0 de 18 linhas concluídas") — em E2E, esperar pela linha de estatísticas
   completa ("18 linhas, 0 da cache, 18 analisadas").
10. `tsx -e` compila como CJS (sem top-level await) — usar ficheiro `.mts`.

## uxui-evaluator

11. Sem `UXUI_API_KEY` o modo interno do framework funciona, mas os códigos de
    princípios menos comuns (ex.: automation bias) ficam por estimativa — marcar
    isso no `api_note` em vez de fingir verificação.
