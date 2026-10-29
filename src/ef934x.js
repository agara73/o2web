'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// ef934x.js - coppia Thomson EF9340 (VIN) / EF9341 (GEN) del Videopac+ G7400, mixer con il chip video 8245 e collisioni CX (tappa 5).
// Codice originale: la semantica e' quella del riferimento hw/ef934x_ref.py. Il modello e' stato confrontato con il datasheet Thomson
// EF9340/EF9341 (vedi la testata di hw/ef934x_ref.py: cosa e' verificato, cosa corretto, cosa resta DA VERIFICARE, mixer compreso).
// La ROM dei caratteri (2560 byte = 256 voci da 10 byte) la porta l'utente.
//
// Interfaccia della console: access(addr, dato, scrittura) per gli accessi MOVX con P1 bit 5 = 0; frameTick() una volta per quadro;
// renderLine(tl, out) per la linea di teletext tl = riga dello schermo - offsetY (in ordine 0, 1, 2... in ogni quadro). Stato
// serializzabile: saveState() / loadState().

const ROM_SIZE = 2560, EX_SIZE = 0x800, LINE_PIXELS = 320, SCREEN_W = 360;

// indirizzo (10 bit) della cella (colonna x, riga y) nelle RAM A e B
function cellAddr(x, y) {
  let a;
  if (y < 24 && x < 32) a = y * 32 + x;
  else if (y < 24) a = 0x300 + ((y & 7) << 5) + (y & 0x18) + (x & 7);
  else a = 0x318 | ((x & 0x38) << 2) | (x & 7);
  return a & 0x3FF;
}

// indice (11 bit) nella memoria estesa da 2 KB per attributo, codice e fetta
function exIndex(attr, code, sl) {
  const off = ((attr & 0xFF) << 12) | ((code & 0xFF) << 4) | (sl & 0xF);
  const latch = ((off >> 4) & 0x7F) | (((off >> 19) & 1) << 7);
  let idx = latch & 0x1F;
  idx |= (off & 1) << 9;
  idx |= ((latch >> 7) & 1) << 10;
  if (off & 8) idx |= latch & 0x60;
  else {
    idx |= ((off >> 1) & 3) << 5;
    idx |= ((latch >> 5) & 3) << 7;
  }
  return idx;
}

const DH_SLICE = [Uint8Array.of(0, 0, 0, 1, 1, 2, 2, 3, 3, 4), Uint8Array.of(4, 5, 5, 6, 6, 7, 7, 8, 8, 9)];

function toHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
  return s;
}

function fromHex(s, n, name) {
  if (typeof s !== 'string' || s.length !== 2 * n || !/^[0-9a-f]*$/.test(s)) throw new Error('stato non valido: ' + name);
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = parseInt(s.substr(2 * i, 2), 16);
  return u;
}

function intIn(v, lo, hi, name) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('stato non valido: ' + name);
  return v;
}

class EfPair {
  constructor(rom, opts) {
    if (!rom || rom.length !== ROM_SIZE) throw new Error('la ROM dei caratteri EF9341 deve essere di 2560 byte');
    this.rom = Uint8Array.from(rom);
    const o = opts || {};
    this.offsetX = o.offsetX === undefined ? 15 : o.offsetX;
    this.offsetY = o.offsetY === undefined ? 5 : o.offsetY;
    this.ramA = new Uint8Array(1024);
    this.ramB = new Uint8Array(1024);
    this.exram = new Uint8Array(EX_SIZE);
    this.reset();
  }

  reset() {
    this.ramA.fill(0);
    this.ramB.fill(0);
    this.exram.fill(0);
    this.ta = 0; this.tb = 0; this.x = 0; this.y = 0; this.y0 = 0; this.m = 0; this.r = 0;
    this.parity = 0;
    this.flPrescaler = 0;
    this.flPhase = 0;
  }

  // ------------------------------------------------------------------ accessi della CPU
  // addr a 8 bit: bit 0 = B/A (1 = TB), bit 1 = C/T (1 = comando), bit 2 = lettura. Ritorna il byte letto (0xFF se non risponde).
  access(addr, data, write) {
    const cmd = (addr >> 1) & 1, b = addr & 1, rd = (addr >> 2) & 1;
    if (write) {
      if (!rd) this._write(cmd, b, data & 0xFF);
      return 0xFF;
    }
    return rd ? this._read(cmd, b) : 0xFF;
  }

  _write(cmd, b, d) {
    if (cmd) {
      if (!b) { this.ta = d; return; }
      this.tb = d;
      switch (d >> 5) {
        case 0: this.x = 0; this.y = this.ta & 0x1F; break;
        case 1: this.y = this.ta & 0x1F; break;
        case 2: this.x = this.ta & 0x3F; break;
        case 3: this._incCursor(); break;
        case 4: this.m = this.ta; break;
        case 5: this.r = this.ta; break;
        case 6: this.y0 = this.ta & 0x3F; break;
        default: break;
      }
      return;
    }
    if (!b) { this.ta = d; return; }
    this.tb = d;
    const mode = this.m & 0xE0, cell = cellAddr(this.x, this.y);
    if (mode === 0x00 || mode === 0x40) {
      this.ramA[cell] = this.ta;
      this.ramB[cell] = this.tb;
      if (mode === 0x00) this._incCursor();
    } else if (mode === 0x80) {
      this.exram[exIndex(this.ramA[cell], this.ramB[cell], this.m & 0x0F)] = this.ta;
      this._incSlice();
    }
  }

  _read(cmd, b) {
    if (cmd) return 0x00;
    if (!b) return this.ta;
    const old = this.tb, mode = this.m & 0xE0, cell = cellAddr(this.x, this.y);
    if (mode === 0x20 || mode === 0x60) {
      this.ta = this.ramA[cell];
      this.tb = this.ramB[cell];
      if (mode === 0x20) this._incCursor();
    } else if (mode === 0xA0) {
      this.ta = this.exram[exIndex(this.ramA[cell], this.ramB[cell], this.m & 0x0F)];
      this._incSlice();
    }
    return old;
  }

  _incCursor() {
    this.x++;
    if (this.x === 40 || this.x === 48 || this.x === 56 || this.x === 64) {
      this.x = 0;
      this.y++;
      if (this.y === 24 || this.y === 32) this.y = 0;
    }
  }

  _incSlice() {
    let s = ((this.m & 0x0F) + 1) & 0x0F;
    if (s === 10) s = 0;
    this.m = (this.m & 0xF0) | s;
  }

  // ------------------------------------------------------------------ video
  frameTick() {
    this.flPrescaler++;
    if (this.flPrescaler >= ((this.r & 0x40) ? 50 : 60)) {
      this.flPrescaler = 0;
      this.flPhase ^= 1;
    }
  }

  _glyph(attr, code, sl) {
    if (code >= 0xA0) return this.exram[exIndex(attr, code, sl)];
    if (attr & 0x80) return this.rom[(code | 0x80) * 10 + sl];
    return this.rom[code * 10 + sl];
  }

  // 8 pixel di una cella con glifo (bit 0 = sinistra) scritti in out da pos
  _cellPixels(out, pos, bits, fg, bg, attr, blank, cursor, curInv, flashOn, graphics) {
    const inv = !graphics && (attr & 0x40) !== 0;
    if (inv) bits = ~bits & 0xFF;
    if ((this.r & 0x80) && !cursor && !(attr & 8)) {
      let on = flashOn;
      if (inv) on = !on;
      if (on) bits = 0;
    }
    if (curInv) bits = ~bits & 0xFF;
    for (let i = 0; i < 8; i++) out[pos + i] = blank ? 8 : (((bits >> i) & 1 ? fg : bg) & 7) | 8;
  }

  _solid(out, pos, fg, bg, curInv) {
    out.fill(((curInv ? bg : fg) & 7) | 8, pos, pos + 8);
  }

  // 320 valori di pixel per la linea di teletext tl in out (Uint8Array di 320): colore | 8 nell'area attiva, 0 fuori
  renderLine(tl, out) {
    if (tl === 0) this.parity = 0;
    const r = this.r;
    if (!(r & 1) || tl >= ((r & 0x40) ? 250 : 210)) { out.fill(0); return; }
    let row, sl, last;
    if (tl < 10) {
      if (!(r & 8)) { out.fill((r & 2) ? 0 : 8); return; }
      row = 31; sl = tl; last = tl === 9;
    } else if (this.y0 & 0x20) {                               // zoom: 20 linee per riga
      const k = tl - 10;
      row = ((this.y0 & 0x1F) + Math.floor(k / 20)) % 24;
      sl = (k % 20) >> 1;
      last = k % 20 === 19;
    } else {
      row = ((this.y0 & 0x1F) + Math.floor((tl - 10) / 10)) % 24;
      sl = tl % 10;
      last = sl === 9;
    }
    const boxing = (r & 2) !== 0;
    let boxed = false;
    let bg = 0, fg = 0, blank = false, ul = false, dwSecond = false, dwA = 0, dwC = 0, dwSl = 0, anyDh = false;
    const flashOn = (r & 0x80) !== 0 && this.flPhase === 1;
    for (let x = 0; x < 40; x++) {
      const cell = cellAddr(x, row), attr = this.ramA[cell], code = this.ramB[cell], pos = x * 8;
      const cursor = (r & 0x10) !== 0 && x === this.x && row === this.y;
      const curInv = cursor && (!(r & 0x80) || this.flPhase === 0);
      if (dwSecond) {
        dwSecond = false;
        let g = this._glyph(dwA, dwC, dwSl);
        if (dwC < 0x80 && ul && dwSl === 9) g = 0xFF;
        let bits = 0;
        for (let i = 0; i < 8; i++) if ((g >> (4 + (i >> 1))) & 1) bits |= 1 << i;
        this._cellPixels(out, pos, bits, dwA & 7, bg, dwA, blank, cursor, curInv, flashOn, false);
        if (boxing && !boxed) out.fill(0, pos, pos + 8);
        continue;
      }
      if (attr & 0x80) {                                       // modo grafico
        if ((code & 0xE0) === 0x80) {
          this._solid(out, pos, fg, bg, curInv);
          if (boxing && !boxed) out.fill(0, pos, pos + 8);
          continue;
        }
        fg = attr & 7;
        bg = (attr >> 4) & 7;
        this._cellPixels(out, pos, this._glyph(attr, code, sl), fg, bg, attr, blank, cursor, curInv, flashOn, true);
        if (boxing && !boxed) out.fill(0, pos, pos + 8);
        continue;
      }
      if ((code & 0xE0) === 0x80) {                            // delimitatore
        fg = attr & 7;
        bg = (attr >> 4) & 7;
        this._solid(out, pos, fg, bg, curInv);
        const nb = (code & 2) !== 0;
        if (boxing) {
          if (boxed && nb) { /* dentro la zona: blocco pieno */ }
          else if (nb) out.fill(0, pos, pos + 4);              // apre la zona: meta' sinistra trasparente (DA VERIFICARE)
          else if (boxed) out.fill(0, pos + 4, pos + 8);       // chiude la zona: meta' destra trasparente (DA VERIFICARE)
          else out.fill(0, pos, pos + 8);                      // fuori dalla zona: tutto trasparente
        }
        boxed = nb;
        blank = (r & 4) !== 0 && (code & 1) !== 0;
        ul = (code & 4) !== 0;
        continue;
      }
      let esl = sl;
      const dh = (attr & 0x10) !== 0;
      if (dh) esl = DH_SLICE[this.parity][sl];
      let g = this._glyph(attr, code, esl);
      if (code < 0x80 && ul && esl === 9) g = 0xFF;
      if (dh) anyDh = true;
      if (attr & 0x20) {                                       // doppia larghezza: prima cella
        let bits = 0;
        for (let i = 0; i < 8; i++) if ((g >> (i >> 1)) & 1) bits |= 1 << i;
        dwSecond = x < 39;
        dwA = attr; dwC = code; dwSl = esl;
        this._cellPixels(out, pos, bits, attr & 7, bg, attr, blank, cursor, curInv, flashOn, false);
        if (boxing && !boxed) out.fill(0, pos, pos + 8);
        continue;
      }
      this._cellPixels(out, pos, g, attr & 7, bg, attr, blank, cursor, curInv, flashOn, false);
      if (boxing && !boxed) out.fill(0, pos, pos + 8);
    }
    if (last) this.parity = anyDh ? this.parity ^ 1 : 0;
  }

  // ------------------------------------------------------------------ stato serializzabile (solo stato: mai la ROM dei caratteri)
  saveState() {
    return {ramA: toHex(this.ramA), ramB: toHex(this.ramB), exram: toHex(this.exram), ta: this.ta, tb: this.tb, x: this.x, y: this.y,
      y0: this.y0, m: this.m, r: this.r, parity: this.parity, flPrescaler: this.flPrescaler, flPhase: this.flPhase};
  }

  loadState(s) {
    if (!s || typeof s !== 'object') throw new Error('stato non valido: EF9340/41');
    const ramA = fromHex(s.ramA, 1024, 'RAM A dell\'EF9341'), ramB = fromHex(s.ramB, 1024, 'RAM B dell\'EF9341');
    const exram = fromHex(s.exram, EX_SIZE, 'memoria estesa dell\'EF9341');
    const ta = intIn(s.ta, 0, 255, 'EF9341: TA'), tb = intIn(s.tb, 0, 255, 'EF9341: TB'), x = intIn(s.x, 0, 63, 'EF9341: X');
    const y = intIn(s.y, 0, 31, 'EF9341: Y'), y0 = intIn(s.y0, 0, 63, 'EF9341: Y0'), m = intIn(s.m, 0, 255, 'EF9341: M');
    const r = intIn(s.r, 0, 255, 'EF9341: R'), parity = intIn(s.parity, 0, 1, 'EF9341: parita\''), ph = intIn(s.flPhase, 0, 1, 'EF9341: fase');
    const pre = intIn(s.flPrescaler, 0, 59, 'EF9341: prescaler');
    this.ramA.set(ramA); this.ramB.set(ramB); this.exram.set(exram);
    this.ta = ta; this.tb = tb; this.x = x; this.y = y; this.y0 = y0; this.m = m; this.r = r;
    this.parity = parity; this.flPrescaler = pre; this.flPhase = ph;
  }
}

// ---------------------------------------------------------------------- mixer e CX (funzioni pure)
// row: indici dell'8245 della riga (360, modificata sul posto); ef: 320 pixel EF o null (nessuna linea EF: tutti 0); cx: Uint8Array(360)
// in uscita con il livello di CX per pixel. mix8245 / mixEf: registri di mix; cartBHigh: pin B della cartuccia; lum: P1 bit 7 = 0.
function mixLine(row, ef, offsetX, mix8245, mixEf, cartBHigh, lum, cx) {
  const lumBit = lum ? 8 : 0;
  for (let x = 0; x < SCREEN_W; x++) {
    const k = x - offsetX;
    const e = ef && k >= 0 && k < LINE_PIXELS ? ef[k] : 0;
    const en = (e & 8) !== 0 || !cartBHigh;
    const e3 = e & 7;
    const i2 = (mixEf >> e3) & 1 ? 0 : 1;
    const d8 = row[x];
    if (en && ((mix8245 >> (d8 & 7)) & 1)) row[x] = (d8 | lumBit) & 15;
    else row[x] = e3 | (i2 ? 8 : 0);
    cx[x] = i2;
  }
}

// collisioni dovute a CX in una riga: ritorna i bit da aggiungere alle collisioni (8 bit) piu' 0x100 se c'e' stato un contatto
// (per l'interrupt). cmap: mappa delle collisioni della riga (360); cm: maschera 0xA2
function cxCollisions(cmap, cx, cm) {
  let st = 0, hit = false;
  if (!(cm & 0x40)) return 0;
  for (let x = 0; x < SCREEN_W; x++) {
    if (!cx[x]) continue;
    const m = cmap[x] & 0x3F;
    if (m) { st |= 0x40; hit = true; }
    st |= m;
  }
  return st | (hit ? 0x100 : 0);
}

module.exports = {EfPair, cellAddr, exIndex, mixLine, cxCollisions, ROM_SIZE, EX_SIZE, LINE_PIXELS, SCREEN_W};
