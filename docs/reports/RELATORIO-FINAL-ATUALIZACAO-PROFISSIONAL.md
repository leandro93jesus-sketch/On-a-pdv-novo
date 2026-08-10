# Relatório consolidado — Atualização profissional ONÇA PDV 1.1.0

**Data:** 2026-08-08  
**Validação automatizada:** Linux/cloud  
**Hardware Windows real:** PENDENTE DE TESTE EM WINDOWS REAL

## Fases concluídas

| Fase | Escopo | Status automatizado | Branch / PR |
|---|---|---|---|
| 1 | Backup JSON + Impressoras + Logo | APROVADA | `cursor/onca-pdv-fase1-json-impressoras-logo-2c6b` (#10) |
| 2 | Duplicados + Estoque | APROVADA | `cursor/onca-pdv-fase2-duplicados-estoque-2c6b` (#11) |
| 3 | Vendas (misto, histórico, qty) | APROVADA | `cursor/onca-pdv-fase3-vendas-misto-2c6b` (#12) |
| 4 | Segurança operacional | APROVADA | `cursor/onca-pdv-fase4-seguranca-2c6b` (#13) |
| 5 | Exportação + Suporte | APROVADA | `cursor/onca-pdv-fase5-suporte-export-2c6b` (#14) |
| 6 | Responsividade | APROVADA | `cursor/onca-pdv-fase6-7-release-2c6b` |
| 7 | Critérios + artefatos 1.1.0 | APROVADA (auto) | `cursor/onca-pdv-fase6-7-release-2c6b` |

## Melhorias implementadas

### Fase 1
- Import JSON antigo separado de restore `.db` (SHA-256, prechecks, rollback)
- Impressoras + perfil A4/80/58 + logo persistente em `{dataDir}/assets/brand/`

### Fase 2
- Verificador de duplicados (barcode/sku/nome exato/similar) e mesclagem segura com auditoria
- Bloqueio preventivo de barcode/sku duplicado; aviso de nome similar
- Estoque: Entrada / Saída / Definir saldo + histórico do produto

### Fase 3
- Pagamentos: Dinheiro | Pix | Cartão / Crediário | Misto | Histórico
- Pagamento misto com soma **exatamente** igual ao total; métodos gravados separadamente
- Troco (`amount_received_cents` / `change_cents`); quantidade digitável `[-][n][+]`
- Histórico filtrado; **Item Diversos não alterado** (regressão OK)

### Fase 4
- Instância única (Electron + lock no data dir); journal de recuperação
- Histórico de preços; debounce de leitor (~450 ms); permissões sensíveis em estoque
- Ajuste de caixa fechado + reimpressão

### Fase 5
- Export CSV (produtos/estoque/clientes/vendas/crediário)
- Diagnóstico de suporte sem senhas

### Fase 6
- CSS responsivo (1366 / ≤1180, carrinho sticky, botões de pagamento, DPI 125%/150%)
- Sem reduzir tipografia/botões já aprovados

### Fase 7
- Versão **1.1.0**; artefatos Windows sem banco real embutido
- Critérios de aceite automatizados validados neste relatório

## Migrations

- `013_fase1_printers_logo.sql`
- `014_fase2_duplicates_stock.sql`
- `015_fase3_sale_change.sql`
- `016_fase4_security.sql`

## Testes automatizados (antes da geração final)

- `npm test` — **89/89 PASS** (inclui Item Diversos)
- `npm run lint` — PASS
- `npm run build` — PASS
- SQLite `integrity_check` — ok
- `foreign_key_check` — 0 linhas
- Vendas legacy `oncas_pdv_v2` — **87 preservadas**

## Artefatos gerados (sem banco real)

| Arquivo | Tamanho aprox. | Local |
|---|---|---|
| `ONCA-PDV-Setup-1.1.0.exe` | ~97 MB | `release/dist/` e `/opt/cursor/artifacts/release/` |
| `ONCA-PDV-1.1.0-win-x64.zip` | ~153 MB | `release/dist/` e `/opt/cursor/artifacts/release/` |

Build Windows via `PDV_DESKTOP_PLATFORM=win` (Node Windows/`node.exe` no empacotamento).  
`desktop-resources/server/data` **não** está embutido no instalador.

SHA-256:

- Setup: `a8ba6e290cc98d44e508372eea498c133f43642b84a466de27ec54956590ffbe`
- Zip: `38fe5dd903fa63d2c212a293b5af761543b6c3d7eb2d8fe2d4fe440eeb9514e6`

## Item Diversos

Não alterado. Regressão automatizada OK (venda avulsa sem baixa de estoque).

## Dados reais

- Banco principal preservado (`server/data/onca-pdv.db`)
- Backups pré-fase em `server/data/backups/onca-pdv-backup-pre-faseN-*.db`
- Nenhuma reseeding destrutiva

## Pendências Windows real

Checklist pendente em máquina Windows do cliente:

1. Abrir app / login  
2. Leitor de código de barras  
3. Impressora térmica / A4  
4. Venda simples + misto + troco  
5. Estoque (entrada/saída/definir saldo)  
6. Histórico de vendas  
7. PDF / WhatsApp (se aplicável)  
8. Import JSON / restore  
9. Fechamento de caixa  
10. Reinício e recuperação

## Veredito

**ATUALIZAÇÃO DO ONÇA PDV CONCLUÍDA E VALIDADA (AUTOMATIZADO) — PRONTA PARA TESTES FINAIS EM WINDOWS REAL.**

Não declarar validação de hardware Windows a partir deste ambiente Linux/cloud.
