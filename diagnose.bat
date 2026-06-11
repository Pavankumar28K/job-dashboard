@echo off
echo ================================
echo  Job Dashboard - Diagnostics
echo ================================
echo.

cd /d "%~dp0"

echo [1] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo    ERROR: Node.js is NOT installed or not on PATH
    echo    Download from: https://nodejs.org
) else (
    for /f %%v in ('node --version') do echo    Node.js version: %%v
)

echo.
echo [2] Checking port 8765...
netstat -aon | findstr ":8765 " >nul 2>&1
if %errorlevel% equ 0 (
    echo    WARNING: Port 8765 is already in use!
    echo    Process using it:
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765 "') do (
        echo       PID %%a
        tasklist /FI "PID eq %%a" 2>nul | findstr /v "INFO:"
    )
) else (
    echo    OK: Port 8765 is free
)

echo.
echo [3] Checking required files...
if exist "server.js" (echo    server.js ✓) else (echo    ERROR: server.js MISSING)
if exist "public\index.html" (echo    index.html ✓) else (echo    ERROR: index.html MISSING)
if exist "public\app.js" (echo    app.js ✓) else (echo    ERROR: app.js MISSING)
if exist "public\styles.css" (echo    styles.css ✓) else (echo    ERROR: styles.css MISSING)
if exist "data\jobs.json" (echo    jobs.json ✓) else (echo    NOTE: jobs.json not found - will be created)

echo.
echo [4] Testing Node.js can run server.js...
start /B node server.js > logs\diag_server.log 2>&1
timeout /t 4 /nobreak >nul

echo    Checking if server responded...
curl -s -o nul -w "   HTTP status: %%{http_code}" http://127.0.0.1:8765/ 2>nul || echo    curl not available - checking port instead
netstat -aon | findstr ":8765 " >nul 2>&1
if %errorlevel% equ 0 (
    echo    Server IS running on port 8765
) else (
    echo    ERROR: Server failed to start. Log:
    type logs\diag_server.log
)

echo.
echo [5] Killing test server...
taskkill /F /IM node.exe /T >nul 2>&1

echo.
echo ================================
echo  Diagnostics complete
echo ================================
pause
