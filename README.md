# Mesh2STEP
Versione: 1.0.0 — 2026-10-05 17:10

Converte mesh **STL / OBJ / 3MF** in **STEP** con geometria CAD reale: piani, cilindri e sfere
invece di migliaia di triangoli. Gira interamente nel browser: i file non vengono caricati da nessuna parte.

**Prova online:** https://chicco83.github.io/mesh2step/

| Mesh | STEP generato (letto da OpenCASCADE) |
|---|---|
| Piastra con foro, 272 triangoli | 6 piani + 1 cilindro, volume esatto 11214,6018 mm³ |
| Piastra raccordata, 464 triangoli | 6 piani + 5 cilindri |
| Cupola, 1222 triangoli | 6 piani + 1 sfera |

- Documentazione: [MANUAL.md](MANUAL.md) · [CONTEXT.md](CONTEXT.md) · [CHANGELOG.md](CHANGELOG.md)
- Migliorie proposte: [IMPROVEMENTS.md](IMPROVEMENTS.md)
- Build portabile single-file: cartella [`dist/`](dist/)

Ispirato a mesh2solid.thavision.com; implementazione indipendente (clean-room), nessun codice o asset dell'originale.
