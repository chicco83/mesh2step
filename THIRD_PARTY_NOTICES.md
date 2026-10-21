# Avvisi di terze parti — Mesh2STEP
Versione documento: 1.13.0 — 2026-10-21 21:49

## SimpleCAD (MIT)
`src/core.js`, sezione «6. PORT DI SIMPLECAD»: traduzione in JavaScript di `simplecad/surfaces/fit.py`
(https://github.com/igsova/SimpleCAD, release 0.38.0, commit 9180c4b).

```
MIT License

Copyright (c) 2026 SimpleCAD contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OpenCASCADE (LGPL-2.1) tramite replicad-opencascadejs
`vendor/replicad_single.js` e `vendor/replicad_single.wasm`: replicad-opencascadejs 1.1.0 (npm, https://github.com/sgenoud/replicad),
build WebAssembly di Open CASCADE Technology (https://dev.opencascade.org), licenza **LGPL-2.1** (OCCT: LGPL-2.1 con eccezione).
I due file sono distribuiti **senza modifiche** e caricati a parte, solo su richiesta («STEP validato»): si possono sostituire con
un'altra build compatibile dello stesso pacchetto. Sorgenti: https://github.com/Open-Cascade-SAS/OCCT e il repository di replicad.

## Altre librerie in `vendor/`
three.js (MIT), manifold-3d (Apache-2.0): vedi README.
