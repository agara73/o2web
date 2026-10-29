# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""o2g7400.py - modello per riga del Videopac+ G7400 (tappa 5): la console di hw/o2line.py piu' la coppia EF9340/41 e il mixer di
hw/ef934x_ref.py. E' l'ORACOLO con cui si confronta la console JavaScript con g7400 = true (test/line_run.js). Tutto cio' che
riguarda l'EF9340/41, il mixer, il pin B e CX e' DA VERIFICARE (vedi la testata di ef934x_ref.py).

Collegamento (stesso della console JS): MOVX con P1 bit 5 = 0 -> EF9341; registri di mix = latch dell'8243: mix EF = P5 | P4 << 4, mix 8245
= P7 | P6 << 4 (il nibble basso e' della porta con il numero piu' alto: corretto il 15/10/2026); LUM = P1 bit 7 = 0; dopo ogni riga dell'8245 si mescola la riga con la linea EF (tl = riga - offset_y, quadro per quadro
con frame_tick a riga 0) e si aggiungono le collisioni CX (maschera 0xA2); un contatto con 0xA0 bit 4 alza il bit 6 dello stato e /INT."""
import os
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import ef934x_ref as ef  # noqa: E402
import o2line  # noqa: E402
from o2line import LineVdc, LineEnv, LineCPU, Keys, VIS_W, VIS_H  # noqa: E402


class G7400Vdc(LineVdc):
    def __init__(self, charset, timing, efpair, cart_b_high, machine):
        super().__init__(charset, timing)
        self.efp = efpair
        self.cart_b_high = cart_b_high
        self.machine = machine

    def event(self):
        k = self.ev
        self.ev += 1
        j = k % o2line.EV_PER_FRAME
        if j < VIS_H:
            st = self.render_line(j)
            st |= self.mix_row(j)
            self.col_status |= st & 0xFF
            if (st & 0x100) and (self.reg[0xA0] & 0x10):
                self.ctl_status |= 0x40
                self.irq = True
            if j == VIS_H - 1:
                self.frame_done += 1
            if self.line_log is not None:
                self.line_log.append((k, self.col_status, zlib.crc32(bytes(self.fb[j]))))
            return j
        self.ctl_status |= 0x08
        self.irq = True
        if self.line_log is not None:
            self.line_log.append((k, self.ctl_status | (0x100 if self.irq else 0), 0))
        return None

    def mix_row(self, j):
        e = self.efp
        cpu = self.machine.cpu
        if j == 0:
            e.frame_tick()
        tl = j - e.offset_y
        line = e.render_line(tl) if tl >= 0 else None
        x = cpu.exp
        out, cx = ef.mix_line(list(self.fb[j]), line, e.offset_x, x[3] | (x[2] << 4), x[1] | (x[0] << 4), self.cart_b_high,
                              not (cpu.p1 & 0x80))
        self.fb[j][:] = bytes(out)
        st, hit = ef.cx_collisions(self.last_cmap, cx, self.reg[0xA2])
        return st | (0x100 if hit else 0)


class G7400Env(LineEnv):
    def __init__(self, vdc, keys, bios, cart, efpair):
        super().__init__(vdc, keys, bios, cart)
        self.efp = efpair

    def movx_r(self, a):
        d = super().movx_r(a)
        if not (self.cpu.p1 & 0x20):
            d &= self.efp.access(a & 0xFF, 0, False)
        return d

    def movx_w(self, a, v):
        super().movx_w(a, v)
        if not (self.cpu.p1 & 0x20):
            self.efp.access(a & 0xFF, v & 0xFF, True)


class G7400Machine:
    def __init__(self, bios, cart, charset, efrom, cart_b_high=False, timing=o2line.PAL):
        self.efp = ef.EFPair(efrom)
        self.keys = Keys()
        self.vdc = G7400Vdc(charset, timing, self.efp, cart_b_high, self)
        self.env = G7400Env(self.vdc, self.keys, bios, cart, self.efp)
        self.cpu = LineCPU(self.env)
        self.env.cpu = self.cpu

    def step(self):
        return self.cpu.step()

    def frame_cycles(self):
        return int(self.vdc.t.frame / self.vdc.t.dpc)


if __name__ == "__main__":
    sys.exit("modulo di libreria: vedi test/line_record.py")
