Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Join-Path $PWD "work\ONCA-PDV-PRO"
if (-not (Test-Path $root)) { throw "Fonte extraida nao encontrada" }

function Get-Text([string]$p) { [IO.File]::ReadAllText($p) }
function Set-Text([string]$p,[string]$t) { [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($true)) }
function Replace-Req([string]$p,[string]$a,[string]$b) {
  $t=Get-Text $p
  if(-not $t.Contains($a)){ throw "Trecho nao encontrado em $p" }
  Set-Text $p ($t.Replace($a,$b))
}

$contracts=Join-Path $root "src\OncaPDV.Application\Contracts.cs"
$a='    public async Task<ScanResult> ScanAsync(string query, CancellationToken ct = default)'
$b=@'
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
Replace-Req $contracts $a $b

$xaml=Join-Path $root "src\OncaPDV.Desktop\MainWindow.xaml"
$a='                <Border Background="#0B6B3A" CornerRadius="12" Padding="20" Margin="0,0,0,12">'
$b=@'
                <Button Style="{StaticResource RoundedButton}" Background="#D28A14" Foreground="White"
                        Content="+ ITEM DIVERSOS  [F3]" FontSize="20" FontWeight="Bold" Height="64"
                        Margin="0,0,0,12" Click="Misc_Click"/>

                <Border Background="#0B6B3A" CornerRadius="12" Padding="20" Margin="0,0,0,12">
'@
Replace-Req $xaml $a $b

# DIVERSOS fixo dentro do proprio carrinho: valor + adicionar
$t=Get-Text $xaml
$oldRows='                    <Grid.RowDefinitions><RowDefinition Height="54"/><RowDefinition/><RowDefinition Height="46"/></Grid.RowDefinitions>'
$newRows='                    <Grid.RowDefinitions><RowDefinition Height="54"/><RowDefinition Height="64"/><RowDefinition/><RowDefinition Height="46"/></Grid.RowDefinitions>'
if(-not $t.Contains($oldRows)){ throw "Linhas do carrinho nao encontradas" }
$t=$t.Replace($oldRows,$newRows)

$oldGrid='                    <DataGrid Grid.Row="1" x:Name="CartGrid"'
$newGrid=@'
                    <Border Grid.Row="1" Background="#FFF4D6" BorderBrush="#D9A62E" BorderThickness="1" CornerRadius="8" Margin="10,2,10,6" Padding="10,7">
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="Auto"/>
                                <ColumnDefinition Width="170"/>
                                <ColumnDefinition Width="Auto"/>
                                <ColumnDefinition Width="*"/>
                            </Grid.ColumnDefinitions>
                            <TextBlock Text="DIVERSOS" FontSize="18" FontWeight="Bold" Foreground="#7A4D00" VerticalAlignment="Center" Margin="0,0,14,0"/>
                            <TextBox Grid.Column="1" x:Name="MiscValueBox" FontSize="18" FontWeight="Bold" HorizontalContentAlignment="Right"
                                     ToolTip="Digite o valor do item DIVERSOS" Margin="0,0,10,0"/>
                            <Button Grid.Column="2" Style="{StaticResource RoundedButton}" Background="#D28A14" Foreground="White"
                                    Content="ADICIONAR DIVERSOS" FontWeight="Bold" Padding="16,8" Click="MiscCart_Click"/>
                            <TextBlock Grid.Column="3" Text="Digite o valor e clique em ADICIONAR" Foreground="#8A6A2E"
                                       VerticalAlignment="Center" Margin="12,0,0,0"/>
                        </Grid>
                    </Border>

                    <DataGrid Grid.Row="2" x:Name="CartGrid"
'@
if(-not $t.Contains($oldGrid)){ throw "Grid do carrinho nao encontrado" }
$t=$t.Replace($oldGrid,$newGrid)

$oldFooter='                    <Grid Grid.Row="2" Margin="13,2">'
$newFooter='                    <Grid Grid.Row="3" Margin="13,2">'
if(-not $t.Contains($oldFooter)){ throw "Rodape do carrinho nao encontrado" }
$t=$t.Replace($oldFooter,$newFooter)
Set-Text $xaml $t

$main=Join-Path $root "src\OncaPDV.Desktop\MainWindow.xaml.cs"
$t=Get-Text $main
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

$payPattern='(?s)            var sale = await _workflow\.CompleteAsync\(dialog\.Payments, OperatorId\);.*?            SetStatus\("CAIXA LIVRE — PRÓXIMA VENDA"\);'
$payRep=@'
            var sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId);
            await RefreshSales();
            RefreshCart();

            var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
            var received = cash.Sum(x => x.Received ?? x.Amount);
            var change = cash.Sum(x => x.Change);
            var cashSummary = cash.Length == 0 ? string.Empty : $"\nRecebido em dinheiro: {received:C}\nTroco: {change:C}";

            var printNow = MessageBox.Show(
                $"VENDA CONCLUÍDA\n\nVenda Nº {sale.Number:000000}\nTotal: {sale.Total:C}\nPagamento: {string.Join(" + ", sale.Payments.Select(x => x.Method))}{cashSummary}\n\nDeseja imprimir a nota?",
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
$payRx=[regex]::new($payPattern)
if(-not $payRx.IsMatch($t)){ throw "Pagamento nao encontrado" }
$t=$payRx.Replace($t,$payRep,1)

$a='    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();'
$b=@'
    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();
    private async void Misc_Click(object sender, RoutedEventArgs e) => await AddMiscAsync();
    private async void MiscCart_Click(object sender, RoutedEventArgs e)
    {
        var raw = MiscValueBox.Text.Trim();
        decimal price;
        var ok =
            decimal.TryParse(raw, NumberStyles.Currency, CultureInfo.GetCultureInfo("pt-BR"), out price) ||
            decimal.TryParse(raw.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out price);

        if (!ok || price <= 0)
        {
            MessageBox.Show("Digite um valor válido para DIVERSOS.", "ITEM DIVERSOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            MiscValueBox.Focus();
            MiscValueBox.SelectAll();
            return;
        }

        await _workflow.AddMiscAsync(price, "DIVERSOS");
        MiscValueBox.Clear();
        RefreshCart();
        SetStatus($"DIVERSOS ADICIONADO - {price:C}");
        MiscValueBox.Focus();
    }
'@
if(-not $t.Contains($a)){ throw "Add_Click nao encontrado" }
$t=$t.Replace($a,$b)

$keyNeedle='        else if (e.Key == Key.F2) Pay_Click(sender, e);'
if(-not $t.Contains($keyNeedle)){ throw "Atalho F2 nao encontrado" }
$t=$t.Replace($keyNeedle,$keyNeedle+[Environment]::NewLine+'        else if (e.Key == Key.F3) Misc_Click(sender, e);')
Set-Text $main $t

$db=Join-Path $root "src\OncaPDV.Infrastructure\Database.cs"
$t=Get-Text $db
$t=$t.Replace('UPDATE products SET stock=stock-$q WHERE id=$p AND stock >= $q','UPDATE products SET stock=stock-$q WHERE id=$p')
$t=$t.Replace('if (changed != 1) throw new DomainException($"Estoque insuficiente para {item.Name}.");','if (changed != 1) throw new DomainException($"Produto não encontrado para baixa de estoque: {item.Name}.");')
Set-Text $db $t

$pg=Join-Path $root "src\OncaPDV.PostgreSql\CentralDatabase.cs"
$t=Get-Text $pg
$t=$t.Replace('UPDATE products SET stock=stock-@quantity WHERE id=@product AND active=true AND stock>=@quantity RETURNING stock','UPDATE products SET stock=stock-@quantity WHERE id=@product AND active=true RETURNING stock')
$t=$t.Replace('if(left is null)throw new DomainException($"Estoque insuficiente para {item.Name}.");','if(left is null)throw new DomainException($"Produto não encontrado para baixa de estoque: {item.Name}.");')
Set-Text $pg $t

$proj=Join-Path $root "src\OncaPDV.Desktop\OncaPDV.Desktop.csproj"
$t=(Get-Text $proj).Replace("<Version>0.1.3</Version>","<Version>0.1.9</Version>")
Set-Text $proj $t

Write-Host "ONCA PDV 0.1.9 QUICKFIX APLICADO - DIVERSOS DENTRO DO CARRINHO"
