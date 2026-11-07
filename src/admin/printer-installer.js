import { encodePayload } from "./installers/payload.js";

// File cài máy in DNP cho mini PC của một phòng Photobooth (máy cắm DNP DS-RX1). Chạy một lần (xin
// quyền quản trị để tạo hàng in "cắt đôi 2x6"): giải nén chương trình in (installers/print-agent-dnp.ps1)
// vào %LOCALAPPDATA%\NXC-Printer, chạy phần cài đặt của nó (tìm máy DNP, bật 2inch cut cho hàng in tờ nhỏ,
// tự chạy khi bật máy). Địa chỉ web, mã máy in và tên phòng nằm trong file dạng base64.
export function printerInstaller({ script, api, token, room }) {
  if (!/^https?:\/\/[\w.:-]+$/.test(api)) throw new Error("Địa chỉ web không hợp lệ.");
  const extract = [
    "powershell -NoProfile -Command \"try { $s = [IO.File]::ReadAllText($env:NXC_PRINT_INSTALLER);",
    "$m = [regex]::Match($s, '(?m)^rem NXC_PRINT_AGENT_BASE64:([A-Za-z0-9+/=]+)'); if (-not $m.Success) { exit 1 };",
    "[IO.File]::WriteAllBytes((Join-Path $env:NXC_PRINT_DIR 'print-agent.ps1'), [Convert]::FromBase64String($m.Groups[1].Value)) }",
    "catch { exit 1 }\"",
  ].join(" ");
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    "rem NXC Photobooth - cai chuong trinh in tu dong cho may DNP DS-RX1 cua mot phong chup.",
    "rem Chay 1 lan tren mini PC cam may in DNP cua phong. To to: in nguyen to 10x15; to nho: may tu cat doi.",
    'set "NXC_SELF=%~f0"',
    "net session >nul 2>&1",
    "if errorlevel 1 (",
    "  echo Can quyen quan tri de tao hang in cat doi 2 inch: bam Yes o hop thoai cua Windows.",
    "  powershell -NoProfile -Command \"Start-Process -FilePath $env:NXC_SELF -Verb RunAs\"",
    "  exit /b",
    ")",
    'set "NXC_PRINT_INSTALLER=%~f0"',
    'set "NXC_PRINT_DIR=%LOCALAPPDATA%\NXC-Printer"',
    'if not exist "%NXC_PRINT_DIR%" mkdir "%NXC_PRINT_DIR%"',
    "echo Dang cai chuong trinh in tu dong...",
    extract,
    "if errorlevel 1 (",
    "  echo Khong giai nen duoc chuong trinh in. Tai lai file cai o Quan ly may.",
    "  pause",
    "  exit /b 1",
    ")",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%NXC_PRINT_DIR%\print-agent.ps1" -Install',
    "exit /b",
    `rem NXC_PRINT_AGENT_BASE64:${encodePayload(script)}`,
    `rem NXC_PRINT_CONFIG_BASE64:${encodePayload(JSON.stringify({ api, token, room }), { bom: false })}`,
    "",
  ].join("\r\n");
}

// Tên file: không dấu, chỉ chữ số và gạch nối ("Phòng 1" → cai-may-in-phong-1.bat).
export const printerInstallerName = (room) =>
  `cai-may-in-${room.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "phong"}.bat`;
