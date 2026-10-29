'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// stub_console.js - console MINIMA solo per i test della tappa 1: abbastanza hardware perche' il BIOS e le cartucce girino dal
// reset al menu e dentro i giochi (tempo del raggio, /INT e T1 dal tempo, registri del chip video come memoria con le regole di
// specchio e di lettura, RAM 6810, tastiera a 74148, joystick). NON disegna nulla e non calcola le collisioni.
// Non e' il codice finale: la console vera (bus, mappa della cartuccia, chip video per riga) e' la tappa 2.
// I fatti sull'hardware sono quelli di hw/o2hw.py (ricavati da sorgenti MAME/memoria: DA VERIFICARE).

const TIMING = {
  PAL: {htotal: 456, vtotal: 313, vbStart: 242, vbEnd: 312, hbStart: 366, hbEnd: 454, bgate: 414, dpc: 18},
  NTSC: {htotal: 455, vtotal: 263, vbStart: 242, vbEnd: 0, hbStart: 366, hbEnd: 453, bgate: 413, dpc: 20},
};

function keyCode(row8) {            // 74148: bit 5-7 = zeri iniziali della riga (bit 7 = priorita' piu' alta), bit 4 = 0 se c'e' un tasto
  if (row8 === 0) return 0xFF;
  let lz = 0;
  while (!(row8 & (0x80 >> lz))) lz++;
  return (lz << 5) | 0x0F;
}

class StubConsole {
  constructor(image, timing) {
    const t = timing || TIMING.PAL;
    this.t = Object.assign({}, t);
    this.t.frame = t.htotal * t.vtotal;
    this.t.irqDot = t.vbStart * t.htotal + (t.hbStart - 1);
    this.prog = image;
    this.reg = new Uint8Array(256);
    this.xram80 = new Uint8Array(0x80);
    this.ctlStatus = 0;
    this.xbeam = 0;
    this.ybeam = 0;
    this.irq = false;
    this.ev = 0;                          // pari = inizio area attiva (ignorato qui), dispari = vblank
    this.keyRows = new Uint8Array(8);
    this.joy = new Uint8Array(2);
    this.cpu = null;
  }

  // ---- tempo del chip video
  nextEventCycle() {
    const t = this.t;
    const d = Math.floor(this.ev / 2) * t.frame + ((this.ev & 1) ? t.irqDot : 0);
    return Math.ceil(d / t.dpc);
  }
  pos(cyc) {
    const t = this.t;
    const d = (cyc * t.dpc) % t.frame;
    return [Math.floor(d / t.htotal), d % t.htotal];
  }
  hblank(h) {
    const t = this.t;
    return t.hbEnd < t.hbStart ? (h >= t.hbStart || h < t.hbEnd) : (t.hbStart <= h && h < t.hbEnd);
  }
  vblank(v, h) {
    const t = this.t;
    if ((v === t.vbStart && h >= t.hbStart - 1) || (v === t.vbEnd && h <= t.hbStart - 1)) return true;
    if (t.vbEnd < t.vbStart) return v > t.vbStart || v < t.vbEnd;
    return t.vbStart < v && v < t.vbEnd;
  }
  t1At(cyc) {
    const [v, h] = this.pos(cyc);
    return (this.vblank(v, h) || this.hblank(h)) ? 1 : 0;
  }
  ybeamNow(cyc) {
    const t = this.t;
    let [v, h] = this.pos(cyc);
    if (v === 0 && h < t.hbStart) v = t.vtotal;
    if (h >= t.bgate) v += 1;
    return Math.min(v, 263);
  }
  xbeamNow(cyc) { return this.pos(cyc)[1] >> 1; }

  applyEvents(cyc) {
    while (this.nextEventCycle() <= cyc) {
      if (this.ev & 1) { this.ctlStatus |= 0x08; this.irq = true; }
      this.ev++;
    }
  }

  // ---- registri del chip video
  static mirror(off) {
    if ((off & 0xC2) === 0x40) off &= ~0x0C;
    if ((off & 0xE0) === 0xA0) off &= ~0x10;
    return off & 0xFF;
  }
  vdcRead(off, cyc) {
    off = StubConsole.mirror(off);
    const r = this.reg;
    if (off === 0xA1) {
      let d = this.ctlStatus;
      const h = this.pos(cyc)[1];
      if (h >= 225 && h < this.t.bgate && this.ybeamNow(cyc) <= this.t.vbStart) d |= 1;
      d |= r[0xA0] & 0x02;
      this.irq = false;
      this.ctlStatus &= ~0xCC;
      return d & 0xFF;
    }
    if (off === 0xA2) return 0;                                          // collisioni: non modellate in questo stub
    if (off === 0xA4) return (r[0xA0] & 0x02) ? (this.ybeamNow(cyc) & 0xFF) : this.ybeam;
    if (off === 0xA5) return (r[0xA0] & 0x02) ? (this.xbeamNow(cyc) & 0xFF) : this.xbeam;
    if (off === 0x02 || off === 0x06 || off === 0x0A || off === 0x0E || off === 0xA3 || off === 0xA7 || off === 0xA8 || off === 0xA9) return 0;
    if (off < 0x80 && (r[0xA0] & 0x20)) return 0;
    if (off >= 0xC0 && (r[0xA0] & 0x08)) return 0;
    return r[off];
  }
  vdcWrite(off, data, cyc) {
    off = StubConsole.mirror(off);
    const r = this.reg;
    data &= 0xFF;
    if (off < 0x80 && (r[0xA0] & 0x20)) return;
    if ((off >= 0xC0 && (r[0xA0] & 0x08)) || off >= 0xF0) return;
    if ((off & 0x83) === 0x03) data &= 0x0F;
    if (off >= 0x10 && (off & 0x83) === 0x00) data &= 0xFE;
    if ((off & 0xF0) === 0xD0) data &= 0x01;
    if (off === 0xA0) {
      if ((r[0xA0] & 0x02) && !(data & 0x02)) {
        this.xbeam = this.xbeamNow(cyc) & 0xFF;
        this.ybeam = this.ybeamNow(cyc) & 0xFF;
      }
    } else if (off === 0xA1 || off === 0xA4 || off === 0xA5) {
      return;
    } else if (off === 0xAA) {
      data &= 0xBF;
    } else if (off === 0x03 || off === 0x07 || off === 0x0B || off === 0x0F || off === 0xA6 || off === 0xAB || off === 0xAC ||
      off === 0xAD || off === 0xAE || off === 0xAF || (off >= 0xC9 && off <= 0xCF) || (off >= 0xD9 && off <= 0xDF) ||
      (off >= 0xEA && off <= 0xEF)) {
      return;
    }
    r[off] = data;
  }

  // ---- interfaccia dell'ambiente della CPU (vedi cpu8048.js)
  readProg(a) { return this.prog[a & 0xFFF]; }
  sync(cpu) { this.applyEvents(cpu.now); }
  intActive() { this.applyEvents(this.cpu.now); return this.irq ? 1 : 0; }
  t0() { return 0; }
  t1() { return this.t1At(this.cpu.now); }
  p1Pin() { return 0xFF; }
  p2Pin() {
    const c = this.cpu;
    let d = 0xFF;
    if (!(c.p1 & 0x04)) {
      const code = keyCode(this.keyRows[c.p2 & 7]);
      if (code !== 0xFF) d &= code;
    }
    return d;
  }
  busPin() {
    const c = this.cpu;
    let d = 0xFF;
    if (!(c.p1 & 0x04)) {
      const sel = c.p2 & 7;
      if (sel < 2) d &= ~this.joy[sel] & 0xFF;
    }
    return d;
  }
  movxRead(a) {
    a &= 0xFF;
    const c = this.cpu;
    this.applyEvents(c.now);
    let d = 0xFF;
    if (!(c.p1 & 0x10) && !(a & 0x80)) d &= this.xram80[a];
    if ((c.p1 & 0x48) === 0) d &= this.vdcRead(a, c.now);
    return d;
  }
  movxWrite(a, v) {
    a &= 0xFF;
    v &= 0xFF;
    const c = this.cpu;
    this.applyEvents(c.now);
    if (!(c.p1 & 0x40)) {
      if (!(c.p1 & 0x10) && !(a & 0x80)) this.xram80[a] = v;
    }
    if (!(c.p1 & 0x08)) this.vdcWrite(a, v, c.now);
  }
}

module.exports = {StubConsole, TIMING, keyCode};
