# Impressão

## Arquitetura única

Teste, venda, reimpressão e segunda via passam por `IPrintService`. O documento é renderizado por `IReceiptRenderer`; não existem HTML, navegador, iframe, CSS ou `window.print()`. `QueuedPrintService` apenas registra o estado e decora o mesmo serviço.

Fluxo: operação → `IPrintService` → `IReceiptRenderer` → validação → MOCK ou transporte RAW. `IPhysicalPrinterTransport` é a única fronteira com Win32. A implementação real encapsula OpenPrinter, StartDocPrinter, StartPagePrinter, WritePrinter, EndPagePrinter, EndDocPrinter e ClosePrinter.

## Bloqueios

1. O renderer precisa concluir sem erro.
2. `ReceiptValidator` bloqueia conteúdo vazio com `PRINT BLOCKED - EMPTY RECEIPT`.
3. TXT e BIN de depuração são gravados antes do spooler.
4. `PHYSICAL_PRINTING=false` bloqueia antes de consultar ou chamar APIs físicas.
5. Impressora offline retorna `IMPRESSORA OFFLINE — Nenhum dado foi enviado`.
6. Falhas registram estágio, bytes solicitados/escritos e erro Win32.

## MOCK e encoding

Cada solicitação cria TXT e BIN com GUID. O gate confirmou 1.000 solicitações, 1.000 renderizações, 1.000 conclusões, nenhuma exceção e zero chamadas físicas.

`IPrinterEncoding` separa a codificação do renderer. `CodePagePrinterEncoding` oferece CP850, CP858 e CP860 e aceita outras code pages. UTF-8 não é presumido.

## Condições para teste físico futuro

- fila vazia e térmica online;
- pessoa observando a impressora;
- nome vindo da enumeração do Windows;
- mock curto aprovado e TXT/BIN conferidos;
- habilitação temporária explícita;
- uma única tentativa e retorno imediato para `PHYSICAL_PRINTING=false`.

Até nova validação manual, o botão físico permanece desabilitado.

## Transporte básico homologado localmente

Uma tentativa manual controlada enviou 39 bytes ASCII puros com CRLF pela fila `POS-80`, datatype `RAW`, porta `USB001`. Todas as chamadas Win32 concluíram, 39/39 bytes foram escritos, o job saiu da fila e o texto foi impresso corretamente. O papel já estava cortado antes do teste; não houve corte causado pelo sistema.

- `RAW TRANSPORT = PASS`
- `WINDOWS SPOOLER = PASS`
- `USB001 = PASS`
- `POS-80 RAW TEXT = PASS`
- `PHYSICAL PRINT BASIC = PASS`

Após a tentativa, `PHYSICAL_PRINTING=false`. O cupom real continua exclusivamente em MOCK, sem corte e sem gaveta.

O cupom comercial físico de 80 mm também foi aprovado pelo operador: conteúdo completo e legível, 549/549 bytes, `JobId=5`, sem folha branca e sem corte solicitado. Status final: `POS-80 = PASS`, `RAW/USB001 = PASS`, `cupom real físico = PASS`, `80 mm = PASS`, `CP850 = PASS`, `folha branca = RESOLVIDO`. O subsistema está congelado e só deve ser alterado se surgir bug real.
