# Release 1.2.1 — ONÇA PDV

**Data/hora do build:** 2026-08-09 ~23:51 UTC  
**Branch:** `cursor/onca-pdv-barcode-printer-fix-2c6b`  
**Tag:** `v1.2.1`  
**PR:** https://github.com/leandro93jesus-sketch/On-a-pdv-novo/pull/19

## Correções

1. Conferência por código de barras na separação de pedidos  
2. UI de impressoras/Bluetooth sem travar (timeouts, cancelar, reset)

## SHA-256

| Arquivo | SHA-256 |
|---|---|
| `ONCA-PDV-Setup-1.2.1.exe` | `b4b9135049a8d5b5edbd52b1d92db7f7e41393d2a3e85f22bef83d408d1714a8` |
| `ONCA-PDV-1.2.1-PORTATIL-WINDOWS-X64.zip` | `061500e1ed05e1619c4f1ac426c14a9eef1672dc1a0ab658dc4c850221a8a1dd` |
| `ONCA-PDV-1.2.1-linux-x86_64.AppImage` | `4226061cd74bef57e00aca037e7e3c9d981755174725c8e05c70fb0c49011f81` |

## Testes

- `npm test` 103/103
- lint / build OK
- SQLite integrity_check OK · FK 0
- Hardware real (impressora/Bluetooth físico): **PENDENTE**
