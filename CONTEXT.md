# CONTEXT — Mesh2STEP
Versione documento: 1.0.0 — 2026-10-05 17:10

## Scopo
Web app che converte mesh triangolari (STL, OBJ, 3MF) in file STEP con **geometria CAD reale**:
piani, cilindri e sfere al posto di migliaia di triangoli, così il pezzo è modificabile in
Fusion 360, SolidWorks, FreeCAD (cambiare Ø dei fori, spostare facce, aggiungere raccordi).

Nasce come replica clean-room di <https://mesh2solid.thavision.com/> (tha:vision), analizzato il 2026-10-05.

## Analisi del sito di riferimento (2026-10-05)
| Aspetto | Mesh2Solid |
|---|---|
| Input / output | STL, 3MF, OBJ → STEP |
| Superfici | piano, cilindro, cono, toro, sfera, filetto, freeform |
| Parametri | tolleranza in mm, toggle per tipo di superficie |
| Architettura | statica; viewer WebGL2 scritto a mano; calcolo in Web Worker con core **Rust → WASM**; nessun upload |
| Licenza | Free (privato, non commerciale) / Pro 12 €/anno: conversione manuale facce, chiusura buchi, selezione/rinomina corpi, "Apri in Fusion" |
| Lingue | DE / EN |
| Telemetria | contatori anonimi via `sendBeacon('./api/hit')` |

## Architettura di Mesh2STEP
```
index.html ── src/app.js (UI + three.js viewer, modulo ES)
                 │ postMessage (buffer trasferiti, zero copie)
                 ▼
             src/worker.js ── src/core.js (parsing, topologia, riconoscimento, STEP)
```
- `core.js` è puro JS senza DOM: gira nel Worker e in Node (test).
- `dist/` contiene la build single-file (worker incorporato come Blob).
- Unica dipendenza runtime: three.js 0.169 da jsDelivr.

## Algoritmo (sintesi)
1. **Saldatura** vertici su griglia 1e-6 × diagonale; scarto triangoli degeneri.
2. **Sfere** (prima dei cilindri): seme con vicini "morbidi", 12 triangoli → fit, poi ri-crescita iterativa
   con vincolo |d−R| ≤ 3·tol e refit; filtro finale a tol; normali devono coprire 2 direzioni.
3. **Cilindri**: seme = coppia adiacente con diedro 0,3°–40°; asse = n₁×n₂, cerchio dai 3 punti proiettati;
   crescita con normale ⟂ asse e vertici entro tol; refit (asse = autovettore minimo di Σ A·nnᵀ).
   Validazione: ≥3 orientazioni di facetta, non planare, estremità non "morbide" (anti-toro).
4. **Piani**: seme = triangolo più grande; crescita per angolo e distanza dal piano.
5. **Freeform**: piani di 1–2 triangoli circondati da zone morbide.
6. **Fusione** di regioni adiacenti con stessa primitiva.
7. **STEP**: spigoli topologici = spigoli mesh tra facce diverse; catene tra vertici "angolo";
   ogni catena → `LINE` / `CIRCLE` / B-spline lineare; anelli orientati dai triangoli (CCW = esterno).

## Decisioni
- Nome diverso ("Mesh2STEP") e codice scritto da zero: nessun asset/codice/testo dell'originale.
- JS invece di Rust/WASM per la v1: più semplice da mantenere; 68k triangoli in < 1 s.
- Tolleranza STEP (`UNCERTAINTY_MEASURE`) = tolleranza di riconoscimento.
- Freeform esportato sfaccettato (un `PLANE` per triangolo): sempre valido, nessuna approssimazione NURBS.

## Limiti noti v1.0.0
- Coni, tori, filettature non riconosciuti (finiscono in freeform/piani).
- Trasformazioni `<build><item transform>` del 3MF ignorate.
- Nessuna riparazione mesh (buchi → STEP superficie aperta).
- three.js da CDN: la build "portabile" richiede comunque internet per il viewer.
