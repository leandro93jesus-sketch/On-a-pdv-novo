from pathlib import Path

source=Path('scripts/test_pin_and_cancel_043.ps1').read_text(encoding='utf-8-sig')
old=r"portable043\ONCA-PDV-PRO-0.1.43-PIN-RECUPERADO.exe"
new=r"portable044\ONCA-PDV-PRO-0.1.44-VENDAS-CORRIGIDAS.exe"
if old not in source:raise RuntimeError("old binary name missing")
source=source.replace(old,new)
start=source.index(' Click $mgr "CANCELAR VENDA SELECIONADA"')
end=source.index(' # Existing administrator: wrong PIN',start)
part=source[start:end]
part=part.replace('Click $mgr "CANCELAR VENDA SELECIONADA"','Click $mgr "EXCLUIR VENDA"',1)
part=part.replace('Enter $reasonRoot "ReasonBox" "Teste de cancelamento UI"',
                  'Enter $reasonRoot "ReasonBox" "Excluir venda duplicada 044"',1)
part=part.replace('Click-Dialog $p "Confirmar cancelamento" @("Yes","Sim")',
                  'Click-Dialog $p "CONFIRMAR EXCLUSÃO DA VENDA" @("Yes","Sim")',1)
part=part.replace(' Click-Dialog $p "Impressão opcional" @("No","Não")\n','',1)
part=part.replace('python ..\\..\\scripts\\seed_and_check_cancel_041.py check',
                  'python ..\\..\\scripts\\verify_delete_044.py',1)
part=part.replace('Write-Host "UI_CANCEL_FIRST_PIN_FLOW_PASS=YES"',
                  '''if($LASTEXITCODE -ne 0){throw "Database verification of GUI delete failed"}
 $grid=Find-Element $mgr "DataGrid" "Grid" $true
 $visible=@($grid.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::DataItem})
 if($visible.Count -ne 0){throw "Deleted sale still appears in normal search results"}
 Write-Host "DELETED_SALE_HIDDEN_FROM_NORMAL_SEARCH=YES"
 Write-Host "UI_DELETE_044_FULL_FLOW_PASS=YES"''')
assert "UI_DELETE_044_FULL_FLOW_PASS" in part
source=source[:start]+part+'''
}
finally {Try-Close $p}
'''
Path('scripts/test_delete_e2e_044.ps1').write_text(source,encoding='utf-8')
print('DELETE_GUI_TEST_GENERATED=YES')
