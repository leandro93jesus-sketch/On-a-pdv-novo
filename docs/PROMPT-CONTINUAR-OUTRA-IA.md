# PROMPT PARA OUTRA IA — CONTINUAR ONÇA PDV PRO 0.1.45

Você recebeu o ZIP de código-fonte **completo e compilável** do ONÇA PDV PRO. Leia `docs/HANDOFF-ONCA-PDV-0.1.45.md` e todos os testes antes de modificar.

Missão: corrigir e evoluir incrementalmente o PDV de uma loja real no Brasil, mantendo dados e funcionalidades. A base é .NET 10, WPF, SQLite, Windows x64 portátil. Não reescreva do zero, não apague o banco e não introduza migrações destrutivas.

**Contrato de segurança:**
- Nunca apagar produtos, clientes, vendas, crediário ou dados já cadastrados. Não apagar nem ocultar silenciosamente produtos.
- Preservar abas MULTIVENDAS e recuperação, caixa, preço/estoque, pagamento misto, crediário, auditoria, backup, cancelamento, exclusão lógica, PDF e impressão opcional.
- Nunca imprimir automaticamente; perguntar ao concluir a venda.
- Todas as operações de dinheiro, estoque, venda e crediário devem ser atômicas e idempotentes quando reenviadas com a **mesma identidade operacional**.
- Uma compra nova pode ter exatamente o mesmo valor/produtos; não bloqueie por similaridade. Recebimento novo pode ter mesmo valor, mas precisa de requestId novo.
- Cancelamentos e exclusões requerem autorização, motivo e histórico; não estornar duas vezes.
- Não inventar valor, saldo ou exclusão no banco real; usar sempre base temporária nas verificações.
- Segredos e PIN não devem ser gravados no código-fonte.
- Entregar EXE portátil Windows 64 bits testado, ZIP do código completo, instruções e resultado real dos testes.

**Trabalho:** revise a solicitação atual, inspecione as classes correspondentes, elabore testes de regressão que reproduzam a falha, aplique a menor mudança segura, execute todos os testes, build com warnings como erro, smoke test WPF, registre notas. Se algum teste falhar, não publique a versão como validada. Distinguir execução em CI da validação na máquina da loja.

**Arquivos centrais:** `src/OncaPDV.Infrastructure/Database.cs`, `CustomerCredit.cs`, `AdvancedOperations.cs`, `OperationalServices.cs`, `src/OncaPDV.Desktop/MainWindow.xaml.cs`, `CreditWindow.xaml.cs`, `SalesManagementWindow.xaml.cs`, `tests/OncaPDV.Tests/`. Leia README de handoff.

**Início:** execute os comandos de build/teste do handoff e faça uma cópia de segurança antes de qualquer alteração.