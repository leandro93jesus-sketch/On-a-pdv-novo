# ONÇA PDV PRO 0.2.0 — Interface Profissional

Base: 0.1.53 (crediário lista ativa).

Objetivo desta versão: reorganizar a experiência visual e operacional sem alterar regras financeiras, banco, impressão ou fluxos já validados.

## Alterações visuais
- Frente de caixa reorganizada em Operação / Gestão / Sistema.
- Busca/scanner de produto em destaque, carrinho central e checkout persistente à direita.
- Total e finalização da venda mais evidentes, com formas de pagamento agrupadas.
- Crediário com ação principal única de recebimento; correções, estornos e exclusões ficam em área administrativa recolhível.
- Contas ativas continuam separadas de PAGOS e AUDITORIA.
- Financeiro reorganizado com formulário, grade e pagamento selecionado em áreas visuais distintas.
- Centro de Integridade reorganizado para leitura rápida de saúde, duplicidades e diagnóstico do crediário.
- Tema visual consistente em ProfessionalTheme0200.xaml.

## Impressão congelada
Nenhuma lógica de impressão foi modificada nesta versão. Permanecem inalterados, entre outros:
- OncaPDV.Printing/*
- ConfiguredPhysicalPrintService.cs
- PrinterSettingsWindow.xaml / .cs
- ReceiptPreviewWindow.xaml / .cs
- MainWindow.xaml.cs
- PaymentWindow.xaml / .cs

O pipeline 0.2.0 deve comparar SHA-256 desses arquivos contra a fonte 0.1.53 antes de compilar. Se houver diferença, a publicação deve ser bloqueada.

## Regras que continuam obrigatórias
- Nunca substituir o banco comercial por banco de teste.
- Backup antes de atualizar.
- Perguntar sobre impressão conforme comportamento já existente; não imprimir automaticamente.
- Não alterar confirmação/reimpressão/preview/PDF nesta versão.
- Vendas, caixa, estoque, crediário, contas a pagar e despesas permanecem com a mesma lógica da 0.1.53.
- Windows 10/11 x64; .NET 10; binário sem assinatura de editor.

## Gate de publicação
1. Aplicar patch sobre a fonte exata 0.1.53.
2. Confirmar hashes de impressão intactos.
3. Validar os XAMLs e os handlers obrigatórios.
4. Rodar toda a suíte .NET.
5. Build WPF com warnings como erro.
6. Publicar pasta e EXE single-file.
7. Abrir os dois executáveis em banco isolado.
8. Só então publicar a release.
