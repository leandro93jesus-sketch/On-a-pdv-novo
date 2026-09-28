# ONÇA PDV PRO 0.1.46 — complemento do handoff para outra IA

Leia também `AI-HANDOFF.md`. Este arquivo é complementar e descreve as mudanças posteriores à 0.1.45.

## Regras centrais
- `EXCLUIR CREDIÁRIO` é baixa administrativa do saldo de uma **conta**, não exclusão da venda, nem reembolso de pagamentos.
- Exige PIN do administrador, motivo, confirmação, auditoria.
- Mantém a linha de `credit_accounts` com status `Cancelled`, `balance=0` e registro único em `credit_account_deletions_046`.
- Mantém `credit_receipts` e `cash_movements` históricos e **não retira dinheiro já recebido** do caixa.
- `credit_entries` ganha Credit apenas do saldo perdoado/baixado. Não criar crédito da parte já recebida.
- Se a venda for cancelada depois, o fluxo deve estornar recibos existentes e creditar só a diferença, não duplicar a baixa anterior.
- Conta excluída sai de Todos/ativas, aparece em EXCLUÍDOS com a parte efetivamente paga.
- Se soma de recebimentos ativos divergir do caixa, bloquear exclusão e solicitar conferência manual. Nunca corrigir caixa silenciosamente.

## Antiduplicidade do recebimento
- `credit_receipt_intents_046`: um pedido pendente por conta (índice único parcial por account_id com acknowledged_at NULL).
- Criar o pedido persistente ANTES de executar a baixa.
- `ReceiveOnceAsync` usa o MESMO request_id da intenção; transação indivisível grava recibo + saldo + movimento + ligação 045.
- Após commit, `CheckAsync` verifica receipt id, cash movement id, tipo, sessão e valor.
- Só `AcknowledgeAsync` libera nova operação. Após crash, `PendingAsync` encontra a anterior.
- Se já estiver gravado, mostrar o recibo/movimento, NÃO criar novo lançamento.
- Se pendente sem recibo, retomar a MESMA identidade ou descartar somente após confirmar que não houve commit.
- Caixa original fechado: não retomar automaticamente. Revisão manual.
- `ReconcileAsync` compara soma líquida dos recibos e lançamentos no caixa e mede vínculos individuais. Em dados antigos sem vínculo, avisar que igualdade dos totais não demonstra conferência individual.
- Pagamentos legítimos distintos usam IDs distintos após confirmação explícita.

## Tabelas aditivas
- `credit_account_deletions_046`: account_id PK, sale_id, removed_balance, net_paid, operador, motivo, data.
- `credit_receipt_intents_046`: request_id PK, account_id, valor, método, operador, sessão, observação, created_at, acknowledged_at.
- Índice parcial `ux_credit_pending_intent_046`.

## Fontes principais
- `src/OncaPDV.Infrastructure/CreditSafety046.cs`
- `src/OncaPDV.Infrastructure/CustomerCredit.cs` (ReceiveOnceAsync 045)
- `src/OncaPDV.Infrastructure/AdvancedOperations.cs`
- `src/OncaPDV.Infrastructure/OperationalServices.cs`
- `src/OncaPDV.Desktop/CreditWindow.xaml(.cs)`
- `src/OncaPDV.Desktop/CreditExclusion046Window.xaml(.cs)`
- `tests/OncaPDV.Tests/CreditSafety046Tests.cs`

## Testar antes de publicar
1. Novo recebimento parcial: um recibo, um movimento caixa.
2. Retry do mesmo request após reinício: mesmo recibo/movimento, sem novo débito no saldo.
3. Pedido já gravado mas não reconhecido pela interface: mostrar o lançamento anterior, não gerar outro.
4. Cancelar tentativa sem recibo: não mexer no saldo/caixa.
5. Tentativa de excluir crédito com recebimento pendente: bloquear.
6. Excluir crédito parcialmente pago: saldo restante baixado, dinheiro recebido preservado.
7. Excluir conta paga: apenas arquivar, caixa intacto.
8. Excluir conta duas vezes: bloquear segundo intento.
9. Cancelar venda depois de excluir crédito: não somar baixa duas vezes; estornar recibos corretos.
10. Divergência de caixa: bloquear exclusão.
11. Regressão de venda normal, MULTIVENDAS, PIN, cancelamento, exclusão, impressão opcional e banco legado.

## Dados privados
Não incluir banco da loja, PIN, dados de clientes ou tokens no ZIP do código. O PIN cadastrado no banco não é código-fonte.

## Build e rollback
Use a solução já gerada no ZIP `SOURCE-COMPLETO`. Execute os testes antes de alterar. Preserve a 0.1.45 como fallback. A versão 0.1.46 deve ser gerada somente após workflow de testes e publicação da mesma árvore-fonte testada.
