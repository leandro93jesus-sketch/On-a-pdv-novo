# ONÇA PDV PRO 0.2.1 — Consistência profissional

Base: release 0.2.0, mantendo banco e regras de negócio.

## Objetivo
Corrigir a sensação de sistema misturado: na 0.2.0 apenas quatro janelas usavam o tema profissional. A 0.2.1 padroniza todas as janelas operacionais não relacionadas à impressão e remove artefatos visuais de versões antigas.

## Mudanças
- Novo `ProfessionalCompatibility0210.xaml` com estilos implícitos para janelas legadas.
- 34 XAMLs não relacionados à impressão passam a carregar o tema compatível.
- Nenhuma referência visual a versões antigas 0.1.x permanece nos XAMLs.
- Nenhuma grade operacional usa `AutoGenerateColumns="True"`.
- Removidos emojis decorativos de telas administrativas.
- MainWindow: navegação de Gestão e Sistema recolhível, remoção de entrada duplicada de vendas, remoção de textos falsos/fixos como Loja Matriz, Caixa 001 e Administrador, e menos atalhos duplicados.
- Crediário: filtros diários simplificados; filtros menos frequentes ficam em Mais filtros.
- Vendas e pós-venda: colunas explícitas e ações destrutivas separadas em Ações administrativas; removido cancelamento duplicado.
- Compras, Fornecedores, Operações, Clientes e Documentos receberam layout consistente e colunas explícitas.

## Impressão congelada
Não alterar lógica, código ou XAML dos componentes sensíveis de impressão/pagamento:
- `src/OncaPDV.Printing/*`
- `ConfiguredPhysicalPrintService.cs`
- `PrinterSettingsWindow.xaml` e `.xaml.cs`
- `ReceiptPreviewWindow.xaml` e `.xaml.cs`
- `PaymentWindow.xaml` e `.xaml.cs`
- `MainWindow.xaml.cs`
- `SalesManagementWindow.xaml.cs`

O XAML de SalesManagement pode ser reorganizado, mas handlers e código de reimpressão não mudam.

## Gates de entrega
1. Comparar hashes dos arquivos congelados com a 0.2.0.
2. Validar todos os XAMLs.
3. Exigir zero `AutoGenerateColumns="True"` em janelas operacionais.
4. Exigir zero versões 0.1.x visíveis em XAML.
5. Rodar toda a regressão .NET.
6. Build WPF com warnings como erro.
7. Publicar folder e single-file win-x64 self-contained.
8. Abrir ambos com banco isolado antes de release.
