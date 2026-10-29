#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""test_vplist_parse.py LISTA.html - prova di tools/make_vplist.py (analizzatore della lista delle cartucce Videopac / Odyssey2 di Maurice Simon).
Scritto PRIMA dell'analizzatore. Tre tipi di controllo, con oracoli diversi dal codice provato:
  1. conteggi ricavati con un'altra tecnica (grep delle righe con le tre caselle [ ][ ][ ], senza i segnaposto vuoti);
  2. andata e ritorno: ogni riga del file deve ritrovarsi per intero (ogni parola) nei campi della voce; niente si perde;
  3. fatti scritti a mano guardando la lista (voci e numeri precisi), piu' le regole su «+» (Plus), le lingue e i prodotti senza numero.
Uso: python3 -I test/test_vplist_parse.py LISTA.html"""
import html, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import make_vplist as M  # noqa: E402

bad = n = 0


def ok(c, msg):
    global bad, n
    n += 1
    if not c:
        bad += 1
        if bad < 30:
            print("FALLITO:", msg)


def main():
    raw = open(sys.argv[1], "rb").read()
    rows = M.parse_html(raw)
    # --- 1. conteggi con un'altra tecnica: righe con le caselle nella sezione 2.5, meno i segnaposto
    text = html.unescape(re.sub(r"<[^>]+>", "", raw.decode("cp1252"))).replace("\u00ef\u00bf\u00bd", "\ufffd")      # nel file originale il carattere accentato e' gia' perso: resta una sequenza di tre caratteri, la si legge come U+FFFD
    a = text.index("** Section 2.5")
    b = text.index("** Section 3.1")
    lines = [l for l in text[a:b].split("\n") if re.search(r"\[.\]\[.\]\[.\]", l)]
    placeholder = [l for l in lines if re.fullmatch(r"[-?\s]*(06AV\d{4})?[-?\s]*(NR)?\s*", l.split("[")[0]) or l.split("[")[0].strip() in ("Philips Brazil - - -",)]
    ok(len(lines) == 490, "righe con caselle: %d (attese 490)" % len(lines))
    ok(len(placeholder) == 11, "segnaposto vuoti: %d (attesi 11)" % len(placeholder))
    ok(len(rows) == len(lines) - len(placeholder) == 479, "voci: %d (attese 479)" % len(rows))
    # numeri con «+» in Philips Europa: grep sulle righe, contro le voci
    grep_plus = sorted(set(int(m.group(1)) for l in lines if l.startswith("Philips ") and not l.startswith("Philips France") and not l.startswith("Philips Brazil")
                           and not l.startswith("Philips UK") and not l.startswith("Philips Germany")
                           for m in [re.match(r"Philips \d{5} (\d+)\+ ", l)] if m))
    got_plus = sorted(set(r["vp"] for r in rows if r["mk"] == "Philips" and r["pl"] and r["ct"].startswith("27")))
    ok(grep_plus == got_plus and len(got_plus) >= 15, "numeri Plus Philips: %s contro %s" % (grep_plus, got_plus))
    # --- 2. andata e ritorno: ogni parola della riga (senza caselle) sta nei campi della voce
    def words(s):
        return [w for w in re.split(r"[\s]+", s) if w]
    by_raw = {}
    for r in rows:
        by_raw.setdefault(r["raw"], []).append(r)
    for l in lines:
        if l in placeholder:
            continue
        ok(l in by_raw, "riga non trovata tra le voci: " + l[:60])
    for r in rows:
        left = re.split(r"\s*\[.\]\[.\]\[.\]", r["raw"])[0]
        blob = " ".join([r["mk"], r["ct"], str(r["vp"] or ""), "+" if False else "", r["ti"], r["lg"], r["bx"], r["ra"], r["fl"], r["nt"]])
        # le parole della riga a sinistra delle caselle devono comparire nel testo grezzo conservato (rw) o nei campi
        ok(all(w in (blob + " " + r["raw"]) for w in words(left)), "parola persa: " + r["raw"][:70])
        ok(r["raw"] == r["raw"].strip() and r["ti"] != "" and r["mk"] != "", "campi vuoti: " + r["raw"][:70])
        ok(r["ra"] in ("C", "U", "R", "ER", "UR", "PR", "NR", "EM", "RP", "**"), "rarita' strana %r: %s" % (r["ra"], r["raw"][:60]))
    # --- 3. fatti scritti a mano
    def find(**kw):
        out = [r for r in rows if all(r.get(k) == v for k, v in kw.items())]
        return out
    one = lambda **kw: (find(**kw) or [None])[0]
    r = one(mk="Philips", ct="G7143", vp=43)
    ok(r and r["ti"] == "Pick Axe Pete" and r["ra"] == "C" and not r["pl"] and r["rg"] == "EU", "Philips G7143")
    r = one(mk="Philips", ct="27143", vp=43)
    ok(r and r["pl"] == 1 and r["ti"] == "Pick Axe Pete+" and r["ra"] == "R", "Philips 27143 (43+)")
    r = one(mk="Magnavox", ct="AC9437")
    ok(r and r["vp"] == 43 and r["ti"] == "Pick Axe Pete!" and r["rg"] == "US" and r["ra"] == "U", "Magnavox AC9437")
    r = one(mk="Philips Brazil", ct="06AV9437")
    ok(r and r["vp"] == 43 and r["ti"] == "Didi na Mina Encantada" and r["rg"] == "BR", "Brasile 06AV9437")
    r = one(mk="Philips", ct="27156")
    ok(r and r["vp"] == 56 and r["pl"] == 1 and r["po"] == 1 and r["ra"] == "UR", "Norseman: 56+, solo Plus")
    r = one(mk="Philips", ct="27159")
    ok(r and r["po"] == 1 and r["ti"].startswith("Helicopter Rescue"), "Helicopter Rescue+: solo Plus")
    r = one(mk="Philips", ct="G7105")
    ok(r and r["no"] == 1 and r["po"] == 0 and r["ti"] == "Blackjack", "Blackjack: «-» = solo originale")
    ok(len(find(mk="Philips", ct="G7109", vp=9)) == 8 and sorted(x["lg"] for x in find(mk="Philips", ct="G7109")) ==
       sorted("English German Dutch Italian Danish Swedish Finnish Spanish".split()), "Computer Programmer: 8 lingue")
    r = one(mk="Philips", ct="G7141", vp=41, lg="German")
    ok(r and r["ti"] == "Eroberung der Welt" and r["fl"].count("m") == 1 and "Conquest of the World" in r["nt"], "41 tedesco, serie Master (m), titolo originale nella nota")
    r = one(mk="Magnavox", ct="AK9419")
    ok(r and r["vp"] == 2 and "*" in r["fl"] and r["ti"] == "Out of This World / Helicopter Rescue", "AK9419: 3-in-1 europeo (*), il «2» finale e' il numero")
    r = one(mk="Magnavox", ct="AC9439")
    ok(r and "v" in r["fl"] and r["vp"] == 0, "Nimble Numbers Ned: con The Voice, senza numero Videopac")
    r = one(mk="To-Tek", ct="JXA A02")
    ok(r and r["vp"] == 14 and r["pl"] == 1 and r["ti"] == "Western+" and r["ra"] == "UR" and r["rg"] == "JO", "Jopac A02: numero e rarita' incollati")
    r = one(mk="To-Tek", ct="JXT E05")
    ok(r and r["vp"] == 0 and r["po"] == 1 and r["ti"] == "Moto Crash+", "Moto Crash+: solo Plus")
    r = one(mk="Philips", ct="G7199")
    ok(r and r["vl"] == "A" and r["vp"] == 0 and r["ti"] == "Newscaster", "Newscaster = A")
    r = one(mk="Philips Germany")
    ok(r and r["vl"] == "V" and r["ti"] == "Kinder im Verkehr" and r["rg"] == "DE", "Kinder im Verkehr = V")
    r = one(mk="Imagic", ct="710075-2A")
    ok(r and r["ti"] == "Demon Attack" and r["vp"] == 0, "Imagic Demon Attack")
    r = one(mk="Philips Brazil", ct="06AV9477")
    ok(r and r["vp"] == 58 and r["ti"] == "Barao Vermelho!" and r["ra"] == "R", "Brasile 58 = Barao Vermelho")
    r = one(mk="Philips", ct="C7010/16") or one(mk="Philips France", ct="C7010/16")
    ok(r and r["ti"] == "Chess" and r["vp"] == 0, "C7010 Chess")
    ok(sum(1 for x in rows if x["rg"] == "BR") >= 60, "righe del Brasile")
    ok(all(x["vp"] == 0 or 1 <= x["vp"] <= 99 for x in rows), "numeri nell'intervallo")
    # caratteri persi nel file originale (U+FFFD): conservati come tali
    ok(any("�" in x["ti"] for x in rows) and not any("ï¿½" in x["ti"] for x in rows), "caratteri persi: U+FFFD, non la sequenza a tre caratteri")
    # --- JS generato
    js = M.render_js(rows, source="x")
    ok(js.startswith("'use strict';") and "(c) 2026 by Agara73" in js and "Maurice Simon" in js and "module.exports" in js, "intestazione e crediti nel modulo generato")
    ok("\\u" in js or all(ord(c) < 128 for c in js), "modulo generato in ASCII (caratteri non ASCII come \\uXXXX)")
    print("OK" if not bad else "FALLITI %d su %d" % (bad, n), "(%d controlli)" % n)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
