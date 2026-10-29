'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// bench.js DUMPS  - misura la velocita' del nucleo con la console minima di prova (nessuna ottimizzazione: solo una misura).
// Servono circa 394000 cicli macchina al secondo (PAL) per andare in tempo reale.
const fs = require('fs');
const path = require('path');
const {CPU8048} = require('../src/cpu8048.js');
const {StubConsole} = require('./stub_console.js');
const dumps = process.argv[2];
const img = new Uint8Array(4096);
img.set(fs.readFileSync(path.join(dumps, 'bios/o2rom.bin')).subarray(0, 1024), 0);
img.set(fs.readFileSync(path.join(dumps, 'blockout.bin')).subarray(0, 3072), 0x400);
const con = new StubConsole(img);
const cpu = new CPU8048(con);
con.cpu = cpu;
const warm = 400000;
cpu.runUntil(warm);                                   // il BIOS arriva al menu
con.keyRows.fill(0x01);
cpu.runUntil(warm + 40000);
con.keyRows.fill(0);
const SIM = 20000000;                                 // cicli da simulare (circa 51 secondi di console PAL)
const t0 = process.hrtime.bigint();
const c0 = cpu.now;
cpu.runUntil(c0 + SIM);
const dt = Number(process.hrtime.bigint() - t0) / 1e9;
const cps = (cpu.now - c0) / dt;
console.log('cicli simulati: ' + (cpu.now - c0) + ' in ' + dt.toFixed(2) + ' s -> ' + (cps / 1e6).toFixed(1) + ' milioni di cicli macchina al secondo');
console.log('margine rispetto al tempo reale PAL (394100 cicli/s): x' + (cps / 394100).toFixed(0));
