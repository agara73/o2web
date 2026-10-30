'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// build.js - unisce i moduli di src/ (e il set di caratteri originale di hw/) in UN SOLO file HTML che funziona aprendolo dal disco,
// senza rete. Nessun BIOS, cartuccia o set di caratteri dell'utente e' incluso: li sceglie l'utente nella pagina.
// Uso: node tools/build.js [OUT.html]      (default: dist/o2web.html)
// Controlli prima di scrivere: tag <script> bilanciati, nessun "</script" dentro ai moduli, copyright in ogni modulo e nella pagina,
// nessun localStorage / alert( / confirm( , dimensione > 0. In piu': la pagina porta il testo completo della licenza (LICENSE), l'avviso GPL,
// l'identificatore SPDX e la regola di sicurezza della rete (CSP con connect-src https:, uguale in vercel.json), e nessun modulo tranne
// src/netfetch.js usa fetch, XMLHttpRequest, WebSocket o altre API di rete (tappa 4c: la rete parte solo su richiesta dell'utente).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// ordine: dipendenze prima; l'ultimo e' il punto d'ingresso
const MODULES = [
  ['./lang_en.js', 'src/lang_en.js'], ['./lang_en_dom.js', 'src/lang_en_dom.js'], ['./i18n.js', 'src/i18n.js'],
  ['./sha256.js', 'src/sha256.js'], ['./unzip.js', 'src/unzip.js'], ['./zipstore.js', 'src/zipstore.js'], ['./cpu8048.js', 'src/cpu8048.js'],
  ['./cartmap.js', 'src/cartmap.js'], ['./vdc.js', 'src/vdc.js'], ['./ef934x.js', 'src/ef934x.js'], ['./z80.js', 'src/z80.js'], ['./chessmod.js', 'src/chessmod.js'], ['./console.js', 'src/console.js'], ['./audio.js', 'src/audio.js'],
  ['./webaudio.js', 'src/webaudio.js'], ['./input.js', 'src/input.js'], ['./touch.js', 'src/touch.js'],['./sha1.js', 'src/sha1.js'], ['./gamedb_data.js', 'src/gamedb_data.js'], ['./vplist_data.js', 'src/vplist_data.js'], ['./vplist.js', 'src/vplist.js'], ['./gamenames.js', 'src/gamenames.js'], ['./library.js', 'src/library.js'], ['./gamelist.js', 'src/gamelist.js'], ['./preview.js', 'src/preview.js'], ['./previews.js', 'src/previews.js'], ['./covers.js', 'src/covers.js'], ['./netfetch.js', 'src/netfetch.js'], ['./look.js', 'src/look.js'], ['./machines.js', 'src/machines.js'], ['./photos.js', 'src/photos.js'], ['./photos_data.js', null], ['./session.js', 'src/session.js'],
  ['./charedit.js', 'src/charedit.js'], ['./charui.js', 'src/charui.js'], ['./charset_own.js', 'hw/charset_own.js'], ['./charset9341_own.js', 'hw/charset9341_own.js'], ['./pacer.js', 'src/pacer.js'], ['./app.js', 'src/app.js'], ['./screen.js', 'src/screen.js'], ['./ui.js', 'src/ui.js'],
];
const COPY = '(c) 2026 by Agara73';

// foto delle macchine (web/photos, licenza libera fornita dall'utente): modulo generato './photos_data.js' = {tipo: {src: 'data:image/webp;base64,...', ...crediti}}
// Se la cartella manca, la pagina usa solo i disegni originali. Ogni foto e' controllata (SHA-256, dimensione, licenza libera) con src/photos.js.
// API di rete e di esecuzione di codice esterno: ammesse solo in src/netfetch.js (fetch) e mai altrove
// (il metodo `fetch()` del nucleo 8048 e' il prelievo di un byte di programma, non la rete: si salta la sua definizione e le chiamate `this.fetch(`)
const NET_APIS = [
  [/(^|[^A-Za-z0-9_$.])fetch\s*\(/, 'fetch('], [/\b(window|globalThis|self|top|parent|frames)\s*(\.|\[)\s*['"]?fetch/, 'window.fetch'],
  [/(^|[^A-Za-z0-9_$.])fetch\b(?!\s*[(:])/, 'fetch (riferimento)'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'], [/\bsendBeacon\b/, 'sendBeacon'], [/\bimportScripts\b/, 'importScripts'], [/\bnew\s+(Shared)?Worker\b/, 'Worker'],
  [/\bserviceWorker\b/, 'serviceWorker'], [/\bRTCPeerConnection\b/, 'RTCPeerConnection'], [/\bWebTransport\b/, 'WebTransport'], [/(^|[^A-Za-z0-9_$.])import\s*\(/, 'import('],
  [/\beval\s*\(/, 'eval('], [/\bnew\s+Function\b/, 'new Function'],
];
// codice senza righe di commento e senza la definizione di un metodo `fetch(...) {` (nucleo 8048); ritorna le etichette delle API di rete trovate
function scanNetApis(src) {
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !/^\s*(async\s+)?fetch\s*\([^)]*\)\s*\{/.test(l)).join('\n');
  return NET_APIS.filter(([re]) => re.test(code)).map(([, label]) => label);
}
// la regola di sicurezza (CSP) della pagina e di vercel.json: stessa, tranne frame-ancestors (solo nelle intestazioni); connect-src deve essere esattamente https:
function cspDirectives(text) {
  const m = {};
  for (const part of text.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf(' ');
    m[i < 0 ? t : t.slice(0, i)] = i < 0 ? '' : t.slice(i + 1).trim();
  }
  return m;
}
function checkCsp(tpl, vercelFile) {
  const mm = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(tpl);
  if (!mm) throw new Error('la pagina non ha la regola di sicurezza (Content-Security-Policy)');
  const meta = cspDirectives(mm[1]);
  if (meta['connect-src'] !== 'https:') throw new Error('la regola di sicurezza della pagina deve avere connect-src https: (trovato: ' + meta['connect-src'] + ')');
  if (meta['default-src'] !== "'none'") throw new Error('la regola di sicurezza della pagina deve avere default-src \'none\'');
  for (const k of ['script-src', 'style-src']) if (meta[k] !== "'unsafe-inline'") throw new Error('la regola di sicurezza della pagina: ' + k + ' non e\' quella prevista');
  if (meta['img-src'] !== 'data: blob:' || meta['media-src'] !== 'blob:') throw new Error('la regola di sicurezza della pagina: img-src / media-src non sono quelli previsti');
  if (meta['form-action'] !== "'none'" || meta['base-uri'] !== "'none'") throw new Error('la regola di sicurezza della pagina: form-action / base-uri non sono quelli previsti');
  const vf = vercelFile || path.join(ROOT, 'vercel.json');
  if (fs.existsSync(vf)) {
    const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
    const h = (v.headers || []).flatMap((x) => x.headers || []).find((x) => x.key === 'Content-Security-Policy');
    if (!h) throw new Error('vercel.json non ha l\'intestazione Content-Security-Policy');
    const hv = cspDirectives(h.value);
    delete hv['frame-ancestors'];
    if (JSON.stringify(Object.entries(hv).sort()) !== JSON.stringify(Object.entries(meta).sort())) throw new Error('la regola di sicurezza di vercel.json non coincide con quella della pagina');
  }
}

function photosModule() {
  const dir = path.join(ROOT, 'web', 'photos'), cf = path.join(dir, 'CREDITS.json');
  const head = '// ' + COPY + ' - SPDX-License-Identifier: GPL-3.0-only - modulo generato dal build: foto delle macchine e crediti (le foto hanno la loro licenza, vedi web/photos/CREDITS.json)\n';
  if (!fs.existsSync(cf)) return {src: head + 'module.exports = {};', count: 0, bytes: 0, pending: 0};
  const P = require(path.join(ROOT, 'src', 'photos.js'));
  const {KINDS} = require(path.join(ROOT, 'src', 'machines.js'));
  const credits = P.checkCredits(JSON.parse(fs.readFileSync(cf, 'utf8')), KINDS);
  const data = {};
  let bytes = 0, pending = 0;
  for (const kind of Object.keys(credits)) {
    const e = credits[kind], b = fs.readFileSync(path.join(dir, e.file));
    if (crypto.createHash('sha256').update(b).digest('hex') !== e.sha256) throw new Error('web/photos/' + e.file + ': l\'impronta SHA-256 non corrisponde a CREDITS.json');
    if (b.length === 0 || b.length > P.MAX_FILE) throw new Error('web/photos/' + e.file + ': dimensione non valida (' + b.length + ' byte, massimo ' + P.MAX_FILE + ')');
    if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') throw new Error('web/photos/' + e.file + ': non e\' un file WebP');
    data[kind] = Object.assign({src: 'data:image/webp;base64,' + b.toString('base64')}, e);
    bytes += b.length;
    if (P.needsReview(e)) pending++;
  }
  return {src: head + 'module.exports = ' + JSON.stringify(data) + ';', count: Object.keys(data).length, bytes, pending};
}

function build() {
  const parts = [];
  for (const [name, file] of MODULES) {
    const src = file === null ? photosModule().src : fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!src.includes(COPY)) throw new Error((file || name) + ': manca il copyright');
    if (/<\/script/i.test(src)) throw new Error(file + ': contiene "</script"');
    if (file !== 'src/netfetch.js') {
      const found = scanNetApis(src);
      if (found.length) throw new Error(file + ': usa ' + found.join(', ') + ' (le richieste di rete stanno solo in src/netfetch.js)');
    }
    for (const bad of ['localStorage', 'sessionStorage', 'alert(', 'confirm(']) {
      const re = new RegExp('(^|[^A-Za-z_.])' + bad.replace('(', '\\('));
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      if (re.test(code)) throw new Error(file + ': usa ' + bad);
    }
    if (/[\u{1F000}-\u{1FFFF}☀-➿]/u.test(src)) throw new Error(file + ': emoji non codificate come \\uXXXX');
    parts.push('__def(' + JSON.stringify(name) + ', function (module, exports, require) {\n' + src + '\n});');
  }
  const boot = [
    '(function () {',
    '"use strict";',
    'var __defs = {}, __cache = {};',
    'function __def(name, fn) { __defs[name] = fn; }',
    'function __require(name) {',
    '  if (__cache[name]) return __cache[name].exports;',
    '  var fn = __defs[name];',
    '  if (!fn) throw new Error("modulo mancante: " + name);',
    '  var m = {exports: {}};',
    '  __cache[name] = m;',
    '  fn(m, m.exports, __require);',
    '  return m.exports;',
    '}',
    parts.join('\n'),
    '__require("./ui.js");',
    '})();',
  ].join('\n');
  const tpl = fs.readFileSync(path.join(ROOT, 'web', 'index.template.html'), 'utf8');
  if (!tpl.includes(COPY.replace('(c) ', '').replace('2026 by', '2026 by')) && !tpl.includes('2026 by Agara73')) throw new Error('la pagina non ha il copyright');
  if (!tpl.includes('/*__BUNDLE__*/')) throw new Error('segnaposto del bundle mancante');
  if (!tpl.includes('/*__LICENSE__*/')) throw new Error('segnaposto della licenza mancante');
  checkCsp(tpl);
  if (!tpl.includes('SPDX-License-Identifier: GPL-3.0-only')) throw new Error('la pagina non ha l\'identificatore della licenza');
  // testo ufficiale della GPL-3.0: deve essere quello vero (intestazione e dimensione), e finisce dentro la pagina (HTML con caratteri speciali)
  const lic = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  if (!/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/.test(lic) || lic.length < 30000 || !lic.includes('END OF TERMS AND CONDITIONS')) throw new Error('LICENSE non e\' il testo della GPL-3.0');
  const licHtml = lic.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = tpl.replace('/*__BUNDLE__*/', () => boot).replace('/*__LICENSE__*/', () => licHtml);
  const opens = (html.match(/<script[\s>]/gi) || []).length, closes = (html.match(/<\/script>/gi) || []).length;
  if (opens !== closes || opens !== 1) throw new Error('tag script non bilanciati: ' + opens + ' aperti, ' + closes + ' chiusi');
  return html;
}

function main() {
  const out = process.argv[2] || path.join(ROOT, 'dist', 'o2web.html');
  const html = build();
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const bytes = new TextEncoder().encode(html);
  fs.writeFileSync(out, bytes);
  if (fs.statSync(out).size === 0) throw new Error('file vuoto');
  console.log('scritto ' + out + ' (' + bytes.length + ' byte)');
  const ph = photosModule();
  if (ph.count) console.log('foto delle macchine: ' + ph.count + ' (' + ph.bytes + ' byte)' + (ph.pending ? ' - ATTENZIONE: ' + ph.pending + ' con autore o licenza da confermare (web/photos/CREDITS.json)' : ''));
}
if (require.main === module) main();
module.exports = {build, scanNetApis, cspDirectives, checkCsp, NET_APIS};
