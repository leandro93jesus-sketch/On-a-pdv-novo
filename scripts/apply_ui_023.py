from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'

# Version bump everywhere visible.
for p in d.glob('*.*'):
    if p.suffix.lower() not in {'.xaml','.cs'}: continue
    try: x=p.read_text(encoding='utf-8-sig')
    except: continue
    x=x.replace('v0.1.22','v0.1.23').replace('0.1.22','0.1.23')
    p.write_text(x,encoding='utf-8')

# Sales management: make critical actions visually obvious and accessible at the top too.
p=d/'SalesManagementWindow.xaml'; x=p.read_text(encoding='utf-8-sig')
x=x.replace('<WrapPanel Grid.Column="1" VerticalAlignment="Center"><TextBox', '<StackPanel Grid.Column="1" VerticalAlignment="Center"><WrapPanel HorizontalAlignment="Right"><Button Content="✎ EDITAR VENDA" Click="Edit_Click" Background="#0B6B3A" Foreground="White" FontSize="15" Padding="16,10"/><Button Content="🗑 CANCELAR VENDA" Click="Cancel_Click" Background="#FFF0F0" Foreground="#B42318" FontSize="15" Padding="16,10"/></WrapPanel><WrapPanel HorizontalAlignment="Right" Margin="0,6,0,0"><TextBox',1)
x=x.replace('<Button Content="PESQUISAR" Click="Search_Click" Background="#0B6B3A" Foreground="White"/></WrapPanel></Grid></Border>', '<Button Content="PESQUISAR" Click="Search_Click" Background="#0B6B3A" Foreground="White"/></WrapPanel></StackPanel></Grid></Border>',1)
x=x.replace('Content="EDITAR / REABRIR NO CARRINHO"','Content="✎ EDITAR / REABRIR VENDA NO CARRINHO"')
p.write_text(x,encoding='utf-8')

# Credit: top visible edit/cancel actions and friendlier dimensions.
p=d/'CreditWindow.xaml'; x=p.read_text(encoding='utf-8-sig')
x=x.replace('Width="1280" Height="760" MinWidth="1000" MinHeight="640"','Width="1320" Height="800" MinWidth="1000" MinHeight="640"')
# Existing action buttons remain; emphasize them without changing handlers.
x=x.replace('Content="✎  EDITAR / CORRIGIR RECEBIMENTO"', 'Content="✎  EDITAR RECEBIMENTO" Background="#E8F5EC" Foreground="#0B6B3A" FontWeight="Bold"')
x=x.replace('Content="🗑  APAGAR / ESTORNAR RECEBIMENTO"', 'Content="🗑  APAGAR / ESTORNAR" Background="#FFF0F0" Foreground="#B42318" FontWeight="Bold"')
p.write_text(x,encoding='utf-8')

# Make version discreet but permanently visible on main screen.
p=d/'MainWindow.xaml'; x=p.read_text(encoding='utf-8-sig')
x=x.replace('ONÇA PDV PRO • v0.1.23','ONÇA PDV PRO  •  v0.1.23')
p.write_text(x,encoding='utf-8')

print('0.1.23 UI visibility patch applied')