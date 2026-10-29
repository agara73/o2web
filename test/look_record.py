#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""look_record.py - registra i casi per la prova dello strato di aspetto (src/look.js contro hw/look_ref.py, riferimento indipendente).

Scrive in OUTDIR/look_cases.json una lista di casi: {nome, w, h, look, frames: [[indici]], expect: [...]}. Ogni 'expect' e' per un fotogramma:
  {"b64": RGBA dei pixel (R, G, B, 255), "rows": null | [righe di uscita campionate]}   per i casi piccoli e per le righe campionate;
  {"sha": sha256 dei byte RGBA, "rows": null}                                         per i fotogrammi interi a piena risoluzione.
Casi piccoli: confronto completo di ogni pixel; casi a 360 x 243: i passi 1-3 per intero (impronta) e il passo 4 su righe campionate.
Nessun dump entra qui: i fotogrammi sono sintetici (pseudo-casuali con seme, impulsi, sfumature, riquadri).
Uso: python3 -I test/look_record.py OUTDIR [--quick]"""
import argparse
import base64
import hashlib
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import look_ref as R  # noqa: E402
from o2hw import PALETTE  # noqa: E402

BASE = {'mono': False, 'blur': 0, 'persist': 0, 'glow': 0, 'scan': 0, 'mask': 0, 'curve': 0, 'detail': 3}


def L(**kw):
    d = dict(BASE)
    d.update(kw)
    return d


def noise(w, h, seed):
    r = random.Random(seed)
    return [r.randrange(16) for _ in range(w * h)]


def impulse(w, h, x, y, c=15):
    f = [0] * (w * h)
    f[y * w + x] = c
    return f


def ramp(w, h):
    return [(x * 16 // w) for y in range(h) for x in range(w)]


def boxes(w, h, seed):
    """riquadri di colori pieni, come uno schermo di gioco (fondo, griglia, oggetti)"""
    r = random.Random(seed)
    f = [r.choice((0, 8)) for _ in range(w * h)]
    for _ in range(18):
        x0, y0 = r.randrange(w), r.randrange(h)
        x1, y1 = min(w, x0 + r.randrange(2, w // 3 + 3)), min(h, y0 + r.randrange(2, h // 3 + 3))
        c = r.randrange(16)
        for y in range(y0, y1):
            for x in range(x0, x1):
                f[y * w + x] = c
    return f


def rgba(pixels):
    out = bytearray()
    for p in pixels:
        out += bytes((p[0], p[1], p[2], 255))
    return bytes(out)


def run_case(name, w, h, look, frames, sample_rows=None, always_sha=False, pal=None):
    palette = PALETTE if pal is None else pal
    prev = None
    expect = []
    for fb in frames:
        # per i fotogrammi interi a piena risoluzione basta l'impronta; per i casi piccoli il confronto completo
        rows = sample_rows if R.out_scale(look) > 1 else None
        px, prev = R.frame(fb, w, h, palette, look, prev, rows)
        flat = [p for line in px for p in line] if R.out_scale(look) > 1 else px      # con k > 1 'frame' ritorna righe di pixel
        if rows is not None:
            expect.append({"b64": base64.b64encode(rgba(flat)).decode(), "rows": list(rows)})
        elif always_sha:
            expect.append({"sha": hashlib.sha256(rgba(flat)).hexdigest(), "rows": None})
        else:
            expect.append({"b64": base64.b64encode(rgba(flat)).decode(), "rows": None})
    case = {"name": name, "w": w, "h": h, "look": look, "frames": frames, "expect": expect}
    if pal is not None:
        case["palette"] = [list(c) for c in pal]
    return case


def rand_palette(seed):
    """16 colori qualunque (anche con valori estremi): i passaggi di arrotondamento si provano su tutti i valori, non solo su quelli della tavolozza vera"""
    r = random.Random(seed)
    pal = [(r.randrange(256), r.randrange(256), r.randrange(256)) for _ in range(16)]
    pal[0], pal[1] = (0, 0, 0), (255, 255, 255)
    return pal


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--quick", action="store_true", help="senza i casi a piena risoluzione")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    cases = []
    W, H = 20, 14
    f1, f2, f3 = noise(W, H, 1), noise(W, H, 2), boxes(W, H, 3)
    # 0: nessun filtro (colore e bianco e nero)
    cases.append(run_case("esatto colore", W, H, L(), [f1]))
    cases.append(run_case("esatto bianco e nero", W, H, L(mono=True), [f1]))
    # 1: sfocatura
    for b in (1, 37, 100):
        cases.append(run_case("sfocatura %d" % b, W, H, L(blur=b), [f1, f3]))
    cases.append(run_case("sfocatura impulso al bordo", W, H, L(blur=100), [impulse(W, H, 0, 0), impulse(W, H, W - 1, H - 1)]))
    # 2: persistenza (la memoria passa da un fotogramma all'altro)
    for p in (1, 50, 90):
        cases.append(run_case("persistenza %d" % p, W, H, L(persist=p), [f1, f2, f3, [0] * (W * H), [0] * (W * H)]))
    cases.append(run_case("persistenza con impulso", W, H, L(persist=90), [impulse(W, H, 5, 5)] + [[0] * (W * H)] * 12))
    # 3: alone
    for g in (1, 40, 100):
        cases.append(run_case("alone %d" % g, W, H, L(glow=g), [f1, f3]))
    cases.append(run_case("alone impulso al bordo", W, H, L(glow=100), [impulse(W, H, 0, 0), impulse(W, H, W - 1, 6)]))
    # 4: righe, maschera, curvatura (k = 3 e 4), da soli e insieme
    for k in (3, 4):
        cases.append(run_case("righe %d k%d" % (100, k), W, H, L(scan=100, detail=k), [f1]))
        cases.append(run_case("righe %d k%d" % (33, k), W, H, L(scan=33, detail=k), [f3]))
        cases.append(run_case("maschera %d k%d" % (100, k), W, H, L(mask=100, detail=k), [f1]))
        cases.append(run_case("maschera %d k%d" % (1, k), W, H, L(mask=1, detail=k), [f3]))
        cases.append(run_case("curvatura %d k%d" % (100, k), W, H, L(curve=100, detail=k), [f1]))
        cases.append(run_case("curvatura %d k%d" % (7, k), W, H, L(curve=7, detail=k), [f3]))
        cases.append(run_case("righe+maschera k%d" % k, W, H, L(scan=60, mask=60, detail=k), [f1]))
        cases.append(run_case("tutto acceso k%d" % k, W, H, L(blur=40, persist=35, glow=35, scan=55, mask=30, curve=35, detail=k), [f1, f2, f3]))
        cases.append(run_case("tutto al massimo k%d bianco e nero" % k, W, H, L(mono=True, blur=100, persist=90, glow=100, scan=100, mask=100, curve=100, detail=k), [f3, f1]))
    # valori limite (1 sul cursore: l'ingresso piu' basso che cambia ancora qualcosa) e tavolozze casuali per provare ogni arrotondamento
    cases.append(run_case("righe 1 k3", W, H, L(scan=1), [f3]))
    cases.append(run_case("righe 1 k4", W, H, L(scan=1, detail=4), [f1]))
    cases.append(run_case("curvatura 1 k3", W, H, L(curve=1), [f1]))
    cases.append(run_case("curvatura 1 k4", W, H, L(curve=1, detail=4), [f3]))
    for seed in range(1, 7):
        pal = rand_palette(100 + seed)
        fa, fb2, fc = noise(W, H, 200 + seed), noise(W, H, 300 + seed), boxes(W, H, 400 + seed)
        cases.append(run_case("tav. casuale %d: sfocatura" % seed, W, H, L(blur=seed * 15 + 3), [fa, fc], pal=pal))
        cases.append(run_case("tav. casuale %d: persistenza" % seed, W, H, L(persist=seed * 14 + 5), [fa, fb2, [0] * (W * H), fc, [0] * (W * H)], pal=pal))
        cases.append(run_case("tav. casuale %d: alone" % seed, W, H, L(glow=seed * 16 + 1), [fa, fc], pal=pal))
        cases.append(run_case("tav. casuale %d: bianco e nero" % seed, W, H, L(mono=True), [fa], pal=pal))
        cases.append(run_case("tav. casuale %d: righe e maschera k3" % seed, W, H, L(scan=seed * 15, mask=seed * 16 + 2, detail=3), [fa], pal=pal))
        cases.append(run_case("tav. casuale %d: tutto k4" % seed, W, H, L(mono=seed % 2 == 0, blur=seed * 13, persist=seed * 12, glow=seed * 11, scan=seed * 14, mask=seed * 15, curve=seed * 16, detail=4), [fa, fb2], pal=pal))
    # dimensioni minime e dispari
    for (w, h) in ((1, 1), (2, 3), (3, 2), (7, 5)):
        fb = noise(w, h, 40 + w * 10 + h)
        cases.append(run_case("minimo %dx%d k3" % (w, h), w, h, L(blur=50, persist=40, glow=50, scan=70, mask=40, curve=50), [fb, noise(w, h, 9)]))
        cases.append(run_case("minimo %dx%d k4" % (w, h), w, h, L(mono=True, blur=50, glow=50, scan=70, mask=40, curve=50, detail=4), [fb]))
    if not a.quick:
        # piena risoluzione
        w, h = 360, 243
        fa, fbb = boxes(w, h, 11), boxes(w, h, 12)
        rows3 = [0, 1, 2, 3, 5, 100, 361, 362, 363, 364, 540, 541, 542, 600, 727, 728]
        cases.append(run_case("pieno: sfocatura persistenza alone", w, h, L(blur=40, persist=40, glow=35), [fa, fbb], always_sha=True))
        cases.append(run_case("pieno: righe maschera curvatura k3", w, h, L(blur=25, scan=55, mask=30, curve=35, detail=3), [fa], sample_rows=rows3))
        rows4 = [0, 1, 2, 3, 4, 7, 200, 485, 486, 487, 488, 900, 969, 970, 971]
        cases.append(run_case("pieno: righe maschera k4 bianco e nero", w, h, L(mono=True, scan=80, mask=70, detail=4), [fbb], sample_rows=rows4))
        cases.append(run_case("pieno: curvatura forte k4", w, h, L(glow=20, curve=100, detail=4), [fa], sample_rows=rows4))
    path = os.path.join(a.outdir, "look_cases.json")
    with open(path, "w") as f:
        json.dump(cases, f)
    if os.path.getsize(path) == 0:
        sys.exit("file vuoto")
    print("registrati %d casi in %s (%d byte)" % (len(cases), path, os.path.getsize(path)))


if __name__ == "__main__":
    main()
