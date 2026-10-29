#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""replay.py - registra l'esecuzione di BIOS + cartuccia nel modello hardware di riferimento (hw/o2hw.py, riferimento CPU + console
con chip video, tastiera e joystick) e produce i file per la prova "registra e riproduci" del nucleo JavaScript (replay_run.js).

Per ogni scenario si salvano:
  <nome>.log   tutte le interazioni CPU <-> ambiente nell'ordine in cui avvengono: [tipo, argomento, valore, now, P1, P2] (6 x uint32)
               tipo: 1 /INT, 2 T0, 3 T1, 4 pin P1, 5 pin P2, 6 pin BUS, 7 MOVX lettura (argomento = indirizzo), 8 MOVX scrittura
  <nome>.dig   un hash a 32 bit dello stato della CPU dopo OGNI istruzione (uint32)
  <nome>.json  descrizione (BIOS, cartuccia, numero di istruzioni, cicli)
Il nucleo JS, con un ambiente che restituisce i valori registrati, deve chiedere le stesse cose nello stesso ordine, negli stessi
istanti e con gli stessi latch di porta, e arrivare agli stessi stati: cosi' si prova su codice vero, con le risposte vere
dell'hardware, senza dover modellare la console nel test.
Uso: python3 -I test/replay.py OUTDIR [--frames N]   (i dump si leggono da DUMPS, default ~/dumps)
"""
import argparse
import array
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import o2hw  # noqa: E402

DUMPS = os.environ.get("O2_DUMPS", "/home/claude/dumps")
SCENARIOS = [
    ("o2_blockout", "bios/o2rom.bin", "blockout.bin"),
    ("o2_killerbees", "bios/o2rom.bin", "killerbees.bin"),
    ("o2_pickaxepete", "bios/o2rom.bin", "pickaxepete.bin"),
    ("o2_demonattack", "bios/o2rom.bin", "demonattack.bin"),
    ("g7400_blockout", "bios/g7400.bin", "blockout.bin"),
]


def checksum(b):
    h = 0
    for x in b:
        h = (h * 31 + x + 1) & 0xFFFFFFFF
    return h


def hash_vec(v):
    h = 2166136261
    for x in v:
        h = ((h ^ (x & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    return h


def cpu_vec(cpu, op, cyc):
    return [op, cyc, cpu.pc, cpu.a, cpu.psw, int(cpu.f1), 1 if cpu.a11 else 0, cpu.timer, cpu.prescaler, int(cpu.tf),
            int(cpu.tirq_en), int(cpu.xirq_en), int(cpu.in_progress), int(cpu.timer_pend), int(cpu.timer_en),
            int(cpu.counter_en), cpu.p1, cpu.p2, cpu.bus, cpu.exp[0], cpu.exp[1], cpu.exp[2], cpu.exp[3], cpu.now,
            int(cpu.t1_prev), checksum(cpu.ram)]


class LoggedEnv(o2hw.O2Env):
    """Stesso ambiente del modello, con registro di ogni interazione (non cambia nessun risultato)."""

    def _log(self, kind, arg, val):
        c = self.cpu
        self.log.extend((kind, arg, val & 0xFFFFFFFF, c.now & 0xFFFFFFFF, c.p1, c.p2))

    def _prop(name, kind):
        base = getattr(o2hw.O2Env, name)

        def get(self):
            v = base.fget(self)
            self._log(kind, 0, int(v))
            return v

        def put(self, v):
            pass
        return property(get, put)

    int_active = _prop('int_active', 1)
    t0 = _prop('t0', 2)
    t1 = _prop('t1', 3)
    p1_pin = _prop('p1_pin', 4)
    p2_pin = _prop('p2_pin', 5)
    bus_pin = _prop('bus_pin', 6)

    def movx_r(self, a):
        v = super().movx_r(a)
        self._log(7, a & 0xFF, v)
        return v

    def movx_w(self, a, v):
        self._log(8, a & 0xFF, v & 0xFF)
        super().movx_w(a, v)


def record(name, bios, cart, outdir, frames):
    img = o2hw.load_image(os.path.join(DUMPS, bios), os.path.join(DUMPS, cart))[:4096]
    m = o2hw.Machine(img, o2hw.own_charset())
    m.env.__class__ = LoggedEnv
    m.env.log = array.array('I')
    dig = array.array('I')
    rng = random.Random(7)
    keys, cpu = m.keys, m.cpu
    cyc_frame = int(m.vdc.t.frame / m.vdc.t.dpc)
    release_at = -1
    for fr in range(frames):
        if fr == 30:                                    # un tasto qualsiasi: dal menu si passa alla cartuccia
            keys.rows[:] = [0x01] * 8
            release_at = 34
        if fr == release_at:
            keys.rows[:] = [0] * 8
        if fr > 40 and rng.random() < 0.15:             # joystick e tasti casuali
            keys.joy[0] = rng.getrandbits(5) if rng.random() < 0.7 else 0
            keys.joy[1] = rng.getrandbits(5) if rng.random() < 0.7 else 0
            if rng.random() < 0.3:
                keys.rows[:] = [0] * 8
                keys.rows[rng.randrange(8)] = 1 << rng.randrange(8)
            elif rng.random() < 0.5:
                keys.rows[:] = [0] * 8
        end = cpu.now + cyc_frame
        while cpu.now < end:
            op, cyc = m.step()
            dig.append(hash_vec(cpu_vec(cpu, op, cyc)))
    with open(os.path.join(outdir, name + '.log'), 'wb') as f:
        m.env.log.tofile(f)
    with open(os.path.join(outdir, name + '.dig'), 'wb') as f:
        dig.tofile(f)
    with open(os.path.join(outdir, name + '.json'), 'w') as f:
        json.dump({'name': name, 'bios': bios, 'cart': cart, 'steps': len(dig), 'cycles': cpu.now, 'frames': frames,
                   'calls': len(m.env.log) // 6}, f)
    for fn in (name + '.log', name + '.dig'):
        assert os.path.getsize(os.path.join(outdir, fn)) > 0
    print("%-16s %7d istruzioni, %8d cicli, %7d interazioni, PC finale %03X" % (name, len(dig), cpu.now, len(m.env.log) // 6, cpu.pc))


def record_live(outdir):
    """Riferimento per boot_menu.js (avvio dal vivo con la console minima): modello senza grafica ne' collisioni, tasto premuto
    ai fotogrammi 30-33, nessun altro ingresso; 100 fotogrammi. Salva solo i digest dello stato dopo ogni istruzione."""
    img = o2hw.load_image(os.path.join(DUMPS, "bios/o2rom.bin"), os.path.join(DUMPS, "blockout.bin"))[:4096]
    m = o2hw.Machine(img, o2hw.own_charset())
    m.vdc.render = False
    cpu = m.cpu
    cyc_frame = int(m.vdc.t.frame / m.vdc.t.dpc)
    dig = array.array('I')
    for fr in range(100):
        if fr == 30:
            m.keys.rows[:] = [0x01] * 8
        if fr == 34:
            m.keys.rows[:] = [0] * 8
        end = cpu.now + cyc_frame
        while cpu.now < end:
            op, cyc = m.step()
            dig.append(hash_vec(cpu_vec(cpu, op, cyc)))
    path = os.path.join(outdir, 'live_o2_blockout.dig')
    with open(path, 'wb') as f:
        dig.tofile(f)
    assert os.path.getsize(path) > 0
    print("live_o2_blockout %7d istruzioni (senza grafica)" % len(dig))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('outdir')
    ap.add_argument('--frames', type=int, default=150)
    ap.add_argument('--live', action='store_true', help="solo il riferimento per boot_menu.js")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    if a.live:
        record_live(a.outdir)
        return
    for name, bios, cart in SCENARIOS:
        record(name, bios, cart, a.outdir, a.frames)
    record_live(a.outdir)


if __name__ == '__main__':
    main()
