// Mesh2STEP — build.mjs
// Versione: 1.9.0 — 2026-10-09 09:53 (Europe/Rome)
// Versione precedente archiviata: archive/build_v1.0.0_20261005-1710.mjs
// (2026-10-06: build completamente offline: three.js e OrbitControls incorporati come moduli Blob).
//
// Crea la build portabile single-file in dist/: mesh2step_v<versione>_<AAAAMMGG-HHMM>.html
// Uso: node build.mjs   (BUILD_STAMP=AAAAMMGG-HHMM per fissare il timbro)
import fs from 'node:fs';
const ver = fs.readFileSync('VERSION', 'utf8').trim();
const stamp = process.env.BUILD_STAMP || new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16).replace(/[-:]/g, '').replace(' ', '-');
const esc = s => s.replace(/<\/script/gi, '<\\/script');
const rd = f => fs.readFileSync(f, 'utf8');
const core = rd('src/core.js'), worker = rd('src/worker.js'), app = rd('src/app.js');
// [v1.7.0] manifold-3d (riparazione auto-intersezioni) incorporato nel worker: modulo come testo, wasm in base64
const manifoldEmbed = `self.M2S_MANIFOLD_EMBED = ${JSON.stringify({ js: rd('vendor/manifold.js'), wasm: fs.readFileSync('vendor/manifold.wasm').toString('base64') })};\n`;
const three = rd('vendor/three.module.min.js'), orbit = rd('vendor/OrbitControls.js');
const icon = 'data:image/png;base64,' + fs.readFileSync('icons/icon-192.png').toString('base64');
let html = rd('index.html');
// via import map, manifest e icona esterna: tutto incorporato
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '');
html = html.replace('<link rel="icon" href="icons/icon-192.png">', `<link rel="icon" href="${icon}">`);
// bootstrap: crea URL Blob per three -> OrbitControls -> app, riscrivendo gli import
const boot = `<script id="worker-src" type="text/plain">${esc(manifoldEmbed)}${esc(core)}\n${esc(worker)}</script>
<script id="three-src" type="text/plain">${esc(three)}</script>
<script id="orbit-src" type="text/plain">${esc(orbit)}</script>
<script id="app-src" type="text/plain">${esc(app)}</script>
<script>
(function () {
  var src = function (id) { return document.getElementById(id).textContent; };
  var url = function (code) { return URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); };
  var uThree = url(src('three-src'));
  var uOrbit = url(src('orbit-src').replace(/from\\s*['"]three['"]/g, "from '" + uThree + "'"));
  var uApp = url(src('app-src').replace(/from\\s*'three'/, "from '" + uThree + "'").replace(/from\\s*'three\\/addons\\/controls\\/OrbitControls\\.js'/, "from '" + uOrbit + "'"));
  import(uApp);
})();
</script>`;
html = html.replace('<script type="module" src="src/app.js"></script>', () => boot);
html = html.replace('Entry point (GitHub Pages / sviluppo). La build portabile single-file è in dist/.', `Build portabile single-file ${stamp}: completamente offline (three.js incorporato).`);
fs.mkdirSync('dist', { recursive: true });
for (const f of fs.readdirSync('dist')) if (/^mesh2step_v.*\.html$/.test(f)) fs.unlinkSync('dist/' + f);   // tiene solo l'ultima build
const out = `dist/mesh2step_v${ver}_${stamp}.html`;
fs.writeFileSync(out, html);
console.log('creato', out, (html.length / 1024).toFixed(1) + ' KB');
