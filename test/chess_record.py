#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""chess_record.py - registra con il RIFERIMENTO Python (hw/chessmod_ref.py: ref8048 + modello della console + Z80 del pacchetto `z80` kosarev 1.2.0,
solo in sviluppo) lo scambio fra l'8048 e il modulo scacchi con i programmi di PROVA ORIGINALI di test/chess_testrom.js, per la prova differenziale
test/chess_run.js (che rifa lo stesso lavoro con src/console.js e src/chessmod.js e confronta tutto).

Uso:  node test/chess_testrom.js CARTELLA
      python3 -I test/chess_record.py CARTELLA --lib CARTELLA_DEL_PACCHETTO_z80      (oppure variabile Z80_LIB)
Registra, per PAL e NTSC: la sequenza di eventi (ogni MOVX con il valore dei latch e di P1, ogni IN / OUT dello Z80, compressa) e lo stato finale
(RAM esterna, RAM del modulo, latch, reset, PC e tempo dello Z80, tempo dell'8048). Scrive CARTELLA/chess_ref.json.
"""
import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))

CYCLES = 400000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--lib", default=os.environ.get("Z80_LIB"))
    ap.add_argument("--cycles", type=int, default=CYCLES)
    a = ap.parse_args()
    if a.lib:
        sys.path.insert(0, a.lib)
    import z80  # noqa
    import chessmod_ref as C
    bios = open(os.path.join(a.dir, "bios8048.bin"), "rb").read()
    rom = open(os.path.join(a.dir, "z80rom.bin"), "rb").read()
    image = bytearray(4096)
    image[:len(bios)] = bios
    out = {"cycles": a.cycles}
    for std in ("PAL", "NTSC"):
        con = C.ChessConsole(z80, bytes(image), rom, std)
        con.run_cycles(a.cycles)
        ch = con.chess
        out[std] = {
            "events": C.rle(ch.events), "xram": list(con.env.xram80), "ramSha": hashlib.sha256(bytes(ch.ram)).hexdigest(),
            "latch0": ch.latch0, "latch1": ch.latch1, "running": ch.running, "z80pc": ch.m.pc, "z80t": ch.z80_t, "target": ch.target,
            "now": con.cpu.now,
        }
        print("%s: %d eventi (%d righe compresse), 8048 a %d cicli, Z80 a %d T (PC %04X)" % (std, len(ch.events), len(out[std]["events"]), con.cpu.now, ch.z80_t, ch.m.pc))
    with open(os.path.join(a.dir, "chess_ref.json"), "w") as f:
        json.dump(out, f)
    print("scritto", os.path.join(a.dir, "chess_ref.json"), os.path.getsize(os.path.join(a.dir, "chess_ref.json")), "byte")


if __name__ == "__main__":
    main()
