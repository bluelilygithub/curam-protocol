@echo off
:: vault-rebuild.bat
:: Run this AFTER fixing npm (via fix-node-env.ps1 + restart).
:: Rebuilds better-sqlite3 for current Node version, then starts vault dev server.

echo.
echo === Vault Rebuild and Start ===
echo.

cd /d "%~dp0vault"

echo [1] Node version:
node --version
echo.
echo [2] npm version:
npm --version
echo.

echo [3] Rebuilding better-sqlite3 for current Node version...
npm rebuild better-sqlite3
if %errorlevel% neq 0 (
    echo.
    echo ERROR: rebuild failed. Check the error above.
    pause
    exit /b 1
)

echo.
echo [4] better-sqlite3 rebuild successful.
echo.
echo [5] Starting vault dev server...
echo     Frontend: http://localhost:5173
echo     Backend:  http://localhost:3000
echo.
npm run dev
