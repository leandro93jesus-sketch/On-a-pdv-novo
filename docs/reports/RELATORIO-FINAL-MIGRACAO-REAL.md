# Relatório final — Importação do backup JSON real

## Autorização
Importação definitiva autorizada pelo responsável. Adaptador usado: **`oncas_pdv_v2`**.

## Pré-importação
| Item | Resultado |
| --- | --- |
| Backup automático | `onca-pdv-backup-2026-08-08-160524.db` |
| SHA-256 do backup | registrado em manifesto + `backup_history` |
| SHA-256 do JSON | `6389a693b4f9f2f0d6c8b1781e633767db5e32913a26933d7c43212d0a112d70` |
| `integrity_check` prévio | **ok** |
| `foreign_key_check` prévio | **0** |
| JSON modificado? | **Não** |

## Limpeza de dados de desenvolvimento
Removidos com segurança (dados de seed/review/e2e):
- 19 produtos demo
- 7 clientes de teste
- 31 vendas de teste
- 4 fornecedores de teste

Preservados: `users` (admin), estrutura `settings`, migrations, históricos de backup/import do sistema.

## Comparativo JSON × SQLite

| Entidade | JSON | Importado | Ignorado | Match |
| --- | ---: | ---: | ---: | --- |
| Produtos | 488 | 488 | 0 | OK |
| Clientes | 7 | 7 | 0 | OK |
| Vendas | 87 | 87 | 0 | OK |
| Itens de venda | 210 | 210 | 0 | OK |
| Pagamentos | 87 | 87 | 0 | OK |
| Movimentações | 204 | 204 | 0 | OK |
| Fornecedores | 0 | 0 | 0 | OK |
| Crediário | 0 | 0 | 0 | OK |
| Compras | 0 | 0 | 0 | OK |
| Entregas | 0 | 0 | 0 | OK |
| Devoluções | 0 | 0 | 0 | OK |
| Sessões caixa (history) | 2 | 2 | 0 | OK |

### Financeiro
- Total vendas legado: **R$ 3.430,53** (343053 centavos) — **match**
- Crediário: 0 contas

### Estoque
- Soma estoque JSON = DB = **214763** — **match**
- Zero: 12 · Negativos permitidos (legado): 4 · Negativos indevidos: **0**
- Códigos duplicados no JSON: 36 conflitos tratados (1º mantém barcode; demais sem barcode, sem sobrescrita)

### Conflitos / erros
- Erros críticos: **0**
- Rollback: não necessário
- Campos desconhecidos registrados no relatório de importação (não descartados silenciosamente)

## Validação pós-importação
| Check | Resultado |
| --- | --- |
| `integrity_check` | **ok** |
| `foreign_key_check` | **0** |
| Órfãos `sale_items` | **0** |
| Usuário admin | preservado |
| Empresa | Onça Produtos de Limpeza / CNPJ 48566983000154 |

## Teste operacional pós-migração
1. API/UI iniciadas (rotas `/produtos`, `/estoque`, `/clientes`, `/vendas`, `/crediario`, `/fornecedores` → HTTP 200)
2. Dados reais presentes (ex.: clientes STHEPHANY MARTINS, LEANDRO ONCINHA…; produtos ACOOL ZULU, ÁGUA SANITÁRIA…)
3. Nova venda de teste: produto importado `AGUA SANITARIA ZUCCO 2L` (`L-362`)
   - estoque 997 → **996**
   - venda `VD-20260808-000088` registrada
4. Histórico legado preservado: **87** vendas com `legacy_source=oncas_pdv_v2`

## Artefatos
- `docs/reports/IMPORTACAO-REAL-ONCAS-PDV-V2.json`
- `server/src/services/legacyImport/importOncasPdvV2Real.js`
- `scripts/import-oncas-v2-real.mjs`
- Backup: `server/data/backups/onca-pdv-backup-2026-08-08-160524.db`
