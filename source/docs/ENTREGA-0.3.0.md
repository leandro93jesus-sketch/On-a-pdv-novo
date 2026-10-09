# ONÇA PDV PRO 0.3.0 — Frente de caixa profissional

Data da validação: 09/10/2026. Base: tag `v0.2.3-operacao-pro`, commit `10be25f6dbc0e3e3974c3711038a4198c75286fc`.
Código-fonte oficial 0.2.3 conferido pelo SHA-256 `3932a6a21c0a1e6f3e8e01a7c90ee246f72d1003060ad8aae74a60f48639785b`.
Branch de trabalho: `feature/ux-0300`.

## O que mudou

- Caixa com scanner amplo, carrinho central, cliente, subtotal, desconto e total fixos. Finalizar fica visível sem rolar a coluna de pagamento.
- Barra de ações com Produto, Cliente, Diversos, Consulta de preço, Colocar em espera, Recuperar, Última venda e Calculadora. Atalhos mantidos.
- Quantidade do item selecionado com `−`, `+`, Alterar Qtd e Remover. Nome e preço continuam editáveis. Código permanece disponível no tooltip do produto.
- F9 abre diretamente a PaymentWindow original. Separar pedido foi mantido como botão próprio no carrinho.
- Confirmação adicional de sucesso substituída por aviso temporário com total e troco. A pergunta para imprimir continua obrigatoriamente presente; falha de impressão continua alertada.
- Últimas vendas expande pelo próprio cabeçalho; VER, REIMPRIMIR e PDF foram mantidos, assim como a gestão de vendas no menu.
- Contador de vendas em espera, estado real do caixa e resumo de vendas por pagamento, recebimentos, sangria e suprimento.
- Resumo compacto do cliente com telefone, compras e crediário; Consumidor continua sendo o padrão.
- Busca por várias palavras, abreviações e pequenos erros. Código de barras exato tem prioridade sobre código interno. Leituras exatas dispensam o fallback aproximado.
- Corrigido o bloqueio de estoque no fechamento: vender sem saldo agora efetivamente grava a venda e o estoque negativo. A base exibia “venda permitida”, mas ainda bloqueava no SQL.
- Recuperação verifica a identidade persistida do checkout: carrinhos com venda já gravada não reaparecem após uma queda entre commit e limpeza da interface. Outras abas permanecem.
- Corrigida recuperação JSON de duas linhas Diversos com mesmo valor: suas descrições e quantidades permanecem separadas.
- F11 entra em janela sem borda e restaura o estado anterior ao sair.
- Financeiro recebeu quatro cards alimentados pelos serviços existentes. Consulta de preço mostra o preço normal quando houver promoção vigente.
- Solução corrigida: o ZIP oficial referenciava duas ferramentas ausentes. Foram retiradas apenas essas referências inválidas, e incluído o teste WPF reproduzível.

## Preservado

Banco, tabelas, histórico, vendas, movimentos, clientes, fornecedores, estoque, crediário, recibos, financeiro, configurações, backup, pedidos, orçamentos, carrinhos e Diversos. Nenhuma migração destrutiva ou acesso ao banco comercial foi realizado. Não houve correção financeira automática.

Os 10 arquivos de impressão/PaymentWindow estão byte a byte idênticos ao pacote oficial 0.2.3. Além dos hashes, testes comparam o bloco de confirmação/chamada de impressão e os métodos de reimpressão, preview, visualização e PDF com o original. Os comandos ESC/POS, corte, espaçamento, largura e suporte à impressora não foram editados.

## Resultados

- Base original: **188 aprovados**, nenhum ignorado ou reprovado.
- Versão 0.3.0: **205 aprovados**, nenhum ignorado ou reprovado.
- O teste antigo de rollback por estoque insuficiente foi adaptado para rollback por produto inexistente, pois sua antiga premissa contrariava a regra de venda sem estoque. A cobertura de atomicidade permanece, e foram acrescentados testes reais de venda com estoque zero.
- `dotnet restore`, `dotnet test` e `dotnet build -c Release -warnaserror`: concluídos. Build final: **0 avisos, 0 erros**.
- Teste WPF: scanner normal, `3*CODIGO`, `3xCODIGO`, Diversos, nova aba, identidade do carrinho, 20 ciclos rápidos de troca de abas, limites visíveis de scanner/carrinho/cliente/total/finalizar/espera em 1366×768, 1600×900 e 1920×1080, entrada e saída de F11.
- Percurso de integração: abrir caixa, produtos, Diversos, cliente sem documento, espera, segunda venda, recuperação, venda no crediário, recebimento parcial, quitação saindo de ativos, despesa, fechamento sem diferença e integridade SQLite.
- Os dois pacotes self-contained win-x64 foram iniciados no Windows deste ambiente. Cada processo permaneceu aberto por 10 segundos, inicializou banco isolado e não registrou log fatal nem eventos críticos/de erro relacionados ao executável no log Application.

## Limites da validação e publicação

**Entrega compilada para homologação.** O teste por cliques no desktop não foi concluído: o serviço Computer Use respondeu `Computer Use was not approved to use desktop`. Os testes WPF executam os controles e handlers dentro de um processo de teste; não equivalem a uma homologação manual completa do pagamento e da confirmação nativa de impressão.

Não houve teste em impressora física POS-80/KAPBOM nem em uma segunda máquina Windows 10. A preservação da impressão foi comprovada por código, hashes e regressões automatizadas. O host de execução é Windows 11 x64.

Por essa pendência de homologação, **não foi criada tag nem release 0.3.0**. A 0.2.3 continua disponível como referência estável.

## Uso dos arquivos

- `ONCA-PDV-PRO-0.3.0.exe`: EXE único self-contained x64.
- ZIP portátil: extrair a pasta completa e abrir `OncaPDV.Desktop.exe`, mantendo suas bibliotecas.
- ZIP do código-fonte: contém a solução, serviços, testes, ferramenta WPF e este relatório; não contém banco da loja.
- Uso normal mantém `%LOCALAPPDATA%\Onca PDV Pro\data\onca-pdv-pro.db`. Para homologação isolada, defina `ONCA_PDV_DATA_ROOT` antes de iniciar o executável.
- Manter backup e versão anterior disponíveis durante a homologação.

## Reproduzir

Na raiz do código-fonte, com .NET SDK 10 no Windows:

```powershell
dotnet restore
dotnet test -c Release --logger "trx;LogFileName=ux030.trx"
dotnet build -c Release -warnaserror
dotnet run --project tools/OncaPDV.UxCheck -c Release -- ./evidencias
dotnet publish src/OncaPDV.Desktop -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:PublishTrimmed=false -o ./pacote-pasta
dotnet publish src/OncaPDV.Desktop -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:IncludeAllContentForSelfExtract=true -p:PublishTrimmed=false -o ./pacote-unico
```
