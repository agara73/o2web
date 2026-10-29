#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - strumenti per l'emulatore Odyssey 2 / Videopac G7000 su ZX Spectrum
"""Verifica i dump BIOS/cartucce: dimensione, MD5, riconoscimento e prova di coerenza.

Uso: check_dumps.py FILE.bin [FILE.bin ...]
Per i BIOS controlla anche che dai punti d'ingresso noti (vettori, interrupt, selectgame) si raggiunga solo codice valido (nessun
opcode illegale): e' una prova indipendente che dump e disassemblatore sono sani.
Gli MD5 di riferimento sono quelli della lista BIOS di O2EM/libretro.
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dis48  # noqa: E402

KNOWN = {
    "562d5ebf9e030a40d6fabfc2f33139fd": "BIOS Odyssey 2 / Videopac G7000 (o2rom.bin)",
    "f1071cdb0b6b10dde94d3bc8a6146387": "BIOS Videopac G7000 francese (c52.bin)",
    "c500ff71236068e0dc0d0603d265ae76": "BIOS Videopac+ G7400 europeo (g7400.bin)",
    "279008e4a0db2dc5f1c048853b033828": "BIOS Videopac+ G7400 francese (jopac.bin)",
}


def main(files):
    bad = 0
    for f in files:
        d = open(f, "rb").read()
        md5 = hashlib.md5(d).hexdigest()
        what = KNOWN.get(md5)
        print("%s\n  %d byte  md5 %s  %s" % (os.path.basename(f), len(d), md5,
                                              what or "(non in lista: cartuccia o dump diverso)"))
        if what or len(d) == 1024:
            # vettori, gestore dell'interrupt esterno (0x09), routine 0x44 e selectgame (0x2C3);
            # nel G7400 anche il reset proprio a 0x26A
            ent = [0, 3, 7, 0x09, 0x44, 0x2C3] + ([0x26A] if what and "G7400" in what else [])
            seen, jmpp = dis48.trace(d, ent, 0, 0x400)
            ill = [a for a, v in seen.items() if v[2] == "ill"]
            print("  codice raggiungibile dai punti d'ingresso: %d istruzioni, opcode illegali: %d, JMPP: %d"
                  % (len(seen), len(ill), len(jmpp)))
            bad += len(ill)
        elif len(d) in (2048, 4096, 8192):
            vec = [(d[i], d[i + 1]) for i in (0, 2, 4, 6, 8, 10)]
            print("  cartuccia %d KB; vettori 0x400..0x40A: %s" %
                  (len(d) // 1024, " ".join("%02X%02X" % v for v in vec)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main(sys.argv[1:]) if len(sys.argv) > 1 else sys.exit(__doc__)
