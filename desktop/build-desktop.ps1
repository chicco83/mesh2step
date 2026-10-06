# Mesh2STEP Desktop — build-desktop.ps1
# Versione: 1.3.0 — 2026-10-06 14:10 (Europe/Rome)
# Equivalente PowerShell di build-desktop.sh (per Windows senza Git Bash).
# Copia l'app web in desktop\wwwroot e pubblica l'exe portabile win-x64.
# Output: desktop\out\Mesh2STEP_v<versione>_<AAAAMMGG-HHMM>.exe   — richiede .NET 8 SDK.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ver = (Get-Content ..\VERSION -Raw).Trim()
$stamp = if ($env:BUILD_STAMP) { $env:BUILD_STAMP } else { Get-Date -Format 'yyyyMMdd-HHmm' }
# copia dei file web (stessa lista di build-desktop.sh)
if (Test-Path wwwroot) { Remove-Item wwwroot -Recurse -Force }
New-Item -ItemType Directory -Force wwwroot\src, wwwroot\vendor, wwwroot\icons | Out-Null
Copy-Item ..\index.html, ..\manifest.webmanifest wwwroot\
Copy-Item ..\src\app.js, ..\src\worker.js, ..\src\core.js wwwroot\src\
Copy-Item ..\vendor\three.module.min.js, ..\vendor\OrbitControls.js wwwroot\vendor\
Copy-Item ..\icons\*.png wwwroot\icons\
dotnet publish -c Release -o publish
New-Item -ItemType Directory -Force out | Out-Null
Copy-Item publish\Mesh2STEP.exe "out\Mesh2STEP_v${ver}_${stamp}.exe"
Write-Host "creato out\Mesh2STEP_v${ver}_${stamp}.exe"
