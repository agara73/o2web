'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// gamelist.js - la VISTA dell'elenco dei giochi (tappa 7): da ogni gioco della libreria una VOCE con sigla e nome, e, se richiesto, una voce
// sola per tutti i dump con lo STESSO CONTENUTO (stesso SHA-256) anche se i file hanno nomi diversi (raccolte TOSEC, NonGood, MAME, roms777...).
// E' solo una vista: la libreria, le sessioni e gli stati di gioco restano per singolo dump, non cambia niente nei file salvati.
// Si fondono SOLO dump identici byte per byte: versioni diverse dello stesso gioco (Plus, ritocchi, regioni) restano voci separate.
//   buildEntries(games, names, opts)  -> [voce]      opts.merge: true = una voce per contenuto
//   filterEntries(entries, {query, folder, order})  -> [voce] in ordine: order 'name' (predefinito) = per titolo; 'device' = per dispositivo e numero di cassetta
//   groupEntries(voci ordinate, order)  -> [{kind, label, entries}]  i blocchi con intestazione dell'ordine per dispositivo (kind: odyssey | videopac | plus | maker | unknown); per nome un blocco solo ('all')
// voce = {key, games: [record], ids: [id], rep: record, metaGame: record, sigla, siglas: [], title, label, others: [], count, folders: [], text,
//         device: 'odyssey' | 'videopac' | 'plus' | 'maker' | 'unknown', maker: editore (giochi senza numero e non riconosciuti), num: numero Videopac per l'ordine
//         conflict: null | {name, content}  il nome del file diceva un altro gioco di quello dell'impronta SHA-1 (vale l'impronta: gamenames.describeGame)
//         cat: descrizione dell'abbinamento al catalogo (vplist.describeMatch) | null, match: l'abbinamento (vplist.matchGame) | null}
const {gameText, searchKey} = require('./library.js');
const {describeGame, isNumbered, sigKey, stemOf} = require('./gamenames.js');
const {matchGame, describeMatch} = require('./vplist.js');

const SIGLA_ORDER = ['vp', 'o2', 'o3', 'br', 'csv', 'ntsc', 'mod'];
function siglaRank(s) {
  const p = /^(vp|o2|o3|br|csv|ntsc|mod)(?![a-z])/.exec(s);        // il prefisso puo' contenere una cifra (o2_05): non basta [a-z]+
  const i = p ? SIGLA_ORDER.indexOf(p[1]) : -1;
  return i < 0 ? SIGLA_ORDER.length : i;
}
const norm = (s) => searchKey(s).replace(/[^a-z0-9]+/g, '');

// Ingresso dell'abbinamento al catalogo (vplist.js): la sigla (con le altre in ordine), i titoli noti (nome scelto, nomi alternativi, titolo e nome dei file)
// e l'indizio «Plus» scritto nel nome del file («Pick Axe Pete+», «(Plus)», «_plus»; un «+» tra spazi e' un separatore: «Bowling + Basketball»).
// games: [record della libreria]; descs: la descrizione (describeGame) di ognuno, in un array o sola; siglas: l'ordine delle sigle, se noto.
function plusInName(stem) {
  const t = String(stem || '').replace(/\s\+\s/g, ' ');
  return /\+|\(plus\)|(^|[\s_\-])plus([\s_\-.)]|$)/i.test(t);
}
function gameInfo(games, descs, siglas) {
  const ds = Array.isArray(descs) ? descs : [descs];
  const sg = siglas ? siglas.slice() : [];
  if (!siglas) for (const d of ds) for (const x of [d.sigla].concat(d.extraSiglas)) if (x && !sg.includes(x)) sg.push(x);
  const titles = [];
  const add = (t) => { if (t && !titles.includes(t)) titles.push(t); };
  for (const d of ds) { add(d.title); for (const x of d.altNames) add(x); }
  for (const g of games) { add(g.title); add(g.display); add(stemOf(g.name)); }
  const plusHint = games.some((g) => plusInName(stemOf(g.name))) || sg.some((x) => /pl/.test(x));
  return {sigla: sg[0] || '', siglas: sg.slice(1), titles, plusHint};
}

// Dispositivo, editore e numero di una voce per l'ordine «dispositivo - numero di cassetta»: i giochi col numero Videopac vanno nei blocchi
// Odyssey2 (sigla o2_ o versione solo USA), Videopac G7000 e Videopac+ (versione Plus); gli altri (senza numero, o non riconosciuti) in un blocco per editore,
// quello della lista o, se il gioco non c'e', quello scritto nel nome TOSEC; senza editore, in fondo.
const LETTER_NUM = {A: 1000, V: 1001};
function classify(match, sigla, metaGame) {
  if (match && (match.number || match.letter)) {
    const num = match.number || LETTER_NUM[match.letter] || 1002;
    const o2 = /^o2/.test(sigla) || (!sigla && match.rows.length > 0 && match.rows[0].rg === 'US');
    return {device: match.plus ? 'plus' : o2 ? 'odyssey' : 'videopac', maker: '', num};
  }
  let maker = match && match.rows.length ? match.rows[0].mk : (metaGame.publisher || '');
  maker = maker.replace(/^Philips\//, '').trim();
  return {device: maker ? 'maker' : 'unknown', maker, num: Infinity};
}

function makeEntry(members, key) {
  // members: [{g, d}] nell'ordine della libreria
  const ordered = members.slice().sort((a, b) => (a.d.rank - b.d.rank) || ((a.g.year || a.g.publisher ? 0 : 1) - (b.g.year || b.g.publisher ? 0 : 1)) || (a.g.id - b.g.id));
  const best = ordered[0];
  const siglas = [];
  for (const m of members) if (m.d.sigla && !siglas.includes(m.d.sigla)) siglas.push(m.d.sigla);
  siglas.sort((a, b) => (siglaRank(a) - siglaRank(b)) || (a < b ? -1 : a > b ? 1 : 0));
  for (const m of members) for (const x of m.d.extraSiglas) if (!siglas.includes(x)) siglas.push(x);       // le sigle «di rincalzo» (scritte diversamente dall'impronta) dopo
  const sigla = siglas[0] || '';
  const title = best.d.title;
  const seen = new Set([norm(title)]);
  if (sigla) seen.add(norm(sigla));
  const others = [];
  const add = (text, key) => {
    const k = key === undefined ? norm(text) : key;
    if (!k || seen.has(k)) return;
    seen.add(k);
    others.push(text);
  };
  for (const m of ordered) { for (const x of m.d.altNames) add(x); }
  for (const m of ordered) add(m.d.title);                                // il titolo che ogni file riceverebbe da solo (elenchi di nomi diversi)
  for (const m of ordered) add(m.g.display);
  for (const x of siglas.slice(1)) add(x);
  for (const m of ordered) add(m.g.name, norm(stemOf(m.g.name)));
  for (const m of ordered) { for (const x of m.d.notes) add(x); }
  const folders = [];
  for (const m of members) if (!folders.includes(m.g.folder)) folders.push(m.g.folder);
  const conflictMember = members.find((m) => m.d.conflict);
  const metaGame = (ordered.find((m) => m.g.year || m.g.publisher) || best).g;
  const match = matchGame(gameInfo(members.map((m) => m.g), members.map((m) => m.d), siglas));
  const cat = match ? describeMatch(match) : null;
  const cls = classify(match, sigla, metaGame);
  // per la ricerca: numero, cataloghi, titoli di tutti i paesi e lingue del gioco, editori
  const catText = match ? [cat.line, match.family.map((r) => [r.ct, r.ti, r.mk].join(' ')).join(' ')].join(' ') : '';
  const text = searchKey([sigla, siglas.join(' '), title, others.join(' '), catText, members.map((m) => gameText(m.g)).join(' ')].join(' '));
  return {key, games: members.map((m) => m.g), ids: members.map((m) => m.g.id), rep: best.g, metaGame, sigla, siglas, title,
    label: sigla ? sigla + ' — ' + title : title, others, count: members.length, folders, text, cat, match, conflict: conflictMember ? conflictMember.d.conflict : null,
    device: cls.device, maker: cls.maker, num: cls.num};
}

function buildEntries(games, names, opts) {
  const merge = !!(opts && opts.merge);
  const groups = new Map();
  for (const g of games) {
    const d = describeGame(g, names);
    const k = merge ? 'sha:' + g.sha : 'id:' + g.id;
    let e = groups.get(k);
    if (!e) groups.set(k, e = []);
    e.push({g, d});
  }
  const out = [];
  for (const [k, members] of groups) out.push(makeEntry(members, k));
  return out;
}

function sortEntries(list) {
  return list.slice().sort((a, b) => {
    const ka = searchKey(a.title), kb = searchKey(b.title);
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.sigla !== b.sigla) return a.sigla < b.sigla ? -1 : 1;
    return a.rep.id - b.rep.id;
  });
}

const DEVICE_RANK = {odyssey: 0, videopac: 1, plus: 2, maker: 3, unknown: 4};
const DEVICE_LABEL = {odyssey: 'Odyssey\u00b2 (Magnavox)', videopac: 'Videopac (Philips G7000)', plus: 'Videopac+ (Philips G7400)', unknown: 'Editore sconosciuto'};
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sortDevice(list) {
  return list.slice().sort((a, b) => {
    if (a.device !== b.device) return DEVICE_RANK[a.device] - DEVICE_RANK[b.device];
    if (a.device === 'maker') { const c = cmp(norm(a.maker), norm(b.maker)); if (c) return c; }
    else if (a.device !== 'unknown' && a.num !== b.num) return a.num - b.num;
    const ka = searchKey(a.title), kb = searchKey(b.title);
    if (a.device !== 'maker' && a.device !== 'unknown') { const c = cmp(a.sigla, b.sigla); if (c) return c; }
    return cmp(ka, kb) || cmp(a.sigla, b.sigla) || (a.rep.id - b.rep.id);
  });
}

function filterEntries(entries, opts) {
  const q = opts && opts.query ? searchKey(opts.query).split(/\s+/).filter(Boolean) : [];
  const folder = opts && opts.folder !== undefined && opts.folder !== null ? opts.folder : null;
  const out = entries.filter((e) => {
    if (folder !== null && !e.folders.includes(folder)) return false;
    return q.every((w) => e.text.includes(w));
  });
  return opts && opts.order === 'device' ? sortDevice(out) : sortEntries(out);
}

// i blocchi con intestazione di un elenco gia' ordinato (per dispositivo); per nome un blocco solo, senza intestazione
function groupEntries(list, order) {
  if (!list.length) return [];
  if (order !== 'device') return [{kind: 'all', label: '', entries: list}];
  const out = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last.kind === e.device && (e.device !== 'maker' || norm(last.makerSample) === norm(e.maker))) {
      last.entries.push(e);
      if (e.device === 'maker' && e.maker < last.label) last.label = e.maker;        // a parita' di editore scritto in modi diversi vale la scrittura con la maiuscola
    } else out.push({kind: e.device, label: e.device === 'maker' ? e.maker : DEVICE_LABEL[e.device], makerSample: e.maker, entries: [e]});
  }
  for (const g of out) delete g.makerSample;
  return out;
}

module.exports = {buildEntries, filterEntries, groupEntries, sortEntries, isNumbered, sigKey, gameInfo, plusInName};
