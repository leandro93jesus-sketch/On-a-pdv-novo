# Diagnóstico da tentativa física sem texto

Data do diagnóstico: 2026-09-04. Nenhuma nova impressão física foi executada. Ao final, `PHYSICAL_PRINTING=false`, fila POS-80 vazia e total de chamadas físicas adicionais igual a zero.

## Resultado Win32 preservado

Fonte: `gate-hardware-physical-once/physical-result.json` e `gate-hardware-physical-once/logs/printing-physical.log`.

| Etapa | Resultado |
|---|---:|
| `OpenPrinter` | sucesso (`true`) |
| `StartDocPrinter` | sucesso (`true`) |
| `StartPagePrinter` | sucesso (`true`) |
| `WritePrinter` | sucesso (`true`) |
| Bytes solicitados | 43 |
| Bytes declarados escritos | 43 |
| `EndPagePrinter` | sucesso (`true`) |
| `EndDocPrinter` | sucesso (`true`) |
| `GetLastWin32Error` | 0 (`ERROR_SUCCESS`; nenhum erro registrado) |
| `DOC_INFO_1.pDatatype` | exatamente `RAW` |

O retorno de `WritePrinter` significa que o pipeline de spool/monitor aceitou os 43 bytes. Ele não confirma que o firmware interpretou esses bytes nem que houve impressão visível.

## Payload exato

Hexadecimal, 43 bytes:

```text
1B 40
4F 4E 43 41 0A
54 45 53 54 45 20 44 45 20 49 4D 50 52 45 53 53 41 4F 0A
49 4D 50 52 45 53 53 4F 52 41 20 4F 4B 0A
1B 64 02
```

Interpretação:

- primeiro comando: `1B 40` (`ESC @`, inicialização);
- texto ASCII presente: `ONCA`, `TESTE DE IMPRESSAO`, `IMPRESSORA OK`;
- após cada linha existe `0A` (`LF`);
- não existe `0D` (`CR`), portanto o payload usa LF, não CRLF;
- comando final: `1B 64 02` (avanço de duas linhas);
- não há comando de corte nem de gaveta.

O SHA-256 do payload físico e do payload MOCK aprovado é o mesmo:

```text
FF6120773A5BDB4961528C821A89BB48010E8174A40486FC959991C70BCCE027
```

Logo, não houve divergência entre bytes MOCK e bytes encaminhados à tentativa física.

## Fila, driver e porta

Consulta local somente leitura:

| Campo | Valor |
|---|---|
| Fila | `POS-80` |
| Estado | Normal |
| Driver | `POS-80 11.3.0.0` |
| Porta | `USB001` |
| Datatype da fila | `RAW` |
| Processador | `winprint` |
| Jobs após diagnóstico | 0 |
| Monitor da porta | `Dynamic Print Monitor` |
| Dispositivo de USB001 | `USB\VID_0416&PID_5011\27CFCA867093` |

O driver é baseado em Unidrv (`UNIDRVUI.DLL`) e usa `POS80.GPD`. O GPD declara `PrinterType: SERIAL`, code page padrão 936 e modo padrão `zjGraphMode`; também contém modo `zjSoftFontMode` e opções PC850, PC858 e PC860. Isso caracteriza uma pilha de driver normalmente orientada à renderização gráfica.

A fila anuncia e aceitou `RAW`. Segundo a documentação da Microsoft, dados RAW são encaminhados ao monitor sem processamento/renderização adicional pelo driver. Portanto, o modo gráfico do GPD é um sinal de incompatibilidade de configuração, mas não é prova de que o GPD modificou este job RAW. A compatibilidade ESC/POS ponta a ponta permanece **não confirmada**, pois o papel saiu sem texto. Referências: [RAW Data Type](https://learn.microsoft.com/en-us/windows-hardware/drivers/print/raw-data-type) e [Introduction to Print Processors](https://learn.microsoft.com/en-us/windows-hardware/drivers/print/introduction-to-print-processors).

## Comparação virtual com Generic / Text Only

Existem duas filas com driver `Generic / Text Only`, porém ambas apontam para `USB002`:

- `Generic / Text Only` → USB002;
- `KAPBOM KA-1445` → USB002.

USB002 resolve para `USB\VID_28E9&PID_0289\000000000004`, diferente de USB001. Essas filas não pertencem à interface USB atualmente associada à POS-80 e **não são candidatas para teste físico**.

Uma nova fila temporária `Generic / Text Only`, explicitamente ligada a USB001, é candidata melhor para isolar o driver POS-80. Ela não foi criada e nenhum job foi enviado. A configuração futura pode seguir o procedimento oficial de fila Generic/Text escolhendo a porta local correta: [Print to file using Generic/Text Only](https://learn.microsoft.com/ga-ie/troubleshoot/windows-server/printing/print-to-file-without-user-intervention).

## Testes alternativos preparados, não executados

1. Payload ESC/POS aprovado para uma futura fila `Generic / Text Only em USB001`: 43 bytes, idênticos ao MOCK e à tentativa física.
2. Payload ASCII puro, sem qualquer byte ESC/POS, com CRLF:

```text
ONCA\r\n
TESTE TEXTO PURO\r\n
IMPRESSORA OK\r\n
```

Hexadecimal, 39 bytes:

```text
4F 4E 43 41 0D 0A
54 45 53 54 45 20 54 45 58 54 4F 20 50 55 52 4F 0D 0A
49 4D 50 52 45 53 53 4F 52 41 20 4F 4B 0D 0A
```

Artefatos: `gate-hardware-diagnostic/diagnostics/generic-text-escpos.bin`, `plain-ascii-crlf.bin`, `plain-ascii-crlf.txt` e `prepared-tests.json`. O plano registra `Executed=false`, `SpoolerCalled=false`, `PhysicalPrinterApiCalls=0`.

## Hipótese mais provável

O renderer e o transporte até a API Win32 estão íntegros: conteúdo, hash, datatype, contagem solicitada e contagem escrita conferem. A falha está depois da aceitação do job pelo Windows, na combinação monitor USB/interface do dispositivo/linguagem entendida pelo firmware. As hipóteses concretas, em ordem, são:

1. a interface exposta em USB001 aceita o job, mas o firmware ou monitor não interpreta o fluxo ESC/POS como texto;
2. o driver POS-80 e seu monitor dinâmico formam uma pilha gráfica que não oferece compatibilidade ESC/POS RAW ponta a ponta nesta instalação;
3. a impressora necessita CRLF para retorno/início de linha ou não finaliza corretamente linhas LF-only;
4. USB001 pertence ao dispositivo VID 0416/PID 5011 associado à fila POS-80, mas ainda falta confirmação externa de que esse VID/PID é exatamente o hardware esperado e de que o firmware está em emulação ESC/POS.

Não há evidência de perda ou corrupção no ONCA-PDV: 43/43 bytes foram aceitos e são idênticos ao MOCK.

## Acesso direto USB

O Windows expõe esta impressora pela interface USBPRINT e monitor de impressão. `USB001` é um nome lógico do spooler, não um arquivo/porta serial que a aplicação deva abrir diretamente. Um caminho direto pode existir via SDK do fabricante ou WinUSB/libusb, mas exigiria confirmar protocolo, assumir controle da interface e possivelmente trocar o driver USB, com risco de conflito com o spooler. Não é recomendado antes de obter documentação específica do modelo/firmware. A alternativa segura e reversível é primeiro isolar o driver com uma fila Generic/Text na mesma USB001.

## Próximo teste físico recomendado

Somente após nova autorização manual:

1. criar uma fila temporária `Generic / Text Only` apontando **exclusivamente** para USB001;
2. confirmar novamente VID/PID, fila vazia e `PHYSICAL_PRINTING=false` antes do ato autorizado;
3. enviar uma única vez o payload ASCII puro de 39 bytes com CRLF, sem `ESC @`, sem feed ESC/POS, sem corte e sem gaveta;
4. registrar todas as chamadas Win32 e bytes escritos;
5. se houver texto, o driver/pipeline POS-80 ou os comandos ESC/POS/LF-only ficam isolados como causa; se continuar em branco, a investigação deve migrar para porta, modo/emulação do firmware e documentação do fabricante, sem gastar outra folha.

Estado final deste diagnóstico: **nenhuma impressão realizada, zero chamadas físicas, PHYSICAL_PRINTING=false**.
