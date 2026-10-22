/*
 * Mesh2STEP — core.js
 * Versione: 1.13.3 — 2026-10-22 12:13 (Europe/Rome)  [1.1.0: coni, tori, filettature, B-spline, snap, riparazione, nomi corpi, editing]
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
  // [2026-10-07 v1.5.0] const VERSION = '1.4.1';
  // [2026-10-07 v1.5.1] const VERSION = '1.5.0';
  // [2026-10-07 v1.6.0] const VERSION = '1.5.1';
  // [2026-10-07 v1.7.0] const VERSION = '1.6.0';
  // [2026-10-08 v1.8.0] const VERSION = '1.7.0';
  // [2026-10-09 09:53 v1.9.0] const VERSION = '1.8.0';
  // [2026-10-21 14:15 v1.10.0] const VERSION = '1.9.0';
  // [2026-10-21 18:27 v1.11.0] const VERSION = '1.10.0';
  // [2026-10-21 19:26 v1.11.1] const VERSION = '1.11.0';
  // [2026-10-21 20:51 v1.11.2] const VERSION = '1.11.1';
  // [2026-10-21 21:49 v1.12.0] const VERSION = '1.11.2';
  // [2026-10-21 22:59 v1.13.0] const VERSION = '1.12.0';
  // [2026-10-22 09:19 v1.13.1] const VERSION = '1.13.0';
  // [2026-10-22 11:17 v1.13.2] const VERSION = '1.13.1';
  // [2026-10-22 12:13 v1.13.3] const VERSION = '1.13.2';
  const VERSION = '1.13.3';

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
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)|^\s*solid[ \t]*([^\r\n]*)/gm;
    const arr = [], names = [], triName = []; let m, cur = -1;   // [v1.1.0] nome di ogni 'solid'
    while ((m = re.exec(txt))) {
      if (m[1] === undefined) { const nm = (m[4] || '').trim(); if (nm) { cur = names.indexOf(nm); if (cur < 0) { names.push(nm); cur = names.length - 1; } } else cur = -1; continue; }
      arr.push(+m[1], +m[2], +m[3]); if (arr.length % 9 === 0) triName.push(cur);
    }
    if (!arr.length || arr.length % 9) throw new Error('STL non valido');
    const soup = new Float32Array(arr);
    if (names.length) { soup.triName = new Int32Array(triName); soup.names = names; }
    return soup;
  }

  function parseOBJ(buf) {
    const lines = new TextDecoder().decode(buf).split(/\r?\n/);
    const v = [], out = [], triName = [], names = []; let cur = -1;   // [v1.1.0] nomi da 'o'/'g'
    for (const l of lines) {
      if (/^[og]\s+/.test(l)) { const nm = l.slice(2).trim(); cur = names.indexOf(nm); if (cur < 0) { names.push(nm); cur = names.length - 1; } continue; }
      if (l.startsWith('v ')) { const p = l.trim().split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
      else if (l.startsWith('f ')) {
        // indici 1-based, negativi = relativi; formati v, v/vt, v/vt/vn, v//vn; poligoni -> ventaglio
        const idx = l.trim().split(/\s+/).slice(1).map(s => { const i = parseInt(s, 10); return i < 0 ? v.length + i : i - 1; });
        for (let k = 1; k + 1 < idx.length; k++) { for (const j of [idx[0], idx[k], idx[k + 1]]) out.push(...v[j]); triName.push(cur); }
      }
    }
    if (!out.length) throw new Error('OBJ senza facce');
    const soup = new Float32Array(out);
    if (names.length) { soup.triName = new Int32Array(triName); soup.names = names; }
    return soup;
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

  /* [2026-10-06] versione precedente parse3MF (senza trasformazioni build/component e senza nomi):
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

  */
  // [v1.1.0] 3MF: oggetti con nome, componenti annidati, trasformazioni di build/item e component,
  // unità convertite in mm; ogni triangolo conserva il nome dell'oggetto (-> nome del corpo nello STEP)
  async function parse3MF(buf) {
    const z = await unzip(buf);
    const models = z.names.filter(n => /\.model$/i.test(n));
    if (!models.length) throw new Error('3MF senza modello');
    const objs = new Map(); let build = [], sc = 1;
    const attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
    const parseM = s => { if (!s) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; const v = s.trim().split(/\s+/).map(Number); return v.length === 12 ? v : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; };
    // composizione: prima a, poi b (convenzione 3MF a vettore riga: p' = p·M)
    const comp = (a, b) => { const r = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { let v = i === 3 ? b[9 + j] : 0; for (let k = 0; k < 3; k++) v += (i < 3 ? a[i * 3 + k] : a[9 + k]) * b[k * 3 + j]; r.push(v); } return r; };
    const apply = (m, p) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9], p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10], p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];
    for (const n of models) {
      const xml = new TextDecoder().decode(await z.read(n));
      const unit = (xml.match(/<model[^>]*\bunit="([a-z]+)"/i) || [])[1];
      if (unit) sc = { micron: 1e-3, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] || 1;
      const ro = /<object\b([^>]*)>([\s\S]*?)<\/object>/g; let m;
      while ((m = ro.exec(xml))) {
        const id = attr(m[1], 'id'), name = attr(m[1], 'name'), body = m[2], o = { name, v: [], t: [], comps: [] };
        let k; const rv = /<vertex\s[^>]*?x="([^"]+)"[^>]*?y="([^"]+)"[^>]*?z="([^"]+)"/g;
        while ((k = rv.exec(body))) o.v.push([+k[1], +k[2], +k[3]]);
        const rt = /<triangle\s[^>]*?v1="(\d+)"[^>]*?v2="(\d+)"[^>]*?v3="(\d+)"/g;
        while ((k = rt.exec(body))) o.t.push([+k[1], +k[2], +k[3]]);
        const rc = /<component\b([^>]*)\/?>/g;
        while ((k = rc.exec(body))) o.comps.push({ id: attr(k[1], 'objectid'), m: parseM(attr(k[1], 'transform')) });
        objs.set(id, o);
      }
      const ri = /<item\b([^>]*)\/?>/g;
      while ((m = ri.exec(xml))) build.push({ id: attr(m[1], 'objectid'), m: parseM(attr(m[1], 'transform')) });
    }
    if (!build.length) build = [...objs.keys()].filter(id => objs.get(id).t.length).map(id => ({ id, m: parseM(null) }));
    const out = [], triName = [], names = [];
    const emit = (id, M, inherited, depth) => {
      const o = objs.get(id); if (!o || depth > 16) return;
      const nm = o.name || inherited;
      let ni = -1; if (nm) { ni = names.indexOf(nm); if (ni < 0) { names.push(nm); ni = names.length - 1; } }
      for (const [a, b, c] of o.t) { for (const vi of [a, b, c]) out.push(...apply(M, o.v[vi]).map(x => x * sc)); triName.push(ni); }
      for (const cp of o.comps) emit(cp.id, comp(cp.m, M), nm, depth + 1);
    };
    for (const it of build) emit(it.id, it.m, null, 0);
    if (!out.length) throw new Error('3MF senza triangoli');
    const soup = new Float32Array(out);
    soup.triName = new Int32Array(triName); soup.names = names;
    return soup;
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
    const keptName = [];   // [v1.1.0] nome sorgente dei triangoli conservati
    for (let i = 0; i < soup.length; i += 9) {
      const a = vid(soup[i], soup[i + 1], soup[i + 2]), b = vid(soup[i + 3], soup[i + 4], soup[i + 5]), c = vid(soup[i + 6], soup[i + 7], soup[i + 8]);
      if (a !== b && b !== c && a !== c) { Tl.push(a, b, c); if (soup.triName) keptName.push(soup.triName[i / 9]); }   // scarta triangoli degeneri
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
    // [v1.1.0] nome per corpo: nome più frequente tra i suoi triangoli
    let triName = null, compNames = null;
    if (soup.triName && soup.names) {
      triName = new Int32Array(keptName); compNames = [];
      const cnt = [...Array(nComp)].map(() => new Map());
      for (let t = 0; t < nT; t++) if (triName[t] >= 0) cnt[comp[t]].set(triName[t], (cnt[comp[t]].get(triName[t]) || 0) + 1);
      cnt.forEach((m, c) => { let best = -1, bn = 0; for (const [k, v] of m) if (v > bn) { bn = v; best = k; } compNames[c] = best >= 0 ? soup.names[best] : null; });
      // nomi ripetuti (più corpi nello stesso oggetto): suffisso _2, _3…
      const seen = new Map(); compNames = compNames.map(n => { if (!n) return n; const k = (seen.get(n) || 0) + 1; seen.set(n, k); return k > 1 ? n + '_' + k : n; });
    }
    return { V: Vf, T, N, A, C, nT, nV, E0, E1, ET, triEdge, nb, comp, nComp, open, nonManifold, bbox: [mn, mx], diag, volume: vol, area, P, triName, names: soup.names || null, compNames };
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
  // opts: { tol (mm), angle (gradi), cylinders, spheres, cones, tori, threads, nurbs, snap }  [v1.1.0: aggiunti cones..snap]
  function segment(M, opts) {
    const tol = opts.tol, cosA = Math.cos(opts.angle * Math.PI / 180), sinA = Math.sin(opts.angle * Math.PI / 180);
    const nT = M.nT, face = new Int32Array(nT).fill(-1), regions = [];
    const Nv = t => [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]];
    const cosDih = (t, u) => dot(Nv(t), Nv(u));       // coseno angolo diedro tra triangoli
    const maxStep = Math.cos(40 * Math.PI / 180);     // salto massimo tra facette di una superficie curva
    // [2026-10-21 v1.10.0] Inclinazione ammessa per rumore: un triangolo piccolo i cui vertici sono spostati di ±tol può avere la normale
    // inclinata fino a ~atan(2·tol/altezza minima). Il test "normale entro opts.angle" falliva su mesh rumorose (scansioni, float32, rimesh)
    // e frantumava piani e cilindri in centinaia di regioni: la soglia vale max(opts.angle, inclinazione da rumore), con tetto 15°.
    // Il controllo geometrico vero resta la distanza dei vertici dalla superficie (vertsOK), quindi su mesh esatte nulla cambia.
    const tiltSin = new Float64Array(nT), tiltCos = new Float64Array(nT), capT = 15 * Math.PI / 180;
    for (let t = 0; t < nT; t++) {
      const a = M.P(M.T[3 * t]), b = M.P(M.T[3 * t + 1]), c = M.P(M.T[3 * t + 2]);
      const lmax = Math.max(len(sub(b, a)), len(sub(c, b)), len(sub(a, c))), alt = lmax > 0 ? 2 * M.A[t] / lmax : 0;
      const tl = Math.max(opts.angle * Math.PI / 180, alt > 0 ? Math.min(Math.atan(2 * tol / alt), capT) : capT);
      tiltSin[t] = Math.sin(tl); tiltCos[t] = Math.cos(tl);
    }
    const mark = new Int32Array(nT).fill(-1); let stamp = 0;   // marcatura temporanea senza riallocare
    const vertsOK = (t, f) => { for (let k = 0; k < 3; k++) if (f(M.P(M.T[3 * t + k])) > tol) return false; return true; };
    const vertsOKt = (t, f, tl) => { for (let k = 0; k < 3; k++) if (f(M.P(M.T[3 * t + k])) > tl) return false; return true; };

    // ---- 4-00. [v1.1.0 2026-10-06] PRE-PASSO FILETTATURE: i fianchi di un filetto sono patch lisce
    //      lunghe ed elicoidali; se una patch supera il test dell'elica si raccolgono tutti i triangoli
    //      connessi nella fascia radiale [rmin, rmax] dello stesso asse (prima delle primitive, perché
    //      strisce di elicoide sembrano cilindri/coni)
    if (opts.threads !== false) {
      const cos25 = Math.cos(25 * Math.PI / 180), visited = new Uint8Array(nT);
      for (let s0 = 0; s0 < nT; s0++) {
        if (visited[s0] || face[s0] >= 0) continue;
        const patch = [s0]; visited[s0] = 1;
        for (let qi = 0; qi < patch.length; qi++) { const t = patch[qi]; for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && !visited[u] && face[u] < 0 && cosDih(t, u) > cos25) { visited[u] = 1; patch.push(u); } } }
        if (patch.length < 200) continue;
        const th = detectThread(M, patch, []);
        if (!th) continue;
        // fascia del filetto: triangoli connessi con vertici nel range radiale e assiale del fianco
        let inBand = t => { for (let k = 0; k < 3; k++) { const d = sub(M.P(M.T[3 * t + k]), th.origin), h = dot(d, th.axis), rho = len(sub(d, mul(th.axis, h))); if (rho < th.rmin - 2 * tol - 0.05 * (th.rmax - th.rmin) || rho > th.rmax + 2 * tol + 0.05 * (th.rmax - th.rmin)) return false; } return true; };
        // [v1.4.0 2026-10-07] i triangoli ⟂ asse (tappi/spalle) non appartengono al filetto: prima venivano inglobati se entro la fascia radiale
        const notCap = t => Math.abs(dot(Nv(t), th.axis)) <= 0.9986, inBand0 = inBand; inBand = t => notCap(t) && inBand0(t);
        const reg = [], inR = new Uint8Array(nT); const st = patch.filter(inBand);
        for (const t of st) inR[t] = 1;
        while (st.length) { const t = st.pop(); reg.push(t); for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && !inR[u] && face[u] < 0 && inBand(u)) { inR[u] = 1; st.push(u); } } }
        const full = detectThread(M, reg, [{ axis: th.axis, origin: th.origin }]) || th;
        const id = regions.length;
        regions.push(Object.assign({ id, type: 'thread', tris: reg }, full));
        for (const t of reg) { face[t] = id; visited[t] = 1; }
      }
    }

    // ---- 4-0. [v1.1.0 2026-10-06] PRE-PASSO NURBS: patch lisce (diedri < 25°) senza grandi zone piane
    //      che nessuna primitiva descrive -> superficie B-spline intera (evita mosaici di cilindri/sfere
    //      "accidentali" su superfici organiche)
    if (opts.nurbs !== false) {
      const cos25 = Math.cos(25 * Math.PI / 180), visited = new Uint8Array(nT);
      for (let s0 = 0; s0 < nT; s0++) {
        if (visited[s0] || face[s0] >= 0) continue;
        const patch = [s0]; visited[s0] = 1;
        for (let qi = 0; qi < patch.length; qi++) { const t = patch[qi]; for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && !visited[u] && face[u] < 0 && cosDih(t, u) > cos25) { visited[u] = 1; patch.push(u); } } }
        if (patch.length < 50) continue;
        // area del più grande gruppo complanare (normali entro 0,5°)
        const inP = new Set(patch), cl = new Uint8Array(nT); let tot = 0, big = 0;
        for (const t of patch) tot += M.A[t];
        const clusters = [];   // [v1.6.0] gruppi complanari (triangoli, area): servono a staccare i tappi piani da un tubo
        for (const t of patch) {
          if (cl[t]) continue; let a = 0; const st = [t], grp = [t]; cl[t] = 1;
          while (st.length) { const x = st.pop(); a += M.A[x]; for (let j = 0; j < 3; j++) { const u = M.nb[3 * x + j]; if (u >= 0 && inP.has(u) && !cl[u] && dot(Nv(u), Nv(t)) > Math.cos(0.5 * Math.PI / 180)) { cl[u] = 1; st.push(u); grp.push(u); } } }
          big = Math.max(big, a); clusters.push({ a, grp });
        }
        // [v1.6.0] tubo chiuso con tappi piani nella stessa patch (diedro < 25° su una parete ripida): si tolgono i grandi gruppi
        // complanari (> 5% dell'area) e si prova la B-spline chiusa sul resto (componente connessa più grande)
        const tryPeeled = () => {
          const flat = new Set(); for (const k of clusters) if (k.a > 0.05 * tot) for (const t of k.grp) flat.add(t);
          if (!flat.size) return null;
          const rest = patch.filter(t => !flat.has(t)), inR = new Set(rest), seen = new Set(); let bestC = [];
          for (const t0 of rest) { if (seen.has(t0)) continue; const comp = [t0], stc = [t0]; seen.add(t0); while (stc.length) { const x = stc.pop(); for (let j = 0; j < 3; j++) { const u = M.nb[3 * x + j]; if (u >= 0 && inR.has(u) && !seen.has(u)) { seen.add(u); comp.push(u); stc.push(u); } } } if (comp.length > bestC.length) bestC = comp; }
          if (bestC.length < 200) return null;
          const Bc = fitBSplineClosed(M, bestC, tol); return Bc && { B: Bc, tris: bestC };
        };
        if (big > 0.15 * tot) {   // [2026-10-07 v1.6.0] prima: if (big > 0.15 * tot) continue;
          const pe = tryPeeled(); if (!pe) continue;
          const id = regions.length; regions.push(Object.assign({ id, type: 'bspline', tris: pe.tris }, bsFields(pe.B))); for (const t of pe.tris) face[t] = id; continue;
        }
        // se una primitiva descrive tutta la patch, la lasciamo agli stadi successivi
        const pv = verticesOf(M, patch);
        const sp = fitSphere(pv); if (sp && sp.maxErr <= tol) continue;
        const cy = fitCylinder(M, patch, norm(axisFromNormals(M, patch)[0].vec)); if (cy && cy.maxErr <= tol) continue;
        const cn = fitCone(M, patch); if (cn && cn.maxErr <= tol) continue;
        const T = fitTorus(M, patch); if (T && T.maxErr <= tol) continue;
        // [v1.5.0] prima: const B = fitBSpline(M, patch, tol); if (!B) continue; regions.push({ id, type: 'bspline', tris: patch, nc: B.nc, cp: B.cp, segs: B.segs, err: B.maxErr, normal: B.normal, dist: B.dist });
        const B = fitBSplineAny(M, patch, tol);
        if (!B) {   // [v1.6.0] riprovo staccando i tappi piani
          const pe = tryPeeled(); if (!pe) continue;
          const id = regions.length; regions.push(Object.assign({ id, type: 'bspline', tris: pe.tris }, bsFields(pe.B))); for (const t of pe.tris) face[t] = id; continue;
        }
        const id = regions.length;
        regions.push(Object.assign({ id, type: 'bspline', tris: patch }, bsFields(B)));
        for (const t of patch) face[t] = id;
      }
    }

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

    // ---- 4a-quater. [v1.1.0 2026-10-06] TORI (raccordi su spigoli circolari), prima di coni e cilindri:
    //      i loro anelli/meridiani sembrerebbero coni o cilindri. Seme solo su zone a doppia curvatura.
    if (opts.tori !== false) {
      const torTried = new Uint8Array(nT);
      for (let s = 0; s < nT; s++) {
        if (face[s] >= 0 || torTried[s]) continue;
        let soft = 0; for (let j = 0; j < 3; j++) { const u = M.nb[3 * s + j]; if (u >= 0 && face[u] < 0) { const cd = cosDih(s, u); if (cd < Math.cos(0.3 * Math.PI / 180) && cd > maxStep) soft++; } }
        if (soft < 2) continue;
        const grow = (T, tolG, lim) => {
          stamp++; const reg = [s]; mark[s] = stamp;
          for (let qi = 0; qi < reg.length && reg.length < lim; qi++) {
            const t = reg[qi];
            for (let j = 0; j < 3; j++) {
              const u = M.nb[3 * t + j];
              if (u < 0 || face[u] >= 0 || mark[u] === stamp) continue;
              if (cosDih(t, u) < maxStep) continue;
              if (T && !vertsOKt(u, p => Math.abs(torusDist(T, p)), tolG)) continue;
              mark[u] = stamp; reg.push(u);
            }
          }
          return reg;
        };
        let reg = grow(null, 0, 48);
        for (const t of reg) torTried[t] = 1;
        if (reg.length < 24) continue;
        // doppia curvatura: le normali devono coprire due direzioni (esclude piani, cilindri, coni)
        const ev = axisFromNormals(M, reg), tot = ev[0].val + ev[1].val + ev[2].val;
        if (!(ev[0].val / tot > 2e-4)) continue;
        let T = fitTorus(M, reg);
        const okT = T => T && T.maxErr <= tol && T.r > tol && T.R > T.r + tol && T.R < M.diag * 2 && T.r < M.diag * 0.5;
        if (!okT(T)) continue;
        for (let it = 0; it < 6; it++) {
          const r2 = grow(T, 3 * tol, Infinity), f2 = fitTorus(M, r2);
          if (!f2) break;
          const stable = r2.length === reg.length; reg = r2; T = f2; if (stable) break;
        }
        reg = reg.filter(t => vertsOKt(t, p => Math.abs(torusDist(T, p)), tol));
        if (reg.length < 24 || !okT(T)) continue;
        for (const t of reg) torTried[t] = 1;
        // [2026-10-21 v1.10.0] un cilindro o un piano che spiega tutta la regione (entro 2·tol) vince sul toro: con mesh rumorose
        // la "doppia curvatura" è solo rumore e un foro diventava un toro enorme (R 15, r 11) invece di un cilindro.
        {
          const vs = verticesOf(M, reg), axC = norm(axisFromNormals(M, reg)[0].vec);
          const perpT = reg.filter(t => Math.abs(dot(Nv(t), axC)) <= 3 * tiltSin[t]);   // il resto (pochi triangoli piani inglobati) non conta
          let cy = perpT.length >= 0.9 * reg.length ? fitCylinder(M, perpT, axC) : null, inl = perpT;
          // adattamento robusto: a ogni giro si scarta il 3% di triangoli più lontani (pareti/piani inglobati) e si rifitta
          for (let it = 0; it < 6 && cy && cy.maxErr > 2 * tol; it++) {
            const c0 = cy, er = t => Math.max(...[0, 1, 2].map(k => { const d = sub(M.P(M.T[3 * t + k]), c0.origin); return Math.abs(len(sub(d, mul(axC, dot(d, axC)))) - c0.radius); }));
            const sorted = inl.map(t => [er(t), t]).sort((x, y) => x[0] - y[0]);
            inl = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.97))).map(x => x[1]);
            cy = inl.length >= 0.9 * reg.length ? fitCylinder(M, inl, axC) : null;
          }
          if ((cy && cy.maxErr <= 2 * tol && cy.radius < M.diag * 20 && inl.length >= 0.9 * reg.length) || fitPlane(vs).maxErr <= 2 * tol) continue;
        }
        let out = 0;
        for (const t of reg) { const p = [M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], d = sub(p, T.center), h = dot(d, T.axis), q = add(T.center, mul(norm(sub(d, mul(T.axis, h))), T.R)); out += M.A[t] * dot(Nv(t), sub(p, q)); }
        const id = regions.length;
        regions.push({ id, type: 'torus', tris: reg, center: T.center, axis: T.axis, R: T.R, r: T.r, err: T.maxErr, outward: out >= 0 });
        for (const t of reg) face[t] = id;
      }
    }

    // ---- 4a-ter. [v1.1.0 2026-10-06] CONI (prima dei cilindri: strisce di cono sembrano cilindri corti) (smussi, svasature): crescita libera 12 triangoli,
    //      fit, ri-crescita iterativa con vincolo 3·tol e refit (come per le sfere) ----
    if (opts.cones !== false) {
      const coneTried = new Uint8Array(nT);
      for (let s = 0; s < nT; s++) {
        if (face[s] >= 0 || coneTried[s]) continue;
        let soft = 0; for (let j = 0; j < 3; j++) { const u = M.nb[3 * s + j]; if (u >= 0 && face[u] < 0) { const cd = cosDih(s, u); if (cd < Math.cos(0.3 * Math.PI / 180) && cd > maxStep) soft++; } }
        if (soft < 1) continue;
        coneTried[s] = 1;
        const grow = (cn, tolG, lim) => {
          stamp++; const reg = [s]; mark[s] = stamp;
          for (let qi = 0; qi < reg.length && reg.length < lim; qi++) {
            const t = reg[qi];
            for (let j = 0; j < 3; j++) {
              const u = M.nb[3 * t + j];
              if (u < 0 || face[u] >= 0 || mark[u] === stamp) continue;
              if (cosDih(t, u) < maxStep) continue;
              if (cn && !vertsOKt(u, p => coneDist(cn, p), tolG)) continue;
              mark[u] = stamp; reg.push(u);
            }
          }
          return reg;
        };
        let reg = grow(null, 0, 12);
        if (reg.length < 6) continue;
        let cn = fitCone(M, reg);
        const okCone = c => c && c.maxErr <= tol && c.alpha > 2 * Math.PI / 180 && c.alpha < 88 * Math.PI / 180;
        if (!okCone(cn)) continue;
        for (let it = 0; it < 6; it++) {
          const r2 = grow(cn, 3 * tol, Infinity), f2 = fitCone(M, r2);
          if (!f2) break;
          const stable = r2.length === reg.length; reg = r2; cn = f2; if (stable) break;
        }
        reg = reg.filter(t => vertsOKt(t, p => coneDist(cn, p), tol));
        if (reg.length < 4) continue;
        for (const t of reg) coneTried[t] = 1;
        cn = fitCone(M, reg);
        if (!okCone(cn)) continue;
        if (fitPlane(verticesOf(M, reg)).maxErr <= tol) continue;
        // ≥3 orientazioni di facetta attorno all'asse
        const u0 = perp(cn.axis), v0 = cross(cn.axis, u0);
        const angs = reg.map(t => Math.atan2(dot(Nv(t), v0), dot(Nv(t), u0))).sort((a, b) => a - b);
        let clusters = 1; for (let i = 1; i < angs.length; i++) if (angs[i] - angs[i - 1] > 0.5 * Math.PI / 180) clusters++;
        if (clusters < 3) continue;
        // anti-toro: il bordo non deve proseguire in modo morbido su triangoli liberi fuori dal cono
        {
          const inReg = new Set(reg); let bl = 0, smooth = 0;
          for (const t of reg) for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * t + j]; if (u >= 0 && inReg.has(u)) continue;
            const l = len(sub(M.P(M.T[3 * t + (j + 1) % 3]), M.P(M.T[3 * t + j]))); bl += l;
            const fu = u >= 0 ? face[u] : -2, freeN = fu === -1 || (fu >= 0 && (regions[fu].type === 'cylinder' || regions[fu].type === 'cone'));
            if (u >= 0 && freeN && cosDih(t, u) > maxStep && !vertsOK(u, p => coneDist(cn, p))) smooth += l;
          }
          if (bl > 0 && smooth > 0.3 * bl) continue;
        }
        let out = 0; for (const t of reg) { const d = sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], cn.apex); out += M.A[t] * dot(Nv(t), sub(d, mul(cn.axis, dot(d, cn.axis)))); }
        const id = regions.length;
        regions.push({ id, type: 'cone', tris: reg, apex: cn.apex, axis: cn.axis, alpha: cn.alpha, hmin: cn.hmin, hmax: cn.hmax, err: cn.maxErr, outward: out >= 0 });
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
        // [2026-10-21 v1.10.0] asse iniziale robusto: cross(n1,n2) di soli 2 triangoli è troppo sensibile al rumore (errore di ~10° con
        // vertici spostati di 0,01 mm su facette da 0,5 mm) e la crescita si fermava subito. Si prende una piccola toppa (fino a 12
        // triangoli lisci intorno al seme) e l'asse è l'autovettore minimo delle sue normali; se la toppa è piccola resta l'asse a 2 triangoli.
        {
          const patch = [s, s2];
          for (let qi = 0; qi < patch.length && patch.length < 12; qi++) for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * patch[qi] + j];
            if (u < 0 || face[u] >= 0 || mark[u] === stamp || cosDih(patch[qi], u) < maxStep) continue;
            mark[u] = stamp; patch.push(u); if (patch.length >= 12) break;
          }
          if (patch.length >= 6) {
            const a2 = norm(axisFromNormals(M, patch)[0].vec);
            if (len(a2) > 0 && fitCylinder(M, patch, a2)) { axis = a2; reg.length = 0; reg.push(...patch); }
            else for (const t of patch) if (t !== s && t !== s2) mark[t] = 0;
          } else for (const t of patch) if (t !== s && t !== s2) mark[t] = 0;
        }
        // cerchio iniziale dai 3 punti proiettati della coppia seme (esatto su mesh da CAD):
        // evita che la crescita "scivoli" su piani tangenti prima del primo refit
        let cyl = fitCylinder(M, reg, axis); if (cyl && cyl.radius > M.diag * 20) cyl = null;
        let nextFit = 6; const queue = reg.slice();   // [2026-10-21 v1.10.0] prima: const queue = [s, s2];
        for (let qi = 0; qi < queue.length; qi++) {
          const t = queue[qi];
          for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * t + j];
            if (u < 0 || face[u] >= 0 || mark[u] === stamp) continue;
            if (cosDih(t, u) < maxStep) continue;
            // [2026-10-21 v1.10.0] prima: if (Math.abs(dot(Nv(u), axis)) > sinA) continue;
            if (Math.abs(dot(Nv(u), axis)) > tiltSin[u]) continue;            // normale ⟂ asse (con tolleranza da rumore)
            // [2026-10-21 v1.10.0] prima: if (cyl && !vertsOK(u, ...)) continue;  e  if (c && c.maxErr <= tol) { ... }
            // Con mesh rumorose il cilindro iniziale (2 soli triangoli) ha asse e raggio sbagliati: finché la regione ha meno di 24
            // triangoli la soglia è 3·tol, poi torna tol (il refit a 6, 9, 14… triangoli stabilizza l'asse).
            const tolG = reg.length < 24 ? 3 * tol : tol;
            if (cyl && !vertsOKt(u, p => { const d = sub(p, cyl.origin); const h = dot(d, axis); return Math.abs(len(sub(d, mul(axis, h))) - cyl.radius); }, tolG)) continue;
            mark[u] = stamp; reg.push(u); queue.push(u);
            if (reg.length >= nextFit) {                                  // riallinea asse e raggio
              const ax = axisFromNormals(M, reg)[0].vec;
              const c = fitCylinder(M, reg, norm(ax));
              if (c && c.maxErr <= tolG) { cyl = c; axis = c.axis; }
              nextFit = Math.ceil(nextFit * 1.5);
            }
          }
        }
        // validazione finale
        if (reg.length < 4) continue;
        const ax = norm(axisFromNormals(M, reg)[0].vec), c = fitCylinder(M, reg, ax);
        if (!c || c.maxErr > tol || c.radius > M.diag * 20) continue;
        // [v1.1.0 2026-10-06] tutte le normali ⟂ all'asse finale (esclude strisce di coni/tori)
        // [2026-10-21 v1.10.0] prima: if (reg.some(t => Math.abs(dot(Nv(t), ax)) > 2 * sinA)) continue;
        if (reg.some(t => Math.abs(dot(Nv(t), ax)) > 2 * tiltSin[t])) continue;
        if (fitPlane(verticesOf(M, reg)).maxErr <= tol) continue;     // è in realtà un piano
        // almeno 3 orientazioni di facetta distinte attorno all'asse
        const u0 = perp(ax), v0 = cross(ax, u0);
        const angs = reg.map(t => Math.atan2(dot(Nv(t), v0), dot(Nv(t), u0))).sort((a, b) => a - b);
        let clusters = 1; for (let i = 1; i < angs.length; i++) if (angs[i] - angs[i - 1] > 0.5 * Math.PI / 180) clusters++;
        if (clusters < 3) continue;
        // [2026-10-05 17:55] rifiuta "falsi cilindri" (strisce di toro/freeform): se oltre metà dei bordi
        // di estremità (⟂ asse) prosegue in modo morbido su triangoli liberi non ⟂ asse, la superficie
        // continua a curvare in un'altra direzione -> non è un cilindro.
        /* [2026-10-06 13:22] versione precedente (soglia unica su entrambe le estremità insieme):
        {
          const inReg = new Set(reg); let endLen = 0, smoothLen = 0;
          for (const t of reg) for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * t + j]; if (u >= 0 && inReg.has(u)) continue;
            const a = M.P(M.T[3 * t + j]), b = M.P(M.T[3 * t + (j + 1) % 3]), dv = sub(b, a), l = len(dv);
            if (Math.abs(dot(dv, ax)) / l > 0.5) continue;                       // bordo laterale, non di estremità
            endLen += l;
            // [2026-10-06] versione precedente: contava solo vicini non assegnati (face[u] < 0)
            // if (u >= 0 && face[u] < 0 && cosDih(t, u) > maxStep && Math.abs(dot(Nv(u), ax)) > 3 * sinA) smoothLen += l;
            // ora anche vicini già riconosciuti come cilindri/coni (anelli adiacenti di un toro)
            const fu = u >= 0 ? face[u] : -2, freeN = fu === -1 || (fu >= 0 && (regions[fu].type === 'cylinder' || regions[fu].type === 'cone'));
            if (u >= 0 && freeN && cosDih(t, u) > maxStep && Math.abs(dot(Nv(u), ax)) > 3 * sinA) smoothLen += l;
          }
          if (endLen > 0 && smoothLen > 0.5 * endLen) continue;
        }
        */
        // [v1.1.0] estremità valutate separatamente: un cilindro con raccordo tangente a UN capo è valido;
        // se entrambi i capi proseguono morbidi ed è basso rispetto al raggio è un anello di toro
        {
          const inReg = new Set(reg), hc = (() => { let a = 0; for (const p of verticesOf(M, reg)) a += dot(sub(p, c.origin), ax); return a / verticesOf(M, reg).length; })();
          const endL = [0, 0], smL = [0, 0];
          for (const t of reg) for (let j = 0; j < 3; j++) {
            const u = M.nb[3 * t + j]; if (u >= 0 && inReg.has(u)) continue;
            const a = M.P(M.T[3 * t + j]), b = M.P(M.T[3 * t + (j + 1) % 3]), dv = sub(b, a), l = len(dv);
            if (Math.abs(dot(dv, ax)) / l > 0.5) continue;
            const side = dot(sub(mul(add(a, b), 0.5), c.origin), ax) > hc ? 1 : 0;
            endL[side] += l;
            const fu = u >= 0 ? face[u] : -2, freeN = fu === -1 || (fu >= 0 && (regions[fu].type === 'cylinder' || regions[fu].type === 'cone'));
            if (u >= 0 && freeN && cosDih(t, u) > maxStep && Math.abs(dot(Nv(u), ax)) > 3 * sinA) smL[side] += l;
          }
          const sm0 = endL[0] > 0 && smL[0] > 0.5 * endL[0], sm1 = endL[1] > 0 && smL[1] > 0.5 * endL[1];
          if (sm0 && sm1 && c.height < c.radius) continue;
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
      // [2026-10-21 v1.10.0] prima: const n = ..., d0 = ... fissi dal solo triangolo seme (un piano per 3 vertici rumorosi, esteso lontano,
      // si scosta oltre tol e la crescita si fermava: ogni triangolo diventava una faccia). Ora il piano si rifitta a 4, 8, 16… triangoli
      // (fitPlane sui vertici della regione) e finché la regione è piccola la soglia è 2·tol.
      let n = Nv(s), d0 = dot(n, [M.C[3 * s], M.C[3 * s + 1], M.C[3 * s + 2]]), nextFit = 4;
      const id = regions.length, reg = [s]; face[s] = id;
      const st = [s];
      while (st.length) {
        const t = st.pop();
        for (let j = 0; j < 3; j++) {
          const u = M.nb[3 * t + j];
          if (u < 0 || face[u] >= 0) continue;
          // [2026-10-21 v1.10.0] prima: if (dot(Nv(u), n) < cosA) continue;
          if (dot(Nv(u), n) < tiltCos[u]) continue;
          if (!vertsOKt(u, p => Math.abs(dot(p, n) - d0), reg.length < 16 ? 2 * tol : tol)) continue;
          face[u] = id; reg.push(u); st.push(u);
          if (reg.length >= nextFit) {
            const pl = fitPlane(verticesOf(M, reg));
            if (pl && pl.maxErr <= 2 * tol) { const sg = dot(pl.normal, n) >= 0 ? 1 : -1; n = mul(pl.normal, sg); d0 = dot(n, pl.origin); }
            nextFit *= 2;
          }
        }
      }
      // [2026-10-21 v1.13.1] prima: origin = baricentro del triangolo seme (con la normale rifittata il piano poteva stare fino a tol dai vertici,
      // sempre dallo stesso lato: errore sistematico di volume, es. 110 mm³ su un piano di 1 153 mm² del Plenum). Ora il piano ai minimi quadrati.
      let porg = [M.C[3 * s], M.C[3 * s + 1], M.C[3 * s + 2]];
      if (reg.length > 1) { const plf = fitPlane(verticesOf(M, reg)); if (Math.abs(dot(plf.normal, n)) > 0.999) porg = plf.origin; }
      regions.push({ id, type: 'plane', tris: reg, normal: n, origin: porg });
    }

    // ---- 4c. FREEFORM: piani da 1-2 triangoli immersi in zone morbide ----
    for (const r of regions) {
      if (r.type !== 'plane' || r.tris.length > 2) continue;
      let sharp = true;
      for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && face[u] !== r.id && regions[face[u]].type === 'plane' && cosDih(t, u) > Math.cos(20 * Math.PI / 180)) sharp = false; }  // [2026-10-05 17:45] i vicini analitici (cilindri/sfere) tangenti non rendono freeform un piano
      if (!sharp) r.type = 'freeform';
    }

    // ---- 4d. [v1.1.0 2026-10-06] MACCHIE FREEFORM -> filettature, tori, B-spline ----
    // candidate = freeform o piccoli piani (≤6 triangoli) con un vicino "morbido" non analitico
    {
      const isCand = r => r.type === 'freeform' || (r.type === 'plane' && r.tris.length <= 6 && r.tris.some(t => [0, 1, 2].some(j => { const u = M.nb[3 * t + j]; return u >= 0 && face[u] !== r.id && ['freeform', 'plane'].includes(regions[face[u]].type) && cosDih(t, u) > Math.cos(20 * Math.PI / 180); })));
      const cand = regions.map(isCand), seen = new Uint8Array(regions.length);
      const blobs = [];
      for (const r0 of regions) {
        if (!cand[r0.id] || seen[r0.id]) continue;
        const blob = [], st = [r0.id]; seen[r0.id] = 1;
        while (st.length) {
          const r = regions[st.pop()]; blob.push(r);
          for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0) continue; const f = face[u]; if (cand[f] && !seen[f]) { seen[f] = 1; st.push(f); } }
        }
        if (blob.length > 1 || blob[0].type === 'freeform') blobs.push(blob);
      }
      const replace = (blob, reg) => {
        const tris = blob.flatMap(r => r.tris), id = regions.length;
        reg.id = id; reg.tris = tris; regions.push(reg);
        for (const r of blob) { r.type = 'merged'; r.tris = []; }
        for (const t of tris) face[t] = id;
      };
      for (const blob of blobs) {
        const tris = blob.flatMap(r => r.tris); if (tris.length < 8) continue;
        // filettatura: assi candidati dalle regioni di rivoluzione confinanti
        if (opts.threads !== false && tris.length >= 40) {
          const inB = new Set(tris), ax = [];
          for (const t of tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0 || inB.has(u)) continue; const r = regions[face[u]]; if ((r.type === 'cylinder' || r.type === 'cone') && !ax.some(a => a.src === r)) ax.push({ src: r, axis: r.axis, origin: r.type === 'cylinder' ? r.origin : r.apex }); }
          const th = detectThread(M, tris, ax.map(a => ({ axis: a.axis, origin: a.origin })));
          if (th) { replace(blob, Object.assign({ type: 'thread' }, th)); continue; }
        }
        // toro
        if (opts.tori !== false && tris.length >= 12) {
          const T = fitTorus(M, tris);
          if (T && T.maxErr <= tol && T.r > tol && T.R > T.r && T.R < M.diag * 2 && T.r < M.diag * 0.5) {  // [2026-10-06] limiti R/r più stretti (prima: T.R < M.diag * 20)
            const ev = axisFromNormals(M, tris), tot = ev[0].val + ev[1].val + ev[2].val;
            if (ev[0].val / tot > 1e-4) {
              let out = 0;
              for (const t of tris) { const p = [M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], d = sub(p, T.center), h = dot(d, T.axis), q = add(T.center, mul(norm(sub(d, mul(T.axis, h))), T.R)); out += M.A[t] * dot(Nv(t), sub(p, q)); }
              replace(blob, { type: 'torus', center: T.center, axis: T.axis, R: T.R, r: T.r, err: T.maxErr, outward: out >= 0 });
              continue;
            }
          }
        }
        // B-spline (NURBS non razionale) come campo di altezze
        if (opts.nurbs !== false && tris.length >= 16) {
          const B = fitBSplineAny(M, tris, tol);   // [v1.5.0] prima: fitBSpline (solo patch aperte)
          if (B) replace(blob, Object.assign({ type: 'bspline' }, bsFields(B)));   // [v1.5.0] prima: campi elencati a mano (solo aperta)
        }
      }
    }

    // ---- 4d-bis. [v1.11.0 2026-10-21] PATCH B-SPLINE PER SUPERFICI LISCE "DEBOLI" ----
    // Una superficie liscia a forma libera (scoop, condotti, carene) con la tolleranza data si spezzava in centinaia di sfere e cilindri
    // di raggio enorme (R >> dimensione della regione: sono solo curvatura dolce approssimata) o in freeform triangolo per triangolo.
    // Qui le regioni "deboli" (freeform, quadriche con R > 4× la loro estensione, piccoli piani ≤ 6 triangoli accanto a loro) connesse
    // da diedri < 30° vengono unite a patch B-spline: si aggiungono regioni intere in ordine di adiacenza e si controlla l'adattamento
    // (campo di altezze, scarto ≤ tol) a 3, 6, 12, 24… regioni; alla prima rottura si cerca a metà e si chiude la patch.
    if (opts.nurbs !== false) {
      const extent = r => { let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const p of verticesOf(M, r.tris)) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } return len(sub(mx, mn)); };
      const weak = new Set(), badSag = new Set();
      for (const r of regions) {
        if (!r.tris.length || r.type === 'merged') continue;
        if (r.type === 'freeform') weak.add(r.id);
        else if ((r.type === 'sphere' || r.type === 'cylinder' || r.type === 'torus') && (r.type === 'torus' ? r.R : r.radius) > 4 * extent(r)) weak.add(r.id);
        else if (r.type === 'sphere' || r.type === 'cylinder') {
          // [2026-10-21 v1.11.1] sfera/cilindro con triangoli lunghi: i vertici stanno sulla superficie ma il punto medio degli spigoli (la corda) è
          // lontano (fino a 13 mm su una "sfera" R 97 del file Plenum): la mesh non è su quella superficie e gli spigoli di bordo esportati non
          // stanno sulla faccia (STEP non valido). Soglia max(3·tol, 3% del raggio): le sfere/cilindri tessellati in modo grossolano restano.
          let sag = 0;
          for (const t of r.tris) for (let k = 0; k < 3; k++) {
            const m = mul(add(M.P(M.T[3 * t + k]), M.P(M.T[3 * t + (k + 1) % 3])), 0.5);
            sag = Math.max(sag, r.type === 'sphere' ? Math.abs(r.radius - len(sub(m, r.center))) : (() => { const d = sub(m, r.origin); return Math.abs(r.radius - len(sub(d, mul(r.axis, dot(d, r.axis))))); })());
          }
          if (sag > Math.max(3 * tol, 0.03 * r.radius)) { weak.add(r.id); badSag.add(r.id); }
        }
      }
      for (const r of regions) {   // piccoli piani incastrati tra regioni deboli
        if (r.type !== 'plane' || r.tris.length > 6 || !r.tris.length) continue;
        let n = 0, tot = 0; for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0 || face[u] === r.id) continue; tot++; if (weak.has(face[u])) n++; }
        if (tot > 0 && n >= 0.5 * tot) weak.add(r.id);
      }
      // secondo livello: quadriche a raggio moderato (R > 2× estensione) che formano una catena liscia di ≥ 4 regioni curve confinanti
      // (con raggi diversi tra loro) sono un mosaico di una superficie libera, non vere sfere/cilindri: una vera sfera/cilindro confina
      // con piani o con raccordi, non con una catena di altre quadriche quasi piatte
      // [2026-10-21 v1.11.0] prima: solo quadriche con R > 2× estensione; ora tutte le sfere/cilindri/tori, ma una catena è "organica" solo se
      // i raggi variano (max/min > 1,8): una catena di raccordi di un pezzo CAD ha raggi uguali (cilindri e sfere d'angolo di raggio r).
      const radOf = r => r.type === 'torus' ? r.r : r.radius;
      const soft2 = new Set();
      for (const r of regions) if (r.tris.length && !weak.has(r.id) && (r.type === 'sphere' || r.type === 'cylinder' || r.type === 'torus')) soft2.add(r.id);
      const cand = new Set([...weak, ...soft2]), adj0 = new Map();
      for (const id of cand) adj0.set(id, new Set());
      for (let t = 0; t < nT; t++) { const a = face[t]; if (!cand.has(a)) continue; for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0) continue; const b = face[u]; if (b !== a && cand.has(b) && cosDih(t, u) > Math.cos(30 * Math.PI / 180)) { adj0.get(a).add(b); adj0.get(b).add(a); } } }
      const seen0 = new Set();
      for (const id of cand) {
        if (seen0.has(id)) continue;
        const comp = [id]; seen0.add(id);
        for (let qi = 0; qi < comp.length; qi++) for (const nb of adj0.get(comp[qi])) if (!seen0.has(nb)) { seen0.add(nb); comp.push(nb); }
        const rads = comp.filter(c => regions[c].type !== 'freeform' && regions[c].tris.length >= 8).map(c => radOf(regions[c])).filter(x => x > 0);
        const varied = rads.length >= 2 && Math.max(...rads) / Math.min(...rads) > 1.8;
        // catena di ≥ 4 regioni curve confinanti (con almeno una già debole o raggi variabili) = mosaico di una superficie libera
        if (comp.length >= 4 && (varied || comp.some(c => weak.has(c)))) for (const c of comp) weak.add(c);
      }
      const adj = new Map();   // regione debole -> regioni deboli confinanti con diedro lieve
      for (const id of weak) adj.set(id, new Set());
      for (let t = 0; t < nT; t++) { const a = face[t]; if (!weak.has(a)) continue; for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0) continue; const b = face[u]; if (b !== a && weak.has(b) && cosDih(t, u) > Math.cos(30 * Math.PI / 180)) { adj.get(a).add(b); adj.get(b).add(a); } } }
      const done = new Set();
      const regTris = ids => ids.flatMap(i => regions[i].tris);
      let guardFits = 0;
      // crescita delle patch con tolleranza tolG sulle regioni di `weakSet` (adiacenza `adjM`)
      const growPatches = (weakSet, adjM, tolG) => {
        const ordered = [...weakSet].sort((a, b) => regions[b].tris.length - regions[a].tris.length);
        for (const seed of ordered) {
          if (done.has(seed) || !regions[seed].tris.length || guardFits > 600 || regions[seed].type === 'bspline') continue;
          // ordine di crescita: BFS di regioni dal seme
          const order = [seed], seen = new Set([seed]);
          for (let qi = 0; qi < order.length; qi++) for (const nb of adjM.get(order[qi]) || []) if (!seen.has(nb) && !done.has(nb) && regions[nb].tris.length) { seen.add(nb); order.push(nb); }
          let okN = 0, okB = null, size = 3, failed = false;
          const tryN = n => { guardFits++; return fitBSpline(M, regTris(order.slice(0, n)), tolG); };
          while (okN < order.length && !failed) {
            const n = Math.min(order.length, size), B = tryN(n);
            if (B) { okN = n; okB = B; if (n === order.length) break; size *= 2; }
            else {
              failed = true;
              let lo = okN, hi = n;   // bisezione tra l'ultimo adattamento riuscito e il primo fallito
              while (hi - lo > 1 && guardFits <= 600) { const mid = (lo + hi) >> 1, Bm = tryN(mid); if (Bm) { lo = mid; okB = Bm; okN = mid; } else hi = mid; }
            }
          }
          if (!okB || okN < 1) continue;
          const ids = order.slice(0, okN), tris = regTris(ids);
          if (tris.length < 16) continue;
          const id = regions.length; regions.push(Object.assign({ id, type: 'bspline', tris }, bsFields(okB)));
          for (const i of ids) { regions[i].type = 'merged'; regions[i].tris = []; done.add(i); }
          for (const t of tris) face[t] = id;
        }
      };
      // assorbimento dei frammenti: regioni piccole (≤ 150 triangoli, non B-spline) confinanti con una patch e con tutti i vertici entro
      // 2·tolG dalla sua superficie (scarto verticale `dist`) ne fanno parte (prima restavano piani/freeform da pochi triangoli lungo la patch)
      const absorb = tolG => {
        // [2026-10-21 v1.11.1] prima: soglia 2·tolG e nessun rifit (la patch restava quella di prima e i vertici assorbiti arrivavano fino a
        // 0,15 mm da una superficie con err 0,03: gli spigoli di bordo non stavano sulla faccia e OpenCASCADE la segnava non valida).
        // Ora: soglia tolG, poi la B-spline si rifitta su tutti i triangoli della patch; se il rifit non sta in tolG l'assorbimento si annulla.
        for (let pass = 0; pass < 3; pass++) {
          const added = new Map();   // patch -> frammenti aggiunti in questa passata
          for (const r of regions) {
            if (r.type === 'bspline' || r.type === 'merged' || r.type === 'thread' || !r.tris.length || r.tris.length > 150) continue;
            const cands = new Set(); for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && face[u] !== r.id && regions[face[u]].type === 'bspline' && regions[face[u]].dist && !regions[face[u]].closedU) cands.add(face[u]); }
            let best = null, bd = Infinity;
            for (const bid of cands) { const B = regions[bid]; let d = 0; for (const t of r.tris) for (let k = 0; k < 3; k++) d = Math.max(d, B.dist(M.P(M.T[3 * t + k]))); if (d <= tolG && d < bd) { bd = d; best = B; } }
            if (!best) continue;
            if (!added.has(best)) added.set(best, []);
            added.get(best).push({ r, type: r.type, tris: r.tris });
            for (const t of r.tris) face[t] = best.id;
            best.tris = best.tris.concat(r.tris); r.type = 'merged'; r.tris = [];
          }
          if (!added.size) break;
          for (const [B, frs] of added) {
            const F = fitBSpline(M, B.tris, tolG);
            if (F) { Object.assign(B, bsFields(F)); continue; }
            const back = new Set(frs.flatMap(x => x.tris));   // rifit fallito: si restituiscono i frammenti
            B.tris = B.tris.filter(t => !back.has(t));
            for (const x of frs) { x.r.type = x.type; x.r.tris = x.tris; for (const t of x.tris) face[t] = x.r.id; }
          }
        }
      };
      growPatches(weak, adj, tol);
      absorb(tol);
      // [2026-10-21 v1.11.1] provato e scartato: trasformare in freeform le sfere/cilindri con corde lontane non assorbiti (file Plenum: 427 → 1911 facce
      // per togliere 3 facce non valide). Restano quadriche; sono solo candidate alle patch (weak).
      // for (const id of badSag) { const r = regions[id]; if ((r.type === 'sphere' || r.type === 'cylinder') && r.tris.length) r.type = 'freeform'; }
      // seconda passata con 2·tol solo sulle freeform rimaste (altrimenti restano come una faccia per triangolo): lo scarto resta in `err` e nella mappa di deviazione
      {
        const w2 = new Set(regions.filter(r => r.type === 'freeform' && r.tris.length).map(r => r.id));
        for (const r of regions) { if (r.type === 'plane' && r.tris.length && r.tris.length <= 60) { let n = 0, tot = 0; for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0 || face[u] === r.id) continue; tot++; if (w2.has(face[u])) n++; } if (tot > 0 && n >= 0.5 * tot) w2.add(r.id); } }
        const adj2 = new Map(); for (const id of w2) adj2.set(id, new Set());
        for (let t = 0; t < nT; t++) { const a = face[t]; if (!w2.has(a)) continue; for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0) continue; const b = face[u]; if (b !== a && w2.has(b) && cosDih(t, u) > Math.cos(30 * Math.PI / 180)) { adj2.get(a).add(b); adj2.get(b).add(a); } } }
        growPatches(w2, adj2, 2 * tol); absorb(2 * tol);
      }
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
    // ---- 4e-0. [v1.4.0 2026-10-07] RESIDUI ALLE USCITE DEL FILETTO: piccole regioni (sfere/coni/tori/freeform/piani inclinati < 100 triangoli)
    //      adiacenti a un filetto, dentro la sua fascia radiale e assiale, sono pezzi del filetto non agganciati dal 4-00
    //      (in bolt_m6 erano 8 sfere spurie + 11 freeform) -> assorbite nella regione 'thread'
    for (const th of regions.filter(r => r.type === 'thread')) {
      const hs = verticesOf(M, th.tris).map(p => dot(sub(p, th.origin), th.axis)), h0 = Math.min(...hs) - th.pitch, h1 = Math.max(...hs) + th.pitch;
      const slack = 2 * tol + 0.05 * (th.rmax - th.rmin);
      const inThread = r => r.tris.every(t => [0, 1, 2].every(k => { const d = sub(M.P(M.T[3 * t + k]), th.origin), h = dot(d, th.axis), rho = len(sub(d, mul(th.axis, h))); return h >= h0 && h <= h1 && rho >= th.rmin - slack && rho <= th.rmax + slack; }));
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of regions) {
          if (r === th || r.type === 'thread' || r.type === 'merged' || (r.type === 'plane' && Math.abs(dot(r.normal, th.axis)) > Math.cos(0.5 * Math.PI / 180)) || r.type === 'bspline' || !r.tris.length || r.tris.length >= 100) continue;   // i piani ⟂ asse (tappi) restano
          if (!r.tris.some(t => [0, 1, 2].some(j => { const u = M.nb[3 * t + j]; return u >= 0 && face[u] === th.id; }))) continue;
          if (!inThread(r) || r.tris.some(t => Math.abs(dot(Nv(t), th.axis)) > 0.9986)) continue;   // niente triangoli ⟂ asse (tappi/spalle)
          for (const t of r.tris) face[t] = th.id;
          th.tris = th.tris.concat(r.tris); r.type = 'merged'; r.tris = []; grew = true;
        }
      }
    }

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
        // [v1.1.0 2026-10-06] coni (stesso apice, asse, angolo) e tori (stesso centro, asse, R, r)
        if (a.type === 'cone') return Math.abs(dot(a.axis, b.axis)) > cosA && len(sub(a.apex, b.apex)) <= tol && Math.abs(a.alpha - b.alpha) < 1e-3 && a.outward === b.outward;
        if (a.type === 'torus') return Math.abs(dot(a.axis, b.axis)) > cosA && len(sub(a.center, b.center)) <= tol && Math.abs(a.R - b.R) <= tol && Math.abs(a.r - b.r) <= tol && a.outward === b.outward;
        return false;
      };
      // [2026-10-21 v1.10.0] FUSIONE GEOMETRICA di riserva: se i parametri delle due regioni differiscono per il rumore (assi/piani leggermente
      // diversi) ma la primitiva rifittata sull'unione resta entro `tol`, le regioni sono la stessa superficie. Solo piano, cilindro, sfera.
      // Su mesh esatte `same` risponde già prima e questo ramo non cambia nulla.
      const unionFit = (A, B) => {
        if (A.type !== B.type) return null;
        const tris = A.tris.concat(B.tris);
        if (A.type === 'plane') { const pl = fitPlane(verticesOf(M, tris)); return pl.maxErr <= tol && dot(pl.normal, A.normal) * Math.sign(dot(A.normal, B.normal)) > 0 ? { normal: dot(pl.normal, A.normal) >= 0 ? pl.normal : mul(pl.normal, -1), origin: pl.origin } : null; }
        if (A.type === 'sphere') { if (A.outward !== B.outward) return null; const sp = fitSphere(verticesOf(M, tris)); return sp && sp.maxErr <= tol ? { center: sp.center, radius: sp.radius, err: sp.maxErr } : null; }
        if (A.type === 'cylinder') {
          if (A.outward !== B.outward || Math.abs(A.radius - B.radius) > 3 * tol || Math.abs(dot(A.axis, B.axis)) < Math.cos(10 * Math.PI / 180)) return null;
          const ax = norm(axisFromNormals(M, tris)[0].vec), c = fitCylinder(M, tris, ax);
          return c && c.maxErr <= tol && Math.abs(dot(ax, A.axis)) > 0.99 ? { axis: c.axis, origin: c.origin, radius: c.radius, height: c.height, err: c.maxErr } : null;
        }
        return null;
      };
      const fuse = () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (let t = 0; t < nT && !changed; t++) for (let j = 0; j < 3; j++) {
          const u = M.nb[3 * t + j]; if (u < 0) continue;
          const A = regions[face[t]], B = regions[face[u]];
          if (A === B) continue;
          if (!same(A, B)) {
            const uf = A.type === B.type && ['plane', 'sphere', 'cylinder'].includes(A.type) ? unionFit(A, B) : null; if (!uf) continue;
            Object.assign(A, uf);
          }
          for (const x of B.tris) face[x] = A.id;
          A.tris = A.tris.concat(B.tris); B.type = 'merged'; B.tris = [];
          if (A.type === 'cylinder') { const c = fitCylinder(M, A.tris, A.axis); if (c) { A.origin = c.origin; A.height = c.height; } }
          if (A.type === 'cone') { const c = fitCone(M, A.tris); if (c) { A.hmin = c.hmin; A.hmax = c.hmax; } }
          changed = true; break;
        }
      }
      };
      fuse();
      // [2026-10-21 v1.10.0] ASSORBIMENTO dei frammenti: regioni piccole (≤ 4 triangoli, piano/freeform) con tutti i vertici entro 1,5·tol
      // dalla superficie di una regione vicina più grande (piano, cilindro, sfera, cono, toro) sono solo rumore di quella superficie.
      // Prima restavano come facce separate da 1–2 triangoli (una faccia STEP ciascuna).
      {
        const analytic = r => ['plane', 'cylinder', 'sphere', 'cone', 'torus'].includes(r.type) || (r.type === 'bspline' && !!r.dist);   // [v1.11.2] anche B-spline (scarto con r.dist)
        // [2026-10-21 v1.11.2] prima: solo piani e freeform; ora anche sfere/cilindri/coni/tori da ≤ 4 triangoli (una "sfera" da 2 triangoli
        // con un solo anello di 0,4 mm era una faccia degenere non valida nel file Plenum)
        const tiny = regions.filter(r => ['plane', 'freeform', 'sphere', 'cylinder', 'cone', 'torus'].includes(r.type) && r.tris.length > 0 && r.tris.length <= 4).sort((x, y) => x.tris.length - y.tris.length);
        for (const r of tiny) {
          if (r.type === 'merged' || !r.tris.length) continue;
          const cand = new Map();
          for (const t of r.tris) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u < 0 || face[u] === r.id) continue; const q = regions[face[u]]; if (q.tris.length > r.tris.length && analytic(q) && q.tris.length > 4) cand.set(q.id, q); }
          let best = null, bd = Infinity;
          for (const q of cand.values()) {
            let d = 0; for (const t of r.tris) for (let k = 0; k < 3; k++) { const pk = M.P(M.T[3 * t + k]); d = Math.max(d, q.type === 'bspline' ? q.dist(pk) : surfDist(q, pk)); }
            if (d <= 1.5 * tol && d < bd) { bd = d; best = q; }
          }
          if (!best) continue;
          for (const x of r.tris) face[x] = best.id;
          best.tris = best.tris.concat(r.tris); r.type = 'merged'; r.tris = [];
        }
        fuse();
      }
    }

    // ---- 4f. [v1.1.0 2026-10-06] SNAP AI VALORI NOMINALI ("beautify") ----
    // ogni modifica è accettata solo se i vertici restano entro la tolleranza
    if (opts.snap) {
      const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const snapDir = d => { for (const a of AX) { const c = dot(d, a); if (Math.abs(c) > cosA) return mul(a, Math.sign(c)); } return null; };
      const roundTo = (x, q) => Math.round(x / q) * q;
      const live = regions.filter(r => r.type !== 'merged');
      for (const r of live) {
        const pts = verticesOf(M, r.tris);
        if (r.type === 'plane') {
          const n2 = snapDir(r.normal); if (!n2) continue;
          const d = pts.reduce((s, p) => s + dot(p, n2), 0) / pts.length;
          if (pts.every(p => Math.abs(dot(p, n2) - d) <= tol)) { r.normal = n2; r.origin = add(sub(r.origin, mul(n2, dot(r.origin, n2))), mul(n2, d)); r.snapped = true; }
        } else if (r.type === 'cylinder') {
          let axis = snapDir(r.axis) || r.axis, origin = r.origin;
          if (axis !== r.axis) { const c = fitCylinder(M, r.tris, axis); if (c && c.maxErr <= tol) origin = c.origin; else axis = r.axis; }
          let rad = r.radius;
          for (const q of [0.1, 0.05, 0.01]) { const d2 = roundTo(2 * rad, q) / 2; if (cylErr(M, r.tris, axis, origin, d2) <= tol) { rad = d2; break; } }
          if (axis !== r.axis || rad !== r.radius) { r.axis = axis; r.origin = origin; r.radius = rad; r.err = cylErr(M, r.tris, axis, origin, rad); r.snapped = true; }
        } else if (r.type === 'sphere') {
          for (const q of [0.1, 0.05, 0.01]) { const r2 = roundTo(2 * r.radius, q) / 2; if (pts.every(p => Math.abs(len(sub(p, r.center)) - r2) <= tol)) { r.radius = r2; r.snapped = true; break; } }
        } else if (r.type === 'cone') {
          // semi-angolo a 0,5° (es. svasature 45°, 41°)
          const a2 = roundTo(r.alpha * 180 / Math.PI, 0.5) * Math.PI / 180, ax2 = snapDir(r.axis) || r.axis;
          const test = { apex: r.apex, axis: ax2, alpha: a2 };
          if (pts.every(p => coneDist(test, p) <= tol)) { r.alpha = a2; r.axis = ax2; r.snapped = true; }
        } else if (r.type === 'torus') {
          const ax2 = snapDir(r.axis) || r.axis;
          for (const q of [0.1, 0.05, 0.01]) { const T = { center: r.center, axis: ax2, R: r.R, r: roundTo(r.r, q) }; if (T.r > 0 && pts.every(p => Math.abs(torusDist(T, p)) <= tol)) { r.r = T.r; r.axis = ax2; r.snapped = true; break; } }
        }
      }
      // cilindri coassiali: stessa retta d'asse (media) se entro tolleranza
      const cyls = live.filter(r => r.type === 'cylinder');
      for (let i = 0; i < cyls.length; i++) for (let j = i + 1; j < cyls.length; j++) {
        const a = cyls[i], b = cyls[j]; if (Math.abs(dot(a.axis, b.axis)) < cosA) continue;
        const d = sub(b.origin, a.origin), off = sub(d, mul(a.axis, dot(d, a.axis)));
        if (len(off) > tol || len(off) === 0) continue;
        const o2 = add(b.origin, mul(off, -1));   // proietta b sulla retta di a
        if (cylErr(M, b.tris, a.axis, o2, b.radius) <= tol) { b.origin = o2; b.axis = dot(a.axis, b.axis) > 0 ? a.axis : mul(a.axis, -1); b.snapped = true; }
      }
    }

    // compattazione indici (rimuove regioni assorbite)
    const live = regions.filter(r => r.type !== 'merged'), remap = new Int32Array(regions.length).fill(-1);
    live.forEach((r, i) => { remap[r.id] = i; r.id = i; });
    for (let t = 0; t < nT; t++) face[t] = remap[face[t]];
    // statistiche
    // [2026-10-06] versione precedente (solo piano/cilindro/sfera/freeform):
    // const stats = { plane: 0, cylinder: 0, sphere: 0, freeform: 0, freeformTris: 0 };
    const stats = { plane: 0, cylinder: 0, cone: 0, sphere: 0, torus: 0, thread: 0, bspline: 0, freeform: 0, freeformTris: 0 };
    for (const r of live) { stats[r.type]++; if (r.type === 'freeform') stats.freeformTris += r.tris.length; }
    return { face, regions: live, stats };
  }

  // ================= 3-bis. [v1.1.0 2026-10-06] NUOVE PRIMITIVE E UTILITÀ =================

  // ---- Cono: asse = autovettore minimo della covarianza delle normali (centrate),
  //      apice = punto comune ai piani delle facette (minimi quadrati), semi-angolo da ρ = h·tanα
  function fitCone(M, tris) {
    let m = [0, 0, 0], at = 0;
    for (const t of tris) { const a = M.A[t]; at += a; for (let k = 0; k < 3; k++) m[k] += a * M.N[3 * t + k]; }
    m = mul(m, 1 / at);
    const S = [0, 0, 0, 0, 0, 0], G = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
    for (const t of tris) {
      const a = M.A[t], n = [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], d = sub(n, m);
      S[0] += a * d[0] * d[0]; S[1] += a * d[0] * d[1]; S[2] += a * d[0] * d[2]; S[3] += a * d[1] * d[1]; S[4] += a * d[1] * d[2]; S[5] += a * d[2] * d[2];
      const c = [M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], nc = dot(n, c);
      for (let i = 0; i < 3; i++) { g[i] += a * n[i] * nc; for (let j = 0; j < 3; j++) G[i][j] += a * n[i] * n[j]; }
    }
    let axis = norm(eigSym3(S)[0].vec);
    const apex = solve(G, g); if (!apex) return null;
    const pts = verticesOf(M, tris);
    let sh = 0; for (const p of pts) sh += dot(sub(p, apex), axis);
    if (sh < 0) axis = mul(axis, -1);
    let srh = 0, shh = 0;
    const hr = pts.map(p => { const d = sub(p, apex), h = dot(d, axis), r = len(sub(d, mul(axis, h))); srh += r * h; shh += h * h; return [h, r]; });
    if (!(shh > 0)) return null;
    const alpha = Math.atan(srh / shh);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    let maxErr = 0, hmin = Infinity, hmax = -Infinity;
    for (const [h, r] of hr) { maxErr = Math.max(maxErr, Math.abs(r * ca - h * sa)); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
    if (hmin < -1e-9) maxErr = Math.max(maxErr, -hmin);     // punti oltre l'apice: non è un cono semplice
    return { apex, axis, alpha, maxErr, hmin, hmax };
  }
  const coneDist = (cn, p) => { const d = sub(p, cn.apex), h = dot(d, cn.axis), r = len(sub(d, mul(cn.axis, h))); return Math.abs(r * Math.cos(cn.alpha) - h * Math.sin(cn.alpha)); };

  // ---- Toro: distanza = sqrt((ρ-R)² + h²) - r ----
  const torusDist = (T, p) => { const d = sub(p, T.center), h = dot(d, T.axis), rho = len(sub(d, mul(T.axis, h))); return Math.hypot(rho - T.R, h) - T.r; };
  // Fit: inizializzazione dai "centri del tubo" (centroide - s·r·normale) per alcuni r candidati,
  // poi Levenberg-Marquardt su 7 parametri (centro, asse 2 gdl, R, r) con Jacobiano numerico.
  function fitTorus(M, tris) {
    const ptsAll = verticesOf(M, tris); if (ptsAll.length < 12) return null;
    const step = Math.max(1, Math.floor(ptsAll.length / 2500)), pts = ptsAll.filter((_, i) => i % step === 0);
    // raggi di curvatura locali tra facette adiacenti della regione
    const inR = new Set(tris), radii = [];
    for (const t of tris) for (let j = 0; j < 3; j++) {
      const u = M.nb[3 * t + j]; if (u < t || !inR.has(u)) continue;
      const th = Math.acos(Math.min(1, dot([M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], [M.N[3 * u], M.N[3 * u + 1], M.N[3 * u + 2]])));
      if (th < 1e-3) continue;
      radii.push(len(sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], [M.C[3 * u], M.C[3 * u + 1], M.C[3 * u + 2]])) / th);
    }
    if (radii.length < 4) return null;
    radii.sort((a, b) => a - b);
    const cands = [...new Set([0.05, 0.15, 0.3, 0.5, 0.8].map(q => radii[Math.floor(q * (radii.length - 1))]))];
    const err = T => { let e = 0, mx = 0; for (const p of pts) { const d = torusDist(T, p); e += d * d; mx = Math.max(mx, Math.abs(d)); } return { rms: Math.sqrt(e / pts.length), mx }; };
    let best = null;
    for (const r of cands) for (const s of [1, -1]) {
      const q = tris.map(t => sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], mul([M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], s * r)));
      const pl = fitPlane(q), u = perp(pl.normal), w = cross(pl.normal, u);
      const c = fitCircle2D(q.map(x => [dot(sub(x, pl.origin), u), dot(sub(x, pl.origin), w)])); if (!c) continue;
      const T = { center: add(pl.origin, add(mul(u, c.cx), mul(w, c.cy))), axis: pl.normal, R: c.r, r };
      const e = err(T); if (!best || e.rms < best.e.rms) best = { T, e };
    }
    if (!best) return null;
    // Levenberg-Marquardt
    let T = best.T, cur = best.e.rms, lam = 1e-3;
    const pack = T => [T.center[0], T.center[1], T.center[2], 0, 0, T.R, T.r];
    const unpack = (x, a0) => { const e1 = perp(a0), e2 = cross(a0, e1); return { center: [x[0], x[1], x[2]], axis: norm(add(a0, add(mul(e1, x[3]), mul(e2, x[4])))), R: x[5], r: x[6] }; };
    for (let it = 0; it < 25; it++) {
      const a0 = T.axis, x0 = pack(T), f0 = pts.map(p => torusDist(T, p));
      const J = pts.map(() => new Float64Array(7)), hstep = M.diag * 1e-6;
      for (let k = 0; k < 7; k++) {
        const x = x0.slice(); const hk = k === 3 || k === 4 ? 1e-6 : hstep; x[k] += hk;
        const Tk = unpack(x, a0); pts.forEach((p, i) => { J[i][k] = (torusDist(Tk, p) - f0[i]) / hk; });
      }
      const A = [...Array(7)].map(() => Array(7).fill(0)), b = Array(7).fill(0);
      pts.forEach((_, i) => { for (let a = 0; a < 7; a++) { b[a] -= J[i][a] * f0[i]; for (let c = 0; c < 7; c++) A[a][c] += J[i][a] * J[i][c]; } });
      let improved = false;
      for (let tries = 0; tries < 6 && !improved; tries++) {
        const Al = A.map((r, i) => r.map((v, j) => (i === j ? v * (1 + lam) + 1e-12 : v)));
        const dlt = solve(Al, b); if (!dlt) { lam *= 10; continue; }
        const Tn = unpack(x0.map((v, i) => v + dlt[i]), a0);
        const e = err(Tn);
        if (e.rms < cur) { T = Tn; cur = e.rms; lam = Math.max(1e-7, lam / 5); improved = true; } else lam *= 10;
      }
      if (!improved || cur < 1e-9) break;
    }
    if (T.r < 0) T.r = -T.r;
    let mx = 0; for (const p of ptsAll) mx = Math.max(mx, Math.abs(torusDist(T, p)));
    return { center: T.center, axis: T.axis, R: T.R, r: T.r, maxErr: mx };
  }

  // ---- Errore massimo di un cilindro dato (per snap/editing) ----
  function cylErr(M, tris, axis, origin, r) {
    let mx = 0; for (const p of verticesOf(M, tris)) { const d = sub(p, origin), h = dot(d, axis); mx = Math.max(mx, Math.abs(len(sub(d, mul(axis, h))) - r)); }
    return mx;
  }

  // ---- Tabella filettature metriche ISO (diametro nominale, passi grosso/fini) ----
  const ISO_METRIC = [[1, [0.25, 0.2]], [1.2, [0.25, 0.2]], [1.6, [0.35, 0.2]], [2, [0.4, 0.25]], [2.5, [0.45, 0.35]], [3, [0.5, 0.35]], [3.5, [0.6, 0.35]],
    [4, [0.7, 0.5]], [5, [0.8, 0.5]], [6, [1, 0.75]], [8, [1.25, 1, 0.75]], [10, [1.5, 1.25, 1, 0.75]], [12, [1.75, 1.5, 1.25, 1]], [14, [2, 1.5, 1.25, 1]],
    [16, [2, 1.5, 1]], [18, [2.5, 2, 1.5, 1]], [20, [2.5, 2, 1.5, 1]], [22, [2.5, 2, 1.5, 1]], [24, [3, 2, 1.5, 1]], [27, [3, 2, 1.5, 1]], [30, [3.5, 3, 2, 1.5, 1]],
    [33, [3.5, 3, 2, 1.5]], [36, [4, 3, 2, 1.5]], [42, [4.5, 4, 3, 2, 1.5]], [48, [5, 4, 3, 2, 1.5]]];
  const PITCHES = [...new Set(ISO_METRIC.flatMap(x => x[1]))].sort((a, b) => a - b);

  // ---- Filettatura: assi candidati, profilo radiale ρ∈[rmin,rmax], periodicità elicoidale delle creste ----
  function detectThread(M, tris, axesCand) {
    const pts = verticesOf(M, tris); if (pts.length < 40) return null;
    // candidati asse: quelli forniti (regioni coassiali vicine) + PCA dei vertici + normali
    const c0 = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length), S = [0, 0, 0, 0, 0, 0];
    for (const p of pts) { const d = sub(p, c0); S[0] += d[0] * d[0]; S[1] += d[0] * d[1]; S[2] += d[0] * d[2]; S[3] += d[1] * d[1]; S[4] += d[1] * d[2]; S[5] += d[2] * d[2]; }
    const ev = eigSym3(S);
    const cands = [...axesCand, { axis: ev[2].vec }, { axis: ev[0].vec }, { axis: axisFromNormals(M, tris)[0].vec }];
    let best = null;
    for (const cd of cands) {
      const a = norm(cd.axis), u = perp(a), w = cross(a, u);
      let ctr;
      if (cd.origin) ctr = cd.origin;
      else { const c = fitCircle2D(pts.map(p => [dot(p, u), dot(p, w)])); if (!c) continue; ctr = add(mul(u, c.cx), mul(w, c.cy)); }
      const data = pts.map(p => { const d = sub(p, ctr), h = dot(d, a), q = sub(d, mul(a, h)); return { h, rho: len(q), th: Math.atan2(dot(q, w), dot(q, u)) }; });
      const rs = data.map(x => x.rho).sort((x, y) => x - y);
      const rmin = rs[Math.floor(0.02 * (rs.length - 1))], rmax = rs[Math.floor(0.98 * (rs.length - 1))], depth = rmax - rmin;
      if (!(depth > 0) || depth > 0.35 * rmax) continue;
      const crest = data.filter(x => x.rho > rmax - 0.2 * depth);
      const hs = data.map(x => x.h), span = Math.max(...hs) - Math.min(...hs);
      // passo: massimizza la concentrazione della fase (h - P·θ/2π) mod P sulle creste (destra e sinistra)
      for (const P of PITCHES) {
        // [2026-10-21 v1.11.0] prima: span < 1.5 * P (bastavano 1,5 giri: un'onda lenta di una superficie libera passava per filetto, Ø10 P5 su un guscio ondulato)
        if (span < 2.5 * P || depth < 0.3 * P || depth > 1.0 * P) continue;
        for (const hand of [1, -1]) {
          let cs = 0, sn = 0;
          for (const x of crest) { const ph = 2 * Math.PI * (x.h - hand * P * x.th / (2 * Math.PI)) / P; cs += Math.cos(ph); sn += Math.sin(ph); }
          const R = Math.hypot(cs, sn) / crest.length;
          if (!best || R > best.R) best = { R, P, hand, axis: a, origin: ctr, rmin, rmax, depth, span };
        }
      }
    }
    if (!best || best.R < 0.85) return null;
    // filetto interno o esterno dal verso delle normali
    let out = 0; for (const t of tris) { const d = sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], best.origin); out += M.A[t] * dot([M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], sub(d, mul(best.axis, dot(d, best.axis)))); }
    const internal = out < 0, major = 2 * best.rmax;
    let label = `Ø${major.toFixed(2)} P${best.P}`, nominal = null;
    for (const [d, ps] of ISO_METRIC) if (Math.abs(d - major) <= Math.max(0.25, 0.12 * d) && ps.some(p => Math.abs(p - best.P) < 1e-9)) {
      if (!nominal || Math.abs(d - major) < Math.abs(nominal - major)) nominal = d;
    }
    if (nominal) label = `M${nominal}` + (ISO_METRIC.find(x => x[0] === nominal)[1][0] === best.P ? '' : `x${best.P}`);
    // [2026-10-06 13:38] prima: hand 'destro'/'sinistro' e ' interno' nel label (testo italiano nel core)
    return { axis: best.axis, origin: best.origin, pitch: best.P, hand: best.hand > 0 ? 'R' : 'L', rmin: best.rmin, rmax: best.rmax, length: best.span, internal, label, nominal, score: best.R };
  }

  // ---- Superficie B-spline bicubica come campo di altezze sopra il piano medio della regione ----
  function fitBSpline(M, tris, tol) {
    // [2026-10-21 v1.11.1] prima: const pts = verticesOf(M, tris);  (solo i vertici: con triangoli lunghi e sottili la superficie poteva scostarsi
    // di millimetri lungo gli spigoli, tra un vertice e l'altro, e gli spigoli di bordo non stavano più sulla faccia: STEP non valido).
    // Ora anche punti interni agli spigoli più lunghi di 1/16 dell'estensione della patch (fino a 8 per spigolo).
    const pts = verticesOf(M, tris); if (pts.length < 16) return null;
    {
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      const step = len(sub(mx, mn)) / 16, seenE = new Set();
      if (step > 0) for (const t of tris) for (let k = 0; k < 3; k++) {
        const e = M.triEdge[3 * t + k]; if (seenE.has(e)) continue; seenE.add(e);
        const a = M.P(M.E0[e]), b = M.P(M.E1[e]), L = len(sub(b, a)), n = Math.min(8, Math.floor(L / step));
        for (let i = 1; i <= n; i++) pts.push(add(a, mul(sub(b, a), i / (n + 1))));
      }
    }
    const pl = fitPlane(pts);
    let n = pl.normal, mn = [0, 0, 0];
    for (const t of tris) mn = add(mn, mul([M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], M.A[t]));
    if (dot(mn, n) < 0) n = mul(n, -1);
    for (const t of tris) if (dot([M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], n) < 0.25) return null;   // non è un campo di altezze
    const e1 = perp(n), e2 = cross(n, e1);
    const uvh = pts.map(p => { const d = sub(p, pl.origin); return [dot(d, e1), dot(d, e2), dot(d, n)]; });
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [u, v] of uvh) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    // [2026-10-21 v1.11.1] prima: pad = 0.02 (la proiezione al punto più vicino dei vertici di bordo poteva uscire dal dominio della superficie)
    const pad = 0.1 * Math.max(u1 - u0, v1 - v0); u0 -= pad; u1 += pad; v0 -= pad; v1 += pad;
    // base B-spline cubica uniforme bloccata con nc punti di controllo
    const basis = (nc, t) => {   // t in [0,1] -> pesi non nulli
      const segs = nc - 3, x = Math.min(segs - 1e-9, Math.max(0, t * segs)), k = Math.floor(x);
      const knots = [0, 0, 0, 0]; for (let i = 1; i < segs; i++) knots.push(i); knots.push(segs, segs, segs, segs);
      const N = Array(nc).fill(0);
      // Cox-de Boor
      let Nk = knots.slice(0, -1).map((kv, i) => (x >= kv && x < knots[i + 1] ? 1 : 0));
      for (let p = 1; p <= 3; p++) {
        const nx = [];
        for (let i = 0; i < knots.length - 1 - p; i++) {
          const a = knots[i + p] - knots[i], b = knots[i + p + 1] - knots[i + 1];
          nx.push((a > 0 ? (x - knots[i]) / a * Nk[i] : 0) + (b > 0 ? (knots[i + p + 1] - x) / b * Nk[i + 1] : 0));
        }
        Nk = nx;
      }
      for (let i = 0; i < nc; i++) N[i] = Nk[i];
      return N;
    };
    for (const nc of [6, 8, 10, 12]) {
      const K = nc * nc, A = [...Array(K)].map(() => new Float64Array(K)), b = new Float64Array(K);
      const rows = uvh.map(([u, v, h]) => ({ Bu: basis(nc, (u - u0) / (u1 - u0)), Bv: basis(nc, (v - v0) / (v1 - v0)), h }));
      for (const { Bu, Bv, h } of rows) {
        const idx = [], val = [];
        for (let i = 0; i < nc; i++) if (Bu[i]) for (let j = 0; j < nc; j++) if (Bv[j]) { idx.push(i * nc + j); val.push(Bu[i] * Bv[j]); }
        for (let a = 0; a < idx.length; a++) { b[idx[a]] += val[a] * h; for (let c = 0; c < idx.length; c++) A[idx[a]][idx[c]] += val[a] * val[c]; }
      }
      // regolarizzazione (differenze seconde) per i punti di controllo non vincolati dai dati
      const lam = 1e-6 * (rows.length / K);
      for (let i = 0; i < nc; i++) for (let j = 0; j < nc; j++) for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + 2 * di >= nc || j + 2 * dj >= nc) continue;
        const ids = [i * nc + j, (i + di) * nc + j + dj, (i + 2 * di) * nc + j + 2 * dj], w = [1, -2, 1];
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) A[ids[a]][ids[c]] += lam * w[a] * w[c];
      }
      const z = solve(A.map(r => Array.from(r)), Array.from(b)); if (!z) continue;
      let mx = 0;
      for (const { Bu, Bv, h } of rows) { let s = 0; for (let i = 0; i < nc; i++) if (Bu[i]) for (let j = 0; j < nc; j++) s += Bu[i] * Bv[j] * z[i * nc + j]; mx = Math.max(mx, Math.abs(s - h)); }
      if (mx <= tol) {
        // punti di controllo 3D (ascisse di Greville -> precisione lineare in u,v)
        const segs = nc - 3, knots = [0, 0, 0, 0]; for (let i = 1; i < segs; i++) knots.push(i); knots.push(segs, segs, segs, segs);
        const grev = [...Array(nc).keys()].map(i => (knots[i + 1] + knots[i + 2] + knots[i + 3]) / 3 / segs);
        const cp = [...Array(nc).keys()].map(i => [...Array(nc).keys()].map(j => add(pl.origin, add(add(mul(e1, u0 + grev[i] * (u1 - u0)), mul(e2, v0 + grev[j] * (v1 - v0))), mul(n, z[i * nc + j])))));
        // [v1.4.0] scarto verticale (lungo la normale media) di un punto dalla superficie: per la mappa di deviazione per triangolo
        const dist = p => { const d = sub(p, pl.origin), u = dot(d, e1), v = dot(d, e2), h = dot(d, n), Bu = basis(nc, Math.min(1, Math.max(0, (u - u0) / (u1 - u0)))), Bv = basis(nc, Math.min(1, Math.max(0, (v - v0) / (v1 - v0)))); let s = 0; for (let i = 0; i < nc; i++) if (Bu[i]) for (let j = 0; j < nc; j++) s += Bu[i] * Bv[j] * z[i * nc + j]; return Math.abs(s - h); };
        // [v1.11.2] proiezione "verticale" (lungo la normale media) di un punto sulla superficie: per portare gli spigoli di bordo sulla faccia
        // [v1.11.2] proiezione lungo la normale media (provato Gauss-Newton sul punto più vicino: divergeva fuori dominio, scartato)
        const proj = p => { const d = sub(p, pl.origin), u = dot(d, e1), v = dot(d, e2), Bu = basis(nc, Math.min(1, Math.max(0, (u - u0) / (u1 - u0)))), Bv = basis(nc, Math.min(1, Math.max(0, (v - v0) / (v1 - v0)))); let s = 0; for (let i = 0; i < nc; i++) if (Bu[i]) for (let j = 0; j < nc; j++) s += Bu[i] * Bv[j] * z[i * nc + j]; return add(pl.origin, add(add(mul(e1, u), mul(e2, v)), mul(n, s))); };
        // [v1.13.1] parametri (u, v) della superficie STEP (nodi 0…segs) di un punto: servono per scrivere le PCURVE dei bordi
        const uvOf = p => { const d = sub(p, pl.origin); return [segs * (dot(d, e1) - u0) / (u1 - u0), segs * (dot(d, e2) - v0) / (v1 - v0)]; };
        // [2026-10-22 v1.13.2] proiezione inversa: parametri (u, v) del punto della superficie PIÙ VICINO a p (Gauss-Newton sulle coordinate
        // metriche s,t della mappa di altezze h(s,t); si parte dalla proiezione verticale e si resta nel dominio). È la stessa definizione che
        // usa OpenCASCADE per proiettare gli altri spigoli della faccia: così le due curve 2D coincidono ai vertici.
        const hAt = (s, t) => { const Bu = basis(nc, Math.min(1, Math.max(0, (s - u0) / (u1 - u0)))), Bv = basis(nc, Math.min(1, Math.max(0, (t - v0) / (v1 - v0)))); let a = 0; for (let i = 0; i < nc; i++) if (Bu[i]) for (let j = 0; j < nc; j++) a += Bu[i] * Bv[j] * z[i * nc + j]; return a; };
        const uvNear = p => {
          const d = sub(p, pl.origin); let s = Math.min(u1, Math.max(u0, dot(d, e1))), t = Math.min(v1, Math.max(v0, dot(d, e2))), best = Infinity, bs = s, bt = t;
          const h = 1e-4 * Math.max(u1 - u0, v1 - v0);
          for (let it = 0; it < 12; it++) {
            const h0 = hAt(s, t), hs = (hAt(s + h, t) - hAt(s - h, t)) / (2 * h), ht = (hAt(s, t + h) - hAt(s, t - h)) / (2 * h);
            const r = sub(add(pl.origin, add(add(mul(e1, s), mul(e2, t)), mul(n, h0))), p), f = dot(r, r);
            if (f < best) { best = f; bs = s; bt = t; } else break;
            const a = (1 + hs * hs), b = hs * ht, c = (1 + ht * ht), g1 = dot(r, add(e1, mul(n, hs))), g2 = dot(r, add(e2, mul(n, ht))), det = a * c - b * b;
            if (!(Math.abs(det) > 1e-12)) break;
            const ds = -(c * g1 - b * g2) / det, dt = -(a * g2 - b * g1) / det;
            s = Math.min(u1, Math.max(u0, s + ds)); t = Math.min(v1, Math.max(v0, t + dt));
            if (Math.abs(ds) + Math.abs(dt) < 1e-9 * (u1 - u0)) { const r2 = sub(add(pl.origin, add(add(mul(e1, s), mul(e2, t)), mul(n, hAt(s, t)))), p), f2 = dot(r2, r2); if (f2 < best) { best = f2; bs = s; bt = t; } break; }
          }
          return [segs * (bs - u0) / (u1 - u0), segs * (bt - v0) / (v1 - v0)];
        };
        return { nc, cp, segs, maxErr: mx, normal: n, dist, proj, uvOf, uvNear };
      }
    }
    return null;
  }

  // ---- [v1.5.0 2026-10-07] B-spline CHIUSA (periodica in angolo): superfici lisce che si richiudono su se stesse ----
  // Tubo/vaso/guscio liscio "a stella" rispetto a un asse: ogni punto ha parametri (θ, z) attorno all'asse delle normali.
  // Si adatta una B-spline cubica periodica in θ (nu punti di controllo, anello chiuso) e chiusa-bloccata in z (nv punti),
  // risolvendo ai minimi quadrati le 3 coordinate dei punti di controllo (non il raggio: così la superficie 3D coincide con i dati).
  // Per STEP la rete periodica (uniforme, non bloccata) viene convertita in B-spline bloccata con inserimento di nodi (Boehm):
  // geometricamente chiusa (prima e ultima riga di controllo coincidono), flag U_CLOSED. Restituisce lo stesso formato di fitBSpline
  // + { closedU, nv, segsV, outward, axis }.
  function fitBSplineClosed(M, tris, tol) {
    const pts = verticesOf(M, tris); if (pts.length < 64 || tris.length < 64) return null;
    const ax = axisFromNormals(M, tris); if (!ax || !ax[0]) return null;
    let org = [0, 0, 0]; for (const p of pts) org = add(org, p); org = mul(org, 1 / pts.length);
    // [v1.6.0] asse candidato: autovettore delle normali (vale per i tubi dritti) e assi principali dei vertici (tubi molto incurvati,
    // dove le normali indicano un asse sbagliato); si usa il primo per cui spina, copertura angolare e componente radiale sono validi.
    // [2026-10-07 v1.6.0] prima: un solo asse, quello delle normali
    const setup = a => {
      // [v1.6.0] SPINA: asse non più dritto. Si taglia in 24 fasce lungo a, il baricentro di ogni fascia dà la spina (lisciata), la
      // tangente T e un riferimento (e1, e2) trasportato senza torsione; θ si misura nel piano ⟂ T alla quota del punto.
      // Per un asse dritto la spina coincide con l'asse e il risultato è quello della 1.5.0.
      // [2026-10-07 v1.6.0] prima: const e1 = perp(a), e2 = cross(a, e1);  (θ attorno a un asse fisso)
      let z0 = Infinity, z1 = -Infinity;
      for (const p of pts) { const z = dot(sub(p, org), a); if (z < z0) z0 = z; if (z > z1) z1 = z; }
      if (!(z1 - z0 > 1e-6)) return null;
      const NB = 24, sp = [...Array(NB)].map(() => ({ n: 0, p: [0, 0, 0], z: 0 }));
      for (const p of pts) { const z = dot(sub(p, org), a), b = sp[Math.min(NB - 1, Math.floor((z - z0) / (z1 - z0) * NB))]; b.n++; b.p = add(b.p, p); b.z += z; }
      if (sp.some(b => !b.n)) return null;
      const spZ = sp.map(b => b.z / b.n), spP = sp.map(b => mul(b.p, 1 / b.n));
      // spina = polinomio cubico in z fitto ai baricentri delle fasce (liscio: una spina spezzata introduce errori di parametrizzazione di ~0,1 mm)
      // [2026-10-07 v1.6.0] prima (provato e scartato): spina poligonale dei baricentri, lisciata a mano -> errore 0,18 mm sul vaso dritto
      const zc = (z0 + z1) / 2, zh = (z1 - z0) / 2, pw = z => { const s = (z - zc) / zh; return [1, s, s * s, s * s * s]; };
      const coef = [0, 1, 2].map(k => {
        const A = [...Array(4)].map(() => Array(4).fill(0)), bb = Array(4).fill(0);
        sp.forEach((b, i) => { const w = pw(spZ[i]); for (let r = 0; r < 4; r++) { bb[r] += b.n * w[r] * spP[i][k]; for (let q = 0; q < 4; q++) A[r][q] += b.n * w[r] * w[q]; } });
        return solve(A, bb);
      });
      if (coef.some(x => !x)) return null;
      const polyC = z => { const w = pw(z); return coef.map(cf => cf[0] * w[0] + cf[1] * w[1] + cf[2] * w[2] + cf[3] * w[3]); };
      const polyT = z => { const s = (z - zc) / zh; return norm(coef.map(cf => cf[1] + 2 * cf[2] * s + 3 * cf[3] * s * s)); };
      const spC = spZ.map(polyC), spT = spZ.map(polyT);
      // [v1.6.0] parametro lungo la spina = ascissa curvilinea normalizzata (con spina inclinata un passo in z non è un passo di superficie)
      // [2026-10-07 v1.6.0] prima: v = (z - z0) / (z1 - z0)
      const NS = 128, sTab = [0]; for (let i = 1; i <= NS; i++) sTab.push(sTab[i - 1] + len(sub(polyC(z0 + (z1 - z0) * i / NS), polyC(z0 + (z1 - z0) * (i - 1) / NS))));
      const tv = z => { const x = Math.min(NS - 1e-9, Math.max(0, (z - z0) / (z1 - z0) * NS)), k = Math.floor(x); return (sTab[k] + (sTab[k + 1] - sTab[k]) * (x - k)) / sTab[NS]; };
      // [v1.6.0] θ si misura nel piano ⟂ a (sezione a z costante) attorno al punto della spina c(z): uniforme anche con spina molto inclinata.
      // [2026-10-07 v1.6.0] prima (provato e scartato): riferimento (e1, e2) trasportato lungo la tangente T della spina, θ nel piano ⟂ T:
      // parametrizzazione molto non uniforme su tubi incurvati (nu 24 × nv 26 non bastava: 0,045 mm)
      const e1 = perp(a), e2 = cross(a, e1);
      const param = p => { const z = dot(sub(p, org), a), d = sub(p, polyC(z)); return [Math.atan2(dot(d, e2), dot(d, e1)), z]; };
      // iniettività della parametrizzazione (θ, z): ogni triangolo deve avere area con segno costante nel piano dei parametri
      // (sostituisce il controllo «normale ⟂ asse», falso su pareti ripide); segno positivo = normali verso l'esterno
      let pos = 0, neg = 0;
      for (const t of tris) {
        const q = [0, 1, 2].map(k => param(M.P(M.T[3 * t + k]))), wrap = x => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
        const du1 = wrap(q[1][0] - q[0][0]), du2 = wrap(q[2][0] - q[0][0]), dz1 = q[1][1] - q[0][1], dz2 = q[2][1] - q[0][1], ar = 0.5 * (du1 * dz2 - du2 * dz1);
        if (ar > 1e-7) pos++; else if (ar < -1e-7) neg++;
      }
      if (pos && neg) return null;
      if (!pos && !neg) return null;
      const outward = pos > 0;
      const th = [], zz = [];
      for (const p of pts) { const [t_, z] = param(p); th.push(t_); zz.push(z); }   // [v1.6.0] prima: θ attorno all'asse fisso, z0/z1 calcolati qui
      { // la copertura angolare deve essere completa (nessun vuoto > 90°)
        const s = th.slice().sort((x, y) => x - y); let gap = s[0] + 2 * Math.PI - s[s.length - 1];
        for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i] - s[i - 1]);
        if (gap > Math.PI / 2) return null;
      }
      return { a, z0, z1, param, th, zz, outward, tv };
    };
    const cov = [0, 0, 0, 0, 0, 0]; for (const p of pts) { const d = sub(p, org); cov[0] += d[0] * d[0]; cov[1] += d[0] * d[1]; cov[2] += d[0] * d[2]; cov[3] += d[1] * d[1]; cov[4] += d[1] * d[2]; cov[5] += d[2] * d[2]; }
    const cands = [norm(ax[0].vec)].concat(eigSym3(cov).map(e => norm(e.vec)));
    let S = null;
    for (const cd of cands) { for (const sg of [1, -1]) { S = setup(mul(cd, sg)); if (S) break; } if (S) break; }
    if (!S) return null;
    const { a, z0, z1, param, th, zz, outward, tv } = S;
    // basi: periodica uniforme in u (t in [0,nu)), bloccata uniforme in v
    const bu = (nu, t) => { const k = Math.floor(t), s = t - k, w = [(1 - s) ** 3 / 6, (3 * s ** 3 - 6 * s * s + 4) / 6, (-3 * s ** 3 + 3 * s * s + 3 * s + 1) / 6, s ** 3 / 6]; return w.map((x, m) => [((k + m) % nu + nu) % nu, x]); };
    const bv = (nv, t) => {
      const segs = nv - 3, x = Math.min(segs - 1e-9, Math.max(0, t * segs)), kn = [0, 0, 0, 0]; for (let i = 1; i < segs; i++) kn.push(i); kn.push(segs, segs, segs, segs);
      let Nk = kn.slice(0, -1).map((kv, i) => (x >= kv && x < kn[i + 1] ? 1 : 0));
      for (let p = 1; p <= 3; p++) { const nx = []; for (let i = 0; i < kn.length - 1 - p; i++) { const d1 = kn[i + p] - kn[i], d2 = kn[i + p + 1] - kn[i + 1]; nx.push((d1 > 0 ? (x - kn[i]) / d1 * Nk[i] : 0) + (d2 > 0 ? (kn[i + p + 1] - x) / d2 * Nk[i + 1] : 0)); } Nk = nx; }
      const o = []; for (let i = 0; i < nv; i++) if (Nk[i]) o.push([i, Nk[i]]); return o;
    };
    const tU = (nu, th_) => ((th_ + Math.PI) / (2 * Math.PI) * nu) % nu, tV = tv;   // [v1.6.0] prima: z => (z - z0) / (z1 - z0)
    for (const [nu, nv] of [[8, 6], [12, 8], [16, 10], [20, 14], [24, 18]]) {
      const K = nu * nv, A = [...Array(K)].map(() => new Float64Array(K)), b = [new Float64Array(K), new Float64Array(K), new Float64Array(K)];
      const rows = pts.map((p, i) => ({ U: bu(nu, tU(nu, th[i])), V: bv(nv, tV(zz[i])), p }));
      for (const { U, V, p } of rows) {
        const idx = [], val = [];
        for (const [i, wu] of U) for (const [j, wv] of V) { idx.push(i * nv + j); val.push(wu * wv); }
        for (let s = 0; s < idx.length; s++) { for (let c = 0; c < 3; c++) b[c][idx[s]] += val[s] * p[c]; for (let q = 0; q < idx.length; q++) A[idx[s]][idx[q]] += val[s] * val[q]; }
      }
      const lam = 1e-6 * (rows.length / K) * Math.max(1, (z1 - z0) ** 2 / 100);   // differenze seconde (periodiche in u)
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (j + 2 * dj >= nv) continue;
        const ids = [i * nv + j, ((i + di) % nu) * nv + j + dj, ((i + 2 * di) % nu) * nv + j + 2 * dj], w = [1, -2, 1];
        for (let s = 0; s < 3; s++) for (let q = 0; q < 3; q++) A[ids[s]][ids[q]] += lam * w[s] * w[q];
      }
      const sol = [0, 1, 2].map(c => solve(A.map(r => Array.from(r)), Array.from(b[c]))); if (sol.some(x => !x)) continue;
      const net = [...Array(nu)].map((_, i) => [...Array(nv)].map((__, j) => [sol[0][i * nv + j], sol[1][i * nv + j], sol[2][i * nv + j]]));
      const evalS = (thv, zv) => { let s = [0, 0, 0]; for (const [i, wu] of bu(nu, tU(nu, thv))) for (const [j, wv] of bv(nv, Math.min(1, Math.max(0, tV(zv))))) s = add(s, mul(net[i][j], wu * wv)); return s; };
      let mx = 0; for (let i = 0; i < pts.length; i++) mx = Math.max(mx, len(sub(evalS(th[i], zz[i]), pts[i])));
      if (mx > tol) continue;
      // rete periodica (nu+3 righe, indici modulo nu) -> bloccata: inserimento di 3 nodi a u=3 e 3 a u=nu+3 (Boehm), poi taglio dei bordi
      let ctrl = []; for (let i = 0; i < nu + 3; i++) ctrl.push(net[i % nu]);
      let kn = []; for (let i = 0; i < nu + 7; i++) kn.push(i);
      const insert = u => {
        let k = 3; while (!(kn[k] <= u && u <= kn[k + 1] && kn[k] < kn[k + 1])) k++;   // primo intervallo non vuoto che contiene u (anche all'estremo destro)
        const Q = [];
        for (let i = 0; i <= ctrl.length; i++) {
          if (i <= k - 3) Q.push(ctrl[i]);
          else if (i <= k) { const al = (u - kn[i]) / (kn[i + 3] - kn[i]); Q.push(ctrl[i].map((c, j) => c.map((x, m) => al * x + (1 - al) * ctrl[i - 1][j][m]))); }
          else Q.push(ctrl[i - 1]);
        }
        ctrl = Q; kn.splice(k + 1, 0, u);
      };
      for (let r = 0; r < 3; r++) insert(3);
      for (let r = 0; r < 3; r++) insert(nu + 3);
      ctrl = ctrl.slice(3, ctrl.length - 3);
      // dist: scarto di un punto dalla superficie ai suoi parametri (θ, z)
      const dist = p => { const [t_, z] = param(p); return len(sub(evalS(t_, z), p)); };   // [v1.6.0] prima: θ attorno all'asse fisso
      const proj = p => { const [t_, z] = param(p); return evalS(t_, z); };   // [v1.11.2]
      return { nc: nu, nv, cp: ctrl, segs: nu, segsV: nv - 3, maxErr: mx, normal: a, dist, proj, closedU: true, outward };
    }
    return null;
  }

  // [v1.5.0] campi comuni di una regione B-spline (aperta o chiusa)
  // [2026-10-21 v1.11.2] aggiunto proj (prima: ... dist: B.dist })
  // [2026-10-21 v1.13.1] aggiunto uvOf (prima: ... dist: B.dist, proj: B.proj })
  const bsFields = B => ({ nc: B.nc, nv: B.nv, cp: B.cp, segs: B.segs, segsV: B.segsV, closedU: B.closedU, outward: B.outward, err: B.maxErr, normal: B.normal, dist: B.dist, proj: B.proj, uvOf: B.uvOf, uvNear: B.uvNear });
  const fitBSplineAny = (M, tris, tol) => fitBSpline(M, tris, tol) || fitBSplineClosed(M, tris, tol);

  // ---- Riparazione: chiude i buchi (anelli di bordo aperti) con ear clipping sul piano medio ----
  // ---- [v1.4.0 2026-10-07] Riparazione spigoli NON-MANIFOLD ----
  // 1) triangoli duplicati (stessi 3 vertici) -> ne resta uno; coppie "schiena a schiena" (orientamento opposto) si annullano;
  // 2) spigoli con >2 triangoli: si tengono i due con percorrenza opposta di area totale maggiore, gli altri (alette) si scartano.
  // Restituisce la nuova "zuppa" di triangoli (stesso formato di fillHoles) e quanti triangoli sono stati tolti.
  // Le auto-intersezioni NON sono trattate (richiedono booleane robuste: vedi IMPROVEMENTS.md).
  function fixNonManifold(M) {
    const keep = new Uint8Array(M.nT).fill(1), groups = new Map();
    for (let t = 0; t < M.nT; t++) {
      const v = [M.T[3 * t], M.T[3 * t + 1], M.T[3 * t + 2]], key = [...v].sort((a, b) => a - b).join('_');
      const sign = ((v[1] - v[0]) * (v[2] - v[1]) * (v[0] - v[2])) > 0 ? 1 : -1;   // parità della permutazione rispetto all'ordine crescente
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([t, sign]);
    }
    let dup = 0;
    const dmap = new Map();   // spigolo orientato a>b -> triangoli che lo percorrono in quel verso
    for (let t = 0; t < M.nT; t++) for (let k = 0; k < 3; k++) { const key = M.T[3 * t + k] + '>' + M.T[3 * t + (k + 1) % 3]; if (!dmap.has(key)) dmap.set(key, []); dmap.get(key).push(t); }
    // coerenza di un triangolo con i vicini esterni al suo gruppo: +1 per ogni spigolo percorso in verso opposto, -1 se nello stesso verso
    const coherence = (t, grp) => { let sc = 0; for (let k = 0; k < 3; k++) { const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3]; for (const u of dmap.get(b + '>' + a) || []) if (!grp.has(u)) sc++; for (const u of dmap.get(a + '>' + b) || []) if (!grp.has(u) && u !== t) sc--; } return sc; };
    for (const l of groups.values()) {
      if (l.length < 2) continue;
      const grp = new Set(l.map(x => x[0])), pos = l.filter(x => x[1] > 0), neg = l.filter(x => x[1] < 0);
      let survivor = null;
      if (!neg.length) survivor = pos[0][0]; else if (!pos.length) survivor = neg[0][0];
      else { const sp = coherence(pos[0][0], grp), sn = coherence(neg[0][0], grp); if (sp > sn) survivor = pos[0][0]; else if (sn > sp) survivor = neg[0][0]; }   // coppia schiena a schiena: resta il triangolo coerente con i vicini; a parità si tolgono entrambi (parete doppia interna)
      for (const [t] of l) if (t !== survivor) { keep[t] = 0; dup++; }
    }
    // spigoli con >2 triangoli tra quelli rimasti
    let fins = 0;
    for (let pass = 0; pass < 5; pass++) {
      const em = new Map();
      for (let t = 0; t < M.nT; t++) if (keep[t]) for (let k = 0; k < 3; k++) {
        const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3], key = a < b ? a * M.nV + b : b * M.nV + a;
        if (!em.has(key)) em.set(key, []);
        em.get(key).push([t, a < b ? 1 : -1]);
      }
      const closedEdges = t => { let c = 0; for (let k = 0; k < 3; k++) { const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3], l = em.get(a < b ? a * M.nV + b : b * M.nV + a); if (l && l.filter(x => keep[x[0]]).length === 2) c++; } return c; };
      let changed = false;
      for (const l of em.values()) {
        const live = l.filter(x => keep[x[0]]); if (live.length <= 2) continue;
        let best = null;
        for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
          if (live[i][1] === live[j][1]) continue;   // devono percorrere lo spigolo in versi opposti
          // si preferiscono i triangoli i cui altri spigoli sono già "chiusi" (2 triangoli): le alette hanno spigoli liberi; a parità, area maggiore
          const sc = (closedEdges(live[i][0]) + closedEdges(live[j][0])) * 1e9 + M.A[live[i][0]] + M.A[live[j][0]]; if (!best || sc > best.sc) best = { sc, i, j };
        }
        if (!best) best = { i: 0, j: 1 };
        live.forEach((x, idx) => { if (idx !== best.i && idx !== best.j) { keep[x[0]] = 0; fins++; changed = true; } });
      }
      if (!changed) break;
    }
    let n = 0; for (let t = 0; t < M.nT; t++) n += keep[t];
    const soup = new Float32Array(n * 9); let o = 0; const names = M.triName ? new Int32Array(n) : null;
    for (let t = 0; t < M.nT; t++) if (keep[t]) {
      for (let k = 0; k < 3; k++) soup.set(M.P(M.T[3 * t + k]), o * 9 + k * 3);
      if (names) names[o] = M.triName[t];
      o++;
    }
    if (names) { soup.triName = names; soup.names = M.names; }
    return { soup, removed: M.nT - n, duplicates: dup, fins };
  }

  // ---- [v1.5.0 2026-10-07] Rilevamento AUTO-INTERSEZIONI ----
  // Due triangoli che non condividono vertici si intersecano (caso non complanare) se uno spigolo di uno buca l'altro:
  // test segmento-triangolo (Möller-Trumbore) con tolleranza interna stretta, così i contatti su spigolo/vertice non contano.
  // Accelerazione con griglia uniforme sui bounding box. Si ferma dopo `budgetMs` (risultato parziale: `partial`).
  // Solo rilevamento: la riparazione richiede booleane robuste sulla mesh (vedi IMPROVEMENTS.md).
  function findSelfIntersections(M, opts = {}) {
    const maxPairs = opts.maxPairs || 200, budget = opts.budgetMs || 4000, t0 = Date.now();
    const nT = M.nT, V = M.V, T = M.T, bb = new Float64Array(nT * 6);
    let ext = 0;
    for (let t = 0; t < nT; t++) {
      for (let k = 0; k < 3; k++) { let lo = Infinity, hi = -Infinity; for (let j = 0; j < 3; j++) { const x = V[3 * T[3 * t + j] + k]; if (x < lo) lo = x; if (x > hi) hi = x; } bb[6 * t + k] = lo; bb[6 * t + 3 + k] = hi; ext += hi - lo; }
    }
    const mn = M.bbox[0], cell = Math.max(1.5 * ext / (3 * nT || 1), M.diag / 128), inv = 1 / cell;
    const dims = [0, 1, 2].map(k => Math.floor((M.bbox[1][k] - mn[k]) * inv) + 1);
    const grid = new Map(), key = (i, j, k) => (i * dims[1] + j) * dims[2] + k;
    for (let t = 0; t < nT; t++) {
      const lo = [0, 1, 2].map(k => Math.floor((bb[6 * t + k] - mn[k]) * inv)), hi = [0, 1, 2].map(k => Math.floor((bb[6 * t + 3 + k] - mn[k]) * inv));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const c = key(i, j, k); let l = grid.get(c); if (!l) grid.set(c, l = []); l.push(t); }
    }
    const P = i => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
    // il segmento p->q buca il triangolo (a,b,c)? (parametri strettamente interni)
    const pierce = (p, q, a, b, c) => {
      const d = sub(q, p), e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-14 * (len(e1) * len(e2) * len(d) || 1)) return false;   // parallelo / complanare
      const f = 1 / det, s = sub(p, a), u = f * dot(s, h); if (u <= 1e-9 || u >= 1 - 1e-9) return false;
      const qv = cross(s, e1), v = f * dot(d, qv); if (v <= 1e-9 || u + v >= 1 - 1e-9) return false;
      const tt = f * dot(e2, qv); return tt > 1e-9 && tt < 1 - 1e-9;
    };
    const stamp = new Int32Array(nT), pairs = [], bad = new Set(); let count = 0, partial = false;
    for (let t = 0; t < nT && !partial; t++) {
      if ((t & 1023) === 0 && Date.now() - t0 > budget) { partial = true; break; }
      const tv = [T[3 * t], T[3 * t + 1], T[3 * t + 2]], tp = tv.map(P);
      const lo = [0, 1, 2].map(k => Math.floor((bb[6 * t + k] - mn[k]) * inv)), hi = [0, 1, 2].map(k => Math.floor((bb[6 * t + 3 + k] - mn[k]) * inv));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const l = grid.get(key(i, j, k)); if (!l) continue;
        for (const u of l) {
          if (u <= t || stamp[u] === t + 1) continue; stamp[u] = t + 1;
          let ov = true; for (let a = 0; a < 3; a++) if (bb[6 * t + a] > bb[6 * u + 3 + a] || bb[6 * u + a] > bb[6 * t + 3 + a]) { ov = false; break; }
          if (!ov) continue;
          const uv = [T[3 * u], T[3 * u + 1], T[3 * u + 2]]; if (uv.some(x => tv.includes(x))) continue;   // vicini: condividono almeno un vertice
          const up = uv.map(P); let hit = false;
          for (let a = 0; a < 3 && !hit; a++) hit = pierce(tp[a], tp[(a + 1) % 3], up[0], up[1], up[2]) || pierce(up[a], up[(a + 1) % 3], tp[0], tp[1], tp[2]);
          if (hit) { count++; bad.add(t); bad.add(u); if (pairs.length < maxPairs) pairs.push([t, u]); }
        }
      }
    }
    return { count, pairs, tris: bad, partial };
  }

  // ---- [v1.7.0 2026-10-07] RIPARAZIONE AUTO-INTERSEZIONI (unione booleana dei corpi sovrapposti) ----
  // Ogni corpo (componente connessa) chiuso e manifold diventa un Manifold (libreria manifold-3d in WebAssembly, `vendor/manifold.*`,
  // iniettata come `wasm` per tenere il core senza dipendenze) e i corpi si UNISCONO con una booleana robusta: le parti sovrapposte
  // si fondono e le intersezioni spariscono. Corpi aperti/non-manifold restano com'erano (si riparano prima con «Ripara»).
  // Limite: l'auto-intersezione DENTRO un solo corpo (guscio ripiegato su se stesso) non viene risolta: l'esito è verificato e, se
  // restano intersezioni, `ok` è falso. I nomi dei corpi uniti si perdono (restano quelli dei corpi non toccati).
  // Restituisce { ok, soup, merged, kept, before, after, volume }.
  function repairSelfIntersections(M, wasm) {
    const { Manifold, Mesh } = wasm, before = findSelfIntersections(M).count;
    const parts = [], keep = [];
    for (let c = 0; c < M.nComp; c++) {
      const tris = []; for (let t = 0; t < M.nT; t++) if (M.comp[t] === c) tris.push(t);
      let closed = true; for (const t of tris) for (let k = 0; k < 3; k++) if (M.ET[M.triEdge[3 * t + k]].length !== 2) closed = false;
      let man = null;
      if (closed) {
        const vmap = new Map(), vp = [], tv = []; let vol = 0;
        for (const t of tris) {
          const ids = [0, 1, 2].map(k => { const v = M.T[3 * t + k]; if (!vmap.has(v)) { vmap.set(v, vp.length / 3); vp.push(M.V[3 * v], M.V[3 * v + 1], M.V[3 * v + 2]); } return vmap.get(v); });
          tv.push(...ids); vol += dot(M.P(M.T[3 * t]), cross(M.P(M.T[3 * t + 1]), M.P(M.T[3 * t + 2]))) / 6;
        }
        if (vol < 0) for (let i = 0; i < tv.length; i += 3) { const x = tv[i + 1]; tv[i + 1] = tv[i + 2]; tv[i + 2] = x; }   // guscio rovesciato: lo si raddrizza
        try { man = new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(vp), triVerts: new Uint32Array(tv) })); if (man.status() !== 'NoError' || man.isEmpty()) man = null; } catch (e) { man = null; }
      }
      if (man) parts.push(man); else keep.push(c);
    }
    if (!parts.length) return { ok: false, reason: 'nobody', before, after: before, merged: 0, kept: keep.length };
    const u = parts.length > 1 ? Manifold.union(parts) : parts[0], om = u.getMesh(), nv = om.vertProperties, tvr = om.triVerts, np = om.numProp;
    let kt = 0; for (let t = 0; t < M.nT; t++) if (keep.includes(M.comp[t])) kt++;
    const soup = new Float32Array((tvr.length / 3 + kt) * 9); let o = 0;
    for (let i = 0; i < tvr.length; i++) { const v = tvr[i]; soup[o++] = nv[v * np]; soup[o++] = nv[v * np + 1]; soup[o++] = nv[v * np + 2]; }
    for (let t = 0; t < M.nT; t++) if (keep.includes(M.comp[t])) for (let k = 0; k < 3; k++) { const p = M.P(M.T[3 * t + k]); soup[o++] = p[0]; soup[o++] = p[1]; soup[o++] = p[2]; }
    const M2 = buildMesh(soup), after = findSelfIntersections(M2).count;
    return { ok: after === 0, soup, merged: parts.length, kept: keep.length, before, after, volume: M2.volume, reason: after ? 'internal' : '' };
  }

  function fillHoles(M) {
    const half = new Map();
    for (let t = 0; t < M.nT; t++) for (let k = 0; k < 3; k++) {
      const e = M.triEdge[3 * t + k]; if (M.ET[e].length !== 1) continue;
      const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3];
      if (!half.has(a)) half.set(a, []); half.get(a).push(b);
    }
    const used = new Set(), loops = [];
    for (const [a0, outs] of half) for (const b0 of outs) {
      const key0 = a0 + '_' + b0; if (used.has(key0)) continue;
      const loop = [a0]; let a = a0, b = b0, ok = true;
      while (true) {
        used.add(a + '_' + b);
        if (b === a0) break;
        loop.push(b);
        const nx = (half.get(b) || []).find(c => !used.has(b + '_' + c));
        if (nx === undefined || loop.length > 100000) { ok = false; break; }
        a = b; b = nx;
      }
      if (ok && loop.length >= 3) loops.push(loop);
    }
    /* [2026-10-06 13:24] versione precedente: ogni anello riempito da solo (anelli annidati complanari,
       es. faccia superiore con fori, venivano chiusi due volte -> solidi sovrapposti)
    const added = [];
    for (const loop of loops) {
      const poly = loop.slice().reverse();                // verso opposto al bordo esistente
      const P3 = poly.map(v => M.P(v)), pl = fitPlane(P3), u = perp(pl.normal), w = cross(pl.normal, u);
      const P2 = P3.map(p => [dot(p, u), dot(p, w)]);
      let area = 0; for (let i = 0; i < P2.length; i++) { const p = P2[i], q = P2[(i + 1) % P2.length]; area += p[0] * q[1] - q[0] * p[1]; }
      const sgn = Math.sign(area) || 1, idx = [...poly.keys()], tris = [];
      const crs = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      let guard = 0;
      while (idx.length > 3 && guard++ < 100000) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
          const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
          const A = P2[ia], B = P2[ib], C = P2[ic];
          if (crs(A, B, C) * sgn <= 1e-14) continue;
          let inside = false;
          for (const j of idx) { if (j === ia || j === ib || j === ic) continue; const p = P2[j]; if (crs(A, B, p) * sgn > 0 && crs(B, C, p) * sgn > 0 && crs(C, A, p) * sgn > 0) { inside = true; break; } }
          if (inside) continue;
          tris.push([poly[ia], poly[ib], poly[ic]]); idx.splice(i, 1); clipped = true; break;
        }
        if (!clipped) break;
      }
      if (idx.length === 3) { tris.push(idx.map(i => poly[i])); added.push(...tris); }
      else {                                              // poligono non semplice: ventaglio dal baricentro
        const c = mul(P3.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / P3.length);
        for (let i = 0; i < poly.length; i++) added.push([c, poly[i], poly[(i + 1) % poly.length]]);
      }
    }
    */
    // [v1.1.0] anelli complanari annidati -> poligono con fori (ponte foro-contorno), poi ear clipping
    const info = loops.map(loop => {
      const poly = loop.slice().reverse(), P3 = poly.map(v => M.P(v)), pl = fitPlane(P3);
      return { poly, P3, pl };
    });
    const added = [], usedAsHole = new Set(), crs = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const area2 = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    const inside = (pt, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const segX = (p1, p2, q1, q2) => { const d1 = crs(q1, q2, p1), d2 = crs(q1, q2, p2), d3 = crs(p1, p2, q1), d4 = crs(p1, p2, q2); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && Math.abs(d1) > 1e-12 && Math.abs(d2) > 1e-12; };
    info.forEach(o => { o.n = o.pl.normal; o.u = perp(o.n); o.w = cross(o.n, o.u); o.P2 = o.P3.map(p => [dot(p, o.u), dot(p, o.w)]); o.area = Math.abs(area2(o.P2)); });
    const order = [...info.keys()].sort((a, b) => info[b].area - info[a].area);
    for (const oi of order) {
      if (usedAsHole.has(oi)) continue;
      const o = info[oi];
      // fori: anelli più piccoli, complanari (entro tol), contenuti nel contorno
      const holes = [];
      if (o.pl.maxErr <= 1e-3 * M.diag) for (const hi of order) {
        if (hi === oi || usedAsHole.has(hi) || info[hi].area >= o.area) continue;
        const h = info[hi];
        if (Math.abs(dot(h.n, o.n)) < 0.999 || h.P3.some(p => Math.abs(dot(sub(p, o.pl.origin), o.n)) > 1e-3 * M.diag)) continue;
        const h2 = h.P3.map(p => [dot(p, o.u), dot(p, o.w)]);
        if (!inside(h2[0], o.P2)) continue;
        holes.push({ hi, P2: h2, poly: h.poly }); usedAsHole.add(hi);
      }
      // contorno con verso positivo, fori con verso negativo (rispetto alla base u,w di o)
      let poly = o.poly.slice(), P2 = o.P2.slice();
      const sgnO = Math.sign(area2(P2)) || 1;
      for (const h of holes.sort((a, b) => Math.max(...b.P2.map(p => p[0])) - Math.max(...a.P2.map(p => p[0])))) {
        let hp = h.poly.slice(), h2 = h.P2.slice();
        if (Math.sign(area2(h2)) === sgnO) { hp.reverse(); h2.reverse(); }
        const k = h2.reduce((bi, p, i) => (p[0] > h2[bi][0] ? i : bi), 0), hk = h2[k];
        // vertice del contorno visibile più vicino
        const cand = [...P2.keys()].sort((a, b) => Math.hypot(P2[a][0] - hk[0], P2[a][1] - hk[1]) - Math.hypot(P2[b][0] - hk[0], P2[b][1] - hk[1]));
        let bi = cand[0];
        for (const i of cand) {
          let ok = true;
          for (let j = 0; j < P2.length && ok; j++) { const a = P2[j], b2 = P2[(j + 1) % P2.length]; if (j === i || (j + 1) % P2.length === i) continue; if (segX(hk, P2[i], a, b2)) ok = false; }
          for (let j = 0; j < h2.length && ok; j++) { const a = h2[j], b2 = h2[(j + 1) % h2.length]; if (j === k || (j + 1) % h2.length === k) continue; if (segX(hk, P2[i], a, b2)) ok = false; }
          if (ok) { bi = i; break; }
        }
        const hRot = hp.slice(k).concat(hp.slice(0, k)), h2Rot = h2.slice(k).concat(h2.slice(0, k));
        poly = poly.slice(0, bi + 1).concat(hRot, [hp[k], poly[bi]], poly.slice(bi + 1));
        P2 = P2.slice(0, bi + 1).concat(h2Rot, [h2[k], P2[bi]], P2.slice(bi + 1));
      }
      // ear clipping
      const sgn = Math.sign(area2(P2)) || 1, idx = [...poly.keys()], tris = [];
      let guard = 0;
      while (idx.length > 3 && guard++ < 200000) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
          const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
          const A = P2[ia], B = P2[ib], C = P2[ic];
          if (crs(A, B, C) * sgn <= 1e-14) continue;
          let ins = false;
          for (const j of idx) {
            if (j === ia || j === ib || j === ic) continue; const p = P2[j];
            if ((p[0] === A[0] && p[1] === A[1]) || (p[0] === B[0] && p[1] === B[1]) || (p[0] === C[0] && p[1] === C[1])) continue;   // vertici duplicati del ponte
            if (crs(A, B, p) * sgn >= 0 && crs(B, C, p) * sgn >= 0 && crs(C, A, p) * sgn >= 0) { ins = true; break; }
          }
          if (ins) continue;
          tris.push([poly[ia], poly[ib], poly[ic]]); idx.splice(i, 1); clipped = true; break;
        }
        if (!clipped) break;
      }
      if (idx.length === 3) { tris.push(idx.map(i => poly[i])); added.push(...tris); }
      else {                                               // fallback: ventaglio dal baricentro (solo contorno)
        const c = mul(o.P3.reduce((s2, p) => add(s2, p), [0, 0, 0]), 1 / o.P3.length);
        for (let i = 0; i < o.poly.length; i++) added.push([c, o.poly[i], o.poly[(i + 1) % o.poly.length]]);
        for (const h of holes) usedAsHole.delete(h.hi);
      }
    }
    // nuova "zuppa" di triangoli: originali + chiusure (i vertici possono essere indici o punti)
    const nT = M.nT + added.length, soup = new Float32Array(nT * 9);
    for (let t = 0; t < M.nT; t++) for (let k = 0; k < 3; k++) soup.set(M.P(M.T[3 * t + k]), t * 9 + k * 3);
    added.forEach((tr, i) => tr.forEach((v, k) => soup.set(typeof v === 'number' ? M.P(v) : v, (M.nT + i) * 9 + k * 3)));
    if (M.triName) { soup.triName = new Int32Array(nT); soup.triName.set(M.triName); for (let i = M.nT; i < nT; i++) soup.triName[i] = -1; soup.names = M.names; }
    return { soup, holes: loops.length, added: added.length };
  }

  // ---- [v1.1.0 2026-10-06] Statistiche per tipo ----
  function regionStats(regions) {
    const stats = { plane: 0, cylinder: 0, cone: 0, sphere: 0, torus: 0, thread: 0, bspline: 0, freeform: 0, freeformTris: 0 };
    for (const r of regions) { stats[r.type]++; if (r.type === 'freeform') stats.freeformTris += r.tris.length; }
    return stats;
  }

  // ---- [v1.1.0 2026-10-06] Editing manuale: unisce le regioni ids e le rifitta come primitiva `as`
  //      ('auto' prova piano, cilindro, cono, sfera, toro, B-spline). maxErr = scarto massimo accettato.
  function editRegions(M, seg, ids, as, maxErr) {
    const set = new Set(ids), tris = seg.regions.filter(r => set.has(r.id)).flatMap(r => r.tris);
    if (!tris.length) throw new Error('err.empty');
    // connessione: le regioni unite devono formare un'unica zona
    const inT = new Set(tris), seen = new Set([tris[0]]), st = [tris[0]];
    while (st.length) { const t = st.pop(); for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && inT.has(u) && !seen.has(u)) { seen.add(u); st.push(u); } } }
    if (seen.size !== tris.length) throw new Error('err.notConnected');
    const Nv = t => [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], pts = verticesOf(M, tris);
    const outward = (center, axisDir) => { let o = 0; for (const t of tris) { const p = [M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]]; let d = sub(p, center); if (axisDir) d = sub(d, mul(axisDir, dot(d, axisDir))); o += M.A[t] * dot(Nv(t), d); } return o >= 0; };
    const tryFit = type => {
      if (type === 'plane') { const pl = fitPlane(pts); let n = pl.normal, m = [0, 0, 0]; for (const t of tris) m = add(m, Nv(t)); if (dot(m, n) < 0) n = mul(n, -1); return { type, err: pl.maxErr, normal: n, origin: pl.origin }; }
      if (type === 'cylinder') { const ax = norm(axisFromNormals(M, tris)[0].vec), c = fitCylinder(M, tris, ax); return c && { type, err: c.maxErr, axis: ax, origin: c.origin, radius: c.radius, height: c.height, outward: outward(c.origin, ax) }; }
      if (type === 'cone') { const c = fitCone(M, tris); return c && { type, err: c.maxErr, apex: c.apex, axis: c.axis, alpha: c.alpha, hmin: c.hmin, hmax: c.hmax, outward: outward(c.apex, c.axis) }; }
      if (type === 'sphere') { const c = fitSphere(pts); return c && { type, err: c.maxErr, center: c.center, radius: c.radius, outward: outward(c.center) }; }
      if (type === 'torus') {
        const T = fitTorus(M, tris); if (!T) return null;
        let o = 0; for (const t of tris) { const p = [M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], d = sub(p, T.center), h = dot(d, T.axis), q = add(T.center, mul(norm(sub(d, mul(T.axis, h))), T.R)); o += M.A[t] * dot(Nv(t), sub(p, q)); }
        return { type, err: T.maxErr, center: T.center, axis: T.axis, R: T.R, r: T.r, outward: o >= 0 };
      }
      if (type === 'bspline') { const B = fitBSplineAny(M, tris, maxErr); return B && Object.assign({ type }, bsFields(B)); }   // [v1.5.0] prima: fitBSpline + campi a mano
      if (type === 'freeform') return { type, err: 0 };
      return null;
    };
    let reg = null, bestErr = Infinity;
    if (as === 'auto') {
      for (const ty of ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'bspline']) { const r = tryFit(ty); if (r && r.err < bestErr) bestErr = r.err; if (r && r.err <= maxErr) { reg = r; break; } }
    } else { reg = tryFit(as); if (reg) bestErr = reg.err; if (reg && reg.err > maxErr) reg = null; }
    if (!reg) { const e = new Error('err.fit'); e.best = bestErr; throw e; }
    // nuova lista regioni: rimuove le unite, aggiunge la nuova in coda, rinumera
    // [2026-10-08 v1.8.0] prima: const regions = seg.regions.filter(r => !set.has(r.id));  (rinumerare gli id mutava le regioni dello stato precedente: Annulla/resizeHole)
    const regions = seg.regions.filter(r => !set.has(r.id)).map(r => Object.assign({}, r));
    reg.tris = tris; reg.manual = true; regions.push(reg);
    regions.forEach((r, i) => { r.id = i; });
    const face = new Int32Array(M.nT); regions.forEach(r => { for (const t of r.tris) face[t] = r.id; });
    return { face, regions, stats: regionStats(regions), newId: reg.id };
  }

  // ---- [v1.8.0] Modifica foro: nuovo diametro per un foro cilindrico (o filetto interno) ----
  // Tabella M2–M16: [Ø nominale, passo, foro di gioco (ISO 273 serie media), foro di maschiatura]
  const HOLE_SIZES = [[2, 0.4, 2.4, 1.6], [2.5, 0.45, 2.9, 2.05], [3, 0.5, 3.4, 2.5], [4, 0.7, 4.5, 3.3], [5, 0.8, 5.5, 4.2], [6, 1, 6.6, 5], [8, 1.25, 9, 6.8],
    [10, 1.5, 11, 8.5], [12, 1.75, 13.5, 10.2], [14, 2, 15.5, 12], [16, 2, 17.5, 14]];
  // mode: 'clearance' (gioco), 'tap' (maschiatura), 'thread' (maschiatura + etichetta «THREAD Mx» sulla faccia: filettatura NON elicoidale), 'diameter' (valore libero)
  function holeTarget(mode, size, dia) {
    if (mode === 'diameter') return { dia, label: null };
    const row = HOLE_SIZES.find(x => x[0] === size); if (!row) throw new Error('err.holeSize');
    if (mode === 'clearance') return { dia: row[2], label: null };
    if (mode === 'tap') return { dia: row[3], label: null };
    if (mode === 'thread') return { dia: row[3], label: 'M' + size };
    throw new Error('err.holeMode');
  }
  // Sposta radialmente i vertici del foro sul nuovo raggio (i piani ⟂ asse restano piani), ricostruisce la mesh (stesso ordine dei triangoli)
  // e rifitta le regioni toccate: il foro come cilindro esatto, i vicini (coni, ecc.) con il proprio tipo, altrimenti sfaccettati.
  function resizeHole(M, seg, id, mode, size, dia) {
    const r = seg.regions[id];
    if (!r || !((r.type === 'cylinder' && !r.outward) || (r.type === 'thread' && r.internal))) throw new Error('err.notHole');
    const { dia: D, label } = holeTarget(mode, size, dia), R = D / 2;
    if (!(R > 0.05)) throw new Error('err.holeSize');
    const a = r.axis, o = r.origin, P = i => M.P(i), moved = new Uint8Array(M.nV), np = new Map();
    for (const t of r.tris) for (let k = 0; k < 3; k++) {
      const v = M.T[3 * t + k]; if (moved[v]) continue;
      const d = sub(P(v), o), h = dot(d, a), q = sub(d, mul(a, h)), l = len(q); if (l < 1e-9) throw new Error('err.holeSize');
      np.set(v, add(o, add(mul(a, h), mul(q, R / l)))); moved[v] = 1;
    }
    const soup = new Float32Array(M.nT * 9);
    for (let t = 0; t < M.nT; t++) for (let k = 0; k < 3; k++) { const v = M.T[3 * t + k]; soup.set(np.get(v) || P(v), t * 9 + k * 3); }
    if (M.triName) { soup.triName = M.triName; soup.names = M.names; }
    const M2 = buildMesh(soup);
    if (M2.nT !== M.nT) throw new Error('err.holeCollision');
    // triangoli vicini ribaltati (rim che esce dal contorno, raggio oltre il materiale) = collisione
    const own = new Set(r.tris);
    for (let t = 0; t < M.nT; t++) {
      if (own.has(t) || !(moved[M.T[3 * t]] || moved[M.T[3 * t + 1]] || moved[M.T[3 * t + 2]])) continue;
      if (M.N[3 * t] * M2.N[3 * t] + M.N[3 * t + 1] * M2.N[3 * t + 1] + M.N[3 * t + 2] * M2.N[3 * t + 2] < 0.5) throw new Error('err.holeCollision');
    }
    if (M2.nComp !== M.nComp || findSelfIntersections(M2).count > findSelfIntersections(M).count) throw new Error('err.holeCollision');
    // regioni da rifittare: il foro + quelle che toccano vertici spostati (esclusi i piani ⟂ asse, che restano esatti)
    const reps = [{ t: r.tris[0], as: 'cylinder' }];
    for (const q of seg.regions) {
      if (q.id === id || !q.tris.some(t => moved[M.T[3 * t]] || moved[M.T[3 * t + 1]] || moved[M.T[3 * t + 2]])) continue;
      if (q.type === 'plane' && Math.abs(dot(q.normal, a)) > Math.cos(0.5 * Math.PI / 180)) continue;
      reps.push({ t: q.tris[0], as: ['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(q.type) ? q.type : 'freeform' });
    }
    let cur = { face: Int32Array.from(seg.face), regions: seg.regions }, holeRep = reps[0].t;
    for (const rp of reps) {
      const rid = cur.face[rp.t];
      let e; try { e = editRegions(M2, cur, [rid], rp.as, Infinity); } catch (x) { e = editRegions(M2, cur, [rid], 'freeform', Infinity); }
      cur = { face: e.face, regions: e.regions };
    }
    const hole = cur.regions[cur.face[holeRep]];
    if (hole.type !== 'cylinder') throw new Error('err.fit');
    if (label) hole.threadLabel = label;
    return { M: M2, seg: Object.assign({}, seg, { face: cur.face, regions: cur.regions }), diameter: 2 * hole.radius, label, newId: hole.id };
  }

  // ---- Caratteristiche: fori passanti/ciechi, profondità; corpi ----
  function features(M, seg) {
    const regs = seg ? seg.regions : [];   // [v1.2.0] seg null -> solo corpi
    const nbr = regs.map(() => new Set());
    if (seg) for (let t = 0; t < M.nT; t++) for (let j = 0; j < 3; j++) { const u = M.nb[3 * t + j]; if (u >= 0 && seg.face[u] !== seg.face[t]) nbr[seg.face[t]].add(seg.face[u]); }
    const holes = [];
    for (const r of regs) {
      if (r.type !== 'cylinder' || r.outward) continue;
      // cieco se una regione vicina (fondo piano o punta conica) confina solo con questo cilindro
      const bottom = [...nbr[r.id]].find(f => nbr[f].size === 1 && nbr[f].has(r.id));
      let depth = r.height;
      if (bottom !== undefined && seg.regions[bottom].type === 'cone') {
        const cn = seg.regions[bottom]; depth += Math.abs(cn.hmax - cn.hmin);
      }
      holes.push({ region: r.id, diameter: 2 * r.radius, through: bottom === undefined, depth, axis: r.axis, origin: r.origin, length: r.height });
    }
    // corpi: nome, triangoli, chiuso, volume
    const bodies = [...Array(M.nComp)].map((_, c) => ({ id: c, name: (M.compNames && M.compNames[c]) || 'Body' + (c + 1), nTris: 0, closed: true, volume: 0 }));
    for (let t = 0; t < M.nT; t++) {
      const b = bodies[M.comp[t]]; b.nTris++;
      const a = M.P(M.T[3 * t]), bb = M.P(M.T[3 * t + 1]), c = M.P(M.T[3 * t + 2]); b.volume += dot(a, cross(bb, c)) / 6;
    }
    for (let e = 0; e < M.E0.length; e++) if (M.ET[e].length !== 2) for (const t of M.ET[e]) bodies[M.comp[t]].closed = false;
    return { holes, bodies };
  }

  // ---- Deviazione: distanza max dei vertici di ogni triangolo dalla superficie della sua regione ----
  function surfDist(r, p) {
    switch (r.type) {
      case 'plane': return Math.abs(dot(sub(p, r.origin), r.normal));
      case 'cylinder': { const d = sub(p, r.origin), h = dot(d, r.axis); return Math.abs(len(sub(d, mul(r.axis, h))) - r.radius); }
      case 'sphere': return Math.abs(len(sub(p, r.center)) - r.radius);
      case 'cone': return coneDist(r, p);
      case 'torus': return Math.abs(torusDist(r, p));
      default: return 0;
    }
  }
  function deviation(M, seg) {
    // [v1.5.1] devThr: come dev, ma le filettature sono confrontate con il cilindro nominale (quello dell'opzione STEP «filettature come cilindro»):
    // di default la filettura è esportata sfaccettata = esatta (dev 0); i freeform sono sempre sfaccettati = esatti (dev 0, nessuna superficie da confrontare)
    const dev = new Float32Array(M.nT), devThr = new Float32Array(M.nT); let mx = 0, mxThr = 0;
    for (let t = 0; t < M.nT; t++) {
      const r = seg.regions[seg.face[t]]; let d = 0;
      if (r.type === 'thread') {
        const R = r.internal ? r.rmin : (r.nominal ? r.nominal / 2 : r.rmax); let dt = 0;
        for (let k = 0; k < 3; k++) { const q = sub(M.P(M.T[3 * t + k]), r.origin); dt = Math.max(dt, Math.abs(len(sub(q, mul(r.axis, dot(q, r.axis)))) - R)); }
        devThr[t] = dt; mxThr = Math.max(mxThr, dt); continue;
      }
      // [2026-10-06 v1.3.2] prima: if (r.type === 'bspline' && r.devTri) d = r.devTri.get(t) || 0;  (devTri non è mai impostato -> sempre 0, mappa tutta verde)
      // [v1.4.0] prima (1.3.2): sempre r.err (un solo valore per regione); ora scarto verticale vero dei vertici del triangolo
      if (r.type === 'bspline') { if (r.dist) for (let k = 0; k < 3; k++) d = Math.max(d, r.dist(M.P(M.T[3 * t + k]))); else d = r.err || 0; }
      else for (let k = 0; k < 3; k++) d = Math.max(d, surfDist(r, M.P(M.T[3 * t + k])));
      dev[t] = d; devThr[t] = d; mx = Math.max(mx, d); mxThr = Math.max(mxThr, d);
    }
    return { dev, max: mx, devThr, maxThr: mxThr };
  }

  // ============================ 5. EXPORT STEP ============================
  function stepNum(x, dec = 9) {
    if (!isFinite(x) || Math.abs(x) < 1e-12) return '0.';
    let s = x.toFixed(dec).replace(/0+$/, '');
    if (s === '-0.') s = '0.';
    return s;
  }
  const stepStr = s => "'" + String(s).replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_') + "'";

  // ---- [v1.4.0] Filettature -> cilindro nominale (solo per l'export STEP, su una copia della mesh) ----
  // I vertici delle regioni 'thread' vengono proiettati radialmente sul raggio nominale (esterno: Ø nominale ISO o cresta;
  // interno: fondo del foro = rmin). Le proiezioni sono radiali, quindi i piani ⟂ asse che chiudono il filetto restano piani.
  // Le altre regioni che toccano vertici spostati (tranne piani ⟂ asse) diventano sfaccettate (freeform) per restare valide.
  function threadsToCylinders(M, seg) {
    const ths = seg.regions.filter(r => r.type === 'thread');
    if (!ths.length) return { M, seg, n: 0 };
    const V = new Float64Array(M.V), P = i => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
    const moved = new Uint8Array(M.nV), cylOf = new Map();
    for (const r of ths) {
      const R = r.internal ? r.rmin : (r.nominal ? r.nominal / 2 : r.rmax), a = r.axis, o = r.origin;
      for (const t of r.tris) for (let k = 0; k < 3; k++) {
        const v = M.T[3 * t + k]; if (moved[v]) continue;
        const d = sub(P(v), o), h = dot(d, a), q = sub(d, mul(a, h)), l = len(q); if (l < 1e-9) continue;
        const np = add(o, add(mul(a, h), mul(q, R / l))); V[3 * v] = np[0]; V[3 * v + 1] = np[1]; V[3 * v + 2] = np[2]; moved[v] = 1;
      }
    }
    const N = new Float64Array(M.N), A = new Float64Array(M.A), C = new Float64Array(M.C);
    for (let t = 0; t < M.nT; t++) {
      if (!(moved[M.T[3 * t]] || moved[M.T[3 * t + 1]] || moved[M.T[3 * t + 2]])) continue;
      const a = P(M.T[3 * t]), b = P(M.T[3 * t + 1]), c = P(M.T[3 * t + 2]), n = cross(sub(b, a), sub(c, a)), l = len(n);
      A[t] = l / 2; N.set(l > 0 ? mul(n, 1 / l) : [0, 0, 1], 3 * t); C.set(mul(add(add(a, b), c), 1 / 3), 3 * t);
    }
    const M2 = Object.assign({}, M, { V, P, N, A, C });
    const regions = seg.regions.map(r => {
      if (r.type === 'thread') return { id: r.id, type: 'cylinder', tris: r.tris, axis: r.axis, origin: r.origin, radius: r.internal ? r.rmin : (r.nominal ? r.nominal / 2 : r.rmax), height: r.length, err: 0, outward: !r.internal, threadLabel: r.label };
      if (!r.tris.some(t => moved[M.T[3 * t]] || moved[M.T[3 * t + 1]] || moved[M.T[3 * t + 2]])) return r;
      if (r.type === 'plane' && ths.some(th => Math.abs(dot(r.normal, th.axis)) > Math.cos(0.5 * Math.PI / 180))) return r;
      return { id: r.id, type: 'freeform', tris: r.tris, err: 0 };
    });
    return { M: M2, seg: Object.assign({}, seg, { regions }), n: ths.length };
  }

  // ---- [v1.9.0] Verifica STEP: controllo leggero del testo esportato (senza OpenCASCADE) ----
  // Controlla: intestazione/chiusura del file, id unici, riferimenti #n risolti, numeri finiti, anelli (EDGE_LOOP) chiusi e continui,
  // facce con almeno un anello, e per ogni CLOSED_SHELL che ogni spigolo sia usato due volte con verso opposto
  // (OPEN_SHELL: gli spigoli usati una volta sola sono il bordo aperto, solo avviso). La validità completa resta in tests/check_step.py (OpenCASCADE).
  function verifyStep(text) {
    const errors = [], warnings = [], ent = new Map();
    const err = m => { if (errors.length < 50) errors.push(m); };
    if (!/^ISO-10303-21;/.test(text)) err('step.noHeader');
    if (!/END-ISO-10303-21;\s*$/.test(text)) err('step.noFooter');
    if (!/\nENDSEC;\n/.test(text)) err('step.noEndsec');
    if (/NaN|Infinity|undefined/.test(text)) err('step.badNumber');
    const dataAt = text.indexOf('DATA;'); if (dataAt < 0) err('step.noData');
    for (const line of text.slice(Math.max(dataAt, 0)).split('\n')) {
      const m = /^#(\d+)=(.*);$/.exec(line); if (!m) continue;
      const id = +m[1]; if (ent.has(id)) err('step.dupId:#' + id);
      const body = m[2].replace(/'(?:[^']|'')*'/g, "''");   // via i testi: possono contenere '#'
      const k = /^([A-Z_0-9]+)\(/.exec(body);
      ent.set(id, { name: k ? k[1] : 'COMPLEX', body, refs: (body.match(/#\d+/g) || []).map(x => +x.slice(1)) });
    }
    let dangling = 0;
    for (const [id, e] of ent) for (const r of e.refs) if (!ent.has(r)) { dangling++; err(`step.dangling:#${id}->#${r}`); }
    const of = n => [...ent].filter(([, e]) => e.name === n);
    const counts = { faces: of('ADVANCED_FACE').length, edges: of('EDGE_CURVE').length, vertices: of('VERTEX_POINT').length, loops: of('EDGE_LOOP').length, solids: of('MANIFOLD_SOLID_BREP').length, openShells: of('OPEN_SHELL').length };
    // spigolo: v0, v1 ; orientamento: ORIENTED_EDGE(...,#edge,.T./.F.)
    const edgeEnds = id => { const e = ent.get(id); return e && e.name === 'EDGE_CURVE' ? e.refs.slice(0, 2) : null; };
    const oriented = id => { const e = ent.get(id); if (!e || e.name !== 'ORIENTED_EDGE') return null; const f = !/\.F\.\)$/.test(e.body); return { edge: e.refs[0], fwd: f }; };
    const loopOk = new Map();
    for (const [id, e] of of('EDGE_LOOP')) {
      const oes = e.refs.map(oriented); let ok = oes.length > 0;
      if (oes.some(x => !x || !edgeEnds(x.edge))) { err(`step.loopRef:#${id}`); ok = false; }
      else {
        const se = oes.map(x => { const [a, b] = edgeEnds(x.edge); return x.fwd ? [a, b] : [b, a]; });
        for (let i = 0; i < se.length; i++) if (se[i][1] !== se[(i + 1) % se.length][0]) { err(`step.loopOpen:#${id}`); ok = false; break; }
      }
      loopOk.set(id, ok);
    }
    const faceLoops = new Map();
    for (const [id, e] of of('ADVANCED_FACE')) {
      const bounds = e.refs.filter(r => ent.has(r) && /^FACE_(OUTER_)?BOUND$/.test(ent.get(r).name));
      if (!bounds.length) err(`step.faceNoBound:#${id}`);
      faceLoops.set(id, bounds.map(b => ent.get(b).refs[0]));
    }
    const checkShell = (id, e, closed) => {
      const use = new Map();   // spigolo -> [n. versi diretti, n. versi inversi]
      for (const f of e.refs) { if (!faceLoops.has(f)) { err(`step.shellFace:#${id}->#${f}`); continue; }
        for (const lp of faceLoops.get(f)) { const L = ent.get(lp); if (!L) continue; for (const r of L.refs) { const o = oriented(r); if (!o) continue; const u = use.get(o.edge) || [0, 0]; u[o.fwd ? 0 : 1]++; use.set(o.edge, u); } } }
      let bad = 0, boundary = 0;
      for (const [, [a, b]] of use) { if (a === 1 && b === 1) continue; if (a + b === 1) boundary++; else bad++; }
      if (closed && (bad || boundary)) err(`step.shellNotClosed:#${id}:${bad + boundary}`);
      if (!closed && bad) err(`step.shellEdge:#${id}:${bad}`);
      if (!closed && boundary) warnings.push(`step.openBoundary:${boundary}`);
    };
    for (const [id, e] of of('CLOSED_SHELL')) checkShell(id, e, true);
    for (const [id, e] of of('OPEN_SHELL')) checkShell(id, e, false);
    if (!counts.faces) err('step.noFaces');
    return { ok: errors.length === 0, errors, warnings, counts, entities: ent.size, dangling };
  }

  function exportSTEP(M, seg, opts = {}) {
    if (opts.threadCyl) ({ M, seg } = threadsToCylinders(M, seg));   // [v1.4.0]
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
    // [2026-10-21 v1.11.1] incertezza = max(tol, 1,2 × scarto massimo delle B-spline): le patch della seconda passata (2·tol) hanno spigoli fino a 2·tol
    // dalla superficie e con l'incertezza = tol il lettore li considerava fuori faccia. prima: LENGTH_MEASURE(${'$'}{stepNum(tol)})
    const tolU = Math.max(tol, ...seg.regions.filter(r => r.type === 'bspline' && r.tris.length).map(r => 1.2 * (r.err || 0)));
    const unc = E(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${stepNum(tolU)}),${uLen},'distance_accuracy_value','confusion accuracy')`);
    const gctx = E(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${uLen},${uAng},${uSol}))REPRESENTATION_CONTEXT('Context3D','3D context'))`);

    // --- id di "faccia B-rep": regioni analitiche intere; freeform = un triangolo per faccia ---
    /* [2026-10-06] versione precedente: freeform per triangolo, il resto una faccia per regione
    const fid = new Int32Array(M.nT); let nF = 0;
    const faceInfo = [];   // { region, tris }
    for (const r of seg.regions) {
      if (r.type === 'freeform') for (const t of r.tris) { fid[t] = nF++; faceInfo.push({ region: r, tris: [t] }); }
      else { for (const t of r.tris) fid[t] = nF; nF++; faceInfo.push({ region: r, tris: r.tris }); }
    }
    */
    // [v1.1.0] sfaccettate per triangolo: freeform, filettature e regioni chiuse senza bordo
    // (es. sfera/toro completi: una ADVANCED_FACE richiede almeno un anello); corpi esclusi saltati
    const bodies = opts.bodies || [];
    const included = t => !(bodies[M.comp[t]] && bodies[M.comp[t]].include === false);
    const fid = new Int32Array(M.nT).fill(-1); let nF = 0;
    const faceInfo = [];   // { region, tris }
    for (const r of seg.regions) {
      const tris = r.tris.filter(included); if (!tris.length) continue;
      let faceted = r.type === 'freeform' || r.type === 'thread';
      if (!faceted) { const inR = new Set(r.tris); faceted = !r.tris.some(t => [0, 1, 2].some(j => { const u = M.nb[3 * t + j]; return u < 0 || !inR.has(u); })); }
      // [v1.4.0 2026-10-07] sfera/toro COMPLETI (nessun bordo): divisi in due metà con un piano per il centro/asse ->
      // due facce analitiche (prima: una faccia piana per triangolo). Sfera: due emisferi; toro: due semi-tubi.
      if (faceted && (r.type === 'sphere' || r.type === 'torus') && r.center) {
        const nn = r.type === 'sphere' ? [0, 0, 1] : perp(r.axis), ga = [], gb = [];
        for (const t of tris) (dot(sub([M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], r.center), nn) >= 0 ? ga : gb).push(t);
        if (ga.length && gb.length) { for (const g of [ga, gb]) { for (const t of g) fid[t] = nF; nF++; faceInfo.push({ region: r, tris: g }); } continue; }
      }
      // [2026-10-21 v1.13.0] prima: un triangolo per faccia. Ora i triangoli complanari connessi diventano una sola faccia piana e le schegge
      // (triangoli degeneri, senza area) si uniscono alla faccia oltre il loro lato lungo (come «settle_slivers» di SimpleCAD): una scheggia
      // da sola era una faccia non valida per OpenCASCADE.
      // prima: if (faceted) for (const t of tris) { fid[t] = nF++; faceInfo.push({ region: r, tris: [t], faceted: true }); }
      // [2026-10-22 v1.13.1] r.singleTris (messo da facetRegionsAt quando una faccia unita resta non valida): un triangolo per faccia,
      // senza unione dei complanari (Plenum, tolleranza 0,02: un gruppo complanare da 117,9 mm² restava non valido e lo STEP finale pure).
      if (faceted && r.singleTris) for (const t of tris) { fid[t] = nF++; faceInfo.push({ region: r, tris: [t], faceted: true, rep: t }); }
      else if (faceted) {
        const inR = new Set(tris), grp = new Map(), isSl = t => { const a = M.P(M.T[3 * t]), b = M.P(M.T[3 * t + 1]), c = M.P(M.T[3 * t + 2]), lo = Math.max(len(sub(b, a)), len(sub(c, b)), len(sub(a, c))); return 2 * M.A[t] < Math.max(1e-3 * lo, 1e-6 * M.diag) * lo; };
        const nrm = t => [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]], coplanar = (t, u) => { if (dot(nrm(t), nrm(u)) < Math.cos(1e-3)) return false; const o = M.P(M.T[3 * t]), n = nrm(t); for (let k = 0; k < 3; k++) if (Math.abs(dot(sub(M.P(M.T[3 * u + k]), o), n)) > 1e-7 * M.diag) return false; return true; };
        const groups = [];
        for (const t0 of tris) {
          if (grp.has(t0) || isSl(t0)) continue;
          const g = [t0]; grp.set(t0, groups.length);
          for (let q = 0; q < g.length; q++) for (let k = 0; k < 3; k++) { const u = M.nb[3 * g[q] + k]; if (u < 0 || !inR.has(u) || grp.has(u) || isSl(u) || !coplanar(t0, u)) continue; grp.set(u, groups.length); g.push(u); }
          groups.push(g);
        }
        for (const t of tris) if (!grp.has(t)) {   // schegge: alla faccia oltre il lato lungo (seguendo la catena), altrimenti una faccia propria
          let u = t; for (let it = 0; it < 64 && !grp.has(u); it++) { const a = M.P(M.T[3 * u]), b = M.P(M.T[3 * u + 1]), c = M.P(M.T[3 * u + 2]), L = [len(sub(b, a)), len(sub(c, b)), len(sub(a, c))], w = M.nb[3 * u + L.indexOf(Math.max(...L))]; if (w < 0 || !inR.has(w) || w === t) break; u = w; }
          if (grp.has(u)) { grp.set(t, grp.get(u)); groups[grp.get(u)].push(t); } else { grp.set(t, groups.length); groups.push([t]); }
        }
        for (const g of groups) { for (const t of g) fid[t] = nF; nF++; let big = g[0]; for (const t of g) if (M.A[t] > M.A[big]) big = t; faceInfo.push({ region: r, tris: g, faceted: true, rep: big }); }
      }
      else { for (const t of tris) fid[t] = nF; nF++; faceInfo.push({ region: r, tris }); }
    }

    // --- spigoli topologici: spigoli mesh con facce diverse ai due lati (o bordo aperto) ---
    const nE = M.E0.length, isTopo = new Uint8Array(nE);
    const facesKey = e => M.ET[e].map(t => fid[t]).sort((a, b) => a - b).join('_');
    const vEdges = new Map();   // vertice -> spigoli topologici incidenti
    for (let e = 0; e < nE; e++) {
      if (fid[M.ET[e][0]] < 0) continue;   // [v1.1.0] corpo escluso
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
    // [2026-10-22 v1.13.2] prima: const vertexPoint = v => { if (!vtx.has(v)) vtx.set(v, E(`VERTEX_POINT('',${pt(M.P(v))})`)); return vtx.get(v); };
    // opts.bsplineSnap: i vertici toccati da una B-spline aperta vengono portati sulla superficie (media delle proiezioni se più B-spline, solo se
    // lo spostamento è ≤ tol): così le PCURVE alle estremità coincidono con la proiezione che OpenCASCADE fa degli altri spigoli della faccia.
    const vposMemo = new Map();
    const posOf = v => {
      if (!opts.bsplineSnap) return M.P(v);
      if (vposMemo.has(v)) return vposMemo.get(v);
      const p = M.P(v), prj = [];
      for (const e of (vEdges.get(v) || [])) for (const fi of facesOf(e)) if (!fi.faceted && fi.region.type === 'bspline' && !fi.region.closedU && fi.region.proj && !prj.some(x => x.fi === fi)) { const q = fi.region.proj(p); if (q) prj.push({ fi, q }); }
      let res = p;
      if (prj.length) { const m = mul(prj.reduce((a, x) => add(a, x.q), [0, 0, 0]), 1 / prj.length); if (len(sub(m, p)) <= tol) res = m; }
      vposMemo.set(v, res); return res;
    };
    const vertexPoint = v => { if (!vtx.has(v)) vtx.set(v, E(`VERTEX_POINT('',${pt(posOf(v))})`)); return vtx.get(v); };
    // [2026-10-21 v1.11.2] PROIEZIONE SULLE SUPERFICI (idea presa da SimpleCAD, addon FreeCAD MIT: "ogni bordo condiviso diventa una curva che
    // sta su entrambe le superfici vicine"). Le polilinee della mesh stavano solo entro tol dalle superfici e, con triangoli lunghi, la corda
    // si allontanava di millimetri: OpenCASCADE allargava la tolleranza dello spigolo e la faccia risultava non valida.
    const projOn = (fi, p) => {
      if (!fi || fi.faceted) return null;
      const r = fi.region;
      if (r.type === 'plane') return sub(p, mul(r.normal, dot(sub(p, r.origin), r.normal)));
      if (r.type === 'cylinder') { const d = sub(p, r.origin), h = dot(d, r.axis), q = sub(d, mul(r.axis, h)), l = len(q); return l > 1e-12 ? add(r.origin, add(mul(r.axis, h), mul(q, r.radius / l))) : null; }
      if (r.type === 'sphere') { const d = sub(p, r.center), l = len(d); return l > 1e-12 ? add(r.center, mul(d, r.radius / l)) : null; }
      if (r.type === 'cone') { const d = sub(p, r.apex), h = dot(d, r.axis), q = sub(d, mul(r.axis, h)), l = len(q); if (l < 1e-12) return null; const g = add(mul(r.axis, Math.cos(r.alpha)), mul(q, Math.sin(r.alpha) / l)); return add(r.apex, mul(g, Math.max(0, dot(d, g)))); }
      if (r.type === 'torus') { const d = sub(p, r.center), h = dot(d, r.axis), q = sub(d, mul(r.axis, h)), l = len(q); if (l < 1e-12) return null; const C = add(r.center, mul(q, r.R / l)), w = sub(p, C), lw = len(w); return lw > 1e-12 ? add(C, mul(w, r.r / lw)) : null; }
      if (r.type === 'bspline' && r.proj) return r.proj(p);
      return null;
    };
    const facesOf = e => [...new Set(M.ET[e].map(t => fid[t]))].map(f => faceInfo[f]);
    // punto sul bordo tra le facce: intersezione (proiezioni alternate) se vicina, altrimenti metà strada tra le due proiezioni
    const between = (fs, p) => {
      if (fs.length === 1) return projOn(fs[0], p) || p;
      const A = fs[0], B = fs[1], pa = projOn(A, p), pb = projOn(B, p); if (!pa || !pb) return p;
      let q = mul(add(pa, pb), 0.5);
      for (let it = 0; it < 30; it++) { const nq = projOn(A, projOn(B, q) || q) || q; if (len(sub(nq, q)) < 1e-6 * tol) { q = nq; break; } q = nq; }
      const qb = projOn(B, q);
      if (!(qb && len(sub(qb, q)) <= 0.05 * tol && len(sub(q, p)) <= 2 * tol)) q = mul(add(pa, pb), 0.5);
      // si accetta lo spostamento solo se avvicina il punto a entrambe le superfici (altrimenti resta il punto della mesh)
      const gap = x => Math.max(len(sub(projOn(A, x) || x, x)), len(sub(projOn(B, x) || x, x)));
      // [2026-10-21 v1.13.0] e solo se lo spostamento è piccolo (≤ 2·tol): accanto a una «sfera» con corde lontane spostava il bordo di millimetri
      // e la faccia piana vicina, valida per OpenCASCADE, aveva un'area del 20% diversa da quella dei suoi triangoli
      return gap(q) < gap(p) && len(sub(q, p)) <= 2 * tol ? q : p;
    };
    // [2026-10-21 v1.13.1] superficie di una faccia (memorizzata) e funzione dei parametri (u, v) per le PCURVE: piani (anche sfaccettati) e
    // B-spline aperte; per cilindri/coni/sfere/tori/B-spline chiuse uv = null (OpenCASCADE proietta in modo esatto sulle analitiche).
    const planeUV = (o, n) => { const x = perp(n), y = cross(n, x); return p => { const d = sub(p, o); return [dot(d, x), dot(d, y)]; }; };
    const surfMemo = new Map();
    const surfOf = fi => {
      if (surfMemo.has(fi)) return surfMemo.get(fi);
      let surf, sense = '.T.', uv = null; const r = fi.region;
      // [v1.13.0] prima: t = fi.tris[0] (con le facce di più triangoli serve il triangolo più grande: le schegge hanno normale casuale)
      if (fi.faceted) { const t = fi.rep != null ? fi.rep : fi.tris[0], n = [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]]; surf = E(`PLANE('',${place(M.P(M.T[3 * t]), n, perp(n))})`); uv = planeUV(M.P(M.T[3 * t]), n); }
      else if (r.type === 'plane') { surf = E(`PLANE('',${place(r.origin, r.normal, perp(r.normal))})`); uv = planeUV(r.origin, r.normal); }
      else if (r.type === 'cone') {   // [v1.1.0] posizione alla quota minima, raggio = h·tanα
        const h0 = Math.max(0, r.hmin);
        surf = E(`CONICAL_SURFACE('',${place(add(r.apex, mul(r.axis, h0)), r.axis, perp(r.axis))},${stepNum(h0 * Math.tan(r.alpha))},${stepNum(r.alpha, 12)})`); sense = r.outward ? '.T.' : '.F.';
      } else if (r.type === 'torus') {
        surf = E(`TOROIDAL_SURFACE('',${place(r.center, r.axis, perp(r.axis))},${stepNum(r.R)},${stepNum(r.r)})`); sense = r.outward ? '.T.' : '.F.';
      } else if (r.type === 'bspline') {
        const rows = r.cp.map(row => '(' + row.map(pt).join(',') + ')').join(',');
        // [v1.5.0] superficie chiusa in u (B-spline bloccata con prima e ultima riga coincidenti): nodi v propri (segsV), U_CLOSED vero
        const sv = r.closedU ? r.segsV : r.segs;
        const mult = [4, ...Array(r.segs - 1).fill(1), 4].join(','), kn = [...Array(r.segs + 1).keys()].map(i => stepNum(i)).join(',');
        const multV = [4, ...Array(sv - 1).fill(1), 4].join(','), knV = [...Array(sv + 1).keys()].map(i => stepNum(i)).join(',');
        // [v1.12.0] superfici del port SimpleCAD: nodi non uniformi (r.ub / r.vb = punti di rottura)
        const U = r.ub ? { m: [4, ...Array(r.ub.length - 2).fill(1), 4].join(','), k: r.ub.map(x => stepNum(x)).join(',') } : { m: mult, k: kn };
        const Vk = r.vb ? { m: [4, ...Array(r.vb.length - 2).fill(1), 4].join(','), k: r.vb.map(x => stepNum(x)).join(',') } : { m: multV, k: knV };
        // [v1.5.0] prima: ...,.UNSPECIFIED.,.F.,.F.,.F.,(${mult}),(${mult}),(${kn}),(${kn}),.UNSPECIFIED.) con gli stessi nodi in u e v
        // [v1.12.0] prima: ...,(${mult}),(${multV}),(${kn}),(${knV}),...
        surf = E(`B_SPLINE_SURFACE_WITH_KNOTS('',3,3,(${rows}),.UNSPECIFIED.,${r.closedU ? '.T.' : '.F.'},.F.,.F.,(${U.m}),(${Vk.m}),(${U.k}),(${Vk.k}),.UNSPECIFIED.)`);
        // [v1.13.1] provato: PCURVE anche sulle B-spline (parametri da proiezione «verticale»): OpenCASCADE proietta gli altri spigoli della
        // stessa faccia (archi) al punto più vicino e i due metodi non coincidono ai vertici → anelli 2D aperti, 28 facce non valide. Solo piani.
        if (r.closedU) sense = r.outward ? '.T.' : '.F.'; else if (r.uvOf && opts.bsplinePcurves) uv = (opts.bsplinePcurves === 'near' && r.uvNear) ? r.uvNear : r.uvOf;
      }
      else if (r.type === 'freeform') { const t = fi.tris[0], n = [M.N[3 * t], M.N[3 * t + 1], M.N[3 * t + 2]]; surf = E(`PLANE('',${place(M.P(M.T[3 * t]), n, perp(n))})`); uv = planeUV(M.P(M.T[3 * t]), n); }
      else if (r.type === 'cylinder') { surf = E(`CYLINDRICAL_SURFACE('',${place(r.origin, r.axis, perp(r.axis))},${stepNum(r.radius)})`); sense = r.outward ? '.T.' : '.F.'; }
      else if (r.type === 'sphere') { surf = E(`SPHERICAL_SURFACE('',${place(r.center, [0, 0, 1], [1, 0, 0])},${stepNum(r.radius)})`); sense = r.outward ? '.T.' : '.F.'; }
      const res = { id: surf, sense, uv }; surfMemo.set(fi, res); return res;
    };
    const curvedRadii = e => M.ET[e].map(t => faceInfo[fid[t]].region).filter(r => r.type === 'cylinder' || r.type === 'sphere').map(r => r.radius);  // (coni gestiti sotto con ctrX/rX)
    const edgeStats = { line: 0, circle: 0, polyline: 0 };
    // [2026-10-21 v1.11.1] due catene con gli stessi estremi (faccia sottile tra due bordi quasi allineati) non devono diventare entrambe LINE:
    // la faccia avrebbe due spigoli coincidenti e area nulla (OpenCASCADE: faccia non valida). Restano polilinee.
    const pairN = new Map(); for (const ch of chains) if (!ch.closed) { const a = ch.verts[0], b = ch.verts[ch.verts.length - 1], k = a < b ? a + ',' + b : b + ',' + a; pairN.set(k, (pairN.get(k) || 0) + 1); }
    const sharedEnds = ch => { const a = ch.verts[0], b = ch.verts[ch.verts.length - 1]; return (pairN.get(a < b ? a + ',' + b : b + ',' + a) || 0) > 1; };
    // [2026-10-21 v1.13.1] CURVE 2D ESPLICITE (PCURVE): una retta 3D tra due punti diventa SURFACE_CURVE con, per ogni faccia vicina che ha
    // parametri noti (piani, B-spline aperte), la retta corrispondente nel piano dei parametri. Così OpenCASCADE non deve ricavarle per
    // approssimazione (causa delle facce valide ma ritagliate male: area diversa dai triangoli, volume −3…−15%).
    let ctx2d = null;
    const lineWithPcurves = (a, b, fs) => {
      const d = sub(b, a), L = len(d), l3 = E(`LINE('',${pt(a)},${E(`VECTOR('',${dir(mul(d, 1 / L))},${stepNum(L)})`)})`);
      if (opts.pcurves === false) return l3;
      const pcs = [];
      for (const fi of fs) {
        const S = surfOf(fi); if (!S.uv) continue;
        const ua = S.uv(a), ub = S.uv(b), du = ub[0] - ua[0], dv = ub[1] - ua[1], l2 = Math.hypot(du, dv); if (!(l2 > 1e-14)) continue;
        if (!ctx2d) ctx2d = E("(GEOMETRIC_REPRESENTATION_CONTEXT(2)PARAMETRIC_REPRESENTATION_CONTEXT()REPRESENTATION_CONTEXT('2D SPACE',''))");
        const l2d = E(`LINE('',${E(`CARTESIAN_POINT('',(${stepNum(ua[0])},${stepNum(ua[1])}))`)},${E(`VECTOR('',${E(`DIRECTION('',(${stepNum(du / l2, 12)},${stepNum(dv / l2, 12)}))`)},${stepNum(l2)})`)})`);
        pcs.push(E(`PCURVE('',${S.id},${E(`DEFINITIONAL_REPRESENTATION('',(${l2d}),${ctx2d})`)})`));
      }
      return pcs.length ? E(`SURFACE_CURVE('',${l3},(${pcs.join(',')}),.CURVE_3D.)`) : l3;
    };
    chains.forEach(ch => {
      // [2026-10-22 v1.13.2] prima: ch.verts.map(v => M.P(v)) (ora posOf: vertici sulla B-spline con opts.bsplineSnap)
      const pts = ch.verts.map(v => posOf(v)), p0 = pts[0], pN = pts[pts.length - 1];
      const v0 = vertexPoint(ch.verts[0]), v1 = vertexPoint(ch.verts[ch.verts.length - 1]);
      let curve = null;
      // retta: tutti i punti entro tolleranza dalla congiungente estremi
      if (!ch.closed) {
        const d = norm(sub(pN, p0));
        let ok = len(sub(pN, p0)) > 0 && !(sharedEnds(ch) && pts.length > 2);   // [v1.11.1] vedi sharedEnds
        for (const p of pts) { const w = sub(p, p0); if (len(sub(w, mul(d, dot(w, d)))) > tol * 0.5) { ok = false; break; } }
        // [2026-10-21 v1.11.2] la retta deve stare anche sulle superfici vicine (prima: LINE di 49 mm accanto a B-spline curve, tolleranza 4,9 mm)
        if (ok) for (const fi of facesOf(ch.edges[0])) for (let k = 1; k < 8 && ok; k++) { const q = add(p0, mul(sub(pN, p0), k / 8)), pq = projOn(fi, q); if (pq && len(sub(pq, q)) > tol) ok = false; }
        if (ok) { curve = lineWithPcurves(p0, pN, facesOf(ch.edges[0])); edgeStats.line++; }   // [v1.13.1] con PCURVE
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
            // [2026-10-21 v1.12.0] provato ≥ 5 punti come SimpleCAD: sul file Plenum una faccia non valida in più → resta ≥ 4
            const supported = uniq.length >= 4 || radii.some(r => Math.abs(r - c.r) <= tol);
            // [v1.1.0 2026-10-06] se la catena borda un cilindro/cono coassiale usa asse e raggio esatti
            // della superficie (spigolo coerente con la faccia, anche dopo lo snap)
            let ctrX = null, rX = null;
            for (const t of M.ET[ch.edges[0]]) {
              const rg = faceInfo[fid[t]].region;
              if ((rg.type === 'cylinder' || rg.type === 'cone') && Math.abs(dot(rg.axis, ax)) > Math.cos(Math.PI / 180)) {
                const o = rg.type === 'cylinder' ? rg.origin : rg.apex, h = dot(sub(pl.origin, o), rg.axis);
                const rr = rg.type === 'cylinder' ? rg.radius : h * Math.tan(rg.alpha);
                if (Math.abs(rr - c.r) <= tol) { ctrX = add(o, mul(rg.axis, h)); rX = rr; }
              }
            }
            // [2026-10-21 v1.11.1] controllo dell'arco: prima bastavano 4 punti complanari entro tol da un cerchio. Sui bordi delle superfici libere
            // nascevano cerchi falsi: anelli sottili "andata e ritorno" presi per cerchi interi (R 77 mm per un anello lungo 3,9 mm) e archi percorsi
            // nel verso sbagliato; OpenCASCADE allargava la tolleranza dello spigolo fino a decine di mm e la faccia non era valida.
            // Ora: angoli crescenti lungo la catena (passo < 90°), giro completo ≈ 360° per le catene chiuse e, se nessuna faccia vicina è un
            // cilindro/sfera/cono dello stesso raggio, freccia di ogni corda ≤ tol (la polilinea segue davvero l'arco).
            let arcOK = false;
            {
              const az = ax, ux = perp(az), wx = cross(az, ux), cc0 = ctrX || ctr, rr0 = rX || c.r;
              const th = pts.map(p => { const d = sub(p, cc0); return Math.atan2(dot(d, wx), dot(d, ux)); });
              let sw = 0, sgn = 0, okA = true, dmax = 0;
              for (let i = 0; i + 1 < th.length; i++) {
                let dt = th[i + 1] - th[i]; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
                if (Math.abs(dt) < 1e-12) continue;
                const sg = Math.sign(dt); if (sgn && sg !== sgn) { okA = false; break; } sgn = sg;
                sw += dt; dmax = Math.max(dmax, Math.abs(dt));
              }
              if (okA && dmax < Math.PI / 2) {
                const strong = !!ctrX || radii.some(r => Math.abs(r - c.r) <= tol);
                const sagOK = strong || rr0 * (1 - Math.cos(dmax / 2)) <= tol;
                arcOK = sagOK && (ch.closed ? Math.abs(Math.abs(sw) - 2 * Math.PI) < 0.1 : Math.abs(sw) < 2 * Math.PI - 1e-3);
              }
            }
            if (err <= tol && supported && arcOK) {
              // verso antiorario rispetto all'asse = verso di percorrenza della catena
              let turn = 0; for (let i = 0; i + 1 < pts.length; i++) turn += dot(cross(sub(pts[i], ctr), sub(pts[i + 1], ctr)), ax);
              const zax = turn >= 0 ? ax : mul(ax, -1);
              const cc = ctrX || ctr, rr = rX || c.r;
              let xref = sub(p0, cc); xref = norm(sub(xref, mul(zax, dot(xref, zax))));
              curve = E(`CIRCLE('',${place(cc, zax, xref)},${stepNum(rr)})`); edgeStats.circle++;
              // [2026-10-06] versione precedente:
              // const xref = norm(sub(p0, ctr));
              // curve = E(`CIRCLE('',${place(ctr, zax, xref)},${stepNum(c.r)})`); edgeStats.circle++;
            }
          }
        }
      }
      // fallback: polilinea come B-spline lineare
      if (!curve) {
        // [2026-10-21 v1.11.2] polilinea portata sulle superfici vicine: segmenti lunghi suddivisi (≤ diag/150, max 32 pezzi) e punti interni
        // spostati sul bordo tra le due facce (`between`); gli estremi restano (condivisi con le altre catene). Se una faccia vicina è
        // sfaccettata (triangoli) la polilinea resta quella della mesh. prima: pts usati così com'erano
        let P = pts;
        const fs = facesOf(ch.edges[0]);
        // Si suddividono solo i segmenti la cui corda si stacca da una faccia vicina di oltre tol/2 (triangoli lunghi su superfici curve):
        // suddividere tutto accanto alle B-spline cambiava il volume letto da OpenCASCADE (vase +0,5%, scoop −2%).
        // Lo spostamento sul bordo (`between`) solo tra superfici analitiche: accanto a una B-spline peggiorava (Plenum: 25 facce non valide contro 4).
        if (fs.length <= 2 && fs.every(fi => projOn(fi, p0)) && !fs.some(fi => fi.region.closedU)) {   // B-spline chiuse escluse (vase: volume +0,5%)
          const hmax = Math.max(M.diag / 150, 4 * tol), dev = q => Math.max(...fs.map(fi => len(sub(projOn(fi, q) || q, q))));
          P = [pts[0]];
          for (let i = 0; i + 1 < pts.length; i++) {
            const L = len(sub(pts[i + 1], pts[i])), mid = mul(add(pts[i], pts[i + 1]), 0.5);
            const k = dev(mid) > 0.5 * tol ? Math.min(32, Math.max(1, Math.ceil(L / hmax))) : 1;
            for (let j = 1; j <= k; j++) P.push(add(pts[i], mul(sub(pts[i + 1], pts[i]), j / k)));
          }
          if (!fs.some(fi => fi.region.type === 'bspline')) P = P.map((p, i) => (i === 0 || i === P.length - 1) ? p : between(fs, p));
        }
        // [2026-10-21 v1.13.1] CAUSA DELLE FACCE «RITAGLIATE MALE»: una polilinea lunga come B-spline di grado 1 costringe il lettore STEP a
        // ricavare la curva 2D sulla faccia (pcurve) per approssimazione, che smussa gli angoli: sul file Plenum un piano con bordo 3D di
        // 1 199,9 mm² diventava una faccia di 1 427,9 mm² (volume −15%). Ora la polilinea diventa una catena di spigoli rettilinei (LINE),
        // con vertici intermedi condivisi dalle due facce: la proiezione di una retta è esatta. Prima: un solo EDGE_CURVE su B_SPLINE_CURVE
        // di grado 1 (resta per le catene di 2 punti, che sono già una retta, e se opts.polylineEdges === true).
        // Solo se una faccia vicina è un piano (lì l'errore della pcurve era grande e la PCURVE esplicita è esatta): tra due superfici curve
        // le tante rette corte facevano proiettare a OpenCASCADE anelli 2D non chiusi (scoop: 6 facce B-spline non valide) → resta la polilinea.
        /* [2026-10-22 v1.13.1] variante provata e scartata: suddividere anche se i segmenti sono lunghi (media > diag/50 o diag/200).
           Plenum validato 2 984 facce invece di 3 034, ma scoop.step diventava non valido (facce B-spline NotClosed).
        let Ltot = 0; for (let i = 0; i + 1 < P.length; i++) Ltot += len(sub(P[i + 1], P[i]));
        const longSegs = Ltot / Math.max(1, P.length - 1) > M.diag / 50;
        if (opts.polylineEdges !== true && P.length > 2 && (planeSide || longSegs)) { */
        const planeSide = fs.some(fi => fi.faceted || fi.region.type === 'plane' || fi.region.type === 'freeform');
        if (opts.polylineEdges !== true && P.length > 2 && planeSide) {
          // [2026-10-22 v1.13.1] punti intermedi più vicini di tol/4 al precedente (o all'ultimo) tolti: un segmento di ~0,002 mm diventava per
          // OpenCASCADE uno spigolo chiuso su un solo vertice (Plenum a tolleranza 0,02: anello aperto, ultima faccia non valida)
          { const dmin = 0.25 * tol, Q = [P[0]];
            for (let i = 1; i < P.length - 1; i++) if (len(sub(P[i], Q[Q.length - 1])) > dmin && len(sub(P[i], P[P.length - 1])) > dmin) Q.push(P[i]);
            Q.push(P[P.length - 1]); P = Q; }
        }
        if (opts.polylineEdges !== true && P.length > 2 && planeSide) {
          const vs = P.map((p, i) => i === 0 ? v0 : i === P.length - 1 ? v1 : E(`VERTEX_POINT('',${pt(p)})`));
          ch.steps = [];
          for (let i = 0; i + 1 < P.length; i++) {
            const d = sub(P[i + 1], P[i]), L = len(d); if (L < 1e-12) continue;
            ch.steps.push(E(`EDGE_CURVE('',${vs[i]},${vs[i + 1]},${lineWithPcurves(P[i], P[i + 1], fs)},.T.)`));
          }
          edgeStats.polyline++;
          return;
        }
        const n = P.length, mult = Array(n).fill(1); mult[0] = mult[n - 1] = 2;
        curve = E(`B_SPLINE_CURVE_WITH_KNOTS('',1,(${P.map(pt).join(',')}),.POLYLINE_FORM.,.F.,.F.,(${mult.join(',')}),(${[...Array(n).keys()].map(i => stepNum(i)).join(',')}),.UNSPECIFIED.)`);
        edgeStats.polyline++;
      }
      ch.step = E(`EDGE_CURVE('',${v0},${v1},${curve},.T.)`);
    });

    // --- facce: superficie + anelli di bordo ---
    const solidsByComp = new Map();
    faceInfo.forEach((fi, f) => {
      const r = fi.region, tset = new Set(fi.tris);
      // semi-spigoli di bordo orientati come i triangoli (CCW visto da fuori)
      const half = new Map();   // vertice di partenza -> lista [a,b,e,t,k]
      const isB = (t, k) => { const e = M.triEdge[3 * t + k]; return isTopo[e] && !(M.ET[e].length === 2 && M.ET[e].every(x => tset.has(x))); };
      for (const t of fi.tris) for (let k = 0; k < 3; k++) {
        if (!isB(t, k)) continue;
        const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3];
        if (!half.has(a)) half.set(a, []); half.get(a).push([a, b, M.triEdge[3 * t + k], t, k]);
      }
      /* [2026-10-21 v1.11.1] versione precedente: il successore era un qualsiasi semi-spigolo libero che parte da b. In un vertice "a farfalla"
         (la faccia tocca se stessa in un punto: frequente nelle patch B-spline fatte di più regioni) due anelli si scambiavano pezzi e
         nascevano anelli incrociati o aperti (OpenCASCADE: SelfIntersectingWire / NotClosed / InvalidImbricationOfWires).
      const used = new Set(), loops = [];
      for (const [, list] of half) for (const h0 of list) {
        if (used.has(h0)) continue;
        const loop = []; let h = h0;
        while (h && !used.has(h)) { used.add(h); loop.push(h); h = (half.get(h[1]) || []).find(x => !used.has(x)); }
        loops.push(loop);
      }
      */
      // Successore canonico: si gira attorno a b dentro la faccia (triangolo per triangolo attraverso gli spigoli interni) fino al primo
      // spigolo di bordo che parte da b: è il bordo che segue davvero, anche quando in b partono più semi-spigoli di bordo.
      const succ = h => {
        let cur = h[3], j = h[4];
        for (let g = 0; g < 256; g++) {
          const jn = (j + 1) % 3;
          if (isB(cur, jn)) { const a2 = M.T[3 * cur + jn]; return (half.get(a2) || []).find(x => x[3] === cur && x[4] === jn) || null; }
          const u = M.nb[3 * cur + jn]; if (u < 0 || !tset.has(u)) return null;
          const c = M.T[3 * cur + (jn + 1) % 3], b2 = M.T[3 * cur + jn];
          let m = -1; for (let q = 0; q < 3; q++) if (M.T[3 * u + q] === c && M.T[3 * u + (q + 1) % 3] === b2) m = q;
          if (m < 0) return null;
          cur = u; j = m;
        }
        return null;
      };
      const used = new Set(), loops = [];
      for (const [, list] of half) for (const h0 of list) {
        if (used.has(h0)) continue;
        const loop = []; let h = h0;
        while (h && !used.has(h)) { used.add(h); loop.push(h); h = succ(h) || (half.get(h[1]) || []).find(x => !used.has(x)); }
        loops.push(loop);
      }
      const bounds = loops.map(loop => {
        // ruota l'anello per iniziare all'inizio di una catena
        const startsChain = ([a, , e]) => { const ch = chains[chainOf[e]]; const i = ch.edges.indexOf(e); return (ch.verts[i] === a && i === 0) || (ch.verts[i] !== a && i === ch.edges.length - 1); };
        const s = loop.findIndex(startsChain); const L = s > 0 ? loop.slice(s).concat(loop.slice(0, s)) : loop;
        const oe = [];
        for (let i = 0; i < L.length;) {
          const [a, , e] = L[i], ch = chains[chainOf[e]], j = ch.edges.indexOf(e), fwd = ch.verts[j] === a;
          // [v1.13.1] catena spezzata in rette: gli spigoli in ordine (o al contrario se la catena è percorsa all'indietro)
          if (ch.steps) for (const st of (fwd ? ch.steps : ch.steps.slice().reverse())) oe.push(E(`ORIENTED_EDGE('',*,*,${st},${fwd ? '.T.' : '.F.'})`));
          else oe.push(E(`ORIENTED_EDGE('',*,*,${ch.step},${fwd ? '.T.' : '.F.'})`));
          i += ch.edges.length;
        }
        // area proiettata (per scegliere il bordo esterno delle facce piane)
        // [2026-10-21 v1.11.0] prima: solo r.type === 'plane'; le B-spline aperte usano la stessa area proiettata lungo la loro normale
        const useAr = r.type === 'plane' || (r.type === 'bspline' && r.normal && !r.closedU) || (fi.faceted && fi.tris.length > 1);
        const arN = fi.faceted ? [M.N[3 * fi.rep], M.N[3 * fi.rep + 1], M.N[3 * fi.rep + 2]] : r.normal;   // [v1.13.0] facce sfaccettate di più triangoli
        let ar = 0; if (useAr) for (const [a, b] of L) ar += dot(cross(M.P(a), M.P(b)), arN);
        let per = 0; for (const [a, b] of L) per += len(sub(M.P(b), M.P(a)));   // [2026-10-21 v1.11.0] perimetro (per scegliere il bordo esterno delle facce non piane)
        return { loop: E(`EDGE_LOOP('',(${oe.join(',')}))`), ar, per };
      });
      // [2026-10-21 v1.11.0] prima: solo i piani avevano un FACE_OUTER_BOUND; le altre facce con più anelli (B-spline, cilindri… con fori) li avevano tutti
      // come FACE_BOUND e OpenCASCADE poteva prendere come esterno quello sbagliato. Ora per le non piane l'esterno è l'anello più lungo.
      let outer = -1; if ((r.type === 'plane' || (r.type === 'bspline' && r.normal && !r.closedU) || (fi.faceted && fi.tris.length > 1)) && bounds.length) outer = bounds.reduce((bi, b, i) => (b.ar > bounds[bi].ar ? i : bi), 0);
      else if (bounds.length > 1) outer = bounds.reduce((bi, b, i) => (b.per > bounds[bi].per ? i : bi), 0);
      const fb = bounds.map((b, i) => E(`${i === outer ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${b.loop},.T.)`));
      // [2026-10-21 v1.13.1] superficie creata da surfOf (anche le PCURVE dei bordi la richiamano); prima il codice era qui
      let fname = ''; const SF = surfOf(fi), surf = SF.id, sense = SF.sense;
      if (fi.faceted && r.type === 'thread') fname = 'THREAD ' + r.label;
      if (!fi.faceted && r.type === 'cylinder') fname = r.threadLabel ? 'THREAD ' + r.threadLabel : (r.outward ? 'SHAFT D' : 'HOLE D') + (2 * r.radius).toFixed(3);
      const af = E(`ADVANCED_FACE(${stepStr(fname)},(${fb.join(',')}),${surf},${sense})`);
      // [2026-10-06] versione precedente: const af = E(`ADVANCED_FACE('',(${fb.join(',')}),${surf},${sense})`);
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
      // [v1.1.0] nome corpo: scelto dall'utente > nome da 3MF/OBJ > BodyN
      const bname = (bodies[c] && bodies[c].name) || (M.compNames && M.compNames[c]) || ((closedComp[c] ? 'Body' : 'Surface') + bi);
      if (closedComp[c]) items.push(E(`MANIFOLD_SOLID_BREP(${stepStr(bname)},${E(`CLOSED_SHELL('',(${faces.join(',')}))`)})`));
      else surfItems.push(E(`SHELL_BASED_SURFACE_MODEL(${stepStr(bname)},(${E(`OPEN_SHELL('',(${faces.join(',')}))`)}))`));
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

  // ============ 6. [v1.4.0 2026-10-07] REPORT PDF CON DISEGNO QUOTATO DEI FORI ============
  // PDF 1.4 minimale scritto a mano (nessuna libreria): vista lungo l'asse dei fori più frequente (contorno = inviluppo
  // convesso della proiezione della mesh), fori numerati (continuo = passante, tratteggio = cieco), quote d'ingombro e
  // tabelle fori / filettature / alberi. Coordinate dei fori dall'angolo in basso a sinistra della vista.
  // o: { name, L: {testi}, num: x => stringa }  (i testi arrivano dal dizionario IT/EN dell'app)
  function reportPdf(M, seg, o) {
    const L = o.L, num = o.num || ((x, d = 2) => x.toFixed(d)), f = features(M, seg), holes = f.holes;
    // --- asse di vista: quello del gruppo di fori più numeroso (altrimenti Z) ---
    const dom = a => { const i = [0, 1, 2].reduce((b, k) => (Math.abs(a[k]) > Math.abs(a[b]) ? k : b), 0); return a[i] < 0 ? mul(a, -1) : a; };
    let a = [0, 0, 1];
    if (holes.length) {
      const groups = [];
      for (const h of holes) { const ha = dom(h.axis); let g = groups.find(g => Math.abs(dot(g.a, ha)) > Math.cos(Math.PI / 180)); if (!g) groups.push(g = { a: ha, n: 0 }); g.n++; }
      a = groups.sort((x, y) => y.n - x.n)[0].a;
    }
    const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], wi = AX.findIndex(w => Math.abs(dot(w, a)) > 0.9998);
    let u, v;
    if (wi >= 0) { a = AX[wi]; u = AX[(wi + 1) % 3]; v = AX[(wi + 2) % 3]; } else { u = norm(perp(a)); v = cross(a, u); }
    // --- proiezione + inviluppo convesso (monotone chain) ---
    const pts2 = []; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < M.nV; i++) { const p = [M.V[3 * i], M.V[3 * i + 1], M.V[3 * i + 2]], x = dot(p, u), y = dot(p, v); pts2.push([x, y]); u0 = Math.min(u0, x); u1 = Math.max(u1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y); }
    pts2.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cr = (o2, p, q) => (p[0] - o2[0]) * (q[1] - o2[1]) - (p[1] - o2[1]) * (q[0] - o2[0]);
    const lower = [], upper = [];
    for (const p of pts2) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts2.length - 1; i >= 0; i--) { const p = pts2[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const W = Math.max(u1 - u0, 1e-9), H = Math.max(v1 - v0, 1e-9);
    // --- scrittore di contenuto (coordinate "dall'alto" ty, convertite in coordinate PDF) ---
    const c = [], PH = 841.89, Y = ty => (PH - ty).toFixed(2), X = x => x.toFixed(2);
    const clean = t => String(t).replace(/[—–]/g, '-').replace(/[^\x20-\xff]/g, '?').replace(/([\\()])/g, '\\$1');
    const text = (x, ty, t, size = 9, bold = false) => c.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${X(x)} ${Y(ty)} Td (${clean(t)}) Tj ET`);
    const textV = (x, ty, t, size = 8) => c.push(`BT /F1 ${size} Tf 0 1 -1 0 ${X(x)} ${Y(ty)} Tm (${clean(t)}) Tj ET`);
    const line = (x1, y1, x2, y2) => c.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`);
    const circle = (cx, cy, r) => { const k = 0.5523 * r; c.push(`${X(cx + r)} ${Y(cy)} m ${X(cx + r)} ${Y(cy - k)} ${X(cx + k)} ${Y(cy - r)} ${X(cx)} ${Y(cy - r)} c ${X(cx - k)} ${Y(cy - r)} ${X(cx - r)} ${Y(cy - k)} ${X(cx - r)} ${Y(cy)} c ${X(cx - r)} ${Y(cy + k)} ${X(cx - k)} ${Y(cy + r)} ${X(cx)} ${Y(cy + r)} c ${X(cx + k)} ${Y(cy + r)} ${X(cx + r)} ${Y(cy + k)} ${X(cx + r)} ${Y(cy)} c S`); };
    text(40, 52, 'Mesh2STEP — ' + L.title, 16, true);
    text(40, 70, `${L.file}: ${o.name}`, 10);
    text(40, 84, `${L.size}: ${num(W, 2)} × ${num(H, 2)} mm (${L.view} ${['X', 'Y', 'Z'][wi >= 0 ? wi : 2]}${wi >= 0 ? '' : '*'})`, 10);
    // --- disegno ---
    const bx = 76, bw = 443, bt = 125, bh = 275, sc = Math.min(bw / W, bh / H), ox = bx + (bw - W * sc) / 2, bot = bt + bh - (bh - H * sc) / 2;
    const P = (x, y) => [ox + (x - u0) * sc, bot - (y - v0) * sc];
    c.push('0.8 w 0.15 G');
    hull.forEach((p, i) => { const q = hull[(i + 1) % hull.length], A = P(p[0], p[1]), B = P(q[0], q[1]); line(A[0], A[1], B[0], B[1]); });
    const inView = holes.filter(h => Math.abs(dot(h.axis, a)) > Math.cos(Math.PI / 180));
    inView.forEach((h, i) => {
      h.n = i + 1; const q = P(dot(h.origin, u), dot(h.origin, v)), r = Math.max(h.diameter / 2 * sc, 1.2);
      c.push(h.through ? '[] 0 d' : '[3 2] 0 d'); circle(q[0], q[1], r); c.push('[] 0 d');
      line(q[0] - r - 3, q[1], q[0] + r + 3, q[1]); line(q[0], q[1] - r - 3, q[0], q[1] + r + 3);
      text(q[0] + r * 0.72 + 2, q[1] - r * 0.72 - 2, String(h.n), 8, true);
    });
    // quote d'ingombro
    c.push('0.4 w 0.4 G');
    const xb = ox + W * sc, yb = bot + 16; line(ox, yb, xb, yb); line(ox, yb - 4, ox, yb + 4); line(xb, yb - 4, xb, yb + 4);
    text((ox + xb) / 2 - 18, yb + 11, num(W, 2) + ' mm', 8);
    const xl = ox - 16, yt = bot - H * sc; line(xl, yt, xl, bot); line(xl - 4, yt, xl + 4, yt); line(xl - 4, bot, xl + 4, bot);
    textV(xl - 3, (yt + bot) / 2 + 18, num(H, 2) + ' mm');
    // --- tabelle ---
    let ty = 440; const rowH = 12, maxTy = 800;
    const heading = t => { ty += 8; text(40, ty, t, 10, true); ty += 4; c.push('0.4 w 0.4 G'); line(40, ty, 555, ty); ty += rowH - 2; };
    const row = (cols, xs, bold = false) => { if (ty > maxTy) return false; cols.forEach((t, i) => text(xs[i], ty, t, 8.5, bold)); ty += rowH; return true; };
    heading(L.holes);
    const hx = [40, 70, 130, 200, 250, 320, 390];
    row(['#', 'Ø mm', L.type, L.depth, 'X mm', 'Y mm', L.axis], hx, true);
    let more = 0;
    for (const h of holes) {
      const inV = h.n != null, X0 = inV ? dot(h.origin, u) - u0 : null, Y0 = inV ? dot(h.origin, v) - v0 : null;
      if (!row([inV ? String(h.n) : '–', num(h.diameter, 2), h.through ? L.through : L.blind, num(h.depth, 2), inV ? num(X0, 2) : '–', inV ? num(Y0, 2) : '–', h.axis.map(x => num(x, 3)).join(' ; ')], hx)) more++;
    }
    if (!holes.length) row([L.none], [40]);
    if (more) { text(40, ty, `… (+${more})`, 8.5); ty += rowH; }
    const th = seg.regions.filter(r => r.type === 'thread');
    if (th.length) {
      heading(L.threads); const tx = [40, 150, 220, 290, 360];
      row([L.thread, L.pitch, L.len, L.hand, ''], tx, true);
      for (const r of th) row([r.label + ' ' + (r.internal ? L.internal : L.external), num(r.pitch, 2), num(r.length, 1), r.hand === 'R' ? L.right : L.left, ''], tx);
    }
    const sh = new Map(); for (const r of seg.regions) if (r.type === 'cylinder' && r.outward) { const k = (2 * r.radius).toFixed(2); sh.set(k, (sh.get(k) || 0) + 1); }
    if (sh.size) { heading(L.shafts); const sx = [40, 110]; row(['Ø mm', L.count], sx, true); for (const [d, n] of [...sh].sort((p, q) => p[0] - q[0])) row([num(+d, 2), String(n)], sx); }
    text(40, 826, `Mesh2STEP ${VERSION} — ${L.footer}`, 8);
    // --- assemblaggio PDF ---
    const stream = c.join('\n'), objs = [null,
      '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    let out = '%PDF-1.4\n'; const offs = [];
    for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xr = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return { bytes, holes: holes.length, inView: inView.length };
  }

  // ======================== Pipeline completa ========================
  // ============================ 6. PORT DI SIMPLECAD (MIT) ============================
  // [v1.12.0 2026-10-21] Traduzione in JavaScript dell'adattatore di superfici di SimpleCAD
  // (https://github.com/igsova/SimpleCAD, simplecad/surfaces/fit.py, release 0.38.0, commit 9180c4b).
  // Copyright (c) 2026 SimpleCAD contributors — licenza MIT:
  //   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
  //   (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
  //   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
  //   subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or
  //   substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
  // Metodo: regioni lisce tra spigoli vivi (≥ 30°) → un cilindro se segue tutta la regione → altrimenti parti che guardano la propria normale
  // media entro 60° → per ognuna un piano (vertici entro tol/4) o un campo di altezze B-spline cubico con nodi raffittiti dove serve,
  // controllato su vertici (tol/2, bordo tol/4) e su campioni lungo spigoli e dentro i triangoli (tol, bordo tol/2) → se non basta la patch
  // si divide (pieghe più forti, poi direzione delle facce, poi a metà) fino al singolo triangolo piano. Poi «tidy» (triangoli isolati alla
  // patch che li circonda) e «settle_slivers» (triangoli degeneri alla patch oltre il lato lungo).
  // Differenze dal Python: algebra densa al posto di scipy.sparse (MAX_SPANS 12 invece di 48), niente raffinamento ai minimi quadrati non
  // lineari dell'asse del cilindro, «borrow normals» senza la coda di priorità finale.
  const SC = { SHARP: 30, TILT: 60, SPANS: 12, PATCHES: 2000, BISECT: 10 };
  function scBasis(knots, x) {   // B-spline cubica a nodi qualsiasi (bloccata): indice di span e 4 pesi (de Boor)
    const p = 3, n = knots.length - p - 1;
    x = Math.min(Math.max(x, knots[p]), knots[n]);
    let k = p; while (k < n - 1 && x >= knots[k + 1]) k++;
    const N = [1, 0, 0, 0], left = [0, 0, 0, 0], right = [0, 0, 0, 0];
    for (let j = 1; j <= p; j++) {
      left[j] = x - knots[k + 1 - j]; right[j] = knots[k + j] - x; let saved = 0;
      for (let r = 0; r < j; r++) { const den = right[r + 1] + left[j - r], tmp = den !== 0 ? N[r] / den : 0; N[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp; }
      N[j] = saved;
    }
    return { k: k - p, w: N };   // pesi per i punti di controllo k-p … k
  }
  const scClamp = br => [br[0], br[0], br[0], ...br, br[br.length - 1], br[br.length - 1], br[br.length - 1]];
  function scFacets(M) {
    const nT = M.nT, Nv = new Float64Array(M.N), areas = new Float64Array(nT), sliver = new Uint8Array(nT);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < M.nV; v++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], M.V[3 * v + k]); mx[k] = Math.max(mx[k], M.V[3 * v + k]); }
    const extent = len(sub(mx, mn)) || 1, longestK = new Int8Array(nT);
    for (let t = 0; t < nT; t++) {
      const a = M.P(M.T[3 * t]), b = M.P(M.T[3 * t + 1]), c = M.P(M.T[3 * t + 2]), L = [len(sub(b, a)), len(sub(c, b)), len(sub(a, c))];
      const lo = Math.max(...L); longestK[t] = L.indexOf(lo);
      sliver[t] = 2 * M.A[t] < Math.max(1e-3 * lo, 1e-4 * extent) * lo ? 1 : 0; areas[t] = sliver[t] ? 0 : M.A[t];
    }
    // normali prese in prestito: una scheggia prende la normale del primo triangolo vero oltre il suo lato lungo
    for (let t = 0; t < nT; t++) if (sliver[t]) {
      let u = t; for (let g = 0; g < 64 && sliver[u]; g++) { const w = M.nb[3 * u + longestK[u]]; if (w < 0 || w === t) break; u = w; }
      if (!sliver[u]) for (let k = 0; k < 3; k++) Nv[3 * t + k] = Nv[3 * u + k];
    }
    const nrm = t => [Nv[3 * t], Nv[3 * t + 1], Nv[3 * t + 2]];
    const dih = new Float64Array(nT * 3).fill(180);   // per semi-spigolo (t, k): diedro col vicino
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const u = M.nb[3 * t + k]; if (u >= 0) dih[3 * t + k] = Math.acos(Math.max(-1, Math.min(1, dot(nrm(t), nrm(u))))) * 180 / Math.PI; }
    return { M, nT, Nv, nrm, areas, sliver, extent, dih, crease: k3 => dih[k3] >= SC.SHARP || M.nb[k3] < 0 };
  }
  const scVerts = (F, tris) => { const s = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) s.add(F.M.T[3 * t + k]); return [...s]; };
  const scMeanN = (F, tris) => { let m = [0, 0, 0]; for (const t of tris) m = add(m, mul(F.nrm(t), F.areas[t] + 1e-12)); const l = len(m); return l > 1e-300 ? mul(m, 1 / l) : null; };
  function scComponents(F, tris, same) {   // parti connesse di `tris` (same(t,u) = stesso gruppo)
    const inS = new Map(tris.map((t, i) => [t, i])), seen = new Uint8Array(tris.length), out = [];
    for (let i = 0; i < tris.length; i++) {
      if (seen[i]) continue; const comp = [tris[i]]; seen[i] = 1;
      for (let q = 0; q < comp.length; q++) for (let k = 0; k < 3; k++) { const t = comp[q], u = F.M.nb[3 * t + k]; if (u < 0) continue; const j = inS.get(u); if (j === undefined || seen[j] || !same(t, u, k)) continue; seen[j] = 1; comp.push(u); }
      out.push(comp);
    }
    return out;
  }
  function scClusters(F, tris, k) {   // k-means sferico con semi lontani (deterministico)
    const N = tris.map(t => F.nrm(t)), W = tris.map(t => F.areas[t] + 1e-12);
    let best = 0; for (let i = 1; i < W.length; i++) if (W[i] > W[best]) best = i;
    let C = [N[best]];
    while (C.length < k) { let j = 0, low = Infinity; for (let i = 0; i < N.length; i++) { const near = Math.max(...C.map(c => dot(N[i], c))); if (near < low) { low = near; j = i; } } C.push(N[j]); }
    let lab = new Int32Array(N.length);
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < N.length; i++) { let b = 0, bv = -Infinity; for (let c = 0; c < C.length; c++) { const v = dot(N[i], C[c]); if (v > bv) { bv = v; b = c; } } lab[i] = b; }
      const S = C.map(() => [0, 0, 0]); for (let i = 0; i < N.length; i++) S[lab[i]] = add(S[lab[i]], mul(N[i], W[i]));
      let moved = false; const C2 = S.map((s, c) => { const l = len(s); if (l < 1e-300) return C[c]; const n = mul(s, 1 / l); if (len(sub(n, C[c])) > 1e-9) moved = true; return n; });
      C = C2; if (!moved) break;
    }
    return lab;
  }
  function scTilted(F, tris) {   // divide finché ogni parte guarda la propria normale media entro 60°
    const cosL = Math.cos(SC.TILT * Math.PI / 180);
    let lab = new Int32Array(tris.length);
    for (let k = 1; k <= 32; k++) {
      if (k > 1) lab = scClusters(F, tris, k);
      let worst = 1;
      for (let c = 0; c < k; c++) { const sel = tris.filter((_, i) => lab[i] === c); if (!sel.length) continue; const m = scMeanN(F, sel); if (!m) continue; for (const t of sel) worst = Math.min(worst, dot(F.nrm(t), m)); }
      if (worst >= cosL) break;
    }
    const L = new Map(tris.map((t, i) => [t, lab[i]]));
    return scAbsorb(F, scComponents(F, tris, (t, u) => L.get(t) === L.get(u)));
  }
  function scAbsorb(F, parts) {   // frammenti piccoli uniti alla parte vicina con più spigoli in comune (se resta entro 60°)
    if (parts.length < 2) return parts;
    const cosL = Math.cos(SC.TILT * Math.PI / 180), lab = new Map(); parts.forEach((p, i) => p.forEach(t => lab.set(t, i)));
    const total = parts.reduce((s, p) => s + p.length, 0), order = [...parts.keys()].sort((a, b) => parts[a].length - parts[b].length);
    for (const i of order) {
      const part = parts[i]; if (part.length > Math.max(8, Math.floor(total / 50))) break;
      const cnt = new Map(); for (const t of part) for (let k = 0; k < 3; k++) { const u = F.M.nb[3 * t + k]; if (u < 0) continue; const j = lab.get(u); if (j === undefined || j === i) continue; cnt.set(j, (cnt.get(j) || 0) + 1); }
      for (const [j] of [...cnt].sort((a, b) => b[1] - a[1])) {
        const joined = parts[j].concat(part), m = scMeanN(F, joined); if (!m) continue;
        if (joined.every(t => dot(F.nrm(t), m) >= cosL)) { parts[j] = joined; parts[i] = []; for (const t of part) lab.set(t, j); break; }
      }
    }
    return parts.filter(p => p.length);
  }
  function scRegions(F) { return scComponents(F, [...Array(F.nT).keys()], (t, u, k) => F.dih[3 * t + k] < SC.SHARP); }
  function scPlane(pts) { const pl = fitPlane(pts); return pl; }
  // campioni sui triangoli: lungo gli spigoli (passo `spacing`, metà sul bordo) e centroidi dei triangoli bisecati finché i lati ≤ passo locale
  function scSamples(F, tris, spacing, boundary, localSp) {
    const M = F.M, out = [], onB = [], seenE = new Set();
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const a = M.T[3 * t + k], b = M.T[3 * t + (k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; if (seenE.has(key)) continue; seenE.add(key);
      const pa = M.P(a), pb = M.P(b), bd = boundary.has(a) && boundary.has(b), step = bd ? spacing / 2 : spacing, n = Math.min(512, Math.max(1, Math.ceil(len(sub(pb, pa)) / step)));
      for (let i = 0; i < n; i++) { out.push(add(pa, mul(sub(pb, pa), (i + 0.5) / n))); onB.push(bd); }
    }
    tris.forEach((t, ti) => {
      let stack = [[M.P(M.T[3 * t]), M.P(M.T[3 * t + 1]), M.P(M.T[3 * t + 2]), 0]]; const sp = localSp[ti];
      while (stack.length) {
        const [a, b, c, d] = stack.pop(), L = [len(sub(b, a)), len(sub(c, b)), len(sub(a, c))], lo = Math.max(...L);
        if (lo <= sp || d >= SC.BISECT) { out.push(mul(add(add(a, b), c), 1 / 3)); onB.push(false); continue; }
        const r = L.indexOf(lo), P3 = [a, b, c], p0 = P3[r], p1 = P3[(r + 1) % 3], p2 = P3[(r + 2) % 3], m = mul(add(p0, p1), 0.5);
        stack.push([p0, m, p2, d + 1], [m, p1, p2, d + 1]);
      }
    });
    return { pts: out, onB };
  }
  function scField(origin, e1, e2, e3, ub, vb, H) {   // campo di altezze B-spline: origin + s e1 + t e2 + h(s,t) e3
    const uk = scClamp(ub), vk = scClamp(vb), nu = ub.length + 2, nv = vb.length + 2;
    const h = (s, t) => { const U = scBasis(uk, s), V = scBasis(vk, t); let z = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) z += U.w[i] * V.w[j] * H[(U.k + i) * nv + V.k + j]; return z; };
    const local = p => { const d = sub(p, origin); return [dot(d, e1), dot(d, e2), dot(d, e3)]; };
    const greville = (k, n) => [...Array(n).keys()].map(i => (k[i + 1] + k[i + 2] + k[i + 3]) / 3);
    const gu = greville(uk, nu), gv = greville(vk, nv);
    const cp = gu.map((u, i) => gv.map((v, j) => add(origin, add(add(mul(e1, u), mul(e2, v)), mul(e3, H[i * nv + j])))));
    return { kind: 'bspline', origin, e1, e2, e3, ub, vb, uk, vk, nu, nv, H, h, local, cp,
      dist: p => { const [s, t, z] = local(p); return Math.abs(h(s, t) - z); },
      proj: p => { const [s, t] = local(p); return add(origin, add(add(mul(e1, s), mul(e2, t)), mul(e3, h(s, t)))); }, uvOf: p => local(p).slice(0, 2) };
  }
  function scFit(F, tris0, tol, planeTol, around) {
    const M = F.M; let tris = tris0.filter(t => !F.sliver[t]); if (!tris.length) tris = tris0;
    const verts = scVerts(F, tris); if (verts.length < 3) return null;
    const pts = verts.map(v => M.P(v)), pl = scPlane(pts), axis = scMeanN(F, tris); if (!axis) return null;
    if (pl.maxErr <= (planeTol == null ? tol / 4 : planeTol)) return { kind: 'plane', origin: pl.origin, normal: dot(pl.normal, axis) >= 0 ? pl.normal : mul(pl.normal, -1), error: pl.maxErr };
    if (tris.length < 2 || tris.some(t => dot(F.nrm(t), axis) < Math.cos((SC.TILT + 15) * Math.PI / 180))) return null;
    // asse principale nel piano ⟂ alla normale media
    const c0 = pl.origin; let S = [0, 0, 0, 0, 0, 0];
    for (const p of pts) { let d = sub(p, c0); d = sub(d, mul(axis, dot(d, axis))); S[0] += d[0] * d[0]; S[1] += d[0] * d[1]; S[2] += d[0] * d[2]; S[3] += d[1] * d[1]; S[4] += d[1] * d[2]; S[5] += d[2] * d[2]; }
    let e1 = eigSym3(S)[2].vec; e1 = sub(e1, mul(axis, dot(e1, axis))); if (len(e1) < 1e-12) e1 = perp(axis); e1 = norm(e1); const e2 = cross(axis, e1);
    const loc = p => { const d = sub(p, c0); return [dot(d, e1), dot(d, e2), dot(d, axis)]; };
    // la proiezione deve conservare l'orientamento di ogni triangolo
    const st2 = t => [0, 1, 2].map(k => loc(M.P(M.T[3 * t + k])));
    const signed = c => (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]);
    for (const t of tris) if (!F.sliver[t] && signed(st2(t)) <= 0) return null;
    const inTri = new Set(tris), V = pts.map(loc);
    let aroundOK = (around || []).filter(t => signed(st2(t)) > 0), extra = scVerts(F, aroundOK).filter(v => !verts.includes(v)).map(v => loc(M.P(v)));
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const q of V) for (let k = 0; k < 2; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
    const size = [hi[0] - lo[0], hi[1] - lo[1]], smax = Math.max(...size);
    for (const q of extra) for (let k = 0; k < 2; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
    const pad = 0.03 * smax + tol; lo = lo.map(x => x - pad); hi = hi.map(x => x + pad);
    const spans = size.map(s => Math.max(1, Math.round(4 * s / smax))), smallest = Math.max(hi[0] - lo[0], hi[1] - lo[1]) / (4 * SC.SPANS);
    let ub = [...Array(spans[0] + 1).keys()].map(i => lo[0] + (hi[0] - lo[0]) * i / spans[0]), vb = [...Array(spans[1] + 1).keys()].map(i => lo[1] + (hi[1] - lo[1]) * i / spans[1]);
    // bordo della patch: vertici sugli spigoli che escono dalla patch
    const boundary = new Set();
    for (const t of tris) for (let k = 0; k < 3; k++) { const u = M.nb[3 * t + k]; if (u < 0 || !inTri.has(u)) { boundary.add(M.T[3 * t + k]); boundary.add(M.T[3 * t + (k + 1) % 3]); } }
    const vW = verts.map(v => boundary.has(v) ? 4 : 1), vLim = verts.map(v => boundary.has(v) ? tol / 4 : tol / 2);
    const spanW = (br, x) => { let k = 0; while (k < br.length - 2 && x >= br[k + 1]) k++; return br[k + 1] - br[k]; };
    for (let iter = 0; iter < 16; iter++) {
      const nu = ub.length + 2, nv = vb.length + 2, K = nu * nv; if (K > 400) return null;
      const spacing = Math.min(...ub.slice(1).map((x, i) => x - ub[i]), ...vb.slice(1).map((x, i) => x - vb[i])) / 2;
      const localSp = tris.map(t => Math.min(...st2(t).map(q => Math.min(spanW(ub, q[0]), spanW(vb, q[1])))));
      const smp = scSamples(F, tris, spacing, boundary, localSp);
      const data = V.map((q, i) => ({ q, w: vW[i], lim: vLim[i] })).concat(smp.pts.map((p, i) => ({ q: loc(p), w: smp.onB[i] ? 1 : 0.25, lim: smp.onB[i] ? tol / 2 : tol })));
      const uk = scClamp(ub), vk = scClamp(vb);
      const rowsOf = list => list.map(d => { const U = scBasis(uk, d.q[0]), Vv = scBasis(vk, d.q[1]), idx = [], val = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { idx.push((U.k + i) * nv + Vv.k + j); val.push(U.w[i] * Vv.w[j]); } return { idx, val, z: d.q[2], w: d.w, lim: d.lim }; });
      const rows = rowsOf(data);
      const solveH = rs => {
        const A = [...Array(K)].map(() => new Float64Array(K)), b = new Float64Array(K);
        for (const r of rs) for (let a = 0; a < 16; a++) { b[r.idx[a]] += r.w * r.val[a] * r.z; for (let c = 0; c < 16; c++) A[r.idx[a]][r.idx[c]] += r.w * r.val[a] * r.val[c]; }
        let md = 0; for (let i = 0; i < K; i++) md += A[i][i]; const sm = 1e-3 * md / K;
        const addR = (ids, ws) => { for (let a = 0; a < ids.length; a++) for (let c = 0; c < ids.length; c++) A[ids[a]][ids[c]] += sm * ws[a] * ws[c]; };
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
          if (i + 2 < nu) addR([i * nv + j, (i + 1) * nv + j, (i + 2) * nv + j], [1, -2, 1]);
          if (j + 2 < nv) addR([i * nv + j, i * nv + j + 1, i * nv + j + 2], [1, -2, 1]);
          if (i + 1 < nu && j + 1 < nv) addR([i * nv + j, (i + 1) * nv + j, i * nv + j + 1, (i + 1) * nv + j + 1], [Math.SQRT2, -Math.SQRT2, -Math.SQRT2, Math.SQRT2]);
        }
        return solve(A.map(r => Array.from(r)), Array.from(b));
      };
      let H = solveH(rows); if (!H || !H.every(isFinite)) return null;
      const resid = (Hh, rs) => rs.map(r => { let s = 0; for (let a = 0; a < 16; a++) s += r.val[a] * Hh[r.idx[a]]; return Math.abs(s - r.z); });
      let res = resid(H, rows), bad = res.map((e, i) => e > rows[i].lim);
      if (!bad.some(x => x)) {
        if (aroundOK.length) {   // seconda soluzione che segue leggermente anche la prima fila di triangoli vicini
          const gs = scSamples(F, aroundOK, spacing, boundary, aroundOK.map(() => spacing));
          const guide = extra.map(q => ({ q, w: 0.1, lim: Infinity })).concat(gs.pts.map(p => ({ q: loc(p), w: 0.1, lim: Infinity })));
          const H2 = solveH(rows.concat(rowsOf(guide)));
          if (H2 && H2.every(isFinite)) { const r2 = resid(H2, rows); if (r2.every((e, i) => e <= rows[i].lim)) { H = H2; res = r2; } }
        }
        const fld = scField(c0, e1, e2, axis, ub, vb, H);
        fld.error = Math.max(...res.slice(0, V.length)); fld.sampleError = Math.max(0, ...res.slice(V.length));
        return fld;
      }
      const refine = (br, vals) => {
        if (!vals.length || br.length - 1 >= SC.SPANS) return null;
        const marks = new Map(); for (const x of vals) { let k = 0; while (k < br.length - 2 && x >= br[k + 1]) k++; if (br[k + 1] - br[k] >= 2 * smallest) marks.set(k, (marks.get(k) || 0) + 1); }
        if (!marks.size) return null;
        let mk = [...marks].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, SC.SPANS - (br.length - 1));
        return [...br, ...mk.map(k => (br[k] + br[k + 1]) / 2)].sort((a, b) => a - b);
      };
      const bu = data.filter((_, i) => bad[i]).map(d => d.q[0]), bv = data.filter((_, i) => bad[i]).map(d => d.q[1]);
      const ru = refine(ub, bu), rv = refine(vb, bv);
      if (!ru && !rv) return null;
      if (ru) ub = ru; if (rv) vb = rv;
    }
    return null;
  }
  function scCylinder(F, tris0, tol) {
    const M = F.M, solid = tris0.filter(t => !F.sliver[t]); if (solid.length < 4) return null;
    const verts = scVerts(F, solid), pts = verts.map(v => M.P(v));
    if (scPlane(pts).maxErr <= tol / 4) return null;
    const S = [0, 0, 0, 0, 0, 0]; for (const t of solid) { const n = F.nrm(t), w = F.areas[t]; S[0] += w * n[0] * n[0]; S[1] += w * n[0] * n[1]; S[2] += w * n[0] * n[2]; S[3] += w * n[1] * n[1]; S[4] += w * n[1] * n[2]; S[5] += w * n[2] * n[2]; }
    const axis = norm(eigSym3(S)[0].vec), e1 = perp(axis), e2 = cross(axis, e1);
    const c = fitCircle2D(pts.map(p => [dot(p, e1), dot(p, e2)])); if (!c) return null;
    const origin = add(mul(e1, c.cx), mul(e2, c.cy));
    const radial = p => { const d = sub(p, origin); return sub(d, mul(axis, dot(d, axis))); };
    let reach = pts.map(p => len(radial(p))), R = reach.reduce((s, x) => s + x, 0) / reach.length;
    if (!(tol < R && R <= F.extent) || Math.max(...reach) - Math.min(...reach) > 1.5 * tol) return null;
    let facing = 0; const fac = solid.map(t => { const ctr = [M.C[3 * t], M.C[3 * t + 1], M.C[3 * t + 2]], r = norm(radial(ctr)); const f = dot(F.nrm(t), r); facing += f; return f; });
    const outward = facing > 0; if (Math.min(...fac.map(f => outward ? f : -f)) < Math.cos(SC.TILT * Math.PI / 180)) return null;
    const spacing = Math.max(Math.sqrt(R * tol), tol), smp = scSamples(F, solid, spacing, new Set(), solid.map(() => spacing)).pts;
    const all = pts.concat(smp).map(p => len(radial(p))); R = (Math.max(...all) + Math.min(...all)) / 2;
    if (Math.max(...all.map(r => Math.abs(r - R))) > 0.75 * tol) return null;
    let hmin = Infinity, hmax = -Infinity; for (const p of pts) { const h = dot(sub(p, origin), axis); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
    return { kind: 'cylinder', axis, origin: add(origin, mul(axis, hmin)), radius: R, height: hmax - hmin, outward, error: Math.max(...all.map(r => Math.abs(r - R))) };
  }
  function scSplit(F, tris) {
    if (tris.length < 2) return [];
    const inS = new Set(tris); let maxA = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) { const u = F.M.nb[3 * t + k]; if (u >= 0 && inS.has(u)) maxA = Math.max(maxA, F.dih[3 * t + k]); }
    if (maxA >= 8) { const cut = Math.max(8, 0.7 * maxA), parts = scComponents(F, tris, (t, u, k) => F.dih[3 * t + k] < cut); if (parts.length > 1) return parts; }
    const lab = scClusters(F, tris, 2), L = new Map(tris.map((t, i) => [t, lab[i]])), parts = scComponents(F, tris, (t, u) => L.get(t) === L.get(u));
    if (parts.length > 1) return parts;
    const C = tris.map(t => [F.M.C[3 * t], F.M.C[3 * t + 1], F.M.C[3 * t + 2]]), W = tris.map(t => F.areas[t] + 1e-12), sw = W.reduce((s, x) => s + x, 0);
    const m = mul(C.reduce((s, c, i) => add(s, mul(c, W[i])), [0, 0, 0]), 1 / sw), S = [0, 0, 0, 0, 0, 0];
    for (const c of C) { const d = sub(c, m); S[0] += d[0] * d[0]; S[1] += d[0] * d[1]; S[2] += d[0] * d[2]; S[3] += d[1] * d[1]; S[4] += d[1] * d[2]; S[5] += d[2] * d[2]; }
    const ax = eigSym3(S)[2].vec, side = new Map(tris.map((t, i) => [t, dot(sub(C[i], m), ax) > 0]));
    const p2 = scComponents(F, tris, (t, u) => side.get(t) === side.get(u)); return p2.length > 1 ? p2 : [];
  }
  function scMargin(F, tris) {   // la prima fila di triangoli oltre gli spigoli lisci del bordo
    const inS = new Set(tris), out = new Set();
    for (const t of tris) for (let k = 0; k < 3; k++) { const u = F.M.nb[3 * t + k]; if (u >= 0 && !inS.has(u) && !F.crease(3 * t + k) && !F.sliver[u]) out.add(u); }
    return [...out];
  }
  function scAccepts(F, s, t, tol) {
    const cs = [0, 1, 2].map(k => F.M.P(F.M.T[3 * t + k])), dist = p => s.kind === 'plane' ? Math.abs(dot(sub(p, s.origin), s.normal)) : s.kind === 'cylinder' ? (() => { const d = sub(p, s.origin); return Math.abs(len(sub(d, mul(s.axis, dot(d, s.axis)))) - s.radius); })() : s.dist(p);
    if (s.kind === 'bspline') { const q = cs.map(s.local); if ((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) <= 0) return false; if (q.some(x => x[0] < s.ub[0] || x[0] > s.ub[s.ub.length - 1] || x[1] < s.vb[0] || x[1] > s.vb[s.vb.length - 1])) return false; }
    const mids = [mul(add(add(cs[0], cs[1]), cs[2]), 1 / 3), mul(add(cs[0], cs[1]), 0.5), mul(add(cs[1], cs[2]), 0.5), mul(add(cs[2], cs[0]), 0.5)];
    return Math.max(...cs.map(dist)) <= tol / 4 && Math.max(...mids.map(dist)) <= tol / 2;
  }
  // segmentazione completa alla SimpleCAD → stesso formato di segment(): { face, regions }
  function segmentSimpleCAD(M, opts) {
    const tol = opts.tol, F = scFacets(M), patches = [], pending = [];
    for (const region of scRegions(F)) {
      const cyl = opts.cylinders !== false ? scCylinder(F, region, tol) : null;
      if (cyl) patches.push({ tris: region, s: cyl }); else pending.push(...scTilted(F, region));
    }
    while (pending.length) {
      if (patches.length + pending.length > SC.PATCHES) break;
      const tris = pending.pop(), s = scFit(F, tris, tol, null, scMargin(F, tris));
      if (s) { patches.push({ tris, s }); continue; }
      const parts = scSplit(F, tris); if (parts.length) { pending.push(...parts); continue; }
      for (const t of tris) { const s1 = scFit(F, [t], tol, Infinity, null); patches.push({ tris: [t], s: s1 || { kind: 'freeform' } }); }
    }
    for (const tris of pending) for (const t of tris) patches.push({ tris: [t], s: { kind: 'freeform' } });   // oltre il limite di patch
    const lab = new Int32Array(M.nT); patches.forEach((p, i) => p.tris.forEach(t => { lab[t] = i; }));
    // tidy: un triangolo con 2–3 vicini della stessa altra patch vi passa se la superficie lo accetta come bordo
    for (let it = 0; it < 16; it++) {
      let moved = 0;
      for (let t = 0; t < M.nT; t++) {
        if (F.sliver[t]) continue; const nb = [0, 1, 2].map(k => M.nb[3 * t + k]).filter(u => u >= 0).map(u => lab[u]);
        const cnt = new Map(); for (const l of nb) cnt.set(l, (cnt.get(l) || 0) + 1);
        let best = -1, bc = 0; for (const [l, c] of cnt) if (c > bc) { bc = c; best = l; }
        if (best < 0 || best === lab[t] || bc < 2 || patches[best].s.kind === 'freeform') continue;
        if (scAccepts(F, patches[best].s, t, tol)) { lab[t] = best; moved++; }
      }
      if (!moved) break;
    }
    // settle_slivers: ogni scheggia alla patch oltre il suo lato lungo
    for (let t = 0; t < M.nT; t++) if (F.sliver[t]) {
      let u = t; for (let g = 0; g < 64 && F.sliver[u]; g++) { const a = M.P(M.T[3 * u]), b = M.P(M.T[3 * u + 1]), c = M.P(M.T[3 * u + 2]), L = [len(sub(b, a)), len(sub(c, b)), len(sub(a, c))], w = M.nb[3 * u + L.indexOf(Math.max(...L))]; if (w < 0 || w === t) break; u = w; }
      lab[t] = lab[u];
    }
    // regioni nel formato di Mesh2STEP (le patch spezzate da tidy restano un'unica regione se ancora connesse; altrimenti una per parte)
    const groups = new Map(); for (let t = 0; t < M.nT; t++) { if (!groups.has(lab[t])) groups.set(lab[t], []); groups.get(lab[t]).push(t); }
    const regions = [], face = new Int32Array(M.nT);
    for (const [pi, trisAll] of groups) {
      const s = patches[pi].s;
      for (const tris of scComponents(F, trisAll, () => true)) {
        const id = regions.length; let r;
        if (s.kind === 'plane') r = { type: 'plane', normal: s.normal, origin: s.origin, err: s.error || 0 };
        else if (s.kind === 'cylinder') r = { type: 'cylinder', axis: s.axis, origin: s.origin, radius: s.radius, height: s.height, outward: s.outward, err: s.error };
        else if (s.kind === 'bspline') r = { type: 'bspline', cp: s.cp, nc: s.nu, nv: s.nv, segs: s.ub.length - 1, segsV: s.vb.length - 1, ub: s.ub, vb: s.vb, err: Math.max(s.error || 0, s.sampleError || 0), normal: s.e3, dist: s.dist, proj: s.proj, uvOf: s.uvOf, sc: true };
        else r = { type: 'freeform', err: 0 };
        if (r.type === 'plane' && tris.length <= 2 && s.kind === 'plane' && patches[pi].tris.length === 1) { /* triangolo singolo: resta piano (come in SimpleCAD) */ }
        r.id = id; r.tris = tris; regions.push(r); for (const t of tris) face[t] = id;
      }
    }
    return { face, regions };
  }

  // ---- [v1.13.0] Ripiego per faccia (come SimpleCAD): OpenCASCADE (nel Worker) legge lo STEP e per ogni faccia restituisce
  // { valid, area, pts: vertici }. Qui ogni faccia viene attribuita alla regione che tocca più vertici di mesh vicini; una regione è
  // da sfaccettare se una sua faccia non è valida oppure se l'area letta differisce da quella dei suoi triangoli (faccia valida ma
  // ritagliata male: anello esterno sbagliato, dominio della B-spline). Le regioni trovate diventano sfaccettate (un triangolo piano per
  // faccia, sempre valido). Restituisce una copia di seg, gli id cambiati e i conteggi.
  // regione di una faccia letta da OpenCASCADE: punti presi dentro la faccia (centri dei triangoli della sua tessellazione), ognuno al triangolo
  // di mesh più vicino, regione a maggioranza. (Provato con i vertici della faccia: sono condivisi con le vicine e l'attribuzione sbagliava.)
  // distanza al quadrato punto-triangolo (Ericson, Real-Time Collision Detection 5.1.5)
  function ptTriDist2(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); let q;
    if (d1 <= 0 && d2 <= 0) q = a;
    else { const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) q = b;
      else { const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) q = add(a, mul(ab, d1 / (d1 - d3)));
        else { const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
          if (d6 >= 0 && d5 <= d6) q = c;
          else { const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) q = add(a, mul(ac, d2 / (d2 - d6)));
            else { const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
              else { const den = 1 / (va + vb + vc); q = add(a, add(mul(ab, vb * den), mul(ac, vc * den))); } } } } } }
    const d = sub(p, q); return dot(d, d);
  }
  function regionOfFace(M, seg, pts, preferAnalytic, kind) {
    // [v1.13.1] solo regioni il cui tipo può dare quella superficie (piano: piano o regione a triangoli)
    const okType = r => !kind || kind === 'other' || (kind === 'plane' ? (r.type === 'plane' || r.type === 'freeform' || r.type === 'thread') : r.type === kind);
    const cnt = new Map();
    for (const p of pts) {
      // triangolo più vicino per distanza punto-triangolo (con il centro dei triangoli i triangoli grandi "rubavano" i punti ai vicini piccoli)
      let best = -1, bd = Infinity;
      for (let t = 0; t < M.nT; t++) {
        const dx = M.C[3 * t] - p[0], dy = M.C[3 * t + 1] - p[1], dz = M.C[3 * t + 2] - p[2], dc = dx * dx + dy * dy + dz * dz;
        if (!okType(seg.regions[seg.face[t]])) continue;
        if (dc > 4 * bd + 1e-9 && dc > 1e-12 && bd < Infinity && Math.sqrt(dc) - Math.sqrt(M.A[t] * 2) > Math.sqrt(bd)) continue;   // scarto rapido
        const d = ptTriDist2(p, M.P(M.T[3 * t]), M.P(M.T[3 * t + 1]), M.P(M.T[3 * t + 2])); if (d < bd) { bd = d; best = t; }
      }
      if (best >= 0) { const id = seg.face[best]; cnt.set(id, (cnt.get(id) || 0) + 1); }
    }
    let best = -1, bc = -1; for (const [id, c] of cnt) if (c > bc) { bc = c; best = id; }
    if (preferAnalytic && best >= 0 && seg.regions[best].type === 'freeform') {   // faccia non valida: si cerca la regione non ancora sfaccettata vicina
      let b2 = -1, c2 = -1; for (const [id, c] of cnt) if (seg.regions[id].type !== 'freeform' && c > c2) { c2 = c; b2 = id; }
      if (b2 >= 0) return b2;
    }
    return best;
  }
  function facetRegionsAt(M, seg, faces, tol) {
    const ids = new Set(), single = new Set(), area = new Map(); let invalid = 0, mismatch = 0;
    for (const f of faces) {
      const id = regionOfFace(M, seg, f.pts, !f.valid, f.kind); if (id < 0) continue;
      area.set(id, (area.get(id) || 0) + (f.area || 0));
      if (!f.valid && seg.regions[id].type !== 'freeform') { ids.add(id); invalid++; }
      else if (!f.valid && !seg.regions[id].singleTris) { single.add(id); invalid++; }   // [2026-10-22 v1.13.1] faccia sfaccettata unita non valida
      else if (!f.valid) {
        // [2026-10-22 v1.13.1] faccia già di un solo triangolo e ancora non valida: il difetto viene dallo spigolo condiviso con una superficie vicina
        // (Plenum a tolleranza 0,02: retta lunga 16 mm accanto a una B-spline, OpenCASCADE chiudeva l'anello con uno spigolo degenere) →
        // si passano a triangoli le regioni analitiche adiacenti ai triangoli della faccia
        for (const p of f.pts) {
          let bt = -1, bd = Infinity;
          for (const t of seg.regions[id].tris) { const d = ptTriDist2(p, M.P(M.T[3 * t]), M.P(M.T[3 * t + 1]), M.P(M.T[3 * t + 2])); if (d < bd) { bd = d; bt = t; } }
          if (bt >= 0) for (let k = 0; k < 3; k++) { const u = M.nb[3 * bt + k]; if (u >= 0 && seg.regions[seg.face[u]].type !== 'freeform') ids.add(seg.face[u]); }
        }
        invalid++;
      }
    }
    // [2026-10-21 v1.13.1] confronto delle AREE (|area OCC − area dei triangoli| > 2%). Provato il confronto del contributo al volume
    // (∫ x·n/3 dA): dipende dalla tessellazione OCC ed era più rumoroso (Plenum: −1,3% di volume finale contro −0,3%), scartato.
    for (const [id, a] of area) {
      const r = seg.regions[id]; if (r.type === 'freeform' || ids.has(id)) continue;
      let am = 0; for (const t of r.tris) am += M.A[t];
      const per = Math.sqrt(am) * 4;   // stima del perimetro per la tolleranza sull'area
      if (Math.abs(a - am) > Math.max(0.02 * am, 2 * tol * per)) { ids.add(id); mismatch++; }
    }
    /* [2026-10-22 v1.13.1] prima: solo le regioni analitiche passavano a triangoli; una faccia sfaccettata (gruppo complanare) non valida restava tale.
    const regions = seg.regions.map(r => (ids.has(r.id) && r.type !== 'freeform' && r.tris.length) ? Object.assign({}, r, { type: 'freeform', faceted: true, wasType: r.type }) : r);
    return { seg: Object.assign({}, seg, { regions }), ids: [...ids], invalid, mismatch }; */
    const regions = seg.regions.map(r => (ids.has(r.id) && r.type !== 'freeform' && r.tris.length) ? Object.assign({}, r, { type: 'freeform', faceted: true, wasType: r.type })
      : single.has(r.id) ? Object.assign({}, r, { singleTris: true }) : r);
    for (const id of single) ids.add(id);
    return { seg: Object.assign({}, seg, { regions }), ids: [...ids], invalid, mismatch, single: single.size };
  }

  // ---- [v1.13.0] Verifica e ripiego con OpenCASCADE (oc = modulo replicad-opencascadejs, iniettato come manifold: il core resta senza dipendenze)
  // occCheckStep: legge lo STEP con STEPControl_Reader, BRepCheck_Analyzer su forma e facce, volume, e per ogni faccia area, validità e
  // alcuni punti DENTRO la faccia (centri dei triangoli della sua tessellazione) per riconoscere la regione di origine.
  function occCheckStep(oc, text, opts = {}) {
    oc.FS.writeFile('/m2s_check.step', text);
    const rd = new oc.STEPControl_Reader();
    rd.ReadFile('/m2s_check.step');
    rd.TransferRoots(new oc.Message_ProgressRange());
    const sh = rd.OneShape();
    // tessellazione grossolana: serve solo a prendere punti dentro le facce (provata 0,02 mm per il contributo al volume: scartato)
    new oc.BRepMesh_IncrementalMesh(sh, opts.deflection || 0.5, false, 0.5, false);
    const az = new oc.BRepCheck_Analyzer(sh, true, false, false), faces = [];
    const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current()), g = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, g, false, false);
      const pts = [], T = oc.BRep_Tool.Triangulation(f, new oc.TopLoc_Location(), 0);
      if (T && !(T.IsNull && T.IsNull())) {
        const tri = T.get ? T.get() : T, nt = tri.NbTriangles();
        // [v1.13.1] fino a 12 triangoli distribuiti (prima 4: le facce piccole vicine a una grande venivano attribuite alla grande)
        for (const i of [...new Set([...Array(Math.min(12, nt)).keys()].map(k => 1 + Math.floor(k * nt / Math.min(12, nt))))]) {
          if (i < 1) continue; const tr = tri.Triangle(i), ps = [1, 2, 3].map(j => tri.Node(tr.Value(j)));
          pts.push([(ps[0].X() + ps[1].X() + ps[2].X()) / 3, (ps[0].Y() + ps[1].Y() + ps[2].Y()) / 3, (ps[0].Z() + ps[1].Z() + ps[2].Z()) / 3]);
        }
      }
      if (!pts.length) {   // faccia senza tessellazione (area nulla): i suoi vertici
        const ev = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; ev.More(); ev.Next()) { const q = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(ev.Current())); pts.push([q.X(), q.Y(), q.Z()]); }
      }
      // tipo di superficie: serve ad attribuire la faccia solo a regioni compatibili (un piano non può essere una B-spline vicina)
      const ty = new oc.BRepAdaptor_Surface(f, true).GetType(), G = oc.GeomAbs_SurfaceType;
      const kind = ty === G.GeomAbs_Plane ? 'plane' : ty === G.GeomAbs_Cylinder ? 'cylinder' : ty === G.GeomAbs_Cone ? 'cone' : ty === G.GeomAbs_Sphere ? 'sphere' : ty === G.GeomAbs_Torus ? 'torus' : ty === G.GeomAbs_BSplineSurface ? 'bspline' : 'other';
      faces.push({ valid: az.IsValid(f), area: g.Mass(), pts, kind });
    }
    const gv = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh, gv, false, false, false);
    let solids = 0; const es = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); for (; es.More(); es.Next()) solids++;
    try { oc.FS.unlink('/m2s_check.step'); } catch (e) { /* già tolto */ }
    return { ok: true, valid: az.IsValid(sh), volume: Math.abs(gv.Mass()), solids, faces, invalid: faces.filter(f => !f.valid).length };
  }
  // stepValidated: esporta, controlla con OpenCASCADE e, finché trova facce non valide o con area diversa dai triangoli della regione,
  // le sfaccetta (facetRegionsAt) e riesporta (max opts.rounds giri, predefinito 4). Come il ripiego di SimpleCAD, ma per singola regione.
  function stepValidated(M, seg, oc, opts = {}) {
    const rounds = [], maxR = opts.rounds || 4; let cur = seg, ex = null, chk = null, faceted = 0;
    for (let i = 0; i <= maxR; i++) {
      ex = exportSTEP(M, cur, opts); chk = occCheckStep(oc, ex.text);
      const step = { faces: ex.faces, occFaces: chk.faces.length, valid: chk.valid, invalid: chk.invalid, volume: chk.volume };
      if (i === maxR) { rounds.push(step); break; }
      const r = facetRegionsAt(M, cur, chk.faces, opts.tol || 0.01);
      step.faceted = r.ids.length; step.mismatch = r.mismatch; rounds.push(step);
      if (!r.ids.length) break;
      faceted += r.ids.length; cur = r.seg;
    }
    return { text: ex.text, exp: ex, seg: cur, valid: chk.valid, invalid: chk.invalid, volume: chk.volume, meshVolume: Math.abs(M.volume), faces: ex.faces, faceted, rounds };
  }

  // ---- [v1.10.0] Tolleranza automatica ----
  // Se con la tolleranza richiesta restano troppi triangoli "sciolti" (freeform + frammenti di ≤ 4 triangoli), la si alza per gradini
  // (×1,5 ×2,5 ×4 ×8, mai oltre 0,4% della diagonale) e si tiene il tentativo con meno triangoli sciolti: sulle mesh rumorose (scansioni,
  // float32, rimesh) la tolleranza giusta è quella del rumore, non quella di una mesh CAD esatta. Se il primo tentativo è già pulito, una sola passata.
  function looseTris(seg, nT) {   // triangoli rimasti sfaccettati (una faccia STEP ciascuno); i piani da ≤ 2 triangoli contano solo se sono tanti (> 10% della mesh)
    let n = 0, tiny = 0; for (const r of seg.regions) { if (r.type === 'freeform') n += r.tris.length; else if (r.type === 'plane' && r.tris.length <= 2) tiny += r.tris.length; }
    return n + (tiny > 0.1 * nT ? tiny : 0);
  }
  function segmentAuto(M, opts) {
    // [2026-10-21 v1.11.0] prima: gradini fissi ×1 ×2 ×4 ×8; ora il gradino dipende da quanto è grave: se restano > 3% di triangoli sciolti si salta ×4
    // (su un file da 22 000 triangoli ogni analisi costa ~20 s: meno tentativi = meno attesa)
    const tries = [], cap = Math.max(opts.tol, M.diag * 0.004), limit = Math.max(2, 0.005 * M.nT);
    let best = null, prev = null, tol = opts.tol, quasi = false;
    for (let n = 0; n < 5; n++) {
      const seg = segment(M, Object.assign({}, opts, { tol })), loose = looseTris(seg, M.nT), regions = seg.regions.filter(r => r.type !== 'merged').length;
      tries.push({ tol, loose, regions });
      const eff = loose <= limit ? 0 : loose, cur = { seg, tol, loose, eff, regions };
      // si cambia tentativo solo se migliora in modo netto (meno triangoli sciolti o, a parità, meno facce): preferisce la tolleranza più stretta
      if (!best || eff < best.eff * 0.8 || (eff <= best.eff && regions < best.regions * 0.9)) best = cur;
      else if (prev && eff >= prev.eff && regions >= prev.regions) break;   // nessun miglioramento rispetto al gradino precedente: inutile salire
      prev = cur;
      if (loose === 0) break;                                              // nessun triangolo sciolto: finito
      // quasi pulito (≤ 0,5% sciolti): al massimo un gradino ×2 in più, accettato solo se le regioni calano di oltre il 10% (vedi `best` sopra)
      if (eff === 0) { if (quasi) break; quasi = true; }
      const next = Math.min(tol * (loose > 0.03 * M.nT ? 3 : 2), cap);   // [2026-10-21 v1.11.0] ×3 (non ×4) se grave: ×4 superava troppo la tolleranza utile (noisy_plate 0,02 → 0,08) if (next <= tol * 1.0001) break;
      tol = next;
    }
    return { seg: best.seg, tol: best.tol, tries };
  }
  function analyse(soup, opts) {
    const M = buildMesh(soup);
    // [2026-10-21 v1.10.0] prima: const seg = segment(M, opts);  (opts.autoTol: tolleranza automatica, vedi segmentAuto)
    const a = opts.autoTol ? segmentAuto(M, opts) : null;
    const seg = a ? a.seg : segment(M, opts);
    return { M, seg, tol: a ? a.tol : opts.tol };
  }

  const API = { VERSION, parseFile, parseSTL, parseOBJ, parse3MF, buildMesh, segment, segmentAuto, segmentSimpleCAD, facetRegionsAt, occCheckStep, stepValidated, exportSTEP, analyse, fitCylinder, fitSphere, fitPlane, fitCone, fitTorus, fitBSpline, detectThread, threadsToCylinders, fixNonManifold, findSelfIntersections, repairSelfIntersections, fitBSplineClosed, reportPdf, fillHoles, features, deviation, surfDist, editRegions, regionStats, resizeHole, holeTarget, HOLE_SIZES, verifyStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.M2S = API;
})(typeof self !== 'undefined' ? self : this);
