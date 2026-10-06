/*
 * Mesh2STEP — worker.js
 * Versione: 1.0.0 — 2026-10-05 17:10 (Europe/Rome)
 * Web Worker: esegue parsing, analisi ed export fuori dal thread UI.
 * Protocollo messaggi (main -> worker):
 *   {id, cmd:'load',    name, buf}  -> {positions, info}
 *   {id, cmd:'analyse', opts}       -> {face, regions, stats, edges}
 *   {id, cmd:'step',    opts}       -> {text, faces, edges}
 */
/* global M2S, importScripts */
if (typeof M2S === 'undefined') importScripts('core.js');   // in dist il core è già concatenato

let M = null, seg = null, lastName = 'mesh';

// riassunto serializzabile delle regioni (senza liste triangoli)
function regionSummary(r) {
  let area = 0; for (const t of r.tris) area += M.A[t];
  const o = { id: r.id, type: r.type, nTris: r.tris.length, area };
  if (r.type === 'cylinder') Object.assign(o, { radius: r.radius, axis: r.axis, origin: r.origin, height: r.height, hole: !r.outward, err: r.err });
  if (r.type === 'sphere') Object.assign(o, { radius: r.radius, center: r.center, hole: !r.outward, err: r.err });
  if (r.type === 'plane') Object.assign(o, { normal: r.normal });
  return o;
}

// segmenti degli spigoli tra regioni diverse (per l'overlay nel viewer)
function boundaryLines() {
  const out = [];
  for (let e = 0; e < M.E0.length; e++) {
    const ts = M.ET[e];
    if (ts.length === 2 && seg.face[ts[0]] === seg.face[ts[1]]) continue;
    const a = M.P(M.E0[e]), b = M.P(M.E1[e]);
    out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return new Float32Array(out);
}

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  try {
    if (cmd === 'load') {
      lastName = data.name.replace(/\.[^.]+$/, '');
      const soup = await M2S.parseFile(data.name, data.buf);
      M = M2S.buildMesh(soup); seg = null;
      const pos = new Float32Array(M.nT * 9);
      for (let t = 0; t < M.nT; t++) for (let k = 0; k < 3; k++) { const v = M.T[3 * t + k]; pos.set([M.V[3 * v], M.V[3 * v + 1], M.V[3 * v + 2]], t * 9 + k * 3); }
      const info = { nT: M.nT, nV: M.nV, bodies: M.nComp, open: M.open, nonManifold: M.nonManifold, volume: M.volume, area: M.area, bbox: M.bbox, diag: M.diag };
      self.postMessage({ id, ok: true, positions: pos, info }, [pos.buffer]);
    } else if (cmd === 'analyse') {
      const t0 = performance.now();
      seg = M2S.segment(M, data.opts);
      const face = new Int32Array(seg.face), edges = boundaryLines();
      self.postMessage({ id, ok: true, face, edges, regions: seg.regions.map(regionSummary), stats: seg.stats, ms: performance.now() - t0 }, [face.buffer, edges.buffer]);
    } else if (cmd === 'step') {
      const r = M2S.exportSTEP(M, seg, { name: lastName, tol: data.opts.tol });
      self.postMessage({ id, ok: true, text: r.text, faces: r.faces, edges: r.edges, solids: r.solids, surfaces: r.surfaces, name: lastName });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message || String(e) });
  }
};
