@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0tools\node\node.exe" (
  "%~dp0tools\node\node.exe" server.js
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Install Node.js or place a portable runtime in tools\node\.
    pause
    exit /b 1
  )
  node server.js
)
