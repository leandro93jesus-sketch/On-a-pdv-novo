# Decisões técnicas — Etapa 1

## 1. Monorepo npm workspaces
Mantém frontend e backend no mesmo repositório, alinhado ao ambiente Cloud Agent já previsto (`npm install` + terminais api/web). Facilita evolução para empacotamento Windows.

## 2. Dinheiro em centavos (`INTEGER`)
Evita erros de arredondamento de ponto flutuante em totais, descontos e pagamentos.

## 3. Migrations SQL versionadas
Schema evolui de forma auditável. A tabela `schema_migrations` controla o que já foi aplicado.

## 4. Estoque negativo só com regra explícita
Campo `products.allow_negative_stock`. Padrão: bloqueio com HTTP 409 (`STOCK_INSUFFICIENT`). Venda e baixa ocorrem na mesma transação.

## 5. Item Diversos sem produto
`sale_items.product_id` nullable + `is_misc = 1`. Não gera movimento de estoque.

## 6. Pagamentos em tabela própria
`sale_payments` já aceita N métodos. UI da etapa 1 usa um método; API aceita `payments[]`.

## 7. Cancelamento pré-conclusão é local
Limpar carrinho não grava venda. Cancelamento pós-venda fica para etapa futura (estorno + devolução de estoque).

## 8. Seed opcional de desenvolvimento
Produtos demo só entram se o catálogo estiver vazio (`PDV_SEED` diferente de `0`). Testes usam fixtures próprias e `PDV_SEED=0`.

## 9. UI comercial clara
Shell com navegação completa desde o dia 1; módulos não prontos ficam como placeholder explícito (“Em breve”), sem fingir funcionalidade.
