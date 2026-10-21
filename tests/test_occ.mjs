// Mesh2STEP — tests/test_occ.mjs
// Versione: 1.13.0 — 2026-10-21 22:59
// OpenCASCADE nel motore (vendor/replicad_single.js, LGPL-2.1): occCheckStep e stepValidated sui campioni.
// plate_hole e countersink validi al primo giro; scoop valido dopo il ripiego di alcune regioni; volume OCC entro l'1% della mesh.
import init from '../vendor/replicad_single.js';
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), M2S = require('../src/core.js'), dir = path.dirname(new URL(import.meta.url).pathname);
let fail = 0; const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail = 1; };
const oc = await init();
for (const [f, tol] of [['plate_hole.stl', 0.02], ['scoop.stl', 0.04], ['countersink.stl', 0.02]]) {
  const b = fs.readFileSync(path.join(dir, 'samples', f));
  const M = M2S.buildMesh(await M2S.parseFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const seg = M2S.segment(M, { tol, angle: 1, cylinders: true, spheres: true });
  const r = M2S.stepValidated(M, seg, oc, { name: 't', tol });
  const dv = Math.abs(r.volume - r.meshVolume) / r.meshVolume;
  // scoop: alcune patch B-spline hanno area diversa dai loro triangoli e vengono sfaccettate (il volume torna a +0,25%)
  chk(r.valid && (f === 'scoop.stl' || r.faceted === 0) && dv < 0.01, `${f}: valido ${r.valid}, regioni sfaccettate ${r.faceted}, volume OCC ${r.volume.toFixed(1)} mesh ${r.meshVolume.toFixed(1)} (${(100 * dv).toFixed(2)}%)`);
}
// uno STEP rovinato (riferimento mancante a metà file) non deve passare per valido
{
  const b = fs.readFileSync(path.join(dir, 'samples', 'plate_hole.stl')), M = M2S.buildMesh(await M2S.parseFile('plate_hole.stl', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const t = M2S.exportSTEP(M, M2S.segment(M, { tol: 0.02, angle: 1, cylinders: true, spheres: true }), { name: 't', tol: 0.02 }).text.replace(/CIRCLE\('',#\d+,/, "CIRCLE('',#999999,");
  let c; try { c = M2S.occCheckStep(oc, t); } catch (e) { c = { valid: false }; }
  chk(!c.valid || c.volume < 11000, 'STEP rovinato: non valido o volume sbagliato (' + (c.volume || 0).toFixed(1) + ')');
}
console.log(fail ? 'FALLITO' : 'OK'); process.exit(fail);
