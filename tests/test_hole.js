// Mesh2STEP — tests/test_hole.js
// Versione: 1.8.0 — 2026-10-08 23:30
// Modifica foro: plate_hole (foro Ø da tabella) portato a M6 gioco (6,6), M6 maschiatura (5) e Ø libero; countersink; collisione.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
const load = async n => { const b = fs.readFileSync(path.join(__dirname, 'samples', n)); return M2S.buildMesh(await M2S.parseFile(n, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); };
let fail = 0; const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail = 1; };
(async () => {
  const opts = { tol: 0.02, angle: 25, cylinders: true, spheres: true };
  let M = await load('plate_hole.stl'), seg = M2S.segment(M, opts);
  const h0 = seg.regions.find(r => r.type === 'cylinder' && !r.outward);
  console.log('foro iniziale Ø', (2 * h0.radius).toFixed(3), 'volume', M.volume.toFixed(3));
  for (const [mode, size, dia, exp, lab] of [['clearance', 6, 0, 6.6, null], ['tap', 6, 0, 5, null], ['thread', 8, 0, 6.8, 'M8'], ['diameter', 0, 4.2, 4.2, null]]) {
    const r = M2S.resizeHole(M, seg, h0.id, mode, size, dia);
    const nCyl = r.seg.regions.filter(x => x.type === 'cylinder').length, nPl = r.seg.regions.filter(x => x.type === 'plane').length;
    chk(Math.abs(r.diameter - exp) < 0.02, `${mode}: Ø ${r.diameter.toFixed(3)} atteso ${exp}`);
    chk(nCyl === 1 && nPl === 6, `${mode}: ${nPl} piani + ${nCyl} cilindro`);
    chk((r.label || null) === lab, `${mode}: etichetta ${r.label}`);
    const vExp = M.volume + Math.PI * ((h0.radius) ** 2 - (exp / 2) ** 2) * h0.height;   // volume = originale + foro tolto/aggiunto
    chk(Math.abs(r.M.volume - vExp) < 0.01 * Math.abs(vExp) + 1, `${mode}: volume ${r.M.volume.toFixed(2)} (atteso ~${vExp.toFixed(2)})`);
    const st = M2S.exportSTEP(r.M, r.seg, { name: 'h_' + mode });
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'out', `plate_hole_${mode}.step`), st.text);
  }
  // collisione: foro più largo della piastra
  let thrown = null; try { M2S.resizeHole(M, seg, h0.id, 'diameter', 0, 60); } catch (e) { thrown = e.message; }
  chk(thrown === 'err.holeCollision', 'foro troppo grande -> ' + thrown);
  // non-foro
  thrown = null; try { M2S.resizeHole(M, seg, seg.regions.find(r => r.type === 'plane').id, 'tap', 6, 0); } catch (e) { thrown = e.message; }
  chk(thrown === 'err.notHole', 'piano rifiutato -> ' + thrown);
  // svasatura: foro con cono vicino
  M = await load('countersink.stl'); seg = M2S.segment(M, opts);
  const h1 = seg.regions.find(r => r.type === 'cylinder' && !r.outward);
  const r2 = M2S.resizeHole(M, seg, h1.id, 'tap', 5, 0);
  chk(Math.abs(r2.diameter - 4.2) < 0.02, 'countersink: Ø ' + r2.diameter.toFixed(3));
  chk(r2.seg.regions.some(x => x.type === 'cone') || r2.seg.regions.some(x => x.type === 'freeform'), 'countersink: cono rifittato o sfaccettato');
  fs.writeFileSync(path.join(__dirname, 'out', 'countersink_tap.step'), M2S.exportSTEP(r2.M, r2.seg, { name: 'cs' }).text);
  console.log(fail ? 'FALLITO' : 'OK'); process.exit(fail);
})();
