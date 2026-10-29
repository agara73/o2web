#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""preview_vectors.py OUT.json - vettori per test/test_preview.js: quadri casuali (e casi limite) con statistiche, punteggio, vuoto,
ricco e miniatura calcolati dal riferimento indipendente hw/preview_ref.py. Uso: python3 -I test/preview_vectors.py OUT.json [--seed N]"""
import argparse, json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import o2hw  # noqa: E402
import preview_ref as P  # noqa: E402


def case(rows, ow, oh, label):
    h, w = len(rows), len(rows[0])
    st = P.frame_stats(rows)
    th = P.thumbnail(rows, o2hw.PALETTE, ow, oh)
    flat = [c for r in rows for c in r]
    return {"label": label, "w": w, "h": h, "ow": ow, "oh": oh, "fb": flat, "n": st[0], "max": st[1], "colors": st[2],
            "score": P.score(st), "blank": P.is_blank(st), "poor": P.is_poor(st), "rich": P.is_rich(st), "rgba": list(P.rgba_bytes(th))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=5)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    cases = []
    # dimensioni vere del video
    for k in range(6):
        w, h = 360, 243
        mode = k % 3
        if mode == 0:
            rows = [[rng.randrange(16) for _ in range(w)] for _ in range(h)]
        elif mode == 1:
            rows = [[0] * w for _ in range(h)]
            for _ in range(rng.randrange(1, 4000)):
                rows[rng.randrange(h)][rng.randrange(w)] = rng.randrange(16)
        else:
            base = rng.randrange(16)
            rows = [[base] * w for _ in range(h)]
            for _ in range(rng.randrange(1, 30)):
                x0, y0 = rng.randrange(w - 20), rng.randrange(h - 20)
                c = rng.randrange(16)
                for y in range(y0, y0 + rng.randrange(1, 20)):
                    for x in range(x0, x0 + rng.randrange(1, 20)):
                        rows[y][x] = c
        cases.append(case(rows, 80, 54, "video%d" % k))
    # dimensioni piccole e non divisibili, anche con uscita piu' grande dell'ingresso
    for (w, h, ow, oh) in [(4, 4, 4, 4), (7, 5, 3, 2), (17, 11, 5, 4), (9, 9, 20, 3), (3, 3, 7, 7), (1, 1, 2, 2), (360, 243, 7, 5), (360, 243, 90, 61)]:
        rows = [[rng.randrange(16) for _ in range(w)] for _ in range(h)]
        cases.append(case(rows, ow, oh, "%dx%d->%dx%d" % (w, h, ow, oh)))
    # limiti delle soglie: 2% e 0,5% esatti su 1000 pixel (50x20)
    for non_modal, label in [(19, "sotto2"), (20, "esatto2"), (21, "sopra2")]:
        rows = [[0] * 50 for _ in range(20)]
        flat = [(0, 0)] * 0
        for i in range(non_modal):
            rows[i // 50][i % 50] = 1
        cases.append(case(rows, 5, 4, label))
    for non_modal, label in [(1, "sotto02"), (2, "esatto02"), (3, "sopra02")]:      # 0,2% di 1000 = 2 pixel
        rows = [[0] * 50 for _ in range(20)]
        for i in range(non_modal):
            rows[0][i] = 1
        cases.append(case(rows, 5, 4, label))
    for non_modal, label in [(1, "n1001-1"), (2, "n1001-2"), (3, "n1001-3")]:      # 1001 pixel: 2 diversi = 0,1998% (vuoto), la soglia 501 darebbe un altro risultato
        rows = [[0] * 91 for _ in range(11)]
        for i in range(non_modal):
            rows[0][i] = 1
        cases.append(case(rows, 7, 5, label))
    for cnt, label in [(4, "colore4"), (5, "colore5"), (6, "colore6")]:           # 0,5% di 1000 = 5 pixel
        rows = [[0] * 50 for _ in range(20)]
        for i in range(cnt):
            rows[0][i] = 3
        for i in range(5):
            rows[1][i] = 7
        cases.append(case(rows, 5, 4, label))
    with open(a.out, "w") as f:
        json.dump(cases, f)
    assert os.path.getsize(a.out) > 0
    print("%d casi -> %s" % (len(cases), a.out))


if __name__ == "__main__":
    main()
