# Canon EOS R50 Camera Agent (Windows x64)

Local USB control for the kiosk. Requires Node.js 20+ x64, .NET Framework 4.8 and Canon EDSDK x64
supporting the EOS R50. Canon's SDK/DLL files are not distributed in this archive.
Obtain the SDK from https://www.usa.canon.com/support/sdk under Canon's licence.

1. R50 firmware >= 1.3.0; choose Photo Import/Remote Control for USB. Connect a data USB cable.
2. Exit EOS Utility / EOS Webcam Utility. Only Camera Agent should own the USB session.
3. Extract this archive and run install.cmd. Select EDSDK.dll from the SDK's x64 DLL directory;
   keep its accompanying Canon DLLs in that directory. Installation copies only the agent source
   files into %LOCALAPPDATA%\NXC-CanonAgent; it does not copy the SDK or change USB drivers.
4. Copy the displayed connection token into kiosk staff settings → Canon EOS R50.
5. Choose C:\PhotoBooth\CanonR50 (or the folder displayed by Camera Agent) in the kiosk.
6. Connect R50, shoot a test and verify JPEG delivery and external flash on the actual equipment.

Both the 3-second timer and the touchscreen capture button send a real Canon exposure command.
An optional USB keyboard-style remote can send Enter/Space to the computer. The R50 has no wired
remote jack; its 3.5 mm socket is microphone input. BR-E1 is a Bluetooth remote: do not assume it
can operate simultaneously with USB tethering. It has not been validated by this integration.

Set JPEG Large/Fine (or RAW+JPEG), Single shooting, Elec. 1st-curtain; disable Silent shutter.
The R50 has no fully mechanical shutter. Verify flash/trigger multi-function shoe compatibility
and whether Canon AD-E1 is required. No flash or image is simulated by this agent.

After installing the kiosk autostart file, it starts the installed Camera Agent at login.
To run manually: powershell -NoProfile -File "$env:LOCALAPPDATA\NXC-CanonAgent\start.ps1".
Configuration: %LOCALAPPDATA%\NXC-Kiosk\canon-agent.json. The HTTP API binds only to
127.0.0.1:8788 and requires the token and an allowed kiosk Origin. Chrome/Edge may ask to allow
local network access; grant it for the trusted kiosk page. No customer photos go through this API:
complete JPEGs are atomically saved to the folder and the kiosk uses its existing upload flow.

Development: npm run camera:agent from photobooth-fe. CANON_SDK_DIR can select the SDK DLL directory;
CANON_PHOTO_DIR selects the save directory; CANON_KIOSK_ORIGINS is an explicit comma-separated list
of permitted web origins. Never expose this local server on a network interface.

Code compiles without the Canon SDK, but hardware acceptance still requires the SDK, an R50,
the flash/trigger and an end-to-end test on the booth computer.
