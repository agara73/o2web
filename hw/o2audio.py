#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""o2audio.py - riferimento (oracolo) dei campioni PCM del suono, indipendente da src/audio.js.

Dal log del livello di uscita [(ciclo, livello 0..15)] (hw/o2line.py: snd_log) calcola i campioni mono come MEDIA del livello
sull'intervallo di tempo di ciascun campione, con aritmetica ESATTA a interi (nessun errore di arrotondamento): i cicli macchina al
secondo sono razionali (PAL 17734475/45, NTSC 3579545/10), il campione i copre i cicli [i * cps / rate, (i + 1) * cps / rate).
Ampiezza: livello / 15 * AMP (AMP = 0.5), DA VERIFICARE come il resto del modello del suono.
"""
from fractions import Fraction

AMP = 0.5
CPS = {"PAL": Fraction(17734475, 45), "NTSC": Fraction(3579545, 10)}


def render_pcm(log, total_cycles, std, rate, level0=0):
    """Ritorna la lista dei campioni COMPLETI fino a total_cycles (come src/audio.js: la parte finale di campione non si emette).
    log: [(ciclo, livello)] con cicli non decrescenti (a parita' di ciclo vale l'ultimo livello); level0: livello prima del primo cambio."""
    cps = CPS[std]
    num, den = cps.numerator, cps.denominator * rate        # il campione i copre le unita' [i * num, (i + 1) * num) (unita' = 1/den cicli)
    n = (total_cycles * den) // num
    segs = []                                               # (inizio unita', livello)
    segs.append((0, level0))
    for c, l in log:
        segs.append((c * den, l))
    out = []
    k = 0
    for i in range(n):
        a, b = i * num, (i + 1) * num
        while k + 1 < len(segs) and segs[k + 1][0] <= a:
            k += 1
        acc = 0
        j = k
        while j < len(segs) and segs[j][0] < b:
            s0 = max(a, segs[j][0])
            s1 = b if j + 1 >= len(segs) else min(b, segs[j + 1][0])
            if s1 > s0:
                acc += segs[j][1] * (s1 - s0)
            j += 1
        out.append(acc / num * (AMP / 15))
    return out
