# Relatório — Fase 1 (Backup JSON + Impressoras + Logo)

**Status:** implementada e validada em ambiente Linux/cloud (automatizado).  
**Branch:** `cursor/onca-pdv-fase1-json-impressoras-logo-2c6b`  
**Base:** Etapa 5 (`1.0.0`)

## Escopo entregue

1. **Importar Backup Antigo JSON** (aba separada de Restaurar `.db`)
   - Validação, SHA-256, contagens, conflitos, duplicidades
   - Prechecks `integrity_check` + `foreign_key_check`
   - Backup de segurança + importação em transaction com rollback
2. **Configurações > Impressoras**
   - Comprovante / relatórios / padrão ONÇA
   - Usar impressora padrão do Windows
   - Perfil A4 / 80mm / 58mm, cópias, auto/manual
   - Testar impressão via IPC Electron (desktop)
3. **Configurações > Empresa — Logo**
   - PNG/JPG/JPEG/WEBP em `{dataDir}/assets/brand/`
   - Exibição discreta: Login, cabeçalho, Sobre, comprovante, PDF
   - Sem logo oficial fornecido: mantém marca **ON** (não inventa outro logo)

## Migrations

- `013_fase1_printers_logo.sql` — chaves de settings para logo e impressoras

## Backup de segurança (pré-Fase 1)

Ver `docs/reports/FASE1-PRECHECK.json`.

## Pendências

- **PENDENTE DE TESTE EM WINDOWS REAL:** listagem de impressoras instaladas, teste de impressão física, persistência após reinício do app desktop, upload do logo oficial da ONÇA.
- Fases 2–7 **não iniciadas** (regra: só avançar após aprovação da Fase 1).

## Item Diversos

Não alterado. Regressão coberta pelos testes existentes de vendas.
