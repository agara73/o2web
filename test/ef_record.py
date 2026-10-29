#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""ef_record.py - prova CASUALE della coppia EF9340/41 (tappa 5): registra con il riferimento hw/ef934x_ref.py sequenze casuali di
accessi MOVX (comandi, dati, letture, modi fetta), di quadri e di linee di resa, di mixer e di collisioni CX, con ROM e memoria
casuali. test/ef_run.js rigioca tutto su src/ef934x.js e confronta. Uso: python3 -I test/ef_record.py FILE.json [--cases N] [--seed S]
(il riferimento prova che il JavaScript lo riproduce, NON che il riferimento sia fedele all'hardware: tutto e' DA VERIFICARE)"""
import argparse
import json
import os
import random
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import ef934x_ref as ef  # noqa: E402


def crc(vals):
    return zlib.crc32(bytes(vals))


def rnd_attr(rng):
    q = rng.random()
    if q < 0.25:
        return rng.randrange(256)
    if q < 0.5:
        return rng.randrange(0x80)           # alfanumerico
    if q < 0.65:
        return rng.randrange(0x80, 0x100)    # grafico
    return rng.choice([0x07, 0x17, 0x27, 0x37, 0x47, 0x0F, 0x1F, 0x2F, 0x87, 0x8F, 0x71, 0x65, 0xF2])


def rnd_code(rng):
    q = rng.random()
    if q < 0.08:
        return rng.choice([0x7F, 0x80, 0x9F, 0xA0, 0xA1, 0xFF])
    if q < 0.3:
        return rng.randrange(0x80, 0xA0)     # delimitatori (i bit 0 e 2 scelgono cancellazione e sottolineatura)
    if q < 0.45:
        return rng.randrange(0xA0, 0x100)    # memoria estesa
    return rng.randrange(0x80)


def make_case(rng, nops):
    rom = bytes(rng.randrange(256) for _ in range(ef.ROM_SIZE))
    ox = rng.choice([15, 15, 0, 7, 40])
    oy = rng.choice([5, 5, 0, 3])
    m = ef.EFPair(rom, ox, oy)
    ops = []
    last_ef = None
    tl = 0

    def acc(addr, data, write):
        r = m.access(addr, data, write)
        ops.append(["a", addr, data, 1 if write else 0, r])

    def cmd(op, ta):
        acc(2 | 0, ta, True)           # comando, TA
        acc(2 | 1, op << 5 | rng.randrange(32), True)   # comando, TB

    # letture iniziali dei registri a riposo (TA, TB, comando, dato, memoria): rivelano i valori di reset
    for a_ in (4, 5, 6, 7, 4, 5):
        acc(a_, 0, False)
    if rng.random() < 0.7:
        cmd(5, rng.choice([0x49, 0x59, 0x01, 0x41, 0xC9, 0x7D, 0x4B, 0x5B, 0x5F, 0xDF, rng.randrange(256)]))
    else:                               # senza caricare R: resa e dati subito dopo il reset
        for _k in range(rng.randrange(0, 4)):
            acc(1, rnd_code(rng), True)
        for tl_ in range(rng.randrange(0, 3)):
            ops.append(["l", tl_, crc(m.render_line(tl_))])
        m.reset()
        ops.append(["z"])
    for _ in range(nops):
        q = rng.random()
        if q < 0.08:
            cmd(5, rng.choice([0x49, 0x59, 0x41, 0xC9, 0xD9, 0xFD, 0x4B, 0x5B, 0x5F, 0xDB, 0xDF, rng.randrange(256)]))
        elif q < 0.14:
            cmd(4, rng.choice([0x00, 0x40, 0x80, 0x20, 0x60, 0xA0, rng.randrange(256), 0x80 | rng.randrange(10), 0xA0 | rng.randrange(10)]))
        elif q < 0.20:
            op_ = rng.choice([0, 1, 2, 6])
            ta_ = rng.randrange(64)
            if op_ == 6 and rng.random() < 0.5:
                ta_ |= 0x20                      # zoom
            if op_ == 1 and rng.random() < 0.6:
                ta_ = rng.choice([22, 23, 23, 24, 25, 30, 31, 31, 32, 33, 63])
            elif op_ == 2 and rng.random() < 0.6:
                ta_ = rng.choice([31, 32, 33, 38, 39, 40, 47, 48, 55, 56, 63])
            cmd(op_, ta_)
        elif q < 0.22:
            cmd(3, 0)
        elif q < 0.24:
            cmd(7, rng.randrange(256))
        elif q < 0.55:
            # coppia di dati: TA poi TB (scrittura di cella o di fetta)
            if rng.random() < 0.12:     # raffica di scritture consecutive (il cursore scorre fino ai bordi)
                for _k in range(rng.choice([rng.randrange(20, 90), rng.randrange(60, 220)])):
                    acc(0, rnd_attr(rng), True)
                    acc(1, rnd_code(rng), True)
            acc(0, rnd_attr(rng), True)
            acc(1, rnd_code(rng) if rng.random() < 0.7 else rng.randrange(256), True)
        elif q < 0.65:
            acc(4 | 0, 0, False)
            acc(4 | 1, 0, False)
        elif q < 0.68:
            acc(4 | 2, 0, False)
            acc(4 | 3, 0, False)
        elif q < 0.70:
            acc(rng.randrange(256), rng.randrange(256), rng.random() < 0.5)
        elif q < 0.72:
            m.frame_tick()
            ops.append(["f"])
        elif q < 0.74 and rng.random() < 0.5:
            for _k in range(rng.randrange(1, 70)):
                m.frame_tick()
                ops.append(["f"])
        elif q < 0.90:
            # una o piu' linee in ordine
            n = rng.choice([1, 1, 5, 10, 30, 30, 262]) if rng.random() < 0.9 else 262
            for _k in range(n):
                if tl >= 262:
                    tl = 0
                line = m.render_line(tl)
                last_ef = line
                ops.append(["l", tl, crc(line)])
                tl += 1
        else:
            fb = [rng.randrange(16) for _ in range(360)]
            use_ef = last_ef if (last_ef is not None and rng.random() < 0.85) else None
            mix8 = rng.choice([0xFF, 0x00, rng.randrange(256)])
            mixef = rng.choice([0xFF, 0x00, rng.randrange(256)])
            cb = rng.random() < 0.5
            lum = rng.random() < 0.5
            ox2 = rng.choice([m.offset_x, rng.randrange(0, 60)])
            out, cx = ef.mix_line(fb, use_ef, ox2, mix8, mixef, cb, lum)
            cmap = [rng.choice([0, 0, 0, 1, 2, 4, 8, 0x10, 0x20, 0x40, 0x80, rng.randrange(256)]) for _ in range(360)]
            cm = rng.choice([0x40, 0x00, 0xFF, rng.randrange(256)])
            st, hit = ef.cx_collisions(cmap, cx, cm)
            ops.append(["x", bytes(fb).hex(), None if use_ef is None else bytes(use_ef).hex(), mix8, mixef, int(cb), int(lum), ox2,
                        bytes(cmap).hex(), cm, crc(out), crc(cx), st, int(hit)])
    final = {
        "ta": m.ta, "tb": m.tb, "x": m.x, "y": m.y, "y0": m.y0, "m": m.m, "r": m.r, "parity": m.parity,
        "pre": m.fl_prescaler, "ph": m.fl_phase, "crcA": crc(m.ram_a), "crcB": crc(m.ram_b), "crcX": crc(m.exram),
    }
    return {"rom": rom.hex(), "ox": ox, "oy": oy, "ops": ops, "final": final}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--cases", type=int, default=60)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--ops", type=int, default=400)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    cases = [make_case(rng, a.ops) for _ in range(a.cases)]
    data = json.dumps(cases)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(data)
    if os.path.getsize(a.out) == 0:
        raise SystemExit("file vuoto")
    nl = sum(1 for c in cases for o in c["ops"] if o[0] == "l")
    nx = sum(1 for c in cases for o in c["ops"] if o[0] == "x")
    print("%d casi, %d linee, %d mixer, %d KB" % (len(cases), nl, nx, os.path.getsize(a.out) // 1024))


main()
