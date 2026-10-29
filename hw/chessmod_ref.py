#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""chessmod_ref.py - RIFERIMENTO (Python) del modulo scacchi Philips C7010 collegato alla console, per la tappa 6a.

E' l'oracolo di test/chess_run.js: stessa descrizione del bus e del tempo di src/chessmod.js e src/console.js, ma scritta a parte e con
altri mezzi: l'8048 e' il riferimento ref/ref8048.py (con l'ambiente di hw/o2hw.py), lo Z80 e' il pacchetto Python `z80` (kosarev 1.2.0, MIT,
SOLO in sviluppo), il tempo si calcola in modo assoluto (bersaglio = cicli * NUM / DEN, senza accumulatore) e il modulo si rifa da capo (nuova
macchina Z80) a ogni fronte del reset. Tenere uguale a src/chessmod.js e a console.js: se si cambia una regola, si cambia qui e li'.

Fatti sull'hardware (TUTTI DA VERIFICARE, vedi src/chessmod.js): mappa dello Z80 (ROM 0000-1FFF, RAM 2 KB a E000-FFFF con specchio, il resto
0xFF), una sola porta specchiata (IN = latch 1, OUT = latch 0), lato 8048: P1 bit 1 = reset (0 = in reset); latch visibili solo con P1 bit 0 = 0,
bit 3 = 1 e bit 4 = 0; lettura se (indirizzo & 0xA0) == 0xA0, scrittura se indirizzo & 0x80; rapporto di velocita' PAL 45/8, NTSC 17734475/2863636 (Z80 a meta' del quarzo da 4,43 MHz)
stati T dello Z80 per ciclo macchina dell'8048; dopo il reset lo Z80 ha AF = SP = 0xFFFF e il resto a 0.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import o2hw  # noqa: E402
import ref8048 as R  # noqa: E402

SPEED = {"PAL": (45, 8), "NTSC": (17734475, 2863636)}


class ChessRef:
    def __init__(self, z80lib, rom, std="PAL"):
        assert len(rom) == 0x2000
        self.z80 = z80lib
        self.rom = bytes(rom)
        self.ram = bytearray(0x800)
        self.num, self.den = SPEED[std]
        self.latch0 = 0
        self.latch1 = 0
        self.running = 0
        self.base = 0                      # tempo dello Z80 quando la macchina e' stata creata (la macchina parte da frame_tick = 0)
        self.acc = 0                       # T trascorsi dalla creazione della macchina (frame_tick si azzera ogni FRAME T: si accumula a mano)
        self.prev_ft = 0
        self.last_now = 0
        self.events = []                   # sequenza di eventi per il confronto
        self.m = self._machine()

    # ---- macchina Z80 (si rifa a ogni fronte del reset)
    def _machine(self):
        m = self.z80.Z80Machine()
        m.mark_addrs(0, 0x10000, m.READ_MARK | m.WRITE_MARK)
        m.set_read_callback(self._rd)
        m.set_write_callback(self._wr)
        m.set_input_callback(self._in)
        m.set_output_callback(self._out)
        m.af = 0xFFFF
        m.sp = 0xFFFF
        return m

    def _rd(self, a):
        a &= 0xFFFF
        if a < 0x2000:
            return self.rom[a]
        if a >= 0xE000:
            return self.ram[a & 0x7FF]
        return 0xFF

    def _wr(self, a, v):
        a &= 0xFFFF
        if a >= 0xE000:
            self.ram[a & 0x7FF] = v & 0xFF

    def _in(self, port):
        v = self.latch1
        self.events.append(("zI", port & 0xFFFF, v))
        return v

    def _out(self, port, v):
        self.latch0 = v & 0xFF
        self.events.append(("zO", port & 0xFFFF, v & 0xFF))

    FRAME = 100000                         # il pacchetto z80 azzera frame_tick (modulo) ogni 100000 T

    @property
    def z80_t(self):
        return self.base + self.acc

    def _step_z80(self):
        self.m.ticks_to_stop = 1
        self.m.run()
        ft = self.m.frame_tick
        self.acc += (ft - self.prev_ft) % self.FRAME
        self.prev_ft = ft

    # ---- lato console
    def gate(self, p1):
        return (p1 & 0x01) == 0 and (p1 & 0x08) != 0 and (p1 & 0x10) == 0

    def read8048(self, a, p1):
        v = self.latch0 if (self.gate(p1) and (a & 0xA0) == 0xA0) else 0xFF
        self.events.append(("R", a, p1, v))
        return v

    def write8048(self, a, v, p1):
        if self.gate(p1) and (a & 0x80):
            self.latch1 = v & 0xFF
        self.events.append(("W", a, v & 0xFF, p1))

    # ---- il tempo: `now` in cicli macchina dell'8048; p1 = valore di P1 dopo l'ultima istruzione
    def advance(self, now, p1):
        if now > self.last_now:
            self.last_now = now
        target = (self.last_now * self.num) // self.den        # assoluto: nessun accumulatore
        self.target = target
        if self.running:
            while self.z80_t < target:
                self._step_z80()
        run = 1 if (p1 & 0x02) else 0
        if run != self.running:
            self.m = self._machine()
            self.base = target
            self.acc = 0
            self.prev_ft = 0
            self.running = run
        elif not run:
            self.base = target - self.acc


class ChessEnv(o2hw.O2Env):
    def __init__(self, vdc, keys, prog, chess):
        super().__init__(vdc, keys, prog)
        self.chess = chess

    def movx_r(self, a):
        a &= 0xFF
        c = self.cpu
        self.chess.advance(c.now, c.p1)
        d = super().movx_r(a)
        return d & self.chess.read8048(a, c.p1)

    def movx_w(self, a, v):
        a &= 0xFF
        c = self.cpu
        self.chess.advance(c.now, c.p1)
        super().movx_w(a, v)
        self.chess.write8048(a, v & 0xFF, c.p1)


class ChessConsole:
    """8048 di riferimento + chip video + modulo scacchi; `image` = BIOS (1 KB) con la cartuccia (se c'e') a 0x400."""

    def __init__(self, z80lib, image, rom, std="PAL"):
        self.chess = ChessRef(z80lib, rom, std)
        self.vdc = o2hw.Vdc(bytes(512), o2hw.PAL if std == "PAL" else o2hw.NTSC)
        self.env = ChessEnv(self.vdc, o2hw.Keys(), image, self.chess)
        self.cpu = R.CPU(self.env)
        self.env.cpu = self.cpu

    def step(self):
        self.chess.advance(self.cpu.now, self.cpu.p1)       # confine fra istruzioni
        return self.cpu.step()

    def run_cycles(self, n):
        end = self.cpu.now + n
        while self.cpu.now < end:
            self.step()


def rle(events):
    out = []
    for e in events:
        if out and out[-1][0] == list(e):
            out[-1][1] += 1
        else:
            out.append([list(e), 1])
    return out
