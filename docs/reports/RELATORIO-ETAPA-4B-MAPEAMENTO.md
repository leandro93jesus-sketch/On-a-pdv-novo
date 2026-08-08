# Relatório final — Etapa 4B (mapeamento do backup JSON real)

## Escopo cumprido
- Leitura somente do JSON (arquivo não modificado)
- Banco SQLite principal **não** alterado
- Inventário, campos, mapeamento, qualidade, finanças, estoque
- Adaptador específico `oncas_pdv_v2`
- Simulação em banco temporário com validação OK
- Documentação atualizada em `docs/MIGRACAO-BACKUP-ANTIGO.md`

## Arquivo
- Nome: `oncas-pdv-backup-2026-08-07-1786145822438_eda5.json`
- Bytes: 223981
- SHA-256: `6389a693b4f9f2f0d6c8b1781e633767db5e32913a26933d7c43212d0a112d70`
- JSON válido: sim
- App: Oncas PDV v2

## Inventário resumido
488 produtos · 7 clientes · 87 vendas · 210 itens · 204 movimentações · 0 fornecedores · 0 compras · 0 crediário · 0 entregas · 0 devoluções · 2 caixas (history)

## Financeiro
- Total vendas: **R$ 3.430,53**
- Crediário aberto/pago/pendente: **R$ 0,00**
- Pagamentos: PIX, Cartão débito/crédito, Dinheiro

## Estoque
- Soma: 214763
- Zero: 12 · Negativo: 4 · Códigos duplicados: 38

## Simulação (temp)
- validation.ok = **true**
- produtos/clientes/vendas/itens/totais/estoque: **match**
- erros: **0**
- Importação definitiva: **NÃO executada**

## Artefatos
- `docs/MIGRACAO-BACKUP-ANTIGO.md`
- `docs/reports/ANALISE-ESTRUTURA-ONCAS-PDV-V2.json`
- `docs/reports/ANALISE-QUALIDADE-ONCAS-PDV-V2.json`
- `docs/reports/SIMULACAO-IMPORT-ONCAS-PDV-V2.json`
- `server/src/services/legacyImport/mapOncasPdvV2.js`
- `server/src/services/legacyImport/simulateOncasPdvV2.js`
