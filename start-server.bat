@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
) else (
  "C:\Users\labpc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py
)

pause
