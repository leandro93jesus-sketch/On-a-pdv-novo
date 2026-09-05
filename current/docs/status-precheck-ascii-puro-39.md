# Pré-checagem — ASCII puro 39 bytes

Estado em 2026-09-04: operação preparada, não executada.

## Payload confirmado

```text
ONCA\r\n
TESTE TEXTO PURO\r\n
IMPRESSORA OK\r\n
```

```text
4F 4E 43 41 0D 0A
54 45 53 54 45 20 54 45 58 54 4F 20 50 55 52 4F 0D 0A
49 4D 50 52 45 53 53 4F 52 41 20 4F 4B 0D 0A
```

Total exato: 39 bytes. O payload não contém byte `1B` nem inicialização, corte, gaveta, seleção de code page, negrito, alinhamento ou qualquer comando ESC/POS.

## Estado da pré-checagem

| Item | Resultado |
|---|---|
| Printer | POS-80 |
| Status | Normal |
| Porta | USB001 |
| Fila | vazia, 0 jobs |
| Payload | 39 bytes |
| Datatype | RAW |
| `PHYSICAL_PRINTING` | false |
| Chamadas físicas nesta preparação | 0 |

O modo físico ESC/POS anterior (`--physical-once`) foi desativado para impedir repetição acidental. A única operação preparada é `--physical-ascii-39-once`, que captura `OpenPrinter`, `StartDocPrinter`, `JobId`, `StartPagePrinter`, `WritePrinter`, bytes solicitados/escritos, `EndPagePrinter`, `EndDocPrinter` e erro Win32. Ela não foi invocada.

A execução deve aguardar exatamente a autorização manual documentada:

```text
AUTORIZO O TESTE FISICO ASCII PURO DE 39 BYTES NA POS-80.
```

Depois de eventual tentativa, o observador ainda deverá informar se o papel avançou, se apareceu texto ou se saiu em branco. Nenhuma segunda tentativa será automática.
