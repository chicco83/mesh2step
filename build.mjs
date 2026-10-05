// Mesh2STEP — build.mjs
// Versione: 1.0.0 — 2026-10-05 17:10 (Europe/Rome)
// Crea la build portabile single-file in dist/: mesh2step_v<versione>_<AAAAMMGG-HHMM>.html
// Uso: node build.mjs  (legge la versione da VERSION)
import fs from 'node:fs';
const ver = fs.readFileSync('VERSION', 'utf8').trim();
const stamp = process.env.BUILD_STAMP || new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16).replace(/[-:]/g, '').replace(' ', '-');
const esc = s => s.replace(/<\/script/gi, '<\\/script');
const core = fs.readFileSync('src/core.js', 'utf8'), worker = fs.readFileSync('src/worker.js', 'utf8'), app = fs.readFileSync('src/app.js', 'utf8');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('<script type="module" src="src/app.js"></script>',
  `<script id="worker-src" type="text/plain">${esc(core)}\n${esc(worker)}</script>\n<script type="module">\n${esc(app)}\n</script>`);
html = html.replace('Entry point (GitHub Pages / sviluppo). La build portabile single-file è in dist/.', `Build portabile single-file ${stamp}. Richiede internet solo per three.js (CDN).`);
fs.mkdirSync('dist', { recursive: true });
for (const f of fs.readdirSync('dist')) if (/^mesh2step_v.*\.html$/.test(f)) fs.unlinkSync('dist/' + f);   // tiene solo l'ultima build
const out = `dist/mesh2step_v${ver}_${stamp}.html`;
fs.writeFileSync(out, html);
console.log('creato', out, (html.length / 1024).toFixed(1) + ' KB');
