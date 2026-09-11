from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'

# Start from the validated 0.1.24 UI patch.
exec((Path('scripts/apply_ui_024.py')).read_text(encoding='utf-8'), {})

p=d/'CreditWindow.xaml'
x=p.read_text(encoding='utf-8-sig')

# Put the correction actions in the SAME right-side action area shown to the user,
# immediately below RECEBER PAGAMENTO. Reuse existing handlers; no business/print change.
anchor='Content="💵  RECEBER PAGAMENTO  [F9]"'
pos=x.find(anchor)
if pos < 0:
    raise SystemExit('Receive payment button anchor not found')
tag_start=x.rfind('<Button',0,pos)
tag_end=x.find('/>',pos)
if tag_start < 0 or tag_end < 0:
    raise SystemExit('Receive payment button tag not found')
tag_end += 2
buttons='''\n                    <StackPanel Margin="0,0,0,12">\n                        <Button Style="{StaticResource RoundedButton}" Content="✎  EDITAR / CORRIGIR RECEBIMENTO" Click="EditReceipt_Click" FontSize="16" FontWeight="Bold" MinHeight="50" Margin="0,0,0,8" Background="#E8F5EC" Foreground="#0B6B3A" ToolTip="Selecione um recebimento em Últimos recebimentos / movimentos e clique aqui para corrigir."/>\n                        <Button Style="{StaticResource RoundedButton}" Content="🗑  ESTORNAR RECEBIMENTO" Click="ReverseReceipt_Click" FontSize="16" FontWeight="Bold" MinHeight="50" Margin="0" Background="#FFF0F0" Foreground="#B42318" ToolTip="Selecione um recebimento em Últimos recebimentos / movimentos e clique aqui para estornar."/>\n                    </StackPanel>'''

# Avoid duplicate insertion.
region=x[tag_end:tag_end+1200]
if 'ToolTip="Selecione um recebimento em Últimos recebimentos / movimentos' not in region:
    x=x[:tag_end]+buttons+x[tag_end:]

# Version marker only in visible UI file.
x=x.replace('v0.1.24','v0.1.25').replace('0.1.24','0.1.25')
p.write_text(x,encoding='utf-8')

# Verify both handler names are now wired in the visible right-side area.
for s in ['EditReceipt_Click','ReverseReceipt_Click','EDITAR / CORRIGIR RECEBIMENTO','ESTORNAR RECEBIMENTO']:
    if s not in x:
        raise SystemExit(f'Missing credit action after patch: {s}')

print('UI025_APPLIED=YES')