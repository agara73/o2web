'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// lib_case.js - ambiente di prova generico (equivalente di ref8048.Env) e stato completo per i test differenziali.
// Le liste dei campi e la funzione di hash sono identiche a quelle di difftest.py.

const path = require('path');
const CPU_PATH = process.env.O2_CPU_PATH || path.join(__dirname, '..', 'src', 'cpu8048.js');   // O2_CPU_PATH: solo per la prova di mutazione
const {CPU8048} = require(CPU_PATH);

const NAMES = ['op', 'cyc', 'pc', 'a', 'psw', 'f1', 'a11', 'timer', 'prescaler', 'tf', 'tirq_en', 'xirq_en', 'in_progress',
  'timer_pend', 'timer_en', 'counter_en', 'p1', 'p2', 'bus', 'exp0', 'exp1', 'exp2', 'exp3', 'now', 't1_prev', 'ram_ck',
  'xram_ck', 'int_active', 't0', 't1', 'p1_pin', 'p2_pin', 'bus_pin', 'ev_i'];

function checksum(arr) {
  let h = 0;
  for (let i = 0; i < arr.length; i++) h = (Math.imul(h, 31) + arr[i] + 1) >>> 0;
  return h;
}

function hexBytes(s) {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
  return out;
}

class TestEnv {
  constructor(c) {
    this.prog = new Uint8Array(4096);
    for (const [addr, hex] of c.prog) this.prog.set(hexBytes(hex), addr);
    this.xram = hexBytes(c.env.xram);
    this.intv = c.env.int_active;
    this.t0v = c.env.t0;
    this.t1v = c.env.t1;
    this.p1v = c.env.p1_pin;
    this.p2v = c.env.p2_pin;
    this.busv = c.env.bus_pin;
    this.events = c.events;
    this.evI = 0;
  }
  readProg(a) { return this.prog[a & 0xFFF]; }
  t0() { return this.t0v; }
  t1() { return this.t1v; }
  intActive() { return this.intv; }
  p1Pin() { return this.p1v; }
  p2Pin() { return this.p2v; }
  busPin() { return this.busv; }
  movxRead(a) { return this.xram[a & 0xFF]; }
  movxWrite(a, v) { this.xram[a & 0xFF] = v & 0xFF; }
  sync(cpu) {
    while (this.evI < this.events.length && this.events[this.evI][0] <= cpu.now) {
      const [, i, t0, t1, p1, p2, bus] = this.events[this.evI++];
      this.intv = i;
      this.t0v = t0;
      this.p1v = p1;
      this.p2v = p2;
      this.busv = bus;
      cpu.t1Changed(t1);
      this.t1v = t1;
    }
  }
}

function makeMachine(c) {
  const env = new TestEnv(c);
  const cpu = new CPU8048(env);
  const s = c.cpu;
  if (c.reset) return {cpu, env};                 // caso "dopo il reset": nessuna sovrascrittura dello stato
  cpu.a = s.a; cpu.pc = s.pc; cpu.psw = s.psw; cpu.f1 = s.f1; cpu.a11 = s.a11;
  cpu.ram.set(hexBytes(s.ram));
  cpu.timer = s.timer; cpu.prescaler = s.prescaler; cpu.timerEn = s.timer_en; cpu.counterEn = s.counter_en;
  cpu.tf = s.tf; cpu.tirqEn = s.tirq_en; cpu.xirqEn = s.xirq_en; cpu.inProgress = s.in_progress;
  cpu.timerPend = s.timer_pend; cpu.p1 = s.p1; cpu.p2 = s.p2; cpu.bus = s.bus;
  for (let i = 0; i < 4; i++) cpu.exp[i] = s.exp[i];
  cpu.now = s.now; cpu.t1Prev = s.t1_prev;
  return {cpu, env};
}

function fullState(cpu, env, op, cyc) {
  return [op, cyc, cpu.pc, cpu.a, cpu.psw, cpu.f1, cpu.a11 ? 1 : 0, cpu.timer, cpu.prescaler, cpu.tf, cpu.tirqEn, cpu.xirqEn,
    cpu.inProgress, cpu.timerPend, cpu.timerEn, cpu.counterEn, cpu.p1, cpu.p2, cpu.bus, cpu.exp[0], cpu.exp[1], cpu.exp[2],
    cpu.exp[3], cpu.now, cpu.t1Prev, checksum(cpu.ram), checksum(env.xram), env.intv, env.t0v, env.t1v, env.p1v, env.p2v,
    env.busv, env.evI];
}

function hashVec(v) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < v.length; i++) {
    // ogni campo dello stato deve essere un intero ben definito (JavaScript tratterebbe undefined/NaN come 0 nelle operazioni sui bit)
    if (!Number.isInteger(v[i])) throw new Error('campo dello stato non intero (indice ' + i + ', valore ' + v[i] + ')');
    h = Math.imul(h ^ (v[i] >>> 0), 16777619) >>> 0;
  }
  return h;
}

// esegue un caso; ritorna la lista dei digest (uno per istruzione) oppure dei vettori completi
function runCase(c, vectors) {
  const {cpu, env} = makeMachine(c);
  const out = [];
  for (let i = 0; i < c.steps; i++) {
    const cyc = cpu.step();
    const v = fullState(cpu, env, cpu.lastOp, cyc);
    out.push(vectors ? v : hashVec(v));
  }
  return out;
}

module.exports = {NAMES, TestEnv, makeMachine, fullState, hashVec, runCase, checksum, hexBytes};
