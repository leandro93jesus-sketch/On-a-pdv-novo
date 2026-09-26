$ErrorActionPreference='Stop'
$exe=(Resolve-Path '.\portable041\ONCA-PDV-PRO-0.1.41-CANCELAMENTO-TESTADO.exe').Path
$env:ONCA_PDV_DATA_ROOT=Join-Path $env:RUNNER_TEMP ("ONCA-UI-CANCEL-041-"+[Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $env:ONCA_PDV_DATA_ROOT -Force|Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OncaWindows041 {
 public delegate bool EnumCB(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumCB cb,IntPtr l);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h,int id);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr wp,IntPtr lp);
 public sealed class W {public IntPtr Handle; public string Title;public string Class;}
 public static W[] Get(int pid) {
  var list=new List<W>();
  EnumWindows((h,l)=>{
   uint p;GetWindowThreadProcessId(h,out p);
   if(p==(uint)pid&&IsWindowVisible(h)){var title=new StringBuilder(512);var cls=new StringBuilder(256);
    GetWindowText(h,title,title.Capacity);GetClassName(h,cls,cls.Capacity);
    list.Add(new W{Handle=h,Title=title.ToString(),Class=cls.ToString()});
   }
   return true;
  },IntPtr.Zero);return list.ToArray();
 }
}
'@
function Windows($p){return @([OncaWindows041]::Get($p.Id))}
function Wait-Window($p,[string]$name,[int]$seconds=12){
 for($n=0;$n -lt ($seconds*5);$n++){
  $p.Refresh();if($p.HasExited){throw "PDV exited with code $($p.ExitCode)"}
  $w=@(Windows $p | Where-Object {$_.Title.Contains($name,[System.StringComparison]::OrdinalIgnoreCase) -and $_.Title.Length -gt 0})|Select-Object -First 1
  if($w){Write-Host "FOUND_WINDOW $($w.Title) CLASS=$($w.Class)";return $w}
  Start-Sleep -Milliseconds 200
 }
 Write-Host "ALL_WINDOWS: $((Windows $p|ForEach-Object { $_.Title+' ['+$_.Class+']' })-join '; ')"
 throw "Window missing: $name"
}
function Root($win){return [System.Windows.Automation.AutomationElement]::FromHandle($win.Handle)}
function Find-Element($root,[string]$type,[string]$name,[bool]$useId=$false){
 $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 foreach($n in $nodes){
  if($type -and $n.Current.ControlType.ProgrammaticName -notlike "*$type*"){continue}
  $val=if($useId){$n.Current.AutomationId}else{$n.Current.Name}
  if($val.Contains($name,[System.StringComparison]::OrdinalIgnoreCase)){return $n}
 }
 throw "Element not found ($type): $name"
}
function Dump($root,[string]$label){
 Write-Host "TREE $label"
 $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 foreach($n in $nodes){if($n.Current.IsOffscreen -eq $false){Write-Host "$($n.Current.ControlType.ProgrammaticName) ID=$($n.Current.AutomationId) NAME=$($n.Current.Name)"}}
}
function Click($r,[string]$name) {
 $el=Find-Element $r "Button" $name
 Write-Host "CLICK $($el.Current.Name)"
 $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function Enter($r,[string]$id,[string]$value,[string]$type="Edit"){
 $el=Find-Element $r $type $id $true
 $pattern=$null
 if($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$pattern.SetValue($value)}
 else {
  $el.SetFocus();[System.Windows.Forms.SendKeys]::SendWait($value)
 }
 Write-Host "FILLED $id"
}
function Select-OnlyDataRow($r){
 $all=$r.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $rows=@($all|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::DataItem})
 Write-Host "DATA_ROWS=$($rows.Count)"
 foreach($x in $rows){Write-Host "ROW name=$($x.Current.Name) id=$($x.Current.AutomationId)"}
 if($rows.Count -ne 1) {Dump $r "SALES MANAGER";throw "Expected 1 selected searched sale row; found $($rows.Count)"}
 $row=$rows[0]
 $row.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
 Write-Host "SELECTED_SALE_ROW"
}
function Try-Close($p){if($p -and -not $p.HasExited){try{$p.CloseMainWindow()|Out-Null}catch{};Start-Sleep -Milliseconds 700;$p.Refresh();if(-not $p.HasExited){try{$p.Kill($true)}catch{}}}}
function Click-Dialog($p,[string]$title,[string[]]$buttonNames){
 $w=$null
 for($attempt=0;$attempt -lt 60;$attempt++){
  $w=@(Windows $p|Where-Object {$_.Class -eq '#32770' -and $_.Title.Contains($title,[System.StringComparison]::OrdinalIgnoreCase)})|Select-Object -First 1
  if($w){break}
  Start-Sleep -Milliseconds 200
 }
 if(-not $w){throw "Native dialog not found: $title; windows=$((Windows $p|ForEach-Object {$_.Title+' / '+$_.Class})-join ' ; ')"}
 $r=Root $w
 foreach($name in $buttonNames){
  $id=switch ($name.ToLowerInvariant()) {'yes' {6} 'sim' {6} 'no' {7} 'não' {7} 'ok' {1} default {0}}
  if($id -ne 0){
   $h=[OncaWindows041]::GetDlgItem($w.Handle,$id)
   if($h -ne [IntPtr]::Zero) {
    [OncaWindows041]::SendMessage($h,[uint32]0xF5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
    Write-Host "NATIVE_DIALOG_ACTION=$title / $name / id=$id"
    return
   }
  }
  try{Click $r $name;Write-Host "DIALOG_ACTION=$title / $name";return}catch{continue}
 }
 Dump $r "DIALOG $title"
 throw "Could not click dialog $title"
}
$p=$null
try {
 $p=Start-Process -FilePath $exe -PassThru
 $main=Wait-Window $p "ONÇA PDV PRO"
 Start-Sleep -Seconds 3
 Try-Close $p
 python ..\..\scripts\seed_and_check_cancel_041.py seed
 if($LASTEXITCODE -ne 0){throw "Fixture seed failed"}
 $p=Start-Process -FilePath $exe -PassThru
 $main=Wait-Window $p "ONÇA PDV PRO"
 Start-Sleep -Seconds 4
 $mainRoot=Root $main
 Click $mainRoot "VENDAS REALIZADAS"
 $mg=Wait-Window $p "Gerenciar vendas"
 $mgr=Root $mg
 Dump $mgr "INITIAL_SALES_MANAGER"
 Enter $mgr "SearchBox" "94101"
 Click $mgr "PESQUISAR"
 Start-Sleep -Seconds 1
 Select-OnlyDataRow $mgr
 Click $mgr "CANCELAR VENDA SELECIONADA"
 $au=Wait-Window $p "Autorização de administrador"
 $authRoot=Root $au
 Dump $authRoot "ADMIN_FIRST_TIME"
 Enter $authRoot "AdminNameBox" "Administrador Teste"
 Enter $authRoot "PinBox" "725849"
 Enter $authRoot "ConfirmBox" "725849"
 Click $authRoot "AUTORIZAR"
 $re=Wait-Window $p "Motivo do cancelamento"
 $reasonRoot=Root $re
 Enter $reasonRoot "ReasonBox" "Teste de cancelamento UI"
 Click $reasonRoot "CONFIRMAR MOTIVO"
 Click-Dialog $p "Confirmar cancelamento" @("Yes","Sim")
 Click-Dialog $p "ONÇA PDV" @("OK")
 Click-Dialog $p "Impressão opcional" @("No","Não")
 python ..\..\scripts\seed_and_check_cancel_041.py check
 if($LASTEXITCODE -ne 0){throw "Completed-sale DB assertions failed"}
 Write-Host "UI_CANCEL_041_FULL_FLOW_PASS=YES"
}
finally {Try-Close $p}
