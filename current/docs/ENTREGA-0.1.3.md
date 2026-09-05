# Entrega 0.1.3 — continuidade sem Codex

## Alterações desta continuidade

- importador legado adaptado à estrutura real do backup ONÇA PDV 1.2.19;
- dry-run em somente leitura + SHA-256 + idempotência + rollback;
- produtos sem SKU preservados por código `LEGACY-*` estável;
- itens de venda legados sem `product_id` preservados como `DIVERSOS`;
- venda cancelada preservada, mas excluída dos relatórios operacionais de vendas concluídas;
- movimentos de caixa de vendas normalizados para `Cash`, `Pix`, `Debit`, `Credit` ou `StoreCredit` para manter o fechamento coerente;
- tabelas sem equivalente direto arquivadas em `legacy_raw_records`;
- layout principal atualizado em verde/branco;
- tela de pagamento com Dinheiro Recebido e Troco em grande destaque;
- tela de Crediário redesenhada no mesmo padrão visual;
- tela de Produtos e tela de Importar Backup redesenhadas;
- referências visuais salvas em `docs/layout-referencia/`;
- versão ajustada para 0.1.3;
- script `FINALIZAR-NO-WINDOWS.ps1` incluído para restore, testes, build, publish e instalador.

## Validação feita neste ambiente

- XAML/XML: válido;
- handlers de eventos XAML/code-behind: conferidos;
- balanceamento estrutural dos arquivos C# alterados: conferido;
- backup real: SQLite íntegro (`PRAGMA integrity_check=ok`);
- SHA-256 do backup real: `508B43C92FE200AD9808A808108F62AE107F03E6389D2A37CECDE34CB74C1D92`;
- simulação de mapeamento do backup real: 0 violações de FK e integridade `ok`;
- 685 produtos, 322 vendas, 771 itens, 322 pagamentos, 9 crediários, 258 movimentos de caixa e 1.212 movimentos de estoque preserváveis pelo mapeamento;
- saldo agregado de estoque preservado: 1.279.680;
- total das vendas concluídas preservado: R$ 15.191,74.

## Validação que precisa ocorrer no Windows

Este ambiente não possui o SDK .NET 10 nem WPF/Windows, portanto **não foi possível executar `dotnet build`/`dotnet test` aqui**.

No computador Windows, abra PowerShell na pasta do projeto e execute:

```powershell
.\FINALIZAR-NO-WINDOWS.ps1
```

O script para se houver falha de teste/build e não executa importação real nem impressão física.

## Importação do backup real

Depois do build aprovado:

1. abra o ONÇA PDV PRO;
2. vá em Configurações/Operações → Importar backup do PDV antigo;
3. selecione o arquivo real `.db`;
4. clique em **VALIDAR BACKUP**;
5. confira as contagens;
6. só então clique em **IMPORTAR DADOS**.

O sistema cria backup de segurança do banco novo antes da importação e bloqueia repetição do mesmo arquivo pelo SHA-256.
