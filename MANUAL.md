# MANUALE — Mesh2STEP
Versione documento: 1.0.0 — 2026-10-05 17:10

## 1. Avvio
- **Online**: GitHub Pages del repository (`https://chicco83.github.io/mesh2step/`).
- **Portabile**: apri `dist/mesh2step_v1.0.0_20261005-1710.html` con doppio clic (serve internet solo per caricare three.js).
- **Sviluppo**: `python3 -m http.server` nella cartella del progetto, poi `http://localhost:8000`.

## 2. Uso
1. **Apri mesh** (o trascina il file nella vista): STL, OBJ, 3MF.
   Il pannello File mostra triangoli, corpi, dimensioni, se la mesh è chiusa e il volume.
2. L'**analisi parte da sola** con una tolleranza suggerita. Puoi cambiarla e premere **Analizza mesh**.
3. Controlla i colori:

   | Colore | Significato |
   |---|---|
   | Blu-grigio | Piano |
   | Verde acqua | Cilindro (foro, albero, raccordo) |
   | Arancio | Sfera |
   | Viola | Freeform: resta sfaccettato nello STEP |
   | Grigio | Non ancora analizzato |

4. **Clic** su una faccia: tipo, Ø, lunghezza, asse, scarto massimo dalla mesh.
5. La tabella **Cilindri** raggruppa fori e alberi per diametro.
6. **Scarica STEP** e apri il file nel CAD.

### Parametri
| Parametro | Default | Effetto |
|---|---|---|
| Tolleranza (mm) | diag × 1e-4 (0,01–0,2) | Distanza max dei vertici dalla superficie. Più alta = più cilindri/piani riconosciuti, ma rischio di unire facce diverse. Per STL da CAD 0,01–0,05; per stampe/scan 0,1–0,3. |
| Angolo (°) | 1 | Scostamento max delle normali (piani) e dalla perpendicolare all'asse (cilindri). |
| Cilindri / Sfere | attivi | Disattiva un tipo per forzarlo in piani/freeform. |

### Navigazione 3D
Trascina = ruota · rotella/pizzica = zoom · tasto destro o Shift+trascina = sposta · **F** = adatta.

## 3. Consigli
- Le mesh migliori sono quelle **esportate da CAD** (Printables, Thingiverse, MakerWorld): i vertici stanno esattamente sulle superfici.
- Scansioni e modelli scolpiti diventano quasi tutti freeform.
- Mesh aperta (avviso giallo): lo STEP sarà una superficie; chiudi i buchi prima (es. in Meshmixer/PrusaSlicer).
- Messaggio "molte zone freeform": aumenta la tolleranza a passi di ×2.

## 4. Sviluppo
```
src/core.js      parsing, topologia, riconoscimento, export STEP (no DOM)
src/worker.js    Web Worker: protocollo load / analyse / step
src/app.js       UI e viewer three.js
index.html       pagina (GitHub Pages)
build.mjs        crea dist/mesh2step_v<VERSION>_<AAAAMMGG-HHMM>.html
tests/           make_samples.py, run_core.js, check_step.py
```
### Test
```
pip install trimesh manifold3d cadquery-ocp
python3 tests/make_samples.py && node tests/run_core.js && python3 tests/check_step.py
```
`check_step.py` legge gli STEP con OpenCASCADE e stampa validità B-rep, solidi, volume e tipi di superficie; esce con codice 1 se uno STEP non è valido.

### Nuova versione
1. Aggiorna `VERSION` e le intestazioni dei file toccati.
2. Voce in `CHANGELOG.md`, aggiorna `CONTEXT.md` / `MANUAL.md` se serve.
3. `node build.mjs` (cancella la build precedente in `dist/`).
4. Test, poi commit per nome dei file modificati (vedi `CLAUDE.md`).
