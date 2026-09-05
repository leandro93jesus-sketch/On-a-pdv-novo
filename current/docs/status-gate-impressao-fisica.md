# Gate — impressão física controlada

Data: 03/09/2026

## Resultado

**PRINT PHYSICAL TEST = NOT RUN — THERMAL PRINTERS OFFLINE**

## Incidente ao religar a impressora

Ao ligar a POS-80, o Windows retomou um trabalho antigo já existente na fila: documento `ONÇA PDV`, ID 2, enviado em 01/09/2026 21:40:49, 82.636 bytes, 16 páginas, estado `Error, Restarted`. Esse trabalho antecede este gate; a instrumentação atual havia confirmado `SpoolerCalled=false` e 0 bytes enviados.

O trabalho antigo foi removido. Verificação posterior: `REMAINING_JOBS=0` na POS-80 e nenhuma tarefa pendente nas demais filas. Não foi enviada nova impressão. `PHYSICAL_PRINTING` permanece false.

O Windows detectou quatro filas. `POS-80` é a padrão, porém `WorkOffline=True`. `KAPBOM KA-1445` e a fila `Generic / Text Only` na porta USB002 também estão offline. `AnyDesk Printer` está online, mas é virtual e não é uma térmica ESC/POS. Nenhum trabalho foi enviado ao spooler e a tentativa física única não foi consumida.

## Checklist objetivo

1. Impressoras: POS-80 (padrão, driver POS-80 11.3.0.0, USB001, offline); KAPBOM KA-1445 (Generic/Text Only, USB002, offline); Generic/Text Only (USB002, offline); AnyDesk Printer (virtual, online).
2. Selecionada para configuração: POS-80, exclusivamente pelo nome real enumerado.
3. Papel: 80 mm.
4. Renderer: EscPos80Renderer.
5. Bytes ESC/POS: 48.
6. Texto: 41 caracteres; contém ONÇA, TESTE DE IMPRESSÃO e IMPRESSORA OK.
7. Mock: PASS.
8. OpenPrinter: NÃO EXECUTADO, bloqueado antes do spooler.
9. StartDocPrinter: NÃO EXECUTADO.
10. WritePrinter: NÃO EXECUTADO.
11. Bytes enviados: 0.
12. Bytes escritos: 0.
13. Teste físico: não executado porque a térmica está offline.
14. Papel em branco: não houve papel.
15. Corte: desabilitado; comando de corte ausente no mock.
16. Código: instrumentação adicionada para registrar todos os estágios Win32 e contagens de bytes; mesma interface IPrintService mantida.
17. PHYSICAL_PRINTING: false/BLOQUEADO.
18. Pendência: colocar a POS-80 online e então executar exatamente uma tentativa curta, observando o papel.

## Evidências

- `gate-physical/result.json`
- `gate-physical/logs/print-last.txt`
- `gate-physical/logs/print-last-escpos.bin`
- primeiros bytes: `1B404F4EC387410D0A544553544520444520494D50524553`
- suíte: 20/20 testes aprovados; 0 falhas.

Venda, reimpressão e diagnóstico continuam utilizando IPrintService. O teste automatizado confirmou que reimpressão não cria venda nem movimentos de estoque/caixa.
