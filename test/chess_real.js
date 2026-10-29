'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// chess_real.js - prova di regressione con le ROM VERE del modulo scacchi C7010 (le porta l'utente: non fanno parte del progetto).
// Uso: node test/chess_real.js DUMPS     (servono DUMPS/bios/o2rom.bin, DUMPS/chess/vp_c7010.bin e DUMPS/chess/z80_c7010.bin; se mancano la prova si salta)
// Gioca con la tastiera della console (BIOS -> menu -> scacchi): Y (si', gioco con il bianco?), livello 1, poi tre mosse (E2E4, G1F3, F1C4) con INVIO.
// Controlla (in PAL) che il motore risponda a ogni mossa (il modulo scrive sul bus un numero ragionevole di byte diversi da 0xFF) e che
// salvataggio e ripresa a meta' partita siano deterministici. In NTSC si limita a riferire: la cartuccia e' europea (PAL) e con i tempi
// NTSC non legge piu' i tasti (osservato il 17/10/2026 con le ROM vere: la schermata si disegna a pezzi e le mosse non arrivano), quindi
// il modulo funziona solo con uno standard PAL; in NTSC si controlla soltanto che la ripresa sia deterministica.
// NON stampa ne' registra nulla del contenuto delle ROM.
const fs = require('fs');
const path = require('path');
const {Console} = require('../src/console.js');
const charsetOwn = require('../hw/charset_own.js');

const dumps = process.argv[2] || process.env.O2_DUMPS;
const files = dumps ? ['bios/o2rom.bin', 'chess/vp_c7010.bin', 'chess/z80_c7010.bin'].map((f) => path.join(dumps, f)) : [];
if (!files.length || !files.every((f) => fs.existsSync(f))) { console.log('SALTATA: mancano le ROM vere del modulo scacchi in DUMPS/chess/ (vp_c7010.bin, z80_c7010.bin) o il BIOS'); process.exit(0); }
const [bios, cart, z80rom] = files.map((f) => new Uint8Array(fs.readFileSync(f)));
const LAYOUT = '0123456789:\0 ?LP+WERTUIOQSDFGHJKAZXCVBM.-*/=YN';       // tastiera della console: posizione = indice del tasto
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };

function play(standard) {
  const c = new Console({bios, cart, charset: new Uint8Array(charsetOwn.build()), standard, chessRom: z80rom});
  let outs = 0;                                                   // byte scritti dal modulo (OUT dello Z80) diversi da 0xFF
  const out = c.chess.out.bind(c.chess);
  c.chess.out = (p, v) => { if ((v & 255) !== 0xFF) outs++; return out(p, v); };
  const key = (i) => { c.keyRows.fill(0); if (i >= 0) c.keyRows[i >> 3] = 1 << (i & 7); };
  const run = (n) => { for (let k = 0; k < n; k++) c.runFrame(); };
  const press = (ch) => { key(ch === '\n' ? 47 : LAYOUT.indexOf(ch)); run(6); key(-1); run(20); };
  run(30); key(1); run(5); key(-1); run(60);                      // BIOS: tasto 1 (menu) = scelta del gioco
  press('Y'); press('1'); run(60);
  const replies = [];
  for (const mv of ['E2E4', 'G1F3', 'F1C4']) {
    const o0 = outs;
    for (const ch of mv) press(ch);
    press('\n');
    // il motore «pensa» (con lo Z80 a meta' del quarzo piu' a lungo): si aspetta fino a 3000 fotogrammi, finche' le risposte non si fermano da 300
    let last = outs, still = 0;
    for (let f = 0; f < 3000 && !(outs - o0 >= 8 && still >= 300); f += 10) { run(10); if (outs !== last) { last = outs; still = 0; } else still += 10; }
    replies.push(outs - o0);
  }
  const snap = JSON.parse(JSON.stringify(c.saveState()));
  run(200); const a = JSON.stringify(c.saveState());
  c.loadState(snap); run(200); const b = JSON.stringify(c.saveState());
  return {replies, same: a === b, ramNonZero: c.chess.ram.some((v) => v !== 0)};
}

const res = {};
for (const std of ['PAL', 'NTSC']) {
  res[std] = play(std);
  console.log(std + ': byte di risposta per mossa ' + res[std].replies.join(', '));
  if (std === 'PAL') {
    res[std].replies.forEach((n, i) => ok(n >= 8, std + ': il motore risponde alla mossa ' + (i + 1) + ' (' + n + ' byte)'));
    ok(res[std].ramNonZero, std + ': la RAM del modulo e\' stata usata');
  }
  ok(res[std].same, std + ': salvataggio e ripresa a meta\' partita deterministici');
}
console.log(fails ? ('FALLITI ' + fails + ' su ' + checks) : ('TUTTO OK (' + checks + ' controlli)'));
process.exit(fails ? 1 : 0);
