#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""mutate2.py - prova di mutazione dei moduli delle tappe 2 e 3 (vdc.js, console.js, cartmap.js, sha256.js, unzip.js; audio.js, input.js,
zipstore.js, library.js, session.js, webaudio.js, app.js; sha1.js, gamenames.js, gamelist.js, vplist.js, preview.js, previews.js della tappa 7; touch.js e pacer.js della tappa 8; look.js, machines.js, screen.js della tappa 4b; netfetch.js e covers.js della tappa 4c; ef934x.js della tappa 5; z80.js e chessmod.js della tappa 6a) e, con --cache/--replay, anche di cpu8048.js (comprese saveState/loadState).

Per ogni mutante si copia src/ in una cartella temporanea con il file guastato e si lanciano i test, dal piu' veloce: test_misc.js,
test_state.js, vdc_stress.js, line_run.js (e per la CPU anche run_cached.js, test_api.js, replay_run.js). Basta un test rosso per
"uccidere" il mutante; uno che sopravvive a tutto va esaminato a mano (equivalente o test debole).
Uso: python3 -I test/mutate2.py FILE (vdc|console|cartmap|sha256|unzip|cpu8048|audio|input|zipstore|library|session|webaudio|app|look|machines|screen|photos|netfetch|covers|ef934x|charedit|i18n|sha1|gamenames|gamelist|vplist|preview|previews|touch|pacer|z80|chessmod) --dumps DUMPS
         --stress STRESS.json --rec RECDIR [--audio-ref AUDIO_REFDIR] [--look-ref LOOK_REFDIR] [--ef-ref EF.json] [--z80-ref Z80_REFDIR] [--cache CACHE.json --replay REPLAYDIR] [--n 0] [--seed 1] [--jobs 4] [--report FILE] [--retry RAPPORTO_PRECEDENTE]"""
import argparse
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src')
TOKEN = re.compile(r'===|!==|<=|>=|>>>|>>|<<|&&|\|\||\b0x[0-9A-Fa-f]+\b|\b\d+\b|[+\-&|^<>]|!(?!=)')
STMT = re.compile(r'(?:this\.[A-Za-z0-9_]+|\b[a-z][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*(?:=|\|=|&=|\^=|\+=|-=)\s*[^;{}=][^;{}]*;')
STR = re.compile(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"")


def code_of(line):
    c = STR.sub(lambda m: ' ' * len(m.group(0)), line)
    i = c.find('//')
    return c[:i] if i >= 0 else c


def candidates(lines, start):
    out = []
    for ln in range(start, len(lines)):
        code = code_of(lines[ln])
        if 'require(' in code or 'module.exports' in code:
            continue
        for m in TOKEN.finditer(code):
            t = m.group(0)
            reps = []
            if t == '===': reps = ['!==']
            elif t == '!==': reps = ['===']
            elif t == '>>>': reps = ['>>']
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
            elif t == '>': reps = ['>=', '<']
            elif t == '<=': reps = ['<']
            elif t == '>=': reps = ['>']
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


def suites(target, o):
    node = lambda *a: ['node'] + list(a)
    T = lambda n: os.path.join(HERE, n)
    if target == 'unzip':
        return [node(T('test_unzip.js')), node(T('test_zipstore.js')), node(T('test_library.js'))]
    if target == 'zipstore':
        return [node(T('test_zipstore.js')), node(T('test_session.js'))]
    if target == 'webaudio':
        return [node(T('test_webaudio.js'))]
    if target == 'input':
        return [node(T('test_input.js'), o.dumps), node(T('test_usability.js'), o.dumps)]
    if target == 'touch':
        return [node(T('test_touch.js'), o.touch_vec)]
    if target == 'pacer':
        return [node(T('test_pacer.js'), o.pacer_vec), node(T('test_app.js'), o.dumps)]
    if target == 'audio':
        return [node(T('test_audio.js'), o.audio_ref, o.dumps)]
    if target == 'library':
        return [node(T('test_library.js'), o.dumps), node(T('test_gamelist.js'))]
    if target == 'sha1':
        return [node(T('test_sha1.js')), node(T('test_gamenames.js'), o.dumps)]
    if target == 'gamenames':
        return [node(T('test_gamenames.js'), o.dumps), node(T('test_gamelist.js'), o.dumps), node(T('test_app_list.js'), o.dumps)]
    if target == 'gamelist':
        return [node(T('test_gamelist.js'), o.dumps), node(T('test_app_list.js'), o.dumps)]
    if target == 'vplist':
        return [node(T('test_vplist.js'), o.vp_vec), node(T('test_gamelist.js'), o.dumps), node(T('test_app_list.js'), o.dumps)]
    if target == 'preview':
        return [node(T('test_preview.js'), os.path.join(o.prev_ref, 'vec.json')), node(T('preview_run.js'), o.prev_ref, o.dumps), node(T('test_previews.js'))]
    if target == 'previews':
        return [node(T('test_previews.js')), node(T('test_app_list.js'), o.dumps)]
    if target == 'session':
        return [node(T('test_session.js'), o.dumps), node(T('test_library.js'), o.dumps), node(T('test_usability.js'), o.dumps)]
    if target == 'app':
        return [node(T('test_usability.js'), o.dumps), node(T('test_automachine.js'), o.dumps), node(T('test_app_net.js')), node(T('test_app.js'), o.dumps), node(T('test_app_list.js'), o.dumps), node(T('test_g7400.js'), o.dumps), node(T('test_charlive.js'), o.dumps)]
    if target == 'netfetch':
        return [node(T('test_net.js')), node(T('test_app_net.js'))]
    if target == 'covers':
        return [node(T('test_covers.js')), node(T('test_app_net.js'))]
    if target == 'photos':
        return [node(T('test_photos.js'))]
    if target == 'charedit':
        return [node(T('test_charedit.js'))]
    if target == 'i18n':
        return [node(T('test_i18n.js'))]
    if target == 'z80':
        return [node(T('test_z80_misc.js')), node(T('z80_run.js'), o.z80_ref), node(T('test_chess.js'))]
    if target == 'chessmod':
        return [node(T('test_chess.js')), node(T('test_chess_app.js'))]
    if target == 'ef934x':
        return [node(T('ef_run.js'), o.ef_ref), node(T('test_g7400.js'), o.dumps)]
    if target in ('look', 'machines', 'screen'):
        # test_look.js: formule, casi costruiti, confronto bit per bit con hw/look_ref.py (cartella look_cases.json), macchine e disegni
        s = [node(T('test_look.js'), o.look_ref, o.dumps), node(T('test_usability.js'), o.dumps)]
        if target == 'screen':
            s.append(node(T('test_misc.js')))
        return s
    s = [node(T('test_misc.js')),
         node(T('test_charlive.js'), o.dumps),
         node(T('test_g7400.js'), o.dumps),
         node(T('test_state.js'), o.dumps),
         node(T('test_audio.js'), o.audio_ref, o.dumps),
         node(T('vdc_stress.js'), o.stress),
         node(T('line_run.js'), o.rec, o.dumps)]
    if target == 'cpu8048' and o.cache:
        s = [node(T('run_cached.js'), o.cache), node(T('test_api.js'))] + s
        if o.replay:
            s.append(node(T('replay_run.js'), o.replay, o.dumps))
    return s


def run_one(args):
    idx, c, text, target, o = args
    with tempfile.TemporaryDirectory() as tmp:
        sd = os.path.join(tmp, 'src')
        shutil.copytree(SRC, sd)
        path = os.path.join(sd, target + '.js')
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        if subprocess.run(['node', '--check', path], capture_output=True).returncode != 0:
            return idx, 'invalid'
        env = dict(os.environ, O2_SRC_DIR=sd, O2_CPU_PATH=os.path.join(sd, 'cpu8048.js'), O2_CONSOLE_PATH=os.path.join(sd, 'console.js'),
                   O2_VDC_PATH=os.path.join(sd, 'vdc.js'), O2_AUDIO_PATH=os.path.join(sd, 'audio.js'), O2_EF_PATH=os.path.join(sd, 'ef934x.js'), O2_Z80_PATH=os.path.join(sd, 'z80.js'), O2_CHESS_PATH=os.path.join(sd, 'chessmod.js'), O2_DUMPS=o.dumps, O2_LOOK_BENCH='0')
        for cmd in suites(target, o):
            try:
                r = subprocess.run(cmd, env=env, capture_output=True, timeout=120)
            except subprocess.TimeoutExpired:
                return idx, 'killed:' + os.path.basename(cmd[1]) + '(timeout)'
            if r.returncode != 0:
                return idx, 'killed:' + os.path.basename(cmd[1])
        return idx, 'SURVIVED'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('target', choices=['vdc', 'console', 'cartmap', 'sha256', 'unzip', 'cpu8048', 'audio', 'input', 'zipstore', 'library', 'session', 'webaudio', 'app', 'look', 'machines', 'screen', 'photos', 'netfetch', 'covers', 'ef934x', 'charedit', 'i18n', 'z80', 'chessmod', 'sha1', 'gamenames', 'gamelist', 'vplist', 'preview', 'previews', 'touch', 'pacer'])
    ap.add_argument('--dumps', required=True)
    ap.add_argument('--stress', required=True)
    ap.add_argument('--rec', required=True)
    ap.add_argument('--audio-ref', dest='audio_ref', help='cartella preparata da test/audio_ref.py')
    ap.add_argument('--look-ref', dest='look_ref', help='cartella preparata da test/look_record.py')
    ap.add_argument('--ef-ref', dest='ef_ref', help='file preparato da test/ef_record.py')
    ap.add_argument('--z80-ref', dest='z80_ref', help='cartella preparata da test/z80_record.py')
    ap.add_argument('--prev-ref', dest='prev_ref', help='cartella con vec.json (preview_vectors.py) e le anteprime registrate da preview_record.py')
    ap.add_argument('--vp-vec', dest='vp_vec', help='file preparato da test/vplist_vectors.py')
    ap.add_argument('--touch-vec', dest='touch_vec', help='file preparato da test/touch_vectors.py')
    ap.add_argument('--pacer-vec', dest='pacer_vec', help='file preparato da test/pacer_vectors.py')
    ap.add_argument('--cache')
    ap.add_argument('--replay')
    ap.add_argument('--n', type=int, default=0, help='mutanti campionati (0 = tutti)')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--report')
    ap.add_argument('--lines', help='solo i guasti nelle righe date, es. 120-190,440-480 (numerazione da 1)')
    ap.add_argument('--retry', help="rifa solo i mutanti elencati come sopravvissuti in un rapporto precedente")
    a = ap.parse_args()
    src = os.path.join(SRC, a.target + '.js')
    text = open(src, encoding='utf-8', newline='').read()
    lines = text.split('\n')
    start = next((i for i, l in enumerate(lines) if l.startswith('const ILLEGAL')), 0) if a.target == 'cpu8048' else 0
    cands = candidates(lines, start)
    if a.lines:
        rngs = [tuple(int(x) for x in part.split('-')) for part in a.lines.split(',')]
        cands = [c for c in cands if any(lo <= c[0] + 1 <= hi for lo, hi in rngs)]
    rng = random.Random(a.seed)
    pick = cands if a.n == 0 or a.n >= len(cands) else rng.sample(cands, a.n)
    if a.retry:
        want = {}
        for l in open(a.retry, encoding='utf-8'):
            m = re.match(r'riga (\d+): (.*?)   \|', l)
            if m:
                want[(int(m.group(1)), m.group(2))] = want.get((int(m.group(1)), m.group(2)), 0) + 1
        pick = [c for c in cands if (c[0] + 1, c[4]) in want]
    print("%s: candidati %d, campionati %d" % (a.target, len(cands), len(pick)), flush=True)
    jobs = [(i, c, apply(lines, c), a.target, a) for i, c in enumerate(pick)]
    with ThreadPoolExecutor(a.jobs) as ex:
        res = list(ex.map(run_one, jobs))
    tally = {}
    surv = []
    for i, st in res:
        k = st.split(':')[0]
        tally[k] = tally.get(k, 0) + 1
        if st == 'SURVIVED':
            c = pick[i]
            surv.append("riga %d: %s   | %s" % (c[0] + 1, c[4], lines[c[0]].strip()[:110]))
    valid = len(res) - tally.get('invalid', 0)
    killed = tally.get('killed', 0)
    by = {}
    for i, st in res:
        if st.startswith('killed:'):
            by[st[7:]] = by.get(st[7:], 0) + 1
    msg = ["%s: mutanti validi %d, uccisi %d (%s), sopravvissuti %d, non validi %d" % (
        a.target, valid, killed, ', '.join('%s %d' % kv for kv in sorted(by.items())), tally.get('SURVIVED', 0), tally.get('invalid', 0)),
        "punteggio di mutazione: %.1f%%" % (100.0 * killed / max(valid, 1))]
    msg += surv
    print("\n".join(msg))
    if a.report:
        with open(a.report, 'w') as f:
            f.write("\n".join(msg) + "\n")


if __name__ == '__main__':
    sys.exit(main())
