$ErrorActionPreference='Stop'
$src=Join-Path $PSScriptRoot 'apply-ui-018.ps1'
$fixed=Join-Path $PSScriptRoot 'apply-ui-018-runtime.ps1'
$t=Get-Content $src -Raw

# Make the App.xaml.cs startup anchor work with either CRLF or LF.
$t=[regex]::Replace($t,"\$needle='    protected override void OnStartup\(StartupEventArgs e\)\\n    \\{'",'$needle=[regex]::Match($t,''    protected override void OnStartup\(StartupEventArgs e\)\s*\{'').Value',1)

# Repair PowerShell quoting used to insert the two new navigation buttons.
$bad='(?m)^\s*\$extra=\$anchor\+"`r`n\s*<Button Style=.*DisplaySettings_Click.*$'
$good=@'
  $extra=$anchor+"`r`n"+'                    <Button Style="{StaticResource NavButton}" Content="💾   Backup" Click="BackupCenter_Click"/>'+"`r`n"+'                    <Button Style="{StaticResource NavButton}" Content="🖥   Tela / Tamanho" Click="DisplaySettings_Click"/>'
'@
$t=[regex]::Replace($t,$bad,$good.TrimEnd(),1)

Set-Content $fixed $t -Encoding UTF8
& $fixed
