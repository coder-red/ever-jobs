@echo off
REM Run every suite. Exit non-zero if any fails.
cd /d "%~dp0"
set FAIL=0
for %%T in (test.mjs test-agencies.mjs test-outreach.mjs test-srchealth.mjs) do (
  node %%T || set FAIL=1
)
if %FAIL%==1 (echo. & echo SUITES FAILED & exit /b 1)
echo. & echo ALL SUITES GREEN
