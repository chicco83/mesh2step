// Mesh2STEP — tests/test_simplecad.js
// Versione: 1.12.0 — 2026-10-21 21:49
// Port sperimentale dell'adattatore di superfici di SimpleCAD (segmentSimpleCAD, MIT): controllo di base su campioni CAD.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
let fail = 0; const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail = 1; };
(async () => {
  for (const [f, exp] of [['plate_hole.stl', { plane: 6, cylinder: 1 }], ['bump.stl', { plane: 5, bspline: 1 }]]) {
    const b = fs.readFileSync(path.join(__dirname, 'samples', f));
    const M = M2S.buildMesh(await M2S.parseFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
    const seg = M2S.segmentSimpleCAD(M, { tol: 0.02 }), st = M2S.regionStats(seg.regions);
    const ok = Object.entries(exp).every(([k, v]) => st[k] === v) && st.freeform === 0;
    chk(ok, `${f}: ${JSON.stringify(Object.fromEntries(Object.entries(st).filter(([, v]) => v)))} (attesi ${JSON.stringify(exp)})`);
    const v = M2S.verifyStep(M2S.exportSTEP(M, seg, { name: 't', tol: 0.02 }).text); chk(v.ok, `${f}: verifyStep ${v.ok}`);
  }
  console.log(fail ? 'FALLITO' : 'OK'); process.exit(fail);
})();
