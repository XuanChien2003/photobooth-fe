param([string]$ExecutablePath = '')

$ErrorActionPreference = 'Stop'
$logDirectory = Join-Path $env:LOCALAPPDATA 'NXC-Kiosk'
$log = Join-Path $logDirectory 'fuji-acquire-start.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

try {
  $candidates = @(
    $ExecutablePath,
    (Join-Path ${env:ProgramFiles(x86)} 'FUJIFILM\XAcquire\XAcquire.exe'),
    (Join-Path $env:ProgramFiles 'FUJIFILM\XAcquire\XAcquire.exe')
  )
  $exe = $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
  if (-not $exe) { throw 'FUJIFILM X Acquire was not found. Set -ExecutablePath to XAcquire.exe.' }
  if (Get-Process -Name 'XAcquire' -ErrorAction SilentlyContinue) { exit 0 }
  # Keep X Acquire and the kiosk pointed at the same directory after sign-in.
  $saveFolder = 'C:\PhotoBooth\Fujifilm'
  $preferences = 'HKCU:\Software\COM.FUJIFILM.DENJI\XAcquire\Preferences'
  New-Item -ItemType Directory -Path $saveFolder -Force | Out-Null
  New-Item -Path $preferences -Force | Out-Null
  New-ItemProperty -Path $preferences -Name Destination -Value $saveFolder -PropertyType String -Force | Out-Null
  # The tray menu lets staff inspect the connection and selected save folder.
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Normal
  "$(Get-Date -Format o) Started FUJIFILM X Acquire" | Out-File -LiteralPath $log -Append -Encoding utf8
} catch {
  "$(Get-Date -Format o) $($_.Exception.Message)" | Out-File -LiteralPath $log -Append -Encoding utf8
  exit 1
}
