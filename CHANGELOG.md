# CHANGELOG — Mesh2STEP
Versione documento: 1.13.1 — 2026-10-22 09:19

## 24. [1.13.1] — 2026-10-22 09:19 — Trovata la causa delle facce «ritagliate male»
- **Causa**: i bordi lunghi fatti di pochi punti erano scritti come una sola B-spline di grado 1 (polilinea). Lo STEP non conteneva la curva 2D della faccia (PCURVE), quindi OpenCASCADE la ricavava per approssimazione e **smussava gli angoli** del bordo. Sul Plenum un piano con bordo 3D di 1 199,9 mm² diventava una faccia di 1 427,9 mm² (volume −15%).
- **Correzione**: le polilinee accanto a un piano o a una regione a triangoli diventano **una catena di spigoli rettilinei** (LINE), con vertici intermedi condivisi dalle due facce. Ogni spigolo ha la sua **PCURVE esplicita** (retta 2D) sui piani e sulle facce a triangoli: la proiezione di una retta su un piano è esatta. Origine del piano: baricentro dei vertici (minimi quadrati). Opzioni del core: `pcurves: false` e `polylineEdges: true` per tornare al comportamento precedente.
- **Ripiego più completo** (`facetRegionsAt`):
  - una faccia a triangoli uniti (gruppo complanare) che resta non valida viene esportata un triangolo per faccia (`singleTris`);
  - se anche il triangolo singolo resta non valido, passano a triangoli le regioni analitiche adiacenti, perché il difetto sta nello spigolo condiviso.
- I punti intermedi più vicini di tol/4 vengono tolti dalla catena di rette: un segmento di circa 0,002 mm diventava uno spigolo chiuso su un solo vertice.
- **Risultati sul Plenum con «STEP validato»**:

  | Tolleranza | Esportazione semplice | STEP validato | Volume validato |
  |---|---|---|---|
  | 0,01 | 237 facce, 8 non valide, volume −1,8% | **valido, 2 277 facce** | 49 957 (−0,8%) |
  | 0,02 | 289 facce, 3 non valide, volume −1,2% | **valido, 1 933 facce** | 49 929 (−0,9%) |

  Il volume della mesh è 50 378. La 1.13.0 dava 3 669 facce validate (+0,28%) e −15% di volume nell'esportazione semplice.
- **Campioni**: 28/28 validi; scoop 6 692,14 (era 6 614,98), vase 27 431,05 (era 27 419,14), gli altri invariati.
- **Provato e scartato**:
  - Spezzare in rette tutte le polilinee: le facce B-spline vicine diventavano NotClosed (scoop non valido).
  - Spezzarle anche quando i segmenti sono lunghi (media > diag/50 o diag/200): Plenum 2 984 facce invece di 3 034, ma scoop non valido.
  - PCURVE sulle B-spline (proiezione nei nodi): anelli 2D non chiusi in 28 facce del Plenum. Ora sono disattivate, si riattivano con l'opzione `bsplinePcurves`.
  - Confronto del contributo al volume invece dell'area: più rumoroso.
- **Diagnosi** (script `inv.py`, non nel repo, con OCP in Python): per ogni faccia non valida stampa il tipo, l'area e il riquadro, poi per ogni anello `ShapeAnalysis_Wire(wire, face, 1e-4)` (`CheckClosed`, `CheckGaps3d`, `CheckGaps2d`), i vertici e la tolleranza di ogni spigolo (`BRep_Tool.Tolerance_s`). Uno spigolo chiuso su un vertice con tolleranza > 0 è il segno di un buco 2D chiuso dal lettore.
- **Riprovato dopo il rilascio** (`bsplinePcurves: true` con la suddivisione attuale, Plenum tol 0,01): peggiora (5 giri, 3 778 facce, 1 non valida). Resta disattivato; serve una proiezione inversa vera, non verticale. CI GitHub verde sul push 1.13.1.
- **Limite**: restano a triangoli le regioni B-spline accanto ad altre B-spline e alcune sfere. Lì la polilinea resta tale e OpenCASCADE ricava ancora la pcurve. Il passo successivo sono PCURVE corrette sulle B-spline: proiezione inversa vera, non verticale.

## 23. [1.13.0] — 2026-10-21 22:59 — OpenCASCADE nel browser: STEP validato con ripiego per regione (come SimpleCAD)
- **OpenCASCADE in WebAssembly**: `vendor/replicad_single.js` + `.wasm` (replicad-opencascadejs 1.1.0, LGPL-2.1, ~23 MB invece dei 66 MB di opencascade.js), caricati nel Worker solo alla prima richiesta e poi tenuti nella cache del service worker. Non inclusi nella build a file singolo (`dist/`): lì il comando risponde con un messaggio.
- **Pulsante «STEP validato (OpenCASCADE)»** (Export): esporta, legge lo STEP con `STEPControl_Reader`, controlla forma e facce con `BRepCheck_Analyzer`, misura area di ogni faccia e volume. Le regioni con facce **non valide** o con **area diversa da quella dei loro triangoli** (> 2%: facce valide ma ritagliate male) vengono esportate a triangoli e si ricontrolla (max 4 giri). È il ripiego di SimpleCAD, ma per singola regione invece che per componente. Riquadro con i giri e download dello STEP finale.
- Core: `occCheckStep(oc, text)`, `stepValidated(M, seg, oc, opts)`, `facetRegionsAt` (attribuzione delle facce OCC alle regioni con punti presi dentro la faccia: centri dei triangoli della sua tessellazione, triangolo di mesh più vicino per distanza punto-triangolo; con i vertici della faccia o il centro dei triangoli l'attribuzione sbagliava).
- **Facce sfaccettate**: i triangoli complanari connessi di una regione a triangoli diventano una sola faccia piana e le schegge (triangoli degeneri) si uniscono alla faccia oltre il lato lungo (come `settle_slivers` di SimpleCAD): una scheggia da sola era una faccia non valida. bolt_m6: 54 579 → 54 531 facce.
- **Bordi**: lo spostamento verso le superfici (`between`) accettato solo se ≤ 2·tol.
- **Risultato sul file Plenum**: prima 414 facce, 5 non valide e soprattutto **volume −15%** (25 regioni con facce valide ma ritagliate male, scoperte grazie al controllo d'area). Con «STEP validato»: **valido per OpenCASCADE, volume 50 518 contro 50 380 della mesh (+0,28%)**, ma **3 669 facce** (36 regioni a triangoli), ~106 s in Node. Campioni: plate_hole e countersink validi al primo giro; scoop valido dopo 6 regioni a triangoli (volume da −1,5% a +0,4%).
- Test: `tests/test_occ.mjs` (in CI). Provato nel browser (Playwright): plate_hole 3 s, Plenum ~57 s, console pulita.
- Limiti: la causa delle facce ritagliate male (area OCC ≠ area dei triangoli con bordi giusti) non è trovata: il ripiego le rende corrette ma a triangoli. App Windows: i file OpenCASCADE sono copiati da `build-desktop.ps1/.sh` (exe più grande di ~23 MB; non provato).

## 22. [1.12.0] — 2026-10-21 21:49 — Port dell'adattatore di superfici di SimpleCAD (sperimentale)
- **`segmentSimpleCAD(M, {tol, cylinders})`** in `src/core.js` (sezione 6): traduzione in JavaScript di `simplecad/surfaces/fit.py` (SimpleCAD 0.38.0, MIT; avviso in `THIRD_PARTY_NOTICES.md` e nell'intestazione della sezione): regioni tra spigoli vivi (≥ 30°) con normali in prestito per le schegge; un cilindro se segue tutta la regione (asse = direzione evitata dalle normali, raggio a metà tra punto più lontano e più vicino, tutto entro ¾ tol); altrimenti parti entro 60° dalla propria normale (k-means sferico + assorbimento dei frammenti); per ogni parte piano (tol/4) o campo di altezze B-spline cubico con **nodi non uniformi raffittiti dove serve**, vincolato su vertici (tol/2, bordo tol/4) e su **campioni lungo gli spigoli e dentro i triangoli** (tol, bordo tol/2), con seconda soluzione che segue la prima fila di triangoli vicini; divisione delle patch che non si adattano (pieghe ≥ 8°, poi direzione delle facce, poi a metà) fino al singolo triangolo; `tidy` e `settle_slivers`.
- Export: B-spline con nodi non uniformi (`r.ub`/`r.vb`).
- Differenze dal Python: algebra densa (massimo 12 span per direzione invece di 48), niente raffinamento non lineare dell'asse del cilindro, la parte FreeCAD (costruzione delle facce con OpenCASCADE, validazione e ripiego) **non è portabile** nel browser senza OpenCASCADE.
- **Risultati del port** (per questo resta sperimentale, solo API, non nell'interfaccia): plate_hole 7 facce e bump 6 facce come il motore Mesh2STEP; dome 113 facce (cupola spezzata in 107 B-spline per il limite di 12 span), scoop 346 facce; rounded_plate 19 facce con volume OpenCASCADE 10 628 contro 11 426 (−7%: facce piane ritagliate male, causa non trovata); file Plenum 1 192 facce e 7 facce non valide (motore Mesh2STEP: 414 facce, 6 non valide).
- Provato e scartato: archi solo con ≥ 5 punti come in SimpleCAD (Plenum: una faccia non valida in più).
- Test: `tests/test_simplecad.js` (plate_hole 6 piani + 1 cilindro, bump 5 piani + 1 B-spline, `verifyStep`), in CI. 28/28 STEP dei campioni ancora validi con il motore predefinito.
- Prossimo passo proposto: usare OpenCASCADE nel browser (opencascade.js, WebAssembly) per costruire e validare le facce come fa SimpleCAD in FreeCAD, con ripiego per faccia.

## 21. [1.11.2] — 2026-10-21 20:51 — Bordi portati sulle superfici (idea da SimpleCAD) e analisi di SimpleCAD
**SimpleCAD** (https://github.com/igsova/SimpleCAD, addon FreeCAD, licenza MIT, v0.38): modellazione diretta «alla SketchUp» con conversione mesh → CAD (`simplecad/mesh/conversion.py`, `surfaces.py`, `curved.py`, `planar.py`). Idee rilevanti per noi (dettagli in CONTEXT.md):
ogni bordo condiviso diventa **una curva che sta su entrambe le superfici vicine** (punti a metà tra le due proiezioni, sull'intersezione se lo spigolo è vivo); saldatura dei vertici entro la tolleranza (via le schegge micrometriche); ogni superficie si adatta anche alla prima fila di triangoli della vicina; validazione con OpenCASCADE e ripiego a facce piane/triangoli se fallisce; archi solo con ≥ 5 punti; cavità annidate sottratte; unione dei piani complanari (`removeSplitter`).
- **Adottato** (implementazione propria in JS): proiezione di un punto su ogni superficie (`projOn`: piano, cilindro, sfera, cono, toro, B-spline con `proj`); le polilinee di bordo tra superfici analitiche vengono suddivise e spostate sul bordo comune (`between`: proiezioni alternate verso l'intersezione, altrimenti metà strada; accettato solo se avvicina il punto a entrambe le superfici). Accanto alle B-spline solo suddivisione dei segmenti la cui corda si stacca di oltre tol/2 (spostare lì peggiorava). Le LINE devono stare anche sulle superfici vicine.
- **Provato e scartato**: proiezione Gauss-Newton sul punto più vicino della B-spline (divergeva fuori dominio); spostamento dei punti anche accanto alle B-spline (Plenum 25 facce non valide contro 4); suddivisione di tutti i segmenti accanto alle B-spline (volumi di vase/scoop spostati dello 0,5–3%).
- Frammenti da ≤ 4 triangoli anche di sfere/cilindri/coni/tori (e assorbiti anche nelle B-spline vicine, con scarto `dist`).
- Risultati: file Plenum **8 → 5 facce non valide** su ~540 (414 facce in Mesh2STEP, tolleranza automatica 0,102); il volume letto da OCC di uno shell non valido non è affidabile (oscilla tra −15% e +1% tra le varianti). Campioni: 28/28 validi; `scoop` 6 614,98 (era 6 651,96; mesh 6 713,78), gli altri invariati.
- Limite: restano 4 facce B-spline e 1 sferica non valide sul Plenum. Prossimo passo indicato: PCURVE esplicite (curve 2D nello spazio dei parametri della faccia) nello STEP, o ripiego per faccia ai triangoli quando il bordo si stacca dalla superficie.

## 20. [1.11.1] — 2026-10-21 19:26 — Indagine sugli STEP non validi: tre cause trovate e corrette
Diagnosi con OpenCASCADE (`BRepCheck_Face`, `BRepCheck_Wire`, `ShapeAnalysis_Wire`, tolleranze degli spigoli dopo la lettura): le facce non valide avevano spigoli con tolleranza allargata dal lettore fino a decine di mm, cioè spigoli lontani dalla superficie della faccia.
- **Cerchi falsi** sui bordi delle superfici libere: bastavano 4 punti complanari entro tol da un cerchio. Nascevano cerchi interi per anelli sottili «andata e ritorno» (R 77 mm per un anello lungo 3,9 mm) e archi nel verso sbagliato. Ora l'arco deve avere angoli crescenti (passo < 90°), giro di 360° se chiuso e, se nessuna faccia vicina è un cilindro/sfera/cono di quel raggio, freccia di ogni corda ≤ tol.
- **Patch B-spline che si scostano tra i vertici**: l'adattamento controllava solo i vertici; con triangoli lunghi la superficie si allontanava di millimetri lungo gli spigoli. Ora `fitBSpline` usa anche punti interni agli spigoli lunghi (fino a 8 per spigolo) e il dominio ha un margine del 10% (era 2%: la proiezione dei vertici di bordo usciva dal dominio).
- **Assorbimento senza rifit**: i frammenti assorbiti in una patch potevano stare a 2–4·tol dalla superficie (che non veniva rifittata). Ora soglia tol e rifit della patch; se il rifit non sta in tolleranza l'assorbimento si annulla. L'incertezza dello STEP vale max(tol, 1,2 × scarto massimo delle B-spline).
- Anche: successore canonico negli anelli di bordo (si gira attorno al vertice dentro la faccia: nessuno scambio di pezzi tra anelli nei vertici «a farfalla»); due catene con gli stessi estremi non diventano entrambe LINE (faccia degenere); sfere/cilindri con corde lontane (> max(3·tol, 3% R)) sono candidati alle patch.
- Risultati: **`scoop.step` ora valido** (era in `tests/known_invalid.txt`, ora vuoto): 28/28 STEP validi. File Plenum dell'utente: facce non valide **49 → 8** su ~540 (427 facce in Mesh2STEP, tolleranza automatica 0,102). **Non ancora valido**: restano 5 facce B-spline e 3 sferiche; volume OCC 44 180 contro 50 380 della mesh (−12%). Causa residua: sfere/patch con triangoli molto lunghi (corde a 13 mm dalla superficie su una «sfera» R 97). Provato e scartato: trasformarle in freeform (427 → 1 911 facce per 3 facce in meno).
- Variazioni nei campioni: `bump` volume 8 800,11 (era 8 799,84) per il nuovo margine del dominio; gli altri invariati.
- Progetto `Igsova/symplecad`: non accessibile da questa sessione (GitHub risponde 404 / clone con credenziali: privato o nome diverso), non analizzato.

## 19. [1.11.0] — 2026-10-21 18:27 — Superfici libere: patch B-spline al posto di mosaici di quadriche (file «80mm MI_XX GPU Fan Plenum»)
Il file dell'utente (staffa/condotto da 22 394 triangoli: flangia con fori, pareti piane, testo in rilievo e una «scoop» curva con triangoli lunghi e sottili) con i valori predefiniti dava **4 529 facce** (tolleranza 0,017): la scoop diventava centinaia di sfere e cilindri di raggio enorme (R fino a 2 758 mm su regioni di pochi mm) e di freeform triangolo per triangolo.
- **Stadio 4d-bis: patch B-spline** (`segment`). Regioni «deboli» = freeform, quadriche con R > 4× la loro estensione, piccoli piani incastrati, e catene di ≥ 4 quadriche confinanti con diedri < 30° e **raggi variabili** (max/min > 1,8: una catena di raccordi CAD ha raggi uguali e resta com'è). Si uniscono regioni intere in ordine di adiacenza e si controlla l'adattamento a campo di altezze (scarto ≤ tol) a 3, 6, 12, 24… regioni, con bisezione al primo fallimento. Seconda passata a 2·tol sulle sole freeform rimaste. Assorbimento dei frammenti (≤ 150 triangoli) entro 2·tol dalla patch.
- **Filettature**: servono almeno 2,5 giri (prima 1,5): un'onda lenta di una superficie libera veniva scambiata per un filetto (Ø10 P5) e sfaccettata (179 facce).
- **Tolleranza automatica** più veloce: salto ×3 se resta oltre il 3% di triangoli sciolti, ×2 altrimenti, al massimo un gradino dopo essere «quasi pulita», 5 analisi al massimo.
- **STEP**: le facce non piane con più anelli (e le B-spline aperte) scelgono l'anello esterno (perimetro / area proiettata).
- Risultati: file dell'utente con tolleranza automatica **4 529 → 590 facce** (tolleranza usata 0,051; 142 B-spline, 126 piani, 34 cilindri; ~45 s in Node). Nuovo campione `scoop.stl` (mezza tromba a guscio, 14 548 triangoli): 144 → 55 facce (38 B-spline). Tutti gli altri campioni invariati (conteggi di facce e volumi come prima).
- **Limite noto (non risolto)**: lo STEP di queste parti organiche **non è valido per OpenCASCADE** (BRepCheck): sul file dell'utente 49 facce su 473 (47 B-spline), volume 57 241 contro 50 380 della mesh; prima della 1.11.0 lo stesso file era invalido in modo peggiore (volume 1,2×10^11). Su `scoop` 6 facce su 92, volume +1,5% (prima 4 321 contro 6 714). Cause scartate: tolleranza di incertezza, verso della superficie, punti a farfalla, patch con un solo anello. `scoop.step` è in `tests/known_invalid.txt` (non fa fallire `check_step.py`). Da indagare: pcurve/anelli delle facce con più anelli su superfici B-spline.
- Test: `tests/test_autotol.js` (scoop: ≤ 80 facce, ≥ 5 B-spline); 28 STEP, 27 validi + `scoop` noto. Il file dell'utente non è nel repository.
- Rollback: `git revert` del commit; senza lo stadio 4d-bis restano le soglie di 1.10.0.

## 18. [1.10.0] — 2026-10-21 14:15 — Meno triangoli, più superfici: tolleranza automatica e robustezza al rumore
Richiesta: «vengono mantenuti troppi triangoli invece di creare superfici». Causa trovata: il riconoscimento era tarato su mesh CAD esatte; su mesh con rumore sui vertici (scansioni, float32, rimesh) o con tessellazione più grossolana della tolleranza (il campo parte da 0,01 mm) piani e cilindri si frantumavano in centinaia di regioni da 1–2 triangoli, ciascuna una faccia STEP.
- **Tolleranza automatica** (casella, attiva di default): `segmentAuto` analizza con la tolleranza scelta e, se restano triangoli sfaccettati (freeform, o piani da ≤ 2 triangoli se sono > 10% della mesh), la alza a gradini ×1,5 ×2,5 ×4 ×8 (mai oltre lo 0,4% della diagonale) tenendo il tentativo migliore; mesh pulite = una sola passata. La tolleranza usata è mostrata nello stato e diventa quella dell'export STEP. `dome.stl` a 0,01 mm: 902 regioni → 7 facce; `vase_bent`: 4393 → 3.
- **Soglia d'angolo da rumore**: la normale di un triangolo piccolo con vertici spostati di ±tol può inclinarsi di atan(2·tol/altezza); `tiltSin/tiltCos` per triangolo (max(angolo, rumore), tetto 15°) nella crescita di piani e cilindri.
- **Piani**: il piano di crescita si rifitta a 4, 8, 16… triangoli (prima restava quello del solo triangolo seme: con rumore ogni triangolo diventava una faccia); soglia 2·tol sotto 16 triangoli.
- **Cilindri**: asse iniziale da una toppa di 12 triangoli (autovettore delle normali) invece di cross(n1,n2) di soli due; soglia 3·tol sotto 24 triangoli.
- **Tori**: un cilindro (adattamento robusto che scarta i triangoli lontani) o un piano che spiega la regione vince sul toro: prima un foro rumoroso diventava un toro R15/r11.
- **Fusione e assorbimento**: oltre ai parametri uguali, due regioni adiacenti si fondono se la primitiva rifittata sull'unione resta entro tol (piano, cilindro, sfera); i frammenti di ≤ 4 triangoli (piano/freeform) a ≤ 1,5·tol da una regione analitica vicina vengono assorbiti.
- Test: nuovi campioni `noisy_plate.stl` (σ 0,01) e `noisy_fillet.stl` (σ 0,03) in `make_samples.py`; `tests/test_autotol.js` (senza auto 27 e 555 facce; con auto 7 e 27; mesh pulite invariate) in CI; `run_core.js` usa `autoTol`; 27 STEP `valid=True` (OpenCASCADE); tutti gli altri test invariati; `test_selfint.js` ignora `noisy_*` (il rumore crea piccole piegature). Provato nel browser (Playwright) con e senza la casella.
- Limiti: con rumore forte la tolleranza finale sale (σ 0,03 → 0,08 mm) e le caratteristiche più piccole del rumore si perdono; l'auto fa fino a 5 analisi (vase_bent ~22 s dal 0,01 iniziale); il rumore non elimina le piegature della mesh.
- Rollback: togliere la casella (`autoTol` falso) ripristina il comportamento di prima per la tolleranza; le altre modifiche (soglie, fusione) sono nel commit e si annullano con `git revert`.

## 17. [1.9.0] — 2026-10-09 09:53 — Verifica STEP nell'app
Ispirata alla «Verifica STEP» del sito di riferimento (solo l'idea; implementazione propria).
- **Pulsante «Verifica STEP»** (sezione Export): esporta lo STEP con le opzioni correnti e ne controlla il testo senza scaricarlo; l'esito va nella barra di stato e in un riquadro con gli eventuali problemi.
- Core: `verifyStep(text)` → `{ok, errors, warnings, counts, entities, dangling}`. Controlli: intestazione/chiusura/ENDSEC/DATA, id unici, riferimenti `#n` risolti, numeri finiti, anelli `EDGE_LOOP` continui e chiusi, ogni faccia con almeno un bordo, ogni `CLOSED_SHELL` con spigoli usati due volte con verso opposto (`OPEN_SHELL`: bordo aperto solo come avviso).
- Worker: comando `verify {opts}`; messaggi `step.*` tradotti IT/EN.
- **Limite dichiarato**: è un controllo leggero, non sostituisce OpenCASCADE (`tests/check_step.py`) né l'apertura in un CAD.
- Test: `tests/test_verify.js` (tutti i 25 STEP di `tests/out` passano; 4 corruzioni — riferimento mancante, spigolo orientato rimosso, NaN, file troncato — vengono rilevate); in CI. Nel browser (Playwright): plate_hole ok (7 facce), open_block con avviso di bordo aperto, bolt_m6 (54 580 facce) ok, console pulita.
- Rollback: `git revert` del commit.

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
