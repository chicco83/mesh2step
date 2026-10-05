/*
 * Mesh2STEP — core.js
 * Versione: 1.0.0 — 2026-10-05 17:10 (Europe/Rome)
 * ---------------------------------------------------------------------------
 * Motore indipendente dalla UI (gira nel Web Worker del browser e in Node per i test).
 *   1. Parsing  : STL (binario/ASCII), OBJ, 3MF (zip letto a mano + DecompressionStream)
 *   2. Topologia: saldatura vertici, adiacenze triangoli, componenti connesse
 *   3. Riconoscimento: cilindri -> piani -> sfere -> freeform (region growing + fitting)
 *   4. Export STEP AP214: B-rep con PLANE / CYLINDRICAL_SURFACE / SPHERICAL_SURFACE,
 *      spigoli LINE / CIRCLE / B-spline grado 1, CLOSED_SHELL -> MANIFOLD_SOLID_BREP
 * Implementazione clean-room: nessun codice preso da mesh2solid.thavision.com.
 */
(function (root) {
  'use strict';
  const VERSION = '1.0.0';

  // ===================== Helper vettoriali (array [x,y,z]) =====================
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a); return l > 1e-300 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
  // Restituisce un versore perpendicolare ad a (per costruire basi locali)
  const perp = a => norm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));

  // Autovalori/autovettori di matrice simmetrica 3x3 (Jacobi). Ritorna ordinati crescenti.
  function eigSym3(A) {
    const a = [[A[0], A[1], A[2]], [A[1], A[3], A[4]], [A[2], A[4], A[5]]];
    const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-15) break;
      for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    const r = [0, 1, 2].map(i => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] }));
    r.sort((x, y) => x.val - y.val);
    return r;
  }

  // Risolve sistema lineare NxN (Gauss con pivoting). Ritorna null se singolare.
  function solve(M, b) {
    const n = b.length, A = M.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-14) return null;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
    }
    return A.map((r, i) => r[n] / r[i]);
  }

  // ============================== 1. PARSING ==============================
  // Tutti i parser ritornano un "triangle soup": Float32Array (9 float per triangolo)

  function parseSTL(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === buf.byteLength) {           // STL binario: dimensione esatta
        const out = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50 + 12;                   // salta la normale (ricalcolata)
          for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        }
        return out;
      }
    }
    // STL ASCII: legge tutte le righe "vertex x y z"
    const txt = new TextDecoder().decode(buf);
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    const arr = []; let m;
    while ((m = re.exec(txt))) arr.push(+m[1], +m[2], +m[3]);
    if (!arr.length || arr.length % 9) throw new Error('STL non valido');
    return new Float32Array(arr);
  }

  function parseOBJ(buf) {
    const lines = new TextDecoder().decode(buf).split(/\r?\n/);
    const v = [], out = [];
    for (const l of lines) {
      if (l.startsWith('v ')) { const p = l.trim().split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
      else if (l.startsWith('f ')) {
        // indici 1-based, negativi = relativi; formati v, v/vt, v/vt/vn, v//vn; poligoni -> ventaglio
        const idx = l.trim().split(/\s+/).slice(1).map(s => { const i = parseInt(s, 10); return i < 0 ? v.length + i : i - 1; });
        for (let k = 1; k + 1 < idx.length; k++) for (const j of [idx[0], idx[k], idx[k + 1]]) out.push(...v[j]);
      }
    }
    if (!out.length) throw new Error('OBJ senza facce');
    return new Float32Array(out);
  }

  // Decompressione deflate grezza con API nativa (browser moderni / Node 18+)
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Lettore ZIP minimale: usa la central directory, supporta store(0) e deflate(8)
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
    let e = buf.byteLength - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('ZIP non valido');
    let p = dv.getUint32(e + 16, true); const count = dv.getUint16(e + 10, true);
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = u8.subarray(ds, ds + csize);
      files[name] = { method, raw };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      read: async n => { const f = files[n]; return f.method === 0 ? f.raw : await inflateRaw(f.raw); },
    };
  }

  async function parse3MF(buf) {
    const z = await unzip(buf);
    const models = z.names.filter(n => /\.model$/i.test(n));
    if (!models.length) throw new Error('3MF senza modello');
    const out = [];
    for (const n of models) {
      const xml = new TextDecoder().decode(await z.read(n));
      const unit = (xml.match(/<model[^>]*\bunit="([a-z]+)"/i) || [])[1] || 'millimeter';
      const sc = { micron: 1e-3, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] || 1;
      // ogni <mesh> ha i propri vertici: si processano blocco per blocco
      for (const mesh of xml.split(/<mesh[\s>]/).slice(1)) {
        const v = []; let m;
        const rv = /<vertex\s[^>]*?x="([^"]+)"[^>]*?y="([^"]+)"[^>]*?z="([^"]+)"/g;
        while ((m = rv.exec(mesh))) v.push([+m[1] * sc, +m[2] * sc, +m[3] * sc]);
        const rt = /<triangle\s[^>]*?v1="(\d+)"[^>]*?v2="(\d+)"[^>]*?v3="(\d+)"/g;
        while ((m = rt.exec(mesh))) out.push(...v[+m[1]], ...v[+m[2]], ...v[+m[3]]);
      }
    }
    if (!out.length) throw new Error('3MF senza triangoli');
    return new Float32Array(out);
  }

  async function parseFile(name, buf) {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'stl') return parseSTL(buf);
    if (ext === 'obj') return parseOBJ(buf);
    if (ext === '3mf') return parse3MF(buf);
    throw new Error('Formato non supportato: ' + ext);
  }

  // ============================ 2. TOPOLOGIA ============================
  // Costruisce mesh indicizzata: V (Float64Array xyz), T (Uint32Array abc), normali, aree,
  // vicini per lato, spigoli non orientati, componenti connesse.
  function buildMesh(soup) {
    // bounding box -> passo di quantizzazione per la saldatura (1e-6 della diagonale)
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < soup.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], soup[i + k]); mx[k] = Math.max(mx[k], soup[i + k]); }
    const diag = len(sub(mx, mn)) || 1, q = diag * 1e-6;
    const map = new Map(), V = [], Tl = [];
    const vid = (x, y, z) => {
      const key = Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q);
      let id = map.get(key);
      if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(x, y, z); }
      return id;
    };
    for (let i = 0; i < soup.length; i += 9) {
      const a = vid(soup[i], soup[i + 1], soup[i + 2]), b = vid(soup[i + 3], soup[i + 4], soup[i + 5]), c = vid(soup[i + 6], soup[i + 7], soup[i + 8]);
      if (a !== b && b !== c && a !== c) Tl.push(a, b, c);   // scarta triangoli degeneri
    }
    const Vf = new Float64Array(V), T = new Uint32Array(Tl), nT = T.length / 3, nV = Vf.length / 3;
    const P = i => [Vf[3 * i], Vf[3 * i + 1], Vf[3 * i + 2]];
    const N = new Float64Array(nT * 3), A = new Float64Array(nT), C = new Float64Array(nT * 3);
    for (let t = 0; t < nT; t++) {
      const a = P(T[3 * t]), b = P(T[3 * t + 1]), c = P(T[3 * t + 2]);
      const n = cross(sub(b, a), sub(c, a)), l = len(n);
      A[t] = l / 2;
      const u = l > 0 ? mul(n, 1 / l) : [0, 0, 1];
      N.set(u, 3 * t);
      C.set(mul(add(add(a, b), c), 1 / 3), 3 * t);
    }
    // spigoli: chiave numerica min*nV+max
    const emap = new Map(), E0 = [], E1 = [], ET = [];   // ET: lista triangoli per spigolo
    const triEdge = new Int32Array(nT * 3);
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
      const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3];
      const key = a < b ? a * nV + b : b * nV + a;
      let e = emap.get(key);
      if (e === undefined) { e = E0.length; emap.set(key, e); E0.push(Math.min(a, b)); E1.push(Math.max(a, b)); ET.push([]); }
      ET[e].push(t); triEdge[3 * t + k] = e;
    }
    // vicino attraverso il lato k (-1 se bordo aperto o spigolo non-manifold)
    const nb = new Int32Array(nT * 3).fill(-1);
    let open = 0, nonManifold = 0;
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
      const l = ET[triEdge[3 * t + k]];
      if (l.length === 2) nb[3 * t + k] = l[0] === t ? l[1] : l[0];
    }
    for (const l of ET) { if (l.length === 1) open++; else if (l.length > 2) nonManifold++; }
    // componenti connesse (corpi)
    const comp = new Int32Array(nT).fill(-1); let nComp = 0;
    for (let s = 0; s < nT; s++) if (comp[s] < 0) {
      const st = [s]; comp[s] = nComp;
      while (st.length) { const t = st.pop(); for (let k = 0; k < 3; k++) { const u = nb[3 * t + k]; if (u >= 0 && comp[u] < 0) { comp[u] = nComp; st.push(u); } } }
      nComp++;
    }
    // volume con segno (teorema della divergenza) — utile per verifiche
    let vol = 0, area = 0;
    for (let t = 0; t < nT; t++) { const a = P(T[3 * t]), b = P(T[3 * t + 1]), c = P(T[3 * t + 2]); vol += dot(a, cross(b, c)) / 6; area += A[t]; }
    return { V: Vf, T, N, A, C, nT, nV, E0, E1, ET, triEdge, nb, comp, nComp, open, nonManifold, bbox: [mn, mx], diag, volume: vol, area, P };
  }

  // ======================= 3. FITTING DI PRIMITIVE =======================
  function verticesOf(M, tris) {
    const seen = new Set(), pts = [];
    for (const t of tris) for (let k = 0; k < 3; k++) { const v = M.T[3 * t + k]; if (!seen.has(v)) { seen.add(v); pts.push(M.P(v)); } }
    return pts;
  }

  // Piano ai minimi quadrati: centro + autovettore minimo della covarianza
  function fitPlane(pts) {
    const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    const m = mul(c, 1 / pts.length), S = [0, 0, 0, 0, 0, 0];
    for (const p of pts) { const d = sub(p, m); S[0] += d[0] * d[0]; S[1] += d[0] * d[1]; S[2] += d[0] * d[2]; S[3] += d[1] * d[1]; S[4] += d[1] * d[2]; S[5] += d[2] * d[2]; }
    const n = norm(eigSym3(S)[0].vec);
    let maxd = 0; for (const p of pts) maxd = Math.max(maxd, Math.abs(dot(sub(p, m), n)));
    return { origin: m, normal: n, maxErr: maxd };
  }

  // Cerchio 2D (Kasa): x²+y²+Dx+Ey+F=0
  function fitCircle2D(xy) {
    let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const [x, y] of xy) {
      const r = [x, y, 1], z = -(x * x + y * y);
      for (let i = 0; i < 3; i++) { b[i] += r[i] * z; for (let j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; }
    }
    const s = solve(S, b); if (!s) return null;
    let cx = -s[0] / 2, cy = -s[1] / 2; const r2 = cx * cx + cy * cy - s[2];
    if (!(r2 > 0)) return null;
    let r = Math.sqrt(r2);
    // [2026-10-05 17:35] raffinamento geometrico Gauss-Newton (Kasa è distorto su archi corti)
    for (let it = 0; it < 10; it++) {
      const JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Jtr = [0, 0, 0];
      for (const [x, y] of xy) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1e-300, res = d - r;
        const J = [-dx / d, -dy / d, -1];
        for (let i = 0; i < 3; i++) { Jtr[i] -= J[i] * res; for (let j = 0; j < 3; j++) JtJ[i][j] += J[i] * J[j]; }
      }
      const dlt = solve(JtJ, Jtr); if (!dlt) break;
      cx += dlt[0]; cy += dlt[1]; r += dlt[2];
      if (Math.abs(dlt[0]) + Math.abs(dlt[1]) + Math.abs(dlt[2]) < 1e-12 * (1 + r)) break;
    }
    if (!(r > 0)) return null;
    return { cx, cy, r };
  }

  // Asse di un cilindro dalle normali: autovettore minimo di Σ A·n nᵀ
  function axisFromNormals(M, tris) {
    const S = [0, 0, 0, 0, 0, 0];
    for (const t of tris) {
      const a = M.A[t], n = [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]];
      S[0] += a * n[0] * n[0]; S[1] += a * n[0] * n[1]; S[2] += a * n[0] * n[2]; S[3] += a * n[1] * n[1]; S[4] += a * n[1] * n[2]; S[5] += a * n[2] * n[2];
    }
    return eigSym3(S);
  }

  // Cilindro dato l'asse: proiezione dei vertici sul piano ⟂ asse + cerchio
  function fitCylinder(M, tris, axis) {
    const pts = verticesOf(M, tris), u = perp(axis), v = cross(axis, u);
    const c = fitCircle2D(pts.map(p => [dot(p, u), dot(p, v)]));
    if (!c) return null;
    const ctr = add(mul(u, c.cx), mul(v, c.cy));
    // origine sull'asse alla quota minima dei punti
    let hmin = Infinity, hmax = -Infinity, maxErr = 0, se = 0;
    for (const p of pts) {
      const h = dot(p, axis); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
      const e = Math.abs(Math.hypot(dot(p, u) - c.cx, dot(p, v) - c.cy) - c.r);
      maxErr = Math.max(maxErr, e); se += e * e;
    }
    return { axis, origin: add(ctr, mul(axis, hmin)), radius: c.r, height: hmax - hmin, maxErr, rms: Math.sqrt(se / pts.length) };
  }

  // Sfera algebrica: x²+y²+z²+Dx+Ey+Fz+G=0
  function fitSphere(pts) {
    const S = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (const p of pts) {
      const r = [p[0], p[1], p[2], 1], z = -dot(p, p);
      for (let i = 0; i < 4; i++) { b[i] += r[i] * z; for (let j = 0; j < 4; j++) S[i][j] += r[i] * r[j]; }
    }
    const s = solve(S, b); if (!s) return null;
    let c = [-s[0] / 2, -s[1] / 2, -s[2] / 2]; const r2 = dot(c, c) - s[3];
    if (!(r2 > 0)) return null;
    let r = Math.sqrt(r2);
    // [2026-10-05 17:35] raffinamento geometrico Gauss-Newton su (centro, raggio)
    for (let it = 0; it < 10; it++) {
      const JtJ = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], Jtr = [0, 0, 0, 0];
      for (const p of pts) {
        const dv = sub(p, c), d = len(dv) || 1e-300, res = d - r;
        const J = [-dv[0] / d, -dv[1] / d, -dv[2] / d, -1];
        for (let i = 0; i < 4; i++) { Jtr[i] -= J[i] * res; for (let j = 0; j < 4; j++) JtJ[i][j] += J[i] * J[j]; }
      }
      const dlt = solve(JtJ, Jtr); if (!dlt) break;
      c = [c[0] + dlt[0], c[1] + dlt[1], c[2] + dlt[2]]; r += dlt[3];
      if (Math.abs(dlt[0]) + Math.abs(dlt[1]) + Math.abs(dlt[2]) + Math.abs(dlt[3]) < 1e-12 * (1 + r)) break;
    }
    if (!(r > 0)) return null;
    let maxErr = 0; for (const p of pts) maxErr = Math.max(maxErr, Math.abs(len(sub(p, c)) - r));
    return { center: c, radius: r, maxErr };
  }

  // ====================== 4. RICONOSCIMENTO SUPERFICI ======================
  // opts: { tol (mm), angle (gradi), cylinders, spheres }
  function segment(M, opts) {
    const tol = opts.tol, cosA = Math.cos(opts.angle * Math.PI / 180), sinA = Math.sin(opts.angle * Math.PI / 180);
    const nT = M.nT, face = new Int32Array(nT).fill(-1), regions = [];
    const Nv = t => [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]];
    const cosDih = (t, u) => dot(Nv(t), Nv(u));       // coseno angolo diedro tra triangoli
    const maxStep = Math.cos(40 * Math.PI / 180);     // salto massimo tra facette di una superficie curva
    const mark = new Int32Array(nT).fill(-1); let stamp = 0;   // marcatura temporanea senza riallocare
    const vertsOK = (t, f) => { for (let k = 0; k < 3; k++) if (f(M.P(M.T[3 * t + k])) > tol) return false; return true; };
    const vertsOKt = (t, f, tl) => { for (let k = 0; k < 3; k++) if (f(M.P(M.T[3 * t + k])) > tl) return false; return true; };

    // ---- 4a-bis. SFERE (prima dei cilindri: una striscia di sfera può sembrare un cilindro) ----
    // seme = triangolo con vicini "morbidi"; crescita libera fino a 12 triangoli, poi fit e vincolo |d-r|<=tol
    if (opts.spheres) {
      const sphTried = new Uint8Array(nT);
      for (let s = 0; s < nT; s++) {
        if (face[s] >= 0 || sphTried[s]) continue;
        let soft = 0; for (let j = 0; j < 3; j++) { const u = M.nb[3 * s + j]; if (u >= 0) { const cd = cosDih(s, u); if (cd < Math.cos(0.3 * Math.PI / 180) && cd > maxStep) soft++; } }
        if (soft < 2) continue;
        sphTried[s] = 1;
        /* [2026-10-05 17:30] versione precedente: crescita unica con fit fisso a 12 triangoli
           -> sfera stimata male su patch piccole, regione frammentata (6 sfere con R errati).
        stamp++; const reg = [s]; mark[s] = stamp; sphTried[s] = 1;
        let sp = null; const queue = [s];
        ... (crescita singola) ...
        if (!sp || reg.length < 12) continue;
        */
        // crescita BFS dal seme; lim = n. massimo triangoli senza vincolo, sp = sfera vincolante
        const grow = (sp, tolG, lim) => {
          stamp++; const reg = [s]; mark[s] = stamp;
          for (let qi = 0; qi < reg.length && reg.length < lim; qi++) {
            const t = reg[qi];
            for (let j = 0; j < 3; j++) {
              const u = M.nb[3 * t + j];
              if (u < 0 || face[u] >= 0 || mark[u] === stamp) continue;
              if (cosDih(t, u) < maxStep) continue;
              if (sp && vertsOKt(u, p => Math.abs(len(sub(p, sp.center)) - sp.radius), tolG) === false) continue;
              mark[u] = stamp; reg.push(u);
            }
          }
          return reg;
        };
        let reg = grow(null, 0, 12), sp = reg.length >= 12 ? fitSphere(verticesOf(M, reg)) : null;
        if (!sp || sp.maxErr > tol || sp.radius > M.diag * 20) continue;
        // ri-crescita iterativa: tolleranza larga (3·tol) e refit sull'intera regione finché stabile
        for (let it = 0; it < 6; it++) {
          const r2 = grow(sp, 3 * tol, Infinity), f2 = fitSphere(verticesOf(M, r2));
          if (!f2) break;
          const stable = r2.length === reg.length;
          reg = r2; sp = f2;
          if (stable) break;
        }
        // scarta i triangoli fuori tolleranza stretta rispetto alla sfera finale
        reg = reg.filter(t => vertsOKt(t, p => Math.abs(len(sub(p, sp.center)) - sp.radius), tol));
        if (reg.length < 12) continue;
        for (const t of reg) sphTried[t] = 1;
        const fin = fitSphere(verticesOf(M, reg));
        if (!fin || fin.maxErr > tol || fin.radius > M.diag * 20) continue;
        // le normali devono coprire 2 direzioni (cilindro/piano hanno autovalore minimo ~0)
        const ev = axisFromNormals(M, reg); const tot = ev[0].val + ev[1].val + ev[2].val;
        if (ev[0].val / tot < 1e-4) continue;
        let out = 0; for (const t of reg) out += M.A[t] * dot(Nv(t), sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], fin.center));
        const id = regions.length;
        regions.push({ id, type: 'sphere', tris: reg, center: fin.center, radius: fin.radius, err: fin.maxErr, outward: out >= 0 });
        for (const t of reg) face[t] = id;
      }
    }

    // ---- 4a. CILINDRI: seme = coppia di triangoli adiacenti con diedro "morbido" ----
    if (opts.cylinders) {
      for (let s = 0; s < nT; s++) for (let k = 0; k < 3; k++) {
        if (face[s] >= 0) break;
        const s2 = M.nb[3 * s + k]; if (s2 < s || face[s2] >= 0) continue;
        const cd = cosDih(s, s2); if (cd > Math.cos(0.3 * Math.PI / 180) || cd < maxStep) continue;
        let axis = norm(cross(Nv(s), Nv(s2))); if (len(axis) === 0) continue;
        stamp++; const reg = [s, s2]; mark[s] = mark[s2] = stamp;
        // cerchio iniziale dai 3 punti proiettati della coppia seme (esatto su mesh da CAD):
        // evita che la crescita "scivoli" su piani tangenti prima del primo refit
        let cyl = fitCylinder(M, reg, axis); if (cyl && cyl.radius > M.diag * 20) cyl = null;
        let nextFit = 6; const queue = [s, s2];
        for (let qi = 0; qi < queue.length; qi++) {
          const t = queue[qi];
          for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * t + j];
            if (u < 0 || face[u] >= 0 || mark[u] === stamp) continue;
            if (cosDih(t, u) < maxStep) continue;
            if (Math.abs(dot(Nv(u), axis)) > sinA) continue;            // normale ⟂ asse
            if (cyl && !vertsOK(u, p => { const d = sub(p, cyl.origin); const h = dot(d, axis); return Math.abs(len(sub(d, mul(axis, h))) - cyl.radius); })) continue;
            mark[u] = stamp; reg.push(u); queue.push(u);
            if (reg.length >= nextFit) {                                  // riallinea asse e raggio
              const ax = axisFromNormals(M, reg)[0].vec;
              const c = fitCylinder(M, reg, norm(ax));
              if (c && c.maxErr <= tol) { cyl = c; axis = c.axis; }
              nextFit = Math.ceil(nextFit * 1.5);
            }
          }
        }
        // validazione finale
        if (reg.length < 4) continue;
        const ax = norm(axisFromNormals(M, reg)[0].vec), c = fitCylinder(M, reg, ax);
        if (!c || c.maxErr > tol || c.radius > M.diag * 20) continue;
        if (fitPlane(verticesOf(M, reg)).maxErr <= tol) continue;     // è in realtà un piano
        // almeno 3 orientazioni di facetta distinte attorno all'asse
        const u0 = perp(ax), v0 = cross(ax, u0);
        const angs = reg.map(t => Math.atan2(dot(Nv(t), v0), dot(Nv(t), u0))).sort((a, b) => a - b);
        let clusters = 1; for (let i = 1; i < angs.length; i++) if (angs[i] - angs[i - 1] > 0.5 * Math.PI / 180) clusters++;
        if (clusters < 3) continue;
        // [2026-10-05 17:55] rifiuta "falsi cilindri" (strisce di toro/freeform): se oltre metà dei bordi
        // di estremità (⟂ asse) prosegue in modo morbido su triangoli liberi non ⟂ asse, la superficie
        // continua a curvare in un'altra direzione -> non è un cilindro.
        {
          const inReg = new Set(reg); let endLen = 0, smoothLen = 0;
          for (const t of reg) for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * t + j]; if (u >= 0 && inReg.has(u)) continue;
            const a = M.P(M.T[3 * t + j]), b = M.P(M.T[3 * t + (j + 1) % 3]), dv = sub(b, a), l = len(dv);
            if (Math.abs(dot(dv, ax)) / l > 0.5) continue;                       // bordo laterale, non di estremità
            endLen += l;
            if (u >= 0 && face[u] < 0 && cosDih(t, u) > maxStep && Math.abs(dot(Nv(u), ax)) > 3 * sinA) smoothLen += l;
          }
          if (endLen > 0 && smoothLen > 0.5 * endLen) continue;
        }
        // verso: normali uscenti dall'asse (albero) o entranti (foro)
        let out = 0; for (const t of reg) { const d = sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], c.origin); out += M.A[t] * dot(Nv(t), sub(d, mul(ax, dot(d, ax)))); }
        const id = regions.length;
        regions.push({ id, type: 'cylinder', tris: reg, axis: ax, origin: c.origin, radius: c.radius, height: c.height, err: c.maxErr, outward: out >= 0 });
        for (const t of reg) face[t] = id;
      }
    }

    // ---- 4b. PIANI: seme = triangolo più grande non assegnato ----
    const order = [...Array(nT).keys()].sort((a, b) => M.A[b] - M.A[a]);
    for (const s of order) {
      if (face[s] >= 0) continue;
      const n = Nv(s), d0 = dot(n, [M.C[3 * s], M.C[3 * s + 1], M.C[3 * s + 2]]);
      const id = regions.length, reg = [s]; face[s] = id;
      const st = [s];
      while (st.length) {
        const t = st.pop();
        for (let j = 0; j < 3; j++) {
          const u = M.nb[3 * t + j];
          if (u < 0 || face[u] >= 0) continue;
          if (dot(Nv(u), n) < cosA) continue;
          if (!vertsOK(u, p => Math.abs(dot(p, n) - d0))) continue;
          face[u] = id; reg.push(u); st.push(u);
        }
      }
      regions.push({ id, type: 'plane', tris: reg, normal: n, origin: [M.C[3 * s], M.C[3 * s + 1], M.C[3 * s + 2]] });
    }

    // ---- 4c. FREEFORM: piani da 1-2 triangoli immersi in zone morbide ----
    for (const r of regions) {
      if (r.type !== 'plane' || r.tris.length > 2) continue;
      let sharp = true;
      for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && face[u] !== r.id && regions[face[u]].type === 'plane' && cosDih(t, u) > Math.cos(20 * Math.PI / 180)) sharp = false; }  // [2026-10-05 17:45] i vicini analitici (cilindri/sfere) tangenti non rendono freeform un piano
      if (!sharp) r.type = 'freeform';
    }

    /* [2026-10-05 17:25] Versione precedente 4d (sfere da macchie freeform), sostituita da 4a-bis:
    // ---- 4d. SFERE: gruppi connessi di freeform che stanno su una sfera ----
    if (opts.spheres) {
      const seen = new Uint8Array(regions.length);
      for (const r0 of regions) {
        if (r0.type !== 'freeform' || seen[r0.id]) continue;
        // raccoglie la macchia connessa di regioni freeform
        const blob = [], st = [r0.id]; seen[r0.id] = 1;
        while (st.length) {
          const r = regions[st.pop()]; blob.push(r);
          for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0) continue; const f = face[u]; if (regions[f].type === 'freeform' && !seen[f]) { seen[f] = 1; st.push(f); } }
        }
        const tris = blob.flatMap(r => r.tris); if (tris.length < 8) continue;
        const sp = fitSphere(verticesOf(M, tris));
        if (!sp || sp.maxErr > tol || sp.radius > M.diag * 20) continue;
        const id = regions.length;
        let out = 0; for (const t of tris) out += M.A[t] * dot(Nv(t), sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], sp.center));
        regions.push({ id, type: 'sphere', tris, center: sp.center, radius: sp.radius, err: sp.maxErr, outward: out >= 0 });
        for (const r of blob) r.type = 'merged';
        for (const t of tris) face[t] = id;
      }
    }
    */
    // ---- 4e. [2026-10-05 18:00] FUSIONE di regioni adiacenti con la stessa primitiva ----
    // (es. sfera/cilindro spezzati in due semi): stesso asse+raggio, stesso centro+raggio, stesso piano
    {
      const same = (a, b) => {
        if (a.type !== b.type || a.type === 'freeform' || a.type === 'merged') return false;
        if (a.type === 'plane') return dot(a.normal, b.normal) > cosA && Math.abs(dot(sub(b.origin, a.origin), a.normal)) <= tol;
        if (a.type === 'sphere') return Math.abs(a.radius - b.radius) <= tol && len(sub(a.center, b.center)) <= tol && a.outward === b.outward;
        if (a.type === 'cylinder') {
          if (Math.abs(dot(a.axis, b.axis)) < cosA || Math.abs(a.radius - b.radius) > tol || a.outward !== b.outward) return false;
          const d = sub(b.origin, a.origin); return len(sub(d, mul(a.axis, dot(d, a.axis)))) <= tol;
        }
        return false;
      };
      let changed = true;
      while (changed) {
        changed = false;
        for (let t = 0; t < nT && !changed; t++) for (let j = 0; j < 3; j++) {
          const u = M.nb[3 * t + j]; if (u < 0) continue;
          const A = regions[face[t]], B = regions[face[u]];
          if (A === B || !same(A, B)) continue;
          for (const x of B.tris) face[x] = A.id;
          A.tris = A.tris.concat(B.tris); B.type = 'merged'; B.tris = [];
          if (A.type === 'cylinder') { const c = fitCylinder(M, A.tris, A.axis); if (c) { A.origin = c.origin; A.height = c.height; } }
          changed = true; break;
        }
      }
    }

    // compattazione indici (rimuove regioni assorbite)
    const live = regions.filter(r => r.type !== 'merged'), remap = new Int32Array(regions.length).fill(-1);
    live.forEach((r, i) => { remap[r.id] = i; r.id = i; });
    for (let t = 0; t < nT; t++) face[t] = remap[face[t]];
    // statistiche
    const stats = { plane: 0, cylinder: 0, sphere: 0, freeform: 0, freeformTris: 0 };
    for (const r of live) { stats[r.type]++; if (r.type === 'freeform') stats.freeformTris += r.tris.length; }
    return { face, regions: live, stats };
  }

  // ============================ 5. EXPORT STEP ============================
  function stepNum(x, dec = 9) {
    if (!isFinite(x) || Math.abs(x) < 1e-12) return '0.';
    let s = x.toFixed(dec).replace(/0+$/, '');
    if (s === '-0.') s = '0.';
    return s;
  }
  const stepStr = s => "'" + String(s).replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_') + "'";

  function exportSTEP(M, seg, opts = {}) {
    const name = opts.name || 'mesh2step', tol = Math.max(opts.tol || 0.01, 1e-4);
    const lines = []; let nid = 0;
    const E = s => { nid++; lines.push('#' + nid + '=' + s + ';'); return '#' + nid; };
    const pt = p => E(`CARTESIAN_POINT('',(${stepNum(p[0])},${stepNum(p[1])},${stepNum(p[2])}))`);
    const dir = d => E(`DIRECTION('',(${stepNum(d[0], 12)},${stepNum(d[1], 12)},${stepNum(d[2], 12)}))`);
    const place = (o, z, x) => E(`AXIS2_PLACEMENT_3D('',${pt(o)},${dir(z)},${dir(x)})`);

    // --- contesto prodotto AP214 ---
    const ctx = E("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    E(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
    const pctx = E(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
    const prod = E(`PRODUCT(${stepStr(name)},${stepStr(name)},'',(${pctx}))`);
    E(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const pdf = E(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
    const pdc = E(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
    const pd = E(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
    const pds = E(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    const uLen = E('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
    const uAng = E('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
    const uSol = E('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
    const unc = E(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${stepNum(tol)}),${uLen},'distance_accuracy_value','confusion accuracy')`);
    const gctx = E(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${uLen},${uAng},${uSol}))REPRESENTATION_CONTEXT('Context3D','3D context'))`);

    // --- id di "faccia B-rep": regioni analitiche intere; freeform = un triangolo per faccia ---
    const fid = new Int32Array(M.nT); let nF = 0;
    const faceInfo = [];   // { region, tris }
    for (const r of seg.regions) {
      if (r.type === 'freeform') for (const t of r.tris) { fid[t] = nF++; faceInfo.push({ region: r, tris: [t] }); }
      else { for (const t of r.tris) fid[t] = nF; nF++; faceInfo.push({ region: r, tris: r.tris }); }
    }

    // --- spigoli topologici: spigoli mesh con facce diverse ai due lati (o bordo aperto) ---
    const nE = M.E0.length, isTopo = new Uint8Array(nE);
    const facesKey = e => M.ET[e].map(t => fid[t]).sort((a, b) => a - b).join('_');
    const vEdges = new Map();   // vertice -> spigoli topologici incidenti
    for (let e = 0; e < nE; e++) {
      const fs = M.ET[e].map(t => fid[t]);
      if (fs.length !== 2 || fs[0] !== fs[1]) {
        isTopo[e] = 1;
        for (const v of [M.E0[e], M.E1[e]]) { if (!vEdges.has(v)) vEdges.set(v, []); vEdges.get(v).push(e); }
      }
    }
    // vertice "angolo" se grado ≠ 2 o se i due spigoli separano coppie di facce diverse
    const isCorner = v => { const l = vEdges.get(v); return l.length !== 2 || facesKey(l[0]) !== facesKey(l[1]); };
    // catene di spigoli mesh tra due angoli -> un EDGE_CURVE
    const chainOf = new Int32Array(nE).fill(-1), chains = [];
    const other = (e, v) => (M.E0[e] === v ? M.E1[e] : M.E0[e]);
    const walk = (startV, e0) => {
      const verts = [startV], edges = []; let v = startV, e = e0;
      for (;;) {
        chainOf[e] = chains.length; edges.push(e);
        v = other(e, v); verts.push(v);
        if (v === startV || isCorner(v)) break;
        const nx = vEdges.get(v).find(x => x !== e && chainOf[x] < 0);
        if (nx === undefined) break;
        e = nx;
      }
      chains.push({ verts, edges, closed: verts[0] === verts[verts.length - 1] });
    };
    for (const [v, l] of vEdges) if (isCorner(v)) for (const e of l) if (chainOf[e] < 0) walk(v, e);
    for (let e = 0; e < nE; e++) if (isTopo[e] && chainOf[e] < 0) walk(M.E0[e], e);   // anelli senza angoli

    // --- geometria delle catene: LINE, CIRCLE o polilinea B-spline grado 1 ---
    const vtx = new Map();
    const vertexPoint = v => { if (!vtx.has(v)) vtx.set(v, E(`VERTEX_POINT('',${pt(M.P(v))})`)); return vtx.get(v); };
    const curvedRadii = e => M.ET[e].map(t => faceInfo[fid[t]].region).filter(r => r.type === 'cylinder' || r.type === 'sphere').map(r => r.radius);
    const edgeStats = { line: 0, circle: 0, polyline: 0 };
    chains.forEach(ch => {
      const pts = ch.verts.map(v => M.P(v)), p0 = pts[0], pN = pts[pts.length - 1];
      const v0 = vertexPoint(ch.verts[0]), v1 = vertexPoint(ch.verts[ch.verts.length - 1]);
      let curve = null;
      // retta: tutti i punti entro tolleranza dalla congiungente estremi
      if (!ch.closed) {
        const d = norm(sub(pN, p0));
        let ok = len(sub(pN, p0)) > 0;
        for (const p of pts) { const w = sub(p, p0); if (len(sub(w, mul(d, dot(w, d)))) > tol * 0.5) { ok = false; break; } }
        if (ok) { curve = E(`LINE('',${pt(p0)},${E(`VECTOR('',${dir(d)},${stepNum(len(sub(pN, p0)))})`)})`); edgeStats.line++; }
      }
      // cerchio: punti complanari a raggio costante (≥4 punti o adiacente a faccia curva di pari raggio)
      if (!curve && pts.length >= 3) {
        const uniq = ch.closed ? pts.slice(0, -1) : pts;
        const pl = fitPlane(uniq);
        if (pl.maxErr <= tol) {
          const ax = pl.normal, u = perp(ax), w = cross(ax, u);
          const c = fitCircle2D(uniq.map(p => [dot(sub(p, pl.origin), u), dot(sub(p, pl.origin), w)]));
          if (c && c.r < M.diag * 20) {
            const ctr = add(pl.origin, add(mul(u, c.cx), mul(w, c.cy)));
            let err = 0; for (const p of uniq) err = Math.max(err, Math.abs(len(sub(p, ctr)) - c.r));
            const radii = curvedRadii(ch.edges[0]);
            const supported = uniq.length >= 4 || radii.some(r => Math.abs(r - c.r) <= tol);
            if (err <= tol && supported) {
              // verso antiorario rispetto all'asse = verso di percorrenza della catena
              let turn = 0; for (let i = 0; i + 1 < pts.length; i++) turn += dot(cross(sub(pts[i], ctr), sub(pts[i + 1], ctr)), ax);
              const zax = turn >= 0 ? ax : mul(ax, -1);
              const xref = norm(sub(p0, ctr));
              curve = E(`CIRCLE('',${place(ctr, zax, xref)},${stepNum(c.r)})`); edgeStats.circle++;
            }
          }
        }
      }
      // fallback: polilinea come B-spline lineare
      if (!curve) {
        const n = pts.length, mult = Array(n).fill(1); mult[0] = mult[n - 1] = 2;
        curve = E(`B_SPLINE_CURVE_WITH_KNOTS('',1,(${pts.map(pt).join(',')}),.POLYLINE_FORM.,.F.,.F.,(${mult.join(',')}),(${[...Array(n).keys()].map(i => stepNum(i)).join(',')}),.UNSPECIFIED.)`);
        edgeStats.polyline++;
      }
      ch.step = E(`EDGE_CURVE('',${v0},${v1},${curve},.T.)`);
    });

    // --- facce: superficie + anelli di bordo ---
    const solidsByComp = new Map();
    faceInfo.forEach((fi, f) => {
      const r = fi.region, tset = new Set(fi.tris);
      // semi-spigoli di bordo orientati come i triangoli (CCW visto da fuori)
      const half = new Map();   // vertice di partenza -> lista [a,b,e]
      for (const t of fi.tris) for (let k = 0; k < 3; k++) {
        const e = M.triEdge[3 * t + k]; if (!isTopo[e]) continue;
        if (M.ET[e].length === 2 && M.ET[e].every(x => tset.has(x))) continue;
        const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3];
        if (!half.has(a)) half.set(a, []); half.get(a).push([a, b, e]);
      }
      const used = new Set(), loops = [];
      for (const [, list] of half) for (const h0 of list) {
        if (used.has(h0)) continue;
        const loop = []; let h = h0;
        while (h && !used.has(h)) { used.add(h); loop.push(h); h = (half.get(h[1]) || []).find(x => !used.has(x)); }
        loops.push(loop);
      }
      const bounds = loops.map(loop => {
        // ruota l'anello per iniziare all'inizio di una catena
        const startsChain = ([a, , e]) => { const ch = chains[chainOf[e]]; const i = ch.edges.indexOf(e); return (ch.verts[i] === a && i === 0) || (ch.verts[i] !== a && i === ch.edges.length - 1); };
        const s = loop.findIndex(startsChain); const L = s > 0 ? loop.slice(s).concat(loop.slice(0, s)) : loop;
        const oe = [];
        for (let i = 0; i < L.length;) {
          const [a, , e] = L[i], ch = chains[chainOf[e]], j = ch.edges.indexOf(e), fwd = ch.verts[j] === a;
          oe.push(E(`ORIENTED_EDGE('',*,*,${ch.step},${fwd ? '.T.' : '.F.'})`));
          i += ch.edges.length;
        }
        // area proiettata (per scegliere il bordo esterno delle facce piane)
        let ar = 0; if (r.type === 'plane') for (const [a, b] of L) ar += dot(cross(M.P(a), M.P(b)), r.normal);
        return { loop: E(`EDGE_LOOP('',(${oe.join(',')}))`), ar };
      });
      let outer = -1; if (r.type === 'plane' && bounds.length) outer = bounds.reduce((bi, b, i) => (b.ar > bounds[bi].ar ? i : bi), 0);
      const fb = bounds.map((b, i) => E(`${i === outer ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${b.loop},.T.)`));
      let surf, sense = '.T.';
      if (r.type === 'plane') surf = E(`PLANE('',${place(r.origin, r.normal, perp(r.normal))})`);
      else if (r.type === 'freeform') { const t = fi.tris[0], n = [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]]; surf = E(`PLANE('',${place(M.P(M.T[3 * t]), n, perp(n))})`); }
      else if (r.type === 'cylinder') { surf = E(`CYLINDRICAL_SURFACE('',${place(r.origin, r.axis, perp(r.axis))},${stepNum(r.radius)})`); sense = r.outward ? '.T.' : '.F.'; }
      else if (r.type === 'sphere') { surf = E(`SPHERICAL_SURFACE('',${place(r.center, [0, 0, 1], [1, 0, 0])},${stepNum(r.radius)})`); sense = r.outward ? '.T.' : '.F.'; }
      const af = E(`ADVANCED_FACE('',(${fb.join(',')}),${surf},${sense})`);
      const c = M.comp[fi.tris[0]];
      if (!solidsByComp.has(c)) solidsByComp.set(c, []);
      solidsByComp.get(c).push(af);
    });

    // --- un solido per corpo; shell aperte -> superficie ---
    const items = [], surfItems = [];
    const closedComp = new Uint8Array(M.nComp).fill(1);
    for (let e = 0; e < nE; e++) if (M.ET[e].length !== 2) for (const t of M.ET[e]) closedComp[M.comp[t]] = 0;
    let bi = 0;
    for (const [c, faces] of solidsByComp) {
      bi++;
      if (closedComp[c]) items.push(E(`MANIFOLD_SOLID_BREP(${stepStr('Body' + bi)},${E(`CLOSED_SHELL('',(${faces.join(',')}))`)})`));
      else surfItems.push(E(`SHELL_BASED_SURFACE_MODEL(${stepStr('Surface' + bi)},(${E(`OPEN_SHELL('',(${faces.join(',')}))`)}))`));
    }
    const origin = place([0, 0, 0], [0, 0, 1], [1, 0, 0]);
    let rep;
    if (items.length) rep = E(`ADVANCED_BREP_SHAPE_REPRESENTATION(${stepStr(name)},(${[origin, ...items].join(',')}),${gctx})`);
    else rep = E(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION(${stepStr(name)},(${[origin, ...surfItems].join(',')}),${gctx})`);
    E(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    if (items.length && surfItems.length) {   // corpi aperti aggiunti come rappresentazione collegata
      const rep2 = E(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(${surfItems.join(',')}),${gctx})`);
      E(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${rep},${rep2})`);
    }

    const now = new Date().toISOString().slice(0, 19);
    const head = [
      'ISO-10303-21;', 'HEADER;',
      "FILE_DESCRIPTION(('Mesh2STEP export'),'2;1');",
      `FILE_NAME(${stepStr(name + '.step')},'${now}',('Mesh2STEP'),(''),'Mesh2STEP ${VERSION}','Mesh2STEP','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;',
    ];
    return { text: head.concat(lines, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n', faces: nF, edges: edgeStats, solids: items.length, surfaces: surfItems.length };
  }

  // ======================== Pipeline completa ========================
  function analyse(soup, opts) {
    const M = buildMesh(soup);
    const seg = segment(M, opts);
    return { M, seg };
  }

  const API = { VERSION, parseFile, parseSTL, parseOBJ, parse3MF, buildMesh, segment, exportSTEP, analyse, fitCylinder, fitSphere, fitPlane };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.M2S = API;
})(typeof self !== 'undefined' ? self : this);
