'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// probe_keys.js - ricava dal BIOS dell'utente la matrice della tastiera: per ogni (riga, colonna) preme quel solo tasto nel menu
// "SELECT GAME" e legge il codice che il BIOS passa alla cartuccia (A all'indirizzo 0x408). Stampa una tabella 8 x 8 (-1 = nessun codice).
// Uso: node tools/probe_keys.js BIOS.bin CARTUCCIA.bin
const fs = require('fs');
const {Console} = require('../src/console.js');
const charsetOwn = require('../hw/charset_own.js');
if (process.argv.length < 4) { console.log('uso: node tools/probe_keys.js BIOS.bin CARTUCCIA.bin'); process.exit(2); }
const bios = new Uint8Array(fs.readFileSync(process.argv[2]));
const cart = new Uint8Array(fs.readFileSync(process.argv[3]));
const res = [];
for (let r = 0; r < 8; r++) {
  const row = [];
  for (let c = 0; c < 8; c++) {
    const con = new Console({bios, cart, charset: new Uint8Array(charsetOwn.build()), standard: 'PAL'});
    let got = -1;
    for (let fr = 0; fr < 60 && got < 0; fr++) {
      if (fr >= 25) con.keyRows[r] = 1 << c;
      const target = con.vdc.frameDone + 1;
      while (con.vdc.frameDone < target) { con.cpu.step(); if (con.cpu.pc === 0x408) { got = con.cpu.a; break; } }
    }
    row.push(got);
  }
  res.push(row);
}
console.log('riga: codice per colonna 0..7 (il codice e\' anche l\'indice della cella nel set di caratteri)');
res.forEach((row, r) => console.log(r + ': ' + row.map((v) => String(v).padStart(3)).join(' ')));
