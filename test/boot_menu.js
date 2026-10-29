'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// boot_menu.js DUMPS [REF_DIR]  - avvia IN DIRETTA il BIOS (e una cartuccia) nel nucleo JS con la console minima di prova
// (stub_console.js), dal reset fino al menu e dentro il gioco, e controlla:
//   1. che il BIOS arrivi all'anello di attesa del tasto (0x176-0x17A) e ci resti;
//   2. che, premuto un tasto, parta la cartuccia (anello di attesa del raggio 0x71E-0x727 della cartuccia di prova);
//   3. (se REF_DIR e' dato) che lo stato dopo OGNI istruzione coincida con quello del modello Python senza grafica (replay.py --live).
const fs = require('fs');
const path = require('path');
const {CPU8048} = require(process.env.O2_CPU_PATH || path.join(__dirname, '..', 'src', 'cpu8048.js'));
const {StubConsole} = require('./stub_console.js');
const {checksum, hashVec} = require('./lib_case.js');

function cpuVec(c, op, cyc) {
  return [op, cyc, c.pc, c.a, c.psw, c.f1, c.a11 ? 1 : 0, c.timer, c.prescaler, c.tf, c.tirqEn, c.xirqEn, c.inProgress,
    c.timerPend, c.timerEn, c.counterEn, c.p1, c.p2, c.bus, c.exp[0], c.exp[1], c.exp[2], c.exp[3], c.now, c.t1Prev,
    checksum(c.ram)];
}

function loadImage(biosPath, cartPath) {
  const img = new Uint8Array(4096);
  img.set(fs.readFileSync(biosPath).subarray(0, 4096), 0);
  img.set(fs.readFileSync(cartPath).subarray(0, 4096 - 0x400), 0x400);
  return img;
}

const [, , dumps, refDir] = process.argv;
const SCEN = [['bios/o2rom.bin', 'blockout.bin', 'live_o2_blockout']];
const FRAMES = 100, KEY_ON = 30, KEY_OFF = 34;
let fails = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails++; };

for (const [bios, cart, name] of SCEN) {
  const con = new StubConsole(loadImage(path.join(dumps, bios), path.join(dumps, cart)));
  const cpu = new CPU8048(con);
  con.cpu = cpu;
  const frameCycles = Math.floor(con.t.frame / con.t.dpc);
  const ref = refDir ? (() => { const b = fs.readFileSync(path.join(refDir, name + '.dig')); return new Uint32Array(b.buffer, b.byteOffset, b.length >> 2); })() : null;
  let step = 0, firstDiff = -1;
  const inMenuLoop = new Array(FRAMES).fill(0), inGame = new Array(FRAMES).fill(0), steps = new Array(FRAMES).fill(0);
  for (let fr = 0; fr < FRAMES; fr++) {
    if (fr === KEY_ON) con.keyRows.fill(0x01);
    if (fr === KEY_OFF) con.keyRows.fill(0);
    const end = cpu.now + frameCycles;
    while (cpu.now < end) {
      const pc0 = cpu.pc;
      const cyc = cpu.step();
      steps[fr]++;
      if (pc0 >= 0x176 && pc0 <= 0x17A) inMenuLoop[fr]++;
      if (pc0 >= 0x71E && pc0 <= 0x727) inGame[fr]++;      // anello di attesa del raggio della cartuccia di prova
      if (ref && firstDiff < 0) {
        if (hashVec(cpuVec(cpu, cpu.lastOp, cyc)) !== ref[step]) firstDiff = step;
      }
      step++;
    }
  }
  const frac = (arr, a, b) => { let s = 0, n = 0; for (let i = a; i < b; i++) { s += arr[i]; n += steps[i]; } return s / n; };
  console.log(name + ': ' + step + ' istruzioni, ' + cpu.now + ' cicli, PC finale ' + cpu.pc.toString(16));
  check(frac(inMenuLoop, 10, KEY_ON) > 0.8, 'dal fotogramma 10 al 29 il BIOS passa ' + (100 * frac(inMenuLoop, 10, KEY_ON)).toFixed(1) + '% delle istruzioni nell\'anello di attesa del tasto (0x176-0x17A)');
  check(frac(inGame, 10, KEY_ON) === 0, 'prima del tasto il gioco non parte (nessuna istruzione nell\'anello 0x71E-0x727 della cartuccia)');
  check(frac(inGame, 40, FRAMES) > 0.4, 'dopo il tasto la cartuccia gira: ' + (100 * frac(inGame, 40, FRAMES)).toFixed(1) + '% delle istruzioni nell\'anello di attesa del raggio 0x71E-0x727');
  if (ref) check(firstDiff < 0 && step === ref.length, 'stato identico al modello Python dopo ogni istruzione (' + step + ' istruzioni)' + (firstDiff >= 0 ? ', prima differenza all\'istruzione #' + firstDiff : ''));
}
console.log(fails ? 'FALLITO: ' + fails + ' controlli' : 'OK');
process.exit(fails ? 1 : 0);
