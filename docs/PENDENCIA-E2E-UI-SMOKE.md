# Pendência — E2E UI smoke Etapa 3 (computer-use)

## Status
**SUBSTITUÍDO E NÃO BLOQUEANTE** — o smoke visual interativo via subagente `computerUse` travou no agente anterior e **não** foi retomado.

## Continuação (este agente)
1. Código da Etapa 3 preservado (sem revert / sem apagar arquivos).
2. E2E simplificado com timeout global ≤ 5 minutos:
   - `npm run e2e:etapa3` — **APROVADO** (API + rotas UI HTTP + SQLite)
   - `npm run e2e:ui:etapa3` — **APROVADO** (Chrome headless dump-dom + screenshot; ~245s < 300s)
3. Se o headless ultrapassar o timeout, o processo aborta sozinho (sem espera infinita).

## Observação
O computer-use interativo permanece opcional; a validação de interface da Etapa 3 é coberta por `e2e:ui:etapa3`.
