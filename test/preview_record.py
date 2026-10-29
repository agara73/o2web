#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""preview_record.py OUTDIR - registra, per ogni scenario di line_scenarios.json (solo G7000/G7200), il risultato del copione delle
anteprime nel MODELLO PER RIGA (hw/o2line.py) usando il riferimento indipendente hw/preview_ref.py: quadro scelto, punteggio, vuoto, crc
della miniatura. Lo confronta test/preview_run.js con la console JavaScript. Uso: python3 -I test/preview_record.py OUTDIR [--only a,b]
I dump si cercano in $O2_DUMPS (come line_record.py); gli scenari senza cartuccia si saltano."""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import o2line  # noqa: E402
import preview_ref  # noqa: E402

DUMPS = os.environ.get("O2_DUMPS", "/home/claude/dumps/t1")
SCENARIOS = json.load(open(os.path.join(HERE, "line_scenarios.json")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    only = set(a.only.split(",")) if a.only else None
    done = 0
    for sc in SCENARIOS:
        if sc.get("g7400") or not sc["cart"] or (only and sc["name"] not in only):
            continue
        cp, bp = os.path.join(DUMPS, sc["cart"]), os.path.join(DUMPS, sc["bios"])
        if not (os.path.exists(cp) and os.path.exists(bp)):
            print("%-24s saltato: manca un dump" % sc["name"])
            continue
        timing = o2line.NTSC if sc.get("std") == "NTSC" else o2line.PAL
        m = o2line.LineMachine(open(bp, "rb").read(), open(cp, "rb").read(), o2line.own_charset(), timing)
        r = preview_ref.run_script(m)
        px = r.pop("pixels")
        r.update(name=sc["name"], cart=sc["cart"], bios=sc["bios"], std=sc.get("std", "PAL"), size=len(px))
        path = os.path.join(a.outdir, sc["name"] + ".json")
        with open(path, "w") as f:
            json.dump(r, f)
        with open(os.path.join(a.outdir, sc["name"] + ".rgba"), "wb") as f:
            f.write(px)
        assert os.path.getsize(path) > 0
        print("%-24s quadro %3d punteggio %8d vuoto %-5s crc %08x" % (sc["name"], r["frame"], r["score"], r["blank"], r["crc"]))
        done += 1
    if not done:
        sys.exit("nessuno scenario registrato: controlla $O2_DUMPS")


if __name__ == "__main__":
    main()
