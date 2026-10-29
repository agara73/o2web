'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// zex_run.js - esegue gli esercizi ZEXDOC / ZEXALL (Frank Cringle / Yaze, GPL) sul nucleo Z80 con un CP/M minimo (BDOS 2 e 9).
// Sono programmi di terzi che confrontano il CRC dei flag e dei risultati di ogni istruzione con quello del Z80 vero: NON fanno
// parte del progetto, si portano da fuori (per esempio dal repository superzazu/z80, cartella roms/) e restano in locale.
// Uso: node test/zex_run.js FILE.com|FILE.cim [--only testo] [--max-t N]    (circa 46,7 miliardi di stati T per file intero)
const fs = require('fs');
const {Z80} = require('../src/z80.js');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
let only = null, maxT = Infinity;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only') only = args[i + 1];
  if (args[i] === '--max-t') maxT = +args[i + 1];
}
if (!file) { console.log('uso: node test/zex_run.js FILE.com [--only testo] [--max-t N]'); process.exit(2); }

const mem = new Uint8Array(65536);
const prog = fs.readFileSync(file);
mem.set(prog, 0x100);
mem[0] = 0xC3; mem[1] = 0x00; mem[2] = 0x00;       // warm boot a 0: fine
mem[5] = 0xC9;                                      // BDOS: RET (gestito dall'ambiente)
let out = '';
const host = {read: (a) => mem[a], write: (a, v) => { mem[a] = v; }, in: () => 0xFF, out: () => {}};
const cpu = new Z80(host);
cpu.reset();
cpu.pc = 0x100;
cpu.sp = 0xF000;
let lineBuf = '';
function flush(ch) {
  if (ch === '\n') { console.log(lineBuf); lineBuf = ''; } else if (ch !== '\r') lineBuf += ch;
}
const t0 = Date.now();
let steps = 0;
let ok = true;
for (;;) {
  if (cpu.pc === 5) {
    const c = cpu.r[1];
    if (c === 2) flush(String.fromCharCode(cpu.r[3]));
    else if (c === 9) {
      for (let a = (cpu.r[2] << 8) | cpu.r[3]; mem[a] !== 0x24; a++) flush(String.fromCharCode(mem[a]));
    }
    // RET
    cpu.pc = mem[cpu.sp] | (mem[cpu.sp + 1] << 8); cpu.sp = (cpu.sp + 2) & 0xFFFF;
    cpu.t += 10;
    continue;
  }
  if (cpu.pc === 0) break;
  cpu.step();
  if (cpu.t > maxT) { console.log('(fermato a ' + cpu.t + ' stati T)'); break; }
}
if (lineBuf) console.log(lineBuf);
const sec = (Date.now() - t0) / 1000;
console.log('stati T ' + cpu.t + ', ' + sec.toFixed(1) + ' s, ' + (cpu.t / sec / 1e6).toFixed(1) + ' MT/s');
