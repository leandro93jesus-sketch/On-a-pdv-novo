$ErrorActionPreference='Stop'
$src=Join-Path $PSScriptRoot 'apply-ui-018.ps1'
$fixed=Join-Path $PSScriptRoot 'apply-ui-018-runtime.ps1'
$t=Get-Content $src -Raw

# Replace the original fragile culture block with a robust regex-based implementation.
$blockPattern='(?s)# Force Brazilian Portuguese culture globally so currency renders as R\$\..*?# Restore a cleaner, more polished DIVERSOS dialog while keeping the same behavior\.'
$blockReplacement=@'
# Force Brazilian Portuguese culture globally so currency renders as R$.
$app=Join-Path $desktop 'App.xaml.cs'
$t=Get-Content $app -Raw
if(-not $t.Contains('DefaultThreadCurrentCulture')){
  $startupPattern='    protected override void OnStartup\(StartupEventArgs e\)\s*\{'
  $inject=@'
    protected override void OnStartup(StartupEventArgs e)
    {
        var culture = System.Globalization.CultureInfo.GetCultureInfo("pt-BR");
        System.Globalization.CultureInfo.DefaultThreadCurrentCulture = culture;
        System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = culture;
        System.Threading.Thread.CurrentThread.CurrentCulture = culture;
        System.Threading.Thread.CurrentThread.CurrentUICulture = culture;
        System.Windows.FrameworkElement.LanguageProperty.OverrideMetadata(
            typeof(System.Windows.FrameworkElement),
            new System.Windows.FrameworkPropertyMetadata(System.Windows.Markup.XmlLanguage.GetLanguage("pt-BR")));
'@
  if(-not [regex]::IsMatch($t,$startupPattern)){throw 'App OnStartup anchor missing'}
  $t=[regex]::Replace($t,$startupPattern,[System.Text.RegularExpressions.MatchEvaluator]{param($m) $inject.TrimEnd()},1)
  Set-Content $app $t -Encoding UTF8
}

# Restore a cleaner, more polished DIVERSOS dialog while keeping the same behavior.
'@
$t=[regex]::Replace($t,$blockPattern,[System.Text.RegularExpressions.MatchEvaluator]{param($m) $blockReplacement.TrimEnd()},1)

# Repair PowerShell quoting used to insert the two new navigation buttons.
$bad='(?m)^\s*\$extra=\$anchor\+"`r`n\s*<Button Style=.*DisplaySettings_Click.*$'
$good=@'
  $extra=$anchor+"`r`n"+'                    <Button Style="{StaticResource NavButton}" Content="💾   Backup" Click="BackupCenter_Click"/>'+"`r`n"+'                    <Button Style="{StaticResource NavButton}" Content="🖥   Tela / Tamanho" Click="DisplaySettings_Click"/>'
'@
$t=[regex]::Replace($t,$bad,$good.TrimEnd(),1)

Set-Content $fixed $t -Encoding UTF8
& $fixed
