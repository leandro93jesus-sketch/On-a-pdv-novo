# Gate — printing mock final

Data: 03/09/2026

- Testes totais: 29; aprovados: 29; falhos: 0.
- Resistência MOCK: 1.000 solicitadas, 1.000 renderizadas, 1.000 concluídas.
- Total MOCK na suíte: 1.103.
- Chamadas a APIs físicas: 0.
- Cupom vazio: `PRINT BLOCKED - EMPTY RECEIPT`; chamadas físicas 0.
- Offline simulado: `IMPRESSORA OFFLINE — Nenhum dado foi enviado`; chamadas físicas 0.
- Online simulado com modo desligado: `Impressão física bloqueada por configuração`; chamadas físicas 0.
- Renderer falhando: cancelado antes de disponibilidade/spooler; chamadas físicas 0.
- Encoding: `IPrinterEncoding`; CP850, CP858 e CP860 testadas sem hardware.
- ASCII exato: `ONCA\nTESTE DE IMPRESSAO\nIMPRESSORA OK\n`.
- Bytes: 43.
- Hex: `1B404F4E43410A544553544520444520494D5052455353414F0A494D50524553534F5241204F4B0A1B6402`.
- Inicialização `1B 40`: presente; LF: presente; corte: ausente; gaveta: ausente.
- `PHYSICAL_PRINTING=false`: preservado.

O primeiro ensaio de carga detectou colisão de arquivos baseados em milissegundos (432 evidências). O nome recebeu GUID e a repetição passou com 1.000 BIN e 1.000 TXT distintos.

Pendências: teste físico somente mediante validação manual; pagamento misto; clientes/crediário; PDF; relatórios e evolução de backup. Fiscal real não iniciado e legado intocado.
