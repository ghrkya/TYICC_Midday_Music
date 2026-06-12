# pack.ps1
$env:HTTP_PROXY = 'http://127.0.0.1:7897'
$env:http_proxy = 'http://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:https_proxy = 'http://127.0.0.1:7897'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Set-Location $PSScriptRoot
Write-Host "[1/2] Building..."
npm.cmd run build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!"; exit 1 }
Write-Host "[2/2] Packaging..."
npx.cmd electron-builder --win --x64
Write-Host "Done!"
