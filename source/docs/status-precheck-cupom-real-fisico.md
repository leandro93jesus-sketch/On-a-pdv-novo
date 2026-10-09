# Pré-checagem — cupom real físico controlado

Gate preparado em MOCK. Nenhuma impressão física foi executada nesta etapa.

## Venda sintética

A venda `TESTE-001` existe somente em memória no utilitário de impressão. Não há chamada a banco, repositório, estoque ou caixa. Contém um detergente de R$ 5,00, um desinfetante de R$ 10,00, total de R$ 15,00, pagamento em dinheiro, R$ 20,00 recebidos e R$ 5,00 de troco.

## Payload aprovado em MOCK

| Item | Resultado |
|---|---|
| Conteúdo não vazio | Sim |
| Papel | 80 mm |
| Colunas | 48 |
| Encoding | CP850 |
| Renderer | EscPos80Renderer |
| Backend futuro | RAW aprovado |
| Payloads | 1 |
| Bytes | 549 |
| SHA-256 | `3276D5E4017D115423E4153C6590DC8F7E01FE18F7AA408D2B42A1A71D6C738C` |
| Comando de corte | Ausente |
| Comando de gaveta | Ausente |
| MOCK | PASS |
| Escritas no banco | 0 |
| Movimentos de estoque | 0 |
| Movimentos de caixa | 0 |

Arquivos preservados: `gate-real-physical-precheck/print-real-precheck.txt` e `gate-real-physical-precheck/print-real-precheck.bin`.

## POS-80

| Item | Resultado |
|---|---|
| Printer | POS-80 |
| Status | Normal |
| Porta | USB001 |
| Datatype | RAW |
| Fila | 0 jobs |
| PaperWidth | 80 mm |
| CutEnabled | false |
| DrawerEnabled | false |
| PHYSICAL_PRINTING | false |

Build Release: sucesso, 0 erros e 0 avisos. Suíte: 78 aprovados, 0 falhas.

A operação de tentativa única está preparada, com telemetria Win32, `JobId`, bytes solicitados/escritos e retorno obrigatório para `PHYSICAL_PRINTING=false`. Ela não foi invocada e deve aguardar exatamente:

```text
AUTORIZO UMA IMPRESSAO FISICA DO CUPOM REAL NA POS-80 AGORA.
```

Não haverá repetição automática.
