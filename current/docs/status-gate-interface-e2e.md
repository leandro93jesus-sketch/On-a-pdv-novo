# Gate — Interface desktop e venda end-to-end

Data: 03/09/2026

1. UI: WPF nativo em C# / .NET 10.
2. Build Debug: aprovado, 0 erros e 0 avisos.
3. Build Release: aprovado, 0 erros e 0 avisos.
4. Publicação win-x64 self-contained single-file: aprovada; smoke test exit code 0.
5. Testes: 19.
6. Resultado: 19 aprovados, 0 falhas.
7. Venda end-to-end pela camada Application: aprovada.
8. Estoque: 20 inicial, quantidade 3 vendida, saldo final 17; movimentos Inventory e Sale presentes.
9. Caixa: um movimento de venda, valor R$ 15,00.
10. Troco: recebido R$ 20,00, troco R$ 5,00.
11. Recuperação: aprovada; após cancelamento explícito não retorna.
12. Reimpressão: 0 novas vendas, 0 movimentos extras de estoque e 0 movimentos extras de caixa.
13. Cupons mock: 102 gerados durante a suíte (100 de resistência + venda + reimpressão), em pastas temporárias.
14. SQLite: `integrity_check=ok`, `foreign_keys=1`, `journal_mode=wal`.
15. Abertura: 774 ms no smoke final do executável instalado; processo completo até fechamento automático.
16. Volume: 1.000 produtos cadastrados; busca exata concluída abaixo de 1 segundo.
17. Carrinho: 100 itens diferentes calculados abaixo de 1 segundo.
18. Executável: `publish/OncaPDV.Desktop.exe`.
19. Instalador: `installer/Output/ONCA-PDV-PRO-Setup.exe`; status **TESTADO LOCALMENTE**, não em máquina limpa.
20. Pendências: pagamento misto com múltiplas parcelas na janela, seleção/cadastro de cliente para crediário, PDF das vendas, automação UI por acessibilidade, teste em Windows 10 e máquina limpa, assinatura digital e teste físico único.

## Decisões

A janela chama `PosWorkflow` para operações de venda. Persistência SQLite não é feita em eventos da UI. Venda e reimpressão usam o mesmo `IPrintService`, decorado por fila persistente. Impressão física continua inacessível na composição atual.

## Artefatos

- Publicação self-contained gerada novamente após os testes.
- Instalador SHA-256: `65BD1FE70549B9981061EB3BCAD8DA9DEE3961C2D8582424A8210EC3361AE2C0`.
- Instalação silenciosa local em pasta isolada: exit code 0.
- Smoke test do executável instalado: exit code 0.
