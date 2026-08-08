# Pendência — E2E UI smoke Etapa 3 (computer-use)

## Status
**NÃO CONCLUÍDO POR TRAVAMENTO** — teste visual `E2E UI smoke Etapa 3` (subagente `computerUse`).

**NÃO APROVADO.**

## O que foi feito
1. Interrompido somente o smoke UI (sessão Chrome `remote-debugging-port=9222` encerrada).
2. API (`:3001`) e interface Vite (`:5173`) preservadas.
3. Código/alterações da Etapa 3 preservados (sem revert).
4. O agente computer-use **não** foi retomado (`resume` não utilizado).
5. Esse smoke visual **não** é tratado como aprovado.

## Substituição
Foi adotado o E2E com timeout explícito:

```bash
npm run e2e:etapa3
```

- timeout global: 120s (`E2E_TIMEOUT_MS`)
- timeout por request: 10s (`E2E_REQ_TIMEOUT_MS`)
- cobre API real (fornecedores, compras, crediário, devoluções, entregas) + HTTP das rotas UI + integridade SQLite

## Observação
O smoke visual por computer-use permanece pendente como melhoria futura; não bloqueia a regressão automatizada/API se `e2e:etapa3` e as demais suítes críticas passarem.
