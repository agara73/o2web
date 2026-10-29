#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""o2line.py - modello hardware di riferimento PER RIGA DI SCANSIONE (tappa 2): chip video 8244/8245, T1 come fronti, mappa
della cartuccia con cambio di banco. E' l'ORACOLO con cui si confrontano src/vdc.js e src/console.js (test/line_*).

Estende hw/o2hw.py (che resta com'e': e' il riferimento della tappa 1) togliendo le semplificazioni nate per lo Spectrum:

  * FOTOGRAMMA INTERO -> RIGA PER RIGA. Il fotogramma ha 244 eventi: 243 eventi di riga (riga 0..242 dell'area visibile, al dot
    k * htotal della riga) e l'evento di vblank (riga 242, dot 365: stato bit 3 e /INT). All'evento di riga si disegna QUELLA riga
    con i registri di quell'istante e si accumulano le collisioni nello stato (0xA2): una scrittura di registro fatta a meta'
    schermo vale dalla riga successiva. (DA VERIFICARE sul chip vero: l'istante preciso in cui il chip legge i registri per la
    riga; qui il dot 0 della riga, perche' lo schema e' quello della scansione di MAME ma senza copiarne il codice.)
  * MODO CONTATORE SU T1. T1 = vblank | hblank e' una funzione pura del tempo; i suoi cambi di livello (circa 2 x 243 per
    fotogramma) sono eventi (tabella dei cambi su un periodo di 3 fotogrammi PAL / 4 NTSC, in cicli interi), applicati ai
    confini fra istruzioni: la CPU conta i fronti di discesa con STRT CNT.
  * MAPPA DELLA CARTUCCIA con cambio di banco, specchio 0xC00 e 4 KB lineare (vedi ProgMap).

Semplificazioni che RESTANO (motivate):
  * Nessun "priority map" dei caratteri maggiori sovrapposti: nessun dato verificabile (nessun dump o documento nel progetto);
    due oggetti maggiori si disegnano entrambi e i loro pixel collidono se la maschera di collisione lo consente (DA VERIFICARE).
  * Nessun EF934x (G7400): tappa 5.

Aggiunto in tappa 3: SUONO (registri 0xA7-0xAA) e interrupt del suono, a eventi come il video (DA VERIFICARE, come ogni fatto
sull'hardware ricavato da documentazione di altri emulatori letta come tale):
  * Registro a scorrimento a 24 bit: 0xA9 = byte basso, 0xA8, 0xA7 = byte alto. Controllo 0xAA: bit 7 uscita abilitata, bit 5 frequenza
    (1: scorre ogni 4 righe, 0: ogni 16), bit 4 rumore (retroazione = bit 0 xor bit 5 pre-scorrimento, nel bit 15), bit 0-3 volume.
  * Un evento di suono per OGNI riga di scansione del fotogramma completo (313 PAL, 263 NTSC), al dot hb_start della riga (ciclo =
    ceil(dot / dot-per-ciclo)). Il prescaler (8 bit) conta gli eventi; quando (prescaler & maschera) == 0 lo scorrimento diventa
    "pendente"; se e' pendente e dall'ultimo evento NESSUNO dei registri 0xA7-0xA9 e' stato scritto, il registro scorre di un bit:
    uscita = bit 0 prima dello scorrimento, il bit uscente rientra nel bit 23 (e, col rumore, la retroazione nel bit 15). Se invece e' stato
    scritto un registro, il contatore degli scorrimenti si azzera e lo scorrimento pendente resta per l'evento dopo.
  * Ogni 24 scorrimenti, se il bit 2 di 0xA0 e' 1: bit 2 dello stato (0xA1) e /INT. La lettura di 0xA1 li azzera (come per il vblank).
  * Livello di uscita = (uscita & bit 7 di 0xAA) * volume (0..15). snd_log registra (ciclo, livello) a ogni cambio (evento o scrittura
    di 0xAA).
  * Ordine a parita' di istante: eventi video, poi suono, poi T1.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import o2hw  # noqa: E402
import ref8048 as R  # noqa: E402
from o2hw import PAL, NTSC, VIS_W, VIS_H, Keys, key_code, bit  # noqa: E402,F401

EV_PER_FRAME = VIS_H + 1          # 243 righe + vblank


class LineVdc(o2hw.Vdc):
    def __init__(self, charset, timing=PAL):
        super().__init__(charset, timing)
        self.fb = [bytearray(VIS_W) for _ in range(VIS_H)]
        self.frame_done = 0                       # numero di fotogrammi completati (riga 242 disegnata)
        self.line_log = None                      # se e' una lista: (k, col_status dopo, crc32 della riga) per ogni evento di riga
        t = self.t
        g = math.gcd(t.frame, t.dpc)
        kf = t.dpc // g                           # fotogrammi per periodo (PAL 3, NTSC 4)
        self.t1_period = kf * t.frame // t.dpc    # cicli per periodo
        seq = [self.t1(c) for c in range(self.t1_period)]
        self.t1_table = [(c, seq[c]) for c in range(self.t1_period) if seq[c] != seq[c - 1]]
        self.t1_i = 0
        # suono
        self.sn = 0                               # indice del prossimo evento di suono (uno per riga di scansione)
        self.sh_prescaler = 0
        self.sh_pending = False
        self.sh_written = False
        self.sh_count = 0
        self.sh_output = 0
        self.snd_log = None                       # se e' una lista: (ciclo, livello) a ogni cambio del livello di uscita

    # -- suono
    def snd_next_cycle(self):
        t = self.t
        return -(-(self.sn * t.htotal + t.hb_start) // t.dpc)

    def level(self):
        c = self.reg[0xAA]
        return (c & 15) if (self.sh_output & (c >> 7)) else 0

    def snd_event(self):
        cyc = self.snd_next_cycle()
        r = self.reg
        lvl0 = self.level()
        self.sn += 1
        self.sh_prescaler = (self.sh_prescaler + 1) & 0xFF
        mask = 3 if r[0xAA] & 0x20 else 0xF
        if self.sh_prescaler & mask == 0:
            self.sh_pending = True
        if self.sh_pending and not self.sh_written:
            self.sh_pending = False
            sig = r[0xA9] | (r[0xA8] << 8) | (r[0xA7] << 16)
            self.sh_output = sig & 1
            fb = self.sh_output
            sig >>= 1
            if r[0xAA] & 0x10:
                fb ^= (sig >> 4) & 1
                sig = (sig & ~0x8000) | (fb << 15)
            sig |= fb << 23
            r[0xA9], r[0xA8], r[0xA7] = sig & 0xFF, (sig >> 8) & 0xFF, (sig >> 16) & 0xFF
            self.sh_count += 1
            if self.sh_count == 24:
                self.sh_count = 0
                if r[0xA0] & 0x04:
                    self.ctl_status |= 0x04
                    self.irq = True
        elif self.sh_written:
            self.sh_count = 0
            self.sh_written = False
        lvl1 = self.level()
        if lvl1 != lvl0 and self.snd_log is not None:
            self.snd_log.append((cyc, lvl1))

    def write(self, off, data, cyc):
        o = self.mirror(off)
        lvl0 = self.level()
        super().write(off, data, cyc)
        if 0xA7 <= o <= 0xA9:
            self.sh_written = True
        elif o == 0xAA and self.snd_log is not None and self.level() != lvl0:
            self.snd_log.append((cyc, self.level()))

    def advance_to(self, c):
        """Applica in ordine di tempo gli eventi video e di suono scaduti (<= c). Per le prove del chip video da solo."""
        while True:
            cv, cs = self.next_event_cycle(), self.snd_next_cycle()
            if cv <= cs:
                if cv > c:
                    break
                self.event()
            else:
                if cs > c:
                    break
                self.snd_event()

    def snd_state(self):
        return [self.sn, self.sh_prescaler, int(self.sh_pending), int(self.sh_written), self.sh_count, self.sh_output,
                int(self.irq), self.ctl_status]

    # -- eventi video
    def next_event_cycle(self):
        t = self.t
        f, j = divmod(self.ev, EV_PER_FRAME)
        d = f * t.frame + (j * t.htotal if j < VIS_H else t.irq_dot)
        return -(-d // t.dpc)

    def event(self):
        k = self.ev
        self.ev += 1
        j = k % EV_PER_FRAME
        if j < VIS_H:
            st = self.render_line(j)
            self.col_status |= st
            if j == VIS_H - 1:
                self.frame_done += 1
            if self.line_log is not None:
                import zlib
                self.line_log.append((k, self.col_status, zlib.crc32(bytes(self.fb[j]))))
            return j
        self.ctl_status |= 0x08
        self.irq = True
        if self.line_log is not None:
            self.line_log.append((k, self.ctl_status | (0x100 if self.irq else 0), 0))
        return None

    # -- cambi di livello di T1
    def t1_next_cycle(self):
        n = len(self.t1_table)
        return (self.t1_i // n) * self.t1_period + self.t1_table[self.t1_i % n][0]

    def t1_pop(self):
        n = len(self.t1_table)
        lvl = self.t1_table[self.t1_i % n][1]
        self.t1_i += 1
        return lvl

    # -- una riga di scansione: ritorna l'accumulo delle collisioni (8 bit); la riga colorata e' in self.fb[sl]
    def render_line(self, sl):
        r = self.reg
        ctl = r[0xA0]
        cm = r[0xA2]
        bg = ((r[0xA3] >> 3) & 1) << 2 | ((r[0xA3] >> 4) & 1) << 1 | ((r[0xA3] >> 5) & 1)
        gcol = ((r[0xA3] >> 6) & 1) << 3 | (r[0xA3] & 1) << 2 | ((r[0xA3] >> 1) & 1) << 1 | ((r[0xA3] >> 2) & 1)
        row = self.fb[sl]
        for i in range(VIS_W):
            row[i] = bg
        ntsc = self.t.ntsc
        cs = self.charset
        st = 0
        cmap = [0] * VIS_W

        def put(px, mask, color):
            nonlocal st
            if 0 <= px < VIS_W:
                colx = cmap[px] & 0xFF
                if cm & colx:
                    st |= mask & 0xFF
                if cm & mask & 0xFF:
                    st |= colx
                cmap[px] |= mask
                row[px] = color

        def mark(px, mask, color):                # griglia: nessun controllo di collisione (e' il primo strato)
            if 0 <= px < VIS_W:
                cmap[px] |= mask
                row[px] = color

        if (ctl & 0x08) and 24 <= sl <= 218:
            w = 16 if (ctl & 0x80) else 2
            for y in range(9):
                if 24 + y * 24 <= sl < 24 + y * 24 + 3:
                    for i in range(9):
                        if bit(r[0xD0 + i] << 8 | r[0xC0 + i], y):
                            for k in range(18):
                                x = (13 + i * 16 + k) * 2
                                mark(x, 0x20, gcol), mark(x + 1, 0x20, gcol)
                    if ctl & 0x40:
                        for i in range(10):
                            for k in range(2):
                                x = (13 + i * 16 + k) * 2
                                mark(x, 0x20, gcol), mark(x + 1, 0x20, gcol)
            for y in range(8):
                if 24 + y * 24 <= sl < 24 + (y + 1) * 24:
                    for i in range(10):
                        if r[0xE0 + i] & (1 << y):
                            for k in range(w):
                                x = (13 + i * 16 + k) * 2
                                mark(x, 0x10, gcol), mark(x + 1, 0x10, gcol)
        if ctl & 0x20:
            def major_row(y, x0, ptr, colr):
                off = (ptr | ((colr & 1) << 8)) + (y >> 1) + ((sl - y) >> 1)
                color = 8 + ((colr >> 1) & 7)
                data = cs[off & 0x1FF]
                x = x0
                for cx in range(8):
                    if (data >> (cx ^ 7)) & 1:
                        for px in (x, x + 1):
                            put(px, 0x80, color)
                    x += 2

            for i in range(3, -1, -1):                # gruppi da 4 caratteri
                base = 0x40 + 16 * i
                y = r[base]
                if ntsc and y < 0x0E:
                    continue
                ptr3 = r[base + 12 + 2]
                height = 7 - (((y >> 1) + ptr3) & 7)
                if height == 0:
                    height = 8
                if y <= sl < y + height * 2:
                    x = (r[base + 1] + 5) * 2
                    for j in range(4):
                        major_row(y, x, r[base + 4 * j + 2], r[base + 4 * j + 3])
                        x += 32
            for i in range(11, -1, -1):               # caratteri singoli
                base = 0x10 + 4 * i
                y = r[base]
                if ntsc and y < 0x0E:
                    continue
                height = 7 - (((y >> 1) + r[base + 2]) & 7)
                if height == 0:
                    height = 8
                if y <= sl < y + height * 2:
                    major_row(y, (r[base + 1] + 5) * 2, r[base + 2], r[base + 3])
            for i in range(3, -1, -1):                # sprite
                y = r[4 * i]
                zoom = bool(r[4 * i + 2] & 4)
                zp = 4 if zoom else 2
                if y <= sl < y + 8 * zp:
                    color = 8 + ((r[4 * i + 2] >> 3) & 7)
                    chr_ = r[0x80 + 8 * i + ((sl - y) // zp)]
                    x = (r[4 * i + 1] + 5) * 2
                    a = r[4 * i + 2] & 3
                    rr = ((sl - y) // zp) & 1
                    xs = 0
                    if a == 1:
                        xs = 1
                    elif a == 2:
                        xs = rr ^ 1
                    elif a == 3:
                        xs = rr
                    x += xs * (zp // 2)
                    mask = (0x101 if zoom else 1) << i
                    m = 1
                    while m < 0x100:
                        if chr_ & m:
                            for px in range(x, x + zp):
                                put(px, mask, color)
                        m <<= 1
                        x += zp
        # passo dei pixel adiacenti
        for x in range(1, VIS_W):
            colx0 = cmap[x - 1]
            colx1 = cmap[x]
            if colx1 & 0x80:
                if cm & colx0 & 0x3F:
                    st |= 0x80
                if cm & 0x80:
                    st |= colx0 & 0x3F
            mask = (colx1 & 0xF) & ((~colx1 >> 8) & 0xFF)
            if cm & colx0 & 0x30:
                st |= mask
            if cm & mask:
                st |= colx0 & 0x30
        self.last_cmap = cmap                      # (G7400: serve al passo delle collisioni CX, hw/o2g7400.py)
        return st & 0xFF


# ------------------------------------------------------------------------------------------------ mappa della cartuccia
def _jmp_vec(b, off):
    return off + 2 < len(b) and (b[off] & 0x1F) == 4 and (b[off + 2] & 0x1F) == 4


class ProgMap:
    """Memoria programma vista dalla CPU (4 KB). Stessa logica di src/cartmap.js (DA VERIFICARE, ricavata dai dump):
         0x000-0x3FF  BIOS (1 KB, ROM interna dell'8048)
         0x400-0xFFF  cartuccia. Schema 'rally' (16 KB, e 12 KB come parte alta di 16 KB): vedi src/cartmap.js. Schema 'std': il file e' una sequenza di BANCHI da 2 KB e il banco visibile e' P1 & (banchi-1)
                      (bit 0-1 di P1) per 1, 2, 4 banchi (2, 4, 8 KB); al reset P1 = 0xFF: parte l'ULTIMO banco; 0xC00-0xFFF e'
                      lo specchio di 0x800-0xBFF. Schema 'linear' (4 KB con i vettori a offset 0x400 del file): a -> file[a].
                      Schema 'big' (12/16 KB): schema non noto, si usano i primi 4 banchi (cartuccia NON SUPPORTATA).
       Accesso con prog[a]: serve alla CPU di riferimento (ref8048.CPU legge env.prog[indirizzo])."""

    def __init__(self, bios, cart, env):
        self.bios = bytes(bios) + bytes(0x400 - len(bios))
        self.cart = None
        self.kind = 'none'
        self.mask = 0
        if cart:
            n = (len(cart) + 0x7FF) // 0x800
            self.cart = bytes(cart) + bytes([0xFF]) * (n * 0x800 - len(cart))
            if n == 6:                             # 12 KB: parte alta di una finestra da 16 KB (come cartmap.js)
                self.cart = bytes([0xFF]) * 0x1000 + self.cart
                n = 8
            if n == 8:
                self.kind, self.mask = 'rally', 7
            elif n > 4:
                self.kind, self.mask = 'big', 3
            elif n == 2 and _jmp_vec(self.cart, 0x400) and not _jmp_vec(self.cart, 0x800):
                self.kind, self.mask = 'linear', 0
            else:
                self.kind, self.mask = 'std', (0 if n <= 1 else 1 if n == 2 else 3)
        self.env = env

    def __getitem__(self, a):
        a &= 0xFFF
        if a < 0x400:
            return self.bios[a]
        if not self.cart:
            return 0xFF
        if self.kind == 'linear':
            return self.cart[a]
        if self.kind == 'rally':
            p1 = self.env.cpu.p1
            bank = 0xFF if (p1 & 1) else self.env.cart_bank
            return self.cart[((bank << 11) | ((a & 0x800) >> 1) | (a & 0x3FF)) & 0x3FFF]
        return self.cart[((self.env.cpu.p1 & self.mask) << 11) | ((a & 0x800) >> 1) | (a & 0x3FF)]


# ------------------------------------------------------------------------------------------------ CPU, ambiente, macchina
class LineCPU(R.CPU):
    def apply_events(self):
        self.env.apply_upto(self.now)


class LineEnv(o2hw.O2Env):
    def __init__(self, vdc, keys, bios, cart):
        super().__init__(vdc, keys, None)
        self.cart_bank = 0                       # latch del banco delle cartucce 'rally' (16 KB)
        self.prog = ProgMap(bios, cart, self)

    def movx_w(self, a, v):
        super().movx_w(a, v)
        if self.prog.kind == 'rally' and (a & 0x80) and not (self.cpu.p1 & 0x10) and (self.cpu.p1 & 0x08):   # p1 bit 3 = 1: chip video non selezionato (Neutron Star)
            self.cart_bank = v & 7

    def movx_r(self, a):
        """Come O2Env.movx_r, piu' la ROM dati della cartuccia 'linear' (DA VERIFICARE, ipotesi ricavata dal codice di 4 in 1 Row:
        legge con MOVX una tabella nel primo KB del file, con P2 (bit 0-3) come byte alto dell'indirizzo): risponde quando ne' la
        RAM ne' il chip video sono in lettura."""
        a &= 0xFF
        d = super().movx_r(a)
        c = self.cpu
        pm = self.prog
        if pm.kind == 'linear' and ((c.p1 & 0x10) or (a & 0x80)) and (c.p1 & 0x48) != 0:
            d &= pm.cart[((c.p2 & 0x0F) << 8) | a]
        return d

    def apply_upto(self, cyc, strict=False):
        v = self.vdc
        cpu = self.cpu
        while True:
            cv = v.next_event_cycle()
            cs = v.snd_next_cycle()
            ct = v.t1_next_cycle()
            c = min(cv, cs, ct)
            if (c >= cyc) if strict else (c > cyc):
                break
            if cv <= cs and cv <= ct:
                v.event()
            elif cs <= ct:
                v.snd_event()
            else:
                lvl = v.t1_pop()
                if cpu.counter_en and cpu.t1_prev == 1 and lvl == 0:      # fronte di discesa di T1
                    cpu.timer = (cpu.timer + 1) & 0xFF
                    if cpu.timer == 0:
                        cpu.overflow()
                cpu.t1_prev = lvl


class LineMachine:
    def __init__(self, bios, cart, charset, timing=PAL):
        self.vdc = LineVdc(charset, timing)
        self.keys = Keys()
        self.env = LineEnv(self.vdc, self.keys, bios, cart)
        self.cpu = LineCPU(self.env)
        self.env.cpu = self.cpu

    def step(self):
        return self.cpu.step()

    def frame_cycles(self):
        return int(self.vdc.t.frame / self.vdc.t.dpc)


def own_charset():
    return o2hw.own_charset()


if __name__ == "__main__":
    sys.exit("modulo di libreria: vedi test/line_record.py")
