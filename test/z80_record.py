#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""z80_record.py - registra, con un riferimento INDIPENDENTE, il comportamento del Z80 per la prova differenziale del nucleo
`src/z80.js` (vedi test/z80_run.js).

Riferimento: il pacchetto Python `z80` (kosarev, versione 1.2.0, licenza MIT) usato SOLO in sviluppo (non e' distribuito con O2web):
    pip install --target CARTELLA z80==1.2.0      e poi      PYTHONPATH=CARTELLA python3 -I -s test/z80_record.py USCITA
(con -I Python ignora PYTHONPATH: in questo script la cartella si passa con --lib CARTELLA oppure con la variabile Z80_LIB).

Che cosa registra. Ogni CASO e' uno stato di partenza (registri, flag, I, R, IFF, modo, WZ, memoria "pigra" calcolata da una funzione
di hash del seme) con qualche byte di programma; si eseguono N passi. Dopo OGNI passo si salva lo stato completo (AF BC DE HL e
ombra, IX IY SP PC, I/R, WZ, IFF1, IFF2, HALT, modo, blocco degli interrupt, prefisso attivo, stati T del passo) e la sequenza degli
eventi visibili all'esterno: scritture in memoria, IN e OUT con indirizzo di porta a 16 bit. Un passo e' un'istruzione, oppure un
prefisso DD / FD da solo (come nel riferimento). Alcuni casi chiedono un interrupt (mascherabile) fra due passi.

Famiglie di casi: (1) ogni opcode di ogni famiglia (nessun prefisso, CB, ED, DD, FD, DD CB, FD CB) con stati polarizzati (registri e
flag a 0, 1, 0x7F, 0x80, 0xFF, a caso; memoria a zero, a 0xFF o a caso; PC vicino ai bordi dello spazio); (2) programmi casuali;
(3) interrupt in modo 0 (RST), 1 e 2 con EI e HALT.
Il file di uscita: USCITA/cases.json e USCITA/ref.bin (u16 little-endian).
"""
import argparse
import json
import os
import random
import struct
import sys

# ---- funzioni pigre comuni con il lato JavaScript (stessi interi a 32 bit)
M32 = 0xFFFFFFFF


def mix32(h):
    h &= M32
    h ^= h >> 15
    h = (h * 0x85EBCA77) & M32
    h ^= h >> 13
    h = (h * 0xC2B2AE3D) & M32
    h ^= h >> 16
    return h


def base_byte(seed, mode, fill, addr):
    if mode == 0:
        return mix32((addr * 0x9E3779B1) ^ seed) & 255
    if mode == 1:
        return 0
    if mode == 2:
        return 0xFF
    return fill & 255


def in_byte(seed, port, n):
    return mix32(((port * 0x9E3779B1) ^ (n * 0x7F4A7C15)) ^ (seed ^ 0x5A5A5A5A)) & 255


STATE_WORDS = 20   # vedi pack_state


def load_lib(path):
    if path:
        sys.path.insert(0, path)
    import z80  # noqa
    return z80


def pack_state(m, dticks, nev):
    v = bytes(m.get_state_view())
    # layout (macchina Z80 del riferimento): vedi _machine.py
    w = lambda o: v[o] | (v[o + 1] << 8)
    return [
        m.af, m.bc, m.de, m.hl, m.alt_af, m.alt_bc, m.alt_de, m.alt_hl, m.ix, m.iy, m.sp, m.pc,
        (m.i << 8) | m.r, w(12),
        (1 if m.iff1 else 0) | (2 if m.iff2 else 0) | (4 if m.halted else 0) | (v[42] << 3),
        (1 if m.int_disabled else 0) | (v[43] << 1),
        dticks, nev,
    ]


class Case:
    pass


def rnd8(rng):
    return rng.choice([0, 1, 0x7F, 0x80, 0xFF, 0x0F, 0x10, 0xF0, 0x55, 0xAA]) if rng.random() < 0.6 else rng.randrange(256)


def rnd16(rng):
    c = rng.random()
    if c < 0.45:
        return rng.choice([0, 1, 0x7FFF, 0x8000, 0xFFFF, 0x00FF, 0x0100, 0xFF00, 0x0FFF, 0x1000])
    return rng.randrange(65536)


def make_state(rng):
    return {
        'af': (rnd8(rng) << 8) | rng.randrange(256), 'bc': rnd16(rng), 'de': rnd16(rng), 'hl': rnd16(rng),
        'af2': (rnd8(rng) << 8) | rng.randrange(256), 'bc2': rnd16(rng), 'de2': rnd16(rng), 'hl2': rnd16(rng),
        'ix': rnd16(rng), 'iy': rnd16(rng), 'sp': rnd16(rng), 'i': rnd8(rng), 'r': rnd8(rng),
        'iff1': rng.randrange(2), 'iff2': rng.randrange(2), 'im': 0, 'wz': rnd16(rng),
    }


def make_case(rng, code, steps, ints=None, state=None, pc=None):
    c = make_state(rng) if state is None else state
    if pc is None:
        pc = rng.choice([rng.randrange(65536), rng.randrange(65536), 0xFFFF - rng.randrange(6), rng.randrange(8), 0x4000])
    c['pc'] = pc
    c['code'] = bytes(code).hex()
    c['steps'] = steps
    c['seed'] = rng.randrange(1 << 32)
    c['mode'] = rng.choice([0, 0, 0, 1, 2, 3])
    c['fill'] = rng.randrange(256)
    c['ints'] = ints or []
    return c


def build_cases(args):
    rng = random.Random(args.seed)
    cases = []
    # famiglie: prefisso (byte), numero di byte di operando a seguire dopo l'opcode
    fams = [
        ([], 'plain'), ([0xCB], 'cb'), ([0xED], 'ed'), ([0xDD], 'dd'), ([0xFD], 'fd'), ([0xDD, 0xCB], 'ddcb'), ([0xFD, 0xCB], 'fdcb'),
    ]
    per = args.per_op
    for prefix, name in fams:
        for op in range(256):
            for k in range(per):
                if name in ('ddcb', 'fdcb'):
                    code = prefix + [rng.randrange(256), op] + [rng.randrange(256) for _ in range(3)]
                    steps = 3                         # prefisso + istruzione + una dopo
                else:
                    code = prefix + [op] + [rng.randrange(256) for _ in range(4)]
                    steps = 3 if prefix in ([0xDD], [0xFD]) else 2
                cases.append(make_case(rng, code, steps))
    # programmi casuali
    for _ in range(args.random):
        n = rng.randrange(8, 40)
        code = [rng.randrange(256) for _ in range(n)]
        if rng.random() < 0.5:                     # un po' piu' di prefissi e istruzioni vicine a "interessanti"
            for _ in range(n // 3):
                code[rng.randrange(n)] = rng.choice([0xDD, 0xFD, 0xCB, 0xED, 0x00, 0x76, 0xFB, 0xF3, 0xB0, 0xB8, 0xA2, 0xA3])
        cases.append(make_case(rng, code, rng.randrange(20, 80)))
    # interrupt: IM n; EI; poi istruzioni; in certi passi si chiede un interrupt
    for _ in range(args.ints):
        im = rng.randrange(3)
        code = [0xED, [0x46, 0x56, 0x5E][im], 0xFB] + [rng.choice([0x00, 0x76, 0x3C, 0x04, 0xFB, 0xF3, 0xDD, 0xFD, 0xCB, 0xED, 0x23])
                                                       if rng.random() < 0.7 else rng.randrange(256) for _ in range(rng.randrange(6, 30))]
        steps = rng.randrange(8, 40)
        ints = []
        for _ in range(rng.randrange(1, 5)):
            data = 0xFF if im == 0 else rng.randrange(256)   # modo 0: il riferimento esegue sempre RST 38 (bus libero = 0xFF); gli altri RST: test_z80_misc.js
            ints.append({'at': rng.randrange(1, steps + 4), 'data': data})
        ints.sort(key=lambda d: d['at'])
        st = make_state(rng)
        st['iff1'] = 0; st['iff2'] = 0
        c = make_case(rng, code, steps, ints, st)
        cases.append(c)
    return cases


def run_case(z80, c, out):
    seed, mode, fill = c['seed'], c['mode'], c['fill']
    over = {}
    events = []
    incount = [0]
    vector = [0]
    m = z80.Z80Machine()
    m.mark_addrs(0, 0x10000, m.READ_MARK | m.WRITE_MARK)

    def rd(a):
        a &= 0xFFFF
        return over[a] if a in over else base_byte(seed, mode, fill, a)

    def wr(a, v):
        a &= 0xFFFF
        over[a] = v & 255
        events.append((1, a, v & 255))

    def inp(port):
        v = in_byte(seed, port & 0xFFFF, incount[0])
        incount[0] += 1
        events.append((3, port & 0xFFFF, v))
        return v

    def outp(port, v):
        events.append((2, port & 0xFFFF, v & 255))

    m.set_read_callback(rd)
    m.set_write_callback(wr)
    m.set_input_callback(inp)
    m.set_output_callback(outp)
    m.set_get_int_vector_callback(lambda: vector[0])
    # stato di partenza
    m.af = c['af']; m.bc = c['bc']; m.de = c['de']; m.hl = c['hl']
    m.alt_af = c['af2']; m.alt_bc = c['bc2']; m.alt_de = c['de2']; m.alt_hl = c['hl2']
    m.ix = c['ix']; m.iy = c['iy']; m.sp = c['sp']; m.i = c['i']; m.r = c['r']
    m.iff1 = c['iff1']; m.iff2 = c['iff2']
    v = m.get_state_view()
    v[12] = c['wz'] & 255; v[13] = c['wz'] >> 8
    code = bytes.fromhex(c['code'])
    pc = c['pc']
    for i, b in enumerate(code):
        over[(pc + i) & 0xFFFF] = b
    m.pc = pc
    m.ticks_to_stop = 0
    # registra lo stato iniziale come "passo 0" (senza eventi) per controllare che l'impostazione coincida
    out.append(struct.pack('<%dH' % 18, *pack_state(m, 0, 0)))
    ints = {}
    for d in c['ints']:
        ints.setdefault(d['at'], d['data'])
    nstep = 0
    total = c['steps'] + len(c['ints'])
    k = 0
    done = set()
    while nstep < total:
        events.clear()
        t0 = m.frame_tick
        if k in ints and k not in done:
            done.add(k)
            vector[0] = ints[k]
            m.on_handle_active_int()
        else:
            m.ticks_to_stop = 1
            m.run()
            k += 1
        nstep += 1
        st = pack_state(m, m.frame_tick - t0, len(events))
        out.append(struct.pack('<%dH' % 18, *st))
        for (t, a, b) in events:
            out.append(struct.pack('<3H', t, a, b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--lib', default=os.environ.get('Z80_LIB'))
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--per-op', type=int, default=24)
    ap.add_argument('--random', type=int, default=4000)
    ap.add_argument('--ints', type=int, default=1500)
    ap.add_argument('--quick', action='store_true')
    args = ap.parse_args()
    if args.quick:
        args.per_op, args.random, args.ints = 4, 300, 200
    z80 = load_lib(args.lib)
    cases = build_cases(args)
    os.makedirs(args.out, exist_ok=True)
    chunks = []
    pos = 0
    for c in cases:
        c['off'] = pos
        n0 = len(chunks)
        run_case(z80, c, chunks)
        pos += sum(len(x) for x in chunks[n0:])
    with open(os.path.join(args.out, 'ref.bin'), 'wb') as f:
        data = b''.join(chunks)
        f.write(data)
    with open(os.path.join(args.out, 'cases.json'), 'w') as f:
        json.dump(cases, f)
    for p in ('ref.bin', 'cases.json'):
        assert os.path.getsize(os.path.join(args.out, p)) > 0
    print('casi', len(cases), 'passi registrati', sum(c['steps'] + len(c['ints']) for c in cases))


if __name__ == '__main__':
    main()
