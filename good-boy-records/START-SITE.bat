@echo off
setlocal
cd /d "%~dp0"

echo ================================================================
echo  GOOD BOY RECORDS
 echo ================================================================
echo Building ONLY the hand-picked files in .\showcase\ ...
call BUILD-SHOWCASE.bat
if errorlevel 1 (
  echo.
  echo The site was NOT started because the showcase build failed.
  pause
  exit /b 1
)

echo.
echo Starting local preview at http://localhost:8000/
start "" "http://localhost:8000/"
where py >nul 2>nul
if not errorlevel 1 (
  py tools\serve.py
  goto :eof
)
python tools\serve.py
