#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""browser_check.py - prova della pagina INTERA in un browser vero (Chromium di Playwright, senza testa): apre dist/o2web.html da
disco (file://), aggiunge BIOS e raccolte TOSEC (zip di zip, costruite al volo dai dump dell'utente), cerca e filtra l'elenco, avvia un
gioco, prova tastiera, joystick 1 e 2, gamepad (finto), reset console (F9), pausa (F8), suono (AudioContext), cambio di gioco con stato
memorizzato, cambio di BIOS, stato su file, sessione (salva, riapri in una pagina nuova, sessione rotta), tasti configurabili,
ingrandimento e proporzioni, tastiera a schermo, e controlla che non ci siano errori in console ne' richieste di rete.
Gli screenshot si fanno in locale (mostrano il menu del BIOS e i giochi): NON vanno consegnati ne' inclusi nei pacchetti.
Uso: python3 -I test/browser_check.py HTML DUMPS OUTDIR"""
import argparse
import json
import os
import sys
import tempfile
import zipfile

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")   # Windows: l'uscita non e' UTF-8 e i testi della pagina hanno «», ●, ecc.

ap = argparse.ArgumentParser()
ap.add_argument("html")
ap.add_argument("dumps")
ap.add_argument("outdir")
a = ap.parse_args()
os.makedirs(a.outdir, exist_ok=True)
D = a.dumps
tmp = tempfile.mkdtemp()

errors, requests = [], []
fails = 0


def check(cond, msg):
    global fails
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        fails += 1


def nonblack(page):
    return page.evaluate("""() => {
      const c = document.getElementById('screen'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0, cols = new Set();
      for (let i = 0; i < d.length; i += 4) { if (d[i] | d[i + 1] | d[i + 2]) n++; cols.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); }
      return [n, cols.size];
    }""")


def build_tosec(src_dir, out):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for r, ds, fs in os.walk(src_dir):
            for f in sorted(fs):
                p = os.path.join(r, f)
                z.write(p, os.path.relpath(p, os.path.dirname(src_dir)))


def new_page(ctx, auto=False):
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.goto("file://" + os.path.abspath(a.html) + ("?lang=it" if auto else "?offline&lang=it"))     # le prove partono «?offline»: il caricamento automatico dei set da GitHub ha una sezione a parte
    return pg


def log_text(pg):
    return pg.inner_text("#log")


def ev(pg, js):
    return pg.evaluate(js)


o2zip = os.path.join(tmp, "o2.zip")
vpzip = os.path.join(tmp, "vp.zip")
have_tosec = os.path.isdir(os.path.join(D, "_tosec_o2"))
if have_tosec:
    build_tosec(os.path.join(D, "_tosec_o2", "Magnavox Odyssey 2 [TOSEC]"), o2zip)
    build_tosec(os.path.join(D, "_tosec_vp", "Philips Videopac+ [TOSEC]"), vpzip)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    ctx.add_init_script("""
      window.__pads = [];
      const real = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
      navigator.getGamepads = () => (window.__pads.length ? window.__pads : real());
    """)
    page = new_page(ctx)
    page.screenshot(path=os.path.join(a.outdir, "0_avvio.png"))
    check(page.is_visible("#splash"), "schermata di avvio originale visibile")
    badges = ev(page, "() => ['s-bios', 's-char', 's-games'].map(id => document.querySelector('#' + id + ' .badge').textContent)")
    check(badges == ["MANCA", "GPL", "MANCA"], "schermata di avvio: BIOS e giochi «MANCA», set di caratteri «GPL» (set incluso in uso) (%s)" % badges)
    check("GPL" in page.inner_text("#s-char") and "ingiocabili" in page.inner_text("#s-char"), "schermata di avvio: avviso in evidenza sul set di caratteri GPL")
    check(ev(page, "() => document.getElementById('c-char').classList.contains('miss')") and "GPL" in page.inner_text("#c-char"), "pannello «Macchina e giochi»: set di caratteri GPL segnalato")
    lic = ev(page, "() => document.getElementById('gpl-text').textContent")
    check("GNU GENERAL PUBLIC LICENSE" in lic and "Version 3, 29 June 2007" in lic and "END OF TERMS AND CONDITIONS" in lic and len(lic) > 30000, "testo completo della GPL-3.0 nella pagina (%d caratteri)" % len(lic))
    about = ev(page, "() => document.getElementById('d-about').textContent")
    check("GNU General Public License" in about and "senza alcuna garanzia" in about and "2026 by Agara73" in about and "solo il codice" in about, "pannello «Informazioni e licenza»: avviso GPL, nessuna garanzia, copyright, solo il codice")
    pc = ev(page, "() => document.getElementById('photo-credits').textContent")
    check("non sono coperte dalla GPL" in pc and all(n in pc for n in ("Odyssey", "G7000", "G7200", "G7400", "Evan-Amos", "Jzh2074", "Marco van den Hout", "CC BY-SA")) and ev(page, "() => document.querySelectorAll('#photo-credits li').length") == 4 and "da completare" not in pc, "«Informazioni e licenza»: crediti delle 4 foto (autore, licenza), con l'avviso che non sono GPL")
    check("2026 by Agara73" in page.inner_text("footer") and "rispettivi titolari" in page.inner_text("footer"), "piede: copyright e titolari di giochi e BIOS")
    src = ev(page, "() => document.documentElement.outerHTML")
    check("SPDX-License-Identifier: GPL-3.0-only" in src and src.count("2026 by Agara73") >= 3, "la pagina porta l'identificatore della licenza e il copyright")
    check(page.is_disabled("#b-start") and page.is_disabled("#b-reset") and page.is_disabled("#b-pause"), "comandi disabilitati senza BIOS")

    # ---- elenco: BIOS singoli + due raccolte TOSEC
    page.set_input_files("#f-files", [os.path.join(D, "bios/o2rom.bin"), os.path.join(D, "bios/c52.bin"), os.path.join(D, "bios/g7400.bin")])
    page.wait_for_timeout(400)
    check(len(ev(page, "() => [...document.querySelectorAll('#bios-sel option')].map(o => o.value)")) == 3, "tre BIOS nell'elenco")
    check(not page.is_disabled("#b-start"), "Avvia abilitato (BIOS G7000 scelto in automatico)")
    check(ev(page, "() => document.querySelector('#s-bios .badge').textContent") == "PRONTO" and ev(page, "() => document.querySelector('#s-char .badge').textContent") == "GPL", "schermata di avvio: BIOS pronto, set di caratteri GPL in uso")
    if have_tosec:
        page.set_input_files("#f-files", [o2zip, vpzip])
        page.wait_for_function("() => document.querySelectorAll('#games li').length >= 100", timeout=15000)
        n_games = ev(page, "() => window.o2web.app.lib.games.length")
        check(n_games == 167, "raccolte TOSEC: 167 giochi (%d)" % n_games)
        check(ev(page, "() => window.o2web.app.lib.bios.length") == 4, "BIOS con lo stesso contenuto elencati una volta sola: 4 in tutto")
        opts = ev(page, "() => [...document.querySelectorAll('#folder option')].map(o => o.textContent)")
        check(len(opts) == 5, "filtro cartelle: tutte + 4 (%s)" % "; ".join(opts))
        page.fill("#q", "demon attack")
        page.wait_for_timeout(150)
        rows = page.query_selector_all("#games li")
        check(len(rows) >= 2, "ricerca «demon attack»: %d risultati" % len(rows))
        page.fill("#q", "")
        page.select_option("#folder", index=2)
        page.wait_for_timeout(150)
        check(0 < len(page.query_selector_all("#games li")) < 167, "filtro per cartella: %s righe" % len(page.query_selector_all("#games li")))
        page.select_option("#folder", index=0)
        page.fill("#q", "killer bees")
        page.wait_for_timeout(150)
        page.screenshot(path=os.path.join(a.outdir, "1_elenco.png"))
        page.click("#games li button.g")
    else:
        page.set_input_files("#f-files", [os.path.join(D, "killerbees.bin"), os.path.join(D, "pickaxepete.bin"), os.path.join(D, "blockout.bin")])
        page.wait_for_timeout(400)
        page.click("#games li button.g")
    page.wait_for_timeout(1800)
    n, ncol = nonblack(page)
    page.screenshot(path=os.path.join(a.outdir, "2_gioco.png"))
    check(ev(page, "() => window.o2web.app.running"), "il gioco scelto dall'elenco e' in esecuzione")
    check("set di caratteri GPL incluso" in log_text(page) and "ingiocabili" in log_text(page), "avvio senza set di caratteri: avviso nel registro")
    check(n > 500, "schermo disegnato (%d pixel non neri, %d colori)" % (n, ncol))
    check(not page.is_visible("#splash"), "schermata di avvio nascosta")
    stats = page.inner_text("#stats")
    print("INFO  " + stats)
    check("audio" in stats, "passo di temporizzazione indicato (%s)" % stats[-40:])
    check(ev(page, "() => window.o2web.sink.running"), "AudioContext in funzione")
    check(ev(page, "() => window.o2web.app.audioPaced"), "passo guidato dall'audio")
    # il suono produce campioni
    q = ev(page, "() => window.o2web.sink.pushed")
    check(q > 10000, "campioni audio programmati (%d)" % q)

    # ---- tasti: console, joystick 1, joystick 2, F9, F8
    page.keyboard.down("ArrowLeft")
    page.keyboard.down("Numpad4")
    page.wait_for_timeout(300)
    joy = ev(page, "() => [...window.o2web.app.con.joy]")
    page.keyboard.up("ArrowLeft")
    page.keyboard.up("Numpad4")
    check(joy == [8, 8], "freccia sinistra = joystick 1, tastierino 4 = joystick 2 (letto %s)" % joy)
    page.keyboard.down("Control")
    page.keyboard.down("ArrowUp")
    page.wait_for_timeout(300)
    joy = ev(page, "() => [...window.o2web.app.con.joy]")
    page.keyboard.up("ArrowUp")
    page.keyboard.up("Control")
    check(joy[0] == 0x11, "Ctrl (fuoco) + freccia su insieme: %s" % joy)
    page.keyboard.down("a")
    page.wait_for_timeout(200)
    rows_ = ev(page, "() => [...window.o2web.app.con.keyRows]")
    page.keyboard.up("a")
    check(any(rows_), "tasto della console premuto (%s)" % rows_)
    # gamepad finto
    page.evaluate("""() => { window.__pads = [{connected: true, index: 0, id: 'Pad finto', buttons: Array.from({length: 17}, (_, i) => ({pressed: i === 15 || i === 0, value: 0})), axes: [0, 0]}]; }""")
    page.wait_for_timeout(700)
    joy = ev(page, "() => [...window.o2web.app.con.joy]")
    check(joy[0] == 0x12, "gamepad finto = joystick 1 destra + fuoco (%s)" % joy)
    check("1 gamepad" in page.text_content("#pad-info"), "gamepad elencato")
    page.evaluate("() => { window.__pads = []; }")
    page.wait_for_timeout(200)
    # reset console
    page.keyboard.press("F9")
    page.wait_for_timeout(80)
    check("Reset della console" in log_text(page) and page.inner_text("#toast") == "Reset console", "F9 = reset console (messaggio e avviso sullo schermo)")
    page.keyboard.press("F8")
    page.wait_for_timeout(200)
    check(ev(page, "() => window.o2web.app.paused") and "Riprendi" in page.inner_text("#b-pause"), "F8 = pausa")
    t1 = ev(page, "() => window.o2web.app.con.cpu.now")
    page.wait_for_timeout(300)
    check(ev(page, "() => window.o2web.app.con.cpu.now") == t1, "in pausa il tempo non avanza")
    page.keyboard.press("F8")

    # ---- cambio di gioco: stato memorizzato; riprendi
    page.fill("#q", "")
    page.wait_for_timeout(2500)
    first_id = ev(page, "() => window.o2web.app.gameId")
    others = ev(page, "() => window.o2web.app.lib.games.map(g => g.id).filter(i => i !== window.o2web.app.gameId).slice(0, 3)")
    page.click("#games li[data-id='%d'] button.g" % others[0])
    page.wait_for_timeout(500)
    check(ev(page, "() => window.o2web.app.gameId") == others[0], "cambio gioco con un clic")
    has = ev(page, "() => window.o2web.app.hasState(%d)" % first_id)
    check(has, "stato del gioco lasciato memorizzato")
    check(page.query_selector("#games li[data-id='%d'] button.mem" % first_id) is not None, "marcatore dello stato memorizzato nell'elenco")
    page.click("#games li[data-id='%d'] button.mem" % first_id)
    page.wait_for_timeout(300)
    check(ev(page, "() => window.o2web.app.gameId") == first_id and "Ripresa" in log_text(page), "riprendi la partita memorizzata")

    # ---- BIOS: cambio = reset; stato legato al BIOS
    c52 = ev(page, "() => window.o2web.app.lib.bios.find(b => /C52/.test(b.display)).id")
    page.select_option("#machine-sel", "c52")
    page.wait_for_timeout(400)
    check(ev(page, "() => window.o2web.app.bios.display").find("C52") >= 0 and ev(page, "() => window.o2web.app.running"), "cambio BIOS: C52, console ripartita")
    page.click("#games li[data-id='%d'] button.mem" % first_id)
    page.wait_for_timeout(200)
    check("altro BIOS" in log_text(page), "stato di un altro BIOS: non si riprende, messaggio nella pagina")
    # ---- tappa 5: Videopac+ G7400 (EF9340/EF9341): BIOS, set di caratteri dell'EF9341 come ingresso, pin B, avvio, schermo
    check(ev(page, "() => window.o2web.app.lib.bios.every(b => b.supported)"), "tutti i BIOS noti sono utilizzabili (G7400 e Jopac compresi)")
    g74 = ev(page, "() => window.o2web.app.lib.bios.find(b => b.known && b.known.system === 'g7400' && /G7400/.test(b.known.label)).id")
    vpc = os.path.join(D, "carts", "vp_killer_bees.bin")
    page.set_input_files("#f-files", [vpc])
    page.wait_for_timeout(300)
    vid = ev(page, "() => { const g = window.o2web.app.lib.games.filter(g => /killer/i.test(g.display)); const v = g.find(x => /Videopac\\+/i.test((x.platform || '') + ' ' + (x.folder || ''))) || g[g.length - 1]; return v.id; }")
    page.select_option("#machine-sel", "g7400")
    page.wait_for_timeout(500)
    check(ev(page, "() => window.o2web.app.isG7400"), "BIOS G7400 scelto: console Videopac+")
    check(ev(page, "() => document.querySelector('#n-efchar .badge').textContent") == "GPL", "set EF9341: segnato «GPL» con il BIOS G7400")
    ev(page, "() => window.o2web.app.start(%d)" % vid)
    page.wait_for_timeout(1500)
    check(ev(page, "() => window.o2web.app.running && window.o2web.app.con.g7400"), "G7400: gioco Videopac+ in esecuzione")
    check("EF9341" in log_text(page) and "GPL" in log_text(page), "G7400 senza set EF9341: avviso nel registro")
    n, ncol = nonblack(page)
    page.screenshot(path=os.path.join(a.outdir, "5_g7400.png"))
    check(n > 500, "G7400: schermo disegnato (%d pixel non neri, %d colori)" % (n, ncol))
    check(ev(page, "() => window.o2web.app.con.cartBHigh") in (True, 1), "pin B automatico: alto per un gioco Videopac+")
    # il set EF9341: dimensione sbagliata rifiutata, giusta accettata (la console riparte)
    bad = os.path.join(tmp, "ef_bad.bin")
    open(bad, "wb").write(bytes(100))
    page.set_input_files("#f-files", bad)
    page.wait_for_timeout(300)
    check("saltat" in log_text(page) and ev(page, "() => !window.o2web.app.efCharset"), "set EF9341 di dimensione sbagliata (punto unico di caricamento): non preso come set")
    good = os.path.join(tmp, "ef_good.bin")
    open(good, "wb").write(bytes((i * 7 + 3) & 0xFF for i in range(2560)))
    page.set_input_files("#f-files", good)
    page.wait_for_timeout(600)
    check(ev(page, "() => document.querySelector('#n-efchar .badge').textContent") == "PRONTO" and ev(page, "() => window.o2web.app.running"), "set EF9341 accettato: «PRONTO», console ripartita")
    # pin B: forzato basso, la console riparte a freddo
    check(page.is_visible("#pinb"), "pin B: visibile solo con il G7400 (ora si vede)")
    page.select_option("#pinb", "low")
    page.wait_for_timeout(500)
    check(ev(page, "() => !window.o2web.app.con.cartBHigh") and "Pin B" in log_text(page), "pin B forzato «basso»: la console riparte")
    page.select_option("#pinb", "auto")
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(a.outdir, "5_g7400_ef.png"))
    # sessione con G7400: salva e riapri
    ev(page, "() => window.o2web.app.clearEfCharset()")
    page.wait_for_timeout(300)
    check(ev(page, "() => document.querySelector('#n-efchar .badge').textContent") == "GPL", "set EF9341 tolto: di nuovo «GPL»")
    ev(page, "() => window.o2web.renderAll()")
    page.select_option("#machine-sel", "g7000")
    page.wait_for_timeout(300)
    check(ev(page, "() => !window.o2web.app.isG7400") and ev(page, "() => document.querySelector('#n-efchar .badge').textContent") == "NON SERVE", "ritorno al BIOS G7000: set EF9341 «NON SERVE»")
    check(not page.is_visible("#pinb"), "pin B: nascosto con una macchina diversa dal G7400")
    # ---- tappa 6a: modulo scacchi Philips C7010 (con le ROM VERE in DUMPS/chess/, se ci sono: restano in locale; screenshot locali)
    vpc7 = os.path.join(D, "chess", "vp_c7010.bin")
    z80c = os.path.join(D, "chess", "z80_c7010.bin")
    if os.path.exists(vpc7) and os.path.exists(z80c):
        pq = new_page(ctx)
        pq.set_input_files("#f-files", [os.path.join(D, "bios", "o2rom.bin"), vpc7])
        pq.wait_for_timeout(500)
        check(ev(pq, "() => window.o2web.app.lib.games.some(g => g.chess)"), "modulo scacchi: la cartuccia da 2 KB e' riconosciuta (CRC-32)")
        check(pq.is_visible("#chess-warn") and "8 KB" in pq.inner_text("#chess-warn"), "modulo scacchi: senza la ROM dello Z80 compare l'avviso")
        pq.select_option("#machine-sel", "g7000")
        pq.wait_for_timeout(300)
        pq.set_input_files("#f-files", [z80c])
        pq.wait_for_timeout(500)
        check(not pq.is_visible("#chess-warn") and ev(pq, "() => !!window.o2web.app.chessRom"), "modulo scacchi: ROM dello Z80 accettata (avviso sparito)")
        check(ev(pq, "() => document.querySelector('#n-chess .badge').textContent") == "PRONTO", "modulo scacchi: riquadro «PRONTO»")
        cid = ev(pq, "() => window.o2web.app.lib.games.find(g => g.chess).id")
        ev(pq, "() => window.o2web.app.start(%d)" % cid)
        pq.wait_for_timeout(1500)
        check(ev(pq, "() => window.o2web.app.running && !!window.o2web.app.con.chess"), "modulo scacchi: console in esecuzione con il modulo")
        ev(pq, "() => { const c = window.o2web.app.con.chess, o = c.out.bind(c); window.__zout = 0; c.out = (p, v) => { if ((v & 255) !== 0xFF) window.__zout++; return o(p, v); }; }")
        pq.keyboard.down("1"); pq.wait_for_timeout(300); pq.keyboard.up("1")       # menu del BIOS: tasto 1 (premuto abbastanza a lungo per la scansione)
        pq.wait_for_timeout(1500)
        for k in ("y", "1"):
            pq.keyboard.down(k); pq.wait_for_timeout(200); pq.keyboard.up(k); pq.wait_for_timeout(500)
        z0 = ev(pq, "() => window.__zout")
        for k in ("e", "2", "e", "4", "Enter"):
            pq.keyboard.down(k); pq.wait_for_timeout(200); pq.keyboard.up(k); pq.wait_for_timeout(500)
        for _ in range(40):                          # il motore pensa (Z80 a meta' del quarzo): fino a 20 s, finche' risponde
            pq.wait_for_timeout(500)
            if ev(pq, "() => window.__zout") - z0 >= 8:
                break
        pq.wait_for_timeout(2000)
        z1 = ev(pq, "() => window.__zout")
        pq.screenshot(path=os.path.join(a.outdir, "6a_chess.png"))
        check(z1 - z0 >= 8, "modulo scacchi: il motore risponde alla mossa E2-E4 dalla tastiera del PC (%d byte)" % (z1 - z0))
        # sessione con il modulo: salva e riapri
        ev(pq, "() => { document.getElementById('d-state').open = true; }")
        with pq.expect_download() as dl:
            pq.click("#b-sess-save")
        spath2 = os.path.join(tmp, "chess_session.zip")
        dl.value.save_as(spath2)
        pq2 = new_page(ctx)
        pq2.set_input_files("#f-files", spath2)
        pq2.wait_for_timeout(2500)
        check(ev(pq2, "() => !!window.o2web.app.chessRom && window.o2web.app.running && !!window.o2web.app.con.chess"), "modulo scacchi: la sessione riporta ROM dello Z80 e partita")
        pq2.close()
        pq.close()
    else:
        print("INFO  prova del modulo scacchi nel browser saltata: mancano le ROM vere in DUMPS/chess/")

    # ---- standard, ingrandimento, proporzioni
    ev(page, "() => { document.getElementById('d-adv').open = true; }")
    page.select_option("#std", "NTSC")
    page.wait_for_timeout(300)
    check(ev(page, "() => window.o2web.app.con.std") == "NTSC", "NTSC selezionato")
    page.select_option("#std", "PAL")
    page.select_option("#scale", "2")
    page.select_option("#aspect", "square")
    page.wait_for_timeout(200)
    w, h = ev(page, "() => [parseInt(document.getElementById('screen').style.width), parseInt(document.getElementById('screen').style.height)]")
    check((w, h) == (720, 486), "2x con punti quadrati: %dx%d" % (w, h))
    page.select_option("#aspect", "tv")
    w, h = ev(page, "() => [parseInt(document.getElementById('screen').style.width), parseInt(document.getElementById('screen').style.height)]")
    check((w, h) == (720, 540), "2x schermo 4:3: %dx%d" % (w, h))
    page.select_option("#scale", "0")
    page.check("#integer")
    w, h = ev(page, "() => [parseInt(document.getElementById('screen').style.width), parseInt(document.getElementById('screen').style.height)]")
    check(w % 360 == 0 and h == w * 3 // 4, "adatta, solo multipli interi: %dx%d" % (w, h))
    page.uncheck("#integer")
    page.screenshot(path=os.path.join(a.outdir, "3_impostazioni.png"))
    # schermo intero
    page.click("#b-full")
    page.wait_for_timeout(500)
    fs_ok = ev(page, "() => !!document.fullscreenElement")
    print("INFO  schermo intero in questo browser: %s" % fs_ok)
    if fs_ok:
        wf = ev(page, "() => parseInt(document.getElementById('screen').style.width)")
        check(wf >= 1280 * 0.5, "schermo intero: schermata ingrandita (%d)" % wf)
        page.keyboard.press("F10")
        page.wait_for_timeout(300)
        check(not ev(page, "() => !!document.fullscreenElement"), "F10 esce dallo schermo intero")

    # ---- aspetto (tappa 4b): monitor B/N, filtri da tubo catodico, disegno della macchina
    page.keyboard.press("F8")                                    # pausa: l'immagine non cambia mentre la si legge
    page.wait_for_timeout(150)
    check(ev(page, "() => window.o2web.app.paused"), "aspetto: console in pausa mentre si legge l'immagine")
    page.click("#d-look summary")
    cv = lambda: ev(page, "() => { const c = document.getElementById('screen'); return [c.width, c.height, c.classList.contains('smooth'), parseInt(c.style.width), parseInt(c.style.height)]; }")
    c0 = cv()
    check(c0[:3] == [360, 243, False], "aspetto: di partenza canvas 360 x 243, senza «smooth» (%s)" % c0)
    same = ev(page, """() => { const o = window.o2web, c = document.getElementById('screen'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
      p = o.screen.pipe.pal32, fb = o.app.con.fb; let bad = 0;
      for (let i = 0; i < fb.length; i++) { const v = p[fb[i] & 15]; if (d[i * 4] !== (v & 255) || d[i * 4 + 1] !== ((v >>> 8) & 255) || d[i * 4 + 2] !== ((v >>> 16) & 255)) bad++; }
      return bad; }""")
    check(same == 0, "aspetto: con i filtri spenti l'immagine e' esattamente quella del chip (%d pixel diversi)" % same)
    machine0 = ev(page, "() => ({kind: window.o2web.app.machine.kind, cap: document.getElementById('machine-sel').options[document.getElementById('machine-sel').selectedIndex].textContent, vis: getComputedStyle(document.getElementById('machine')).display !== 'none'})")
    check(machine0["kind"] == "g7000" and machine0["vis"] and "Videopac G7000" in machine0["cap"], "macchina automatica con BIOS Videopac/Odyssey e PAL: G7000 (%s)" % machine0["cap"])
    svg0 = ev(page, "() => document.getElementById('machine-img').innerHTML")
    imgs = ev(page, "() => { const i = document.querySelector('#machine-img img'); return i ? [i.src.slice(0, 22), i.complete && i.naturalWidth > 100, i.alt, i.naturalWidth, getComputedStyle(i).display] : null; }")
    check(imgs is not None and imgs[0] == "data:image/webp;base64" and imgs[1] and "G7000" in imgs[2], "foto della macchina: WebP incorporato (data:), caricato e con testo alternativo (%s)" % (imgs,))
    check(ev(page, "() => !!document.querySelector('#splash-machine img')"), "la foto e' anche nella schermata di avvio")
    box = ev(page, "() => { const r = document.querySelector('#machine-img img').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }")
    check(100 < box[0] <= 300 and box[1] > 60, "foto della macchina: dimensioni sulla pagina %s" % box)
    check("Foto:" in page.inner_text("#machine-cap"), "didascalia con il credito della foto (%s)" % page.inner_text("#machine-cap"))
    check(not ev(page, "() => getComputedStyle(document.getElementById('splash')).display !== 'none'"), "schermata di avvio nascosta")
    page.select_option("#machine-sel", "odyssey2")
    page.wait_for_timeout(400)
    check(ev(page, "() => window.o2web.app.machine.kind") == "odyssey2" and ev(page, "() => window.o2web.app.con.std") == "NTSC" and "Odyssey" in page.eval_on_selector("#machine-sel", "e => e.options[e.selectedIndex].textContent"), "macchina Odyssey 2: NTSC e BIOS G7000 (%s)" % page.eval_on_selector("#machine-sel", "e => e.options[e.selectedIndex].textContent"))
    svg_o2 = ev(page, "() => document.getElementById('machine-img').innerHTML")
    check(svg_o2 != svg0 and "<img" in svg_o2, "la foto cambia con la macchina")
    page.select_option("#machine-sel", "g7000")
    page.wait_for_timeout(400)
    check(ev(page, "() => window.o2web.app.machine.kind") == "g7000" and ev(page, "() => window.o2web.app.con.std") == "PAL", "di nuovo G7000: PAL")
    page.select_option("#std", "NTSC")                           # avanzate: lo standard cambia ma la macchina scelta resta (si fissa)
    page.wait_for_timeout(400)
    check(ev(page, "() => window.o2web.app.machine.kind") == "g7000" and ev(page, "() => window.o2web.app.con.std") == "NTSC" and ev(page, "() => window.o2web.app.machinePref") == "g7000", "avanzate: standard NTSC con la macchina G7000 fissata")
    page.select_option("#std", "PAL")
    page.wait_for_timeout(400)
    page.keyboard.press("F8")                                    # cambiare standard riavvia la console: si rimette in pausa
    page.wait_for_timeout(150)
    check(ev(page, "() => window.o2web.app.paused"), "aspetto: console di nuovo in pausa")
    # bianco e nero: tutti i pixel hanno R = G = B, la macchina diventa il G7200
    page.select_option("#machine-sel", "g7200")
    page.wait_for_timeout(250)
    grey = ev(page, """() => { const c = document.getElementById('screen'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let bad = 0, nb = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) bad++; if (d[i]) nb++; } return [bad, nb]; }""")
    check(grey[0] == 0 and grey[1] > 500, "G7200: R = G = B su tutta l'immagine (%s)" % grey)
    check(ev(page, "() => window.o2web.app.machine.kind") == "g7200" and "G7200" in page.eval_on_selector("#machine-sel", "e => e.options[e.selectedIndex].textContent") and not ev(page, "() => window.o2web.app.paused === false && false"), "macchina G7200: schermo in bianco e nero (%s)" % page.eval_on_selector("#machine-sel", "e => e.options[e.selectedIndex].textContent"))
    check(ev(page, "() => document.getElementById('look-preset').value") == "esatto", "solo il B/N: il filtro resta «Nessun filtro»")
    page.locator("#screen").screenshot(path=os.path.join(a.outdir, "3b_bianco_e_nero.png"))
    page.select_option("#machine-sel", "g7000")
    page.wait_for_timeout(250)
    check(ev(page, "() => window.o2web.app.machine.kind") == "g7000" and not ev(page, "() => window.o2web.app.look.mono"), "G7000: tornano i colori")
    dis = page.eval_on_selector("#machine-sel", "e => [...e.options].filter(o => o.disabled).map(o => o.value).join()")
    exp = ev(page, "() => window.o2web.app.machineChoices().filter(c => !c.available).map(c => c.kind).join()")
    check(dis == exp, "macchine senza BIOS: in grigio, non scegliibili (%s)" % dis)
    # insiemi pronti
    page.select_option("#look-preset", "anni80")
    page.wait_for_timeout(300)
    c1 = cv()
    check(c1[:3] == [1080, 729, True] and c1[3:] == c0[3:], "«Tubo catodico anni '80»: canvas 1080 x 729 con «smooth», dimensione sulla pagina invariata (%s)" % c1)
    check(ev(page, "() => { const l = window.o2web.app.look; return l.blur > 0 && l.persist > 0 && l.glow > 0 && l.scan > 0 && l.mask > 0 && l.curve > 0 && l.detail === 3 && !l.mono; }"), "«anni '80»: tutti i filtri accesi, dettaglio 3")
    n1, ncol1 = nonblack(page)
    check(n1 > 10000 and ncol1 > 50, "con i filtri l'immagine non e' vuota (%d pixel, %d colori)" % (n1, ncol1))
    page.locator("#screen").screenshot(path=os.path.join(a.outdir, "3c_filtri.png"))
    # cursore: qualunque movimento porta a «Personalizzato»
    ev(page, "() => { const s = document.getElementById('look-scan'); s.value = '80'; s.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_timeout(200)
    check(ev(page, "() => window.o2web.app.look.scan") == 80 and ev(page, "() => document.getElementById('look-preset').value") == "custom" and page.inner_text("#look-scan-v") == "80", "cursore delle righe: valore 80, insieme «Personalizzato»")
    page.select_option("#look-detail", "4")
    page.wait_for_timeout(250)
    c2 = cv()
    check(c2[:2] == [1440, 972], "dettaglio 4 x 4: canvas 1440 x 972 (%s)" % c2)
    # valori fuori scala non passano (l'interfaccia li limita, ma app.setLook li rifiuta lo stesso)
    bad = ev(page, "() => window.o2web.app.setLook({blur: 500})")
    check(bad is False and ev(page, "() => window.o2web.app.look.blur") == 40, "valore fuori scala rifiutato")
    # il gioco continua a girare con i filtri (persistenza e scia comprese) e il tempo medio per fotogramma resta basso
    page.keyboard.press("F8")
    page.wait_for_timeout(1200)
    t_a = ev(page, "() => window.o2web.app.con.cpu.now")
    page.wait_for_timeout(500)
    t_b = ev(page, "() => window.o2web.app.con.cpu.now")
    check(t_b > t_a, "con tutti i filtri 4 x 4 la console continua a girare (%s -> %s, in pausa: %s, %s)" % (t_a, t_b, ev(page, "() => window.o2web.app.paused"), page.inner_text("#stats")))
    ms = ev(page, """() => { const o = window.o2web; const fb = o.app.con.fb; const t0 = performance.now(); for (let i = 0; i < 30; i++) o.screen.paint(fb); return (performance.now() - t0) / 30; }""")
    print("INFO  costo medio di un fotogramma con i filtri al massimo del 4 x 4 (anni 80 + dettaglio 4): %.1f ms" % ms)
    check(ms < 30, "filtri + dettaglio 4: meno di 30 ms per fotogramma (%.1f)" % ms)
    check(not ev(page, "() => window.o2web.app.paused"), "aspetto: console in marcia alla fine")
    # ritorno all'immagine esatta
    page.select_option("#look-preset", "esatto")
    page.wait_for_timeout(300)
    c3 = cv()
    check(c3[:3] == [360, 243, False], "«Nessun filtro»: di nuovo 360 x 243 esatti (%s)" % c3)
    # scelta della macchina a mano
    page.select_option("#machine-sel", "c52")
    page.wait_for_timeout(200)
    check("C52" in page.eval_on_selector("#machine-sel", "e => e.options[e.selectedIndex].textContent") and ev(page, "() => window.o2web.app.machinePref") == "c52" and ev(page, "() => document.getElementById('machine-img').innerHTML") != svg0, "macchina scelta: C52")
    c5 = ev(page, "() => document.getElementById('machine-img').innerHTML")          # per il C52 non c'e' una foto con fonte nota: disegno originale
    check(c5.startswith("<svg") and "<script" not in c5 and "<text" not in c5 and "href" not in c5 and "<image" not in c5 and "Foto:" not in page.inner_text("#machine-cap"), "C52: disegno originale SVG senza script, testi o rimandi (nessuna foto)")
    page.select_option("#machine-sel", "g7000")
    page.wait_for_timeout(200)
    check(ev(page, "() => window.o2web.app.machine.kind") == "g7000" and "Foto:" in page.inner_text("#machine-cap"), "di nuovo G7000, con la foto")
    page.screenshot(path=os.path.join(a.outdir, "3d_macchina.png"))
    page.click("#d-look summary")

    # ---- tasti configurabili
    page.click("#d-keys summary")
    page.click("#keytab button.cap[data-p='2'][data-a='up']")
    check("Premi un tasto" in page.inner_text("#keytab"), "cattura del tasto avviata")
    page.keyboard.press("KeyU")
    page.wait_for_timeout(150)
    check(ev(page, "() => window.o2web.app.bindings['2'].up") == ["KeyU"], "joystick 2 su = U")
    page.keyboard.down("u")
    page.wait_for_timeout(200)
    joy = ev(page, "() => [...window.o2web.app.con.joy]")
    page.keyboard.up("u")
    check(joy[1] == 1, "il nuovo tasto muove il joystick 2 (%s)" % joy)
    page.click("#keytab button.cap[data-p='2'][data-a='up']")
    page.keyboard.press("F9")
    check("riservato" in log_text(page), "F9 non si puo' associare")
    page.keyboard.press("Escape")
    check(ev(page, "() => window.o2web.ui.capture") is None, "Esc annulla la cattura")
    page.click("#p-portatile")
    check(ev(page, "() => window.o2web.app.bindings['2'].up") == ["KeyI"], "preset portatile")
    page.click("#p-tastierino")
    # tastiera a schermo
    page.check("#vk")
    page.focus("#screen")
    page.dispatch_event("#vkeys button[data-k='1']", "pointerdown", {"pointerId": 1})
    page.wait_for_timeout(120)
    r = ev(page, "() => [...window.o2web.app.con.keyRows]")
    page.dispatch_event("#vkeys button[data-k='1']", "pointerup", {"pointerId": 1})
    check(any(r), "tastiera a schermo: tasto premuto (%s)" % r)
    page.uncheck("#vk")

    # ---- stato su file
    page.click("#d-state summary")
    page.keyboard.press("F8")
    with page.expect_download() as dl:
        page.click("#b-save")
    path = os.path.join(a.outdir, "stato.o2state")
    dl.value.save_as(path)
    st = json.load(open(path, encoding="utf-8"))
    check(os.path.getsize(path) > 0 and st.get("format") == "o2web-snapshot" and st.get("version") == 4, "stato scaricato in formato o2web-snapshot v4")
    check("sound" in json.dumps(st.get("vdc", {})).lower() or "snd" in st.get("vdc", {}), "lo stato contiene il suono")
    page.keyboard.press("F8")
    page.wait_for_timeout(400)
    before = ev(page, "() => window.o2web.app.con.cpu.now")
    page.set_input_files("#f-files", path)
    page.wait_for_timeout(300)
    after = ev(page, "() => window.o2web.app.con.cpu.now")
    check("Stato caricato" in log_text(page) and after < before, "stato ricaricato dal file (tempo %s -> %s)" % (before, after))
    st2 = dict(st)
    st2["hashes"] = dict(st["hashes"], cart="0" * 64)
    bad = os.path.join(a.outdir, "stato_falso.o2state")
    open(bad, "w", encoding="utf-8").write(json.dumps(st2))
    con_before = ev(page, "() => window.o2web.app.con.cpu.now")
    page.set_input_files("#f-files", bad)
    page.wait_for_timeout(300)
    check("cartuccia che non" in log_text(page), "stato di una cartuccia sconosciuta: messaggio, la partita resta")

    # ---- sessione: salva, riapri in una pagina nuova
    check("non condividerlo" in page.inner_text("#d-state"), "l'avviso sui dump e' scritto accanto ai pulsanti")
    with page.expect_download() as dl:
        page.click("#b-sess-save")
    spath = os.path.join(a.outdir, "sessione.zip")
    dl.value.save_as(spath)
    sdata = open(spath, "rb").read()
    check(sdata[:2] == b"PK" and len(sdata) > 1000, "sessione scaricata (%d byte)" % len(sdata))
    check("non condividerlo" in log_text(page) or "non condividerlo" in page.inner_text("#log"), "messaggio di salvataggio con l'avviso")
    z = zipfile.ZipFile(spath)
    check(z.testzip() is None and "sessione.json" in z.namelist(), "la sessione e' uno zip valido")
    tot = ev(page, "() => window.o2web.app.lib.games.length")
    gtitle = ev(page, "() => window.o2web.app.game.display")
    pg2 = new_page(ctx)
    pg2.set_input_files("#f-files", spath)
    pg2.wait_for_function("() => window.o2web.app.running", timeout=8000)
    check(ev(pg2, "() => window.o2web.app.lib.games.length") == tot, "sessione riaperta in una pagina nuova: stesso elenco (%d)" % tot)
    check(ev(pg2, "() => window.o2web.app.game.display") == gtitle, "stesso gioco in uso (%s)" % gtitle)
    check("Sessione aperta" in log_text(pg2), "messaggio di sessione aperta")
    pg2.wait_for_timeout(800)
    n2, _ = nonblack(pg2)
    check(n2 > 300, "la partita della sessione e' sullo schermo (%d pixel)" % n2)
    pg2.screenshot(path=os.path.join(a.outdir, "4_sessione.png"))
    # sessione rotta: nessun cambiamento
    brk = bytearray(sdata)
    brk[len(brk) // 2] ^= 0xFF
    bpath = os.path.join(a.outdir, "sessione_rotta.zip")
    open(bpath, "wb").write(bytes(brk))
    pg2.set_input_files("#f-files", bpath)
    pg2.wait_for_timeout(500)
    check("non e' stata toccata" in log_text(pg2).replace("’", "'"), "sessione rotta: rifiutata, la partita resta")
    check(ev(pg2, "() => window.o2web.app.lib.games.length") == tot and ev(pg2, "() => window.o2web.app.running"), "sessione rotta: elenco e partita intatti")
    # trascinamento: si prova con un evento 'drop' finto
    pg2.close()


    # ---- pagina nuova: trascinamento di file, togliere dall'elenco, memorizza, svuota, set di caratteri, file sbagliati, volume
    import base64
    pg3 = new_page(ctx)
    kb_path = os.path.join(D, "killerbees.bin")
    pp_path = os.path.join(D, "pickaxepete.bin")
    files_js = []
    for pth in (os.path.join(D, "bios/o2rom.bin"), kb_path, pp_path):
        files_js.append({"name": os.path.basename(pth), "b64": base64.b64encode(open(pth, "rb").read()).decode()})
    pg3.evaluate("""(files) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bin = atob(f.b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        dt.items.add(new File([u], f.name));
      }
      window.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
    }""", files_js)
    pg3.wait_for_function("() => window.o2web.app.lib.games.length === 2", timeout=5000)
    check(ev(pg3, "() => window.o2web.app.lib.bios.length") == 1, "trascinamento di file sulla pagina: 1 BIOS e 2 giochi")
    pg3.click("#games li button.g")
    pg3.wait_for_timeout(800)
    check(ev(pg3, "() => window.o2web.app.running"), "gioco avviato dal trascinamento")
    pg3.wait_for_timeout(900)
    pg3.click("#b-memo")
    pg3.wait_for_timeout(200)
    check("memorizzato nella sessione" in log_text(pg3) and pg3.query_selector("#games button.mem") is not None, "Memorizza: messaggio e marcatore nell'elenco")
    ids = ev(pg3, "() => window.o2web.app.lib.games.map(g => g.id)")
    cur = ev(pg3, "() => window.o2web.app.gameId")
    other = [i for i in ids if i != cur][0]
    pg3.click("#games li[data-id='%d'] button[data-act='remove']" % other)
    pg3.wait_for_timeout(150)
    check(ev(pg3, "() => window.o2web.app.lib.games.length") == 1, "gioco tolto dall'elenco con il pulsante")
    pg3.click("#games li[data-id='%d'] button[data-act='remove']" % cur)
    pg3.wait_for_timeout(150)
    check("in uso" in log_text(pg3) and ev(pg3, "() => window.o2web.app.lib.games.length") == 1, "il gioco in uso non si toglie")
    # file sbagliati
    junk = os.path.join(tmp, "rotto.zip")
    open(junk, "wb").write(b"PK\x03\x04" + bytes(range(60)))
    pg3.set_input_files("#f-files", junk)
    pg3.wait_for_timeout(300)
    check(ev(pg3, "() => window.o2web.app.running") and ("danneggiato" in log_text(pg3) or "non valid" in log_text(pg3) or "Nessun gioco" in log_text(pg3)), "zip rotto: messaggio, la partita continua")
    # set di caratteri: ingresso come il BIOS. Scelta esplicita (pulsante), riconoscimento da file singolo e da zip, riavvio a freddo se gira un gioco
    ch = os.path.join(tmp, "charset.bin")
    open(ch, "wb").write(bytes(range(256)) * 2)
    frames_before = ev(pg3, "() => window.o2web.app.framesRun")
    with pg3.expect_file_chooser() as fc:
        pg3.click("#b-add")
    fc.value.set_files(ch)
    pg3.wait_for_timeout(300)
    check("Set di caratteri dell" in log_text(pg3) and ev(pg3, "() => !!window.o2web.app.charset"), "set di caratteri da 512 byte accettato (pulsante «Aggiungi file»)")
    check("la console riparte" in log_text(pg3) and ev(pg3, "() => window.o2web.app.running && window.o2web.app.framesRun < 30"), "mentre gira un gioco: la console riparte a freddo col set nuovo")
    check("PRONTO" in pg3.text_content("#n-char") and ev(pg3, "() => document.getElementById('n-char').classList.contains('ok')") and "SHA-256" in pg3.text_content("#char-info"), "pannello: set di caratteri pronto, con impronta SHA-256")
    sha_shown = pg3.text_content("#char-info")
    check(ev(pg3, "() => window.o2web.app.charsetSha.slice(0, 12)") in sha_shown, "l'impronta mostrata e' quella del file in uso")
    ch100 = os.path.join(tmp, "charset_corto.bin")
    open(ch100, "wb").write(bytes(100))
    pg3.set_input_files("#f-files", ch100)
    pg3.wait_for_timeout(200)
    check("saltat" in log_text(pg3) and ev(pg3, "() => !!window.o2web.app.charset"), "file di 100 byte: saltato, resta il set di prima")
    pg3.evaluate("() => { document.getElementById('d-sets').open = true; }")
    pg3.click("#b-char-clear")
    pg3.wait_for_timeout(200)
    check(ev(pg3, "() => window.o2web.app.charset") is None and ev(pg3, "() => window.o2web.app.running"), "torna al set di ripiego (la console riparte a freddo)")
    check("GPL" in pg3.text_content("#n-char"), "pannello: di nuovo «GPL»")
    # riconoscimento dalla dimensione: file singolo tra gli altri file, poi dentro uno zip
    cs2 = os.path.join(tmp, "set da riconoscere.bin")
    open(cs2, "wb").write(bytes((i * 7) & 255 for i in range(512)))
    pg3.set_input_files("#f-files", cs2)
    pg3.wait_for_timeout(300)
    check(ev(pg3, "() => window.o2web.app.charsetName") == "set da riconoscere.bin", "un file da 512 byte aggiunto con gli altri e' riconosciuto come set di caratteri")
    check(ev(pg3, "() => window.o2web.app.lib.games.length") == 1 and ev(pg3, "() => window.o2web.app.lib.bios.length") == 1, "il set di caratteri non finisce nell'elenco dei giochi o dei BIOS")
    pg3.evaluate("() => { document.getElementById('d-sets').open = true; }")
    pg3.click("#b-char-clear")
    pg3.wait_for_timeout(200)
    zcs = os.path.join(tmp, "firmware.zip")
    with zipfile.ZipFile(zcs, "w", zipfile.ZIP_DEFLATED) as zz:
        zz.writestr("Firmware/charset_i8244.bin", bytes((i * 11 + 3) & 255 for i in range(512)))
    pg3.set_input_files("#f-files", zcs)
    pg3.wait_for_timeout(300)
    check(ev(pg3, "() => window.o2web.app.charsetName") == "charset_i8244.bin", "set di caratteri dentro uno zip: riconosciuto")
    pg3.screenshot(path=os.path.join(a.outdir, "5_file_necessari.png"))
    # volume e silenzio
    pg3.fill("#volume", "30")
    pg3.dispatch_event("#volume", "input")
    pg3.check("#muted")
    check(abs(ev(pg3, "() => window.o2web.app.settings.volume") - 0.3) < 1e-9 and ev(pg3, "() => window.o2web.sink.muted"), "volume e silenzio")
    # svuota elenco (due passi)
    pg3.click("#b-clearlib")
    check("Sicuro" in pg3.inner_text("#b-clearlib") and ev(pg3, "() => window.o2web.app.lib.games.length") == 1, "Svuota: prima chiede conferma")
    pg3.click("#b-clearlib")
    pg3.wait_for_timeout(200)
    check(ev(pg3, "() => window.o2web.app.lib.games.length") == 0 and not ev(pg3, "() => window.o2web.app.running") and pg3.is_visible("#splash"), "Svuota: elenco vuoto, macchina ferma, schermata di avvio")
    pg3.close()

    # ---- tappa 4c: rete su richiesta e copertine. Le risposte le inventa il browser di prova (ctx.route): nessuna richiesta esce davvero dal sandbox.
    import struct
    import zlib

    def mkpng(w, h, seed):
        raw = b"".join(b"\x00" + bytes(((x * 7 + y * 3 + seed * 11 + c * 50) & 255) for x in range(w) for c in range(3)) for y in range(h))
        def chunk(t, d):
            return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

    NET_HOST = "https://test.invalid/"
    ARCH = "https://archive.org/download/"
    hits, bad_hits, pending = [], [], []
    zgames = os.path.join(tmp, "net_games.zip")
    with zipfile.ZipFile(zgames, "w", zipfile.ZIP_DEFLATED) as zz:
        zz.write(os.path.join(D, "pickaxepete.bin"), "Pickaxe Pete (198x)(Philips)(EU).bin")
    zgames_b = open(zgames, "rb").read()
    CORS = {"access-control-allow-origin": "*"}

    def note(route):
        rq = route.request
        hits.append((rq.method, rq.url, {k.lower(): v for k, v in rq.headers.items()}))

    def r_games(route):
        note(route)
        route.fulfill(status=200, headers=dict(CORS, **{"content-type": "application/zip"}), body=zgames_b)

    def r_png(route):
        note(route)
        route.fulfill(status=200, headers=dict(CORS, **{"content-type": "image/png"}), body=mkpng(40, 60, 1))

    def r_nocors(route):
        # il sito non e' raggiungibile / non permette la lettura: per la pagina e' lo stesso errore di rete (il rispetto vero della regola CORS di un sito non si prova da qui:
        # Playwright non la applica alle risposte inventate, ed e' DA VERIFICARE con archive.org in un browser vero)
        note(route)
        route.abort("failed")

    def r_404(route):
        note(route)
        route.fulfill(status=404, headers=CORS, body=b"no")

    def r_session(route):
        note(route)
        route.fulfill(status=200, headers=CORS, body=sdata)

    def r_slow(route):
        note(route)
        pending.append(route)             # non risponde finche' non lo decide il test

    def r_to_http(route):
        note(route)
        route.fulfill(status=302, headers=dict(CORS, **{"location": "http://test.invalid/insecure.zip"}), body=b"")

    def r_http(route):
        bad_hits.append(route.request.url)
        route.fulfill(status=200, headers=CORS, body=zgames_b)

    ctx.route(NET_HOST + "games.zip", r_games)
    ctx.route(ARCH + "**", r_games)
    ctx.route(NET_HOST + "cover/**", r_png)
    ctx.route(NET_HOST + "nocors.zip", r_nocors)
    ctx.route(NET_HOST + "missing.zip", r_404)
    ctx.route(NET_HOST + "session.zip", r_session)
    ctx.route(NET_HOST + "slow.zip", r_slow)
    ctx.route(NET_HOST + "redir.zip", r_to_http)
    ctx.route("http://**/*", r_http)

    pn = new_page(ctx)
    pn.set_input_files("#f-files", [os.path.join(D, "bios", "o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pn.wait_for_function("() => window.o2web.app.lib.games.length === 1", timeout=8000)
    pn.wait_for_timeout(500)
    check(not hits, "rete: nessuna richiesta partita da sola all'apertura (%s)" % [h[1] for h in hits])
    pn.evaluate("() => document.getElementById('d-net').open = true")
    check(pn.is_visible("#net-url") and pn.is_visible("#net-go") and pn.is_disabled("#net-cancel"), "rete: campo indirizzo, Scarica attivo, Annulla spento")
    check(pn.locator("#net-sugg").count() == 0, "rete: nessun indirizzo suggerito nel pannello Rete (archive.org non permette la lettura da una pagina: niente collegamenti a raccolte)")

    # ordine di «Macchina e giochi»: macchina, elenco dei giochi, punto unico di caricamento, chip di stato, set di caratteri (chiuso)
    pn.evaluate("() => document.getElementById('d-games').open = true")
    order = pn.evaluate("""() => ['machine-sel', 'q', 'folder', 'games', 'b-add', 'chips', 'd-sets'].map(id => document.getElementById(id).getBoundingClientRect().top)""")
    check(all(order[i] < order[i + 1] or abs(order[i] - order[i + 1]) < 1 for i in range(len(order) - 1)) and order == sorted(order), "layout: ordine macchina, giochi, caricamento unico, stato, set di caratteri (%s)" % order)
    seq = pn.evaluate("() => [...document.querySelectorAll('#panel > details')].map(d => d.id)")
    check(seq == ["d-games", "d-state", "d-net", "d-look", "d-keys", "d-chars", "d-about"], "layout: pannelli in ordine, editor dei caratteri penultimo (%s)" % seq)
    txt_all = pn.evaluate("() => ['panel', 'splash'].map(i => document.getElementById(i).textContent).join(' ') + document.querySelector('header').textContent + document.querySelector('footer').textContent + document.documentElement.outerHTML.replace(/<script[\\s\\S]*?<\\/script>/g, '')")
    check("tosec" not in txt_all.lower() and pn.locator("#tosec-box, #tosec-links, a.btn").count() == 0, "pagina: nessun riferimento a TOSEC e nessun riquadro dei collegamenti")
    check(pn.locator("#plate").count() == 1 and pn.locator("#screenopts").count() == 1 and pn.evaluate("() => { const a = document.getElementById('screen').getBoundingClientRect().bottom, b = document.getElementById('plate').getBoundingClientRect(), c = document.getElementById('screenopts').getBoundingClientRect(); return a <= b.top && b.bottom <= c.top; }"), "layout: sotto lo schermo prima la piastra dei tasti, poi «Schermo e suono»")
    check(pn.locator("#d-games input[type=file]").count() == 1 and pn.locator("input[type=file]").count() == 1, "layout: un solo punto di caricamento in tutta la pagina (%d campi file)" % pn.locator("input[type=file]").count())
    for gone in ["b-char", "b-efchar", "b-load", "b-sess-open", "b-covers", "b-covers-dir", "ce-open", "net-sugg"]:
        check(pn.locator("#" + gone).count() == 0, "layout: tolto il pulsante ridondante #" + gone)

    # aiuto: le istruzioni stanno dietro i pulsanti «?» (riquadri nascosti), la pagina mostra solo gli stati brevi
    hb = pn.eval_on_selector_all("button.help", """els => els.map(b => { const bx = document.getElementById(b.getAttribute('aria-controls'));
      return [b.getAttribute('aria-controls'), b.getAttribute('aria-expanded'), (b.getAttribute('aria-label') || '').slice(0, 6), !!bx, bx ? bx.hidden : null, bx ? bx.textContent.trim().length : 0, b.textContent.trim()]; })""")
    check(len(hb) >= 12 and len(set(h[0] for h in hb)) == len(hb), "aiuto: i pulsanti «?» sono %d, ognuno con il proprio riquadro" % len(hb))
    check(all(h[1] == "false" and h[2] == "Aiuto:" and h[3] and h[4] and h[5] > 40 and h[6] == "?" for h in hb), "aiuto: tutti chiusi all'inizio, con etichetta «Aiuto: ...», riquadro nascosto e testo presente (%s)" % [h for h in hb if not (h[1] == "false" and h[3] and h[4] and h[5] > 40)])
    body_txt = pn.inner_text("body")
    for frase in ["Serve un BIOS", "unico punto di caricamento", "Il pulsante avvia il download normale", "stati (.o2state) e sessioni", "Disegno stilizzato e originale", "La sessione ricorda elenco", "Croce o levetta sinistra"]:
        check(frase not in body_txt, "aiuto: «%s» non e' scritto in pagina finche' non si preme «?»" % frase)
    check("Serve un BIOS" in pn.text_content("#h-machine") and "1024 byte" in pn.text_content("#h-machine"), "aiuto: «Serve un BIOS ... 1024 byte» sta nel riquadro della macchina")
    check(not pn.is_visible("#h-machine"), "aiuto: il riquadro del BIOS e' nascosto")
    pn.click("[aria-controls=h-machine]")
    check(pn.is_visible("#h-machine") and "Serve un BIOS" in pn.inner_text("#h-machine") and pn.get_attribute("[aria-controls=h-machine]", "aria-expanded") == "true", "aiuto: il clic su «?» mostra le istruzioni sul BIOS")
    pn.click("[aria-controls=h-machine]")
    check(not pn.is_visible("#h-machine") and pn.get_attribute("[aria-controls=h-machine]", "aria-expanded") == "false", "aiuto: un secondo clic le nasconde")
    pn.click("[aria-controls=h-drop]")
    check(pn.is_visible("#h-drop") and "unico punto di caricamento" in pn.inner_text("#h-drop") and "stati (.o2state) e sessioni" in pn.inner_text("#h-drop"), "aiuto: il riquadro di «Aggiungi file» elenca BIOS, set, cartucce, zip, TOSEC, stati e sessioni")
    pn.focus("[aria-controls=h-drop]")
    pn.keyboard.press("Escape")
    check(not pn.is_visible("#h-drop") and pn.get_attribute("[aria-controls=h-drop]", "aria-expanded") == "false", "aiuto: Esc chiude il riquadro dal pulsante")
    pn.focus("[aria-controls=h-drop]")
    pn.keyboard.press("Enter")
    check(pn.is_visible("#h-drop"), "aiuto: Invio sul pulsante apre il riquadro (accessibile da tastiera)")
    pn.keyboard.press("Space")
    check(not pn.is_visible("#h-drop"), "aiuto: Spazio sul pulsante lo richiude")
    check(not hits and not any("archive.org" in u for u in requests), "aiuto: aprire e chiudere gli aiuti non fa nessuna richiesta di rete")
    # ogni «?» dei pannelli apre e chiude il suo riquadro (si aprono prima tutti i pannelli)
    pn.evaluate("() => document.querySelectorAll('aside details').forEach(d => { d.open = true; })")
    bad_h = []
    for h in hb:
        if h[0] == "h-pinb": continue                              # visibile solo con il G7400 (provato nella sezione G7400)
        sel_b = "[aria-controls=%s]" % h[0]
        pn.click(sel_b)
        if not (pn.is_visible("#" + h[0]) and pn.get_attribute(sel_b, "aria-expanded") == "true"): bad_h.append(h[0] + ":apre")
        pn.click(sel_b)
        if pn.is_visible("#" + h[0]) or pn.get_attribute(sel_b, "aria-expanded") != "false": bad_h.append(h[0] + ":chiude")
    check(not bad_h, "aiuto: ognuno dei %d pulsanti «?» apre e richiude il suo riquadro (%s)" % (len(hb), bad_h))
    # istruzioni spostate: in pagina restano solo gli stati brevi
    pn.evaluate("() => document.querySelectorAll('aside > details').forEach(d => { d.open = true; })")
    panel_txt = pn.inner_text("#panel")
    for frase in ["aggiungi file .bin o uno zip", "aggiungi il BIOS Odyssey", "Premi un suo tasto", "nel dump della cartuccia", "Cambiano solo i colori mostrati", "non entrano nella sessione"]:
        check(frase.lower() not in panel_txt.lower(), "aiuto: «%s» non e' piu' in pagina" % frase)
    # pagina vuota (nessun BIOS, nessun gioco): niente istruzioni in pagina, solo stati brevi; poi con il gioco in corso i «?» funzionano ancora da tastiera
    pv = new_page(ctx)
    vt = pv.inner_text("body")
    check("Serve un BIOS" not in vt and "1024 byte" not in vt and "1024" not in pv.inner_text("#bios-info") and "nessun bios" in pv.inner_text("#machine-sel").lower(),
          "aiuto: senza BIOS la pagina non scrive le istruzioni («%s»)" % pv.inner_text("#chips").replace("\n", " | "))
    check(len(pv.inner_text("#splash .sub")) < 110, "aiuto: il testo della schermata di avvio e' breve (%d caratteri)" % len(pv.inner_text("#splash .sub")))
    pv.click("[aria-controls=h-machine]")
    check(pv.is_visible("#h-machine") and "Serve un BIOS" in pv.inner_text("#h-machine"), "aiuto: senza BIOS, il «?» mostra le istruzioni")
    pv.click("[aria-controls=h-machine]")
    pv.set_input_files("#f-files", [os.path.join(D, "bios", "o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pv.wait_for_function("() => window.o2web.app.lib.games.length === 1", timeout=8000)
    pv.click("#games button.g")
    pv.wait_for_function("() => window.o2web.app.running", timeout=8000)
    pv.evaluate("() => { document.getElementById('d-sets').open = true; }")
    pv.focus("[aria-controls=h-dl]")
    pv.keyboard.press("Enter")
    check(pv.is_visible("#h-dl") and "?offline" in pv.inner_text("#h-dl"), "aiuto: con il gioco in corso, Invio sul «?» apre l'aiuto (la tastiera non va alla console)")
    pv.keyboard.press("Space")
    check(not pv.is_visible("#h-dl"), "aiuto: con il gioco in corso, Spazio lo chiude")
    pv.close()

    # un archivio .zip scaricato a mano si aggiunge dal punto unico (qui costruito al volo, con dentro la cartuccia di prova)
    hits.clear()
    pt = new_page(ctx)
    zpath = os.path.join(tmp, "archivio.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(D, "killerbees.bin"), "Giochi/killerbees.bin")
    pt.set_input_files("#f-files", zpath)
    pt.wait_for_function("() => window.o2web.app.lib.games.length >= 1", timeout=8000)
    check("Aggiunti all" in log_text(pt), "archivio .zip: si aggiunge dal punto unico")
    pt.close()

    # set di caratteri da GitHub: due pulsanti, la rete parte solo dal clic (risposte inventate)
    cset_src = "uint8_t cset[512]= {\n" + ",".join("0x%02x" % ((i * 5 + 1) & 255) for i in range(512)) + "\n};\n"
    gh_hits = []
    def r_gh(route):
        gh_hits.append(route.request.url)
        route.fulfill(status=200, headers=dict(CORS, **{"content-type": "text/plain"}), body=cset_src.encode())
    ctx.route("https://raw.githubusercontent.com/libretro/libretro-o2em/master/src/*.c", r_gh)
    check(not gh_hits and not any("githubusercontent" in u for u in requests), "github: nessuna richiesta prima del clic")
    pn.evaluate("() => { document.getElementById('d-sets').open = true; }")
    check(pn.inner_text("#b-dl-vdc").startswith("Scarica il set di caratteri del chip video") and "EF9341" in pn.inner_text("#b-dl-ef"), "github: i due pulsanti dicono quale set scaricano")
    pn.click("#b-dl-vdc")
    pn.wait_for_function("() => !!window.o2web.app.charset && /cset\\.c/.test(window.o2web.app.charsetName)", timeout=8000)
    check(len(gh_hits) == 1 and gh_hits[0].endswith("/src/cset.c"), "github: il pulsante del chip video legge solo cset.c (%s)" % gh_hits)
    check(ev(pn, "() => window.o2web.app.net.busy") is False and not pn.is_disabled("#b-dl-vdc") and pn.is_hidden("#dl-prog"), "github: a scarico finito i pulsanti tornano a riposo")
    check("Set del chip video letto da cset.c" in log_text(pn), "github: messaggio di set letto")
    pn.evaluate("() => { document.getElementById('d-sets').open = true; }")
    pn.click("#b-dl-ef")
    pn.wait_for_function("() => document.getElementById('log').textContent.includes('non contiene il set dell')", timeout=8000)
    check(len(gh_hits) == 2 and gh_hits[1].endswith("/src/vpp_cset.c") and ev(pn, "() => !window.o2web.app.efCharset"), "github: il pulsante EF9341 legge vpp_cset.c (qui il file finto non ha la ROM: messaggio, nessun set cambiato)")
    # un sorgente C passa dal punto unico di caricamento
    csrc_path = os.path.join(tmp, "cset_mio.c")
    open(csrc_path, "w").write(cset_src.replace("0x01", "0x02", 1))
    pn.set_input_files("#f-files", csrc_path)
    pn.wait_for_function("() => window.o2web.app.charsetName === 'cset_mio.c'", timeout=8000)
    check("senza riavviare" in log_text(pn), "caricamento unico: un sorgente C con la tabella e' un set di caratteri, in uso subito")
    pn.evaluate("() => { document.getElementById('d-sets').open = true; }")
    pn.click("#b-char-clear")
    pn.wait_for_timeout(300)
    hits.clear()

    # Scarica: i suggerimenti non ci sono piu', si scrive l'indirizzo (qui una risposta inventata)
    sug = ARCH + "Magnavox_Odyssey_2_TOSEC_2012_04_23/Magnavox_Odyssey_2_TOSEC_2012_04_23.zip"
    pn.evaluate("() => document.getElementById('d-net').open = true")
    pn.fill("#net-url", sug)
    pn.select_option("#net-kind", "games")

    # Scarica: ora parte la richiesta (GET anonimo, senza referrer ne' cookie)
    n_before = ev(pn, "() => window.o2web.app.lib.games.length")
    pn.click("#net-go")
    pn.wait_for_function("(n) => window.o2web.app.lib.games.length > n", arg=n_before, timeout=8000)
    check(len(hits) == 1 and hits[0][0] == "GET" and hits[0][1] == sug, "rete: una sola richiesta GET all'indirizzo scelto (%s)" % [h[:2] for h in hits])
    hd = hits[0][2]
    check("referer" not in hd and "cookie" not in hd and "authorization" not in hd, "rete: nessun referrer, cookie o autorizzazione (%s)" % sorted(hd))
    check("Scaricato" in log_text(pn) and "Aggiunti all" in log_text(pn), "rete: messaggio di scarico riuscito e giochi aggiunti")
    check(ev(pn, "() => window.o2web.app.net.busy") is False and pn.is_disabled("#net-cancel") and not pn.is_disabled("#net-go") and pn.is_hidden("#net-prog"), "rete: a scarico finito i pulsanti tornano a riposo")

    # Invio nel campo = Scarica, copertina da un indirizzo (PNG sintetica: nome come il gioco)
    pn.select_option("#net-kind", "covers")
    pn.fill("#net-url", NET_HOST + "cover/Killer%20Bees%20(198x)(Philips)(EU).png")
    pn.press("#net-url", "Enter")
    pn.wait_for_function("() => window.o2web.app.covers.count === 1", timeout=8000)
    check(len(hits) == 2 and hits[1][1].startswith(NET_HOST + "cover/"), "rete: copertina scaricata con Invio (%d richieste)" % len(hits))
    pn.wait_for_function("() => document.querySelectorAll('#games img.th').length === 1", timeout=8000)
    pn.wait_for_function("() => { const i = document.querySelector('#games img.th'); return i && i.src && i.naturalWidth > 0; }", timeout=8000)
    check("1 copertina in memoria" in pn.inner_text("#covers-info") and "abbinate a 1 giochi su 2" in pn.inner_text("#covers-info") and not pn.is_disabled("#b-covers-clear"), "copertine: riepilogo (%s)" % pn.inner_text("#covers-info"))
    check("blob:" in ev(pn, "() => document.querySelector('#games img.th').src"), "copertine: la miniatura e' un blob in memoria, non un indirizzo di rete")

    # errori della rete: messaggi chiari, pagina intatta
    ngames = ev(pn, "() => window.o2web.app.lib.games.length")
    e0, r0 = len(errors), len(requests)          # da qui in poi alcuni errori di console sono previsti (rete simulata che fallisce, 404, reindirizzamento a http bloccato)
    pn.select_option("#net-kind", "games")
    pn.fill("#net-url", NET_HOST + "nocors.zip")
    pn.click("#net-go")
    pn.wait_for_function("() => !window.o2web.app.net.busy && document.getElementById('log').textContent.includes('CORS')", timeout=8000)
    check(ev(pn, "() => window.o2web.app.lib.games.length") == ngames, "rete: sito irraggiungibile o senza permesso CORS: il file non entra (%s)" % log_text(pn)[-160:])
    check("Aggiungi file" in log_text(pn), "rete: il messaggio di errore indica la strada a mano («Aggiungi file»)")
    pn.fill("#net-url", NET_HOST + "missing.zip")
    pn.click("#net-go")
    pn.wait_for_function("() => document.getElementById('log').textContent.includes('non esiste su test.invalid')", timeout=8000)
    check("errore 404" in log_text(pn), "rete: errore 404 spiegato")
    nh = len(hits)
    pn.fill("#net-url", NET_HOST + "redir.zip")
    pn.click("#net-go")
    pn.wait_for_function("() => !window.o2web.app.net.busy", timeout=8000)
    pn.wait_for_timeout(500)
    check(not bad_hits and ev(pn, "() => window.o2web.app.lib.games.length") == ngames and len(hits) == nh + 1, "rete: un reindirizzamento a http non viene seguito (richieste http: %s)" % bad_hits)
    pn.fill("#net-url", "http://test.invalid/games.zip")
    pn.click("#net-go")
    pn.wait_for_timeout(300)
    check(not bad_hits and "serve https" in log_text(pn), "rete: un indirizzo http e' rifiutato prima di ogni richiesta")
    pn.fill("#net-url", "ftp://test.invalid/games.zip")
    pn.click("#net-go")
    check("solo indirizzi https" in log_text(pn), "rete: ftp rifiutato")
    pn.fill("#net-url", "")
    pn.click("#net-go")
    check("Scrivi l" in log_text(pn), "rete: campo vuoto")

    # una sessione scaricata non si apre (la partita non cambia)
    pn.click("#games li button[data-act=play] >> nth=0")
    pn.wait_for_function("() => window.o2web.app.running", timeout=8000)
    gname = ev(pn, "() => window.o2web.app.game.display")
    pn.fill("#net-url", NET_HOST + "session.zip")
    pn.click("#net-go")
    pn.wait_for_function("() => document.getElementById('log').textContent.includes('non si apre da un indirizzo')", timeout=8000)
    check(ev(pn, "() => window.o2web.app.running") and ev(pn, "() => window.o2web.app.game.display") == gname, "rete: una sessione scaricata non sostituisce la partita in corso")

    # annullamento
    pn.fill("#net-url", NET_HOST + "slow.zip")
    pn.click("#net-go")
    pn.wait_for_function("() => window.o2web.app.net.busy", timeout=8000)
    check(not pn.is_disabled("#net-cancel") and pn.is_disabled("#net-go") and pn.is_disabled("#net-url") and "Scarico da test.invalid" in pn.inner_text("#net-status"), "rete: scarico in corso: Annulla attivo, Scarica e campo spenti")
    pn.click("#net-cancel")
    pn.wait_for_function("() => !window.o2web.app.net.busy && document.getElementById('log').textContent.includes('annullato')", timeout=8000)
    check(pn.is_disabled("#net-cancel") and not pn.is_disabled("#net-go"), "rete: scarico annullato, pulsanti a riposo")
    for r_ in pending:
        try:
            r_.abort()
        except Exception:
            pass

    pn.wait_for_timeout(300)
    exp = errors[e0:]
    # la frase cambia con Chromium: «Refused to connect to 'URL' because it violates...» (vecchie), «Connecting to 'URL' violates...» (156)
    csp_redirect = [e for e in exp if "'http://test.invalid/insecure.zip'" in e and "connect-src https:" in e
                    and ("Refused to connect to" in e or "violates the following Content Security Policy" in e)]
    others = [e for e in exp if e not in csp_redirect and not ("ERR_FAILED" in e or "ERR_ABORTED" in e or "status of 404" in e or "net::ERR_" in e)]
    check(len(csp_redirect) == 1 and not others, "rete: il browser blocca davvero il reindirizzamento a http (regola connect-src https:) e gli altri errori di console sono solo quelli previsti (%s)" % [e[:90] for e in exp])
    del errors[e0:]
    http_seen = [u for u in requests[r0:] if u.startswith("http://")]
    check(http_seen in ([], ["http://test.invalid/insecure.zip"]) and not bad_hits, "rete: nessuna richiesta http e' arrivata alla rete (%s)" % http_seen)
    requests[:] = requests[:r0] + [u for u in requests[r0:] if not u.startswith("http://test.invalid/insecure.zip")]

    # copertine dal disco: file singoli e cartella
    cdir = os.path.join(tmp, "covers_in")
    os.makedirs(os.path.join(cdir, "Box"), exist_ok=True)
    f1 = os.path.join(cdir, "Pickaxe Pete (198x)(Philips)(EU).png")
    f2 = os.path.join(cdir, "Box", "Demon Attack.png")
    f3 = os.path.join(cdir, "Box", "Bees.jpg")
    open(f1, "wb").write(mkpng(30, 40, 2))
    open(f2, "wb").write(mkpng(31, 41, 3))
    open(f3, "wb").write(b"non un'immagine")
    pn.set_input_files("#f-files", [f1])
    pn.wait_for_function("() => window.o2web.app.covers.count === 2", timeout=8000)
    pn.wait_for_function("() => document.getElementById('covers-info').textContent.startsWith('2 copertine')", timeout=8000)
    check("2 copertine in memoria" in pn.inner_text("#covers-info"), "copertine dal disco: file singolo (%s)" % pn.inner_text("#covers-info"))
    pn.set_input_files("#f-files", [f2, f3])               # i file di una cartella, selezionati insieme
    pn.wait_for_function("() => window.o2web.app.covers.count === 3", timeout=8000)
    check("saltati" in log_text(pn) and "Bees.jpg" in log_text(pn), "copertine scelte insieme: una valida, una falsa saltata con il nome")
    pn.wait_for_timeout(500)
    # la copertina del gioco in uso compare vicino all'elenco
    pn.evaluate("() => window.o2web.app.start(window.o2web.app.lib.games.find(g => /killer/i.test(g.title)).id)")
    pn.wait_for_function("() => document.getElementById('cover').style.display !== 'none'", timeout=8000)
    pn.wait_for_function("() => { const i = document.getElementById('cover-img'); return i.complete && i.naturalWidth === 40; }", timeout=8000)
    check("Killer" in pn.inner_text("#cover-cap"), "copertina del gioco in uso mostrata (%s)" % pn.inner_text("#cover-cap"))
    pn.screenshot(path=os.path.join(a.outdir, "6_rete_copertine.png"))

    # le copertine non entrano nella sessione
    pn.evaluate("() => document.getElementById('d-state').open = true")
    with pn.expect_download() as dl2:
        pn.click("#b-sess-save")
    sp2 = os.path.join(a.outdir, "sessione_con_copertine.zip")
    dl2.value.save_as(sp2)
    zn = zipfile.ZipFile(sp2)
    blob = b"".join(zn.read(n) for n in zn.namelist())
    check(zn.testzip() is None and not any(n.lower().endswith((".png", ".jpg")) for n in zn.namelist()) and b"\x89PNG" not in blob, "copertine: la sessione salvata non le contiene (%s)" % zn.namelist())
    # svuota: due passi
    pn.click("#b-covers-clear")
    check("Sicuro" in pn.inner_text("#b-covers-clear") and ev(pn, "() => window.o2web.app.covers.count") == 3, "copertine: Svuota chiede conferma")
    pn.click("#b-covers-clear")
    # si attende lo stato della PAGINA (pulsante spento e riepilogo aggiornato), non solo il modello: il ridisegno avviene un attimo dopo
    pn.wait_for_function("() => window.o2web.app.covers.count === 0 && document.getElementById('b-covers-clear').disabled && /Nessuna copertina/.test(document.getElementById('covers-info').textContent)", timeout=8000)
    check(pn.is_disabled("#b-covers-clear") and "Nessuna copertina" in pn.inner_text("#covers-info") and pn.evaluate("() => document.querySelectorAll('#games img.th').length") == 0 and pn.is_hidden("#cover"), "copertine: svuotate (elenco, riepilogo e figura)")
    check(all(h[1].startswith((NET_HOST, ARCH)) for h in hits) and len(hits) == 7, "rete: tutte le richieste sono quelle chieste col pulsante (%d: %s)" % (len(hits), [h[1] for h in hits]))
    pn.close()

    # ---- editor dei caratteri: griglia, pixel, annulla, testo, salvataggio, apertura di un sorgente C, ritorno al GPL, EF9341; modifica a caldo di una partita in corso
    pe = new_page(ctx)
    pe.set_input_files("#f-files", [os.path.join(D, "bios", "o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pe.wait_for_timeout(400)
    pe.click("#games li button.g")
    pe.wait_for_timeout(1500)
    check(ev(pe, "() => window.o2web.app.running"), "editor: partita in corso")
    pe.click("#d-chars > summary")
    check(pe.is_visible("#ce-grid") and pe.is_visible("#ce-pix"), "editor: griglia e disegno visibili")
    check("set GPL" in pe.inner_text("#ce-info") and ev(pe, "() => window.o2web.app.charset") is None, "editor: parte dal set GPL incluso (%s)" % pe.inner_text("#ce-info")[:60])
    check(ev(pe, "() => window.o2web.charui.state.data.vdc.length") == 512, "editor: 512 byte del chip video")
    geom = "() => { const r = document.getElementById('%s').getBoundingClientRect(), c = document.getElementById('%s'); return [r.left, r.top, r.width / c.width, r.height / c.height]; }"

    def click_on(cid, x, y):                                                  # x, y in punti del canvas; lo porta in vista prima (la pagina e' piu' alta della finestra)
        pe.locator("#" + cid).scroll_into_view_if_needed()
        l, t, sx, sy = ev(pe, geom % (cid, cid))
        pe.mouse.click(l + x * sx, t + y * sy)

    def grid_cell(col, row, cw, ch):
        click_on("ce-grid", col * cw + cw / 2, row * ch + ch / 2)
    grid_cell(5, 1, 26, 26)                                                    # cella 13 (riga 1, colonna 5)
    check(ev(pe, "() => window.o2web.charui.state.sel") == 13 and "Cella 13" in pe.inner_text("#ce-sel"), "editor: clic sulla griglia sceglie la cella 13 (%s)" % pe.inner_text("#ce-sel"))
    before = ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(104, 112))")
    frames0 = ev(pe, "() => window.o2web.app.framesRun")
    con0 = ev(pe, "() => { window.__con0 = window.o2web.app.con; return true; }")
    def pixel(x, y):
        click_on("ce-pix", x * 22 + 11, y * 22 + 11)
    pixel(0, 0)
    after = ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(104, 112))")
    check(after[0] == before[0] ^ 0x80 and after[1:] == before[1:], "editor: un clic cambia solo il punto (0,0) della cella 13 (%s -> %s)" % (before[0], after[0]))
    check(ev(pe, "() => window.o2web.app.charset && window.o2web.app.charset[104]") == after[0] and "modificato" in ev(pe, "() => window.o2web.app.charsetName"), "editor: il regista ha il set modificato (nome: %s)" % ev(pe, "() => window.o2web.app.charsetName"))
    pe.wait_for_timeout(300)
    check(ev(pe, "() => window.o2web.app.con === window.__con0 && window.o2web.app.con.vdc.charset[104]") == after[0], "editor: la console in corso ha il glifo nuovo senza essere riavviata")
    check(ev(pe, "() => window.o2web.app.framesRun") >= frames0 and ev(pe, "() => window.o2web.app.running"), "editor: la partita continua a girare")
    check("PRONTO" in ev(pe, "() => document.querySelector('#s-char .badge').textContent") or "PRONTO" in pe.text_content("#n-char"), "editor: dopo il ritocco il set conta come dell'utente (PRONTO)")
    # tratto trascinato: tre punti in una riga, un solo passo di annullamento
    pe.locator("#ce-pix").scroll_into_view_if_needed()
    px, py, psx, psy = ev(pe, geom % ("ce-pix", "ce-pix"))
    pe.mouse.move(px + (1 * 22 + 11) * psx, py + (3 * 22 + 11) * psy)
    pe.mouse.down()
    pe.mouse.move(px + (3 * 22 + 11) * psx, py + (3 * 22 + 11) * psy, steps=6)
    pe.mouse.up()
    row3 = ev(pe, "() => window.o2web.charui.state.data.vdc[104 + 3]")
    check((row3 & 0x70) in (0x70, 0), "editor: tratto trascinato: i punti 1-3 della riga 3 hanno tutti lo stesso valore (%s)" % hex(row3))
    n_undo = ev(pe, "() => window.o2web.charui.state.undo.vdc.length")
    check(n_undo == 2, "editor: due passi di annullamento (un clic + un tratto) (%s)" % n_undo)
    pe.click("#ce-undo")
    check(ev(pe, "() => window.o2web.charui.state.data.vdc[104 + 3]") != row3 or row3 == 0, "editor: annulla toglie il tratto")
    pe.click("#ce-undo")
    check(ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(104, 112))") == before, "editor: annulla due volte riporta la cella com'era")
    check(ev(pe, "() => window.o2web.app.con.vdc.charset[104]") == before[0], "editor: anche la console in corso torna com'era")
    pe.click("#ce-redo")
    check(ev(pe, "() => window.o2web.charui.state.data.vdc[104]") == after[0], "editor: ripeti rifa il clic")
    # strumenti
    pe.click("#ce-clear")
    check(ev(pe, "() => window.o2web.charui.state.data.vdc.slice(104, 112).every(v => v === 0)"), "editor: azzera")
    pe.click("#ce-inv")
    check(ev(pe, "() => window.o2web.charui.state.data.vdc.slice(104, 112).every(v => v === 255)"), "editor: inverti")
    pe.click("#d-chars details:has(#ce-ascii) > summary")
    pe.fill("#ce-ascii", "#.......\n.#......\n..#.....\n...#....\n....#...\n.....#..\n......#.\n.......#")
    pe.click("#ce-ascii-apply")
    check(ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(104, 112))") == [128, 64, 32, 16, 8, 4, 2, 1], "editor: il testo ASCII si applica (diagonale)")
    pe.click("#ce-fh")
    check(ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(104, 112))") == [1, 2, 4, 8, 16, 32, 64, 128], "editor: ribalta orizzontale")
    pe.click("#ce-copy")
    grid_cell(6, 1, 26, 26)                                                    # cella 14
    pe.click("#ce-paste")
    check(ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(112, 120))") == [1, 2, 4, 8, 16, 32, 64, 128], "editor: copia e incolla in un'altra cella")
    pe.fill("#ce-ascii", "###")
    pe.click("#ce-ascii-apply")
    check("non valido" in log_text(pe) and ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(112, 120))") == [1, 2, 4, 8, 16, 32, 64, 128], "editor: testo con troppe poche righe rifiutato con messaggio, la cella resta")
    # tastiera sulla griglia
    pe.focus("#ce-grid")
    pe.keyboard.press("ArrowDown")
    check(ev(pe, "() => window.o2web.charui.state.sel") == 22, "editor: freccia in giu' sulla griglia (cella 22)")
    # salva
    with pe.expect_download() as dl3:
        pe.click("#ce-save")
    dpath = os.path.join(tmp, "ce_saved.bin")
    dl3.value.save_as(dpath)
    saved = open(dpath, "rb").read()
    check(len(saved) == 512 and list(saved[104:112]) == [1, 2, 4, 8, 16, 32, 64, 128] and dl3.value.suggested_filename == "o2web-charset-chip-video.bin", "editor: salva un .bin di 512 byte con le modifiche (%s)" % dl3.value.suggested_filename)
    # apri un sorgente C inventato: tabella da 512 valori
    vals = [(i * 37 + 11) & 0xFF for i in range(512)]
    csrc = os.path.join(tmp, "cset_inventato.c")
    open(csrc, "w").write("/* tabella inventata */\nconst unsigned char cset[512] = {\n" + ", ".join("0x%02X" % v for v in vals) + "\n};\n")
    pe.set_input_files("#f-files", csrc)
    pe.wait_for_timeout(300)
    check(ev(pe, "() => Array.from(window.o2web.app.charset)") == vals and "tabella C" in log_text(pe), "punto unico di caricamento: apre un sorgente C con la tabella (%s)" % log_text(pe)[-90:])
    check(ev(pe, "() => window.o2web.app.con.vdc.charset[5]") == vals[5], "editor: il set aperto e' subito in uso nella partita")
    # un file che non e' un set
    junk = os.path.join(tmp, "niente.txt")
    open(junk, "w").write("niente di utile qui")
    pe.set_input_files("#f-files", junk)
    pe.wait_for_timeout(200)
    check("Nessun gioco o BIOS" in log_text(pe) and ev(pe, "() => window.o2web.app.charset[5]") == vals[5], "editor: file senza set: messaggio, il set in uso resta")
    # un .bin da 512 byte
    binp = os.path.join(tmp, "set512.bin")
    open(binp, "wb").write(bytes(vals[::-1]))
    pe.set_input_files("#f-files", binp)
    pe.wait_for_timeout(200)
    check(ev(pe, "() => window.o2web.app.charset[0]") == vals[::-1][0] and ev(pe, "() => window.o2web.charui.state.data.vdc[0]") == vals[::-1][0], "editor: apre un .bin da 512 byte")
    ev(pe, "() => { window.__con0 = window.o2web.app.con; return true; }")      # un .bin passa dal punto unico e riavvia a freddo: da qui in poi la console di riferimento e' questa
    # pulsante «Scarica da O2EM (GitHub)»: la risposta e' inventata dal browser di prova (nessun dato vero), la rete parte SOLO dopo il clic
    gh_hits = []
    cvals = [(i * 53 + 7) & 0xFF for i in range(512)]
    ctext = "/* inventato */\nuint8_t cset[512]= {\n" + ",".join("0x%02X" % v for v in cvals) + "\n};\n"
    gh_mode = {"m": "ok"}

    def gh_route(route):
        gh_hits.append(route.request.url)
        hd = {"access-control-allow-origin": "*", "content-type": "text/plain; charset=utf-8"}
        if gh_mode["m"] == "404":
            route.fulfill(status=404, headers=hd, body="Not found")
        else:
            route.fulfill(status=200, headers=hd, body=ctext if route.request.url.endswith("/cset.c") else "int t[2][1280] = {{" + ",".join("0x%02X" % (i & 255) for i in range(1280)) + "},{" + ",".join("0x%02X" % (i & 255) for i in range(1280)) + "}};")
    pe.route("https://raw.githubusercontent.com/**", gh_route)
    pe.evaluate("() => { window.__fetched = 0; }")
    check(len(gh_hits) == 0, "scarico da O2EM: nessuna richiesta prima del clic")
    check("chip video" in pe.inner_text("#ce-dl") and "O2EM" in pe.inner_text("#ce-dl"), "scarico da O2EM: etichetta del pulsante per il chip video (%s)" % pe.inner_text("#ce-dl"))
    pe.locator("#ce-dl").scroll_into_view_if_needed()
    pe.click("#ce-dl")
    pe.wait_for_function("() => window.o2web.app.charsetName === 'cset.c (O2EM)'", timeout=8000)
    check(gh_hits == ["https://raw.githubusercontent.com/libretro/libretro-o2em/master/src/cset.c"], "scarico da O2EM: una sola richiesta, all'indirizzo previsto (%s)" % gh_hits)
    check(ev(pe, "() => Array.from(window.o2web.app.charset)") == cvals, "scarico da O2EM: il set letto dalla tabella e' in uso")
    check(ev(pe, "() => window.o2web.app.con === window.__con0 && Array.from(window.o2web.app.con.vdc.charset.slice(0, 8))") == cvals[:8], "scarico da O2EM: la partita in corso lo usa subito (stessa console)")
    check("cset.c" in log_text(pe) and "In uso subito" in log_text(pe) and "impronta non nota" in log_text(pe), "scarico da O2EM: messaggio (impronta di prova non nota)")
    check(ev(pe, "() => Array.from(window.o2web.charui.state.data.vdc.slice(0, 8))") == cvals[:8], "scarico da O2EM: l'editor mostra il set scaricato")
    check(not pe.is_disabled("#ce-dl"), "scarico da O2EM: pulsante di nuovo attivo a fine scarico")
    # scheda EF9341: la tabella 2D inventata non ha l'impronta nota: rifiutata, il set resta
    pe.click("#ce-k-ef")
    check("EF9341" in pe.inner_text("#ce-dl"), "scarico da O2EM: etichetta per l'EF9341 (%s)" % pe.inner_text("#ce-dl"))
    pe.click("#ce-dl")
    pe.wait_for_function("() => /non contiene il set dell/.test(document.getElementById('log').textContent)", timeout=8000)
    check(ev(pe, "() => window.o2web.app.efCharset") is None and gh_hits[-1].endswith("/src/vpp_cset.c"), "scarico da O2EM: ROM EF9341 con impronta sconosciuta: rifiutata, resta quella GPL")
    # errore 404
    gh_mode["m"] = "404"
    pe.click("#ce-k-vdc")
    before_name = ev(pe, "() => window.o2web.app.charsetName")
    pe.click("#ce-dl")
    pe.wait_for_function("() => /404|non trovat|non esiste/i.test(document.getElementById('log').textContent)", timeout=8000)
    check(ev(pe, "() => window.o2web.app.charsetName") == before_name, "scarico da O2EM: errore 404: messaggio, il set in uso resta")
    pe.unroute("https://raw.githubusercontent.com/**")
    exp404 = [e for e in errors if "status of 404" in e]
    check(len(exp404) == 1, "scarico da O2EM: l'unico errore di console e' il 404 provocato apposta (%d)" % len(exp404))
    for e in exp404:
        errors.remove(e)
    # il collegamento diretto nelle istruzioni
    pe.click("#d-chars #ce-howto > summary")
    hrefs = ev(pe, "() => [...document.querySelectorAll('#ce-howto a')].map(a => [a.href, a.target, a.rel])")
    check(["https://github.com/libretro/libretro-o2em/blob/master/src/cset.c", "_blank", "noopener noreferrer"] in hrefs and any(h[0].endswith("/src/vpp_cset.c") for h in hrefs), "istruzioni: collegamenti diretti a cset.c e vpp_cset.c, in una nuova scheda (%s)" % hrefs)
    # ritorno al GPL
    pe.click("#ce-revert")
    pe.wait_for_timeout(200)
    check(ev(pe, "() => window.o2web.app.charset") is None and ev(pe, "() => window.o2web.app.con === window.__con0"), "editor: «Torna al set GPL» a caldo (stessa console)")
    check("GPL" in pe.text_content("#n-char") and pe.is_disabled("#ce-revert"), "editor: dopo il ritorno al GPL il pannello lo dice")
    # EF9341: scheda con 256 voci
    pe.click("#ce-k-ef")
    check(ev(pe, "() => window.o2web.charui.state.kind") == "ef" and ev(pe, "() => window.o2web.charui.state.data.ef.length") == 2560 and pe.get_attribute("#ce-k-ef", "aria-pressed") == "true", "editor: scheda EF9341 (2560 byte)")
    grid_cell(1, 4, 18, 22)                                                    # voce 65 = 'A' (riga 4, colonna 1)
    check(ev(pe, "() => window.o2web.charui.state.sel") == 65 and "0x41" in pe.inner_text("#ce-sel"), "editor: EF9341: voce 65 (%s)" % pe.inner_text("#ce-sel"))
    efb = ev(pe, "() => window.o2web.charui.state.data.ef[650]")
    pe.click("#ce-inv")
    check(ev(pe, "() => window.o2web.charui.state.data.ef[650]") == efb ^ 0xFF and ev(pe, "() => window.o2web.app.efCharset.length") == 2560, "editor: EF9341: inverti la voce e il regista ha la ROM modificata")
    pe.click("#ce-revert")
    check(ev(pe, "() => window.o2web.app.efCharset") is None, "editor: EF9341: ritorno al set GPL")
    howto = pe.inner_text("#ce-howto")
    check("MAME" in howto and "O2EM" in howto and "DA VERIFICARE" in howto and "charset_i8244.bin" in howto, "editor: istruzioni per i set originali nella pagina")
    pe.locator("#d-chars").screenshot(path=os.path.join(a.outdir, "7_editor.png"))
    pe.close()

    # ---- la regola di sicurezza (CSP) impedisce davvero le richieste di rete: pagina a parte, i suoi errori di console sono attesi
    pgc = ctx.new_page()
    pgc.goto("file://" + os.path.abspath(a.html) + "?offline&lang=it")
    blocked = pgc.evaluate("""() => new Promise((res) => {
      document.addEventListener('securitypolicyviolation', (e) => res(e.violatedDirective));
      fetch('http://127.0.0.1:9/x').catch(() => {});
      setTimeout(() => res(null), 2000);
    })""")
    check(blocked == "connect-src", "la regola di sicurezza blocca fetch() verso un indirizzo http (%s)" % blocked)
    viol = pgc.evaluate("""() => new Promise((res) => {
      document.addEventListener('securitypolicyviolation', (e) => res(e.violatedDirective));
      fetch('https://test.invalid/games.zip', {mode: 'cors', credentials: 'omit'}).then(() => res(null), () => {});
      setTimeout(() => res(null), 1500);
    })""")
    check(viol is None, "la regola di sicurezza lascia passare fetch() verso un indirizzo https (%s)" % viol)
    wsv = pgc.evaluate("""() => new Promise((res) => {
      document.addEventListener('securitypolicyviolation', (e) => res(e.violatedDirective));
      try { new WebSocket('ws://127.0.0.1:9/'); } catch (e) { res('eccezione'); }
      setTimeout(() => res(null), 1500);
    })""")
    check(wsv == "connect-src", "la regola di sicurezza blocca i WebSocket non cifrati (%s)" % wsv)
    frm = pgc.evaluate("""() => new Promise((res) => {
      document.addEventListener('securitypolicyviolation', (e) => res(e.violatedDirective));
      const f = document.createElement('iframe'); f.src = 'https://test.invalid/games.zip'; document.body.appendChild(f);
      setTimeout(() => res(null), 1500);
    })""")
    check(frm in ("default-src", "frame-src", "child-src"), "la regola di sicurezza blocca i frame (%s)" % frm)
    imgv = pgc.evaluate("""() => new Promise((res) => {
      document.addEventListener('securitypolicyviolation', (e) => res(e.violatedDirective));
      const i = new Image(); i.src = 'https://test.invalid/cover/x.png';
      setTimeout(() => res(null), 1500);
    })""")
    check(imgv == "img-src", "la regola di sicurezza blocca le immagini da indirizzi esterni (%s)" % imgv)
    pgc.close()

    # ---- set di caratteri da GitHub all'apertura (15/10/2026): la pagina li legge da sola; «?offline» no; senza rete resta il GPL con un avviso. Risposte inventate (nessun dato vero).
    ctx2 = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    gh_calls, gh_mode2 = [], {"m": "ok"}
    def gh2_route(route):
        gh_calls.append((route.request.method, route.request.url, {k.lower(): v for k, v in route.request.headers.items()}))
        if gh_mode2["m"] == "down":
            route.abort("failed")
        else:
            route.fulfill(status=200, headers={"access-control-allow-origin": "*", "content-type": "text/plain; charset=utf-8"},
                          body=cset_src if route.request.url.endswith("/cset.c") else "niente di utile qui")
    ctx2.route("https://raw.githubusercontent.com/**", gh2_route)
    pa = ctx2.new_page()
    pa.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pa.on("pageerror", lambda e: errors.append(str(e)))
    pa.goto("file://" + os.path.abspath(a.html) + "?lang=it")
    pa.wait_for_function("() => window.o2web.app.charset !== null", timeout=8000)
    check(ev(pa, "() => window.o2web.AUTO_CHARSETS") is True, "caricamento automatico: attivo per default")
    check(len(gh_calls) == 2 and gh_calls[0][1].endswith("/libretro-o2em/master/src/cset.c") and gh_calls[1][1].endswith("/libretro-o2em/master/src/vpp_cset.c"), "caricamento automatico: all'apertura, senza clic, una richiesta per set (%s)" % [c[1][-30:] for c in gh_calls])
    check(all(c[0] == "GET" and "cookie" not in c[2] and "authorization" not in c[2] and "referer" not in c[2] for c in gh_calls), "caricamento automatico: GET anonimi, senza cookie, autorizzazione o referrer")
    check(ev(pa, "() => window.o2web.app.charsetName") == "cset.c (O2EM)" and ev(pa, "() => window.o2web.app.charset.length") == 512, "caricamento automatico: set del chip video in uso")
    pa.wait_for_function("() => /originali caricati da GitHub/.test(document.getElementById('log').textContent)", timeout=8000)
    check("PRONTO" in pa.text_content("#n-char") and "cset.c" in pa.text_content("#char-info"), "caricamento automatico: il pannello segna «PRONTO» (%s)" % pa.text_content("#n-char .badge"))
    check("PRONTO" in pa.inner_text("#s-char") or "PRONTO" in pa.inner_text("#splash-needs"), "caricamento automatico: anche la schermata di avvio segna il set pronto")
    check("uso il set GPL incluso" in log_text(pa) and ev(pa, "() => window.o2web.app.efCharset") is None, "caricamento automatico: EF9341 con file non riconosciuto: avviso e ripiego GPL")
    check(ev(pa, "() => window.o2web.app.net.busy") is False and not pa.is_disabled("#b-dl-vdc") and pa.is_hidden("#dl-prog"), "caricamento automatico: a fine scarico i pulsanti tornano a riposo")
    # un set dell'utente aggiunto dopo vale quello (riavvio a freddo come sempre) e non viene piu' sostituito
    pa.set_input_files("#f-files", [os.path.join(D, "bios", "o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pa.wait_for_function("() => window.o2web.app.lib.games.length === 1", timeout=8000)
    mine = os.path.join(tmp, "mio_set.bin")
    open(mine, "wb").write(bytes((i * 3 + 5) & 255 for i in range(512)))
    pa.set_input_files("#f-files", mine)
    pa.wait_for_function("() => window.o2web.app.charsetName === 'mio_set.bin'", timeout=8000)
    check(len(gh_calls) == 2, "caricamento automatico: aggiungere un set non fa altre richieste")
    pa.close()
    # senza rete: un solo tentativo, poi il GPL con un avviso; la pagina funziona
    gh_calls.clear(); gh_mode2["m"] = "down"
    pb = ctx2.new_page()
    pb.on("pageerror", lambda e: errors.append(str(e)))
    pb.goto("file://" + os.path.abspath(a.html) + "?lang=it")
    pb.wait_for_function("() => /uso il set GPL incluso/.test(document.getElementById('log').textContent)", timeout=8000)
    check(len(gh_calls) == 1 and ev(pb, "() => window.o2web.app.charset") is None and "GPL" in pb.text_content("#n-char"), "caricamento automatico: senza rete un solo tentativo, resta il set GPL")
    check("Aggiungi file" in log_text(pb) and ev(pb, "() => window.o2web.app.net.busy") is False, "caricamento automatico: l'avviso indica come procedere e la pagina e' a riposo")
    pb.set_input_files("#f-files", [os.path.join(D, "bios", "o2rom.bin"), os.path.join(D, "killerbees.bin")])
    pb.wait_for_function("() => window.o2web.app.lib.games.length === 1", timeout=8000)
    pb.click("#games li button.g >> nth=0")
    pb.wait_for_timeout(600)
    check(ev(pb, "() => window.o2web.app.running"), "caricamento automatico: senza rete BIOS e giochi si aggiungono e si gioca (set GPL)")
    pb.close()
    # «?offline»: nessuna richiesta
    gh_calls.clear(); gh_mode2["m"] = "ok"
    pc2 = ctx2.new_page()
    pc2.goto("file://" + os.path.abspath(a.html) + "?offline&lang=it")
    pc2.wait_for_timeout(1500)
    check(not gh_calls and ev(pc2, "() => window.o2web.AUTO_CHARSETS") is False and ev(pc2, "() => window.o2web.app.charset") is None, "«?offline»: nessuna richiesta di rete, set GPL")
    pc2.close()
    ctx2.close()

    # ---- niente rete, niente errori
    ext = [u for u in requests if not u.startswith("file://") and not u.startswith("data:") and not u.startswith("blob:")]
    ext = [u for u in ext if not u.startswith(("https://test.invalid/", "https://archive.org/download/", "https://raw.githubusercontent.com/"))]     # quelle chieste a mano nella prova di rete (risposte inventate dal browser di prova)
    check(not ext, "nessuna richiesta di rete oltre a quelle chieste (%s)" % ext[:3])
    check(not errors, "nessun errore in console (%s)" % errors[:3])
    b.close()
print("TUTTO OK" if not fails else "FALLITI %d controlli" % fails)
sys.exit(1 if fails else 0)
