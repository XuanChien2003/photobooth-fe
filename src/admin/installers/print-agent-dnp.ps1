# NXC Photobooth - chương trình in tự động cho máy DNP DS-RX1 của MỘT phòng chụp, chạy trên mini PC
# cắm máy in. Cài bằng file "cai-may-in-*.bat" tải ở Quản lý máy → Cài máy chụp → Máy in DNP của phòng.
# Chỉ dùng PowerShell có sẵn của Windows (không cần Node.js).
#
#   -Install   tìm máy DNP, tạo hàng in "cắt đôi 2x6" cho tờ nhỏ (bật 2inch cut), lưu cấu hình và tự
#              chạy mỗi lần bật máy.
#   -Diagnose  chỉ xem: liệt kê máy in, khổ giấy, tuỳ chọn cắt của driver (không đổi gì).
#   (mặc định) mỗi 3 giây hỏi web có lệnh in của phòng không, tải tờ in và in ra máy DNP:
#              tờ to (10 × 15 cm) in nguyên tờ ở hàng in chính; tờ nhỏ (2 dải 5 × 15 cm trên một tờ) in
#              qua hàng in cắt đôi để máy tự cắt thành 2 dải.
param(
  [switch]$Install,
  [switch]$Diagnose,
  # In hết lệnh đang chờ rồi thoát (kiểm tra tự động).
  [switch]$Once,
  # Không in thật: chép tờ in vào thư mục này (kiểm tra tự động).
  [string]$DryRunDir = "",
  [string]$ConfigPath = ""
)
$ErrorActionPreference = 'Stop'
$AgentDir = Join-Path $env:LOCALAPPDATA 'NXC-Printer'
if (-not $ConfigPath) { $ConfigPath = Join-Path $AgentDir 'config.json' }
$LogPath = Join-Path (Split-Path -Parent $ConfigPath) 'print-agent.log'
$StripSuffix = ' - cat doi 2x6'
$PsfNs = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Write-Log([string]$text) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $text
  Write-Host $line
  try {
    if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 1MB) {
      Move-Item -LiteralPath $LogPath -Destination "$LogPath.old" -Force
    }
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {}
}

function Show-Message([string]$text, [string]$icon = 'Information') {
  Write-Host $text
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($text, 'NXC Photobooth - Máy in DNP', 'OK', $icon)
  } catch {}
}

# Máy DNP trong Windows: theo tên driver / tên hàng in, bỏ hàng in cắt đôi do chương trình này tạo.
function Find-Dnp {
  $all = @(Get-Printer -ErrorAction SilentlyContinue)
  $dnp = @($all | Where-Object {
    (($_.DriverName -match 'DNP|DS-?RX1|RX1') -or ($_.Name -match 'DNP|DS-?RX1|RX1')) -and
      -not $_.Name.EndsWith($StripSuffix)
  })
  if ($dnp.Count -eq 0) { return $null }
  # Ưu tiên máy không để "Use printer offline", rồi hàng in tên ngắn nhất (hàng in gốc của driver).
  return $dnp | Sort-Object @{ Expression = { [bool]$_.WorkOffline } }, @{ Expression = { $_.Name.Length } } |
    Select-Object -First 1
}

# Tên + tên hiển thị của một Feature / Option trong PrintCapabilities.
function Get-Label($node) {
  $text = $node.GetAttribute('name')
  foreach ($child in $node.ChildNodes) {
    if ($child.LocalName -eq 'Property' -and $child.GetAttribute('name') -match 'DisplayName$') {
      $text += ' ' + $child.InnerText
    }
  }
  return $text
}

# Tuỳ chọn cắt của driver (DNP: "2inch cut" Enable / Disable) trong PrintCapabilities của hàng in.
function Find-CutOptionIn([System.Xml.XmlDocument]$caps, [bool]$enable) {
  $ns = New-Object System.Xml.XmlNamespaceManager($caps.NameTable)
  $ns.AddNamespace('psf', $PsfNs)
  foreach ($feature in $caps.SelectNodes('//psf:Feature', $ns)) {
    if ((Get-Label $feature) -notmatch '(?i)cut') { continue }
    foreach ($option in $feature.SelectNodes('psf:Option', $ns)) {
      $label = Get-Label $option
      if ($enable) { $wanted = $label -match '(?i)enable|2\s*-?\s*inch|\bon\b' }
      else { $wanted = $label -match '(?i)disable|standard|normal|\boff\b' }
      if ($wanted -and $feature.GetAttribute('name').Contains(':') -and $option.GetAttribute('name').Contains(':')) {
        return @{ feature = $feature; option = $option; label = (Get-Label $feature) + ' = ' + $label }
      }
    }
  }
  return $null
}
function Find-CutOption([string]$queueName, [bool]$enable) {
  Add-Type -AssemblyName System.Printing, ReachFramework
  $server = New-Object System.Printing.LocalPrintServer
  $caps = New-Object System.Xml.XmlDocument
  $caps.Load($server.GetPrintQueue($queueName).GetPrintCapabilitiesAsXml())
  return Find-CutOptionIn $caps $enable
}
# PrintTicket chỉ đổi đúng tuỳ chọn cắt (các tuỳ chọn khác của hàng in giữ nguyên khi gộp).
function New-CutTicketXml($found) {
  $fPrefix, $fLocal = $found.feature.GetAttribute('name').Split(':', 2)
  $oPrefix, $oLocal = $found.option.GetAttribute('name').Split(':', 2)
  $fUri = $found.feature.GetNamespaceOfPrefix($fPrefix)
  $oUri = $found.option.GetNamespaceOfPrefix($oPrefix)
  return "<psf:PrintTicket xmlns:psf=`"$PsfNs`" xmlns:f=`"$fUri`" xmlns:o=`"$oUri`" version=`"1`">" +
    "<psf:Feature name=`"f:$fLocal`"><psf:Option name=`"o:$oLocal`"/></psf:Feature></psf:PrintTicket>"
}

# Bật / tắt cắt đôi 2 inch làm mặc định của hàng in (cần quyền quản trị). Driver không cho đặt tuỳ chọn
# qua PrintTicket thì trả về $false: nhân viên bật tay một lần trong cửa sổ cài đặt in.
function Set-TwoInchCut([string]$queueName, [bool]$enable) {
  try {
    $found = Find-CutOption $queueName $enable
    if (-not $found) { return $false }
    $xml = New-CutTicketXml $found
    $oLocal = $found.option.GetAttribute('name').Split(':', 2)[1]
    $delta = New-Object System.Printing.PrintTicket(New-Object System.IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($xml)))
    $server = New-Object System.Printing.PrintServer
    $queue = New-Object System.Printing.PrintQueue($server, $queueName, [System.Printing.PrintSystemDesiredAccess]::AdministratePrinter)
    $queue.DefaultPrintTicket = $queue.MergeAndValidatePrintTicket($queue.DefaultPrintTicket, $delta).ValidatedPrintTicket
    $queue.UserPrintTicket = $queue.MergeAndValidatePrintTicket($queue.UserPrintTicket, $delta).ValidatedPrintTicket
    $queue.Commit()
    $queue.Refresh()
    $check = (New-Object System.IO.StreamReader($queue.UserPrintTicket.GetXmlStream())).ReadToEnd()
    if ($check -match [regex]::Escape($oLocal)) {
      Write-Log "Hàng in '$queueName': $($found.label)."
      return $true
    }
  } catch {
    Write-Log "Không tự đặt được tuỳ chọn cắt cho '$queueName': $($_.Exception.Message)"
  }
  return $false
}

# Khổ giấy 10 × 15 cm (4 × 6 inch) của driver (driver có thể khai báo dọc hoặc ngang).
function Find-Paper($settings) {
  return $settings.PaperSizes | Where-Object {
    $short = [Math]::Min($_.Width, $_.Height); $long = [Math]::Max($_.Width, $_.Height)
    [Math]::Abs($short - 400) -lt 12 -and [Math]::Abs($long - 600) -lt 12
  } | Sort-Object { $_.PaperName -match 'x ?2|2x6|strip|cut' } | Select-Object -First 1
}

function Send-Sheets([string]$printerName, [string[]]$files, [string]$docName) {
  if ($DryRunDir) {
    New-Item -ItemType Directory -Force -Path $DryRunDir | Out-Null
    $safe = $printerName -replace '[^\w.-]+', '_'
    $n = 0
    foreach ($file in $files) {
      $n++
      Copy-Item -LiteralPath $file -Destination (Join-Path $DryRunDir ('{0}-{1}-{2}{3}' -f $docName, $n, $safe, [IO.Path]::GetExtension($file)))
    }
    return 'thử'
  }
  Add-Type -AssemblyName System.Drawing
  $document = New-Object System.Drawing.Printing.PrintDocument
  $document.DocumentName = $docName
  $document.PrinterSettings.PrinterName = $printerName
  if (-not $document.PrinterSettings.IsValid) { throw "Không thấy hàng in '$printerName' trong Windows." }
  $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $paper = Find-Paper $document.PrinterSettings
  if (-not $paper) { throw "Hàng in '$printerName' không có khổ giấy 4x6 (10 × 15 cm). Kiểm tra driver DNP." }
  $document.DefaultPageSettings.PaperSize = $paper
  $document.DefaultPageSettings.Landscape = $false
  $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $script:printPages = $files
  $script:printIndex = 0
  $document.add_PrintPage({
    param($sender, $event)
    $photo = [System.Drawing.Image]::FromFile($script:printPages[$script:printIndex])
    try {
      # Tờ khác chiều với trang của máy in (vd. tờ ngang trên trang dọc): xoay 90 độ cho kín khổ.
      $pageLandscape = $event.PageBounds.Width -gt $event.PageBounds.Height
      if (($photo.Width -gt $photo.Height) -ne $pageLandscape) { $photo.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
      $event.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $event.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $event.Graphics.TranslateTransform(-$event.PageSettings.HardMarginX, -$event.PageSettings.HardMarginY)
      $event.Graphics.DrawImage($photo, $event.PageBounds)
    } finally { $photo.Dispose() }
    $script:printIndex++
    $event.HasMorePages = $script:printIndex -lt $script:printPages.Count
  })
  try { $document.Print() } finally { $document.Dispose() }
  return $paper.PaperName
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Chưa cài máy in: không thấy $ConfigPath. Chạy lại file cai-may-in-*.bat tải ở Quản lý máy."
  }
  return Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Invoke-Api([string]$method, [string]$path, $body) {
  $params = @{
    Method = $method
    Uri = "$($script:Config.api)/api/print-agent$path"
    Headers = @{ Authorization = "Bearer $($script:Config.token)" }
    TimeoutSec = 30
    UseBasicParsing = $true
  }
  if ($null -ne $body) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress -Depth 6))
  }
  return Invoke-RestMethod @params
}

# Tình trạng máy DNP cho trang quản trị: sẵn sàng, mất kết nối, hết giấy…, số tờ đang chờ trong Windows.
$StatusNames = @{
  Normal = 'Sẵn sàng'; Offline = 'Mất kết nối (máy in tắt hoặc rút cáp USB)'; PaperOut = 'Hết giấy / hết mực'
  PaperJam = 'Kẹt giấy'; Paused = 'Hàng in đang tạm dừng'; Error = 'Máy in báo lỗi'; PaperProblem = 'Lỗi giấy'
  DoorOpen = 'Đang mở nắp'; NotAvailable = 'Không dùng được'; TonerLow = 'Sắp hết mực'
}
function Send-Status {
  $config = $script:Config
  $printer = Get-Printer -Name $config.printer -ErrorAction SilentlyContinue
  $ready = $false; $state = 'Không thấy máy in DNP trong Windows'; $jobs = 0
  if ($printer) {
    $raw = [string]$printer.PrinterStatus
    $state = $StatusNames[$raw]
    if (-not $state) { $state = $raw }
    $ready = ($raw -eq 'Normal') -and -not $printer.WorkOffline
    if ($printer.WorkOffline) { $state = 'Đang bật "Use printer offline" trong Windows' }
    foreach ($name in @($config.printer, $config.stripPrinter)) {
      if ($name) { $jobs += @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue).Count }
    }
  }
  $cut = 'none'
  if ($config.stripPrinter -and (Get-Printer -Name $config.stripPrinter -ErrorAction SilentlyContinue)) { $cut = $config.cut }
  if ($cut -ne 'auto' -and $cut -ne 'queue') { $cut = 'none' }
  [void](Invoke-Api 'POST' '/status' @{ dnp = @{
    printer = [string]$config.printer; stripPrinter = [string]$config.stripPrinter
    ready = [bool]$ready; state = [string]$state; jobs = [int]$jobs; cut = $cut
  } })
}

function Invoke-Job($job) {
  $config = $script:Config
  $dir = Join-Path $env:TEMP ('nxc-print-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $files = @()
    foreach ($sheet in @($job.sheets)) {
      $file = Join-Path $dir ('{0}.{1}' -f $sheet.index, $sheet.extension)
      Invoke-WebRequest -Uri "$($config.api)/api/print-agent/jobs/$($job.id)/sheets/$($sheet.index)" `
        -Headers @{ Authorization = "Bearer $($config.token)"; 'X-Print-Lease' = $job.leaseId } `
        -OutFile $file -UseBasicParsing -TimeoutSec 120
      $copies = [Math]::Max(1, [int]$job.copies)
      for ($n = 0; $n -lt $copies; $n++) { $files += $file }
    }
    $queue = $config.printer; $note = ''
    if ($job.printSize -eq 'strip') {
      if ($config.stripPrinter -and (($DryRunDir) -or (Get-Printer -Name $config.stripPrinter -ErrorAction SilentlyContinue))) {
        $queue = $config.stripPrinter; $note = ', tờ nhỏ qua hàng in cắt đôi 2 inch'
      } else {
        $note = ' — chưa có hàng in cắt đôi: tờ nhỏ ra nguyên tờ, nhân viên tự cắt'
      }
    }
    $paper = Send-Sheets $queue $files ("NXC-$($job.code)")
    return "Đã gửi $($files.Count) tờ tới máy DNP ($paper)$note."
  } finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Start-Agent {
  $script:Config = Read-Config
  if (-not $Once) {
    $script:Mutex = New-Object System.Threading.Mutex($false, 'Local\NXC-Printer-Agent')
    if (-not $script:Mutex.WaitOne(0)) { Write-Log 'Chương trình in đã đang chạy.'; return }
  }
  Write-Log "Bắt đầu nhận lệnh in phòng '$($script:Config.room)' → $($script:Config.printer) (tờ nhỏ: $($script:Config.stripPrinter))."
  $statusAt = [datetime]::MinValue
  $delay = 3
  while ($true) {
    try {
      if (((Get-Date) - $statusAt).TotalSeconds -ge 60) {
        try { Send-Status } catch { Write-Log "Không báo được tình trạng máy in: $($_.Exception.Message)" }
        $statusAt = Get-Date
      }
      $claim = Invoke-Api 'POST' '/claim' @{ printSizes = @('full', 'strip') }
      $job = $claim.job
      if ($job) {
        $sent = $false
        try {
          $message = Invoke-Job $job
          $sent = $true
          Write-Log "Lệnh $($job.code): $message"
        } catch {
          $message = "Máy in DNP không nhận lệnh: $($_.Exception.Message)"
          Write-Log "Lệnh $($job.code): $message"
        }
        if ($message.Length -gt 480) { $message = $message.Substring(0, 480) }
        [void](Invoke-Api 'POST' "/jobs/$($job.id)/complete" @{ leaseId = [string]$job.leaseId; sent = $sent; message = $message })
        # Còn lệnh khác thì lấy ngay; báo lại tình trạng (số tờ đang chờ) cho quản trị.
        $delay = 0
        $statusAt = [datetime]::MinValue
      } else {
        if ($Once) { break }
        $delay = 3
      }
    } catch {
      $code = 0
      try { $code = [int]$_.Exception.Response.StatusCode } catch {}
      if ($code -eq 403) {
        Write-Log 'Mã máy in không hợp lệ hoặc đã hết hạn: tải lại file cài máy in ở Quản lý máy và chạy lại.'
        $delay = 60
      } else {
        Write-Log "Chưa kết nối được máy chủ: $($_.Exception.Message)"
        $delay = [Math]::Min(30, [Math]::Max(3, $delay * 2))
      }
      if ($Once) { throw }
    }
    if ($delay -gt 0) { Start-Sleep -Seconds $delay }
  }
}

function Show-Diagnosis {
  Write-Host '== Máy in trong Windows'
  Get-Printer | Format-Table -AutoSize Name, DriverName, PortName, PrinterStatus, WorkOffline | Out-String -Width 200 | Write-Host
  $main = Find-Dnp
  if (-not $main) { Write-Host 'Không thấy máy DNP (driver DNP / DS-RX1).'; return }
  Write-Host "== Máy DNP: $($main.Name)"
  Add-Type -AssemblyName System.Drawing
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $main.Name
  foreach ($paper in $settings.PaperSizes) { Write-Host ('  khổ: {0} ({1} x {2})' -f $paper.PaperName, $paper.Width, $paper.Height) }
  $paper = Find-Paper $settings
  Write-Host "  khổ dùng để in: $(if ($paper) { $paper.PaperName } else { 'KHÔNG CÓ 4x6' })"
  foreach ($name in @($main.Name, $main.Name + $StripSuffix)) {
    if (-not (Get-Printer -Name $name -ErrorAction SilentlyContinue)) { continue }
    try {
      $on = Find-CutOption $name $true; $off = Find-CutOption $name $false
      Write-Host "  cắt đôi qua PrintTicket ($name): bật = $(if ($on) { $on.label } else { 'không có' }); tắt = $(if ($off) { $off.label } else { 'không có' })"
    } catch { Write-Host "  không đọc được PrintCapabilities của $($name): $($_.Exception.Message)" }
  }
}

function Install-Agent {
  # Địa chỉ web, mã máy in và tên phòng nằm trong file cài (.bat) dạng base64, không qua dòng lệnh.
  $installer = $env:NXC_PRINT_INSTALLER
  if (-not $installer -or -not (Test-Path -LiteralPath $installer)) { throw 'Hãy chạy file cai-may-in-*.bat, không chạy trực tiếp file này.' }
  $payload = [regex]::Match([IO.File]::ReadAllText($installer), '(?m)^rem NXC_PRINT_CONFIG_BASE64:([A-Za-z0-9+/=]+)')
  if (-not $payload.Success) { throw 'File cài bị hỏng: tải lại ở Quản lý máy.' }
  $setup = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.Groups[1].Value)) | ConvertFrom-Json
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
  Write-Host "Cài máy in DNP cho phòng: $($setup.room)"

  $main = Find-Dnp
  if (-not $main) {
    Show-Message ("Chưa thấy máy in DNP DS-RX1 trong Windows.`n`nCắm máy in vào máy tính này, cài driver DNP " +
      "(dnpphoto.com → Support → Drivers), bật máy in rồi chạy lại file cài.") 'Warning'
    exit 1
  }
  Write-Host "Máy in DNP: $($main.Name) (driver $($main.DriverName), cổng $($main.PortName))"
  $stripName = $main.Name + $StripSuffix
  $created = $false
  if (-not (Get-Printer -Name $stripName -ErrorAction SilentlyContinue)) {
    Add-Printer -Name $stripName -DriverName $main.DriverName -PortName $main.PortName
    $created = $true
    Write-Host "Đã tạo hàng in cho tờ nhỏ: $stripName"
  }
  $cut = 'queue'
  if (Set-TwoInchCut $stripName $true) {
    $cut = 'auto'
    # Hàng in chính không cắt: tờ to ra nguyên tờ 10 × 15.
    [void](Set-TwoInchCut $main.Name $false)
  } elseif ($created -or -not (Test-Path -LiteralPath $ConfigPath)) {
    Show-Message ("Bước cuối (chỉ làm 1 lần): bật cắt đôi cho tờ nhỏ.`n`nBấm OK, cửa sổ cài đặt in của hàng " +
      "'$stripName' sẽ mở ra:`n  Advanced… (Nâng cao) → Printer Features → 2inch cut → Enable → OK → OK.`n`n" +
      "Hàng in '$($main.Name)' giữ nguyên (2inch cut = Disable) để tờ to in nguyên tờ.")
    Start-Process -FilePath 'rundll32.exe' -ArgumentList "printui.dll,PrintUIEntry /e /n `"$stripName`"" -Wait
  }
  $config = [ordered]@{
    api = [string]$setup.api; token = [string]$setup.token; room = [string]$setup.room
    printer = $main.Name; stripPrinter = $stripName; cut = $cut
  }
  $config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

  # Bật máy là chạy: lối tắt trong thư mục Startup của người dùng này.
  $startup = [Environment]::GetFolderPath('Startup')
  Set-Content -LiteralPath (Join-Path $startup 'NXC-May-in.bat') -Encoding ASCII -Value @(
    '@echo off',
    "start `"`" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  )
  # Dừng bản đang chạy (cài lại / đổi phòng) rồi chạy bản mới ngay.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*NXC-Printer*print-agent.ps1*' -and $_.CommandLine -notlike '*-Install*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
  )
  $cutText = if ($cut -eq 'auto') { 'đã tự bật cắt đôi 2 inch' } else { 'nhớ bật 2inch cut = Enable như hướng dẫn' }
  Show-Message ("Đã cài xong máy in DNP cho phòng '$($setup.room)'.`n`n" +
    "Tờ to: in nguyên tờ ở '$($main.Name)'.`nTờ nhỏ: in qua '$stripName' ($cutText).`n`n" +
    "Chương trình in chạy ẩn và tự chạy mỗi lần bật máy. Xem tình trạng ở Quản lý máy → Máy in tự động.")
}

if ($Diagnose) { Show-Diagnosis; return }
if ($Install) {
  try { Install-Agent } catch { Show-Message "Cài máy in không thành công: $($_.Exception.Message)" 'Error'; exit 1 }
  return
}
Start-Agent
