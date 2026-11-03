@echo off
title TikTok Live Viewer - 100%% Sem Login
cd /d "%~dp0"

echo ========================================================
echo    TikTok Live Stream Viewer (100%% Sem Login)
echo ========================================================
echo.
echo [No seu Computador] Acesse:
echo   http://localhost:3000
echo.
echo [No seu Celular (conectado no mesmo Wi-Fi)] Acesse:
for /f "tokens=4" %%a in ('route print ^| findstr 0.0.0.0.*0.0.0.0 ^| findstr /v "Default"') do (
  set IP=%%a
)
echo   http://%IP%:3000
echo.
echo Pressione Ctrl+C para encerrar.
echo ========================================================

start "" http://localhost:3000
node server.js
pause
