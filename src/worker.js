/*
 * Mesh2STEP — worker.js
 * Versione: 1.4.0 — 2026-10-07 00:23 (Europe/Rome)
 * Versione precedente archiviata in archive/worker_v1.0.0_20261005-1710.js (2026-10-06: riscrittura
 * per editing, riparazione, export STL/OBJ, deviazione, corpi).
 *
 * Web Worker: parsing, analisi, editing ed export fuori dal thread UI.
 * Protocollo (main -> worker), risposta {id, ok, ...} oppure {id, ok:false, error, best?}:
 *   load    {name, buf}            -> {positions, info}
 *   repair  {}                     -> {positions, info, holes, added}   chiude i buchi
 *   analyse {opts}                 -> risultato analisi (vedi result())
 *   edit    {ids, as, maxErr}      -> risultato analisi aggiornato      (unione/conversione facce)
 *   undo    {}                     -> risultato analisi precedente
 *   step    {opts:{tol, bodies, threadCyl}}   -> {text, ...}
 *   pdf     {L, lang}              -> {buf: PDF}  [v1.4.0]
 *   stl     {}                     -> {buf}   STL binario della mesh corrente
 *   obj     {}                     -> {text}  OBJ con un gruppo per faccia riconosciuta
 */
/* global M2S, importScripts */
if (typeof M2S === 'undefined') importScripts('core.js');   // in dist il core è già concatenato

let M = null, seg = null, lastName = 'mesh', lastOpts = null;
const history = [];   // stati precedenti di seg per "Annulla" (max 20)

// ---- riassunto serializzabile di una regione (senza liste di triangoli) ----
function regionSummary(r) {
  let area = 0; for (const t of r.tris) area += M.A[t];
  const o = { id: r.id, type: r.type, nTris: r.tris.length, area, err: r.err || 0, snapped: !!r.snapped, manual: !!r.manual };
  if (r.type === 'cylinder') Object.assign(o, { radius: r.radius, axis: r.axis, origin: r.origin, height: r.height, hole: !r.outward });
  if (r.type === 'sphere') Object.assign(o, { radius: r.radius, center: r.center, hole: !r.outward });
  if (r.type === 'plane') Object.assign(o, { normal: r.normal });
  if (r.type === 'cone') Object.assign(o, { alpha: r.alpha, axis: r.axis, apex: r.apex, hole: !r.outward });
  if (r.type === 'torus') Object.assign(o, { R: r.R, r: r.r, axis: r.axis, center: r.center, hole: !r.outward });
  if (r.type === 'thread') Object.assign(o, { label: r.label, pitch: r.pitch, hand: r.hand, major: 2 * r.rmax, minor: 2 * r.rmin, length: r.length, axis: r.axis, origin: r.origin, internal: r.internal });
  if (r.type === 'bspline') Object.assign(o, { nc: r.nc });
  return o;
}

// ---- segmenti degli spigoli tra regioni diverse (overlay nel viewer) ----
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

function meshPayload() {
  const pos = new Float32Array(M.nT * 9);
  for (let t = 0; t < M.nT; t++) for (let k = 0; k < 3; k++) { const v = M.T[3 * t + k]; pos.set([M.V[3 * v], M.V[3 * v + 1], M.V[3 * v + 2]], t * 9 + k * 3); }
  const f = M2S.features(M, null);
  const info = { nT: M.nT, nV: M.nV, bodies: M.nComp, open: M.open, nonManifold: M.nonManifold, volume: M.volume, area: M.area, bbox: M.bbox, diag: M.diag, bodyList: f.bodies };
  return { pos, info };
}

// ---- risultato completo di un'analisi / modifica ----
function result(extra = {}) {
  const face = new Int32Array(seg.face), edges = boundaryLines();
  const dv = M2S.deviation(M, seg), feat = M2S.features(M, seg);
  return {
    msg: Object.assign({ face, edges, dev: dv.dev, devMax: dv.max, regions: seg.regions.map(regionSummary), stats: M2S.regionStats(seg.regions), holes: feat.holes, bodies: feat.bodies }, extra),
    transfer: [face.buffer, edges.buffer, dv.dev.buffer],
  };
}

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  const reply = (msg, transfer = []) => self.postMessage(Object.assign({ id, ok: true }, msg), transfer);
  try {
    if (cmd === 'load') {
      lastName = data.name.replace(/\.[^.]+$/, '');
      const soup = await M2S.parseFile(data.name, data.buf);
      M = M2S.buildMesh(soup); seg = null; history.length = 0;
      const { pos, info } = meshPayload();
      reply({ positions: pos, info }, [pos.buffer]);
    } else if (cmd === 'repair') {
      // [v1.4.0] prima: solo const r = M2S.fillHoles(M);  ora prima si tolgono duplicati e alette non-manifold
      const fx = M.nonManifold > 0 ? M2S.fixNonManifold(M) : { removed: 0 };
      if (fx.removed) M = M2S.buildMesh(fx.soup);
      const r = M2S.fillHoles(M);
      M = M2S.buildMesh(r.soup); seg = null; history.length = 0;
      const { pos, info } = meshPayload();
      reply({ positions: pos, info, holes: r.holes, added: r.added, removed: fx.removed }, [pos.buffer]);
    } else if (cmd === 'analyse') {
      const t0 = performance.now();
      lastOpts = data.opts; seg = M2S.segment(M, data.opts); history.length = 0;
      const { msg, transfer } = result({ ms: performance.now() - t0 });
      reply(msg, transfer);
    } else if (cmd === 'edit') {
      const next = M2S.editRegions(M, seg, data.ids, data.as, data.maxErr);
      history.push(seg); if (history.length > 20) history.shift();
      seg = next;
      const { msg, transfer } = result({ selected: next.newId });
      reply(msg, transfer);
    } else if (cmd === 'undo') {
      if (!history.length) throw new Error('err.noUndo');
      seg = history.pop();
      const { msg, transfer } = result({ canUndo: history.length > 0 });
      reply(msg, transfer);
    } else if (cmd === 'step') {
      const r = M2S.exportSTEP(M, seg, { name: lastName, tol: data.opts.tol, bodies: data.opts.bodies, threadCyl: data.opts.threadCyl });
      reply({ text: r.text, faces: r.faces, edges: r.edges, solids: r.solids, surfaces: r.surfaces, name: lastName });
    } else if (cmd === 'pdf') {   // [v1.4.0] report PDF con disegno quotato dei fori
      const r = M2S.reportPdf(M, seg, { name: lastName, L: data.L, lang: data.lang });
      reply({ buf: r.bytes.buffer, name: lastName }, [r.bytes.buffer]);
    } else if (cmd === 'stl') {
      const buf = new ArrayBuffer(84 + 50 * M.nT), dv = new DataView(buf);
      new Uint8Array(buf).set(new TextEncoder().encode('Mesh2STEP ' + lastName).slice(0, 80));
      dv.setUint32(80, M.nT, true);
      for (let t = 0; t < M.nT; t++) {
        const o = 84 + 50 * t;
        for (let k = 0; k < 3; k++) dv.setFloat32(o + 4 * k, M.N[3 * t + k], true);
        for (let v = 0; v < 3; v++) { const p = M.P(M.T[3 * t + v]); for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + 12 * v + 4 * k, p[k], true); }
      }
      reply({ buf, name: lastName }, [buf]);
    } else if (cmd === 'obj') {
      const L = ['# Mesh2STEP ' + M2S.VERSION + ' — un gruppo per faccia riconosciuta'];
      for (let v = 0; v < M.nV; v++) L.push(`v ${M.V[3 * v]} ${M.V[3 * v + 1]} ${M.V[3 * v + 2]}`);
      const regs = seg ? seg.regions : [{ id: 0, type: 'mesh', tris: [...Array(M.nT).keys()] }];
      for (const r of regs) {
        L.push(`g ${r.type}_${r.id}`);
        for (const t of r.tris) L.push(`f ${M.T[3 * t] + 1} ${M.T[3 * t + 1] + 1} ${M.T[3 * t + 2] + 1}`);
      }
      reply({ text: L.join('\n') + '\n', name: lastName });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message || String(e), best: e.best });
  }
};
