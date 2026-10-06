# CHANGELOG — Mesh2STEP
Versione documento: 1.4.0 — 2026-10-07 00:23

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
- Console "An unknown error occurred when fetching the script": viene dalla registrazione del service worker nel **browser integrato** di Claude Code (`navigator.serviceWorker.register('sw.js')` fallisce lì anche con `sw.js` servito 200); l'app la ignora (`.catch`) e funziona. Non riprodotto/verificato in Chrome normale: da controllare lì se il PWA offline serve.
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
