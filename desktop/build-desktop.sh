#!/usr/bin/env bash
# Mesh2STEP Desktop — build-desktop.sh
# Versione: 1.3.0 — 2026-10-06 13:40 (Europe/Rome)
# Copia l'app web in desktop/wwwroot e pubblica l'exe portabile win-x64 (funziona anche da Linux/macOS
# grazie a EnableWindowsTargeting). Output: desktop/out/Mesh2STEP_v<versione>_<AAAAMMGG-HHMM>.exe
set -euo pipefail
cd "$(dirname "$0")"
VER=$(cat ../VERSION); STAMP=${BUILD_STAMP:-$(TZ=Europe/Rome date +%Y%m%d-%H%M)}
rm -rf wwwroot && mkdir -p wwwroot/src wwwroot/vendor wwwroot/icons
cp ../index.html ../manifest.webmanifest wwwroot/
cp ../src/app.js ../src/worker.js ../src/core.js wwwroot/src/
# [2026-10-07 v1.7.0] prima: solo three.module.min.js e OrbitControls.js (manifold-3d serve a «Ripara auto-intersezioni»)
cp ../vendor/three.module.min.js ../vendor/OrbitControls.js ../vendor/manifold.js ../vendor/manifold.wasm wwwroot/vendor/
cp ../icons/*.png wwwroot/icons/
dotnet publish -c Release -o publish
mkdir -p out && cp publish/Mesh2STEP.exe "out/Mesh2STEP_v${VER}_${STAMP}.exe"
echo "creato out/Mesh2STEP_v${VER}_${STAMP}.exe"
