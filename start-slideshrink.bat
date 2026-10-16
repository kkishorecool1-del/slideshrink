@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
if not defined ROOT set "ROOT=%CD%"

echo ========================================
echo   SlideShrink - Windows Desktop App
echo   Local PowerPoint (PPTX) Compressor
echo ========================================
echo.

:: --- Prerequisites ---
echo [.] Checking prerequisites...
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3.11+ is not installed or not on PATH.
    echo         Install from https://www.python.org and re-run this script.
    pause
    exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 20+ is not installed or not on PATH.
    echo         Install from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)
echo [OK] Python and Node.js found.
echo.

:: --- Install root deps (Electron) ---
echo [1/3] Installing Electron (root)...
cd /d "%ROOT%"
if not exist "node_modules" (
    npm install
)
echo [OK] Electron ready.
echo.

:: --- Backend ---
echo [2/3] Setting up Python backend...
cd /d "%ROOT%backend"
if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)
call "%ROOT%backend\.venv\Scripts\activate.bat" >nul 2>&1 || (
    echo [WARNING] Could not activate venv; using system python.
)
python -m pip install --upgrade pip >nul 2>&1
pip install -r requirements.txt
echo [OK] Backend dependencies installed.
echo.

:: --- Frontend build ---
echo [3/3] Building React frontend...
cd /d "%ROOT%frontend"
if not exist "node_modules" (
    npm install
)
npm run build
echo [OK] Frontend built.
echo.

:: --- Launch ---
echo [Launch] Starting SlideShrink desktop application...
cd /d "%ROOT%"
npx electron .

echo.
echo SlideShrink has been closed.
pause
