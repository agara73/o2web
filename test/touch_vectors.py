#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""touch_vectors.py OUT.json - vettori per test/test_touch.js (joystick a tocco, tappa 8), calcolati dal riferimento indipendente
hw/touch_ref.py: (1) direzioni di spostamenti casuali e di casi limite vicini (ma non sopra) ai confini dei settori e della zona morta,
con raggi e zone morte diverse; (2) sequenze casuali di eventi delle dita (direzione, fuoco, spostamento, rilascio, azzeramento) nei due
modi 'cross' e 'float', con i bit dopo ogni evento. Uso: python3 -I test/touch_vectors.py OUT.json [--seed N]"""
import argparse, json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import touch_ref as R  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=8)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    dirs = []

    def add(dx, dy, radius, dz, label):
        if R.near_boundary(dx, dy, radius, dz):
            return
        dirs.append({"dx": dx, "dy": dy, "r": radius, "dz": dz, "bits": R.dir_bits(dx, dy, radius, dz), "label": label})

    # spostamenti casuali, anche oltre il raggio e nella zona morta
    for _ in range(3000):
        radius = rng.choice([1.0, 40.0, 64.0, 90.5, 200.0])
        dz = rng.choice([0.0, 0.1, 0.25, 0.5])
        d = rng.uniform(0, 2.5) * radius
        t = rng.uniform(0, 2 * math.pi)
        add(d * math.cos(t), d * math.sin(t), radius, dz, "caso")
    # ogni confine dei settori, appena prima e appena dopo (0,01 gradi), a distanze diverse
    for k in range(8):
        for side in (-0.01, 0.01):
            ang = math.radians(22.5 + 45 * k + side)
            for dist in (0.3, 0.9, 1.0, 1.7):
                add(64 * dist * math.cos(ang), -64 * dist * math.sin(ang), 64.0, 0.25, "confine%d%+.2f" % (k, side))
    # assi e diagonali esatti
    for k in range(8):
        ang = math.radians(45 * k)
        add(50 * math.cos(ang), -50 * math.sin(ang), 64.0, 0.25, "asse%d" % k)
    # zona morta: appena dentro e appena fuori
    for f in (0.999, 1.001):
        for k in range(16):
            ang = math.radians(10 + 22.5 * k)
            add(16 * f * math.cos(ang), 16 * f * math.sin(ang), 64.0, 0.25, "zona%.3f" % f)
    # centro esatto e coordinate intere (i pixel veri)
    add(0.0, 0.0, 64.0, 0.25, "centro")
    for _ in range(500):
        add(float(rng.randint(-120, 120)), float(rng.randint(-120, 120)), 64.0, 0.25, "intero")

    def on_boundary(geom, events):
        # centri possibili: quello della croce e ogni punto dove un dito si e' appoggiato sulla direzione ('float')
        centers = [(geom[0], geom[1])] + [(e[2], e[3]) for e in events if e[0] == "dir"]
        return any(R.near_boundary(e[2] - cx, e[3] - cy, geom[2]) for e in events if e[0] in ("dir", "move") for cx, cy in centers
                   if (e[2], e[3]) != (cx, cy))

    seqs = []
    skipped = 0
    s = 0
    while len(seqs) < 200:
        s += 1
        mode = "float" if s % 2 else "cross"
        geom = [float(rng.randint(40, 300)), float(rng.randint(40, 700)), float(rng.choice([48, 64, 80]))]
        events = []
        down = set()
        for _ in range(rng.randint(5, 40)):
            op = rng.choice(["dir", "dir", "fire", "move", "move", "move", "up", "up", "reset"])
            pid = rng.randint(1, 4) if op != "reset" else 0
            if op == "move" and down and rng.random() < 0.8:
                pid = rng.choice(sorted(down))
            x = geom[0] + rng.uniform(-2.2, 2.2) * geom[2]
            y = geom[1] + rng.uniform(-2.2, 2.2) * geom[2]
            if op in ("dir", "fire"):
                down.add(pid)
            elif op == "up":
                down.discard(pid)
            elif op == "reset":
                down.clear()
            events.append([op, pid, x, y])
        # niente confronti sui confini: si scarta la sequenza se una posizione della direzione cade su un confine
        if on_boundary(geom, events):
            skipped += 1
            continue
        seqs.append({"mode": mode, "geom": geom, "events": events, "bits": R.run_events(mode, geom, events)})
    out = {"deadzone": R.DEADZONE, "dirs": dirs, "seqs": seqs}
    with open(a.out, "w") as f:
        json.dump(out, f)
    assert os.path.getsize(a.out) > 0
    print("%d direzioni, %d sequenze (%d scartate sui confini) -> %s" % (len(dirs), len(seqs), skipped, a.out))


if __name__ == "__main__":
    main()
