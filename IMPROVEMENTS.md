# MIGLIORIE — Mesh2STEP
Versione documento: 1.8.0 — 2026-10-08 23:35
<!-- [2026-10-06 13:45] versione precedente 1.0.0 (2026-10-05 17:10): elenco proposte tutte "da fare";
     aggiornato con lo stato di realizzazione. -->

Stato: ✅ fatto · 🟡 parziale · ⏸️ valutato e rinviato.

| # | Miglioria | Stato | Versione | Note |
|---|---|---|---|---|
| 0.1–0.5 | Tabella cilindri, picking, tolleranza automatica, mobile, test OCCT | ✅ | 1.0.0 | |
| 1 | Coni (smussi, svasature) | ✅ | 1.1.0 | `CONICAL_SURFACE`; svasatura 90° riconosciuta a 45,00° |
| 2 | Tori (raccordi su spigoli circolari) | ✅ | 1.1.0 | `TOROIDAL_SURFACE`; toro completo chiuso esportato sfaccettato |
| 3 | Snap ai valori nominali | ✅ | 1.1.0 | Opzione "Arrotonda a valori nominali" |
| 4 | Filettature | ✅ | 1.4.0 | Riconoscimento, M-size ISO, passo, senso, report e nome faccia; opzione STEP *Filettature come cilindro nominale* (default spenta, proiezione radiale su copia della mesh). Residui d'uscita assorbiti nel filetto |
| 5 | Freeform → NURBS | 🟡 | 1.6.0 | B-spline bicubiche per zone «campo di altezze» (1.1.0), per superfici chiuse tubo/vaso anche **lungo una spina curva** (periodiche in angolo, 1.5.0–1.6.0, `vase.stl`, `vase_bent.stl`: 3 facce). Restano sfaccettati: gusci con poli o rientranze, superfici chiuse in due direzioni, regioni non connesse. Sfera/toro completi: ✅ 1.4.0 |
| 6 | Conversione/unione facce manuale | ✅ | 1.2.0 | Con annulla a 20 livelli |
| 7 | Selezione e rinomina corpi | ✅ | 1.2.0 | Nomi anche da 3MF/OBJ/STL |
| 8 | Riparazione mesh | ✅ | 1.7.0 | Chiusura buchi (anche annidati), **spigoli non-manifold** (duplicati, schiena-a-schiena, alette) e **auto-intersezioni tra corpi** (unione booleana con manifold-3d, 1.7.0). Non risolte: auto-intersezione dentro un solo guscio (ripiegato su se stesso) |
| 9 | Report fori CSV + PDF | ✅ | 1.4.0 | CSV per Excel (1.2.0); PDF con disegno quotato, fori numerati, tabelle (1.4.0) |
| 10 | Export STL / OBJ | ✅ | 1.2.0 | |
| 11 | Heatmap di deviazione | ✅ | 1.5.1 | B-spline per triangolo (1.4.0); **filettature: scarto dal cilindro nominale** con l'opzione «filettature come cilindro» (1.5.1); freeform = 0 per scelta (esportati sfaccettati, esatti) |
| 12 | "Apri in Fusion/FreeCAD" | 🟡 | 1.2.0 | Da browser non si può lanciare un CAD locale senza server: c'è **Condividi STEP** (telefono) e l'app Windows apre i file dal sistema |
| 13 | 3MF: trasformazioni e nomi | ✅ | 1.1.0 | |
| 14 | PWA offline | ✅ | 1.3.0 | |
| 15 | App Windows portabile + integrazione con 3D STL Multipart Maker | 🟡 | 1.4.1 | Exe WebView2 **provato su Windows 11** (1.4.1): avvio, file da argomento, export. Il pulsante lato Multipart Maker va aggiunto in quel progetto (API `postMessage`/`?url=` pronte) |
| 16 | Core Rust/WASM | ⏸️ | — | Non serve ora: 205 k triangoli in 3 s |
| 17 | CI GitHub Actions | ✅ | 1.3.0 | `ci.yml` verde dal 2026-10-06 (mancavano `networkx`/`lxml`/`numpy`); dalla 1.4.0 esegue anche `test_repair.js` e `test_pdf.js` |
| 18 | IT/EN, tema chiaro, viste | ✅ | 1.2.0 | |
| 19 | Modifica foro (Ø, M2–M16: gioco / maschiatura / etichetta filetto) | 🟡 | 1.8.0 | Diametro cambiato con Annulla; la «filettatura» è foro di maschiatura + etichetta, **non** elica reale |
| 20 | Verifica STEP nell'app | ⏸️ | — | Idea dal sito di riferimento; proposta: controllo leggero (facce, anelli chiusi, riferimenti) |

## Prossimi passi proposti
<!-- [2026-10-07] elenco precedente (8 voci, 1.3.0): fatte filettature→cilindro, sfere spurie, sfera/toro completi, non-manifold, PDF -->
1. ~~Provare l'exe Windows~~ ✅ 2026-10-07 (trovato e corretto il bug delle risorse in sottocartelle). Restano: «Apri con…»/trascinamento, PC senza WebView2.
2. ~~Pulsante «Converti in STEP»~~ ✅ 2026-10-07 nel repo 3d-stl-multipart-maker v0.6.2-beta (pannello Esporta; `postMessage`). Non provato sulla versione Windows.
3. ~~Auto-intersezioni~~ ✅ rilevamento 1.5.0, riparazione tra corpi 1.7.0 (unione booleana). Resta il guscio ripiegato su se stesso.
4. ~~B-spline per superfici che si richiudono~~ ✅ 1.5.0 (asse dritto) e 1.6.0 (spina curva). Restano gusci con poli/rientranze.
5. ~~Deviazione per freeform e filettature~~ ✅ filettature 1.5.1; freeform volutamente 0 (esatti).
6. Report PDF su più pagine quando i fori superano ~28 righe.
