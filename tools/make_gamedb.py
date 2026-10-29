#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""Genera src/gamedb_data.js dalla lista software di MAME per il Videopac (hash/videopac.xml, licenza CC0-1.0).

Contiene SOLO impronte SHA-1, il nome-sigla della ROM (per esempio vp_13) e la descrizione pubblicata nella lista: nessun byte
di ROM. Serve a dare un nome-sigla ai dump che non lo hanno nel nome del file (nomi TOSEC e simili) e un nome di ripiego quando
non si legge nessun elenco di nomi. Il contenuto e' un fatto "da verificare" finche' non si confronta coi dump (lo fa test/test_gamenames.js).

uso:  python3 tools/make_gamedb.py videopac.xml [-o src/gamedb_data.js]
"""
import argparse, re, sys
import xml.etree.ElementTree as ET

CODE = re.compile(r'^(vp|o2|o3|br|jo|im|pb|pr|ntsc|pal|mod|new|csv)[_0-9]')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xml')
    ap.add_argument('-o', '--out', default='src/gamedb_data.js')
    a = ap.parse_args()
    root = ET.parse(a.xml).getroot()
    rows, seen = [], {}
    # i genitori prima dei cloni: a parita' di impronta vale il nome del genitore
    sw = sorted(root.findall('software'), key=lambda s: (s.get('cloneof') is not None))
    for s in sw:
        desc = (s.findtext('description') or '').strip()
        alt = ' / '.join(i.get('value').strip() for i in s.findall('info') if i.get('name') == 'alt_title' and i.get('value'))
        for rom in s.iter('rom'):
            sha1 = (rom.get('sha1') or '').lower()
            name = (rom.get('name') or '').lower()
            if not sha1 or not name.endswith('.bin'):
                continue
            stem = name[:-4]
            if stem.startswith('z80_') or not CODE.match(stem):
                continue
            if sha1 in seen:
                continue
            seen[sha1] = stem
            rows.append((stem, sha1, desc, alt))
    rows.sort()
    out = ["'use strict';",
           "// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - generato da tools/make_gamedb.py: NON modificare a mano",
           "// Fonte: lista software di MAME per il Videopac (hash/videopac.xml), licenza CC0-1.0. Contiene solo impronte SHA-1, nome-sigla della ROM",
           "// e descrizione pubblicata: nessun byte di ROM. [sigla, SHA-1, descrizione, titolo alternativo]. Dati da verificare coi propri dump (test/test_gamenames.js).",
           "const ROMS = ["]
    for stem, sha1, desc, alt in rows:
        out.append('  [%s, %s, %s, %s],' % (jq(stem), jq(sha1), jq(desc), jq(alt)))
    out.append('];')
    out.append('module.exports = {ROMS};')
    text = '\n'.join(out) + '\n'
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    import os
    if os.path.getsize(a.out) <= 0:
        sys.exit('file vuoto')
    print('%d voci -> %s (%d byte)' % (len(rows), a.out, os.path.getsize(a.out)))


def jq(s):
    # stringa JS tra apici singoli, caratteri non ASCII come \uXXXX
    r = []
    for ch in s:
        o = ord(ch)
        if ch == "'" or ch == '\\':
            r.append('\\' + ch)
        elif o < 32 or o > 126:
            r.append('\\u%04x' % o)
        else:
            r.append(ch)
    return "'" + ''.join(r) + "'"


if __name__ == '__main__':
    main()
