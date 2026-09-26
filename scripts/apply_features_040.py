from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'
i=root/'src'/'OncaPDV.Infrastructure'
t=root/'tests'/'OncaPDV.Tests'

def replace_exact(s,old,new,label,count=1):
    if old not in s: raise RuntimeError('Missing '+label)
    return s.replace(old,new,count)

# Only additions. Existing backend, printing, stock, payment and version 0.1.39 scripts remain unchanged.
service=Path('scripts/feature040_service.cs').read_text(encoding='utf-8')
service=service.replace('if(locked>DateTimeOffset.UtcNow)', 'if(string.IsNullOrWhiteSpace(name))throw new InvalidOperationException("Administrador não configurado.");\n        if(locked>DateTimeOffset.UtcNow)')
(i/'MultiSaleRecovery040.cs').write_text(service,encoding='utf-8')
(d/'AdminAuthorization040Window.xaml').write_text(Path('scripts/feature040_admin.xaml').read_text(encoding='utf-8'),encoding='utf-8')
(d/'AdminAuthorization040Window.xaml.cs').write_text(Path('scripts/feature040_admin.xaml.cs').read_text(encoding='utf-8'),encoding='utf-8')

# Admin PIN controls BOTH direct cancellation and edit/reopen (which cancels original).
p=d/'SalesManagementWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
a=c.index(' private async void Cancel_Click(')
b=c.index(' private async void Edit_Click(',a)
part=c[a:b]
part=replace_exact(part,'  var reason=Microsoft.VisualBasic.Interaction.InputBox(',
'''  var auth=new AdminAuthorization040Window(_db){Owner=this};
  if(auth.ShowDialog()!=true)return;
  var reason=Microsoft.VisualBasic.Interaction.InputBox(''','cancel authentication')
part=replace_exact(part,'await _advanced.CancelSaleAsync(row.Id,_operator,reason.Trim());',
                   'await _advanced.CancelSaleAsync(row.Id,_operator,$"ADMIN: {auth.AuthorizedName} | MOTIVO: {reason.Trim()}");','cancel audit')
c=c[:a]+part+c[b:]
a=c.index(' private async void Edit_Click(')
b=c.index(' private async void Payment_Click(',a)
part=c[a:b]
part=replace_exact(part,'var reason=Microsoft.VisualBasic.Interaction.InputBox(',
   'var auth=new AdminAuthorization040Window(_db){Owner=this};if(auth.ShowDialog()!=true)return;var reason=Microsoft.VisualBasic.Interaction.InputBox(',
   'edit authentication')
part=replace_exact(part,'_operator,"EDIÇÃO: "+reason',
   '_operator,"ADMIN: "+auth.AuthorizedName+" | EDIÇÃO: "+reason','edit audit')
c=c[:a]+part+c[b:]
p.write_text(c,encoding='utf-8')

# Rename action beside the existing two multi-sale buttons. Do not reposition their click handlers.
p=d/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=replace_exact(x,'<Button Grid.Column="2" Content="FECHAR ABA"',
  '<Button Grid.Column="2" Content="RENOMEAR ABA" Padding="13,9" Margin="6,0,0,0" Click="RenameMultiSale040_Click"/><Button Grid.Column="2" Content="FECHAR ABA"',
  'rename button')
# Two controls in the same grid cell overlap; use an inner horizontal stack for rename + close.
x=replace_exact(x,
  '<Button Grid.Column="2" Content="RENOMEAR ABA" Padding="13,9" Margin="6,0,0,0" Click="RenameMultiSale040_Click"/><Button Grid.Column="2" Content="FECHAR ABA" Padding="13,9" Margin="6,0,0,0" Click="CloseMultiSale_Click"/>',
  '<StackPanel Grid.Column="2" Orientation="Horizontal"><Button Content="RENOMEAR ABA" Padding="13,9" Margin="6,0,0,0" Click="RenameMultiSale040_Click"/><Button Content="FECHAR ABA" Padding="13,9" Margin="6,0,0,0" Click="CloseMultiSale_Click"/></StackPanel>',
  'rename layout')
p.write_text(x,encoding='utf-8')

p=d/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
# Avoid early 0.1.38 initialization: start only AFTER legacy _workflow.InitializeAsync recovery.
c=replace_exact(c,'Loaded += (_, _) => InitializeMultiSales037();','', 'unsafe legacy initialization')
c=replace_exact(c,'var recovered = await _workflow.InitializeAsync();\n        RefreshCart();',
'''var recovered = await _workflow.InitializeAsync();
        var recoveredTabs040 = await RestoreMultiSales040();
        RefreshCart();''','restore after workflow init')
c=replace_exact(c,
  'RecoveryText.Text = recovered ? "CARRINHO RECUPERADO" : string.Empty;',
  'RecoveryText.Text = recoveredTabs040 ? "ABAS DE VENDAS RECUPERADAS" : (recovered ? "CARRINHO RECUPERADO" : string.Empty);',
  'recovery message')
c=replace_exact(c,'public string CustomerLabel { get; set; } = "CONSUMIDOR";',
    'public string CustomerLabel { get; set; } = "CONSUMIDOR";\n        public string Label { get; set; } = "";',
    'slot label')
c=replace_exact(c,
  'Content = $"VENDA {slot.Number}   {slot.Cart.Total:C}",',
  'Content = $"VENDA {slot.Number}{(string.IsNullOrWhiteSpace(slot.Label) ? "" : " — "+slot.Label)}   {slot.Cart.Total:C}",',
  'tab label')
# Persist all state after every RefreshCart -> SyncCurrentMultisale, additionally after switch/create/close.
a=c.index('    private void SyncCurrentMultiSale037(');b=c.index('    private void RefreshMultiSaleTabs037(',a)
part=c[a:b]
part=replace_exact(part,'        RefreshMultiSaleTabs037();',
                   '        RefreshMultiSaleTabs037();\n        SaveMultiSales040();','save current tab')
c=c[:a]+part+c[b:]
# Other tab mutations were suppressed with _multiSaleSwitching037; save after the suppression clears.
for method,next_method in [('SwitchMultiSale037','NewMultiSale_Click'),('NewMultiSale_Click','CloseMultiSale_Click'),('CloseMultiSale_Click','CancelCurrentStable_Click')]:
    a=c.index('    private ',c.index('    private '+('async Task' if method=='SwitchMultiSale037' else 'async void')+' '+method+'(')) if False else c.index(method+'(')
    # Find only within actual method block by next method marker; for Close, include helper inserted before cancel.
    begin=c.rfind('    private ',0,a)
    if method=='SwitchMultiSale037': end=c.index('    private async void NewMultiSale_Click(',begin)
    elif method=='NewMultiSale_Click': end=c.index('    private async void CloseMultiSale_Click(',begin)
    else: end=c.index('    private async void CancelCurrentStable_Click(',begin)
    part=c[begin:end]
    if '        RefreshMultiSaleTabs037();' not in part:raise RuntimeError('Missing post-switch tab refresh '+method)
    part=part.replace('        RefreshMultiSaleTabs037();','        RefreshMultiSaleTabs037();\n        SaveMultiSales040();',1)
    c=c[:begin]+part+c[end:]
# Preserve the existing 0.1.38 multivendas and workflow logic; add recovery and display helpers only.
anchor='    private async void CancelCurrentStable_Click('
methods=r'''
    private bool _finalizing040;
    private bool _paymentChoiceOpen040;
    private bool _recoveryReadOnly040;
    private bool _recoveryWarningShown040;
    private MultiSaleRecovery040? _recovery040;

    private SaleTabsSnapshot040 SnapshotMultiSales040() => new(
        _multiSales037[_currentMultiSale037].Number,_nextMultiSaleNumber037,
        _multiSales037.Select(s=>new SaleTab040(
            s.Number,s.Label,s.CustomerLabel,s.Cart.CustomerId,s.OrderId,s.Cart.Discount,
            s.Cart.Items.Select(item=>new CartItem040(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice)).ToList()
        )).ToList());

    private void SaveMultiSales040()
    {
        if(_recoveryReadOnly040||_multiSales037.Count==0||_multiSaleSwitching037)return;
        try
        {
            _recovery040 ??= new MultiSaleRecovery040(_database);
            _recovery040.Save(SnapshotMultiSales040());
            _recoveryWarningShown040=false;
        }
        catch(Exception ex)
        {
            if(!_recoveryWarningShown040)
            {
                _recoveryWarningShown040=true;
                MessageBox.Show("Não foi possível salvar automaticamente as abas. Verifique o disco e faça backup antes de fechar o PDV.\n\n"+ex.Message,
                    "RECUPERAÇÃO DE VENDAS",MessageBoxButton.OK,MessageBoxImage.Warning);
            }
        }
    }

    private async Task<bool> RestoreMultiSales040()
    {
        try
        {
            _recovery040=new MultiSaleRecovery040(_database);
            var state=_recovery040.Load();
            if(state is null){InitializeMultiSales037();return false;}
            _multiSaleSwitching037=true;
            try
            {
                _multiSales037.Clear();
                foreach(var saved in state.Tabs)
                {
                    var cart=new Cart{CustomerId=saved.CustomerId};
                    foreach(var item in saved.Items)
                        cart.AddCustom(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice);
                    cart.SetDiscount(saved.Discount);
                    _multiSales037.Add(new MultiSaleSlot037{Number=saved.Number,Label=saved.Label??"",
                        CustomerLabel=saved.CustomerLabel??"CONSUMIDOR",OrderId=saved.OrderId,Cart=cart});
                }
                _nextMultiSaleNumber037=state.NextNumber;
                _currentMultiSale037=_multiSales037.FindIndex(slot=>slot.Number==state.ActiveNumber);
                var active=_multiSales037[_currentMultiSale037];
                await _workflow.ReplaceCartAsync(CloneCart037(active.Cart));
                _activeOrderId=active.OrderId;
                CustomerText.Text=string.IsNullOrWhiteSpace(active.CustomerLabel)?"CONSUMIDOR":active.CustomerLabel;
            }
            finally{_multiSaleSwitching037=false;}
            RefreshMultiSaleTabs037();
            return true;
        }
        catch(Exception ex)
        {
            // Do not overwrite a possibly damaged snapshot with a new empty one.
            _recoveryReadOnly040=true;
            MessageBox.Show("Não foi possível restaurar as abas salvas. O arquivo original não será apagado nem substituído.\n\n"+
                ex.Message+"\n\nVerifique o backup antes de continuar.","RECUPERAÇÃO DE VENDAS",MessageBoxButton.OK,MessageBoxImage.Warning);
            if(_multiSales037.Count==0)InitializeMultiSales037();
            return false;
        }
    }

    private void RenameMultiSale040_Click(object sender,RoutedEventArgs e)
    {
        if(_multiSales037.Count==0||_multiSaleSwitching037||_finalizing040)return;
        var tab=_multiSales037[_currentMultiSale037];
        var name=Microsoft.VisualBasic.Interaction.InputBox(
            $"Identificação para a VENDA {tab.Number} (ex.: João, Entrega, Balcão):","RENOMEAR ABA",tab.Label);
        if(string.IsNullOrWhiteSpace(name))return;
        name=name.Trim().Replace("\r"," ").Replace("\n"," ");
        if(name.Length>32){MessageBox.Show("Use no máximo 32 caracteres.","Renomear aba");return;}
        tab.Label=name;
        RefreshMultiSaleTabs037();
        SaveMultiSales040();
    }

    private void FinalizeActiveTab040()
    {
        if(_multiSales037.Count==0)return;
        var tab=_multiSales037[_currentMultiSale037];
        tab.Cart=new Cart();
        tab.OrderId=null;
        tab.CustomerLabel="CONSUMIDOR";
        tab.Label="";
        _activeOrderId=null;
        CustomerText.Text="CONSUMIDOR";
        SaveMultiSales040();
        RefreshMultiSaleTabs037();
    }

'''
if anchor not in c:raise RuntimeError('Missing cancellation anchor for helper placement')
c=c.replace(anchor,methods+anchor,1)
# Customer-only changes must persist even if user loses power before next item is scanned.
c=replace_exact(c,'CustomerText.Text = w.Selected.Name;\n        SetStatus(',
 'CustomerText.Text = w.Selected.Name;\n        SyncCurrentMultiSale037();\n        SetStatus(','selected customer sync')
c=replace_exact(c,'CustomerText.Text = "CONSUMIDOR";\n    }\n\n    private void CustomerManagement_Click',
 'CustomerText.Text = "CONSUMIDOR";\n        SyncCurrentMultiSale037();\n    }\n\n    private void CustomerManagement_Click','customer removal sync')
# Additional direct store credit selection.
c=replace_exact(c,'CustomerText.Text = w.Selected.Name;\n        }\n        await CompletePaymentAsync(PaymentMethod.StoreCredit);',
 'CustomerText.Text = w.Selected.Name;\n            SyncCurrentMultiSale037();\n        }\n        await CompletePaymentAsync(PaymentMethod.StoreCredit);','credit selection sync')
# Guard completion across concurrent click/keyboard flows. Keep the old payment/print flow byte-for-byte inside the try.
signature='    private async Task CompletePaymentAsync(PaymentMethod? initialMethod = null)'
a=c.index(signature); brace=c.index('{',a)
depth=1;j=brace+1
while depth and j<len(c):
    if c[j]=='{':depth+=1
    elif c[j]=='}':depth-=1
    j+=1
if depth:raise RuntimeError('Unbalanced CompletePaymentAsync')
body=c[brace+1:j-1]
body=replace_exact(body,'            await RefreshSales();',
  '            FinalizeActiveTab040();\n            await RefreshSales();','paid tab clear')
c=c[:brace+1]+'''
        if(_finalizing040 || _multiSaleSwitching037) return;
        _finalizing040=true;
        try
        {'''+body+'''
        }
        finally { _finalizing040=false; }
    '''+c[j-1:]
# Guard the Finalize / Separate Order choice too.
sig='    private async void Pay_Click(object sender, RoutedEventArgs e)'
a=c.index(sig);brace=c.index('{',a);depth=1;j=brace+1
while depth and j<len(c):
    if c[j]=='{':depth+=1
    elif c[j]=='}':depth-=1
    j+=1
if depth:raise RuntimeError('Unbalanced Pay_Click')
body=c[brace+1:j-1]
c=c[:brace+1]+'''
        if(_paymentChoiceOpen040 || _finalizing040 || _multiSaleSwitching037)return;
        _paymentChoiceOpen040=true;
        try
        {'''+body+'''
        }
        finally { _paymentChoiceOpen040=false; }
    '''+c[j-1:]
# Ensure normal window close informs about non-empty tabs, not just whichever is active.
old='if(_workflow.Cart.Items.Count==0)return;'
if old not in c:raise RuntimeError('Closing cart check missing')
at=c.index('private void MainWindow_Closing')
before=c[:at];tail=c[at:]
tail=replace_exact(tail,old,
  'if(_multiSales037.Count>0){SyncCurrentMultiSale037();if(_multiSales037.All(x=>x.Cart.Items.Count==0))return;}else if(_workflow.Cart.Items.Count==0)return;',
  'close protect all tabs')
c=before+tail
p.write_text(c,encoding='utf-8')
print('ONCA_FEATURE040_APPLIED=YES')
