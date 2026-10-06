// Mesh2STEP — tests/test_pdf.js
// Versione: 1.4.0 — 2026-10-07
// Genera il report PDF per alcuni campioni in tests/out/*_report.pdf e ne controlla la struttura (header, xref, conteggio fori).
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
const L = { title: 'Report fori', file: 'File', size: 'Ingombro', view: 'vista asse', holes: 'Fori', type: 'Tipo', depth: 'Prof.', axis: 'Asse', through: 'passante', blind: 'cieco', none: 'Nessun foro', threads: 'Filettature', thread: 'Filetto', pitch: 'Passo', len: 'Lunghezza', hand: 'Senso', internal: 'interna', external: 'esterna', right: 'destra', left: 'sinistra', shafts: 'Alberi', count: 'n.', footer: 'misure in mm' };
(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  let ok = true;
  for (const [f, wantHoles] of [['plate_hole.stl', 1], ['countersink.stl', 1], ['block.stl', 2], ['bolt_m6.stl', 0]]) {
    const buf = fs.readFileSync(path.join(__dirname, 'samples', f));
    const soup = await M2S.parseFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const { M, seg } = M2S.analyse(soup, { tol: 0.02, angle: 1, cylinders: true, spheres: true, cones: true, tori: true, threads: true, nurbs: true });
    const r = M2S.reportPdf(M, seg, { name: f, L });
    const txt = Buffer.from(r.bytes).toString('latin1');
    const xr = +txt.match(/startxref\n(\d+)/)[1], okx = txt.slice(xr, xr + 4) === 'xref';
    const good = txt.startsWith('%PDF-1.4') && txt.trimEnd().endsWith('%%EOF') && r.holes === wantHoles && r.inView === wantHoles && okx;
    fs.writeFileSync(path.join(__dirname, 'out', path.parse(f).name + '_report.pdf'), r.bytes);
    console.log(f, 'fori', r.holes, 'in vista', r.inView, 'byte', r.bytes.length, good ? 'OK' : 'FALLITO'); ok = ok && good;
  }
  process.exit(ok ? 0 : 1);
})();
