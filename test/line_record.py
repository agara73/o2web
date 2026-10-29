#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""line_record.py - registra BIOS + cartuccia nel MODELLO PER RIGA (hw/o2line.py: riferimento CPU, console, video per riga,
T1 a fronti, banchi della cartuccia) per la prova "console JS contro modello" (line_run.js).

Per ogni scenario salva in OUTDIR:
  <nome>.dig    hash a 32 bit dello stato della CPU dopo OGNI istruzione (come test/replay.py)
  <nome>.lines  per ogni evento video: (indice evento, stato collisioni dopo la riga / stato+IRQ al vblank, crc32 della riga) x uint32
  <nome>.snd    (tappa 3) per ogni cambio del livello di uscita del suono: (ciclo, livello) x uint32
  <nome>.efrom  (solo scenari G7400, tappa 5) ROM di prova dei caratteri dell'EF9341
  <nome>.json   descrizione + ingressi (tastiera / joystick) fotogramma per fotogramma + impronta finale dello schermo e dei registri
Uso: python3 -I test/line_record.py OUTDIR [--frames N] [--only nome,nome]   (gli scenari la cui cartuccia manca si saltano)
I dump si cercano in $O2_DUMPS: bios/o2rom.bin, bios/g7400.bin e le cartucce elencate in SCENARIOS (cartelle `carts/...`).
"""
import argparse
import array
import json
import os
import random
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
sys.path.insert(0, HERE)
import o2line  # noqa: E402
import o2g7400  # noqa: E402
from replay import cpu_vec, hash_vec  # noqa: E402

DUMPS = os.environ.get("O2_DUMPS", "/home/claude/dumps/t1")
# (nome, bios, cartuccia, standard): le cartucce sono nella cartella dei dump (nomi corti scelti dall'utente)
SCENARIOS = json.load(open(os.path.join(HERE, "line_scenarios.json")))


def make_inputs(frames, seed):
    """Ingressi per fotogramma: tasto qualsiasi ai fotogrammi 30-33 (dal menu alla cartuccia), poi joystick e tasti casuali."""
    rng = random.Random(seed)
    rows, joy = [0] * 8, [0, 0]
    out = []
    for fr in range(frames):
        if fr == 30:
            rows = [0x01] * 8
        if fr == 34:
            rows = [0] * 8
        if fr > 40 and rng.random() < 0.15:
            joy = [rng.getrandbits(5) if rng.random() < 0.7 else 0, rng.getrandbits(5) if rng.random() < 0.7 else 0]
            if rng.random() < 0.3:
                rows = [0] * 8
                rows[rng.randrange(8)] = 1 << rng.randrange(8)
            elif rng.random() < 0.5:
                rows = [0] * 8
        out.append([list(rows), list(joy)])
    return out


def record(sc, outdir, frames):
    name = sc["name"]
    bios = open(os.path.join(DUMPS, sc["bios"]), "rb").read()
    cart = open(os.path.join(DUMPS, sc["cart"]), "rb").read() if sc["cart"] else b""
    timing = o2line.NTSC if sc.get("std") == "NTSC" else o2line.PAL
    efrom = None
    if sc.get("g7400"):
        # ROM dei caratteri dell'EF9341 di prova: pseudo-casuale e deterministica (solo per il confronto; salvata accanto allo scenario)
        efrom = bytes(random.Random(sc.get("seed", 7) + 1000).randrange(256) for _ in range(2560))
        with open(os.path.join(outdir, name + ".efrom"), "wb") as f:
            f.write(efrom)
        m = o2g7400.G7400Machine(bios, cart, o2line.own_charset(), efrom, bool(sc.get("pinB")), timing)
    else:
        m = o2line.LineMachine(bios, cart, o2line.own_charset(), timing)
    m.vdc.line_log = []
    m.vdc.snd_log = []
    inputs = make_inputs(frames, sc.get("seed", 7))
    dig = array.array("I")
    cpu = m.cpu
    fc = m.frame_cycles()
    for fr in range(frames):
        m.keys.rows[:] = inputs[fr][0]
        m.keys.joy[:] = inputs[fr][1]
        end = cpu.now + fc
        while cpu.now < end:
            op, cyc = m.step()
            dig.append(hash_vec(cpu_vec(cpu, op, cyc)))
    lines = array.array("I")
    for k, st, crc in m.vdc.line_log:
        lines.extend((k & 0xFFFFFFFF, st & 0xFFFFFFFF, crc & 0xFFFFFFFF))
    snd = array.array("I")
    for cyc, lvl in m.vdc.snd_log:
        snd.extend((cyc & 0xFFFFFFFF, lvl))
    with open(os.path.join(outdir, name + ".snd"), "wb") as f:
        snd.tofile(f)
    with open(os.path.join(outdir, name + ".dig"), "wb") as f:
        dig.tofile(f)
    with open(os.path.join(outdir, name + ".lines"), "wb") as f:
        lines.tofile(f)
    meta = {"name": name, "bios": sc["bios"], "cart": sc["cart"], "std": sc.get("std", "PAL"), "frames": frames,
            "steps": len(dig), "cycles": cpu.now, "events": len(lines) // 3, "inputs": inputs,
            "final_fb_crc": zlib.crc32(b"".join(bytes(r) for r in m.vdc.fb)), "final_regs": bytes(m.vdc.reg).hex(),
            "final_p1": cpu.p1, "g7400": bool(sc.get("g7400")), "pinB": bool(sc.get("pinB")), "frames_done": m.vdc.frame_done, "snd_changes": len(snd) // 2, "snd_state": m.vdc.snd_state()}
    if efrom is not None:
        e = m.efp
        crc = lambda b: zlib.crc32(bytes(b))  # noqa: E731
        meta["final_ef"] = {"ta": e.ta, "tb": e.tb, "x": e.x, "y": e.y, "y0": e.y0, "m": e.m, "r": e.r, "parity": e.parity,
                            "pre": e.fl_prescaler, "ph": e.fl_phase, "crcA": crc(e.ram_a), "crcB": crc(e.ram_b), "crcX": crc(e.exram)}
    with open(os.path.join(outdir, name + ".json"), "w") as f:
        json.dump(meta, f)
    for fn in (name + ".dig", name + ".lines", name + ".json"):
        assert os.path.getsize(os.path.join(outdir, fn)) > 0
    print("%-22s %7d istruzioni, %8d cicli, %6d eventi video, %5d cambi di suono, PC finale %03X, P1 %02X" % (
        name, len(dig), cpu.now, len(lines) // 3, len(snd) // 2, cpu.pc, cpu.p1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--frames", type=int, default=150)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    only = set(a.only.split(",")) if a.only else None
    done = 0
    for sc in SCENARIOS:
        if only and sc["name"] not in only:
            continue
        if (sc["cart"] and not os.path.exists(os.path.join(DUMPS, sc["cart"]))) or not os.path.exists(os.path.join(DUMPS, sc["bios"])):
            print("%-22s saltato: manca %s nella cartella dei dump" % (sc["name"], sc["cart"] or sc["bios"]))
            continue
        record(sc, a.outdir, sc.get("frames", a.frames))
        done += 1
    if not done:
        sys.exit("nessuno scenario registrato: controlla la cartella dei dump ($O2_DUMPS)")


if __name__ == "__main__":
    main()
