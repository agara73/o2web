'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// replay_run.js DIR DUMPS  - riproduce le registrazioni di replay.py sul nucleo JavaScript.
// Il nucleo gira con un ambiente che restituisce i valori registrati; ogni richiesta deve coincidere (tipo, indirizzo, valore
// scritto, tempo, latch P1/P2) e dopo ogni istruzione l'hash dello stato deve coincidere con quello del riferimento.
const fs = require('fs');
const path = require('path');
const {CPU8048} = require(process.env.O2_CPU_PATH || path.join(__dirname, '..', 'src', 'cpu8048.js'));   // O2_CPU_PATH: solo per la prova di mutazione
const {checksum, hashVec} = require('./lib_case.js');

class ReplayHost {
  constructor(image, log) {
    this.prog = image;
    this.log = log;
    this.pos = 0;
    this.cpu = null;
  }
  take(kind, arg, wval) {
    const L = this.log, i = this.pos * 6, c = this.cpu;
    if (i + 5 >= L.length) throw new Error('il riferimento non ha altre interazioni (JS ne chiede una in piu): tipo ' + kind);
    this.pos++;
    const exp = [L[i], L[i + 1], L[i + 3], L[i + 4], L[i + 5]];
    const got = [kind, arg, c.now >>> 0, c.p1, c.p2];
    if (wval !== undefined && L[i + 2] !== wval) got[0] = -1;
    for (let k = 0; k < 5; k++) {
      if (exp[k] !== got[k]) {
        throw new Error('interazione #' + (this.pos - 1) + ' diversa: riferimento [tipo,arg,now,P1,P2]=' + exp + ' JS=' + got +
          (wval !== undefined ? ' (valore scritto ref=' + L[i + 2] + ' js=' + wval + ')' : ''));
      }
    }
    return L[i + 2];
  }
  readProg(a) { return this.prog[a & 0xFFF]; }
  intActive() { return this.take(1, 0); }
  t0() { return this.take(2, 0); }
  t1() { return this.take(3, 0); }
  p1Pin() { return this.take(4, 0); }
  p2Pin() { return this.take(5, 0); }
  busPin() { return this.take(6, 0); }
  movxRead(a) { return this.take(7, a & 0xFF); }
  movxWrite(a, v) { this.take(8, a & 0xFF, v & 0xFF); }
  sync() {}
}

function cpuVec(c, op, cyc) {
  return [op, cyc, c.pc, c.a, c.psw, c.f1, c.a11 ? 1 : 0, c.timer, c.prescaler, c.tf, c.tirqEn, c.xirqEn, c.inProgress,
    c.timerPend, c.timerEn, c.counterEn, c.p1, c.p2, c.bus, c.exp[0], c.exp[1], c.exp[2], c.exp[3], c.now, c.t1Prev,
    checksum(c.ram)];
}

function loadImage(biosPath, cartPath) {
  const img = new Uint8Array(4096);
  const b = fs.readFileSync(biosPath), c = fs.readFileSync(cartPath);
  img.set(b.subarray(0, 4096), 0);
  img.set(c.subarray(0, 4096 - 0x400), 0x400);
  return img;
}

const u32 = (file) => { const b = fs.readFileSync(file); return new Uint32Array(b.buffer, b.byteOffset, b.length >> 2); };

function main() {
  const [, , dir, dumps] = process.argv;
  let fails = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const log = u32(path.join(dir, meta.name + '.log')), dig = u32(path.join(dir, meta.name + '.dig'));
    const host = new ReplayHost(loadImage(path.join(dumps, meta.bios), path.join(dumps, meta.cart)), log);
    const cpu = new CPU8048(host);
    host.cpu = cpu;
    let msg = 'OK';
    let step = 0;
    try {
      for (; step < meta.steps; step++) {
        const cyc = cpu.step();
        const h = hashVec(cpuVec(cpu, cpu.lastOp, cyc));
        if (h !== dig[step]) {
          msg = 'FALLITO: stato diverso dopo l\'istruzione #' + step + ' (opcode ' + cpu.lastOp.toString(16) + ', PC ' + cpu.pc.toString(16) + ', now ' + cpu.now + ')';
          break;
        }
      }
      if (msg === 'OK' && host.pos * 6 !== log.length) msg = 'FALLITO: interazioni consumate ' + host.pos + ' su ' + log.length / 6;
    } catch (e) {
      msg = 'FALLITO: ' + e.message + ' (istruzione #' + step + ')';
    }
    if (msg !== 'OK') fails++;
    console.log(meta.name.padEnd(16) + String(meta.steps).padStart(8) + ' istruzioni, ' + String(log.length / 6).padStart(8) + ' interazioni: ' + msg);
  }
  console.log(fails ? 'FALLITO: ' + fails + ' scenari' : 'OK: tutti gli scenari coincidono');
  process.exit(fails ? 1 : 0);
}

main();
