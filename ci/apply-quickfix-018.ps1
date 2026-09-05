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
        var label = string.IsNullOrWhiteSpace(description) ? "DIVERSOS" : description.Trim();
        var item = baseProduct with { Name = label, SalePrice = price, PromotionalPrice = null, PromotionStartsAt = null, PromotionEndsAt = null };
        Cart.Add(item);
        await recovery.SaveAsync(Cart, ct);
    }

    public async Task<ScanResult> ScanAsync(string query, CancellationToken ct = default)
'@
Replace-Req $contracts $a $b

# Carrinho: cada DIVERSOS com nome diferente permanece separado e qualquer linha pode ser editada
$models=Join-Path $root "src\OncaPDV.Domain\Models.cs"
$t=Get-Text $models
$oldMerge='        var existing = _items.FindIndex(x => x.ProductId == product.Id && x.UnitPrice == product.CurrentPrice(DateTimeOffset.Now));'
$newMerge='        var existing = _items.FindIndex(x => x.ProductId == product.Id && x.UnitPrice == product.CurrentPrice(DateTimeOffset.Now) && x.Name.Equals(product.Name, StringComparison.OrdinalIgnoreCase));'
if(-not $t.Contains($oldMerge)){ throw "Regra de agrupamento do carrinho nao encontrada" }
$t=$t.Replace($oldMerge,$newMerge)

$changeQtyNeedle='    public void ChangeQuantity(Guid productId, decimal quantity)'
$editMethod=@'
    public void EditItem(int lineIndex, string name, decimal quantity, decimal unitPrice)
    {
        if (lineIndex < 0 || lineIndex >= _items.Count) throw new DomainException("Item não encontrado.");
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Informe o nome do produto.");
        if (quantity <= 0) throw new DomainException("Quantidade deve ser positiva.");
        if (unitPrice <= 0) throw new DomainException("Valor unitário deve ser maior que zero.");

        var current = _items[lineIndex];
        _items[lineIndex] = current with
        {
            Name = name.Trim(),
            Quantity = quantity,
            UnitPrice = decimal.Round(unitPrice, 2, MidpointRounding.AwayFromZero)
        };
    }

'@
if(-not $t.Contains($changeQtyNeedle)){ throw "ChangeQuantity nao encontrado" }
$t=$t.Replace($changeQtyNeedle,$editMethod+$changeQtyNeedle)
Set-Text $models $t

# Workflow persiste a edicao da linha do carrinho
$t=Get-Text $contracts
$scanNeedle='    public async Task<ScanResult> ScanAsync(string query, CancellationToken ct = default)'
$editWorkflow=@'
    public async Task EditCartItemAsync(int lineIndex, string name, decimal quantity, decimal unitPrice, CancellationToken ct = default)
    {
        Cart.EditItem(lineIndex, name, quantity, unitPrice);
        await recovery.SaveAsync(Cart, ct);
    }

'@
if(-not $t.Contains($scanNeedle)){ throw "ScanAsync nao encontrado apos patch" }
$t=$t.Replace($scanNeedle,$editWorkflow+$scanNeedle)
Set-Text $contracts $t

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
$newRows='                    <Grid.RowDefinitions><RowDefinition Height="54"/><RowDefinition Height="72"/><RowDefinition/><RowDefinition Height="46"/></Grid.RowDefinitions>'
if(-not $t.Contains($oldRows)){ throw "Linhas do carrinho nao encontradas" }
$t=$t.Replace($oldRows,$newRows)

$oldGrid='                    <DataGrid Grid.Row="1" x:Name="CartGrid"'
$newGrid=@'
                    <Border Grid.Row="1" Background="#FFF4D6" BorderBrush="#D9A62E" BorderThickness="1" CornerRadius="8" Margin="10,2,10,6" Padding="10,7">
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="Auto"/>
                                <ColumnDefinition Width="2*"/>
                                <ColumnDefinition Width="Auto"/>
                                <ColumnDefinition Width="150"/>
                                <ColumnDefinition Width="Auto"/>
                            </Grid.ColumnDefinitions>
                            <TextBlock Text="DIVERSOS" FontSize="18" FontWeight="Bold" Foreground="#7A4D00" VerticalAlignment="Center" Margin="0,0,12,0"/>

                            <StackPanel Grid.Column="1" Margin="0,0,10,0">
                                <TextBlock Text="NOME DO PRODUTO" FontSize="11" FontWeight="Bold" Foreground="#7A4D00"/>
                                <TextBox x:Name="MiscNameBox" FontSize="17" ToolTip="Digite o nome do produto"/>
                            </StackPanel>

                            <TextBlock Grid.Column="2" Text="R$" FontSize="17" FontWeight="Bold" Foreground="#7A4D00"
                                       VerticalAlignment="Center" Margin="0,15,6,0"/>

                            <StackPanel Grid.Column="3" Margin="0,0,10,0">
                                <TextBlock Text="VALOR" FontSize="11" FontWeight="Bold" Foreground="#7A4D00"/>
                                <TextBox x:Name="MiscValueBox" FontSize="17" FontWeight="Bold" HorizontalContentAlignment="Right"
                                         ToolTip="Digite o valor do item DIVERSOS"/>
                            </StackPanel>

                            <Button Grid.Column="4" Style="{StaticResource RoundedButton}" Background="#D28A14" Foreground="White"
                                    Content="ADICIONAR" FontWeight="Bold" Padding="18,9" Margin="0,14,0,0" Click="MiscCart_Click"/>
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
# Consulta de preco sem adicionar ao carrinho
$searchCols='<Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>'
$searchColsNew='<Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>'
if(-not $t.Contains($searchCols)){ throw "Colunas da busca nao encontradas" }
$t=$t.Replace($searchCols,$searchColsNew)

$productButton='<Button Grid.Column="3" Style="{StaticResource SoftButton}" Content="+ CADASTRAR PRODUTO  [F1]" Click="Product_Click" Margin="4,0,0,0"/>'
$productButtonsNew=@'
                    <Button Grid.Column="3" Style="{StaticResource SoftButton}" Content="CONSULTAR PREÇO  [F4]" Click="PriceLookup_Click" Margin="4,0,4,0"/>
                    <Button Grid.Column="4" Style="{StaticResource SoftButton}" Content="+ CADASTRAR PRODUTO  [F1]" Click="Product_Click" Margin="4,0,0,0"/>
'@
if(-not $t.Contains($productButton)){ throw "Botao cadastrar produto nao encontrado" }
$t=$t.Replace($productButton,$productButtonsNew)

$cartOpen='<DataGrid Grid.Row="2" x:Name="CartGrid" AutoGenerateColumns="False" CellEditEnding="CartGrid_CellEditEnding" Margin="10,0">'
$cartOpenNew='<DataGrid Grid.Row="2" x:Name="CartGrid" AutoGenerateColumns="False" CellEditEnding="CartGrid_CellEditEnding" PreviewMouseLeftButtonDown="CartGrid_PreviewMouseLeftButtonDown" SelectionUnit="Cell" Margin="10,0">'
if(-not $t.Contains($cartOpen)){ throw "Abertura CartGrid nao encontrada" }
$t=$t.Replace($cartOpen,$cartOpenNew)

$t=$t.Replace('<DataGridTextColumn Header="PRODUTO" Binding="{Binding Name}" IsReadOnly="True" Width="*"/>','<DataGridTextColumn Header="PRODUTO" Binding="{Binding Name}" Width="*"/>')
$t=$t.Replace('<DataGridTextColumn Header="UNITÁRIO (R$)" Binding="{Binding UnitPrice,StringFormat=N2}" IsReadOnly="True" Width="125"/>','<DataGridTextColumn Header="UNITÁRIO (R$)" Binding="{Binding UnitPrice,StringFormat=N2}" Width="125"/>')
Set-Text $xaml $t

$main=Join-Path $root "src\OncaPDV.Desktop\MainWindow.xaml.cs"
$t=Get-Text $main
$t=$t.Replace("using System.Collections.ObjectModel;","using System.Collections.ObjectModel;"+[Environment]::NewLine+"using System.Globalization;"+[Environment]::NewLine+"using Microsoft.VisualBasic;"+[Environment]::NewLine+"using System.Windows.Media;")

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

    private Product? SelectProduct(IReadOnlyList<Product> products, string actionText = "ADICIONAR SELECIONADO", string heading = "PRODUTOS COM NOME PARECIDO - SELECIONE O CORRETO")
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
            Text = heading,
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
        var choose = new Button { Content=actionText, Padding=new Thickness(18,8,18,8), Margin=new Thickness(4), FontWeight=FontWeights.Bold };
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

    private async Task LookupPriceAsync()
    {
        var query = SearchBox.Text.Trim();
        if (query.Length == 0)
        {
            SetStatus("DIGITE CÓDIGO OU NOME PARA CONSULTAR");
            SearchBox.Focus();
            return;
        }

        var matches = (await _workflow.SearchAsync(query)).Where(x => x.Active).ToList();
        if (matches.Count == 0)
        {
            MessageBox.Show("Produto não encontrado.", "CONSULTA DE PREÇO", MessageBoxButton.OK, MessageBoxImage.Information);
            SearchBox.SelectAll();
            return;
        }

        Product? product;
        var exact = matches.FirstOrDefault(x =>
            x.InternalCode.Equals(query, StringComparison.OrdinalIgnoreCase) ||
            (!string.IsNullOrWhiteSpace(x.Barcode) && x.Barcode.Equals(query, StringComparison.OrdinalIgnoreCase)) ||
            x.Name.Equals(query, StringComparison.OrdinalIgnoreCase));

        if (exact is not null) product = exact;
        else if (matches.Count == 1) product = matches[0];
        else product = SelectProduct(matches, "CONSULTAR PREÇO", "SELECIONE O PRODUTO PARA CONSULTAR");

        if (product is null)
        {
            SearchBox.Focus();
            return;
        }

        var currentPrice = product.CurrentPrice(DateTimeOffset.Now);
        MessageBox.Show(
            $"PRODUTO: {product.Name}\n\nCódigo: {product.InternalCode}\nCódigo de barras: {product.Barcode ?? "-"}\nPreço: {currentPrice:C}\nEstoque: {product.Stock:N2} {product.Unit}",
            "CONSULTA DE PREÇO — NÃO ADICIONADO AO CARRINHO",
            MessageBoxButton.OK,
            MessageBoxImage.Information);

        SetStatus($"CONSULTA: {product.Name} - {currentPrice:C}");
        SearchBox.SelectAll();
        SearchBox.Focus();
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
                $"VENDA CONCLUÍDA\n\nVenda Nº {sale.Number:000000}\nTotal: {sale.Total:C}\nPagamento: {string.Join(" + ", sale.Payments.Select(x => x.Method))}{cashSummary}\n\nAUTORIZAR IMPRESSÃO DA NOTA?\n\nA nota só será impressa se você escolher SIM.",
                "ONÇA PDV",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question,
                MessageBoxResult.No) == MessageBoxResult.Yes;

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

# Edicao direta no carrinho: nome, quantidade e valor unitario
$editPattern='(?s)    private async void CartGrid_CellEditEnding\(object sender, DataGridCellEditEndingEventArgs e\)\s*\{.*?\r?\n    \}\r?\n\r?\n    private async Task RefreshSales'
$editRep=@'
    private async void CartGrid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e)
    {
        if (e.Row.Item is not CartRow row || e.EditingElement is not TextBox box) return;

        try
        {
            var name = row.Name;
            var quantity = row.Quantity;
            var unitPrice = row.UnitPrice;

            if (e.Column.DisplayIndex == 1)
            {
                name = box.Text.Trim();
                if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Informe o nome do produto.");
            }
            else if (e.Column.DisplayIndex == 2)
            {
                var raw = box.Text.Trim();
                if (!(decimal.TryParse(raw, NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out quantity) ||
                      decimal.TryParse(raw.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out quantity)) ||
                    quantity <= 0)
                    throw new DomainException("Quantidade inválida.");
            }
            else if (e.Column.DisplayIndex == 3)
            {
                var raw = box.Text.Trim();
                if (!(decimal.TryParse(raw, NumberStyles.Currency, CultureInfo.GetCultureInfo("pt-BR"), out unitPrice) ||
                      decimal.TryParse(raw.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out unitPrice)) ||
                    unitPrice <= 0)
                    throw new DomainException("Valor unitário inválido.");
            }
            else return;

            await _workflow.EditCartItemAsync(row.LineIndex, name, quantity, unitPrice);
            SetStatus("ITEM DO CARRINHO ATUALIZADO");
            _ = Dispatcher.BeginInvoke(RefreshCart);
        }
        catch (DomainException ex)
        {
            MessageBox.Show(ex.Message, "Editar item", MessageBoxButton.OK, MessageBoxImage.Warning);
            _ = Dispatcher.BeginInvoke(RefreshCart);
        }
    }

    private void CartGrid_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        var element = e.OriginalSource as DependencyObject;
        while (element is not null && element is not DataGridCell)
            element = VisualTreeHelper.GetParent(element);

        if (element is not DataGridCell cell || cell.Column.IsReadOnly) return;
        cell.Focus();
        CartGrid.CurrentCell = new DataGridCellInfo(cell);
        CartGrid.BeginEdit();
    }

    private async Task RefreshSales
'@
$editRx=[regex]::new($editPattern)
if(-not $editRx.IsMatch($t)){ throw "Handler de edicao do carrinho nao encontrado" }
$t=$editRx.Replace($t,$editRep,1)

# RefreshCart passa o indice real da linha para edicao segura
$oldRefresh=@'
        _rows.Clear();
        foreach (var i in _workflow.Cart.Items)
            _rows.Add(new(i.ProductId, i.Code, i.Name, i.Quantity, i.UnitPrice, i.Subtotal));
'@
$newRefresh=@'
        _rows.Clear();
        for (var index = 0; index < _workflow.Cart.Items.Count; index++)
        {
            var i = _workflow.Cart.Items[index];
            _rows.Add(new(index, i.ProductId, i.Code, i.Name, i.Quantity, i.UnitPrice, i.Subtotal));
        }
'@
if(-not $t.Contains($oldRefresh)){ throw "RefreshCart original nao encontrado" }
$t=$t.Replace($oldRefresh,$newRefresh)

$t=$t.Replace('private sealed record CartRow(Guid ProductId, string Code, string Name, decimal Quantity, decimal UnitPrice, decimal Subtotal);',
              'private sealed record CartRow(int LineIndex, Guid ProductId, string Code, string Name, decimal Quantity, decimal UnitPrice, decimal Subtotal);')

$a='    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();'
$b=@'
    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();
    private async void PriceLookup_Click(object sender, RoutedEventArgs e) => await LookupPriceAsync();
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

        var itemName = MiscNameBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(itemName))
        {
            MessageBox.Show("Digite o nome do produto.", "ITEM DIVERSOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            MiscNameBox.Focus();
            return;
        }

        await _workflow.AddMiscAsync(price, itemName);
        MiscNameBox.Clear();
        MiscValueBox.Clear();
        RefreshCart();
        SetStatus($"{itemName} ADICIONADO - {price:C}");
        MiscNameBox.Focus();
    }
'@
if(-not $t.Contains($a)){ throw "Add_Click nao encontrado" }
$t=$t.Replace($a,$b)

$keyNeedle='        else if (e.Key == Key.F2) Pay_Click(sender, e);'
if(-not $t.Contains($keyNeedle)){ throw "Atalho F2 nao encontrado" }
$t=$t.Replace($keyNeedle,$keyNeedle+[Environment]::NewLine+'        else if (e.Key == Key.F3) Misc_Click(sender, e);'+[Environment]::NewLine+'        else if (e.Key == Key.F4) PriceLookup_Click(sender, e);')
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
$t=(Get-Text $proj).Replace("<Version>0.1.3</Version>","<Version>0.1.11</Version>")
Set-Text $proj $t

Write-Host "ONCA PDV 0.1.11 QUICKFIX APLICADO - CONSULTA PRECO F4 + EDICAO DIRETA CARRINHO"
