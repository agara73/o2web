'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_photos.js - foto delle macchine (web/photos) e crediti (src/photos.js): validazione di CREDITS.json (campi, licenze libere, verified),
// coerenza coi file (SHA-256, WebP, dimensione, nessun file in piu'), righe di credito, e modulo generato dal build.
// Non usa dump. Uso: node test/test_photos.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = (n) => path.join(process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src'), n);
const P = require(S('photos.js'));
const {KINDS} = require(S('machines.js'));
const DIR = path.join(__dirname, '..', 'web', 'photos');

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (ottenuto ' + JSON.stringify(a) + ', atteso ' + JSON.stringify(b) + ')');
const throws = (fn, re, m) => { let e = null; try { fn(); } catch (x) { e = x; } ok(e instanceof P.PhotoError && re.test(e.message), m + ' (' + (e ? e.message : 'nessun errore') + ')'); };

const good = () => ({photos: {g7000: {file: 'g7000.webp', sha256: 'a'.repeat(64), title: 'Titolo', author: 'Mario Rossi', licence: 'CC-BY-SA-3.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', changes: 'ridimensionata', verified: true, note: 'ok'}}});
const mod = (fn) => { const c = good(); fn(c.photos.g7000, c); return c; };

// ---- validazione
eq(Object.keys(P.checkCredits(good(), KINDS)), ['g7000'], 'credito valido');
throws(() => P.checkCredits(null, KINDS), /photos/, 'null');
throws(() => P.checkCredits({}, KINDS), /photos/, 'senza elenco');
throws(() => P.checkCredits({photos: []}, KINDS), /photos/, 'elenco array');
throws(() => P.checkCredits(mod((e, c) => { c.photos.g9000 = c.photos.g7000; delete c.photos.g7000; }), KINDS), /macchina sconosciuta/, 'tipo sconosciuto');
throws(() => P.checkCredits(mod((e) => { e.extra = 1; }), KINDS), /campo sconosciuto/, 'campo in piu\'');
for (const k of ['file', 'sha256', 'title', 'author', 'licence', 'licenceUrl', 'sourceUrl', 'changes', 'verified', 'note']) throws(() => P.checkCredits(mod((e) => { delete e[k]; }), KINDS), /manca/, 'manca ' + k);
for (const f of ['../x.webp', 'x.jpg', 'X.webp', 'a b.webp', '', 5, 'a/b.webp']) throws(() => P.checkCredits(mod((e) => { e.file = f; }), KINDS), /file non valido/, 'file ' + JSON.stringify(f));
for (const h of ['a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 5]) throws(() => P.checkCredits(mod((e) => { e.sha256 = h; }), KINDS), /sha256/, 'sha256 ' + String(h).slice(0, 8));
for (const k of ['title', 'changes', 'note']) for (const v of ['', '  ', 5, null]) throws(() => P.checkCredits(mod((e) => { e[k] = v; }), KINDS), /testo non vuoto/, k + ' = ' + JSON.stringify(v));
for (const v of ['', ' ', 5]) throws(() => P.checkCredits(mod((e) => { e.author = v; }), KINDS), /autore non valido/, 'autore ' + JSON.stringify(v));
ok(P.checkCredits(mod((e) => { e.author = null; e.verified = false; e.sourceUrl = null; }), KINDS).g7000.author === null, 'autore null ammesso se non verificata');
for (const v of ['true', 1, null]) throws(() => P.checkCredits(mod((e) => { e.verified = v; }), KINDS), /verified/, 'verified ' + String(v));
for (const l of ['CC-BY-NC-4.0', 'GPL-3.0', 'All rights reserved', 'cc-by-4.0', '', null]) throws(() => P.checkCredits(mod((e) => { e.licence = l; }), KINDS), /licenza non libera/, 'licenza ' + String(l));
for (const l of Object.keys(P.FREE_LICENCES)) ok(P.checkCredits(mod((e) => { e.licence = l; }), KINDS).g7000.licence === l, 'licenza libera ' + l);
for (const l of Object.keys(P.FREE_LICENCES)) ok(!/NC|ND/.test(l), 'nessuna licenza NC / ND nell\'elenco: ' + l);
throws(() => P.checkCredits(mod((e) => { e.licence = 'da-confermare'; }), KINDS), /non puo' essere/, 'da confermare ma verified');
ok(P.checkCredits(mod((e) => { e.licence = 'da-confermare'; e.verified = false; }), KINDS).g7000.licence === 'da-confermare', 'da confermare con verified falso: ammessa');
throws(() => P.checkCredits(mod((e) => { e.author = null; }), KINDS), /bisogno dell'autore/, 'verified senza autore');
throws(() => P.checkCredits(mod((e) => { e.sourceUrl = null; }), KINDS), /indirizzo della fonte/, 'verified senza fonte');
for (const u of ['http://a.org/x', 'javascript:alert(1)', 'data:text/html,x', 'https://a.org/ x', 'https://a.org/"x', 'ftp://a.org', 5, '']) {
  throws(() => P.checkCredits(mod((e) => { e.sourceUrl = u; }), KINDS), /https/, 'sourceUrl ' + JSON.stringify(u));
  throws(() => P.checkCredits(mod((e) => { e.licenceUrl = u; }), KINDS), /https/, 'licenceUrl ' + JSON.stringify(u));
}
ok(P.checkCredits(good(), KINDS).g7000 !== good().photos.g7000 && P.checkCredits(good(), KINDS).g7000.title === 'Titolo', 'ritorna una copia');

// ---- righe di credito
eq(P.creditLine(good().photos.g7000), 'Foto: Mario Rossi · CC BY-SA 3.0', 'riga di credito completa');
eq(P.needsReview(good().photos.g7000), false, 'completa: niente da rivedere');
const pend = Object.assign(good().photos.g7000, {author: null, licence: 'da-confermare', verified: false});
eq(P.creditLine(pend), 'Foto: autore da completare · licenza da confermare (da verificare)', 'riga di credito incompleta');
eq(P.needsReview(pend), true, 'incompleta: da rivedere');
eq(P.needsReview(Object.assign(good().photos.g7000, {verified: false})), true, 'non verificata: da rivedere');
eq(P.creditLine(Object.assign(good().photos.g7000, {licence: 'PD'})), 'Foto: Mario Rossi · pubblico dominio', 'pubblico dominio');

// ---- i file veri
if (!fs.existsSync(path.join(DIR, 'CREDITS.json'))) console.log('  (nessuna cartella web/photos: prova dei file saltata)');
else {
  const credits = P.checkCredits(JSON.parse(fs.readFileSync(path.join(DIR, 'CREDITS.json'), 'utf8')), KINDS);
  const listed = new Set(Object.values(credits).map((e) => e.file));
  const onDisk = fs.readdirSync(DIR).filter((f) => f !== 'CREDITS.json');
  eq(onDisk.sort(), [...listed].sort(), 'web/photos: solo i file elencati in CREDITS.json');
  eq(new Set(Object.values(credits).map((e) => e.file)).size, Object.keys(credits).length, 'un file per macchina');
  let total = 0, pending = 0;
  for (const kind of Object.keys(credits)) {
    const e = credits[kind], b = fs.readFileSync(path.join(DIR, e.file));
    ok(crypto.createHash('sha256').update(b).digest('hex') === e.sha256, kind + ': SHA-256');
    ok(b.length > 0 && b.length <= P.MAX_FILE, kind + ': dimensione ' + b.length);
    ok(b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP', kind + ': WebP');
    total += b.length;
    if (P.needsReview(e)) pending++;
  }
  ok(total < 400 * 1024, 'foto in tutto sotto i 400 KB (' + total + ')');
  console.log('  foto: ' + Object.keys(credits).length + ' (' + total + ' byte); crediti da completare o verificare: ' + pending);

  // ---- il build: modulo generato, controlli
  const {build} = require(path.join(__dirname, '..', 'tools', 'build.js'));
  const html = build();
  for (const kind of Object.keys(credits)) ok(html.includes('"' + kind + '":{"src":"data:image/webp;base64,'), 'pagina: foto ' + kind);
  ok(!/<img [^>]*src="(?!data:)/i.test(html), 'pagina: nessuna immagine esterna');
  ok(/img-src data: blob:;/.test(html), 'pagina: regola di sicurezza con immagini data:');
  const b64 = (html.match(/data:image\/webp;base64,([A-Za-z0-9+\/=]+)/g) || []).length;
  eq(b64, Object.keys(credits).length, 'pagina: tante immagini incorporate quante le macchine con foto');
}

console.log(fails ? 'ERRORI: ' + fails + ' (' + (fails + passes) + ' controlli)' : 'OK: ' + passes + ' controlli sulle foto e sui crediti');
process.exit(fails ? 1 : 0);
