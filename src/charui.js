'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// charui.js - il pannello «Editor dei caratteri» della pagina: griglia dei caratteri, editor a pixel, strumenti (azzera, inverti, sposta, ribalta,
// copia / incolla, annulla / ripeti), testo ASCII del carattere, salvataggio .bin, apertura di .bin / zip / sorgenti C, ritorno al set GPL.
// Solo DOM: la logica sta in charedit.js (provata in Node) e le modifiche passano da app.replace*Live (a caldo: la partita non riparte).
// Nessuna rete, nessun localStorage: il set modificato resta nella pagina finche' non lo salvi (o non salvi la sessione).
const E = require('./charedit.js');
const {t: T} = require('./i18n.js');
const {sha256} = require('./sha256.js');

const SEL_COLORS = {on: '#e8edf5', off: '#161b26', grid: '#2a3040', sel: '#58a6ff', warn: '#e3a008'};
const UNDO_MAX = 300;
// tasti (e quindi celle) del chip video: le prime 40 celle sono cifre e lettere nell'ordine della tastiera della console (DA VERIFICARE su una copia vera);
// le altre sono segni e simboli dei giochi
const VDC_LABELS = '0123456789:@ ?LP+WERTUIOQSDFGHJKAZXCVBM.';

function init(env) {
  const {$, app, log, readFile, download} = env;
  const ed = {
    kind: 'vdc', sel: 0, cx: 0, cy: 0, data: {vdc: null, ef: null}, sha: {vdc: '', ef: ''}, undo: {vdc: [], ef: []}, redo: {vdc: [], ef: []},
    clip: null, paint: null, charRev: -1, asciiDirty: false,
  };
  const grid = $('ce-grid'), pix = $('ce-pix'), gctx = grid.getContext('2d'), pctx = pix.getContext('2d');

  const K = () => E.KINDS[ed.kind];
  const cur = () => ed.data[ed.kind];
  const available = () => !!cur();

  function nameFor(kind) {
    const base = (kind === 'vdc' ? app.charsetName : app.efCharsetName) || 'O2web GPL';
    return /\(modificato\)$/.test(base) ? base : base + ' (modificato)';
  }
  function push() {                                             // dopo ogni modifica: il set nuovo va alla console (a caldo)
    const d = cur();
    if (ed.kind === 'vdc') app.replaceCharsetLive(d, nameFor('vdc')); else app.replaceEfCharsetLive(d, nameFor('ef'));
    ed.sha[ed.kind] = sha256(d);
    ed.charRev = app.charRev;
  }

  // il set in uso puo' cambiare da fuori (file scelto, ritorno al GPL, sessione): allora si riparte da quello e si azzerano annulla / ripeti
  function syncFromApp() {
    for (const kind of ['vdc', 'ef']) {
      const src = kind === 'vdc' ? app.activeCharset : app.activeEfCharset;
      if (!src) { ed.data[kind] = null; ed.sha[kind] = ''; continue; }
      const h = sha256(src);
      if (!ed.data[kind] || h !== ed.sha[kind]) {
        ed.data[kind] = Uint8Array.from(src);
        ed.sha[kind] = h;
        ed.undo[kind].length = 0; ed.redo[kind].length = 0;
      }
    }
  }

  // ---------------------------------------------------------------- disegno
  function cellGeom() {
    const k = K();
    if (ed.kind === 'vdc') return {s: 3, cols: 8, cw: 8 * 3 + 2, ch: k.h * 3 + 2};
    return {s: 2, cols: 16, cw: 8 * 2 + 2, ch: k.h * 2 + 2};
  }
  function drawGrid() {
    const k = K(), g = cellGeom(), d = cur();
    const rows = Math.ceil(k.glyphs / g.cols);
    if (grid.width !== g.cols * g.cw || grid.height !== rows * g.ch) { grid.width = g.cols * g.cw; grid.height = rows * g.ch; }
    gctx.fillStyle = SEL_COLORS.grid;
    gctx.fillRect(0, 0, grid.width, grid.height);
    if (!d) return;
    for (let i = 0; i < k.glyphs; i++) {
      const x0 = (i % g.cols) * g.cw, y0 = Math.floor(i / g.cols) * g.ch;
      gctx.fillStyle = SEL_COLORS.off;
      gctx.fillRect(x0 + 1, y0 + 1, 8 * g.s, k.h * g.s);
      gctx.fillStyle = SEL_COLORS.on;
      for (let y = 0; y < k.h; y++) {
        const b = d[i * k.h + y];
        for (let x = 0; x < 8; x++) if ((k.msbLeft ? b >> (7 - x) : b >> x) & 1) gctx.fillRect(x0 + 1 + x * g.s, y0 + 1 + y * g.s, g.s, g.s);
      }
    }
    const sx = (ed.sel % g.cols) * g.cw, sy = Math.floor(ed.sel / g.cols) * g.ch;
    gctx.strokeStyle = SEL_COLORS.sel;
    gctx.lineWidth = 2;
    gctx.strokeRect(sx + 1, sy + 1, g.cw - 2, g.ch - 2);
  }
  const PS = 22;
  function drawPix() {
    const k = K(), d = cur();
    if (pix.width !== 8 * PS || pix.height !== k.h * PS) { pix.width = 8 * PS; pix.height = k.h * PS; }
    pctx.fillStyle = SEL_COLORS.off;
    pctx.fillRect(0, 0, pix.width, pix.height);
    if (!d) return;
    for (let y = 0; y < k.h; y++) for (let x = 0; x < 8; x++) {
      if (E.getPixel(ed.kind, d, ed.sel, x, y)) {
        pctx.fillStyle = SEL_COLORS.on;
        pctx.fillRect(x * PS + 1, y * PS + 1, PS - 1, PS - 1);
      } else {
        pctx.fillStyle = '#20263a';
        pctx.fillRect(x * PS + 1, y * PS + 1, PS - 1, PS - 1);
      }
    }
    pctx.strokeStyle = SEL_COLORS.sel;
    pctx.lineWidth = 2;
    pctx.strokeRect(ed.cx * PS + 2, ed.cy * PS + 2, PS - 3, PS - 3);
  }
  function labelFor() {
    const i = ed.sel;
    if (ed.kind === 'vdc') {
      let t = T('Cella {i} di 64', {i});
      if (i < VDC_LABELS.length) t += ' · ' + (VDC_LABELS[i] === '@' ? T('omino') : VDC_LABELS[i] === ' ' ? T('spazio') : T('«{c}»', {c: VDC_LABELS[i]}));
      else if (i < 48) t += ' · ' + T('segno o lettera della tastiera (ordine da verificare)');
      else t += ' · ' + T('simbolo speciale dei giochi (cambia da gioco a gioco)');
      return t;
    }
    const code = i & 0x7F, hex = '0x' + (code < 16 ? '0' : '') + code.toString(16).toUpperCase();
    if (i < 128) return T('Voce {i} · alfanumerica, codice {hex}', {i, hex}) + (code > 0x20 && code < 0x7F ? ' · ' + T('«{c}»', {c: String.fromCharCode(code)}) : '');
    return T('Voce {i} · semigrafica (gamma), codice {hex}', {i, hex}) + (code >= 0x40 ? ' · ' + T('mosaico unito') : ' · ' + T('mosaico separato'));
  }
  function renderInfo() {
    const d = cur();
    const kindName = T(K().name);
    if (!d) { $('ce-info').textContent = T('Il set di caratteri {kind} non e’ disponibile in questa pagina.', {kind: kindName}); return; }
    const id = E.identify(d);
    const src = ed.kind === 'vdc' ? app.charset : app.efCharset, nm = ed.kind === 'vdc' ? app.charsetName : app.efCharsetName;
    let t = T('In uso: {what}', {what: src ? nm : T('set GPL O2web (incluso nella pagina, disegnato da zero)')}) + ' · SHA-256 ' + ed.sha[ed.kind].slice(0, 12) + ' · CRC-32 ' + (id ? id.crc.toString(16).padStart(8, '0') : '?');
    if (id && id.label) t += ' · ' + T('set riconosciuto: {label}.', {label: T(id.label)});
    $('ce-info').textContent = t;
    $('ce-undo').disabled = !ed.undo[ed.kind].length;
    $('ce-redo').disabled = !ed.redo[ed.kind].length;
    $('ce-paste').disabled = !(ed.clip && ed.clip.kind === ed.kind);
    $('ce-revert').disabled = !src;
  }
  function renderAscii() {
    const d = cur();
    const ta = $('ce-ascii');
    if (!d) { ta.value = ''; return; }
    ta.value = E.glyphToAscii(E.getGlyph(ed.kind, d, ed.sel));
    ta.rows = K().h + 1;
    ed.asciiDirty = false;
  }
  function renderAll() {
    $('ce-k-vdc').setAttribute('aria-pressed', ed.kind === 'vdc' ? 'true' : 'false');
    $('ce-k-ef').setAttribute('aria-pressed', ed.kind === 'ef' ? 'true' : 'false');
    drawGrid();
    drawPix();
    $('ce-sel').textContent = labelFor();
    renderInfo();
    if (!ed.asciiDirty || document.activeElement !== $('ce-ascii')) renderAscii();
    const fb = $('ce-dl');
    fb.textContent = T(ed.kind === 'vdc' ? 'Scarica il set del chip video da O2EM (GitHub)' : 'Scarica la ROM EF9341 da O2EM (GitHub)');
    fb.disabled = !!app.net.busy;
    for (const id of ['ce-clear', 'ce-inv', 'ce-l', 'ce-r', 'ce-u', 'ce-d', 'ce-fh', 'ce-fv', 'ce-copy', 'ce-save', 'ce-ascii-apply']) $(id).disabled = !available();
  }

  // ---------------------------------------------------------------- modifiche
  function beginEdit() {                                        // salva il carattere com'e' prima di toccarlo (un passo di annullamento)
    const d = cur(), st = ed.undo[ed.kind];
    st.push({g: ed.sel, rows: E.getGlyph(ed.kind, d, ed.sel)});
    if (st.length > UNDO_MAX) st.shift();
    ed.redo[ed.kind].length = 0;
  }
  function applyRows(rows) {
    beginEdit();
    E.setGlyph(ed.kind, cur(), ed.sel, rows);
    push();
    renderAll();
  }
  function step(from, to) {                                     // annulla / ripeti: scambia il carattere con quello in cima alla pila
    const a = ed.undo[ed.kind], b = ed.redo[ed.kind];
    const src = from === 'undo' ? a : b, dst = from === 'undo' ? b : a;
    if (!src.length) return;
    const it = src.pop();
    dst.push({g: it.g, rows: E.getGlyph(ed.kind, cur(), it.g)});
    E.setGlyph(ed.kind, cur(), it.g, it.rows);
    ed.sel = it.g;
    push();
    renderAll();
  }
  const op = (f) => () => { if (available()) applyRows(f(E.getGlyph(ed.kind, cur(), ed.sel))); };
  $('ce-clear').addEventListener('click', op((r) => r.map(() => '........')));
  $('ce-inv').addEventListener('click', op((r) => r.map((x) => x.replace(/[#.]/g, (c) => (c === '#' ? '.' : '#')))));
  $('ce-l').addEventListener('click', op((r) => E.shiftGlyph(r, -1, 0, $('ce-wrap').checked)));
  $('ce-r').addEventListener('click', op((r) => E.shiftGlyph(r, 1, 0, $('ce-wrap').checked)));
  $('ce-u').addEventListener('click', op((r) => E.shiftGlyph(r, 0, -1, $('ce-wrap').checked)));
  $('ce-d').addEventListener('click', op((r) => E.shiftGlyph(r, 0, 1, $('ce-wrap').checked)));
  $('ce-fh').addEventListener('click', op(E.flipH));
  $('ce-fv').addEventListener('click', op(E.flipV));
  $('ce-copy').addEventListener('click', () => { if (available()) { ed.clip = {kind: ed.kind, rows: E.getGlyph(ed.kind, cur(), ed.sel)}; renderInfo(); } });
  $('ce-paste').addEventListener('click', () => { if (available() && ed.clip && ed.clip.kind === ed.kind) applyRows(ed.clip.rows.slice()); });
  $('ce-undo').addEventListener('click', () => step('undo'));
  $('ce-redo').addEventListener('click', () => step('redo'));
  $('ce-ascii').addEventListener('input', () => { ed.asciiDirty = true; });
  $('ce-ascii-apply').addEventListener('click', () => {
    if (!available()) return;
    try { const rows = E.glyphFromAscii($('ce-ascii').value, K().h); ed.asciiDirty = false; applyRows(rows); } catch (e) { log(T('Testo del carattere non valido: {m}.', {m: T(e.message)}), 'warn'); }
  });

  // ---------------------------------------------------------------- selezione e pixel
  function selectGlyph(i) {
    const n = K().glyphs;
    ed.sel = Math.max(0, Math.min(n - 1, i));
    renderAll();
  }
  grid.addEventListener('pointerdown', (ev) => {
    const r = grid.getBoundingClientRect(), g = cellGeom();
    const x = Math.floor((ev.clientX - r.left) * grid.width / r.width / g.cw), y = Math.floor((ev.clientY - r.top) * grid.height / r.height / g.ch);
    const i = y * g.cols + x;
    if (x >= 0 && x < g.cols && i >= 0 && i < K().glyphs) selectGlyph(i);
    grid.focus();
  });
  grid.addEventListener('keydown', (ev) => {
    const g = cellGeom(), n = K().glyphs;
    const m = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -g.cols, ArrowDown: g.cols, PageUp: -g.cols * 4, PageDown: g.cols * 4};
    if (ev.key in m) { selectGlyph(ed.sel + m[ev.key]); ev.preventDefault(); }
    else if (ev.key === 'Home') { selectGlyph(0); ev.preventDefault(); }
    else if (ev.key === 'End') { selectGlyph(n - 1); ev.preventDefault(); }
  });
  function pixAt(ev) {
    const r = pix.getBoundingClientRect(), k = K();
    const x = Math.floor((ev.clientX - r.left) * pix.width / r.width / PS), y = Math.floor((ev.clientY - r.top) * pix.height / r.height / PS);
    return x >= 0 && x < 8 && y >= 0 && y < k.h ? {x, y} : null;
  }
  function paintAt(p) {
    if (!p || !ed.paint) return;
    ed.cx = p.x; ed.cy = p.y;
    if (E.getPixel(ed.kind, cur(), ed.sel, p.x, p.y) === ed.paint.on) { drawPix(); return; }
    if (!ed.paint.begun) { beginEdit(); ed.paint.begun = true; }
    E.setPixel(ed.kind, cur(), ed.sel, p.x, p.y, ed.paint.on);
    push();
    drawPix(); drawGrid(); renderInfo(); renderAscii();
  }
  pix.addEventListener('pointerdown', (ev) => {
    if (!available()) return;
    const p = pixAt(ev);
    if (!p) return;
    ev.preventDefault();
    pix.focus();
    const on = ev.shiftKey || ev.button === 2 ? false : !E.getPixel(ed.kind, cur(), ed.sel, p.x, p.y);
    ed.paint = {on, begun: false};
    try { pix.setPointerCapture(ev.pointerId); } catch (e) { /* senza cattura il tratto si ferma uscendo dal disegno */ }
    paintAt(p);
  });
  pix.addEventListener('pointermove', (ev) => { if (ed.paint) paintAt(pixAt(ev)); });
  const endPaint = () => { ed.paint = null; renderAll(); };
  pix.addEventListener('pointerup', endPaint);
  pix.addEventListener('pointercancel', endPaint);
  pix.addEventListener('contextmenu', (ev) => ev.preventDefault());
  pix.addEventListener('keydown', (ev) => {
    const h = K().h;
    const mv = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[ev.key];
    if (mv) {
      ed.cx = Math.max(0, Math.min(7, ed.cx + mv[0])); ed.cy = Math.max(0, Math.min(h - 1, ed.cy + mv[1]));
      drawPix(); ev.preventDefault();
    } else if ((ev.key === ' ' || ev.key === 'Enter') && available()) {
      beginEdit();
      E.setPixel(ed.kind, cur(), ed.sel, ed.cx, ed.cy, !E.getPixel(ed.kind, cur(), ed.sel, ed.cx, ed.cy));
      push(); renderAll(); ev.preventDefault();
    }
  });

  // ---------------------------------------------------------------- tipo di set, salva, apri, ritorno al GPL
  function setKind(kind) {
    ed.kind = kind; ed.sel = 0; ed.cx = 0; ed.cy = 0; ed.paint = null;
    renderAll();
  }
  $('ce-k-vdc').addEventListener('click', () => setKind('vdc'));
  $('ce-k-ef').addEventListener('click', () => setKind('ef'));
  $('ce-save').addEventListener('click', () => {
    if (!available()) return;
    const name = ed.kind === 'vdc' ? 'o2web-charset-chip-video.bin' : 'o2web-charset-ef9341.bin';
    download(name, cur().slice(), 'application/octet-stream');
    log(T('Salvato {name} ({n} byte). ', {name, n: cur().length}) + T('Per riusarlo: aggiungilo con «Aggiungi file» in «Macchina e giochi» (o trascinalo sulla pagina).') +
      ' ' + T('Se parti da un set originale, il file resta personale: non condividerlo.'), 'good');
  });
  function importBytes(fname, bytes) {
    const r = E.findSetInFile(bytes, ed.kind);
    if (!r) {
      log(fname + ': ' + T('non ho trovato un set di caratteri (serve un file di 512 o 2560 byte, uno zip che lo contenga, oppure un sorgente C con la tabella di 512 valori).'), 'warn');
      return false;
    }
    const nm = (r.from ? r.from.split(' > ').pop() : fname).replace(/^.*\//, '');
    if (r.kind === 'vdc') app.replaceCharsetLive(r.data, nm); else app.replaceEfCharsetLive(r.data, nm);
    if (r.kind !== ed.kind) { ed.kind = r.kind; ed.sel = 0; }
    syncFromApp();
    const id = E.identify(r.data);
    log(T('Set di caratteri {kind} letto da {src} ({note})', {kind: T(E.KINDS[r.kind].name), src: r.from ? r.from + ' (' + T('in {file}', {file: fname}) + ')' : fname, note: T(r.note)}) + (id && id.label ? ': ' + T('riconosciuto, {label}', {label: T(id.label)}) : '') + '. ' + T('In uso subito, senza riavviare.'), 'good');
    renderAll();
    return true;
  }
  $('ce-dl').addEventListener('click', async () => {                  // rete SOLO su questo clic: legge un file pubblico, non invia niente
    await app.fetchCharset(ed.kind);
    syncFromApp();
    renderAll();
  });
  $('ce-revert').addEventListener('click', () => {
    if (ed.kind === 'vdc') app.revertCharsetLive(); else app.revertEfCharsetLive();
    syncFromApp();
    log(T('Set GPL O2web rimesso in uso ({kind}).', {kind: T(K().name)}), '');
    renderAll();
  });

  // ---------------------------------------------------------------- aggancio alla pagina
  function render() {                                           // dalla pagina: quando cambia lo stato (rev) o il set (charRev)
    syncFromApp();
    renderAll();
    ed.charRev = app.charRev;
  }
  function poll() {                                             // ritocchi a caldo che arrivano da fuori (nessuno oggi) o dall'editor stesso: si ridisegna se serve
    if (app.charRev !== ed.charRev) render();
  }
  render();
  return {render, poll, importBytes, get state() { return ed; }};
}

module.exports = {init};
