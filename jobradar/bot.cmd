@echo off
REM jobradar Telegram bot — keeps listening for commands and button taps.
REM Restarts if it exits, except on a 409 (another poller already running).
cd /d "%~dp0"
:loop
node bot.mjs >> data\bot.log 2>&1
timeout /t 15 /nobreak >nul
goto loop
