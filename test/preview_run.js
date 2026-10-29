'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// preview_run.js DIR DUMPS - anteprime della console JavaScript contro il modello per riga in Python (registrato da preview_record.py con il
// riferimento indipendente hw/preview_ref.py): stesso quadro scelto, stesso punteggio, stesso «vuoto», stessa miniatura (byte per byte).
const SP = (n) => require('path').join(process.env.O2_SRC_DIR || require('path').join(__dirname, '..', 'src'), n);
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {Console} = require(SP('console.js'));
const {PreviewRun} = require(SP('preview.js'));
const charsetOwn = require('../hw/charset_own.js');
const [dir, dumps] = process.argv.slice(2);
let bad = 0, done = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!meta.cart) continue;
  const bios = new Uint8Array(fs.readFileSync(path.join(dumps, meta.bios)));
  const cart = new Uint8Array(fs.readFileSync(path.join(dumps, meta.cart)));
  const con = new Console({bios, cart, charset: new Uint8Array(charsetOwn.build()), standard: meta.std});
  const run = new PreviewRun(con);
  while (!run.step(50));
  const r = run.result();
  const ref = new Uint8Array(fs.readFileSync(path.join(dir, meta.name + '.rgba')));
  let diff = 0;
  for (let i = 0; i < ref.length; i++) if (r.rgba[i] !== ref[i]) diff++;
  const good = r.frame === meta.frame && r.score === meta.score && r.blank === meta.blank && diff === 0 && r.rgba.length === ref.length && zlib.crc32(r.rgba) === meta.crc;
  if (!good) { bad++; console.log('FALLITO ' + meta.name + ': quadro ' + r.frame + '/' + meta.frame + ' punteggio ' + r.score + '/' + meta.score + ' vuoto ' + r.blank + '/' + meta.blank + ' byte diversi ' + diff); }
  else console.log('  ' + meta.name.padEnd(24) + 'quadro ' + r.frame + ' punteggio ' + r.score + ' ok');
  done++;
}
if (!done) { console.log('nessuno scenario'); process.exit(1); }
console.log(bad ? 'FALLITI ' + bad + ' su ' + done : 'OK (' + done + ' anteprime identiche al riferimento)');
process.exit(bad ? 1 : 0);
