@echo off
title AnyDesk Clone - Global Internet Tunnel
echo ========================================================
echo   AnyDesk Clone - Cloudflare Global Internet Tunnel
echo ========================================================
echo.
echo Starting secure public tunnel for port 5082...
echo You will see your public HTTPS URL below in a few seconds.
echo.
echo Copy that URL and enter it in Settings on the remote PC!
echo.
echo ========================================================
.\tools\cloudflared.exe tunnel --url http://localhost:5082
pause
