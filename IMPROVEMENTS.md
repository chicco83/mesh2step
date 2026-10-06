# MIGLIORIE — Mesh2STEP
Versione documento: 1.3.0 — 2026-10-06 14:10
<!-- [2026-10-06 13:45] versione precedente 1.0.0 (2026-10-05 17:10): elenco proposte tutte "da fare";
     aggiornato con lo stato di realizzazione. -->

Stato: ✅ fatto · 🟡 parziale · ⏸️ valutato e rinviato.

| # | Miglioria | Stato | Versione | Note |
|---|---|---|---|---|
| 0.1–0.5 | Tabella cilindri, picking, tolleranza automatica, mobile, test OCCT | ✅ | 1.0.0 | |
| 1 | Coni (smussi, svasature) | ✅ | 1.1.0 | `CONICAL_SURFACE`; svasatura 90° riconosciuta a 45,00° |
| 2 | Tori (raccordi su spigoli circolari) | ✅ | 1.1.0 | `TOROIDAL_SURFACE`; toro completo chiuso esportato sfaccettato |
| 3 | Snap ai valori nominali | ✅ | 1.1.0 | Opzione "Arrotonda a valori nominali" |
| 4 | Filettature | 🟡 | 1.1.0 | Riconoscimento, M-size ISO, passo, senso, report e nome faccia. **Manca**: sostituzione con cilindro nominale nello STEP (resta sfaccettata) |
| 5 | Freeform → NURBS | 🟡 | 1.1.0 | B-spline bicubiche per zone "campo di altezze"; superfici che si richiudono (es. tubi organici) restano sfaccettate |
| 6 | Conversione/unione facce manuale | ✅ | 1.2.0 | Con annulla a 20 livelli |
| 7 | Selezione e rinomina corpi | ✅ | 1.2.0 | Nomi anche da 3MF/OBJ/STL |
| 8 | Riparazione mesh | 🟡 | 1.1.0 | Chiusura buchi (anche annidati). **Manca**: correzione spigoli non-manifold e auto-intersezioni |
| 9 | Report fori CSV | ✅ | 1.2.0 | CSV per Excel; PDF non fatto |
| 10 | Export STL / OBJ | ✅ | 1.2.0 | |
| 11 | Heatmap di deviazione | ✅ | 1.2.0 | |
| 12 | "Apri in Fusion/FreeCAD" | 🟡 | 1.2.0 | Da browser non si può lanciare un CAD locale senza server: c'è **Condividi STEP** (telefono) e l'app Windows apre i file dal sistema |
| 13 | 3MF: trasformazioni e nomi | ✅ | 1.1.0 | |
| 14 | PWA offline | ✅ | 1.3.0 | |
| 15 | App Windows portabile + integrazione con 3D STL Multipart Maker | 🟡 | 1.3.0 | Exe WebView2 compilato (da provare su Windows); API `postMessage`/`?url=` pronte, il pulsante lato Multipart Maker va aggiunto in quel progetto |
| 16 | Core Rust/WASM | ⏸️ | — | Non serve ora: 205 k triangoli in 3 s |
| 17 | CI GitHub Actions | ✅ | 1.3.0 | `ci.yml`, `desktop.yml` |
| 18 | IT/EN, tema chiaro, viste | ✅ | 1.2.0 | |

## Prossimi passi proposti
<!-- [2026-10-06 14:10] elenco precedente (5 voci) integrato con verifica exe/CI e sfere spurie; ordine allineato a CLAUDE.md §8 -->
1. Provare l'exe Windows (Actions → *desktop*, o `desktop\build-desktop.ps1`).
2. Controllare l'esito della CI `ci.yml`.
3. Filettature: sostituire la zona filettata con il cilindro nominale quando confina con piani ⟂ asse.
4. Ridurre le sfere spurie nelle zone di uscita del filetto.
5. Toro/sfera completi divisi in due facce invece che sfaccettati.
6. Riparazione non-manifold e auto-intersezioni.
7. Pulsante "Converti in STEP" in 3D STL Multipart Maker che apre Mesh2STEP via `postMessage`.
8. Report PDF con disegno quotato dei fori.
