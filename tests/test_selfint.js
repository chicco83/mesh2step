// Mesh2STEP — tests/test_selfint.js
// Versione: 1.5.0 — 2026-10-07 01:03
// Auto-intersezioni: i campioni chiusi non ne hanno; due scatole sovrapposte (non fuse) sì.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
const box = (x, y, z, s) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => [x + p[0] * s, y + p[1] * s, z + p[2] * s]);
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.flatMap(t => t.flatMap(i => v[i]));
};
(async () => {
  let ok = true;
  for (const f of fs.readdirSync(path.join(__dirname, 'samples')).filter(n => /\.(stl)$/.test(n))) {
    const b = fs.readFileSync(path.join(__dirname, 'samples', f));
    const soup = await M2S.parseFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const M = M2S.buildMesh(soup), r = M2S.findSelfIntersections(M);
    console.log(f.padEnd(26), 'auto-intersezioni:', r.count, r.partial ? '(parziale)' : '');
    // [v1.7.0] overlap_pin.stl ha due shell sovrapposte di proposito (campione per la riparazione): deve avere intersezioni
    if (f === 'overlap_pin.stl' ? r.count === 0 : r.count !== 0) ok = false;
  }
  const one = M2S.findSelfIntersections(M2S.buildMesh(new Float32Array(box(0, 0, 0, 10))));
  const two = M2S.findSelfIntersections(M2S.buildMesh(new Float32Array([...box(0, 0, 0, 10), ...box(3, 4.3, 6.1, 10)])));
  console.log('una scatola:', one.count, '— due scatole sovrapposte:', two.count, 'triangoli coinvolti', two.tris.size);
  if (one.count !== 0 || two.count === 0) ok = false;
  console.log(ok ? 'OK' : 'FALLITO'); process.exit(ok ? 0 : 1);
})();
