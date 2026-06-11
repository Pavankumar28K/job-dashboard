@echo off
cd /d "C:\Users\konat\job-dashboard"

echo Killing any existing server on port 8765...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /IM node.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Job Dashboard...
start "Job Dashboard Server" cmd /k "cd /d C:\Users\konat\job-dashboard && node server.js"
timeout /t 4 /nobreak >nul

start "" "http://localhost:8765"
