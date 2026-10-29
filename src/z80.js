'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// z80.js - nucleo Z80 (compatibile con l'NSC800 del modulo scacchi Philips C7010) a interprete. Codice originale, scritto dalla
// descrizione pubblica del set di istruzioni (decodifica x/y/z/p/q, tabelle dei flag e dei tempi); i punti che la descrizione
// ufficiale non fissa (flag X/Y, MEMPTR/WZ, prefissi, istruzioni non documentate) sono quelli osservati sul Z80 vero e si
// provano contro un riferimento indipendente (test/z80_record.py + test/z80_run.js) e contro gli esercizi ZEXDOC / ZEXALL
// (test/zex_run.js, solo in locale). DA VERIFICARE sull'NSC800: stessi tempi del Z80, nessuna differenza di istruzioni (l'NSC800
// ha in piu' gli ingressi RSTA/B/C e il bus multiplexato: NON modellati, il modulo non li usa).
//
// Modello. Ogni chiamata di step() esegue UN'istruzione, tranne i prefissi DD / FD, che sono un'istruzione a se' (4 T, R + 1) e
// lasciano il prefisso attivo per la successiva; un prefisso seguito da un'altra istruzione che non usa HL / (HL) / H / L si
// comporta come un NOP da 4 T davanti alla stessa istruzione. Dopo un prefisso o dopo EI non si accettano interrupt.
// Interfaccia dell'ambiente (host): la CPU non conosce alcun indirizzo ne' porta della scheda.
//   host.read(a16) -> byte      host.write(a16, v)
//   host.in(port16) -> byte     host.out(port16, v)     port16 = byte alto (B o A) e byte basso, come sul bus del Z80
// Tempo: cpu.t = stati T trascorsi dall'inizio. step() ritorna gli stati T dell'istruzione; runUntil(t) esegue fino a t.
// Interrupt: requestInt(dato) e nmi() si chiamano fra due istruzioni; ritornano gli stati T usati (0 se l'interrupt non e'
// accettato). Modo 0: dal bus si esegue solo un RST (dato 0xC7 | n); altre istruzioni sul bus: non supportate (DA VERIFICARE).

const SF = 0x80, ZF = 0x40, YF = 0x20, HF = 0x10, XF = 0x08, PF = 0x04, NF = 0x02, CF = 0x01;

const PAR = new Uint8Array(256);       // PF se il numero di bit a 1 e' pari
const SZXY = new Uint8Array(256);      // S, Z, Y, X dal valore
const SZXYP = new Uint8Array(256);     // S, Z, Y, X, P dal valore
for (let i = 0; i < 256; i++) {
  let b = i, n = 0;
  while (b) { n += b & 1; b >>= 1; }
  PAR[i] = (n & 1) ? 0 : PF;
  SZXY[i] = (i & (SF | YF | XF)) | (i === 0 ? ZF : 0);
  SZXYP[i] = SZXY[i] | PAR[i];
}
// condizioni: NZ Z NC C PO PE P M
const COND_MASK = [ZF, ZF, CF, CF, PF, PF, SF, SF];

function sext(d) { return (d << 24) >> 24; }

class Z80 {
  constructor(host) {
    this.host = host;
    this.r = new Uint8Array(8);        // B C D E H L F A (l'indice 6 e' F: non e' mai un operando)
    this.r2 = new Uint8Array(8);       // insieme ombra
    this.reset();
  }

  reset() {
    this.r.fill(0);
    this.r2.fill(0);
    this.r[6] = 0xFF; this.r[7] = 0xFF;   // AF e SP = FFFF dopo il reset (DA VERIFICARE; gli altri registri sono indefiniti)
    this.sp = 0xFFFF;
    this.pc = 0;
    this.ix = 0;
    this.iy = 0;
    this.i = 0;
    this.rr = 0;                       // registro R (8 bit; il bit 7 resta com'e')
    this.iff1 = 0;
    this.iff2 = 0;
    this.im = 0;
    this.halted = 0;
    this.wz = 0;                       // MEMPTR (registro interno, visibile solo nei flag X/Y di BIT n,(HL))
    this.idx = 0;                      // prefisso attivo: 0 nessuno, 1 IX (DD), 2 IY (FD)
    this.noInt = 0;                    // 1: dopo EI o un prefisso non si accetta l'interrupt
    this.t = 0;
  }

  // ------------------------------------------------------- stato serializzabile (snapshot)
  // Solo stato della CPU (registri, flag interni, tempo): nessun contenuto di memoria. loadState convalida tutti i campi prima di
  // modificare qualcosa (un file di stato e' un input dell'utente: puo' essere corrotto o falsificato).
  saveState() {
    return {r: Array.from(this.r), r2: Array.from(this.r2), sp: this.sp, pc: this.pc, ix: this.ix, iy: this.iy, i: this.i,
      rr: this.rr, iff1: this.iff1, iff2: this.iff2, im: this.im, halted: this.halted, wz: this.wz, idx: this.idx,
      noInt: this.noInt, t: this.t};
  }

  loadState(s) {
    const chk = (v, lo, hi, name) => {
      if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('stato non valido: ' + name);
      return v;
    };
    if (!s || !Array.isArray(s.r) || s.r.length !== 8 || !Array.isArray(s.r2) || s.r2.length !== 8) {
      throw new Error('stato non valido: registri dello Z80');
    }
    const n = {
      sp: chk(s.sp, 0, 0xFFFF, 'SP'), pc: chk(s.pc, 0, 0xFFFF, 'PC'), ix: chk(s.ix, 0, 0xFFFF, 'IX'), iy: chk(s.iy, 0, 0xFFFF, 'IY'),
      i: chk(s.i, 0, 255, 'I'), rr: chk(s.rr, 0, 255, 'R'), iff1: chk(s.iff1, 0, 1, 'IFF1'), iff2: chk(s.iff2, 0, 1, 'IFF2'),
      im: chk(s.im, 0, 2, 'IM'), halted: chk(s.halted, 0, 1, 'HALT'), wz: chk(s.wz, 0, 0xFFFF, 'WZ'), idx: chk(s.idx, 0, 2, 'prefisso'),
      noInt: chk(s.noInt, 0, 1, 'noInt'), t: chk(s.t, 0, Number.MAX_SAFE_INTEGER, 'tempo'),
    };
    const r = s.r.map((v) => chk(v, 0, 255, 'registro'));
    const r2 = s.r2.map((v) => chk(v, 0, 255, 'registro ombra'));
    Object.assign(this, n);
    this.r.set(r);
    this.r2.set(r2);
  }

  // ---------------------------------------------------------------- utilita'
  rd(a) { return this.host.read(a & 0xFFFF) & 0xFF; }
  wr(a, v) { this.host.write(a & 0xFFFF, v & 0xFF); }
  rd16(a) { return this.rd(a) | (this.rd(a + 1) << 8); }
  wr16(a, v) { this.wr(a, v); this.wr(a + 1, v >> 8); }
  fetch8() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const lo = this.fetch8(); return lo | (this.fetch8() << 8); }
  fetchOp() {                          // ciclo M1: incrementa i 7 bit bassi di R
    const v = this.fetch8();
    this.rr = (this.rr & 0x80) | ((this.rr + 1) & 0x7F);
    return v;
  }
  push16(v) { this.sp = (this.sp - 1) & 0xFFFF; this.wr(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xFFFF; this.wr(this.sp, v); }
  pop16() { const lo = this.rd(this.sp); this.sp = (this.sp + 1) & 0xFFFF; const hi = this.rd(this.sp); this.sp = (this.sp + 1) & 0xFFFF; return lo | (hi << 8); }

  get bc() { return (this.r[0] << 8) | this.r[1]; }
  set bc(v) { this.r[0] = v >> 8; this.r[1] = v; }
  get de() { return (this.r[2] << 8) | this.r[3]; }
  set de(v) { this.r[2] = v >> 8; this.r[3] = v; }
  get hl() { return (this.r[4] << 8) | this.r[5]; }
  set hl(v) { this.r[4] = v >> 8; this.r[5] = v; }
  get af() { return (this.r[7] << 8) | this.r[6]; }
  set af(v) { this.r[7] = v >> 8; this.r[6] = v; }
  // HL, oppure IX / IY se c'e' un prefisso
  getHL() { return this.idx === 0 ? this.hl : (this.idx === 1 ? this.ix : this.iy); }
  setHL(v) { if (this.idx === 0) this.hl = v; else if (this.idx === 1) this.ix = v & 0xFFFF; else this.iy = v & 0xFFFF; }
  // registro a 8 bit con IXH / IXL / IYH / IYL al posto di H / L se c'e' un prefisso (mai z = 6)
  gr(z) {
    if (this.idx === 0 || (z !== 4 && z !== 5)) return this.r[z];
    const v = this.idx === 1 ? this.ix : this.iy;
    return z === 4 ? v >> 8 : v & 255;
  }
  sr(z, v) {
    if (this.idx === 0 || (z !== 4 && z !== 5)) { this.r[z] = v; return; }
    const o = this.idx === 1 ? this.ix : this.iy;
    const n = z === 4 ? ((v << 8) | (o & 255)) : ((o & 0xFF00) | v);
    if (this.idx === 1) this.ix = n; else this.iy = n;
  }
  // indirizzo dell'operando (HL): con un prefisso e' IX+d / IY+d (legge lo spostamento)
  ea() {
    if (this.idx === 0) return this.hl;
    const d = sext(this.fetch8());
    const a = ((this.idx === 1 ? this.ix : this.iy) + d) & 0xFFFF;
    this.wz = a;
    return a;
  }
  rp(p) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.getHL() : this.sp; }
  setRp(p, v) {
    if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.setHL(v); else this.sp = v & 0xFFFF;
  }
  cond(cc) { return ((this.r[6] & COND_MASK[cc]) !== 0) === ((cc & 1) === 1); }

  // ---------------------------------------------------------------- aritmetica e logica a 8 bit
  alu(y, v) {
    const a = this.r[7];
    let res, f;
    switch (y) {
      case 0: case 1: {                // ADD, ADC
        res = a + v + (y === 1 ? (this.r[6] & CF) : 0);
        f = SZXY[res & 255] | ((a ^ v ^ res) & HF) | ((~(a ^ v) & (a ^ res) & 0x80) ? PF : 0) | ((res >> 8) & 1);
        this.r[7] = res; this.r[6] = f;
        return;
      }
      case 2: case 3: case 7: {        // SUB, SBC, CP
        res = a - v - (y === 3 ? (this.r[6] & CF) : 0);
        f = NF | ((a ^ v ^ res) & HF) | (((a ^ v) & (a ^ res) & 0x80) ? PF : 0) | ((res >> 8) & 1);
        if (y === 7) {
          f |= (SZXY[res & 255] & (SF | ZF)) | (v & (YF | XF));
        } else {
          f |= SZXY[res & 255];
          this.r[7] = res;
        }
        this.r[6] = f;
        return;
      }
      case 4: res = a & v; this.r[7] = res; this.r[6] = SZXYP[res] | HF; return;
      case 5: res = a ^ v; this.r[7] = res; this.r[6] = SZXYP[res]; return;
      default: res = a | v; this.r[7] = res; this.r[6] = SZXYP[res]; return;
    }
  }
  inc8(v) {
    const res = (v + 1) & 255;
    this.r[6] = (this.r[6] & CF) | SZXY[res] | ((v & 15) === 15 ? HF : 0) | (v === 0x7F ? PF : 0);
    return res;
  }
  dec8(v) {
    const res = (v - 1) & 255;
    this.r[6] = (this.r[6] & CF) | SZXY[res] | NF | ((v & 15) === 0 ? HF : 0) | (v === 0x80 ? PF : 0);
    return res;
  }
  // rotazioni e scorrimenti del prefisso CB (y = tipo); aggiorna F
  rot(y, v) {
    let c, res;
    switch (y) {
      case 0: c = v >> 7; res = ((v << 1) | c) & 255; break;                       // RLC
      case 1: c = v & 1; res = (v >> 1) | (c << 7); break;                         // RRC
      case 2: c = v >> 7; res = ((v << 1) | (this.r[6] & CF)) & 255; break;        // RL
      case 3: c = v & 1; res = (v >> 1) | ((this.r[6] & CF) << 7); break;          // RR
      case 4: c = v >> 7; res = (v << 1) & 255; break;                             // SLA
      case 5: c = v & 1; res = (v >> 1) | (v & 0x80); break;                       // SRA
      case 6: c = v >> 7; res = ((v << 1) | 1) & 255; break;                       // SLL (non documentata)
      default: c = v & 1; res = v >> 1; break;                                     // SRL
    }
    this.r[6] = SZXYP[res] | c;
    return res;
  }
  bitFlags(n, v, xy) {
    const z = (v & (1 << n)) === 0;
    this.r[6] = (this.r[6] & CF) | HF | (z ? (ZF | PF) : 0) | ((n === 7 && !z) ? SF : 0) | (xy & (YF | XF));
  }
  daa() {
    const a = this.r[7], f = this.r[6];
    let corr = 0, c = f & CF;
    if ((f & HF) || (a & 15) > 9) corr |= 6;
    if (c || a > 0x99) { corr |= 0x60; c = CF; }
    const n = f & NF;
    const res = n ? (a - corr) & 255 : (a + corr) & 255;
    const h = n ? (((f & HF) && (a & 15) < 6) ? HF : 0) : ((a & 15) > 9 ? HF : 0);
    this.r[7] = res;
    this.r[6] = SZXYP[res] | n | c | h;
  }

  // ---------------------------------------------------------------- aritmetica a 16 bit
  add16(a, b) {                        // ADD HL,rr (flag S Z P non toccati)
    const res = a + b;
    this.r[6] = (this.r[6] & (SF | ZF | PF)) | (((a ^ b ^ res) >> 8) & HF) | ((res >> 8) & (YF | XF)) | ((res >> 16) & 1);
    this.wz = (a + 1) & 0xFFFF;
    return res & 0xFFFF;
  }
  adc16(a, b) {
    const res = a + b + (this.r[6] & CF);
    const r16 = res & 0xFFFF;
    this.r[6] = (r16 >> 8 & (SF | YF | XF)) | (r16 === 0 ? ZF : 0) | (((a ^ b ^ res) >> 8) & HF) |
      ((~(a ^ b) & (a ^ res) & 0x8000) ? PF : 0) | ((res >> 16) & 1);
    this.wz = (a + 1) & 0xFFFF;
    return r16;
  }
  sbc16(a, b) {
    const res = a - b - (this.r[6] & CF);
    const r16 = res & 0xFFFF;
    this.r[6] = (r16 >> 8 & (SF | YF | XF)) | (r16 === 0 ? ZF : 0) | NF | (((a ^ b ^ res) >> 8) & HF) |
      (((a ^ b) & (a ^ res) & 0x8000) ? PF : 0) | ((res >> 16) & 1);
    this.wz = (a + 1) & 0xFFFF;
    return r16;
  }

  // ---------------------------------------------------------------- un'istruzione
  step() {
    let cyc;
    if (this.halted) {
      // HALT: la CPU esegue NOP finche' non arriva un interrupt (PC resta dopo l'istruzione HALT)
      this.rr = (this.rr & 0x80) | ((this.rr + 1) & 0x7F);
      this.noInt = 0;
      this.t += 4;
      return 4;
    }
    this.noInt = 0;
    const op = this.fetchOp();
    if (op === 0xDD || op === 0xFD) {
      this.idx = op === 0xDD ? 1 : 2;
      this.noInt = 1;
      cyc = 4;
    } else {
      if (op === 0xCB) cyc = this.execCB();
      else if (op === 0xED) cyc = this.execED();          // dopo ED il prefisso DD / FD e' ignorato (execED non guarda idx)
      else cyc = this.execMain(op);
      this.idx = 0;
    }
    this.t += cyc;
    return cyc;
  }

  runUntil(t) {
    while (this.t < t) this.step();
  }

  // interrupt mascherabile; dato = byte sul bus. Ritorna gli stati T (0 se non accettato)
  requestInt(data) {
    if (!this.iff1 || this.noInt) return 0;
    this.halted = 0;
    this.iff1 = 0; this.iff2 = 0;
    this.rr = (this.rr & 0x80) | ((this.rr + 1) & 0x7F);
    let cyc;
    if (this.im === 2) {
      this.push16(this.pc);
      this.pc = this.rd16((this.i << 8) | (data & 255));
      cyc = 19;
    } else if (this.im === 1) {
      this.push16(this.pc);
      this.pc = 0x38;
      cyc = 13;
    } else {
      this.push16(this.pc);
      this.pc = (data & 0x38);          // modo 0: solo RST
      cyc = 13;
    }
    this.wz = this.pc;
    this.idx = 0;
    this.t += cyc;
    return cyc;
  }

  // interrupt non mascherabile
  nmi() {
    this.halted = 0;
    this.iff2 = this.iff1;
    this.iff1 = 0;
    this.rr = (this.rr & 0x80) | ((this.rr + 1) & 0x7F);
    this.push16(this.pc);
    this.pc = 0x66;
    this.wz = 0x66;
    this.idx = 0;
    this.t += 11;
    return 11;
  }

  execMain(op) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    const r = this.r;
    let a, v, d;
    switch (x) {
      case 0:
        switch (z) {
          case 0:
            if (y === 0) return 4;                                                    // NOP
            if (y === 1) {                                                             // EX AF,AF'
              v = r[6]; r[6] = this.r2[6]; this.r2[6] = v;
              v = r[7]; r[7] = this.r2[7]; this.r2[7] = v;
              return 4;
            }
            d = sext(this.fetch8());
            if (y === 2) {                                                             // DJNZ
              r[0] = (r[0] - 1) & 255;
              if (r[0] === 0) return 8;
            } else if (y > 3 && !this.cond(y - 4)) {                                   // JR cc non preso
              return 7;
            }
            this.pc = (this.pc + d) & 0xFFFF;                                          // JR, DJNZ, JR cc presi
            this.wz = this.pc;
            return y === 2 ? 13 : 12;
          case 1:
            if (q === 0) { this.setRp(p, this.fetch16()); return 10; }                 // LD rp,nn
            this.setHL(this.add16(this.getHL(), this.rp(p)));                          // ADD HL,rp
            return 11;
          case 2:
            if (p === 0 || p === 1) {                                                  // LD (BC),A / (DE),A / A,(BC) / A,(DE)
              a = p === 0 ? this.bc : this.de;
              if (q === 0) { this.wr(a, r[7]); this.wz = ((a + 1) & 255) | (r[7] << 8); } else { r[7] = this.rd(a); this.wz = (a + 1) & 0xFFFF; }
              return 7;
            }
            a = this.fetch16();
            if (p === 2) {
              if (q === 0) this.wr16(a, this.getHL()); else this.setHL(this.rd16(a));  // LD (nn),HL / LD HL,(nn)
              this.wz = (a + 1) & 0xFFFF;
              return 16;
            }
            if (q === 0) { this.wr(a, r[7]); this.wz = ((a + 1) & 255) | (r[7] << 8); } else { r[7] = this.rd(a); this.wz = (a + 1) & 0xFFFF; }
            return 13;
          case 3:                                                                       // INC / DEC rp
            this.setRp(p, this.rp(p) + (q === 0 ? 1 : -1));
            return 6;
          case 4: case 5:                                                               // INC r / DEC r
            if (y === 6) {
              a = this.ea();
              v = this.rd(a);
              this.wr(a, z === 4 ? this.inc8(v) : this.dec8(v));
              return this.idx ? 19 : 11;
            }
            this.sr(y, z === 4 ? this.inc8(this.gr(y)) : this.dec8(this.gr(y)));
            return 4;
          case 6:                                                                       // LD r,n
            if (y === 6) {
              a = this.ea();
              this.wr(a, this.fetch8());
              return this.idx ? 15 : 10;
            }
            this.sr(y, this.fetch8());
            return 7;
          default:
            switch (y) {
              case 0: v = r[7]; r[7] = ((v << 1) | (v >> 7)) & 255; r[6] = (r[6] & (SF | ZF | PF)) | (r[7] & (YF | XF)) | (v >> 7); return 4;   // RLCA
              case 1: v = r[7]; r[7] = (v >> 1) | ((v & 1) << 7); r[6] = (r[6] & (SF | ZF | PF)) | (r[7] & (YF | XF)) | (v & 1); return 4;     // RRCA
              case 2: v = r[7]; r[7] = ((v << 1) | (r[6] & CF)) & 255; r[6] = (r[6] & (SF | ZF | PF)) | (r[7] & (YF | XF)) | (v >> 7); return 4; // RLA
              case 3: v = r[7]; r[7] = (v >> 1) | ((r[6] & CF) << 7); r[6] = (r[6] & (SF | ZF | PF)) | (r[7] & (YF | XF)) | (v & 1); return 4;  // RRA
              case 4: this.daa(); return 4;
              case 5: r[7] ^= 0xFF; r[6] = (r[6] & (SF | ZF | PF | CF)) | HF | NF | (r[7] & (YF | XF)); return 4;                               // CPL
              case 6: r[6] = (r[6] & (SF | ZF | PF)) | CF | (r[7] & (YF | XF)); return 4;                                                         // SCF
              default: r[6] = (r[6] & (SF | ZF | PF)) | ((r[6] & CF) ? HF : CF) | (r[7] & (YF | XF)); return 4;                                    // CCF
            }
        }
      case 1:                                                                           // LD r,r' e HALT
        if (y === 6 && z === 6) { this.halted = 1; return 4; }
        if (y === 6) {                                                                   // LD (HL),r (r semplice)
          a = this.ea();
          this.wr(a, r[z]);
          return this.idx ? 15 : 7;
        }
        if (z === 6) {                                                                   // LD r,(HL) (r semplice)
          a = this.ea();
          r[y] = this.rd(a);
          return this.idx ? 15 : 7;
        }
        this.sr(y, this.gr(z));
        return 4;
      case 2:                                                                           // ALU A,r
        if (z === 6) {
          a = this.ea();
          this.alu(y, this.rd(a));
          return this.idx ? 15 : 7;
        }
        this.alu(y, this.gr(z));
        return 4;
      default:
        switch (z) {
          case 0:                                                                       // RET cc
            if (!this.cond(y)) return 5;
            this.pc = this.pop16(); this.wz = this.pc;
            return 11;
          case 1:
            if (q === 0) {                                                               // POP rp2
              v = this.pop16();
              if (p === 3) this.af = v; else this.setRp(p, v);
              return 10;
            }
            if (p === 0) { this.pc = this.pop16(); this.wz = this.pc; return 10; }       // RET
            if (p === 1) {                                                               // EXX
              for (let i = 0; i < 6; i++) { v = r[i]; r[i] = this.r2[i]; this.r2[i] = v; }
              return 4;
            }
            if (p === 2) { this.pc = this.getHL(); return 4; }                           // JP (HL)
            this.sp = this.getHL();                                                      // LD SP,HL
            return 6;
          case 2:                                                                       // JP cc,nn
            a = this.fetch16(); this.wz = a;
            if (this.cond(y)) this.pc = a;
            return 10;
          case 3:
            switch (y) {
              case 0: a = this.fetch16(); this.wz = a; this.pc = a; return 10;           // JP nn
              case 2:                                                                    // OUT (n),A
                d = this.fetch8();
                this.host.out((r[7] << 8) | d, r[7]);
                this.wz = ((d + 1) & 255) | (r[7] << 8);
                return 11;
              case 3:                                                                    // IN A,(n)
                a = (r[7] << 8) | this.fetch8();
                r[7] = this.host.in(a & 0xFFFF) & 0xFF;
                this.wz = (a + 1) & 0xFFFF;
                return 11;
              case 4:                                                                    // EX (SP),HL
                v = this.rd16(this.sp);
                this.wr(this.sp + 1, this.getHL() >> 8);                                   // prima il byte alto, poi il basso
                this.wr(this.sp, this.getHL());
                this.setHL(v); this.wz = v;
                return 19;
              case 5:                                                                    // EX DE,HL (mai IX / IY)
                v = this.de; this.de = this.hl; this.hl = v;
                return 4;
              case 6: this.iff1 = 0; this.iff2 = 0; return 4;                            // DI
              default: this.iff1 = 1; this.iff2 = 1; this.noInt = 1; return 4;           // EI (case 1 e' CB, gestito in step)
            }
          case 4:                                                                       // CALL cc,nn
            a = this.fetch16(); this.wz = a;
            if (!this.cond(y)) return 10;
            this.push16(this.pc); this.pc = a;
            return 17;
          case 5:                                                                       // PUSH rp2 / CALL nn
            if (q === 0) { this.push16(p === 3 ? this.af : this.rp(p)); return 11; }
            a = this.fetch16(); this.wz = a;
            this.push16(this.pc); this.pc = a;
            return 17;
          case 6: this.alu(y, this.fetch8()); return 7;                                  // ALU A,n
          default:                                                                      // RST
            this.push16(this.pc); this.pc = y << 3; this.wz = this.pc;
            return 11;
        }
    }
  }

  execCB() {
    const r = this.r;
    let a, v, op, x, y, z, res;
    if (this.idx) {                    // DD CB d op / FD CB d op: l'ultimo byte non e' un ciclo M1
      a = this.ea();
      op = this.fetch8();
      x = op >> 6; y = (op >> 3) & 7; z = op & 7;
      v = this.rd(a);
      if (x === 1) { this.bitFlags(y, v, a >> 8); return 16; }
      res = x === 0 ? this.rot(y, v) : x === 2 ? (v & ~(1 << y)) : (v | (1 << y));
      this.wr(a, res);
      if (z !== 6) r[z] = res;         // copia nel registro (non documentata)
      return 19;
    }
    op = this.fetchOp();
    x = op >> 6; y = (op >> 3) & 7; z = op & 7;
    if (z === 6) {
      a = this.hl;
      v = this.rd(a);
      if (x === 1) { this.bitFlags(y, v, this.wz >> 8); return 12; }
      res = x === 0 ? this.rot(y, v) : x === 2 ? (v & ~(1 << y)) : (v | (1 << y));
      this.wr(a, res);
      return 15;
    }
    v = r[z];
    if (x === 1) { this.bitFlags(y, v, v); return 8; }
    r[z] = x === 0 ? this.rot(y, v) : x === 2 ? (v & ~(1 << y)) : (v | (1 << y));
    return 8;
  }

  execED() {
    const r = this.r;
    const op = this.fetchOp();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    let a, v, res;
    if (x === 1) {
      switch (z) {
        case 0:                                                                         // IN r,(C)
          a = this.bc;
          v = this.host.in(a) & 0xFF;
          if (y !== 6) r[y] = v;
          r[6] = (r[6] & CF) | SZXYP[v];
          this.wz = (a + 1) & 0xFFFF;
          return 12;
        case 1:                                                                         // OUT (C),r
          a = this.bc;
          this.host.out(a, y === 6 ? 0 : r[y]);
          this.wz = (a + 1) & 0xFFFF;
          return 12;
        case 2:                                                                         // SBC HL,rp / ADC HL,rp
          this.hl = q === 0 ? this.sbc16(this.hl, this.rp2(p)) : this.adc16(this.hl, this.rp2(p));
          return 15;
        case 3:                                                                         // LD (nn),rp / LD rp,(nn)
          a = this.fetch16();
          if (q === 0) this.wr16(a, this.rp2(p)); else this.setRp2(p, this.rd16(a));
          this.wz = (a + 1) & 0xFFFF;
          return 20;
        case 4:                                                                         // NEG
          v = r[7]; res = -v;
          r[6] = SZXY[res & 255] | NF | ((v & 15) ? HF : 0) | (v === 0x80 ? PF : 0) | (v ? CF : 0);
          r[7] = res;
          return 8;
        case 5:                                                                         // RETN / RETI
          this.pc = this.pop16(); this.wz = this.pc;
          this.iff1 = this.iff2;
          return 14;
        case 6:                                                                         // IM
          this.im = (y & 3) === 2 ? 1 : (y & 3) === 3 ? 2 : 0;
          return 8;
        default:
          switch (y) {
            case 0: this.i = r[7]; return 9;                                              // LD I,A
            case 1: this.rr = r[7]; return 9;                                             // LD R,A
            case 2: case 3:                                                               // LD A,I / LD A,R
              v = y === 2 ? this.i : this.rr;
              r[7] = v;
              r[6] = (r[6] & CF) | SZXY[v] | (this.iff2 ? PF : 0);
              return 9;
            case 4: case 5:                                                               // RRD / RLD
              a = this.hl;
              v = this.rd(a);
              if (y === 4) { res = (r[7] & 0xF0) | (v & 15); this.wr(a, ((r[7] & 15) << 4) | (v >> 4)); } else {
                res = (r[7] & 0xF0) | (v >> 4); this.wr(a, ((v << 4) | (r[7] & 15)) & 255);
              }
              r[7] = res;
              r[6] = (r[6] & CF) | SZXYP[res];
              this.wz = (a + 1) & 0xFFFF;
              return 18;
            default: return 8;                                                            // NOP
          }
      }
    }
    if (x === 2 && y >= 4 && z < 4) return this.block(y, z);
    return 8;                                                                           // ED NOP
  }

  // come rp(), ma HL e' sempre HL (dopo ED il prefisso DD / FD e' ignorato)
  rp2(p) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.hl : this.sp; }
  setRp2(p, v) { if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.hl = v; else this.sp = v & 0xFFFF; }

  // istruzioni a blocco: y = 4..7 (LDI/LDD/LDIR/LDDR ...), z = 0..3 (LD, CP, IN, OUT)
  block(y, z) {
    const r = this.r;
    const inc = (y & 1) ? -1 : 1;
    const rep = (y & 2) !== 0;
    let v, f, n, bc, k, repeat;
    switch (z) {
      case 0:                                                                           // LDI LDD LDIR LDDR
        v = this.rd(this.hl);
        this.wr(this.de, v);
        this.hl = this.hl + inc; this.de = this.de + inc; bc = (this.bc - 1) & 0xFFFF; this.bc = bc;
        n = r[7] + v;
        f = (r[6] & (SF | ZF | CF)) | (n & XF) | ((n & 2) << 4) | (bc !== 0 ? PF : 0);
        repeat = rep && bc !== 0;
        break;
      case 1: {                                                                         // CPI CPD CPIR CPDR
        v = this.rd(this.hl);
        const res = r[7] - v;
        const h = (r[7] ^ v ^ res) & HF;
        this.hl = this.hl + inc; bc = (this.bc - 1) & 0xFFFF; this.bc = bc;
        n = (res - (h ? 1 : 0)) & 255;
        f = (r[6] & CF) | NF | (res & SF) | ((res & 255) === 0 ? ZF : 0) | h | (n & XF) | ((n & 2) << 4) | (bc !== 0 ? PF : 0);
        this.wz = (this.wz + inc) & 0xFFFF;
        repeat = rep && bc !== 0 && (res & 255) !== 0;
        break;
      }
      case 2: {                                                                         // INI IND INIR INDR
        const port = this.bc;
        v = this.host.in(port) & 0xFF;
        this.wr(this.hl, v);
        r[0] = (r[0] - 1) & 255;
        this.wz = (port + inc) & 0xFFFF;
        this.hl = this.hl + inc;
        k = v + ((r[1] + inc) & 255);
        f = SZXY[r[0]] | ((v & 0x80) ? NF : 0) | (k > 255 ? (HF | CF) : 0) | PAR[(k & 7) ^ r[0]];
        repeat = rep && r[0] !== 0;
        break;
      }
      default: {                                                                        // OUTI OUTD OTIR OTDR
        v = this.rd(this.hl);
        r[0] = (r[0] - 1) & 255;
        const port = this.bc;
        this.host.out(port, v);
        this.wz = (port + inc) & 0xFFFF;
        this.hl = this.hl + inc;
        k = v + r[5];
        f = SZXY[r[0]] | ((v & 0x80) ? NF : 0) | (k > 255 ? (HF | CF) : 0) | PAR[(k & 7) ^ r[0]];
        repeat = rep && r[0] !== 0;
        break;
      }
    }
    if (repeat) {
      this.pc = (this.pc - 2) & 0xFFFF;
      this.wz = (this.pc + 1) & 0xFFFF;
      f = (f & ~(YF | XF)) | ((this.pc >> 8) & (YF | XF));
    }
    r[6] = f;
    return repeat ? 21 : 16;
  }
}

module.exports = {Z80, SF, ZF, YF, HF, XF, PF, NF, CF};
