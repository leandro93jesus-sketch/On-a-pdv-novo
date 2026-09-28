-- Diagnóstico SOMENTE LEITURA: use em backup consistente do banco da loja.
-- Não executar DELETE/UPDATE. Dois valores iguais não provam duplicidade.
-- 1: mais de uma conta de crediário ATIVA vinculada à mesma venda.
SELECT a.sale_id,s.number AS venda,COUNT(*) AS contas_ativas,
       SUM(a.original_amount) AS original_contas,SUM(a.balance) AS saldo_contas,
       (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.sale_id=a.sale_id AND p.method='StoreCredit') AS valor_credito_venda
FROM credit_accounts a JOIN sales s ON s.id=a.sale_id
WHERE a.status NOT IN ('Cancelled')
GROUP BY a.sale_id,s.number
HAVING COUNT(*)>1 OR SUM(a.original_amount)<>(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.sale_id=a.sale_id AND p.method='StoreCredit');
-- 2: vendas concluídas com mais de um lançamento financeiro positivo de crediário
-- só como indício de inspeção, não elimine automaticamente.
SELECT a.id AS conta,s.number AS venda,a.original_amount,a.balance,a.status,
       COUNT(r.id) AS total_recebimentos,
       COALESCE(SUM(CASE WHEN x.id IS NULL THEN r.amount ELSE 0 END),0) AS recebimentos_nao_estornados
FROM credit_accounts a JOIN sales s ON s.id=a.sale_id
LEFT JOIN credit_receipts r ON r.account_id=a.id
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id
GROUP BY a.id
HAVING a.status NOT IN ('Cancelled') AND ABS((a.original_amount-a.balance)-COALESCE(SUM(CASE WHEN x.id IS NULL THEN r.amount ELSE 0 END),0))>0.009;
-- 3: mesmas quantias/forma de pagamento em minutos próximos (não prova duplicidade).
SELECT account_id,amount,method,substr(created_at,1,16) AS minuto,COUNT(*) AS ocorrencias
FROM credit_receipts GROUP BY account_id,amount,method,substr(created_at,1,16) HAVING COUNT(*)>1;
-- 4: movimentos de caixa de recebimento que não possuem vínculo explícito (registros anteriores à 0.1.45 podem aparecer).
SELECT m.id,m.session_id,m.origin_id AS conta,m.amount,m.created_at FROM cash_movements m
WHERE m.type='StoreCreditReceipt' AND m.amount>0
  AND NOT EXISTS(SELECT 1 FROM credit_receipt_cash_links_045 l WHERE l.cash_movement_id=m.id)
ORDER BY m.created_at DESC;
