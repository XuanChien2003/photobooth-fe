param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ProfileDirectory
)

# A local, non-activating control for the browser launched by the kiosk installer.
# It never connects to the browser, changes its profile, or sends keys to another app.
$ErrorActionPreference = 'Stop'

function Get-NormalizedProfilePath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try {
        $expanded = [Environment]::ExpandEnvironmentVariables($Value)
        if (-not [IO.Path]::IsPathRooted($expanded)) { return $null }
        return [IO.Path]::GetFullPath($expanded).TrimEnd([char[]]'\/')
    }
    catch { return $null }
}

$profilePath = Get-NormalizedProfilePath $ProfileDirectory
if (-not $profilePath) { exit 0 }

$hashProvider = [Security.Cryptography.SHA256]::Create()
try {
    $profileHash = [BitConverter]::ToString(
        $hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($profilePath.ToLowerInvariant()))
    ).Replace('-', '').Substring(0, 24)
}
finally { $hashProvider.Dispose() }

$mutex = New-Object Threading.Mutex($false, "Local\NXC-Kiosk-Corner-$profileHash")
$hasMutex = $false
$form = $null
$timer = $null
$tooltip = $null
$font = $null
$menuFont = $null
$titleFont = $null
$formRegion = $null
$context = $null

try {
    try { $hasMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { return }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace Nxc.KioskCorner
{
    public class CornerForm : Form
    {
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams value = base.CreateParams;
                value.ExStyle |= 0x08000000 | 0x00000080; // NOACTIVATE | TOOLWINDOW
                return value;
            }
        }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0021) // WM_MOUSEACTIVATE
            {
                message.Result = new IntPtr(3); // MA_NOACTIVATE: leave browser keys with the browser.
                return;
            }
            base.WndProc(ref message);
        }
    }

    public static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct Rect { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr window, out Rect bounds);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr window, int command);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();
        [DllImport("shell32.dll", SetLastError = true)]
        private static extern IntPtr CommandLineToArgvW(
            [MarshalAs(UnmanagedType.LPWStr)] string commandLine, out int count);
        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);

        public static bool IsBrowserWindow(IntPtr window)
        {
            StringBuilder name = new StringBuilder(64);
            return GetAncestor(window, 2) == window &&
                GetClassName(window, name, name.Capacity) > 0 &&
                name.ToString() == "Chrome_WidgetWin_1";
        }

        public static int GetWindowDpi(IntPtr window)
        {
            try
            {
                uint dpi = GetDpiForWindow(window);
                if (dpi > 0) return (int)dpi;
            }
            catch (EntryPointNotFoundException) { }
            return 96;
        }

        public static void EnableDpiAwareness()
        {
            // Match Screen.Bounds and GetWindowRect in physical pixels on scaled displays.
            try
            {
                if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return;
                if (SetThreadDpiAwarenessContext(new IntPtr(-3)) != IntPtr.Zero) return;
            }
            catch (EntryPointNotFoundException) { }
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
            catch (EntryPointNotFoundException) { }
            try { SetProcessDPIAware(); }
            catch (EntryPointNotFoundException) { }
        }

        public static string[] SplitCommandLine(string commandLine)
        {
            int count;
            IntPtr memory = CommandLineToArgvW(commandLine, out count);
            if (memory == IntPtr.Zero) return new string[0];
            try
            {
                string[] result = new string[count];
                for (int i = 0; i < count; i++)
                    result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
                return result;
            }
            finally { LocalFree(memory); }
        }
    }
}
'@

    [Nxc.KioskCorner.Native]::EnableDpiAwareness()

    function Test-OwnedCommandLine([string]$CommandLine) {
        if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
        $arguments = [Nxc.KioskCorner.Native]::SplitCommandLine($CommandLine)
        $profileArguments = @()
        for ($index = 1; $index -lt $arguments.Length; $index++) {
            $argument = $arguments[$index]
            # Old --kiosk launches lock out F11 and must be closed before installing this launcher.
            if ($argument -eq '--kiosk') { return $false }
            # Chromium child processes do not own the kiosk's main browser window.
            if ($argument -eq '--type' -or $argument.StartsWith('--type=')) { return $false }
            if ($argument -eq '--user-data-dir') {
                $index++
                if ($index -ge $arguments.Length) { return $false }
                $profileArguments += $arguments[$index]
            }
            elseif ($argument.StartsWith('--user-data-dir=')) {
                $profileArguments += $argument.Substring('--user-data-dir='.Length)
            }
        }
        if ($profileArguments.Count -ne 1) { return $false }
        $candidatePath = Get-NormalizedProfilePath $profileArguments[0]
        return [string]::Equals($candidatePath, $profilePath, [StringComparison]::OrdinalIgnoreCase)
    }

    function Test-WindowOwner([IntPtr]$Window, [int]$ProcessId) {
        if ($Window -eq [IntPtr]::Zero -or -not [Nxc.KioskCorner.Native]::IsWindow($Window)) {
            return $false
        }
        $ownerId = [uint32]0
        [void][Nxc.KioskCorner.Native]::GetWindowThreadProcessId($Window, [ref]$ownerId)
        return $ownerId -eq $ProcessId
    }

    function Find-OwnedBrowser {
        try {
            $candidates = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction Stop)
        }
        catch { return $null }
        foreach ($candidate in $candidates) {
            if (-not (Test-OwnedCommandLine $candidate.CommandLine)) { continue }
            $process = $null
            try {
                $process = Get-Process -Id $candidate.ProcessId -ErrorAction Stop
                $startedTicks = $process.StartTime.ToUniversalTime().Ticks
                if (-not $candidate.CreationDate -or
                    [Math]::Abs($startedTicks - $candidate.CreationDate.ToUniversalTime().Ticks) -gt
                    [TimeSpan]::TicksPerMillisecond) { continue }
                $window = $process.MainWindowHandle
                if (-not (Test-WindowOwner $window $process.Id)) { continue }
                if (-not [Nxc.KioskCorner.Native]::IsBrowserWindow($window)) { continue }
                if (-not [Nxc.KioskCorner.Native]::IsWindowVisible($window)) { continue }
                return [pscustomobject]@{
                    ProcessId = $process.Id
                    StartedUtcTicks = $startedTicks
                    Window = $window
                }
            }
            catch { continue }
            finally { if ($process) { $process.Dispose() } }
        }
        return $null
    }

    function Test-PinnedProcess($Target) {
        $process = $null
        try {
            $process = Get-Process -Id $Target.ProcessId -ErrorAction Stop
            # Reject PID reuse even if the old window handle has also been recycled.
            if ($process.StartTime.ToUniversalTime().Ticks -ne $Target.StartedUtcTicks) {
                return $false
            }
            return $true
        }
        catch { return $false }
        finally { if ($process) { $process.Dispose() } }
    }

    function Test-PinnedBrowser($Target) {
        return (Test-PinnedProcess $Target) -and (Test-WindowOwner $Target.Window $Target.ProcessId) -and
            [Nxc.KioskCorner.Native]::IsBrowserWindow($Target.Window)
    }

    function Update-PinnedBrowserWindow($Target) {
        if (-not (Test-PinnedProcess $Target)) { return $false }
        $foreground = [Nxc.KioskCorner.Native]::GetForegroundWindow()
        # Reopening the desktop shortcut can create a new window in the same browser process.
        # Follow that foreground window before checking whether the previous one was closed.
        if ((Test-WindowOwner $foreground $Target.ProcessId) -and
            [Nxc.KioskCorner.Native]::IsBrowserWindow($foreground)) { $Target.Window = $foreground }
        # An owned file picker is not the browser: keep the last browser window and hide its menu.
        return (Test-WindowOwner $Target.Window $Target.ProcessId) -and
            [Nxc.KioskCorner.Native]::IsBrowserWindow($Target.Window)
    }

    function Test-FullscreenWindow([IntPtr]$Window) {
        if (-not [Nxc.KioskCorner.Native]::IsWindowVisible($Window) -or
            [Nxc.KioskCorner.Native]::IsIconic($Window)) { return $false }
        $bounds = New-Object Nxc.KioskCorner.Native+Rect
        if (-not [Nxc.KioskCorner.Native]::GetWindowRect($Window, [ref]$bounds)) { return $false }
        $screen = [Windows.Forms.Screen]::FromHandle($Window).Bounds
        # Maximized windows extend beyond the monitor's bounds; only fullscreen qualifies.
        return [Math]::Abs($bounds.Left - $screen.Left) -le 2 -and
            [Math]::Abs($bounds.Top - $screen.Top) -le 2 -and
            [Math]::Abs($bounds.Right - $screen.Right) -le 2 -and
            [Math]::Abs($bounds.Bottom - $screen.Bottom) -le 2
    }

    $state = [pscustomobject]@{
        Target = $null
        Clock = [Diagnostics.Stopwatch]::StartNew()
        LastProbeMs = -1000
        MenuOpen = $false
        MenuTarget = $null
        PendingAction = $null
        PendingTarget = $null
        PendingRequestedMs = 0
        LastActionMs = -1000
        LayoutDpi = 0
        LayoutExpanded = $null
    }

    $form = New-Object Nxc.KioskCorner.CornerForm
    $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::None
    $form.AutoScaleMode = [Windows.Forms.AutoScaleMode]::None
    $form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
    $form.BackColor = [Drawing.Color]::FromArgb(62, 43, 35)
    $form.ForeColor = [Drawing.Color]::FromArgb(241, 183, 189)
    $form.ShowInTaskbar = $false
    $form.TopMost = $true
    $form.Opacity = 0.88
    $form.Text = 'NXC'
    $form.AccessibleName = 'Điều khiển cửa sổ kiosk'

    $check = New-Object Windows.Forms.Label
    $check.Text = [string][char]0x2713
    $check.TextAlign = [Drawing.ContentAlignment]::MiddleCenter
    $check.Cursor = [Windows.Forms.Cursors]::Hand
    $check.AccessibleName = 'Mở hoặc đóng điều khiển cửa sổ kiosk'
    $form.Controls.Add($check)
    $tooltip = New-Object Windows.Forms.ToolTip
    $tooltip.SetToolTip($check, 'Toàn màn hình, về cửa sổ hoặc thu xuống taskbar')

    $menuTitle = New-Object Windows.Forms.Label
    $menuTitle.Text = 'Điều khiển cửa sổ'
    $menuTitle.ForeColor = [Drawing.Color]::FromArgb(213, 196, 182)
    $menuTitle.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
    $form.Controls.Add($menuTitle)

    $menuLabels = @()
    foreach ($text in @('Toàn màn hình    F11', 'Về cửa sổ', 'Thu xuống taskbar')) {
        $label = New-Object Windows.Forms.Label
        $label.Text = $text
        $label.ForeColor = [Drawing.Color]::FromArgb(250, 242, 235)
        $label.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
        $label.Padding = New-Object Windows.Forms.Padding(12, 0, 0, 0)
        $label.Cursor = [Windows.Forms.Cursors]::Hand
        $label.AccessibleName = $text
        $label.Add_MouseEnter({ $this.BackColor = [Drawing.Color]::FromArgb(87, 61, 49) })
        $label.Add_MouseLeave({ $this.BackColor = $form.BackColor })
        $form.Controls.Add($label)
        $menuLabels += $label
    }

    function Copy-WindowTarget($Target) {
        return [pscustomobject]@{
            ProcessId = $Target.ProcessId
            StartedUtcTicks = $Target.StartedUtcTicks
            Window = $Target.Window
        }
    }

    function Set-CornerLayout([bool]$Expanded, [int]$Dpi) {
        if ($state.LayoutDpi -eq $Dpi -and $state.LayoutExpanded -eq $Expanded) { return }
        $scale = $Dpi / 96.0
        $diameter = [int][Math]::Round(28 * $scale)
        $width = $diameter
        $height = $diameter
        if ($Expanded) {
            $width = [int][Math]::Round(248 * $scale)
            $height = [int][Math]::Round(176 * $scale)
        }
        if ($state.LayoutDpi -ne $Dpi) {
            $previousFonts = @($script:font, $script:menuFont, $script:titleFont)
            $script:font = New-Object Drawing.Font('Segoe UI', (12 * $scale), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
            $script:menuFont = New-Object Drawing.Font('Segoe UI', (13 * $scale), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
            $script:titleFont = New-Object Drawing.Font('Segoe UI', (11 * $scale), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
            $check.Font = $script:font
            $menuTitle.Font = $script:titleFont
            foreach ($label in $menuLabels) { $label.Font = $script:menuFont }
            foreach ($previousFont in $previousFonts) { if ($previousFont) { $previousFont.Dispose() } }
        }
        $form.SuspendLayout()
        try {
            $form.ClientSize = New-Object Drawing.Size($width, $height)
            $checkLeft = 0
            $checkTop = 0
            if ($Expanded) {
                $checkLeft = $width - $diameter - [int][Math]::Round(4 * $scale)
                $checkTop = [int][Math]::Round(4 * $scale)
            }
            $check.Bounds = New-Object Drawing.Rectangle($checkLeft, $checkTop, $diameter, $diameter)
            $menuTitle.Bounds = New-Object Drawing.Rectangle(
                ([int][Math]::Round(12 * $scale)), 0,
                ($width - [int][Math]::Round(52 * $scale)), ([int][Math]::Round(36 * $scale)))
            $menuTitle.Visible = $Expanded
            for ($index = 0; $index -lt $menuLabels.Count; $index++) {
                $menuLabels[$index].Bounds = New-Object Drawing.Rectangle(
                    ([int][Math]::Round(8 * $scale)), ([int][Math]::Round((36 + 44 * $index) * $scale)),
                    ($width - [int][Math]::Round(16 * $scale)), ([int][Math]::Round(44 * $scale)))
                $menuLabels[$index].Padding = New-Object Windows.Forms.Padding(([int][Math]::Round(12 * $scale)), 0, 0, 0)
                $menuLabels[$index].BackColor = $form.BackColor
                $menuLabels[$index].Visible = $Expanded
            }
            $cornerPath = New-Object Drawing.Drawing2D.GraphicsPath
            try {
                if ($Expanded) {
                    $curve = [int][Math]::Round(16 * $scale)
                    $cornerPath.AddArc(0, 0, $curve, $curve, 180, 90)
                    $cornerPath.AddArc(($width - $curve), 0, $curve, $curve, 270, 90)
                    $cornerPath.AddArc(($width - $curve), ($height - $curve), $curve, $curve, 0, 90)
                    $cornerPath.AddArc(0, ($height - $curve), $curve, $curve, 90, 90)
                    $cornerPath.CloseFigure()
                }
                else { $cornerPath.AddEllipse(0, 0, $width, $height) }
                $previousRegion = $script:formRegion
                $script:formRegion = New-Object Drawing.Region($cornerPath)
                $form.Region = $script:formRegion
                if ($previousRegion) { $previousRegion.Dispose() }
            }
            finally { $cornerPath.Dispose() }
            $form.Opacity = if ($Expanded) { 0.98 } else { 0.88 }
            $state.LayoutDpi = $Dpi
            $state.LayoutExpanded = $Expanded
        }
        finally { $form.ResumeLayout() }
    }

    function Close-CornerMenu {
        $state.MenuOpen = $false
        $state.MenuTarget = $null
        Set-CornerLayout $false ([Math]::Max(96, $state.LayoutDpi))
    }

    function Update-CornerPlacement($Target, [bool]$Fullscreen) {
        $dpi = [Nxc.KioskCorner.Native]::GetWindowDpi($Target.Window)
        $scale = $dpi / 96.0
        $screen = [Windows.Forms.Screen]::FromHandle($Target.Window)
        $bounds = New-Object Nxc.KioskCorner.Native+Rect
        if (-not [Nxc.KioskCorner.Native]::GetWindowRect($Target.Window, [ref]$bounds)) { return $false }
        $inset = [int][Math]::Round(6 * $scale)
        if ($Fullscreen) {
            $availableLeft = $screen.Bounds.Left + $inset
            $availableRight = $screen.Bounds.Right - $inset
            $availableTop = $screen.Bounds.Top + $inset
            $availableBottom = $screen.Bounds.Bottom - $inset
        }
        else {
            # Keep the native title bar, close/minimize/maximize buttons and address bar available.
            $availableLeft = [Math]::Max($bounds.Left, $screen.WorkingArea.Left) + $inset
            $availableRight = [Math]::Min($bounds.Right, $screen.WorkingArea.Right) - $inset
            $availableTop = [Math]::Max(($bounds.Top + [int][Math]::Round(90 * $scale)), ($screen.WorkingArea.Top + $inset))
            $availableBottom = [Math]::Min($bounds.Bottom, $screen.WorkingArea.Bottom) - $inset
        }
        Set-CornerLayout $state.MenuOpen $dpi
        if ($availableRight - $availableLeft -lt $form.Width -or
            $availableBottom - $availableTop -lt $form.Height) {
            if ($state.MenuOpen) {
                Close-CornerMenu
                Set-CornerLayout $false $dpi
            }
            if ($availableRight - $availableLeft -lt $form.Width -or
                $availableBottom - $availableTop -lt $form.Height) { return $false }
        }
        $form.Location = New-Object Drawing.Point(($availableRight - $form.Width), $availableTop)
        return $true
    }

    function Test-ActionTarget($Target) {
        if (-not (Test-PinnedBrowser $Target) -or
            -not [Nxc.KioskCorner.Native]::IsWindowVisible($Target.Window) -or
            [Nxc.KioskCorner.Native]::IsIconic($Target.Window)) { return $false }
        $foreground = [Nxc.KioskCorner.Native]::GetForegroundWindow()
        if ($foreground -ne $Target.Window) {
            # NOACTIVATE normally leaves focus on Chrome. Permit only our own menu as a fallback.
            if (-not $state.MenuOpen -or $foreground -ne $form.Handle) { return $false }
            [void][Nxc.KioskCorner.Native]::SetForegroundWindow($Target.Window)
        }
        return (Test-PinnedBrowser $Target) -and
            [Nxc.KioskCorner.Native]::IsWindowVisible($Target.Window) -and
            -not [Nxc.KioskCorner.Native]::IsIconic($Target.Window) -and
            [Nxc.KioskCorner.Native]::GetForegroundWindow() -eq $Target.Window
    }

    function Clear-PendingWindowAction {
        $state.PendingAction = $null
        $state.PendingTarget = $null
    }

    function Send-FullscreenKey { [Windows.Forms.SendKeys]::SendWait('{F11}') }

    function Invoke-CornerAction([string]$Action) {
        $target = $state.MenuTarget
        $now = $state.Clock.ElapsedMilliseconds
        if (-not $state.MenuOpen -or -not $target -or $state.PendingAction -or
            $now - $state.LastActionMs -lt 750) { return }
        if ($Action -notin @('fullscreen', 'window', 'minimize')) { return }
        if (-not (Test-ActionTarget $target)) { Close-CornerMenu; $form.Hide(); return }
        $fullscreen = Test-FullscreenWindow $target.Window
        # Retain this exact HWND even if a second window opens in the same Chromium process.
        $actionTarget = Copy-WindowTarget $target
        $form.Hide()
        Close-CornerMenu
        if (-not (Test-ActionTarget $actionTarget)) { return }
        $state.LastActionMs = $now
        if ($Action -eq 'minimize') {
            [void][Nxc.KioskCorner.Native]::ShowWindowAsync($actionTarget.Window, 6) # SW_MINIMIZE
            return
        }
        if ($Action -eq 'window' -and -not $fullscreen) {
            [void][Nxc.KioskCorner.Native]::ShowWindowAsync($actionTarget.Window, 9) # SW_RESTORE
            return
        }
        if (($Action -eq 'fullscreen') -eq $fullscreen) { return }
        # F11 is a toggle: send it only when changing modes, never repeat it automatically.
        if (-not (Test-ActionTarget $actionTarget) -or
            (Test-FullscreenWindow $actionTarget.Window) -ne $fullscreen) { return }
        $state.PendingAction = $Action
        $state.PendingTarget = $actionTarget
        $state.PendingRequestedMs = $now
        Send-FullscreenKey
    }

    function Update-PendingWindowAction {
        if (-not $state.PendingAction) { return }
        $target = $state.PendingTarget
        if (-not $target -or -not (Test-ActionTarget $target)) {
            # Never restore a minimized/background window or a different window in the same process.
            Clear-PendingWindowAction
            return
        }
        $fullscreen = Test-FullscreenWindow $target.Window
        if ($state.PendingAction -eq 'window' -and -not $fullscreen) {
            if (Test-ActionTarget $target) {
                [void][Nxc.KioskCorner.Native]::ShowWindowAsync($target.Window, 9) # SW_RESTORE
            }
            Clear-PendingWindowAction
        }
        elseif ($state.PendingAction -eq 'fullscreen' -and $fullscreen) {
            Clear-PendingWindowAction
        }
        elseif ($state.Clock.ElapsedMilliseconds - $state.PendingRequestedMs -ge 4000) {
            Clear-PendingWindowAction
        }
    }

    Set-CornerLayout $false 96

    $context = New-Object Windows.Forms.ApplicationContext
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 500

    $onClick = {
        $target = $state.Target
        if (-not $target -or $state.PendingAction) { return }
        if ($state.MenuOpen) { Close-CornerMenu }
        else {
            if (-not (Test-ActionTarget $target)) { return }
            $state.MenuTarget = Copy-WindowTarget $target
            $state.MenuOpen = $true
        }
        if (-not (Update-CornerPlacement $target (Test-FullscreenWindow $target.Window))) { $form.Hide() }
    }
    $check.Add_Click($onClick)
    $menuLabels[0].Add_Click({ Invoke-CornerAction 'fullscreen' })
    $menuLabels[1].Add_Click({ Invoke-CornerAction 'window' })
    $menuLabels[2].Add_Click({ Invoke-CornerAction 'minimize' })

    $onTick = {
        try {
            $now = $state.Clock.ElapsedMilliseconds
            if (-not $state.Target) {
                # CIM is only used while locating the launcher's exact profile, at most once a second.
                if ($now -ge 30000) { $context.ExitThread(); return }
                if ($now - $state.LastProbeMs -lt 1000) { return }
                $state.LastProbeMs = $now
                $state.Target = Find-OwnedBrowser
                if (-not $state.Target) { return }
            }

            Update-PendingWindowAction
            $target = $state.Target
            # An open menu and an in-flight F11 action stay bound to their original window.
            $valid = if ($state.MenuOpen -or $state.PendingAction) {
                Test-PinnedBrowser $target
            }
            else { Update-PinnedBrowserWindow $target }
            if (-not $valid) {
                $form.Hide()
                $context.ExitThread()
                return
            }

            $fullscreen = Test-FullscreenWindow $target.Window
            $foreground = [Nxc.KioskCorner.Native]::GetForegroundWindow()
            $ownsFocus = $foreground -eq $target.Window -or
                ($state.MenuOpen -and $foreground -eq $form.Handle)
            if (-not $state.PendingAction -and $ownsFocus -and
                [Nxc.KioskCorner.Native]::IsWindowVisible($target.Window) -and
                -not [Nxc.KioskCorner.Native]::IsIconic($target.Window) -and
                (Update-CornerPlacement $target $fullscreen)) {
                if (-not $form.Visible) { $form.Show() }
            }
            else {
                if ($state.MenuOpen) { Close-CornerMenu }
                if ($form.Visible) { $form.Hide() }
            }
        }
        catch {
            # A closed/replaced browser must leave no overlay behind.
            $form.Hide()
            $context.ExitThread()
        }
    }
    $timer.Add_Tick($onTick)
    $timer.Start()
    [Windows.Forms.Application]::Run($context)
}
finally {
    if ($timer) { $timer.Stop(); $timer.Dispose() }
    if ($tooltip) { $tooltip.Dispose() }
    if ($form) { $form.Dispose() }
    if ($font) { $font.Dispose() }
    if ($menuFont) { $menuFont.Dispose() }
    if ($titleFont) { $titleFont.Dispose() }
    if ($formRegion) { $formRegion.Dispose() }
    if ($context) { $context.Dispose() }
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
