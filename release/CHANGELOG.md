# Changelog — ONÇA PDV

## 1.2.19 — 2026-08-31

Atualização incremental da versão oficial 1.2.18. Nada foi redesenhado: o layout,
os módulos, o banco e as funções aprovadas continuam como estavam. Foram
acrescentadas quatro melhorias operacionais, uma etapa por vez, com checkpoint e
regressão após cada uma.

### Fechamento diário de caixa mais claro (Etapa 1)

- Tela de Caixa reorganizada em três blocos: **Vendas do período** (dinheiro, pix,
  débito, crédito, crediário, outras formas e TOTAL VENDIDO), **Movimentações do
  caixa** (fundo inicial, dinheiro de vendas, suprimentos, sangrias,
  cancelamentos em dinheiro e VALOR ESPERADO EM DINHEIRO) e **Resumo final**
- Diferença de caixa agora em texto direto: `FALTA R$ XX,XX`, `SOBRA R$ XX,XX`
  ou `CAIXA CORRETO`
- Resumo final com quantidade de vendas, itens vendidos, faturamento bruto,
  descontos, faturamento líquido, formas de pagamento, suprimentos, sangrias,
  valor esperado, valor contado e diferença
- Botões `IMPRIMIR FECHAMENTO` e `GERAR PDF` (novo `GET /api/cash/sessions/:id/pdf`)
- **O cálculo não mudou**: `computeExpectedCash` continua sendo saldo inicial +
  dinheiro de vendas + suprimentos − sangrias. Pix, cartões e crediário aparecem
  para conferência mas não entram no dinheiro físico da gaveta
- Complementos apenas de leitura em `getCashConference`: `sales_outras_cents`,
  `suprimentos_cents`, `sangrias_cents`, `cancelamentos_dinheiro_cents`,
  `sales_count`, `items_sold`, `gross_cents`, `discount_cents`, `net_cents`

### Busca manual inteligente, separada do scanner (Etapa 2)

- A leitura do scanner **não mudou**: continua em `?barcode=` com correspondência
  exata (`p.barcode = ?`), sem LIKE e sem aproximação
- Novo caminho exclusivo da digitação: `GET /api/products/busca-manual?q=`
  aceita várias palavras parciais, ignora acentos e maiúsculas e procura em nome,
  código interno, código de barras, categoria e fornecedor
- Resultados ordenados por proximidade (exato > todas as palavras no nome >
  palavras em outros campos)
- Exemplos: `desinf lav` encontra DESINFETANTE LAVANDA 5L e 2L; `sabao maca`
  encontra SABÃO EM PÓ MAÇÃ VERDE; `5l`, `deterg` e `lavanda` também funcionam
- A lista de sugestões já mostrava nome, código, preço e estoque, com seleção por
  mouse, setas e Enter — preservado

### Recuperação de venda após queda de energia (Etapa 3)

- O rascunho automático do carrinho já existia; agora a tela de recuperação mostra
  **horário**, **itens** (com unidades) e **valor aproximado**
- Ao recuperar, cada produto é reconferido: produto apagado sai do carrinho com
  aviso e preço alterado é atualizado e avisado, sem travar o PDV
- Rascunho inválido ou corrompido é registrado no log, descartado e o PDV abre
  normalmente
- Gravação em duas etapas (chave temporária e depois definitiva) para não deixar
  rascunho pela metade
- O rascunho continua não gerando faturamento, estoque, caixa nem pagamento, e é
  apagado ao concluir ou cancelar a venda

### Reimpressão rápida (Etapa 4)

- Cada linha do histórico ganhou `VER`, `REIMPRIMIR` e `PDF`, em um clique
- As rotinas aprovadas de impressão e de PDF foram extraídas para
  `web/src/lib/saleDocuments.ts` e são reutilizadas pelo comprovante e pelas
  ações rápidas — não existe implementação paralela de impressão
- A reimpressão é identificada discretamente (título `REIMPRESSÃO — Comprovante
  VD-...` e `document_type` `comprovante_reimpressao` na fila), sem alterar
  nenhum valor do comprovante
- Somente leitura: não duplica venda, não cria itens ou pagamento, não baixa
  estoque e não altera faturamento

### Qualidade

- Suítes novas: `fechamentoCaixaClaro` (6), `buscaInteligente` (11),
  `recuperacaoVendaFinalizacao` (5), `reimpressaoRapida` (7) e
  `saleDraftStore.test.mjs` no lado web (8)
- `npm test` passa a rodar servidor **e** web: 242 testes no servidor
  (238 aprovados, 4 pulados por falta de insumo do cliente) + 8 no web

## 1.2.18 — 2026-08-30

Continuação do projeto: as 8 alterações pedidas foram revalidadas ponta a ponta e o
que estava faltando foi completado. Nenhuma função existente foi removida ou
reescrita; o banco, o layout e os módulos atuais foram preservados.

### Vendas — troco automático (Alteração 1)

- Quando o valor recebido é menor que o total, a tela mostra `FALTAM R$ XX,XX`
  (rótulo e mensagem de bloqueio) em vez de "R$ 0,00 (insuficiente)"
- Selecionar DINHEIRO coloca o foco automaticamente no campo Valor recebido
- Pagamento misto continua calculando troco apenas sobre a parte em dinheiro

### Leitor de código de barras (Alteração 2)

- Suíte dedicada cobre 20 leituras do mesmo código, alternância A/B/A/B,
  100 leituras simultâneas (race condition), prefixo que não pode dar match,
  código inexistente e código recém-cadastrado

### Código não cadastrado (Alteração 3)

- Modal passa a destacar `PRODUTO NÃO CADASTRADO` com o código lido
- Fluxo coberto por testes: criação persistida, bloqueio de duplicidade e venda
  seguindo com carrinho, cliente e desconto preservados

### Produtos e Estoque (Alteração 4)

- Tabela com Produto, Código, Estoque, Custo, Preço, Categoria, Status e Ações
- Ações EDITAR, + ESTOQUE, − ESTOQUE e HISTÓRICO por produto
- Novo modal de histórico do produto com data, hora, tipo, antes, movimentação,
  depois, motivo e usuário

### Histórico de vendas (Alteração 5)

- Lista ganha as colunas Data, Hora, Operador e Itens
- Detalhe passa a mostrar crediário (com parcelas), entrega e devoluções quando
  existem, via novo `GET /api/sales/:id/related` (somente leitura)

### Alterar e cancelar venda (Alterações 6 e 7)

- Auditoria de alteração e de cancelamento registra operador e administrador
  autorizador, além de totais e itens antes/depois
- Cancelamento oferece os motivos padronizados: lançamento incorreto,
  duplicidade, cliente desistiu, erro operacional, teste e outro

### Relatórios (Alteração 8)

- Novo relatório `VENDAS DETALHADAS`, ao lado do "Vendas por período" existente
- Filtros: hoje/ontem, data inicial/final, número, cliente, operador, produto
  (nome, código de barras ou SKU), forma de pagamento e situação
- Colunas com produtos/quantidades, subtotal, desconto, total, valor recebido e troco
- Resumo do período: vendas, itens vendidos, faturamento bruto, descontos,
  faturamento líquido, custo, lucro e ticket médio
- Botões GERAR PDF e EXPORTAR CSV (`GET /api/reports/:id/pdf` e `/csv`)

### Correções e qualidade

- Rodapé da interface passa a exibir a versão real do `package.json` (estava fixo em 1.2.16)
- Testes que dependem de arquivos do cliente (JSON legado e banco real) agora são
  pulados com motivo em máquina limpa, em vez de reprovar a suíte
- Script `scripts/etapa0-validar-base.mjs` valida a base em 20 itens
- Suíte do servidor: 213 testes (209 aprovados, 4 pulados por falta de insumo do cliente)

## 1.2.17 — 2026-08-28

### Interface (não sobrecarregar a tela)

- Toast temporário após bipagem (produto + quantidade no carrinho)
- Aviso compacto de estoque zerado/insuficiente com Ajustar / Continuar / Agora não
- Cadastro rápido enxuto + “Mais informações”
- Produtos/Estoque: lista com Código, Produto, Preço, Estoque, Status, Ações
- Histórico: lista enxuta com Abrir; detalhes/PDF/alterar/excluir no detalhe
- Crediário: Receber (modal curto) e Abrir (detalhes)

### Crediário / Caixa

- Recebimento parcial lança valor no caixa (dinheiro/pix/cartão) e reduz `sales_crediario_cents`
- Novo tipo de movimento `recebimento_crediario` (migração 024)

### Qualidade

- Suite `validacaoFinalObrigatoria.test.js` com evidências dos cenários críticos

## 1.0.0 — 2026-08-08

### Estável inicial

- Módulos: Vendas, Caixa, Produtos, Estoque, Clientes, Fornecedores, Compras, Crediário, Devoluções, Entregas, Relatórios, Backup, Importação, Configurações, Usuários, Auditoria
- Item Diversos sem cadastro permanente / sem baixa de estoque de produto
- PDF comprovante (não fiscal) e compartilhamento WhatsApp (link; PDF anexado manualmente)
- Autenticação com hash scrypt; troca obrigatória da senha bootstrap
- Desktop Electron + instalador Windows (NSIS)
- Dados em AppData/ONCA-PDV (banco, backups, logs)
- Migração real Oncas PDV v2 validada (Etapas 4B/4C)
- Logs com rotação e redação de segredos
- Versão 1.0.0 visível na interface e health

### Limitações conhecidas

- WhatsApp não anexa PDF automaticamente
- Estoques negativos herdados do backup legado são preservados (não corrigidos silenciosamente)
- Crediário no backup real importado estava vazio
- Windows 7 não é suportado nesta linha
