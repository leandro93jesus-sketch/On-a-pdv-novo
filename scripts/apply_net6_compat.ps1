$ErrorActionPreference='Stop'
$root=(Resolve-Path '.').Path
Get-ChildItem $root -Recurse -Filter *.csproj | ForEach-Object {
  $p=$_.FullName
  $t=Get-Content $p -Raw
  $old=$t
  $t=$t.Replace('<TargetFramework>net10.0-windows</TargetFramework>','<TargetFramework>net6.0-windows</TargetFramework>')
  $t=$t.Replace('<TargetFramework>net10.0</TargetFramework>','<TargetFramework>net6.0</TargetFramework>')
  if($t -ne $old){Set-Content $p $t -Encoding UTF8; Write-Host "Retargeted $p"}
}
