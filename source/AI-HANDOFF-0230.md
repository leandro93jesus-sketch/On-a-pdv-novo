# ONÇA PDV PRO 0.2.3 — Operação profissional

Base exata: release 0.2.2-profissional.

## Regras de não regressão
- Impressão, preview, reimpressão, PaymentWindow, PrinterSettings e núcleo OncaPDV.Printing não foram alterados.
- Após venda continua perguntando se deseja imprimir; nunca imprimir automaticamente.
- Reimpressão continua exigindo confirmação.
- DIVERSOS permanece como aba do Caixa, menu, F4 e janela dedicada.
- Venda sem estoque continua permitida; alerta é apenas visual.

## Melhorias 0.2.3
- Scanner aceita quantidade por prefixo: `3*CODIGO` ou `3xCODIGO`.
- Scanner mantém foco operacional e proteção contra leitura repetida.
- Busca inteligente com fallback tolerante a pequenos erros de digitação.
- Consulta de preço dedicada (F5), sem iniciar venda; pode adicionar após confirmação.
- Detecção amigável de código interno / código de barras duplicado antes de salvar produto.
- Alerta discreto de estoque baixo ou zerado, sem bloquear venda.
- Resumo do cliente no checkout: compras, total comprado, crediário em aberto e recebido.
- Resumo de vendas do dia por forma de pagamento.
- Indicador de saúde do sistema / backup.
- Tela cheia operacional F11.
- Proteção adicional contra clique duplo/finalização simultânea.
- Confirmação visual temporária da venda concluída sem alterar impressão.
- Atalhos: F1 scanner, F2 produto, F3 cliente, F4 Diversos, F5 preço, F6 espera, F7 recuperar, F8 última venda, F9 finalizar, F11 tela cheia; Ctrl+N nova venda, Ctrl+Tab alternar carrinhos.
- Recursos existentes de multivendas e recuperação automática continuam sendo usados, não duplicados.

## Testes novos
ProfessionalCheckout0230Tests cobre parser do scanner, guard de finalização, alerta de estoque, busca tolerante, conflito de código, resumo diário, resumo do cliente e saúde/backup.
