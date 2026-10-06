// Mesh2STEP — tests/test_repair.js
// Versione: 1.4.0 — 2026-10-07
// Riparazione non-manifold: aggiunge a una mesh chiusa un triangolo duplicato, una coppia schiena-a-schiena e un'aletta
// su uno spigolo; dopo fixNonManifold + fillHoles la mesh deve tornare chiusa e manifold con il volume originale.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
(async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'samples', 'plate_hole.stl'));
  const soup = await M2S.parseFile('plate_hole.stl', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const M0 = M2S.buildMesh(soup), vol0 = M0.volume;
  const tri = t => Array.from(soup.slice(t * 9, t * 9 + 9));
  const extra = [];
  extra.push(...tri(0));                                         // duplicato esatto
  const b = tri(5); extra.push(...b.slice(0, 3), ...b.slice(6, 9), ...b.slice(3, 6));   // gemello a orientamento opposto (schiena a schiena)
  const a = tri(10); extra.push(...a.slice(0, 3), ...a.slice(3, 6), a[0] + 1, a[1] + 5, a[2] + 7);   // aletta sullo spigolo v0-v1
  const bad = new Float32Array(soup.length + extra.length); bad.set(soup); bad.set(extra, soup.length);
  const M1 = M2S.buildMesh(bad);
  console.log('prima: nonManifold', M1.nonManifold, 'open', M1.open);
  const fx = M2S.fixNonManifold(M1), M2 = M2S.buildMesh(fx.soup), R = M2S.fillHoles(M2), M3 = M2S.buildMesh(R.soup);
  console.log('rimossi', fx.removed, '(dup', fx.duplicates, 'alette', fx.fins, ') -> nonManifold', M2.nonManifold, 'open', M2.open, '-> dopo fillHoles open', M3.open, 'nonManifold', M3.nonManifold, 'volume', M3.volume.toFixed(4), 'originale', vol0.toFixed(4));
  const ok = M1.nonManifold > 0 && M3.nonManifold === 0 && M3.open === 0 && Math.abs(M3.volume - vol0) < 1e-3 * Math.abs(vol0) + 1e-3;
  console.log(ok ? 'OK' : 'FALLITO'); process.exit(ok ? 0 : 1);
})();
