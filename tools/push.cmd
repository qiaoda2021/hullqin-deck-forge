@echo off
rem Zero-leak GitHub pusher launcher.
rem Pure ASCII on purpose: the project path contains CJK characters and
rem cmd.exe would mangle UTF-8 literals if they were embedded here.
chcp 65001 >nul 2>nul
setlocal
set "HERE=%~dp0"

where node >nul 2>nul
if not errorlevel 1 goto :run

set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" goto :nonode
goto :run

:run
if not defined NODE set "NODE=node"
"%NODE%" "%HERE%push-github.mjs" %*
exit /b %errorlevel%

:nonode
echo.
echo   Node.js not found.
echo   Edit this file and set NODE= to the full path of node.exe.
echo.
exit /b 1
