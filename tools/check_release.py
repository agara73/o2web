#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - O2web, emulatore Odyssey 2 / Videopac per browser
"""check_release.py - controllo prima di consegnare o pubblicare: il pacchetto dei sorgenti (cartella o zip) deve avere il copyright e
la licenza in ogni file, il testo ufficiale della GPL-3.0, e NIENTE che non sia codice: nessun BIOS, cartuccia, set di caratteri,
copertina, screenshot, sessione o stato (file binari, estensioni dei dump, immagini) e, se si indica la cartella dei dump, nessun
pezzo del contenuto di quei dump dentro a nessun file.

Uso: python3 -I tools/check_release.py CARTELLA_O_ZIP [--dumps CARTELLA_DEI_DUMP]
Esce con 1 se qualcosa non va. Se la cartella e' la radice di un repository git si controllano i file che git traccerebbe (tracciati
e nuovi non ignorati: le cartelle private come _privato/ e _import/ non contano); altrimenti tutta la cartella, saltando __pycache__,
dist, .git, node_modules. In uno zip non si salta niente.
Unica eccezione per le immagini: le FOTO DELLE MACCHINE con licenza libera in web/photos/, solo .webp, solo se elencate in
web/photos/CREDITS.json con SHA-256 giusto e licenza libera (o «da-confermare», che da' un AVVISO, non un errore).
Limite: il confronto con i dump cerca i byte (due pezzi da 32 byte per dump), non le loro trascrizioni in testo (esadecimale, disassemblaggi)."""
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile

GPL3_MD5 = "1ebbd3e34237af26da5dc08a4e440464"      # testo ufficiale della GNU GPL v3 (35149 byte)
CODE_EXT = (".js", ".py", ".sh", ".html")
DOC_EXT = (".md",)
BAD_EXT = (".bin", ".rom", ".o2", ".vp", ".zip", ".o2state", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pyc", ".7z", ".rar", ".tar", ".gz")
PHOTO_DIR = "web/photos/"
PHOTO_FREE = {"CC0-1.0", "PD", "CC-BY-2.0", "CC-BY-2.5", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-2.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0", "CC-BY-SA-4.0"}
SKIP_DIRS = {"__pycache__", "dist", ".git", "node_modules"}
NO_HEADER = {"LICENSE", ".gitignore", ".gitattributes", "vercel.json"}   # senza commenti possibili o testo ufficiale
JSON_OK = {"line_scenarios.json"}                       # JSON dei test: nessun commento possibile, solo nomi di scenari


def git_files(root):
    """i file che git traccerebbe (tracciati + nuovi non ignorati), o None se root non e' la radice di un repository git"""
    try:
        top = subprocess.run(["git", "-C", root, "rev-parse", "--show-toplevel"], capture_output=True, check=True).stdout.decode("utf-8").strip()
        if os.path.normcase(os.path.realpath(top)) != os.path.normcase(os.path.realpath(root)):
            return None
        out = subprocess.run(["git", "-C", root, "ls-files", "-co", "--exclude-standard", "-z"], capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return sorted(n for n in out.decode("utf-8").split("\0") if n and os.path.isfile(os.path.join(root, n)))


ap = argparse.ArgumentParser()
ap.add_argument("target")
ap.add_argument("--dumps")
a = ap.parse_args()

files = {}                                              # percorso relativo -> byte
tracked = git_files(a.target) if os.path.isdir(a.target) else None
if tracked is not None:
    print("INFO  elenco dei file da git (tracciati e nuovi non ignorati): %d" % len(tracked))
    for n in tracked:
        files[n] = open(os.path.join(a.target, n), "rb").read()
elif os.path.isdir(a.target):
    for r, ds, fs in os.walk(a.target):
        ds[:] = sorted(d for d in ds if d not in SKIP_DIRS)
        for f in sorted(fs):
            p = os.path.join(r, f)
            files[os.path.relpath(p, a.target).replace(os.sep, "/")] = open(p, "rb").read()
elif zipfile.is_zipfile(a.target):
    with zipfile.ZipFile(a.target) as z:
        bad = z.testzip()
        if bad:
            sys.exit("zip danneggiato: " + bad)
        for n in z.namelist():
            if not n.endswith("/"):
                files[n] = z.read(n)
else:
    sys.exit("non e' una cartella ne' uno zip: " + a.target)

fails = []


def fail(msg):
    fails.append(msg)
    print("FAIL  " + msg)


if not files:
    fail("nessun file")

# foto delle macchine: ammesse solo se elencate in CREDITS.json (SHA-256 e licenza libera); il resto delle immagini resta vietato
photo_ok = {}
warns = []
if PHOTO_DIR + "CREDITS.json" in files:
    try:
        cj = json.loads(files[PHOTO_DIR + "CREDITS.json"].decode("utf-8"))
        for kind, e in cj["photos"].items():
            lic = e["licence"]
            if lic != "da-confermare" and lic not in PHOTO_FREE:
                fail("web/photos/CREDITS.json, %s: licenza non libera «%s»" % (kind, lic))
            if lic == "da-confermare" or not e["verified"] or not e["author"]:
                warns.append("la foto «%s» ha autore o licenza da completare o verificare (web/photos/CREDITS.json)" % kind)
            photo_ok[PHOTO_DIR + e["file"]] = e["sha256"]
    except (ValueError, KeyError, TypeError, AttributeError) as ex:
        fail("web/photos/CREDITS.json non valido: %s" % ex)
for name in files:
    if name.startswith(PHOTO_DIR) and name != PHOTO_DIR + "CREDITS.json":
        if name not in photo_ok:
            fail("%s: foto non elencata in web/photos/CREDITS.json" % name)
        elif hashlib.sha256(files[name]).hexdigest() != photo_ok[name]:
            fail("%s: l'impronta SHA-256 non corrisponde a CREDITS.json" % name)
        elif not name.endswith(".webp") or files[name][:4] != b"RIFF":
            fail("%s: non e' un file WebP" % name)
for name, data in sorted(files.items()):
    base = name.rsplit("/", 1)[-1]
    low = name.lower()
    if name.startswith(PHOTO_DIR):
        continue                                          # controllate sopra (CREDITS.json e foto elencate)
    if low.endswith(BAD_EXT):
        fail("%s: tipo di file che non va in un pacchetto di sorgenti (dump, archivio o immagine?)" % name)
        continue
    if b"\x00" in data:
        fail("%s: contiene byte nulli (file binario: dump?)" % name)
        continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        fail("%s: non e' testo UTF-8 (file binario: dump?)" % name)
        continue
    if not data:
        fail("%s: file vuoto" % name)
        continue
    if base in NO_HEADER or base in JSON_OK:
        continue
    head = "\n".join(text.split("\n")[:8])
    if low.endswith(CODE_EXT):
        if "(c) 2026 by Agara73" not in head:
            fail("%s: manca «(c) 2026 by Agara73» nelle prime righe" % name)
        if "SPDX-License-Identifier: GPL-3.0-only" not in head:
            fail("%s: manca «SPDX-License-Identifier: GPL-3.0-only» nelle prime righe" % name)
    elif low.endswith(DOC_EXT):
        if "(c) 2026 by Agara73" not in text:
            fail("%s: manca «(c) 2026 by Agara73»" % name)
    else:
        fail("%s: tipo di file non previsto nel pacchetto" % name)

lic = files.get("LICENSE")
if lic is None:
    fail("manca il file LICENSE")
elif hashlib.md5(lic).hexdigest() != GPL3_MD5 or len(lic) != 35149:
    fail("LICENSE non e' il testo ufficiale della GPL-3.0 (MD5 %s, %d byte)" % (hashlib.md5(lic).hexdigest(), len(lic)))
for must in ("README.md", "LEGGIMI.md", "tools/build.js", "web/index.template.html"):
    if must not in files:
        fail("manca " + must)
readme = files.get("README.md", b"").decode("utf-8", "ignore")
for must in ("GPL-3.0", "rispettivi titolari", "O2web"):
    if must not in readme:
        fail("README.md: manca «%s»" % must)

ndump = 0
if a.dumps:
    needles = []
    for r, ds, fs in os.walk(a.dumps):
        for f in sorted(fs):
            if f.lower().endswith((".zip", ".png", ".txt", ".json")):
                continue
            d = open(os.path.join(r, f), "rb").read()
            if len(d) < 256:
                continue
            ndump += 1
            for off in (0, 256):
                n = d[off:off + 32]
                if len(n) == 32 and len(set(n)) > 4:       # niente pezzi quasi costanti (riempimento)
                    needles.append((f, off, n))
    hits = 0
    for name, data in files.items():
        for f, off, n in needles:
            if n in data:
                fail("%s: contiene un pezzo del dump %s (offset %d)" % (name, f, off))
                hits += 1
                break
    print("INFO  confronto con %d dump (%d pezzi): %d corrispondenze" % (ndump, len(needles), hits))

for w in warns:
    print("AVVISO  " + w)
print("INFO  %d file controllati" % len(files))
print("TUTTO OK" if not fails else "FALLITI %d controlli" % len(fails))
sys.exit(1 if fails else 0)
