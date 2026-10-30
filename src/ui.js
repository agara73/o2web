'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// ui.js - la pagina: collega app.js (il regista, senza DOM) a bottoni, elenchi, canvas, tastiera, gamepad e uscita sonora. Solo DOM:
// nessun accesso diretto alla rete (lo scarico passa da app.fetchUrl / app.fetchCharset / app.autoLoadCharsets e da src/netfetch.js), nessun localStorage, nessun alert()/confirm()
// (i messaggi e le conferme sono nella pagina). I file (BIOS, cartucce, zip, stati, sessioni, copertine) si scelgono dal disco dell'utente e restano nel browser.
const {App, layoutSize} = require('./app.js');
const {AudioOutput} = require('./webaudio.js');
const {Screen} = require('./screen.js');
const I = require('./input.js');
const TouchMod = require('./touch.js');
const S = require('./session.js');
const {folderList} = require('./library.js');
const Look = require('./look.js');
const Machines = require('./machines.js');
const Photos = require('./photos.js');
const Net = require('./netfetch.js');
const I18N = require('./i18n.js');
const T = I18N.t;
// lingua della pagina: INGLESE di partenza; «?lang=it» (o «?lang=en») in fondo all'indirizzo la cambia, e le bandiere in alto a destra pure (niente localStorage)
function langFromUrl() {
  const m = /(^|[?&#])lang=(en|it)\b/i.exec(String(location.search || '') + String(location.hash || ''));
  return m ? m[2].toLowerCase() : 'en';
}
I18N.setLang(langFromUrl());
let charui = null;                                       // editor dei caratteri (si crea dopo la pagina)
let PHOTOS = {};
try { PHOTOS = require('./photos_data.js'); } catch (e) { PHOTOS = {}; }      // senza foto (cartella web/photos assente) restano i disegni originali
const charsetOwn = require('./charset_own.js');
const charsetEfOwn = require('./charset9341_own.js');
const CharUI = require('./charui.js');

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 400;
const RESERVED = /^(F8|F9|F10|Tab|Meta|OS|Alt|ContextMenu|CapsLock)/;
const ACTION_NAMES = {up: 'Su', right: 'Destra', down: 'Giù', left: 'Sinistra', fire: 'Fuoco'};

const LOOK_SLIDERS = ['blur', 'persist', 'glow', 'scan', 'mask', 'curve'];
const ui = {charRev: 0, covRev: -1, covClearT: 0, netWas: false, lookRev: -1, lookKey: '', machineKey: null, con: null, capture: null, rev: -1, foldersKey: null, toastT: 0, statT: 0, statFrames: 0, statRaf: 0, statUnder: 0, clearT: 0, vkBuilt: false, padKey: '', rows: [], pvCanvases: new Map(), visible: new Set(), io: null, pvT: 0};

// ---------------------------------------------------------------- messaggi nella pagina
function log(text, kind) {
  const box = $('log');
  const d = document.createElement('div');
  d.className = 'msg' + (kind ? ' ' + kind : '');
  const sp = document.createElement('span');
  sp.textContent = T(text);
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.setAttribute('aria-label', T('Chiudi il messaggio'));
  x.addEventListener('click', () => box.removeChild(d));
  d.appendChild(sp);
  d.appendChild(x);
  box.appendChild(d);
  while (box.children.length > 6) box.removeChild(box.firstChild);
}
function toast(text) {
  const el = $('toast');
  el.textContent = T(text);
  el.classList.add('on');
  clearTimeout(ui.toastT);
  ui.toastT = setTimeout(() => el.classList.remove('on'), 1600);
}

async function readFile(file) {
  if (file.arrayBuffer) return new Uint8Array(await file.arrayBuffer());
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result));
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}

// scaricamento con Blob (mai data: URI)
function download(name, bytes, type) {
  const blob = new Blob([bytes], {type: type || 'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// ---------------------------------------------------------------- applicazione
const AC = window.AudioContext || window.webkitAudioContext || null;
const sink = new AudioOutput({Ctx: AC});
const app = new App({onMessage: log, sink, fallbackCharset: new Uint8Array(charsetOwn.build()), fallbackEfCharset: new Uint8Array(charsetEfOwn.build()), onNet: () => renderNet()});
let screen = null;

function focusScreen() { $('screen').focus(); }
function unlockAudio() {
  if (!sink.available) return;
  if (!sink.ctx) app.enableAudio();
  else if (!sink.running) sink.resume();
}

// ---------------------------------------------------------------- disegno dell'elenco e dei pannelli
function kb(n) { return n >= 1024 ? (n / 1024).toFixed(n % 1024 ? 1 : 0) + ' KB' : T('{n} byte', {n}); }
function biosLabel(b) { return b.display + (b.supported ? '' : ' (' + T('non supportato') + ')') + ' · ' + kb(b.size); }

// ---------------------------------------------------------------- copertine: miniature nell'elenco e immagine del gioco in uso (blob nel browser, mai in rete)
const thumbs = new Map();           // id copertina -> indirizzo blob della miniatura | 'wait' | 'none'
const fulls = new Map();            // id copertina -> indirizzo blob dell'immagine intera
const thumbQ = [];
let thumbBusy = 0;
function blobOf(c) { return new Blob([c.data], {type: c.mime}); }
function fullUrl(c) {
  let u = fulls.get(c.id);
  if (!u) { u = URL.createObjectURL(blobOf(c)); fulls.set(c.id, u); }
  return u;
}
async function makeThumb(c) {
  const bmp = await createImageBitmap(blobOf(c), {resizeHeight: 88, resizeQuality: 'medium'});
  try {
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/webp', 0.8));
    return blob ? URL.createObjectURL(blob) : 'none';
  } finally { if (bmp.close) bmp.close(); }
}
function pumpThumbs() {
  while (thumbBusy < 2 && thumbQ.length) {
    const c = thumbQ.shift();
    thumbBusy++;
    makeThumb(c).then((u) => {
      if (!app.covers.get(c.id)) { if (u !== 'none') URL.revokeObjectURL(u); thumbs.delete(c.id); return; }       // tolta nel frattempo
      thumbs.set(c.id, u);
      if (u !== 'none') for (const im of document.querySelectorAll('#games img.th[data-cover="' + c.id + '"]')) im.src = u;
    }).catch(() => { thumbs.set(c.id, 'none'); }).then(() => { thumbBusy--; pumpThumbs(); });
  }
}
function thumbUrl(c) {
  const t = thumbs.get(c.id);
  if (t && t !== 'wait' && t !== 'none') return t;
  if (!t && typeof createImageBitmap === 'function') { thumbs.set(c.id, 'wait'); thumbQ.push(c); pumpThumbs(); }
  return '';
}
// toglie le immagini in cache delle copertine che non ci sono piu' (svuotate o tolte)
function purgeCovers() {
  const ids = new Set(app.covers.list.map((c) => c.id));
  for (const m of [thumbs, fulls]) {
    for (const [id, u] of [...m]) {
      if (ids.has(id)) continue;
      if (typeof u === 'string' && u.startsWith('blob:')) URL.revokeObjectURL(u);
      if (u !== 'wait') m.delete(id);
    }
  }
}
function renderCover() {
  const g = app.game, c = g && app.covers.count ? app.covers.forGame(g) : null;
  const fig = $('cover'), img = $('cover-img');
  if (!c) { fig.style.display = 'none'; fig.dataset.id = ''; img.removeAttribute('src'); return; }
  fig.style.display = '';
  if (fig.dataset.id !== String(c.id)) { fig.dataset.id = String(c.id); img.src = fullUrl(c); }
  img.alt = T('Copertina di {name}', {name: g.display});
  $('cover-cap').textContent = g.display + ' \u00B7 ' + c.name;
}
function renderCovers() {
  if (app.covers.rev !== ui.covRev) { ui.covRev = app.covers.rev; purgeCovers(); }
  const n = app.covers.count;
  $('b-covers-clear').disabled = !n;
  if (!n) { $('covers-info').textContent = T('Nessuna copertina in memoria.'); return; }
  const st = app.coverStats();
  $('covers-info').textContent = T(n === 1 ? '{n} copertina in memoria ({size})' : '{n} copertine in memoria ({size})', {n, size: kb(app.covers.bytes)}) +
    (st.games ? ' \u00B7 ' + T('abbinate a {m} giochi su {g}', {m: st.matched, g: st.games}) : ' \u00B7 ' + T('si abbinano ai giochi per titolo, appena li aggiungi'));
}

// ---------------------------------------------------------------- rete su richiesta: avanzamento dello scarico (parte solo dal pulsante «Scarica»)
function renderNet() {
  const n = app.net, pr = $('net-prog');
  $('net-go').disabled = n.busy;
  $('b-dl-vdc').disabled = n.busy;
  $('b-dl-ef').disabled = n.busy;
  const pr2 = $('dl-prog');
  $('net-cancel').disabled = !n.busy;
  $('net-url').disabled = n.busy;
  $('net-kind').disabled = n.busy;
  if (n.busy) {
    ui.netWas = true;
    pr.hidden = false;
    if (n.total) { pr.max = n.total; pr.value = n.received; } else pr.removeAttribute('value');
    pr2.hidden = false;
    if (n.total) { pr2.max = n.total; pr2.value = n.received; } else pr2.removeAttribute('value');
    $('net-status').textContent = n.total ? T('Scarico da {host}: {got} di {total}\u2026', {host: n.host, got: Net.fmtBytes(n.received), total: Net.fmtBytes(n.total)}) : T('Scarico da {host}: {got}\u2026', {host: n.host, got: Net.fmtBytes(n.received)});
  } else {
    pr.hidden = true;
    pr2.hidden = true;
    if (ui.netWas) { ui.netWas = false; $('net-status').textContent = ''; }
  }
}

function renderBios() {
  const sel = $('bios-sel');
  sel.textContent = '';
  $('adv-bios').hidden = app.lib.bios.length < 2;
  if (!app.lib.bios.length) {
    const o = document.createElement('option');
    o.textContent = T('(nessun BIOS)');
    sel.appendChild(o);
    sel.disabled = true;
    $('bios-info').textContent = T('Aggiungi un BIOS con «Aggiungi file»: le macchine senza BIOS restano in grigio.');
    return;
  }
  sel.disabled = false;
  for (const b of app.lib.bios) {
    const o = document.createElement('option');
    o.value = String(b.id);
    o.textContent = biosLabel(b);
    sel.appendChild(o);
  }
  if (app.biosId !== null) sel.value = String(app.biosId);
  const b = app.bios;
  $('bios-info').textContent = b ? T('BIOS: {name} · SHA-256 {sha}', {name: b.name, sha: b.sha.slice(0, 12)}) + (b.known ? '' : ' · ' + T('BIOS sconosciuto (provato come G7000)')) +
    (b.supported ? '' : ' · ' + T(b.reason)) : T('Nessun BIOS utilizzabile: scegline uno tra le opzioni avanzate o aggiungilo.');
}

function renderFolders() {
  const list = folderList(app.lib.games);
  const key = list.map((f) => f.folder + '\u0001' + f.count).join('\u0002') + '|' + app.lib.games.length;
  if (key === ui.foldersKey) return;
  ui.foldersKey = key;
  const sel = $('folder');
  const cur = sel.value;
  sel.textContent = '';
  const all = document.createElement('option');
  all.value = '*';
  all.textContent = T('Tutte le cartelle ({n})', {n: app.lib.games.length});
  sel.appendChild(all);
  for (const f of list) {
    const o = document.createElement('option');
    o.value = 'f:' + f.folder;
    o.textContent = (f.folder || T('(file singoli)')) + ' (' + f.count + ')';
    sel.appendChild(o);
  }
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '*';
}

// ---- anteprime (tappa 7): un <canvas> per riga, disegnato dalla memoria dell'app; il calcolo parte solo per le righe che si vedono
function drawPreview(cv, res) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  if (res && res.state === 'ready') { ctx.putImageData(new ImageData(res.rgba, res.w, res.h), 0, 0); return; }
  // segnaposto originale: riquadro scuro con un piccolo joystick stilizzato (in attesa: solo il riquadro)
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!res) return;
  ctx.strokeStyle = '#3a4258';
  ctx.fillStyle = '#3a4258';
  ctx.lineWidth = 2;
  const cx = cv.width / 2, cy = cv.height / 2;
  ctx.beginPath(); ctx.arc(cx, cy + 8, 12, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 8); ctx.lineTo(cx + 5, cy - 12); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 5, cy - 14, 4, 0, Math.PI * 2); ctx.fill();
}
function previewTitle(res) {
  if (!res) return T('Anteprima in preparazione…');
  if (res.state === 'ready') return T('Anteprima: una schermata del gioco');
  if (res.state === 'blank') return T('Nessuna schermata riconoscibile nei primi secondi di gioco');
  if (res.state === 'error') return T('Anteprima non riuscita');
  return T('Anteprima non disponibile con questa macchina');
}
function wantVisible() {                                 // le righe da calcolare: quelle visibili, nell'ordine dell'elenco
  if (!ui.io) return ui.rows.slice(0, 40);                // senza osservatore: le prime righe
  const out = [];
  ui.rows.forEach((e, i) => { if (ui.visible.has(i)) out.push(e); });
  return out;
}
function schedulePreviews() {
  clearTimeout(ui.pvT);
  ui.pvT = setTimeout(() => { ui.pvT = 0; app.requestPreviews(app.previews.enabled ? wantVisible() : []); }, 80);
}
function setupObserver(ul) {
  if (ui.io) { ui.io.disconnect(); ui.io = null; }
  ui.visible = new Set();
  if (typeof IntersectionObserver !== 'function') {
    return;
  }
  ui.io = new IntersectionObserver((list) => {
    for (const en of list) {
      const i = Number(en.target.dataset.i);
      if (en.isIntersecting) ui.visible.add(i); else ui.visible.delete(i);
    }
    schedulePreviews();
  }, {root: ul, rootMargin: '60px 0px'});
  for (const li of ul.children) if (li.dataset.i !== undefined) ui.io.observe(li);       // le intestazioni dei blocchi non hanno anteprima
}
app.onPreview = (g, res) => {
  const list = ui.pvCanvases.get(g.sha);
  if (!list) return;
  for (const cv of list) { drawPreview(cv, res); cv.title = previewTitle(res); }
};

// Testi del catalogo (src/vplist.js): rarita' e segnalazioni della lista di Maurice Simon
function rarityText(code) {
  switch (code) {
    case 'C': return T('Comune');
    case 'U': return T('Non comune');
    case 'R': return T('Raro');
    case 'ER': return T('Molto raro');
    case 'UR': return T('Rarissimo');
    case 'PR': return T('Prototipo');
    case 'NR': return T('Mai uscito');
    case 'EM': return T('ROM per emulatore');
    case 'RP': return T('Prototipo rilasciato');
    case '**': return T('Non confermato');
    default: return '';
  }
}
function catFlagText(f) {
  switch (f) {
    case 'Plus-only': return T('Solo Videopac+');
    case 'Original-only': return T('Solo Videopac originale');
    case 'Master-Strategy': return T('Serie Master Strategy');
    case 'Voice': return T('Con The Voice');
    case 'Not-on-US-Odyssey2': return T('Non gira su un Odyssey2 USA');
    case 'Different-in-US': return T('3 in 1 in Europa, giochi diversi negli USA');
    default: return f;
  }
}
// riga del catalogo sotto il nome: «Videopac 43 · G7143 · AC9437 · +3 · Comune · Solo Videopac+»
function catalogLine(e) {
  const cat = e.cat;
  const c = document.createElement('span');
  c.className = 'c';
  const bits = [cat.number || T('Catalogo')].concat(cat.catalogs.slice(0, 3));
  if (cat.catalogs.length > 3) bits.push('+' + (cat.catalogs.length - 3));
  const r = rarityText(cat.rarity);
  if (r) bits.push(r);
  c.textContent = bits.join(' \u00b7 ');
  const plus = cat.flags.filter((f) => f === 'Plus-only');
  const others = cat.flags.filter((f) => f !== 'Plus-only');
  if (others.length) c.appendChild(document.createTextNode(' \u00b7 ' + others.map(catFlagText).join(' \u00b7 ')));
  if (plus.length) {
    const p = document.createElement('span');
    p.className = 'pl';
    p.textContent = ' \u00b7 ' + catFlagText('Plus-only');
    c.appendChild(p);
  }
  const how = e.match.how === 'titolo' ? T('abbinato dal titolo (da controllare)') : e.match.how === 'catalogo' ? T('abbinato dal numero di catalogo Magnavox') : T('abbinato dalla sigla');
  c.title = [cat.line, cat.titles.length ? cat.titles.slice(0, 12).join(' / ') : '', cat.catalogs.join(', '), how,
    T('Fonte: lista delle cartucce di Maurice Simon (vedi «Informazioni e licenza»)')].filter(Boolean).join('\n');
  return c;
}

function renderGames() {
  renderFolders();
  const fv = $('folder').value;
  const list = app.listEntries($('q').value, fv === '*' ? null : fv.slice(2));
  const ul = $('games');
  ul.setAttribute('aria-label', T('Elenco dei giochi'));
  ul.textContent = '';
  const rows = list.slice(0, MAX_ROWS);
  ui.rows = rows;
  ui.pvCanvases = new Map();
  const pvOn = app.previews.enabled;
  const frag = document.createDocumentFragment();
  // ordine per dispositivo: un'intestazione prima di ogni blocco (Odyssey2, Videopac, Videopac+, un blocco per editore)
  const heads = new Map();
  let at = 0;
  if (app.listOrder === 'device') for (const gr of app.groupedEntries(rows)) { heads.set(at, gr); at += gr.entries.length; }
  rows.forEach((e, idx) => {
    if (heads.has(idx)) {
      const gr = heads.get(idx);
      const h = document.createElement('li');
      h.className = 'hd';
      h.setAttribute('role', 'presentation');
      h.dataset.kind = gr.kind;
      h.textContent = gr.kind === 'maker' ? gr.label : T(gr.label);
      const hn = document.createElement('span');
      hn.className = 'n';
      hn.textContent = String(gr.entries.length);
      h.appendChild(hn);
      frag.appendChild(h);
    }
    const g = e.metaGame;
    const li = document.createElement('li');
    li.dataset.i = String(idx);
    li.dataset.id = String(e.rep.id);                 // il dump che si avvia con un clic (gli altri dump uguali sono in e.ids)
    if (app.entryIsCurrent(e)) li.className = 'cur';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g';
    b.dataset.act = 'play';
    const t = document.createElement('span');
    t.className = 't';
    if (e.sigla) {
      const sg = document.createElement('span');
      sg.className = 'sg';
      sg.textContent = e.sigla;
      t.appendChild(sg);
      t.appendChild(document.createTextNode(' — ' + e.title));
    } else t.textContent = e.title;
    if (e.count > 1) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = '×' + e.count;
      n.title = T('{n} file con lo stesso contenuto', {n: e.count});
      t.appendChild(n);
    }
    const m = document.createElement('span');
    m.className = 'm';
    const bits = [g.year, g.publisher, g.country, kb(e.rep.size)].filter(Boolean);
    m.textContent = bits.join(' · ');
    const warns = g.warn.map((w) => T(w)).concat(e.rep.map.ok ? [] : [T('non supportata ({kb} KB)', {kb: e.rep.map.banks * 2})]);
    if (warns.length) {
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = ' \u26A0 ' + warns.join(', ');
      m.appendChild(w);
    }
    if (g.flags.length) m.appendChild(document.createTextNode(' [' + g.flags.join('][') + ']'));
    b.title = e.games.map((x) => x.name + (x.folder ? ' · ' + x.folder : '')).slice(0, 12).join('\n') + (e.games.length > 12 ? '\n…' : '') + '\n' + T('clic: avvio a freddo');
    b.appendChild(t);
    b.appendChild(m);
    if (e.cat) b.appendChild(catalogLine(e));
    if (e.conflict) {                                    // il nome del file diceva un altro gioco: vale il contenuto (impronta SHA-1)
      const cf = document.createElement('span');
      cf.className = 'cf';
      cf.textContent = '\u26A0 ' + T('il nome del file dice {a}, ma il contenuto è {b}: vale il contenuto', {a: e.conflict.name, b: e.conflict.content});
      b.appendChild(cf);
    }
    if (e.others.length) {
      const a = document.createElement('span');
      a.className = 'a';
      a.textContent = T('anche:') + ' ' + e.others.slice(0, 4).join(' · ') + (e.others.length > 4 ? ' · …' : '');
      a.title = e.others.join('\n');
      b.appendChild(a);
    }
    if (pvOn) {
      const cv = document.createElement('canvas');
      cv.className = 'pv';
      cv.width = 80; cv.height = 54;
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', T('Anteprima di {name}', {name: e.label}));
      const res = app.previewFor(e);
      drawPreview(cv, res);
      cv.title = previewTitle(res);
      let l = ui.pvCanvases.get(e.rep.sha);
      if (!l) ui.pvCanvases.set(e.rep.sha, l = []);
      l.push(cv);
      li.appendChild(cv);
    }
    const cv = app.covers.count ? e.games.map((x) => app.covers.forGame(x)).find(Boolean) : null;
    if (cv) {
      const im = document.createElement('img');
      im.className = 'th'; im.alt = ''; im.decoding = 'async'; im.draggable = false; im.dataset.cover = String(cv.id);
      const u = thumbUrl(cv);
      if (u) im.src = u;
      li.appendChild(im);
    }
    li.appendChild(b);
    const stId = app.entryStateId(e);
    if (stId !== null) {
      const info = app.stateInfo(stId);
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 's mem';
      r.dataset.act = 'resume';
      r.textContent = '●';
      r.title = T('Riprendi la partita memorizzata') + (info.sameBios ? '' : ' (' + T('BIOS diverso: {name}', {name: info.biosName || T('non in elenco')}) + ')');
      r.setAttribute('aria-label', T('Riprendi la partita memorizzata di {name}', {name: e.title}));
      li.appendChild(r);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 's';
    x.dataset.act = 'remove';
    x.textContent = '×';
    x.title = e.count > 1 ? T('Togli dall’elenco tutti i {n} file di questa voce', {n: e.count}) : T('Togli dall’elenco');
    x.setAttribute('aria-label', T('Togli {name} dall’elenco', {name: e.title}));
    li.appendChild(x);
    frag.appendChild(li);
  });
  ul.appendChild(frag);
  setupObserver(ul);
  if (!ui.io) schedulePreviews();
  const total = app.lib.games.length, entries = app.entryCount();
  $('count').textContent = !total ? T('Nessun gioco nell’elenco.')
    : list.length === entries ? (entries < total ? T('{n} giochi nell’elenco ({m} file, i duplicati sono uniti)', {n: entries, m: total}) : T(total === 1 ? '{n} gioco nell’elenco' : '{n} giochi nell’elenco', {n: total})) + (app.states.size ? ' · ' + T('{n} con partita memorizzata (●)', {n: app.states.size}) : '')
      : T('{n} di {m} giochi', {n: list.length, m: entries}) + (list.length > MAX_ROWS ? ' ' + T('(mostrati i primi {n}: affina la ricerca)', {n: MAX_ROWS}) : '');
  $('b-merge').setAttribute('aria-pressed', app.mergeDuplicates ? 'true' : 'false');
  $('b-previews').setAttribute('aria-pressed', app.previews.enabled ? 'true' : 'false');
  $('b-auto').setAttribute('aria-pressed', app.autoMachine ? 'true' : 'false');
  $('order-sel').value = app.listOrder;
}

function renderKeys() {
  const tb = $('keytab').querySelector('tbody');
  tb.textContent = '';
  for (const a of I.ACTIONS) {
    const tr = document.createElement('tr');
    const th = document.createElement('td');
    th.className = 'k';
    th.textContent = T(ACTION_NAMES[a]);
    tr.appendChild(th);
    for (const p of ['1', '2']) {
      const td = document.createElement('td');
      td.appendChild(document.createTextNode(app.bindings[p][a].map((c) => T(I.codeLabel(c))).join(', ') || '—'));
      td.appendChild(document.createTextNode(' '));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'small cap';
      b.dataset.p = p;
      b.dataset.a = a;
      const on = ui.capture && ui.capture.p === p && ui.capture.a === a;
      if (on) b.classList.add('on');
      b.textContent = on ? T('Premi un tasto…') : T('Cambia');
      b.setAttribute('aria-label', T('Cambia il tasto: joystick {p}, {action}', {p, action: T(ACTION_NAMES[a])}));
      td.appendChild(b);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  $('cap-note').textContent = ui.capture ? T('Premi il tasto da associare (Esc per annullare).') : '';
}

function renderPads() {
  let pads = [];
  try { pads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []); } catch (e) { pads = []; }
  const key = pads.map((p) => (p && p.connected ? p.index + ':' + p.id : '-')).join('|') + '/' + app.padPrefs[1] + app.padPrefs[2] + I18N.getLang();
  if (key === ui.padKey) return;
  ui.padKey = key;
  for (const pl of [1, 2]) {
    const sel = $('pad' + pl);
    sel.textContent = '';
    const add = (v, txt) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; sel.appendChild(o); };
    add('auto', T('Automatico'));
    add('off', T('Nessuno'));
    pads.forEach((p, i) => { if (p && p.connected) add(String(i), (i + 1) + ': ' + String(p.id).slice(0, 40)); });
    sel.value = [...sel.options].some((o) => o.value === String(app.padPrefs[pl])) ? String(app.padPrefs[pl]) : 'auto';
  }
  const n = pads.filter((p) => p && p.connected).length;
  $('pad-info').textContent = n ? T(n === 1 ? '{n} gamepad collegato.' : '{n} gamepad collegati.', {n})
    : T('Nessun gamepad collegato.');
}

// Stato dei file necessari: BIOS, set di caratteri, giochi. Lo stesso stato sta sulla schermata di avvio e nel pannello (parole, non solo colori)
function needState(biosOk, charOk, gamesN) {
  const b = app.bios;
  const bios = biosOk ? {ok: true, text: b.display + ' (' + kb(b.size) + ')'}
    : app.lib.bios.length ? {ok: false, text: T('nessun BIOS utilizzabile: {reason}', {reason: T(app.lib.bios[0].reason || 'scegli un BIOS da 1024 byte')})}
      : {ok: false, text: T('nessun BIOS aggiunto')};
  const chars = charOk ? {ok: true, text: app.charsetName + ' · SHA-256 ' + app.charsetSha.slice(0, 12)}
    : {ok: false, gpl: true, text: T('GPL: in uso il set incluso, non identico all’originale: certi giochi risultano ingiocabili')};
  const games = gamesN ? {ok: true, text: T(gamesN === 1 ? '{n} gioco nell’elenco' : '{n} giochi nell’elenco', {n: gamesN})} : {ok: false, text: T('nessuno')};
  return {bios, char: chars, games};
}
function setNeed(el, st) {
  el.className = (el.className.replace(/\b(ok|miss)\b/g, '').trim() + ' ' + (st.ok ? 'ok' : 'miss')).trim();
  const badge = el.querySelector('.badge');
  badge.textContent = T(st.ok ? 'PRONTO' : st.gpl ? 'GPL' : 'MANCA');
  badge.className = 'badge ' + (st.ok ? 'ok' : 'miss');
}
function renderNeeds() {
  const n = needState(!!(app.bios && app.bios.supported), !!app.charset, app.lib.games.length);
  for (const [id, k] of [['s-bios', 'bios'], ['s-char', 'char'], ['s-games', 'games']]) {
    const li = $(id);
    setNeed(li, n[k]);
    li.querySelector('span:last-child').textContent = n[k].text;
  }
  // pannello: una riga di chip (parole, non solo colori); il dettaglio sta nel suggerimento
  const ng = app.lib.games.length;
  const word = {bios: T(n.bios.ok ? 'BIOS' : 'BIOS mancante'), char: T(n.char.ok ? 'Caratteri' : 'Caratteri GPL (provvisori)'), games: ng ? T(ng === 1 ? '{n} gioco' : '{n} giochi', {n: ng}) : T('Nessun gioco')};
  for (const [id, k] of [['c-bios', 'bios'], ['c-char', 'char'], ['c-games', 'games']]) {
    const li = $(id);
    setNeed(li, n[k]);
    li.querySelector('.txt').textContent = word[k];
    li.title = n[k].text;
  }
  setNeed($('n-char'), n.char);
}

// righe di stato dei due set di caratteri (anche dopo un ritocco a caldo dell'editor: cambia l'impronta, non l'elenco dei giochi)
function renderCharInfo() {
  $('char-info').textContent = app.charset ? T('In uso: {name} · SHA-256 {sha}.', {name: app.charsetName, sha: app.charsetSha.slice(0, 12)})
    : T('In uso il set GPL incluso (disegnato da zero), non identico all’originale.');
  $('efchar-info').textContent = app.efCharset ? T('In uso: {name} · SHA-256 {sha}.', {name: app.efCharsetName, sha: app.efCharsetSha.slice(0, 12)})
    : app.isG7400 ? T('In uso la ROM dei caratteri GPL inclusa (disegnata da zero), non identica a quella del chip.')
      : T('Non serve con il BIOS in uso.');
}

// (tappa 5) set di caratteri dell'EF9341 e pin B: servono solo al Videopac+ G7400
function renderEfChar() {
  const box = $('n-efchar'), g7400 = app.isG7400;
  const ok = !!app.efCharset || !g7400;
  setNeed(box, {ok});
  box.querySelector('.badge').textContent = T(app.efCharset ? 'PRONTO' : g7400 ? 'GPL' : 'NON SERVE');
  renderCharInfo();
  $('b-efchar-clear').disabled = !app.efCharset;
  $('pinb').value = app.settings.pinB;
  $('pinb-row').hidden = !g7400;
}

// (tappa 6a) modulo scacchi C7010: la ROM da 8 KB dello Z80 e l'avviso in vista se manca (c'e' la cartuccia da 2 KB ma non la ROM)
function renderChess() {
  const box = $('n-chess'), hasRom = !!app.chessRom;
  const anyChess = app.lib.games.some((g) => g.chess);
  setNeed(box, {ok: hasRom || !anyChess});
  box.querySelector('.badge').textContent = T(hasRom ? 'PRONTO' : anyChess ? 'MANCA' : 'NON SERVE');
  $('chess-info').textContent = hasRom ? T('In uso: {name} · SHA-256 {sha}.', {name: app.chessRomName, sha: app.chessRomSha.slice(0, 12)})
    : anyChess ? T('Manca: nell’elenco c’è la cartuccia del modulo scacchi C7010, che ha bisogno anche della ROM da 8 KB dello Z80.')
      : T('Non serve: nell’elenco non c’è la cartuccia del modulo scacchi.');
  $('b-chess-clear').disabled = !hasRom;
  const warn = $('chess-warn');
  warn.hidden = !(anyChess && !hasRom);
  if (!warn.hidden) $('chess-warn-text').textContent = T('Modulo scacchi C7010: manca la ROM da 8 KB dello Z80 (di solito z80_c7010.bin). Aggiungila con «Aggiungi file»: senza, la scacchiera non risponde.');
}

// aspetto (monitor B/N, filtri) e macchina: solo l'uscita; si ridisegna senza rifare l'elenco dei giochi (e' chiamata anche mentre si trascina un cursore)
function renderLook() {
  ui.lookRev = app.lookRev;
  const L = app.look, lk = JSON.stringify(L) + I18N.getLang();
  if (lk !== ui.lookKey) {
    ui.lookKey = lk;
    screen.setLook(L);
    for (const k of LOOK_SLIDERS) { $('look-' + k).value = String(L[k]); $('look-' + k + '-v').textContent = String(L[k]); }
    $('look-detail').value = String(L.detail);
    $('look-detail').disabled = !(L.scan || L.mask || L.curve);
    $('look-preset').value = Look.presetOf(L);
    renderPlateOpts();
    const pw = screen.pipe.outW, ph = screen.pipe.outH;
    $('look-info').textContent = T('Immagine di uscita: {w} \u00D7 {h} punti', {w: pw, h: ph}) + (screen.pipe.k > 1 ? ' ' + T('(righe, maschera e curvatura pesano di più sul computer: con 4 \u00D7 4 ancora di più)') : '') +
      '. ' + T('Spenti i filtri e con lo schermo a colori l’immagine è quella esatta del chip.');
  }
  renderMachine();
}

// la macchina: elenco con le voci senza BIOS in grigio, foto accanto (la foto e il disegno vengono dal codice o da file con licenza libera)
function renderMachine() {
  const sel = $('machine-sel');
  const ch = app.machineChoices();
  const m = app.machine;
  const mk = ch.map((c) => c.kind + (c.available ? '+' : '-')).join(',') + '|' + (m ? m.kind : '') + '|' + I18N.getLang();
  if (mk === ui.machineKey) return;
  ui.machineKey = mk;
  sel.textContent = '';
  if (!m) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = T(ch.some((c) => c.available) ? '(scegli la macchina)' : '(nessun BIOS: aggiungilo)');
    sel.appendChild(o);
  }
  for (const c of ch) {
    const o = document.createElement('option');
    o.value = c.kind;
    o.textContent = T(c.label) + (c.available ? '' : ' \u2014 ' + T('manca il BIOS'));
    o.disabled = !c.available;
    sel.appendChild(o);
  }
  sel.disabled = !ch.some((c) => c.available);
  sel.value = m ? m.kind : '';
  const cap = $('machine-cap');
  if (m) {
    const ph = Object.prototype.hasOwnProperty.call(PHOTOS, m.kind) ? PHOTOS[m.kind] : null;
    let credit = '';
    if (ph) {                                       // foto con licenza libera (crediti in «Informazioni e licenza»)
      for (const id of ['machine-img', 'splash-machine']) {
        const box = $(id), img = document.createElement('img');
        img.src = ph.src; img.alt = T(Machines.LABELS[m.kind]); img.decoding = 'async'; img.draggable = false;
        box.textContent = ''; box.appendChild(img);
      }
      credit = T(Photos.creditLine(ph));
    } else {
      const svg = Machines.machineSvg(m.kind);       // disegno generato dal codice (nessun testo dell'utente dentro)
      $('machine-img').innerHTML = svg;
      $('splash-machine').innerHTML = svg;
    }
    cap.textContent = credit;
  }
  cap.style.display = m && cap.textContent ? '' : 'none';
  $('machine').style.display = m ? '' : 'none';
  $('splash-machine').style.display = m ? '' : 'none';
  $('splash-mark').style.display = m ? 'none' : '';
}

// i tasti della piastra hanno l'etichetta in un elemento a parte (sotto, la scorciatoia)
function keyLabel(id, text) { $(id).querySelector('.kl').textContent = text; }
// sotto lo schermo: «Scambia comandi 1-2» (acceso = premuto) e lo stato scritto sul tasto «Filtri CRT»
const CRT_STATE = {esatto: 'spenti', leggero: 'leggeri', anni80: 'anni \u201980', custom: 'personalizzati'};
function renderPlateOpts() {
  const sw = $('b-swap');
  sw.setAttribute('aria-pressed', app.swapPads ? 'true' : 'false');
  sw.querySelector('.ks').textContent = T(app.swapPads ? 'scambiati' : 'normali');
  const name = Look.presetOf(app.look);
  const crt = $('b-crt');
  crt.querySelector('.ks').textContent = T(CRT_STATE[name]);          // il nome accessibile del tasto viene dal suo testo: «Filtri CRT» + lo stato
}

function renderAll() {
  ui.rev = app.rev;
  renderBios();
  renderNeeds();
  renderGames();
  renderCover();
  renderCovers();
  renderKeys();
  const running = app.running;
  $('splash').style.display = running ? 'none' : '';
  $('b-start').disabled = !(app.bios && app.bios.supported);
  keyLabel('b-start', T(running ? 'Riavvia' : 'Avvia'));
  $('b-reset').disabled = !running;
  $('b-pause').disabled = !running;
  keyLabel('b-pause', T(app.paused ? 'Riprendi' : 'Pausa'));
  $('b-memo').disabled = !running || app.gameId === null;
  $('b-save').disabled = !running;
  $('b-clearlib').disabled = !app.lib.games.length && !app.lib.bios.length;
  $('std').value = app.settings.standard;
  $('scale').value = String(app.settings.scale);
  $('aspect').value = app.settings.aspect;
  $('integer').checked = !!app.settings.integer;
  $('volume').value = String(Math.round(app.settings.volume * 100));
  $('muted').checked = !!app.settings.muted;
  $('b-char-clear').disabled = !app.charset;
  renderEfChar();
  renderChess();
  renderLook();
  renderPlateOpts();
  renderCharInfo();
  if (charui) charui.render();
  const g = app.game, b = app.bios;
  $('info').textContent = running ? T('BIOS: {name}', {name: b ? b.display : '?'}) + ' · ' + (g ? T('gioco: {name} ({size}, mappa {map})', {name: g.display, size: kb(g.size), map: g.map.kind}) : T('nessuna cartuccia')) +
    ' · ' + app.settings.standard : '';
  relayout();
  // comandi a tocco: quando un gioco parte, se schermo e comandi non si vedono tutti (telefono in orizzontale: la testata li spinge giu')
  // la pagina scorre fino a loro, una volta per avvio
  if (running && touch.on && !ui.playShown) {
    ui.playShown = true;
    const r = $('play').getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) $('play').scrollIntoView({block: 'start'});
  }
  if (!running) ui.playShown = false;
}

function relayout() {
  const st = $('stage');
  const full = document.fullscreenElement === st;                 // con i comandi a tocco lo schermo intero e' di #play: conta lo spazio di #stage
  const L = layoutSize(full ? window.innerWidth : st.clientWidth - 2, full ? window.innerHeight : st.clientHeight - 2, app.settings.scale, app.settings.aspect, app.settings.integer);
  const c = $('screen');
  c.style.width = L.w + 'px';
  c.style.height = L.h + 'px';
}

// ---------------------------------------------------------------- tastiera
function typingTarget(t) { return t && t.closest && t.closest('input, select, textarea, button'); }
function togglePause() {
  if (!app.running) return;
  app.setPaused(!app.paused);
  toast(app.paused ? 'Pausa' : 'Si riprende');
}
function doReset() {
  if (app.resetConsole()) toast('Reset console');
}
// sul computer va a schermo intero solo lo schermo; con i comandi a tocco anche croce, fuoco e tastiera (si gioca col telefono)
function fullTarget() { return touch.on ? $('play') : $('stage'); }
function toggleFull() {
  const st = fullTarget();
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  if (!st.requestFullscreen) { log('Lo schermo intero non e’ disponibile in questo browser.', 'warn'); return; }
  const p = st.requestFullscreen();
  if (p && p.catch) p.catch((e) => log('Schermo intero non riuscito: ' + e.message, 'warn'));
}

// ---------------------------------------------------------------- aiuto: i pulsanti «?» aprono e chiudono il riquadro .helpbox indicato da aria-controls (tutto nella pagina, nessuna finestra)
function toggleHelp(btn, force) {
  const box = document.getElementById(btn.getAttribute('aria-controls'));
  if (!box) return false;
  const open = force === undefined ? box.hidden : !!force;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  return open;
}
document.addEventListener('click', (ev) => {
  const b = ev.target && ev.target.closest ? ev.target.closest('button.help') : null;
  if (b) toggleHelp(b);
});
document.addEventListener('keydown', (ev) => {
  const b = ev.key === 'Escape' && ev.target && ev.target.closest ? ev.target.closest('button.help') : null;
  if (b && b.getAttribute('aria-expanded') === 'true') toggleHelp(b, false);
});

function endCapture() { ui.capture = null; renderKeys(); }
window.addEventListener('keydown', (e) => {
  if (ui.capture) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { endCapture(); return; }
    if (e.code === 'ShiftLeft' && false) return;
    if (RESERVED.test(e.code) || !/^[A-Za-z0-9]{1,24}$/.test(e.code)) { log(T('Questo tasto e’ riservato ({key}): scegline un altro.', {key: T(I.codeLabel(e.code))}), 'warn'); return; }
    try {
      const r = I.rebind(app.bindings, ui.capture.p, ui.capture.a, e.code);
      app.setBindings(r.bindings);
      log(T('Joystick {p}, {action}: {key}', {p: ui.capture.p, action: T(ACTION_NAMES[ui.capture.a]), key: T(I.codeLabel(e.code))}) +
        (r.stolen.length ? ' ' + T('(tolto da: {list})', {list: r.stolen.map((s) => T('joystick {p} {action}', {p: s.player, action: T(ACTION_NAMES[s.action])})).join(', ')}) : '') + '.', 'good');
    } catch (err) { log('Tasto non associato: ' + err.message, 'bad'); }
    ui.capture = null;
    renderKeys();
    return;
  }
  if (e.code === 'F8' || e.code === 'F9' || e.code === 'F10') {
    e.preventDefault();
    if (!e.repeat) { if (e.code === 'F8') togglePause(); else if (e.code === 'F9') doReset(); else toggleFull(); }
    return;
  }
  if (!app.running || typingTarget(e.target)) return;
  if (app.input.keyDown(e)) e.preventDefault();
}, true);
window.addEventListener('keyup', (e) => {
  if (app.input.keyUp(e) && app.running && !typingTarget(e.target)) e.preventDefault();
}, true);
window.addEventListener('blur', () => { app.input.releaseAll(); touchRelease(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { app.input.releaseAll(); touchRelease(); } });

// ---------------------------------------------------------------- tastiera a schermo
function buildVKeys() {
  if (ui.vkBuilt) return;
  ui.vkBuilt = true;
  const box = $('vkeys');
  for (const row of I.VKEYS) {
    const r = document.createElement('div');
    r.className = 'vr';
    for (const k of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = T(k.label);
      b.dataset.k = String(k.idx);
      b.tabIndex = -1;
      const up = () => { app.input.setVirtual(k.idx, false); b.classList.remove('dn'); };
      b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); if (b.setPointerCapture) b.setPointerCapture(ev.pointerId); app.input.setVirtual(k.idx, true); b.classList.add('dn'); unlockAudio(); });
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      r.appendChild(b);
    }
    box.appendChild(r);
  }
}

// ---------------------------------------------------------------- comandi a tocco (tappa 8): croce o stick che segue il dito, fuoco, tastiera
// La logica sta in touch.js (provata in Node); qui solo eventi pointer, posizione della croce e aspetto. Le due scelte (quando
// mostrarli, tipo di joystick) non si ricordano fra una visita e l'altra (niente localStorage).
const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
const touch = {pad: new TouchMod.TouchPad('cross'), mode: 'auto', on: false};
const FLOAT_RADIUS = 48;
function touchWanted() { return touch.mode === 'on' || (touch.mode === 'auto' && !!(coarse && coarse.matches)); }
function touchSync() {
  const b = touch.pad.bits();
  app.input.setTouch(b);
  for (const a of document.querySelectorAll('#tdir .arm')) a.classList.toggle('on', !!(b & Number(a.dataset.b)));
  $('tfire').classList.toggle('dn', !!(b & TouchMod.FIRE));
  const d = touch.pad.dir, el = $('tdir');
  el.classList.toggle('act', !!d);
  if (d && touch.pad.mode === 'float') {
    const r = el.getBoundingClientRect(), k = $('tknob');
    k.style.left = (d.cx - r.left) + 'px';
    k.style.top = (d.cy - r.top) + 'px';
    const dx = d.x - d.cx, dy = d.y - d.cy, len = Math.hypot(dx, dy), f = len > FLOAT_RADIUS ? FLOAT_RADIUS / len : 1;
    k.style.setProperty('--kx', (dx * f).toFixed(1) + 'px');
    k.style.setProperty('--ky', (dy * f).toFixed(1) + 'px');
  }
}
function touchRelease() { touch.pad.reset(); touchSync(); }
function applyTouch() {
  touch.on = touchWanted();
  document.body.classList.toggle('touch-on', touch.on);
  $('tdir').classList.toggle('float', touch.pad.mode === 'float');
  if (!touch.on) touchRelease();
  placeVk();
  relayout();
}
function touchGeometry() {
  const r = $('tdir').getBoundingClientRect();
  touch.pad.setGeometry(r.left + r.width / 2, r.top + r.height / 2, touch.pad.mode === 'float' ? FLOAT_RADIUS : Math.min(r.width, r.height) / 2);
}
function grab(el, ev) {
  ev.preventDefault();
  unlockAudio();
  try { if (el.setPointerCapture) el.setPointerCapture(ev.pointerId); } catch (e) { /* evento costruito a mano (prove): niente cattura */ }
}
$('tdir').addEventListener('pointerdown', (ev) => { grab($('tdir'), ev); touchGeometry(); touch.pad.dirDown(ev.pointerId, ev.clientX, ev.clientY); touchSync(); });
$('tdir').addEventListener('pointermove', (ev) => {
  if (!touch.pad.isDown(ev.pointerId)) return;
  ev.preventDefault();
  touch.pad.move(ev.pointerId, ev.clientX, ev.clientY);
  touchSync();
});
$('tfire').addEventListener('pointerdown', (ev) => { grab($('tfire'), ev); touch.pad.fireDown(ev.pointerId); touchSync(); });
for (const id of ['tdir', 'tfire']) {
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) $(id).addEventListener(t, (ev) => { touch.pad.up(ev.pointerId); touchSync(); });
  $(id).addEventListener('contextmenu', (ev) => ev.preventDefault());       // la pressione lunga di Android non apre il menu
}
$('tkb').addEventListener('click', () => {
  const c = $('vk');
  c.checked = !c.checked;
  c.dispatchEvent(new Event('change'));
  if (c.checked && !document.fullscreenElement) {                      // in orizzontale la tastiera va sotto lo schermo: la si porta in vista
    const r = $('vkeys').getBoundingClientRect();
    if (r.bottom > window.innerHeight) $('vkeys').scrollIntoView({block: 'nearest'});
  }
});
$('tmode').addEventListener('change', (ev) => { touch.mode = ev.target.value; applyTouch(); });
$('tstick').addEventListener('change', (ev) => { touch.pad.setMode(ev.target.value); touchSync(); applyTouch(); });
if (coarse && coarse.addEventListener) coarse.addEventListener('change', applyTouch);

// ---------------------------------------------------------------- comandi
async function handleFiles(files) {
  if (!files || !files.length) return;
  const list = [];
  for (const f of files) {
    try { list.push({name: f.name, bytes: await readFile(f)}); } catch (e) { log('Impossibile leggere ' + f.name + '.', 'bad'); }
  }
  if (!list.length) return;
  $('count').textContent = T('Importazione in corso…');
  try { await app.openFiles(list); } catch (e) { log('Errore: ' + e.message, 'bad'); }
  app.changed();
}

$('b-add').addEventListener('click', () => { $('f-files').value = ''; $('f-files').click(); });
$('f-files').addEventListener('change', (ev) => { handleFiles(Array.from(ev.target.files || [])); });
const drop = $('drop');
for (const n of ['dragenter', 'dragover']) window.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const n of ['dragleave', 'drop']) window.addEventListener(n, (e) => { e.preventDefault(); if (n === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); });
window.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) { $('d-games').open = true; handleFiles(Array.from(e.dataTransfer.files)); } });

$('b-covers-clear').addEventListener('click', () => {
  const b = $('b-covers-clear');
  if (!ui.covClearT) {
    b.textContent = T('Sicuro? Premi di nuovo');
    ui.covClearT = setTimeout(() => { ui.covClearT = 0; b.textContent = T('Svuota copertine'); }, 4000);
    return;
  }
  clearTimeout(ui.covClearT); ui.covClearT = 0; b.textContent = T('Svuota copertine');
  app.clearCovers();
  log('Copertine tolte dalla memoria.', '');
});

// rete su richiesta: nessuna richiesta parte senza questo clic; i suggerimenti riempiono solo il campo
$('net-go').addEventListener('click', async () => {
  $('net-status').textContent = '';
  try { await app.fetchUrl($('net-url').value, $('net-kind').value); } catch (e) { log('Errore: ' + e.message, 'bad'); }
});
$('net-url').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('net-go').click(); } });
$('net-cancel').addEventListener('click', () => { app.cancelFetch(); });
// set di caratteri da GitHub (O2EM): la rete parte solo da questi due clic
for (const [id, kind] of [['b-dl-vdc', 'vdc'], ['b-dl-ef', 'ef']]) {
  $(id).addEventListener('click', async () => {
    try { await app.fetchCharset(kind); } catch (e) { log('Errore: ' + e.message, 'bad'); }
    app.changed();
  });
}

$('bios-sel').addEventListener('change', (ev) => {
  const id = Number(ev.target.value);
  unlockAudio();
  if (!app.selectBios(id)) renderAll();
});
$('q').addEventListener('input', renderGames);
$('folder').addEventListener('change', renderGames);
$('games').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  const li = ev.target.closest('li');
  if (!btn || !li) return;
  const e = ui.rows[Number(li.dataset.i)];
  if (!e) return;
  unlockAudio();
  if (btn.dataset.act === 'play') { if (app.startEntry(e)) focusScreen(); }
  else if (btn.dataset.act === 'resume') { if (app.resumeEntry(e)) focusScreen(); }
  else if (btn.dataset.act === 'remove') app.removeEntry(e);
});
$('b-merge').addEventListener('click', () => { app.setMerge(!app.mergeDuplicates); });
$('b-previews').addEventListener('click', () => { app.setPreviews(!app.previews.enabled); });
$('b-auto').addEventListener('click', () => { app.setAutoMachine(!app.autoMachine); });
$('order-sel').addEventListener('change', (ev) => { app.setListOrder(ev.target.value); });
$('b-clearlib').addEventListener('click', () => {
  const b = $('b-clearlib');
  if (!ui.clearT) {
    b.textContent = T('Sicuro? Premi di nuovo');
    ui.clearT = setTimeout(() => { ui.clearT = 0; b.textContent = T('Svuota elenco'); }, 4000);
    return;
  }
  clearTimeout(ui.clearT); ui.clearT = 0; b.textContent = T('Svuota elenco');
  app.clearLibrary();
  log('Elenco svuotato.', '');
});
$('b-start').addEventListener('click', () => {
  unlockAudio();
  if (app.start(app.gameId)) focusScreen();
});
$('b-reset').addEventListener('click', () => { doReset(); focusScreen(); });
$('b-pause').addEventListener('click', () => { togglePause(); focusScreen(); });
$('b-memo').addEventListener('click', () => {
  if (app.memorize(false)) log('Stato di «' + app.game.display + '» memorizzato nella sessione (\u25CF nell’elenco). Per tenerlo, salva la sessione.', 'good');
  focusScreen();
});
$('b-swap').addEventListener('click', () => { app.setSwapPads(!app.swapPads); renderPlateOpts(); focusScreen(); });
$('b-crt').addEventListener('click', () => { app.cycleLook(); renderLook(); focusScreen(); });
$('b-full').addEventListener('click', toggleFull);
if (!$('stage').requestFullscreen) $('b-full').style.display = 'none';
// con i comandi a tocco (e a schermo intero di #play) la tastiera della console sta dentro #play, subito sotto croce e fuoco: sul
// telefono si vede senza scorrere la pagina; altrimenti torna al suo posto in fondo alla colonna (computer: come prima)
const vkHome = $('vkeys').parentNode;
function placeVk() {
  const inPlay = touch.on || document.fullscreenElement === $('play'), vk = $('vkeys');
  if (inPlay && vk.parentNode !== $('play')) $('play').appendChild(vk);
  else if (!inPlay && vk.parentNode !== vkHome) vkHome.appendChild(vk);
}
document.addEventListener('fullscreenchange', () => {
  placeVk();
  relayout();
  if (document.fullscreenElement) focusScreen();
});
window.addEventListener('resize', relayout);
if (window.ResizeObserver) new ResizeObserver(relayout).observe($('stage'));

$('b-save').addEventListener('click', () => {
  const f = app.saveStateFile();
  if (!f) return;
  download(f.name, f.bytes, 'application/json');
  log('Stato salvato (' + f.bytes.length + ' byte). Contiene solo lo stato della macchina e le impronte dei file, non i file.', 'good');
});
$('b-sess-save').addEventListener('click', () => {
  try {
    const bytes = app.saveSession();
    download('o2web-sessione-' + stamp() + '.zip', bytes, 'application/zip');
    log(T('Sessione salvata ({kb} KB). ', {kb: Math.round(bytes.length / 1024)}) + T(S.WARNING), 'warn');
  } catch (e) { log('Sessione non salvata: ' + e.message, 'bad'); }
});

$('std').addEventListener('change', (ev) => { unlockAudio(); app.setStandard(ev.target.value); });
$('scale').addEventListener('change', (ev) => { app.settings.scale = Number(ev.target.value); relayout(); });
$('aspect').addEventListener('change', (ev) => { app.settings.aspect = ev.target.value; relayout(); });
$('integer').addEventListener('change', (ev) => { app.settings.integer = ev.target.checked; relayout(); });
$('volume').addEventListener('input', (ev) => { app.setVolume(Number(ev.target.value) / 100); });
$('muted').addEventListener('change', (ev) => { app.setMuted(ev.target.checked); });
for (const k of LOOK_SLIDERS) {
  $('look-' + k).addEventListener('input', (ev) => { app.setLook({[k]: Number(ev.target.value)}); renderLook(); });
}
$('look-detail').addEventListener('change', (ev) => { app.setLook({detail: Number(ev.target.value)}); renderLook(); });
$('look-preset').addEventListener('change', (ev) => {
  if (ev.target.value === 'custom') { ev.target.value = Look.presetOf(app.look); return; }     // «Personalizzato» non e' un insieme: si ottiene muovendo un cursore
  app.setLook(Look.PRESETS[ev.target.value]);
  renderLook();
});
$('machine-sel').addEventListener('change', (ev) => { unlockAudio(); if (!app.selectMachine(ev.target.value)) { ui.machineKey = null; renderAll(); } });
$('b-efchar-clear').addEventListener('click', () => { app.clearEfCharset(); });
$('b-chess-clear').addEventListener('click', () => { app.clearChessRom(); });
$('pinb').addEventListener('change', (ev) => { app.setPinB(ev.target.value); });
$('b-char-clear').addEventListener('click', () => {
  const running = app.running;
  app.clearCharset();
  if (!running) log('Set di caratteri di ripiego: vale dal prossimo avvio.', '');
});

$('keytab').addEventListener('click', (ev) => {
  const b = ev.target.closest('button.cap');
  if (!b) return;
  if (ui.capture && ui.capture.p === b.dataset.p && ui.capture.a === b.dataset.a) { endCapture(); return; }
  ui.capture = {p: b.dataset.p, a: b.dataset.a};
  renderKeys();
});
for (const name of ['tastierino', 'portatile']) {
  $('p-' + name).addEventListener('click', () => {
    app.setBindings(I.cloneBindings(I.PRESETS[name]));
    log(name === 'tastierino' ? 'Joystick 2 sul tastierino numerico (8-4-5-6, 0 = fuoco).' : 'Joystick 2 sui tasti I J K L e punto e virgola (fuoco): quelle lettere non sono piu’ tasti della console.', 'good');
  });
}
for (const pl of [1, 2]) {
  $('pad' + pl).addEventListener('change', (ev) => { app.padPrefs[pl] = ev.target.value; ui.padKey = ''; });
}
window.addEventListener('gamepadconnected', () => { ui.padKey = ''; });
window.addEventListener('gamepaddisconnected', () => { ui.padKey = ''; });
$('vk').addEventListener('change', (ev) => { buildVKeys(); $('vkeys').classList.toggle('on', ev.target.checked); $('tkb').setAttribute('aria-pressed', ev.target.checked ? 'true' : 'false'); });
$('stage').addEventListener('click', focusScreen);
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

// ---------------------------------------------------------------- ciclo
// misure per capire la velocita' sui telefoni (tappa 8): quante volte al secondo il browser chiama la pagina (ridisegni), quante volte
// l'audio e' rimasto senza dati, frequenza e ritardo dichiarati dall'audio del browser. Solo lettura: non cambiano l'emulazione.
function timingInfo(dt) {
  const per = (v) => (dt > 0 ? (v * 1000 / dt).toFixed(1) : '0');
  let s = T('ridisegni: {raf}/s', {raf: per(ui.statRaf)});
  const c = sink.ctx;
  if (c) {
    const lat = typeof c.outputLatency === 'number' && c.outputLatency > 0 ? c.outputLatency : typeof c.baseLatency === 'number' ? c.baseLatency : NaN;
    s += ' · ' + T('audio a vuoto: {n}/s · audio {rate} Hz, ritardo {lat} ms', {n: per(sink.underruns - ui.statUnder), rate: c.sampleRate, lat: Number.isFinite(lat) ? Math.round(lat * 1000) : '?'});
  }
  return s;
}
function tick(ts) {
  requestAnimationFrame(tick);
  let pads = [];
  try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
  app.pollPads(pads);
  let n = 0;
  try { n = app.step(ts); } catch (e) {
    app.setPaused(true);
    log('Errore dell’emulazione: ' + e.message + ' (emulazione in pausa).', 'bad');
  }
  if (app.con !== ui.con) { ui.con = app.con; screen.resetLook(); }                // macchina nuova: la persistenza non porta con se' l'immagine di prima
  if (app.lookRev !== ui.lookRev) renderLook();
  if (n && app.con) { screen.paint(app.con.fb); ui.statFrames += n; }
  ui.statRaf++;
  if (app.rev !== ui.rev) renderAll();
  else if (charui && app.charRev !== ui.charRev) { ui.charRev = app.charRev; renderCharInfo(); charui.poll(); }
  if (ts - ui.statT >= 500) {
    const s = app.takeStats();
    renderPads();
    $('stats').textContent = app.running ? (s ? T('emulazione: {ms} ms per fotogramma · {fps} fotogrammi/s', {ms: s.avg.toFixed(2), fps: (ui.statFrames * 1000 / (ts - ui.statT)).toFixed(1)}) : '') +
      (app.running ? ' · ' + T(app.audioPaced ? 'passo guidato dall’audio' : sink.available ? 'audio non attivo (tocca la pagina)' : 'senza audio') : '') +
      (app.running ? ' · ' + timingInfo(ts - ui.statT) : '') : '';
    ui.statFrames = 0;
    ui.statRaf = 0;
    ui.statUnder = sink.underruns;
    ui.statT = ts;
  }
}

screen = new Screen($('screen'));

// crediti delle foto delle macchine (autore, licenza, fonte, modifiche): ogni foto ha la propria licenza, diversa dalla GPL del codice
function renderPhotoCredits() {
  const box = $('photo-credits'), kinds = Machines.KINDS.filter((k) => Object.prototype.hasOwnProperty.call(PHOTOS, k));
  box.textContent = '';
  if (!kinds.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  const h = document.createElement('p');
  h.innerHTML = '<b>' + T('Foto delle macchine.') + '</b> ' + T('Non fanno parte del codice e') + ' <b>' + T('non sono coperte dalla GPL') + '</b>: ' + T('ognuna ha la propria licenza libera, elencata qui con autore e modifiche fatte.');
  box.appendChild(h);
  const ul = document.createElement('ul');
  const link = (parent, text, href) => {
    if (!href) return;
    parent.appendChild(document.createTextNode(' '));
    const a = document.createElement('a');
    a.href = href; a.textContent = text; a.target = '_blank'; a.rel = 'noopener noreferrer';
    parent.appendChild(a);
  };
  for (const k of kinds) {
    const e = PHOTOS[k], li = document.createElement('li');
    li.appendChild(document.createTextNode(T(Machines.LABELS[k]) + ' \u2014 ' + T('\u00AB{t}\u00BB', {t: T(e.title)}) + '. ' + T(Photos.creditLine(e)) + '. ' + T('Modifiche: {c}.', {c: T(e.changes)})));
    link(li, T('[licenza]'), e.licenceUrl || (Photos.FREE_LICENCES[e.licence] && Photos.FREE_LICENCES[e.licence].url));
    link(li, T('[fonte]'), e.sourceUrl);
    ul.appendChild(li);
  }
  box.appendChild(ul);
  if (kinds.some((k) => Photos.needsReview(PHOTOS[k]))) {
    const w = document.createElement('p');
    w.className = 'dim';
    w.textContent = T('Alcuni crediti sono ancora da completare o da verificare (autore, licenza, fonte): vedi web/photos/CREDITS.json nei sorgenti.');
    box.appendChild(w);
  }
}
renderPhotoCredits();

// lingua: le bandiere in alto a destra. Si rifanno anche le parti che scrive questo modulo (elenchi, tasti, crediti) e quelle dell'editor dei caratteri.
function applyLang(l, fromUser) {
  I18N.setLang(l);
  document.documentElement.lang = l;
  I18N.translateDom(document);
  for (const b of document.querySelectorAll('#langs button')) b.setAttribute('aria-pressed', b.dataset.lang === l ? 'true' : 'false');
  ui.foldersKey = null; ui.machineKey = null; ui.lookKey = ''; ui.padKey = '';
  if (ui.vkBuilt) { ui.vkBuilt = false; $('vkeys').textContent = ''; buildVKeys(); }
  renderPhotoCredits();
  renderAll();
  renderPads();
  renderNet();
  if (fromUser) {
    try {
      const u = new URL(location.href);
      u.searchParams.set('lang', l);
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* file:// o altro: l'indirizzo non cambia, la lingua si', */ }
  }
}
for (const b of document.querySelectorAll('#langs button')) b.addEventListener('click', () => { if (b.dataset.lang !== I18N.getLang()) applyLang(b.dataset.lang, true); });

applyTouch();
renderAll();
renderNet();
renderPads();
requestAnimationFrame(tick);

// set di caratteri originali da GitHub all'apertura (richiesta dell'utente, 15/10/2026): si salta aggiungendo «?offline» all'indirizzo della pagina (nessuna richiesta di rete)
const AUTO_CHARSETS = !/(^|[?&#])offline(\b|=)/i.test(String(location.search || '') + String(location.hash || ''));
if (AUTO_CHARSETS) {
  app.autoLoadCharsets().catch((e) => log('Caricamento dei set di caratteri non riuscito: ' + e.message, 'warn')).then(() => { app.changed(); });
}

// per le prove nel browser (screenshot, controlli): niente di cio' esce dalla pagina
charui = CharUI.init({$, app, log, readFile, download});
applyLang(I18N.getLang(), false);
window.o2web = {app, ui, sink, screen, renderAll, renderLook, relayout, charui, toggleHelp, AUTO_CHARSETS, applyLang, I18N, touch, applyTouch, fullTarget};
