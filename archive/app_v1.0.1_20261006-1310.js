/*
 * Mesh2STEP — app.js
 * Versione: 1.0.1 — 2026-10-06 13:10 (Europe/Rome)
 * UI + viewer three.js. Tutto il calcolo pesante è nel Web Worker (worker.js + core.js).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const VERSION = '1.0.1';
const $ = id => document.getElementById(id);
$('ver').textContent = 'v' + VERSION;

// ============================ Worker ============================
// In dist/ il sorgente del worker (core+worker) è incorporato in <script id="worker-src">
function makeWorker() {
  const inl = document.getElementById('worker-src');
  if (inl) return new Worker(URL.createObjectURL(new Blob([inl.textContent], { type: 'text/javascript' })));
  return new Worker(new URL('./worker.js', import.meta.url));
}
const worker = makeWorker();
let reqId = 0; const pending = new Map();
worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); data.ok ? p.res(data) : p.rej(new Error(data.error)); };
const call = (msg, transfer = []) => new Promise((res, rej) => { const id = ++reqId; pending.set(id, { res, rej }); worker.postMessage({ id, ...msg }, transfer); });

// ============================ Stato UI ============================
const status = (txt, cls = '') => { $('status').textContent = txt; $('status').className = cls; };
const busy = on => { $('busy').classList.toggle('on', on); };
const fmt = (x, d = 3) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : Number(x)).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
let info = null, regions = null, faceOf = null, analysedTol = 0.02;

// ============================ Viewer ============================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101214);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); camera.add(sun); sun.position.set(1, 2, 3); scene.add(camera);
let meshObj = null, edgeObj = null;

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

function fit() {
  if (!meshObj) return;
  const box = new THREE.Box3().setFromObject(meshObj), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  camera.position.copy(c).add(new THREE.Vector3(1, -1.4, 0.9).normalize().multiplyScalar(d));
  camera.up.set(0, 0, 1); camera.near = d / 1000; camera.far = d * 100; camera.updateProjectionMatrix();
  controls.target.copy(c); controls.update();
}
addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && e.target.tagName !== 'INPUT') fit(); });

// colori per tipo, con leggera variazione per regione (per distinguere facce adiacenti)
const BASE = { plane: '#7d93b8', cylinder: '#3fd0b6', sphere: '#f39a4a', freeform: '#c46bd6', none: '#9aa1a8' };
function regionColor(r) {
  const c = new THREE.Color(BASE[r.type] || BASE.none), hsl = {}; c.getHSL(hsl);
  const k = ((r.id * 0.618034) % 1) - 0.5;   // variazione deterministica
  return new THREE.Color().setHSL(hsl.h + (r.type === 'freeform' ? 0 : k * 0.06), hsl.s, THREE.MathUtils.clamp(hsl.l + k * 0.18, 0.25, 0.8));
}
function paint(highlight = -1) {
  const col = meshObj.geometry.attributes.color, a = col.array, nT = a.length / 9;
  const cache = new Map(), none = new THREE.Color(BASE.none);
  for (let t = 0; t < nT; t++) {
    let c = none;
    if (faceOf) {
      const f = faceOf[t];
      if (!cache.has(f)) { const cc = regionColor(regions[f]); if (f === highlight) cc.offsetHSL(0, 0, 0.18); cache.set(f, cc); }
      c = cache.get(f);
    }
    for (let k = 0; k < 3; k++) { a[t * 9 + k * 3] = c.r; a[t * 9 + k * 3 + 1] = c.g; a[t * 9 + k * 3 + 2] = c.b; }
  }
  col.needsUpdate = true;
}

function showMesh(positions) {
  for (const o of [meshObj, edgeObj]) if (o) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  edgeObj = null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  g.computeVertexNormals();   // geometria non indicizzata -> shading piatto per triangolo
  meshObj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  scene.add(meshObj); paint(); fit();
}
function showEdges(seg) {
  if (edgeObj) { scene.remove(edgeObj); edgeObj.geometry.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(seg, 3));
  edgeObj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0b0d0f }));
  scene.add(edgeObj);
}

// ---- picking: clic (senza trascinamento) su una faccia -> dettagli ----
const ray = new THREE.Raycaster(); let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || !meshObj || !faceOf) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(meshObj)[0];
  if (!hit) { $('pick').hidden = true; paint(); return; }
  const reg = regions[faceOf[hit.faceIndex]]; paint(reg.id); showPick(reg);
});
const TYPE_IT = { plane: 'Piano', cylinder: 'Cilindro', sphere: 'Sfera', freeform: 'Freeform (sfaccettato)' };
function showPick(r) {
  const rows = [['Tipo', TYPE_IT[r.type] + (r.hole ? ' · foro' : '')], ['Triangoli', r.nTris], ['Area', fmt(r.area, 2) + ' mm²']];
  if (r.type === 'cylinder') rows.push(['Diametro', 'Ø ' + fmt(2 * r.radius) + ' mm'], ['Lunghezza', fmt(r.height, 2) + ' mm'], ['Asse', r.axis.map(v => fmt(v, 3)).join(' ; ')], ['Scarto max', fmt(r.err, 4) + ' mm']);
  if (r.type === 'sphere') rows.push(['Raggio', 'R ' + fmt(r.radius) + ' mm'], ['Centro', r.center.map(v => fmt(v, 2)).join(' ; ')], ['Scarto max', fmt(r.err, 4) + ' mm']);
  if (r.type === 'plane') rows.push(['Normale', r.normal.map(v => fmt(v, 3)).join(' ; ')]);
  $('pick').innerHTML = '<dl class="kv">' + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
  $('pick').hidden = false;
}

// ============================ Caricamento ============================
async function loadFile(file) {
  try {
    busy(true); status('Lettura di ' + file.name + '…');
    const buf = await file.arrayBuffer();
    const r = await call({ cmd: 'load', name: file.name, buf }, [buf]);
    info = r.info; regions = null; faceOf = null;
    $('results').hidden = true; $('pick').hidden = true; $('drop').textContent = '';
    showMesh(r.positions);
    const size = info.bbox[1].map((v, i) => v - info.bbox[0][i]);
    const closed = info.open === 0 && info.nonManifold === 0;
    $('meshinfo').innerHTML = [
      ['File', file.name], ['Triangoli', info.nT.toLocaleString('it-IT')], ['Corpi', info.bodies],
      ['Dimensioni', size.map(v => fmt(v, 1)).join(' × ') + ' mm'],
      ['Chiusa', closed ? 'sì' : `no (${info.open} bordi aperti, ${info.nonManifold} non-manifold)`],
      ['Volume', closed ? fmt(Math.abs(info.volume) / 1000, 2) + ' cm³' : '—'],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('meshinfo').hidden = false;
    $('analyse').disabled = false; $('step').disabled = true;
    // tolleranza suggerita: 0,02 mm per pezzi piccoli, scala con la diagonale per pezzi grandi
    $('tol').value = Math.min(0.2, Math.max(0.01, +(info.diag * 1e-4).toFixed(3)));
    status(closed ? 'Mesh caricata. Premi «Analizza mesh».' : 'Mesh aperta: lo STEP sarà una superficie, non un solido.', closed ? '' : 'warn');
    analyse();   // analisi automatica con i parametri suggeriti
  } catch (e) { status('Errore: ' + e.message, 'err'); }
  finally { busy(false); }
}
$('open').onclick = () => $('file').click();
$('file').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
const view = $('view');
['dragenter', 'dragover'].forEach(ev => addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

// ============================ Analisi ============================
async function analyse() {
  try {
    busy(true); $('analyse').disabled = true; status('Riconoscimento superfici…');
    const opts = { tol: +$('tol').value, angle: +$('ang').value, cylinders: $('cyl').checked, spheres: $('sph').checked };
    const r = await call({ cmd: 'analyse', opts });
    analysedTol = opts.tol; regions = r.regions; faceOf = r.face;
    paint(); showEdges(r.edges); $('pick').hidden = true;
    const s = r.stats;
    $('legend').innerHTML = [['plane', 'Piani', s.plane], ['cylinder', 'Cilindri', s.cylinder], ['sphere', 'Sfere', s.sphere], ['freeform', 'Freeform (triangoli)', s.freeformTris]]
      .map(([k, l, n]) => `<div><span class="sw" style="background:${BASE[k]}"></span>${l}<b>${n}</b></div>`).join('');
    // tabella fori/alberi raggruppata per diametro (tolleranza 0,01 mm)
    const groups = new Map();
    for (const g of regions.filter(x => x.type === 'cylinder')) {
      const key = (g.hole ? 'Foro' : 'Albero/raccordo') + '|' + (2 * g.radius).toFixed(2);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    $('holes').innerHTML = groups.size ? '<table><tr><th>Cilindri</th><th>Ø mm</th><th>n.</th></tr>' +
      [...groups].sort((a, b) => parseFloat(a[0].split('|')[1]) - parseFloat(b[0].split('|')[1])).map(([k, n]) => { const [t, d] = k.split('|'); return `<tr><td>${t}</td><td>${d.replace('.', ',')}</td><td>${n}</td></tr>`; }).join('') + '</table>' : '';
    $('results').hidden = false; $('step').disabled = false;
    const freePct = info.nT ? s.freeformTris / info.nT : 0;
    status(`Analisi completata in ${fmt(r.ms / 1000, 2)} s.` + (freePct > 0.5 ? ' Molte zone freeform: prova ad aumentare la tolleranza.' : ''), freePct > 0.5 ? 'warn' : '');
  } catch (e) { status('Errore: ' + e.message, 'err'); }
  finally { busy(false); $('analyse').disabled = false; }
}
$('analyse').onclick = analyse;

// ============================ Export STEP ============================
$('step').onclick = async () => {
  try {
    busy(true); status('Generazione STEP…');
    const r = await call({ cmd: 'step', opts: { tol: analysedTol } });
    const url = URL.createObjectURL(new Blob([r.text], { type: 'application/step' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: r.name + '.step' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    status(`STEP salvato: ${r.faces} facce (${r.edges.circle} spigoli circolari, ${r.edges.line} rettilinei)` + (r.solids ? `, ${r.solids} solido/i.` : ', superficie aperta.'));
  } catch (e) { status('Errore: ' + e.message, 'err'); }
  finally { busy(false); }
};
