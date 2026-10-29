#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac G7000 per ZX Spectrum
"""ref8048.py - interprete MCS-48 (8048) di riferimento: semplice, leggibile, fonte di verita'.

Serve a confrontare, istruzione per istruzione, il nucleo Z80 (differential testing). Non e'
pensato per la velocita'.

Modello di temporizzazione (identico a quello del nucleo Z80, vedi LEGGIMI.md del pacchetto):
  ad ogni "confine" fra istruzioni:
    1. si applicano gli eventi dell'ambiente (pin, ingressi) il cui tempo e' <= 'now';
    2. si controllano gli interrupt (se scatta: push PC/PSW, vettore 3 o 7, 2 cicli, poi di nuovo gli eventi scaduti);
    3. si esegue l'istruzione (corpo), poi trascorrono i suoi cicli ("burn dopo"): avanzano
       'now', il prescaler e il timer; un overflow imposta TF (e l'interrupt del timer in
       attesa se EN TCNTI era attivo in quel momento).
  Il timer legge quindi il valore all'inizio dell'istruzione (differenza <= 1 ciclo da MAME).

Semantica ricavata dal manuale MCS-48 e confrontata (solo come documentazione) con il sorgente
MCS-48 di MAME; i punti incerti sono marcati "DA VERIFICARE":
  - RAM interna 64 byte, indirizzi @R0/@R1 specchiati modulo 64 (DA VERIFICARE sul chip vero);
  - il PC avanza in 11 bit mantenendo il bit 11 (l'avanzamento sequenziale da 0x7FF va a 0x000);
  - durante un interrupt il banco di memoria e' forzato a MB0 (JMP/CALL/RET senza A11);
  - JNI: non c'e' il trucco di MAME che forza il salto quando l'interrupt arriva subito dopo;
  - MOVD/ANLD/ORLD: espansore 8243 modellato come in MAME (P2 basso = codice, poi dato).
"""
import sys

C_FLAG, A_FLAG, F_FLAG, B_FLAG = 0x80, 0x40, 0x20, 0x10

# cicli macchina (= quelli del manuale MCS-48): 2 per tutte le istruzioni da 2 byte e per queste da 1 byte
TWO_1B = ({0x02, 0x08, 0x09, 0x0A, 0x39, 0x3A, 0x80, 0x81, 0x83, 0x90, 0x91, 0x93, 0xA3, 0xB3, 0xE3}
          | set(range(0x0C, 0x10)) | set(range(0x3C, 0x40)) | set(range(0x8C, 0x90)) | set(range(0x9C, 0xA0)))
LEN2 = ({0x03, 0x13, 0x23, 0x43, 0x53, 0xD3, 0x88, 0x89, 0x8A, 0x98, 0x99, 0x9A, 0xB0, 0xB1}
        | set(range(0xB8, 0xC0)) | {0x12, 0x32, 0x52, 0x72, 0x92, 0xB2, 0xD2, 0xF2, 0x16, 0x26, 0x36, 0x46,
                                    0x56, 0x76, 0x86, 0x96, 0xB6, 0xC6, 0xE6, 0xF6}
        | set(range(0xE8, 0xF0)) | {o for o in range(256) if (o & 0x1F) in (0x04, 0x14)})
ILLEGAL = {0x01, 0x06, 0x0B, 0x22, 0x33, 0x38, 0x3B, 0x63, 0x66, 0x73, 0x82, 0x87, 0x8B, 0x9B, 0xA2, 0xA6,
           0xB7, 0xC0, 0xC1, 0xC2, 0xC3, 0xD6, 0xE0, 0xE1, 0xE2, 0xF3}


def op_cycles(op):
    return 1 if op in ILLEGAL else 2 if (op in LEN2 or op in TWO_1B) else 1


class Env:
    """Ambiente di prova: memoria programma 4 KB, RAM esterna 256 byte (MOVX), pin e ingressi.

    Gli 'eventi' sono (tempo_assoluto_in_cicli, int_attivo, t0, t1, p1_pin, p2_pin, bus_pin) e
    vengono applicati al primo confine con now >= tempo. Lo stesso modello e' nel nucleo Z80.
    """

    def __init__(self, prog=None):
        self.prog = bytearray(4096)
        if prog:
            self.prog[:len(prog)] = prog
        self.xram = bytearray(256)
        self.int_active = 0
        self.t0 = 0
        self.t1 = 0
        self.p1_pin = 0xFF
        self.p2_pin = 0xFF
        self.bus_pin = 0xFF
        self.events = []          # lista ordinata (tempo, int, t0, t1, p1, p2, bus)
        self.ev_i = 0
        self.p1_out_log = []

    def movx_r(self, a):
        return self.xram[a & 0xFF]

    def movx_w(self, a, v):
        self.xram[a & 0xFF] = v & 0xFF


class CPU:
    def __init__(self, env):
        self.env = env
        self.reset()

    # ------------------------------------------------------------------ stato
    def reset(self):
        self.a = 0
        self.pc = 0
        self.psw = 0               # C AC F0 BS . S2 S1 S0 (il bit 3 non e' memorizzato)
        self.f1 = 0
        self.a11 = 0               # 0x000 oppure 0x800 (SEL MB0 / MB1)
        self.ram = bytearray(64)
        self.timer = 0
        self.prescaler = 0
        self.timer_en = 0          # modo timer (STRT T)
        self.counter_en = 0        # modo contatore su T1 (STRT CNT)
        self.tf = 0
        self.tirq_en = 0
        self.xirq_en = 0
        self.in_progress = 0
        self.timer_pend = 0
        self.p1 = 0xFF
        self.p2 = 0xFF
        self.bus = 0xFF
        self.exp = [0, 0, 0, 0]    # latch dell'espansore P4..P7 (valore a 4 bit)
        self.now = 0
        self.t1_prev = 0
        self.halted = False

    # ----------------------------------------------------------------- utilita'
    def R(self, n):
        return self.ram[(24 if self.psw & B_FLAG else 0) + n]

    def setR(self, n, v):
        self.ram[(24 if self.psw & B_FLAG else 0) + n] = v & 0xFF

    def ir(self, a):
        return self.ram[a & 0x3F]

    def iw(self, a, v):
        self.ram[a & 0x3F] = v & 0xFF

    def fetch(self):
        v = self.env.prog[self.pc]
        self.pc = ((self.pc + 1) & 0x7FF) | (self.pc & 0x800)
        return v

    def push(self):
        sp = self.psw & 7
        self.ram[8 + 2 * sp] = self.pc & 0xFF
        self.ram[9 + 2 * sp] = ((self.pc >> 8) & 0x0F) | (self.psw & 0xF0)
        self.psw = (self.psw & 0xF8) | ((sp + 1) & 7)

    def pull(self, restore_psw):
        sp = (self.psw - 1) & 7
        lo = self.ram[8 + 2 * sp]
        hi = self.ram[9 + 2 * sp]
        pc = lo | (hi << 8)
        if restore_psw:
            self.psw = (hi & 0xF0) | sp
        else:
            self.psw = (self.psw & 0xF0) | sp
        self.pc = pc & (0x7FF if self.in_progress else 0xFFF)

    def jmp(self, addr11):
        self.pc = addr11 | (0 if self.in_progress else self.a11)

    def jcc(self, cond):
        page = self.pc & 0xF00
        off = self.fetch()
        if cond:
            self.pc = page | off

    # ------------------------------------------------------------------- tempo
    def burn(self, n):
        self.now += n
        if self.timer_en:
            self.prescaler += n
            ticks = self.prescaler >> 5
            self.prescaler &= 31
            for _ in range(ticks):
                self.timer = (self.timer + 1) & 0xFF
                if self.timer == 0:
                    self.overflow()

    def overflow(self):
        self.tf = 1
        if self.tirq_en:
            self.timer_pend = 1

    def apply_events(self):
        env = self.env
        while env.ev_i < len(env.events) and env.events[env.ev_i][0] <= self.now:
            _, i, t0, t1, p1, p2, bus = env.events[env.ev_i]
            env.ev_i += 1
            env.int_active, env.t0 = i, t0
            env.p1_pin, env.p2_pin, env.bus_pin = p1, p2, bus
            if self.counter_en and self.t1_prev == 1 and t1 == 0:      # fronte di discesa di T1
                self.timer = (self.timer + 1) & 0xFF
                if self.timer == 0:
                    self.overflow()
            env.t1 = t1
            self.t1_prev = t1

    def check_irqs(self):
        """Ritorna True se e' scattato un interrupt."""
        if self.in_progress:
            return False
        if self.env.int_active and self.xirq_en:
            self.in_progress = 1
            self.push()
            self.pc = 3
            self.burn(2)
            return True
        if self.timer_pend and self.tirq_en:
            self.in_progress = 1
            self.push()
            self.pc = 7
            self.timer_pend = 0
            self.burn(2)
            return True
        return False

    # ------------------------------------------------------------ istruzioni
    def add(self, x, cin=0):
        a = self.a
        t = a + x + cin
        t4 = (a & 15) + (x & 15) + cin
        self.psw &= ~(C_FLAG | A_FLAG)
        if t4 > 15:
            self.psw |= A_FLAG
        if t > 255:
            self.psw |= C_FLAG
        self.a = t & 0xFF

    def expander(self, op, port):
        # op: 0 lettura, 1 scrittura, 2 ORLD, 3 ANLD (come MAME)
        # codice sul nibble basso di P2: lettura 0, scrittura 1, OR 2, AND 3 (bit 3-2), porta (bit 1-0)
        self.p2 = (self.p2 & 0xF0) | (op << 2) | (port & 3)
        if op == 0:
            self.p2 |= 0x0F
            self.a = self.exp[port & 3] & 0x0F
        else:
            if op == 1:
                self.exp[port & 3] = self.a & 0x0F
            elif op == 2:
                self.exp[port & 3] |= self.a & 0x0F
            else:
                self.exp[port & 3] &= self.a & 0x0F
            self.p2 = (self.p2 & 0xF0) | (self.a & 0x0F)

    def execute(self, op):
        env = self.env
        r = op & 7
        if op in ILLEGAL or op == 0x00:
            return
        # --- famiglie con registro (xx + n)
        hi5 = op & 0xF8
        if hi5 == 0x18:                                   # INC Rn
            self.setR(r, self.R(r) + 1); return
        if hi5 == 0x28:                                   # XCH A,Rn
            t = self.R(r); self.setR(r, self.a); self.a = t; return
        if hi5 == 0x48:                                   # ORL A,Rn
            self.a |= self.R(r); return
        if hi5 == 0x58:                                   # ANL A,Rn
            self.a &= self.R(r); return
        if hi5 == 0x68:                                   # ADD A,Rn
            self.add(self.R(r)); return
        if hi5 == 0x78:                                   # ADDC A,Rn
            self.add(self.R(r), 1 if self.psw & C_FLAG else 0); return
        if hi5 == 0xA8:                                   # MOV Rn,A
            self.setR(r, self.a); return
        if hi5 == 0xB8:                                   # MOV Rn,#n
            self.setR(r, self.fetch()); return
        if hi5 == 0xC8:                                   # DEC Rn
            self.setR(r, self.R(r) - 1); return
        if hi5 == 0xD8:                                   # XRL A,Rn
            self.a ^= self.R(r); return
        if hi5 == 0xE8:                                   # DJNZ Rn,addr
            v = (self.R(r) - 1) & 0xFF
            self.setR(r, v)
            self.jcc(v != 0); return
        if hi5 == 0xF8:                                   # MOV A,Rn
            self.a = self.R(r); return
        # --- JMP / CALL
        if (op & 0x1F) == 0x04:
            self.jmp(((op & 0xE0) << 3) | self.fetch()); return
        if (op & 0x1F) == 0x14:
            addr = ((op & 0xE0) << 3) | self.fetch()
            self.push()
            self.jmp(addr); return
        # --- salti condizionali
        cj = {0x12: lambda: self.a & 0x01, 0x32: lambda: self.a & 0x02, 0x52: lambda: self.a & 0x04,
              0x72: lambda: self.a & 0x08, 0x92: lambda: self.a & 0x10, 0xB2: lambda: self.a & 0x20,
              0xD2: lambda: self.a & 0x40, 0xF2: lambda: self.a & 0x80,
              0x26: lambda: not env.t0, 0x36: lambda: env.t0, 0x46: lambda: not env.t1,
              0x56: lambda: env.t1, 0x76: lambda: self.f1, 0x86: lambda: env.int_active,
              0x96: lambda: self.a != 0, 0xB6: lambda: self.psw & F_FLAG, 0xC6: lambda: self.a == 0,
              0xE6: lambda: not (self.psw & C_FLAG), 0xF6: lambda: self.psw & C_FLAG}
        if op in cj:
            self.jcc(bool(cj[op]())); return
        if op == 0x16:                                    # JTF
            cond = self.tf
            self.tf = 0
            self.jcc(bool(cond)); return
        # --- il resto: istruzioni singole
        m = {
            0x02: self.i_outl_bus, 0x03: self.i_add_n, 0x05: self.i_en_i, 0x07: self.i_dec_a,
            0x08: self.i_ins_bus, 0x09: self.i_in_p1, 0x0A: self.i_in_p2, 0x10: self.i_inc_r0,
            0x11: self.i_inc_r1, 0x13: self.i_addc_n, 0x15: self.i_dis_i, 0x17: self.i_inc_a,
            0x20: self.i_xch_r0, 0x21: self.i_xch_r1, 0x23: self.i_mov_a_n, 0x25: self.i_en_tcnti,
            0x27: self.i_clr_a, 0x30: self.i_xchd_r0, 0x31: self.i_xchd_r1, 0x35: self.i_dis_tcnti,
            0x37: self.i_cpl_a, 0x39: self.i_outl_p1, 0x3A: self.i_outl_p2, 0x40: self.i_orl_r0,
            0x41: self.i_orl_r1, 0x42: self.i_mov_a_t, 0x43: self.i_orl_n, 0x45: self.i_strt_cnt,
            0x47: self.i_swap, 0x50: self.i_anl_r0, 0x51: self.i_anl_r1, 0x53: self.i_anl_n,
            0x55: self.i_strt_t, 0x57: self.i_da, 0x60: self.i_add_r0, 0x61: self.i_add_r1,
            0x62: self.i_mov_t_a, 0x65: self.i_stop_tcnt, 0x67: self.i_rrc, 0x70: self.i_addc_r0,
            0x71: self.i_addc_r1, 0x75: self.i_nop, 0x77: self.i_rr, 0x80: self.i_movx_r0,
            0x81: self.i_movx_r1, 0x83: self.i_ret, 0x85: self.i_clr_f0, 0x88: self.i_orl_bus,
            0x89: self.i_orl_p1, 0x8A: self.i_orl_p2, 0x90: self.i_movx_w0, 0x91: self.i_movx_w1,
            0x93: self.i_retr, 0x95: self.i_cpl_f0, 0x97: self.i_clr_c, 0x98: self.i_anl_bus,
            0x99: self.i_anl_p1, 0x9A: self.i_anl_p2, 0xA0: self.i_mov_r0_a, 0xA1: self.i_mov_r1_a,
            0xA3: self.i_movp, 0xA5: self.i_clr_f1, 0xA7: self.i_cpl_c, 0xB0: self.i_mov_r0_n,
            0xB1: self.i_mov_r1_n, 0xB3: self.i_jmpp, 0xB5: self.i_cpl_f1, 0xC5: self.i_sel_rb0,
            0xC7: self.i_mov_a_psw, 0xD0: self.i_xrl_r0, 0xD1: self.i_xrl_r1, 0xD3: self.i_xrl_n,
            0xD5: self.i_sel_rb1, 0xD7: self.i_mov_psw_a, 0xE3: self.i_movp3, 0xE5: self.i_sel_mb0,
            0xE7: self.i_rl, 0xF0: self.i_mov_a_r0, 0xF1: self.i_mov_a_r1, 0xF5: self.i_sel_mb1,
            0xF7: self.i_rlc,
        }
        if op in m:
            m[op](); return
        if 0x0C <= op <= 0x0F:
            self.expander(0, 4 + (op & 3)); return
        if 0x3C <= op <= 0x3F:
            self.expander(1, 4 + (op & 3)); return
        if 0x8C <= op <= 0x8F:
            self.expander(2, 4 + (op & 3)); return
        if 0x9C <= op <= 0x9F:
            self.expander(3, 4 + (op & 3)); return
        raise AssertionError("opcode non gestito %02X" % op)

    # singole istruzioni (nomi corti: le tabelle sopra le collegano)
    def i_nop(self): pass
    def i_outl_bus(self): self.bus = self.a
    def i_add_n(self): self.add(self.fetch())
    def i_addc_n(self): self.add(self.fetch(), 1 if self.psw & C_FLAG else 0)
    def i_add_r0(self): self.add(self.ir(self.R(0)))
    def i_add_r1(self): self.add(self.ir(self.R(1)))
    def i_addc_r0(self): self.add(self.ir(self.R(0)), 1 if self.psw & C_FLAG else 0)
    def i_addc_r1(self): self.add(self.ir(self.R(1)), 1 if self.psw & C_FLAG else 0)
    def i_en_i(self): self.xirq_en = 1
    def i_dis_i(self): self.xirq_en = 0
    def i_en_tcnti(self): self.tirq_en = 1
    def i_dis_tcnti(self):
        self.tirq_en = 0
        self.timer_pend = 0
    def i_dec_a(self): self.a = (self.a - 1) & 0xFF
    def i_inc_a(self): self.a = (self.a + 1) & 0xFF
    def i_clr_a(self): self.a = 0
    def i_cpl_a(self): self.a ^= 0xFF
    def i_ins_bus(self): self.a = self.env.bus_pin
    def i_in_p1(self): self.a = self.env.p1_pin & self.p1
    def i_in_p2(self): self.a = self.env.p2_pin & self.p2
    def i_inc_r0(self): self.iw(self.R(0), self.ir(self.R(0)) + 1)
    def i_inc_r1(self): self.iw(self.R(1), self.ir(self.R(1)) + 1)
    def i_xch_r0(self):
        t = self.ir(self.R(0)); self.iw(self.R(0), self.a); self.a = t
    def i_xch_r1(self):
        t = self.ir(self.R(1)); self.iw(self.R(1), self.a); self.a = t
    def i_xchd_r0(self):
        t = self.ir(self.R(0)); self.iw(self.R(0), (t & 0xF0) | (self.a & 0x0F)); self.a = (self.a & 0xF0) | (t & 0x0F)
    def i_xchd_r1(self):
        t = self.ir(self.R(1)); self.iw(self.R(1), (t & 0xF0) | (self.a & 0x0F)); self.a = (self.a & 0xF0) | (t & 0x0F)
    def i_mov_a_n(self): self.a = self.fetch()
    def i_outl_p1(self): self.p1 = self.a
    def i_outl_p2(self): self.p2 = self.a
    def i_orl_r0(self): self.a |= self.ir(self.R(0))
    def i_orl_r1(self): self.a |= self.ir(self.R(1))
    def i_orl_n(self): self.a |= self.fetch()
    def i_anl_r0(self): self.a &= self.ir(self.R(0))
    def i_anl_r1(self): self.a &= self.ir(self.R(1))
    def i_anl_n(self): self.a &= self.fetch()
    def i_xrl_r0(self): self.a ^= self.ir(self.R(0))
    def i_xrl_r1(self): self.a ^= self.ir(self.R(1))
    def i_xrl_n(self): self.a ^= self.fetch()
    def i_mov_a_t(self): self.a = self.timer
    def i_mov_t_a(self): self.timer = self.a
    def i_strt_t(self):
        self.timer_en = 1
        self.counter_en = 0
        self.prescaler = 0
    def i_strt_cnt(self):
        if not self.counter_en:
            self.t1_prev = self.env.t1
        self.counter_en = 1
        self.timer_en = 0
    def i_stop_tcnt(self):
        self.timer_en = 0
        self.counter_en = 0
    def i_swap(self): self.a = ((self.a << 4) | (self.a >> 4)) & 0xFF
    def i_da(self):
        if (self.a & 0x0F) > 9 or (self.psw & A_FLAG):
            if self.a > 0xF9:
                self.psw |= C_FLAG
            self.a = (self.a + 6) & 0xFF
        if (self.a & 0xF0) > 0x90 or (self.psw & C_FLAG):
            self.a = (self.a + 0x60) & 0xFF
            self.psw |= C_FLAG
    def i_rrc(self):
        c = self.a & 1
        self.a = (self.a >> 1) | (0x80 if self.psw & C_FLAG else 0)
        self.psw = (self.psw & ~C_FLAG) | (C_FLAG if c else 0)
    def i_rlc(self):
        c = self.a >> 7
        self.a = ((self.a << 1) & 0xFF) | (1 if self.psw & C_FLAG else 0)
        self.psw = (self.psw & ~C_FLAG) | (C_FLAG if c else 0)
    def i_rr(self): self.a = (self.a >> 1) | ((self.a & 1) << 7)
    def i_rl(self): self.a = ((self.a << 1) & 0xFF) | (self.a >> 7)
    def i_movx_r0(self): self.a = self.env.movx_r(self.R(0))
    def i_movx_r1(self): self.a = self.env.movx_r(self.R(1))
    def i_movx_w0(self): self.env.movx_w(self.R(0), self.a)
    def i_movx_w1(self): self.env.movx_w(self.R(1), self.a)
    def i_ret(self): self.pull(False)
    def i_retr(self):
        self.in_progress = 0
        self.pull(True)
    def i_clr_f0(self): self.psw &= ~F_FLAG
    def i_cpl_f0(self): self.psw ^= F_FLAG
    def i_clr_f1(self): self.f1 = 0
    def i_cpl_f1(self): self.f1 ^= 1
    def i_clr_c(self): self.psw &= ~C_FLAG
    def i_cpl_c(self): self.psw ^= C_FLAG
    def i_orl_bus(self): self.bus = self.env.bus_pin | self.fetch()
    def i_anl_bus(self): self.bus = self.env.bus_pin & self.fetch()
    def i_orl_p1(self): self.p1 |= self.fetch()
    def i_anl_p1(self): self.p1 &= self.fetch()
    def i_orl_p2(self): self.p2 |= self.fetch()
    def i_anl_p2(self): self.p2 &= self.fetch()
    def i_mov_r0_a(self): self.iw(self.R(0), self.a)
    def i_mov_r1_a(self): self.iw(self.R(1), self.a)
    def i_mov_r0_n(self): self.iw(self.R(0), self.fetch())
    def i_mov_r1_n(self): self.iw(self.R(1), self.fetch())
    def i_mov_a_r0(self): self.a = self.ir(self.R(0))
    def i_mov_a_r1(self): self.a = self.ir(self.R(1))
    def i_movp(self): self.a = self.env.prog[(self.pc & 0xF00) | self.a]
    def i_movp3(self): self.a = self.env.prog[0x300 | self.a]
    def i_jmpp(self):
        page = self.pc & 0xF00
        self.pc = page | self.env.prog[page | self.a]
    def i_sel_rb0(self): self.psw &= ~B_FLAG
    def i_sel_rb1(self): self.psw |= B_FLAG
    def i_sel_mb0(self): self.a11 = 0
    def i_sel_mb1(self): self.a11 = 0x800
    def i_mov_a_psw(self): self.a = self.psw | 0x08
    def i_mov_psw_a(self): self.psw = self.a & 0xF7

    # --------------------------------------------------------------- un passo
    def boundary(self):
        """Confine fra istruzioni: eventi dell'ambiente e interrupt."""
        self.apply_events()
        if self.check_irqs():
            self.apply_events()         # gli eventi scaduti durante i 2 cicli dell'ingresso valgono prima della prima istruzione

    def step(self):
        """Esegue il confine + una istruzione. Ritorna (opcode, cicli)."""
        self.boundary()
        op = self.fetch()
        cyc = op_cycles(op)
        self.execute(op)
        self.burn(cyc)
        return op, cyc

    def snapshot(self):
        """Stato al confine (dopo eventi e interrupt, prima del fetch): per il confronto con il nucleo Z80."""
        return (self.pc, self.a, self.psw, self.flags2(), self.timer, self.p1, self.p2, self.now & 0xFFFF)

    def flags2(self):
        """16 bit: bit0 F1, 1 MB1, 2 EN I, 3 EN TCNTI, 4 interrupt in corso, 5 TF, 6 overflow in attesa,
        7 modo timer, 8 modo contatore."""
        return (self.f1 | (1 if self.a11 else 0) << 1 | self.xirq_en << 2 | self.tirq_en << 3 |
                self.in_progress << 4 | self.tf << 5 | self.timer_pend << 6 | self.timer_en << 7 |
                self.counter_en << 8)


if __name__ == "__main__":
    sys.exit("modulo di libreria: vedi test_ref8048.py")
