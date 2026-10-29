'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// chess_run.js - prova DIFFERENZIALE del modulo scacchi C7010 collegato alla console: rifa con src/console.js + src/chessmod.js + src/z80.js lo scambio
// registrato da test/chess_record.py (riferimento Python indipendente: ref8048 + o2hw + hw/chessmod_ref.py + Z80 del pacchetto `z80`) e confronta
// OGNI evento (ogni MOVX con latch e P1, ogni IN / OUT dello Z80, nell'ordine) e lo stato finale, in PAL e NTSC.
// Uso: node test/chess_run.js CARTELLA   (O2_SRC_DIR = copia guastata dalla prova di mutazione)
const fs = require('fs');
const path = require('path');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');
const {Console} = require(path.join(SRC, 'console.js'));
const {sha256} = require(path.join(SRC, 'sha256.js'));
const {EXPECTED} = require('./chess_testrom.js');

const dir = process.argv[2];
if (!dir) { console.log('uso: node test/chess_run.js CARTELLA'); process.exit(2); }
const ref = JSON.parse(fs.readFileSync(path.join(dir, 'chess_ref.json'), 'utf8'));
const bios = new Uint8Array(fs.readFileSync(path.join(dir, 'bios8048.bin')));
const rom = new Uint8Array(fs.readFileSync(path.join(dir, 'z80rom.bin')));
let fails = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails++; };

function rle(ev) {
  const out = [];
  for (const e of ev) {
    const last = out[out.length - 1];
    if (last && last[0].length === e.length && last[0].every((v, i) => v === e[i])) last[1]++;
    else out.push([e, 1]);
  }
  return out;
}

for (const std of ['PAL', 'NTSC']) {
  const r = ref[std];
  const c = new Console({bios, cart: null, charset: new Uint8Array(512), standard: std, chessRom: rom});
  const m = c.chess, ev = [];
  const rd = m.read8048.bind(m), wr = m.write8048.bind(m), zi = m.in.bind(m), zo = m.out.bind(m);
  m.read8048 = (a, p1) => { const v = rd(a, p1); ev.push(['R', a, p1, v]); return v; };
  m.write8048 = (a, v, p1) => { ev.push(['W', a, v & 255, p1]); return wr(a, v, p1); };
  m.in = (port) => { const v = zi(port); ev.push(['zI', port & 0xFFFF, v]); return v; };
  m.out = (port, v) => { ev.push(['zO', port & 0xFFFF, v & 255]); return zo(port, v); };
  c.runCycles(ref.cycles);
  const mine = rle(ev), want = r.events;
  let first = -1;
  for (let i = 0; i < Math.max(mine.length, want.length); i++) {
    if (JSON.stringify(mine[i]) !== JSON.stringify(want[i])) { first = i; break; }
  }
  check(first < 0, std + ': ' + want.length + ' righe di eventi uguali al riferimento' + (first < 0 ? '' : ' (prima differenza alla riga ' + first + ': ' + JSON.stringify(mine[first]) + ' contro ' + JSON.stringify(want[first]) + ')'));
  check(JSON.stringify(Array.from(c.xram)) === JSON.stringify(r.xram), std + ': RAM esterna dell\'8048 uguale');
  check(JSON.stringify(Array.from(c.xram.subarray(0, EXPECTED.length))) === JSON.stringify(EXPECTED), std + ': e uguale ai risultati attesi del programma di prova');
  check(sha256(m.ram).length > 0 && require('crypto').createHash('sha256').update(Buffer.from(m.ram)).digest('hex') === r.ramSha, std + ': RAM del modulo uguale');
  check(m.latch0 === r.latch0 && m.latch1 === r.latch1 && m.running === r.running, std + ': latch e reset uguali');
  check(m.cpu.pc === r.z80pc && m.cpu.t === r.z80t && m.target === r.target && c.cpu.now === r.now, std + ': PC (' + m.cpu.pc.toString(16) + ') e tempo dello Z80 (' + m.cpu.t + ' T), bersaglio e tempo dell\'8048 (' + c.cpu.now + ') uguali');
}
console.log(fails ? '\nPROVE FALLITE: ' + fails : '\nTUTTO OK');
process.exit(fails ? 1 : 0);
