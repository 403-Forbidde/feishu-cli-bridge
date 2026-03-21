@echo off

if "%1"=="--legacy" goto legacy
if "%1"=="-l" goto legacy
if "%1"=="--help" goto help
if "%1"=="-h" goto help

echo Starting in CardKit streaming mode...
goto start

:legacy
echo Starting in legacy IM Patch mode...
set DISABLE_CARDKIT=1
goto start

:help
echo Usage: start.bat [options]
echo.
echo Options:
echo   --legacy, -l    Use legacy IM Patch mode (disable CardKit)
echo   --help, -h      Show this help
echo.
echo Default: CardKit streaming mode
exit /b 0

:start
cd /d "%~dp0"
set CONFIG_FILE=%~dp0config.yaml

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

python -m src.main
