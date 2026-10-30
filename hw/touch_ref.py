# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - O2web, emulatore Odyssey 2 / Videopac per browser
"""touch_ref.py - riferimento indipendente del joystick a tocco (src/touch.js, tappa 8), scritto a parte con un metodo diverso:
la direzione si ricava dall'ANGOLO (atan2, in gradi) diviso in otto settori da 45 gradi centrati sugli assi, invece che dal confronto
delle pendenze. Il modello delle dita e' un elenco di eventi applicati in ordine.

Regole (le stesse scritte nella testata di src/touch.js):
- zona morta: distanza dal centro <= frazione * raggio -> nessuna direzione; oltre il raggio la direzione resta;
- settori: 0 = destra, 45 = su-destra, 90 = su, ... (angolo misurato con la y verso l'alto);
- un solo dito guida la direzione: un secondo dito sulla zona della direzione si ignora; un dito gia' appoggiato non si riappoggia;
- 'cross': il centro e' quello della croce; 'float': il centro e' dove il dito si appoggia; il centro si fissa all'appoggio;
- il fuoco e' premuto finche' almeno un dito sta sul tasto.
I confini esatti fra due settori (multipli di 22,5 gradi) e il bordo esatto della zona morta hanno misura nulla: il generatore dei casi
(test/touch_vectors.py) li evita, perche' due metodi di calcolo diversi possono dare arrotondamenti diversi proprio sul confine."""
import math

UP, RIGHT, DOWN, LEFT, FIRE = 0x01, 0x02, 0x04, 0x08, 0x10
DEADZONE = 0.25
# settore k (0..7, partendo da destra in senso antiorario) -> bit
SECTOR_BITS = [RIGHT, UP | RIGHT, UP, UP | LEFT, LEFT, DOWN | LEFT, DOWN, DOWN | RIGHT]


def angle_deg(dx, dy):
    """angolo in gradi in [0, 360), con la y dello schermo (verso il basso) rovesciata"""
    return math.degrees(math.atan2(-dy, dx)) % 360.0


def dir_bits(dx, dy, radius, deadzone=DEADZONE):
    if radius <= 0:
        return 0
    if math.hypot(dx, dy) <= deadzone * radius:
        return 0
    k = int(((angle_deg(dx, dy) + 22.5) % 360.0) // 45.0)
    return SECTOR_BITS[k]


def near_boundary(dx, dy, radius, deadzone=DEADZONE, eps_deg=1e-6, eps_rel=1e-9):
    """vero se (dx, dy) e' praticamente su un confine (settore o zona morta): quei casi non si confrontano"""
    if radius > 0 and abs(math.hypot(dx, dy) - deadzone * radius) <= eps_rel * max(1.0, radius):
        return True
    if dx == 0 and dy == 0:
        return False
    a = (angle_deg(dx, dy) - 22.5) % 45.0
    return min(a, 45.0 - a) <= eps_deg


def run_events(mode, geom, events, deadzone=DEADZONE):
    """applica gli eventi in ordine e ritorna i bit dopo ciascuno.
    geom = [cx, cy, raggio]; evento = [op, id, x, y] con op in 'dir', 'fire', 'move', 'up', 'reset'"""
    cx, cy, radius = geom
    if mode not in ("cross", "float"):
        mode = "cross"
    direction = None          # (id, centro_x, centro_y, x, y)
    fires = []                # identificativi delle dita sul fuoco
    out = []
    for op, pid, x, y in events:
        held = (direction is not None and direction[0] == pid) or pid in fires
        if op == "dir":
            if direction is None and not held:
                if mode == "float":
                    direction = (pid, x, y, x, y)
                else:
                    direction = (pid, cx, cy, x, y)
        elif op == "fire":
            if not held:
                fires.append(pid)
        elif op == "move":
            if direction is not None and direction[0] == pid:
                direction = (pid, direction[1], direction[2], x, y)
        elif op == "up":
            if direction is not None and direction[0] == pid:
                direction = None
            fires = [f for f in fires if f != pid]
        elif op == "reset":
            direction = None
            fires = []
        b = FIRE if fires else 0
        if direction is not None:
            b |= dir_bits(direction[3] - direction[1], direction[4] - direction[2], radius, deadzone)
        out.append(b)
    return out
