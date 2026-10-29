'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// chess_testrom.js - programmi di PROVA ORIGINALI per il modulo scacchi C7010, scritti per questo progetto (nessun byte viene da un
// dump): un "BIOS" da 1 KB per l'8048 e una ROM da 8 KB per lo Z80, con due piccoli assemblatori. Servono a collaudare il bus
// senza la ROM vera del modulo: specchi della RAM, ROM e memoria non mappata dello Z80, porta specchiata, i due latch, i
// bit di accesso (P1 bit 0 e 4), il reset da P1 bit 1 (la RAM e i latch sopravvivono) e la sincronia dei due processori.
//
// Protocollo di prova. Lo Z80 attende un comando diverso dall'ultimo nel latch 1 (IN) e risponde nel latch 0 (OUT): comando
// 0x00-0x9F e 0xB0-0xFF -> risposta = complemento del comando; comando 0xA0 + i (i = 0..15) -> risposta = byte i della tabella di
// autocontrollo che lo Z80 ha scritto in RAM all'avvio (0xE100 + i; il byte 15 e' il contatore degli avvii, che resta in RAM
// anche dopo un reset). L'8048 scrive i risultati nella RAM esterna da 128 byte (indice nella tabella RESULTS).

// ------------------------------------------------------------------ assemblatore 8048 minimo (solo cio' che serve)
class Asm48 {
  constructor() { this.b = []; this.labels = {}; this.fix = []; }
  get pc() { return this.b.length; }
  label(n) { this.labels[n] = this.pc; return this; }
  emit(...v) { for (const x of v) this.b.push(x & 255); return this; }
  org(a) { while (this.b.length < a) this.b.push(0); return this; }
  movAi(n) { return this.emit(0x23, n); }
  movRi(r, n) { return this.emit(0xB8 + r, n); }
  movAR(r) { return this.emit(0xF8 + r); }
  movRA(r) { return this.emit(0xA8 + r); }
  movIndA(r) { return this.emit(0xA0 + r); }          // MOV @Rr,A
  movxWr(r) { return this.emit(0x90 + r); }           // MOVX @Rr,A
  movxRd(r) { return this.emit(0x80 + r); }           // MOVX A,@Rr
  outlP1() { return this.emit(0x39); }
  anlP1(n) { return this.emit(0x99, n); }
  orlP1(n) { return this.emit(0x89, n); }
  incR(r) { return this.emit(0x18 + r); }
  clrA() { return this.emit(0x27); }
  nop() { return this.emit(0x00); }
  ret() { return this.emit(0x83); }
  jmp(n) { this.fix.push([this.pc, n, 'jmp']); return this.emit(0x04, 0); }
  call(n) { this.fix.push([this.pc, n, 'call']); return this.emit(0x14, 0); }
  djnz(r, n) { this.fix.push([this.pc, n, 'rel']); return this.emit(0xE8 + r, 0); }
  link() {
    for (const [at, n, kind] of this.fix) {
      const t = this.labels[n];
      if (t === undefined) throw new Error('etichetta mancante: ' + n);
      if (kind === 'rel') {
        if ((t >> 8) !== ((at + 1) >> 8)) throw new Error('DJNZ fuori pagina: ' + n);
        this.b[at + 1] = t & 255;
      } else {
        this.b[at] = (kind === 'jmp' ? 0x04 : 0x14) | ((t >> 8) << 5);
        this.b[at + 1] = t & 255;
      }
    }
    return Uint8Array.from(this.b);
  }
}

// ------------------------------------------------------------------ assemblatore Z80 minimo
class AsmZ80 {
  constructor() { this.b = []; this.labels = {}; this.fix = []; }
  get pc() { return this.b.length; }
  label(n) { this.labels[n] = this.pc; return this; }
  emit(...v) { for (const x of v) this.b.push(x & 255); return this; }
  w(n, v) { return this.emit(n, v & 255, v >> 8); }
  jr(op, n) { this.fix.push([this.pc, n]); return this.emit(op, 0); }
  link() {
    for (const [at, n] of this.fix) {
      const t = this.labels[n];
      if (t === undefined) throw new Error('etichetta mancante: ' + n);
      const d = t - (at + 2);
      if (d < -128 || d > 127) throw new Error('salto troppo lungo: ' + n);
      this.b[at + 1] = d & 255;
    }
    return Uint8Array.from(this.b);
  }
}

// indirizzi della RAM dello Z80 usati dalla prova
const TABLE = 0xE100;

// ROM da 8 KB dello Z80 (riempita con 0xFF; il byte a 0x0100 vale 0x5A, il byte a 0x0000 e' DI = 0xF3)
function buildZ80Rom() {
  const a = new AsmZ80();
  a.emit(0xF3);                                      // DI
  a.w(0x31, 0xE800);                                 // LD SP,E800
  a.w(0x3A, TABLE + 15).emit(0x3C).w(0x32, TABLE + 15);   // contatore degli avvii nella cella 15 della tabella (comando 0xAF): la RAM resta dopo un reset
  a.emit(0x3E, 0x11).w(0x32, 0xE000);                // LD A,11 ; LD (E000),A
  const rd = (src, i) => a.w(0x3A, src).w(0x32, TABLE + i);   // LD A,(src) ; LD (TABLE+i),A
  rd(0xE800, 0); rd(0xF000, 1); rd(0xF800, 2);       // specchi della RAM: stesso valore 0x11
  a.emit(0x3E, 0x77).w(0x32, 0xF801);                // scrittura nello specchio
  rd(0xE001, 3);                                     // lettura dalla base: 0x77
  rd(0x4000, 4);                                     // zona non mappata: 0xFF
  rd(0x0000, 5);                                     // ROM: primo byte = 0xF3
  a.emit(0x3E, 0xAA).w(0x32, 0x0100);                // scrittura in ROM: ignorata
  rd(0x0100, 6);                                     // ROM a 0x0100 = 0x5A
  a.emit(0x3E, 0x66).w(0x32, 0x2000);                // scrittura in zona non mappata: ignorata
  rd(0x2000, 7);                                     // 0xFF
  a.emit(0x3E, 0x99).w(0x32, 0xE7FF);                // ultimo byte della RAM base
  rd(0xFFFF, 8);                                     // specchio dell'ultimo byte: 0x99
  // porta specchiata: IN A,(n) con n diversi legge sempre il latch 1; OUT (n),A scrive sempre nel latch 0
  a.emit(0x06, 0x00);                                // LD B,0   (ultimo comando visto)
  a.label('loop');
  a.emit(0xDB, 0x00);                                // IN A,(00)
  a.emit(0xB8);                                      // CP B
  a.jr(0x28, 'loop');                                // JR Z,loop
  a.emit(0x47);                                      // LD B,A
  a.emit(0xFE, 0xA0).jr(0x38, 'echo');               // CP A0 ; JR C,echo
  a.emit(0xFE, 0xB0).jr(0x30, 'echo');               // CP B0 ; JR NC,echo
  a.emit(0xE6, 0x0F, 0x5F, 0x16, 0x00);              // AND 0F ; LD E,A ; LD D,0
  a.w(0x21, TABLE).emit(0x19, 0x7E);                 // LD HL,TABLE ; ADD HL,DE ; LD A,(HL)
  a.jr(0x18, 'out');                                 // JR out
  a.label('echo').emit(0x2F);                        // CPL
  a.label('out').emit(0xD3, 0x37);                   // OUT (37),A
  a.jr(0x18, 'loop');
  const code = a.link();
  if (code.length > 0x100) throw new Error('ROM Z80 di prova: il codice supera 0x100 byte');
  const rom = new Uint8Array(0x2000).fill(0xFF);
  rom.set(code, 0);
  rom[0x0100] = 0x5A;
  return rom;
}

// indici dei risultati nella RAM esterna dell'8048 (xram)
const RESULTS = {
  echo01: 0, echo55: 1, table: 2 /* 9 celle: 2..10 */, boots: 11, noLatchRead: 12, alt: 13 /* 4 celle: 13..16 */,
  heldInReset: 17, pendingAfterRelease: 18, bootsAfter: 19, endMark: 20, echoAlt: 21, echoAlt2: 22,
};
const EXPECTED = (() => {
  const e = new Array(23).fill(0);
  e[RESULTS.echo01] = 0xFE; e[RESULTS.echo55] = 0xAA;
  [0x11, 0x11, 0x11, 0x77, 0xFF, 0xF3, 0x5A, 0xFF, 0x99].forEach((v, i) => { e[RESULTS.table + i] = v; });
  e[RESULTS.boots] = 1; e[RESULTS.noLatchRead] = 0xFF;
  for (let i = 0; i < 4; i++) e[RESULTS.alt + i] = 1;
  e[RESULTS.heldInReset] = 1; e[RESULTS.pendingAfterRelease] = 0xBD; e[RESULTS.bootsAfter] = 2; e[RESULTS.endMark] = 0xEE;
  e[RESULTS.echoAlt] = 0xF0; e[RESULTS.echoAlt2] = 0x0F;
  return e;
})();

// "BIOS" da 1 KB per l'8048 (nessuna cartuccia): esegue il protocollo e scrive i risultati nella RAM esterna
function buildBios8048() {
  const a = new Asm48();
  a.jmp('main');                                     // vettore di reset
  a.org(3).ret();                                    // interrupt esterno: non usato
  a.org(7).ret();                                    // timer: non usato
  a.org(0x10);
  // attesa di circa R2 * 2 * 256 cicli: delay(R2 gia' caricato)
  a.label('delay').movRi(3, 0).label('d1').djnz(3, 'd1').djnz(2, 'delay').ret();
  // comando(A = comando, R1 = indirizzo di scrittura, R6 = indirizzo di lettura, R0 = indice del risultato)
  a.label('cmd');
  a.movxWr(1);                                       // MOVX @R1,A  (latch 1, A7 = 1)
  a.movRi(2, 1).call('delay');                       // attesa
  a.movAR(6).movRA(1);                               // R1 = indirizzo di lettura
  a.movxRd(1);                                       // MOVX A,@R1  (latch 0)
  a.movxWr(0);                                       // MOVX @R0,A  (RAM esterna: P1 bit 4 = 0 e A7 = 0 -> non e' il modulo)
  a.incR(0);
  a.ret();
  a.org(0x40);
  a.label('main');
  a.movAi(0xAE).outlP1();                            // P1: bit 0 = 0, bit 1 = 1 (modulo libero), bit 4 = 0, bit 6 = 0, bit 3 = 1 (chip video non selezionato)
  a.movRi(2, 4).call('delay');                       // lo Z80 si avvia ed esegue l'autocontrollo
  a.movRi(0, 0);                                     // indice dei risultati
  const c = (cmd, wr, rd) => { a.movAi(cmd).movRi(1, wr).movRi(6, rd).call('cmd'); };
  // l'8048 scrive 0 fra un comando e l'altro per rendere "nuovo" ogni comando
  const zero = () => { a.movAi(0).movRi(1, 0x80).movxWr(1).movRi(2, 1).call('delay'); };
  c(0x01, 0x80, 0xA0); zero();                       // echo 0x01 -> 0xFE
  c(0x55, 0x80, 0xA0); zero();                       // echo 0x55 -> 0xAA
  for (let i = 0; i < 9; i++) { c(0xA0 + i, 0x80, 0xA0); zero(); }   // tabella 0..8
  c(0xAF, 0x80, 0xA0); zero();                       // contatore degli avvii: 1
  // lettura senza risposta del latch (A7 = 1, A5 = 0): il bus resta 0xFF
  a.movRi(1, 0x80).movxRd(1).movxWr(0).incR(0);      // risultato 12
  // il latch 0 vale ancora 0xFF? No: dopo "zero()" lo Z80 ha risposto ~0 = 0xFF. Per leggere 1 serve un nuovo 0xAF:
  a.movAi(0xAF).movRi(1, 0x80).movxWr(1).movRi(2, 1).call('delay');
  for (const rd of [0xA0, 0xBF, 0xFF, 0xE5]) { a.movRi(1, rd).movxRd(1).movxWr(0).incR(0); }   // risultati 13..16: indirizzi diversi, stesso latch
  // reset: P11 = 0 e un comando nuovo (0x42) mentre lo Z80 e' fermo; il latch 0 non deve cambiare
  a.movAi(0xAC).outlP1();                            // P1 = 0xAC: bit 1 = 0 -> reset
  a.movAi(0x42).movRi(1, 0x9F).movxWr(1);            // latch 1 = 0x42 (indirizzo 0x9F: A7 = 1)
  a.movRi(2, 8).call('delay');
  a.movRi(1, 0xA0).movxRd(1).movxWr(0).incR(0);      // risultato 17: ancora 1
  a.movAi(0xAE).outlP1();                            // rilascio
  a.movRi(2, 6).call('delay');
  a.movRi(1, 0xA0).movxRd(1).movxWr(0).incR(0);      // risultato 18: 0xBD (~0x42, comando in attesa trovato dopo il riavvio)
  zero();
  c(0xAF, 0x80, 0xA0); zero();                       // risultato 19: contatore = 2
  a.movAi(0xEE).movxWr(0).incR(0);                   // 20: fine
  // eco con indirizzi diversi per i latch
  c(0x0F, 0xFF, 0xFF); zero();                       // scrittura a 0xFF, lettura a 0xFF -> 0xF0
  c(0xF0, 0x80, 0xBF);                               // scrittura a 0x80, lettura a 0xBF -> 0x0F
  a.label('end').jmp('end');
  const code = a.link();
  if (code.length > 0x400) throw new Error('BIOS di prova troppo lungo: ' + code.length);
  const bios = new Uint8Array(0x400).fill(0xFF);
  bios.set(code);
  return bios;
}

// ---- file con un CRC-32 voluto (per provare il riconoscimento per impronta senza i file veri): gli ultimi 4 byte si calcolano in modo che il
// CRC-32 del buffer valga `target` (tecnica classica: il CRC e' affine, si risale dal valore finale). Servono solo ai test: i dati sono nostri.
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function forgeCrc(buf, target) {
  const n = buf.length;
  let reg = 0xFFFFFFFF;
  for (let i = 0; i < n - 4; i++) reg = (CRC_T[(reg ^ buf[i]) & 255] ^ (reg >>> 8)) >>> 0;
  const rev = new Map();
  for (let i = 0; i < 256; i++) rev.set(CRC_T[i] >>> 24, i);
  let st = (target ^ 0xFFFFFFFF) >>> 0;
  const idx = [];
  for (let k = 3; k >= 0; k--) { const i = rev.get(st >>> 24); idx[k] = i; st = (((st ^ CRC_T[i]) >>> 0) << 8) >>> 0; }
  for (let k = 0; k < 4; k++) {
    const b = idx[k] ^ (reg & 255);
    buf[n - 4 + k] = b;
    reg = (CRC_T[(reg ^ b) & 255] ^ (reg >>> 8)) >>> 0;
  }
  return buf;
}
// ROM Z80 di prova con il CRC-32 e la misura della ROM vera del C7010 (45080245, 8192 byte) e cartuccia da 2 KB con quello della vera (77066338)
const forgedZ80Rom = () => forgeCrc(buildZ80Rom(), 0x45080245);
const forgedChessCart = () => { const c = new Uint8Array(2048); for (let i = 0; i < c.length; i++) c[i] = (i * 7 + (i >> 5) + 3) & 255; return forgeCrc(c, 0x77066338); };

module.exports = {buildZ80Rom, buildBios8048, RESULTS, EXPECTED, TABLE, Asm48, AsmZ80, forgeCrc, forgedZ80Rom, forgedChessCart};

// uso da riga di comando: node test/chess_testrom.js CARTELLA  -> scrive bios8048.bin (1 KB) e z80rom.bin (8 KB) di PROVA (nostri) per il riferimento Python
if (require.main === module) {
  const fs = require('fs'), p = require('path');
  const dir = process.argv[2];
  if (!dir) { console.log('uso: node test/chess_testrom.js CARTELLA'); process.exit(2); }
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(p.join(dir, 'bios8048.bin'), buildBios8048());
  fs.writeFileSync(p.join(dir, 'z80rom.bin'), buildZ80Rom());
  console.log('scritti bios8048.bin e z80rom.bin in ' + dir);
}
