# Mesh2STEP
Versione: 1.3.0 — 2026-10-06 13:45
<!-- [2026-10-06 13:45] Versione precedente 1.0.1 (2026-10-06 13:10): README delle funzioni v1.0
     (piani, cilindri, sfere); aggiornato con tutte le funzioni v1.1–v1.3. -->

Converte mesh **STL / OBJ / 3MF** in **STEP** con geometria CAD reale — piani, cilindri, coni, sfere,
tori e superfici B-spline al posto di migliaia di triangoli — così il pezzo si modifica in Fusion 360,
SolidWorks, FreeCAD (cambiare il Ø di un foro, spostare una faccia, aggiungere raccordi).
Gira interamente nel browser, anche offline: **i file non vengono caricati da nessuna parte**.

**Prova online:** https://chicco83.github.io/mesh2step/ (GitHub Pages: *Settings → Pages → main / root*)

---

## Indice
1. [Funzioni](#funzioni)
2. [Avvio rapido](#avvio-rapido)
3. [Uso](#uso)
4. [Come funziona](#come-funziona)
5. [Risultati dei test](#risultati-dei-test)
6. [Struttura del progetto](#struttura-del-progetto)
7. [Sviluppo e test](#sviluppo-e-test)
8. [Limiti noti](#limiti-noti)
9. [Documentazione](#documentazione)

---

## Funzioni

### Import
| Funzione | Dettagli |
|---|---|
| **STL binario / ASCII** | Binario riconosciuto dalla dimensione esatta; ASCII con nome di ogni `solid` |
| **OBJ** | Indici 1-based e negativi, `v`, `v/vt`, `v/vt/vn`, `v//vn`, poligoni a ventaglio, nomi da `o`/`g` |
| **3MF** | Lettore ZIP interno, più oggetti, **componenti annidati**, **trasformazioni** `build/item` e `component`, **nomi oggetto**, conversione unità in mm |
| **Apertura file** | Pulsante, trascinamento, "Apri con" (PWA installata / app Windows), `?url=`, `postMessage` da altre app |

### Analisi e riparazione della mesh
| Funzione | Dettagli |
|---|---|
| **Saldatura e pulizia** | Vertici su griglia 1e-6 della diagonale, triangoli degeneri scartati |
| **Topologia** | Adiacenze, bordi aperti, spigoli non-manifold, corpi separati |
| **Misure** | Triangoli, dimensioni, volume, area |
| **Chiudi i buchi** | Ear clipping sul piano medio; anelli complanari annidati chiusi come **poligoni con fori** (es. faccia superiore con fori) |

### Riconoscimento superfici
| Superficie | Metodo | Dati |
|---|---|---|
| **Piano** | Crescita dal triangolo più grande (angolo + distanza) | Normale |
| **Cilindro** | Asse da n₁×n₂ poi autovettore minimo di Σ A·n·nᵀ, cerchio ai minimi quadrati + Gauss-Newton | Ø, lunghezza, asse, foro/albero |
| **Cono** | Asse dalle normali, apice ai minimi quadrati, semi-angolo da ρ = h·tanα | Semi-angolo, asse, apice |
| **Sfera** | Fit algebrico + Gauss-Newton, ri-crescita iterativa | Centro, raggio |
| **Toro** | Seme a doppia curvatura, fit Levenberg-Marquardt a 7 parametri | R, r, asse |
| **Filettatura** | Test dell'elica sulle creste, passi ISO, tabella metrica grosso/fine | **M-size**, passo, senso, interna/esterna, Ø esterno e nocciolo |
| **B-spline** | Bicubica 6–12 punti di controllo per lato su zone lisce senza primitive | Griglia di controllo |
| **Freeform** | Zone residue | Triangoli piani |

Controlli di qualità: ordine degli stadi pensato per evitare falsi positivi (strisce di sfere, coni, tori ed eliche
sembrano cilindri), filtri anti-toro, normali ⟂ asse, ≥3 orientazioni di facetta, verifica non-planarità,
piani tangenti ai raccordi riconosciuti, **fusione** di regioni adiacenti uguali.

**Arrotonda a valori nominali** (opzionale): assi e normali su X/Y/Z, Ø a 0,1 / 0,05 / 0,01 mm, semi-angoli a 0,5°,
raggi di toro, cilindri coassiali sulla stessa retta — ogni modifica solo se la mesh resta entro tolleranza.

### Viewer 3D
| Funzione | Dettagli |
|---|---|
| **Colori per tipo** | 8 colori + variazione di tono tra facce adiacenti |
| **Contorni** | Spigoli tra superfici diverse, attivabili |
| **Deviazione** | Heatmap mesh ↔ superficie (verde 0 → rosso ≥ tolleranza) con valore massimo |
| **Viste** | Iso, Alto, Fronte, Destra; **F** = adatta |
| **Picking** | Scheda con tipo, area, Ø, lunghezza, asse, angolo, R/r, passo, scarto massimo |

### Editing (gratis, nell'originale è "Pro")
| Funzione | Dettagli |
|---|---|
| **Selezione** | Singola o multipla (pulsante, Shift/Ctrl+clic) |
| **Converti / unisci** | In piano, cilindro, cono, sfera, toro, B-spline, freeform o *Automatico* con scarto massimo scelto |
| **Annulla** | 20 livelli |
| **Corpi** | Includi/escludi e rinomina; il nome va nello STEP |

### Risultati e report
| Funzione | Dettagli |
|---|---|
| **Legenda** | Conteggi per tipo |
| **Tabella fori** | Per Ø, **passante/cieco**, profondità (fondo piano o punta conica) |
| **Alberi/raccordi** e **filettature** | Tabelle dedicate |
| **Report CSV** | Fori, alberi, coni, filettature con asse e posizione; formato Excel italiano (`;`, virgola) |

### Export
| Formato | Dettagli |
|---|---|
| **STEP AP214** | `PLANE`, `CYLINDRICAL_SURFACE`, `CONICAL_SURFACE`, `SPHERICAL_SURFACE`, `TOROIDAL_SURFACE`, `B_SPLINE_SURFACE_WITH_KNOTS`; spigoli `LINE`, `CIRCLE` (coerenti con cilindri/coni), B-spline lineari; un `MANIFOLD_SOLID_BREP` per corpo con il suo nome; mesh aperte come superficie; facce nominate `HOLE D…`, `SHAFT D…`, `THREAD M…` |
| **STL** | Binario, anche della mesh riparata |
| **OBJ** | Un gruppo per faccia riconosciuta |
| **Condividi STEP** | Web Share API (telefono) |

### Piattaforma
| Funzione | Dettagli |
|---|---|
| **Privacy** | Calcolo locale in un Web Worker, nessun upload |
| **Offline / PWA** | three.js incluso, service worker, installabile, gestione file `.stl/.obj/.3mf` |
| **Build single-file** | `dist/` con versione, data e ora nel nome, completamente offline |
| **App Windows** | Exe portabile WebView2 (`desktop/`), file come argomento |
| **Lingue e tema** | Italiano / inglese, tema chiaro / scuro |
| **Responsive** | Su smartphone vista sopra e pannello sotto |
| **Integrazione** | `postMessage` (`mesh2step:open` / `mesh2step:ready`) e `?url=` |
| **CI** | GitHub Actions: test + validazione OpenCASCADE + build; exe Windows su tag |

---

## Avvio rapido
| Modo | Come |
|---|---|
| Online | https://chicco83.github.io/mesh2step/ |
| Installata | Dalla pagina online → *Installa app* (desktop) o *Aggiungi a schermata Home* (telefono) |
| Portabile | `dist/mesh2step_v1.3.0_20261006-1342.html`, doppio clic |
| Windows | Actions → *desktop* → artifact `Mesh2STEP_v1.3.0_….exe` |
| Locale | `python3 -m http.server` → `http://localhost:8000` |

## Uso
1. **Apri mesh** o trascina il file. Se è aperta, **Chiudi i buchi**.
2. Controlla colori e tabelle; con **Deviazione** vedi dove la superficie si scosta dalla mesh.
3. Correggi con **Modifica facce**, scegli i **Corpi**.
4. **Scarica STEP** e aprilo nel CAD.

Manuale completo: [MANUAL.md](MANUAL.md).

## Come funziona
```
mesh ─► saldatura/topologia ─► filettature ─► B-spline ─► sfere ─► tori ─► coni ─► cilindri ─► piani
                                                                                                   │
STEP ◄─ facce (superficie + anelli) ◄─ spigoli LINE/CIRCLE/B-spline ◄─ snap ◄─ fusione ◄─ freeform ◄┘
```
Dettagli e decisioni: [CONTEXT.md](CONTEXT.md).

## Risultati dei test
STEP generati e riletti con **OpenCASCADE** (kernel di FreeCAD), tutti `valid=True`:

| Mesh di prova | Triangoli | Riconosciuto | Volume STEP |
|---|---|---|---|
| Piastra 40×30×10 con foro Ø10 (STL e 3MF) | 272 | 6 piani + 1 cilindro | 11214,6018 mm³ (esatto) |
| Svasatura 90° su foro Ø6 | 400 | 6 piani + 1 cilindro + 1 cono 45,00° | 15604,1593 mm³ (esatto) |
| Albero tornito: raccordo R3 + smusso | 4 032 | 3 piani + 2 cilindri + 1 cono + 1 toro R9/r3 | 6848,98 mm³ |
| Vite M6×1 su testa Ø10 | 54 972 | filettatura **M6** destra + testa | 756,24 mm³ |
| Piastra con bombatura liscia | 6 912 | 5 piani + 1 B-spline | 8799,84 mm³ |
| Blocco 2 fori Ø6 + tasca | 420 | 11 piani + 2 cilindri passanti | 32351,77 mm³ |
| Stesso blocco aperto → *Chiudi i buchi* | 310 | 11 piani + 2 cilindri | 32351,77 mm³ |
| Piastra con 4 raccordi R5 e foro Ø8 | 464 | 6 piani + 5 cilindri | 11426,19 mm³ |
| Cupola R12 | 1 222 | 6 piani + 1 sfera | 12841,46 mm³ |
| 3MF con 2 oggetti nominati e traslati | 460 | solidi **Piastra** e **Perno** | 11717,26 mm³ |
| Piastra con 100 fori | 205 212 | 6 piani + 100 cilindri in 3,0 s | — |

## Struttura del progetto
```
index.html            pagina dell'app (GitHub Pages) · sw.js · manifest.webmanifest · icons/
src/core.js           parsing, topologia, riconoscimento, editing, riparazione, export STEP (senza DOM)
src/worker.js         Web Worker
src/app.js            interfaccia, viewer, i18n, integrazione
vendor/               three.js 0.169 + OrbitControls (MIT)
build.mjs             build single-file offline in dist/
dist/                 mesh2step_v<versione>_<AAAAMMGG-HHMM>.html
desktop/              app Windows WebView2 (C#/.NET 8) + build-desktop.sh
tests/                make_samples.py · run_core.js · check_step.py · samples/
archive/              versioni precedenti dei file riscritti
.github/workflows/    ci.yml · desktop.yml
```

## Sviluppo e test
```bash
pip install trimesh manifold3d cadquery-ocp
python3 tests/make_samples.py     # mesh di prova (manifold3d)
node tests/run_core.js            # analisi + STEP in tests/out (+ *_riparata.step per mesh aperte)
python3 tests/check_step.py       # validazione OpenCASCADE (exit 1 se uno STEP non è valido)
node build.mjs                    # build portabile
desktop/build-desktop.sh          # exe Windows (serve .NET 8 SDK)
```
Regole di versioning, documentazione e git: [CLAUDE.md](CLAUDE.md).

## Limiti noti
- Filettature esportate sfaccettate (con nome `THREAD M…`), non sostituite dal cilindro nominale.
- B-spline solo per zone tipo "campo di altezze"; superfici organiche che si richiudono restano sfaccettate.
- Sfera o toro completi (senza bordi) esportati sfaccettati.
- Riparazione: solo buchi, non spigoli non-manifold o auto-intersezioni.
- App Windows compilata ma non ancora provata su Windows.

Stato di tutte le migliorie: [IMPROVEMENTS.md](IMPROVEMENTS.md).

## Documentazione
| File | Contenuto |
|---|---|
| [MANUAL.md](MANUAL.md) | Manuale d'uso e di sviluppo |
| [CONTEXT.md](CONTEXT.md) | Scopo, analisi del sito di riferimento, architettura, algoritmo, decisioni |
| [CHANGELOG.md](CHANGELOG.md) | Storico delle versioni |
| [IMPROVEMENTS.md](IMPROVEMENTS.md) | Migliorie e stato |
| [CLAUDE.md](CLAUDE.md) | Istruzioni per le sessioni di sviluppo |

---
Ispirato a mesh2solid.thavision.com; implementazione indipendente (clean-room), nessun codice, testo o asset dell'originale.
three.js © three.js authors, licenza MIT (`vendor/LICENSE-three.txt`).
