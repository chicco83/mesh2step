# MANUALE — Mesh2STEP
Versione documento: 1.3.0 — 2026-10-06 13:45
<!-- [2026-10-06 13:45] versione precedente 1.0.0 (2026-10-05 17:10) nel repository git (commit 729f9ed). -->

## 1. Avvio
| Modo | Come |
|---|---|
| Online | `https://chicco83.github.io/mesh2step/` (GitHub Pages: *Settings → Pages → main / root*) |
| Installata (PWA) | Dalla pagina online: menu del browser → *Installa app* / *Aggiungi a schermata Home*. Funziona offline e apre i file `.stl/.obj/.3mf` dal sistema |
| Portabile (un file) | `dist/mesh2step_v1.3.0_20261006-1342.html`: doppio clic, funziona offline |
| Windows (exe) | `Mesh2STEP_v1.3.0_<data>.exe` dalla GitHub Action *desktop* (o `desktop/build-desktop.sh`). Richiede WebView2 Runtime (già presente in Windows 10/11). Si può trascinare un file sull'exe o usare *Apri con* |
| Sviluppo | `python3 -m http.server` nella cartella del progetto → `http://localhost:8000` |

## 2. Flusso di lavoro
1. **Apri mesh** o trascina il file nella vista. Il pannello *File* mostra triangoli, corpi, dimensioni, chiusura, volume.
2. Se la mesh è aperta compare **Chiudi i buchi della mesh**: chiude i buchi (anche facce con fori) e rianalizza.
3. L'analisi parte da sola. Cambia i parametri e premi **Analizza mesh** per ripeterla.
4. Controlla colori, tabelle (fori, alberi, filettature) e, se serve, la **Deviazione**.
5. Correggi le facce sbagliate con **Modifica facce**.
6. Scegli e rinomina i **Corpi**.
7. **Scarica STEP** (o **Condividi STEP** da telefono), eventualmente **STL**, **OBJ** e **report CSV**.

## 3. Parametri di riconoscimento
| Parametro | Default | Effetto |
|---|---|---|
| Tolleranza (mm) | diagonale × 1e-4 (0,01–0,2) | Distanza massima dei vertici dalla superficie. STL da CAD: 0,01–0,05. Stampe/scansioni: 0,1–0,3 |
| Angolo (°) | 1 | Scostamento massimo delle normali per piani e cilindri |
| Cilindri, Coni, Sfere, Tori, Filettature, B-spline | attivi | Disattiva un tipo per forzare il risultato in altre superfici |
| Arrotonda a valori nominali | disattivo | Assi e normali sugli assi X/Y/Z, Ø a 0,1/0,05/0,01 mm, semi-angoli dei coni a 0,5°, raggi dei tori, cilindri coassiali allineati; solo se la mesh resta entro tolleranza |

## 4. Colori
| Colore | Superficie | Nello STEP |
|---|---|---|
| Blu-grigio | Piano | `PLANE` |
| Verde acqua | Cilindro | `CYLINDRICAL_SURFACE` (faccia `HOLE D…` / `SHAFT D…`) |
| Azzurro | Cono | `CONICAL_SURFACE` |
| Arancio | Sfera | `SPHERICAL_SURFACE` |
| Giallo | Toro | `TOROIDAL_SURFACE` |
| Rosa | Filettatura | triangoli piani, facce `THREAD M…` |
| Verde chiaro | B-spline | `B_SPLINE_SURFACE_WITH_KNOTS` |
| Viola | Freeform | triangoli piani |
| Giallo acceso | Selezione | — |

**Deviazione**: verde = 0, giallo = metà tolleranza, rosso ≥ tolleranza; la legenda mostra la deviazione massima.

## 5. Modifica facce
- Tocca una faccia per selezionarla e vederne i dati; **Selezione multipla** (o Shift/Ctrl+clic) per aggiungerne altre.
- Scegli il tipo e premi **Applica**:
  - *Automatico (unisci)*: prova piano → cilindro → cono → sfera → toro → B-spline e usa il primo entro lo scarto.
  - Tipo esplicito: forza quella superficie; se lo scarto supera il limite compare l'errore col valore migliore ottenuto.
  - *Freeform*: torna ai triangoli.
- **Scarto max accettato**: default 5 × tolleranza.
- Le facce unite devono essere contigue.
- **Annulla ultima modifica**: fino a 20 passi. Una nuova analisi azzera la cronologia.

## 6. Corpi
- Compare con più corpi o con nomi presi dal file (3MF `name`, OBJ `o`/`g`, STL ASCII `solid`).
- Spunta = incluso nello STEP; il nome diventa quello del solido nel CAD.

## 7. Report CSV
Colonne: tipo, diametro, profondità, passante, asse (x,y,z), posizione (x,y,z), note.
Righe: `hole`, `shaft`, `cone` (angolo incluso), `thread` (M-size, passo, senso, interna/esterna).
In italiano: separatore `;` e virgola decimale (apertura diretta in Excel).

## 8. Navigazione e interfaccia
Trascina = ruota · rotella/pizzica = zoom · tasto destro o Shift+trascina = sposta · **F** = adatta.
Barra in alto: viste **Iso / Alto / Fronte / Destra**, **Contorni**, **Deviazione**.
In alto a destra del pannello: **tema** chiaro/scuro e **lingua** IT/EN (ricordati dal browser).

## 9. Integrazione con altre app
```js
const w = window.open('https://chicco83.github.io/mesh2step/');
addEventListener('message', e => {
  if (e.data && e.data.type === 'mesh2step:ready')
    w.postMessage({ type: 'mesh2step:open', name: 'pezzo.stl', buffer: arrayBuffer }, '*');
});
```
In alternativa: `…/mesh2step/?url=<URL del file servito con CORS>`.

## 10. Consigli
- Le mesh migliori sono quelle esportate da CAD: i vertici stanno esattamente sulle superfici.
- Molte zone viola: aumenta la tolleranza a passi di ×2, poi correggi a mano le facce residue.
- Fori che risultano "albero": la mesh ha normali invertite; chiudi i buchi o riesporta dal programma d'origine.

## 11. Sviluppo
```
src/core.js      parsing, topologia, riconoscimento, editing, riparazione, export STEP (no DOM)
src/worker.js    Web Worker: load / repair / analyse / edit / undo / step / stl / obj
src/app.js       UI, viewer, i18n, integrazione
index.html       pagina; sw.js + manifest.webmanifest + icons/ = PWA
vendor/          three.js 0.169 (licenza MIT in LICENSE-three.txt)
build.mjs        dist/mesh2step_v<VERSION>_<AAAAMMGG-HHMM>.html (offline)
desktop/         app Windows WebView2 (C#/.NET 8) + build-desktop.sh
tests/           make_samples.py · run_core.js · check_step.py · samples/
archive/         versioni precedenti dei file riscritti
.github/workflows ci.yml (test + build) · desktop.yml (exe Windows)
```
### Test
```bash
pip install trimesh manifold3d cadquery-ocp
python3 tests/make_samples.py && node tests/run_core.js && python3 tests/check_step.py
SNAP=1 node tests/run_core.js tests/samples /tmp/out   # stessa cosa con snap ai valori nominali
```
### App Windows
```bash
# serve .NET 8 SDK (anche su Linux/macOS)
desktop/build-desktop.sh        # -> desktop/out/Mesh2STEP_v<ver>_<data>.exe
```
Oppure GitHub → *Actions* → *desktop* → *Run workflow* (o push di un tag `v1.3.0`: l'exe va nella release).

### Nuova versione
1. `VERSION`, costanti `VERSION` in `src/core.js` e `src/app.js`, `CACHE` in `sw.js`, `<Version>` in `desktop/*.csproj`, intestazioni dei file toccati.
2. Voce in `CHANGELOG.md`; aggiorna `CONTEXT.md`, `MANUAL.md`, `README.md`, `IMPROVEMENTS.md`.
3. `node build.mjs`, test, commit per nome dei file modificati (vedi `CLAUDE.md`).
