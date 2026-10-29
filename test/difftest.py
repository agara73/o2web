#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""difftest.py - test differenziali del nucleo 8048 JavaScript (src/cpu8048.js) contro ref/ref8048.py.

Per ogni caso (programma, stato iniziale completo, eventi dei pin, numero di istruzioni) il riferimento Python e il nucleo JS
vengono eseguiti stato per stato: dopo OGNI istruzione si confronta un hash dello stato completo (registri, RAM interna, RAM
esterna, timer, prescaler, flag, porte, latch dell'espansore, tempo, pin, indice degli eventi). Alla prima differenza si rifa'
girare il caso con gli stati completi e si stampa quali campi divergono.

Famiglie di casi:
  op     ogni opcode (0-255) con stati polarizzati (0x00, 0xFF, 0x0F, 0x80, ...), pc anche ai bordi di pagina e di banco
  reset  programmi casuali dal reset (valori iniziali dello stato)
  prog   programmi casuali: flussi di istruzioni valide (con salti verso pagine note) e byte puri casuali
  irq    prologo EN I / EN TCNTI / STRT T, timer vicino all'overflow, vettori 3 e 7 con RETR, impulsi su /INT
  cnt    modo contatore su T1 con fronti di discesa
Uso:  python3 -I test/difftest.py [--seed N] [--op K] [--prog N] [--irq N] [--cnt N] [--quick]
"""
import argparse
import json
import os
import random
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import ref8048 as R  # noqa: E402

NAMES = ['op', 'cyc', 'pc', 'a', 'psw', 'f1', 'a11', 'timer', 'prescaler', 'tf', 'tirq_en', 'xirq_en', 'in_progress',
         'timer_pend', 'timer_en', 'counter_en', 'p1', 'p2', 'bus', 'exp0', 'exp1', 'exp2', 'exp3', 'now', 't1_prev', 'ram_ck',
         'xram_ck', 'int_active', 't0', 't1', 'p1_pin', 'p2_pin', 'bus_pin', 'ev_i']

LEGAL = [o for o in range(256) if o not in R.ILLEGAL]
POL = [0x00, 0x01, 0x02, 0x08, 0x09, 0x0A, 0x0F, 0x10, 0x3F, 0x40, 0x7F, 0x80, 0x81, 0x99, 0xF0, 0xF9, 0xFA, 0xFE, 0xFF]
SAFE1 = [o for o in LEGAL if o not in R.LEN2 and o not in (0x83, 0x93, 0xB3) and (o & 0x1F) not in (4, 0x14)]


def checksum(b):
    h = 0
    for x in b:
        h = (h * 31 + x + 1) & 0xFFFFFFFF
    return h


def hash_vec(v):
    h = 2166136261
    for x in v:
        h = ((h ^ (x & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    return h


def full_state(cpu, op, cyc):
    e = cpu.env
    return [op, cyc, cpu.pc, cpu.a, cpu.psw, int(cpu.f1), 1 if cpu.a11 else 0, cpu.timer, cpu.prescaler, int(cpu.tf),
            int(cpu.tirq_en), int(cpu.xirq_en), int(cpu.in_progress), int(cpu.timer_pend), int(cpu.timer_en),
            int(cpu.counter_en), cpu.p1, cpu.p2, cpu.bus, cpu.exp[0], cpu.exp[1], cpu.exp[2], cpu.exp[3], cpu.now, int(cpu.t1_prev),
            checksum(cpu.ram), checksum(e.xram), int(e.int_active), int(e.t0), int(e.t1), e.p1_pin, e.p2_pin, e.bus_pin, e.ev_i]


class CountingCPU(R.CPU):
    """Stessa CPU del riferimento, con contatori di copertura (nessun cambiamento di comportamento)."""
    stats = {}

    def _c(self, k):
        CountingCPU.stats[k] = CountingCPU.stats.get(k, 0) + 1

    def check_irqs(self):
        before = self.timer_pend
        r = super().check_irqs()
        if r:
            self._c('irq_ext' if self.pc == 3 else 'irq_timer')
        return r

    def overflow(self):
        self._c('overflow_irq_armed' if self.tirq_en else 'overflow_no_irq')
        super().overflow()

    def apply_events(self):
        n = self.env.ev_i
        t1p, ce = self.t1_prev, self.counter_en
        super().apply_events()
        if self.env.ev_i != n:
            self._c('events')
            if ce and t1p == 1 and self.env.t1 == 0:
                self._c('counter_edge')

    def i_retr(self):
        self._c('retr_in_irq' if self.in_progress else 'retr_plain')
        super().i_retr()

    def jcc(self, cond):
        self._c('jcc_taken' if cond else 'jcc_not_taken')
        super().jcc(cond)

    def push(self):
        if (self.psw & 7) == 7:
            self._c('stack_wrap')
        super().push()


def make_py(c):
    env = R.Env()
    for addr, hx in c['prog']:
        b = bytes.fromhex(hx)
        env.prog[addr:addr + len(b)] = b
    env.xram = bytearray(bytes.fromhex(c['env']['xram']))
    e = c['env']
    env.int_active, env.t0, env.t1 = e['int_active'], e['t0'], e['t1']
    env.p1_pin, env.p2_pin, env.bus_pin = e['p1_pin'], e['p2_pin'], e['bus_pin']
    env.events = [tuple(x) for x in c['events']]
    cpu = CountingCPU(env)
    s = c['cpu']
    if c.get('reset'):                                  # caso "dopo il reset": nessuna sovrascrittura dello stato
        return cpu
    cpu.a, cpu.pc, cpu.psw, cpu.f1, cpu.a11 = s['a'], s['pc'], s['psw'], s['f1'], s['a11']
    cpu.ram[:] = bytes.fromhex(s['ram'])
    cpu.timer, cpu.prescaler = s['timer'], s['prescaler']
    cpu.timer_en, cpu.counter_en, cpu.tf = s['timer_en'], s['counter_en'], s['tf']
    cpu.tirq_en, cpu.xirq_en, cpu.in_progress, cpu.timer_pend = s['tirq_en'], s['xirq_en'], s['in_progress'], s['timer_pend']
    cpu.p1, cpu.p2, cpu.bus = s['p1'], s['p2'], s['bus']
    cpu.exp = list(s['exp'])
    cpu.now, cpu.t1_prev = s['now'], s['t1_prev']
    return cpu


def run_py(c, vectors=False):
    cpu = make_py(c)
    out = []
    ops = {}
    for _ in range(c['steps']):
        op, cyc = cpu.step()
        ops[op] = ops.get(op, 0) + 1
        v = full_state(cpu, op, cyc)
        out.append(v if vectors else hash_vec(v))
    return out, ops


# ---------------------------------------------------------------------------------------------- generatori di casi
def pv(rng):
    return rng.choice(POL) if rng.random() < 0.7 else rng.getrandbits(8)


def rand_cpu_state(rng, pc, steps):
    ram = bytes(pv(rng) if rng.random() < 0.5 else rng.getrandbits(8) for _ in range(64))
    mode = rng.random()
    timer_en = 1 if mode < 0.5 else 0
    counter_en = 1 if 0.5 <= mode < 0.65 else 0
    return {
        'a': pv(rng), 'pc': pc, 'psw': rng.choice([0, rng.getrandbits(8) & 0xF7, 0x80, 0xE0, 0x10, 0x07, 0x77]),
        'f1': rng.getrandbits(1), 'a11': rng.choice([0, 0x800]), 'ram': ram.hex(),
        'timer': rng.choice([pv(rng), 0xFF, 0xFE, 0xF0 + rng.getrandbits(4)]), 'prescaler': rng.choice([0, 31, 30, rng.getrandbits(5)]),
        'timer_en': timer_en, 'counter_en': counter_en, 'tf': rng.getrandbits(1),
        'tirq_en': 1 if rng.random() < 0.4 else 0, 'xirq_en': 1 if rng.random() < 0.4 else 0,
        'in_progress': 1 if rng.random() < 0.2 else 0, 'timer_pend': 1 if rng.random() < 0.15 else 0,
        'p1': pv(rng), 'p2': pv(rng), 'bus': pv(rng), 'exp': [rng.getrandbits(4) for _ in range(4)],
        'now': rng.randint(0, 3000), 't1_prev': rng.getrandbits(1)}


def rand_env(rng):
    return {'int_active': rng.getrandbits(1), 't0': rng.getrandbits(1), 't1': rng.getrandbits(1), 'p1_pin': pv(rng),
            'p2_pin': pv(rng), 'bus_pin': pv(rng), 'xram': bytes(rng.getrandbits(8) for _ in range(256)).hex()}


def rand_events(rng, now, steps, n=None, toggle_t1=False):
    n = rng.randint(0, 5) if n is None else n
    times = sorted(now + rng.randint(0, steps * 2 + 5) for _ in range(n))
    ev = []
    for t in times:
        ev.append([t, rng.getrandbits(1), rng.getrandbits(1), rng.getrandbits(1) if not toggle_t1 else len(ev) & 1,
                   pv(rng), pv(rng), pv(rng)])
    return ev


def operand(rng, op):
    if op in R.LEN2:
        return pv(rng)
    return None


def stream_page(rng, jump_pages, raw=False):
    buf = bytearray(256)
    i = 0
    while i < 256:
        if raw:
            buf[i] = rng.getrandbits(8)
            i += 1
            continue
        op = rng.getrandbits(8) if rng.random() < 0.03 else rng.choice(LEGAL)
        if (op & 0x1F) in (4, 0x14) and rng.random() < 0.9:
            op = (op & 0x1F) | ((rng.choice(jump_pages) & 7) << 5)
        buf[i] = op
        i += 1
        if op in R.LEN2 and i < 256:
            buf[i] = pv(rng)
            i += 1
    return buf


def gen_prog_case(rng, kind):
    steps = rng.randint(20, 100)
    pa, pb = rng.randrange(16), rng.randrange(16)
    pc = (pa << 8) | rng.choice([rng.randrange(256), 0, 0xFE, 0xFF, rng.randrange(0x40)])
    pages = {pa, pb, 3, pa ^ 8, pb ^ 8}
    jump_pages = [pa & 7, pb & 7, pa & 7, pb & 7, 3]
    raw = kind == 'prog' and rng.random() < 0.25
    segs = {pg: stream_page(rng, jump_pages, raw) for pg in pages}
    cpu = rand_cpu_state(rng, pc, steps)
    env = rand_env(rng)
    ev = rand_events(rng, cpu['now'], steps)
    if kind == 'irq':
        pre = bytearray([0x05, 0x25, rng.choice([0x55, 0x55, 0x45]), rng.choice(SAFE1)])
        pg = pa
        base = pc & 0xFF
        for k, b in enumerate(pre):
            segs[pg][(base + k) & 0xFF] = b
        h3 = bytearray(rng.choice(SAFE1) for _ in range(rng.randint(0, 3))) + bytes([0x93])
        h7 = bytearray(rng.choice(SAFE1) for _ in range(rng.randint(0, 4))) + bytes([0x93])
        for pg0 in (0, 8):
            segs.setdefault(pg0, stream_page(rng, jump_pages))
            segs[pg0][3:3 + len(h3)] = h3
            segs[pg0][7:7 + len(h7)] = h7
        cpu['xirq_en'], cpu['tirq_en'] = 0, 0
        cpu['in_progress'] = 0
        cpu['timer'] = rng.choice([0xFF, 0xFE, 0xFD, 0xF8])
        cpu['timer_en'], cpu['counter_en'] = 1, 0
        env['int_active'] = 0
        ev = []
        t = cpu['now'] + rng.randint(2, 30)
        for _ in range(rng.randint(1, 4)):
            ev.append([t, 1, rng.getrandbits(1), rng.getrandbits(1), pv(rng), pv(rng), pv(rng)])
            t += rng.randint(1, 12)
            ev.append([t, 0, rng.getrandbits(1), rng.getrandbits(1), pv(rng), pv(rng), pv(rng)])
            t += rng.randint(1, 40)
    if kind == 'cnt':
        pre = bytearray([0x45, rng.choice(SAFE1), 0x25])
        for k, b in enumerate(pre):
            segs[pa][((pc & 0xFF) + k) & 0xFF] = b
        cpu['timer'] = rng.choice([0xFF, 0xFE, 0xFD, rng.getrandbits(8)])
        cpu['timer_en'], cpu['counter_en'] = 0, 0
        cpu['tirq_en'] = rng.getrandbits(1)
        cpu['xirq_en'] = 0
        cpu['in_progress'] = 0
        ev = rand_events(rng, cpu['now'], steps, n=rng.randint(6, 20), toggle_t1=True)
    return {'prog': [[pg << 8, bytes(b).hex()] for pg, b in sorted(segs.items())], 'cpu': cpu, 'env': env, 'events': ev,
            'steps': steps, 'kind': kind}


def gen_reset_case(rng):
    """Programma casuale eseguito subito dopo il reset (prova i valori iniziali di ogni campo di stato)."""
    c = gen_prog_case(rng, 'prog')
    c['prog'] = [[0, bytes(stream_page(rng, [0, 1, 2, 3])).hex()], [0x300, bytes(stream_page(rng, [0, 3])).hex()]]
    c['steps'] = rng.randint(5, 40)
    c['events'] = rand_events(rng, 0, c['steps'])
    c['reset'] = True
    c['kind'] = 'reset'
    return c


EDGE_PC = [0x000, 0x001, 0x0FE, 0x0FF, 0x100, 0x1FE, 0x1FF, 0x3FE, 0x3FF, 0x7FD, 0x7FE, 0x7FF, 0x800, 0x8FE, 0x8FF, 0xBFF,
           0xFFE, 0xFFF, 0x2A5, 0x5C3, 0xA01, 0xC7E]


def gen_op_case(rng, op):
    pc = rng.choice(EDGE_PC) if rng.random() < 0.5 else rng.randrange(4096)
    steps = rng.choice([1, 1, 2, 3])
    pages = {pc >> 8, ((pc >> 8) + 1) & 15, ((pc + 2) >> 8) & 15, 3}
    segs = {pg: stream_page(rng, [pc >> 8 & 7, 3]) for pg in pages}
    cpu = rand_cpu_state(rng, pc, steps)
    cpu['in_progress'] = 1 if rng.random() < 0.3 else 0
    # R0/R1 polarizzati: indirizzi interni al limite
    ram = bytearray.fromhex(cpu['ram'])
    for i in (0, 1, 24, 25):
        ram[i] = rng.choice([0, 1, 0x3F, 0x40, 0x7F, 0xBF, 0xFF, 0x08, 0x17, 0x18, rng.getrandbits(8)])
    cpu['ram'] = bytes(ram).hex()
    p = pc & 0xFF
    segs[pc >> 8][p] = op
    nxt = ((pc + 1) & 0x7FF) | (pc & 0x800)
    segs.setdefault(nxt >> 8, stream_page(rng, [3]))
    segs[nxt >> 8][nxt & 0xFF] = pv(rng)
    env = rand_env(rng)
    ev = rand_events(rng, cpu['now'], steps, n=rng.randint(0, 2))
    if rng.random() < 0.3:
        env['int_active'] = 1
        cpu['xirq_en'] = 1
    return {'prog': [[pg << 8, bytes(b).hex()] for pg, b in sorted(segs.items())], 'cpu': cpu, 'env': env, 'events': ev,
            'steps': steps, 'kind': 'op'}


# ---------------------------------------------------------------------------------------------------- esecuzione
def run_js(cases, vectors=False):
    with tempfile.TemporaryDirectory() as d:
        fi, fo = os.path.join(d, 'in.json'), os.path.join(d, 'out.json')
        with open(fi, 'w') as f:
            json.dump(cases, f)
        args = ['node', os.path.join(HERE, 'run_cases.js'), fi, fo] + (['--vectors'] if vectors else [])
        subprocess.run(args, check=True)
        with open(fo) as f:
            return json.load(f)


def diagnose(c):
    py, _ = run_py(c, True)
    js = run_js([c], True)[0]
    lines = []
    for i, (a, b) in enumerate(zip(py, js)):
        if a != b:
            lines.append("  primo passo diverso: %d (opcode ref %02X, JS %02X); stato prima: %s" %
                         (i, a[0], b[0], "inizio" if i == 0 else dict(zip(NAMES, py[i - 1]))))
            for n, x, y in zip(NAMES, a, b):
                if x != y:
                    lines.append("    %-12s ref=%s js=%s" % (n, x, y))
            break
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--op', type=int, default=120, help="casi per opcode")
    ap.add_argument('--prog', type=int, default=12000)
    ap.add_argument('--irq', type=int, default=6000)
    ap.add_argument('--cnt', type=int, default=3000)
    ap.add_argument('--quick', action='store_true', help="dimezza tutto (per la prova di mutazione)")
    ap.add_argument('--stop-first', action='store_true', help="si ferma alla prima differenza (per la prova di mutazione)")
    ap.add_argument('--batch', type=int, default=1500)
    ap.add_argument('--save-cache', help="salva casi e digest del riferimento (per run_cached.js e la prova di mutazione)")
    a = ap.parse_args()
    if a.quick:
        a.op, a.prog, a.irq, a.cnt = max(a.op // 4, 8), a.prog // 4, a.irq // 4, a.cnt // 4
    rng = random.Random(a.seed)
    cases = []
    for op in range(256):
        for _ in range(a.op):
            cases.append(gen_op_case(rng, op))
    for kind, n in (('prog', a.prog), ('irq', a.irq), ('cnt', a.cnt)):
        for _ in range(n):
            cases.append(gen_prog_case(rng, kind))
    for _ in range(max(a.prog // 100, 20)):
        cases.append(gen_reset_case(rng))
    t0 = time.time()
    total_steps = 0
    ops_seen = {}
    bad = 0
    shown = 0
    expected = []
    for b0 in range(0, len(cases), a.batch):
        chunk = cases[b0:b0 + a.batch]
        js = run_js(chunk)
        for i, c in enumerate(chunk):
            py, ops = run_py(c)
            expected.append(py)
            total_steps += len(py)
            for o, n in ops.items():
                ops_seen[o] = ops_seen.get(o, 0) + n
            if py != js[i]:
                bad += 1
                if shown < 3:
                    shown += 1
                    print("DIFFERENZA nel caso %d (famiglia %s):" % (b0 + i, c['kind']))
                    print(diagnose(c))
                if a.stop_first:
                    print("FALLITO: %d caso/i diversi" % bad)
                    return 1
    if a.save_cache and not bad:
        with open(a.save_cache, 'w') as f:
            json.dump({'cases': cases, 'expected': expected}, f)
        assert os.path.getsize(a.save_cache) > 0
    print("casi: %d, istruzioni confrontate: %d, tempo %.1f s" % (len(cases), total_steps, time.time() - t0))
    missing = [o for o in range(256) if o not in ops_seen]
    print("opcode eseguiti: %d/256 (mancanti: %s); minimo esecuzioni per opcode: %d" %
          (256 - len(missing), ' '.join('%02X' % o for o in missing) or 'nessuno', min(ops_seen.get(o, 0) for o in range(256))))
    print("copertura eventi:", ', '.join("%s=%d" % kv for kv in sorted(CountingCPU.stats.items())))
    print("casi diversi: %d" % bad)
    print("OK: nessuna differenza" if not bad else "FALLITO")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
