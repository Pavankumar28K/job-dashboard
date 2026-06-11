@echo off
echo ================================
echo  Job Dashboard - Starting...
echo ================================

cd /d "%~dp0"

echo Killing any process on port 8765...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765 "') do taskkill /F /PID %%a >nul 2>&1

echo Stopping any node.exe processes...
taskkill /F /IM node.exe /T >nul 2>&1

echo Waiting for port to free...
timeout /t 3 /nobreak >nul

echo Starting server...
start "Job Dashboard Server" cmd /k "node server.js"

echo Waiting for server to be ready...
timeout /t 4 /nobreak >nul

echo Opening browser...
start "" "http://localhost:8765"

echo Done! Keep the server window open.
