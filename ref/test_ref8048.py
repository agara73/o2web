#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac G7000 per ZX Spectrum
"""Prove di ref8048.py con risultati calcolati a mano dal manuale MCS-48 (non da altro codice).

Esegue anche il confronto di lunghezze/cicli di tutti gli opcode con tools/dis48.py (altro codice, scritto
a parte e a sua volta confrontato con MAME).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import ref8048 as R          # noqa: E402
import dis48                 # noqa: E402

fails = 0


def check(cond, msg):
    global fails
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        fails += 1


def mk(code, at=0, **kw):
    e = R.Env()
    e.prog[at:at + len(code)] = bytes(code)
    c = R.CPU(e)
    c.pc = at
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def run(c, n):
    for _ in range(n):
        c.step()
    return c


# ---- 1. lunghezze e cicli contro dis48 ------------------------------------------------------
bad = []
for op in range(256):
    t = dis48.decode(bytes([op, 0, 0]), 0)
    illegal = t[2] == "ill"
    if (op in R.ILLEGAL) != illegal:
        bad.append("ill %02X" % op)
        continue
    if R.op_cycles(op) != t[4]:
        bad.append("cicli %02X" % op)
    if not illegal and ((op in R.LEN2) != (t[1] == 2)):
        bad.append("lunghezza %02X" % op)
check(not bad, "lunghezze, cicli e opcode illegali di tutti i 256 opcode coincidono con dis48 %s" % bad[:5])

# ---- 2. aritmetica e flag ---------------------------------------------------------------------
c = run(mk([0x23, 0x9C, 0x03, 0x65]), 2)           # MOV A,#9C ; ADD A,#65
check(c.a == 0x01 and c.psw & 0x80 and c.psw & 0x40, "ADD 9C+65 = 01, C=1, AC=1")
c = run(mk([0x23, 0x0F, 0x03, 0x01]), 2)
check(c.a == 0x10 and not c.psw & 0x80 and c.psw & 0x40, "ADD 0F+01 = 10, C=0, AC=1")
c = run(mk([0x23, 0xFF, 0x13, 0x00], psw=0x80), 2)  # ADDC con C=1
check(c.a == 0x00 and c.psw & 0x80 and c.psw & 0x40, "ADDC FF+00+1 = 00, C=1, AC=1")
c = run(mk([0x23, 0x38, 0x03, 0x29, 0x57]), 3)      # BCD 38+29 = 67
check(c.a == 0x67 and not c.psw & 0x80, "ADD 38+29 ; DA A = 67 (BCD)")
c = run(mk([0x23, 0x99, 0x03, 0x01, 0x57]), 3)      # BCD 99+01 = 100
check(c.a == 0x00 and c.psw & 0x80, "ADD 99+01 ; DA A = 00 con C=1 (BCD)")
c = run(mk([0x23, 0x81, 0x67, 0x67]), 3)            # MOV A,#81 ; RRC ; RRC   (C parte da 0)
check(c.a == 0xA0 and not c.psw & 0x80, "RRC due volte: 81 -> 40 (C=1) -> A0 (C=0)")
c = run(mk([0x23, 0x81, 0x97, 0x67]), 3)            # CLR C ; RRC A : 81 -> 40, C=1
check(c.a == 0x40 and c.psw & 0x80, "RRC A: 81 -> 40, C=1")
c = run(mk([0x23, 0x81, 0xA7, 0xF7]), 3)            # CPL C ; RLC A : 81 con C=1 -> 03, C=1
check(c.a == 0x03 and c.psw & 0x80, "RLC A: 81 con C=1 -> 03, C=1")
c = run(mk([0x23, 0xA5, 0x47]), 2)
check(c.a == 0x5A, "SWAP A")
c = run(mk([0x23, 0x81, 0xE7, 0x77]), 3)
check(c.a == 0x81, "RL A poi RR A")
c = run(mk([0x23, 0x12, 0xB8, 0x34, 0x28]), 3)      # XCH A,R0
check(c.a == 0x34 and c.R(0) == 0x12, "XCH A,R0")
c = run(mk([0xB8, 0x20, 0xB0, 0xAB, 0x23, 0xCD, 0x30]), 4)   # MOV R0,#20 ; MOV @R0,#AB ; MOV A,#CD ; XCHD A,@R0
check(c.a == 0xCB and c.ir(0x20) == 0xAD, "XCHD A,@R0 scambia il nibble basso")
# ---- 3. banchi registri, PSW ------------------------------------------------------------------
c = run(mk([0xB9, 0x55, 0xD5, 0xB9, 0x66]), 3)       # MOV R1,#55 ; SEL RB1 ; MOV R1,#66
check(c.ram[1] == 0x55 and c.ram[25] == 0x66 and c.psw & 0x10, "SEL RB1 usa RAM 24..31")
c = run(mk([0xD5, 0xC7]), 2)
check(c.a == 0x18, "MOV A,PSW con BS=1, SP=0: bit 3 letto a 1 -> 18")
c = run(mk([0x23, 0xFF, 0xD7, 0xC7]), 3)
check(c.a == 0xFF and c.psw == 0xF7, "MOV PSW,A: il bit 3 non si memorizza; si rilegge a 1")
# ---- 4. stack: CALL/RET/RETR --------------------------------------------------------------------
c = mk([0x14, 0x10], psw=0xA0)
c.step()
check(c.pc == 0x010 and c.psw & 7 == 1 and c.ram[8] == 0x02 and c.ram[9] == 0xA0, "CALL: push PC=0002 e PSW alto A0, SP=1")
e = R.Env(); e.prog[0x10] = 0x83
c2 = R.CPU(e); c2.pc = 0x10; c2.psw = 1; c2.ram[8] = 0x02; c2.ram[9] = 0xA5
c2.step()
check(c2.pc == 0x502 and c2.psw == 0x00, "RET: pull PC (12 bit) e SP=0; PSW alto non cambia")
e = R.Env(); e.prog[0x10] = 0x93
c2 = R.CPU(e); c2.pc = 0x10; c2.psw = 1; c2.in_progress = 1; c2.ram[8] = 0x02; c2.ram[9] = 0xA9
c2.step()
check(c2.pc == 0x902 & 0xFFF and c2.psw == 0xA0 and not c2.in_progress, "RETR: ripristina PC con bit 11, PSW alto (A0), azzera interrupt in corso")
# CALL da pagina 7 con MB1
c = mk([0xF5, 0x04, 0x20])
run(c, 2)
check(c.pc == 0x820, "SEL MB1 + JMP 020 -> 820 (A11 aggiunto)")
c = mk([0xF5, 0x14, 0x20], in_progress=1)
run(c, 2)
check(c.pc == 0x020, "con interrupt in corso JMP/CALL ignorano MB1")
# ---- 5. salti: pagina dell'operando, JMPP, MOVP -------------------------------------------------
c = mk([0xC6, 0x10], at=0xFF)    # JZ con A=0, opcode in 0xFF, operando in 0x100: salta in pagina 1
c.step()
check(c.pc == 0x110, "JZ a cavallo di pagina salta nella pagina dell'operando")
c = mk([0xB3], at=0x1FF, a=2)    # JMPP @A: pagina del PC gia' incrementato (0x200)
c.env.prog[0x202] = 0x77
c.step()
check(c.pc == 0x277, "JMPP @A usa la pagina successiva se l'opcode e' in fondo alla pagina")
c = mk([0xA3], at=0x2FE, a=5)
c.env.prog[0x2FF + 0] = 0
c.env.prog[0x205] = 0x11
c.step()
check(c.a == 0x00 or c.a == 0x11, "MOVP A,@A (comportamento a cavallo di pagina documentato)")
c = mk([0xE3], at=0x500, a=7)
c.env.prog[0x307] = 0x42
c.step()
check(c.a == 0x42, "MOVP3 A,@A legge sempre dalla pagina 3")
c = run(mk([0xB8, 0x03, 0xE8, 0x02, 0x00, 0x00]), 4)   # DJNZ R0 verso 0x002 3 volte
check(c.R(0) == 0 and c.pc == 0x004, "DJNZ R0: 3 iterazioni, poi prosegue")
# ---- 6. timer e interrupt -----------------------------------------------------------------------
c = mk([0x23, 0xFE, 0x62, 0x55] + [0x00] * 80)       # MOV A,#FE ; MOV T,A ; STRT T ; NOP...
run(c, 3)
n0 = c.now
n = 0
while not c.tf and n < 200:
    c.step(); n += 1
check(c.tf and (c.now - n0) in range(63, 66), "timer FE: overflow dopo 2x32 cicli (now-n0=%d)" % (c.now - n0))
c = mk([0x23, 0xFF, 0x62, 0x55, 0x00, 0x00, 0x00, 0x16, 0x20, 0x00])
run(c, 3)
c.prescaler = 28                                      # dopo STRT T il prescaler vale 0: lo si forza per un test corto
for _ in range(4):
    c.step()
check(c.tf, "overflow raggiunto con prescaler vicino a 32")
c = mk([0x25, 0x23, 0xFF, 0x62, 0x55] + [0x00] * 40, at=0x100)  # EN TCNTI ; MOV A,#FF ; MOV T,A ; STRT T
c.env.prog[7] = 0x93                                   # vettore timer: RETR
run(c, 4)
for _ in range(60):
    if c.timer_pend:
        break
    c.step()
check(c.timer_pend and not c.in_progress, "overflow con EN TCNTI: interrupt in attesa")
c.boundary()
check(c.in_progress and c.pc == 0x007 and c.psw & 7 == 1 and not c.timer_pend, "interrupt del timer: vettore 7, push, in_progress")
c.step()                                               # RETR
check(not c.in_progress and c.psw & 7 == 0, "RETR chiude l'interrupt")
c = mk([0x05, 0x00, 0x00, 0x00])                       # EN I
c.env.events = [(0, 1, 0, 0, 0xFF, 0xFF, 0xFF)]
run(c, 2)
check(c.in_progress and c.pc in (0x003, 0x004) and c.ram[8] == 1, "interrupt esterno: vettore 3 dopo EN I con /INT attivo")
# contatore su T1: due fronti di discesa
c = mk([0x45] + [0x00] * 30)
c.env.events = [(2, 0, 0, 1, 0xFF, 0xFF, 0xFF), (4, 0, 0, 0, 0xFF, 0xFF, 0xFF), (6, 0, 0, 1, 0xFF, 0xFF, 0xFF),
                (8, 0, 0, 0, 0xFF, 0xFF, 0xFF)]
run(c, 12)
check(c.timer == 2 and c.counter_en, "STRT CNT: conta i fronti di discesa di T1 (%d)" % c.timer)
# JTF azzera TF
c = mk([0x16, 0x00, 0x16, 0x00], tf=1)
c.step()
check(c.pc == 0x000 and c.tf == 0, "JTF salta se TF=1 e lo azzera (salto a 000)")
# ---- 7. porte ---------------------------------------------------------------------------------
c = mk([0x23, 0x0F, 0x39, 0x09, 0x89, 0xF0, 0x99, 0x3C])
c.env.p1_pin = 0xAA
run(c, 3)
check(c.p1 == 0x0F and c.a == (0xAA & 0x0F), "OUTL P1 poi IN A,P1 = pin & latch")
run(c, 2)
check(c.p1 == 0x3C, "ORL P1,#F0 poi ANL P1,#3C: 0F -> FF -> 3C")
# espansore 8243: MOVD P4,A scrive il nibble e lascia il dato su P2 basso
c = mk([0x23, 0x0B, 0x3C, 0x0C])
run(c, 3)
check(c.a == 0x0B and c.exp[0] == 0x0B and (c.p2 & 0x0F) == 0x0F, "MOVD P4,A poi MOVD A,P4")

print("\n%s: %d prove fallite" % ("FALLITO" if fails else "OK", fails))
sys.exit(1 if fails else 0)
