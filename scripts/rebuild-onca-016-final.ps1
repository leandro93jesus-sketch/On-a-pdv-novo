$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$work=Join-Path $repo 'work-final'
if(Test-Path $work){Remove-Item $work -Recurse -Force}
New-Item -ItemType Directory -Path $work -Force | Out-Null
Expand-Archive '.\ONCA-PDV-PRO-ATUALIZADO-0.1.3.zip' $work -Force
$root=Join-Path $work 'ONCA-PDV-PRO'

$encoded=(Get-Content '.\patches\onca-0111-melhorias-hoje.patch.gz.b64' -Raw) -replace '\s',''
[IO.File]::WriteAllBytes('.\base.gz',[Convert]::FromBase64String($encoded))
$i=[IO.File]::OpenRead('.\base.gz');$o=[IO.File]::Create('.\base.patch');$g=[IO.Compression.GzipStream]::new($i,[IO.Compression.CompressionMode]::Decompress)
try{$g.CopyTo($o)}finally{$g.Dispose();$o.Dispose();$i.Dispose()}
Push-Location $root
git init | Out-Null
git apply '..\..\base.patch'; if($LASTEXITCODE -ne 0){throw 'Base patch failed'}
Pop-Location

$src='.\patches\0.1.12';$dst=Join-Path $root 'src\OncaPDV.Desktop'
foreach($n in @('ProductSelectionWindow.xaml','ProductSelectionWindow.xaml.cs','DiversosWindow.xaml','DiversosWindow.xaml.cs')){Copy-Item (Join-Path $src $n) (Join-Path $dst $n) -Force}
$main=Join-Path $dst 'MainWindow.xaml.cs';$t=Get-Content $main -Raw
$t=[regex]::Replace($t,'new ProductSelectionWindow\(([^,\r\n]+),\s*([^,\r\n\)]+)(,\s*(?:true|false))?\)','new ProductSelectionWindow($2, $1$3)')
Set-Content $main $t -Encoding UTF8
$div=Join-Path $dst 'DiversosWindow.xaml.cs';$d=Get-Content $div -Raw
if(-not $d.Contains('public decimal Quantity => 1m;')){$d=$d.Replace('public decimal Price { get; private set; }',"public decimal Price { get; private set; }`r`n    public decimal Quantity => 1m;`r`n    public decimal UnitPrice => Price;");Set-Content $div $d -Encoding UTF8}
$file=Join-Path $dst 'CreditWindow.xaml';$t=Get-Content $file -Raw
$needle='<TextBlock Text="DETALHES DO CLIENTE / CONTA" FontWeight="Bold" Foreground="#33423A"/>'
$button='<Button Style="{StaticResource RoundedButton}" Content="💵  RECEBER PAGAMENTO  [F9]" FontSize="17" MinHeight="52" Margin="0,10,0,12" Click="Receive_Click"/>'
if(-not $t.Contains($button)){if(-not $t.Contains($needle)){throw 'Credit anchor missing'};$t=$t.Replace($needle,$needle+"`r`n"+$button);Set-Content $file $t -Encoding UTF8}

$encoded=(Get-ChildItem '.\patches\016\part-*'|Sort-Object Name|ForEach-Object{Get-Content $_.FullName -Raw}) -join ''
$encoded=$encoded -replace '\s',''
[IO.File]::WriteAllBytes('.\u16.gz',[Convert]::FromBase64String($encoded))
$i=[IO.File]::OpenRead('.\u16.gz');$o=[IO.File]::Create('.\u16.patch');$g=[IO.Compression.GzipStream]::new($i,[IO.Compression.CompressionMode]::Decompress)
try{$g.CopyTo($o)}finally{$g.Dispose();$o.Dispose();$i.Dispose()}
Push-Location $root
git apply '..\..\u16.patch'; if($LASTEXITCODE -ne 0){throw '0.1.16 patch failed'}
git apply '..\..\patches\016\fix-raw-string.patch'; if($LASTEXITCODE -ne 0){throw 'SQL fix failed'}
git apply '..\..\patches\016\fix-mainwindow-closing.patch'; if($LASTEXITCODE -ne 0){throw 'Closing fix failed'}
$p='.\src\OncaPDV.Desktop\MainWindow.xaml.cs';$t=Get-Content $p -Raw;$t=$t.Replace('else if (e.Key == Key.F8) _ = OpenLastSale();','else if (e.Key == Key.F8) OpenLastSale();');Set-Content $p $t -Encoding UTF8
Pop-Location

$encoded=(Get-Content '.\patches\final017\final017b.tar.gz.b64' -Raw) -replace '\s',''
[IO.File]::WriteAllBytes('.\final017.tar.gz',[Convert]::FromBase64String($encoded))
$finalDir='.\final017-unpack';if(Test-Path $finalDir){Remove-Item $finalDir -Recurse -Force};New-Item -ItemType Directory -Path $finalDir -Force|Out-Null
tar -xzf '.\final017.tar.gz' -C $finalDir
Copy-Item "$finalDir\FinalFeaturesService.cs" (Join-Path $root 'src\OncaPDV.Infrastructure\FinalFeaturesService.cs') -Force
Copy-Item "$finalDir\FinalOperationsWindow.xaml" (Join-Path $root 'src\OncaPDV.Desktop\FinalOperationsWindow.xaml') -Force
Copy-Item "$finalDir\FinalOperationsWindow.xaml.cs" (Join-Path $root 'src\OncaPDV.Desktop\FinalOperationsWindow.xaml.cs') -Force
$testPath=Join-Path $root 'tests\OncaPDV.Tests\FinalFeaturesTests.cs'
Copy-Item "$finalDir\FinalFeaturesTests.cs" $testPath -Force
$ft=Get-Content $testPath -Raw
$ft=[regex]::Replace($ft,'new Database\(([^;\r\n]+)\)','new Database(new AppPaths($1))')
Set-Content $testPath $ft -Encoding UTF8

$xamlPath=Join-Path $root 'src\OncaPDV.Desktop\MainWindow.xaml';$x=Get-Content $xamlPath -Raw
if(-not $x.Contains('Click="FinalOps_Click"')){
  $m=[regex]::Match($x,'<Button[^>]+Click="Documents_Click"\s*/>');if(-not $m.Success){throw 'Documents button anchor missing'}
  $extra=@'
                    <Button Style="{StaticResource NavButton}" Content="⏸   Colocar venda em espera" Click="HoldSale_Click"/>
                    <Button Style="{StaticResource NavButton}" Content="↩   Trocas / Devoluções / Despesas" Click="FinalOps_Click"/>
'@
  $buttons=$m.Value+"`r`n"+$extra.TrimEnd()
  $x=$x.Remove($m.Index,$m.Length).Insert($m.Index,$buttons)
}
Set-Content $xamlPath $x -Encoding UTF8

$csPath=Join-Path $root 'src\OncaPDV.Desktop\MainWindow.xaml.cs';$c=Get-Content $csPath -Raw
$c=$c.Replace('dialog.Description, dialog.Quantity','dialog.Description ?? "DIVERSOS", dialog.Quantity')
if(-not $c.Contains('HoldSale_Click(object sender')){
$insert=@'
    private async void HoldSale_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0) { FinalOps_Click(sender, e); return; }
        try
        {
            var svc = new FinalFeaturesService(_database);
            await svc.HoldAsync($"Espera {DateTime.Now:HH:mm}", _workflow.Cart.CustomerId, _workflow.Cart.Items.ToArray(), _workflow.Cart.Discount);
            await _workflow.CancelAsync(); RefreshCart(); SetStatus("VENDA SALVA EM ESPERA"); SearchBox.Focus();
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "Venda em espera", MessageBoxButton.OK, MessageBoxImage.Warning); }
    }

    private async void FinalOps_Click(object sender, RoutedEventArgs e)
    {
        var w = new FinalOperationsWindow(_database, OperatorId) { Owner = this };
        if (w.ShowDialog() != true || w.SelectedHold is null) return;
        if (_workflow.Cart.Items.Count > 0 && MessageBox.Show("Substituir o carrinho atual pela venda em espera?", "ONÇA PDV", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        var h = w.SelectedHold;
        await _workflow.CancelAsync();
        await _workflow.ReplaceCartAsync(h.Items, h.CustomerId);
        await new FinalFeaturesService(_database).DeleteHoldAsync(h.Id);
        RefreshCart(); SetStatus("VENDA EM ESPERA RECUPERADA");
    }

'@
  $anchor='    private void Preview_Click(object sender, RoutedEventArgs e)';if(-not $c.Contains($anchor)){throw 'Preview anchor missing'};$c=$c.Replace($anchor,$insert+$anchor)
}
Set-Content $csPath $c -Encoding UTF8

@'
using Xunit;
[assembly: CollectionBehavior(DisableTestParallelization = true)]
'@ | Set-Content (Join-Path $root 'tests\OncaPDV.Tests\StressSerial.cs') -Encoding UTF8

Write-Host "FINAL_ROOT=$root"
