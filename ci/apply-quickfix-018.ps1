Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Join-Path $PWD "work\ONCA-PDV-PRO"
if (-not (Test-Path $root)) { throw "Fonte extraida nao encontrada" }

function R([string]$p) { [IO.File]::ReadAllText($p) }
function W([string]$p,[string]$t) { [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($true)) }
function RR([string]$p,[string]$a,[string]$b) {
  $t=R $p
  if(-not $t.Contains($a)){ throw "Trecho nao encontrado em $p" }
  W $p ($t.Replace($a,$b))
}

$contracts=Join-Path $root "src\OncaPDV.Application\Contracts.cs"
$a=@'
    public Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct = default) => products.SearchAsync(term, ct);

    public async Task<ScanResult> ScanAsync(string query, CancellationToken ct = default)
'@
$b=@'
    public Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct = default) => products.SearchAsync(term, ct);

    public async Task AddToCartAsync(Product product, CancellationToken ct = default)
    {
        Cart.Add(product);
        await recovery.SaveAsync(Cart, ct);
    }

    public async Task AddMiscAsync(decimal price, string? description, CancellationToken ct = default)
    {
        if (price <= 0) throw new DomainException("Informe um preço maior que zero.");
        var baseProduct = await products.FindAsync("DIVERSOS", ct)
            ?? throw new DomainException("Produto DIVERSOS não encontrado.");
        var label = string.IsNullOrWhiteSpace(description) ? "DIVERSOS" : $"DIVERSOS - {description.Trim()}";
        var item = baseProduct with { Name = label, SalePrice = price, PromotionalPrice = null, PromotionStartsAt = null, PromotionEndsAt = null };
        Cart.Add(item);
        await recovery.SaveAsync(Cart, ct);
    }

    public async Task<ScanResult> ScanAsync(string query, CancellationToken ct = default)
'@
RR $contracts $a $b

$xaml=Join-Path $root "src\OncaPDV.Desktop\MainWindow.xaml"
$a='                <Border Background="#0B6B3A" CornerRadius="12" Padding="20" Margin="0,0,0,12">'
$b=@'
                <Button Style="{StaticResource RoundedButton}" Background="#D28A14" Foreground="White"
                        Content="+ ITEM DIVERSOS  [F3]" FontSize="20" FontWeight="Bold" Height="64"
                        Margin="0,0,0,12" Click="Misc_Click"/>

                <Border Background="#0B6B3A" CornerRadius="12" Padding="20" Margin="0,0,0,12">
'@
RR $xaml $a $b

$main=Join-Path $root "src\OncaPDV.Desktop\MainWindow.xaml.cs"
$t=R $main
$t=$t.Replace("using System.Collections.ObjectModel;","using System.Collections.ObjectModel;"+[Environment]::NewLine+"using System.Globalization;"+[Environment]::NewLine+"using Microsoft.VisualBasic;")

$pattern='(?s)    private async Task AddProduct\(\)\s*\{.*?\r?\n    \}\r?\n\r?\n    private async Task OpenProduct'
$rep=@'
    private async Task AddProduct()
    {
        var query = SearchBox.Text.Trim();
        if (query.Length == 0) return;

        if (query.Equals("DIVERSOS", StringComparison.OrdinalIgnoreCase))
        {
            await AddMiscAsync();
            return;
        }

        var matches = (await _workflow.SearchAsync(query)).Where(x => x.Active).ToList();
        var exact = matches.FirstOrDefault(x =>
            x.InternalCode.Equals(query, StringComparison.OrdinalIgnoreCase) ||
            (!string.IsNullOrWhiteSpace(x.Barcode) && x.Barcode.Equals(query, StringComparison.OrdinalIgnoreCase)));

        if (exact is not null)
        {
            var result = await _workflow.ScanAsync(query);
            if (result.Status == ScanStatus.DuplicateBlocked)
            {
                SetStatus("LEITURA DUPLICADA BLOQUEADA");
                return;
            }
            RefreshCart();
            SetStatus(result.Product?.Name ?? exact.Name);
            SearchBox.Clear();
            SearchBox.Focus();
            return;
        }

        if (matches.Count == 0)
        {
            SetStatus("PRODUTO NÃO CADASTRADO");
            if (MessageBox.Show(
                    "PRODUTO NÃO CADASTRADO\n\nCadastrar agora?\n\nO carrinho será preservado.",
                    "ONÇA PDV",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question) == MessageBoxResult.Yes)
                await OpenProduct(query, true);

            SearchBox.SelectAll();
            return;
        }

        var selected = SelectProduct(matches);
        if (selected is null) { SearchBox.Focus(); return; }

        await _workflow.AddToCartAsync(selected);
        RefreshCart();
        SetStatus(selected.Name);
        SearchBox.Clear();
        SearchBox.Focus();
    }

    private Product? SelectProduct(IReadOnlyList<Product> products)
    {
        Product? selected = null;
        var w = new Window
        {
            Title = $"Selecionar produto - {products.Count} encontrado(s)",
            Width = 920,
            Height = 560,
            Owner = this,
            WindowStartupLocation = WindowStartupLocation.CenterOwner
        };

        var layout = new Grid { Margin = new Thickness(14) };
        layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var title = new TextBlock
        {
            Text = "PRODUTOS COM NOME PARECIDO - SELECIONE O CORRETO",
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Margin = new Thickness(0,0,0,10)
        };
        Grid.SetRow(title,0);
        layout.Children.Add(title);

        var grid = new DataGrid { AutoGenerateColumns=false, IsReadOnly=true, ItemsSource=products, SelectionMode=DataGridSelectionMode.Single };
        grid.Columns.Add(new DataGridTextColumn { Header="CÓDIGO", Binding=new System.Windows.Data.Binding("InternalCode"), Width=130 });
        grid.Columns.Add(new DataGridTextColumn { Header="PRODUTO", Binding=new System.Windows.Data.Binding("Name"), Width=new DataGridLength(1,DataGridLengthUnitType.Star) });
        grid.Columns.Add(new DataGridTextColumn { Header="CÓD. BARRAS", Binding=new System.Windows.Data.Binding("Barcode"), Width=170 });
        grid.Columns.Add(new DataGridTextColumn { Header="PREÇO", Binding=new System.Windows.Data.Binding("SalePrice"){StringFormat="C"}, Width=110 });
        grid.Columns.Add(new DataGridTextColumn { Header="ESTOQUE", Binding=new System.Windows.Data.Binding("Stock"){StringFormat="N2"}, Width=100 });
        Grid.SetRow(grid,1);
        layout.Children.Add(grid);

        var buttons = new StackPanel { Orientation=Orientation.Horizontal, HorizontalAlignment=HorizontalAlignment.Right, Margin=new Thickness(0,10,0,0) };
        var cancel = new Button { Content="CANCELAR", Padding=new Thickness(18,8,18,8), Margin=new Thickness(4) };
        var choose = new Button { Content="ADICIONAR SELECIONADO", Padding=new Thickness(18,8,18,8), Margin=new Thickness(4), FontWeight=FontWeights.Bold };
        cancel.Click += (_,_) => w.DialogResult=false;
        choose.Click += (_,_) => { if(grid.SelectedItem is Product p){ selected=p; w.DialogResult=true; } };
        grid.MouseDoubleClick += (_,_) => { if(grid.SelectedItem is Product p){ selected=p; w.DialogResult=true; } };
        buttons.Children.Add(cancel);
        buttons.Children.Add(choose);
        Grid.SetRow(buttons,2);
        layout.Children.Add(buttons);
        w.Content=layout;
        w.ShowDialog();
        return selected;
    }

    private async Task AddMiscAsync()
    {
        var raw=Interaction.InputBox("Digite o preço do item DIVERSOS:","ITEM DIVERSOS","");
        if(string.IsNullOrWhiteSpace(raw)) return;

        decimal price;
        var ok=decimal.TryParse(raw,NumberStyles.Currency,CultureInfo.GetCultureInfo("pt-BR"),out price)
            || decimal.TryParse(raw.Replace(',','.'),NumberStyles.Number,CultureInfo.InvariantCulture,out price);
        if(!ok || price<=0)
        {
            MessageBox.Show("Preço inválido. Digite um valor maior que zero.","ITEM DIVERSOS",MessageBoxButton.OK,MessageBoxImage.Warning);
            return;
        }

        var description=Interaction.InputBox("Descrição opcional do item:","ITEM DIVERSOS","DIVERSOS");
        await _workflow.AddMiscAsync(price,description);
        RefreshCart();
        SetStatus($"DIVERSOS ADICIONADO - {price:C}");
        SearchBox.Clear();
        SearchBox.Focus();
    }

    private async Task OpenProduct
'@
$rx=[regex]::new($pattern)
if(-not $rx.IsMatch($t)){ throw "AddProduct nao encontrado" }
$t=$rx.Replace($t,$rep,1)

$a=@'
            var sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId);
            var printed = await _printer.PrintAsync(new(sale));
            await RefreshSales();
            RefreshCart();

            var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
            var received = cash.Sum(x => x.Received ?? x.Amount);
            var change = cash.Sum(x => x.Change);
            var cashSummary = cash.Length == 0 ? string.Empty : $"
Recebido em dinheiro: {received:C}
Troco: {change:C}";

            MessageBox.Show(
                $"VENDA CONCLUÍDA

Venda Nº {sale.Number:000000}
Total: {sale.Total:C}
Pagamento: {string.Join(" + ", sale.Payments.Select(x => x.Method))}{cashSummary}
Cupom: {(printed.Success ? "OK" : "FALHOU")}",
                "ONÇA PDV",
                MessageBoxButton.OK,
                MessageBoxImage.Information);

            SetStatus("CAIXA LIVRE — PRÓXIMA VENDA");
'@
$b=@'
            var sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId);
            await RefreshSales();
            RefreshCart();

            var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
            var received = cash.Sum(x => x.Received ?? x.Amount);
            var change = cash.Sum(x => x.Change);
            var cashSummary = cash.Length == 0 ? string.Empty : $"
Recebido em dinheiro: {received:C}
Troco: {change:C}";

            var printNow = MessageBox.Show(
                $"VENDA CONCLUÍDA

Venda Nº {sale.Number:000000}
Total: {sale.Total:C}
Pagamento: {string.Join(" + ", sale.Payments.Select(x => x.Method))}{cashSummary}

Deseja imprimir a nota?",
                "ONÇA PDV",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question) == MessageBoxResult.Yes;

            if (printNow)
            {
                var printed = await _printer.PrintAsync(new(sale));
                if (!printed.Success)
                    MessageBox.Show(printed.Error ?? "Falha ao imprimir a nota.","Impressão",MessageBoxButton.OK,MessageBoxImage.Warning);
            }

            SetStatus("CAIXA LIVRE — PRÓXIMA VENDA");
'@
if(-not $t.Contains($a)){ throw "Pagamento nao encontrado" }
$t=$t.Replace($a,$b)

$a='    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();'
$b=@'
    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();
    private async void Misc_Click(object sender, RoutedEventArgs e) => await AddMiscAsync();
'@
if(-not $t.Contains($a)){ throw "Add_Click nao encontrado" }
$t=$t.Replace($a,$b)

$a=@'
        if (e.Key == Key.F1) Product_Click(sender, e);
        else if (e.Key == Key.F2) Pay_Click(sender, e);
        else if (e.Key == Key.Escape) Cancel_Click(sender, e);
'@
$b=@'
        if (e.Key == Key.F1) Product_Click(sender, e);
        else if (e.Key == Key.F2) Pay_Click(sender, e);
        else if (e.Key == Key.F3) Misc_Click(sender, e);
        else if (e.Key == Key.Escape) Cancel_Click(sender, e);
'@
if(-not $t.Contains($a)){ throw "Atalhos nao encontrados" }
$t=$t.Replace($a,$b)
W $main $t

$db=Join-Path $root "src\OncaPDV.Infrastructure\Database.cs"
$t=R $db
$t=$t.Replace('UPDATE products SET stock=stock-$q WHERE id=$p AND stock >= $q','UPDATE products SET stock=stock-$q WHERE id=$p')
$t=$t.Replace('if (changed != 1) throw new DomainException($"Estoque insuficiente para {item.Name}.");','if (changed != 1) throw new DomainException($"Produto não encontrado para baixa de estoque: {item.Name}.");')
W $db $t

$pg=Join-Path $root "src\OncaPDV.PostgreSql\CentralDatabase.cs"
$t=R $pg
$t=$t.Replace('UPDATE products SET stock=stock-@quantity WHERE id=@product AND active=true AND stock>=@quantity RETURNING stock','UPDATE products SET stock=stock-@quantity WHERE id=@product AND active=true RETURNING stock')
$t=$t.Replace('if(left is null)throw new DomainException($"Estoque insuficiente para {item.Name}.");','if(left is null)throw new DomainException($"Produto não encontrado para baixa de estoque: {item.Name}.");')
W $pg $t

$proj=Join-Path $root "src\OncaPDV.Desktop\OncaPDV.Desktop.csproj"
$t=(R $proj).Replace("<Version>0.1.3</Version>","<Version>0.1.8</Version>")
W $proj $t

Write-Host "ONCA PDV 0.1.8 QUICKFIX APLICADO"
