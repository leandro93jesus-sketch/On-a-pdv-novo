# Gate clientes, crediário, relatórios e backup - parcial

## Concluído

- Migration v2 para clientes, índices de CPF/CNPJ e contas de crediário.
- Cliente CONSUMIDOR.
- Cliente sem documento, CPF/CNPJ válidos e bloqueio de duplicidade.
- Busca limitada por nome, telefone, CPF ou CNPJ.
- Pagamento misto transacional e troco separado do valor contabilizado.
- Venda em crediário cria conta vinculada ao cliente.
- Recebimentos parcial e total geram registros auditáveis e movimentos de caixa sem nova venda.
- 37 testes aprovados, 0 falhas; build Release aprovado.
- Cinco PDFs de referência renderizados e inspecionados visualmente.

## Ainda pendente

- Telas completas de clientes, seleção e crediário.
- Pagamento misto visual com múltiplas linhas.
- Gerador PDF integrado aos dados dos serviços; PDFs atuais continuam sendo referências.
- Consultas e filtros completos de relatórios.
- Fechamento operacional e seu PDF.
- Backup expandido, retenção e restauração reversível.
- Cargas de 10.000 clientes e 5.000 vendas.
- Regeneração final do instalador.

Impressão física permanece false; fiscal real e banco legado permanecem intocados. Gate não aprovado.
