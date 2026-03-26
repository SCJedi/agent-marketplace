@echo off
echo.
echo   Agent Marketplace - Windows Installer
echo   ======================================
echo.
echo   Starting setup...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
