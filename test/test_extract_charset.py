#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - strumenti per l'emulatore Odyssey 2 / Videopac (O2web)
"""Prova di tools/extract_charset.py con sorgenti C inventati (nessun dato di terzi): tabelle esadecimali, decimali, $XX, commenti,
tabelle di altra lunghezza, zip (anche annidati), cartelle, --ef, e rifiuto dei casi sbagliati."""
import importlib.util
import io
import os
import random
import subprocess
import sys
import tempfile
import zlib
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "..", "tools", "extract_charset.py")
spec = importlib.util.spec_from_file_location("extract_charset", TOOL)
X = importlib.util.module_from_spec(spec)
spec.loader.exec_module(X)

fails = 0
checks = 0


def ok(c, m):
    global fails, checks
    checks += 1
    if not c:
        fails += 1
        print("FAIL", m)


rng = random.Random(7)
v512 = bytes(rng.randrange(256) for _ in range(512))
v2560 = bytes(rng.randrange(256) for _ in range(2560))
hexs = lambda v: ", ".join("0x%02X" % b for b in v)
src = lambda v, n: ("/* intestazione 0xFF, 0xEE */\nconst unsigned char cset[%d] = {\n%s\n};\n" % (n, hexs(v))).encode()

ok(X.parse_table(src(v512, 512).decode(), 512) == v512, "tabella esadecimale da 512")
ok(X.parse_table("x={" + ",".join(str(b) for b in v512) + "};", 512) == v512, "tabella decimale")
ok(X.parse_table("x={" + ",".join("$%02x" % b for b in v512) + ",};", 512) == v512, "tabella $xx con virgola finale")
ok(X.parse_table("{1,2,3}", 512) is None, "tabella corta: nessun set")
ok(X.parse_table("{" + hexs(v512[:-1]) + "}", 512) is None and X.parse_table("{" + hexs(v512 + b'\0') + "}", 512) is None, "511 e 513 valori: nessun set")
ok(X.parse_table("{" + ",".join("256" if i == 3 else "1" for i in range(512)) + "}", 512) is None, "256 non e' un byte")
ok(X.parse_table("{" + ",".join("zz" if i == 3 else "1" for i in range(512)) + "}", 512) is None, "valore non numerico")
ok(X.parse_table("a={1,2};b={" + hexs(v512) + "};", 512) == v512, "salta le tabelle di altra lunghezza")
ok(X.parse_table("/* {" + hexs(v512) + "} */", 512) is None, "tabella dentro un commento: ignorata")
ok(X.parse_table("{" + hexs(v2560) + "}", 2560) == v2560 and X.parse_table("{" + hexs(v2560) + "}", 512) is None, "2560 con --ef, non come 512")


# ---- tabella a due dimensioni di O2EM (vpp_cset): bit invertiti, solo con impronta nota
R = bytes(rng.randrange(256) for _ in range(2560))
rv = lambda b: int("{:08b}".format(b)[::-1], 2)
nest = "int t[2][1280] = {\n{%s},\n{%s}\n};" % (", ".join("0x%02X" % rv(b) for b in R[:1280]), ", ".join("0x%02X" % rv(b) for b in R[1280:]))
known = (zlib.crc32(R),)
ok(X.parse_nested_ef(nest, known) == R, "tabella 2 x 1280 con bit invertiti e impronta nota")
ok(X.parse_nested_ef(nest) is None, "impronta sconosciuta (predefinita): scartata")
ok(X.parse_nested_ef(nest.replace("0x", "0x1", 1), known) is None, "un valore cambiato: scartata")
ok(X.parse_nested_ef(nest.replace("},\n{", ",0x00},\n{"), known) is None, "2561 valori: scartata")
ok(X.parse_nested_ef("/*" + nest + "*/", known) is None, "dentro un commento: ignorata")
ok(X.parse_nested_ef("{" + ", ".join("0x%02X" % b for b in R) + "}", known) is None, "tabella piatta: non e' una tabella 2D")
ok(X.KNOWN_EF_CRC == 0x8DE85988, "impronta nota della ROM EF9341 (MAME)")

with tempfile.TemporaryDirectory() as tmp:
    d = os.path.join(tmp, "o2em", "src")
    os.makedirs(d)
    open(os.path.join(d, "altro.c"), "wb").write(b"int x = {1,2};\n")
    open(os.path.join(d, "cset.c"), "wb").write(src(v512, 512))
    open(os.path.join(d, "dati.bin"), "wb").write(bytes(range(256)) * 4)                 # binario: saltato
    r = X.find_table(os.path.join(tmp, "o2em"), 512)
    ok(r and r[1] == v512 and r[0].endswith("cset.c"), "cartella: trova la tabella in qualunque file di testo")
    ok(X.find_table(os.path.join(tmp, "o2em"), 2560) is None, "cartella: senza tabella da 2560: None")
    r = X.find_table(os.path.join(d, "cset.c"), 512)
    ok(r and r[1] == v512, "file singolo")
    zp = os.path.join(tmp, "o2em.zip")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("o2em/readme.txt", "niente")
        z.writestr("o2em/src/cset.c", src(v512, 512))
    r = X.find_table(zp, 512)
    ok(r and r[1] == v512 and "cset.c" in r[0], "zip con sorgente (deflate)")
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("c.c", src(v2560, 2560))
    outer = io.BytesIO()
    with zipfile.ZipFile(outer, "w") as z:
        z.writestr("dentro.zip", inner.getvalue())
    zn = os.path.join(tmp, "nest.zip")
    open(zn, "wb").write(outer.getvalue())
    r = X.find_table(zn, 2560)
    ok(r and r[1] == v2560 and "dentro.zip" in r[0], "zip dentro zip")
    lvl3 = io.BytesIO()
    with zipfile.ZipFile(lvl3, "w") as z:
        z.writestr("l2.zip", outer.getvalue())
    ok(X.scan_bytes("t", lvl3.getvalue(), 2560) is None, "tre livelli di zip: non si scende")
    bad = os.path.join(tmp, "rotto.zip")
    open(bad, "wb").write(b"PK\x03\x04" + b"\x00" * 50)
    ok(X.find_table(bad, 512) is None, "zip rotto: None, senza eccezioni")
    # linea di comando
    out = os.path.join(tmp, "o.bin")
    p = subprocess.run([sys.executable, "-I", TOOL, os.path.join(tmp, "o2em"), "-o", out], capture_output=True, text=True)
    ok(p.returncode == 0 and open(out, "rb").read() == v512 and "512 byte" in p.stdout, "riga di comando: scrive 512 byte")
    out2 = os.path.join(tmp, "ef.rom")
    p = subprocess.run([sys.executable, "-I", TOOL, zn, "--ef", "-o", out2], capture_output=True, text=True)
    ok(p.returncode == 0 and open(out2, "rb").read() == v2560, "riga di comando: --ef scrive 2560 byte")
    p = subprocess.run([sys.executable, "-I", TOOL, zn, "-o", os.path.join(tmp, "x.bin")], capture_output=True, text=True)
    ok(p.returncode != 0 and not os.path.exists(os.path.join(tmp, "x.bin")), "riga di comando: senza tabella esce con errore e non scrive")

print(("FALLITO: %d su %d" % (fails, checks)) if fails else "OK: %d controlli (estrattore del set di caratteri)" % checks)
sys.exit(1 if fails else 0)
