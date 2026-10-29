'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// vdc.js - chip video Intel 8244 (NTSC) / 8245 (PAL) PER RIGA DI SCANSIONE. Codice originale: la semantica e' quella del
// modello di riferimento hw/o2line.py (che si legge, come MAME e O2EM, come documentazione: i fatti sull'hardware sono tutti
// DA VERIFICARE con hardware o documentazione ufficiale, vedi o2web-stato.md).
//
// Tempo. Il chip lavora in "dot clock": 18 dot per ciclo macchina dell'8048 (PAL, 456 x 313 dot) o 20 (NTSC, 455 x 263). La
// posizione del raggio e' una funzione pura del tempo (cicli 8048): dot = dpc * cicli. Funzioni pure: T1 = vblank | hblank,
// bit 0 dello stato (0xA1), registri 0xA4/0xA5 del raggio.
// Eventi (indice 'ev'; 244 per fotogramma): 0..242 = riga 0..242 dell'area visibile, al dot 0 della riga: si disegna QUELLA
// riga con i registri di quell'istante e si accumulano le collisioni (registro 0xA2); 243 = inizio del vblank (riga 242,
// dot 365): bit 3 dello stato e /INT. Un evento al dot D di un fotogramma ha tempo ceil(D / dpc) cicli.
// Cambi di livello di T1: tabella calcolata una volta (periodo di 3 fotogrammi PAL / 4 NTSC, cicli interi); la console li
// applica ai confini fra istruzioni (modo contatore dell'8048).
//
// Uscita: 'fb' = indici di colore 0..15 per dot, 360 x 243 (riga per riga). Il passo "priority map" dei caratteri maggiori
// sovrapposti NON e' modellato (nessun dato verificabile): i due oggetti si disegnano entrambi (DA VERIFICARE).
// Stato serializzabile: saveState() / loadState() (solo stato: registri, flag, posizione negli eventi; mai il set di caratteri).
//
// SUONO (tappa 3; tutti i fatti DA VERIFICARE: ricavati da documentazione di altri emulatori letta come tale, non dai dump).
// Registro a scorrimento a 24 bit = 0xA9 (byte basso), 0xA8, 0xA7 (byte alto); controllo 0xAA: bit 7 uscita abilitata, bit 5 frequenza
// (1 = scorre ogni 4 righe, 0 = ogni 16), bit 4 rumore (retroazione = bit 0 xor bit 5), bit 0-3 volume; il bit 6 non si memorizza.
// Un evento per riga di scansione, all'inizio dell'hblank (dot 'hbStart' della riga: vale anche per le righe fuori dall'area visibile),
// conta un prescaler; quando scatta e nessuno dei registri 0xA7-0xA9 e' stato scritto dall'ultimo evento, il registro scorre di un bit
// (l'uscita e' il bit 0 prima dello scorrimento). Ogni 24 scorrimenti, se il bit 2 di 0xA0 e' 1, si alza il bit 2 dello stato (0xA1) e
// /INT. Livello di uscita = bit di uscita & bit 7 di 0xAA, per il volume (0..15): ad ogni suo cambio si chiama sndHook(ciclo, livello).

const VIS_W = 360, VIS_H = 243;
const EV_PER_FRAME = VIS_H + 1;

const TIMING = {
  PAL: {name: 'PAL', htotal: 456, vtotal: 313, vbStart: 242, vbEnd: 312, hbStart: 366, hbEnd: 454, bgate: 414, dpc: 18, ntsc: false},
  NTSC: {name: 'NTSC', htotal: 455, vtotal: 263, vbStart: 242, vbEnd: 0, hbStart: 366, hbEnd: 453, bgate: 413, dpc: 20, ntsc: true},
};
for (const k of Object.keys(TIMING)) {
  const t = TIMING[k];
  t.frame = t.htotal * t.vtotal;
  t.irqDot = t.vbStart * t.htotal + (t.hbStart - 1);
}

// colori: indice 0..15 -> [R, G, B]. DA VERIFICARE (valori usati dal modello di riferimento: 3 bit di colore + luminosita')
const PALETTE = [[0, 0, 0], [0xB6, 0, 0], [0, 0xB6, 0], [0xB6, 0xB6, 0], [0, 0, 0xB6], [0xB6, 0, 0xB6], [0, 0xB6, 0xB6],
  [0xB6, 0xB6, 0xB6], [0x49, 0x49, 0x49], [0xFF, 0x49, 0x49], [0x49, 0xFF, 0x49], [0xFF, 0xFF, 0x49],
  [0x49, 0x49, 0xFF], [0xFF, 0x49, 0xFF], [0x49, 0xFF, 0xFF], [0xFF, 0xFF, 0xFF]];

function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }

function intIn(v, lo, hi, name) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('stato non valido: ' + name);
  return v;
}

class Vdc {
  constructor(charset, std) {
    if (!charset || charset.length !== 512) throw new Error('il set di caratteri deve essere di 512 byte');
    this.charset = Uint8Array.from(charset);
    this.t = TIMING[std || 'PAL'];
    if (!this.t) throw new Error('standard video sconosciuto: ' + std);
    this.reg = new Uint8Array(256);
    this.fb = new Uint8Array(VIS_W * VIS_H);
    this.cmap = new Uint16Array(VIS_W);
    this.postLine = null;                      // G7400: funzione(riga, fb, cmap) dopo il disegno della riga (mixer con l'EF9341); ritorna bit di collisione (0-255) piu' 0x100 se un contatto CX deve alzare l'interrupt
    this.lineHook = null;                      // solo test: funzione(k, riga, stato) chiamata dopo ogni evento video (riga = -1 per il vblank)
    this.sndHook = null;                       // funzione(ciclo, livello 0..15) chiamata quando cambia il livello di uscita del suono
    this.frameDone = 0;
    // tabella dei cambi di livello di T1 su un periodo
    const t = this.t;
    const kf = t.dpc / gcd(t.frame, t.dpc);
    this.t1Period = kf * t.frame / t.dpc;
    const seq = new Uint8Array(this.t1Period);
    for (let c = 0; c < this.t1Period; c++) seq[c] = this.t1At(c);
    const cyc = [], lvl = [];
    for (let c = 0; c < this.t1Period; c++) {
      if (seq[c] !== seq[(c + this.t1Period - 1) % this.t1Period]) { cyc.push(c); lvl.push(seq[c]); }
    }
    this.t1Cycles = Int32Array.from(cyc);
    this.t1Levels = Uint8Array.from(lvl);
    this.reset();
  }

  reset() {
    this.reg.fill(0);
    this.ctlStatus = 0;
    this.colStatus = 0;
    this.xbeam = 0;
    this.ybeam = 0;
    this.irq = false;
    this.ev = 0;
    this.t1i = 0;
    this.fb.fill(0);
    this.frameDone = 0;
    this.legacySound = false;
    this.sn = 0;
    this.shPrescaler = 0;
    this.shPending = false;
    this.shWritten = false;
    this.shCount = 0;
    this.shOutput = 0;
    this.updateNext();
    this.updateSnd();
  }

  // ------------------------------------------------------------------ tempo
  updateNext() {
    const t = this.t;
    const f = Math.floor(this.ev / EV_PER_FRAME), j = this.ev - f * EV_PER_FRAME;
    this.nextEv = Math.ceil((f * t.frame + (j < VIS_H ? j * t.htotal : t.irqDot)) / t.dpc);
    const n = this.t1Cycles.length, q = Math.floor(this.t1i / n);
    this.nextT1 = q * this.t1Period + this.t1Cycles[this.t1i - q * n];
  }

  t1Pop() {
    const n = this.t1Cycles.length, q = Math.floor(this.t1i / n);
    const lvl = this.t1Levels[this.t1i - q * n];
    this.t1i++;
    this.updateNext();
    return lvl;
  }

  // ciclo dell'evento di suono numero n (n-esima riga di scansione, dot hbStart)
  sndCycle(n) { return Math.ceil((n * this.t.htotal + this.t.hbStart) / this.t.dpc); }
  updateSnd() { this.nextSnd = this.sndCycle(this.sn); }

  // livello di uscita del suono (0..15) all'istante corrente
  level() {
    const c = this.reg[0xAA];
    return this.shOutput & (c >> 7) ? c & 15 : 0;
  }

  // evento di suono: una riga di scansione
  sndEvent() {
    const cyc = this.nextSnd, r = this.reg;
    const lvl0 = this.level();
    this.sn++;
    this.updateSnd();
    this.shPrescaler = (this.shPrescaler + 1) & 0xFF;
    if ((this.shPrescaler & ((r[0xAA] & 0x20) ? 3 : 15)) === 0) this.shPending = true;
    if (this.shPending && !this.shWritten) {
      this.shPending = false;
      let sig = r[0xA9] | (r[0xA8] << 8) | (r[0xA7] << 16);
      this.shOutput = sig & 1;
      let fb = this.shOutput;
      sig >>>= 1;
      if (r[0xAA] & 0x10) {                                // rumore: bit 0 xor bit 5 (prima dello scorrimento) torna nel bit 15
        fb ^= (sig >>> 4) & 1;
        sig = (sig & ~0x8000) | (fb << 15);
      }
      sig |= fb << 23;
      r[0xA9] = sig & 0xFF;
      r[0xA8] = (sig >>> 8) & 0xFF;
      r[0xA7] = (sig >>> 16) & 0xFF;
      if (++this.shCount === 24) {
        this.shCount = 0;
        if (r[0xA0] & 0x04) {
          this.ctlStatus |= 0x04;
          this.irq = true;
        }
      }
    } else if (this.shWritten) {
      this.shCount = 0;
      this.shWritten = false;
    }
    if (this.sndHook) {
      const lvl1 = this.level();
      if (lvl1 !== lvl0) this.sndHook(cyc, lvl1);
    }
  }

  // solo prove e test: applica in ordine di tempo gli eventi video e di suono scaduti (<= cyc)
  advanceTo(cyc) {
    for (;;) {
      if (this.nextEv <= this.nextSnd) {
        if (this.nextEv > cyc) break;
        this.event();
      } else {
        if (this.nextSnd > cyc) break;
        this.sndEvent();
      }
    }
  }

  // dopo il caricamento di uno stato senza dati del suono (versione 1): il primo evento di suono utile e' il primo con ciclo >= cyc
  alignSound(cyc) {
    const t = this.t;
    this.sn = Math.max(0, Math.ceil((cyc * t.dpc - t.hbStart) / t.htotal));
    while (this.sn > 0 && this.sndCycle(this.sn - 1) >= cyc) this.sn--;
    while (this.sndCycle(this.sn) < cyc) this.sn++;
    this.shPrescaler = 0; this.shPending = false; this.shWritten = false; this.shCount = 0; this.shOutput = 0;
    this.updateSnd();
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
    const t = this.t;
    const d = (cyc * t.dpc) % t.frame;
    const v = Math.floor(d / t.htotal), h = d - v * t.htotal;
    return (this.vblank(v, h) || this.hblank(h)) ? 1 : 0;
  }

  ybeamNow(cyc) {
    const t = this.t;
    const d = (cyc * t.dpc) % t.frame;
    let v = Math.floor(d / t.htotal);
    const h = d - v * t.htotal;
    if (v === 0 && h < t.hbStart) v = t.vtotal;
    if (h >= t.bgate) v += 1;
    return Math.min(v, 263);
  }

  xbeamNow(cyc) {
    const t = this.t;
    const d = (cyc * t.dpc) % t.frame;
    return (d % t.htotal) >> 1;
  }

  // evento video: disegna una riga (0..242) oppure segnala il vblank
  event() {
    const k = this.ev;
    this.ev++;
    this.updateNext();
    const j = k % EV_PER_FRAME;
    if (j < VIS_H) {
      this.colStatus |= this.renderLine(j);
      if (this.postLine) {
        const x = this.postLine(j, this.fb, this.cmap);
        this.colStatus |= x & 0xFF;
        if ((x & 0x100) && (this.reg[0xA0] & 0x10)) { this.ctlStatus |= 0x40; this.irq = true; }
      }
      if (j === VIS_H - 1) this.frameDone++;
      if (this.lineHook) this.lineHook(k, j, this.colStatus);
      return;
    }
    this.ctlStatus |= 0x08;
    this.irq = true;
    if (this.lineHook) this.lineHook(k, -1, this.ctlStatus | 0x100);
  }

  // ------------------------------------------------------------------ registri
  static mirror(off) {
    if ((off & 0xC2) === 0x40) off &= ~0x0C;
    if ((off & 0xE0) === 0xA0) off &= ~0x10;
    return off & 0xFF;
  }

  read(off, cyc) {
    off = Vdc.mirror(off);
    const r = this.reg;
    if (off === 0xA1) {
      let d = this.ctlStatus;
      const t = this.t;
      const h = ((cyc * t.dpc) % t.frame) % t.htotal;
      if (h >= 225 && h < t.bgate && this.ybeamNow(cyc) <= t.vbStart) d |= 1;
      d |= r[0xA0] & 0x02;
      this.irq = false;
      this.ctlStatus &= ~0xCC;
      return d & 0xFF;
    }
    if (off === 0xA2) {
      const d = this.colStatus;
      this.colStatus = 0;
      return d;
    }
    if (off === 0xA4) return (r[0xA0] & 0x02) ? (this.ybeamNow(cyc) & 0xFF) : this.ybeam;
    if (off === 0xA5) return (r[0xA0] & 0x02) ? (this.xbeamNow(cyc) & 0xFF) : this.xbeam;
    if (off === 0x02 || off === 0x06 || off === 0x0A || off === 0x0E || off === 0xA3 || off === 0xA7 || off === 0xA8 || off === 0xA9) return 0;
    if (off < 0x80 && (r[0xA0] & 0x20)) return 0;
    if (off >= 0xC0 && (r[0xA0] & 0x08)) return 0;
    return r[off];
  }

  write(off, data, cyc) {
    off = Vdc.mirror(off);
    const r = this.reg;
    data &= 0xFF;
    if (off < 0x80 && (r[0xA0] & 0x20)) return;
    if ((off >= 0xC0 && (r[0xA0] & 0x08)) || off >= 0xF0) return;
    if ((off & 0x83) === 0x03) data &= 0x0F;
    if (off >= 0x10 && (off & 0x83) === 0x00) data &= 0xFE;
    if ((off & 0xF0) === 0xD0) data &= 0x01;
    let lvl0 = -1;
    if (off === 0xA0) {
      if ((r[0xA0] & 0x02) && !(data & 0x02)) {
        this.xbeam = this.xbeamNow(cyc) & 0xFF;
        this.ybeam = this.ybeamNow(cyc) & 0xFF;
      }
    } else if (off === 0xA1 || off === 0xA4 || off === 0xA5) {
      return;
    } else if (off === 0xAA) {
      data &= 0xBF;
      lvl0 = this.level();
    } else if (off >= 0xA7 && off <= 0xA9) {
      this.shWritten = true;
    } else if (off === 0x03 || off === 0x07 || off === 0x0B || off === 0x0F || off === 0xA6 || off === 0xAB || off === 0xAC ||
      off === 0xAD || off === 0xAE || off === 0xAF || (off >= 0xC9 && off <= 0xCF) || (off >= 0xD9 && off <= 0xDF) ||
      (off >= 0xEA && off <= 0xEF)) {
      return;
    }
    r[off] = data;
    if (lvl0 >= 0 && this.sndHook) {
      const lvl1 = this.level();
      if (lvl1 !== lvl0) this.sndHook(cyc, lvl1);
    }
  }

  // ------------------------------------------------------------------ una riga di scansione
  // Disegna la riga 'sl' (0..242) in fb e ritorna l'accumulo delle collisioni (8 bit).
  renderLine(sl) {
    const r = this.reg, cs = this.charset, cmap = this.cmap, fb = this.fb;
    const ctl = r[0xA0], cm = r[0xA2], a3 = r[0xA3];
    const bg = ((a3 >> 3) & 1) << 2 | ((a3 >> 4) & 1) << 1 | ((a3 >> 5) & 1);
    const gcol = ((a3 >> 6) & 1) << 3 | (a3 & 1) << 2 | ((a3 >> 1) & 1) << 1 | ((a3 >> 2) & 1);
    const base0 = sl * VIS_W;
    fb.fill(bg, base0, base0 + VIS_W);
    cmap.fill(0);
    const ntsc = this.t.ntsc;
    let st = 0;

    const put = (px, mask, color) => {
      if (px >= 0 && px < VIS_W) {
        const colx = cmap[px] & 0xFF;
        if (cm & colx) st |= mask & 0xFF;
        if (cm & mask & 0xFF) st |= colx;
        cmap[px] |= mask;
        fb[base0 + px] = color;
      }
    };
    const mark = (px, mask, color) => {                    // griglia: nessun controllo di collisione (primo strato)
      if (px >= 0 && px < VIS_W) {
        cmap[px] |= mask;
        fb[base0 + px] = color;
      }
    };

    if ((ctl & 0x08) && sl >= 24 && sl <= 218) {
      const w = (ctl & 0x80) ? 16 : 2;
      for (let y = 0; y < 9; y++) {
        if (sl >= 24 + y * 24 && sl < 24 + y * 24 + 3) {
          for (let i = 0; i < 9; i++) {
            if (((r[0xD0 + i] << 8 | r[0xC0 + i]) >> y) & 1) {
              for (let k = 0; k < 18; k++) {
                const x = (13 + i * 16 + k) * 2;
                mark(x, 0x20, gcol); mark(x + 1, 0x20, gcol);
              }
            }
          }
          if (ctl & 0x40) {
            for (let i = 0; i < 10; i++) {
              for (let k = 0; k < 2; k++) {
                const x = (13 + i * 16 + k) * 2;
                mark(x, 0x20, gcol); mark(x + 1, 0x20, gcol);
              }
            }
          }
        }
      }
      for (let y = 0; y < 8; y++) {
        if (sl >= 24 + y * 24 && sl < 24 + (y + 1) * 24) {
          for (let i = 0; i < 10; i++) {
            if (r[0xE0 + i] & (1 << y)) {
              for (let k = 0; k < w; k++) {
                const x = (13 + i * 16 + k) * 2;
                mark(x, 0x10, gcol); mark(x + 1, 0x10, gcol);
              }
            }
          }
        }
      }
    }
    if (ctl & 0x20) {
      const majorRow = (y, x0, ptr, colr) => {
        const off = (ptr | ((colr & 1) << 8)) + (y >> 1) + ((sl - y) >> 1);
        const color = 8 + ((colr >> 1) & 7);
        const data = cs[off & 0x1FF];
        let x = x0;
        for (let cx = 0; cx < 8; cx++) {
          if ((data >> (cx ^ 7)) & 1) { put(x, 0x80, color); put(x + 1, 0x80, color); }
          x += 2;
        }
      };
      for (let i = 3; i >= 0; i--) {                       // gruppi da 4 caratteri
        const base = 0x40 + 16 * i, y = r[base];
        if (ntsc && y < 0x0E) continue;
        const ptr3 = r[base + 12 + 2];
        let height = 7 - (((y >> 1) + ptr3) & 7);
        if (height === 0) height = 8;
        if (y <= sl && sl < y + height * 2) {
          let x = (r[base + 1] + 5) * 2;
          for (let j = 0; j < 4; j++) {
            majorRow(y, x, r[base + 4 * j + 2], r[base + 4 * j + 3]);
            x += 32;
          }
        }
      }
      for (let i = 11; i >= 0; i--) {                      // caratteri singoli
        const base = 0x10 + 4 * i, y = r[base];
        if (ntsc && y < 0x0E) continue;
        let height = 7 - (((y >> 1) + r[base + 2]) & 7);
        if (height === 0) height = 8;
        if (y <= sl && sl < y + height * 2) majorRow(y, (r[base + 1] + 5) * 2, r[base + 2], r[base + 3]);
      }
      for (let i = 3; i >= 0; i--) {                       // sprite
        const y = r[4 * i];
        const zoom = (r[4 * i + 2] & 4) !== 0;
        const zp = zoom ? 4 : 2;
        if (y <= sl && sl < y + 8 * zp) {
          const color = 8 + ((r[4 * i + 2] >> 3) & 7);
          const line = Math.floor((sl - y) / zp);
          const chr = r[0x80 + 8 * i + line];
          let x = (r[4 * i + 1] + 5) * 2;
          const a = r[4 * i + 2] & 3;
          const rr = line & 1;
          let xs = 0;
          if (a === 1) xs = 1;
          else if (a === 2) xs = rr ^ 1;
          else if (a === 3) xs = rr;
          x += xs * (zp >> 1);
          const mask = (zoom ? 0x101 : 1) << i;
          for (let m = 1; m < 0x100; m <<= 1) {
            if (chr & m) { for (let px = x; px < x + zp; px++) put(px, mask, color); }
            x += zp;
          }
        }
      }
    }
    // passo dei pixel adiacenti
    for (let x = 1; x < VIS_W; x++) {
      const colx0 = cmap[x - 1], colx1 = cmap[x];
      if (colx1 & 0x80) {
        if (cm & colx0 & 0x3F) st |= 0x80;
        if (cm & 0x80) st |= colx0 & 0x3F;
      }
      const mask = (colx1 & 0xF) & ((~colx1 >> 8) & 0xFF);
      if (cm & colx0 & 0x30) st |= mask;
      if (cm & mask) st |= colx0 & 0x30;
    }
    return st & 0xFF;
  }

  // ------------------------------------------------------------------ stato serializzabile
  saveState() {
    return {reg: Array.from(this.reg), ctlStatus: this.ctlStatus, colStatus: this.colStatus, xbeam: this.xbeam, ybeam: this.ybeam,
      irq: this.irq ? 1 : 0, ev: this.ev, t1i: this.t1i,
      snd: {sn: this.sn, prescaler: this.shPrescaler, pending: this.shPending ? 1 : 0, written: this.shWritten ? 1 : 0,
        count: this.shCount, output: this.shOutput}};
  }

  loadState(s) {
    if (!s || !Array.isArray(s.reg) || s.reg.length !== 256) throw new Error('stato non valido: registri del chip video');
    const reg = Uint8Array.from(s.reg.map((v) => intIn(v, 0, 255, 'registro del chip video')));
    const ctlStatus = intIn(s.ctlStatus, 0, 255, 'stato del chip video'), colStatus = intIn(s.colStatus, 0, 255, 'collisioni');
    const xbeam = intIn(s.xbeam, 0, 255, 'xbeam'), ybeam = intIn(s.ybeam, 0, 255, 'ybeam'), irq = intIn(s.irq, 0, 1, 'irq');
    const ev = intIn(s.ev, 0, Number.MAX_SAFE_INTEGER, 'indice evento'), t1i = intIn(s.t1i, 0, Number.MAX_SAFE_INTEGER, 'indice T1');
    // suono: assente negli stati di versione 1 (il chiamante allinea il tempo con alignSound)
    let snd = null;
    if (s.snd !== undefined) {
      const q = s.snd;
      if (!q || typeof q !== 'object') throw new Error('stato non valido: suono');
      snd = {sn: intIn(q.sn, 0, Number.MAX_SAFE_INTEGER, 'indice evento del suono'), prescaler: intIn(q.prescaler, 0, 255, 'prescaler del suono'),
        pending: intIn(q.pending, 0, 1, 'suono: pending'), written: intIn(q.written, 0, 1, 'suono: written'),
        count: intIn(q.count, 0, 23, 'contatore del suono'), output: intIn(q.output, 0, 1, 'uscita del suono')};
    }
    this.reg.set(reg);
    this.ctlStatus = ctlStatus; this.colStatus = colStatus; this.xbeam = xbeam; this.ybeam = ybeam; this.irq = irq === 1;
    this.ev = ev; this.t1i = t1i;
    this.fb.fill(0);
    this.updateNext();
    if (snd) {
      this.sn = snd.sn; this.shPrescaler = snd.prescaler; this.shPending = snd.pending === 1; this.shWritten = snd.written === 1;
      this.shCount = snd.count; this.shOutput = snd.output;
      this.legacySound = false;
      this.updateSnd();
    } else {
      this.legacySound = true;
    }
  }
}

module.exports = {Vdc, TIMING, PALETTE, VIS_W, VIS_H, EV_PER_FRAME};
