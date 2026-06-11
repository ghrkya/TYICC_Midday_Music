@echo off
cd /d D:\Code\Github\TYICC_Midday_Music
set HTTP_PROXY=http://127.0.0.1:7897
set http_proxy=http://127.0.0.1:7897
set HTTPS_PROXY=http://127.0.0.1:7897
set https_proxy=http://127.0.0.1:7897
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set CSC_KEY_PASSWORD=

echo [clean] Removing locked build artifacts...
if exist dist\win-unpacked.tmp rmdir /s /q dist\win-unpacked.tmp
if exist dist\win-unpacked rmdir /s /q dist\win-unpacked
if exist dist\*.7z del /f /q dist\*.7z
if exist dist\*.exe del /f /q dist\*.exe
if exist dist\*.blockmap del /f /q dist\*.blockmap
if exist dist\*.yml del /f /q dist\*.yml

echo [1/2] Building...
call npm.cmd run build
if %errorlevel% neq 0 ( echo Build failed! & pause & exit /b 1 )

echo [2/2] Packaging...
call npx.cmd electron-builder --win --x64
if %errorlevel% neq 0 ( echo Packaging failed! & pause & exit /b 1 )

echo Done!
pause
