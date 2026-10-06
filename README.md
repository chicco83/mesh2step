# Mesh2STEP
Versione: 1.0.1 — 2026-10-06 13:10
<!-- [2026-10-06 13:10] Versione precedente 1.0.0 (2026-10-05 17:10): README sintetico con
     tabella di 3 esempi e link ai documenti; sostituito da README completo con tutte le funzioni. -->

Converte mesh **STL / OBJ / 3MF** in **STEP** con geometria CAD reale: piani, cilindri e sfere
al posto di migliaia di triangoli, così il pezzo si modifica in Fusion 360, SolidWorks, FreeCAD
(cambiare il Ø di un foro, spostare una faccia, aggiungere raccordi).
Gira interamente nel browser: **i file non vengono caricati da nessuna parte**.

**Prova online:** https://chicco83.github.io/mesh2step/ (richiede GitHub Pages attivo: *Settings → Pages → main / root*)

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
| **STL binario** | Riconosciuto dalla dimensione esatta del file (84 + 50 × n byte); normali ricalcolate dai vertici |
| **STL ASCII** | Lettura di tutte le righe `vertex x y z` |
| **OBJ** | Indici 1-based e negativi, formati `v`, `v/vt`, `v/vt/vn`, `v//vn`; poligoni triangolati a ventaglio |
| **3MF** | Lettore ZIP interno (store + deflate tramite `DecompressionStream` nativo), più oggetti/mesh per file, conversione unità (`micron`, `millimeter`, `centimeter`, `inch`, `foot`, `meter`) in mm |
| **Apertura file** | Pulsante *Apri mesh* oppure trascinamento in qualsiasi punto della finestra |

### Analisi della mesh
| Funzione | Dettagli |
|---|---|
| **Saldatura vertici** | Griglia di quantizzazione a 1e-6 della diagonale del pezzo |
| **Pulizia** | Scarto dei triangoli degeneri (vertici coincidenti) |
| **Topologia** | Adiacenze tra triangoli, conteggio bordi aperti e spigoli non-manifold |
| **Corpi** | Componenti connesse: ogni corpo separato diventa un solido distinto nello STEP |
| **Misure** | Numero triangoli, dimensioni del bounding box, volume (teorema della divergenza), area |
| **Controllo chiusura** | Mesh chiusa → solido; mesh aperta → avviso e superficie |

### Riconoscimento superfici
| Superficie | Metodo | Dati ricavati |
|---|---|---|
| **Sfera** | Seme su zona curva, fit algebrico + raffinamento Gauss-Newton, ri-crescita iterativa con refit | Centro, raggio, verso (calotta o cavità), scarto massimo |
| **Cilindro** | Seme su coppia di facette, asse = n₁ × n₂ poi autovettore minimo di Σ A·n·nᵀ, cerchio ai minimi quadrati sui vertici proiettati | Asse, Ø, lunghezza, foro o albero, scarto massimo |
| **Piano** | Crescita dal triangolo più grande con vincolo di angolo e distanza | Normale, origine |
| **Freeform** | Zone che non rientrano nelle primitive | Esportate come facce piane triangolari |

Controlli di qualità sul riconoscimento:
- **Ordine sfere → cilindri → piani**: evita che strisce di sfera vengano scambiate per cilindri.
- **Filtro anti-falsi cilindri**: scarta strisce di tori o superfici libere che proseguono curvando alle estremità.
- **Verifica non-planarità** e **almeno 3 orientazioni di facetta** prima di accettare un cilindro.
- **Piani tangenti** a raccordi cilindrici riconosciuti correttamente come piani (non freeform).
- **Fusione automatica** di regioni adiacenti con la stessa primitiva (stesso piano, stesso asse e raggio, stesso centro e raggio).

### Viewer 3D
| Funzione | Dettagli |
|---|---|
| **Colori per tipo** | Piano blu-grigio · cilindro verde acqua · sfera arancio · freeform viola · grigio = non analizzato; leggera variazione di tono tra facce adiacenti |
| **Contorni delle facce** | Linee sugli spigoli tra superfici riconosciute diverse |
| **Navigazione** | Trascina = ruota · rotella/pizzica = zoom · tasto destro o Shift+trascina = sposta · **F** = adatta alla vista |
| **Picking** | Clic su una faccia: evidenziazione e scheda con tipo, triangoli, area, Ø, lunghezza, asse, centro, normale, scarto massimo |
| **Indicatore di lavoro** | Spinner durante lettura, analisi ed export |

### Risultati e misure
| Funzione | Dettagli |
|---|---|
| **Legenda con conteggi** | Numero di piani, cilindri, sfere e triangoli freeform |
| **Tabella cilindri** | Raggruppati per diametro e per tipo (*Foro* / *Albero o raccordo*) con quantità |
| **Avvisi** | Mesh aperta; oltre metà superficie freeform → suggerimento di aumentare la tolleranza |

### Parametri
| Parametro | Default | Effetto |
|---|---|---|
| **Tolleranza (mm)** | Suggerita automaticamente: diagonale × 1e-4, tra 0,01 e 0,2 | Distanza massima dei vertici dalla superficie riconosciuta; usata anche come tolleranza del file STEP |
| **Angolo (°)** | 1 | Scostamento massimo delle normali per piani e cilindri |
| **Cilindri / Sfere** | Attivi | Disattivabili per forzare il risultato in piani o freeform |

L'analisi parte **automaticamente** al caricamento con la tolleranza suggerita; *Analizza mesh* la ripete con i parametri modificati.

### Export STEP
| Funzione | Dettagli |
|---|---|
| **Formato** | ISO 10303-21, schema AP214 (`AUTOMOTIVE_DESIGN`), unità mm |
| **Superfici** | `PLANE`, `CYLINDRICAL_SURFACE`, `SPHERICAL_SURFACE` |
| **Spigoli** | `LINE` per tratti rettilinei, `CIRCLE` per cerchi e archi (es. bordo di un foro), B-spline di grado 1 negli altri casi |
| **Topologia** | Spigoli e vertici condivisi tra facce adiacenti, anelli orientati, bordo esterno e fori per le facce piane |
| **Solidi** | Un `MANIFOLD_SOLID_BREP` per corpo chiuso, nominati *Body1*, *Body2*… |
| **Mesh aperte** | `SHELL_BASED_SURFACE_MODEL` (superficie) |
| **Nome file** | Uguale alla mesh, estensione `.step` |
| **Riepilogo** | Dopo il salvataggio: numero facce, spigoli circolari e rettilinei, solidi |

### Interfaccia e piattaforma
| Funzione | Dettagli |
|---|---|
| **Privacy** | Nessun upload: calcolo in locale in un Web Worker (l'interfaccia resta reattiva) |
| **Responsive** | Su smartphone vista 3D sopra e pannello sotto |
| **Build portabile** | Un solo file HTML in `dist/`, con versione, data e ora nel nome; si apre con doppio clic |
| **Lingua** | Italiano |
| **Dipendenze** | Solo three.js 0.169 da CDN (jsDelivr) |

---

## Avvio rapido
| Modo | Come |
|---|---|
| Online | https://chicco83.github.io/mesh2step/ |
| Portabile | Scarica `dist/mesh2step_v1.0.1_20261006-1310.html` e aprilo nel browser (serve internet solo per three.js) |
| Locale | `python3 -m http.server` nella cartella del progetto → `http://localhost:8000` |

## Uso
1. **Apri mesh** o trascina il file nella finestra.
2. Controlla il pannello *File*: triangoli, corpi, dimensioni, chiusura, volume.
3. Guarda i colori: le zone viola resteranno sfaccettate. Se sono troppe, aumenta la tolleranza e premi **Analizza mesh**.
4. Tocca una faccia per verificarne Ø e scarto.
5. **Scarica STEP** e apri il file nel CAD.

Le mesh migliori sono quelle esportate da CAD (Printables, Thingiverse, MakerWorld). Scansioni e modelli scolpiti diventano quasi tutti freeform.

## Come funziona
```
mesh ──► saldatura + topologia ──► sfere ──► cilindri ──► piani ──► freeform ──► fusione regioni
                                                                                     │
STEP ◄── facce (superficie + anelli) ◄── geometria spigoli (LINE/CIRCLE/B-spline) ◄── catene di spigoli
```
- Gli **spigoli topologici** sono gli spigoli della mesh che separano facce diverse.
- Vengono concatenati tra vertici "angolo" (dove cambiano le facce confinanti): ogni catena diventa un solo spigolo STEP.
- Ogni catena è classificata come retta, cerchio/arco (se complanare e a raggio costante) o polilinea.
- L'orientamento delle facce segue quello dei triangoli: normale uscente dal materiale.

Dettagli dell'algoritmo e decisioni di progetto: [CONTEXT.md](CONTEXT.md).

## Risultati dei test
STEP generati e riletti con **OpenCASCADE** (lo stesso kernel di FreeCAD):

| Mesh di prova | Triangoli | Riconosciuto | B-rep valido | Volume STEP |
|---|---|---|---|---|
| Piastra 40×30×10 con foro Ø10 | 272 | 6 piani + 1 cilindro | ✅ | 11214,6018 mm³ (= 12000 − π·5²·10, esatto) |
| Stessa piastra in 3MF | 272 | 6 piani + 1 cilindro | ✅ | 11214,6018 mm³ |
| Albero Ø20 su base | 300 | 7 piani + 1 cilindro | ✅ | 21924,78 mm³ |
| Blocco con 2 fori Ø6 e tasca | 420 | 11 piani + 2 cilindri | ✅ | 32351,77 mm³ |
| Piastra con 4 raccordi R5 e foro Ø8 | 464 | 6 piani + 5 cilindri | ✅ | 11426,19 mm³ |
| Cupola R12 su base | 1 222 | 6 piani + 1 sfera | ✅ | 12841,46 mm³ |
| Blocco aperto (faccia mancante) | 310 | 9 piani + 2 cilindri | ✅ superficie | — |
| Toro (OBJ) | 2 304 | freeform | ✅ | 9729,41 mm³ |
| Piastra con 25 fori + sfera | 68 256 | 6 piani + 25 cilindri + 2 sfere | ✅ | analisi < 1 s |

## Struttura del progetto
```
index.html        pagina dell'app (GitHub Pages)
src/core.js       parsing, topologia, riconoscimento, export STEP (senza DOM: Worker e Node)
src/worker.js     Web Worker: comandi load / analyse / step
src/app.js        interfaccia e viewer three.js
build.mjs         crea la build single-file in dist/
dist/             mesh2step_v<versione>_<AAAAMMGG-HHMM>.html
tests/            make_samples.py · run_core.js · check_step.py · samples/
VERSION           versione corrente
```

## Sviluppo e test
```bash
pip install trimesh manifold3d cadquery-ocp
python3 tests/make_samples.py     # genera le mesh di prova
node tests/run_core.js            # analisi + STEP in tests/out
python3 tests/check_step.py       # validazione OpenCASCADE (esce con 1 se uno STEP non è valido)
node build.mjs                    # build portabile in dist/
```
Regole di versioning, documentazione e git: [CLAUDE.md](CLAUDE.md).

## Limiti noti
- Coni, tori e filettature non sono ancora riconosciuti (diventano piani o freeform).
- Le zone freeform restano sfaccettate (nessuna superficie NURBS).
- Le trasformazioni `build/item` dei file 3MF sono ignorate.
- Nessuna riparazione della mesh: i buchi producono una superficie, non un solido.
- La build portabile richiede internet per caricare three.js.

Roadmap e priorità: [IMPROVEMENTS.md](IMPROVEMENTS.md).

## Documentazione
| File | Contenuto |
|---|---|
| [MANUAL.md](MANUAL.md) | Manuale d'uso e di sviluppo |
| [CONTEXT.md](CONTEXT.md) | Scopo, analisi del sito di riferimento, architettura, algoritmo, decisioni |
| [CHANGELOG.md](CHANGELOG.md) | Storico delle versioni |
| [IMPROVEMENTS.md](IMPROVEMENTS.md) | Migliorie proposte |
| [CLAUDE.md](CLAUDE.md) | Istruzioni per le sessioni di sviluppo |

---
Ispirato a mesh2solid.thavision.com; implementazione indipendente (clean-room), nessun codice, testo o asset dell'originale.
