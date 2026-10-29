#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""preview_ref.py - riferimento INDIPENDENTE per le anteprime (src/preview.js). Scritto dalla descrizione del copione, non dal codice JS:
  punteggio di un quadro, quadro vuoto, miniatura a scatole (aritmetica intera), e la scelta del quadro migliore su un modello di console.
Il modello di console e' hw/o2line.py (CPU di riferimento + video per riga). Nessun dato dei giochi qui dentro.

  frame_stats(rows)           -> (n, massimo, colori)       rows: lista di righe, ogni riga una lista di indici colore 0..15
  score(st), is_blank(st), is_rich(st)
  thumbnail(rows, palette, ow, oh) -> lista di ow*oh tuple (r, g, b)
  run_script(machine, ...)    -> dict con quadro scelto, punteggio, crc della miniatura
"""
import os
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import o2hw  # noqa: E402

TOTAL, PRESS_FROM, PRESS_TO, SAMPLE_FROM, SAMPLE_EVERY = 270, 150, 156, 170, 10
OW, OH = 80, 54
# seconda fase (solo se alla fine della prima il quadro migliore ha meno del 2% di punti diversi dal fondo): un tasto alla volta, 5 fotogrammi
# premuto e 35 rilasciato, un campione ogni 10 fotogrammi (il 10o, 20o, 30o, 40o di ogni tasto), ci si ferma al primo campione con almeno il 2%
PER_KEY, KEY_PRESS = 40, 5
KEY_ORDER = [1, 0, 47] + list(range(2, 10)) + [44, 45, 12, 13, 46]                       # poi tutti gli altri, in ordine, tranne il tasto 11 (non esiste)
KEYS = KEY_ORDER + [k for k in range(48) if k not in KEY_ORDER and k != 11]


def frame_stats(rows):
    cnt = [0] * 16
    n = 0
    for r in rows:
        for c in r:
            cnt[c & 15] += 1
            n += 1
    mx = max(cnt)
    colors = sum(1 for c in cnt if c * 200 >= n)
    return n, mx, colors


def score(st):
    n, mx, colors = st
    return (n - mx) * min(colors, 4)


def is_poor(st):
    """Meno del 2% di punti diversi dal fondo (il gioco forse aspetta un tasto)."""
    n, mx, _ = st
    return (n - mx) * 50 < n


def is_blank(st):
    """Meno dello 0,2% di punti diversi dal fondo: vuoto davvero."""
    n, mx, _ = st
    return (n - mx) * 500 < n


def is_rich(st):
    n, mx, colors = st
    return (n - mx) * 4 >= n and colors >= 3


def thumbnail(rows, palette, ow=OW, oh=OH):
    h, w = len(rows), len(rows[0])
    out = []
    for oy in range(oh):
        ys = range(oy * h // oh, max(oy * h // oh + 1, (oy + 1) * h // oh))
        for ox in range(ow):
            xs = range(ox * w // ow, max(ox * w // ow + 1, (ox + 1) * w // ow))
            tot = [0, 0, 0]
            for y in ys:
                row = rows[y]
                for x in xs:
                    p = palette[row[x] & 15]
                    tot[0] += p[0]; tot[1] += p[1]; tot[2] += p[2]
            cnt = len(ys) * len(xs)
            out.append(tuple((2 * t + cnt) // (2 * cnt) for t in tot))
    return out


def rgba_bytes(pixels):
    b = bytearray()
    for r, g, bl in pixels:
        b += bytes((r, g, bl, 255))
    return bytes(b)


def run_script(m):
    """Fa girare la macchina m (hw/o2line.LineMachine) con il copione e ritorna il risultato."""
    best = None
    best_score = -1
    best_frame = -1
    best_st = None
    total = TOTAL
    fr = 0
    while fr < total:
        keys = [0] * 8
        if fr < TOTAL:
            if PRESS_FROM <= fr < PRESS_TO:
                keys = [1] * 8
        else:
            idx = (fr - TOTAL) // PER_KEY
            if (fr - TOTAL) % PER_KEY < KEY_PRESS:
                k = KEYS[idx]
                keys[k // 8] |= 1 << (k % 8)
        m.keys.rows[:] = keys
        target = m.vdc.frame_done + 1
        while m.vdc.frame_done < target:
            m.step()
        sample = False
        if fr < TOTAL:
            sample = fr >= SAMPLE_FROM and (fr - SAMPLE_FROM) % SAMPLE_EVERY == 0
        else:
            sample = (fr - TOTAL) % 10 == 9
        stop = False
        if sample:
            rows = [list(r) for r in m.vdc.fb]
            st = frame_stats(rows)
            sc = score(st)
            if sc > best_score:
                best, best_score, best_frame, best_st = rows, sc, fr, st
            if fr < TOTAL and is_rich(st):
                stop = True
            if fr >= TOTAL and not is_poor(st):
                stop = True
        fr += 1
        if stop:
            break
        if fr == TOTAL:
            if best_st is not None and not is_poor(best_st):
                break
            total = TOTAL + len(KEYS) * PER_KEY
    blank = best is None or is_blank(best_st)
    if best is None:
        best = [[0] * 360 for _ in range(243)]
    px = rgba_bytes(thumbnail(best, o2hw.PALETTE))
    return {"frame": best_frame, "score": best_score, "blank": blank, "crc": zlib.crc32(px), "pixels": px}


if __name__ == "__main__":
    sys.exit("modulo di libreria: vedi test/preview_record.py")
