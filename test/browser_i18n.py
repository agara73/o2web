#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""browser_i18n.py - prova delle lingue nella pagina INTERA (Chromium di Playwright): inglese predefinito, bandiere in alto a destra,
cambio di lingua (e ritorno senza residui), nessun testo italiano rimasto in inglese e viceversa, pannello «Donazioni» sempre aperto
e ultimo, messaggi dell'uso (aggiunta di file, errori, rete rifiutata, stato memorizzato) nella lingua scelta, nessuna richiesta di rete.
Gli screenshot si fanno in locale (mostrano il menu del BIOS): NON vanno consegnati.
Uso: python3 -I test/browser_i18n.py HTML DUMPS OUTDIR"""
import argparse
import os
import re
import sys
import tempfile

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")   # Windows: l'uscita non e' UTF-8 e i testi della pagina hanno «», ●, ecc.

ap = argparse.ArgumentParser()
ap.add_argument("html")
ap.add_argument("dumps")
ap.add_argument("outdir")
a = ap.parse_args()
os.makedirs(a.outdir, exist_ok=True)
D = a.dumps
URL = "file://" + os.path.abspath(a.html)
fails = 0
errors, requests = [], []


def check(cond, msg):
    global fails
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        fails += 1


# parole che in inglese non compaiono (e in italiano si): servono a scovare testo non tradotto
IT_WORDS = re.compile(r"\b(gioco|giochi|aggiungi|aggiunti|scegli|nessun[ao]?|della|delle|nella|nello|degli|manca|schermo|salva|scarica|avvio|riparte|tasti|elenco|"
                      r"cartuccia|cartucce|macchina|copertin[ae]|impossibile|errore|sessione|memorizzat[oa]|utilizzabile|non e’|non è|dal|dalla|sul|sulla|alla|alle)\b", re.I)
EN_WORDS = re.compile(r"\b(the|games?|add|press|download|screen|cartridge|machine|session|cover|covers|missing|error|stored|state)\b", re.I)


def page_text(pg, skip_log=False):
    """tutto il testo leggibile: testo visibile + title/aria-label/placeholder/alt; i messaggi gia' scritti nel registro restano nella lingua in cui sono nati"""
    return pg.evaluate("""() => {
      const SK = %s;
      const out = [document.title, document.querySelector('meta[name=description]').content];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement; if (p && !/^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName) && !(SK && p.closest('#log')) && n.nodeValue.trim()) out.push(n.nodeValue.trim()); }
      for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))
        for (const k of ['title', 'aria-label', 'placeholder', 'alt']) if (el.hasAttribute(k)) out.push(el.getAttribute(k));
      return out;
    }""".replace("%s", "true" if skip_log else "false"))


def leftovers(pg, rx, ignore=()):
    bad = []
    for t in page_text(pg, True):
        if any(i in t for i in ignore):
            continue
        m = rx.search(t)
        if m:
            bad.append("«" + m.group(0) + "» in: " + t[:110])
    return bad


def new_page(ctx, query):
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.goto(URL + query)
    pg.evaluate("() => { document.getElementById('d-games').open = true; }")     # il pannello sta nel cassetto
    return pg


def ev(pg, js):
    return pg.evaluate(js)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    # ================= 1. inglese predefinito, bandiere, pannello Donazioni
    pg = new_page(ctx, "?offline")
    check(ev(pg, "() => document.documentElement.lang") == "en", "lingua predefinita: inglese (html lang=en)")
    check(ev(pg, "() => document.title") == "O2web - Odyssey 2 / Videopac emulator", "titolo della pagina in inglese")
    check("free and open source emulator" in ev(pg, "() => document.querySelector('meta[name=description]').content"), "descrizione della pagina in inglese")
    fl = ev(pg, "() => [...document.querySelectorAll('#langs button')].map(b => ({l: b.dataset.lang, p: b.getAttribute('aria-pressed'), t: b.getAttribute('aria-label') || b.title, r: b.getBoundingClientRect().toJSON(), svg: !!b.querySelector('svg')}))")
    check([f["l"] for f in fl] == ["en", "it"] and fl[0]["p"] == "true" and fl[1]["p"] == "false", "due bandiere (inglese, italiano): l'inglese e' premuta")
    check(all(f["svg"] for f in fl), "le bandiere sono immagini SVG (non emoji)")
    check(all(f["r"]["right"] > 1440 - 150 and f["r"]["top"] < 80 and f["r"]["width"] > 18 for f in fl), "bandiere in alto a destra")
    check(all(f["t"] and not IT_WORDS.search(f["t"]) for f in fl), "nomi accessibili delle bandiere in inglese: %s" % [f["t"] for f in fl])
    un = ev(pg, "() => window.o2web.I18N.untranslated(document)")
    check(un == [], "DOM statico: ogni testo ha la voce inglese (%s)" % un[:3])
    lo = leftovers(pg, IT_WORDS)
    check(lo == [], "nessun testo italiano rimasto nella pagina inglese (%s)" % lo[:3])
    don = ev(pg, """() => { const s = document.getElementById('d-don'); if (!s) return null; const a = s.querySelector('a');
      const panels = [...document.querySelectorAll('details.panel, section.static')]; const last = panels[panels.length - 1];
      return {tag: s.tagName, inDetails: !!s.closest('details'), last: last === s, vis: s.getBoundingClientRect().height > 40 && getComputedStyle(s).display !== 'none',
        href: a && a.href, target: a && a.target, rel: a && a.rel, atext: a && a.textContent.trim(), head: (s.querySelector('h2,h3,summary,.ph') || {}).textContent}; }""")
    check(don is not None and don["tag"] == "SECTION" and not don["inDetails"], "Donazioni: sezione fissa (non un riquadro che si chiude)")
    check(don and don["last"], "Donazioni: ultima voce del menu a destra")
    check(don and don["vis"], "Donazioni: visibile senza aprire niente")
    check(don and don["href"].startswith("https://www.amazon.it/hz/wishlist/dl/invite/AQICAHgv7cct2SGZ58TbNYwiFrb-8NeSw0t4jGZKtponcI7CSwEmMKXjbP0B9o5djm62xJUNAAAAkTCBjgYJKoZIhvcNAQcGoIGAMH4CAQAweQYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzKetxG4LAarjsCG1ACARCATPfJzfeSbzYEJJQLZYBWgnMKZT4GIgbqvEfj77j5OTYvrfWUs75qdk6K3LLvkggcmE0iTJ8X4oyFdZW-2eLkvPBhQaCjBET79Fwoy9w"), "Donazioni: indirizzo della lista dei desideri")
    check(don and don["target"] == "_blank" and "noopener" in don["rel"] and "noreferrer" in don["rel"], "Donazioni: il link si apre in un'altra scheda con noopener noreferrer")
    check(don and don["atext"] == "Amazon wish list" and don["head"] and don["head"].strip().startswith("Donations"), "Donazioni: testi in inglese (%s / %s)" % (don and don["atext"], don and don["head"]))
    check(not any("amazon" in r for r in requests), "la pagina non contatta Amazon da sola")
    # ordine dei pannelli: Donazioni dopo «About and license»
    order = ev(pg, "() => [...document.querySelectorAll('main details[id^=d-], main section#d-don, details[id^=d-], section#d-don')].map(e => e.id)")
    check(order[-2:] == ["d-about", "d-don"], "ordine dei pannelli: ... d-about, d-don (%s)" % order[-4:])
    snap_en = "\n".join(page_text(pg))
    pg.screenshot(path=os.path.join(a.outdir, "en_desktop.png"))
    # ================= 2. cambio di lingua e ritorno
    pg.click("#langs button[data-lang=it]")
    pg.wait_for_timeout(200)
    check(ev(pg, "() => document.documentElement.lang") == "it" and ev(pg, "() => document.title") == "O2web - emulatore Odyssey 2 / Videopac", "bandiera italiana: pagina e titolo in italiano")
    txt_it = "\n".join(page_text(pg))
    check("Donazioni" in txt_it and "Lista dei desideri su Amazon" in txt_it and "Macchina e giochi" in txt_it, "italiano: pannelli e donazioni")
    lo = leftovers(pg, EN_WORDS, ignore=("O2EM", "GitHub", "BIOS", "EF9341", "Videopac", "Odyssey", "GNU GENERAL PUBLIC LICENSE"))
    check(lo == [], "nessun testo inglese rimasto nella pagina italiana (%s)" % lo[:4])
    check(ev(pg, "() => document.querySelector('#langs button[data-lang=it]').getAttribute('aria-pressed')") == "true", "bandiera italiana premuta")
    units = set(re.sub(r"^\[(?:title|aria-label|placeholder|alt)\] ", "", x) for x in ev(pg, "() => window.o2web.I18N.units(document)"))
    keys = [k for k in ev(pg, "() => Object.keys(window.o2web.I18N.DOM)") if not k.startswith("doc:")]
    stale = [k for k in keys if k not in units]
    check(stale == [], "tabella dei testi fissi: nessuna voce superata (%s)" % [k[:40] for k in stale[:3]])
    check(len(units) == len(keys), "tabella dei testi fissi: una voce per ogni testo del template (%d testi, %d voci)" % (len(units), len(keys)))
    pg.screenshot(path=os.path.join(a.outdir, "it_desktop.png"))
    pg.click("#langs button[data-lang=en]")
    pg.wait_for_timeout(200)
    check("\n".join(page_text(pg)) == snap_en, "andata e ritorno IT -> EN: la pagina e' identica alla prima (nessun residuo)")
    pg.close()
    # ================= 3. ?lang=it all'apertura
    pg = new_page(ctx, "?offline&lang=it")
    check(ev(pg, "() => document.documentElement.lang") == "it" and "Donazioni" in "\n".join(page_text(pg)), "«?lang=it»: la pagina si apre in italiano")
    pg.close()
    # ================= 4. uso in inglese: file, errori, rete, stato
    pg = new_page(ctx, "?offline")
    bad = os.path.join(tempfile.mkdtemp(), "empty.bin")
    open(bad, "wb").write(b"")
    pg.set_input_files("#f-files", [os.path.join(D, "bios/o2rom.bin"), os.path.join(D, "killerbees.bin"), bad])
    pg.wait_for_timeout(600)
    lg = pg.inner_text("#log")
    check("Added to the list" in lg and "1 game" in lg and "1 BIOS" in lg, "messaggio di aggiunta in inglese: %r" % lg[:120])
    check("skipped" in lg and "empty file" in lg, "file saltato: «skipped … empty file»")
    lo = leftovers(pg, IT_WORDS, ignore=("empty.bin", "killerbees"))
    check(lo == [], "dopo l'aggiunta: nessun testo italiano (%s)" % lo[:3])
    pg.click("#games li button.g")
    pg.wait_for_timeout(1800)
    check(ev(pg, "() => window.o2web.app.running"), "il gioco parte")
    lg = pg.inner_text("#log")
    check("black" not in lg or "still black" in lg, "avvio: nessun errore")
    for sel in ("#b-state",):
        pass
    pg.click("#b-memo") if pg.query_selector("#b-memo") else None
    pg.wait_for_timeout(300)
    lg = pg.inner_text("#log")
    check("stored in the session" in lg, "stato memorizzato: messaggio in inglese: %r" % lg[-140:])
    lo = leftovers(pg, IT_WORDS, ignore=("empty.bin", "killerbees", "Killer"))
    check(lo == [], "durante il gioco: nessun testo italiano (%s)" % lo[:3])
    # rete rifiutata
    ev(pg, "() => { document.getElementById('d-net').open = true; }")
    pg.fill("#net-url", "http://example.com/x.zip")
    pg.click("#net-go")
    pg.wait_for_timeout(300)
    lg = pg.inner_text("#log")
    check("Address not allowed: https is required, not http." in lg, "rete: indirizzo http rifiutato, in inglese: %r" % lg[-120:])
    pg.fill("#net-url", "")
    pg.click("#net-go")
    pg.wait_for_timeout(300)
    check("Type the address" in pg.inner_text("#log"), "rete: indirizzo vuoto, in inglese")
    # macchina senza BIOS
    ev(pg, "() => window.o2web.app.selectMachine('c52')")
    pg.wait_for_timeout(300)
    lg = pg.inner_text("#log")
    check("the C52 BIOS is missing" in lg and "Add it with" in lg, "macchina senza BIOS: messaggio in inglese: %r" % lg[-140:])
    # cambio lingua con messaggi gia' scritti: restano com'erano; i nuovi seguono la lingua
    pg.click("#langs button[data-lang=it]")
    pg.wait_for_timeout(300)
    ev(pg, "() => window.o2web.app.selectMachine('c52')")
    pg.wait_for_timeout(300)
    lg = pg.inner_text("#log")
    check("manca il BIOS C52" in lg, "dopo il cambio, i messaggi nuovi sono in italiano: %r" % lg[-100:])
    lo = leftovers(pg, EN_WORDS, ignore=("O2EM", "GitHub", "BIOS", "EF9341", "Videopac", "Odyssey", "Killer", "empty.bin", "killerbees", "GNU GENERAL PUBLIC LICENSE", "Close the message", "Added to", "skipped", "stored", "Address", "Type the", "the C52"))
    check(lo == [], "pagina italiana in uso: nessun testo inglese (%s)" % lo[:4])
    pg.click("#langs button[data-lang=en]")
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(a.outdir, "en_running.png"))
    pg.close()
    # ================= 5. disposizione: telefono e computer
    for w, h in ((390, 844), (1440, 900)):
        c2 = br.new_context(viewport={"width": w, "height": h})
        q = c2.new_page()
        q.goto(URL + "?offline")
        q.wait_for_timeout(300)
        r = q.evaluate("() => ({sw: document.documentElement.scrollWidth, iw: innerWidth, b: [...document.querySelectorAll('#langs button')].map(b => b.getBoundingClientRect().toJSON())})")
        check(r["sw"] <= r["iw"] and all(b["right"] <= r["iw"] and b["left"] >= 0 and b["top"] >= 0 for b in r["b"]), "%d px: bandiere dentro la finestra, nessuno scorrimento orizzontale" % w)
        q.screenshot(path=os.path.join(a.outdir, "en_%d.png" % w), full_page=True)
        c2.close()
    br.close()

check(not [e for e in errors if "Failed to load resource" not in e], "nessun errore in console (%s)" % errors[:3])
check(all(r.startswith("file:") or r.startswith("data:") or r.startswith("blob:") for r in requests), "nessuna richiesta di rete (%s)" % [r for r in requests if not r.startswith(("file:", "data:", "blob:"))][:3])
print("\n%s: %d prove fallite" % ("FALLITO" if fails else "TUTTO OK", fails))
sys.exit(1 if fails else 0)
