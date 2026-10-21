// Mesh2STEP — tests/test_autotol.js
// Versione: 1.10.0 — 2026-10-21 14:15
// Tolleranza automatica + robustezza al rumore: noisy_plate (sigma 0,01) e noisy_fillet (sigma 0,03) con tol 0,02.
// Senza autoTol restano decine/centinaia di facce; con autoTol si torna alla forma (7 e ~28 facce). Mesh pulite: nessun rialzo.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
const load = async n => { const b = fs.readFileSync(path.join(__dirname, 'samples', n)); return M2S.buildMesh(await M2S.parseFile(n, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); };
let fail = 0; const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail = 1; };
const O = { tol: 0.02, angle: 1, cylinders: true, spheres: true };
const faces = (M, seg, tol) => M2S.exportSTEP(M, seg, { name: 't', tol }).faces;
(async () => {
  let M = await load('noisy_plate.stl');
  const plain = faces(M, M2S.segment(M, O), 0.02), a = M2S.segmentAuto(M, O), fa = faces(M, a.seg, a.tol);
  chk(plain > 10, `noisy_plate senza auto: ${plain} facce (tol 0,02 < rumore)`);
  chk(fa === 7 && a.tol > 0.02 && a.tol <= 0.06, `noisy_plate con auto: ${fa} facce, tol ${a.tol} (attese 7)`);
  const cyl = a.seg.regions.filter(r => r.type === 'cylinder');
  chk(cyl.length === 1 && Math.abs(cyl[0].radius - 5) < 0.05, `noisy_plate: 1 cilindro R ${cyl[0] && cyl[0].radius.toFixed(3)} (atteso 5)`);
  M = await load('noisy_fillet.stl');
  const p2 = faces(M, M2S.segment(M, O), 0.02), b = M2S.segmentAuto(M, O), fb = faces(M, b.seg, b.tol);
  chk(p2 > 100, `noisy_fillet senza auto: ${p2} facce`);
  chk(fb <= 35 && b.tol >= 0.05 && b.tol <= 0.2, `noisy_fillet con auto: ${fb} facce, tol ${b.tol} (attese ~28)`);
  for (const f of ['plate_hole.stl', 'dome.stl', 'countersink.stl']) {
    M = await load(f); const c = M2S.segmentAuto(M, O);
    chk(c.tol === 0.02 && c.tries.length === 1, `${f}: mesh pulita, nessun rialzo (tol ${c.tol}, ${c.tries.length} tentativo)`);
  }
  console.log(fail ? 'FALLITO' : 'OK'); process.exit(fail);
})();
