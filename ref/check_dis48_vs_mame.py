#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - controllo di sviluppo: tabella opcode di dis48.py contro quella di MAME (mcs48.cpp, solo lettura)
import re, sys
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import dis48
src = open(sys.argv[1]).read()
m = re.search(r"s_mcs48_opcodes\[256\]\s*=\s*\{(.*?)\n\};", src, re.S)
ops = re.findall(r"OP\((\w+)\)", m.group(1))
assert len(ops) == 256, len(ops)
ill_mame = {i for i, n in enumerate(ops) if n == "illegal"}
ill_dis = {o for o in range(256) if dis48.decode(bytes([o, 0, 0]), 0)[2] == "ill"}
print("illegali MAME: %d  dis48: %d  uguali: %s" % (len(ill_mame), len(ill_dis), ill_mame == ill_dis))
print("solo MAME:", sorted(hex(x) for x in ill_mame - ill_dis), " solo dis48:", sorted(hex(x) for x in ill_dis - ill_mame))
# lunghezze e cicli: MAME dichiara i cicli nel corpo (burn_cycles); qui si legge dalle OPHANDLER
cyc = {}
for name, body in re.findall(r"OPHANDLER\(\s*(\w+)\s*\)\s*(\{.*?\})\s*\n", src, re.S):
    mm = re.search(r"burn_cycles\((\d)\)", body)
    if mm: cyc[name] = int(mm.group(1))
bad = 0
for o in range(256):
    n = ops[o]
    if n == "illegal": continue
    c = cyc.get(n)
    d = dis48.decode(bytes([o, 0, 0]), 0)
    if c is None: print("senza cicli letti: %02X %s" % (o, n)); continue
    if c != d[4]: print("CICLI diversi %02X %s: MAME %d dis48 %d" % (o, n, c, d[4])); bad += 1
print("opcode con cicli diversi:", bad)
