# ONÇA PDV PRO — AI HANDOFF

## Estado de referência
- Produto: ONÇA PDV PRO
- Plataforma: Windows desktop WPF, .NET 10, SQLite.
- Linha estável anterior: 0.1.44.
- Próxima linha: 0.1.45, com endurecimento do crediário.
- Repositório: privado. Não publique nem altere visibilidade sem autorização explícita do proprietário.
- O banco comercial do usuário NÃO faz parte deste pacote de código.

## Objetivo deste arquivo
Este documento permite que outra IA ou desenvolvedor continue o sistema sem reconstruir o projeto do zero e sem quebrar funções já validadas.

## Regras obrigatórias
1. Mudanças são incrementais. Não reescrever o PDV inteiro.
2. Nunca apagar/recriar o banco para atualizar versão.
3. Nunca apagar ou ocultar produtos silenciosamente.
4. Código interno e código de barras continuam únicos; nomes podem se repetir.
5. Venda pode ocorrer mesmo com estoque zero somente se essa regra estiver explicitamente habilitada na versão em uso; não alterar silenciosamente a política.
6. MULTIVENDAS: abas independentes, com identidade de carrinho persistente e recuperação após reinício.
7. Impressão NUNCA automática. Após concluir venda, perguntar SIM/NÃO.
8. Cancelar venda e excluir venda são operações diferentes.
9. Exclusão de venda é lógica/auditável: status Deleted; não apagar linhas de sales/sale_items/payments.
10. Cancelamento/exclusão precisa estornar caixa/estoque/crediário no máximo uma vez.
11. Operações administrativas exigem autorização pelo mecanismo AdminPinService040. Nunca hardcode PIN real no código-fonte.
12. Antes de liberar EXE: full tests, build com warnings-as-errors e testes de GUI existentes.
13. Manter o EXE anterior como rollback.
14. Não fazer migrações destrutivas. Preferir CREATE TABLE/INDEX IF NOT EXISTS e colunas aditivas.
15. Não alterar caminhos de dados existentes sem migração compatível.

## Estrutura principal
- src/OncaPDV.Domain: entidades de domínio (Cart, Sale, Payment, etc.).
- src/OncaPDV.Application: contratos, CheckoutService, PosWorkflow e validações.
- src/OncaPDV.Infrastructure: SQLite, crediário, operações avançadas, relatórios, recuperação.
- src/OncaPDV.Desktop: WPF e fluxos de caixa/vendas/crediário.
- src/OncaPDV.Printing: renderização/impressão.
- tests/OncaPDV.Tests: regressão e integração.

## Banco
Por padrão AppPaths.Default usa:
%LOCALAPPDATA%\Onca PDV Pro
Subpastas: data, backups, logs, exports, print-preview.
Banco: data\onca-pdv-pro.db.
Para testes use ONCA_PDV_DATA_ROOT apontando para pasta isolada.

SQLite abre com:
- foreign_keys=ON
- journal_mode=WAL
- busy_timeout=5000

### Tabelas críticas
- products
- customers
- cash_sessions
- sales
- sale_items
- payments
- stock_movements
- cash_movements
- credit_entries
- credit_accounts
- credit_receipts
- credit_receipt_reversals
- sale_events
- checkout_keys_044
- credit_receipt_requests_045
- credit_receipt_cash_links_045

## Proteção contra venda duplicada (0.1.44)
Cart possui Id persistente.
checkout_keys_044 vincula cart_id -> sale_id dentro da MESMA transação da venda.
Se a mesma identidade de carrinho for finalizada novamente, SqliteSaleRepository devolve a venda já criada em vez de descontar estoque/caixa outra vez.
JsonCartRecoveryStore e MultiSaleRecovery040 preservam o Cart.Id.
Não substituir essa proteção por heurística de valor/data/produtos, pois duas vendas legítimas podem ser iguais.

## Exclusão de venda (0.1.44)
AdvancedOperationsService.DeleteSaleAsync:
- exige fluxo administrativo na UI;
- exige motivo;
- venda Completed: estorna e muda para Deleted atomicamente;
- venda já Cancelled: muda para Deleted SEM estornar novamente;
- mantém sale_items, payments e sale_events;
- some da busca normal e aparece no filtro Excluídas;
- bloqueia atalho administrativo para situação fiscal Authorized/Pending.

## Crediário (0.1.45)
Regras que devem permanecer:
- Uma venda gera no máximo UMA credit_account, mesmo se pagamentos tiverem mais de uma linha StoreCredit.
- O valor da conta é a soma das linhas StoreCredit da venda.
- Retentativa da mesma venda não gera outra conta por causa de checkout_keys_044.
- Recebimentos usam request ID em ReceiveOnceAsync.
- Repetir o mesmo request ID retorna o mesmo CreditReceipt e não baixa saldo/caixa novamente.
- request ID reutilizado com dados diferentes deve falhar.
- credit_receipt_cash_links_045 liga exatamente um recebimento ao movimento de caixa correspondente.
- Estorno deve usar esse vínculo exato, não “o último caixa da conta”.
- Registros legados sem vínculo explícito só podem ser estornados quando o movimento correspondente for identificado sem ambiguidade.
- Recebimentos estornados permanecem no histórico/auditoria.
- Relatórios devem considerar recebimentos líquidos de estornos.
- Contas de venda Cancelled/Deleted não são dívida ativa.

## MULTIVENDAS
Nunca perder:
- + NOVA VENDA;
- trocar de aba sem misturar carrinhos;
- fechar/descarregar somente a aba escolhida;
- renomear aba;
- recuperação das abas após reinício;
- Cart.Id preservado ao clonar/restaurar;
- cliente e pedido associados à aba correta.

## Fluxo de venda
MainWindow -> PaymentWindow -> PosWorkflow.CompleteAsync -> CheckoutService -> SqliteSaleRepository.
Após commit:
- aba ativa é zerada;
- lista é atualizada;
- impressão é OPCIONAL;
- confirmação visual da venda deve permanecer.

## Crediário UI
CreditWindow:
- receber parcial/total;
- editar recebimento = estornar com auditoria + criar novo lançamento;
- apagar recebimento = estorno auditável;
- saldo atualizado;
- movimento entra no caixa aberto;
- proteção _receiving045 evita execução concorrente da ação de recebimento.

## Como compilar
Na raiz da solução:
dotnet restore
dotnet test tests/OncaPDV.Tests/OncaPDV.Tests.csproj -c Release
dotnet build src/OncaPDV.Desktop/OncaPDV.Desktop.csproj -c Release --no-restore -warnaserror
dotnet publish src/OncaPDV.Desktop/OncaPDV.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true

O nome do EXE de release deve trazer a versão e a finalidade.

## Testes mínimos antes de qualquer release
- todos os testes xUnit, 0 falhas;
- build warnings-as-errors, 0 erros;
- abrir WPF;
- criar/trocar/recuperar abas MULTIVENDAS;
- venda normal;
- retentar mesma identidade de carrinho: só 1 venda;
- duas vendas legítimas iguais com Cart.Id diferentes: 2 vendas;
- venda crediário;
- duas linhas StoreCredit: apenas 1 conta consolidada;
- retentar venda crediário: apenas 1 conta;
- recebimento parcial;
- repetir mesmo request ID: apenas 1 receipt/movimento/baixa;
- novo request ID: novo recebimento legítimo;
- estornar recebimento e conferir caixa/saldo;
- cancelar venda;
- PIN incorreto não autoriza;
- excluir venda;
- excluir venda já cancelada não estorna de novo;
- estoque e caixa reconciliados;
- impressão continua opcional;
- backup/restauração continuam funcionando.

## Reconstrução no repositório
O GitHub atual mantém scripts incrementais que montam a árvore final. A ordem já está codificada nos workflows da série onca-0xx. Não execute scripts fora da ordem.
A versão final 0.1.45 deve ser derivada da 0.1.44 aplicando scripts/apply_credit_integrity_045.py.
O pacote SOURCE publicado na release é a forma mais simples para outra IA continuar: ele já contém a árvore completa resultante e não exige remontar patches históricos.

## Procedimento recomendado para a próxima IA
1. Trabalhar em cópia/branch, nunca diretamente sobre dados da loja.
2. Ler este arquivo inteiro.
3. Rodar testes antes de alterar e registrar baseline.
4. Fazer uma alteração pequena por vez.
5. Adicionar teste que falharia antes da correção.
6. Rodar full regression.
7. Rodar GUI regression.
8. Gerar novo EXE self-contained win-x64.
9. Nunca declarar “testado no computador da loja” se o teste ocorreu apenas no GitHub Actions.
10. Entregar rollback + release notes.

## Não incluir em código/prompt
- PIN real do proprietário.
- banco real da loja.
- dados pessoais de clientes.
- tokens/credenciais GitHub.
- segredos de APIs.

## Critério de continuidade
Se uma futura mudança conflitar com uma função já aprovada, preservar a função aprovada e adaptar a nova mudança ao comportamento existente. Segurança de dados e rastreabilidade têm prioridade sobre atalhos de interface.
