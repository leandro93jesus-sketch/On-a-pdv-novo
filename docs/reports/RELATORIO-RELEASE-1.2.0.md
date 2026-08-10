# Release 1.2.0 — ONÇA PDV

**Data/hora do build:** 2026-08-09 ~23:35 UTC  
**Branch:** `cursor/onca-pdv-mestre-1-2-0-2c6b`  
**Tag:** `v1.2.0`  
**PR:** https://github.com/leandro93jesus-sketch/On-a-pdv-novo/pull/18

## Alterações

- Pedidos de entrega aguardando pagamento + reserva de estoque
- Pagamento parcial / PIX pendente / confirmação idempotente
- Pedido não pago não entra no caixa
- Escolha de impressora na hora + fila/log
- Config portátil `impressoras.json` (export/import/match)
- Bluetooth desktop (Windows PnP / Linux BlueZ)
- AppImage Linux + ZIP portátil Windows com LEIA-ME

## SHA-256

| Arquivo | SHA-256 |
|---|---|
| `ONCA-PDV-Setup-1.2.0.exe` | `f7a025911165212e1bce0dfa967b85cb78a2700b0a15feb488582967d597e069` |
| `ONCA-PDV-1.2.0-PORTATIL-WINDOWS-X64.zip` | `17fab3a510b1bfad264f5b51d1d7cedccbfbf932f138945406f51711f188e3a5` |
| `ONCA-PDV-1.2.0-linux-x86_64.AppImage` | `c9464459119b478ea272848ed194e6330ce3cd66b74103f56f3d12f209a0554e` |

## Testes

- `npm test` 99/99
- lint / build OK
- SQLite integrity_check / foreign_key_check no banco real
- TESTE COM HARDWARE REAL (impressora/Bluetooth físico): **PENDENTE**
