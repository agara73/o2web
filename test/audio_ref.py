#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""audio_ref.py - prepara i riferimenti per test/test_audio.js: campioni PCM calcolati da hw/o2audio.py (aritmetica esatta, indipendente
da src/audio.js) a partire da (a) log di livello SINTETICI casuali (cambi allo stesso ciclo, a meta' campione, molti cambi dentro un
campione, livelli 0..15, PAL e NTSC, 44100 e 48000 Hz) e (b) i log di suono REALI registrati dal modello per riga (test/line_record.py,
file <nome>.snd) di alcuni scenari. Scrive OUTDIR/audio.json (descrizione) e OUTDIR/<caso>.f64 (campioni, float64 little-endian).
Uso: python3 -I test/audio_ref.py OUTDIR [--line DIR_DI_LINE_RECORD] [--cases N] [--seed S]"""
import argparse
import array
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import o2audio  # noqa: E402


def synth(rng, idx):
    std = rng.choice(["PAL", "NTSC"])
    rate = rng.choice([44100, 48000, 22050])
    total = rng.choice([4000, 20000, 60000])
    n = rng.choice([0, 3, 40, 400, 3000])
    cs = sorted(rng.randrange(0, total) for _ in range(n))
    if cs and rng.random() < 0.5:                      # alcuni cambi allo stesso ciclo
        for _ in range(min(5, len(cs))):
            i = rng.randrange(len(cs))
            cs[i:i] = [cs[i]] * rng.randrange(1, 3)
    level0 = rng.choice([0, 0, rng.randrange(16)])
    log = [(c, rng.randrange(16)) for c in cs]
    return {"name": "synth%d" % idx, "std": std, "rate": rate, "total": total, "level0": level0, "log": log}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--line", default="")
    ap.add_argument("--cases", type=int, default=40)
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = random.Random(a.seed)
    cases = [synth(rng, i) for i in range(a.cases)]
    if a.line:
        for name in ("o2_blockout", "o2_popeye_8k", "o2_musician_linear", "o2_pickaxepete", "ntsc_popeye_8k"):
            sp, jp = os.path.join(a.line, name + ".snd"), os.path.join(a.line, name + ".json")
            if not (os.path.exists(sp) and os.path.exists(jp)):
                continue
            meta = json.load(open(jp))
            raw = array.array("I")
            with open(sp, "rb") as f:
                raw.frombytes(f.read())
            log = [(raw[i], raw[i + 1]) for i in range(0, len(raw), 2)]
            cases.append({"name": "real_" + name, "std": meta["std"], "rate": 48000, "total": meta["cycles"], "level0": 0, "log": log})
    desc = []
    for c in cases:
        pcm = o2audio.render_pcm(c["log"], c["total"], c["std"], c["rate"], c["level0"])
        arr = array.array("d", pcm)
        if sys.byteorder != "little":
            arr.byteswap()
        path = os.path.join(a.out, c["name"] + ".f64")
        with open(path, "wb") as f:
            arr.tofile(f)
        assert os.path.getsize(path) > 0 or len(pcm) == 0
        desc.append({k: c[k] for k in ("name", "std", "rate", "total", "level0", "log")} | {"samples": len(pcm)})
    with open(os.path.join(a.out, "audio.json"), "w") as f:
        json.dump(desc, f)
    assert os.path.getsize(os.path.join(a.out, "audio.json")) > 0
    print("%d casi (%d sintetici), %d campioni di riferimento -> %s" % (len(desc), a.cases, sum(d["samples"] for d in desc), a.out))


if __name__ == "__main__":
    main()
