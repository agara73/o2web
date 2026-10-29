#!/usr/bin/env python3
# (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
"""make_vplist.py LISTA.html [-o src/vplist_data.js] - dalla lista «Videopac/Odyssey2 Cartridge list» di Maurice Simon (v0.74, 28/01/2006,
www.renelips.nl, copia salvata da digitpress.com) ricava le voci (editore, numero di catalogo, numero Videopac, titolo, lingua, rarita', segni)
e scrive il modulo src/vplist_data.js. Nella lista non c'e' nessun byte di ROM: sono i dati di un catalogo, riportati con il credito all'autore.

Segni della lista (sezione 2.3): m = serie Master Strategy; v = con The Voice; «+» accanto alla rarita' = gira SOLO su un Videopac+;
«-» = dovrebbe girare solo sul Videopac originale; * = 3-in-1 in Europa, giochi diversi negli USA; ! = non gira su un Odyssey2 americano.
Il numero con «+» (43+) e' la versione Plus (ROM vp_43pl) del gioco 43.

Campi di una voce:  id, mk editore, rg regione (EU FR DE UK BE JO US BR PT NC TE), ct catalogo, vp numero Videopac (0 = nessuno), vl lettera (A = Newscaster,
V = Verkehr), pl 1 = versione Plus, po 1 = solo Plus, no 1 = solo originale, ti titolo, lg lingua, bx confezione, ra rarita', fl segni (m v * !), nt nota.
Uso:  python3 -I tools/make_vplist.py LISTA.html [-o src/vplist_data.js]"""
import argparse, html, json, os, re, sys

MAKERS = ['Philips France', 'Philips Germany', 'Philips UK', 'Philips Brazil', 'Philips/Imagic', 'Philips/Parker', 'Philips/GST', 'Parker Brothers',
          'To-Tek/VIFI', 'To-Tek', 'Magnavox', 'Philips', 'Radiola', 'Siera', 'Imagic', 'CSV', 'Dynacom', 'MSP/Gadgets', 'John Dondzilla', 'VPaC',
          'Soeren', 'Ralph Baer', 'Ted Szczypiorski', 'Rene van den Ende', 'Nicolas Sapin', 'Dieter Koenig']
LANGS = ('English', 'German', 'Dutch', 'Italian', 'Danish', 'Swedish', 'Finnish', 'Spanish', 'Belgium', 'British')
# regione di ogni blocco della sezione 2.5 (nell'ordine del file)
BLOCK_REGION = ['EU', 'FR', 'DE', 'UK', 'FR', 'BE', 'DE', 'EU', 'EU', 'JO', 'US', 'BR', 'PT', 'NC', 'TE']
FRONT_VP = {0, 1, 2, 3, 4, 5}                     # il numero Videopac sta davanti al titolo (Radiola e Siera lo ripetono in fondo)
CB = re.compile(r'\s*\[.\]\[.\]\[.\]')
RAR = re.compile(r'(?:^|\s)(\*\*|ER|UR|PR|NR|EM|RP|C|U|R)((?:\s*[-+mv*!])*)\s*$')
CAT = re.compile(r'^(G\d{4}|2\d{4}|[A-Z]{2}\d{4}|\d{2}AV\d{4}|\d{6}(?:-\w+)?|C7\d{3}(?:/\S+)?|TRAFIC2)$')
VP = re.compile(r'^(\d{1,2}\+?|[AV])$')
BOXES = (' Videopac+ box', ' normal box', ' Different label', ' Magnavox')
CREDIT = ('Videopac/Odyssey2 Cartridge list v0.74 (28 gennaio 2006) di Maurice Simon <maurice@videopac.info>, www.renelips.nl; copia da www.digitpress.com/faq/videopaclist.htm. '
          'L\'autore permette di copiare la lista, intera o in parte, e di metterla su un sito, purche\' senza profitto e dando il credito a lui.')


def decode(raw):
    t = raw.decode('cp1252')
    t = html.unescape(re.sub(r'<[^>]+>', '', t))
    return t.replace('ï¿½', '�')      # nel file originale il carattere accentato e' gia' perso (resta «?» nero)


def blocks_of(text):
    a = text.index('** Section 2.5')
    b = text.index('** Section 3.1')
    out, cur, inhead = [], None, False
    for l in text[a:b].split('\n')[1:]:
        if l.startswith('+---'):
            if cur is None or not inhead:
                cur = []
                out.append(cur)
                inhead = True
            else:
                inhead = False
            continue
        if inhead or cur is None:
            continue
        if CB.search(l):
            cur.append(l)
    return out


def split_row(raw, bi):
    m = CB.search(raw)
    left = raw[:m.start()].rstrip()
    notes = re.sub(r'\[.\]\[.\]\[.\]', '', raw[m.start():]).strip()
    # segnaposto vuoti: nessun titolo
    if re.fullmatch(r'[-?\s]*(06AV\d{4})?[-?\s]*(NR)?\s*', left) or left == 'Philips Brazil - - -':
        return None
    mk = next((x for x in MAKERS if left == x or left.startswith(x + ' ') or left.startswith(x + '-')), '')
    rest = left[len(mk):].strip() if mk else left
    if rest.startswith('-'):
        rest = rest[1:].strip()
    # numero e rarita' incollati (Jopac, O3): «Western+ 14+UR»
    g = re.match(r'^(.*?) (\d{1,2}\+?)(ER|UR|PR)$', rest)
    if g:
        rest, rar, mods = g.group(1) + ' ' + g.group(2), g.group(3), ''
    else:
        r = RAR.search(rest)
        if not r:
            raise ValueError('rarita\' non trovata: ' + raw)
        rar, mods = r.group(1), re.sub(r'\s', '', r.group(2))
        rest = rest[:r.start()].rstrip()
    # due righe dell'originale hanno la rarita' attaccata alla lingua («Swedish**m»)
    if rar == '' and False:
        pass
    toks = rest.split(' ')
    ct = ''
    if bi == 9 and len(toks) > 2 and re.fullmatch(r'[A-Za-z]{3}', toks[0]) and re.fullmatch(r'[A-Z]\d\d(/\d)?', toks[1]):
        ct, toks = toks[0].upper() + ' ' + toks[1], toks[2:]
    elif toks and CAT.match(toks[0]):
        ct, toks = toks[0], toks[1:]
    elif toks and toks[0] in ('-', '?'):
        toks = toks[1:]
    vp = ''
    if bi in FRONT_VP:
        if toks and VP.match(toks[0]):
            vp, toks = toks[0], toks[1:]
            if bi in (4, 5) and toks and toks[-1] == vp:           # Radiola e Siera ripetono il numero in fondo
                toks = toks[:-1]
    else:
        if len(toks) > 1 and re.fullmatch(r'\d{1,2}\+?', toks[-1]):
            vp, toks = toks[-1], toks[:-1]
        elif len(toks) > 1 and toks[-1] == 'A' and bi in (10, 11):         # «Keyboard Creations A»
            vp, toks = 'A', toks[:-1]
    title = ' '.join(toks)
    if mk in ('Nicolas Sapin', 'Dieter Koenig'):                         # «61 Interpol 40 made»: numero di catalogo, titolo, tiratura
        g2 = re.match(r'^(\d+) (.+)$', title)
        if g2:
            ct, title = g2.group(1), g2.group(2)
    g3 = re.match(r'^(.*?)\s*(\d+ made)$', title)
    if g3:
        title = g3.group(1)
        notes = (g3.group(2) + (' ' + notes if notes else '')).strip()
    bx = ''
    for x in BOXES:
        if title.endswith(x):
            bx, title = x.strip(), title[:-len(x)]
    lg = ''
    if bi in (0, 3) and len(title.split(' ')) > 1 and title.split(' ')[-1] in LANGS:
        lg = title.split(' ')[-1]
        title = title[:-len(lg) - 1]
    if bi == 6:
        pass
    plus_vp = vp.endswith('+')
    vl = vp if vp in ('A', 'V') else ''
    num = 0 if vl else int(vp.rstrip('+')) if vp else 0
    # il titolo che comincia per «A Newscaster» (Philips) tiene la «A» come lettera, non come parte del titolo
    if vl == 'A' and title.startswith('A '):
        title = title[2:]
    pl = 1 if (plus_vp or title.rstrip().endswith('+')) else 0
    return dict(mk=mk, rg=BLOCK_REGION[bi] if not (mk == 'Magnavox' and bi == 0) else 'UK', ct=ct, vp=num, vl=vl, pl=pl,
                po=1 if '+' in mods else 0, no=1 if '-' in mods else 0, ti=title.strip(), lg=lg, bx=bx, ra=rar,
                fl=''.join(c for c in mods if c in 'mv*!'), nt=notes, raw=raw)


def parse_html(raw_bytes):
    text = decode(raw_bytes)
    rows = []
    for bi, lines in enumerate(blocks_of(text)):
        for l in lines:
            # «Swedish**m»: lingua e rarita' attaccate nell'originale
            l2 = l.replace('Swedish**m', 'Swedish ** m')
            r = split_row(l2, bi)
            if r:
                r['raw'] = l
                rows.append(r)
    for i, r in enumerate(rows):
        r['id'] = i
    return rows


def render_js(rows, source=''):
    keys = ('id', 'mk', 'rg', 'ct', 'vp', 'vl', 'pl', 'po', 'no', 'ti', 'lg', 'bx', 'ra', 'fl', 'nt')
    lines = [json.dumps({k: r[k] for k in keys}, ensure_ascii=True, separators=(',', ':')) for r in rows]
    head = ("'use strict';\n// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser\n//\n"
            "// vplist_data.js - GENERATO da tools/make_vplist.py (non modificare a mano). Voci del catalogo delle cartucce Videopac / Odyssey2:\n"
            "// editore, catalogo, numero Videopac, titolo, lingua, rarita'. Nessun byte di ROM. Credito: Maurice Simon (vedi CREDIT).\n"
            "// La GPL-3.0 del progetto vale per il CODICE; questi dati restano soggetti al permesso dell'autore (nessun profitto, credito a lui).\n")
    return (head + "const CREDIT = " + json.dumps(CREDIT, ensure_ascii=True) + ";\nconst ROWS = [\n" + ',\n'.join(lines) + "\n];\n"
            "module.exports = {CREDIT, ROWS};\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html')
    ap.add_argument('-o', '--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'vplist_data.js'))
    a = ap.parse_args()
    rows = parse_html(open(a.html, 'rb').read())
    js = render_js(rows)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    assert os.path.getsize(a.out) > 0
    print('%d voci -> %s (%d byte)' % (len(rows), a.out, os.path.getsize(a.out)))


if __name__ == '__main__':
    main()
