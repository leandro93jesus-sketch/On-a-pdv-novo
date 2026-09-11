from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'

# IMPORTANT: do not touch printing files or printing logic in this patch.

def replace_button(path, old_content, new_content, bg, fg, min_h='48', font='16'):
    p=d/path
    x=p.read_text(encoding='utf-8-sig')
    pat=re.compile(r'<Button\b(?=[^>]*Content="'+re.escape(old_content)+r'")([^>]*)/>', re.S)
    m=pat.search(x)
    if not m:
        raise SystemExit(f'Button not found: {old_content} in {path}')
    tag=m.group(0)
    tag=re.sub(r'Content="[^"]*"', f'Content="{new_content}"', tag, count=1)
    attrs={
        'MinHeight':min_h,
        'FontSize':font,
        'FontWeight':'Bold',
        'Background':bg,
        'Foreground':fg,
        'Padding':'16,10',
        'Margin':'4'
    }
    for k,v in attrs.items():
        if re.search(rf'\b{k}="[^"]*"',tag):
            tag=re.sub(rf'\b{k}="[^"]*"',f'{k}="{v}"',tag)
        else:
            tag=tag[:-2]+f' {k}="{v}"/>'
    x=x[:m.start()]+tag+x[m.end():]
    p.write_text(x,encoding='utf-8')

# Sales: style the existing, known-working actions instead of injecting new controls.
replace_button('SalesManagementWindow.xaml','EDITAR / REABRIR NO CARRINHO','✎ EDITAR VENDA FINALIZADA','#0B6B3A','White','54','17')
replace_button('SalesManagementWindow.xaml','EXCLUIR / CANCELAR VENDA','🗑 CANCELAR VENDA FINALIZADA','#FFF0F0','#B42318','54','17')

# Credit: style the existing, known-working receipt actions in place.
replace_button('CreditWindow.xaml','✎  EDITAR / CORRIGIR RECEBIMENTO','✎ EDITAR RECEBIMENTO','#E8F5EC','#0B6B3A','52','16')
replace_button('CreditWindow.xaml','🗑  APAGAR / ESTORNAR RECEBIMENTO','🗑 ESTORNAR RECEBIMENTO','#FFF0F0','#B42318','52','16')

# Bump only visible non-print UI files. Never mass-edit all .cs/.xaml files.
for name in ['MainWindow.xaml','SalesManagementWindow.xaml','CreditWindow.xaml']:
    p=d/name
    x=p.read_text(encoding='utf-8-sig')
    x=x.replace('v0.1.22','v0.1.24').replace('0.1.22','0.1.24')
    p.write_text(x,encoding='utf-8')

print('UI024_APPLIED=YES')