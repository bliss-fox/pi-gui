@echo off
if "%~1"=="" (
  echo Usage: Apply-Chinese.cmd "C:\path\to\pi-gui"
  exit /b 1
)
node "%~dp0src\cli.mjs" apply "%~1"
exit /b %errorlevel%
