# jev-sheets

Planilha completa (todas as funcionalidades de edição/ordenação/filtros/exportação)
com um **filtro de IA**: cada linha é avaliada individualmente pelo **Jev** (System
One da TypeSafe, via OpenRouter) contra uma afirmação/pergunta escrita pelo
utilizador, e marcada **SIM/NÃO** numa coluna temporária. Com cache incremental,
concorrência máxima e um clique só para enviar.

```
┌─────────────────────────────────────────────────────────────────────┐
│ jev-sheets · modelo typesafe/jev-1.13 · chave configurada · 32 máx. │
├─────────────────────────────────────────────────────────────────────┤
│ Afirmação ou pergunta para filtrar as linhas                        │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ O cliente pede ou ameaça cancelar/sair do serviço?              │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ [ Enviar análise ]  [ Limpar coluna ]   12 de 18 linhas concluídas  │
├─────────────────────────────────────────────────────────────────────┤
│ ID · Empresa · Segmento · … · Última Mensagem │ Filtro IA (temp.)   │
│ CTA-4107 · Transportes Rondelli · Logística   │        NÃO          │
│ CTA-4120 · Doce Raiz Chocolates · E-commerce  │        SIM          │
│ …                                             │        SIM          │
└─────────────────────────────────────────────────────────────────────┘
```

## Como correr

```bash
npm install
cp .env.example .env        # já vem OPENROUTER_API_KEY neste PoC (ver .env)

npm run dev                 # sobe UI + API juntos (um comando só)
                            # UI no URL impresso (5173, ou outra se ocupada),
                            # API em http://127.0.0.1:8787, proxy /api automático

npm run build && npm start  # produção: UI + API no mesmo processo (porta 8787)
```

Se a porta 5173 estiver ocupada por outro projeto, o orquestrador avisa e
imprime o URL real da UI (ex.: `http://localhost:5174/`) — abra sempre o URL
impresso. Alternativas manuais: `npm run dev:api` + `npm run dev:web`.

## Testes (a prova de que funciona)

```bash
npm test          # 54 testes: unitários + UI (offline, determinísticos)
npm run test:live # 4 testes AO VIVO contra o Jev real (usa a chave do .env)
npm run test:e2e  # 2 testes Playwright: fluxo completo em browser real
```

Última execução nesta máquina (2026-09-29):

| Suíte | Testes | Resultado | Destaques medidos |
|---|---|---|---|
| `tests/unit` (cache, chave, pool, requisições, pipeline) | 42 | 42 verdes | pico de concorrência = teto; dedup; cache incremental |
| `tests/ui` (Testing Library + AG Grid em jsdom) | 8 | 8 verdes | coluna preenche/limpa/desfaz; cancelar; offline 502; erros |
| `tests/integration` (Jev real, OpenRouter) | 4 | 4 verdes | 6 decisões reais em 689 ms; 2ª execução = 0 chamadas |
| `e2e` (Playwright + Jev real) | 2 | 2 verdes | fluxo completo 2,7 s; edição limpa o veredito |

Prova ao vivo via API (`curl /api/analyze`, 3 linhas com 1 repetida):

```json
"results": [
  { "rowId": "A", "verdict": "SIM",  "probability": 0.98, "band": "auto", "source": "api", "latencyMs": 664 },
  { "rowId": "B", "verdict": "NÃO", "probability": 0.03, "band": "auto", "source": "api", "latencyMs": 679 },
  { "rowId": "C", "verdict": "SIM",  "probability": 0.98, "band": "auto", "source": "api", "latencyMs": 664 }
],
"stats": { "total": 3, "cacheHits": 0, "analyzed": 3, "errors": 0,
           "durationMs": 688, "costUsd": 0.000039, "concurrency": 32, "maxInFlight": 2 }
```

Repare que a linha `C` (duplicado de `A`) **partilhou a mesma decisão** (mesmo
latencyMs) e que `maxInFlight: 2` prova a paralelização real.

## Regras do produto implementadas

1. **Avaliação individual considera TODOS os nomes de colunas e TODOS os valores.**
   O `state` enviado ao Jev é `{ "row": { "<Nome da Coluna>": "<valor>", ... } }`,
   um por um (valores longos truncados para caber no orçamento de tokens).
2. **Coluna temporária SIM/NÃO.** A coluna `Filtro IA (temporário)` já existe no
   grid, mas fica **sempre limpa** até um envio. `Limpar coluna` volta ao estado
   limpo. Editar uma célula limpa o veredito daquela linha (nunca fica resultado
   desatualizado).
3. **Cache por (prompt, dados da linha).** A chave SHA-256 inclui o modelo, o
   prompt normalizado, os **nomes + chaves de todas as colunas** e **todos os
   valores** da linha. Na prática:
   - mesmo prompt + mesmo dado → sai da cache, zero chamadas à API;
   - novas inserções → analisa-se só o que é novo;
   - prompt mudado → reanalisa tudo;
   - valor de célula editado → reanalisa só essa linha;
   - erros **nunca** entram na cache (podem ser repetidos).
   A cache persiste em `data/jev-cache.json` (escrita atómica).
4. **Máximo de concorrência simultâneo.** Pool com teto (32 por omissão,
   `JEV_CONCURRENCY`, máx. 64). O transporte da lib Jev mantém até 50 sockets
   quentes (HTTP keep-alive), então a rajada toda sai em paralelo: 18 decisões
   reais em ~1 s. Linhas duplicadas partilham uma única decisão.

## Como a decisão é feita (Jev)

Requisição por linha (primitiva `noul`, uma decisão atómica):

```json
{
  "model": "typesafe/jev-1.13",
  "state": { "row": { "Empresa": "Marítima Norte", "Última Mensagem do Cliente": "…vamos sair…" } },
  "questions": {
    "aderente": {
      "type": "noul",
      "instructions": "You are the AI filter of a spreadsheet tool. Decide whether the data row given in the state is ADHERENT to the assertion/question stated by the user below. User's assertion/question (decide against it literally): \"\"\" … \"\"\" … Consider EVERY column name and EVERY value.",
      "criteria": { "true": "The row matches…", "false": "The row does not match…" }
    }
  }
}
```

- `p = answers.aderente.noul` → **SIM** se `p ≥ 0.5`, senão **NÃO**;
- a **banda de ação** (`auto` ≥ 0.90 de certeza · `hitl` ≥ 0.50 · perto de 0.5 =
  indeciso) vem da lib Jev e aparece no tooltip da célula junto com `p(aderente)`;
- instruções em inglês de propósito (a TypeSafe documenta melhor precisão em
  inglês); a afirmação do utilizador entra literalmente;
- cada pedido passa pela **validação offline** da lib Jev (`validateRequest`) e
  cada resposta pela validação de coerência (`validateResponse`) — resposta
  inválida vira `ERRO`, nunca um veredito inventado.

## Arquitetura

```
src/            React + Vite · AG Grid Community (planilha completa)
  components/   SheetGrid (coluna temporária incluída), AiFilterBar
  lib/api.ts    cliente HTTP + parser NDJSON do stream de progresso
server/         Express 5 · pipeline de análise
  analyze.ts    cache incremental + dedup + pool de concorrência + eventos
  jev-request.ts construtor do pedido + mapeamento SIM/NÃO + validação
  cache.ts      cache JSON persistente (escrita atómica)
  cache-key.ts  chave SHA-256 (prompt + nomes de colunas + valores)
  pool.ts       mapPool com teto de concorrência
  jev/vendor/   lib Jev EXISTENTE da skill jev-agent-skill (cópias byte a byte
                idênticas — ver server/jev/vendor/PROVENANCE.md; não reescrevemos
                o protocolo)
shared/         tipos + dados de demonstração partilhados
tests/          unit (42) · ui (6) · integration ao vivo (4)
e2e/            Playwright (2) contra a app real + Jev real
```

**Decisões**: AG Grid Community (MIT) em vez de inventar tabela — edição,
ordenação, filtros, resize, reordenação, seleção, undo/redo, paginação e export
CSV saíram da caixa; a lib Jev da skill foi **vendorizada sem alterações** (SHA-256
verificado) em vez de reimplantar o protocolo; o backend existe para guardar a
chave fora do browser e persistir a cache.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | modelo, chave, entradas de cache, concorrência |
| POST | `/api/analyze` | análise completa → JSON (`results` + `stats`) |
| POST | `/api/analyze/stream` | mesma análise com progresso NDJSON (`start`/`result`/`done`) |
| POST | `/api/cache/clear` | esvazia a cache persistente |

`POST /api/analyze` (e `/stream`) aceita `{ prompt, columns: [{key,name}], rows: [{id, …}] }`.

## Configuração (.env)

```
OPENROUTER_API_KEY=sk-or-v1-…   # obrigatória (nunca commitada — .gitignore)
JEV_MODEL=typesafe/jev-1.13
JEV_CONCURRENCY=32              # máximo simultâneo (1..64)
PORT=8787
JEV_CACHE_PATH=data/jev-cache.json   # opcional
```

## Auditoria UX/UI

`docs/ux-audit.json` — avaliação da interface pela framework uxuiprinciples
(195 princípios), reavaliada após correções: **94/100 (banda `excellent`)**.
Os 5 findings da primeira auditoria (transparência da IA só em tooltip, bandas
hitl indistinguíveis, limpeza sem desfazer, estatísticas densas, falta de
cancelamento) foram corrigidos; restam 2 sugestões (terceiro estado "REVER"
para p≈0.5 e botão "Repetir erros"). Sem `UXUI_API_KEY` configurada
(`api_enriched: false`).

## Aprendizados da construção

`docs/learnings.md` — detalhes de API que nos corrigiram durante o trabalho
(bandas `noul`, AG Grid v36, cache por conteúdo).
