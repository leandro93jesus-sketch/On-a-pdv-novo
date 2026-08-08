# Relatório — Layout de Vendas + Edição de Estoque

**Data:** 2026-08-08  
**Branch:** `cursor/onca-pdv-vendas-layout-estoque-2c6b`

## Vendas

- Removida a tabela fixa de produtos
- Busca com sugestões (nome / código / barras): nome, estoque, preço
- Clique ou Enter adiciona ao carrinho; 1 resultado = adição rápida
- Carrinho em largura total abaixo da busca (colunas: produto, código, unitário, qtd, subtotal, ações)
- Quantidade digitável `[-][n][+]` com validação de estoque
- Resumo: itens, unidades, subtotal, desconto, total
- Pagamentos, Misto, Histórico, Cancelar/Finalizar preservados
- Item Diversos: descrição + valor + quantidade (sem alterar lógica de estoque)

## Estoque

- Colunas claras: **Estoque atual** × **Estoque mínimo**
- Editar atual via modal (Entrada / Saída / Definir quantidade + motivo + movimentação)
- Estoque mínimo editável na própria grade
- Histórico de movimentações mantido

## Validação

| Checagem | Resultado |
|---|---|
| `npm test` | 93/93 PASS |
| lint / build | PASS |
| `e2e:etapa5` | 37/37 PASS |
| SQLite integrity / FK | ok / 0 |

## Veredito

Layout de vendas e edição de estoque atual validados, sem quebra das rotinas existentes.
