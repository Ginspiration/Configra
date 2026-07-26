@echo off
setlocal
cd /d "%~dp0"

node scripts\start-debug.mjs %*
set "configra_exit_code=%errorlevel%"

if not "%configra_exit_code%"=="0" (
  echo.
  echo Configra debug startup failed. See the message above.
  pause
)

exit /b %configra_exit_code%
