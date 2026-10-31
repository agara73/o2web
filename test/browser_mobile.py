#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""browser_mobile.py HTML DUMPS OUTDIR - tappa 8 (mobile web) nella pagina intera, con Chromium che simula un telefono Android (schermo
tattile, 412 x 915 in verticale e 915 x 412 in orizzontale) e tocchi veri del browser (protocollo di Chrome: piu' dita, scivolamento,
rilascio): i comandi a tocco compaiono da soli, la croce e il fuoco muovono davvero il joystick 1 della console con un gioco in corso
(anche insieme, anche con lo scambio 1-2), lo stick che segue il dito, il tasto della tastiera della console, le scelte «Comandi a
tocco» e «Joystick a tocco», nessuno scorrimento orizzontale, la disposizione in verticale e in orizzontale, i testi in inglese; sul
computer (niente tocco) i comandi non compaiono e lo schermo intero resta quello di prima. Nessun errore in console, nessuna richiesta
di rete. Gli screenshot sono della sola zona dei comandi a tocco (nessuna grafica di gioco) e restano in OUTDIR."""
import argparse, os, sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")   # Windows: l'uscita non e' UTF-8 e i testi della pagina hanno «», ●, ecc.

ap = argparse.ArgumentParser()
ap.add_argument("html"); ap.add_argument("dumps"); ap.add_argument("outdir")
a = ap.parse_args()
os.makedirs(a.outdir, exist_ok=True)
D = a.dumps
URL = "file://" + os.path.abspath(a.html)
fails = 0
errors, requests = [], []
UP, RIGHT, DOWN, LEFT, FIRE = 1, 2, 4, 8, 16


def check(cond, msg):
    global fails
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        fails += 1


def settle(pg, n=3):
    pg.evaluate("(n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); })", n)


def box(pg, sel):
    return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom}; }", sel)


def visible(pg, sel):
    return pg.evaluate("(s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; }", sel)


def joy(pg):
    settle(pg)
    return pg.evaluate("() => [window.o2web.app.con.joy[0], window.o2web.app.con.joy[1]]")


def no_hscroll(pg):
    return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")


def open_page(b, w, h, mobile, lang):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2.625 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("request", lambda r: requests.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
    pg.goto(URL + "?offline&lang=" + lang)
    return ctx, pg


def start_game(pg):
    pg.set_input_files("#f-files", [os.path.join(D, "bios/o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pg.wait_for_function("() => document.querySelectorAll('#games li:not(.hd)').length >= 1", timeout=15000)
    pg.evaluate("() => document.getElementById('b-start').click()")
    pg.wait_for_function("() => window.o2web.app.running && window.o2web.app.framesRun > 30", timeout=15000)


class Fingers:
    """tocchi veri del browser (Input.dispatchTouchEvent), come fa Puppeteer: ogni evento porta solo il dito che cambia (appoggiato,
    spostato o alzato), riconosciuto dal suo id"""
    def __init__(self, ctx, pg):
        self.cdp = ctx.new_cdp_session(pg)
        self.pos = {}

    def _send(self, kind, fid):
        x, y = self.pos[fid]
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": fid}]})

    def press(self, fid, x, y):
        self.pos[fid] = (x, y)
        self._send("touchStart", fid)

    def move(self, fid, x, y):
        self.pos[fid] = (x, y)
        self._send("touchMove", fid)

    def lift(self, fid):
        self._send("touchEnd", fid)
        del self.pos[fid]


def choose(pg, sel, value):
    """scelta in un menu del pannello «Tasti, joystick e gamepad» (lo si apre prima, come farebbe una persona)"""
    pg.evaluate("() => { document.getElementById('d-keys').open = true; }")
    pg.wait_for_timeout(300)
    if not pg.evaluate("() => document.body.classList.contains('menu-open')"):     # il pannello era gia' aperto, ma il cassetto chiuso
        pg.click("#b-menu")
        pg.wait_for_timeout(300)
    pg.select_option(sel, value)
    pg.click("#b-menu")                                       # chiude il cassetto: sul telefono copre lo schermo
    pg.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])

    # ================================================================ telefono in verticale (italiano)
    ctx, pg = open_page(b, 412, 915, True, "it")
    check(pg.evaluate("() => matchMedia('(pointer: coarse)').matches"), "il browser di prova si presenta come schermo tattile (pointer: coarse)")
    check(pg.evaluate("() => document.body.classList.contains('touch-on')") and visible(pg, "#tpad"), "verticale: i comandi a tocco compaiono da soli")
    check(pg.input_value("#tmode") == "auto" and pg.input_value("#tstick") == "cross", "scelte all'apertura: comandi automatici, croce fissa")

    # ---- cassetto dei pannelli (tappa 8b): barra in alto, un pannello alla volta
    bar = pg.evaluate("() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return {menu: r('b-menu'), add: r('b-add'), iw: innerWidth}; }")
    check(bar["menu"]["top"] < 80 and bar["add"]["top"] < 80 and bar["menu"]["width"] >= 40 and bar["add"]["right"] <= bar["iw"], "barra: menu e «Aggiungi file…» in alto, sempre in vista (%s)" % {k: round(v["top"]) for k, v in bar.items() if k != "iw"})
    closed = pg.evaluate("() => ({inert: document.getElementById('panel').inert, left: document.getElementById('panel').getBoundingClientRect().right, shade: document.getElementById('shade').hidden})")
    check(closed["inert"] and closed["left"] <= 0 and closed["shade"], "cassetto chiuso: fuori schermo, non raggiungibile, nessuna ombra (%s)" % closed)
    pg.tap("#b-menu")
    pg.wait_for_timeout(300)
    opened = pg.evaluate("() => ({open: document.querySelectorAll('#panel > details[open]').length, id: (document.querySelector('#panel > details[open]') || {}).id, left: document.getElementById('panel').getBoundingClientRect().left, w: document.getElementById('panel').getBoundingClientRect().width, iw: innerWidth, shade: !document.getElementById('shade').hidden, exp: document.getElementById('b-menu').getAttribute('aria-expanded')})")
    check(opened["open"] == 1 and opened["id"] == "d-games" and opened["left"] == 0 and opened["w"] <= opened["iw"] * 0.9 and opened["shade"] and opened["exp"] == "true", "menu: si apre il cassetto con «Macchina e giochi», ombra sul resto (%s)" % opened)
    pg.tap("#d-look > summary")
    pg.wait_for_timeout(300)
    check(pg.evaluate("() => [...document.querySelectorAll('#panel > details[open]')].map(d => d.id).join()") == "d-look", "un solo pannello alla volta: aprendo «Aspetto» si chiude «Macchina e giochi»")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    check(pg.evaluate("() => document.getElementById('panel').inert && document.getElementById('shade').hidden && document.getElementById('b-menu').getAttribute('aria-expanded') === 'false'"), "Esc chiude il cassetto")
    pg.tap("#b-menu")
    pg.wait_for_timeout(300)
    pg.tap("#shade", position={"x": 400, "y": 300})
    pg.wait_for_timeout(300)
    check(pg.evaluate("() => document.getElementById('panel').inert"), "un tocco sull'ombra chiude il cassetto")
    st, tp, td, tf = box(pg, "#stage"), box(pg, "#tpad"), box(pg, "#tdir"), box(pg, "#tfire")
    check(tp["y"] >= st["b"] - 1, "verticale: i comandi stanno sotto lo schermo (%.0f >= %.0f)" % (tp["y"], st["b"]))
    check(td["r"] <= tf["x"] and td["x"] >= 0 and tf["r"] <= 412, "verticale: croce a sinistra, fuoco a destra, dentro lo schermo del telefono")
    check(st["w"] >= 380 and st["h"] >= 250, "verticale: schermo largo (%.0f x %.0f)" % (st["w"], st["h"]))
    sc = box(pg, "#screen")
    check(sc["w"] >= 360 and sc["h"] >= 260, "verticale: l'immagine della console prende la larghezza del telefono (%.0f x %.0f)" % (sc["w"], sc["h"]))
    check(td["w"] >= 140 and tf["w"] >= 100, "verticale: croce e fuoco abbastanza grandi per un dito (%.0f, %.0f px)" % (td["w"], tf["w"]))
    check(no_hscroll(pg), "verticale: nessuno scorrimento orizzontale")
    check(pg.evaluate("() => window.o2web.fullTarget().id") == "play", "con i comandi a tocco lo schermo intero comprende i comandi (#play)")
    pg.locator("#tpad").screenshot(path=os.path.join(a.outdir, "tpad_verticale.png"))

    start_game(pg)
    cx, cy = td["x"] + td["w"] / 2, td["y"] + td["h"] / 2
    f = Fingers(ctx, pg)
    check(joy(pg) == [0, 0], "gioco in corso, nessun dito: joystick fermi")
    f.press(1, cx, cy - td["h"] * 0.4)
    check(joy(pg) == [UP, 0], "dito sul braccio alto della croce: su al joystick 1 %s" % joy(pg))
    check(pg.evaluate("() => [...document.querySelectorAll('#tdir .arm.on')].map(a => a.dataset.b).join()") == "1", "il braccio premuto si illumina")
    f.move(1, cx + td["w"] * 0.35, cy + td["h"] * 0.35)
    check(joy(pg) == [DOWN | RIGHT, 0], "il dito scivola in basso a destra: diagonale %s" % joy(pg))
    f.press(2, tf["x"] + tf["w"] / 2, tf["y"] + tf["h"] / 2)
    check(joy(pg) == [DOWN | RIGHT | FIRE, 0], "secondo dito sul fuoco: direzione e fuoco insieme %s" % joy(pg))
    check(pg.evaluate("() => document.getElementById('tfire').classList.contains('dn')"), "il fuoco premuto si vede")
    f.lift(2)
    check(joy(pg) == [DOWN | RIGHT, 0], "alzato il fuoco: resta la direzione %s" % joy(pg))
    f.move(1, cx + 3, cy - 2)
    check(joy(pg) == [0, 0], "dito al centro (zona morta): fermo %s" % joy(pg))
    f.move(1, cx - 250, cy)
    check(joy(pg) == [LEFT, 0], "il dito esce dalla croce verso sinistra: la direzione resta %s" % joy(pg))
    f.lift(1)
    check(joy(pg) == [0, 0], "tutte le dita alzate: joystick fermi %s" % joy(pg))
    check(pg.evaluate("() => document.querySelectorAll('#tdir .arm.on').length") == 0, "nessun braccio illuminato")

    # scambio 1-2: il tocco va al joystick 2
    pg.evaluate("() => document.getElementById('b-swap').click()")
    f.press(1, cx, cy - td["h"] * 0.4)
    check(joy(pg) == [0, UP], "con lo scambio acceso il joystick a tocco muove il joystick 2 %s" % joy(pg))
    f.lift(1)
    pg.evaluate("() => document.getElementById('b-swap').click()")

    # stick che segue il dito
    choose(pg, "#tstick", "float")
    td2 = box(pg, "#tdir")
    check(pg.evaluate("() => document.getElementById('tdir').classList.contains('float')") and td2["w"] > td["w"], "«Segue il dito»: la zona del joystick si allarga (%.0f px)" % td2["w"])
    check(no_hscroll(pg), "«Segue il dito»: nessuno scorrimento orizzontale")
    x0, y0 = td2["x"] + td2["w"] * 0.7, td2["y"] + td2["h"] * 0.6
    f.press(1, x0, y0)
    check(joy(pg) == [0, 0] and visible(pg, "#tknob"), "appena appoggiato: fermo, compare il cerchio della levetta")
    f.move(1, x0, y0 - 40)
    check(joy(pg) == [UP, 0], "trascinato in su: su %s" % joy(pg))
    f.move(1, x0 - 40, y0)
    check(joy(pg) == [LEFT, 0], "trascinato a sinistra del punto d'appoggio: sinistra %s" % joy(pg))
    f.lift(1)
    check(joy(pg) == [0, 0] and not visible(pg, "#tknob"), "alzato: fermo, il cerchio sparisce")
    choose(pg, "#tstick", "cross")

    # tasto della tastiera della console
    pg.tap("#tkb")
    check(pg.evaluate("() => document.getElementById('vk').checked && document.getElementById('vkeys').classList.contains('on')") and pg.get_attribute("#tkb", "aria-pressed") == "true",
          "«Tastiera»: compare la tastiera della console (e la casella del pannello e' spuntata)")
    tp, vk = box(pg, "#tpad"), box(pg, "#vkeys")
    check(pg.evaluate("() => document.getElementById('play').contains(document.getElementById('vkeys'))") and tp["b"] - 1 <= vk["y"] <= tp["b"] + 30,
          "«Tastiera»: sta nell'area di gioco, subito sotto croce e fuoco (%.0f -> %.0f)" % (tp["b"], vk["y"]))
    check(vk["b"] <= 915 and vk["y"] >= 0, "verticale: la tastiera si vede tutta senza scorrere la pagina (fondo a %.0f su 915)" % vk["b"])
    stats = pg.inner_text("#stats")
    check("ridisegni:" in stats and "/s" in stats, "statistiche: ridisegni al secondo (%s)" % stats)
    if pg.evaluate("() => !!window.o2web.sink.ctx"):
        check("audio a vuoto:" in stats and " Hz, ritardo " in stats, "statistiche: audio a vuoto, frequenza e ritardo dell'audio")
    pg.tap("#tkb")
    check(not pg.evaluate("() => document.getElementById('vkeys').classList.contains('on')") and pg.get_attribute("#tkb", "aria-pressed") == "false", "«Tastiera» di nuovo: nascosta")

    # «Comandi a tocco: Mai» e di nuovo automatici; un dito giu' viene rilasciato
    f.press(1, cx, cy - td["h"] * 0.4)
    check(joy(pg) == [UP, 0], "dito giu' prima di spegnere i comandi")
    choose(pg, "#tmode", "off")
    check(not visible(pg, "#tpad") and joy(pg) == [0, 0], "«Mai»: comandi nascosti e joystick rilasciato %s" % joy(pg))
    check(not pg.evaluate("() => document.getElementById('play').contains(document.getElementById('vkeys'))"), "«Mai»: la tastiera della console torna al suo posto in fondo alla colonna")
    check(pg.evaluate("() => window.o2web.fullTarget().id") == "stage", "«Mai»: lo schermo intero torna quello del solo schermo")
    f.lift(1)
    choose(pg, "#tmode", "auto")
    check(visible(pg, "#tpad"), "«Automatici»: di nuovo visibili sul telefono")

    # schermo intero (se il browser di prova lo permette)
    pg.tap("#tkb")
    pg.tap("#b-full")
    try:
        pg.wait_for_function("() => !!document.fullscreenElement", timeout=3000)
        full = True
    except Exception:
        full = False
    if full:
        check(pg.evaluate("() => document.fullscreenElement.id") == "play", "schermo intero: e' #play (schermo + comandi a tocco)")
        check(pg.evaluate("() => document.getElementById('play').contains(document.getElementById('vkeys'))"), "schermo intero: la tastiera della console e' dentro, si vede")
        check(visible(pg, "#tdir") and visible(pg, "#tfire"), "schermo intero: croce e fuoco visibili")
        pg.evaluate("() => document.exitFullscreen()")
        pg.wait_for_function("() => !document.fullscreenElement", timeout=3000)
        settle(pg, 5)      # l'evento fullscreenchange arriva subito dopo
        check(pg.evaluate("() => document.getElementById('play').contains(document.getElementById('vkeys'))"), "uscendo dallo schermo intero, con i comandi a tocco, la tastiera resta vicino ai comandi")
    else:
        print("INFO  schermo intero non disponibile nel browser di prova: controllato solo il bersaglio (#play)")
    pg.tap("#tkb")
    ctx.close()

    # ================================================================ telefono in orizzontale (inglese)
    ctx, pg = open_page(b, 915, 412, True, "en")
    check(visible(pg, "#tpad") or visible(pg, "#tdir"), "orizzontale: comandi a tocco visibili")
    st, td, tr = box(pg, "#stage"), box(pg, "#tdir"), box(pg, "#tright")
    check(td["r"] <= st["x"] + 1 and tr["x"] >= st["r"] - 1, "orizzontale: croce a sinistra dello schermo, fuoco a destra (%.0f | %.0f-%.0f | %.0f)" % (td["r"], st["x"], st["r"], tr["x"]))
    check(300 <= st["h"] <= 412, "orizzontale: lo schermo usa l'altezza del telefono e ci sta tutto (%.0f px su 412)" % st["h"])
    check(st["w"] >= 500, "orizzontale: lo schermo prende la larghezza fra croce e fuoco, il pannello va sotto (%.0f px)" % st["w"])
    sc = box(pg, "#screen")
    check(sc["w"] >= 450 and sc["h"] >= 330, "orizzontale: l'immagine della console e' grande (%.0f x %.0f)" % (sc["w"], sc["h"]))
    check(no_hscroll(pg), "orizzontale: nessuno scorrimento orizzontale")
    check(pg.inner_text("#tfire") == "Fire" and pg.inner_text("#tkb") == "Keyboard", "inglese: «Fire» e «Keyboard» (%r, %r)" % (pg.inner_text("#tfire"), pg.inner_text("#tkb")))
    opts = pg.evaluate("() => [...document.querySelectorAll('#tmode option, #tstick option')].map(o => o.textContent)")
    check(opts == ["Automatic (if the screen is a touch screen)", "Always", "Never", "Fixed cross", "Follows your finger"], "inglese: scelte dei comandi a tocco %s" % opts)
    left = pg.evaluate("() => window.o2web.I18N.untranslated(document).filter(t => /tocco|Fuoco|Tastiera\\b|Croce|dito|Sempre|Mai\\b|Automatici/.test(t))")
    check(left == [], "inglese: nessun testo dei comandi a tocco rimasto in italiano %s" % left)
    pg.locator("#play").screenshot(path=os.path.join(a.outdir, "play_orizzontale.png"), mask=[pg.locator("#stage")])
    start_game(pg)
    settle(pg)
    st, td = box(pg, "#stage"), box(pg, "#tdir")
    check(st["y"] >= -1 and st["b"] <= 412 + 1, "orizzontale: all'avvio del gioco la pagina scorre fino allo schermo, che si vede tutto (%.0f-%.0f)" % (st["y"], st["b"]))
    f = Fingers(ctx, pg)
    f.press(1, td["x"] + td["w"] / 2 + td["w"] * 0.4, td["y"] + td["h"] / 2)
    check(joy(pg) == [RIGHT, 0], "orizzontale: braccio destro della croce = destra %s" % joy(pg))
    f.lift(1)
    pg.wait_for_function("() => /redraws: /.test(document.getElementById('stats').textContent)", timeout=5000)
    check("redraws:" in pg.inner_text("#stats"), "inglese: statistiche con «redraws» (%s)" % pg.inner_text("#stats"))
    pg.tap("#tkb")
    settle(pg)
    vk = box(pg, "#vkeys")
    check(vk["y"] >= -1 and vk["b"] <= 412 + 1, "orizzontale: «Keyboard» porta la tastiera in vista (%.0f-%.0f)" % (vk["y"], vk["b"]))
    pg.tap("#tkb") if box(pg, "#tkb")["y"] >= 0 else pg.evaluate("() => document.getElementById('tkb').click()")
    ctx.close()

    # ================================================================ computer (niente tocco): come prima
    ctx, pg = open_page(b, 1280, 1000, False, "it")
    check(not pg.evaluate("() => matchMedia('(pointer: coarse)').matches"), "computer: niente schermo tattile")
    check(not pg.evaluate("() => document.body.classList.contains('touch-on')") and not visible(pg, "#tpad"), "computer: i comandi a tocco non compaiono")
    check(pg.evaluate("() => window.o2web.fullTarget().id") == "stage", "computer: lo schermo intero resta quello del solo schermo")
    check(not pg.evaluate("() => document.getElementById('play').contains(document.getElementById('vkeys'))"), "computer: la tastiera della console resta al suo posto in fondo alla colonna")
    check(no_hscroll(pg), "computer: nessuno scorrimento orizzontale")
    choose(pg, "#tmode", "on")
    check(visible(pg, "#tpad"), "computer, «Sempre»: i comandi a tocco compaiono anche senza schermo tattile")
    start_game(pg)
    td = box(pg, "#tdir")
    pg.mouse.move(td["x"] + td["w"] / 2, td["y"] + td["h"] * 0.1)
    pg.mouse.down()
    check(joy(pg) == [UP, 0], "computer, «Sempre»: anche il mouse sulla croce muove il joystick %s" % joy(pg))
    pg.mouse.up()
    check(joy(pg) == [0, 0], "mouse alzato: fermo")
    choose(pg, "#tmode", "auto")
    check(not visible(pg, "#tpad"), "computer, di nuovo «Automatici»: nascosti")
    ctx.close()
    b.close()

check(not errors, "nessun errore in console: %s" % errors[:3])
check(not requests, "nessuna richiesta di rete: %s" % requests[:3])
print("OK: tutti i controlli della pagina sul telefono" if not fails else "FALLITI %d controlli" % fails)
sys.exit(1 if fails else 0)
