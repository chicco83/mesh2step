// Mesh2STEP — tests/test_devthr.js
// Versione: 1.5.1 — 2026-10-07 07:15
// Deviazione dei filetti dal cilindro nominale: bolt_m6 -> devThr > 0 sul filetto (profondità del fianco), dev = 0; resto invariato.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
(async () => {
  const b = fs.readFileSync(path.join(__dirname, 'samples', 'bolt_m6.stl'));
  const soup = await M2S.parseFile('bolt_m6.stl', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const { M, seg } = M2S.analyse(soup, { tol: 0.02, angle: 1, cylinders: true, spheres: true });
  const d = M2S.deviation(M, seg), th = seg.regions.find(r => r.type === 'thread');
  let mt = 0, mf = 0; for (let t = 0; t < M.nT; t++) { if (seg.face[t] === th.id) { mt = Math.max(mt, d.devThr[t]); mf = Math.max(mf, d.dev[t]); } }
  console.log('filetto', th.label, 'dev max', mf.toFixed(4), 'devThr max', mt.toFixed(4), '(profondita filetto', (th.rmax - th.rmin).toFixed(3) + ')');
  const ok = mf === 0 && mt > 0.1 && mt < 1.5 && d.maxThr >= mt;
  console.log(ok ? 'OK' : 'FALLITO'); process.exit(ok ? 0 : 1);
})();
