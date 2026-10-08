/*
 * Mesh2STEP — worker.js
 * Versione: 1.8.0 — 2026-10-08 23:30 (Europe/Rome)
 * Versione precedente archiviata in archive/worker_v1.0.0_20261005-1710.js (2026-10-06: riscrittura
 * per editing, riparazione, export STL/OBJ, deviazione, corpi).
 *
 * Web Worker: parsing, analisi, editing ed export fuori dal thread UI.
 * Protocollo (main -> worker), risposta {id, ok, ...} oppure {id, ok:false, error, best?}:
 *   load    {name, buf}            -> {positions, info}
 *   repair  {}                     -> {positions, info, holes, added}   chiude i buchi
 *   repairSelf {}                  -> {positions, info, ok, reason, before, after, merged, kept}  unione booleana dei corpi sovrapposti [v1.7.0]
 *   analyse {opts}                 -> risultato analisi (vedi result())
 *   edit    {ids, as, maxErr}      -> risultato analisi aggiornato      (unione/conversione facce)
 *   hole    {region, mode, size, dia}  -> risultato analisi + {positions, info, diameter, label}  modifica del diametro di un foro [v1.8.0]
 *   undo    {}                     -> risultato analisi precedente (+ positions/info se l'ultima modifica era un foro)
 *   step    {opts:{tol, bodies, threadCyl}}   -> {text, ...}
 *   pdf     {L, lang}              -> {buf: PDF}  [v1.4.0]
 *   stl     {}                     -> {buf}   STL binario della mesh corrente
 *   obj     {}                     -> {text}  OBJ con un gruppo per faccia riconosciuta
 */
/* global M2S, importScripts */
if (typeof M2S === 'undefined') importScripts('core.js');   // in dist il core è già concatenato

let M = null, seg = null, lastName = 'mesh', lastOpts = null;

// [v1.7.0] manifold-3d (WebAssembly, vendor/) caricato solo alla prima riparazione di auto-intersezioni. import() dinamico: vale anche
// nei worker classici. self.M2S_MANIFOLD_EMBED = { js, wasm(base64) } lo scrive build.mjs nella build single-file (dist).
let manifoldP = null;
function loadManifold() {
  if (!manifoldP) manifoldP = (async () => {
    let cfg = {};
    if (self.M2S_MANIFOLD_EMBED) {   // build single-file: modulo e wasm incorporati (testo + base64), si ricreano come URL Blob / ArrayBuffer
      const E = self.M2S_MANIFOLD_EMBED;
      cfg = { js: URL.createObjectURL(new Blob([E.js], { type: 'text/javascript' })), wasm: Uint8Array.from(atob(E.wasm), ch => ch.charCodeAt(0)).buffer };
    }
    const mod = await import(cfg.js || '../vendor/manifold.js');
    // wasmBinary + locateFile fittizio: da un modulo blob: `new URL('manifold.wasm', import.meta.url)` non è valido
    const w = await mod.default(cfg.wasm ? { wasmBinary: cfg.wasm, locateFile: f => f } : {}); w.setup(); return w;
  })().catch(e => { manifoldP = null; throw e; });
  return manifoldP;
}
const history = [];   // stati precedenti di seg per "Annulla" (max 20)

// ---- riassunto serializzabile di una regione (senza liste di triangoli) ----
function regionSummary(r) {
  let area = 0; for (const t of r.tris) area += M.A[t];
  const o = { id: r.id, type: r.type, nTris: r.tris.length, area, err: r.err || 0, snapped: !!r.snapped, manual: !!r.manual };
  if (r.type === 'cylinder') Object.assign(o, { radius: r.radius, axis: r.axis, origin: r.origin, height: r.height, hole: !r.outward, threadLabel: r.threadLabel });
  if (r.type === 'sphere') Object.assign(o, { radius: r.radius, center: r.center, hole: !r.outward });
  if (r.type === 'plane') Object.assign(o, { normal: r.normal });
  if (r.type === 'cone') Object.assign(o, { alpha: r.alpha, axis: r.axis, apex: r.apex, hole: !r.outward });
  if (r.type === 'torus') Object.assign(o, { R: r.R, r: r.r, axis: r.axis, center: r.center, hole: !r.outward });
  if (r.type === 'thread') Object.assign(o, { label: r.label, pitch: r.pitch, hand: r.hand, major: 2 * r.rmax, minor: 2 * r.rmin, length: r.length, axis: r.axis, origin: r.origin, internal: r.internal });
  // [v1.5.0] prima: Object.assign(o, { nc: r.nc });
  if (r.type === 'bspline') Object.assign(o, { nc: r.nc, nv: r.nv || r.nc, closedU: !!r.closedU });
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
  const si = M2S.findSelfIntersections(M);   // [v1.5.0] auto-intersezioni (solo rilevamento)
  const info = { selfInt: si.count, selfIntPartial: si.partial, nT: M.nT, nV: M.nV, bodies: M.nComp, open: M.open, nonManifold: M.nonManifold, volume: M.volume, area: M.area, bbox: M.bbox, diag: M.diag, bodyList: f.bodies };
  return { pos, info };
}

// ---- risultato completo di un'analisi / modifica ----
function result(extra = {}) {
  const face = new Int32Array(seg.face), edges = boundaryLines();
  const dv = M2S.deviation(M, seg), feat = M2S.features(M, seg);
  return {
    msg: Object.assign({ face, edges, dev: dv.dev, devMax: dv.max, devThr: dv.devThr, devThrMax: dv.maxThr, regions: seg.regions.map(regionSummary), stats: M2S.regionStats(seg.regions), holes: feat.holes, bodies: feat.bodies }, extra),
    transfer: [face.buffer, edges.buffer, dv.dev.buffer, dv.devThr.buffer],
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
    } else if (cmd === 'repairSelf') {   // [v1.7.0] unione booleana dei corpi sovrapposti
      const r = M2S.repairSelfIntersections(M, await loadManifold());
      if (r.ok) { M = M2S.buildMesh(r.soup); seg = null; history.length = 0; }
      const { pos, info } = meshPayload();
      reply({ positions: pos, info, ok: r.ok, reason: r.reason || '', before: r.before, after: r.after, merged: r.merged, kept: r.kept }, [pos.buffer]);
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
    } else if (cmd === 'hole') {   // [v1.8.0] cambia il diametro di un foro: la mesh cambia, quindi Annulla ripristina anche M
      const r = M2S.resizeHole(M, seg, data.region, data.mode, data.size, data.dia);
      history.push({ hole: true, seg, M }); if (history.length > 20) history.shift();
      M = r.M; seg = { face: r.seg.face, regions: r.seg.regions, opts: r.seg.opts };
      const { pos, info } = meshPayload();
      const { msg, transfer } = result({ positions: pos, info, diameter: r.diameter, label: r.label, selected: r.newId, canUndo: true });
      reply(msg, transfer.concat([pos.buffer]));
    } else if (cmd === 'undo') {
      if (!history.length) throw new Error('err.noUndo');
      // [2026-10-08 v1.8.0] prima: seg = history.pop();  (le voci 'hole' portano anche la mesh precedente)
      const h = history.pop(); let extra = { canUndo: history.length > 0 }, tr = [];
      if (h.hole) { M = h.M; seg = h.seg; const { pos, info } = meshPayload(); extra = Object.assign(extra, { positions: pos, info }); tr = [pos.buffer]; }
      else seg = h;
      const { msg, transfer } = result(extra);
      reply(msg, transfer.concat(tr));
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
