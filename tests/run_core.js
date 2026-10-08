// Mesh2STEP — tests/run_core.js
// Versione: 1.8.0 — 2026-10-08 23:30
// Esegue il core in Node su ogni file di tests/samples e scrive gli STEP in tests/out.
// Uso: node tests/run_core.js [cartella_input] [cartella_output] [tol]
const fs = require('fs'), path = require('path');
const M2S = require('../src/core.js');
const inDir = process.argv[2] || path.join(__dirname, 'samples');
const outDir = process.argv[3] || path.join(__dirname, 'out');
const tol = +(process.argv[4] || 0.02);
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  let wasm = null;
  for (const f of fs.readdirSync(inDir).filter(f => /\.(stl|obj|3mf)$/i.test(f))) {
    const buf = fs.readFileSync(path.join(inDir, f));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const t0 = Date.now();
    const soup = await M2S.parseFile(f, ab);
    const snap = !!process.env.SNAP;   // [v1.1.0] SNAP=1 per lo snap ai valori nominali
    const { M, seg } = M2S.analyse(soup, { tol, angle: 1, cylinders: true, spheres: true, cones: true, tori: true, threads: true, nurbs: true, snap });
    const feat = M2S.features(M, seg);
    const st = M2S.exportSTEP(M, seg, { name: path.parse(f).name, tol });
    fs.writeFileSync(path.join(outDir, path.parse(f).name + '.step'), st.text);
    // [v1.4.0] variante con filettature sostituite dal cilindro nominale -> <nome>_threadcyl.step
    if (seg.regions.some(r => r.type === 'thread')) fs.writeFileSync(path.join(outDir, path.parse(f).name + '_threadcyl.step'), M2S.exportSTEP(M, seg, { name: path.parse(f).name, tol, threadCyl: true }).text);
    // [v1.1.0] mesh aperte: chiude i buchi ed esporta anche <nome>_riparata.step
    if (M.open > 0) {
      const R = M2S.fillHoles(M), M2 = M2S.buildMesh(R.soup), s2 = M2S.segment(M2, { tol, angle: 1, cylinders: true, spheres: true });
      fs.writeFileSync(path.join(outDir, path.parse(f).name + '_riparata.step'), M2S.exportSTEP(M2, s2, { name: path.parse(f).name, tol }).text);
      console.log(JSON.stringify({ file: f, riparazione: { buchi: R.holes, triangoli: R.added, apertiDopo: M2.open, volume: +M2.volume.toFixed(3) } }));
    }
    // [v1.7.0] auto-intersezioni: unione booleana dei corpi (manifold-3d) ed export <nome>_riparata.step
    const si = M2S.findSelfIntersections(M);
    if (si.count > 0) {
      wasm = wasm || await (async () => { const w = await (await import(require('url').pathToFileURL(path.join(__dirname, '..', 'vendor', 'manifold.js')).href)).default(); w.setup(); return w; })();
      const R = M2S.repairSelfIntersections(M, wasm);
      if (R.ok) {
        const M3 = M2S.buildMesh(R.soup), s3 = M2S.segment(M3, { tol, angle: 1, cylinders: true, spheres: true });
        fs.writeFileSync(path.join(outDir, path.parse(f).name + '_riparata.step'), M2S.exportSTEP(M3, s3, { name: path.parse(f).name, tol }).text);
      }
      console.log(JSON.stringify({ file: f, autoIntersezioni: { prima: si.count, dopo: R.after, corpiUniti: R.merged, ok: R.ok, volume: R.ok ? +R.volume.toFixed(3) : null } }));
    }
    const cyl = seg.regions.filter(r => r.type === 'cylinder').map(r => 'Ø' + (2 * r.radius).toFixed(3) + (r.outward ? '' : ' foro'));
    const sph = seg.regions.filter(r => r.type === 'sphere').map(r => 'R' + r.radius.toFixed(3));
    const extra = seg.regions.filter(r => ['cone', 'torus', 'thread', 'bspline'].includes(r.type)).map(r => r.type === 'cone' ? 'cono ' + (r.alpha * 180 / Math.PI).toFixed(2) + '°' : r.type === 'torus' ? 'toro R' + r.R.toFixed(3) + ' r' + r.r.toFixed(3) : r.type === 'thread' ? 'filetto ' + r.label + ' (' + r.score.toFixed(2) + ')' : 'bspline ' + r.nc + 'x' + (r.nv || r.nc) + (r.closedU ? ' chiusa' : '') + ' err ' + r.err.toFixed(4));
    const holes = feat.holes.map(h => 'Ø' + h.diameter.toFixed(2) + (h.through ? ' passante' : ' cieco') + ' p' + h.depth.toFixed(2));
    console.log(JSON.stringify({ file: f, tris: M.nT, ms: Date.now() - t0, stats: Object.fromEntries(Object.entries(seg.stats).filter(([, v]) => v)), cyl, sph, extra, holes, bodies: feat.bodies.map(b => b.name), faces: st.faces, edges: st.edges, solids: st.solids }));
  }
})();
