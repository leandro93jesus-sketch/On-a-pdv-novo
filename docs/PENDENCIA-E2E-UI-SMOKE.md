# Pendência — E2E UI smoke Etapa 3 (computer-use)

## Status
**NÃO CONCLUÍDO / NÃO APROVADO** — travamento do teste visual `E2E UI smoke Etapa 3` (subagente `computerUse`).

## O que foi feito
1. Tentativa de interrupção do processo do smoke UI.
2. No ambiente não havia PID isolado do subagente ainda em execução (apenas Chrome ocioso da sessão e API/web saudáveis).
3. O agente **não** foi retomado (`resume` não utilizado).
4. Esse smoke visual **não** é tratado como aprovado.

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
