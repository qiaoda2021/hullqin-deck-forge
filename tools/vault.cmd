@echo off
chcp 65001 >nul
setlocal

rem vault.cmd - launcher for vault.ps1 that bypasses ExecutionPolicy
rem for this process only. It never changes your system policy.
rem Usage:  tools\vault.cmd init
rem         tools\vault.cmd add github
rem         tools\vault.cmd list

set "HERE=%~dp0"

set "PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS=pwsh.exe"

rem no -NonInteractive here: "add" needs Read-Host to read the secret
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%HERE%vault.ps1" %*
set "RC=%ERRORLEVEL%"

endlocal & exit /b %RC%
