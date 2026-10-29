'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_api.js - prove dell'interfaccia del nucleo che i test differenziali non toccano: valori dopo il reset, tutti i 256 opcode
// eseguibili senza eccezioni, runUntil() equivalente a una sequenza di step(), nessun campo di stato non definito.
const path = require('path');
const {CPU8048, CYCLES, ILLEGAL} = require(process.env.O2_CPU_PATH || path.join(__dirname, '..', 'src', 'cpu8048.js'));
const i48 = require(path.join(__dirname, '..', 'ref', 'i48.js'));

let fails = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails++; };

class Host {
  constructor(seed) { this.s = seed >>> 0; this.prog = new Uint8Array(4096); for (let i = 0; i < 4096; i++) this.prog[i] = this.rnd() & 0xFF; }
  rnd() { this.s ^= this.s << 13; this.s >>>= 0; this.s ^= this.s >>> 17; this.s ^= this.s << 5; this.s >>>= 0; return this.s; }
  readProg(a) { return this.prog[a & 0xFFF]; }
  t0() { return 0; } t1() { return 1; } intActive() { return 0; }
  p1Pin() { return 0xFF; } p2Pin() { return 0xFF; } busPin() { return 0xFF; }
  movxRead() { return 0x5A; } movxWrite() {}
  sync() {}
}

// 1. valori dopo il reset
{
  const c = new CPU8048(new Host(1));
  const z = ['a', 'pc', 'psw', 'f1', 'a11', 'timer', 'prescaler', 'timerEn', 'counterEn', 'tf', 'tirqEn', 'xirqEn', 'inProgress',
    'timerPend', 'now', 't1Prev', 'lastOp'];
  check(z.every((k) => c[k] === 0), 'dopo il reset tutti i registri e i flag valgono 0');
  check(c.p1 === 0xFF && c.p2 === 0xFF && c.bus === 0xFF, 'dopo il reset P1, P2 e BUS valgono 0xFF');
  check(c.ram.length === 64 && c.ram.every((v) => v === 0) && c.exp.length === 4 && c.exp.every((v) => v === 0), 'RAM interna da 64 byte azzerata, espansore P4-P7 a 0');
}

// 2. tutti gli opcode si eseguono; tabelle uguali a ref/i48.js (a sua volta verificata contro Python e dis48)
{
  let bad = [], tab = [];
  for (let op = 0; op < 256; op++) {
    const h = new Host(op + 7);
    h.prog[0] = op;
    const c = new CPU8048(h);
    try { c.step(); } catch (e) { bad.push(op.toString(16) + ':' + e.message); }
    if (CYCLES[op] !== i48.cycles(op) || ILLEGAL[op] !== (i48.ILLEGAL.has(op) ? 1 : 0)) tab.push(op.toString(16));
  }
  check(bad.length === 0, 'tutti i 256 opcode si eseguono senza eccezioni ' + bad.slice(0, 3));
  check(tab.length === 0, 'cicli e opcode illegali coincidono con ref/i48.js per tutti i 256 opcode ' + tab.slice(0, 5));
}

// 3. runUntil == step ripetuti; 4. nessun campo non definito dopo molte istruzioni
{
  const snap = (c) => [c.pc, c.a, c.psw, c.f1, c.a11, c.timer, c.prescaler, c.tf, c.p1, c.p2, c.bus, c.now, c.lastOp, Array.from(c.ram).join(','), Array.from(c.exp).join(',')].join('|');
  let same = true, near = true, noop = true, defined = true;
  for (let seed = 1; seed <= 40; seed++) {
    const a = new CPU8048(new Host(seed)), b = new CPU8048(new Host(seed));
    const limit = 50 + seed * 37;
    a.runUntil(limit);
    while (b.now < limit) b.step();
    if (snap(a) !== snap(b)) same = false;
    if (!(a.now >= limit && a.now < limit + 2)) near = false;
    const before = snap(a);
    a.runUntil(limit);
    a.runUntil(limit - 10);
    if (snap(a) !== before) noop = false;
    for (const k of ['a', 'pc', 'psw', 'f1', 'a11', 'timer', 'prescaler', 'tf', 'tirqEn', 'xirqEn', 'inProgress', 'timerPend', 'timerEn',
      'counterEn', 'p1', 'p2', 'bus', 'now', 't1Prev', 'lastOp']) if (!Number.isInteger(a[k])) defined = false;
  }
  check(same, 'runUntil(n) lascia la CPU nello stato di una sequenza di step() fino a now >= n');
  check(near, 'runUntil(n) si ferma entro 1 ciclo oltre il limite');
  check(noop, 'runUntil con now gia\' oltre il limite non esegue nulla');
  check(defined, 'tutti i campi di stato sono interi ben definiti');
}

console.log(fails ? 'FALLITO: ' + fails + ' controlli' : 'OK');
process.exit(fails ? 1 : 0);
