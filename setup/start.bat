@echo off
echo.
echo   Starting Agent Marketplace...
echo   Dashboard: http://localhost:3001/dashboard
echo.
cd /d "%~dp0.."
node src/server.js
pause
