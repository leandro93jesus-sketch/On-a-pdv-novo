# Gate — cupom real em MOCK

O transporte físico básico foi confirmado pelo usuário: o conteúdo `ONCA / TESTE TEXTO PURO / IMPRESSORA OK` foi impresso. O papel já estava cortado; não houve corte prematuro do ONCA-PDV-PRO.

Resultados registrados: `RAW TRANSPORT = PASS`, `WINDOWS SPOOLER = PASS`, `USB001 = PASS`, `POS-80 RAW TEXT = PASS` e `PHYSICAL PRINT BASIC = PASS`.

O cupom real foi implementado no renderer RAW compartilhado, preparado para 80 mm (48 colunas) e CP850 configurável. Venda e reimpressão continuam entrando pelo mesmo `IPrintService`; reimpressão apenas acrescenta o rótulo `REIMPRESSAO / SEGUNDA VIA`. Cada renderização produz um único payload. Corte e gaveta estão desabilitados.

Conteúdo integrado: empresa, venda, data, operador, cliente opcional, produtos, quantidade, descrição limitada à largura, valor unitário, subtotal, total, pagamentos traduzidos, recebido, troco e mensagem final.

Cenários MOCK: 1 produto, vários produtos, nome longo, dinheiro, troco, PIX, cartão, crediário, pagamento misto e reimpressão. Os payloads variam conforme o conteúdo; no conjunto de referência ficaram entre 475 e 627 bytes. Previews TXT e payloads BIN estão em `gate-real-receipt-mock/real-receipt-mock`.

O bloqueio `PRINT BLOCKED - EMPTY RECEIPT` foi preservado. Estado final: `PHYSICAL_PRINTING=false`, zero novas chamadas físicas durante este gate MOCK.
