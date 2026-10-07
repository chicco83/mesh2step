// Mesh2STEP — tests/test_selfrepair.js
// Versione: 1.7.0 — 2026-10-07 22:10
// Riparazione auto-intersezioni: due scatole 10 mm sovrapposte (non fuse) -> unione booleana: 0 intersezioni, volume = 2000 - 155,61.
// Una scatola isolata e un corpo aperto restano com'erano.
const path = require('path'), M2S = require('../src/core.js');
const box = (x, y, z, s) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => [x + p[0] * s, y + p[1] * s, z + p[2] * s]);
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.flatMap(t => t.flatMap(i => v[i]));
};
(async () => {
  const Module = (await import(require('url').pathToFileURL(path.join(__dirname, '..', 'vendor', 'manifold.js')).href)).default;
  const wasm = await Module(); wasm.setup();
  let ok = true;
  const M = M2S.buildMesh(new Float32Array([...box(0, 0, 0, 10), ...box(3, 4.3, 6.1, 10)]));
  const r = M2S.repairSelfIntersections(M, wasm), exp = 2000 - 7 * 5.7 * 3.9;
  console.log('prima', r.before, 'dopo', r.after, 'corpi uniti', r.merged, 'volume', r.volume.toFixed(3), 'atteso', exp.toFixed(3));
  if (!(r.ok && r.before > 0 && r.after === 0 && Math.abs(r.volume - exp) < 0.01)) ok = false;
  // due scatole lontane: nessuna intersezione, due corpi uniti senza cambiare il volume
  const M2 = M2S.buildMesh(new Float32Array([...box(0, 0, 0, 10), ...box(30, 0, 0, 10)])), r2 = M2S.repairSelfIntersections(M2, wasm);
  console.log('separate: dopo', r2.after, 'volume', r2.volume.toFixed(3));
  if (!(r2.ok && Math.abs(r2.volume - 2000) < 0.01)) ok = false;
  // corpo aperto + scatola: l'aperto resta
  const open = box(40, 0, 0, 10).slice(9);   // 11 triangoli: scatola senza un triangolo
  const M3 = M2S.buildMesh(new Float32Array([...box(0, 0, 0, 10), ...open])), r3 = M2S.repairSelfIntersections(M3, wasm);
  console.log('con corpo aperto: corpi uniti', r3.merged, 'lasciati', r3.kept);
  if (!(r3.merged === 1 && r3.kept === 1)) ok = false;
  console.log(ok ? 'OK' : 'FALLITO'); process.exit(ok ? 0 : 1);
})();
