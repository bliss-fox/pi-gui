@echo off
if "%~1"=="" (
  echo Usage: Restore-English.cmd "C:\path\to\pi-gui"
  exit /b 1
)
node "%~dp0src\cli.mjs" restore "%~1"
exit /b %errorlevel%
