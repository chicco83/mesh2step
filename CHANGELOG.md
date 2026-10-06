# CHANGELOG — Mesh2STEP
Versione documento: 1.0.1 — 2026-10-06 13:10

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
