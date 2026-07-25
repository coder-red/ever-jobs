@echo off
REM jobradar scheduled run. Logs to data\run.log so failures are visible.
cd /d "%~dp0"
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format s"') do set NOW=%%i
echo. >> data\run.log
echo ===== %NOW% ===== >> data\run.log
node radar.mjs >> data\run.log 2>&1
