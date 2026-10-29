#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""ef934x_ref.py - modello di RIFERIMENTO (lento e leggibile) della coppia Thomson EF9340 (VIN) / EF9341 (GEN) del Videopac+ G7400
e del mixer con il chip video 8245 (tappa 5). E' l'ORACOLO con cui si confronta src/ef934x.js (prove casuali di comandi, accessi e
resa per riga). Codice originale.

FONTI E AFFIDABILITA'. Il modello nasce dalla documentazione di altri emulatori (i sorgenti MAME di ef9340_1, odyssey2 e i8244, letti
come documentazione e riscritti da zero) ed e' stato poi CONFRONTATO CON IL DATASHEET Thomson Semiconducteurs «EF9340/EF9341 Semi-
graphic CRT display processor» (Advance Information, 28 pagine, fornito dall'utente il 15/10/2026; il file non e' nel progetto).
VERIFICATO sul datasheet: indirizzamento C/T e B/A, comandi 0-6, modi M (000/001/010/011/100/101, NT mod 10), trascodifica cella
(cell_addr), regole del cursore, campi del codice di finestra, tabelle della doppia altezza, ordine degli attributi, 210/250 linee
attive, finestra di 8 punti x 10 linee, significato dei bit di R, mappa degli indirizzi del generatore esterno. CORRETTO dopo il
datasheet: fetta scritta/letta tramite TA (bus A) e non TB; modo zoom (Y0 bit 5); zone di «boxing» (R bit 1, bit 1 dei delimitatori) e
uscita I; Y0 usa solo i bit 0-4 come riga; lampeggio nominale 0.5 Hz. Il datasheet NON dice (restano DA VERIFICARE): quale meta' di un
delimitatore di bordo e' trasparente, il periodo esatto del lampeggio (il nominale e' 0.5 Hz), lo scarto 15 x 5 rispetto all'8245 e il
mixer col chip video (sta nella logica del G7400, non nei due chip). Il tempo di occupato (<= 4 finestre a schermo spento, <= 44 con lo
schermo acceso) NON e' modellato: il bit resta 0 (i programmi che lo sondano escono subito; e' una semplificazione dichiarata).
Il confronto con questo modello prova che il JavaScript lo riproduce; la fedelta' all'hardware e' quella del datasheet sopra.

INTERFACCIA CON LA CPU (G7400). Accesso con MOVX quando P1 bit 5 = 0. Dei bit dell'indirizzo a 8 bit: bit 0 = B/A (1 = registro TB,
0 = TA), bit 1 = C/T (1 = comando, 0 = dati), bit 2 = lettura (collegato a R/W: se 1 l'accesso e' una lettura, se 0 una scrittura).
  comando, scrittura TA : TA <- dato (parametro)
  comando, scrittura TB : TB <- dato; il codice e' dato >> 5 e l'operando e' TA:
        0 inizio riga: X = 0, Y = TA & 0x1F        1 Y = TA & 0x1F         2 X = TA & 0x3F        3 incrementa il cursore
        4 M = TA                                    5 R = TA                6 Y0 = TA & 0x3F       7 nessun effetto
  comando, lettura TA   : bit 7 = occupato (qui sempre 0: il tempo di occupato NON e' modellato, DA VERIFICARE), gli altri bit 0
  comando, lettura TB   : 0
  dati,   scrittura TA  : TA <- dato
  dati,   scrittura TB  : TB <- dato, poi accesso alla memoria secondo M (sotto)
  dati,   lettura TA    : TA
  dati,   lettura TB    : restituisce il TB PRECEDENTE, poi accesso in lettura secondo M (TA e TB si caricano dalla memoria)
M (modo e fetta): bit 7-5 = modo: 000 scrive e incrementa, 010 scrive senza incrementare, 100 scrive una fetta, 001 legge e incrementa,
  011 legge senza incrementare, 101 legge una fetta (le altre combinazioni: nessun accesso); bit 3-0 = numero di fetta (0..9, poi 0).
  Scrittura di cella: RAM A[cella] <- TA (attributo), RAM B[cella] <- TB (codice). Lettura di cella: TA <- RAM A, TB <- RAM B.
  Fetta (DRCS): la cella e' quella del cursore (attributo e codice letti dalle RAM A e B), il dato e' TA (scrittura; va sul bus A) o va in
  TA (lettura); dopo l'accesso la fetta aumenta (modulo 10); il cursore NON si muove (datasheet). Il byte restituito da una lettura di
  TB e' il TB precedente (la prima lettura dopo il caricamento di M e' non valida, nota 2 del datasheet).
R (controllo): bit 0 schermo acceso, bit 1 boxing, bit 2 cancellazione (conceal) dai delimitatori, bit 3 riga di servizio, bit 4 cursore,
  bit 6 temporizzazione (0 = 262 linee/60 Hz e 210 linee attive, 1 = 312 linee/50 Hz e 250 attive), bit 7 lampeggio.
Cursore: X (6 bit) e Y (5 bit); dopo un incremento, se X vale 40, 48, 56 o 64: X = 0 e Y + 1 (24 -> 0, 32 -> 0).

MEMORIA. RAM A (attributi) e RAM B (codici) da 1 KB (10 bit), con indirizzo mescolato (cell_addr). Memoria estesa (DRCS) da 2 KB, con
l'indirizzo mescolato di ex_index. ROM dei caratteri: 256 voci da 10 byte (fetta 0..9); bit 0 = pixel di sinistra. Voci 0-127:
alfanumerici; voci 128-255: grafica (semigrafica) letta cosi' com'e'. La ROM la porta l'utente (non e' nel progetto).

RESA. Linea di teletext tl = riga dello schermo - offset_y; 40 celle da 8 pixel = 320 pixel, spostati di offset_x. tl 0-9 = riga di
servizio (riga 31 se R bit 3, altrimenti tutti i pixel valgono 8), poi 10 linee per riga: riga = (Y0 bit 0-4 + (tl-10)/10) mod 24, fetta = tl mod 10 (con Y0 bit 5 = zoom: 20 linee per riga, fetta = ((tl-10) mod 20)/2, riga di servizio sempre semplice);
l'area attiva finisce a tl = 210 (R bit 6 = 0) o 250 (R bit 6 = 1). Valore di pixel = colore (bit 0-2) | 8 se il pixel e' nell'area
attiva (bit 3 = «extra», lo legge il mixer); fuori dall'area (o con R bit 0 = 0) il valore e' 0.
Attributo con bit 7 = 1: modo grafico (sfondo = bit 6-4, primo piano = bit 2-0, bit 3 = niente lampeggio); codici 0x80-0x9F illegali (blocco
pieno nel primo piano corrente, senza cambiare primo piano e sfondo); codici 0xA0-0xFF dalla memoria estesa; 0x00-0x7F dalla ROM voce
(codice | 0x80). Attributo con bit 7 = 0: alfanumerico (primo piano = bit 2-0, bit 3 = niente lampeggio, bit 4 = doppia altezza, bit 5 =
doppia larghezza, bit 6 = inverso); lo sfondo e' l'ultimo impostato su quella linea da una cella grafica o da un delimitatore (0 a
inizio linea); codici 0x80-0x9F = delimitatori (colori dall'attributo: primo piano bit 2-0, sfondo bit 6-4; blocco pieno; poi
cancellazione = R bit 2 & codice bit 0, sottolineatura = codice bit 2 per le celle seguenti); codici 0xA0-0xFF dalla memoria estesa;
0x00-0x7F dalla ROM voce codice. Doppia altezza: la fetta effettiva dipende dalla parita' (0: 0,0,0,1,1,2,2,3,3,4; 1: 4,5,5,6,6,7,7,8,8,9),
che a fetta 9 di ogni riga si inverte se la riga ha celle a doppia altezza e altrimenti torna a 0 (e torna a 0 a tl = 0). Doppia
larghezza: la prima cella disegna i bit 0-3 raddoppiati, la seconda (di cui si ignora il codice) i bit 4-7. Sottolineatura: fetta
effettiva 9 tutta accesa (solo glifi della ROM). Lampeggio (R bit 7): nelle celle non delimitatrici senza il bit «niente lampeggio» e fuori
dal cursore, la fase «accesa» cancella i bit del glifo; le celle inverse usano la fase opposta. Cursore (R bit 4) alla cella (X, Y): inverte la
cella (anche i delimitatori) se R bit 7 = 0 o se la fase e' «spenta». La fase cambia ogni 60 quadri (50 con R bit 6): nominale 0.5 Hz del datasheet.
Boxing (R bit 1 = 1): il bit 1 del codice di un delimitatore dice se le finestre seguenti della riga sono «boxed» (a inizio riga: no); una
finestra non boxed vale 0 (nero, I = 0: trasparente); un delimitatore che apre la zona ha la meta' sinistra trasparente, uno che la
chiude la meta' destra, uno fuori zona e' tutto trasparente (quale meta': DA VERIFICARE). Con R bit 1 = 0 il bit 3 vale 1 in ogni finestra
attiva. Con la riga di servizio nascosta (R bit 3 = 0) il bit 3 vale 0 se il boxing e' acceso, altrimenti 1 (DA VERIFICARE).

MIXER (G7400) per pixel x di una riga dello schermo, con d = indice dell'8245 & 7, e = pixel EF (bit 3 = extra, bit 0-2 = colore),
registri di mix (latch dell'8243: mix8245 = P7 | P6 << 4, mixEF = P5 | P4 << 4, il nibble basso e' della porta con il numero piu' alto: verificato con
Trans American Rally il 15/10/2026, vedi o2web-stato.md): mix8245 (bit d: l'8245 vince), mixEF (bit e: pilota CX e luminosita' EF), pin B, LUM (P1 bit 7 = 0 -> +8 all'8245):
  en = (e & 8) o non B;  i2 = non bit (e & 7) di mixEF;  CX = i2 (attivo alto)
  se en e bit d di mix8245: uscita = indice dell'8245 | (LUM ? 8 : 0)   altrimenti: uscita = (e & 7) | (i2 ? 8 : 0)
CX (collisione esterna del 8245, DA VERIFICARE): con CX attivo nel pixel x, se la mappa delle collisioni del pixel ha qualche bit di
0x3F (sprite, griglia) e il bit 6 della maschera 0xA2 e' acceso, il bit 6 delle collisioni si accende; se il bit 6 della maschera e'
acceso, i bit 0x3F della mappa passano nelle collisioni (stesso schema a coppie degli altri oggetti, ma senza i caratteri 0x80); con il
bit 4 di 0xA0 acceso un contatto alza il bit 6 dello stato (0xA1) e /INT.
"""

ROM_SIZE = 2560
EXRAM_SIZE = 0x800
LINE_PIXELS = 320


def cell_addr(x, y):
    """indirizzo (10 bit) della cella (colonna x, riga y) nelle RAM A e B"""
    if y < 24 and x < 32:
        a = y * 32 + x
    elif y < 24:
        a = 0x300 + ((y & 7) << 5) + (y & 0x18) + (x & 7)
    else:
        a = 0x318 | ((x & 0x38) << 2) | (x & 7)
    return a & 0x3FF


def ex_index(attr, code, sl):
    """indice (11 bit) nella memoria estesa da 2 KB per attributo, codice e fetta"""
    off = ((attr & 0xFF) << 12) | ((code & 0xFF) << 4) | (sl & 0xF)
    latch = ((off >> 4) & 0x7F) | (((off >> 19) & 1) << 7)
    idx = latch & 0x1F
    idx |= (off & 1) << 9
    idx |= ((latch >> 7) & 1) << 10
    if off & 8:
        idx |= latch & 0x60
    else:
        idx |= ((off >> 1) & 3) << 5
        idx |= ((latch >> 5) & 3) << 7
    return idx


DH_SLICE = ([0, 0, 0, 1, 1, 2, 2, 3, 3, 4], [4, 5, 5, 6, 6, 7, 7, 8, 8, 9])


class EFPair:
    def __init__(self, rom, offset_x=15, offset_y=5):
        if len(rom) != ROM_SIZE:
            raise ValueError("la ROM dei caratteri deve essere di 2560 byte")
        self.rom = bytes(rom)
        self.offset_x = offset_x
        self.offset_y = offset_y
        self.reset()

    def reset(self):
        self.ram_a = bytearray(1024)
        self.ram_b = bytearray(1024)
        self.exram = bytearray(EXRAM_SIZE)
        self.ta = 0
        self.tb = 0
        self.x = 0
        self.y = 0
        self.y0 = 0
        self.m = 0
        self.r = 0
        self.parity = 0
        self.fl_prescaler = 0
        self.fl_phase = 0

    # ------------------------------------------------------------------ accessi della CPU
    def access(self, addr, data, write):
        """accesso MOVX con P1 bit 5 = 0: addr a 8 bit; ritorna il byte letto (0xFF se l'accesso non risponde)"""
        cmd = (addr >> 1) & 1
        b = addr & 1
        rd = (addr >> 2) & 1
        if write:
            if rd:
                return 0xFF
            self._write(cmd, b, data & 0xFF)
            return 0xFF
        if not rd:
            return 0xFF
        return self._read(cmd, b)

    def _write(self, cmd, b, d):
        if cmd:
            if not b:
                self.ta = d
                return
            self.tb = d
            op = d >> 5
            if op == 0:
                self.x = 0
                self.y = self.ta & 0x1F
            elif op == 1:
                self.y = self.ta & 0x1F
            elif op == 2:
                self.x = self.ta & 0x3F
            elif op == 3:
                self._inc_cursor()
            elif op == 4:
                self.m = self.ta
            elif op == 5:
                self.r = self.ta
            elif op == 6:
                self.y0 = self.ta & 0x3F
            return
        if not b:
            self.ta = d
            return
        self.tb = d
        mode = self.m & 0xE0
        cell = cell_addr(self.x, self.y)
        if mode == 0x00 or mode == 0x40:
            self.ram_a[cell] = self.ta
            self.ram_b[cell] = self.tb
            if mode == 0x00:
                self._inc_cursor()
        elif mode == 0x80:
            sl = self.m & 0x0F
            self.exram[ex_index(self.ram_a[cell], self.ram_b[cell], sl)] = self.ta
            self._inc_slice()

    def _read(self, cmd, b):
        if cmd:
            if not b:
                return 0x00
            return 0x00
        if not b:
            return self.ta
        old = self.tb
        mode = self.m & 0xE0
        cell = cell_addr(self.x, self.y)
        if mode == 0x20 or mode == 0x60:
            self.ta = self.ram_a[cell]
            self.tb = self.ram_b[cell]
            if mode == 0x20:
                self._inc_cursor()
        elif mode == 0xA0:
            sl = self.m & 0x0F
            self.ta = self.exram[ex_index(self.ram_a[cell], self.ram_b[cell], sl)]
            self._inc_slice()
        return old

    def _inc_cursor(self):
        self.x += 1
        if self.x in (40, 48, 56, 64):
            self.x = 0
            self.y += 1
            if self.y == 24 or self.y == 32:
                self.y = 0

    def _inc_slice(self):
        s = ((self.m & 0x0F) + 1) & 0x0F
        if s == 10:
            s = 0
        self.m = (self.m & 0xF0) | s

    # ------------------------------------------------------------------ video
    def frame_tick(self):
        """una volta per quadro (prima della linea 0)"""
        self.fl_prescaler += 1
        if self.fl_prescaler >= (50 if self.r & 0x40 else 60):
            self.fl_prescaler = 0
            self.fl_phase ^= 1

    def _glyph(self, attr, code, sl):
        if code >= 0xA0:
            return self.exram[ex_index(attr, code, sl)]
        if attr & 0x80:
            return self.rom[(code | 0x80) * 10 + sl]
        return self.rom[code * 10 + sl]

    def render_line(self, tl):
        """320 valori di pixel per la linea di teletext tl (>= 0); chiamare in ordine tl = 0, 1, 2, ... in ogni quadro"""
        if tl == 0:
            self.parity = 0
        r = self.r
        if not (r & 1):
            return [0] * LINE_PIXELS
        if tl >= (250 if r & 0x40 else 210):
            return [0] * LINE_PIXELS
        zoom = (self.y0 & 0x20) != 0
        if tl < 10:
            if not (r & 8):
                return [0 if (r & 2) else 8] * LINE_PIXELS
            row, sl, last = 31, tl, tl == 9
        elif zoom:
            k = tl - 10
            row = ((self.y0 & 0x1F) + k // 20) % 24
            sl = (k % 20) // 2
            last = (k % 20) == 19
        else:
            row = ((self.y0 & 0x1F) + (tl - 10) // 10) % 24
            sl = tl % 10
            last = sl == 9
        out = []
        bg = 0
        fg = 0
        blank = False
        ul = False
        boxed = False
        boxing = (r & 2) != 0
        dw_second = False
        dw_src = None
        any_dh = False
        flash_on = (r & 0x80) != 0 and self.fl_phase == 1
        for x in range(40):
            cell = cell_addr(x, row)
            attr = self.ram_a[cell]
            code = self.ram_b[cell]
            cursor = (r & 0x10) != 0 and x == self.x and row == self.y
            cur_inv = cursor and (not (r & 0x80) or self.fl_phase == 0)
            if dw_second:
                dw_second = False
                a2, c2, esl = dw_src
                g = self._glyph(a2, c2, esl)
                if c2 < 0x80 and ul and esl == 9:
                    g = 0xFF
                bits = 0
                for i in range(8):
                    if (g >> (4 + i // 2)) & 1:
                        bits |= 1 << i
                pix = self._cell_pixels(bits, a2 & 7, bg, a2, blank, cursor, cur_inv, flash_on)
                out.extend(pix if (boxed or not boxing) else [0] * 8)
                continue
            if attr & 0x80:                                   # modo grafico
                if (code & 0xE0) == 0x80:
                    pix = self._solid(fg, bg, cur_inv)
                    out.extend(pix if (boxed or not boxing) else [0] * 8)
                    continue
                fg = attr & 7
                bg = (attr >> 4) & 7
                bits = self._glyph(attr, code, sl)
                pix = self._cell_pixels(bits, fg, bg, attr, blank, cursor, cur_inv, flash_on, graphics=True)
                out.extend(pix if (boxed or not boxing) else [0] * 8)
                continue
            if (code & 0xE0) == 0x80:                         # delimitatore
                fg = attr & 7
                bg = (attr >> 4) & 7
                pix = self._solid(fg, bg, cur_inv)
                new_boxed = (code & 2) != 0
                if boxing:
                    if boxed and new_boxed:
                        pass                                   # dentro la zona: blocco pieno
                    elif new_boxed:
                        pix = [0] * 4 + pix[4:]                # apre la zona: meta' sinistra trasparente (DA VERIFICARE quale meta')
                    elif boxed:
                        pix = pix[:4] + [0] * 4                # chiude la zona: meta' destra trasparente (DA VERIFICARE)
                    else:
                        pix = [0] * 8                          # fuori dalla zona: trasparente
                out.extend(pix)
                boxed = new_boxed
                blank = bool((r & 4) and (code & 1))
                ul = bool(code & 4)
                continue
            esl = sl
            dh = (attr & 0x10) != 0
            if dh:
                esl = DH_SLICE[self.parity][sl]
            g = self._glyph(attr, code, esl)
            if code < 0x80 and ul and esl == 9:
                g = 0xFF
            if dh:
                any_dh = True
            if attr & 0x20:                                   # doppia larghezza: prima cella
                bits = 0
                for i in range(8):
                    if (g >> (i // 2)) & 1:
                        bits |= 1 << i
                dw_second = x < 39
                dw_src = (attr, code, esl)
                pix = self._cell_pixels(bits, attr & 7, bg, attr, blank, cursor, cur_inv, flash_on)
                out.extend(pix if (boxed or not boxing) else [0] * 8)
                continue
            pix = self._cell_pixels(g, attr & 7, bg, attr, blank, cursor, cur_inv, flash_on)
            out.extend(pix if (boxed or not boxing) else [0] * 8)
        if last:
            self.parity = (self.parity ^ 1) if any_dh else 0
        return out

    # un blocco di 8 pixel di una cella con glifo: bits (bit 0 = sinistra), colori fg e bg, attr (bit 3 niente lampeggio, bit 6 inverso solo
    # in alfanumerico), cancellazione, cursore e lampeggio
    def _cell_pixels(self, bits, fg, bg, attr, blank, cursor, cur_inv, flash_on, graphics=False):
        inv = (not graphics) and bool(attr & 0x40)
        if inv:
            bits = (~bits) & 0xFF
        if (self.r & 0x80) and not cursor and not (attr & 8):
            on = flash_on
            if inv:
                on = not on
            if on:
                bits = 0
        if cur_inv:
            bits = (~bits) & 0xFF
        px = []
        for i in range(8):
            if blank:
                px.append(8)
            else:
                px.append(((fg if (bits >> i) & 1 else bg) & 7) | 8)
        return px

    def _solid(self, fg, bg, cur_inv):
        c = (bg if cur_inv else fg) & 7
        return [c | 8] * 8



# ---------------------------------------------------------------------- mixer e CX
def mix_pixel(d8245, e, mix8245, mix_ef, cart_b_high, lum):
    """d8245: indice dell'8245 (0..15); e: pixel EF (bit 3 = extra). Ritorna (uscita 0..15, cx)"""
    en = bool(e & 8) or not cart_b_high
    e3 = e & 7
    i2 = 0 if (mix_ef >> e3) & 1 else 1
    d = d8245 & 7
    if en and ((mix8245 >> d) & 1):
        return (d8245 | (8 if lum else 0)) & 15, i2
    return e3 | (8 if i2 else 0), i2


def mix_line(fb_line, ef_line, offset_x, mix8245, mix_ef, cart_b_high, lum, width=360):
    """fb_line: indici dell'8245 per la riga (360); ef_line: 320 pixel EF o None (nessuna linea EF: tutti 0). Ritorna (uscita, cx)"""
    out = []
    cx = []
    for x in range(width):
        k = x - offset_x
        e = ef_line[k] if (ef_line is not None and 0 <= k < LINE_PIXELS) else 0
        o, c = mix_pixel(fb_line[x], e, mix8245, mix_ef, cart_b_high, lum)
        out.append(o)
        cx.append(c)
    return out, cx


def cx_collisions(cmap, cx, cm):
    """ritorna (bit da aggiungere alle collisioni, contatto) per una riga: cmap = mappa delle collisioni a 360 posizioni,
    cx = CX per pixel, cm = maschera delle collisioni (0xA2)"""
    st = 0
    hit = False
    for x, c in enumerate(cx):
        if not c:
            continue
        m = cmap[x] & 0x3F
        if m and (cm & 0x40):
            st |= 0x40
            hit = True
        if cm & 0x40:
            st |= m
    return st, hit
