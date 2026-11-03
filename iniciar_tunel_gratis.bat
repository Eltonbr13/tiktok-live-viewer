@echo off
title TikTok Live Viewer - Tunel Publico Gratuito
cd /d "%~dp0"

echo ========================================================
echo    TikTok Live - Tunel Publico 100%% Gratuito (Sem Cartao)
echo ========================================================
echo Iniciando o servidor local e gerando link para o celular...
echo.

start "TikTok Server" cmd /c "node server.js"
timeout /t 2 >nul

echo Gerando link publico seguro (HTTPS) para acessar do celular...
echo (Aguarde alguns segundos para o link aparecer abaixo)
echo.
npx localtunnel --port 3000
pause
