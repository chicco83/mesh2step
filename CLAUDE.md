# CLAUDE.md — Mesh2STEP
Versione: 1.7.0 — 2026-10-07 22:10
<!-- [2026-10-06 14:10] versione precedente (2026-10-06 13:45, commit 61c8f81): solo regole di versioning,
     documenti, test, git e progetto. Ora anche stato, ambiente, mappa del codice, insidie e prossimi passi
     per riprendere il lavoro da Claude Code. Le regole precedenti sono riportate invariate qui sotto. -->

Istruzioni per ogni sessione (Claude Code locale, sessioni cloud) che lavora su questo repository.
Leggi prima questo file, poi `CONTEXT.md` (architettura e decisioni) e `IMPROVEMENTS.md` (cosa resta da fare).

## 1. Il progetto in breve
Web app che converte mesh **STL/OBJ/3MF** in **STEP** con superfici CAD reali (piano, cilindro, cono, sfera,
toro, B-spline) + filettature riconosciute. Tutto nel browser (Web Worker), offline, nessun upload.
Replica clean-room di mesh2solid.thavision.com con le funzioni "Pro" gratis e varie migliorie.
- Repo: `https://github.com/chicco83/mesh2step` — sito: `https://chicco83.github.io/mesh2step/` (Pages da `main` / root)
- Copia locale dell'utente: `G:\Il mio Drive\CRISTIANO\VIBE CODING\mesh2step` (cartella Google Drive)

## 2. Stato al 2026-10-07 22:10
| Voce | Stato |
|---|---|
| Versione | **1.7.0** (`main`; v1.6.0 `1caf165`) — CI e Pages da controllare |
| Sito Pages | ✅ online alla 1.4.0, provato il 2026-10-07: bolt_m6 (opzione filettatura→cilindro: 5 facce, 2 cilindri), PDF, toro (2 facce toroidali), service worker attivo, console pulita. Provati in locale (1.3.2–1.4.0): tema chiaro/scuro, selezione, unione/annulla, deviazione, riparazione, export STEP/STL/OBJ |
| Test core + OpenCASCADE | 20 STEP `valid=True` (18 + `overlap_pin`, `overlap_pin_riparata`); `test_repair.js`, `test_pdf.js`, `test_selfint.js`, `test_devthr.js`, `test_selfrepair.js` ok (vedi §6) |
| CI GitHub (`ci.yml`) | ✅ verde sui push 1.5.0, 1.5.1 e 1.6.0 (test core, OpenCASCADE, riparazione, PDF, auto-intersezioni, deviazione filetti); dalla 1.7.0 anche `test_selfrepair.js` |
| App Windows (`desktop/`) | ✅ provata su Windows 11 il 2026-10-07 con la build CI 1.4.1 (WebView2 154): avvio, apertura file da argomento, analisi, export STEP/PDF/STL salvati su disco (STEP rivalidati con OCP: `valid=True`). Bug trovato e corretto: risorse in sottocartelle (backslash in `RecursiveDir`). **Non provati**: «Apri con…»/trascinamento sull'exe, SmartScreen su altro PC, installazione pulita senza WebView2 |
| Migliorie | stato per voce in `IMPROVEMENTS.md` (✅ / 🟡 parziale / ⏸️ rinviata) |

## 3. Ambiente di sviluppo
| Strumento | Uso | Note |
|---|---|---|
| Node.js ≥ 18 | `tests/run_core.js`, `build.mjs` | serve `DecompressionStream` (3MF) |
| Python ≥ 3.10 | `tests/make_samples.py`, `tests/check_step.py` | `pip install numpy trimesh manifold3d cadquery-ocp networkx lxml` (OCP = OpenCASCADE, ~100 MB); facoltativo `pymupdf` per vedere i PDF come immagini |
| .NET 8 SDK | solo per l'exe Windows | `desktop\build-desktop.ps1` (Windows) o `desktop/build-desktop.sh` |
| Browser | prova dell'interfaccia | servire la cartella via HTTP: `python -m http.server 8000` (il Worker e il service worker non partono da `file://`; la build in `dist/` invece sì) |
| Playwright (facoltativo) | test end-to-end della UI | `npm i playwright` in una cartella di lavoro **fuori dal repo** |

Comandi in PowerShell dalla radice del repo:
```powershell
python tests\make_samples.py; node tests\run_core.js; python tests\check_step.py
node tests\test_repair.js; node tests\test_pdf.js
node build.mjs
.\desktop\build-desktop.ps1
python -m http.server 8000   # poi http://localhost:8000
```

## 4. Mappa del codice
| File | Contenuto |
|---|---|
| `src/core.js` | Motore senza DOM (IIFE, esporta `M2S` in Worker e `module.exports` in Node). Sezioni: **1. Parsing** (`parseSTL`, `parseOBJ`, `parse3MF` con `unzip`/`inflateRaw`, `parseFile`) · **2. Topologia** (`buildMesh`: saldatura, normali, spigoli `E0/E1/ET`, vicini `nb`, componenti `comp`, nomi corpi) · **3. Fitting** (`fitPlane`, `fitCircle2D`, `axisFromNormals`, `fitCylinder`, `fitSphere`) · **4. Riconoscimento** (`segment`, stadi 4-00 → 4f, vedi sotto) · **3-bis. Primitive/utilità** (`fitCone`, `coneDist`, `fitTorus`, `torusDist`, `cylErr`, `ISO_METRIC`, `detectThread`, `fitBSpline`, `fillHoles`, `fixNonManifold`, `findSelfIntersections`, `fitBSplineClosed`, `threadsToCylinders`, `reportPdf`, `regionStats`, `editRegions`, `features`, `surfDist`, `deviation`) · **5. Export** (`stepNum`, `exportSTEP`) · `analyse` |
| `src/worker.js` | Protocollo `load / repair / analyse / edit / undo / step / stl / obj`; riassunti serializzabili delle regioni; cronologia per Annulla |
| `src/app.js` | UI: dizionario `DICT` IT/EN, tema, viewer three.js, picking/selezione, tabelle, corpi, editing, export, CSV, integrazione (`postMessage`, `?url=`, `launchQueue`, service worker) |
| `index.html` | Layout e CSS (token colore in `:root` e `[data-theme="light"]`), import map verso `vendor/` |
| `sw.js` · `manifest.webmanifest` · `icons/` | PWA (cambiare `CACHE` a ogni versione) |
| `vendor/` | three.js 0.169 `three.module.min.js` + `OrbitControls.js` (MIT); `manifold.js` + `manifold.wasm` (manifold-3d 3.5.4, Apache-2.0: riparazione auto-intersezioni; ESM + wasm, caricati con `import()` nel Worker) |
| `build.mjs` | Build single-file offline in `dist/` (three/app/worker incorporati come moduli Blob) |
| `desktop/` | App Windows WebView2 (C#/.NET 8): `Program.cs` serve i file incorporati su `https://app.mesh2step/` |
| `tests/` | `make_samples.py` (mesh note con manifold3d), `run_core.js`, `check_step.py`, `samples/` |
| `archive/` | Versioni precedenti dei file riscritti per intero |
| `.github/workflows/` | `ci.yml` (test + build), `desktop.yml` (exe; release sui tag `v*`) |

**Ordine degli stadi in `segment`** (l'ordine è voluto, vedi §7):
4-00 filettature (esclude i triangoli ⟂ asse) → 4-0 B-spline (patch lisce; aperte `fitBSpline` o chiuse `fitBSplineClosed`) → 4a-bis sfere → 4a-quater tori → 4a-ter coni → 4a cilindri →
4b piani → 4c freeform → 4d macchie freeform (filetto/toro/B-spline) → **4e-0 residui del filetto** → 4e fusione → 4f snap.

**Opzioni di `segment`**: `{ tol, angle, cylinders, spheres, cones, tori, threads, nurbs, snap }`
(`cones/tori/threads/nurbs` attivi se non `false`; `cylinders/spheres` vanno passati `true`; `snap` opzionale).

## 5. Regole (invariate dalla versione precedente)
### Versioning (obbligatorio)
- Versione semantica in `VERSION` (MAJOR.MINOR.PATCH). Aggiornarla a **ogni revisione**, insieme a
  `VERSION` in `src/core.js` e `src/app.js`, `CACHE` in `sw.js`, `<Version>` in `desktop/Mesh2STEP.Desktop.csproj`.
- Intestazione in cima a ogni file sorgente/documento: `Versione: X.Y.Z — AAAA-MM-GG HH:MM` (ora reale, Europe/Rome).
- La build distribuibile ha versione, data e ora nel nome: `dist/mesh2step_vX.Y.Z_AAAAMMGG-HHMM.html` (`node build.mjs`).
- Quando si corregge codice, lasciare la sezione precedente **commentata con la data** della modifica.
  Se un file viene riscritto per intero, la versione precedente va in `archive/<nome>_v<ver>_<AAAAMMGG-HHMM>.<ext>`
  e l'intestazione del nuovo file lo indica.

### Documenti da mantenere aggiornati
- `CONTEXT.md` — scopo, architettura, decisioni, vincoli, problemi aperti.
- `CHANGELOG.md` — una voce numerata per ogni versione (più recente in alto).
- `MANUAL.md` — manuale d'uso e di sviluppo.
- `IMPROVEMENTS.md` — backlog migliorie con stato.
- `README.md` — elenco completo delle funzioni implementate (aggiornarlo a ogni funzione nuova).
- `CLAUDE.md` — aggiornare §2 (stato) e §8 (prossimi passi) a fine sessione.

### Test prima di ogni commit
```
python3 tests/make_samples.py      # rigenera le mesh di prova (trimesh + manifold3d)
node tests/run_core.js             # analisi + export STEP in tests/out
python3 tests/check_step.py        # validazione con OpenCASCADE (OCP): tutti valid=True
node tests/test_repair.js          # riparazione non-manifold (exit 1 se fallisce)
node tests/test_pdf.js             # report PDF: struttura e conteggio fori
node tests/test_selfint.js         # auto-intersezioni: campioni chiusi = 0, due scatole sovrapposte > 0
node tests/test_devthr.js          # deviazione filetti dal cilindro nominale (bolt_m6: ~0,63 mm)
node tests/test_selfrepair.js      # riparazione auto-intersezioni (manifold-3d): due scatole 1844,39, lontane 2000, corpo aperto lasciato
node build.mjs                     # build single-file in dist/
```
Per l'interfaccia: prova nel browser caricamento, analisi, selezione, modifica/annulla, tutti gli export.

### Workflow git (più sessioni lavorano sugli stessi file)
1. `git pull --rebase` prima di committare.
2. Aggiungere **solo i file modificati da questa sessione, per nome** (mai `git add -A` / `git add .`).
3. Messaggio descrittivo (mai "."), poi `git push` subito.
4. Conflitto su un `.md`: unire a mano tenendo entrambe le modifiche (CHANGELOG: entrambe le voci, numerate in ordine).
5. Allineare la copia locale al commit pushato.
- La copia locale sta su **Google Drive**: chiudere eventuali conflitti di sincronizzazione Drive prima di
  operare su `.git` (file "(1)" duplicati = problema di sync, non di git).
- Sessioni cloud senza permesso di push sul repo: consegnare un `git bundle` (`git bundle create x.bundle <ultimo-commit-remoto>..main`);
  l'utente lo applica con `git pull <percorso>\x.bundle main` e poi `git push`.

### Regole di progetto
- Implementazione clean-room: non copiare codice, testi o asset da mesh2solid.thavision.com.
- Nessun upload: tutta l'elaborazione resta nel browser.
- `src/core.js` non deve dipendere dal DOM (gira nel Worker e in Node).
- Nessuna dipendenza di rete a runtime: librerie in `vendor/`.
- I testi dell'interfaccia stanno nel dizionario IT/EN di `src/app.js`; i nuovi errori del core usano chiavi `err.*` tradotte lì.

## 6. Risultati attesi dei test (riferimento per le regressioni)
`python3 tests/check_step.py` dopo `node tests/run_core.js` (tolleranza 0,02):
| STEP | Facce attese | Volume |
|---|---|---|
| plate_hole / plate_hole_3mf | 6 piani + 1 cilindro | 11214,6018 (esatto) |
| countersink | 6 piani + 1 cilindro + 1 cono | 15604,1593 (esatto) |
| turned_shaft | 3 piani + 2 cilindri + 1 cono + 1 toro | 6848,98 |
| block / open_block_riparata | 11 piani + 2 cilindri | 32351,77 |
| rounded_plate | 6 piani + 5 cilindri | 11426,19 |
| dome | 6 piani + 1 sfera | 12841,46 |
| bump | 5 piani + 1 B-spline | 8799,84 |
| vase | 2 piani + 1 B-spline **chiusa** (periodica in angolo) | 27419,14 (mesh 27407,17) |
| vase_bent | 2 piani + 1 B-spline chiusa 24×18 (asse incurvato) | 21105,66 (mesh 21082,44) |
| overlap_pin | 2 solidi sovrapposti (non riparato: 8 piani + 1 cilindro) | 13507,96 (doppio conteggio) |
| overlap_pin_riparata | unione: 1 solido, 8 piani + 2 cilindri | 13005,31 (unione mesh 13003,70) |
| shaft | 7 piani + 1 cilindro | 21924,78 |
| named_parts | 2 solidi "Piastra", "Perno" | 11717,26 |
| bolt_m6 | 3 piani + 1 cilindro + 1 filettatura M6 destra (sfaccettata) | ~756 |
| torus | toro completo → **2 facce toroidali** | 9869,60 (esatto) |
| sphere_full | sfera completa → **2 facce sferiche** | 4188,79 (esatto) |
| bolt_m6_threadcyl | filetto → cilindro nominale: 3 piani + 2 cilindri | ~820,6 |
| open_block | superficie aperta, 0 solidi | — |
Tutti devono essere `valid=True`; `check_step.py` esce con codice 1 altrimenti.

## 7. Insidie note (lezioni apprese)
- **Falsi cilindri**: strisce di sfere, coni, tori ed eliche si adattano a un cilindro entro tolleranza. Per questo
  sfere/tori/coni/filetti vengono **prima** dei cilindri e i cilindri hanno 3 filtri: normali ⟂ asse finale,
  ≥3 orientazioni di facetta, estremità "morbide" valutate separatamente (un raccordo tangente a un capo è lecito).
- **Superfici organiche**: senza il pre-passo B-spline diventano mosaici di cilindri/sfere accidentali.
- **Faccia senza bordi** (sfera/toro completi): `ADVANCED_FACE` richiede ≥1 anello → esportata sfaccettata.
- **Cerchi degli spigoli**: se una catena borda un cilindro/cono coassiale, usare asse e raggio della superficie
  (altrimenti dopo lo snap spigolo e faccia non coincidono).
- **Campioni di test**: profili per `Manifold.revolve` in ordine corretto (un profilo auto-intersecante elimina il
  raccordo); `extrude` con twist positivo = filetto destro; usare tanti strati quanti punti del profilo,
  altrimenti i triangoli diventano zig-zag (vicino più simile > 45°) e nulla viene riconosciuto.
- **3MF di trimesh**: il nome dell'oggetto è `geometry_0` (non è un bug).
- **manifold-3d in un Worker classico / modulo blob**: `import()` dinamico (gli `import` statici non valgono nei worker classici); da un modulo `blob:` serve `locateFile` fittizio oltre a `wasmBinary`. Dopo `new Manifold(...)` controllare `status()`: un guscio aperto o non manifold non si può unire.
- **`desktop/build-desktop.sh`**: nel working tree su Google Drive perde il bit eseguibile (100644); prima di committarlo `git update-index --chmod=+x desktop/build-desktop.sh`, altrimenti la CI (`./desktop/build-desktop.sh`) fallisce.
- **Timestamp**: usare l'ora reale (`Get-Date` / `date`), mai orari stimati.

## 8. Prossimi passi (in ordine di priorità)
Fatti il 2026-10-07 (v1.7.0): riparazione delle auto-intersezioni tra corpi (unione booleana, manifold-3d).
Fatti il 2026-10-07 (v1.6.0): B-spline chiuse anche per tubi incurvati (spina curva, tappi piani staccati).
Fatti il 2026-10-07 (v1.5.1): deviazione dei filetti dal cilindro nominale (freeform = 0 per scelta).
Fatti il 2026-10-07 (v1.5.0): rilevamento auto-intersezioni, B-spline chiuse, pulsante «Converti in STEP» in 3D STL Multipart Maker v0.6.2-beta.
Fatti il 2026-10-07 (v1.4.0): filettature→cilindro nominale, sfere spurie, sfera/toro completi, riparazione non-manifold, report PDF, deviazione B-spline per triangolo.
1. ~~Provare l'exe Windows~~ ✅ fatto il 2026-10-07 (v1.4.1). Restano da provare «Apri con…» / trascinamento sull'exe e un PC senza WebView2.
   apertura file da argomento/trascinamento, download STEP dentro WebView2. Correggere `Program.cs` se serve. (Serve un PC Windows.)
2. ~~Controllare l'esito di `ci.yml`~~ ✅ verde su 1.5.0, 1.5.1, 1.6.0; controllare quello della 1.7.0.
3. ~~Pulsante «Converti in STEP»~~ ✅ fatto nel repo `3d-stl-multipart-maker` (v0.6.2-beta); da provare dal vivo (e dalla sua versione Windows).
4. Auto-intersezioni: ✅ rilevamento (1.5.0) e riparazione tra corpi (1.7.0); resta il guscio ripiegato su se stesso (nessun campione: ancora da costruire).
5. B-spline chiuse ✅ per tubi anche incurvati (1.5.0–1.6.0); restano gusci con poli o rientranze. Deviazione filetti ✅ 1.5.1 (freeform = 0 per scelta).
6. Report PDF su più pagine (oltre ~28 fori le righe vengono troncate con «… (+n)»).
