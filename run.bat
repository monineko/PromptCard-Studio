@echo off
setlocal EnableExtensions
chcp 65001 >nul
call "%~dp0run-utf8.bat"
set "PCS_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %PCS_EXIT_CODE%
