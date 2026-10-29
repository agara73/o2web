'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// cpu8048.js - nucleo MCS-48 (Intel 8048) a interprete. Codice originale; la semantica e' quella di ref/ref8048.py
// (fonte di verita' per i test differenziali) e del manuale MCS-48. I punti che il manuale non fissa sono marcati
// "DA VERIFICARE" (stessi del riferimento):
//   - RAM interna da 64 byte, indirizzi @R0/@R1 specchiati modulo 64;
//   - il PC avanza su 11 bit mantenendo il bit 11 (da 0x7FF si passa a 0x000);
//   - durante un interrupt il banco di memoria e' forzato a MB0 (JMP/CALL/RET senza A11);
//   - JNI: nessun "trucco" per l'interrupt che arriva subito dopo l'istruzione;
//   - MOVD/ANLD/ORLD: espansore 8243 modellato in modo semplice (P2 basso = codice, poi dato).
//
// Modello del tempo. Ad ogni "confine" fra istruzioni:
//   1. host.sync(cpu): l'ambiente applica gli eventi scaduti (<= cpu.now);
//   2. si controllano gli interrupt: se ne scatta uno, si salvano PC/PSW, vettore 3 (esterno) o 7 (timer), 2 cicli,
//      poi di nuovo host.sync(cpu);
//   3. si esegue l'istruzione (corpo) e poi trascorrono i suoi cicli: avanzano 'now', il prescaler e il timer; un
//      overflow imposta TF (e l'interrupt del timer in attesa se EN TCNTI era attivo).
// Il timer legge quindi il valore all'inizio dell'istruzione.
//
// Interfaccia dell'ambiente (host): la CPU non conosce alcun indirizzo ne' registro della console.
//   host.readProg(a12)          byte della memoria programma all'indirizzo a 12 bit
//   host.t0() / host.t1()       livello dei pin T0 / T1 (0 o 1)
//   host.intActive()            1 se /INT e' attivo
//   host.p1Pin() p2Pin() busPin()   livello dei pin delle porte (la CPU li combina con i propri latch)
//   host.movxRead(a8) / host.movxWrite(a8, v)   ciclo di memoria esterna (MOVX)
//   host.sync(cpu)              applica gli eventi dell'ambiente scaduti
// Stato leggibile dall'ambiente: cpu.now (cicli macchina), cpu.p1, cpu.p2, cpu.bus (latch di uscita).
// Il fronte di discesa di T1 per il modo contatore si segnala con cpu.t1Changed(livello).

const C_FLAG = 0x80, A_FLAG = 0x40, F_FLAG = 0x20, B_FLAG = 0x10;

// opcode non definiti (nessun effetto, 1 ciclo, 1 byte)
const ILLEGAL = new Uint8Array(256);
for (const o of [0x01, 0x06, 0x0B, 0x22, 0x33, 0x38, 0x3B, 0x63, 0x66, 0x73, 0x82, 0x87, 0x8B, 0x9B, 0xA2, 0xA6,
  0xB7, 0xC0, 0xC1, 0xC2, 0xC3, 0xD6, 0xE0, 0xE1, 0xE2, 0xF3]) ILLEGAL[o] = 1;

// cicli macchina: 2 per tutte le istruzioni da 2 byte e per alcune da 1 byte, altrimenti 1 (opcode illegali: 1)
const CYCLES = new Uint8Array(256).fill(1);
(function buildCycles() {
  const two = [0x03, 0x13, 0x23, 0x43, 0x53, 0xD3, 0x88, 0x89, 0x8A, 0x98, 0x99, 0x9A, 0xB0, 0xB1,
    0x12, 0x32, 0x52, 0x72, 0x92, 0xB2, 0xD2, 0xF2, 0x16, 0x26, 0x36, 0x46, 0x56, 0x76, 0x86, 0x96, 0xB6, 0xC6, 0xE6, 0xF6,
    0x02, 0x08, 0x09, 0x0A, 0x39, 0x3A, 0x80, 0x81, 0x83, 0x90, 0x91, 0x93, 0xA3, 0xB3, 0xE3];
  for (const o of two) CYCLES[o] = 2;
  for (let o = 0xB8; o < 0xC0; o++) CYCLES[o] = 2;      // MOV Rn,#
  for (let o = 0xE8; o < 0xF0; o++) CYCLES[o] = 2;      // DJNZ
  for (let o = 0x0C; o < 0x10; o++) CYCLES[o] = 2;      // MOVD A,Pn
  for (let o = 0x3C; o < 0x40; o++) CYCLES[o] = 2;      // MOVD Pn,A
  for (let o = 0x8C; o < 0x90; o++) CYCLES[o] = 2;      // ORLD
  for (let o = 0x9C; o < 0xA0; o++) CYCLES[o] = 2;      // ANLD
  for (let o = 0; o < 256; o++) {
    if ((o & 0x1F) === 0x04 || (o & 0x1F) === 0x14) CYCLES[o] = 2;   // JMP / CALL
    if (ILLEGAL[o]) CYCLES[o] = 1;
  }
})();

class CPU8048 {
  constructor(host) {
    this.host = host;
    this.ram = new Uint8Array(64);
    this.exp = new Uint8Array(4);      // latch dell'espansore P4..P7 (4 bit ciascuno)
    this.reset();
  }

  reset() {
    this.a = 0;
    this.pc = 0;
    this.psw = 0;                      // C AC F0 BS . S2 S1 S0 (il bit 3 non e' memorizzato)
    this.f1 = 0;
    this.a11 = 0;                      // 0x000 o 0x800 (SEL MB0 / MB1)
    this.ram.fill(0);
    this.exp.fill(0);
    this.timer = 0;
    this.prescaler = 0;
    this.timerEn = 0;                  // modo timer (STRT T)
    this.counterEn = 0;                // modo contatore su T1 (STRT CNT)
    this.tf = 0;
    this.tirqEn = 0;
    this.xirqEn = 0;
    this.inProgress = 0;
    this.timerPend = 0;
    this.p1 = 0xFF;
    this.p2 = 0xFF;
    this.bus = 0xFF;
    this.now = 0;
    this.t1Prev = 0;
    this.lastOp = 0;
  }

  // ------------------------------------------------------- stato serializzabile (snapshot)
  // Solo stato della CPU (registri, RAM interna, timer, flag, porte, tempo): nessun contenuto di programma. loadState convalida
  // tutti i campi prima di modificare qualcosa (un file di stato e' un input dell'utente: puo' essere corrotto o falsificato).
  saveState() {
    return {a: this.a, pc: this.pc, psw: this.psw, f1: this.f1, a11: this.a11, ram: Array.from(this.ram), exp: Array.from(this.exp),
      timer: this.timer, prescaler: this.prescaler, timerEn: this.timerEn, counterEn: this.counterEn, tf: this.tf,
      tirqEn: this.tirqEn, xirqEn: this.xirqEn, inProgress: this.inProgress, timerPend: this.timerPend, p1: this.p1,
      p2: this.p2, bus: this.bus, now: this.now, t1Prev: this.t1Prev, lastOp: this.lastOp};
  }

  loadState(s) {
    const chk = (v, lo, hi, name) => {
      if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('stato non valido: ' + name);
      return v;
    };
    if (!s || !Array.isArray(s.ram) || s.ram.length !== 64 || !Array.isArray(s.exp) || s.exp.length !== 4) {
      throw new Error('stato non valido: RAM o espansore della CPU');
    }
    const n = {
      a: chk(s.a, 0, 255, 'A'), pc: chk(s.pc, 0, 0xFFF, 'PC'), psw: chk(s.psw, 0, 255, 'PSW'), f1: chk(s.f1, 0, 1, 'F1'),
      a11: chk(s.a11, 0, 0x800, 'banco'), timer: chk(s.timer, 0, 255, 'timer'), prescaler: chk(s.prescaler, 0, 31, 'prescaler'),
      timerEn: chk(s.timerEn, 0, 1, 'timerEn'), counterEn: chk(s.counterEn, 0, 1, 'counterEn'), tf: chk(s.tf, 0, 1, 'TF'),
      tirqEn: chk(s.tirqEn, 0, 1, 'tirqEn'), xirqEn: chk(s.xirqEn, 0, 1, 'xirqEn'), inProgress: chk(s.inProgress, 0, 1, 'inProgress'),
      timerPend: chk(s.timerPend, 0, 1, 'timerPend'), p1: chk(s.p1, 0, 255, 'P1'), p2: chk(s.p2, 0, 255, 'P2'),
      bus: chk(s.bus, 0, 255, 'BUS'), now: chk(s.now, 0, Number.MAX_SAFE_INTEGER, 'tempo'), t1Prev: chk(s.t1Prev, 0, 1, 'T1'),
      lastOp: chk(s.lastOp, 0, 255, 'ultimo opcode'),
    };
    if (n.a11 !== 0 && n.a11 !== 0x800) throw new Error('stato non valido: banco');
    const ram = s.ram.map((v) => chk(v, 0, 255, 'RAM interna'));
    const exp = s.exp.map((v) => chk(v, 0, 15, 'espansore'));
    Object.assign(this, n);
    this.ram.set(ram);
    this.exp.set(exp);
  }

  // ---------------------------------------------------------------- utilita'
  R(n) { return this.ram[((this.psw & B_FLAG) ? 24 : 0) + n]; }
  setR(n, v) { this.ram[((this.psw & B_FLAG) ? 24 : 0) + n] = v; }
  ir(a) { return this.ram[a & 0x3F]; }
  iw(a, v) { this.ram[a & 0x3F] = v; }

  fetch() {
    const v = this.host.readProg(this.pc);
    this.pc = ((this.pc + 1) & 0x7FF) | (this.pc & 0x800);
    return v;
  }

  push() {
    const sp = this.psw & 7;
    this.ram[8 + 2 * sp] = this.pc & 0xFF;
    this.ram[9 + 2 * sp] = ((this.pc >> 8) & 0x0F) | (this.psw & 0xF0);
    this.psw = (this.psw & 0xF8) | ((sp + 1) & 7);
  }

  pull(restorePsw) {
    const sp = (this.psw - 1) & 7;
    const lo = this.ram[8 + 2 * sp];
    const hi = this.ram[9 + 2 * sp];
    if (restorePsw) this.psw = (hi & 0xF0) | sp;
    else this.psw = (this.psw & 0xF0) | sp;
    this.pc = (lo | (hi << 8)) & (this.inProgress ? 0x7FF : 0xFFF);
  }

  jmp(addr11) { this.pc = addr11 | (this.inProgress ? 0 : this.a11); }

  // salto condizionale: la pagina e' quella del byte dell'operando
  jcc(cond) {
    const page = this.pc & 0xF00;
    const off = this.fetch();
    if (cond) this.pc = page | off;
  }

  add(x, cin) {
    const a = this.a;
    const t = a + x + cin;
    const t4 = (a & 15) + (x & 15) + cin;
    this.psw &= ~(C_FLAG | A_FLAG);
    if (t4 > 15) this.psw |= A_FLAG;
    if (t > 255) this.psw |= C_FLAG;
    this.a = t & 0xFF;
  }

  expander(op, port) {
    // op: 0 lettura, 1 scrittura, 2 ORLD, 3 ANLD. Codice sul nibble basso di P2: op (bit 3-2), porta (bit 1-0)
    this.p2 = (this.p2 & 0xF0) | (op << 2) | (port & 3);
    if (op === 0) {
      this.p2 |= 0x0F;
      this.a = this.exp[port & 3] & 0x0F;
    } else {
      if (op === 1) this.exp[port & 3] = this.a & 0x0F;
      else if (op === 2) this.exp[port & 3] |= this.a & 0x0F;
      else this.exp[port & 3] &= this.a & 0x0F;
      this.p2 = (this.p2 & 0xF0) | (this.a & 0x0F);
    }
  }

  // ------------------------------------------------------------------- tempo
  burn(n) {
    this.now += n;
    if (this.timerEn) {
      this.prescaler += n;
      let ticks = this.prescaler >> 5;
      this.prescaler &= 31;
      while (ticks-- > 0) {
        this.timer = (this.timer + 1) & 0xFF;
        if (this.timer === 0) this.overflow();
      }
    }
  }

  overflow() {
    this.tf = 1;
    if (this.tirqEn) this.timerPend = 1;
  }

  // l'ambiente segnala un cambio del livello di T1 (da chiamare prima di aggiornare il valore che host.t1() restituisce)
  t1Changed(level) {
    if (this.counterEn && this.t1Prev === 1 && level === 0) {       // fronte di discesa
      this.timer = (this.timer + 1) & 0xFF;
      if (this.timer === 0) this.overflow();
    }
    this.t1Prev = level;
  }

  checkIrqs() {
    if (this.inProgress) return false;
    if (this.host.intActive() && this.xirqEn) {
      this.inProgress = 1;
      this.push();
      this.pc = 3;
      this.burn(2);
      return true;
    }
    if (this.timerPend && this.tirqEn) {
      this.inProgress = 1;
      this.push();
      this.pc = 7;
      this.timerPend = 0;
      this.burn(2);
      return true;
    }
    return false;
  }

  boundary() {
    this.host.sync(this);
    if (this.checkIrqs()) this.host.sync(this);
  }

  // un passo: confine + una istruzione. Ritorna i cicli (l'opcode resta in this.lastOp)
  step() {
    this.boundary();
    const op = this.fetch();
    const cyc = CYCLES[op];
    this.execute(op);
    this.burn(cyc);
    this.lastOp = op;
    return cyc;
  }

  // esegue istruzioni finche' 'now' non raggiunge 'limit' (cicli macchina assoluti)
  runUntil(limit) {
    while (this.now < limit) this.step();
  }

  // ------------------------------------------------------------ istruzioni
  execute(op) {
    const h = this.host;
    const r = op & 7;
    if (ILLEGAL[op]) return;
    switch (op & 0xF8) {                                   // famiglie con registro
      case 0x18: this.setR(r, this.R(r) + 1); return;                              // INC Rn
      case 0x28: { const t = this.R(r); this.setR(r, this.a); this.a = t; return; } // XCH A,Rn
      case 0x48: this.a |= this.R(r); return;                                      // ORL A,Rn
      case 0x58: this.a &= this.R(r); return;                                      // ANL A,Rn
      case 0x68: this.add(this.R(r), 0); return;                                   // ADD A,Rn
      case 0x78: this.add(this.R(r), (this.psw & C_FLAG) ? 1 : 0); return;         // ADDC A,Rn
      case 0xA8: this.setR(r, this.a); return;                                     // MOV Rn,A
      case 0xB8: this.setR(r, this.fetch()); return;                               // MOV Rn,#n
      case 0xC8: this.setR(r, this.R(r) - 1); return;                              // DEC Rn
      case 0xD8: this.a ^= this.R(r); return;                                      // XRL A,Rn
      case 0xE8: { const v = (this.R(r) - 1) & 0xFF; this.setR(r, v); this.jcc(v !== 0); return; } // DJNZ
      case 0xF8: this.a = this.R(r); return;                                       // MOV A,Rn
    }
    if ((op & 0x1F) === 0x04) { this.jmp(((op & 0xE0) << 3) | this.fetch()); return; }          // JMP
    if ((op & 0x1F) === 0x14) {                                                                   // CALL
      const addr = ((op & 0xE0) << 3) | this.fetch();
      this.push();
      this.jmp(addr);
      return;
    }
    if (op >= 0x0C && op <= 0x0F) { this.expander(0, 4 + (op & 3)); return; }     // MOVD A,Pn
    if (op >= 0x3C && op <= 0x3F) { this.expander(1, 4 + (op & 3)); return; }     // MOVD Pn,A
    if (op >= 0x8C && op <= 0x8F) { this.expander(2, 4 + (op & 3)); return; }     // ORLD Pn,A
    if (op >= 0x9C && op <= 0x9F) { this.expander(3, 4 + (op & 3)); return; }     // ANLD Pn,A
    switch (op) {
      // --- salti condizionali
      case 0x12: this.jcc(this.a & 0x01); return;
      case 0x32: this.jcc(this.a & 0x02); return;
      case 0x52: this.jcc(this.a & 0x04); return;
      case 0x72: this.jcc(this.a & 0x08); return;
      case 0x92: this.jcc(this.a & 0x10); return;
      case 0xB2: this.jcc(this.a & 0x20); return;
      case 0xD2: this.jcc(this.a & 0x40); return;
      case 0xF2: this.jcc(this.a & 0x80); return;
      case 0x16: { const c = this.tf; this.tf = 0; this.jcc(c); return; }            // JTF
      case 0x26: this.jcc(!h.t0()); return;                                          // JNT0
      case 0x36: this.jcc(!!h.t0()); return;                                         // JT0
      case 0x46: this.jcc(!h.t1()); return;                                          // JNT1
      case 0x56: this.jcc(!!h.t1()); return;                                         // JT1
      case 0x76: this.jcc(this.f1); return;                                          // JF1
      case 0x86: this.jcc(!!h.intActive()); return;                                  // JNI
      case 0x96: this.jcc(this.a !== 0); return;                                     // JNZ
      case 0xB6: this.jcc(this.psw & F_FLAG); return;                                // JF0
      case 0xC6: this.jcc(this.a === 0); return;                                     // JZ
      case 0xE6: this.jcc(!(this.psw & C_FLAG)); return;                             // JNC
      case 0xF6: this.jcc(this.psw & C_FLAG); return;                                // JC
      // --- accumulatore
      case 0x00: return;                                                             // NOP
      case 0x75: return;                                                             // ENT0 CLK (nessun effetto)
      case 0x03: this.add(this.fetch(), 0); return;                                  // ADD A,#n
      case 0x13: this.add(this.fetch(), (this.psw & C_FLAG) ? 1 : 0); return;        // ADDC A,#n
      case 0x23: this.a = this.fetch(); return;                                      // MOV A,#n
      case 0x43: this.a |= this.fetch(); return;                                     // ORL A,#n
      case 0x53: this.a &= this.fetch(); return;                                     // ANL A,#n
      case 0xD3: this.a ^= this.fetch(); return;                                     // XRL A,#n
      case 0x07: this.a = (this.a - 1) & 0xFF; return;                               // DEC A
      case 0x17: this.a = (this.a + 1) & 0xFF; return;                               // INC A
      case 0x27: this.a = 0; return;                                                 // CLR A
      case 0x37: this.a ^= 0xFF; return;                                             // CPL A
      case 0x47: this.a = ((this.a << 4) | (this.a >> 4)) & 0xFF; return;            // SWAP A
      case 0x57:                                                                     // DA A
        if ((this.a & 0x0F) > 9 || (this.psw & A_FLAG)) {
          if (this.a > 0xF9) this.psw |= C_FLAG;
          this.a = (this.a + 6) & 0xFF;
        }
        if ((this.a & 0xF0) > 0x90 || (this.psw & C_FLAG)) {
          this.a = (this.a + 0x60) & 0xFF;
          this.psw |= C_FLAG;
        }
        return;
      case 0x67: {                                                                   // RRC A
        const c = this.a & 1;
        this.a = (this.a >> 1) | ((this.psw & C_FLAG) ? 0x80 : 0);
        this.psw = (this.psw & ~C_FLAG) | (c ? C_FLAG : 0);
        return;
      }
      case 0xF7: {                                                                   // RLC A
        const c = this.a >> 7;
        this.a = ((this.a << 1) & 0xFF) | ((this.psw & C_FLAG) ? 1 : 0);
        this.psw = (this.psw & ~C_FLAG) | (c ? C_FLAG : 0);
        return;
      }
      case 0x77: this.a = (this.a >> 1) | ((this.a & 1) << 7); return;               // RR A
      case 0xE7: this.a = ((this.a << 1) & 0xFF) | (this.a >> 7); return;            // RL A
      // --- memoria interna indirizzata da R0/R1
      case 0x10: this.iw(this.R(0), this.ir(this.R(0)) + 1); return;                 // INC @R0
      case 0x11: this.iw(this.R(1), this.ir(this.R(1)) + 1); return;                 // INC @R1
      case 0x20: { const t = this.ir(this.R(0)); this.iw(this.R(0), this.a); this.a = t; return; }   // XCH A,@R0
      case 0x21: { const t = this.ir(this.R(1)); this.iw(this.R(1), this.a); this.a = t; return; }   // XCH A,@R1
      case 0x30: { const t = this.ir(this.R(0)); this.iw(this.R(0), (t & 0xF0) | (this.a & 0x0F)); this.a = (this.a & 0xF0) | (t & 0x0F); return; }  // XCHD A,@R0
      case 0x31: { const t = this.ir(this.R(1)); this.iw(this.R(1), (t & 0xF0) | (this.a & 0x0F)); this.a = (this.a & 0xF0) | (t & 0x0F); return; }  // XCHD A,@R1
      case 0x40: this.a |= this.ir(this.R(0)); return;                               // ORL A,@R0
      case 0x41: this.a |= this.ir(this.R(1)); return;
      case 0x50: this.a &= this.ir(this.R(0)); return;                               // ANL A,@R0
      case 0x51: this.a &= this.ir(this.R(1)); return;
      case 0xD0: this.a ^= this.ir(this.R(0)); return;                               // XRL A,@R0
      case 0xD1: this.a ^= this.ir(this.R(1)); return;
      case 0x60: this.add(this.ir(this.R(0)), 0); return;                            // ADD A,@R0
      case 0x61: this.add(this.ir(this.R(1)), 0); return;
      case 0x70: this.add(this.ir(this.R(0)), (this.psw & C_FLAG) ? 1 : 0); return;  // ADDC A,@R0
      case 0x71: this.add(this.ir(this.R(1)), (this.psw & C_FLAG) ? 1 : 0); return;
      case 0xA0: this.iw(this.R(0), this.a); return;                                 // MOV @R0,A
      case 0xA1: this.iw(this.R(1), this.a); return;
      case 0xB0: this.iw(this.R(0), this.fetch()); return;                           // MOV @R0,#n
      case 0xB1: this.iw(this.R(1), this.fetch()); return;
      case 0xF0: this.a = this.ir(this.R(0)); return;                                // MOV A,@R0
      case 0xF1: this.a = this.ir(this.R(1)); return;
      // --- porte e bus
      case 0x02: this.bus = this.a; return;                                          // OUTL BUS,A
      case 0x08: this.a = h.busPin(); return;                                        // INS A,BUS
      case 0x09: this.a = h.p1Pin() & this.p1; return;                               // IN A,P1
      case 0x0A: this.a = h.p2Pin() & this.p2; return;                               // IN A,P2
      case 0x39: this.p1 = this.a; return;                                           // OUTL P1,A
      case 0x3A: this.p2 = this.a; return;                                           // OUTL P2,A
      case 0x88: this.bus = h.busPin() | this.fetch(); return;                       // ORL BUS,#n
      case 0x98: this.bus = h.busPin() & this.fetch(); return;                       // ANL BUS,#n
      case 0x89: this.p1 |= this.fetch(); return;                                    // ORL P1,#n
      case 0x99: this.p1 &= this.fetch(); return;                                    // ANL P1,#n
      case 0x8A: this.p2 |= this.fetch(); return;                                    // ORL P2,#n
      case 0x9A: this.p2 &= this.fetch(); return;                                    // ANL P2,#n
      // --- memoria esterna
      case 0x80: this.a = h.movxRead(this.R(0)); return;                             // MOVX A,@R0
      case 0x81: this.a = h.movxRead(this.R(1)); return;
      case 0x90: h.movxWrite(this.R(0), this.a); return;                             // MOVX @R0,A
      case 0x91: h.movxWrite(this.R(1), this.a); return;
      // --- timer, contatore, interrupt
      case 0x42: this.a = this.timer; return;                                        // MOV A,T
      case 0x62: this.timer = this.a; return;                                        // MOV T,A
      case 0x55: this.timerEn = 1; this.counterEn = 0; this.prescaler = 0; return;   // STRT T
      case 0x45:                                                                     // STRT CNT
        if (!this.counterEn) this.t1Prev = h.t1();
        this.counterEn = 1;
        this.timerEn = 0;
        return;
      case 0x65: this.timerEn = 0; this.counterEn = 0; return;                       // STOP TCNT
      case 0x05: this.xirqEn = 1; return;                                            // EN I
      case 0x15: this.xirqEn = 0; return;                                            // DIS I
      case 0x25: this.tirqEn = 1; return;                                            // EN TCNTI
      case 0x35: this.tirqEn = 0; this.timerPend = 0; return;                        // DIS TCNTI
      // --- sottoprogrammi
      case 0x83: this.pull(false); return;                                           // RET
      case 0x93: this.inProgress = 0; this.pull(true); return;                       // RETR
      // --- flag, banchi, PSW
      case 0x85: this.psw &= ~F_FLAG; return;                                        // CLR F0
      case 0x95: this.psw ^= F_FLAG; return;                                         // CPL F0
      case 0xA5: this.f1 = 0; return;                                                // CLR F1
      case 0xB5: this.f1 ^= 1; return;                                               // CPL F1
      case 0x97: this.psw &= ~C_FLAG; return;                                        // CLR C
      case 0xA7: this.psw ^= C_FLAG; return;                                         // CPL C
      case 0xC5: this.psw &= ~B_FLAG; return;                                        // SEL RB0
      case 0xD5: this.psw |= B_FLAG; return;                                         // SEL RB1
      case 0xE5: this.a11 = 0; return;                                               // SEL MB0
      case 0xF5: this.a11 = 0x800; return;                                           // SEL MB1
      case 0xC7: this.a = this.psw | 0x08; return;                                   // MOV A,PSW
      case 0xD7: this.psw = this.a & 0xF7; return;                                   // MOV PSW,A
      // --- tabelle in memoria programma
      case 0xA3: this.a = h.readProg((this.pc & 0xF00) | this.a); return;            // MOVP A,@A
      case 0xE3: this.a = h.readProg(0x300 | this.a); return;                        // MOVP3 A,@A
      case 0xB3: {                                                                   // JMPP @A
        const page = this.pc & 0xF00;
        this.pc = page | h.readProg(page | this.a);
        return;
      }
    }
    throw new Error('opcode non gestito ' + op.toString(16));
  }
}

module.exports = {CPU8048, CYCLES, ILLEGAL, C_FLAG, A_FLAG, F_FLAG, B_FLAG};
