@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0source\start-app.ps1"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Startup failed. Press any key to close this window.
) else (
  echo Startup command finished. If the browser did not open, check source\logs.
  echo Press any key to close this window.
)
pause >nul
endlocal
