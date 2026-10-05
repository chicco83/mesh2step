# CLAUDE.md — Mesh2STEP
Versione: 1.0.0 — 2026-10-05 17:10

Istruzioni per ogni sessione (locale o cloud) che lavora su questo repository.

## Versioning (obbligatorio)
- Versione semantica in `VERSION` (MAJOR.MINOR.PATCH). Aggiornarla a **ogni revisione**.
- Intestazione in cima a ogni file sorgente/documento: `Versione: X.Y.Z — AAAA-MM-GG HH:MM`.
- La build distribuibile ha versione, data e ora nel nome: `dist/mesh2step_vX.Y.Z_AAAAMMGG-HHMM.html` (`node build.mjs`).
- Quando si corregge codice, lasciare la sezione precedente **commentata con la data** della modifica.

## Documenti da mantenere aggiornati
- `CONTEXT.md` — scopo, architettura, decisioni, vincoli.
- `CHANGELOG.md` — una voce numerata per ogni versione (più recente in alto).
- `MANUAL.md` — manuale d'uso e di sviluppo.
- `IMPROVEMENTS.md` — backlog migliorie con stato.

## Test prima di ogni commit
```
python3 tests/make_samples.py      # rigenera le mesh di prova (trimesh + manifold3d)
node tests/run_core.js             # analisi + export STEP in tests/out
python3 tests/check_step.py        # validazione con OpenCASCADE (OCP): tutti valid=True
```

## Workflow git (più sessioni lavorano sugli stessi file)
1. `git pull --rebase` prima di committare.
2. Aggiungere **solo i file modificati da questa sessione, per nome** (mai `git add -A` / `git add .`).
3. Messaggio descrittivo (mai "."), poi `git push` subito.
4. Conflitto su un `.md`: unire a mano tenendo entrambe le modifiche (CHANGELOG: entrambe le voci, numerate in ordine).
5. Allineare la copia locale al commit pushato.

## Regole di progetto
- Implementazione clean-room: non copiare codice, testi o asset da mesh2solid.thavision.com.
- Nessun upload: tutta l'elaborazione resta nel browser.
- `src/core.js` non deve dipendere dal DOM (gira nel Worker e in Node).
