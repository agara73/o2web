#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - strumenti per l'emulatore Odyssey 2 / Videopac G7000 su ZX Spectrum
"""Disassemblatore Intel MCS-48 (8048) con cicli macchina e tracciamento del codice raggiungibile.

Uso:
  dis48.py FILE [--base 400]            disassemblaggio lineare
  dis48.py FILE --trace 0,3,7           solo il codice raggiungibile da quegli indirizzi (BIOS: 0,3,7)
  dis48.py --selftest                   prove interne (non servono file)

Note: i salti condizionali restano nella pagina da 256 byte; JMP/CALL usano 11 bit e il banco
(MB0/MB1) non e' tracciato: nel BIOS (< 0x400) il tracciamento si ferma a 0x400, dove inizia la
cartuccia. JMPP @A e' un salto calcolato: non si segue e viene segnalato.
Gli indirizzi stampati sono quelli del processore (base + offset nel file).
"""
import sys

# ---- opcode con lunghezza 2 (derivati dal manuale MCS-48) -------------------------------
IMM = {0x03: "ADD A,#%02X", 0x13: "ADDC A,#%02X", 0x23: "MOV A,#%02X", 0x43: "ORL A,#%02X",
       0x53: "ANL A,#%02X", 0xD3: "XRL A,#%02X", 0x88: "ORL BUS,#%02X", 0x89: "ORL P1,#%02X",
       0x8A: "ORL P2,#%02X", 0x98: "ANL BUS,#%02X", 0x99: "ANL P1,#%02X", 0x9A: "ANL P2,#%02X",
       0xB0: "MOV @R0,#%02X", 0xB1: "MOV @R1,#%02X"}
CJ = {0x12: "JB0", 0x32: "JB1", 0x52: "JB2", 0x72: "JB3", 0x92: "JB4", 0xB2: "JB5", 0xD2: "JB6",
      0xF2: "JB7", 0x16: "JTF", 0x26: "JNT0", 0x36: "JT0", 0x46: "JNT1", 0x56: "JT1", 0x76: "JF1",
      0x86: "JNI", 0x96: "JNZ", 0xB6: "JF0", 0xC6: "JZ", 0xE6: "JNC", 0xF6: "JC"}
FIX = {
    0x00: "NOP", 0x02: "OUTL BUS,A", 0x05: "EN I", 0x07: "DEC A", 0x08: "INS A,BUS",
    0x09: "IN A,P1", 0x0A: "IN A,P2", 0x10: "INC @R0", 0x11: "INC @R1", 0x15: "DIS I",
    0x17: "INC A", 0x20: "XCH A,@R0", 0x21: "XCH A,@R1", 0x25: "EN TCNTI", 0x27: "CLR A",
    0x30: "XCHD A,@R0", 0x31: "XCHD A,@R1", 0x35: "DIS TCNTI", 0x37: "CPL A",
    0x39: "OUTL P1,A", 0x3A: "OUTL P2,A", 0x40: "ORL A,@R0", 0x41: "ORL A,@R1", 0x42: "MOV A,T",
    0x45: "STRT CNT", 0x47: "SWAP A", 0x50: "ANL A,@R0", 0x51: "ANL A,@R1", 0x55: "STRT T",
    0x57: "DA A", 0x60: "ADD A,@R0", 0x61: "ADD A,@R1", 0x62: "MOV T,A", 0x65: "STOP TCNT",
    0x67: "RRC A", 0x70: "ADDC A,@R0", 0x71: "ADDC A,@R1", 0x75: "ENT0 CLK", 0x77: "RR A",
    0x80: "MOVX A,@R0", 0x81: "MOVX A,@R1", 0x83: "RET", 0x85: "CLR F0", 0x90: "MOVX @R0,A",
    0x91: "MOVX @R1,A", 0x93: "RETR", 0x95: "CPL F0", 0x97: "CLR C", 0xA0: "MOV @R0,A",
    0xA1: "MOV @R1,A", 0xA3: "MOVP A,@A", 0xA5: "CLR F1", 0xA7: "CPL C", 0xB3: "JMPP @A",
    0xB5: "CPL F1", 0xC5: "SEL RB0", 0xC7: "MOV A,PSW", 0xD0: "XRL A,@R0", 0xD1: "XRL A,@R1",
    0xD5: "SEL RB1", 0xD7: "MOV PSW,A", 0xE3: "MOVP3 A,@A", 0xE5: "SEL MB0", 0xE7: "RL A",
    0xF0: "MOV A,@R0", 0xF1: "MOV A,@R1", 0xF5: "SEL MB1", 0xF7: "RLC A"}
REGF = {0x18: "INC R%d", 0x28: "XCH A,R%d", 0x48: "ORL A,R%d", 0x58: "ANL A,R%d",
        0x68: "ADD A,R%d", 0x78: "ADDC A,R%d", 0xA8: "MOV R%d,A", 0xC8: "DEC R%d",
        0xD8: "XRL A,R%d", 0xF8: "MOV A,R%d"}
# istruzioni da 1 byte che durano 2 cicli macchina (tutte quelle da 2 byte durano 2 cicli)
TWO_CYCLE_1B = ({0x02, 0x08, 0x09, 0x0A, 0x39, 0x3A, 0x80, 0x81, 0x83, 0x90, 0x91, 0x93, 0xA3,
                 0xB3, 0xE3} | set(range(0x0C, 0x10)) | set(range(0x3C, 0x40)) |
                set(range(0x8C, 0x90)) | set(range(0x9C, 0xA0)))


def decode(mem, pc, base=0):
    """-> (testo, lunghezza, tipo, destinazione|None, cicli). tipo: '', jmp, call, cjmp, ret, jmpp, ill"""
    op = mem[pc]
    n1 = mem[pc + 1] if pc + 1 < len(mem) else 0
    if op in FIX:
        k = "ret" if op in (0x83, 0x93) else "jmpp" if op == 0xB3 else ""
        return FIX[op], 1, k, None, 2 if op in TWO_CYCLE_1B else 1
    f = REGF.get(op & 0xF8)
    if f:
        return f % (op & 7), 1, "", None, 1
    for lo, hi, nm in ((0x0C, 0x0F, "MOVD A,P%d"), (0x3C, 0x3F, "MOVD P%d,A"),
                       (0x8C, 0x8F, "ORLD P%d,A"), (0x9C, 0x9F, "ANLD P%d,A")):
        if lo <= op <= hi:
            return nm % (4 + (op & 3)), 1, "", None, 2
    if op in IMM:
        return IMM[op] % n1, 2, "", None, 2
    if 0xB8 <= op <= 0xBF:
        return "MOV R%d,#%02X" % (op & 7, n1), 2, "", None, 2
    if (op & 0x1F) in (0x04, 0x14):
        a = ((op & 0xE0) << 3) | n1
        call = (op & 0x1F) == 0x14
        return ("CALL %03X" if call else "JMP %03X") % a, 2, "call" if call else "jmp", a, 2
    if op in CJ or 0xE8 <= op <= 0xEF:
        a = ((pc + 1 + base) & ~0xFF) | n1      # pagina dell'ultimo byte dell'istruzione
        nm = CJ.get(op) or "DJNZ R%d," % (op & 7)
        return ("%s %03X" % (nm, a)) if op in CJ else ("%s%03X" % (nm, a)), 2, "cjmp", a, 2
    return "DB %02X ; ???" % op, 1, "ill", None, 1


def trace(mem, entries, base=0, limit=0x400):
    """Insieme degli offset raggiungibili. Si ferma a 'limit' (inizio cartuccia)."""
    seen, todo, jmpp = {}, list(entries), []
    while todo:
        a = todo.pop()
        while 0 <= a - base < len(mem) and a < limit and a not in seen:
            txt, ln, k, t, cy = decode(mem, a - base, base)
            seen[a] = (txt, ln, k, cy)
            if k in ("jmp", "cjmp", "call") and t is not None:
                todo.append(t)
            if k == "jmpp":
                jmpp.append(a)
            if k in ("jmp", "ret", "jmpp"):
                break
            a += ln
    return seen, jmpp


def selftest():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("PASS  " if cond else "FAIL  ") + msg)
        ok &= bool(cond)
    # sequenze note dal manuale Intel MCS-48
    cases = [(b"\x23\x12", "MOV A,#12", 2, 2), (b"\x24\x23", "JMP 123", 2, 2), (b"\xA4\x23", "JMP 523", 2, 2),
             (b"\x80", "MOVX A,@R0", 1, 2), (b"\x93", "RETR", 1, 2), (b"\xF5", "SEL MB1", 1, 1),
             (b"\xEA\x10", "DJNZ R2,010", 2, 2), (b"\xB9\x3F", "MOV R1,#3F", 2, 2),
             (b"\x3F", "MOVD P7,A", 1, 2), (b"\xA3", "MOVP A,@A", 1, 2), (b"\x47", "SWAP A", 1, 1)]
    for raw, txt, ln, cy in cases:
        t = decode(raw + b"\x00" * 2, 0)
        chk(t[0] == txt and t[1] == ln and t[4] == cy, "%s -> %s (%d byte, %d cicli)" % (raw.hex(), t[0], t[1], t[4]))
    # il salto condizionale usa la pagina dell'ultimo byte (caso classico a cavallo di pagina)
    mem = bytes(0xFF) + b"\xC6\x10" + bytes(8)       # opcode in 0xFF, operando in 0x100
    chk(decode(mem, 0xFF, 0)[0] == "JZ 110", "JZ con operando nella pagina successiva salta in quella pagina")
    mem = bytes(0xFE) + b"\xC6\x10" + bytes(8)       # opcode in 0xFE, operando in 0xFF
    chk(decode(mem, 0xFE, 0)[0] == "JZ 010", "JZ con operando in fondo alla pagina resta nella pagina")
    ill = [o for o in range(256) if decode(bytes([o, 0, 0]), 0)[2] == "ill"]
    print("INFO  opcode non definiti nel decodificatore: " + " ".join("%02X" % o for o in ill))
    chk(len(ill) == 26, "26 opcode non definiti (il numero esatto va confrontato con il manuale MCS-48)")
    return ok


def main(argv):
    if "--selftest" in argv:
        sys.exit(0 if selftest() else 1)
    if not argv:
        sys.exit(__doc__)
    data = open(argv[0], "rb").read()
    base = int(argv[argv.index("--base") + 1], 16) if "--base" in argv else 0
    if "--trace" in argv:
        ent = [int(x, 16) for x in argv[argv.index("--trace") + 1].split(",")]
        seen, jmpp = trace(data, ent, base, base + len(data) if base else 0x400)
        for a in sorted(seen):
            txt, ln, k, cy = seen[a]
            print("%03X: %-8s %-16s %dc%s" % (a, data[a - base:a - base + ln].hex(" ").upper(), txt, cy,
                                             "  <-- ILLEGALE" if k == "ill" else ""))
        bad = [a for a, v in seen.items() if v[2] == "ill"]
        print("; raggiungibili: %d istruzioni, %d byte; salti calcolati (JMPP): %s; opcode illegali: %d"
              % (len(seen), sum(v[1] for v in seen.values()), [hex(x) for x in jmpp], len(bad)))
        sys.exit(1 if bad else 0)
    pc = 0
    while pc < len(data):
        txt, ln, k, t, cy = decode(data, pc, base)
        print("%03X: %-8s %-16s %dc" % (pc + base, data[pc:pc + ln].hex(" ").upper(), txt, cy))
        pc += ln


if __name__ == "__main__":
    main(sys.argv[1:])
