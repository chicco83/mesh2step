// Mesh2STEP — tests/run_core.js
// Versione: 1.0.0 — 2026-10-05 17:10
// Esegue il core in Node su ogni file di tests/samples e scrive gli STEP in tests/out.
// Uso: node tests/run_core.js [cartella_input] [cartella_output] [tol]
const fs = require('fs'), path = require('path');
const M2S = require('../src/core.js');
const inDir = process.argv[2] || path.join(__dirname, 'samples');
const outDir = process.argv[3] || path.join(__dirname, 'out');
const tol = +(process.argv[4] || 0.02);
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  for (const f of fs.readdirSync(inDir).filter(f => /\.(stl|obj|3mf)$/i.test(f))) {
    const buf = fs.readFileSync(path.join(inDir, f));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const t0 = Date.now();
    const soup = await M2S.parseFile(f, ab);
    const { M, seg } = M2S.analyse(soup, { tol, angle: 1, cylinders: true, spheres: true });
    const st = M2S.exportSTEP(M, seg, { name: path.parse(f).name, tol });
    fs.writeFileSync(path.join(outDir, path.parse(f).name + '.step'), st.text);
    const cyl = seg.regions.filter(r => r.type === 'cylinder').map(r => 'Ø' + (2 * r.radius).toFixed(3) + (r.outward ? '' : ' foro'));
    const sph = seg.regions.filter(r => r.type === 'sphere').map(r => 'R' + r.radius.toFixed(3));
    console.log(JSON.stringify({ file: f, tris: M.nT, ms: Date.now() - t0, volume: +M.volume.toFixed(4), stats: seg.stats, cyl, sph, faces: st.faces, edges: st.edges, solids: st.solids }));
  }
})();
