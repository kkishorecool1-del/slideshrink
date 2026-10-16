<#
.SYNOPSIS
    SlideShrink - Windows Desktop Launcher (PowerShell)
    Local PowerPoint (PPTX) Compressor
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SlideShrink - Windows Desktop App" -ForegroundColor Cyan
Write-Host "  Local PowerPoint (PPTX) Compressor" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Prerequisites ---
Write-Host "[.] Checking prerequisites..." -ForegroundColor Yellow
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python 3.11+ is not installed or not on PATH. Install from https://www.python.org"
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 20+ is not installed or not on PATH. Install from https://nodejs.org"
    exit 1
}
Write-Host "[OK] Python and Node.js found." -ForegroundColor Green
Write-Host ""

# --- Install root deps (Electron) ---
Write-Host "[1/3] Installing Electron (root)..." -ForegroundColor Yellow
Push-Location $Root
if (-not (Test-Path "$Root\node_modules")) { npm install }
Write-Host "[OK] Electron ready." -ForegroundColor Green
Write-Host ""

# --- Backend ---
Write-Host "[2/3] Setting up Python backend..." -ForegroundColor Yellow
Push-Location "$Root\backend"
if (-not (Test-Path "$Root\backend\.venv")) {
    python -m venv .venv
}
& "$Root\backend\.venv\Scripts\Activate.ps1"
python -m pip install --upgrade pip | Out-Null
pip install -r requirements.txt
Write-Host "[OK] Backend dependencies installed." -ForegroundColor Green
Write-Host ""

# --- Frontend build ---
Write-Host "[3/3] Building React frontend..." -ForegroundColor Yellow
Push-Location "$Root\frontend"
if (-not (Test-Path "$Root\frontend\node_modules")) { npm install }
npm run build
Write-Host "[OK] Frontend built." -ForegroundColor Green
Write-Host ""

# --- Launch ---
Write-Host "[Launch] Starting SlideShrink desktop application..." -ForegroundColor Green
Push-Location $Root
npx electron .

Write-Host ""
Write-Host "SlideShrink has been closed." -ForegroundColor Cyan
