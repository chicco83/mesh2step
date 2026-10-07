# CONTEXT — Mesh2STEP
Versione documento: 1.5.1 — 2026-10-07 07:15

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

## Architettura di Mesh2STEP (v1.4.0)
```
index.html ── src/app.js (UI, viewer three.js, i18n, editing, export, API integrazione)
   │             │ postMessage (buffer trasferiti, zero copie)
   │             ▼
   │         src/worker.js ── src/core.js (parsing, topologia, riconoscimento, editing, riparazione, STEP)
   ├─ vendor/  three.js 0.169 + OrbitControls (offline)
   ├─ sw.js + manifest.webmanifest + icons/   (PWA)
   ├─ dist/    build single-file offline (build.mjs)
   └─ desktop/ app Windows WebView2 (C#/.NET 8) con i file web incorporati
```
- `core.js` è puro JS senza DOM: gira nel Worker e in Node (test).
- Nessuna dipendenza di rete a runtime.

## Integrazione con altre app (es. 3D STL Multipart Maker)
- `w = window.open('https://chicco83.github.io/mesh2step/')`; attendere il messaggio `{type:'mesh2step:ready'}`; poi
  `w.postMessage({ type: 'mesh2step:open', name: 'pezzo.stl', buffer: arrayBuffer }, '*')`.
- Oppure `…/mesh2step/?url=<URL del file con CORS>`.
- App Windows: `Mesh2STEP.exe percorso\pezzo.stl`.

## Algoritmo (sintesi, ordine degli stadi)
1. **Saldatura** vertici su griglia 1e-6 × diagonale; scarto triangoli degeneri; nomi sorgente per triangolo.
2. **Pre-passo filettature**: patch lisce (diedri < 25°) ≥ 200 triangoli; test dell'elica sulle creste
   (concentrazione di fase di h − P·θ/2π per i passi ISO); poi tutti i triangoli connessi nella fascia radiale.
3. **Pre-passo B-spline**: patch lisce ≥ 50 triangoli senza grandi zone piane (< 15 %) che nessuna primitiva
   descrive per intero → superficie bicubica (campo di altezze sul piano medio, griglia 6–12, regolarizzata).
4. **Sfere**: seme "morbido", 12 triangoli → fit + Gauss-Newton, ri-crescita a 3·tol e refit, filtro a tol.
5. **Tori**: seme a doppia curvatura (autovalore minimo delle normali > 2e-4), 48 triangoli, fit LM a 7
   parametri inizializzato dai centri del tubo, ri-crescita iterativa.
6. **Coni**: come le sfere; asse dalle normali, apice ai minimi quadrati sui piani delle facette; anti-toro.
7. **Cilindri**: seme su coppia di facette; normali ⟂ asse finale; ≥3 orientazioni; estremità valutate
   separatamente (un capo con raccordo tangente è ammesso).
8. **Piani**, **freeform** (1–2 triangoli in zone morbide), macchie freeform residue → filetto/toro/B-spline.
9. **Fusione** di regioni adiacenti con stessa primitiva; **snap** opzionale ai valori nominali.
10. **STEP**: spigoli topologici tra facce diverse, catene tra vertici "angolo", `LINE` / `CIRCLE` (coerente con
    cilindro/cono adiacente) / B-spline lineare; anelli orientati dai triangoli.

## Decisioni
- Nome diverso ("Mesh2STEP") e codice scritto da zero: nessun asset/codice/testo dell'originale.
- JS invece di Rust/WASM: 205 k triangoli in 3 s, sufficiente (rivalutare oltre 1 M).
- Tolleranza STEP (`UNCERTAINTY_MEASURE`) = tolleranza di riconoscimento.
- Filettature: di default esportate sfaccettate (geometria fedele) con nome faccia `THREAD Mx`. [2026-10-07, v1.4.0] Opzione *cilindro nominale*:
  i vertici del filetto si proiettano **radialmente** su una copia della mesh (i piani ⟂ asse restano piani; le altre regioni toccate
  diventano sfaccettate). Spenta di default perché cambia volume e geometria.
- [2026-10-07, v1.5.0] B-spline chiusa: rete periodica in angolo convertita in bloccata (Boehm) perché OpenCASCADE legge un dominio sbagliato con nodi uniformi non bloccati; prima/ultima riga di controllo coincidenti, nessun spigolo di cucitura esplicito (OCC lo ricostruisce: `valid=True`).
- Regioni chiuse senza bordo: prima sfaccettate (`ADVANCED_FACE` richiede un anello). [2026-10-07, v1.4.0] sfera e toro si dividono con un piano
  per centro/asse in due facce analitiche (emisferi / semi-tubi); altri tipi chiusi restano sfaccettati.
- **Non** fatto, di proposito: riparazione delle auto-intersezioni (richiede booleane robuste; dalla 1.5.0 si **rilevano** e si segnalano); filettatura che sostituisce il cilindro
  nello STEP senza opzione (cambierebbe il volume senza che l'utente lo scelga).
- Editing manuale: le regioni unite devono essere contigue (una faccia = una zona connessa).
- App Windows con WebView2 (stessa scelta di 3D STL Multipart Maker), file web come risorse incorporate. [2026-10-07] I nomi delle risorse si normalizzano (`\` → `/`): `%(RecursiveDir)` dà backslash sui build Windows.

## Limiti noti v1.4.0
- B-spline per zone "campo di altezze" e (1.5.0) superfici chiuse a stella; deviazione di freeform = 0 per scelta (esportati sfaccettati = esatti); filettature: 0 di default, scarto dal cilindro nominale con l'opzione (1.5.1).
- Riparazione: buchi e non-manifold; auto-intersezioni solo rilevate (1.5.0).
- Report PDF su una sola pagina.
- Exe Windows provato (v1.4.1) ma non «Apri con…»/trascinamento né un PC senza WebView2.

## Cronologia delle sessioni
| Data | Sessione | Esito |
|---|---|---|
| 2026-10-05 | Cowork cloud | Analisi del sito di riferimento, v1.0.0 (piani, cilindri, sfere, STEP), commit `729f9ed` caricato dall'utente |
| 2026-10-06 mattina | Cowork cloud | v1.0.1 README completo; v1.1.0–1.3.0 tutte le migliorie (commit `e1e10bb`, `61c8f81`), consegnate come git bundle perché la sessione non poteva fare push; pubblicate dall'utente; Pages verificato online |
| 2026-10-06 14:10 | Cowork cloud | Documentazione per riprendere il lavoro da Claude Code |
| 2026-10-07 | Claude Code (locale) | v1.3.1–1.3.2: colori per tipo, selezione, deviazione B-spline, fix CI, prova UI nel browser integrato. v1.4.0: filettature→cilindro, sfere spurie, sfera/toro completi, non-manifold, report PDF. v1.4.1: primo avvio reale dell'exe su Windows 11 (bug risorse con backslash corretto) |

## Problemi aperti
- App Windows: da provare «Apri con…»/trascinamento sull'exe e l'avvio su un PC senza runtime WebView2.
- Pulsante «Converti in STEP»: fatto nel repo 3D STL Multipart Maker v0.6.2-beta (2026-10-07), non provato dalla versione Windows di quel programma.
- Auto-intersezioni non riparate (solo rilevate).
- B-spline chiuse solo per superfici «a stella» rispetto a un asse.
