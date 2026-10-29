#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - strumenti per l'emulatore Odyssey 2 / Videopac (O2web)
"""Ricava un set di caratteri (512 byte del chip video 8244/8245, oppure 2560 byte della ROM dell'EF9341) da un SORGENTE C che porti tu.

Uso: extract_charset.py CARTELLA_FILE_O_ZIP [-o charset_i8244.bin] [--ef]
Cerca in ogni file di testo (.c .h .txt .inc ...; anche dentro gli zip, anche zip di zip) una tabella fra graffe con ESATTAMENTE 512 valori
(o 2560 con --ef): numeri esadecimali 0x.. / $.. oppure decimali; i commenti si ignorano. Se ce n'e' piu' di una prende la prima e dice quale.
Non scarica nulla: il sorgente lo porta l'utente (per O2EM la tabella sta in un file di nome simile a cset.c: il nome non e' verificato).
Il file prodotto e' derivato da quel sorgente (O2EM ha la propria licenza) e resta sul tuo computer: non va mai in zip, repository o listati.
Fatto da verificare: l'ordine delle 64 celle da 8 byte e l'orientamento dei bit (bit 7 = pixel a sinistra) sono quelli di O2EM.
Per --ef accetta anche la tabella a due dimensioni di O2EM (vpp_cset, 2 x 1280, bit al contrario) se l'impronta coincide con quella nota.
La stessa lettura la fa la pagina: «Aggiungi file» (charedit.js, parseSource / findSetInFile).
"""
import argparse
import hashlib
import io
import os
import re
import sys
import zipfile
import zlib

MAX_FILE = 8 << 20


def parse_table(text, want):
    """Prima tabella fra graffe di `want` valori (0..255) nel testo, o None."""
    text = re.sub(r"/\*.*?\*/|//[^\n]*", " ", text, flags=re.S)
    for m in re.finditer(r"\{([^{}]*)\}", text):
        parts = [p.strip() for p in m.group(1).split(",") if p.strip()]
        if len(parts) != want:
            continue
        vals = []
        for p in parts:
            t = re.fullmatch(r"0[xX]([0-9A-Fa-f]{1,2})|\$([0-9A-Fa-f]{1,2})|(\d{1,3})", p)
            if not t:
                break
            v = int(t.group(1) or t.group(2), 16) if (t.group(1) or t.group(2)) else int(t.group(3))
            if v > 255:
                break
            vals.append(v)
        else:
            return bytes(vals)
    return None


KNOWN_EF_CRC = 0x8DE85988      # ROM dell'EF9341 di MAME (verificato il 15/10/2026: coincide con vpp_cset di O2EM a bit invertiti)


def parse_nested_ef(text, known=(KNOWN_EF_CRC,)):
    """Tabella a due dimensioni di 2560 valori (O2EM: vpp_cset[2][1280], bit 7 a sinistra): si accetta SOLO se, con i bit invertiti
    (la ROM ha il bit 0 a sinistra), l'impronta CRC-32 e' una di quelle note; altrimenti None (l'ordine dei bit sarebbe una scommessa)."""
    text = re.sub(r"/\*.*?\*/|//[^\n]*", " ", text, flags=re.S)
    depth = 0
    start = -1
    deepest = 0
    for i, c in enumerate(text):
        if c == "{":
            if depth == 0:
                start, deepest = i, 0
            depth += 1
            deepest = max(deepest, depth)
        elif c == "}" and depth > 0:
            depth -= 1
            if depth == 0 and deepest >= 2:
                parts = [p.strip() for p in re.sub(r"[{}]", ",", text[start + 1:i]).split(",") if p.strip()]
                if len(parts) != 2560:
                    continue
                vals = []
                for p in parts:
                    t = re.fullmatch(r"0[xX]([0-9A-Fa-f]{1,2})|\$([0-9A-Fa-f]{1,2})|(\d{1,3})", p)
                    if not t:
                        break
                    v = int(t.group(1) or t.group(2), 16) if (t.group(1) or t.group(2)) else int(t.group(3))
                    if v > 255:
                        break
                    vals.append(v)
                else:
                    rev = bytes(int("{:08b}".format(b)[::-1], 2) for b in vals)
                    if zlib.crc32(rev) in known:
                        return rev
    return None


def scan_bytes(name, data, want, depth=0):
    """Rende (percorso, byte) del primo file/voce che contiene la tabella, o None."""
    if len(data) > MAX_FILE:
        return None
    if data[:4] == b"PK\x03\x04":
        if depth >= 2:
            return None
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            for info in z.infolist():
                if info.is_dir() or info.file_size > MAX_FILE:
                    continue
                r = scan_bytes(name + " > " + info.filename, z.read(info), want, depth + 1)
                if r:
                    return r
        except (zipfile.BadZipFile, NotImplementedError, RuntimeError):
            return None
        return None
    if b"\0" in data[:4096]:
        return None
    text = data.decode("latin-1")
    t = parse_table(text, want)
    if not t and want == 2560:
        t = parse_nested_ef(text)
    return (name, t) if t else None


def find_table(path, want):
    if os.path.isfile(path):
        return scan_bytes(path, open(path, "rb").read(), want)
    for root, dirs, files in os.walk(path):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            try:
                r = scan_bytes(p, open(p, "rb").read(), want)
            except OSError:
                continue
            if r:
                return r
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src", help="cartella, file sorgente o zip")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--ef", action="store_true", help="cerca la ROM dell'EF9341 (2560 valori) invece del set del chip video (512)")
    a = ap.parse_args()
    want = 2560 if a.ef else 512
    out = a.out or ("charset_ef9340.rom" if a.ef else "charset_i8244.bin")
    r = find_table(a.src, want)
    if not r:
        sys.exit("nessuna tabella di %d valori trovata in %s" % (want, a.src))
    name, data = r
    with open(out, "wb") as f:
        f.write(data)
    if os.path.getsize(out) != want:
        sys.exit("scrittura di %s non riuscita" % out)
    print("letto da %s\nscritto %s: %d byte, MD5 %s" % (name, out, want, hashlib.md5(data).hexdigest()))


if __name__ == "__main__":
    main()
