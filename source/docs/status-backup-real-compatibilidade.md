# Gate de compatibilidade — backup real ONÇA PDV

Arquivo de referência: `onca-pdv-backup-2026-09-04-173615.db`

## Integridade da origem

- Formato: SQLite
- Tamanho: 1.486.848 bytes
- `PRAGMA integrity_check`: `ok`
- SHA-256: `508B43C92FE200AD9808A808108F62AE107F03E6389D2A37CECDE34CB74C1D92`
- Tabelas detectadas: 41
- `app_version`: `1.2.19`
- `app_build`: `2026.08.08`

## Contagens reais relevantes

- Produtos: 685
- Clientes: 16
- Vendas: 322
- Itens de venda: 771
- Pagamentos de venda: 322
- Contas de crediário: 9
- Parcelas de crediário: 9
- Recebimentos de crediário: 3
- Sessões de caixa: 20
- Movimentos de caixa: 258
- Movimentos de estoque: 1.212
- Pedidos de entrega: 4
- Itens de entrega: 15
- Pagamentos de entrega: 1
- Orçamentos: 1
- Itens de orçamento: 7
- Devoluções: 1
- Itens de devolução: 1
- Usuários: 2
- Fornecedores: 0
- Compras: 0
- Itens de compra: 0

## Particularidades encontradas

1. O backup usa `sku` como código interno do produto.
2. Preços, custos e totais usam campos em centavos (`*_cents`).
3. O estoque atual usa `stock_qty`.
4. Existem produtos com nomes iguais. Isso é válido e deve permanecer permitido.
5. Existem **197 produtos sem `sku`**; o importador gera código `LEGACY-*` estável para não perder nenhum deles.
6. Código de barras não apresentou grupos duplicados no arquivo analisado.
7. `sku` não apresentou grupos duplicados entre os valores preenchidos.
8. Há 190 itens de vendas antigas com `product_id` vazio. Esses itens devem ser preservados usando o produto técnico `DIVERSOS`, mantendo o nome, quantidade e preço históricos do item.
9. Vendas canceladas existem na origem e devem ser preservadas, mas não podem inflar relatórios de vendas concluídas.
10. O número visível antigo da venda é texto em parte do histórico. O novo banco usa número inteiro; o importador preserva uma numeração estável e mantém o registro original integral no arquivo de auditoria legado.

## Estratégia aplicada no ONCA-PDV-PRO

- origem aberta em modo somente leitura;
- SHA-256 conferido antes e depois;
- importação transacional;
- rollback em erro;
- idempotência por SHA-256;
- nomes iguais de produtos permitidos;
- códigos internos únicos;
- códigos de barras únicos quando informados;
- códigos `LEGACY-*` gerados apenas quando necessário;
- vendas, itens, pagamentos, clientes, caixa, crediário e estoque mapeados para as tabelas novas;
- dados sem equivalente direto no modelo novo ficam arquivados em `legacy_raw_records` em JSON auditável;
- o arquivo original nunca é alterado.

## Critério esperado para o dry-run deste arquivo

O painel de validação deve reconhecer pelo menos:

- Produtos = 685
- Clientes = 16
- Vendas = 322
- Itens de venda = 771
- Pagamentos = 322
- Contas de crediário = 9
- Parcelas = 9
- Recebimentos = 3
- Sessões de caixa = 20
- Movimentos de caixa = 258
- Movimentos de estoque = 1.212

A importação definitiva só deve ser liberada depois da validação do arquivo escolhido pelo operador.


## Simulação de mapeamento com o arquivo real

Foi executada uma simulação local do mapeamento contra o schema de destino (sem alterar o backup original). Resultado:

- integridade do destino: `ok`;
- violações de chave estrangeira: 0;
- 685/685 produtos legados preservados (mais o produto técnico DIVERSOS já existente no banco novo = 686 linhas);
- 16/16 clientes preservados (mais o cliente técnico CONSUMIDOR = 17 linhas);
- 322/322 vendas preservadas;
- 771/771 itens de venda preservados;
- 190 itens sem `product_id` mapeados para o produto técnico DIVERSOS, sem perder nome/quantidade/valor da linha;
- 322/322 pagamentos preservados;
- 9/9 contas de crediário e 3/3 recebimentos preservados;
- 258/258 movimentos de caixa preservados;
- 1.212/1.212 movimentos de estoque preservados;
- saldo agregado de estoque da origem e do destino: **1.279.680** unidades/fracionários;
- total das vendas concluídas na origem e no destino: **R$ 15.191,74**;
- uma sessão técnica adicional é criada somente para a venda legada sem sessão de caixa associada, evitando perda da venda.

O fechamento de caixa legado também normaliza `reason` para `Cash`, `Pix`, `Debit`, `Credit` ou `StoreCredit`; quando o legado informa cartão, o importador consulta `sale_payments.card_type` para preservar Débito/Crédito sempre que esse detalhe existe. O texto original continua disponível em `legacy_raw_records`.
