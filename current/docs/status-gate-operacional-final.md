# Gate operacional final

Data: 04/09/2026

## Status

**GATE APROVADO**

O fluxo operacional está integrado na aplicação WPF: cliente → venda → pagamento misto → crediário → recebimento → caixa → histórico → PDF → relatórios → fechamento → backup → restauração de teste.

## Interface e serviços

- Clientes: busca limitada a 100 resultados por nome, telefone, CPF ou CNPJ; cadastro, edição, ativação/inativação, histórico e crediário.
- Venda: seleção, remoção e cadastro de cliente sem recriar o carrinho; o cliente recém-cadastrado fica selecionado.
- Pagamento misto: múltiplas linhas, total alocado, restante, dinheiro recebido e troco em tempo real; confirmação bloqueada enquanto inválida.
- Teste misto: venda R$ 100, PIX R$ 30, dinheiro alocado R$ 70, recebido R$ 120; troco R$ 50 e receita contabilizada em R$ 100.
- Crediário: filtros Todos/Aberto/Parcial/Pago/Vencido, movimentos, recebimento por dinheiro/PIX/débito/crédito, baixa parcial/total e movimento de caixa sem nova venda.
- Relatórios: vendas por período com método/cliente/operador suportados pelo serviço, recebimentos de crediário separados; estoque com filtro abaixo do mínimo; crediário por status.
- Caixa: fechamento com saldo inicial, vendas por forma, crediário gerado, recebimentos, sangrias, suprimentos, esperado, informado e diferença; fechamento persistido.
- PDFs: recibo, segunda via, extrato de crediário, comprovante de recebimento, vendas e fechamento usam DTOs vindos dos serviços/banco. Todos foram renderizados e inspecionados visualmente.
- Backup: pacote ZIP com banco consistente, schema version, configurações essenciais, manifesto e SHA-256; criação manual, diária na inicialização e automática no fechamento; retenção padrão 30 somente após validar o novo pacote.
- Restauração: validação prévia, backup de segurança, restauração, migrations e `PRAGMA integrity_check`; rollback automático em falha.

## Testes e desempenho medido

- Suíte: 45 total, 45 aprovados, 0 falhas, 0 ignorados.
- End-to-end operacional: aprovado, incluindo venda, pagamento misto, crediário, recebimentos parcial/total, estoque, caixa, PDFs, fechamento, backup e restauração.
- 10.000 clientes: abertura/busca vazia 2 ms; nome 1 ms; telefone 1 ms; CPF/CNPJ 2 ms; resultados limitados.
- 5.000 vendas: histórico de 100 vendas 30 ms; detalhe 0 ms; relatório agregado 981 ms; PDF 8 ms.
- Corrupção: banco truncado, manifesto inválido, checksum inválido e banco ausente foram recusados; banco atual permaneceu íntegro.
- SQLite: `PRAGMA integrity_check=ok`, WAL e foreign keys preservados.
- Impressão MOCK: 1.000/1.000 concluídas, zero corrupção, zero exceções e zero chamadas físicas.

## Build e distribuição

- Build Release: aprovado, 0 erros e 0 avisos.
- Publicação: win-x64, self-contained e single-file; `publish/OncaPDV.Desktop.exe` (132.164.279 bytes).
- Instalador: regenerado com Inno Setup 6.7.3; `installer/Output/ONCA-PDV-PRO-Setup.exe` (45.553.777 bytes).
- SHA-256 do instalador: `154BC7A146DB7FAEF4E027AB10FA5A5738EA37554FB2703B380961FC4FE31AAA`.
- Instalação silenciosa local em pasta isolada: exit code 0.
- Smoke test do executável instalado: exit code 0; banco novo criado com sucesso.

## Bloqueios preservados

- `PHYSICAL_PRINTING=false`; composição desktop permanece exclusivamente MOCK; APIs físicas: 0 chamadas.
- Fiscal real bloqueado; nenhum acesso à SEFAZ, NFC-e/NF-e ou certificado.
- Banco legado e PDV antigo não foram acessados nem modificados.

## Pendências fora deste gate

- Teste em máquina Windows limpa e assinatura digital do instalador.
- Teste físico da impressora somente mediante validação manual controlada futura.
- Emissão fiscal real permanece explicitamente fora de escopo.
