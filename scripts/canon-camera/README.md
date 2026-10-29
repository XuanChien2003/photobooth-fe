# Canon EOS R100 Camera Agent (Windows x64)

Legacy prototype: the current kiosk uses FUJIFILM X Acquire and a watched JPEG folder.
This Canon agent is not connected to the current customer capture flow or kiosk startup.
Use the Fujifilm setup in the project root README for the active booth.

Local USB control for the kiosk. Requires Node.js 20+ x64, .NET Framework 4.8 and Canon EDSDK x64
supporting the EOS R100. Canon's SDK/DLL files are not distributed in this archive.
For Vietnam, apply for an R100-compatible EDSDK at Canon South & Southeast Asia:
https://asia.canon/en/campaign/developerresources/sdk/form. Canon requires an application
from a legally registered entity and supplies the SDK under its own terms; contact the local
Canon sales company if that does not apply to you. Keep the supplied x64 DLLs together.

1. R100 firmware 1.3.0 recommended for EDSDK support. Connect a data USB cable and disconnect camera Wi-Fi.
2. Exit EOS Utility / EOS Webcam Utility. Only Camera Agent should own the USB session.
3. Extract this archive and run install.cmd. Select EDSDK.dll from the SDK's x64 DLL directory;
   keep its accompanying Canon DLLs in that directory. Installation copies only the agent source
   files into %LOCALAPPDATA%\NXC-CanonAgent; it does not copy the SDK or change USB drivers.
4. Copy the displayed connection token into kiosk staff settings → Canon EOS R100.
5. Choose C:\PhotoBooth\CanonR100 (or the folder displayed by Camera Agent) in the kiosk.
6. Connect R100, shoot a test and verify JPEG delivery and external flash on the actual equipment.

Timer mode sends a real Canon exposure command after 10 seconds. Cable mode only connects USB
for image transfer: the customer presses an RS-60E3 or compatible cable connected to the R100's
remote terminal. Touching the display or pressing Enter/Space does not trigger a software shot.
Do not connect the shutter cable to the microphone terminal. Both modes receive original JPEGs
through the same SDK download callback and folder watcher; test simultaneous wired capture,
USB tethering, HDMI and flash on the actual equipment before customer use.

Set JPEG Large/Fine (or RAW+JPEG), Single shooting; use a still-photo P/Tv/Av/M mode and disable
Silent shutter for flash. Verify flash/trigger compatibility and sync speed for the R100.
Do not apply the R50 multi-function shoe/AD-E1 instructions to this camera.
No flash or image is simulated by this agent.

Updating from R50: install this R100 archive and restart the previous Camera Agent process (or
restart the computer). The installed old R50 worker cannot recognise an R100. The agent token
is preserved; the old default photo directory changes to CanonR100 without moving/deleting old
files, while custom directories remain unchanged. Re-select the save folder in kiosk settings.

The current kiosk autostart file does not start this Camera Agent.
To run manually: powershell -NoProfile -File "$env:LOCALAPPDATA\NXC-CanonAgent\start.ps1".
Configuration: %LOCALAPPDATA%\NXC-Kiosk\canon-agent.json. The HTTP API binds only to
127.0.0.1:8788 and requires the token and an allowed kiosk Origin. Chrome/Edge may ask to allow
local network access; grant it for the trusted kiosk page. No customer photos go through this API:
complete JPEGs are atomically saved to the folder and the kiosk uses its existing upload flow.

Development: node scripts/canon-camera/server.js from photobooth-fe. CANON_SDK_DIR can select the SDK DLL directory;
CANON_PHOTO_DIR selects the save directory; CANON_KIOSK_ORIGINS is an explicit comma-separated list
of permitted web origins. Never expose this local server on a network interface.

Code compiles without the Canon SDK, but hardware acceptance still requires the SDK, an R100,
the flash/trigger and an end-to-end test on the booth computer.

Canon reference: https://cam.start.canon/en/C015/manual/html/UG-04_AF-Drive_0070.html
Firmware reference: https://sg.canon/en/support/0401145502
