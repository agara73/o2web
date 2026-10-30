#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
"""pacer_vectors.py OUT.json - vettori per test/test_pacer.js (passo dell'emulazione, tappa 8), calcolati dal riferimento indipendente
hw/pacer_ref.py. Ogni scenario e' una sessione di gioco simulata: chiamate del browser (frequenza, irregolarita', schede in secondo piano,
ore che tornano indietro), orologio dell'audio che avanza a blocchi (da 2,7 ms come un computer a 256 ms come un telefono con ritardo
alto) con una piccola deriva, pause, tratti senza audio. La coda dell'audio si simula come in src/webaudio.js: ogni fotogramma aggiunge
la sua durata; se la coda e' quasi vuota (meno di meta' dell'anticipo) si riparte da ora + anticipo e si conta un «a vuoto».
Per ogni chiamata si registrano gli ingressi (ora, durata del fotogramma, ora e coda dell'audio o niente) e le uscite del riferimento
(fotogrammi, anticipo, velocita'); per ogni scenario anche fotogrammi al secondo e vuoti al secondo dopo i primi 3 secondi.
Uso: python3 -I test/pacer_vectors.py OUT.json [--seed N]"""
import argparse, json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import pacer_ref as R  # noqa: E402

PAL = 7929.3 / 394089.5        # durata di un fotogramma PAL (cicli per fotogramma / cicli al secondo, valori della console)
NTSC = 5966.4 / 357954.5


def scenario(rng, name, secs, raf_hz, jitter_ms, block_ms, drift, period, audio=True, events=()):
    """events: elenco di (secondo, tipo, valore) con tipo 'gap' (pausa del browser di valore ms), 'pause' (reset del passo, coda
    svuotata), 'noaudio' (da qui niente audio), 'audio' (di nuovo audio), 'back' (l'ora torna indietro di valore ms)"""
    st = R.fresh_state()
    calls = []
    wall = 0.0
    nxt = None                     # fine dell'audio programmato (ora dell'audio), None = coda vuota appena svuotata
    under = 0
    pushed = False
    has_audio = audio
    ev = sorted(events)
    frames_after, under_after = 0, 0
    max_q = 0.0
    t_ms = 1000.0
    while wall < secs:
        step_ms = 1000.0 / raf_hz + rng.uniform(-jitter_ms, jitter_ms)
        t_ms += step_ms
        wall += step_ms / 1000
        reset = False
        while ev and ev[0][0] <= wall:
            _, kind, val = ev.pop(0)
            if kind == "gap":
                t_ms += val
                wall += val / 1000
            elif kind == "back":
                t_ms -= val
            elif kind == "pause":
                st = R.fresh_state(st["jump"])
                nxt = None
                pushed = False
                reset = True
            elif kind == "noaudio":
                has_audio = False
            elif kind == "audio":
                has_audio = True
        blk = block_ms / 1000
        a_now = math.floor(wall * drift / blk) * blk
        if has_audio:
            queued = 0.0 if nxt is None else max(0.0, nxt - a_now)
            aud = [a_now, queued]
        else:
            aud = None
        n = R.call(st, t_ms, period, None if aud is None else (aud[0], aud[1]))
        lead = R.lead_of(st["jump"])
        if has_audio:
            for _ in range(n):
                if nxt is None or nxt < a_now + lead * 0.5:
                    if pushed:
                        under += 1
                        if wall > 3:
                            under_after += 1
                    nxt = a_now + lead
                pushed = True
                nxt += period
            max_q = max(max_q, (nxt - a_now) if nxt is not None else 0.0) if wall > 3 else max_q
        if wall > 3:
            frames_after += n
        calls.append({"ts": t_ms, "period": period, "audio": aud, "reset": reset, "n": n, "lead": lead, "rate": st["speed"]})
    span = secs - 3
    return {"name": name, "calls": calls, "fps": frames_after / span, "under_s": under_after / span, "max_q": max_q,
            "period": period, "block_ms": block_ms, "audio": audio, "events": [list(e) for e in events]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=9)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    sc = []
    sc.append(scenario(rng, "computer", 20, 60, 0.5, 2.7, 1.0, PAL))
    sc.append(scenario(rng, "computer-ntsc", 20, 60, 0.5, 2.7, 1.0, NTSC))
    sc.append(scenario(rng, "computer-144hz", 15, 144, 0.3, 10.7, 1.0, PAL))
    sc.append(scenario(rng, "telefono-21ms", 20, 60, 2.0, 21.3, 1.0, PAL))
    sc.append(scenario(rng, "telefono-85ms", 25, 66, 3.0, 85.3, 1.0, PAL))
    sc.append(scenario(rng, "telefono-128ms", 25, 66, 3.0, 128.0, 1.0004, PAL))
    sc.append(scenario(rng, "telefono-171ms", 25, 66, 3.0, 170.7, 0.9996, PAL))
    sc.append(scenario(rng, "telefono-256ms-30hz", 25, 30, 4.0, 256.0, 1.0, PAL))
    sc.append(scenario(rng, "telefono-ntsc-85ms", 25, 60, 3.0, 85.3, 1.001, NTSC))
    sc.append(scenario(rng, "deriva-forte", 30, 60, 1.0, 10.7, 1.003, PAL))
    sc.append(scenario(rng, "senza-audio", 15, 60, 1.0, 10.7, 1.0, PAL, audio=False))
    sc.append(scenario(rng, "eventi", 30, 60, 2.0, 85.3, 1.0, PAL,
                       events=[(5, "gap", 2500), (8, "pause", 0), (11, "noaudio", 0), (14, "audio", 0), (17, "back", 400), (20, "gap", 90), (24, "pause", 0)]))
    for k in range(6):
        sc.append(scenario(rng, "caso%d" % k, 12, rng.choice([30, 50, 60, 75, 90, 120]), rng.uniform(0, 5), rng.choice([2.7, 10.7, 21.3, 42.7, 85.3, 170.7]),
                           rng.uniform(0.997, 1.003), rng.choice([PAL, NTSC]),
                           events=[(rng.uniform(2, 11), rng.choice(["gap", "pause", "back"]), rng.uniform(10, 3000))]))
    consts = {"MAX_DT": R.DT_MAX, "MAX_FRAMES": R.PER_CALL, "MAX_OWED": R.OWED_MAX, "LEAD_MIN": R.LEAD_LO, "LEAD_MAX": R.LEAD_HI,
              "JUMP_EXTRA": R.EXTRA, "JUMP_CLAMP": R.JUMP_HI, "JUMP_DECAY": R.DECAY, "QAVG_K": R.AVG_W, "CORR_MAX": R.SPEED_MAX}
    with open(a.out, "w") as f:
        json.dump({"consts": consts, "scenarios": sc}, f)
    assert os.path.getsize(a.out) > 0
    for s in sc:
        print("%-22s %6.1f fotogrammi/s (atteso %.1f)  vuoti %.2f/s  coda max %3.0f ms" % (s["name"], s["fps"], 1 / s["period"], s["under_s"], s["max_q"] * 1000))


if __name__ == "__main__":
    main()
