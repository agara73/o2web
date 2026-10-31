#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""browser_plate.py HTML DUMPS OUTDIR - i due comandi in piu' sotto lo schermo, nella pagina intera (Chromium senza testa, da disco):
«Scambia comandi 1-2» (giochi a turni giocati da soli) e «Filtri CRT» (copia del selettore del pannello «Aspetto»): posto nella barra dei comandi, etichette in
inglese e in italiano, clic con il mouse e effetto vero sui tasti (frecce = joystick 1 / 2), stato scritto sul tasto, il selettore dell'Aspetto resta d'accordo,
il fuoco torna sullo schermo, nessun errore in console, nessuna richiesta di rete, barra senza scorrimento orizzontale su uno schermo stretto.
Gli screenshot sono della sola barra dei comandi (nessuna grafica di gioco)."""
import argparse, os, sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")   # Windows: l'uscita non e' UTF-8 e i testi della pagina hanno «», ●, ecc.

ap = argparse.ArgumentParser()
ap.add_argument("html"); ap.add_argument("dumps"); ap.add_argument("outdir")
a = ap.parse_args()
os.makedirs(a.outdir, exist_ok=True)
D = a.dumps
fails = 0
errors, requests = [], []


def check(cond, msg):
    global fails
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        fails += 1


def joy(pg):
    return pg.evaluate("() => [window.o2web.app.con.joy[0], window.o2web.app.con.joy[1]]")


def settle(pg, n=3):
    pg.evaluate("(n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); })", n)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1000})
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.goto("file://" + os.path.abspath(a.html) + "?offline&lang=en")
    pg.evaluate("() => { document.getElementById('d-games').open = true; }")

    # ---- posto e etichette
    inside = pg.evaluate("() => ['b-swap', 'b-crt'].map(id => !!document.querySelector('#plate #' + id))")
    check(inside == [True, True], "i due pulsanti stanno nella barra dei comandi sotto lo schermo")
    below = pg.evaluate("() => document.getElementById('b-swap').getBoundingClientRect().top > document.getElementById('screen').getBoundingClientRect().bottom")
    check(below, "...e sono sotto lo schermo")
    legs = pg.evaluate("() => [...document.querySelectorAll('#plate .pgrp > .leg')].map(l => l.textContent)")
    check(legs == ["Game", "State", "Players", "Screen", "Keyboard", "Reset"], "gruppi della barra (inglese): %s" % legs)
    pg.click("#b-vk")
    check(pg.evaluate("() => document.getElementById('vkeys').classList.contains('on') && document.getElementById('vk').checked") and pg.get_attribute("#b-vk", "aria-pressed") == "true", "tasto «Tastiera» della barra: mostra la tastiera a schermo")
    pg.click("#b-vk")
    check(pg.evaluate("() => !document.getElementById('vkeys').classList.contains('on')") and pg.get_attribute("#b-vk", "aria-pressed") == "false", "tasto «Tastiera» della barra: la nasconde")
    check(pg.evaluate("() => document.getElementById('b-crt').parentElement.contains(document.getElementById('b-full'))"), "«Filtri CRT» e' nel gruppo «Schermo», accanto a «Schermo intero»")
    check(pg.inner_text("#b-swap .kl") == "Swap controls 1-2" and pg.inner_text("#b-crt .kl") == "CRT filters", "etichette in inglese: %r / %r" % (pg.inner_text("#b-swap .kl"), pg.inner_text("#b-crt .kl")))
    check(pg.inner_text("#b-swap .ks") == "normal" and pg.inner_text("#b-crt .ks") == "off", "stato in inglese: %r / %r" % (pg.inner_text("#b-swap .ks"), pg.inner_text("#b-crt .ks")))
    check(pg.get_attribute("#b-swap", "aria-pressed") == "false", "scambio spento all'apertura")
    check("Swap the controls of players 1 and 2" in (pg.get_attribute("#b-swap", "title") or ""), "descrizione del tasto in inglese")
    check((pg.get_attribute("#b-crt", "title") or "").startswith("CRT filters: go to the next preset"), "descrizione del tasto CRT in inglese")
    check(not pg.is_disabled("#b-swap") and not pg.is_disabled("#b-crt"), "i due tasti si usano anche senza gioco in corso")

    # ---- filtri CRT: un clic = insieme successivo, il selettore dell'Aspetto segue
    sel = lambda: pg.input_value("#look-preset")
    check(sel() == "esatto", "selettore dell'Aspetto all'apertura: nessun filtro")
    pg.click("#b-crt")
    check(sel() == "leggero" and pg.inner_text("#b-crt .ks") == "light", "clic 1: leggero (selettore e stato: %s / %s)" % (sel(), pg.inner_text("#b-crt .ks")))
    check(pg.evaluate("() => document.activeElement && document.activeElement.id") == "screen", "dopo il clic il fuoco torna sullo schermo")
    pg.click("#b-crt")
    check(sel() == "anni80" and pg.inner_text("#b-crt .ks") == "1980s", "clic 2: anni '80 (%s / %s)" % (sel(), pg.inner_text("#b-crt .ks")))
    check(pg.evaluate("() => window.o2web.app.look.scan") == 55 and pg.evaluate("() => window.o2web.screen.pipe.k") == 3, "i valori sono quelli di «anni '80» e l'uscita ha le righe (k = 3)")
    pg.click("#b-crt")
    check(sel() == "esatto" and pg.inner_text("#b-crt .ks") == "off", "clic 3: di nuovo nessun filtro")
    # si cambia dal selettore dell'Aspetto: il tasto segue
    pg.evaluate("() => { const d = document.getElementById('d-look'); d.open = true; }")
    pg.select_option("#look-preset", "leggero")
    pg.wait_for_function("() => document.querySelector('#b-crt .ks').textContent === 'light'", timeout=5000)
    check(pg.inner_text("#b-crt .ks") == "light", "dal selettore dell'Aspetto: il tasto scrive «light»")
    # un cursore porta al personalizzato; il tasto lo scrive; un clic lo lascia e il giro lo ripropone dopo anni '80
    pg.evaluate("() => { const e = document.getElementById('look-blur'); e.value = '77'; e.dispatchEvent(new Event('input', {bubbles: true})); }")
    pg.wait_for_function("() => document.querySelector('#b-crt .ks').textContent === 'custom'", timeout=5000)
    check(sel() == "custom" and pg.inner_text("#b-crt .ks") == "custom", "cursore: personalizzato (%s / %s)" % (sel(), pg.inner_text("#b-crt .ks")))
    pg.click("#b-crt")
    check(sel() == "esatto", "dal personalizzato: nessun filtro")
    pg.click("#b-crt"); pg.click("#b-crt"); pg.click("#b-crt")
    check(sel() == "custom" and pg.evaluate("() => window.o2web.app.look.blur") == 77, "...e dopo anni '80 torna il personalizzato di prima (sfocatura 77)")
    pg.click("#b-crt")
    check(sel() == "esatto", "ancora un clic: nessun filtro")
    # il B/N del G7200 non si tocca
    pg.evaluate("() => window.o2web.app.setLook({mono: true})")
    pg.click("#b-crt")
    check(pg.evaluate("() => window.o2web.app.look.mono") is True, "il bianco e nero resta com'e'")
    pg.evaluate("() => window.o2web.app.setLook({mono: false})")
    pg.click("#b-crt"); pg.click("#b-crt"); pg.click("#b-crt")                 # da leggero: anni '80, personalizzato di prima, nessun filtro
    check(sel() == "esatto", "riportato a nessun filtro dopo tre clic (anni '80, personalizzato, nessun filtro): %s" % sel())

    # ---- scambio: con un gioco in corso
    pg.set_input_files("#f-files", [os.path.join(D, "bios/o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pg.wait_for_function("() => document.querySelectorAll('#games li:not(.hd)').length >= 1", timeout=15000)
    pg.click("#b-start")
    pg.wait_for_function("() => window.o2web.app.running && window.o2web.app.framesRun > 30", timeout=15000)
    pg.keyboard.down("ArrowUp"); settle(pg)
    check(joy(pg) == [1, 0], "senza scambio: freccia su = joystick 1 %s" % joy(pg))
    pg.keyboard.up("ArrowUp"); settle(pg)
    pg.click("#b-swap")
    check(pg.get_attribute("#b-swap", "aria-pressed") == "true" and pg.inner_text("#b-swap .ks") == "swapped", "clic: scambio acceso (premuto, «swapped»)")
    check(pg.evaluate("() => document.activeElement && document.activeElement.id") == "screen", "dopo il clic il fuoco torna sullo schermo")
    pg.keyboard.down("ArrowUp"); settle(pg)
    check(joy(pg) == [0, 1], "con lo scambio: freccia su = joystick 2 %s" % joy(pg))
    pg.keyboard.up("ArrowUp")
    pg.keyboard.down("Numpad8"); settle(pg)
    check(joy(pg) == [1, 0], "con lo scambio: tastierino 8 = joystick 1 %s" % joy(pg))
    pg.keyboard.up("Numpad8"); settle(pg)
    # il fuoco (Ctrl) e i tasti della console non cambiano
    pg.keyboard.down("Control"); settle(pg)
    check(joy(pg) == [0, 16], "con lo scambio: il fuoco del giocatore 1 e' il fuoco del joystick 2 %s" % joy(pg))
    pg.keyboard.up("Control")
    pg.keyboard.down("Digit1"); settle(pg)
    check(pg.evaluate("() => (window.o2web.app.con.keyRows[0] & 2) !== 0") is True, "con lo scambio: il tasto 1 della console funziona come prima")
    pg.keyboard.up("Digit1"); settle(pg)
    # riavvio del gioco e pausa: lo scambio resta
    pg.click("#b-reset"); settle(pg)
    check(pg.get_attribute("#b-swap", "aria-pressed") == "true" and pg.evaluate("() => window.o2web.app.swapPads") is True, "dopo il reset della console lo scambio resta acceso")
    # un clic lo spegne
    pg.click("#b-swap")
    check(pg.get_attribute("#b-swap", "aria-pressed") == "false" and pg.inner_text("#b-swap .ks") == "normal", "secondo clic: scambio spento")
    pg.keyboard.down("ArrowUp"); settle(pg)
    check(joy(pg) == [1, 0], "spento: freccia su = joystick 1 di nuovo %s" % joy(pg))
    pg.keyboard.up("ArrowUp"); settle(pg)
    # la barra e' ancora ordinata
    pg.click("#b-swap")
    pg.locator("#plate").screenshot(path=os.path.join(a.outdir, "plate_en.png"))

    # ---- italiano
    pg.goto("file://" + os.path.abspath(a.html) + "?offline&lang=it")
    pg.evaluate("() => { document.getElementById('d-games').open = true; }")
    legs = pg.evaluate("() => [...document.querySelectorAll('#plate .pgrp > .leg')].map(l => l.textContent)")
    check(legs == ["Gioco", "Stato", "Giocatori", "Schermo", "Tastiera", "Reset"], "gruppi della barra (italiano): %s" % legs)
    check(pg.inner_text("#b-swap .kl") == "Scambia comandi 1-2" and pg.inner_text("#b-swap .ks") == "normali", "italiano: «Scambia comandi 1-2» / «normali»")
    check(pg.inner_text("#b-crt .kl") == "Filtri CRT" and pg.inner_text("#b-crt .ks") == "spenti", "italiano: «Filtri CRT» / «spenti»")
    pg.click("#b-crt")
    check(pg.inner_text("#b-crt .ks") == "leggeri", "italiano: leggeri")
    pg.click("#b-crt")
    check(pg.inner_text("#b-crt .ks") == "anni ’80", "italiano: anni ’80")
    pg.click("#b-swap")
    check(pg.inner_text("#b-swap .ks") == "scambiati", "italiano: scambiati")
    # cambio di lingua con la pagina aperta: le scritte dinamiche seguono
    pg.evaluate("() => window.o2web.applyLang('en', false)")
    check(pg.inner_text("#b-swap .ks") == "swapped" and pg.inner_text("#b-crt .ks") == "1980s", "cambio di lingua: «swapped» / «1980s»")
    check(pg.get_by_role("button", name="CRT filters 1980s").count() == 1 and pg.get_by_role("button", name="Swap controls 1-2 swapped").count() == 1, "nomi accessibili dei due tasti (testo + stato): CRT filters 1980s / Swap controls 1-2 swapped")

    # ---- schermo stretto: nessun scorrimento orizzontale, tasti raggiungibili
    pg.set_viewport_size({"width": 360, "height": 800})
    pg.wait_for_timeout(200)
    ow = pg.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    check(ow[0] <= ow[1], "360 px di larghezza: nessuno scorrimento orizzontale (%s)" % ow)
    r = pg.evaluate("() => ['b-swap', 'b-crt'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)]; })")
    check(all(x[0] >= 0 and x[1] <= 360 and x[2] >= 58 and x[3] >= 36 for x in r), "360 px: i due tasti stanno nella pagina e sono toccabili: %s" % r)
    pg.locator("#plate").screenshot(path=os.path.join(a.outdir, "plate_narrow.png"))

    check(not errors, "nessun errore in console: %s" % errors[:3])
    check(all(u.startswith("file://") or u.startswith("data:") or u.startswith("blob:") for u in requests), "nessuna richiesta di rete: %s" % [u for u in requests if not u.startswith(("file://", "data:", "blob:"))][:3])
    b.close()

print("FALLITI %d" % fails if fails else "OK: tutti i controlli della barra dei comandi")
sys.exit(1 if fails else 0)
