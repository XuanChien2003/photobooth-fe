param([string]$SdkDirectory, [switch]$Install)
$ErrorActionPreference = 'Stop'
$agentRoot = Join-Path $env:LOCALAPPDATA 'NXC-CanonAgent'
if ($Install) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Can cai Node.js 20+ x64 truoc khi cai Canon Camera Agent.' }
  Add-Type -AssemblyName System.Windows.Forms
  if (-not $SdkDirectory) {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Chon EDSDK.dll x64 tu Canon EDSDK da tai ve'
    $dialog.Filter = 'Canon EDSDK|EDSDK.dll'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }
    $SdkDirectory = Split-Path -Parent $dialog.FileName
  }
  if (-not (Test-Path -LiteralPath (Join-Path $SdkDirectory 'EDSDK.dll'))) { throw 'Khong tim thay EDSDK.dll.' }
  New-Item -ItemType Directory -Path $agentRoot -Force | Out-Null
  foreach ($name in @('server.js','driver.js','CanonWorker.cs','start.ps1','package.json')) {
    $source = Join-Path $PSScriptRoot $name
    $target = Join-Path $agentRoot $name
    if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($target)) { Copy-Item -LiteralPath $source -Destination $target -Force }
  }
  $configRoot = Join-Path $env:LOCALAPPDATA 'NXC-Kiosk'
  New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
  $configPath = Join-Path $configRoot 'canon-agent.json'
  if (Test-Path -LiteralPath $configPath) { $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json }
  else { $config = [pscustomobject]@{ token = ''; folder = 'C:\PhotoBooth\CanonR50'; sdkDirectory = '' } }
  if (-not $config.token) {
    $bytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes); $rng.Dispose()
    $config.token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  }
  $config | Add-Member -NotePropertyName sdkDirectory -NotePropertyValue ([IO.Path]::GetFullPath($SdkDirectory)) -Force
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  New-Item -ItemType Directory -Path $config.folder -Force | Out-Null
  Write-Host 'Da cai Canon Camera Agent. Ma ket noi trong Cai dat may chup:'
  Write-Host $config.token
  Write-Host ('Chon thu muc anh: ' + $config.folder)
  Write-Host 'Giu cua so nay mo de Camera Agent chay. Kiosk tu mo lai chuong trinh sau khi bat may.'
}
$serverPath = if (Test-Path -LiteralPath (Join-Path $agentRoot 'server.js')) { Join-Path $agentRoot 'server.js' } else { Join-Path $PSScriptRoot 'server.js' }
& node $serverPath
