# ONÇA PDV PRO 0.1.16 — Escopo final antes do EXE

Base visual obrigatória: preservar o visual aprovado da 0.1.15/0.1.16. Não redesenhar a interface geral.

## Regras críticas preservadas
- Não quebrar funções já existentes.
- Não perder produtos, clientes, vendas, estoque, caixa, crediário ou histórico.
- Impressão: manter o mecanismo já funcional. Nunca imprimir automaticamente; após concluir a venda, perguntar se deseja imprimir. Reimpressões também exigem confirmação.
- Banco existente deve ser preservado em atualizações.

## Funções finais desta versão
- Venda em espera, com múltiplas vendas pausadas e identificação.
- Abertura de caixa com valor inicial.
- Indicador de versão visível.
- Devolução vinculada à venda, inclusive parcial, com retorno correto ao estoque e ajuste financeiro.
- Troca de produto vinculada à venda original, com cobrança/devolução apenas da diferença.
- Despesas do caixa com descrição, valor, data, operador e histórico.
- Pagamento misto/parcial, incluindo combinações de dinheiro, PIX, débito, crédito e crediário.
- Fechamento diário detalhado em PDF.
- Histórico e relatório de vendas detalhado por hoje, ontem, dia, mês, ano e período personalizado.
- Filtros de histórico por número da venda, cliente, produto, forma de pagamento, status, data e valor.
- Detalhe completo da venda: data/hora, operador, cliente, itens, quantidades, preços, descontos, acréscimos, total, pagamentos, troco, crediário, observações, entrega, devoluções/trocas e status.
- Ações no histórico: ver detalhes, gerar PDF e reimprimir comprovante com confirmação antes da impressão.
- Totais por período: faturamento, quantidade de vendas, ticket médio, dinheiro, PIX, débito, crédito, crediário, recebimentos, despesas, devoluções e cancelamentos.

## Funções já aprovadas anteriormente e que devem permanecer
- Gerenciamento avançado de vendas com cancelamento/exclusão controlada e auditoria.
- Cancelamento inteligente de crediário e estorno de recebimentos.
- Alteração controlada de venda e forma de pagamento.
- Orçamentos/reservas e conversão posterior.
- Rascunho fiscal para futura emissão, sem alegar autorização SEFAZ real.
- Pedido de entrega/WhatsApp.
- Vendas de hoje / dashboard.
- Histórico completo de caixa e reabertura controlada.
- Cadastro rápido de cliente preservando carrinho.
- Extrato de crediário PDF/WhatsApp.
- Importação de compras/XML/CSV com conferência antes do estoque.
- Atalho da última venda.
- Aviso ao fechar com carrinho aberto e recuperação após queda de energia.

## Condições para liberar o EXE
1. Compilar sem erros.
2. Rodar regressão completa.
3. Rodar cada teste automatizado 100 vezes no total, de forma isolada/serializada quando necessário para evitar interferência de SQLite.
4. Não liberar se houver falha funcional reproduzível.
5. Instalar silenciosamente e fazer smoke test de abertura do aplicativo.
6. Não afirmar que impressão física foi validada se não houver teste real de impressora.
