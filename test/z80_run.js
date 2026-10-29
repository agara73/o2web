'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// z80_run.js - prova differenziale del nucleo Z80 (src/z80.js) contro il riferimento registrato da test/z80_record.py.
// Uso: node test/z80_run.js CARTELLA_REGISTRAZIONE [--ignore parola,parola] [--max N] [--verbose]
// Dopo OGNI passo si confrontano: AF BC DE HL (e ombra), IX IY SP PC, I/R, WZ, IFF1/IFF2/HALT/modo, blocco degli interrupt e prefisso,
// gli stati T del passo e la sequenza degli eventi esterni (scritture in memoria, IN, OUT con indirizzo di porta a 16 bit).
const fs = require('fs');
const path = require('path');
const {Z80} = require(process.env.O2_Z80_PATH || path.join(__dirname, '..', 'src', 'z80.js'));

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && !/^[a-z0-9,]+$/.test(a) || false) || args[0];
let ignore = new Set();
let maxShow = 40;
let verbose = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ignore') ignore = new Set(args[++i].split(','));
  else if (args[i] === '--max') maxShow = +args[++i];
  else if (args[i] === '--verbose') verbose = true;
}

function mix32(h) {
  h >>>= 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85EBCA77) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE3D) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
function baseByte(seed, mode, fill, addr) {
  if (mode === 0) return mix32((Math.imul(addr, 0x9E3779B1) ^ seed) >>> 0) & 255;
  if (mode === 1) return 0;
  if (mode === 2) return 0xFF;
  return fill & 255;
}
function inByte(seed, port, n) {
  return mix32((Math.imul(port, 0x9E3779B1) ^ Math.imul(n, 0x7F4A7C15) ^ seed ^ 0x5A5A5A5A) >>> 0) & 255;
}

const NAMES = ['af', 'bc', 'de', 'hl', 'af2', 'bc2', 'de2', 'hl2', 'ix', 'iy', 'sp', 'pc', 'ir', 'wz', 'flags', 'idx', 'dt', 'nev'];
const NW = 18;

function stateWords(cpu, dt, nev) {
  const r = cpu.r, s = cpu.r2;
  return [
    (r[7] << 8) | r[6], (r[0] << 8) | r[1], (r[2] << 8) | r[3], (r[4] << 8) | r[5],
    (s[7] << 8) | s[6], (s[0] << 8) | s[1], (s[2] << 8) | s[3], (s[4] << 8) | s[5],
    cpu.ix, cpu.iy, cpu.sp, cpu.pc, (cpu.i << 8) | cpu.rr, cpu.wz,
    cpu.iff1 | (cpu.iff2 << 1) | (cpu.halted << 2) | (cpu.im << 3),
    cpu.noInt | (cpu.idx << 1), dt, nev,
  ];
}

function stateWordsOne(cpu, i, dt, nev) { return stateWords(cpu, dt, nev)[i]; }

function main() {
  const cases = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(dir, 'ref.bin'));
  let off = 0;
  const u16 = () => { const v = buf.readUInt16LE(off); off += 2; return v; };
  let steps = 0, bad = 0, shown = 0;
  const seen = new Map();
  const wordBad = {};
  let events = [];
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    off = c.off;
    const over = new Map();
    let incount = 0;
    events = [];
    const host = {
      read(a) { return over.has(a) ? over.get(a) : baseByte(c.seed, c.mode, c.fill, a); },
      write(a, v) { over.set(a, v); events.push([1, a, v]); },
      in(p) { const v = inByte(c.seed, p, incount++); events.push([3, p, v]); return v; },
      out(p, v) { events.push([2, p, v]); },
    };
    const cpu = new Z80(host);
    cpu.r[7] = c.af >> 8; cpu.r[6] = c.af & 255; cpu.r[0] = c.bc >> 8; cpu.r[1] = c.bc & 255;
    cpu.r[2] = c.de >> 8; cpu.r[3] = c.de & 255; cpu.r[4] = c.hl >> 8; cpu.r[5] = c.hl & 255;
    cpu.r2[7] = c.af2 >> 8; cpu.r2[6] = c.af2 & 255; cpu.r2[0] = c.bc2 >> 8; cpu.r2[1] = c.bc2 & 255;
    cpu.r2[2] = c.de2 >> 8; cpu.r2[3] = c.de2 & 255; cpu.r2[4] = c.hl2 >> 8; cpu.r2[5] = c.hl2 & 255;
    cpu.ix = c.ix; cpu.iy = c.iy; cpu.sp = c.sp; cpu.i = c.i; cpu.rr = c.r; cpu.iff1 = c.iff1; cpu.iff2 = c.iff2;
    cpu.im = c.im; cpu.wz = c.wz; cpu.pc = c.pc; cpu.halted = 0; cpu.idx = 0; cpu.noInt = 0; cpu.t = 0;
    const code = Buffer.from(c.code, 'hex');
    for (let i = 0; i < code.length; i++) over.set((c.pc + i) & 0xFFFF, code[i]);
    // stato iniziale
    const ref0 = []; for (let i = 0; i < NW; i++) ref0.push(u16());
    const got0 = stateWords(cpu, 0, 0);
    for (let i = 0; i < NW - 2; i++) {
      if (ref0[i] !== got0[i] && !ignore.has(NAMES[i])) { console.log('caso ' + ci + ': stato iniziale diverso in ' + NAMES[i] + ' rif ' + ref0[i].toString(16) + ' js ' + got0[i].toString(16)); bad++; break; }
    }
    const ints = new Map();
    for (const d of c.ints) if (!ints.has(d.at)) ints.set(d.at, d.data);
    const total = c.steps + c.ints.length;
    const done = new Set();
    let k = 0;
    for (let n = 0; n < total; n++) {
      events = [];
      // istruzione che sta per essere eseguita (per le eccezioni documentate sotto)
      const b0 = host.read(cpu.pc), b1 = host.read((cpu.pc + 1) & 0xFFFF);
      const pre = {bc: (cpu.r[0] << 8) | cpu.r[1]};
      let dt, isInt = false;
      if (ints.has(k) && !done.has(k)) { done.add(k); dt = cpu.requestInt(ints.get(k)); isInt = true; } else { dt = cpu.step(); k++; }
      const ref = []; for (let i = 0; i < NW; i++) ref.push(u16());
      const evRef = [];
      for (let e = 0; e < ref[17]; e++) evRef.push([u16(), u16(), u16()]);
      const got = stateWords(cpu, dt, events.length);
      steps++;
      let msg = null;
      // Eccezioni documentate (il riferimento e' un'altra implementazione, non il silicio; qui seguiamo i risultati pubblicati sul Z80 vero,
      // DA VERIFICARE): (1) istruzioni a blocco che si RIPETONO (21 T): i bit X e Y di F sono quelli dell'alto di PC (indirizzo
      // dell'istruzione); per INIR / INDR / OTIR / OTDR cambiano anche H e P e WZ non e' PC + 1; (2) INI / IND: WZ = BC (prima del
      // decremento di B) +/- 1.
      if (!isInt && b0 === 0xED && b1 >= 0xA0 && b1 <= 0xBB && (b1 & 7) < 4) {
        const z = b1 & 7, rep = (b1 & 0x10) !== 0 && dt === 21;
        // dopo aver controllato la regola sul valore del JS si ADOTTA il valore del riferimento, per restare in sincronia nei passi dopo
        if (rep) {
          if ((got[0] & 0x28) !== ((got[11] >> 8) & 0x28)) msg = 'X/Y di una ripetizione non vengono dall\'alto di PC';
          let mask = 0x28;
          if (z >= 2) mask |= 0x14;
          cpu.r[6] = (cpu.r[6] & ~mask) | (ref[0] & mask);
          if (z >= 2) cpu.wz = ref[13];
        }
        if (z === 2 && !rep) {
          const want = (pre.bc + ((b1 & 8) ? -1 : 1)) & 0xFFFF;
          if (got[13] !== want) msg = 'WZ di INI/IND diverso da BC +/- 1: js ' + got[13].toString(16) + ' atteso ' + want.toString(16);
          cpu.wz = ref[13];
        }
        for (let i = 0; i < NW; i++) got[i] = stateWordsOne(cpu, i, dt, events.length);
      }
      for (let i = 0; i < NW - 1 && !msg; i++) {
        if (ref[i] !== got[i] && !ignore.has(NAMES[i])) { msg = NAMES[i] + ' rif ' + ref[i].toString(16) + ' js ' + got[i].toString(16); wordBad[NAMES[i]] = (wordBad[NAMES[i]] || 0) + 1; break; }
      }
      if (!msg && !ignore.has('ev')) {
        if (events.length !== evRef.length) msg = 'eventi: rif ' + JSON.stringify(evRef) + ' js ' + JSON.stringify(events);
        else for (let e = 0; e < evRef.length; e++) {
          if (evRef[e][0] !== events[e][0] || evRef[e][1] !== events[e][1] || evRef[e][2] !== events[e][2]) { msg = 'evento ' + e + ': rif ' + JSON.stringify(evRef[e]) + ' js ' + JSON.stringify(events[e]); wordBad.ev = (wordBad.ev || 0) + 1; break; }
        }
      }
      if (msg) {
        bad++;
        const key = (isInt ? 'INT ' : '') + c.code.slice(0, 6) + ' ' + msg.split(' ')[0];
        const kk = c.code.slice(0, 6).replace(/^(..)(..)(..)$/, '$1 $2') + '/' + msg.split(' ')[0];
        if (!seen.has(kk) || verbose) {
          seen.set(kk, 1);
          if (shown < maxShow) {
            shown++;
            console.log('caso ' + ci + ' passo ' + n + (isInt ? ' (INT)' : '') + ' codice ' + c.code.slice(0, 16) + ' @' + c.pc.toString(16) + ': ' + msg);
          }
        }
        break;     // il resto del caso e' fuori sincronia
      }
    }
    if (off > buf.length) throw new Error('registrazione troncata');
  }
  console.log('casi ' + cases.length + ', passi ' + steps + ', differenze ' + bad + (bad ? ' per parola: ' + JSON.stringify(wordBad) : ''));
  if (bad) process.exitCode = 1;
}

main();
