$ErrorActionPreference='Stop'
$exe=(Resolve-Path '.\portable042\ONCA-PDV-PRO-0.1.42-REDEFINIR-PIN.exe').Path

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OncaWindowProbe038 {
  public delegate bool WinEnum(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WinEnum cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int max);
  public sealed class Win { public IntPtr Handle {get;set;} public string Class {get;set;} public string Title {get;set;} }
  public static Win[] Enumerate(int pid) {
    var wins=new List<Win>();
    EnumWindows((h,l)=>{
      uint p; GetWindowThreadProcessId(h,out p);
      if(p==(uint)pid && IsWindowVisible(h)) {
        var cls=new StringBuilder(255); var title=new StringBuilder(512);
        GetClassName(h,cls,cls.Capacity);GetWindowText(h,title,title.Capacity);
        wins.Add(new Win{Handle=h,Class=cls.ToString(),Title=title.ToString()});
      }
      return true;
    },IntPtr.Zero);
    return wins.ToArray();
  }
}
'@

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Assert-WindowOk($p, $label) {
  $p.Refresh()
  if ($p.HasExited) { throw "$label - PDV exited with code $($p.ExitCode)" }
  $wins=@([OncaWindowProbe038]::Enumerate($p.Id))
  foreach($w in $wins){Write-Host "$label WINDOW: $($w.Class) | $($w.Title)"}
  $dialogs=@($wins | Where-Object {$_.Class -eq '#32770'})
  if($dialogs.Count -gt 0){throw "$label - modal error/dialog appeared at startup"}
  $main=@($wins | Where-Object {$_.Class -like 'HwndWrapper*' -and -not [string]::IsNullOrWhiteSpace($_.Title)}) | Select-Object -First 1
  if(-not $main){throw "$label - no visible WPF main window"}
  return $main
}

function Find-Button($root,[string]$prefix) {
  $cond=[System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
  $buttons=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
  foreach($b in $buttons) {
    if($b.Current.Name.Contains($prefix,[System.StringComparison]::OrdinalIgnoreCase)){return $b}
  }
  throw "UI button not found: $prefix"
}

1..3 | ForEach-Object {
  $n=$_
  $p=Start-Process -FilePath $exe -PassThru
  try {
    Start-Sleep -Seconds 6
    $win=Assert-WindowOk $p "LAUNCH $n"
    if($n -eq 1){
      $root=[System.Windows.Automation.AutomationElement]::FromHandle($win.Handle)
      $add=Find-Button $root '+ NOVA VENDA'
      $add.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 900
      $win=Assert-WindowOk $p 'NEW TAB'
      $root=[System.Windows.Automation.AutomationElement]::FromHandle($win.Handle)
      $first=Find-Button $root 'VENDA 1 '
      $second=Find-Button $root 'VENDA 2 '
      $first.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 700
      Assert-WindowOk $p 'TAB 1' | Out-Null
      $second=Find-Button $root 'VENDA 2 '
      $second.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 700
      Assert-WindowOk $p 'TAB 2' | Out-Null
      # Cancellation is reachable without hiding or changing working multi-sale tabs.
      $renameTab=Find-Button $root 'RENOMEAR ABA'
      Write-Host 'RENAME TAB BUTTON OK'
      $currentCancel=Find-Button $root 'DESCARTAR VENDA DA ABA'
      $currentSaleManager=Find-Button $root 'VENDAS REALIZADAS'
      $currentSaleManager.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 900
      $winList=@([OncaWindowProbe038]::Enumerate($p.Id))
      $dialog=@($winList | Where-Object {$_.Title -like '*Gerenciar vendas*'}) | Select-Object -First 1
      if(-not $dialog){throw 'Completed-sales manager did not open'}
      $manager=[System.Windows.Automation.AutomationElement]::FromHandle($dialog.Handle)
      $cancelCompleted=Find-Button $manager 'CANCELAR VENDA SELECIONADA'
      Write-Host 'CANCELLATION UI TEST OK: current tab and completed-sale buttons are visible and usable'
      Write-Host 'MULTIVENDAS UI TEST OK: new tab, switch tab 1 and tab 2'
    }
    if($n -eq 2){
      $root=[System.Windows.Automation.AutomationElement]::FromHandle($win.Handle)
      $restoredSecondTab=Find-Button $root 'VENDA 2 '
      Write-Host 'RECOVERY UI TEST OK: second tab restored after application restart'
    }
    Write-Host "LAUNCH $n OK"
  }
  finally {
    if(-not $p.HasExited) {
      try{$p.CloseMainWindow()|Out-Null}catch{}
      Start-Sleep -Milliseconds 700
      $p.Refresh()
      if(-not $p.HasExited){try{$p.Kill($true)}catch{}}
    }
  }
}
