# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""look_ref.py - riferimento INDIPENDENTE dello strato di aspetto (src/look.js), scritto da zero dalla specifica nella testata di
look.js, senza tabelle ne' trucchi: ogni pixel di uscita si calcola dalle formule. Serve solo come oracolo dei test
(test/look_record.py registra, test/test_look.js confronta).

Aritmetica: pixel e passaggi di colore SEMPRE interi; i soli numeri in virgola mobile (posizioni della curvatura, pesi di maschera e
righe) usano le stesse operazioni, nello stesso ordine, di look.js, quindi coincidono al bit (doppia precisione IEEE).

  gray_of(r, g, b)                         grigio del monitor B/N
  stage1(fb, w, h, pal, look, prev)        passi 1-3 (sfocatura, persistenza, alone) -> (rgb[], prev_nuovo); rgb = lista di (r, g, b)
  out_pixel(rgb, w, h, look, X, Y)         passo 4 per UN pixel di uscita -> (r, g, b)
  frame(fb, w, h, pal, look, prev, rows)   fotogramma intero (o solo le righe di uscita indicate) -> (pixel, prev_nuovo)
"""
import math


def gray_of(r, g, b):
    return (77 * r + 150 * g + 29 * b + 128) >> 8


def out_scale(look):
    return look['detail'] if (look['scan'] or look['mask'] or look['curve']) else 1


def is_exact(look):
    return not any(look[k] for k in ('blur', 'persist', 'glow', 'scan', 'mask', 'curve'))


def stage1(fb, w, h, pal, look, prev):
    """fb: lista di indici (w*h); pal: 16 tuple (r, g, b); prev: memoria della persistenza (lista di w*h tuple) o None."""
    if look['mono']:
        pal = [(gray_of(*c),) * 3 for c in pal]
    cur = [list(pal[v & 15]) for v in fb]
    if look['blur'] > 0:
        side = look['blur'] * 64 // 100
        center = 256 - 2 * side
        nxt = []
        for y in range(h):
            for x in range(w):
                l = cur[y * w + max(x - 1, 0)]
                r = cur[y * w + min(x + 1, w - 1)]
                c = cur[y * w + x]
                nxt.append([(side * (l[i] + r[i]) + center * c[i] + 128) >> 8 for i in range(3)])
        cur = nxt
    if look['persist'] > 0:
        if prev is None:
            prev = [[0, 0, 0] for _ in range(w * h)]
        p = look['persist']
        for i in range(w * h):
            for c in range(3):
                cur[i][c] = max(cur[i][c], prev[i][c] * p // 100)
        prev = [list(px) for px in cur]
    else:
        prev = None
    if look['glow'] > 0:
        g = look['glow']
        # media 7 x 7 con il bordo ripetuto
        def clamp(v, hi):
            return 0 if v < 0 else hi if v > hi else v
        glow = []
        for y in range(h):
            for x in range(w):
                px = []
                for c in range(3):
                    s = 0
                    for dy in range(-3, 4):
                        yy = clamp(y + dy, h - 1)
                        for dx in range(-3, 4):
                            s += cur[yy * w + clamp(x + dx, w - 1)][c]
                    big = (s + 24) // 49
                    px.append(min(255, cur[y * w + x][c] + (big * g * 3 + 200) // 400))
                glow.append(px)
        cur = glow
    return [tuple(px) for px in cur], prev


def out_pixel(rgb, w, h, look, X, Y):
    k = out_scale(look)
    W, H = w * k, h * k
    scan, mask, curve = look['scan'], look['mask'], look['curve']
    ks = (curve / 100) * 0.25
    sc = scan / 100
    off = (256 - mask * 140 // 100) / 256
    mean_scan = 1 - sc / 3 if scan > 0 else 1
    mean_mask = (1 + (k - 1) * off) / k if mask > 0 else 1
    gain = 1 / (mean_scan * mean_mask)
    if gain > 1.5:
        gain = 1.5
    u = (X + 0.5) / W * 2 - 1
    v = (Y + 0.5) / H * 2 - 1
    su, sv = u, v
    if curve > 0:
        su = u * (1 + ks * v * v)
        sv = v * (1 + ks * u * u)
    if su > 1 or su < -1 or sv > 1 or sv < -1:
        return (0, 0, 0)
    sx = (su + 1) * 0.5 * w
    sy = (sv + 1) * 0.5 * h
    ix = min(math.floor(sx), w - 1)
    iy = min(math.floor(sy), h - 1)
    d = abs(2 * (sy - iy) - 1)
    ws = 1 - sc * d * d
    s = X % k
    src = rgb[iy * w + ix]
    out = []
    for c in range(3):
        mf = off if (mask > 0 and s != c) else 1
        weight = math.floor(gain * ws * mf * 256 + 0.5)
        out.append(min(255, (src[c] * weight + 128) >> 8))
    return tuple(out)


def frame(fb, w, h, pal, look, prev, rows=None):
    """Ritorna (pixel, prev): pixel = lista di (r, g, b) in ordine di riga (tutte le righe di uscita, o solo quelle di 'rows')."""
    if is_exact(look):
        p = [(gray_of(*c),) * 3 for c in pal] if look['mono'] else [tuple(c) for c in pal]
        return [p[v & 15] for v in fb], None
    rgb, prev = stage1(fb, w, h, pal, look, prev)
    k = out_scale(look)
    if k == 1:
        return rgb, prev
    W, H = w * k, h * k
    ys = range(H) if rows is None else rows
    return [[out_pixel(rgb, w, h, look, X, Y) for X in range(W)] for Y in ys], prev
