@echo off
setlocal

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>nul
  echo Stopped process %%p using port 3000.
  set "FOUND=1"
)

if not defined FOUND (
  echo No server found on port 3000.
)

echo.
pause

endlocal
