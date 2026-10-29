#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""mutate.py - prova di mutazione dei test del nucleo 8048 JavaScript.

Guasta src/cpu8048.js un po' alla volta (operatori, costanti, negazioni, istruzioni cancellate) e controlla che i test lo notino.
Per ogni mutante: 1) controllo di sintassi (i mutanti non validi si scartano); 2) test differenziale veloce contro i digest del
riferimento (run_cached.js); 3) test_api.js; 4) se sopravvive, la riproduzione del BIOS e delle cartucce (replay_run.js). Un mutante che
sopravvive a tutto va esaminato a mano: o e' equivalente (il guasto non cambia il comportamento osservabile) o i test sono deboli.

Uso: python3 -I test/mutate.py CACHE.json REPLAYDIR DUMPS [--n 300] [--seed 1] [--jobs 2] [--report FILE]
"""
import argparse
import os
import random
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src', 'cpu8048.js')
TOKEN = re.compile(r'===|!==|>>|<<|&&|\|\||\b0x[0-9A-Fa-f]+\b|\b\d+\b|[+\-&|^<>]|!(?!=)')
STMT = re.compile(r'this\.[A-Za-z0-9_]+(?:\[[^\]]*\])?\s*(?:=|\|=|&=|\^=|\+=)\s*[^;{}]+;')


def candidates(lines):
    out = []
    start = next(i for i, l in enumerate(lines) if l.startswith('const ILLEGAL'))
    for ln in range(start, len(lines)):
        line = lines[ln]
        code = line.split('//')[0]
        for m in TOKEN.finditer(code):
            t = m.group(0)
            reps = []
            if t == '===': reps = ['!==']
            elif t == '!==': reps = ['===']
            elif t == '>>': reps = ['<<']
            elif t == '<<': reps = ['>>']
            elif t == '&&': reps = ['||']
            elif t == '||': reps = ['&&']
            elif t == '+': reps = ['-']
            elif t == '-': reps = ['+']
            elif t == '&': reps = ['|']
            elif t == '|': reps = ['&']
            elif t == '^': reps = ['|']
            elif t == '<': reps = ['<=', '>']
            elif t == '>': reps = ['>=']
            elif t == '!': reps = ['']
            elif t.startswith('0x'):
                reps = ['0x%0*X' % (len(t) - 2, int(t, 16) + 1)]
            elif t.isdigit():
                reps = [str(int(t) + 1)]
            for r in reps:
                out.append((ln, m.start(), m.end(), r, "%s -> %s" % (t, r or '(tolto)')))
        for m in STMT.finditer(code):
            out.append((ln, m.start(), m.end(), '', 'istruzione cancellata: ' + m.group(0).strip()))
    return out


def apply(lines, c):
    ln, a, b, rep, _ = c
    new = list(lines)
    new[ln] = lines[ln][:a] + rep + lines[ln][b:]
    return '\n'.join(new)


def run_one(args):
    idx, c, text, tmp, cache, rdir, dumps = args
    path = os.path.join(tmp, 'm%d.js' % idx)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    if subprocess.run(['node', '--check', path], capture_output=True).returncode != 0:
        return idx, 'invalid'
    env = dict(os.environ, O2_CPU_PATH=path)
    r = subprocess.run(['node', os.path.join(HERE, 'run_cached.js'), cache], env=env, capture_output=True, timeout=300)
    if r.returncode != 0:
        return idx, 'killed-diff'
    r = subprocess.run(['node', os.path.join(HERE, 'test_api.js')], env=env, capture_output=True, timeout=300)
    if r.returncode != 0:
        return idx, 'killed-api'
    try:
        r = subprocess.run(['node', os.path.join(HERE, 'replay_run.js'), rdir, dumps], env=env, capture_output=True, timeout=600)
    except subprocess.TimeoutExpired:
        return idx, 'killed-replay'
    if r.returncode != 0:
        return idx, 'killed-replay'
    return idx, 'SURVIVED'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cache')
    ap.add_argument('replaydir')
    ap.add_argument('dumps')
    ap.add_argument('--n', type=int, default=300, help="mutanti campionati (0 = tutti)")
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--jobs', type=int, default=2)
    ap.add_argument('--report')
    a = ap.parse_args()
    text = open(SRC, encoding='utf-8', newline='').read()
    lines = text.split('\n')
    cands = candidates(lines)
    rng = random.Random(a.seed)
    stmts = [c for c in cands if c[4].startswith('istruzione')]
    others = [c for c in cands if not c[4].startswith('istruzione')]
    n_other = len(others) if a.n == 0 else max(a.n - len(stmts), 0)
    pick = stmts + (others if a.n == 0 else rng.sample(others, min(n_other, len(others))))
    print("candidati: %d (istruzioni cancellabili %d, altri %d); campionati %d" % (len(cands), len(stmts), len(others), len(pick)))
    with tempfile.TemporaryDirectory() as tmp:
        jobs = [(i, c, apply(lines, c), tmp, a.cache, a.replaydir, a.dumps) for i, c in enumerate(pick)]
        with ThreadPoolExecutor(a.jobs) as ex:
            res = list(ex.map(run_one, jobs))
    tally = {}
    surv = []
    for i, st in res:
        tally[st] = tally.get(st, 0) + 1
        if st == 'SURVIVED':
            c = pick[i]
            surv.append("riga %d: %s   | %s" % (c[0] + 1, c[4], lines[c[0]].strip()[:110]))
    valid = len(res) - tally.get('invalid', 0)
    killed = tally.get('killed-diff', 0) + tally.get('killed-api', 0) + tally.get('killed-replay', 0)
    msg = ["mutanti validi: %d, uccisi: %d (differenziale %d, api %d, replay %d), sopravvissuti: %d, non validi (scartati): %d" %
           (valid, killed, tally.get('killed-diff', 0), tally.get('killed-api', 0), tally.get('killed-replay', 0), tally.get('SURVIVED', 0), tally.get('invalid', 0)),
           "punteggio di mutazione: %.1f%%" % (100.0 * killed / max(valid, 1))]
    msg += surv
    print("\n".join(msg))
    if a.report:
        with open(a.report, 'w') as f:
            f.write("\n".join(msg) + "\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
