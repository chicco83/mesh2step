# CONTEXT — Mesh2STEP
Versione documento: 1.13.2 — 2026-10-22 11:17

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
- [2026-10-07, v1.7.0] Riparazione auto-intersezioni con **manifold-3d in `vendor/`** (Apache-2.0, WebAssembly, caricato con `import()` dinamico nel Worker classico alla prima richiesta). Scelta: una booleana scritta a mano non sarebbe robusta; la libreria è locale, quindi nessuna dipendenza di rete. Il core riceve il modulo per iniezione (resta senza DOM e senza import). In `dist` il modulo e il wasm sono incorporati nel Worker; `locateFile` fittizio perché `new URL(..., import.meta.url)` non è valido in un modulo blob.
- [2026-10-07, v1.6.0] Spina curva: polinomio cubico dei baricentri delle fasce (non poligonale: il rumore rovina la parametrizzazione), θ nel piano ⟂ asse (non ⟂ tangente: meno uniforme), controllo di iniettività al posto di «normale radiale»; i tappi piani si staccano in 4-0 (`tryPeeled`).
- [2026-10-07, v1.5.0] B-spline chiusa: rete periodica in angolo convertita in bloccata (Boehm) perché OpenCASCADE legge un dominio sbagliato con nodi uniformi non bloccati; prima/ultima riga di controllo coincidenti, nessun spigolo di cucitura esplicito (OCC lo ricostruisce: `valid=True`).
- Regioni chiuse senza bordo: prima sfaccettate (`ADVANCED_FACE` richiede un anello). [2026-10-07, v1.4.0] sfera e toro si dividono con un piano
  per centro/asse in due facce analitiche (emisferi / semi-tubi); altri tipi chiusi restano sfaccettati.
- **Non** fatto, di proposito: riparazione di auto-intersezioni DENTRO un guscio (dalla 1.5.0 si rilevano, dalla 1.7.0 si riparano solo quelle tra corpi, unendoli); filettatura che sostituisce il cilindro
  nello STEP senza opzione (cambierebbe il volume senza che l'utente lo scelga).
- Editing manuale: le regioni unite devono essere contigue (una faccia = una zona connessa).
- App Windows con WebView2 (stessa scelta di 3D STL Multipart Maker), file web come risorse incorporate. [2026-10-07] I nomi delle risorse si normalizzano (`\` → `/`): `%(RecursiveDir)` dà backslash sui build Windows.

## Limiti noti v1.4.0
- B-spline per zone "campo di altezze" e (1.5.0–1.6.0) superfici chiuse tubolari (spina curva, parametrizzazione (θ, z) iniettiva); deviazione di freeform = 0 per scelta (esportati sfaccettati = esatti); filettature: 0 di default, scarto dal cilindro nominale con l'opzione (1.5.1).
- Riparazione: buchi, non-manifold, auto-intersezioni tra corpi (unione con manifold-3d, 1.7.0); non quelle dentro un solo guscio.
- Report PDF su una sola pagina.
- Exe Windows provato (v1.4.1) ma non «Apri con…»/trascinamento né un PC senza WebView2.

## Cronologia delle sessioni
| Data | Sessione | Esito |
|---|---|---|
| 2026-10-05 | Cowork cloud | Analisi del sito di riferimento, v1.0.0 (piani, cilindri, sfere, STEP), commit `729f9ed` caricato dall'utente |
| 2026-10-06 mattina | Cowork cloud | v1.0.1 README completo; v1.1.0–1.3.0 tutte le migliorie (commit `e1e10bb`, `61c8f81`), consegnate come git bundle perché la sessione non poteva fare push; pubblicate dall'utente; Pages verificato online |
| 2026-10-06 14:10 | Cowork cloud | Documentazione per riprendere il lavoro da Claude Code |
| 2026-10-22 | Claude Code (cloud) | v1.13.1: trovata la causa delle facce mal ritagliate (pcurve approssimate da OCC sulle polilinee lunghe) → catene di LINE con PCURVE esplicite accanto ai piani; Plenum validato 2 277 facce (tol 0,01) / 1 933 (0,02), volume −0,8/−0,9% |
| 2026-10-21 | Claude Code (cloud) | v1.13.0: OpenCASCADE (replicad-opencascadejs) nel Worker, «STEP validato» con ripiego per regione; Plenum valido (volume +0,28%) ma 3 669 facce; scoperte facce valide ma mal ritagliate (volume −15%) |
| 2026-10-21 | Claude Code (cloud) | v1.12.0: port in JS di `simplecad/surfaces/fit.py` (MIT) come `segmentSimpleCAD` sperimentale; risultati peggiori del motore Mesh2STEP senza la parte OpenCASCADE |
| 2026-10-21 | Claude Code (cloud) | v1.11.2: analisi di SimpleCAD (addon FreeCAD); bordi portati sulle superfici; Plenum 8 → 5 facce non valide |
| 2026-10-21 | Claude Code (cloud) | v1.11.1: indagine STEP non validi (cerchi falsi, B-spline tra i vertici, assorbimento senza rifit): scoop valido, Plenum 49 → 8 facce non valide. symplecad non accessibile |
| 2026-10-21 | Claude Code (cloud) | v1.11.0: file reale dell'utente (Plenum, 22 394 triangoli): stadio 4d-bis patch B-spline, filettature ≥ 2,5 giri, tolleranza automatica più veloce; STEP organici non validi in OCC (noto) |
| 2026-10-21 | Claude Code (cloud) | v1.10.0: tolleranza automatica e robustezza al rumore (troppi triangoli mantenuti) |
| 2026-10-09 | Claude Code (cloud) | v1.9.0: **Verifica STEP** nell'app (`verifyStep`, comando Worker `verify`, `tests/test_verify.js`) |
| 2026-10-08 | Claude Code (cloud) | v1.8.0: confronto con il sito di riferimento (nuove funzioni: modifica fori, verifica STEP); implementata la **modifica foro** (`resizeHole`, comando Worker `hole`, Annulla con mesh); corretto bug di mutazione in `editRegions` |
| 2026-10-07 | Claude Code (locale) | v1.3.1–1.3.2: colori per tipo, selezione, deviazione B-spline, fix CI, prova UI nel browser integrato. v1.4.0: filettature→cilindro, sfere spurie, sfera/toro completi, non-manifold, report PDF. v1.4.1: primo avvio reale dell'exe su Windows 11 (bug risorse con backslash corretto) |

## Analisi di SimpleCAD (2026-10-21)
Addon FreeCAD (https://github.com/igsova/SimpleCAD, MIT, v0.38, ~32 000 righe Python): modellazione diretta su solidi e mesh STL; «Make mesh editable» converte la mesh in Part.
Pipeline (`simplecad/mesh/conversion.py`): pulizia (duplicati, degeneri, non-manifold rifiutati) → **saldatura entro la tolleranza** (semi greedy, rifiutata se rende la mesh non-manifold) → per componente: cilindri analitici (`curved.reconstruct_cylinder`) → superfici adattate (`surfaces.reconstruct`: piani, cilindri, B-spline) → altrimenti regioni piane + fori circolari impressi → altrimenti triangoli; ogni passo validato con OCC (`isValid`, `fix`) e ripiego al passo più semplice; cavità annidate sottratte; `removeSplitter` per unire piani complanari.
Punto chiave (`surfaces._chain_points`): ogni catena di bordo condivisa viene campionata e ogni punto va a **metà tra le proiezioni sulle due superfici** (dentro metà del loro scarto), oppure sull'**intersezione** (proiezioni alternate) se lo spigolo è vivo; le estremità restano condivise; i bordi lisci vengono lisciati nello spazio dei parametri. Gli archi richiedono ≥ 5 punti; un cerchio chiuso attorno a un cilindro è coassiale e parte dalla cucitura.
Differenze: SimpleCAD lavora dentro FreeCAD con OpenCASCADE (può validare e riparare), Mesh2STEP scrive lo STEP a mano nel browser (nessuna validazione B-rep a runtime: solo `verifyStep`).
Adottato in 1.11.2: proiezione dei bordi sulle superfici (solo tra superfici analitiche) e suddivisione dei segmenti che si staccano. 1.12.0: port completo di `fit.py` (`segmentSimpleCAD`, sezione 6 di core.js, sperimentale). La parte che rende validi i risultati di SimpleCAD è quella FreeCAD/OpenCASCADE (`mesh/surfaces.py`: facce ritagliate, validazione, ripiego): nel browser servirebbe opencascade.js.

## Problemi aperti
<!-- [2026-10-22 v1.13.1] voce precedente:
- **Facce valide ma ritagliate male** (1.13.0): sul Plenum 25 regioni hanno area OCC diversa dai loro triangoli pur con bordi che OCC legge entro 0,1 mm dalla mesh (es. piano: anello esterno 1 427,9 mm² in OCC contro 1 200,3 dai vertici). Il ripiego le rende corrette a triangoli; la causa va trovata per tornare a poche facce.
-->
- **Facce valide ma ritagliate male** (1.13.0, causa trovata in 1.13.1): una polilinea lunga scritta come una sola B-spline di grado 1, senza PCURVE, costringe OpenCASCADE ad approssimare la curva 2D della faccia, e l'approssimazione smussa gli angoli. Ora accanto ai piani e alle facce a triangoli il bordo è una catena di LINE con PCURVE esplicite. Resta il caso B-spline–B-spline (lì le rette corte rendevano gli anelli 2D non chiusi): quelle regioni finiscono ancora a triangoli nel ripiego. Serve una PCURVE vera sulle B-spline, con proiezione inversa.
- **STEP organici non validi in OpenCASCADE**: dopo la 1.11.2 restano 5 facce su ~540 nel file Plenum (4 B-spline, 1 sfera). `scoop` risolto. Idee: PCURVE esplicite, ripiego per faccia ai triangoli.
- Modifica foro (1.8.0): la «filettatura» è foro di maschiatura + etichetta, non elica; da valutare un campione con foro cieco/punta conica. «Verifica STEP» (1.9.0) è un controllo leggero, non sostituisce OpenCASCADE.
- App Windows: da provare «Apri con…»/trascinamento sull'exe e l'avvio su un PC senza runtime WebView2.
- Pulsante «Converti in STEP»: fatto nel repo 3D STL Multipart Maker v0.6.2-beta (2026-10-07), non provato dalla versione Windows di quel programma.
- Auto-intersezioni dentro un solo guscio non riparate (tra corpi sì, 1.7.0).
- B-spline chiuse solo per superfici tubolari con parametrizzazione (θ, z) iniettiva (non poli né rientranze).
