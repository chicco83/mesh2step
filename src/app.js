/*
 * Mesh2STEP — app.js
 * Versione: 1.9.0 — 2026-10-09 09:53 (Europe/Rome)
 * Versione precedente archiviata: archive/app_v1.0.1_20261006-1310.js
 * (2026-10-06: riscritta per editing facce, corpi, report CSV, export STL/OBJ, heatmap deviazione,
 *  viste, IT/EN, tema chiaro, condivisione, PWA e API di integrazione).
 *
 * UI + viewer three.js. Tutto il calcolo pesante è nel Web Worker (worker.js + core.js).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// [2026-10-07 v1.5.0] const VERSION = '1.4.1';
// [2026-10-07 v1.5.1] const VERSION = '1.5.0';
// [2026-10-07 v1.6.0] const VERSION = '1.5.1';
// [2026-10-07 v1.7.0] const VERSION = '1.6.0';
// [2026-10-08 v1.8.0] const VERSION = '1.7.0';
// [2026-10-09 09:53 v1.9.0] const VERSION = '1.8.0';
const VERSION = '1.9.0';
const $ = id => document.getElementById(id);
const store = { get: k => { try { return localStorage.getItem('m2s.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('m2s.' + k, v); } catch { /* storage non disponibile */ } } };

// ============================ i18n (IT/EN) ============================
const DICT = {
  it: {
    tagline: 'Da mesh triangolare a solido CAD', s_file: 'File', open: 'Apri mesh (STL, OBJ, 3MF)', repair: 'Chiudi i buchi della mesh', repair_self: 'Ripara auto-intersezioni (unisci i corpi)', selfint_fixed: 'Auto-intersezioni riparate: {m} corpi uniti, da {b} coppie a {a}.', selfint_fail_internal: 'Riparazione non riuscita: restano {a} intersezioni dentro un corpo (guscio ripiegato su se stesso). La mesh non è stata modificata.', selfint_fail_nobody: 'Riparazione non possibile: nessun corpo chiuso e manifold (usa prima «Chiudi i buchi»).',
    s_detect: 'Riconoscimento', tol: 'Tolleranza (mm)', angle: 'Angolo (°)', snap: 'Arrotonda a valori nominali (Ø, assi, angoli)', analyse: 'Analizza mesh',
    s_result: 'Risultato', csv: 'Scarica report CSV', s_edit: 'Modifica facce',
    edit_hint: 'Tocca una faccia per selezionarla; con «Selezione multipla» (o Shift/Ctrl+clic) ne aggiungi altre.',
    multi: 'Selezione multipla', clearsel: 'Deseleziona', as_auto: 'Automatico (unisci)', apply: 'Applica', maxerr: 'Scarto max accettato (mm)', undo: 'Annulla ultima modifica',
    s_bodies: 'Corpi', s_export: 'Export', step: 'Scarica STEP', obj: 'OBJ (gruppi)', share: 'Condividi STEP',
    privacy: "I file restano sul tuo dispositivo: l'elaborazione avviene nel browser.", nav: 'Ruota: trascina · Zoom: rotella/pizzica · Sposta: tasto destro o Shift · Adatta: F',
    nav_hint: 'Trascina: ruota · Tasto destro (o Ctrl+trascina): sposta · Rotella: zoom · Clic: seleziona · F: adatta', drop: 'Trascina qui un file STL, OBJ o 3MF oppure usa «Apri mesh»', v_top: 'Alto', v_front: 'Fronte', v_right: 'Destra', v_edges: 'Contorni', v_dev: 'Deviazione', dev_title: 'Deviazione mesh ↔ superficie',
    t_plane: 'Piano', t_cylinder: 'Cilindro', t_cone: 'Cono', t_sphere: 'Sfera', t_torus: 'Toro', t_thread: 'Filettatura', t_bspline: 'B-spline', t_freeform: 'Freeform',
    t_plane_p: 'Piani', t_cylinder_p: 'Cilindri', t_cone_p: 'Coni', t_sphere_p: 'Sfere', t_torus_p: 'Tori', t_thread_p: 'Filettature', t_bspline_p: 'B-spline', t_freeform_p: 'Freeform (triangoli)',
    f_name: 'File', f_tris: 'Triangoli', f_bodies: 'Corpi', f_size: 'Dimensioni', f_closed: 'Chiusa', f_selfint: 'Auto-intersezioni', closed_u: '(chiusa)', selfint_n: '{n} coppie di triangoli{p}', selfint_warn: 'La mesh si auto-interseca ({n} coppie{p}): volume e riconoscimento possono essere inaffidabili. Correggi il modello nel programma d\'origine (unione booleana).', f_volume: 'Volume', yes: 'sì', no_open: 'no ({o} bordi aperti, {n} non-manifold)',
    reading: 'Lettura di {f}…', selfint_busy: 'Unione dei corpi sovrapposti…', loaded: 'Mesh caricata.', open_warn: 'Mesh aperta: usa «Chiudi i buchi» oppure lo STEP sarà una superficie.', analysing: 'Riconoscimento superfici…',
    done: 'Analisi completata in {s} s.', many_free: ' Molte zone freeform: prova ad aumentare la tolleranza.', step_gen: 'Generazione STEP…',
    step_ok: 'STEP salvato: {f} facce ({c} spigoli circolari, {l} rettilinei), {s} solido/i.', step_surf: 'STEP salvato: {f} facce, superficie aperta.',
    pdf: 'Report PDF', o_thrcyl: 'Filettature come cilindro nominale (STEP)', pdf_title: 'Report fori', pdf_file: 'File', pdf_size: 'Ingombro', pdf_view: 'vista asse', pdf_type: 'Tipo', pdf_axis: 'Asse', pdf_none: 'Nessun foro', pdf_thread: 'Filetto', pdf_len: 'Lunghezza', pdf_hand: 'Senso', pdf_internal: 'interna', pdf_external: 'esterna', pdf_right: 'destra', pdf_left: 'sinistra', pdf_count: 'n.', pdf_footer: 'misure in mm; X/Y dall\'angolo in basso a sinistra della vista',
    repaired: 'Chiusi {h} buchi con {a} triangoli.', repaired_nm: 'Rimossi {n} triangoli non-manifold (duplicati/alette); chiusi {h} buchi con {a} triangoli.', no_holes: 'Nessun buco da chiudere.', err: 'Errore: ',
    'err.notConnected': 'le facce selezionate non sono contigue', 'err.fit': 'nessuna superficie entro lo scarto richiesto (migliore: {b} mm)', 'err.noUndo': 'niente da annullare', 'err.empty': 'nessuna faccia selezionata',
    sel_n: '{n} facce selezionate ({t} triangoli)', edited: 'Modifica applicata.', undone: 'Modifica annullata.',
    k_type: 'Tipo', k_tris: 'Triangoli', k_area: 'Area', k_dia: 'Diametro', k_len: 'Lunghezza', k_axis: 'Asse', k_err: 'Scarto max', k_rad: 'Raggio', k_center: 'Centro', k_normal: 'Normale',
    k_angle: 'Semi-angolo', k_R: 'Raggio maggiore', k_r: 'Raggio minore', k_pitch: 'Passo', k_hand: 'Senso', k_major: 'Ø esterno', k_minor: 'Ø nocciolo', k_ctrl: 'Punti di controllo',
    hole: 'foro', snapped: 'arrotondato', manual: 'manuale', hand_R: 'destro', hand_L: 'sinistro', internal: 'interno', external: 'esterno',
    h_holes: 'Fori', h_dia: 'Ø mm', h_depth: 'Prof.', h_n: 'n.', through: 'passante', blind: 'cieco', shafts: 'Alberi/raccordi', h_threads: 'Filettature',
    b_name: 'Nome', b_closed: 'chiuso', b_open: 'aperto',
    hole_title: 'Modifica foro', hole_hint: 'Cambia il diametro del foro selezionato (la mesh viene modificata; si può annullare).', hm_clear: 'Foro di gioco', hm_tap: 'Foro di maschiatura', hm_thread: 'Filettatura (maschiatura + etichetta)', hm_dia: 'Diametro libero', hole_apply: 'Applica al foro',
    hole_prev: 'Ø attuale {a} mm → nuovo Ø {b} mm', hole_done: 'Foro modificato: Ø {d} mm{l}.', k_label: 'Etichetta',
    'err.notHole': 'la faccia selezionata non è un foro', 'err.holeSize': 'misura del foro non valida', 'err.holeMode': 'modo non valido', 'err.holeCollision': 'il nuovo diametro urta altre facce (troppo grande per il materiale intorno)',
    verify: 'Verifica STEP', v_ok: 'STEP verificato: {f} facce, {e} spigoli, {l} anelli, {s} solido/i — nessun errore.', v_okw: 'STEP verificato con avvisi: {f} facce, {e} spigoli.', v_fail: 'STEP NON valido: {n} problemi.', v_note: 'Controllo leggero (struttura, riferimenti, anelli, spigoli accoppiati). Per la validità completa apri il file in un CAD.',
    'step.noHeader': 'manca l\'intestazione ISO-10303-21', 'step.noFooter': 'manca la chiusura END-ISO-10303-21', 'step.noEndsec': 'manca ENDSEC', 'step.noData': 'manca la sezione DATA', 'step.badNumber': 'numeri non validi (NaN/Infinity)',
    'step.dupId': 'id duplicato', 'step.dangling': 'riferimento a entità inesistente', 'step.loopRef': 'anello con spigoli non validi', 'step.loopOpen': 'anello non chiuso', 'step.faceNoBound': 'faccia senza bordo',
    'step.shellFace': 'guscio con faccia inesistente', 'step.shellNotClosed': 'guscio chiuso con spigoli non accoppiati', 'step.shellEdge': 'spigolo usato più di due volte', 'step.noFaces': 'nessuna faccia', 'step.openBoundary': 'bordo aperto (spigoli usati una volta)',
    csv_head: 'tipo;diametro_mm;profondita_mm;passante;asse_x;asse_y;asse_z;pos_x;pos_y;pos_z;note',
  },
  en: {
    tagline: 'From triangle mesh to CAD solid', s_file: 'File', open: 'Open mesh (STL, OBJ, 3MF)', repair: 'Close mesh holes', repair_self: 'Fix self-intersections (merge bodies)', selfint_fixed: 'Self-intersections fixed: {m} bodies merged, from {b} pairs to {a}.', selfint_fail_internal: 'Repair failed: {a} intersections remain inside one body (shell folded onto itself). The mesh was not changed.', selfint_fail_nobody: 'Cannot repair: no closed manifold body (use "Close mesh holes" first).',
    s_detect: 'Recognition', tol: 'Tolerance (mm)', angle: 'Angle (°)', snap: 'Round to nominal values (Ø, axes, angles)', analyse: 'Analyse mesh',
    s_result: 'Result', csv: 'Download CSV report', s_edit: 'Edit faces',
    edit_hint: 'Tap a face to select it; with "Multi-select" (or Shift/Ctrl+click) you add more.',
    multi: 'Multi-select', clearsel: 'Clear selection', as_auto: 'Automatic (merge)', apply: 'Apply', maxerr: 'Max accepted deviation (mm)', undo: 'Undo last edit',
    s_bodies: 'Bodies', s_export: 'Export', step: 'Download STEP', obj: 'OBJ (groups)', share: 'Share STEP',
    privacy: 'Your files stay on your device: processing happens in the browser.', nav: 'Rotate: drag · Zoom: wheel/pinch · Pan: right button or Shift · Fit: F',
    nav_hint: 'Drag: rotate · Right button (or Ctrl+drag): pan · Wheel: zoom · Click: select · F: fit', drop: 'Drop an STL, OBJ or 3MF file here or use "Open mesh"', v_top: 'Top', v_front: 'Front', v_right: 'Right', v_edges: 'Edges', v_dev: 'Deviation', dev_title: 'Mesh ↔ surface deviation',
    t_plane: 'Plane', t_cylinder: 'Cylinder', t_cone: 'Cone', t_sphere: 'Sphere', t_torus: 'Torus', t_thread: 'Thread', t_bspline: 'B-spline', t_freeform: 'Freeform',
    t_plane_p: 'Planes', t_cylinder_p: 'Cylinders', t_cone_p: 'Cones', t_sphere_p: 'Spheres', t_torus_p: 'Tori', t_thread_p: 'Threads', t_bspline_p: 'B-splines', t_freeform_p: 'Freeform (triangles)',
    f_name: 'File', f_tris: 'Triangles', f_bodies: 'Bodies', f_size: 'Size', f_closed: 'Closed', f_selfint: 'Self-intersections', closed_u: '(closed)', selfint_n: '{n} triangle pairs{p}', selfint_warn: 'The mesh intersects itself ({n} pairs{p}): volume and recognition may be unreliable. Fix the model in the source program (boolean union).', f_volume: 'Volume', yes: 'yes', no_open: 'no ({o} open edges, {n} non-manifold)',
    reading: 'Reading {f}…', selfint_busy: 'Merging overlapping bodies…', loaded: 'Mesh loaded.', open_warn: 'Open mesh: use "Close mesh holes" or the STEP will be a surface.', analysing: 'Recognising surfaces…',
    done: 'Analysis done in {s} s.', many_free: ' Many freeform areas: try a larger tolerance.', step_gen: 'Generating STEP…',
    step_ok: 'STEP saved: {f} faces ({c} circular, {l} straight edges), {s} solid(s).', step_surf: 'STEP saved: {f} faces, open surface.',
    pdf: 'PDF report', o_thrcyl: 'Threads as nominal cylinder (STEP)', pdf_title: 'Hole report', pdf_file: 'File', pdf_size: 'Overall size', pdf_view: 'view axis', pdf_type: 'Type', pdf_axis: 'Axis', pdf_none: 'No holes', pdf_thread: 'Thread', pdf_len: 'Length', pdf_hand: 'Hand', pdf_internal: 'internal', pdf_external: 'external', pdf_right: 'right', pdf_left: 'left', pdf_count: 'no.', pdf_footer: 'dimensions in mm; X/Y from the lower-left corner of the view',
    repaired: 'Closed {h} holes with {a} triangles.', repaired_nm: 'Removed {n} non-manifold triangles (duplicates/fins); closed {h} holes with {a} triangles.', no_holes: 'No holes to close.', err: 'Error: ',
    'err.notConnected': 'the selected faces are not contiguous', 'err.fit': 'no surface within the requested deviation (best: {b} mm)', 'err.noUndo': 'nothing to undo', 'err.empty': 'no face selected',
    sel_n: '{n} faces selected ({t} triangles)', edited: 'Edit applied.', undone: 'Edit undone.',
    k_type: 'Type', k_tris: 'Triangles', k_area: 'Area', k_dia: 'Diameter', k_len: 'Length', k_axis: 'Axis', k_err: 'Max deviation', k_rad: 'Radius', k_center: 'Centre', k_normal: 'Normal',
    k_angle: 'Half angle', k_R: 'Major radius', k_r: 'Minor radius', k_pitch: 'Pitch', k_hand: 'Hand', k_major: 'Major Ø', k_minor: 'Minor Ø', k_ctrl: 'Control points',
    hole: 'hole', snapped: 'rounded', manual: 'manual', hand_R: 'right', hand_L: 'left', internal: 'internal', external: 'external',
    h_holes: 'Holes', h_dia: 'Ø mm', h_depth: 'Depth', h_n: 'no.', through: 'through', blind: 'blind', shafts: 'Shafts/fillets', h_threads: 'Threads',
    b_name: 'Name', b_closed: 'closed', b_open: 'open',
    hole_title: 'Edit hole', hole_hint: 'Changes the diameter of the selected hole (the mesh is modified; can be undone).', hm_clear: 'Clearance hole', hm_tap: 'Tap drill hole', hm_thread: 'Thread (tap drill + label)', hm_dia: 'Free diameter', hole_apply: 'Apply to hole',
    hole_prev: 'Current Ø {a} mm → new Ø {b} mm', hole_done: 'Hole changed: Ø {d} mm{l}.', k_label: 'Label',
    'err.notHole': 'the selected face is not a hole', 'err.holeSize': 'invalid hole size', 'err.holeMode': 'invalid mode', 'err.holeCollision': 'the new diameter hits other faces (too large for the surrounding material)',
    verify: 'Verify STEP', v_ok: 'STEP verified: {f} faces, {e} edges, {l} loops, {s} solid(s) — no errors.', v_okw: 'STEP verified with warnings: {f} faces, {e} edges.', v_fail: 'STEP NOT valid: {n} problems.', v_note: 'Light check (structure, references, loops, paired edges). For full validity open the file in a CAD.',
    'step.noHeader': 'missing ISO-10303-21 header', 'step.noFooter': 'missing END-ISO-10303-21 footer', 'step.noEndsec': 'missing ENDSEC', 'step.noData': 'missing DATA section', 'step.badNumber': 'invalid numbers (NaN/Infinity)',
    'step.dupId': 'duplicate id', 'step.dangling': 'reference to a missing entity', 'step.loopRef': 'loop with invalid edges', 'step.loopOpen': 'loop not closed', 'step.faceNoBound': 'face without bound',
    'step.shellFace': 'shell with a missing face', 'step.shellNotClosed': 'closed shell with unpaired edges', 'step.shellEdge': 'edge used more than twice', 'step.noFaces': 'no faces', 'step.openBoundary': 'open boundary (edges used once)',
    csv_head: 'type,diameter_mm,depth_mm,through,axis_x,axis_y,axis_z,pos_x,pos_y,pos_z,note',
  },
};
// lingua: scelta salvata, altrimenti quella del browser (italiano se "it", inglese altrimenti)
let lang = store.get('lang') || ((navigator.language || 'it').slice(0, 2) === 'it' ? 'it' : 'en');
const t = (k, p = {}) => (DICT[lang][k] || DICT.it[k] || k).replace(/\{(\w+)\}/g, (_, x) => p[x]);
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('lang').textContent = lang === 'it' ? 'EN' : 'IT';
  if (info) showInfo();
  if (res) { showResults(); updateSel(); }
}
$('lang').onclick = () => { lang = lang === 'it' ? 'en' : 'it'; store.set('lang', lang); applyLang(); };

// ============================ Worker ============================
// in dist/ il sorgente del worker (core+worker) è incorporato in <script id="worker-src">
function makeWorker() {
  const inl = document.getElementById('worker-src');
  if (inl) return new Worker(URL.createObjectURL(new Blob([inl.textContent], { type: 'text/javascript' })));
  return new Worker(new URL('./worker.js', import.meta.url));
}
const worker = makeWorker();
let reqId = 0; const pending = new Map();
worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); if (data.ok) p.res(data); else { const e = new Error(data.error); e.best = data.best; p.rej(e); } };
const call = (msg, transfer = []) => new Promise((res, rej) => { const id = ++reqId; pending.set(id, { res, rej }); worker.postMessage({ id, ...msg }, transfer); });

// ============================ Stato ============================
const status = (txt, cls = '') => { $('status').textContent = txt; $('status').className = cls; };
const busy = on => { $('busy').classList.toggle('on', on); };
const fmt = (x, d = 3) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : Number(x)).toLocaleString(lang === 'it' ? 'it-IT' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const errText = e => t(e.message, { b: e.best != null && isFinite(e.best) ? fmt(e.best, 3) : '—' });
let info = null, fileName = '', res = null, analysedTol = 0.02, multi = false, showDev = false, showEdges = true, bodyCfg = [];
const sel = new Set();

// ============================ Viewer ============================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };   // trascina = ruota, destro = sposta, rotella = zoom
scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); camera.add(sun); sun.position.set(1, 2, 3); scene.add(camera);
let meshObj = null, edgeObj = null;

// ---- tema chiaro/scuro (preferenza salvata, altrimenti quella di sistema) ----
function applyTheme(th) {
  document.documentElement.dataset.theme = th; store.set('theme', th);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--view-bg').trim();
  scene.background = new THREE.Color(bg || '#101214');
  if (edgeObj) edgeObj.material.color.set(th === 'light' ? 0x2a2f35 : 0x0b0d0f);
  paint();
}
$('theme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

// viste predefinite (asse Z verso l'alto, come nei CAD)
const VIEWS = { iso: [1, -1.4, 0.9], top: [0, -1e-4, 1], front: [0, -1, 0], right: [1, 0, 0] };
function fit(view = 'iso') {
  if (!meshObj) return;
  const box = new THREE.Box3().setFromObject(meshObj), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  camera.position.copy(c).add(new THREE.Vector3(...VIEWS[view]).normalize().multiplyScalar(d));
  camera.up.set(0, 0, 1); camera.near = d / 1000; camera.far = d * 100; camera.updateProjectionMatrix();
  controls.target.copy(c); controls.update();
}
document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => fit(b.dataset.view); });
addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !/INPUT|SELECT/.test(e.target.tagName)) fit(); });
$('t_edges').onclick = () => { showEdges = !showEdges; $('t_edges').classList.toggle('on', showEdges); if (edgeObj) edgeObj.visible = showEdges; };
$('t_dev').onclick = () => { showDev = !showDev; $('t_dev').classList.toggle('on', showDev); paint(); };

// colori per tipo, con variazione per regione (facce adiacenti distinguibili)
const BASE = { plane: '#7d93b8', cylinder: '#3fd0b6', cone: '#5fb0f0', sphere: '#f39a4a', torus: '#e3c84a', thread: '#ff6f91', bspline: '#9ad35a', freeform: '#c46bd6', none: '#9aa1a8' };
// [2026-10-06 v1.3.1] prima: variazione di tinta/luminosità per regione (sembrava casuale). Ora il colore dipende SOLO dal tipo
// (come in legenda); i confini tra facce adiacenti sono resi dai contorni.
function regionColor(r) { return new THREE.Color(BASE[r.type] || BASE.none); }
// scala deviazione: verde (0) -> giallo (tol/2) -> rosso (≥ tol)
const C0 = new THREE.Color('#2bb673'), C1 = new THREE.Color('#f0d23c'), C2 = new THREE.Color('#ef5b5b');
const devColor = x => { const s = Math.min(1, Math.max(0, x)); return s < 0.5 ? C0.clone().lerp(C1, s * 2) : C1.clone().lerp(C2, (s - 0.5) * 2); };
function paint() {
  if (!meshObj) return;
  const col = meshObj.geometry.attributes.color, a = col.array, nT = a.length / 9;
  const cache = new Map(), none = new THREE.Color(BASE.none), selC = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--sel').trim() || '#ffd84a');
  for (let i = 0; i < nT; i++) {
    let c = none;
    if (res) {
      const f = res.face[i];
      if (sel.has(f)) c = selC;
      else if (showDev) c = devColor(devArr()[i] / Math.max(1e-9, analysedTol));   // [v1.5.1] prima: res.dev[i]
      else { if (!cache.has(f)) cache.set(f, regionColor(res.regions[f])); c = cache.get(f); }
    }
    for (let k = 0; k < 3; k++) { a[i * 9 + k * 3] = c.r; a[i * 9 + k * 3 + 1] = c.g; a[i * 9 + k * 3 + 2] = c.b; }
  }
  col.needsUpdate = true;
  $('devlegend').hidden = !showDev || !res;
  if (res) $('devmax').textContent = '≥ ' + fmt(analysedTol, 3) + ' mm (max ' + fmt(thrDev() ? res.devThrMax : res.devMax, 4) + ')';   // [v1.5.1] prima: sempre res.devMax
}
// [v1.5.1] con l'opzione «filettature come cilindro nominale» la mappa confronta il filetto col cilindro nominale
const thrDev = () => $('o_thrcyl').checked && res && res.devThr;
const devArr = () => (thrDev() ? res.devThr : res.dev);
$('o_thrcyl').addEventListener('change', () => { if (showDev) paint(); });
function showMesh(positions) {
  for (const o of [meshObj, edgeObj]) if (o) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  edgeObj = null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  g.computeVertexNormals();   // non indicizzata -> shading piatto
  meshObj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  scene.add(meshObj); paint(); fit();
}
function showEdgesObj(seg) {
  if (edgeObj) { scene.remove(edgeObj); edgeObj.geometry.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(seg, 3));
  edgeObj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: document.documentElement.dataset.theme === 'light' ? 0x2a2f35 : 0x0b0d0f }));
  edgeObj.visible = showEdges; scene.add(edgeObj);
}

// ---- picking e selezione (clic singolo; multi con toggle, Shift, Ctrl o Cmd) ----
const ray = new THREE.Raycaster(); let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !meshObj || !res) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(meshObj)[0];
  const addMode = multi || e.shiftKey || e.ctrlKey || e.metaKey;
  if (!hit) { if (!addMode) { sel.clear(); updateSel(); } return; }
  const f = res.face[hit.faceIndex];
  if (addMode) { if (sel.has(f)) sel.delete(f); else sel.add(f); } else { sel.clear(); sel.add(f); }
  updateSel();
});
$('multi').onclick = () => { multi = !multi; $('multi').classList.toggle('on', multi); };
$('clearsel').onclick = () => { sel.clear(); updateSel(); };
function updateSel() {
  paint();
  const ids = [...sel];
  $('apply').disabled = !ids.length;
  $('selinfo').textContent = ids.length ? t('sel_n', { n: ids.length, t: ids.reduce((s, i) => s + res.regions[i].nTris, 0) }) : '';
  if (ids.length === 1) showPick(res.regions[ids[0]]); else $('pick').hidden = true;
  updateHoleBox();   // [v1.8.0]
}
function showPick(r) {
  const v3 = (v, d = 3) => v.map(x => fmt(x, d)).join(' ; ');
  const tags = [r.hole ? t('hole') : '', r.snapped ? t('snapped') : '', r.manual ? t('manual') : ''].filter(Boolean).join(', ');
  const rows = [[t('k_type'), t('t_' + r.type) + (tags ? ' · ' + tags : '')], [t('k_tris'), r.nTris], [t('k_area'), fmt(r.area, 2) + ' mm²']];
  if (r.type === 'cylinder') rows.push([t('k_dia'), 'Ø ' + fmt(2 * r.radius) + ' mm'], [t('k_len'), fmt(r.height, 2) + ' mm'], [t('k_axis'), v3(r.axis)]);
  if (r.type === 'sphere') rows.push([t('k_rad'), 'R ' + fmt(r.radius) + ' mm'], [t('k_center'), v3(r.center, 2)]);
  if (r.type === 'plane') rows.push([t('k_normal'), v3(r.normal)]);
  if (r.type === 'cone') rows.push([t('k_angle'), fmt(r.alpha * 180 / Math.PI, 2) + '° (' + fmt(r.alpha * 360 / Math.PI, 1) + '° incl.)'], [t('k_axis'), v3(r.axis)]);
  if (r.type === 'torus') rows.push([t('k_R'), fmt(r.R) + ' mm'], [t('k_r'), 'R ' + fmt(r.r) + ' mm'], [t('k_axis'), v3(r.axis)]);
  if (r.type === 'thread') rows.push([t('t_thread'), r.label + ' ' + t(r.internal ? 'internal' : 'external')], [t('k_pitch'), fmt(r.pitch, 2) + ' mm'], [t('k_hand'), t('hand_' + r.hand)], [t('k_major'), fmt(r.major, 2)], [t('k_minor'), fmt(r.minor, 2)], [t('k_len'), fmt(r.length, 2) + ' mm']);
  if (r.type === 'bspline') rows.push([t('k_ctrl'), r.nc + ' × ' + (r.nv || r.nc) + (r.closedU ? ' ' + t('closed_u') : '')]);   // [v1.5.0] prima: r.nc + ' × ' + r.nc
  if (r.threadLabel) rows.push([t('k_label'), r.threadLabel]);   // [v1.8.0]
  if (r.type !== 'freeform' && r.type !== 'thread') rows.push([t('k_err'), fmt(r.err, 4) + ' mm']);
  $('pick').innerHTML = '<dl class="kv">' + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
  $('pick').hidden = false;
}

// ============================ Caricamento ============================
function showInfo() {
  const size = info.bbox[1].map((v, i) => v - info.bbox[0][i]);
  const closed = info.open === 0 && info.nonManifold === 0;
  $('meshinfo').innerHTML = [
    [t('f_name'), fileName], [t('f_tris'), info.nT.toLocaleString()], [t('f_bodies'), info.bodies],
    [t('f_size'), size.map(v => fmt(v, 1)).join(' × ') + ' mm'],
    [t('f_closed'), closed ? t('yes') : t('no_open', { o: info.open, n: info.nonManifold })],
    [t('f_volume'), closed ? fmt(Math.abs(info.volume) / 1000, 2) + ' cm³' : '—'],
  ].concat(info.selfInt ? [[t('f_selfint'), t('selfint_n', { n: info.selfInt, p: info.selfIntPartial ? '+' : '' })]] : []).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');   // [v1.5.0] riga auto-intersezioni
  $('meshinfo').hidden = false;
  $('repair').hidden = info.open === 0 && info.nonManifold === 0;   // [v1.4.0] prima: solo info.open === 0
  $('repairself').hidden = !info.selfInt;   // [v1.7.0]
}
function onMesh(r) {
  info = r.info; res = null; sel.clear();
  bodyCfg = info.bodyList.map(b => ({ name: b.name, include: true }));
  $('results').hidden = true; $('editsec').hidden = true; $('pick').hidden = true; $('drop').style.display = 'none';   // [2026-10-06] prima: $('drop').textContent = '' (il cambio lingua lo riscriveva)
  showMesh(r.positions); showInfo(); renderBodies(info.bodyList);
  $('analyse').disabled = false; $('step').disabled = true; $('verify').disabled = true; $('vrep').hidden = true; $('stl').disabled = false; $('obj').disabled = false;
  // tolleranza suggerita: 0,01–0,2 mm in proporzione alla diagonale del pezzo
  $('tol').value = Math.min(0.2, Math.max(0.01, +(info.diag * 1e-4).toFixed(3)));
}
async function loadBuffer(name, buf) {
  try {
    busy(true); fileName = name; status(t('reading', { f: name }));
    const r = await call({ cmd: 'load', name, buf }, [buf]);
    onMesh(r);
    const closed = info.open === 0 && info.nonManifold === 0;
    // [v1.5.0] prima: status(closed ? t('loaded') : t('open_warn'), closed ? '' : 'warn');
    status(info.selfInt ? t('selfint_warn', { n: info.selfInt, p: info.selfIntPartial ? '+' : '' }) : closed ? t('loaded') : t('open_warn'), closed && !info.selfInt ? '' : 'warn');
    await analyse();
  } catch (e) { status(t('err') + errText(e), 'err'); }
  finally { busy(false); }
}
const loadFile = async f => loadBuffer(f.name, await f.arrayBuffer());
$('open').onclick = () => $('file').click();
$('file').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
['dragenter', 'dragover'].forEach(ev => addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$('repair').onclick = async () => {
  try {
    busy(true);
    const r = await call({ cmd: 'repair' });
    onMesh(r); status(r.removed ? t('repaired_nm', { n: r.removed, h: r.holes, a: r.added }) : r.holes ? t('repaired', { h: r.holes, a: r.added }) : t('no_holes'));
    await analyse();
  } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};

$('repairself').onclick = async () => {   // [v1.7.0] unione booleana (manifold-3d nel Worker)
  try {
    busy(true); status(t('selfint_busy'));
    const r = await call({ cmd: 'repairSelf' });
    onMesh(r);
    if (r.ok) { status(t('selfint_fixed', { m: r.merged, b: r.before, a: r.after })); await analyse(); }
    else status(t(r.reason === 'nobody' ? 'selfint_fail_nobody' : 'selfint_fail_internal', { a: r.after }), 'warn');
  } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};

// ============================ Analisi ============================
function opts() {
  return { tol: +$('tol').value, angle: +$('ang').value, cylinders: $('o_cyl').checked, cones: $('o_cone').checked, spheres: $('o_sph').checked, tori: $('o_tor').checked, threads: $('o_thr').checked, nurbs: $('o_nurbs').checked, snap: $('o_snap').checked };
}
function onResult(r) {
  res = r; sel.clear();   // [2026-10-06 v1.3.1] prima: la faccia risultante da un'unione restava selezionata (sel.add(r.selected))
  showEdgesObj(r.edges); showResults(); updateSel();
  $('results').hidden = false; $('editsec').hidden = false; $('step').disabled = false; $('verify').disabled = false;
  try { $('share').hidden = !(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.step')] })); } catch { $('share').hidden = true; }
}
async function analyse() {
  try {
    busy(true); $('analyse').disabled = true; status(t('analysing'));
    const o = opts(); const r = await call({ cmd: 'analyse', opts: o });
    analysedTol = o.tol; $('maxerr').value = +(o.tol * 5).toFixed(3); onResult(r); $('undo').disabled = true;
    const freePct = info.nT ? r.stats.freeformTris / info.nT : 0;
    status(t('done', { s: fmt(r.ms / 1000, 2) }) + (freePct > 0.5 ? t('many_free') : ''), freePct > 0.5 ? 'warn' : '');
  } catch (e) { status(t('err') + errText(e), 'err'); }
  finally { busy(false); $('analyse').disabled = false; }
}
$('analyse').onclick = analyse;

function showResults() {
  const s = res.stats;
  $('legend').innerHTML = ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'thread', 'bspline', 'freeform'].filter(k => s[k] || ['plane', 'cylinder'].includes(k))
    .map(k => `<div><span class="sw" style="background:${BASE[k]}"></span>${t('t_' + k + '_p')}<b>${k === 'freeform' ? s.freeformTris : s[k]}</b></div>`).join('');
  // fori raggruppati per diametro, passante/cieco e profondità
  const g = new Map();
  for (const h of res.holes) { const k = [h.diameter.toFixed(2), h.through ? 1 : 0, h.through ? '' : h.depth.toFixed(1)].join('|'); g.set(k, (g.get(k) || 0) + 1); }
  const shafts = new Map();
  for (const r of res.regions) if (r.type === 'cylinder' && !r.hole) { const k = (2 * r.radius).toFixed(2); shafts.set(k, (shafts.get(k) || 0) + 1); }
  let html = '';
  if (g.size) html += `<table><tr><th>${t('h_holes')}</th><th class="r">${t('h_dia')}</th><th class="r">${t('h_depth')}</th><th class="r">${t('h_n')}</th></tr>` +
    [...g].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, n]) => { const [d, th, dp] = k.split('|'); return `<tr><td>${th === '1' ? t('through') : t('blind')}</td><td class="r">${fmt(+d, 2)}</td><td class="r">${dp ? fmt(+dp, 1) : '—'}</td><td class="r">${n}</td></tr>`; }).join('') + '</table>';
  if (shafts.size) html += `<table><tr><th>${t('shafts')}</th><th class="r">${t('h_dia')}</th><th class="r">${t('h_n')}</th></tr>` + [...shafts].sort((a, b) => a[0] - b[0]).map(([d, n]) => `<tr><td></td><td class="r">${fmt(+d, 2)}</td><td class="r">${n}</td></tr>`).join('') + '</table>';
  $('holes').innerHTML = html;
  const th = res.regions.filter(r => r.type === 'thread');
  $('threads').innerHTML = th.length ? `<table><tr><th>${t('h_threads')}</th><th class="r">${t('k_pitch')}</th><th class="r">${t('k_len')}</th></tr>` + th.map(r => `<tr><td>${r.label} ${t(r.internal ? 'internal' : 'external')}</td><td class="r">${fmt(r.pitch, 2)}</td><td class="r">${fmt(r.length, 1)}</td></tr>`).join('') + '</table>' : '';
  renderBodies(res.bodies);
}

// ---- corpi: includi/escludi e rinomina (nome usato nello STEP) ----
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderBodies(list) {
  $('bodysec').hidden = list.length < 2 && !(list[0] && !/^Body1$/.test(list[0].name));
  $('bodies').innerHTML = `<tr><th></th><th>${t('b_name')}</th><th class="r">${t('f_tris')}</th></tr>` + list.map((b, i) =>
    `<tr><td><input type="checkbox" data-b="${i}" ${bodyCfg[i] && bodyCfg[i].include === false ? '' : 'checked'}></td><td><input type="text" data-bn="${i}" value="${esc(bodyCfg[i] ? bodyCfg[i].name : b.name)}"></td><td class="r">${b.nTris.toLocaleString()}<br><span class="hint">${b.closed ? t('b_closed') : t('b_open')}</span></td></tr>`).join('');
  $('bodies').querySelectorAll('[data-b]').forEach(el => { el.onchange = () => { bodyCfg[+el.dataset.b].include = el.checked; }; });
  $('bodies').querySelectorAll('[data-bn]').forEach(el => { el.oninput = () => { bodyCfg[+el.dataset.bn].name = el.value; }; });
}

// ============================ Editing ============================
$('apply').onclick = async () => {
  try {
    busy(true);
    const r = await call({ cmd: 'edit', ids: [...sel], as: $('as').value, maxErr: +$('maxerr').value });
    onResult(r); $('undo').disabled = false; status(t('edited'));
  } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};
// ---- [v1.8.0] Modifica foro ----
// Tabella come M2S.HOLE_SIZES nel core: [M, Ø gioco (ISO 273 media), Ø maschiatura]. «Filettatura» = foro di maschiatura + etichetta sulla faccia (non elicoidale).
const HOLE_SIZES = [[2, 2.4, 1.6], [2.5, 2.9, 2.05], [3, 3.4, 2.5], [4, 4.5, 3.3], [5, 5.5, 4.2], [6, 6.6, 5], [8, 9, 6.8], [10, 11, 8.5], [12, 13.5, 10.2], [14, 15.5, 12], [16, 17.5, 14]];
$('hsize').innerHTML = HOLE_SIZES.map(x => `<option value="${x[0]}">M${x[0]}</option>`).join('');
$('hsize').value = '6';
function holeTargetDia() {
  const m = $('hmode').value, row = HOLE_SIZES.find(x => x[0] === +$('hsize').value);
  return m === 'diameter' ? +$('hdia').value : m === 'clearance' ? row[1] : row[2];
}
function selectedHole() {
  if (sel.size !== 1 || !res) return null;
  const r = res.regions[[...sel][0]];
  return r && ((r.type === 'cylinder' && r.hole) || (r.type === 'thread' && r.internal)) ? r : null;
}
function updateHoleBox() {
  const r = selectedHole(); $('holebox').hidden = !r; if (!r) return;
  const free = $('hmode').value === 'diameter'; $('hdia').hidden = !free; $('hsize').hidden = free;
  $('hpreview').textContent = t('hole_prev', { a: fmt(r.type === 'thread' ? r.minor : 2 * r.radius, 2), b: fmt(holeTargetDia(), 2) });
}
['hmode', 'hsize', 'hdia'].forEach(id => { $(id).oninput = updateHoleBox; });
$('holeapply').onclick = async () => {
  const r = selectedHole(); if (!r) return;
  try {
    busy(true);
    const x = await call({ cmd: 'hole', region: r.id, mode: $('hmode').value, size: +$('hsize').value, dia: +$('hdia').value });
    info = x.info; showMesh(x.positions); showInfo(); onResult(x); $('undo').disabled = false;
    status(t('hole_done', { d: fmt(x.diameter, 2), l: x.label ? ' · ' + x.label : '' }));
  } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};
$('undo').onclick = async () => {
  // [2026-10-08 v1.8.0] prima: try { busy(true); const r = await call({ cmd: 'undo' }); onResult(r); ...  (annullare un foro ripristina anche la mesh)
  try { busy(true); const r = await call({ cmd: 'undo' }); if (r.positions) { info = r.info; showMesh(r.positions); showInfo(); } onResult(r); $('undo').disabled = !r.canUndo; status(t('undone')); }
  catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};

// ============================ Export ============================
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function makeStep() {
  const r = await call({ cmd: 'step', opts: { tol: analysedTol, bodies: bodyCfg, threadCyl: $('o_thrcyl').checked } });   // [v1.4.0] threadCyl
  status(r.solids ? t('step_ok', { f: r.faces, c: r.edges.circle, l: r.edges.line, s: r.solids }) : t('step_surf', { f: r.faces }));
  return r;
}
$('step').onclick = async () => {
  try { busy(true); status(t('step_gen')); const r = await makeStep(); download(r.text, r.name + '.step', 'application/step'); }
  catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};
// ---- [v1.9.0] Verifica STEP ----
const vtext = c => { const [k, ...r] = c.split(':'); return t(k) + (r.length ? ' (' + r.join(' ') + ')' : ''); };
$('verify').onclick = async () => {
  try {
    busy(true); status(t('step_gen'));
    const r = await call({ cmd: 'verify', opts: { tol: analysedTol, bodies: bodyCfg, threadCyl: $('o_thrcyl').checked } }), v = r.report;
    const lines = v.errors.map(e => '✗ ' + vtext(e)).concat(v.warnings.map(w => '⚠ ' + vtext(w)));
    $('vrep').innerHTML = (lines.length ? lines.map(esc).join('<br>') + '<br>' : '') + esc(t('v_note')); $('vrep').hidden = false;
    status(!v.ok ? t('v_fail', { n: v.errors.length }) : v.warnings.length ? t('v_okw', { f: v.counts.faces, e: v.counts.edges }) : t('v_ok', { f: v.counts.faces, e: v.counts.edges, l: v.counts.loops, s: v.counts.solids }), v.ok ? (v.warnings.length ? 'warn' : '') : 'err');
  } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};
$('share').onclick = async () => {
  try {
    busy(true); const r = await makeStep();
    await navigator.share({ files: [new File([r.text], r.name + '.step', { type: 'application/step' })], title: r.name + '.step' });
  } catch (e) { if (e.name !== 'AbortError') status(t('err') + errText(e), 'err'); } finally { busy(false); }
};
$('stl').onclick = async () => { try { busy(true); const r = await call({ cmd: 'stl' }); download(r.buf, r.name + '_mesh2step.stl', 'model/stl'); } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); } };
$('obj').onclick = async () => { try { busy(true); const r = await call({ cmd: 'obj' }); download(r.text, r.name + '_mesh2step.obj', 'model/obj'); } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); } };
// report CSV (in italiano separatore ';' e virgola decimale, come si aspetta Excel)
$('csv').onclick = () => {
  const it = lang === 'it', sep = it ? ';' : ',', n = x => (it ? String(+x.toFixed(4)).replace('.', ',') : String(+x.toFixed(4)));
  const rows = [t('csv_head')];
  for (const h of res.holes) rows.push(['hole', n(h.diameter), n(h.depth), h.through ? '1' : '0', ...h.axis.map(n), ...h.origin.map(n), ''].join(sep));
  for (const r of res.regions) {
    if (r.type === 'cylinder' && !r.hole) rows.push(['shaft', n(2 * r.radius), n(r.height), '', ...r.axis.map(n), ...r.origin.map(n), ''].join(sep));
    if (r.type === 'thread') rows.push(['thread', n(r.major), n(r.length), '', ...r.axis.map(n), ...r.origin.map(n), `${r.label} P${r.pitch} ${t('hand_' + r.hand)} ${t(r.internal ? 'internal' : 'external')}`].join(sep));
    if (r.type === 'cone') rows.push(['cone', '', '', '', ...r.axis.map(n), ...r.apex.map(n), `${n(r.alpha * 360 / Math.PI)}°`].join(sep));
  }
  download('﻿' + rows.join('\r\n') + '\r\n', (fileName.replace(/\.[^.]+$/, '') || 'mesh') + '_report.csv', 'text/csv');
};

// report PDF con disegno quotato dei fori (generato nel worker, nessun upload)
$('pdf').onclick = async () => {
  try {
    busy(true);
    const L = { title: t('pdf_title'), file: t('pdf_file'), size: t('pdf_size'), view: t('pdf_view'), holes: t('h_holes'), type: t('pdf_type'), depth: t('h_depth'), axis: t('pdf_axis'), through: t('through'), blind: t('blind'), none: t('pdf_none'), threads: t('h_threads'), thread: t('pdf_thread'), pitch: t('k_pitch'), len: t('pdf_len'), hand: t('pdf_hand'), internal: t('pdf_internal'), external: t('pdf_external'), right: t('pdf_right'), left: t('pdf_left'), shafts: t('shafts'), count: t('pdf_count'), footer: t('pdf_footer') };
    const r = await call({ cmd: 'pdf', L, lang });
    download(r.buf, r.name + '_report.pdf', 'application/pdf');
  } catch (e) { status(t('err') + errText(e), 'err'); } finally { busy(false); }
};

// ============================ Integrazione e PWA ============================
// 1) postMessage da un'altra app (es. 3D STL Multipart Maker che apre Mesh2STEP con window.open):
//    w.postMessage({ type: 'mesh2step:open', name: 'pezzo.stl', buffer: ArrayBuffer }, '*')
addEventListener('message', e => { const d = e.data; if (d && d.type === 'mesh2step:open' && d.buffer && d.name) loadBuffer(d.name, d.buffer); });
// 2) parametro ?url=… (file servito con CORS)
const qp = new URLSearchParams(location.search).get('url');
if (qp) fetch(qp).then(r => r.arrayBuffer()).then(b => loadBuffer(decodeURIComponent(qp.split('/').pop().split('?')[0]) || 'mesh.stl', b)).catch(e => status(t('err') + e.message, 'err'));
// 3) PWA installata: apertura dei file .stl/.obj/.3mf dal sistema (File Handling API)
if ('launchQueue' in window) window.launchQueue.setConsumer(async p => { if (p.files && p.files.length) loadFile(await p.files[0].getFile()); });
// 4) service worker per l'uso offline (solo http/https, non nella build single-file)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !document.getElementById('worker-src')) navigator.serviceWorker.register('sw.js').catch(() => {});
// 5) segnala all'opener che l'app è pronta a ricevere un file
if (window.opener) try { window.opener.postMessage({ type: 'mesh2step:ready', version: VERSION }, '*'); } catch { /* opener di altra origine */ }

$('ver').textContent = 'v' + VERSION;
applyTheme(store.get('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
applyLang();
