#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""browser_list.py HTML DUMPS OUTDIR - tappa 7 nella pagina intera (Chromium senza testa, da disco): pulsanti «Unisci giochi duplicati» e «Anteprime» accanto a
«Svuota elenco» (accesi all'apertura), voci con sigla e nome, altri nomi, anteprime disegnate solo per le righe visibili, fusione e disfusione, ricerca per un altro
nome, avvio e rimozione di una voce unita, elenco di nomi letto da un file di testo, inglese e italiano, nessun errore in console, nessuna richiesta di rete.
Gli screenshot mostrano giochi: restano in locale, NON vanno consegnati."""
import argparse, os, sys, tempfile, shutil
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")   # Windows: l'uscita non e' UTF-8 e i testi della pagina hanno «», ●, ecc.

ap = argparse.ArgumentParser()
ap.add_argument("html"); ap.add_argument("dumps"); ap.add_argument("outdir")
a = ap.parse_args()
os.makedirs(a.outdir, exist_ok=True)
D = a.dumps
tmp = tempfile.mkdtemp()
fails = 0
errors, requests = [], []


def check(cond, msg):
    global fails
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        fails += 1


kb = open(os.path.join(D, "killerbees.bin"), "rb").read()
bo = open(os.path.join(D, "blockout.bin"), "rb").read()
pp = open(os.path.join(D, "pickaxepete.bin"), "rb").read()
files = {}
for name, data in [("vp_52.bin", kb), ("Killer Bees (198x)(Philips)(EU).bin", kb), ("o2_47.bin", kb), ("Blockout (1981)(Philips)(EU-US).bin", bo), ("vp_47.bin", pp)]:
    p = os.path.join(tmp, name)
    open(p, "wb").write(data)
    files[name] = p
lst = os.path.join(tmp, "Gamelist.txt")
open(lst, "w").write("vp_52.bin   Killer Bees\no2_47.bin   Killes Bees\nvp_03.bin   American Football\nvp_04.bin   Air-Sea War/Battle\n")


def rows(pg):
    return pg.evaluate("() => document.querySelectorAll('#games li:not(.hd)').length")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1000})
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.goto("file://" + os.path.abspath(a.html) + "?offline&lang=en")
    check(pg.evaluate("() => document.getElementById('b-clearlib').nextElementSibling.id") == "b-merge", "«Unisci giochi duplicati» e' accanto a «Svuota elenco»")
    check(pg.inner_text("#b-merge") == "Merge duplicate games" and pg.inner_text("#b-clearlib") == "Clear list" and pg.inner_text("#b-previews") == "Previews", "etichette in inglese")
    check(pg.get_attribute("#b-merge", "aria-pressed") == "true" and pg.get_attribute("#b-previews", "aria-pressed") == "true", "all'apertura: fusione e anteprime accese")
    pg.set_input_files("#f-files", [os.path.join(D, "bios/o2rom.bin")])
    pg.wait_for_timeout(300)
    pg.set_input_files("#f-files", list(files.values()) + [lst])
    pg.wait_for_function("() => document.querySelectorAll('#games li:not(.hd)').length >= 3", timeout=15000)
    check(rows(pg) == 3, "5 file, 3 voci con la fusione (%d)" % rows(pg))
    check("duplicates merged" in pg.inner_text("#count") and "5 files" in pg.inner_text("#count"), "conteggio: %r" % pg.inner_text("#count"))
    first = pg.evaluate("() => [...document.querySelectorAll('#games li:not(.hd)')].map(l => l.querySelector('.t').textContent)")
    check(any(t.startswith("vp_52") and "Killer Bees" in t and "×3" in t for t in first), "voce unita «vp_52 — Killer Bees ×3»: %s" % first)
    also = pg.evaluate("() => [...document.querySelectorAll('#games li:not(.hd)')].map(l => { const a = l.querySelector('.a'); return a ? a.textContent + ' | ' + a.title.replace(/\\n/g, ' · ') : ''; })")
    check(any("Killer Bees (198x)(Philips)(EU).bin" in t and "o2_47" in t for t in also), "altri nomi mostrati sotto (sigla secondaria e nome TOSEC): %s" % also)
    check(any(t.startswith("vp_29") for t in first) and any("Blockout! / Breakdown!" in t for t in also), "Blockout e' il Videopac n. 29 (Dam Buster): sigla dall'impronta, titolo americano tra gli altri nomi")
    # catalogo delle cartucce: riga con numero Videopac e cataloghi, ricerca per numero e per codice
    cat = pg.evaluate("() => [...document.querySelectorAll('#games li:not(.hd)')].map(l => { const c = l.querySelector('.c'); return c ? c.textContent : ''; })")
    check(any("Videopac 52" in t for t in cat) and any("Videopac 29" in t for t in cat) and any("Videopac 43+" in t for t in cat), "riga del catalogo con il numero Videopac (52, 29, 43+): %s" % cat)
    check(sum(1 for t in cat if t) >= 3, "ogni gioco abbinato ha la riga del catalogo")
    pg.fill("#q", "videopac 52")
    check(rows(pg) == 1, "ricerca per numero di catalogo trova Killer Bees (%d)" % rows(pg))
    pg.fill("#q", "G7143")
    check(rows(pg) == 1, "ricerca per codice Philips G7143 (Pick Axe Pete: %d)" % rows(pg))
    pg.fill("#q", "G7147")
    check(rows(pg) == 0, "il file vp_47.bin contiene Pick Axe Pete: l'impronta prevale, il Videopac 47 (G7147) non c'e' (%d)" % rows(pg))
    pg.fill("#q", "")
    cf = pg.evaluate("() => [...document.querySelectorAll('#games li:not(.hd) .cf')].map(c => c.textContent)")
    check(len(cf) == 1 and "vp_47" in cf[0] and "vp_43pl" in cf[0], "nota di discordanza nome/contenuto: %s" % cf)
    # ordine per dispositivo (predefinito): intestazioni dei blocchi; per nome: niente intestazioni
    heads = pg.evaluate("() => [...document.querySelectorAll('#games li.hd')].map(h => h.firstChild.textContent)")
    check(heads == ["Videopac (Philips G7000)", "Videopac+ (Philips G7400)"], "intestazioni dei blocchi: %s" % heads)
    check(pg.input_value("#order-sel") == "device", "ordine predefinito: dispositivo e numero")
    pg.select_option("#order-sel", "name")
    pg.wait_for_function("() => document.querySelectorAll('#games li.hd').length === 0", timeout=5000)
    check(rows(pg) == 3, "per nome: nessuna intestazione, stesse voci (%d)" % rows(pg))
    pg.select_option("#order-sel", "device")
    pg.wait_for_function("() => document.querySelectorAll('#games li.hd').length === 2", timeout=5000)
    check(pg.get_attribute("#b-auto", "aria-pressed") == "true", "interruttore del cambio macchina automatico acceso")
    pg.click("#b-auto")
    pg.wait_for_function("() => document.getElementById('b-auto').getAttribute('aria-pressed') === 'false'", timeout=5000)
    check(pg.get_attribute("#b-auto", "aria-pressed") == "false" and pg.evaluate("() => window.o2web.app.autoMachine") is False, "un clic spegne il cambio macchina automatico")
    pg.click("#b-auto")
    pg.wait_for_function("() => document.getElementById('b-auto').getAttribute('aria-pressed') === 'true'", timeout=5000)
    check(pg.get_attribute("#b-auto", "aria-pressed") == "true" and pg.evaluate("() => window.o2web.app.autoMachine") is True, "un altro clic lo riaccende")
    # anteprime: calcolate per le righe visibili
    pg.wait_for_function("() => window.o2web.app.previews.stats().ready >= 2 && window.o2web.app.previews.stats().pending === 0", timeout=30000)
    st = pg.evaluate("() => window.o2web.app.previews.stats()")
    check(st["ready"] >= 2 and st["pending"] == 0, "anteprime pronte per le righe visibili: %s" % st)
    nb = pg.evaluate("""() => [...document.querySelectorAll('#games canvas.pv')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] | d[i+1] | d[i+2]) n++; return n; })""")
    check(len(nb) == 3 and sum(1 for x in nb if x > 200) >= 2, "un canvas per riga, almeno 2 disegnati (pixel accesi %s)" % nb)
    pg.screenshot(path=os.path.join(a.outdir, "list_merged.png"))
    # disfusione
    pg.click("#b-merge")
    pg.wait_for_function("() => document.querySelectorAll('#games li:not(.hd)').length === 5", timeout=5000)
    check(pg.get_attribute("#b-merge", "aria-pressed") == "false" and rows(pg) == 5, "fusione spenta: 5 voci")
    t5 = pg.evaluate("() => [...document.querySelectorAll('#games li:not(.hd)')].map(l => l.querySelector('.t').textContent)")
    check(sum(1 for t in t5 if t.startswith("vp_52 ")) == 1 and sum(1 for t in t5 if t.startswith("o2_47")) == 1, "nomenclatura per sigla anche senza fusione: %s" % t5)
    check(sum(1 for t in t5 if t.startswith("vp_52pl")) == 1, "il dump con nome TOSEC prende la sigla dall'impronta (vp_52pl): %s" % t5)
    pg.wait_for_function("() => window.o2web.app.previews.stats().pending === 0", timeout=30000)
    pg.click("#b-merge")
    pg.wait_for_function("() => document.querySelectorAll('#games li:not(.hd)').length === 3", timeout=5000)
    check(pg.get_attribute("#b-merge", "aria-pressed") == "true", "fusione riaccesa")
    # ricerca per un altro nome
    pg.fill("#q", "o2_47")
    check(rows(pg) == 1, "ricerca per una sigla secondaria trova la voce unita")
    pg.fill("#q", "Killes")
    check(rows(pg) == 1, "ricerca per un nome dell'elenco di nomi")
    pg.fill("#q", "")
    # anteprime spente
    pg.click("#b-previews")
    pg.wait_for_function("() => document.querySelectorAll('#games canvas.pv').length === 0", timeout=5000)
    check(pg.get_attribute("#b-previews", "aria-pressed") == "false", "anteprime spente: niente canvas")
    pg.click("#b-previews")
    pg.wait_for_function("() => document.querySelectorAll('#games canvas.pv').length === 3", timeout=5000)
    check(True, "anteprime riaccese")
    # avvio di una voce unita
    pg.click("#games li:has(.sg) button.g >> nth=0")
    pg.wait_for_function("() => window.o2web.app.running", timeout=5000)
    check(pg.evaluate("() => window.o2web.app.running"), "un clic sulla voce avvia il gioco")
    # togli una voce unita
    n_before = pg.evaluate("() => window.o2web.app.lib.games.length")
    victim = pg.evaluate("() => { const e = window.o2web.ui.rows.find(r => r.count === 1 && !window.o2web.app.entryIsCurrent(r)); return e ? e.title : null; }")
    pg.fill("#q", "Pickaxe")
    pg.click("#games li button.s:not(.mem)")
    check(pg.evaluate("() => window.o2web.app.lib.games.length") == n_before - 1, "× toglie il dump della voce singola")
    pg.fill("#q", "")
    # italiano
    pg.goto("file://" + os.path.abspath(a.html) + "?offline&lang=it")
    check(pg.inner_text("#b-merge") == "Unisci giochi duplicati" and pg.inner_text("#b-previews") == "Anteprime" and pg.inner_text("#b-clearlib") == "Svuota elenco", "etichette in italiano")
    # senza anteprime ne' errori: la pagina con BIOS ma senza giochi non fa richieste
    check(not errors, "nessun errore in console: %s" % errors[:3])
    ext = [r for r in requests if not r.startswith("file:") and not r.startswith("data:") and not r.startswith("blob:")]
    check(not ext, "nessuna richiesta di rete: %s" % ext[:3])
    b.close()
shutil.rmtree(tmp, ignore_errors=True)
print("TUTTO OK" if not fails else "FALLITI %d" % fails)
sys.exit(1 if fails else 0)
