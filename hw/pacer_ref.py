# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - O2web, emulatore Odyssey 2 / Videopac per browser
"""pacer_ref.py - riferimento indipendente del passo dell'emulazione (src/pacer.js, tappa 8), scritto a parte dalle regole:

- il tempo di gioco segue l'orologio della pagina: fra due chiamate passa dt = (ts - ts precedente) / 1000 secondi, ma mai meno di 0 ne'
  piu' di 0,1 s; alla prima chiamata (o dopo un azzeramento) dt = 0;
- si emulano tanti fotogrammi quanti ne stanno nel tempo accumulato, al massimo 3 per chiamata; il tempo avanzato resta per la volta
  dopo, ma mai piu' di 0,1 s;
- con l'audio attivo il tempo accumulato si moltiplica per una velocita' 1 + 0,005 * e, dove e = (anticipo - coda media) / anticipo
  tenuto fra -1 e 1; la coda media e' una media mobile (peso 0,02) della coda dell'audio, che parte dal primo valore visto;
- l'anticipo e' salto + 0,03 s, tenuto fra 0,06 e 0,5 s; il salto e' il piu' grande fra il salto di prima moltiplicato per 0,999
  e l'avanzamento dell'orologio dell'audio dall'ultima chiamata (al massimo 0,5 s; se l'orologio non avanza, 0);
- senza audio la velocita' e' 1 e coda media e ora dell'audio si dimenticano; l'azzeramento dimentica tutto tranne il salto misurato.
La simulazione e' scritta come una macchina a stati con un dizionario, senza classi, per non ricalcare il JavaScript."""

DT_MAX, PER_CALL, OWED_MAX = 0.1, 3, 0.1
LEAD_LO, LEAD_HI = 0.06, 0.5
EXTRA, JUMP_HI, DECAY = 0.03, 0.5, 0.999
AVG_W, SPEED_MAX = 0.02, 0.005


def fresh_state(jump=0.0):
    return {"prev": None, "owed": 0.0, "audio_prev": None, "avg": None, "jump": jump, "speed": 1.0, "dt": 0.0}


def lead_of(jump):
    v = jump + EXTRA
    if v < LEAD_LO:
        return LEAD_LO
    if v > LEAD_HI:
        return LEAD_HI
    return v


def call(st, ts, period, audio):
    """una chiamata: ritorna i fotogrammi; audio = None oppure (ora_audio, coda)"""
    if period <= 0:
        return 0
    if st["prev"] is None:
        dt = 0.0
    else:
        dt = (ts - st["prev"]) / 1000
        dt = 0.0 if dt < 0 else (DT_MAX if dt > DT_MAX else dt)
    st["dt"] = dt
    st["prev"] = ts
    if audio is not None:
        now, queue = audio
        adv = 0.0
        if st["audio_prev"] is not None and now > st["audio_prev"]:
            adv = now - st["audio_prev"]
            if adv > JUMP_HI:
                adv = JUMP_HI
        decayed = st["jump"] * DECAY
        st["jump"] = adv if adv > decayed else decayed
        st["audio_prev"] = now
        st["avg"] = queue if st["avg"] is None else st["avg"] + AVG_W * (queue - st["avg"])
        lead = lead_of(st["jump"])
        e = (lead - st["avg"]) / lead
        e = -1.0 if e < -1 else (1.0 if e > 1 else e)
        st["speed"] = 1 + SPEED_MAX * e
    else:
        st["audio_prev"] = None
        st["avg"] = None
        st["speed"] = 1.0
    st["owed"] += dt * st["speed"]
    frames = 0
    while frames < PER_CALL and st["owed"] >= period:
        st["owed"] -= period
        frames += 1
    if st["owed"] > OWED_MAX:
        st["owed"] = OWED_MAX
    return frames
