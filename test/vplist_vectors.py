#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""vplist_vectors.py OUT.json [INFOS.json] - vettori per test/test_vplist.js: ingressi sintetici (tutte le sigle possibili, tutti i titoli del
catalogo con variazioni, spazzatura) e, se c'e', gli ingressi ricavati dai dump veri (test/vplist_infos.js), con le uscite calcolate dal riferimento
Python indipendente hw/vplist_ref.py. Uso: python3 -I test/vplist_vectors.py OUT.json [INFOS.json]"""
import json, os, random, sys, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hw"))
import vplist_ref as R  # noqa: E402


def expect(rows, info):
    m = R.match_game(rows, info)
    if m is None:
        return [None] * 9
    return [m["how"], m["number"], m["letter"], m["plus"], m["plusOnly"], m["ambiguous"], m["rows"], m["family"], R.describe(rows, m)]


def main():
    rows = R.load_rows(os.path.join(HERE, "..", "src", "vplist_data.js"))
    assert len(rows) == 479
    rng = random.Random(7)
    infos = []
    for n in range(0, 100):
        for suf in ("", "pl", "_f", "pl_f", "_12", "_alt"):
            infos.append({"sigla": "vp_%02d%s" % (n, suf)})
        for pre in ("br_", "o2_", "o3_", "ntsc_", "mod_"):
            infos.append({"sigla": "%s%02d" % (pre, n)})
    for s in ("vp_a", "vp_v", "vp_c7010", "vp_c7420", "vp_c7777", "csv_1", "csv_2", "csv_9", "pr_killerbees", "new_pong", "jo_01", "vp_100", "vp_1", ""):
        infos.append({"sigla": s})
    seen = set()
    for r in rows:
        t = r["ti"]
        variants = [t, t.lower(), t.upper(), "".join(c for c in unicodedata.normalize("NFD", t) if not unicodedata.combining(c)),
                    t + " (Europe)", t.rstrip("!+") + "+", t.rstrip("!+"), t.split("/")[0].strip(), t.split("/")[-1].strip(), t.replace(" ", ""), t.replace("�", "e"),
                    t[:max(3, len(t) // 2)], t.replace(" / ", " + "),
                    t.replace("e", "\ufffd", 1) + " (Europe)", "[x] " + t.replace("a", "\u00e0") + " (NTSC)", t.replace("a", "\u00e0").replace("e", "\u00e9"), t + " ..."]
        for v in variants:
            if v in seen:
                continue
            seen.add(v)
            infos.append({"titles": [v]})
            infos.append({"titles": [v], "plusHint": True})
    for _ in range(150):
        k = rng.randrange(1, 9)
        infos.append({"titles": ["".join(rng.choice("abcdefghijklmnopqrstuvwxyz ") for _ in range(k * 3))]})
    for _ in range(60):
        a, b = rng.choice(rows), rng.choice(rows)
        infos.append({"sigla": rng.choice(["", "pr_x", "vp_%02d" % rng.randrange(100)]), "titles": ["zzz", a["ti"], b["ti"]]})
    if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
        infos.extend(json.load(open(sys.argv[2])))
    cases = [{"input": i, "expect": expect(rows, i)} for i in infos]
    with open(sys.argv[1], "w") as f:
        json.dump(cases, f)
    assert os.path.getsize(sys.argv[1]) > 0
    hit = sum(1 for c in cases if c["expect"][0])
    print("%d casi (%d con abbinamento) -> %s" % (len(cases), hit, sys.argv[1]))


if __name__ == "__main__":
    main()
