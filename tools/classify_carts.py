#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""classify_carts.py - classifica le cartucce dell'utente (solo analisi statica; i dump non si copiano da nessuna parte).

Per ogni file riporta: dimensione, MD5, banchi da 2 KB (in ogni banco i vettori 0x400..0x40A), uso di SEL MB0/MB1, scritture
di P1 con le maschere immediate (ANL/ORL P1,#n e OUTL P1,A), STRT CNT, MOV Rn,#n con n in 0xA7..0xAA (probabile suono), accessi
MOVX con indirizzi insoliti (>= 0xF0, o RAM extra), salti verso 0xC00..0xFFF, JMPP / MOVP3.
Ipotesi di mappa (DA VERIFICARE con l'esecuzione): finestra 0x400..0xBFF da 2 KB; il banco e' scelto da P1 bit 0-1;
il file e' una sequenza di banchi da 2 KB in ordine (4 KB = 2 banchi, 8 KB = 4 banchi); formati da 12/16 KB: da studiare.
Uso: python3 -I tools/classify_carts.py CARTELLA [--csv out.csv]
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dis48  # noqa: E402


def trace_bank(mem, base, limit_lo, limit_hi, entries):
    """Tracciamento del codice di un banco; ritorna (offset->(txt,len,kind,target)), bersagli fuori dalla finestra."""
    seen, todo, outside = {}, list(entries), set()
    while todo:
        a = todo.pop()
        while limit_lo <= a < limit_hi and a not in seen:
            txt, ln, k, t, cy = dis48.decode(mem, a - base, base)
            seen[a] = (txt, ln, k, t)
            if k in ("jmp", "cjmp", "call") and t is not None:
                if limit_lo <= t < limit_hi:
                    todo.append(t)
                else:
                    outside.add(t)
            if k in ("jmp", "ret", "jmpp"):
                break
            a += ln
    return seen, outside


def analyse(path):
    data = open(path, "rb").read()
    n = len(data)
    info = {"file": os.path.basename(path), "size": n, "md5": hashlib.md5(data).hexdigest()}
    if n < 2048:
        info["kind"] = "bios?"
        return info
    banks = n // 2048
    info["banks"] = banks
    ent = {"p1_imm": set(), "mb": set(), "strt_cnt": 0, "snd": 0, "movp3": 0, "jmpp": 0, "hi_jump": set(), "out_jump": 0,
           "movx_hi": 0, "ill": 0, "seen": 0, "vec": []}
    for b in range(banks):
        mem = data[b * 2048:(b + 1) * 2048]
        # offset 0..0x7FF del file = indirizzi 0x400..0xBFF
        entries = [0x400, 0x402, 0x404, 0x406, 0x408, 0x40A]
        seen, outside = trace_bank(mem, 0x400, 0x400, 0xC00, entries)
        ent["vec"].append(mem[0:12].hex())
        ent["seen"] += len(seen)
        for a, (txt, ln, k, t) in seen.items():
            if txt.startswith("ANL P1") or txt.startswith("ORL P1"):
                ent["p1_imm"].add(txt.split()[0] + txt.split(",")[1])
            if txt == "OUTL P1,A":
                ent["p1_imm"].add("OUTL")
            if txt in ("SEL MB0", "SEL MB1"):
                ent["mb"].add(txt[-3:])
            if txt == "STRT CNT":
                ent["strt_cnt"] += 1
            if txt.startswith("MOV R") and ",#" in txt:
                v = int(txt.split("#")[1], 16)
                if 0xA7 <= v <= 0xAA:
                    ent["snd"] += 1
            if txt == "MOVP3 A,@A":
                ent["movp3"] += 1
            if k == "jmpp":
                ent["jmpp"] += 1
            if k == "ill":
                ent["ill"] += 1
        for t in outside:
            if t >= 0xC00:
                ent["hi_jump"].add(t)
            elif t < 0x400:
                ent["out_jump"] += 1
    info.update(ent)
    return info


def main(argv):
    if not argv:
        sys.exit(__doc__)
    paths = []
    for root, _, files in os.walk(argv[0]):
        for f in sorted(files):
            if f.lower().endswith(".bin"):
                paths.append(os.path.join(root, f))
    paths.sort()
    for p in paths:
        i = analyse(p)
        if i.get("kind") == "bios?":
            continue
        print("%-58s %5d  banchi=%d  P1imm=%s  MB=%s  CNT=%d snd=%d movp3=%d jmpp=%d hi=%s ill=%d" % (
            i["file"][:58], i["size"], i["banks"], sorted(i["p1_imm"]), sorted(i["mb"]), i["strt_cnt"], i["snd"], i["movp3"],
            i["jmpp"], sorted(hex(x) for x in i["hi_jump"])[:6], i["ill"]))


if __name__ == "__main__":
    main(sys.argv[1:])
