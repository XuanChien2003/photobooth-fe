@echo off
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Install
pause
