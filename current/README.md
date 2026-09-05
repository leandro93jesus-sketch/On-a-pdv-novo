# ONCA-PDV-PRO

PDV desktop Windows da **Onça Produtos de Limpeza**, em C# / .NET 10.

## Estado desta entrega (0.1.5)

A versão 0.1.5 consolida o PDV não fiscal e melhora diretamente a operação diária:

- venda, carrinho recuperável, clientes, caixa, crediário, compras e fornecedores;
- produtos com nomes iguais/parecidos permitidos, mantendo código interno e código de barras únicos;
- impressão RAW/POS-80 mantida isolada e `PHYSICAL_PRINTING=false` por padrão;
- PostgreSQL/multicaixa preparado, sem fallback silencioso para SQLite;
- fiscal isolado via `IFiscalProvider`, somente MOCK/homologação;
- importação assistida do banco antigo pela interface, com dry-run, hash, backup de segurança, transação, rollback e idempotência;
- compatibilidade preparada para o backup real `onca-pdv-backup-2026-09-04-173615.db` (app legado 1.2.19);
- layout principal atualizado para o padrão verde/branco definido para o ONÇA PDV PRO;
- tela de Crediário no mesmo padrão visual;
- tela de Pagamento com **DINHEIRO RECEBIDO** e **TROCO** em grande destaque;
- tela de vendas com atalhos F3–F9, consulta rápida sem adicionar ao carrinho e controles +1/−1/remover;
- recuperação de carrinho com cópia principal + backup automático contra corrupção do snapshot;
- histórico de vendas com filtros por forma/status e exportação CSV;
- estoque com ajuste físico auditado e histórico de movimentações por produto;
- caixa com abertura pelo último saldo fechado e histórico dos últimos fechamentos.

### Backup real de referência

O importador foi ajustado para a estrutura real validada:

- 685 produtos;
- 16 clientes;
- 322 vendas;
- 771 itens de venda;
- 322 pagamentos;
- 9 contas de crediário;
- 3 recebimentos de crediário;
- 20 sessões de caixa;
- 258 movimentos de caixa;
- 1.212 movimentos de estoque.

Produtos sem SKU/código interno recebem um código `LEGACY-*` estável em vez de serem descartados. Itens antigos sem `product_id` são preservados como `DIVERSOS`, mantendo nome, quantidade e valores da linha. Tabelas sem equivalente operacional direto são preservadas em `legacy_raw_records` para evitar perda silenciosa.

## Compilar e testar no Windows

Abra PowerShell na pasta do projeto e execute:

```powershell
.\FINALIZAR-NO-WINDOWS.ps1
```

Ou manualmente:

```powershell
dotnet restore OncaPDV.slnx --configfile NuGet.Config
dotnet test OncaPDV.slnx -c Release --no-restore
dotnet build OncaPDV.slnx -c Release --no-restore
dotnet run --project src\OncaPDV.Desktop\OncaPDV.Desktop.csproj
```

Dados novos ficam em `%LOCALAPPDATA%\Onca PDV Pro`. A importação do banco antigo só ocorre quando o operador escolhe explicitamente o arquivo e confirma **IMPORTAR DADOS** após o dry-run.

## Limites externos ainda existentes

- homologação SEFAZ real depende de certificado A1, dados fiscais, CSC e credenciamento;
- teste multicaixa real depende de um servidor PostgreSQL acessível;
- assinatura Authenticode depende de certificado de code signing;
- a geração do instalador requer Inno Setup 6 no Windows.
