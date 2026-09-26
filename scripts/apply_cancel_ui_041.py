from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'
p=d/'AdminAuthorization040Window.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
old='            MessageBox.Show("O responsável pela loja deve definir um PIN de administrador. Não há senha padrão. Guarde o PIN em local seguro.","ONÇA PDV — Primeiro uso",MessageBoxButton.OK,MessageBoxImage.Information);'
if old not in c:raise RuntimeError('First-time modal anchor absent')
# A dialog shown in another dialog constructor before ShowDialog can steal focus and block the workflow.
c=c.replace(old,'            // First-time setup is explained directly in the same owned window; no nested popup.',1)
p.write_text(c,encoding='utf-8')
(d/'CancellationReason041Window.xaml').write_text(Path('scripts/feature041_reason.xaml').read_text(encoding='utf-8'),encoding='utf-8')
(d/'CancellationReason041Window.xaml.cs').write_text(Path('scripts/feature041_reason.xaml.cs').read_text(encoding='utf-8'),encoding='utf-8')
p=d/'SalesManagementWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
a=c.index(' private async void Cancel_Click(')
b=c.index(' private async void Edit_Click(',a)
part=c[a:b]
old='  var reason=Microsoft.VisualBasic.Interaction.InputBox("Informe o motivo obrigatório do cancelamento:","Cancelar venda realizada","");\n  if(string.IsNullOrWhiteSpace(reason))return;'
new='''  var reasonWindow=new CancellationReason041Window(row.Number){Owner=this};
  if(reasonWindow.ShowDialog()!=true)return;
  var reason=reasonWindow.Reason;'''
if old not in part:raise RuntimeError('Original VB InputBox cancel prompt not found')
part=part.replace(old,new,1)
# Synchronous visible confirmation and dialog result remain, no changes to transactional service.
c=c[:a]+part+c[b:]
p.write_text(c,encoding='utf-8')
print('ONCA_CANCEL_UI_041_APPLIED=YES')
