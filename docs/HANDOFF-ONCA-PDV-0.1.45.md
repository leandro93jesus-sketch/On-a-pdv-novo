# ONÇA PDV PRO — entrega técnica 0.1.45

**Leia este arquivo primeiro antes de alterar o programa.** Esta pasta é o código-fonte completo e compilável do EXE publicado com a mesma etiqueta de versão. Não é apenas um conjunto de patches nem um arquivo binário desmontado.

## Requisitos e build
- Windows com .NET SDK 10 instalado. A interface é WPF e somente compila/executa em Windows.
- Execute na raiz que contém `src/`, `tests/` e `NuGet.Config`:
  ```powershell
  dotnet restore .\tests\OncaPDV.Tests\OncaPDV.Tests.csproj --configfile .\NuGet.Config
  dotnet test .\tests\OncaPDV.Tests\OncaPDV.Tests.csproj -c Release --no-restore
  dotnet restore .\src\OncaPDV.Desktop\OncaPDV.Desktop.csproj --configfile .\NuGet.Config
  dotnet build .\src\OncaPDV.Desktop\OncaPDV.Desktop.csproj -c Release --no-restore -warnaserror
  dotnet publish .\src\OncaPDV.Desktop\OncaPDV.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -p:DebugSymbols=false -o .\publish
  ```
- Execute o programa com **um banco de testes**, por exemplo: `$env:ONCA_PDV_DATA_ROOT="$env:TEMP\onca-teste"`. NÃO aponte a testes automatizados para o banco da loja.

## Estrutura
- `src/OncaPDV.Domain`: Cart, Sale, Payment e validações.
- `src/OncaPDV.Application`: contratos, checkout e fluxo `PosWorkflow`.
- `src/OncaPDV.Infrastructure`: migrações SQLite, repositórios, crediário, estornos, backups e relatórios.
- `src/OncaPDV.Desktop`: interface WPF, abas MULTIVENDAS, venda, caixa, crediário, autorização administrativa e impressão.
- `tests/OncaPDV.Tests`: testes de regressão e integridade.
- `docs/`: esta entrega, próximos passos e diagnóstico somente-leitura.

## Banco existente: nunca apagar ou substituir
Caminho padrão: `%LOCALAPPDATA%\Onca PDV Pro\data\onca-pdv-pro.db`. O aplicativo usa SQLite/WAL. Um backup consistente deve usar a API de backup SQLite do programa, não copiar só o .db enquanto estiver aberto. `ONCA_PDV_DATA_ROOT` permite isolamento de dados em testes. A atualização deve rodar as migrações `CREATE TABLE IF NOT EXISTS`, preservando todas as tabelas e produtos anteriores.

## Comportamento preservado
Abas MULTIVENDAS com recuperação; carrinhos independentes; alteração de quantidade/valor; produtos/códigos sem duplicidade de código; venda mista; crediário parcial/total; histórico; controle de caixa; impressão somente mediante pergunta explícita; reimpressão/PDF; cancelamento e exclusão administrativa com motivo/auditoria; recuperação de PIN já configurado no upgrade antigo. Não retorne ao comportamento de imprimir automaticamente.

## Integridade de vendas e crediário
- `checkout_keys_044` vincula `Cart.Id` à venda num único commit com estoque, pagamento, dívida e caixa. Mesmo carrinho repetido devolve a mesma venda. Um novo carrinho pode registrar outra compra legítima de mesmo valor/itens.
- `MultiSaleRecovery040` e `JsonCartRecoveryStore` preservam `Cart.Id` entre abas/reinício.
- `credit_accounts` recebe **uma única dívida agregada por venda** mesmo que haja duas linhas de pagamento StoreCredit na mesma venda. Registros históricos anteriores não são mesclados automaticamente.
- `credit_receipt_requests_045` vincula requestId à movimentação de recebimento. Repetir o mesmo identificador devolve o mesmo recibo; novo identificador representa pagamento distinto. `credit_receipt_cash_links_045` identifica o movimento e caixa exatos.
- Estornos de recebimentos usam o vínculo específico; para registros antigos sem vínculo, só usam correspondência inequívoca por conta, valor e timestamp. Se ambíguo, bloqueiam, em vez de estornar caixa incorreto.
- Relatórios de recebimento consideram recibos MENOS estornos pela data. O histórico mostra o lançamento original marcado como ESTORNADO. Não elimine auditoria para esconder valores.
- Excluir venda é exclusão lógica (`status='Deleted'`) com estorno uma vez, PIN, motivo e `sale_events`. Venda fiscal autorizada/pendente não é apagada por esse atalho.

## Cuidado especial na continuidade
- Não altere o layout/base de dados numa só rodada. Faça patches incrementais e sempre execute testes.
- A edição antiga de recebimento faz estorno e nova cobrança em operações separadas: uma evolução futura pode torná-la atômica. Até lá, nunca diga que esse fluxo é uma única transação.
- Não dependa do fato de produtos/valores serem idênticos para excluir duplicatas: isso pode ser compra legítima. Use IDs operacionais.
- O teste de interface e o banco usados em CI são isolados: **impressora física, máquina do cliente e banco de produção não foram validados**.
- Entregue sempre EXE portátil win-x64 e ZIP deste código-fonte; mantenha versão anterior disponível.
- As informações de PIN do cliente não pertencem ao código-fonte nem a este pacote.

## Critérios mínimos antes de nova versão
1. `dotnet test` completo; `dotnet build -warnaserror`.
2. Venda comum e mista, crediário, mesmas abas em restart e scanner; tentativas repetidas de finalização.
3. Recebimentos parcial e total, replay do mesmo requestId, novo pagamento legítimo, encerramento da dívida.
4. Estorno por recibo em caixas diferentes, cancelamento/exclusão e relatórios líquidos.
5. Fluxos WPF reais de cancelamento, exclusão e PIN, sem impressão automática.
6. Geração de ZIP com `src`, `tests`, `NuGet.Config`, solução e `docs` sem `bin`, `obj` ou banco de cliente.

O repositório que gera este pacote mantém os scripts de reconstrução e a trilha de commits; use o ZIP distribuído nesta mesma versão como baseline completo independente.