@echo off
setlocal
cd /d "%~dp0"
if not defined MINIMAX_ROOT set "MINIMAX_ROOT=%USERPROFILE%\OneDrive\CREATIVE and REPAIRS\!MISC\MiniMax"

echo ================================================================
echo  GOOD BOY RECORDS - SYNC MINIMAX
echo ================================================================
echo Source: %MINIMAX_ROOT%
echo.

where py >nul 2>nul
if errorlevel 1 goto :try_python
set "PY=py"
goto :deps

:try_python
where python >nul 2>nul
if errorlevel 1 goto :no_python
set "PY=python"

:deps
%PY% -c "import yaml; from PIL import Image" >nul 2>nul
if errorlevel 1 (
  echo Installing the two small build dependencies: PyYAML and Pillow...
  %PY% -m pip install PyYAML Pillow || goto :fail
)

%PY% tools\sync_minimax.py --root "%MINIMAX_ROOT%" || goto :fail
%PY% tools\prepare_artwork.py masters assets\img\sleeves || goto :fail
%PY% tools\build_catalogue.py || goto :fail

echo.
echo Sync complete. The site now points at the real audio copied from MiniMax\output.
exit /b 0

:no_python
echo Python was not found.
goto :fail

:fail
echo.
echo SYNC FAILED. Scroll up for the actual error.
exit /b 1
