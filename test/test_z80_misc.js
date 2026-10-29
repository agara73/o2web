'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// test_z80_misc.js - prove puntuali del nucleo Z80 che il confronto con il riferimento (z80_run.js) non copre o copre solo in parte:
// valori dopo il reset, tempi di piccoli programmi calcolati a mano, prefissi, interrupt (INT modi 0 / 1 / 2, NMI, EI, HALT), regole
// delle istruzioni a blocco ripetute (X / Y dall'alto di PC, WZ), indirizzi di porta a 16 bit, avvolgimenti a 0xFFFF, stato
// (saveState / loadState con rifiuto di valori falsi senza toccare la CPU) e runUntil. I valori attesi sono calcolati a mano dalla
// descrizione del Z80, non dal codice.
const path = require('path');
const {Z80, SF, ZF, YF, HF, XF, PF, NF, CF} = require(process.env.O2_Z80_PATH || path.join(__dirname, '..', 'src', 'z80.js'));

let fails = 0, n = 0;
const check = (cond, msg) => { n++; if (!cond) { fails++; console.log('FAIL  ' + msg); } };
const eq = (a, b, msg) => check(a === b, msg + ' (atteso ' + b + ', ottenuto ' + a + ')');
const hex = (v) => '0x' + v.toString(16);

function mk(program, at = 0, opts = {}) {
  const mem = new Uint8Array(65536);
  mem.set(program, at);
  const log = {out: [], inn: [], wr: []};
  const host = {
    read: (a) => mem[a], write: (a, v) => { log.wr.push([a, v]); mem[a] = v; },
    in: (p) => { log.inn.push(p); return opts.inValue === undefined ? 0xFF : opts.inValue; },
    out: (p, v) => { log.out.push([p, v]); },
  };
  const cpu = new Z80(host);
  cpu.pc = at;
  return {cpu, mem, log};
}
function run(m, steps) { let t = 0; for (let i = 0; i < steps; i++) t += m.cpu.step(); return t; }
const af = (c) => (c.r[7] << 8) | c.r[6];

// ---- 1. reset
{
  const c = new Z80({read: () => 0, write() {}, in: () => 0, out() {}});
  eq(af(c), 0xFFFF, 'dopo il reset AF = FFFF');
  eq(c.sp, 0xFFFF, 'dopo il reset SP = FFFF');
  check(c.pc === 0 && c.ix === 0 && c.iy === 0 && c.i === 0 && c.rr === 0 && c.t === 0, 'dopo il reset PC, IX, IY, I, R e il tempo valgono 0');
  check(c.iff1 === 0 && c.iff2 === 0 && c.im === 0 && c.halted === 0 && c.idx === 0 && c.noInt === 0 && c.wz === 0, 'dopo il reset IFF, IM, HALT, prefisso e WZ valgono 0');
  check(c.r.slice(0, 6).every((v) => v === 0) && c.r2.slice(0, 8).every((v) => v === 0), 'dopo il reset BC DE HL e l\'insieme ombra valgono 0');
  c.pc = 0x1234; c.r[0] = 9; c.t = 77; c.iff1 = 1; c.reset();
  check(c.pc === 0 && c.r[0] === 0 && c.t === 0 && c.iff1 === 0, 'reset() riporta tutto allo stato iniziale');
}

// ---- 2. tempi e risultati di piccoli programmi (calcolati a mano)
{
  // LD B,5 (7) ; loop: DJNZ loop (13 x 4 + 8) ; HALT
  let m = mk([0x06, 0x05, 0x10, 0xFE, 0x76]);
  eq(run(m, 1 + 5), 7 + 4 * 13 + 8, 'LD B,5 + DJNZ x5 = 67 T');
  eq(m.cpu.r[0], 0, 'DJNZ porta B a 0');
  eq(m.cpu.pc, 4, 'DJNZ non preso: PC all\'istruzione dopo');
  eq(m.cpu.rr, 6, 'R conta un ciclo M1 per istruzione (6)');
  // CALL / RET / PUSH / POP: LD SP,0x8000 (10) CALL 0x0010 (17) ... RET (10)
  m = mk([0x31, 0x00, 0x80, 0xCD, 0x10, 0x00, 0x76]);
  m.mem[0x10] = 0x3E; m.mem[0x11] = 0x42; m.mem[0x12] = 0xC9;      // LD A,0x42 ; RET
  eq(run(m, 4), 10 + 17 + 7 + 10, 'LD SP,nn + CALL + LD A,n + RET = 44 T');
  eq(m.cpu.r[7], 0x42, 'A = 0x42'); eq(m.cpu.pc, 6, 'RET torna dopo la CALL'); eq(m.cpu.sp, 0x8000, 'SP ripristinato');
  eq(m.mem[0x7FFF], 0x00, 'CALL: byte alto dell\'indirizzo di ritorno a SP-1'); eq(m.mem[0x7FFE], 0x06, 'CALL: byte basso a SP-2');
  // ADD A,n con flag: 0x7F + 1 = 0x80: S, H, V (P) ; N = 0 ; C = 0
  m = mk([0x3E, 0x7F, 0xC6, 0x01]);
  run(m, 2);
  eq(m.cpu.r[7], 0x80, '0x7F + 1 = 0x80'); eq(m.cpu.r[6], SF | HF | PF, 'flag di 0x7F + 1: S H P');
  // SUB: 0x00 - 0x01 = 0xFF: S, H, N, C (X e Y dal risultato 0xFF = bit 5 e 3)
  m = mk([0x3E, 0x00, 0xD6, 0x01]);
  run(m, 2);
  eq(m.cpu.r[7], 0xFF, '0 - 1 = 0xFF'); eq(m.cpu.r[6], SF | YF | HF | XF | NF | CF, 'flag di 0 - 1');
  // CP: X e Y dall'operando, non dal risultato: A = 0x00, CP 0x28 -> risultato 0xD8, X/Y = 1 dall'operando
  m = mk([0x3E, 0x00, 0xFE, 0x28]);
  run(m, 2);
  eq(m.cpu.r[7], 0x00, 'CP non cambia A'); eq(m.cpu.r[6] & (YF | XF), YF | XF, 'CP: X e Y vengono dall\'operando');
  // INC/DEC (HL) 11 T; LD (HL),n 10 T ; ADD HL,BC 11 T
  m = mk([0x21, 0x00, 0x40, 0x36, 0x7F, 0x34, 0x35, 0x09]);
  eq(run(m, 5), 10 + 10 + 11 + 11 + 11, 'LD HL,nn + LD (HL),n + INC (HL) + DEC (HL) + ADD HL,BC = 53 T');
  eq(m.mem[0x4000], 0x7F, 'INC (HL) poi DEC (HL) restituisce 0x7F');
  // DAA dopo 0x15 + 0x27 = 0x3C -> 0x42
  m = mk([0x3E, 0x15, 0xC6, 0x27, 0x27]);
  run(m, 3);
  eq(m.cpu.r[7], 0x42, 'DAA: 0x15 + 0x27 = 0x42 (BCD)');
  // DAA dopo una sottrazione (N = 1) con H = 1: l'H del risultato e' H e (nibble basso < 6) (flag H calcolato come sul Z80 vero)
  for (const [lo, hAfter] of [[5, 1], [6, 0], [7, 0], [0, 1], [0xF, 0]]) {
    m = mk([0x27]); m.cpu.r[7] = 0x20 | lo; m.cpu.r[6] = 0x02 | 0x10;      // A = 0x2? , N = 1, H = 1, C = 0
    run(m, 1);
    eq((m.cpu.r[6] >> 4) & 1, hAfter, 'DAA con N e H: nibble basso ' + lo + ' -> H = ' + hAfter);
    eq(m.cpu.r[7], (0x20 | lo) - 6 & 0xFF, 'DAA con N e H: nibble basso ' + lo + ' -> A meno 6');
  }
  // DAA dopo una somma (N = 0): H = 1 se il nibble basso supera 9
  for (const [lo, hAfter] of [[9, 0], [0xA, 1], [0xF, 1]]) {
    m = mk([0x27]); m.cpu.r[7] = 0x20 | lo; m.cpu.r[6] = 0;
    run(m, 1);
    eq((m.cpu.r[6] >> 4) & 1, hAfter, 'DAA dopo somma: nibble basso ' + lo + ' -> H = ' + hAfter);
  }
  // EX AF,AF' / EXX / EX DE,HL
  m = mk([0x3E, 0x11, 0x08, 0x3E, 0x22, 0x08, 0x01, 0x34, 0x12, 0xD9, 0x01, 0x78, 0x56, 0xD9, 0x11, 0xCD, 0xAB, 0xEB]);
  run(m, 10);
  eq(m.cpu.r[7], 0x11, 'EX AF,AF\' due volte: A = 0x11'); eq(m.cpu.r2[7], 0x22, 'insieme ombra: A\' = 0x22');
  eq(m.cpu.bc, 0x1234, 'EXX: BC = 0x1234 dopo il secondo scambio'); eq((m.cpu.r2[0] << 8) | m.cpu.r2[1], 0x5678, 'EXX: BC\' = 0x5678');
  eq(m.cpu.hl, 0xABCD, 'EX DE,HL: HL = 0xABCD'); eq(m.cpu.de, 0x0000, 'EX DE,HL: DE = 0');
  // JR, JP cc, tempi: JR (12), JP nn (10), JP NZ non preso (10), JR NZ non preso (7)
  m = mk([0x18, 0x02, 0x00, 0x00, 0xC3, 0x08, 0x00, 0x00, 0xAF, 0x20, 0x05, 0xCA, 0x20, 0x00]);
  eq(run(m, 2), 12 + 10, 'JR + JP = 22 T');
  eq(run(m, 2), 4 + 7, 'XOR A (4) + JR NZ non preso (7) = 11 T');
  eq(m.cpu.pc, 11, 'JR NZ non preso va avanti di 2');
  eq(run(m, 1), 10, 'JP Z preso: 10 T'); eq(m.cpu.pc, 0x20, 'JP Z salta a 0x20');
  // RET cc: preso 11, non preso 5
  m = mk([0xC0, 0xC8]); m.cpu.sp = 0x9000; m.mem[0x9000] = 0x34; m.mem[0x9001] = 0x12; m.cpu.r[6] = ZF;
  eq(run(m, 1), 5, 'RET NZ non preso (Z = 1): 5 T');
  eq(run(m, 1), 11, 'RET Z preso: 11 T'); eq(m.cpu.pc, 0x1234, 'RET Z carica PC dalla pila');
  // RST 0x28 : 11 T
  m = mk([0xEF]); m.cpu.sp = 0x9000;
  eq(run(m, 1), 11, 'RST 28h: 11 T'); eq(m.cpu.pc, 0x28, 'RST 28h salta a 0x28'); eq(m.mem[0x8FFE], 1, 'RST salva PC = 1');
}

// ---- 3. prefissi DD / FD: un prefisso e' un'istruzione da 4 T
{
  let m = mk([0xDD, 0x21, 0x34, 0x12, 0xFD, 0x21, 0x78, 0x56]);       // LD IX,0x1234 ; LD IY,0x5678
  eq(m.cpu.step(), 4, 'prefisso DD da solo: 4 T'); eq(m.cpu.idx, 1, 'dopo DD il prefisso attivo e\' IX'); eq(m.cpu.pc, 1, 'dopo DD PC = 1'); eq(m.cpu.rr, 1, 'DD conta un ciclo M1');
  eq(m.cpu.step(), 10, 'LD IX,nn dopo il prefisso: 10 T (14 in tutto)'); eq(m.cpu.idx, 0, 'dopo l\'istruzione il prefisso e\' spento'); eq(m.cpu.ix, 0x1234, 'IX = 0x1234');
  run(m, 2); eq(m.cpu.iy, 0x5678, 'IY = 0x5678');
  // DD DD 21: il primo DD e' un NOP da 4 T
  m = mk([0xDD, 0xDD, 0x21, 0x01, 0x02]);
  eq(run(m, 3), 4 + 4 + 10, 'DD DD LD IX,nn: 18 T'); eq(m.cpu.ix, 0x0201, 'IX = 0x0201');
  // DD seguito da un'istruzione che non usa HL: NOP + istruzione; DD ED: il prefisso e' ignorato
  m = mk([0xDD, 0x3C, 0xFD, 0xED, 0x44]);
  m.cpu.r[7] = 1;
  eq(run(m, 2), 4 + 4, 'DD INC A: 8 T'); eq(m.cpu.r[7], 2, 'DD INC A incrementa A');
  eq(run(m, 2), 4 + 8, 'FD ED 44 (NEG): 12 T'); eq(m.cpu.r[7], 0xFE, 'NEG di 2 = 0xFE');
  // LD A,(IX+d) = 19 T in tutto ; LD (IY-1),n = 19 ; INC (IX+d) = 23
  m = mk([0xDD, 0x7E, 0x05, 0xFD, 0x36, 0xFF, 0x77, 0xDD, 0x34, 0x00]);
  m.cpu.ix = 0x4000; m.cpu.iy = 0x5000; m.mem[0x4005] = 0x9A;
  eq(run(m, 2), 19, 'LD A,(IX+5): 19 T'); eq(m.cpu.r[7], 0x9A, 'A = (IX+5)'); eq(m.cpu.wz, 0x4005, 'WZ = IX+d');
  eq(run(m, 2), 19, 'LD (IY-1),n: 19 T'); eq(m.mem[0x4FFF], 0x77, '(IY-1) = 0x77');
  eq(run(m, 2), 23, 'INC (IX+0): 23 T'); eq(m.mem[0x4000], 1, '(IX+0) incrementata');
  // IXH / IXL (non documentati): DD 26 n = LD IXH,n ; DD 2C = INC IXL ; DD 44 = LD B,IXH
  m = mk([0xDD, 0x26, 0x12, 0xDD, 0x2C, 0xDD, 0x44, 0xDD, 0x65]);
  m.cpu.ix = 0x00FF;
  eq(run(m, 2), 4 + 7, 'LD IXH,n: 11 T'); eq(m.cpu.ix, 0x12FF, 'IXH = 0x12');
  run(m, 2); eq(m.cpu.ix, 0x1200, 'INC IXL: 0xFF + 1 = 0x00');
  run(m, 2); eq(m.cpu.r[0], 0x12, 'LD B,IXH');
  run(m, 2); eq(m.cpu.ix, 0x0000 | 0x0000 | (0x00 << 8) | 0x00, 'LD IXH,IXL: IXH = IXL (0x00)');
  // LD H,(IX+d) carica H vero, non IXH
  m = mk([0xDD, 0x66, 0x01]);
  m.cpu.ix = 0x4000; m.mem[0x4001] = 0x5A;
  run(m, 2); eq(m.cpu.r[4], 0x5A, 'LD H,(IX+1) carica H'); eq(m.cpu.ix, 0x4000, 'LD H,(IX+1) non cambia IX');
  // DDCB: BIT 20 T in tutto, SET/RES/rotazioni 23 T; copia nel registro (non documentata)
  m = mk([0xDD, 0xCB, 0x02, 0xC0, 0xDD, 0xCB, 0x02, 0x46]);
  m.cpu.ix = 0x4000; m.mem[0x4002] = 0x00;
  eq(run(m, 2), 23, 'DD CB d SET 0,B (copia in B): 23 T'); eq(m.mem[0x4002], 1, '(IX+2) = 1'); eq(m.cpu.r[0], 1, 'DDCB copia il risultato in B');
  eq(m.cpu.rr, 2, 'DD CB conta due cicli M1');
  eq(run(m, 2), 20, 'DD CB d BIT 0,(IX+d): 20 T'); eq(m.cpu.r[6] & ZF, 0, 'BIT 0 su un bit a 1: Z = 0');
}

// ---- 4. istruzioni non documentate di ED e CB
{
  let m = mk([0xED, 0x70, 0xED, 0x71, 0xCB, 0x30]);                       // IN F,(C) ; OUT (C),0 ; SLL B
  m.cpu.r[0] = 0x12; m.cpu.r[1] = 0x34;
  const mm = mk([0xED, 0x70, 0xED, 0x71], 0, {inValue: 0x80});
  mm.cpu.r[0] = 0x12; mm.cpu.r[1] = 0x34; mm.cpu.r[6] = CF;
  eq(run(mm, 1), 12, 'IN F,(C): 12 T'); eq(mm.cpu.r[6], SF | CF, 'IN F,(C) con 0x80: S, C conservato');
  eq(mm.log.inn[0], 0x1234, 'IN F,(C): indirizzo di porta = BC');
  run(mm, 1); eq(mm.log.out[0][0], 0x1234, 'OUT (C),0: indirizzo di porta = BC'); eq(mm.log.out[0][1], 0, 'OUT (C),0 scrive 0');
  m.cpu.r[0] = 0x81; run(m, 2); run(m, 1);
  eq(m.cpu.r[0], 0x03, 'SLL B: 0x81 -> 0x03'); eq(m.cpu.r[6] & CF, CF, 'SLL B: C = vecchio bit 7');
}

// ---- 5. porte a 16 bit
{
  const m = mk([0x3E, 0x7B, 0xD3, 0x42, 0xDB, 0x43], 0, {inValue: 0x55});
  run(m, 3);
  eq(m.log.out.length, 1, 'OUT (n),A: una scrittura'); eq(m.log.out[0][0], 0x7B42, 'OUT (n),A: porta = A * 256 + n'); eq(m.log.out[0][1], 0x7B, 'OUT (n),A scrive A');
  eq(m.log.inn[0], 0x7B43, 'IN A,(n): porta = A * 256 + n (A prima dell\'istruzione)'); eq(m.cpu.r[7], 0x55, 'IN A,(n): A = valore letto');
  eq(m.cpu.wz, 0x7B44, 'IN A,(n): WZ = porta + 1');
}

// ---- 6. interrupt
{
  // NMI
  let m = mk([0x00, 0x00]); m.cpu.sp = 0x9000; m.cpu.iff1 = 1; m.cpu.iff2 = 1; m.cpu.pc = 0x1234;
  eq(m.cpu.nmi(), 11, 'NMI: 11 T'); eq(m.cpu.pc, 0x66, 'NMI salta a 0x66'); eq(m.cpu.iff1, 0, 'NMI azzera IFF1'); eq(m.cpu.iff2, 1, 'NMI conserva IFF2');
  // NMI: IFF2 = IFF1 (anche quando IFF1 = 0 e IFF2 = 1), R avanza di uno e il bit 7 di R resta
  { const q = mk([0x00]); q.cpu.sp = 0x9000; q.cpu.iff1 = 0; q.cpu.iff2 = 1; q.cpu.rr = 0xFE; q.cpu.nmi();
    eq(q.cpu.iff2, 0, 'NMI: IFF2 = IFF1 (0)'); eq(q.cpu.rr, 0xFF, 'NMI: R aumenta di uno'); q.cpu.rr = 0xFF; q.cpu.nmi(); eq(q.cpu.rr, 0x80, 'NMI: R conserva il bit 7 e il contatore a 7 bit riparte'); }
  eq(m.mem[0x8FFF], 0x12, 'NMI salva PC (alto)'); eq(m.mem[0x8FFE], 0x34, 'NMI salva PC (basso)'); eq(m.cpu.t, 11, 'NMI conta nel tempo totale'); eq(m.cpu.wz, 0x66, 'NMI: WZ = 0x66');
  // RETN ripristina IFF1 da IFF2
  m.mem[0x66] = 0xED; m.mem[0x67] = 0x45;
  eq(run(m, 1), 14, 'RETN: 14 T'); eq(m.cpu.pc, 0x1234, 'RETN torna al punto interrotto'); eq(m.cpu.iff1, 1, 'RETN: IFF1 = IFF2');
  // INT modo 1
  m = mk([0xED, 0x56, 0xFB, 0x00, 0x00]); m.cpu.sp = 0x9000;
  run(m, 1); eq(m.cpu.im, 1, 'IM 1');
  run(m, 1); eq(m.cpu.iff1, 1, 'EI imposta IFF1'); eq(m.cpu.iff2, 1, 'EI imposta IFF2');
  eq(m.cpu.requestInt(0xFF), 0, 'subito dopo EI l\'interrupt non e\' accettato');
  run(m, 1);
  const t0 = m.cpu.t;
  eq(m.cpu.requestInt(0xFF), 13, 'INT modo 1: 13 T'); eq(m.cpu.pc, 0x38, 'INT modo 1 salta a 0x38'); eq(m.cpu.t, t0 + 13, 'INT conta nel tempo'); eq(m.cpu.iff1, 0, 'INT azzera IFF1'); eq(m.cpu.iff2, 0, 'INT azzera IFF2');
  eq(m.cpu.requestInt(0xFF), 0, 'con gli interrupt disabilitati non si accetta');
  // INT modo 2: vettore I * 256 + dato
  m = mk([0xED, 0x5E, 0xFB, 0x00, 0x00]); m.cpu.sp = 0x9000; m.cpu.i = 0x80; m.mem[0x80FE] = 0x78; m.mem[0x80FF] = 0x56;
  run(m, 3);
  eq(m.cpu.im, 2, 'IM 2'); eq(m.cpu.requestInt(0xFE), 19, 'INT modo 2: 19 T'); eq(m.cpu.pc, 0x5678, 'INT modo 2 salta al vettore letto da I:dato');
  // INT modo 0: RST n sul bus
  m = mk([0xFB, 0x00, 0x00]); m.cpu.sp = 0x9000;
  run(m, 2);
  eq(m.cpu.requestInt(0xEF), 13, 'INT modo 0 con RST 28h sul bus: 13 T'); eq(m.cpu.pc, 0x28, 'INT modo 0 salta a 0x28');
  // un interrupt non si accetta fra un prefisso e la sua istruzione
  m = mk([0xFB, 0x00, 0xDD, 0x23]); m.cpu.sp = 0x9000; m.cpu.im = 1;
  run(m, 3);
  eq(m.cpu.requestInt(0xFF), 0, 'dopo un prefisso DD l\'interrupt non e\' accettato');
  run(m, 1); eq(m.cpu.requestInt(0xFF), 13, 'dopo l\'istruzione s\'accetta');
  // HALT: 4 T per passo, PC resta dopo HALT; un interrupt lo risveglia e salva l'indirizzo dopo HALT
  m = mk([0xFB, 0x00, 0x76, 0x00]); m.cpu.sp = 0x9000; m.cpu.im = 1;
  run(m, 3);
  eq(m.cpu.halted, 1, 'HALT ferma la CPU'); eq(m.cpu.pc, 3, 'HALT: PC dopo l\'istruzione');
  const r0 = m.cpu.rr, t1 = m.cpu.t;
  eq(m.cpu.step(), 4, 'in HALT ogni passo costa 4 T'); eq(m.cpu.rr, (r0 + 1) & 0x7F, 'in HALT R avanza'); eq(m.cpu.pc, 3, 'in HALT PC non cambia'); eq(m.cpu.t, t1 + 4, 'in HALT il tempo avanza');
  eq(m.cpu.requestInt(0xFF), 13, 'INT in HALT: 13 T'); eq(m.cpu.halted, 0, 'l\'interrupt risveglia la CPU'); eq(m.mem[0x8FFE], 3, 'INT in HALT salva l\'indirizzo dopo HALT');
  // NMI risveglia da HALT
  m = mk([0x76]); m.cpu.sp = 0x9000; run(m, 1); m.cpu.nmi(); eq(m.cpu.halted, 0, 'NMI risveglia da HALT');
  // DI blocca
  m = mk([0xFB, 0xF3, 0x00]); m.cpu.sp = 0x9000; run(m, 3); eq(m.cpu.requestInt(0xFF), 0, 'DI blocca gli interrupt');
}

// ---- 7. istruzioni a blocco ripetute: X / Y dall'alto di PC, WZ = PC + 1, tempi
{
  // LDIR con BC = 2 a PC = 0x2800 : prima iterazione si ripete (21 T), poi 16 T
  let m = mk([0xED, 0xB0], 0x2800);
  m.cpu.r[0] = 0; m.cpu.r[1] = 2; m.cpu.hl = 0x4000; m.cpu.de = 0x5000; m.mem[0x4000] = 0x11; m.mem[0x4001] = 0x22; m.cpu.r[7] = 0; m.cpu.r[6] = 0;
  eq(m.cpu.step(), 21, 'LDIR che si ripete: 21 T'); eq(m.cpu.pc, 0x2800, 'LDIR che si ripete: PC torna all\'istruzione');
  eq(m.cpu.r[6] & (YF | XF), 0x28 & 0x28, 'LDIR ripetuta: X e Y dall\'alto di PC (0x28 = 00101000)'); eq(m.cpu.wz, 0x2801, 'LDIR ripetuta: WZ = PC + 1');
  eq(m.cpu.r[6] & PF, PF, 'LDIR con BC != 0 dopo: P = 1'); eq(m.mem[0x5000], 0x11, 'LDIR copia il primo byte');
  eq(m.cpu.step(), 16, 'ultima iterazione di LDIR: 16 T'); eq(m.cpu.pc, 0x2802, 'LDIR finita: PC dopo'); eq(m.mem[0x5001], 0x22, 'LDIR copia il secondo byte');
  eq(m.cpu.r[6] & PF, 0, 'LDIR finita: P = 0'); eq(m.cpu.bc, 0, 'LDIR finita: BC = 0');
  // alto di PC = 0x00: X e Y a 0 anche se A + dato ne avrebbe
  m = mk([0xED, 0xB0], 0x0010);
  m.cpu.r[0] = 0; m.cpu.r[1] = 2; m.cpu.hl = 0x4000; m.cpu.de = 0x5000; m.mem[0x4000] = 0xFF; m.cpu.r[7] = 0xFF;
  m.cpu.step(); eq(m.cpu.r[6] & (YF | XF), 0, 'LDIR ripetuta con alto di PC = 0: X e Y a 0');
  // LDI singola: X = bit 3 e Y = bit 1 di A + dato
  m = mk([0xED, 0xA0], 0x2800);
  m.cpu.r[0] = 0; m.cpu.r[1] = 1; m.cpu.hl = 0x4000; m.cpu.de = 0x5000; m.mem[0x4000] = 0x0A; m.cpu.r[7] = 0x00;
  m.cpu.step(); eq(m.cpu.r[6] & (YF | XF), YF | XF, 'LDI: A + dato = 0x0A: Y (bit 1) e X (bit 3) a 1');
  // CPIR si ferma al primo uguale
  m = mk([0xED, 0xB1], 0x2800);
  m.cpu.r[0] = 0; m.cpu.r[1] = 3; m.cpu.hl = 0x4000; m.mem[0x4000] = 1; m.mem[0x4001] = 7; m.cpu.r[7] = 7;
  eq(m.cpu.step(), 21, 'CPIR: prima iterazione (diverso) si ripete'); eq(m.cpu.step(), 16, 'CPIR: trovato -> si ferma');
  eq(m.cpu.r[6] & ZF, ZF, 'CPIR trovato: Z = 1'); eq(m.cpu.hl, 0x4002, 'CPIR: HL dopo il byte trovato'); eq(m.cpu.bc, 1, 'CPIR: BC decrementato due volte');
  // INIR / OTIR: B arriva a 0 -> 16 T poi fine; porta = BC
  m = mk([0xED, 0xB2], 0x1000, {inValue: 0x42});
  m.cpu.r[0] = 2; m.cpu.r[1] = 0x10; m.cpu.hl = 0x4000;
  eq(m.cpu.step(), 21, 'INIR B = 2: si ripete'); eq(m.log.inn[0], 0x0210, 'INIR: porta = BC (B prima del decremento)'); eq(m.mem[0x4000], 0x42, 'INIR scrive in (HL)');
  eq(m.cpu.step(), 16, 'INIR B = 1: ultima'); eq(m.log.inn[1], 0x0110, 'INIR: seconda lettura con B = 1'); eq(m.cpu.r[0], 0, 'INIR: B = 0');
  m = mk([0xED, 0xB3], 0x1000);
  m.cpu.r[0] = 2; m.cpu.r[1] = 0x10; m.cpu.hl = 0x4000; m.mem[0x4000] = 0x77;
  m.cpu.step(); eq(m.log.out[0][0], 0x0110, 'OTIR: porta = BC con B GIA\' decrementato'); eq(m.log.out[0][1], 0x77, 'OTIR scrive il byte letto');
  // LDDR all'indietro
  m = mk([0xED, 0xB8], 0x2800);
  m.cpu.r[0] = 0; m.cpu.r[1] = 2; m.cpu.hl = 0x4001; m.cpu.de = 0x5001; m.mem[0x4000] = 0xA; m.mem[0x4001] = 0xB;
  run(m, 2); eq(m.mem[0x5001], 0xB, 'LDDR copia dall\'ultimo'); eq(m.mem[0x5000], 0xA, 'LDDR copia il primo'); eq(m.cpu.hl, 0x3FFF, 'LDDR: HL scende');
}

// ---- 8. avvolgimenti a 0xFFFF
{
  let m = mk([0x3A, 0xFF, 0xFF], 0);      // LD A,(0xFFFF)
  m.mem[0xFFFF] = 0x99;
  run(m, 1); eq(m.cpu.r[7], 0x99, 'LD A,(FFFF)');
  m = mk([0x2A, 0xFF, 0xFF]);              // LD HL,(0xFFFF): byte alto da 0x0000
  m.mem[0xFFFF] = 0x34;
  run(m, 1); eq(m.cpu.hl, (m.mem[0] << 8) | 0x34, 'LD HL,(FFFF): il byte alto viene da 0x0000');
  m = mk([0x00], 0xFFFF);                  // NOP in 0xFFFF: PC avvolge a 0
  run(m, 1); eq(m.cpu.pc, 0, 'PC avvolge da 0xFFFF a 0');
  m = mk([0xC5]); m.cpu.sp = 0x0000; m.cpu.r[0] = 0xAB; m.cpu.r[1] = 0xCD;   // PUSH BC con SP = 0: scrive in 0xFFFF e 0xFFFE
  run(m, 1); eq(m.cpu.sp, 0xFFFE, 'PUSH con SP = 0: SP = FFFE'); eq(m.mem[0xFFFF], 0xAB, 'PUSH: alto a FFFF'); eq(m.mem[0xFFFE], 0xCD, 'PUSH: basso a FFFE');
  m = mk([0x03]); m.cpu.r[0] = 0xFF; m.cpu.r[1] = 0xFF; run(m, 1); eq(m.cpu.bc, 0, 'INC BC avvolge a 0');
  m = mk([0x3B]); m.cpu.sp = 0; run(m, 1); eq(m.cpu.sp, 0xFFFF, 'DEC SP avvolge a 0xFFFF');
  // l'host puo' rispondere con piu' di 8 bit: si usano solo gli 8 bassi
  const mem2 = new Uint8Array([0xDB, 0x00, 0x3E, 0x00]);
  const cpu = new Z80({read: (a) => mem2[a & 3] | (a < 2 ? 0x100 : 0), write() {}, in: () => 0x1AB, out() {}});
  cpu.step();
  eq(cpu.r[7], 0xAB, 'IN A,(n): l\'host risponde con 9 bit, si usano gli 8 bassi');
  eq(cpu.pc, 2, 'un byte letto con bit alti non cambia la lunghezza dell\'istruzione');
}

// ---- 9. stato
{
  const m = mk([0xDD, 0x21, 0x34, 0x12, 0xFB, 0x76]);
  m.cpu.r[0] = 0xAA; m.cpu.r2[3] = 0x55; m.cpu.wz = 0xBEEF; m.cpu.i = 0x7E; m.cpu.im = 2; m.cpu.sp = 0x1357; m.cpu.t = 12345;
  run(m, 3);
  const s = m.cpu.saveState();
  const json = JSON.stringify(s);
  const c2 = new Z80({read: () => 0, write() {}, in: () => 0, out() {}});
  c2.loadState(JSON.parse(json));
  eq(JSON.stringify(c2.saveState()), json, 'saveState / loadState: andata e ritorno');
  // confini accettati: ogni campo al minimo e al massimo ammesso
  for (const [name, f] of [
    ['minimi', (x) => { x.noInt = 0; x.t = 0; x.idx = 0; x.iff1 = 0; x.iff2 = 0; x.im = 0; x.halted = 0; x.i = 0; x.rr = 0; x.wz = 0; x.pc = 0; x.sp = 0; }],
    ['massimi', (x) => { x.noInt = 1; x.t = Number.MAX_SAFE_INTEGER; x.idx = 2; x.iff1 = 1; x.iff2 = 1; x.im = 2; x.halted = 1; x.i = 255; x.rr = 255; x.wz = 0xFFFF; x.pc = 0xFFFF; x.sp = 0xFFFF; x.ix = 0xFFFF; x.iy = 0xFFFF; }],
    ['idx 1, noInt 1', (x) => { x.idx = 1; x.noInt = 1; }],
  ]) {
    const x = JSON.parse(json); f(x);
    try { c2.loadState(x); eq(JSON.stringify(c2.saveState()), JSON.stringify(x), 'loadState accetta e ripete lo stato ai confini: ' + name); } catch (e) { check(false, 'loadState accetta lo stato ai confini (' + name + '): ' + e.message); }
  }
  c2.loadState(JSON.parse(json));
  const bad = [
    ['r corto', (x) => { x.r = x.r.slice(1); }], ['r2 non array', (x) => { x.r2 = 5; }], ['byte 256', (x) => { x.r[3] = 256; }], ['byte negativo', (x) => { x.r2[1] = -1; }],
    ['pc 65536', (x) => { x.pc = 65536; }], ['sp frazione', (x) => { x.sp = 1.5; }], ['ix stringa', (x) => { x.ix = '1'; }], ['iy', (x) => { x.iy = -1; }],
    ['i', (x) => { x.i = 256; }], ['rr', (x) => { x.rr = 256; }], ['iff1', (x) => { x.iff1 = 2; }], ['iff2', (x) => { x.iff2 = -1; }], ['im', (x) => { x.im = 3; }],
    ['halted', (x) => { x.halted = 2; }], ['wz', (x) => { x.wz = 70000; }], ['idx', (x) => { x.idx = 3; }], ['noInt', (x) => { x.noInt = 5; }], ['t', (x) => { x.t = -1; }],
    ['t NaN', (x) => { x.t = NaN; }], ['nullo', (x) => { Object.keys(x).forEach((k) => delete x[k]); }],
  ];
  const c3 = new Z80({read: () => 0, write() {}, in: () => 0, out() {}});
  const before = JSON.stringify(c3.saveState());
  let rej = 0, untouched = true;
  for (const [name, f] of bad) {
    const x = JSON.parse(json); f(x);
    try { c3.loadState(x); } catch (e) { rej++; if (JSON.stringify(c3.saveState()) !== before) untouched = false; continue; }
    console.log('FAIL  stato falso accettato: ' + name); fails++;
  }
  eq(rej, bad.length, 'loadState rifiuta tutti gli stati falsi'); check(untouched, 'loadState non tocca la CPU quando rifiuta');
  try { c3.loadState(null); check(false, 'loadState(null) rifiutato'); } catch (e) { check(/stato non valido/.test(e.message), 'loadState(null): messaggio'); }
  // ripresa: eseguire N, salvare, eseguire M; ricaricare e rieseguire M = identico
  const prog = []; for (let i = 0; i < 200; i++) prog.push((i * 37 + 11) & 0xFF);
  const a = mk(prog, 0x100); const b = mk(prog, 0x100);
  a.cpu.sp = 0x8000; run(a, 40);
  const snap = JSON.stringify(a.cpu.saveState()); const memSnap = a.mem.slice();
  run(a, 60);
  b.mem.set(memSnap); b.cpu.loadState(JSON.parse(snap)); run(b, 60);
  eq(JSON.stringify(b.cpu.saveState()), JSON.stringify(a.cpu.saveState()), 'ripresa deterministica: stessi registri dopo N + M passi');
  check(Buffer.compare(Buffer.from(a.mem), Buffer.from(b.mem)) === 0, 'ripresa deterministica: stessa memoria');
}

// ---- 10. runUntil e il tempo
{
  const m = mk([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);       // NOP da 4 T
  m.cpu.runUntil(10);
  eq(m.cpu.t, 12, 'runUntil(10) esegue NOP da 4 T fino a t >= 10 (12)');
  m.cpu.runUntil(12); eq(m.cpu.t, 12, 'runUntil con t gia\' raggiunto non esegue nulla');
  m.cpu.runUntil(5); eq(m.cpu.t, 12, 'runUntil all\'indietro non fa nulla');
  eq(m.cpu.pc, 3, 'tre NOP eseguiti');
}

console.log(fails ? ('FALLITI ' + fails + ' su ' + n) : ('TUTTO OK (' + n + ' controlli)'));
process.exit(fails ? 1 : 0);
