#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""vplist_ref.py - riferimento INDIPENDENTE per src/vplist.js: stesso abbinamento ROM -> voce del catalogo Videopac / Odyssey2, scritto a parte
(scansione lineare di tutte le voci, unicodedata, niente indici) dalla descrizione nella testata di src/vplist.js. Legge le voci da src/vplist_data.js
(una voce JSON per riga).

  match_game(rows, info) -> None | dict(how, number, letter, plus, plusOnly, ambiguous, rows=[id...], family=[id...])
  info = {sigla, siglas, titles, plusHint}
"""
import json, re, unicodedata

REGION_ORDER = ['EU', 'UK', 'US', 'FR', 'BE', 'DE', 'BR', 'JO', 'PT', 'NC', 'TE']
LOOSE = ('PT', 'NC', 'TE')


def load_rows(path):
    rows = []
    for line in open(path, encoding='utf-8'):
        line = line.strip().rstrip(',')
        if line.startswith('{"id"'):
            rows.append(json.loads(line))
    return rows


def rrank(rg):
    return REGION_ORDER.index(rg) if rg in REGION_ORDER else len(REGION_ORDER)


def strip_marks(t):
    return ''.join(c for c in unicodedata.normalize('NFD', t) if not unicodedata.combining(c))


def norm(s, wild=False):
    t = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', s or '')
    t = strip_marks(t).lower()
    if wild:
        t = t.replace('�', '*')
        return re.sub(r'[^a-z0-9*]+', '', t)
    return re.sub(r'[^a-z0-9]+', '', t)


def is_plus_title(s):
    t = s or ''
    if re.search(r'\+\s*(\([^)]*\)\s*)*$', t.replace('!', '')):
        return True
    return bool(re.search(r'\([^)]*\bplus\b[^)]*\)', t, re.I))


def base_title(ti):
    t = re.sub(r'\s+O3$', '', ti)
    t = re.sub(r'\s*\(\s*AKA[^)]*\)', '', t, flags=re.I)
    t = re.sub(r'\(Imagic title[^)]*\)', '', t)
    return t.strip()


def group_key(r):
    if r['vp']:
        return 'n:%d' % r['vp']
    if r['vl']:
        return 'l:' + r['vl']
    return 't:' + norm(base_title(r['ti']))


def title_forms(r):
    """[(chiave, tipo)] tipo 0 = titolo intero, 1 = pezzo di un titolo doppio; e prefisso per i titoli abbreviati"""
    ti = r['ti']
    forms = {}
    def add(x, kind):
        k = norm(x)
        if len(k) >= 3 and k not in forms:
            forms[k] = kind
    add(base_title(ti), 0)
    m = re.search(r'\(\s*AKA\s+([^)]*)\)', ti, re.I)
    if m:
        for p in m.group(1).split('/'):
            add(p, 0)
    if re.search(r'\.\.\.?\+?$', ti):
        return forms, norm(re.sub(r'\.+\+?$', '', ti))
    pieces = re.split(r'\s*/\s*', base_title(ti))
    if len(pieces) > 1:
        for p in pieces:
            k = norm(p)
            if len(k) >= 5 and k not in forms:
                forms[k] = 1
    return forms, ''


def parse_sigla(s):
    t = (s or '').lower().replace('+', 'pl')
    m = re.fullmatch(r'(vp|br|ntsc)_?(\d{2})((?:_?[a-z0-9]+)*)', t)
    if m:
        suf = m.group(3)
        return dict(kind='num', n=int(m.group(2)), plus='pl' in suf, french=bool(re.search(r'(^|_)f$', suf)) or suf == 'f', br=m.group(1) == 'br')
    m = re.fullmatch(r'o([23])_?(\d{2})((?:_?[a-z0-9]+)*)', t)
    if m:
        return dict(kind='cat', k=m.group(2), plus=m.group(1) == '3' or 'pl' in m.group(3))
    m = re.fullmatch(r'vp_?(a|v)', t)
    if m:
        return dict(kind='let', l=m.group(1).upper())
    m = re.fullmatch(r'vp_?(c7\d{3})', t)
    if m:
        return dict(kind='ct', c=m.group(1).upper())
    m = re.fullmatch(r'csv_?(\d)', t)
    if m:
        return dict(kind='csv', n=m.group(1))
    return None


def pick_title(family):
    def ok(r):
        return not r['lg'] or r['lg'] in ('English', 'British')
    ranked = sorted(family, key=lambda r: (not ok(r), rrank(r['rg']), r['id']))
    t = re.sub(r'\s+O3$', '', ranked[0]['ti'])
    t = re.sub(r'\s*[!+]+$', '', t)
    return re.sub(r'\s*[!+]+$', '', t).strip()


def build(rows, how, gk, want_plus, focus):
    family = [r for r in rows if group_key(r) == gk]
    if not family:
        return None
    plus_rows = [r for r in family if r['pl']]
    plain_rows = [r for r in family if not r['pl']]
    plus = bool(want_plus)
    if plus and not plus_rows:
        plus = False
    if not plus and not plain_rows:
        plus = True
    sel = plus_rows if plus else plain_rows
    sel = sorted(sel, key=lambda r: (-1 if focus == r['rg'] else rrank(r['rg']), r['id']))
    first = family[0]
    return dict(how=how, number=first['vp'], letter=first['vl'], plus=plus, plusOnly=any(r['po'] == 1 for r in sel), ambiguous=False,
                rows=[r['id'] for r in sel], family=[r['id'] for r in sorted(family, key=lambda r: (rrank(r['rg']), r['id']))], key=gk,
                title=pick_title(family))


def from_sigla(rows, sig):
    p = parse_sigla(sig)
    if not p:
        return None
    k = p['kind']
    if k == 'num':
        return build(rows, 'sigla', 'n:%d' % p['n'], p['plus'], 'FR' if p['french'] else 'BR' if p['br'] else '')
    if k == 'cat':
        us = [r for r in rows if r['rg'] == 'US' and re.fullmatch(r'[A-Z]{2}94\d\d', r['ct']) and r['ct'][4:] == p['k']]
        if not us:
            return None
        return build(rows, 'catalogo', group_key(us[0]), p['plus'], 'US')
    if k == 'let':
        return build(rows, 'sigla', 'l:' + p['l'], False, '')
    if k == 'ct':
        sel = [r for r in rows if r['ct'].startswith(p['c'])]
        if not sel:
            return None
        out = build(rows, 'sigla', group_key(sel[0]), False, '')
        if out:
            out['rows'] = [r['id'] for r in sel]
        return out
    if k == 'csv':
        sel = [r for r in rows if r['mk'] == 'CSV' and re.search(r'Verkehrsspiele ' + p['n'] + r'\b', r['ti'])]
        if not sel:
            return None
        return build(rows, 'sigla', group_key(sel[0]), False, '')
    return None


def candidates(rows, raw):
    k = norm(raw)
    if len(k) < 3:
        return []
    hit = {}
    prefixes = []
    for r in rows:
        forms, pref = title_forms(r)
        if k in forms:
            hit[r['id']] = min(forms[k], hit.get(r['id'], 9))
        if pref:
            prefixes.append((pref, r['id']))
    if not hit:
        for r in rows:
            if '�' in r['ti']:
                w = norm(base_title(r['ti']), wild=True)
                if '*' in w and re.fullmatch(w.replace('*', '[a-z0-9]'), k):
                    hit[r['id']] = 0
    if not hit and len(k) >= 12:
        for pref, i in prefixes:
            if len(pref) >= 8 and k.startswith(pref):
                hit[i] = 0
    full = [i for i, kd in hit.items() if kd == 0]
    ids = full if full else list(hit)
    return [rows[i] for i in ids]


def from_titles(rows, titles, plus_hint):
    for raw in titles:
        if not raw:
            continue
        cands = candidates(rows, raw)
        if not cands:
            continue
        groups = {}
        for r in cands:
            groups.setdefault(group_key(r), []).append(r)
        keys = list(groups)
        released = [g for g in keys if any(r['rg'] not in LOOSE for r in groups[g])]
        if released:
            keys = released
        keys.sort(key=lambda g: (-len(groups[g]), g))
        mine = groups[keys[0]]
        want = bool(plus_hint) or is_plus_title(raw) or all(r['pl'] == 1 for r in mine)
        focus = sorted(mine, key=lambda r: rrank(r['rg']))[0]['rg']
        res = build(rows, 'titolo', keys[0], want, focus)
        if res:
            res['ambiguous'] = len(keys) > 1
            return res
    return None


def match_game(rows, info):
    sigs = []
    if info.get('sigla'):
        sigs.append(info['sigla'])
    for s in info.get('siglas') or []:
        if s and s not in sigs:
            sigs.append(s)
    for s in sigs:
        r = from_sigla(rows, s)
        if r:
            return r
    titles = info.get('titles') or []
    return from_titles(rows, titles, bool(info.get('plusHint'))) if titles else None


FLAG_NAMES = [('po', 'Plus-only'), ('no', 'Original-only'), ('m', 'Master-Strategy'), ('v', 'Voice'), ('!', 'Not-on-US-Odyssey2'), ('*', 'Different-in-US')]


def tidy_title(t):
    t = re.sub(r'\s*\([^)]*\)', '', t)
    t = re.sub(r'\s*[!+]+$', '', t)
    return t.replace('\ufffd', '?').strip()


def describe(rows, m):
    """Testo da mostrare per un abbinamento m (uscita di match_game): [titolo, riga, numero, cataloghi, segnalazioni, altri titoli, rarita', editori]."""
    by_id = {r['id']: r for r in rows}
    sel = [by_id[i] for i in m['rows']]
    fam = [by_id[i] for i in m['family']]
    catalogs = []
    for r in sel:
        if r['ct'] and r['ct'] not in catalogs:
            catalogs.append(r['ct'])
    flags = []
    if any(r['po'] == 1 for r in sel):
        flags.append('Plus-only')
    if any(r['no'] == 1 for r in sel):
        flags.append('Original-only')
    for c, name in FLAG_NAMES[2:]:
        if any(c in r['fl'] for r in sel):
            flags.append(name)
    shown = tidy_title(m['title'])
    titles = []

    def add_title(raw):
        t = tidy_title(raw)
        if t and '\ufffd' not in raw and t not in titles and t != shown:
            titles.append(t)
    for r in fam:
        add_title(r['ti'])
        aka = re.search(r'\(\s*AKA\s+([^)]*)\)', r['ti'], re.I)
        if aka:
            add_title(aka.group(1))
    if m['number']:
        num = 'Videopac %d%s' % (m['number'], '+' if m['plus'] else '')
    elif m['letter']:
        num = 'Videopac ' + m['letter']
    else:
        num = ''
    best = next((r for r in sel if r['rg'] not in LOOSE), sel[0] if sel else None)
    makers = []
    for r in sel:
        if r['mk'] not in makers:
            makers.append(r['mk'])
    return [m['title'], (num + ' \u00b7 ' if num else '') + shown, num, catalogs, flags, titles, best['ra'] if best else '', makers]
