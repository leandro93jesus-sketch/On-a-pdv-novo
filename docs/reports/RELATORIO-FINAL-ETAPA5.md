# Relatório Final — Etapa 5 — ONÇA PDV 1.0.0

Data: 2026-08-08

## Revisão visual realizada

Telas cobertas por smoke UI autenticado (Chrome headless) + revisão de código/CSS:

Login, Vendas, Caixa, Produtos, Estoque, Clientes, Fornecedores, Compras, Crediário, Devoluções, Entregas, Relatórios, Backup, Configurações.

Ajustes de UX aplicados:

- Total da venda com destaque maior
- Botões de pagamento maiores
- Carrinho mais amplo
- Totalizador de caixa (dinheiro/Pix/cartão/crediário + esperado/informado/diferença)
- Comprovante com marca ONÇA PRODUTOS DE LIMPEZA
- Campo de WhatsApp no modal
- Versão 1.0.0 no shell e login
- Troca obrigatória de senha no primeiro acesso

## Bugs encontrados / corrigidos

| Item | Status |
| --- | --- |
| Review Etapa 1 falhava com estoque baixo no 1º produto real | Corrigido (seleção por estoque ≥ 5) |
| Negativos legados quebravam checks de “estoque negativo indevido” | Ajustado (preserva `oncas_pdv_v2`) |
| UI E2E sem auth (AuthGate) | Corrigido (`e2e:ui:etapa5` + bootstrap) |
| Crediário E2E usava `status=open` | Corrigido (`aberto`) |
| ABI mismatch Node embutido × better-sqlite3 | Corrigido (Node = versão do host) |
| NSIS no Linux exigia Wine/elevate | Corrigido (`packElevateHelper: false`) → Setup 97 MB |

## Dados de teste removidos / tratados

- `Produto Review E2` e `Cliente Review` → **inativados** (tinham histórico de venda; não apagados)
- Relatórios: `docs/reports/ETAPA5-LIMPEZA-DADOS-TESTE.json`, `ETAPA5-PURGE-REVIEW.json`
- Vendas de validação E2E/review **preservadas** (não são demo seed)

## Dados reais preservados

| Métrica | Valor |
| --- | --- |
| Produtos legacy (`oncas_pdv_v2`) | 488 |
| Clientes legacy | 7 |
| Vendas legacy | 87 |
| integrity_check | ok |
| foreign_key_check | 0 violações |
| Estoques negativos legacy | 4 (preservados, não corrigidos) |

## Testes executados

| Suíte | Resultado |
| --- | --- |
| `npm test` (61) | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `review:etapa1` … `review:etapa5` | PASS |
| `etapa5:restore-isolated` | PASS |
| `e2e:etapa3` | PASS |
| `e2e:etapa4` | PASS |
| `e2e:etapa5` (36) | PASS |
| `e2e:ui:etapa5` (16) | PASS |
| `e2e:ui:etapa3` (legado sem auth) | FAIL esperado (substituído pela Etapa 5) |
| Smoke API do pacote desktop (Node embutido + web-dist + DB cópia) | PASS |
| Instalação real do `.exe` em Windows 10/11 | **NÃO EXECUTADA NESTE AMBIENTE** |

## Status por área

| Área | Status | Nota |
| --- | --- | --- |
| PDF | OK | COMPROVANTE DE VENDA / não fiscal |
| WhatsApp | OK | Link `wa.me`; PDF **não** anexado automaticamente |
| Impressão | OK (UI) | `window.print` + PDF; impressora padrão do SO |
| Backup | OK | Criação + histórico |
| Restauração | OK | Validada só em cópia isolada |
| Desktop | OK (build) | Electron 33 + Node embutido + AppData |
| Instalador | BUILD OK | `ONCA-PDV-Setup-1.0.0.exe` gerado; **não instalado em Windows real** |

## Artefatos

| Arquivo | Tamanho | SHA-256 |
| --- | --- | --- |
| `release/dist/ONCA-PDV-Setup-1.0.0.exe` | ~97 MB | `fb6f9386f40c6cc7491da221e81a8dbab0f8240db4726300c118d5d1532d419a` |
| `release/dist/ONCA-PDV-1.0.0-win-x64.zip` | ~153 MB | `3d311b720fa58a2d6b2fbebba79b9355a77b32fece7da19ad18f7dc6cc8e4bee` |
| `release/dist/ONCA-PDV-Setup-1.0.0.zip` | ~147 MB | `9fb978527faa2c2d1a78f0cbe9484f9907bc248bd11c8e1391953710fa14b133` |

Cópias em `/opt/cursor/artifacts/release/`.

Docs de entrega: `release/README.md`, `CHANGELOG.md`, instruções de instalação/backup/restauração.

## Limitações reais

1. **Instalador Windows não foi executado em máquina Windows** neste ambiente Linux — pendência crítica de aceite final.
2. WhatsApp não anexa PDF automaticamente (limitação da plataforma).
3. 4 produtos com estoque negativo vindos do backup legado (preservados).
4. Windows 7 **não suportado** (Electron 33 / Node 22).
5. Senha bootstrap ainda existe até o primeiro login concluir a troca (`must_change_password=1`).
6. `e2e:ui:etapa3` antigo falha sem sessão; usar `e2e:ui:etapa5`.

## Pendências críticas

- Instalar `ONCA-PDV-Setup-1.0.0.exe` em Windows 10/11 limpo
- Confirmar abertura sem terminal, login, venda, PDF, backup e encerramento no app instalado
- Definir senha definitiva do administrador no primeiro uso

## Versão

**ONÇA PDV 1.0.0** (build 2026.08.08)
