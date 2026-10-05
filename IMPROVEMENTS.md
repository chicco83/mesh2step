# MIGLIORIE PROPOSTE — Mesh2STEP
Versione documento: 1.0.0 — 2026-10-05 17:10

Priorità: **A** = alto valore / sforzo contenuto · **B** = alto valore / sforzo alto · **C** = rifinitura.
Stato: ✅ fatto in v1.0.0 · ⬜ da fare.

## Già incluse in v1.0.0 (rispetto all'originale)
| # | Miglioria | Stato |
|---|---|---|
| 0.1 | Tabella cilindri per diametro (fori vs alberi) | ✅ |
| 0.2 | Picking faccia con Ø, lunghezza, asse e scarto massimo | ✅ |
| 0.3 | Tolleranza suggerita + analisi automatica al caricamento | ✅ |
| 0.4 | Layout mobile (viewer sopra, pannello sotto) | ✅ |
| 0.5 | Test automatici con validazione OpenCASCADE | ✅ |

## Riconoscimento
| # | P | Miglioria | Note |
|---|---|---|---|
| 1 | A | **Coni** (smussi su fori, svasature) | Asse = autovettore minimo della covarianza delle normali; n·asse = cos α costante. Bordo STEP già pronto (`CONICAL_SURFACE`). |
| 2 | B | **Tori** (raccordi su spigoli circolari) | Oggi diventano freeform: sono il caso più comune nei pezzi stampati. |
| 3 | A | **Snap ai valori nominali** ("beautify") | Ø arrotondati a 0,05 mm o a tabelle (M3 → 3,2/3,4), normali agganciate agli assi, assi paralleli/coassiali unificati. L'originale non lo fa: è il vero salto di qualità per l'editing in CAD. |
| 4 | B | **Filettature** | Riconoscere l'elica → cilindro nominale + attributo "M6×1" nel nome faccia, così in Fusion si riapplica `Thread`. |
| 5 | B | **Freeform → NURBS** | Fitting B-spline delle macchie freeform: STEP molto più leggero e liscio. |

## Editing (funzioni "Pro" dell'originale, qui gratis)
| # | P | Miglioria |
|---|---|---|
| 6 | A | Clic su faccia → **converti** in piano/cilindro o **unisci** alla vicina |
| 7 | A | **Selezione corpi**: esporta solo i corpi scelti, rinominali (nome nello STEP) |
| 8 | B | **Riparazione mesh**: chiusura buchi, rimozione non-manifold, saldatura con tolleranza |

## Output e integrazioni
| # | P | Miglioria |
|---|---|---|
| 9 | A | **Report fori** CSV/PDF (posizione, Ø, profondità, passante/cieco) |
| 10 | C | Export anche STL "ripulito" e OBJ colorato per tipo |
| 11 | C | Mappa di **deviazione** mesh ↔ superfici (heatmap) per validare la conversione |
| 12 | C | Pulsante "Apri in Fusion/FreeCAD" via protocollo URL o file associato |
| 13 | A | 3MF: applicare le trasformazioni `build/item` e i nomi degli oggetti come nomi dei corpi |

## Piattaforma
| # | P | Miglioria |
|---|---|---|
| 14 | A | **PWA offline**: three.js incluso nel repo + service worker; installabile anche su telefono |
| 15 | B | **App Windows portabile** (Tauri) e integrazione con *3D STL Multipart Maker*: split del modello e conversione STEP nello stesso strumento |
| 16 | B | Core in **Rust/WASM** per mesh > 1 M triangoli (oggi JS: ~0,8 s per 68 k) |
| 17 | A | **CI GitHub Actions**: test + validazione OCCT a ogni push, deploy Pages automatico |
| 18 | C | Interfaccia IT/EN, tema chiaro, scorciatoie (vista dall'alto/fronte, sezione) |
