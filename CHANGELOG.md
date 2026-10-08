# CHANGELOG — Mesh2STEP
Versione documento: 1.8.0 — 2026-10-08 23:35

## 16. [1.8.0] — 2026-10-08 23:35 — Modifica foro (diametro, M2–M16)
Ispirata alla funzione «Modifica dei fori» del sito di riferimento (solo l'idea: implementazione propria, clean-room).
- **Pannello «Modifica foro»** (nella sezione Modifica facce, compare selezionando un foro cilindrico o un filetto interno): modo *Foro di gioco* (ISO 273 serie media: M6 → Ø6,6), *Foro di maschiatura* (M6 → Ø5), *Filettatura* (maschiatura + etichetta `THREAD Mx` sulla faccia STEP; **non** elica reale) o *Diametro libero*; misure M2–M16; anteprima «Ø attuale → nuovo Ø».
- Core: `resizeHole(M, seg, id, mode, size, dia)`, `holeTarget`, `HOLE_SIZES`. I vertici del foro vengono spostati radialmente (i piani ⟂ asse restano piani), la mesh è ricostruita con lo stesso ordine dei triangoli e si rifittano il foro (cilindro esatto) e le regioni vicine toccate (coni di svasatura ecc., altrimenti sfaccettate). Le altre regioni, e le modifiche manuali già fatte, restano.
- Controlli: errore `err.holeCollision` se un triangolo vicino si ribalta (foro oltre il materiale), se aumentano le auto-intersezioni o cambia il numero di triangoli/corpi; `err.notHole` se la faccia non è un foro.
- Worker: comando `hole {region, mode, size, dia}` (non `id`: è l'id della richiesta); **Annulla** ripristina anche la mesh precedente (la cronologia ora contiene voci `{hole, seg, M}`).
- **Bug corretto** in `editRegions`: rinumerare gli id mutava le regioni dello stato precedente (compromettendo Annulla); ora le regioni sono copiate.
- Test: `tests/test_hole.js` (plate_hole → Ø6,6 / 5 / 6,8 / 4,2 con 6 piani + 1 cilindro e volume atteso, collisione, countersink con cono rifittato) e STEP `plate_hole_*.step`, `countersink_tap.step` `valid=True` con OpenCASCADE; in CI. Provato nel browser (Playwright): selezione foro, applica, Annulla, console pulita.
- Limiti: non genera filetti elicoidali; il foro vicino a bordi sottili può essere rifiutato; i campioni non hanno ancora un caso di foro cieco con punta conica.
- Rollback: `git revert` del commit.

## 15. [1.7.0] — 2026-10-07 22:10 — Riparazione delle auto-intersezioni (unione booleana)
- **Pulsante «Ripara auto-intersezioni (unisci i corpi)»**, visibile quando il rilevamento (1.5.0) trova coppie di triangoli che si tagliano.
  Ogni corpo chiuso e manifold diventa un `Manifold` ([manifold-3d](https://github.com/elalish/manifold) in WebAssembly, Apache-2.0, `vendor/manifold.js` + `manifold.wasm`,
  ~620 KB, caricato nel Worker solo alla prima riparazione) e i corpi vengono **uniti con una booleana robusta**: parti sovrapposte → un solo corpo.
  Corpi aperti/non-manifold restano com'erano. Il risultato è verificato (`findSelfIntersections` dopo l'unione): se restano intersezioni
  (guscio ripiegato su se stesso: **non risolto**) la mesh non viene modificata e si avvisa.
- `repairSelfIntersections(M, wasm)` nel core (il modulo wasm è iniettato: il core resta senza dipendenze); comando `repairSelf` del Worker.
- Campione `overlap_pin.stl` (perno che attraversa una piastra, due shell sovrapposte): 260 coppie → 0, volume 13003,70 (unione), STEP `_riparata`
  = 1 solido, 8 piani + 2 cilindri, `valid=True`, volume 13005,31 (il cilindro analitico è un po' più grande del poligono a 64 lati); l'STEP non riparato ha 2 solidi sovrapposti (volume 13507,96 contati doppi).
- Build single-file: modulo e wasm incorporati nel Worker (testo + base64, `dist` 1,7 MB); provato via HTTP, **non** da `file://`.
  App Windows: i due file sono copiati da `build-desktop.ps1/.sh` e `.wasm` ha il suo MIME in `Program.cs`. Service worker: i due file sono nella cache.
- Limiti: i nomi dei corpi uniti si perdono; l'unione cancella la separazione dei corpi (è lo scopo, ma se i corpi dovevano restare distinti non usarla).
- Test: `tests/test_selfrepair.js` (due scatole: 1844,39 = 2000 − 155,61; scatole lontane; corpo aperto lasciato) e `run_core.js` scrive `<nome>_riparata.step`; in CI.
- Rollback: `git revert` del commit; senza il pulsante restano il rilevamento e l'avviso della 1.5.0.

## 14. [1.6.0] — 2026-10-07 22:00 — B-spline chiuse anche per tubi incurvati
- `fitBSplineClosed` non richiede più un asse dritto: la **spina** (centro delle sezioni a z costante) è un polinomio cubico fitto ai
  baricentri di 24 fasce; θ si misura attorno a `c(z)` nel piano ⟂ asse, il parametro lungo il tubo è l'ascissa curvilinea della spina.
  Assi candidati: autovettore delle normali e i 3 assi principali dei vertici (con tubi molto incurvati le normali danno un asse sbagliato).
- Controllo «a stella» sostituito da un test di **iniettività** della parametrizzazione (θ, z): ogni triangolo deve avere area con segno
  costante nel piano dei parametri (il vecchio «normale ⟂ asse > 0,25» era falso sulle pareti ripide); il segno dà `outward`.
- Nuova rete massima 24 × 18 (prima 20 × 14).
- **Tappi piani nella stessa patch** (su una parete ripida il diedro con il tappo è < 25°): nello stadio 4-0, se la patch non si adatta,
  si tolgono i gruppi complanari > 5% dell'area e si prova la B-spline chiusa sul resto (componente più grande); i tappi restano ai piani.
- Nuovo campione `vase_bent.stl` (vaso con asse incurvato, fino a 20 mm): **prima 4 104 facce, ora 3** (1 B-spline chiusa 24 × 18 + 2 piani),
  `valid=True`, volume 21105,66 (mesh 21082,44; +0,11% = errore di fit 0,017 mm × area).
- `vase.stl`: volume 27419,14 (era 27409,90; mesh 27407,17): stessa topologia, fit leggermente diverso con la nuova parametrizzazione.
- Provato e scartato (lasciato nel codice commentato): riferimento trasportato lungo la tangente della spina (θ nel piano ⟂ T) — parametrizzazione
  troppo non uniforme, 0,045 mm anche con 24 × 26; spina poligonale dei baricentri — il rumore dava 0,18 mm sul vaso dritto.
- Ancora sfaccettati: gusci chiusi con poli o rientranze (non iniettivi in θ, z), superfici chiuse in entrambe le direzioni (genus ≥ 1 organico).
- Rollback: `git revert` del commit; i tubi dritti tornano al comportamento 1.5.x, quelli curvi a sfaccettati.

## 13. [1.5.1] — 2026-10-07 07:15 — Deviazione dei filetti dal cilindro nominale
- `deviation` restituisce anche `devThr`/`maxThr`: come `dev`, ma i triangoli del **filetto** sono confrontati con il cilindro nominale
  (esterno: Ø ISO o cresta; interno: fondo del foro), lo stesso dell'opzione STEP *Filettature come cilindro nominale*.
  Con quella casella spuntata la mappa **Deviazione** usa `devThr` (e il massimo in legenda): `bolt_m6` passa da max 0,0000 a 0,63 mm sul filetto.
  Senza l'opzione la mappa resta com'era: il filetto esportato sfaccettato è esatto (0).
- **Freeform**: deviazione resta 0 **per scelta**: sono esportati sfaccettati (esatti) e non hanno una superficie di riferimento da confrontare. Non riproporre.
- Worker: `devThr` e `devThrMax` nel risultato. Test: `tests/test_devthr.js` (in CI). Provato in locale nell'interfaccia (bolt_m6).
- Rollback: `git revert` del commit; l'export STEP non cambia.

## 12. [1.5.0] — 2026-10-07 01:03 — Auto-intersezioni (rilevamento) e B-spline chiuse
- **Rilevamento auto-intersezioni** (`findSelfIntersections`): test segmento-triangolo (Möller-Trumbore, interno stretto) con griglia
  uniforme; salta i triangoli che condividono vertici; budget 4 s (risultato `partial`). Il Worker lo calcola al caricamento: riga
  *Auto-intersezioni* nelle informazioni e avviso nella barra di stato. **Solo rilevamento**: la riparazione richiede booleane robuste
  sulla mesh (scelta di non farla, vedi `IMPROVEMENTS.md`). Test: `tests/test_selfint.js` (i campioni chiusi: 0; due scatole sovrapposte: >0), in CI.
- **B-spline per superfici che si richiudono** (`fitBSplineClosed`): tubo/vaso/guscio liscio «a stella» rispetto a un asse → B-spline cubica
  **periodica in angolo** × bloccata in z, minimi quadrati sulle 3 coordinate dei punti di controllo (nu fino a 20, nv fino a 14).
  In STEP la rete periodica è convertita in B-spline bloccata con inserimento di nodi, `U_CLOSED=.T.`, senso della faccia dal segno della
  componente radiale delle normali. Usata in 4-0, nei blob 4d e in *Converti/unisci → B-spline/Automatico*.
- Nuovo campione `vase.stl` (rivoluzione con profilo ondulato schiacciata in X): **prima 3 583 facce (mosaico di cilindri/sfere/freeform), ora 3 facce**
  (1 B-spline chiusa + 2 piani), `valid=True`, volume 27409,90 (mesh 27407,17). Gli altri 16 STEP invariati.
- Il pannello della faccia mostra «nu × nv (chiusa)». Il riassunto del Worker porta `nv` e `closedU`.
- Rollback: `git revert` del commit; senza `fitBSplineClosed` le superfici chiuse tornano sfaccettate/mosaico come in 1.4.1.

## 11. [1.4.1] — 2026-10-07 00:40 — App Windows: risorse nelle sottocartelle (primo avvio reale su Windows)
- **Bug trovato provando l'exe su Windows**: la finestra si apriva ma restava vuota/non inizializzata: `index.html` e `manifest` si caricavano,
  ma `src/*`, `vendor/*`, `icons/*` davano 404. Causa: sui build Windows (GitHub `windows-latest`) `%(RecursiveDir)` del csproj produce
  `www/src\app.js` (backslash), mentre `Program.cs` cercava `www/src/app.js`; sul build Linux funzionava, per questo non era emerso.
- Fix in `desktop/Program.cs`: dizionario dei nomi di risorsa normalizzati (`\` → `/`).
- Provato (exe 1.4.0, prima del fix) con debug remoto WebView2: avvio, apertura file da argomento (`?url=` → `/open/<nome>` servito: 200, 2,7 MB).
- Rollback: `git revert` del commit.

## 10. [1.4.0] — 2026-10-07 00:23 — Filettature, sfere/tori, non-manifold, PDF, deviazione
- **Filettature → cilindro nominale** (opzione *Filettature come cilindro nominale (STEP)*, default **spenta**): i vertici del filetto
  sono proiettati radialmente sul raggio nominale (esterno: Ø ISO o cresta; interno: fondo del foro) su una **copia** della mesh;
  le regioni vicine toccate diventano sfaccettate tranne i piani ⟂ asse. `bolt_m6_threadcyl.step`: 3 piani + 2 cilindri, `valid=True`, volume 820,58.
- **Residui del filetto**: il pre-passo 4-00 inglobava i triangoli ⟂ asse del tappo (39 tri a z=18) → ora esclusi; nuovo stadio 4e-0
  assorbe nel filetto le piccole regioni (sfere/coni/tori/freeform/piani inclinati < 100 tri) adiacenti e dentro la sua fascia.
  `bolt_m6`: da 15 piani + 8 sfere + 11 freeform a **3 piani + 1 cilindro + 1 filetto**.
- **Sfera e toro completi** → due facce analitiche (emisferi / semi-tubi) invece di migliaia di triangoli:
  `torus.step` = 2 `TOROIDAL_SURFACE`, volume 9869,60 (esatto, prima 9729,41); nuovo campione `sphere_full.stl` = 2 `SPHERICAL_SURFACE`, volume 4188,79 (esatto).
- **Riparazione non-manifold** (`fixNonManifold`): duplicati e coppie schiena-a-schiena, alette su spigoli con >2 triangoli;
  il pulsante *Ripara* compare anche con spigoli non-manifold. Test: `tests/test_repair.js`. **Auto-intersezioni: non trattate.**
- **Report PDF** con disegno quotato dei fori (vista lungo l'asse dei fori più frequente, fori numerati, quote d'ingombro, tabelle
  fori/filettature/alberi), scritto a mano senza librerie. Test: `tests/test_pdf.js`.
- **Deviazione B-spline per triangolo** (scarto verticale dei vertici dalla superficie) al posto del solo massimo della regione.
- Il comando `step` del worker accetta `threadCyl`; nuovo comando `pdf`.
- Console "An unknown error occurred when fetching the script": succede solo su `http://localhost` nel **browser integrato** di Claude Code (la registrazione del service worker fallisce lì); su Pages (https) il service worker è attivo (cache `mesh2step-1.4.0`) e la console è pulita. Provato il 2026-10-07.
- Rollback: `git revert` del commit di questa versione; l'opzione filettature è spenta di default, quindi l'export STEP standard non cambia per le filettature.

## 9. [1.3.2] — 2026-10-06 21:46 — Deviazione B-spline e colore di selezione (tema chiaro)
- Mappa di deviazione: le regioni B-spline risultavano sempre a 0 (`devTri` non veniva mai impostato) e quindi tutte verdi.
  Ora usano lo scarto massimo del fit della regione (per `bump`: 0,0022 mm). Provato nel browser.
- Selezione nel tema chiaro: blu `#1f3bff` al posto del quasi nero (nascondeva l'ombreggiatura).
- Provati nel browser: tema chiaro, modalità deviazione, export STEP/STL/OBJ. Test core + OCP: 14 STEP valid=True.
- Rollback: `git revert` del commit.

## 8. [1.3.1 · CI] — 2026-10-06 20:40 — Fix workflow ci.yml
- La CI falliva in «Mesh di prova»: mancava `networkx` (export 3MF di trimesh); aggiunti anche `numpy` e `lxml`.
- Stesse dipendenze aggiunte in `CLAUDE.md` §3. Rollback: `git revert` del commit.

## 7. [1.3.1] — 2026-10-06 20:32 — Viewer: colori, selezione, navigazione
- Colori delle facce **solo per tipo** (come in legenda): tolta la variazione casuale per regione.
- Colore di selezione bianco (tema scuro) / quasi nero (chiaro): non si confonde più con toro/giallo/scala deviazione.
- Dopo un'unione/modifica la faccia risultante **non resta più selezionata**.
- Suggerimento di navigazione sul viewer (ruota/sposta/zoom/seleziona) e mappatura esplicita dei pulsanti del mouse.
- Rollback: `git revert` del commit di questa versione.

## 6. [1.3.0 · documentazione] — 2026-10-06 14:10 — Ripresa del lavoro da Claude Code
Codice dell'app invariato (resta 1.3.0, commit `61c8f81`).
- `CLAUDE.md` riscritto: stato del progetto, ambiente (Windows/PowerShell), mappa del codice e ordine degli stadi,
  risultati attesi dei test, insidie note, prossimi passi in ordine di priorità.
- `CONTEXT.md`: cronologia delle sessioni e problemi aperti.
- `IMPROVEMENTS.md`, `MANUAL.md`, `README.md`: allineati (script PowerShell, prossimi passi).
- Aggiunto `desktop/build-desktop.ps1` (build dell'exe da PowerShell senza Git Bash).

## 5. [1.3.0] — 2026-10-06 13:45 — Piattaforma
**Aggiunto**
- **PWA offline**: three.js 0.169 incluso in `vendor/` (niente CDN), `manifest.webmanifest`, `sw.js` (cache app shell), icone; installabile su desktop e telefono; apre `.stl/.obj/.3mf` dal sistema (File Handling API).
- **Build single-file completamente offline**: `dist/mesh2step_v1.3.0_20261006-1342.html` con three.js incorporato (moduli Blob).
- **App Windows portabile** (`desktop/`): finestra nativa WebView2 in C#/.NET 8, file web incorporati nell'exe, apertura file da riga di comando / "Apri con". Exe singolo self-contained `Mesh2STEP_v1.3.0_<data>.exe` (compilato e verificato in build, non ancora provato su Windows).
- **API di integrazione** (per 3D STL Multipart Maker o altre app): `postMessage({type:'mesh2step:open', name, buffer})`, parametro `?url=`, messaggio `mesh2step:ready` all'opener.
- **CI GitHub Actions**: `ci.yml` (mesh di prova → analisi → validazione OpenCASCADE → build, artifact) e `desktop.yml` (exe Windows; allegato alla release sui tag `v*`).

**Valutato e non fatto**
- Core in Rust/WASM: non necessario ora (205 k triangoli in 3,0 s, 55 k triangoli di filettatura in 2,8 s in Node).

## 4. [1.2.0] — 2026-10-06 13:40 — Interfaccia
**Aggiunto**
- **Editing facce**: selezione singola o multipla (toggle, Shift/Ctrl+clic), conversione in piano/cilindro/cono/sfera/toro/B-spline/freeform o unione automatica, scarto massimo accettato, **Annulla** (20 livelli).
- **Corpi**: elenco con includi/escludi e rinomina; il nome va nel `MANIFOLD_SOLID_BREP` dello STEP.
- **Report CSV** di fori (Ø, profondità, passante/cieco, asse, posizione), alberi, coni, filettature; separatore `;` e virgola decimale in italiano.
- **Export STL** binario (anche della mesh riparata) e **OBJ** con un gruppo per faccia riconosciuta.
- **Heatmap di deviazione** mesh ↔ superficie con legenda (verde 0 → rosso ≥ tolleranza).
- **Viste** Iso / Alto / Fronte / Destra, contorni on/off.
- **Interfaccia IT/EN** e **tema chiaro/scuro** (preferenze ricordate nel browser).
- **Condividi STEP** (Web Share API, su telefono).
- Pulsante **Chiudi i buchi** per mesh aperte.
- Tabella fori con passante/cieco e profondità; tabella filettature.

**Modificato**
- `src/app.js`, `src/worker.js`, `index.html`, `build.mjs` riscritti; versioni precedenti in `archive/`.

## 3. [1.1.0] — 2026-10-06 13:30 — Riconoscimento e STEP
**Aggiunto**
- **Coni** (smussi, svasature): asse dalle normali, apice ai minimi quadrati, `CONICAL_SURFACE`.
- **Tori** (raccordi su spigoli circolari): crescita da semi a doppia curvatura, fit Levenberg-Marquardt a 7 parametri, `TOROIDAL_SURFACE`.
- **Filettature**: patch elicoidali, passo per concentrazione di fase delle creste, tabella ISO metrica (grosso e fine), interna/esterna, destra/sinistra; facce chiamate `THREAD M6` nello STEP.
- **B-spline** bicubiche (campo di altezze, 6–12 punti di controllo per lato) per zone organiche lisce: `B_SPLINE_SURFACE_WITH_KNOTS`.
- **Snap ai valori nominali** (opzionale): normali e assi sugli assi globali, Ø a 0,1/0,05/0,01 mm, semi-angoli a 0,5°, raggi di toro, cilindri coassiali sulla stessa retta; ogni modifica accettata solo entro tolleranza.
- **Spigoli circolari coerenti** con cilindri e coni adiacenti (stesso asse e raggio).
- **Riparazione**: chiusura buchi con ear clipping, anelli complanari annidati come poligoni con fori.
- **Fori passanti/ciechi** e profondità (fondo piano o punta conica).
- **Nomi dei corpi** da 3MF (`name`), OBJ (`o`/`g`), STL ASCII (`solid`); **3MF**: componenti annidati e trasformazioni `build/item` e `component`.
- Regioni chiuse senza bordo (sfera/toro completi) esportate sfaccettate (una faccia STEP richiede un anello).
- Facce cilindriche chiamate `HOLE D…` / `SHAFT D…` nello STEP.

**Verificato**: 13 mesh di prova + riparazione, tutte `valid=True` in OpenCASCADE; volumi esatti su svasatura (15604,16 mm³) e blocco riparato.

## 2. [1.0.1] — 2026-10-06 13:10
**Documentazione**
- README completo: elenco di tutte le funzioni (import, analisi, riconoscimento, viewer, misure, parametri, export STEP, piattaforma), avvio rapido, algoritmo, tabella risultati test, struttura, limiti.
- Build rigenerata: `dist/mesh2step_v1.0.1_20261006-1310.html` (codice invariato salvo numero di versione).

## 1. [1.0.0] — 2026-10-05 17:10
Prima versione, replica clean-room delle funzioni gratuite di mesh2solid.thavision.com.

**Aggiunto**
- Import STL (binario/ASCII), OBJ, 3MF (lettore ZIP nativo con `DecompressionStream`, unità 3MF convertite in mm).
- Topologia: saldatura vertici, adiacenze, conteggio bordi aperti / non-manifold, corpi separati, volume.
- Riconoscimento: sfere → cilindri → piani → freeform, con region growing e fitting ai minimi quadrati
  (raffinamento Gauss-Newton per cerchi e sfere), fusione di regioni adiacenti con la stessa primitiva,
  filtro anti "falsi cilindri" su strisce di tori/superfici libere.
- Export STEP AP214: `PLANE`, `CYLINDRICAL_SURFACE`, `SPHERICAL_SURFACE`; spigoli `LINE`, `CIRCLE`,
  B-spline grado 1; un `MANIFOLD_SOLID_BREP` per corpo chiuso, `SHELL_BASED_SURFACE_MODEL` per mesh aperte.
- Viewer three.js con colori per tipo di superficie, contorni delle facce, picking con dettagli (Ø, asse, scarto).
- Tabella cilindri raggruppata per diametro (fori vs alberi/raccordi) — non presente nell'originale.
- Tolleranza suggerita automaticamente dalla dimensione del pezzo e analisi automatica al caricamento.
- Layout responsive per smartphone.
- Build single-file portabile `dist/mesh2step_v1.0.0_20261005-1710.html`.
- Test: generatore mesh (manifold3d), runner Node, validazione STEP con OpenCASCADE.

**Verificato**
- 9 mesh di prova + 1 mesh da 68k triangoli: tutti gli STEP `valid=True` in OCCT;
  volume STEP = volume analitico (es. piastra con foro: 11214,6018 mm³ = 12000 − π·5²·10).
