@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for the first setup.
  echo Download it from https://nodejs.org/ and rerun this file.
  pause
  exit /b 1
)
npm install
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)
echo Setup complete. Use Start-VYPER.bat to run VYPER.
pause
