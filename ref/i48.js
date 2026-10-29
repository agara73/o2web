'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - ricompilatore 8048 -> Z80 per l'emulatore Odyssey 2 / Videopac su ZX Spectrum
//
// i48.js - proprieta' delle istruzioni MCS-48 (lunghezza, cicli macchina, tipo di controllo) e decodifica.
// Le tabelle sono le stesse di stage1/ref8048.py (fonte di verita'); check_i48.py le confronta per tutti i 256 opcode.

const ILLEGAL = new Set([0x01, 0x06, 0x0B, 0x22, 0x33, 0x38, 0x3B, 0x63, 0x66, 0x73, 0x82, 0x87, 0x8B, 0x9B, 0xA2, 0xA6,
  0xB7, 0xC0, 0xC1, 0xC2, 0xC3, 0xD6, 0xE0, 0xE1, 0xE2, 0xF3]);

const CJ = {0x12: 'JB0', 0x32: 'JB1', 0x52: 'JB2', 0x72: 'JB3', 0x92: 'JB4', 0xB2: 'JB5', 0xD2: 'JB6', 0xF2: 'JB7',
  0x16: 'JTF', 0x26: 'JNT0', 0x36: 'JT0', 0x46: 'JNT1', 0x56: 'JT1', 0x76: 'JF1', 0x86: 'JNI', 0x96: 'JNZ',
  0xB6: 'JF0', 0xC6: 'JZ', 0xE6: 'JNC', 0xF6: 'JC'};

const LEN2 = new Set([0x03, 0x13, 0x23, 0x43, 0x53, 0xD3, 0x88, 0x89, 0x8A, 0x98, 0x99, 0x9A, 0xB0, 0xB1]);
for (let o = 0xB8; o < 0xC0; o++) LEN2.add(o);
for (const o of Object.keys(CJ)) LEN2.add(+o);
for (let o = 0xE8; o < 0xF0; o++) LEN2.add(o);
for (let o = 0; o < 256; o++) if ((o & 0x1F) === 0x04 || (o & 0x1F) === 0x14) LEN2.add(o);

const TWO_1B = new Set([0x02, 0x08, 0x09, 0x0A, 0x39, 0x3A, 0x80, 0x81, 0x83, 0x90, 0x91, 0x93, 0xA3, 0xB3, 0xE3]);
for (let o = 0x0C; o < 0x10; o++) TWO_1B.add(o);
for (let o = 0x3C; o < 0x40; o++) TWO_1B.add(o);
for (let o = 0x8C; o < 0x90; o++) TWO_1B.add(o);
for (let o = 0x9C; o < 0xA0; o++) TWO_1B.add(o);

const NAMES = {
  0x00: 'NOP', 0x02: 'OUTL BUS,A', 0x05: 'EN I', 0x07: 'DEC A', 0x08: 'INS A,BUS', 0x09: 'IN A,P1', 0x0A: 'IN A,P2',
  0x10: 'INC @R0', 0x11: 'INC @R1', 0x15: 'DIS I', 0x17: 'INC A', 0x20: 'XCH A,@R0', 0x21: 'XCH A,@R1',
  0x25: 'EN TCNTI', 0x27: 'CLR A', 0x30: 'XCHD A,@R0', 0x31: 'XCHD A,@R1', 0x35: 'DIS TCNTI', 0x37: 'CPL A',
  0x39: 'OUTL P1,A', 0x3A: 'OUTL P2,A', 0x40: 'ORL A,@R0', 0x41: 'ORL A,@R1', 0x42: 'MOV A,T', 0x45: 'STRT CNT',
  0x47: 'SWAP A', 0x50: 'ANL A,@R0', 0x51: 'ANL A,@R1', 0x55: 'STRT T', 0x57: 'DA A', 0x60: 'ADD A,@R0',
  0x61: 'ADD A,@R1', 0x62: 'MOV T,A', 0x65: 'STOP TCNT', 0x67: 'RRC A', 0x70: 'ADDC A,@R0', 0x71: 'ADDC A,@R1',
  0x75: 'ENT0 CLK', 0x77: 'RR A', 0x80: 'MOVX A,@R0', 0x81: 'MOVX A,@R1', 0x83: 'RET', 0x85: 'CLR F0',
  0x90: 'MOVX @R0,A', 0x91: 'MOVX @R1,A', 0x93: 'RETR', 0x95: 'CPL F0', 0x97: 'CLR C', 0xA0: 'MOV @R0,A',
  0xA1: 'MOV @R1,A', 0xA3: 'MOVP A,@A', 0xA5: 'CLR F1', 0xA7: 'CPL C', 0xB3: 'JMPP @A', 0xB5: 'CPL F1',
  0xC5: 'SEL RB0', 0xC7: 'MOV A,PSW', 0xD0: 'XRL A,@R0', 0xD1: 'XRL A,@R1', 0xD5: 'SEL RB1', 0xD7: 'MOV PSW,A',
  0xE3: 'MOVP3 A,@A', 0xE5: 'SEL MB0', 0xE7: 'RL A', 0xF0: 'MOV A,@R0', 0xF1: 'MOV A,@R1', 0xF5: 'SEL MB1',
  0xF7: 'RLC A'};
const IMMN = {0x03: 'ADD A,#', 0x13: 'ADDC A,#', 0x23: 'MOV A,#', 0x43: 'ORL A,#', 0x53: 'ANL A,#', 0xD3: 'XRL A,#',
  0x88: 'ORL BUS,#', 0x89: 'ORL P1,#', 0x8A: 'ORL P2,#', 0x98: 'ANL BUS,#', 0x99: 'ANL P1,#', 0x9A: 'ANL P2,#',
  0xB0: 'MOV @R0,#', 0xB1: 'MOV @R1,#'};
const REGN = {0x18: 'INC R', 0x28: 'XCH A,R', 0x48: 'ORL A,R', 0x58: 'ANL A,R', 0x68: 'ADD A,R', 0x78: 'ADDC A,R',
  0xA8: 'MOV R%,A', 0xC8: 'DEC R', 0xD8: 'XRL A,R', 0xF8: 'MOV A,R'};

function opName(op, b1) {
  const hex = (x, n) => x.toString(16).toUpperCase().padStart(n, '0');
  if (ILLEGAL.has(op)) return 'ILL ' + hex(op, 2);
  if (op in NAMES) return NAMES[op];
  const f = REGN[op & 0xF8];
  if (f) return f.includes('%') ? f.replace('%', op & 7) : f + (op & 7);
  if (op >= 0xB8 && op <= 0xBF) return 'MOV R' + (op & 7) + ',#' + hex(b1, 2);
  if (op in IMMN) return IMMN[op] + hex(b1, 2);
  if ((op & 0x1F) === 0x04) return 'JMP ' + hex(((op & 0xE0) << 3) | b1, 3);
  if ((op & 0x1F) === 0x14) return 'CALL ' + hex(((op & 0xE0) << 3) | b1, 3);
  if (op in CJ) return CJ[op] + ' .' + hex(b1, 2);
  if (op >= 0xE8 && op <= 0xEF) return 'DJNZ R' + (op & 7) + ',.' + hex(b1, 2);
  if (op >= 0x0C && op <= 0x0F) return 'MOVD A,P' + (4 + (op & 3));
  if (op >= 0x3C && op <= 0x3F) return 'MOVD P' + (4 + (op & 3)) + ',A';
  if (op >= 0x8C && op <= 0x8F) return 'ORLD P' + (4 + (op & 3)) + ',A';
  if (op >= 0x9C && op <= 0x9F) return 'ANLD P' + (4 + (op & 3)) + ',A';
  return 'DB ' + hex(op, 2);
}

function kindOf(op) {
  if ((op & 0x1F) === 0x04) return 'jmp';
  if ((op & 0x1F) === 0x14) return 'call';
  if (op in CJ || (op >= 0xE8 && op <= 0xEF)) return 'cjmp';
  if (op === 0x83) return 'ret';
  if (op === 0x93) return 'retr';
  if (op === 0xB3) return 'jmpp';
  return '';
}

const len = (op) => (LEN2.has(op) ? 2 : 1);
const cycles = (op) => (ILLEGAL.has(op) ? 1 : (LEN2.has(op) || TWO_1B.has(op)) ? 2 : 1);

// indirizzi a 12 bit: l'avanzamento mantiene il bit 11 e torna a 0x000 oltre 0x7FF (come ref8048.py)
const next = (pc) => (((pc + 1) & 0x7FF) | (pc & 0x800));

// memoria programma: array di 4096 byte (indice = indirizzo a 12 bit)
function decode(mem, pc) {
  const op = mem[pc];
  const n1 = len(op) === 2 ? mem[next(pc)] : 0;
  const k = kindOf(op);
  const ins = {pc, op, b1: n1, len: len(op), cyc: cycles(op), kind: k, name: opName(op, n1), illegal: ILLEGAL.has(op)};
  ins.after = len(op) === 2 ? next(next(pc)) : next(pc);
  if (k === 'jmp' || k === 'call') ins.t11 = ((op & 0xE0) << 3) | n1;
  if (k === 'cjmp') ins.target = (next(pc) & 0xF00) | n1;         // pagina del byte dell'operando
  return ins;
}

module.exports = {ILLEGAL, LEN2, TWO_1B, CJ, len, cycles, kindOf, opName, next, decode};

if (require.main === module) {
  // tabella per il confronto con Python: opcode -> [lunghezza, cicli, illegale, tipo]
  const t = [];
  for (let o = 0; o < 256; o++) t.push([len(o), cycles(o), ILLEGAL.has(o) ? 1 : 0, kindOf(o)]);
  console.log(JSON.stringify(t));
}
