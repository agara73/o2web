#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac G7000 per ZX Spectrum
"""o2hw.py - modello hardware di riferimento (Python) del chip video 8244/8245 e dei collegamenti della console.

Questo e' il RIFERIMENTO della tappa 3: il codice Z80 si confronta con questo modello (stesso metodo di ref8048.py per la CPU).
Codice originale; i FATTI sull'hardware sono ricavati leggendo il sorgente MAME (`i8244.cpp`, `odyssey2.cpp`) come
documentazione e sono tutti DA VERIFICARE con hardware o documentazione ufficiale. Dove il modello semplifica di proposito
lo si dice (vedi "Semplificazioni").

Modello del tempo
  Il chip video lavora in "dot clock" (due per pixel logico): 18 dot per ciclo macchina 8048 sul G7000 PAL (8245: 456 dot per
  riga, 313 righe, fotogramma = 142728 dot = 7929,33 cicli), 20 dot per ciclo sul NTSC (455 x 263). La posizione del raggio e'
  una funzione pura del tempo emulato: dot = DPC * tempo (all'istante 0 il raggio e' a riga 0, colonna 0).
  Uscite che dipendono dalla posizione (funzioni pure): T1 = vblank | hblank, bit 0 dello stato (0xA1), registri 0xA4/0xA5.
  Due EVENTI per fotogramma, in ordine: (R) inizio dell'area attiva (riga 0, dot 0 = k * fotogramma): si calcolano grafica e
  collisioni del fotogramma con i registri di quell'istante; (I) inizio del vblank (riga 242, dot 365): si imposta il bit 3 dello
  stato e si asserisce /INT; la lettura di 0xA1 lo azzera. Un evento al dot D ha tempo (in cicli) ceil(D / DPC).
  Perche' si calcola alla riga 0 e non a fine fotogramma: i giochi modificano i registri durante il vblank (aggiornamento per il
  fotogramma dopo) e talvolta a meta' schermo (la cartuccia di prova lo fa alla riga ~219); lo stato alla riga 0 e' quello
  che governa quasi tutto lo schermo.

Semplificazioni (da riportare nel codice Z80)
  * FOTOGRAMMA INTERO: uscita grafica e collisioni si calcolano una volta per fotogramma, all'evento R (riga 0), con i registri di
    quell'istante (MAME aggiorna per scansione). Le collisioni arrivano quindi tutte insieme all'inizio del fotogramma e i giochi
    che cambiano i registri a meta' schermo (barre di colore, punteggi in basso) non sono fedeli nella parte sotto la modifica.
  * Nessuna emulazione del "priority map" di MAME (glitch dei caratteri maggiori sovrapposti): due oggetti maggiori si
    disegnano entrambi e i loro pixel collidono (se il bit 0x80 e' abilitato nella maschera di collisione).
  * Suono (registri 0xA7-0xAA e interrupt del suono) non modellato (tappa 4). Nessun CX/EF934x (G7400, tappa 7).
  * Solo STRT T e il timer interno: il modo contatore su T1 non e' supportato con T1 calcolato dal tempo.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import ref8048 as R  # noqa: E402


# ------------------------------------------------------------------------------------------------ parametri video
class Timing:
    def __init__(self, name, htotal, vtotal, vb_start, vb_end, hb_start, hb_end, bgate, dpc):
        self.name = name
        self.htotal, self.vtotal = htotal, vtotal
        self.vb_start, self.vb_end = vb_start, vb_end
        self.hb_start, self.hb_end = hb_start, hb_end
        self.bgate = bgate
        self.dpc = dpc                                   # dot clock per ciclo macchina dell'8048
        self.frame = htotal * vtotal                     # dot per fotogramma
        self.irq_dot = vb_start * htotal + (hb_start - 1)  # istante (dot nel fotogramma) dell'evento di vblank
        self.ntsc = vtotal == 263


PAL = Timing("PAL (8245)", 456, 313, 242, 312, 366, 454, 414, 18)
NTSC = Timing("NTSC (8244)", 455, 263, 242, 0, 366, 453, 413, 20)

VIS_W, VIS_H = 360, 243           # area visibile in dot (MAME: set_screen_size(360, 243))


def bit(v, n):
    return (v >> n) & 1


# ------------------------------------------------------------------------------------------------ chip video
class Vdc:
    """Registri e comportamento dell'8244/8245. `charset`: 512 byte (ROM interna dei caratteri, forniti dall'utente)."""

    def __init__(self, charset, timing=PAL):
        assert len(charset) == 512
        self.charset = bytes(charset)
        self.t = timing
        self.reg = bytearray(256)
        self.ctl_status = 0
        self.col_status = 0
        self.xbeam = 0
        self.ybeam = 0
        self.irq = False
        self.ev = 0                                      # indice del prossimo evento: pari = R (riga 0), dispari = I (vblank)
        self.lp_coll = False                             # True: le collisioni vengono da lp.collisions invece che dal modello a dot
        self.render = True                               # False: l'evento R non calcola grafica ne' collisioni (prove dello strato di aggancio)

    # -- tempo
    def next_event_cycle(self):
        """Tempo (cicli) del prossimo evento (R o I)."""
        d = (self.ev >> 1) * self.t.frame + (self.t.irq_dot if self.ev & 1 else 0)
        return -(-d // self.t.dpc)

    def pos(self, cyc):
        d = (cyc * self.t.dpc) % self.t.frame
        return d // self.t.htotal, d % self.t.htotal      # (v, h)

    def hblank(self, h):
        t = self.t
        if t.hb_end < t.hb_start:
            return h >= t.hb_start or h < t.hb_end
        return t.hb_start <= h < t.hb_end

    def vblank(self, v, h):
        t = self.t
        if (v == t.vb_start and h >= t.hb_start - 1) or (v == t.vb_end and h <= t.hb_start - 1):
            return True
        if t.vb_end < t.vb_start:
            return v > t.vb_start or v < t.vb_end
        return t.vb_start < v < t.vb_end

    def t1(self, cyc):
        v, h = self.pos(cyc)
        return 1 if (self.vblank(v, h) or self.hblank(h)) else 0

    def ybeam_now(self, cyc):
        v, h = self.pos(cyc)
        if v == 0 and h < self.t.hb_start:
            v = self.t.vtotal
        if h >= self.t.bgate:
            v += 1
        return min(v, 263)

    def xbeam_now(self, cyc):
        return self.pos(cyc)[1] >> 1

    # -- eventi: R = calcolo del fotogramma, I = vblank (stato + interrupt)
    def event(self):
        kind = self.ev & 1
        self.ev += 1
        if kind == 0:
            if self.lp_coll:                                     # collisioni a pixel logici (lp.py del progetto Spectrum, non incluso: serve solo con lp_coll=True), come il Z80
                import lp
                self.col_status |= lp.collisions(bytes(self.reg), self.charset)
                return None
            return self.render_frame() if self.render else None
        self.ctl_status |= 0x08
        self.irq = True
        return None

    # -- registri
    @staticmethod
    def mirror(off):
        if (off & 0xC2) == 0x40:
            off &= ~0x0C
        if (off & 0xE0) == 0xA0:
            off &= ~0x10
        return off & 0xFF

    def read(self, off, cyc):
        off = self.mirror(off)
        r = self.reg
        if off == 0xA1:
            d = self.ctl_status
            v, h = self.pos(cyc)
            if h >= 225 and h < self.t.bgate and self.ybeam_now(cyc) <= self.t.vb_start:
                d |= 1
            d |= r[0xA0] & 0x02
            self.irq = False
            self.ctl_status &= ~0xCC
            return d
        if off == 0xA2:
            d = self.col_status
            self.col_status = 0
            return d
        if off == 0xA4:
            return (self.ybeam_now(cyc) & 0xFF) if r[0xA0] & 0x02 else self.ybeam
        if off == 0xA5:
            return (self.xbeam_now(cyc) & 0xFF) if r[0xA0] & 0x02 else self.xbeam
        if off in (0x02, 0x06, 0x0A, 0x0E, 0xA3, 0xA7, 0xA8, 0xA9):
            return 0
        d = r[off]
        if off < 0x80 and (r[0xA0] & 0x20):
            return 0
        if off >= 0xC0 and (r[0xA0] & 0x08):
            return 0
        return d

    def write(self, off, data, cyc):
        off = self.mirror(off)
        r = self.reg
        data &= 0xFF
        if off < 0x80 and (r[0xA0] & 0x20):
            return
        if (off >= 0xC0 and (r[0xA0] & 0x08)) or off >= 0xF0:
            return
        if (off & 0x83) == 0x03:
            data &= 0x0F
        if off >= 0x10 and (off & 0x83) == 0x00:
            data &= ~0x01 & 0xFF
        if (off & 0xF0) == 0xD0:
            data &= 0x01
        if off == 0xA0:
            if (r[0xA0] & 0x02) and not (data & 0x02):
                self.xbeam = self.xbeam_now(cyc) & 0xFF
                self.ybeam = self.ybeam_now(cyc) & 0xFF
        elif off in (0xA1, 0xA4, 0xA5):
            return
        elif off == 0xAA:
            data &= ~0x40 & 0xFF
        elif off in (0x03, 0x07, 0x0B, 0x0F, 0xA6, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF) or 0xC9 <= off <= 0xCF \
                or 0xD9 <= off <= 0xDF or 0xEA <= off <= 0xEF:
            return
        r[off] = data

    # -- grafica e collisioni
    def render_frame(self, want_bitmap=True):
        """Calcola il fotogramma (area visibile 360 x 243 dot). Aggiorna col_status. Ritorna la bitmap (lista di 243 bytearray
        con indici di colore 0..15) oppure None. Struttura per scansione identica a MAME, senza priority map."""
        r = self.reg
        ctl = r[0xA0]
        cm = r[0xA2]
        bg = ((r[0xA3] >> 3) & 1) << 2 | ((r[0xA3] >> 4) & 1) << 1 | ((r[0xA3] >> 5) & 1)
        gcol = ((r[0xA3] >> 6) & 1) << 3 | (r[0xA3] & 1) << 2 | ((r[0xA3] >> 1) & 1) << 1 | ((r[0xA3] >> 2) & 1)
        bm = [bytearray([bg]) * VIS_W for _ in range(VIS_H)] if want_bitmap else None
        ntsc = self.t.ntsc
        cs = self.charset
        st = 0                                    # accumulo di col_status (8 bit)
        for sl in range(VIS_H):
            cmap = [0] * VIS_W                    # u16 per dot (solo area visibile: fuori e' ritagliato come in MAME)
            row = bm[sl] if want_bitmap else None

            def put(px, mask, color):
                nonlocal st
                if 0 <= px < VIS_W:
                    colx = cmap[px] & 0xFF
                    if cm & colx:
                        st |= mask & 0xFF
                    if cm & mask & 0xFF:
                        st |= colx
                    cmap[px] |= mask
                    if row is not None:
                        row[px] = color

            def mark(px, mask, color):            # griglia: nessun controllo di collisione (e' il primo strato)
                if 0 <= px < VIS_W:
                    cmap[px] |= mask
                    if row is not None:
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
            if (ctl & 0x20):
                # oggetti maggiori: prima i quad (3..0), poi i singoli (11..0); il disegno e' solo "pixel acceso"
                def major_row(y, x0, ptr, colr, count_start):
                    off = (ptr | ((colr & 1) << 8)) + (y >> 1) + ((sl - y) >> 1)
                    color = 8 + ((colr >> 1) & 7)
                    data = cs[off & 0x1FF]
                    x = x0
                    for cx in range(8):
                        if (data >> (cx ^ 7)) & 1:
                            for px in (x, x + 1):
                                put(px, 0x80, color)
                        x += 2

                for i in range(3, -1, -1):
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
                            major_row(y, x, r[base + 4 * j + 2], r[base + 4 * j + 3], 0)
                            x += 32
                for i in range(11, -1, -1):
                    base = 0x10 + 4 * i
                    y = r[base]
                    if ntsc and y < 0x0E:
                        continue
                    height = 7 - (((y >> 1) + r[base + 2]) & 7)
                    if height == 0:
                        height = 8
                    if y <= sl < y + height * 2:
                        major_row(y, (r[base + 1] + 5) * 2, r[base + 2], r[base + 3], 0)
                # sprite (minor system)
                for i in range(3, -1, -1):
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
            # passo dei casi limite sulla scansione (pixel adiacenti), come in MAME
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
        self.col_status |= st & 0xFF
        return bm


# ------------------------------------------------------------------------------------------------ tastiera e joystick
class Keys:
    """Stato dei tasti: 8 righe da 8 bit (tastiera, 1 = premuto) e 2 joystick (bit 0 su, 1 destra, 2 giu', 3 sinistra, 4 fuoco)."""

    def __init__(self):
        self.rows = [0] * 8
        self.joy = [0, 0]


def key_code(row8):
    """Codifica del 74148: bit 5-7 = zeri iniziali della riga (bit 7 = priorita' piu' alta), bit 4 = 0 se c'e' un tasto."""
    if row8 == 0:
        return 0xFF
    lz = 0
    while not (row8 & (0x80 >> lz)):
        lz += 1
    return (lz << 5) | 0x0F


# ------------------------------------------------------------------------------------------------ ambiente della console
class O2Env(R.Env):
    """Sostituisce l'ambiente di prova di ref8048.Env: MOVX verso RAM esterna da 128 byte e chip video, T1/INT calcolati dal
    tempo, tastiera e joystick. `cpu` va impostato dopo la creazione. Con lazy=True (BlockRef) gli eventi di vblank non si
    applicano da soli: li applica il chiamante con apply_window()."""

    def __init__(self, vdc, keys, prog=None, lazy=False):
        super().__init__(prog)
        self.vdc = vdc
        self.keys = keys
        self.lazy = lazy
        self.cpu = None
        self.xram80 = bytearray(0x80)               # RAM 6810 da 128 byte
        self.frames = []                             # (indice evento, bitmap, col_status dopo il calcolo)
        self.keep_bitmaps = False

    # -- eventi di vblank
    def apply_upto(self, cyc, strict=False):
        v = self.vdc
        while (v.next_event_cycle() < cyc) if strict else (v.next_event_cycle() <= cyc):
            n = v.ev
            bm = v.event()
            if n & 1 == 0:
                self.frames.append((n >> 1, bm if self.keep_bitmaps else None, v.col_status))

    def apply_window(self, limit):
        self.apply_upto(limit, strict=True)

    def sync(self):
        if not self.lazy:
            self.apply_upto(self.cpu.now)

    # -- pin
    @property
    def int_active(self):
        self.sync()
        return 1 if self.vdc.irq else 0

    @int_active.setter
    def int_active(self, v):
        pass

    @property
    def t1(self):
        return self.vdc.t1(self.cpu.now)

    @t1.setter
    def t1(self, v):
        pass

    @property
    def t0(self):
        return 0

    @t0.setter
    def t0(self, v):
        pass

    @property
    def p1_pin(self):
        return 0xFF

    @p1_pin.setter
    def p1_pin(self, v):
        pass

    @property
    def p2_pin(self):
        c = self.cpu
        d = 0xFF
        if not (c.p1 & 0x04):
            code = key_code(self.keys.rows[c.p2 & 7])
            if code != 0xFF:
                d &= code
        return d

    @p2_pin.setter
    def p2_pin(self, v):
        pass

    @property
    def bus_pin(self):
        c = self.cpu
        d = 0xFF
        if not (c.p1 & 0x04):
            sel = c.p2 & 7
            if sel < 2:
                d &= ~self.keys.joy[sel] & 0xFF
        return d

    @bus_pin.setter
    def bus_pin(self, v):
        pass

    # -- MOVX
    def movx_r(self, a):
        a &= 0xFF
        self.sync()
        c = self.cpu
        d = 0xFF
        if not (c.p1 & 0x10) and not (a & 0x80):
            d &= self.xram80[a]
        if (c.p1 & 0x48) == 0:
            d &= self.vdc.read(a, c.now)
        return d

    def movx_w(self, a, v):
        a &= 0xFF
        self.sync()
        c = self.cpu
        v &= 0xFF
        if not (c.p1 & 0x40):
            if not (c.p1 & 0x10) and not (a & 0x80):
                self.xram80[a] = v
        if not (c.p1 & 0x08):
            self.vdc.write(a, v, c.now)


class Machine:
    """CPU 8048 di riferimento + ambiente della console (modello a istruzioni). Immagine: 4096 byte (BIOS + cartuccia)."""

    def __init__(self, image, charset, timing=PAL, keys=None):
        self.vdc = Vdc(charset, timing)
        self.keys = keys or Keys()
        self.env = O2Env(self.vdc, self.keys, image)
        self.cpu = R.CPU(self.env)
        self.env.cpu = self.cpu
        self.ops = {}

    def step(self):
        op, cyc = self.cpu.step()
        self.ops[op] = self.ops.get(op, 0) + 1
        return op, cyc

    def run_cycles(self, n):
        end = self.cpu.now + n
        while self.cpu.now < end:
            self.step()

    def run_frames(self, n):
        self.run_cycles(int(n * self.vdc.t.frame / self.vdc.t.dpc))


# ------------------------------------------------------------------------------------------------ utilita' per le prove
def own_charset():
    """Set di caratteri originale di ripiego (hw/charset_own.js)."""
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    return subprocess.run(["node", "-e", "process.stdout.write(require(process.argv[1]).build())", os.path.join(here, "charset_own.js")],
                          check=True, capture_output=True).stdout


def stand_in_charset(seed=1):
    """512 byte di prova (NON e' la ROM vera): serve solo a confrontare Z80 e modello su basi uguali."""
    import random
    rnd = random.Random(seed)
    out = bytearray()
    for ch in range(64):
        for row in range(8):
            out.append(rnd.getrandbits(8) & rnd.getrandbits(8) | (0x18 if row in (2, 3) else 0))
    return bytes(out)


def load_image(bios_path, cart_path):
    b = open(bios_path, "rb").read()
    c = open(cart_path, "rb").read()
    img = bytearray(4096)
    img[:len(b)] = b
    img[0x400:0x400 + len(c)] = c
    return bytes(img)


PALETTE = [(0, 0, 0), (0xB6, 0, 0), (0, 0xB6, 0), (0xB6, 0xB6, 0), (0, 0, 0xB6), (0xB6, 0, 0xB6), (0, 0xB6, 0xB6),
           (0xB6, 0xB6, 0xB6), (0x49, 0x49, 0x49), (0xFF, 0x49, 0x49), (0x49, 0xFF, 0x49), (0xFF, 0xFF, 0x49),
           (0x49, 0x49, 0xFF), (0xFF, 0x49, 0xFF), (0x49, 0xFF, 0xFF), (0xFF, 0xFF, 0xFF)]


def bitmap_to_png(bm, path, lum=False, scale=2):
    from PIL import Image
    img = Image.new("RGB", (VIS_W // 2, VIS_H // 2 + 1))
    px = img.load()
    for y in range(VIS_H // 2 + 1):
        for x in range(VIS_W // 2):
            c = bm[min(y * 2, VIS_H - 1)][x * 2] | (8 if lum else 0)
            px[x, y] = PALETTE[c]
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(path)


if __name__ == "__main__":
    sys.exit("modulo di libreria: vedi test_o2hw.py e run_ref.py")
