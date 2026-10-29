#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - ricompilatore 8048 -> Z80: confronta le tabelle di i48.js con ref8048.py (tutti i 256 opcode)
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "ref")); sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import ref8048 as R, dis48
js = json.loads(subprocess.check_output(["node", os.path.join(HERE, "i48.js")]))
bad = 0
for op in range(256):
    ln, cy, ill, kind = js[op]
    t = dis48.decode(bytes([op, 0x12, 0]), 0, 0)
    pk = {"": "", "jmp": "jmp", "call": "call", "cjmp": "cjmp", "ret": "ret", "jmpp": "jmpp", "ill": ""}.get(t[2], t[2])
    if op == 0x93: pk = "ret"            # dis48 classifica RETR come 'ret'
    want = (2 if op in R.LEN2 else 1, R.op_cycles(op), 1 if op in R.ILLEGAL else 0)
    ok = (ln, cy, ill) == want and ln == t[1] and cy == (t[4] if t[2] != "ill" else 1) and (kind == pk or (op == 0x93 and kind == "retr"))
    if not ok:
        bad += 1; print("DIVERSO %02X: js=%s ref=%s dis48=%s" % (op, js[op], want, (t[1], t[4], t[2])))
print("opcode controllati: 256, diversi: %d -> %s" % (bad, "OK" if not bad else "FALLITO"))
sys.exit(1 if bad else 0)
