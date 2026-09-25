from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'

# -------- MAIN XAML: real simultaneous-sale tabs --------
p=d/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig')

# Remove the misleading "Venda em espera" shortcut added by the previous stabilization layer.
x=re.sub(r'\s*<Button Style="\{StaticResource NavButton\}" Content="⏸\s+VENDA EM ESPERA" Click="HoldSale_Click"/>','',x)

# Keep the old legacy wait-sales tab hidden; simultaneous sales are handled by the tab strip below.
fp=d/'FinalOperationsWindow.xaml'
if fp.exists():
    fx=fp.read_text(encoding='utf-8-sig')
    fx=fx.replace('<TabItem Header="VENDAS EM ESPERA">','<TabItem Header="VENDAS EM ESPERA" Visibility="Collapsed">',1)
    fp.write_text(fx,encoding='utf-8')

# Add a compact tab strip above the search/cart area.
if 'x:Name="MultiSaleTabsPanel"' not in x:
    anchor='<StackPanel Grid.Row="0">'
    if anchor not in x:
        raise RuntimeError('Main sale-area StackPanel anchor missing')
    bar=r'''
                <Border Background="#EEF5F1" BorderBrush="#CFE0D6" BorderThickness="1" CornerRadius="10" Padding="8" Margin="0,0,0,10">
                    <Grid>
                        <Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
                        <ScrollViewer HorizontalScrollBarVisibility="Auto" VerticalScrollBarVisibility="Disabled">
                            <WrapPanel x:Name="MultiSaleTabsPanel" VerticalAlignment="Center"/>
                        </ScrollViewer>
                        <Button Grid.Column="1" Content="+ NOVA VENDA" Padding="15,9" Margin="8,0,0,0" Background="#0B6B3A" Foreground="White" FontWeight="Bold" Click="NewMultiSale_Click"/>
                        <Button Grid.Column="2" Content="FECHAR ABA" Padding="13,9" Margin="6,0,0,0" Click="CloseMultiSale_Click"/>
                    </Grid>
                </Border>
'''
    x=x.replace(anchor,anchor+bar,1)

p.write_text(x,encoding='utf-8')

# -------- MAIN CODE: independent carts/tabs --------
p=d/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')

# Insert state fields just after the class opening.
if 'private sealed class MultiSaleSlot037' not in c:
    class_match=re.search(r'public partial class MainWindow\s*:\s*Window\s*\{',c)
    if not class_match:
        raise RuntimeError('MainWindow class opening not found')
    fields=r'''
    private sealed class MultiSaleSlot037
    {
        public int Number { get; init; }
        public Cart Cart { get; set; } = new();
        public string CustomerLabel { get; set; } = "CONSUMIDOR";
        public Guid? OrderId { get; set; }
    }

    private readonly List<MultiSaleSlot037> _multiSales037 = new();
    private int _currentMultiSale037;
    private int _nextMultiSaleNumber037 = 2;
    private bool _multiSaleSwitching037;
'''
    pos=class_match.end()
    c=c[:pos]+fields+c[pos:]

# Initialize tabs immediately after MainWindow InitializeComponent.
if 'InitializeMultiSales037();' not in c:
    ctor=re.search(r'public\s+MainWindow\s*\([^)]*\)\s*\{',c)
    if not ctor:
        raise RuntimeError('MainWindow constructor not found')
    init_pos=c.find('InitializeComponent();',ctor.end())
    if init_pos<0:
        raise RuntimeError('MainWindow InitializeComponent not found')
    init_end=init_pos+len('InitializeComponent();')
    c=c[:init_end]+'\n        InitializeMultiSales037();'+c[init_end:]

# Add handlers/methods before the stable cancel handler.
anchor='    private async void CancelCurrentStable_Click'
if anchor not in c:
    raise RuntimeError('Stable current-sale cancel anchor missing')

methods=r'''
    private Cart CloneCart037(Cart source)
    {
        var copy = new Cart { CustomerId = source.CustomerId };
        foreach (var item in source.Items)
            copy.AddCustom(item.ProductId, item.Code, item.Name, item.Quantity, item.UnitPrice);
        copy.SetDiscount(source.Discount);
        return copy;
    }

    private void InitializeMultiSales037()
    {
        if (_multiSales037.Count != 0) return;
        _multiSales037.Add(new MultiSaleSlot037
        {
            Number = 1,
            Cart = CloneCart037(_workflow.Cart),
            CustomerLabel = string.IsNullOrWhiteSpace(CustomerText?.Text) ? "CONSUMIDOR" : CustomerText.Text,
            OrderId = _activeOrderId
        });
        _currentMultiSale037 = 0;
        RefreshMultiSaleTabs037();
    }

    private void SyncCurrentMultiSale037()
    {
        if (_multiSaleSwitching037 || _multiSales037.Count == 0) return;
        var slot = _multiSales037[_currentMultiSale037];
        slot.Cart = CloneCart037(_workflow.Cart);
        slot.CustomerLabel = string.IsNullOrWhiteSpace(CustomerText.Text) ? "CONSUMIDOR" : CustomerText.Text;
        slot.OrderId = _activeOrderId;
        RefreshMultiSaleTabs037();
    }

    private void RefreshMultiSaleTabs037()
    {
        if (MultiSaleTabsPanel is null) return;
        MultiSaleTabsPanel.Children.Clear();
        for (var i = 0; i < _multiSales037.Count; i++)
        {
            var slot = _multiSales037[i];
            var active = i == _currentMultiSale037;
            var b = new Button
            {
                Tag = i,
                Content = $"VENDA {slot.Number}   {slot.Cart.Total:C}",
                Padding = new Thickness(14, 8, 14, 8),
                Margin = new Thickness(3),
                FontWeight = active ? FontWeights.Bold : FontWeights.SemiBold,
                Background = active ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(11,107,58)) : System.Windows.Media.Brushes.White,
                Foreground = active ? System.Windows.Media.Brushes.White : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(35,49,41))
            };
            b.Click += MultiSaleTab037_Click;
            MultiSaleTabsPanel.Children.Add(b);
        }
    }

    private async void MultiSaleTab037_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button b || b.Tag is not int index) return;
        await SwitchMultiSale037(index);
    }

    private async Task SwitchMultiSale037(int index)
    {
        if (index < 0 || index >= _multiSales037.Count || index == _currentMultiSale037) return;
        SyncCurrentMultiSale037();
        _multiSaleSwitching037 = true;
        try
        {
            _currentMultiSale037 = index;
            var slot = _multiSales037[index];
            await _workflow.CancelAsync();
            await _workflow.ReplaceCartAsync(CloneCart037(slot.Cart));
            _activeOrderId = slot.OrderId;
            CustomerText.Text = string.IsNullOrWhiteSpace(slot.CustomerLabel) ? "CONSUMIDOR" : slot.CustomerLabel;
            RefreshCart();
        }
        finally { _multiSaleSwitching037 = false; }
        RefreshMultiSaleTabs037();
        SearchBox.Focus();
        SetStatus($"VENDA {_multiSales037[index].Number} ATIVA");
    }

    private async void NewMultiSale_Click(object sender, RoutedEventArgs e)
    {
        SyncCurrentMultiSale037();
        _multiSaleSwitching037 = true;
        try
        {
            await _workflow.CancelAsync();
            var slot = new MultiSaleSlot037 { Number = _nextMultiSaleNumber037++ };
            _multiSales037.Add(slot);
            _currentMultiSale037 = _multiSales037.Count - 1;
            _activeOrderId = null;
            CustomerText.Text = "CONSUMIDOR";
            RefreshCart();
        }
        finally { _multiSaleSwitching037 = false; }
        RefreshMultiSaleTabs037();
        SearchBox.Focus();
        SetStatus($"VENDA {_multiSales037[_currentMultiSale037].Number} ABERTA");
    }

    private async void CloseMultiSale_Click(object sender, RoutedEventArgs e)
    {
        if (_multiSales037.Count == 0) return;
        SyncCurrentMultiSale037();
        var slot = _multiSales037[_currentMultiSale037];
        if (slot.Cart.Items.Count > 0 &&
            MessageBox.Show($"Fechar a aba VENDA {slot.Number}?\n\nO carrinho desta aba será descartado.", "Fechar venda", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;

        _multiSaleSwitching037 = true;
        try
        {
            await _workflow.CancelAsync();
            if (_multiSales037.Count == 1)
            {
                _multiSales037[0] = new MultiSaleSlot037 { Number = slot.Number };
                _currentMultiSale037 = 0;
                _activeOrderId = null;
                CustomerText.Text = "CONSUMIDOR";
            }
            else
            {
                _multiSales037.RemoveAt(_currentMultiSale037);
                if (_currentMultiSale037 >= _multiSales037.Count) _currentMultiSale037 = _multiSales037.Count - 1;
                var next = _multiSales037[_currentMultiSale037];
                await _workflow.ReplaceCartAsync(CloneCart037(next.Cart));
                _activeOrderId = next.OrderId;
                CustomerText.Text = string.IsNullOrWhiteSpace(next.CustomerLabel) ? "CONSUMIDOR" : next.CustomerLabel;
            }
            RefreshCart();
        }
        finally { _multiSaleSwitching037 = false; }
        RefreshMultiSaleTabs037();
        SearchBox.Focus();
    }

'''
if 'private Cart CloneCart037' not in c:
    c=c.replace(anchor,methods+anchor,1)

# Keep tab snapshot synchronized whenever the UI refreshes the current cart.
if 'SyncCurrentMultiSale037(); // MULTISALE037' not in c:
    sig=re.search(r'private\s+void\s+RefreshCart\s*\(\s*\)\s*\{',c)
    if not sig:
        raise RuntimeError('RefreshCart method not found')
    start=sig.end()
    depth=1
    j=start
    while j<len(c) and depth:
        if c[j]=='{': depth+=1
        elif c[j]=='}': depth-=1
        j+=1
    if depth!=0:
        raise RuntimeError('RefreshCart brace matching failed')
    insert_pos=j-1
    c=c[:insert_pos]+'\n        SyncCurrentMultiSale037(); // MULTISALE037\n'+c[insert_pos:]

p.write_text(c,encoding='utf-8')

print('ONCA_MULTISALE_037_APPLIED=YES')
