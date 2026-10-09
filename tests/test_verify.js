// Mesh2STEP — tests/test_verify.js
// Versione: 1.9.0 — 2026-10-09 09:53
// Verifica STEP: tutti gli STEP di tests/out (dopo run_core.js) devono passare (open_block: solo avviso di bordo aperto);
// poi si corrompe un STEP in 4 modi e verifyStep deve segnalare l'errore.
const fs = require('fs'), path = require('path'), M2S = require('../src/core.js');
const dir = path.join(__dirname, 'out'); let fail = 0;
const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail = 1; };
const files = fs.readdirSync(dir).filter(f => f.endsWith('.step')).sort();
chk(files.length > 0, files.length + ' file STEP in tests/out');
for (const f of files) {
  const v = M2S.verifyStep(fs.readFileSync(path.join(dir, f), 'utf8'));
  chk(v.ok, `${f}: ${v.ok ? 'ok' : v.errors.slice(0, 3).join(', ')} (facce ${v.counts.faces}, spigoli ${v.counts.edges}${v.warnings.length ? ', avvisi ' + v.warnings : ''})`);
}
const base = fs.readFileSync(path.join(dir, 'plate_hole.step'), 'utf8');
const lines = base.split('\n');
const mut = (name, fn, expect) => { const v = M2S.verifyStep(fn(lines.slice()).join('\n')); chk(!v.ok && v.errors.some(e => e.startsWith(expect)), `${name} -> ${v.errors.slice(0, 2)}`); };
mut('riferimento mancante', L => { const i = L.findIndex(l => /^#\d+=CARTESIAN_POINT/.test(l)); L.splice(i, 1); return L; }, 'step.dangling');
mut('spigolo orientato rimosso', L => { const i = L.findIndex(l => /ORIENTED_EDGE/.test(l)); const id = /^#(\d+)=/.exec(L[i])[1]; L.splice(i, 1); return L.map(l => l.replace(new RegExp('#' + id + '(?!\\d)', 'g'), '#' + (+id + 1))); }, 'step.');
mut('numero non finito', L => { const i = L.findIndex(l => /CARTESIAN_POINT/.test(l)); L[i] = L[i].replace(/\(-?[\d.]+,/, '(NaN,'); return L; }, 'step.badNumber');
mut('file troncato', L => L.slice(0, L.length - 4), 'step.no');
console.log(fail ? 'FALLITO' : 'OK'); process.exit(fail);
