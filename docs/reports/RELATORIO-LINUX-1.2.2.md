# Relatório Linux — ONÇA PDV 1.2.2

## Diagnóstico (antes da correção)

| Campo | Valor |
|---|---|
| DISTRIBUIÇÃO | Ubuntu 24.04.4 LTS (noble) |
| VERSÃO | 1.2.1 (pacote que falhou) |
| ARQUITETURA | x86_64 |
| ELECTRON | 33.2.1 |
| NODE EMBUTIDO | 22.14.0 |
| ERRO EXATO | `dlopen(): error loading libfuse.so.2` / `AppImages require FUSE to run.` |
| STACK | Falha no runtime AppImageKit antes de carregar o Electron |

## Causa original

O **AppImage** depende de **FUSE2 (`libfuse.so.2`)**. Em Ubuntu 24.04 isso frequentemente não está instalado → o app **não abre**.

Separação de falhas:
- `linux-unpacked` / API Node + SQLite: **funcionavam**
- AppImage: **falhava no FUSE**
- CUPS (`lpstat`/`lp`): ausente neste ambiente de build (fallback tratado)

## Arquivos alterados

- `electron/main.cjs` — `--no-sandbox` só em Linux
- `electron/cupsLinux.cjs` — adapter CUPS
- `electron/printerIpc.cjs` — Electron → CUPS no Linux; Windows inalterado
- `electron/preload.cjs` — `getLinuxPrintDiag`
- `server/src/services/supportService.js` — diagnóstico Linux/CUPS
- `server/src/db/paths.js` — pasta `configuracoes/`
- `web/.../ConfiguracoesPage.tsx` — seção LINUX / IMPRESSÃO
- `scripts/pack-linux-portable.mjs` — tar.gz sem FUSE + launcher
- `electron-builder.yml` — target `tar.gz`

## Resultado

| Item | Status |
|---|---|
| LINUX APP (smoke xvfb neste ambiente) | OK (1.2.2 health + SQLite em userData) |
| SQLITE | OK |
| CUPS | OK em código (fallback); neste host CUPS não instalado |
| LISTAGEM DE IMPRESSORAS | OK (caminho Electron+CUPS); hardware real PENDENTE |
| IMPRESSÃO REAL | PENDENTE |
| BLUETOOTH | PENDENTE (BlueZ auxiliar) |
| WINDOWS REGRESSION | BUILD OK (artefatos 1.2.2 gerados); hardware real não retestado aqui |

## Validação honesta

- BUILD LINUX: **OK**
- TESTES AUTOMATIZADOS: **107/107**
- TESTE EM HARDWARE LINUX REAL: **PENDENTE**
- TESTE DE IMPRESSORA REAL: **PENDENTE**

**Linux não está marcado como compatibilidade aprovada** até validação na sua máquina.
