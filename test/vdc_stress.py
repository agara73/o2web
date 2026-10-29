#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""vdc_stress.py - prova CASUALE del chip video: registra con il modello per riga (hw/o2line.py, LineVdc) sequenze casuali di
scritture/letture dei registri a istanti casuali (scritture a meta' fotogramma, set di caratteri casuale, PAL e NTSC) e salva,
per ogni evento video, (indice, collisioni, crc32 della riga) e il valore di ogni lettura. test/vdc_stress.js rigioca le stesse
sequenze sul chip video JavaScript (src/vdc.js) e confronta tutto.
Tappa 3: si confrontano anche gli eventi di suono (registro a scorrimento, prescaler, interrupt del suono): ogni caso registra il log
(ciclo, livello di uscita) e lo stato finale del suono; i casi "di suono" (make_sound_case) stressano 0xA7-0xAA e il bit 2 di 0xA0.
Uso: python3 -I test/vdc_stress.py FILE.json [--cases N] [--seed S] [--frames F] [--sound N]"""
import argparse
import json
import os
import random
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import o2line  # noqa: E402


def rnd_off(rng):
    q = rng.random()
    if q < 0.40:
        return rng.randrange(0x00, 0x80)
    if q < 0.60:
        return rng.randrange(0xC0, 0xF0)
    if q < 0.80:
        return rng.randrange(0xA0, 0xB0)
    return rng.randrange(0, 256)


def rnd_data(rng, off, cen=None, nodraw=False):
    # cen = (cy, cx, raggio): i byte di posizione (y, x) cadono spesso in una zona stretta, cosi' gli oggetti si sovrappongono
    if cen and off < 0x80 and (off & 3) in (0, 1) and rng.random() < 0.85:
        return max(0, min(255, cen[off & 3] + rng.randrange(-cen[2], cen[2] + 1)))
    if off == 0xA2:
        # maschera delle collisioni: spesso con molti bit (i controlli sui pixel adiacenti e sulla griglia dipendono da essa)
        return rng.choice([0xFF, 0xFF, 0x3F, 0xB0, 0x30, 0x80, 0x0F, 0xF0, rng.getrandbits(8)])
    if off == 0xA0 and nodraw:
        return rng.getrandbits(8) & 0xDF                  # bit 5 = 0: le letture dei registri 0x00-0x7F restituiscono i valori veri
    if off == 0xA0:
        # controllo: griglia, caratteri/sprite abilitati, ecc.; bit 5 spesso 1 (altrimenti non si disegna nulla)
        return (rng.getrandbits(8) & 0xDF) | (0x20 if rng.random() < 0.85 else 0)
    q = rng.random()
    if q < 0.5:
        return rng.randrange(0, 0x80)
    return rng.getrandbits(8)


def make_case(rng, frames, idx):
    std = rng.choice(["PAL", "NTSC"])
    timing = o2line.NTSC if std == "NTSC" else o2line.PAL
    if rng.random() < 0.3:
        charset = bytes(o2line.own_charset())
    else:
        density = rng.choice([0.3, 0.6, 0.9])
        charset = bytes(rng.getrandbits(8) if rng.random() < density else 0 for _ in range(512))
    # centro della zona densa (y, x, raggio): a volte ai bordi (x vicino a 0 o a 200 = bordo destro, y vicino a 0x0E = limite NTSC o in basso)
    cy = rng.choice([rng.randrange(0x20, 0xB0), rng.randrange(0x08, 0x18), rng.randrange(0xC0, 0xF0)])
    cx = rng.choice([rng.randrange(0x20, 0xB0), rng.randrange(0, 12), rng.randrange(170, 205)])
    cen = (cy, cx, rng.choice([2, 6, 16, 40])) if rng.random() < 0.85 else None
    nodraw = rng.random() < 0.12                              # casi "di sola lettura": niente disegno, si leggono i registri
    clear = rng.choice([0.0, 0.0, 0.7])                       # dopo ogni operazione, probabilita' di leggere A2 (azzera le collisioni accumulate)
    v = o2line.LineVdc(charset, timing)
    v.line_log = []
    v.snd_log = []
    t = v.t
    total = int(frames * t.frame / t.dpc)
    ops, reads = [], []

    def advance(c):
        v.advance_to(c)

    cyc = 0
    # inizializzazione: tanti oggetti sullo schermo
    for _ in range(rng.randrange(40, 120)):
        off = rnd_off(rng)
        data = rnd_data(rng, off, cen, nodraw)
        advance(cyc)
        ops.append(["w", cyc, off, data])
        v.write(off, data, cyc)
        cyc += rng.randrange(1, 6)
    advance(cyc)
    ops.append(["w", cyc, 0xA0, (rng.getrandbits(8) & 0xDF) | 0x20])
    v.write(0xA0, ops[-1][3], cyc)
    while cyc < total:
        cyc += rng.randrange(1, 400)
        if cyc >= total:
            break
        advance(cyc)
        q = rng.random()
        if q < 0.70:
            off = rnd_off(rng)
            if nodraw and rng.random() < 0.4:
                off = rng.choice([0x00, 0x02, 0x03, 0x06, 0x0A, 0x0E, 0x0F, 0x10, 0x7F, 0x80, 0x9F, 0xA3, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xC0, 0xC9, 0xD0, 0xE0])
            data = rnd_data(rng, off, cen, nodraw)
            ops.append(["w", cyc, off, data])
            v.write(off, data, cyc)
        else:
            off = rng.choice([0xA1, 0xA2, 0xA4, 0xA5, rng.getrandbits(8), rng.getrandbits(8), rng.getrandbits(8), rng.getrandbits(8)])
            if nodraw and rng.random() < 0.85:
                off = rng.choice([0x00, 0x02, 0x03, 0x06, 0x0A, 0x0E, 0x0F, 0x10, 0x7F, 0x80, 0x9F, 0xA3, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xC0, 0xC9, 0xD0, 0xE0])
            val = v.read(off, cyc)
            ops.append(["r", cyc, off, val])
        if clear and rng.random() < clear:
            cyc += 1
            advance(cyc)
            ops.append(["r", cyc, 0xA2, v.read(0xA2, cyc)])
    advance(total)
    return {"std": std, "charset": charset.hex(), "total": total, "ops": ops, "events": v.line_log,
            "frame_done": v.frame_done, "regs": bytes(v.reg).hex(),
            "fb_crc": zlib.crc32(b"".join(bytes(r) for r in v.fb)), "snd": v.snd_log, "snd_state": v.snd_state()}


def make_sound_case(rng, frames):
    """Caso "di suono": niente disegno (0xA0 senza i bit 3 e 5), scritture casuali ai registri 0xA7-0xAA (anche agli specchi
    0xB7-0xBA) e a 0xA0 (bit 2 = interrupt del suono), letture di 0xA1 (azzera stato e /INT) e dei registri del suono. Prova il registro
    a scorrimento (frequenza, rumore, scrittura fra due scorrimenti), il prescaler, l'interrupt e il livello di uscita."""
    std = rng.choice(["PAL", "NTSC"])
    timing = o2line.NTSC if std == "NTSC" else o2line.PAL
    charset = bytes(512)
    v = o2line.LineVdc(charset, timing)
    v.line_log = []
    v.snd_log = []
    t = v.t
    total = int(frames * t.frame / t.dpc)
    ops = []
    pats = [0x00, 0xFF, 0x55, 0xAA, 0x0F, 0xF0, 0x01, 0x80]

    def w(cyc, off, data):
        v.advance_to(cyc)
        ops.append(["w", cyc, off, data])
        v.write(off, data, cyc)

    def r(cyc, off):
        v.advance_to(cyc)
        ops.append(["r", cyc, off, v.read(off, cyc)])

    cyc = 0
    w(cyc, 0xA0, rng.choice([0x00, 0x04, 0x04]))
    w(cyc, 0xAA, rng.choice([0x8F, 0xCF, 0xEF, 0xDF, 0xFF, 0x80]))
    for o in (0xA7, 0xA8, 0xA9):
        w(cyc, o, rng.choice(pats) if rng.random() < 0.6 else rng.getrandbits(8))
    while cyc < total:
        cyc += rng.choice([rng.randrange(1, 40), rng.randrange(20, 600), rng.randrange(300, 3000)])
        if cyc >= total:
            break
        q = rng.random()
        if q < 0.22:
            w(cyc, rng.choice([0xA7, 0xA8, 0xA9, 0xB7, 0xB8, 0xB9]), rng.choice(pats) if rng.random() < 0.5 else rng.getrandbits(8))
        elif q < 0.42:
            data = rng.getrandbits(8)
            if rng.random() < 0.7:
                data |= 0x80
            w(cyc, rng.choice([0xAA, 0xAA, 0xBA]), data)
        elif q < 0.52:
            w(cyc, rng.choice([0xA0, 0xB0]), rng.choice([0x00, 0x04, 0x04, 0x05, 0x01, 0x02, 0x06]))
        elif q < 0.80:
            r(cyc, rng.choice([0xA1, 0xA1, 0xB1]))
        elif q < 0.90:
            r(cyc, rng.choice([0xA7, 0xA8, 0xA9, 0xAA, 0xBA]))
        else:
            w(cyc, rng.choice([0xA6, 0xAB, 0xAC, 0xA3, 0xA2]), rng.getrandbits(8))
    v.advance_to(total)
    return {"std": std, "charset": charset.hex(), "total": total, "ops": ops, "events": v.line_log,
            "frame_done": v.frame_done, "regs": bytes(v.reg).hex(),
            "fb_crc": zlib.crc32(b"".join(bytes(r_) for r_ in v.fb)), "snd": v.snd_log, "snd_state": v.snd_state()}


def make_sweep_case(rng):
    """Caso "a scansione": barre della griglia, sprite e caratteri messi a un pixel di distanza gli uni dagli altri, A2 letto dopo OGNI
    riga (cosi' lo stato delle collisioni di ogni riga si vede da solo): prova il passo sui pixel adiacenti (sprite accanto a griglia,
    caratteri accanto a sprite e griglia), che le collisioni per sovrapposizione non coprono."""
    std = rng.choice(["PAL", "NTSC"])
    timing = o2line.NTSC if std == "NTSC" else o2line.PAL
    charset = bytes(rng.getrandbits(8) if rng.random() < 0.8 else 0 for _ in range(512))
    v = o2line.LineVdc(charset, timing)
    v.line_log = []
    v.snd_log = []
    ops = []

    def w(off, data, cyc=0):
        ops.append(["w", cyc, off, data])
        v.write(off, data, cyc)

    cyc = 0
    v.advance_to(cyc)                                           # la riga 0 (ciclo 0) si disegna PRIMA delle scritture, come nella rigiocata
    cm = rng.choice([0xFF, 0xFF, 0x30, 0xB0, 0x3F, 0x8F, 0x0F])
    ctl = 0x28 | rng.choice([0, 0x40, 0x80, 0xC0])
    w(0xA0, 0x00, cyc)                                          # con A0 = 0 le scritture a 0x00-0x7F e 0xC0-0xEF sono permesse
    w(0xA2, cm, cyc)
    w(0xA3, rng.getrandbits(8), cyc)
    cols = rng.sample(range(10), 3)
    for i in range(10):
        w(0xE0 + i, 0xFF if i in cols else (rng.getrandbits(8) if rng.random() < 0.3 else 0), cyc)
        if i < 9:
            w(0xC0 + i, rng.getrandbits(8), cyc)
            w(0xD0 + i, rng.getrandbits(8) & 1, cyc)
    for i in range(4):                                          # sprite: a un pixel dalle barre
        col = rng.choice(cols)
        y = rng.randrange(24, 90)
        w(4 * i, y, cyc)
        w(4 * i + 1, max(0, min(255, 10 + 16 * col + rng.randrange(-4, 5))), cyc)
        w(4 * i + 2, (rng.getrandbits(8) & 0xFB if rng.random() < 0.8 else rng.getrandbits(8)), cyc)
        for j in range(8):
            w(0x80 + 8 * i + j, rng.getrandbits(8) | (1 if rng.random() < 0.7 else 0), cyc)
    for i in range(12):                                         # caratteri singoli, vicino agli sprite e alle barre
        col = rng.choice(cols)
        w(0x10 + 4 * i, rng.randrange(24, 90), cyc)
        w(0x10 + 4 * i + 1, max(0, min(255, 10 + 16 * col + rng.randrange(-6, 7))), cyc)
        w(0x10 + 4 * i + 2, rng.getrandbits(8), cyc)
        w(0x10 + 4 * i + 3, rng.getrandbits(8), cyc)
    for g in range(4):                                          # gruppi da 4 caratteri
        w(0x40 + 16 * g, rng.randrange(24, 90), cyc)
        w(0x40 + 16 * g + 1, rng.randrange(0, 160), cyc)
        for j in range(4):
            w(0x40 + 16 * g + 4 * j + 2, rng.getrandbits(8), cyc)
            w(0x40 + 16 * g + 4 * j + 3, rng.getrandbits(8), cyc)
    w(0xA0, ctl, cyc)                                           # ora si blocca la scrittura e si abilitano griglia e oggetti
    while v.ev < 130:
        c = v.next_event_cycle() + 1
        v.advance_to(c)
        ops.append(["r", c, 0xA2, v.read(0xA2, c)])
    total = v.next_event_cycle()
    v.advance_to(total)
    return {"std": std, "charset": charset.hex(), "total": total, "ops": ops, "events": v.line_log,
            "frame_done": v.frame_done, "regs": bytes(v.reg).hex(), "fb_crc": zlib.crc32(b"".join(bytes(r) for r in v.fb)),
            "snd": v.snd_log, "snd_state": v.snd_state()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--cases", type=int, default=24)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--frames", type=float, default=2.2)
    ap.add_argument("--sweeps", type=int, default=60, help="casi 'a scansione' per il passo sui pixel adiacenti")
    ap.add_argument("--sound", type=int, default=60, help="casi 'di suono' (registro a scorrimento, rumore, interrupt del suono)")
    ap.add_argument("--sound-frames", type=float, default=5.0)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    cases = ([make_case(rng, a.frames, i) for i in range(a.cases)] + [make_sweep_case(rng) for _ in range(a.sweeps)] +
             [make_sound_case(rng, a.sound_frames) for _ in range(a.sound)])
    data = json.dumps(cases).encode("utf-8")
    with open(a.out, "wb") as f:
        f.write(data)
    assert os.path.getsize(a.out) > 0
    print("%d casi, %d eventi video, %d operazioni -> %s" % (len(cases), sum(len(c["events"]) for c in cases),
                                                           sum(len(c["ops"]) for c in cases), a.out))


if __name__ == "__main__":
    main()
