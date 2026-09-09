@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo ============================================================
echo  ComfyUI Batch Studio Launcher
echo ============================================================
echo.

rem ------------------------------------------------------------
rem Check npm / Node.js
rem ------------------------------------------------------------
where npm >nul 2>&1
if errorlevel 1 (
    echo [INFO] npm was not found.
    echo [INFO] Installing Node.js LTS ^(includes npm^)...

    where winget >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] winget was not found.
        echo Please install Node.js LTS manually from:
        echo https://nodejs.org/
        echo.
        pause
        exit /b 1
    )

    winget install --id OpenJS.NodeJS.LTS -e ^
        --accept-source-agreements ^
        --accept-package-agreements

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install Node.js LTS.
        pause
        exit /b 1
    )

    rem Refresh the common Node.js install path for this process.
    if exist "%ProgramFiles%\nodejs\npm.cmd" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    )

    where npm >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Node.js was installed, but npm is not yet available in PATH.
        echo Close this window and run run.bat again.
        pause
        exit /b 1
    )
)

echo [INFO] Node.js:
node --version
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js could not be executed.
    pause
    exit /b 1
)

echo [INFO] npm:
npm --version
if errorlevel 1 (
    echo.
    echo [ERROR] npm could not be executed.
    pause
    exit /b 1
)

echo.

rem ------------------------------------------------------------
rem Install dependencies
rem ------------------------------------------------------------
echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

echo.

rem ------------------------------------------------------------
rem Build
rem ------------------------------------------------------------
echo [2/3] Building application...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] npm run build failed.
    pause
    exit /b 1
)

echo.

rem ------------------------------------------------------------
rem Start
rem ------------------------------------------------------------
echo [3/3] Starting application...
call npm start

set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] npm start exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
