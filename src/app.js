'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// app.js - il "regista" dell'emulatore, SENZA DOM (si prova in Node con test/test_app.js): tiene l'elenco (library.js), i due BIOS e il
// gioco in uso, la console e l'audio, gli stati memorizzati per gioco, le impostazioni, gli ingressi; e sa passare da un gioco
// all'altro, resettare, salvare e aprire stati e sessioni. La pagina (ui.js) lo collega a bottoni, elenchi e canvas.
//
// Scelte (tappa 3, dichiarate in o2web-stato.md):
//  - Scegliere un gioco = AVVIO A FREDDO con quella cartuccia (come inserirla e accendere); lo stato del gioco che si lascia viene
//    MEMORIZZATO in automatico (uno slot per gioco, nella sessione). «Riprendi» ricarica lo stato memorizzato.
//  - Un gioco memorizzato porta con se' l'impronta del BIOS con cui e' stato salvato: con un altro BIOS non si riprende (messaggio), ma
//    lo stato resta nella sessione. Cambiare BIOS = reset della console (avvio a freddo del gioco in uso col BIOS nuovo).
//  - «Reset console» = tasto RESET della macchina (solo la CPU, la cartuccia resta); «Riavvia» = avvio a freddo.
//  - Ogni cambio di macchina si prepara su una copia (nuova Console) e si installa solo se riesce: un errore non tocca la partita in corso.
const {Console, SnapshotError} = require('./console.js');
const {Library, makeGame, makeBios, filterGames, isChessZ80} = require('./library.js');
const {buildEntries, filterEntries, groupEntries, gameInfo} = require('./gamelist.js');
const {matchGame} = require('./vplist.js');
const {describeGame} = require('./gamenames.js');
const {PreviewCache} = require('./previews.js');
const S = require('./session.js');
const {InputState, defaultBindings, assignPads, validateBindings} = require('./input.js');
const {Audio, framesToRun} = require('./audio.js');
const {isZip, listZip, pickEntry, extractEntry, ZipError} = require('./unzip.js');
const {sha256} = require('./sha256.js');
const {LOOK_DEFAULTS, LookError, checkLook, presetOf, nextPreset, pickFilters} = require('./look.js');
const {KINDS, LABELS, NEEDS, pickMachine, fitsBios, defaultStandard, isMono} = require('./machines.js');
const {Covers, IMG_EXTS, sniffImage, isCoverArchive, ext: extOf} = require('./covers.js');
const Net = require('./netfetch.js');
const {t: T} = require('./i18n.js');          // lingua: i messaggi si compongono con T (italiano nei test dei moduli, inglese o italiano nella pagina)
const {findSetInFile, identify} = require('./charedit.js');

const LEAD = 0.06;                // secondi di audio in coda a cui punta il passo guidato dall'audio
const MAX_CATCHUP = 4;            // fotogrammi al massimo per passo
const MIN_RESUME_FRAMES = 30;     // un gioco che ha girato meno di cosi' non sostituisce il proprio stato memorizzato

// dimensioni della schermata: scale 0 = la piu' grande che sta nell'area (con integer = solo multipli interi, ma se nemmeno 1x ci sta si
// riduce); scale > 0 = fissa. aspect 'square' = punti quadrati (360 x 243), 'tv' = schermo 4:3 (punti piu' alti che larghi: 360 x 270,
// DA VERIFICARE). Ritorna {w, h, factor} in pixel CSS.
function layoutSize(cw, ch, scale, aspect, integer) {
  const w0 = 360, h0 = aspect === 'tv' ? 270 : 243;
  let f;
  if (scale > 0) f = scale;
  else if (!(cw > 0 && ch > 0)) f = 1;
  else {
    const fit = Math.min(cw / w0, ch / h0);
    f = fit >= 1 && integer ? Math.floor(fit) : fit;
  }
  return {w: Math.round(w0 * f), h: Math.round(h0 * f), factor: f};
}

// un'immagine scelta dall'utente: estensione da immagine E contenuto da immagine (il solo contenuto non basta: un dump potrebbe iniziare con quei byte)
function isImageFile(f) { return IMG_EXTS.includes(extOf(f.name)) && !!sniffImage(f.bytes); }
// sorgente C o testo (non zip, non binario di dimensione da set): candidato a contenere la tabella di un set di caratteri
function isSetSource(f) { return /\.(c|h|txt)$/i.test(f.name) && f.bytes.length !== 512 && f.bytes.length !== 2560 && !isZip(f.bytes); }

function sniffSession(bytes) {
  if (!isZip(bytes)) return false;
  try { return listZip(bytes).some((e) => e.name === 'sessione.json'); } catch (e) { return false; }
}
function sniffState(bytes) {
  let i = 0;
  while (i < bytes.length && i < 64 && (bytes[i] === 0x20 || bytes[i] === 0x0A || bytes[i] === 0x0D || bytes[i] === 0x09)) i++;
  return bytes[i] === 0x7B;
}

// BIOS scelto in automatico: il primo utilizzabile, ma prima quelli G7000 / C52 (il G7400 chiede in piu' il set di caratteri dell'EF9341)
function firstUsableBios(list) {
  return list.find((x) => x.supported && !(x.known && x.known.system === 'g7400')) || list.find((x) => x.supported) || null;
}

class App {
  // opts: {onMessage(text, kind), sink: AudioOutput | null, fallbackCharset: Uint8Array (512 byte: set di caratteri originale di ripiego),
  //        fallbackEfCharset: Uint8Array (2560 byte, tappa 5: ripiego originale per l'EF9341; senza, il G7400 chiede il set dell'utente),
  //        fetch: funzione fetch da usare per gli scarichi (solo per le prove; nel browser si usa quella della pagina), onNet(stato dello scarico)}
  constructor(opts) {
    opts = opts || {};
    this.onMessage = opts.onMessage || (() => {});
    this.fetchImpl = opts.fetch || null;
    this.onNet = opts.onNet || null;
    this.net = {busy: false, ctl: null, received: 0, total: null, host: ''};   // scarico in corso (src/netfetch.js): parte solo su azione dell'utente
    this.covers = new Covers();            // copertine dell'utente (src/covers.js): in memoria, mai nella sessione
    this.sink = opts.sink || null;
    this.lib = new Library();
    this.settings = {standard: 'PAL', scale: 0, aspect: 'tv', integer: false, volume: 0.8, muted: false, pinB: 'auto', swapPads: false};
    this.look = Object.assign({}, LOOK_DEFAULTS);   // aspetto dell'uscita (src/look.js): monitor B/N e filtri da tubo catodico, spenti di default
    this.machinePref = 'auto';                       // macchina scelta: una di machines.js KINDS (la pagina la sceglie con selectMachine), oppure 'auto' = ricavata dal BIOS, dallo standard e dal B/N (prima della prima scelta e nelle sessioni vecchie)
    this.autoMachine = true;                         // cambio di macchina automatico: un gioco «solo Videopac+» (lista delle cartucce) avvia il G7400, uno normale riporta alla macchina di prima
    this.machineManual = false;                      // l'utente ha scelto a mano macchina o BIOS: il cambio automatico non tocca piu' niente (si toglie riaccendendo l'interruttore)
    this._autoPrev = null;                           // la macchina da cui si e' passati al G7400 in automatico (per tornarci)
    this.listOrder = 'device';                       // ordine dell'elenco: 'device' = dispositivo e numero di cassetta, 'name' = per nome
    this.customLook = null;                          // i filtri personalizzati messi da parte dal pulsante «Filtri CRT» quando si passa a un insieme pronto (non si salvano nella sessione)
    this.lookRev = 0;                                // sale a ogni cambio dell'aspetto o della macchina (la pagina lo ridisegna senza rifare l'elenco)
    this.input = new InputState(defaultBindings());
    this.padPrefs = {1: 'auto', 2: 'auto'};
    this.charset = null;                  // set di caratteri dell'utente (512 byte) o null: allora quello originale di ripiego
    this.charsetName = '';
    if (!(opts.fallbackCharset instanceof Uint8Array) || opts.fallbackCharset.length !== 512) throw new Error('manca il set di caratteri di ripiego');
    this.fallbackCharset = opts.fallbackCharset;
    this.efCharset = null;                // (tappa 5) ROM dei caratteri dell'EF9341 dell'utente (2560 byte) o null
    this.efCharsetName = '';
    this.chessRom = null;                 // (tappa 6a) ROM da 8 KB dello Z80 del modulo scacchi C7010, dell'utente (CRC-32 verificato) o null
    this.chessRomName = '';
    this.charRev = 0;                     // (editor) sale a ogni modifica a caldo di un set; rev (elenco, pannelli) solo quando cambia lo stato visibile
    if (opts.fallbackEfCharset !== undefined && opts.fallbackEfCharset !== null && (!(opts.fallbackEfCharset instanceof Uint8Array) || opts.fallbackEfCharset.length !== 2560)) {
      throw new Error('il set di caratteri di ripiego dell’EF9341 deve essere di 2560 byte');
    }
    this.fallbackEfCharset = opts.fallbackEfCharset || null;
    this.mergeDuplicates = true;          // (tappa 7) una voce sola per i dump identici (gamelist.js); acceso all'apertura, non si ricorda tra una visita e l’altra
    this._entriesKey = null; this._entriesVal = [];
    this.previewRev = 0;                  // sale a ogni anteprima nuova: la pagina ridisegna solo i canvas
    this.onPreview = null;                // la pagina: (gioco, risultato) => void
    this.previews = new PreviewCache({     // (tappa 7) miniature di una schermata, calcolate a fette per le righe visibili; solo in memoria
      build: (g) => {
        let b = this.bios, std = this.settings.standard;
        const plus = this._plusBios(g);                          // gioco «solo Videopac+»: l'anteprima si fa col G7400, come l'avvio (con il G7000 resterebbe vuota)
        if (plus && !(b && b.known && b.known.system === 'g7400')) { b = plus; std = defaultStandard('g7400'); }
        return b && b.supported ? this._buildConsole(b, g, std) : null;
      },
      context: () => this._previewContext(),
      budget: () => (this.con && !this.paused ? 4 : 12),         // mentre si gioca le fette sono corte, per non disturbare l'audio
      schedule: (fn) => setTimeout(fn, 0),
      unschedule: (h) => clearTimeout(h),
      now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
      onChange: (g, res) => { this.previewRev++; if (this.onPreview) this.onPreview(g, res); },
    });
    this.biosId = null;
    this.gameId = null;
    this.states = new Map();              // id gioco -> stato memorizzato (snapshot)
    this.con = null;
    this.audio = null;
    this.paused = false;
    this.acc = 0;
    this.last = null;
    this.runMs = 0;
    this.blackWarned = false;
    this.framesRun = 0;                   // fotogrammi eseguiti dall'ultimo avvio
    this.rev = 0;                         // contatore: sale a ogni cambio che la pagina deve ridisegnare
    this.msPerFrame = [];
  }

  msg(text, kind) { this.onMessage(text, kind || ''); }
  changed() { this.rev++; }

  get bios() { return this.biosId === null ? null : this.lib.getBios(this.biosId); }
  get game() { return this.gameId === null ? null : this.lib.getGame(this.gameId); }
  get running() { return !!this.con; }
  get activeCharset() { return this.charset || this.fallbackCharset; }
  get activeEfCharset() { return this.efCharset || this.fallbackEfCharset; }
  get isG7400() { const b = this.bios; return !!(b && b.known && b.known.system === 'g7400'); }

  // ---------------------------------------------------------------- file dell'utente
  // Sceglie che cosa farne: sessione, stato di gioco oppure dump (BIOS / cartucce / zip). files: [{name, bytes}]
  async openFiles(files) {
    const dumps = [], covers = [];
    for (const f of files) {
      if (sniffSession(f.bytes)) { await this.loadSession(f.bytes, f.name); continue; }
      if (!isZip(f.bytes) && sniffState(f.bytes)) { this.loadStateFile(f.bytes, f.name); continue; }
      if (isImageFile(f) || isCoverArchive(f.bytes)) { covers.push(f); continue; }          // immagini e zip di sole immagini: copertine
      if (isSetSource(f) && this.useSetSource(f.name, f.bytes)) continue;                    // sorgente C con la tabella di un set di caratteri (per esempio cset.c di O2EM)
      dumps.push(f);
    }
    let res = null;
    if (dumps.length) res = await this.addFiles(dumps);
    if (covers.length) await this.addCovers(covers);
    return res;
  }

  // Un sorgente C / testo con la tabella di un set di caratteri (512 valori = chip video; tabella 2D dell'EF9341 con l'impronta nota): lo mette in uso subito,
  // senza riavviare (come lo scarico da GitHub). Ritorna false se il file non contiene un set (allora si tratta come un file qualunque).
  useSetSource(name, bytes) {
    const found = findSetInFile(bytes);
    if (!found) return false;
    const id = identify(found.data);
    if (found.kind === 'vdc') this.replaceCharsetLive(found.data, name); else this.replaceEfCharsetLive(found.data, name);
    this.msg(T(found.kind === 'vdc' ? 'Set del chip video letto da «{name}» ({note})' : 'Set dell’EF9341 letto da «{name}» ({note})', {name, note: T(found.note)}) +
      (id && id.label ? ': ' + T('riconosciuto, {label}', {label: T(id.label)}) : ' (' + T('impronta non nota: controlla che sia quello giusto') + ')') + '. ' + T('In uso subito, senza riavviare.'), 'good');
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- copertine (mai nella sessione: restano in memoria finche' la pagina e' aperta)
  async addCovers(files, opts) {
    const total = {added: 0, dups: 0, skipped: [], errors: [], files: 0};
    for (const f of files) {
      const r = await this.covers.addFile(f.name, f.bytes, opts);
      total.files++;
      total.added += r.added; total.dups += r.dups;
      total.skipped.push(...r.skipped.map((s) => s.name + ': ' + T(s.why)));
      total.errors.push(...r.errors);
    }
    const st = this.coverStats();
    if (total.added) {
      this.msg(T(total.added === 1 ? 'Aggiunte {n} copertina' : 'Aggiunte {n} copertine', {n: total.added}) + (total.dups ? ' (' + T('{n} doppioni ignorati', {n: total.dups}) + ')' : '') + '. ' +
        (st.games ? T('Abbinate a {m} giochi su {g}.', {m: st.matched, g: st.games}) : T('Si abbinano ai giochi per titolo, appena li aggiungi.')), 'good');
      if (st.games && !st.matched) this.msg('Nessuna copertina corrisponde ai giochi dell’elenco: l’abbinamento è per titolo (per esempio «Killer Bees.png» o il nome del file del gioco).', 'warn');
    } else if (total.dups) this.msg(T('Niente di nuovo: {n} copertine erano già presenti.', {n: total.dups}), 'warn');
    else this.msg('Nessuna copertina trovata nei file scelti (servono immagini PNG, JPEG, WebP o GIF, anche dentro uno zip).', 'warn');
    if (total.skipped.length) this.msg(T('{n} file saltati: {list}', {n: total.skipped.length, list: total.skipped.slice(0, 3).join('; ') + (total.skipped.length > 3 ? '; ...' : '')}), 'warn');
    for (const e of total.errors.slice(0, 4)) this.msg(T(e), 'bad');
    if (total.errors.length > 4) this.msg(T('...e altri {n} errori.', {n: total.errors.length - 4}), 'bad');
    this.changed();
    return total;
  }
  coverStats() { return {covers: this.covers.count, games: this.lib.games.length, matched: this.covers.matchedCount(this.lib.games)}; }
  coverFor(gameId) { const g = this.lib.getGame(gameId); return g ? this.covers.forGame(g) : null; }
  clearCovers() { this.covers.clear(); this.changed(); }

  // ---------------------------------------------------------------- rete su richiesta (src/netfetch.js): solo quando l'utente preme «Scarica»
  _net() { if (this.onNet) this.onNet(this.net); }
  cancelFetch() {
    if (!this.net.busy || !this.net.ctl) return false;
    this.net.ctl.abort();
    return true;
  }
  // Scarica un file da un indirizzo https scelto dall'utente e lo tratta come se l'avesse scelto dal disco: giochi / BIOS / set di caratteri / raccolte
  // oppure copertine (se il contenuto sono immagini). Mai sessioni ne' stati: sostituirebbero la partita in corso, si aprono solo dal disco.
  // kind: 'games' | 'covers' (che cosa l'utente si aspetta: serve solo al messaggio quando il contenuto non coincide). Ritorna null se non e' andato a buon fine.
  async fetchUrl(urlText, kind) {
    const r = await this._fetchBytes(urlText);
    if (!r) return null;
    return this._openFetched(r, kind);
  }
  // scarica i byte (solo lettura); null e messaggio se non va. Gestisce lo stato di rete (net) e gli annullamenti
  // opts.quiet: per il caricamento automatico all'apertura: nessun messaggio (li scrive il chiamante); l'errore resta in this.lastNetError
  async _fetchBytes(urlText, opts) {
    const quiet = !!(opts && opts.quiet);
    this.lastNetError = null;
    if (this.net.busy) { if (!quiet) this.msg('Uno scarico è già in corso: aspetta che finisca o annullalo.', 'warn'); return null; }
    const chk = Net.checkUrl(urlText);
    if (!chk.ok) { if (!quiet) this.msg(chk.why, 'bad'); return null; }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    this.net = {busy: true, ctl, received: 0, total: null, host: chk.host};
    this._net();
    if (!quiet) this.msg(T('Scarico da {host} (solo lettura: non invio nessun tuo dato)…', {host: chk.host}), '');
    let r;
    try {
      r = await Net.download(chk.url, {fetch: this.fetchImpl, signal: ctl ? ctl.signal : undefined,
        onProgress: (got, total) => { this.net.received = got; this.net.total = total; this._net(); }});
    } catch (e) {
      if (!(e instanceof Net.NetError)) throw e;
      this.lastNetError = e;
      if (!quiet) this.msg(e.message, e.code === 'abort' ? 'warn' : 'bad');
      return null;
    } finally {
      this.net = {busy: false, ctl: null, received: 0, total: null, host: ''};
      this._net();
      this.changed();
    }
    return r;
  }
  async _openFetched(r, kind) {
    const f = {name: r.name, bytes: r.bytes};
    if (sniffSession(f.bytes) || (!isZip(f.bytes) && sniffState(f.bytes))) {
      this.msg(T('«{name}» è una sessione o uno stato di gioco: per sicurezza non si apre da un indirizzo. Salvalo sul disco e aprilo con «Aggiungi file».', {name: f.name}), 'warn');
      return null;
    }
    this.msg(T('Scaricato «{name}» ({size}) da {host}', {name: f.name, size: Net.fmtBytes(f.bytes.length), host: r.host}) + (r.redirected ? ' (' + T('dopo un reindirizzamento') + ')' : '') + '.', 'good');
    if (isImageFile(f) || isCoverArchive(f.bytes)) return {kind: 'covers', name: f.name, size: f.bytes.length, report: await this.addCovers([f])};
    if (kind === 'covers') {
      this.msg(T('«{name}» non contiene immagini: non è un archivio di copertine. Se sono giochi o BIOS, scegli «Giochi e BIOS».', {name: f.name}), 'warn');
      return null;
    }
    return {kind: 'games', name: f.name, size: f.bytes.length, report: await this.addFiles([f])};
  }

  // Scarica il set di caratteri dal sorgente di O2EM (netfetch.CHARSET_SOURCES) SOLO su richiesta dell'utente (pulsante dell'editor), lo legge (charedit.findSetInFile)
  // e lo mette in uso subito, senza riavviare. kind: 'vdc' | 'ef'. Il file non resta nel codice: sta solo nella pagina dell'utente. Ritorna {kind, name, known} o null.
  async fetchCharset(kind) {
    const src = Net.CHARSET_SOURCES[kind];
    if (!src) throw new Error('tipo di set sconosciuto: ' + kind);
    const r = await this._fetchBytes(src.url);
    if (!r) return null;
    const found = findSetInFile(r.bytes, kind);
    if (!found || found.kind !== kind) {
      this.msg(T(kind === 'vdc' ? '«{file}» scaricato, ma non contiene il set del chip video (512 byte): il file potrebbe essere cambiato sul sito. Scaricalo a mano dalla pagina del sorgente e aggiungilo con «Aggiungi file».' : '«{file}» scaricato, ma non contiene il set dell’EF9341 (2560 byte): il file potrebbe essere cambiato sul sito. Scaricalo a mano dalla pagina del sorgente e aggiungilo con «Aggiungi file».', {file: src.file}), 'bad');
      return null;
    }
    const id = identify(found.data), name = src.file + ' (O2EM)';
    if (kind === 'vdc') this.replaceCharsetLive(found.data, name); else this.replaceEfCharsetLive(found.data, name);
    this.msg(T(kind === 'vdc' ? 'Set del chip video letto da {name} ({note})' : 'Set dell’EF9341 letto da {name} ({note})', {name: src.file, note: T(found.note)}) +
      (id && id.label ? ': ' + T('riconosciuto, {label}', {label: T(id.label)}) : ' (' + T('impronta non nota: controlla che sia quello giusto') + ')') + '. ' + T('In uso subito, senza riavviare.'), 'good');
    return {kind, name, known: !!(id && id.label)};
  }

  // Caricamento automatico dei set di caratteri all'apertura della pagina (richiesta dell'utente, 15/10/2026: cosi' bastano BIOS e giochi): legge cset.c e vpp_cset.c dal sorgente
  // pubblico di O2EM (netfetch.CHARSET_SOURCES), in sola lettura, senza inviare niente. Non sostituisce mai un set che l'utente ha gia' messo (file, sessione, scarico a mano); se manca la
  // connessione o il sito non risponde resta il set GPL incluso, con un avviso, e se il primo scarico fallisce per la rete il secondo non si tenta. Si chiama dalla pagina (a meno di «?offline»).
  // Ritorna {vdc, ef}: 'ok' | 'skip' (c'era gia' un set) | 'fail'.
  async autoLoadCharsets() {
    const res = {vdc: 'skip', ef: 'skip'};
    let netDown = false, fails = [];
    for (const kind of ['vdc', 'ef']) {
      const has = () => (kind === 'vdc' ? this.charset : this.efCharset);
      const label = kind === 'vdc' ? T('chip video') : 'EF9341';
      if (has()) continue;
      if (netDown) { res[kind] = 'fail'; fails.push(label); continue; }
      const src = Net.CHARSET_SOURCES[kind];
      const r = await this._fetchBytes(src.url, {quiet: true});
      if (has()) continue;                                              // nel frattempo l'utente ha messo un suo set: vale il suo
      if (!r) {
        res[kind] = 'fail';
        const code = this.lastNetError ? this.lastNetError.code : 'busy';
        if (code === 'network' || code === 'stalled' || code === 'unsupported') netDown = true;
        fails.push(label);
        continue;
      }
      const found = findSetInFile(r.bytes, kind);
      if (!found || found.kind !== kind) { res[kind] = 'fail'; fails.push(label); continue; }
      const name = src.file + ' (O2EM)';
      if (kind === 'vdc') this.replaceCharsetLive(found.data, name); else this.replaceEfCharsetLive(found.data, name);
      res[kind] = 'ok';
    }
    const ok = ['vdc', 'ef'].filter((k) => res[k] === 'ok').map((k) => (k === 'vdc' ? T('chip video') : 'EF9341'));
    if (ok.length) this.msg(T('Set di caratteri originali caricati da GitHub (O2EM): {list}. Sono in uso subito; per tenerli salva la sessione o l\u2019editor.', {list: ok.join(T(' e '))}), 'good');
    if (res.vdc === 'fail' || res.ef === 'fail') {
      this.msg(T('Non sono riuscito a scaricare {what} da GitHub (manca la connessione, o il sito non risponde): uso il set GPL incluso. ', {what: fails.length ? T('il set di caratteri ({list})', {list: fails.join(T(' e '))}) : T('i set di caratteri')}) +
        T('Puoi aggiungere i file con «Aggiungi file» o riprovare con i pulsanti «Scarica ... da GitHub».'), 'warn');
    }
    this.changed();
    return res;
  }

  async addFiles(files, opts) {
    const total = {games: 0, bios: 0, dups: 0, lists: 0, listNames: 0, skipped: [], errors: [], files: 0, charsets: [], chessRoms: []};
    for (const f of files) {
      const r = await this.lib.addFile(f.name, f.bytes, opts);
      total.files++;
      total.games += r.games; total.bios += r.bios; total.dups += r.dups; total.lists += r.lists; total.listNames += r.listNames;
      total.skipped.push(...r.skipped.map((s) => s.name + ': ' + T(s.why)));
      total.errors.push(...r.errors);
      for (const c of r.charsets) if (!total.charsets.some((x) => x.sha === c.sha)) total.charsets.push(c);   // uno per contenuto
      for (const c of r.chessRoms) if (!total.chessRoms.some((x) => x.sha === c.sha)) total.chessRoms.push(c);
    }
    const parts = [];
    if (total.games) parts.push(T(total.games === 1 ? '{n} gioco' : '{n} giochi', {n: total.games}));
    if (total.bios) parts.push(total.bios + ' BIOS');
    if (total.lists) parts.push(T(total.lists === 1 ? 'un elenco di nomi ({n} voci)' : '{l} elenchi di nomi ({n} voci)', {l: total.lists, n: total.listNames}));
    if (parts.length || total.dups || !(total.charsets.length || total.chessRoms.length)) {
      this.msg(parts.length ? T('Aggiunti all’elenco: {list}', {list: parts.join(T(' e '))}) + (total.dups ? ' (' + T('{n} doppioni ignorati', {n: total.dups}) + ')' : '') + '.'
        : (total.dups ? T('Niente di nuovo: {n} file erano gia’ nell’elenco.', {n: total.dups}) : T('Nessun gioco o BIOS trovato nei file scelti.')), parts.length ? 'good' : 'warn');
    }
    // il set di caratteri del chip video (512 byte) e quello dell'EF9341 (2560 byte) sono ingressi come il BIOS: si riconoscono dalla dimensione, anche dentro uno zip
    const vdcCs = total.charsets.filter((c) => c.chip !== 'ef'), efCs = total.charsets.filter((c) => c.chip === 'ef');
    if (vdcCs.length === 1) this.setCharset(vdcCs[0].name, vdcCs[0].data);
    else if (vdcCs.length > 1) {
      this.msg(T('Trovati {n} file diversi da 512 byte ({list}): non so quale sia il set di caratteri. Aggiungi solo quello giusto con «Aggiungi file».', {n: vdcCs.length, list: vdcCs.slice(0, 3).map((c) => c.name).join(', ') + (vdcCs.length > 3 ? ', ...' : '')}), 'warn');
    }
    if (total.chessRoms.length) this.setChessRom(total.chessRoms[0].name, total.chessRoms[0].data);
    if (efCs.length === 1) this.setEfCharset(efCs[0].name, efCs[0].data);
    else if (efCs.length > 1) {
      this.msg(T('Trovati {n} file diversi da 2560 byte ({list}): non so quale sia il set di caratteri dell’EF9341. Aggiungi solo quello giusto con «Aggiungi file».', {n: efCs.length, list: efCs.slice(0, 3).map((c) => c.name).join(', ') + (efCs.length > 3 ? ', ...' : '')}), 'warn');
    }
    if (total.skipped.length) this.msg(T('{n} file saltati: {list}', {n: total.skipped.length, list: total.skipped.slice(0, 3).join('; ') + (total.skipped.length > 3 ? '; ...' : '')}), 'warn');
    for (const e of total.errors.slice(0, 4)) this.msg(T(e), 'bad');
    if (total.errors.length > 4) this.msg(T('...e altri {n} errori.', {n: total.errors.length - 4}), 'bad');
    if (this.biosId === null) this.autoBios();
    this.changed();
    return total;
  }

  autoBios() {
    const b = firstUsableBios(this.lib.bios);
    if (b) { this.biosId = b.id; this._syncMachine(); }
    else if (this.lib.bios.length) this.msg(T('I BIOS caricati non sono utilizzabili: {reason}.', {reason: T(this.lib.bios[0].reason)}), 'warn');
    return !!b;
  }

  // (tappa 6a) ROM da 8 KB dello Z80 del modulo scacchi C7010: ingresso dell'utente come il BIOS; si riconosce per dimensione + CRC-32 (library.js)
  setChessRom(name, bytes) {
    if (!(bytes instanceof Uint8Array) || !isChessZ80(bytes)) { this.msg(T('Non e’ la ROM dello Z80 del modulo scacchi C7010 (8192 byte, CRC-32 45080245).'), 'bad'); return false; }
    const same = !!this.chessRom && sha256(this.chessRom) === sha256(bytes);
    this.chessRom = Uint8Array.from(bytes); this.chessRomName = name || '';
    const g = this.game, uses = !!(g && g.chess && this.con && !this.con.g7400);
    if (same) this.msg(T('ROM dello Z80 del modulo scacchi: {name} (e’ gia’ quella in uso).', {name: name}), 'good');
    else if (uses && !this.con.chess) this._restartCold(T('ROM dello Z80 del modulo scacchi: {name}: la console riparte con il modulo (avvio a freddo del gioco in uso).', {name: name}), 'good');
    else this.msg(T('ROM dello Z80 del modulo scacchi: {name}. Vale con la cartuccia del modulo scacchi C7010 (2 KB).', {name: name}), 'good');
    this.changed();
    return true;
  }
  get chessRomSha() { return this.chessRom ? sha256(this.chessRom) : ''; }
  clearChessRom() {
    const had = !!this.chessRom;
    this.chessRom = null; this.chessRomName = '';
    if (had && this.con && this.con.chess) this._restartCold('ROM dello Z80 tolta: la console riparte senza il modulo scacchi (avvio a freddo del gioco in uso).', '');
    this.changed();
  }

  setCharset(name, bytes) {
    let b = bytes, n = name;
    if (isZip(b)) {
      try {
        const pk = pickEntry(b, ['.bin', '.rom']);
        b = extractEntry(b, pk.entry); n = pk.entry.name;
      } catch (e) {
        if (!(e instanceof ZipError)) throw e;
        this.msg(name + ': ' + e.message + '.', 'bad');
        return false;
      }
    }
    if (b.length !== 512) { this.msg(T('Il set di caratteri deve essere di 512 byte (questo ne ha {n}).', {n: b.length}), 'bad'); return false; }
    const same = !!this.charset && sha256(this.charset) === sha256(b);
    this.charset = b; this.charsetName = n;
    if (same) this.msg(T('Set di caratteri dell’utente: {name} (e’ gia’ quello in uso).', {name: n}), 'good');
    else if (this.con) this._restartCold(T('Set di caratteri dell’utente: {name}: la console riparte (avvio a freddo del gioco in uso; la partita precedente resta memorizzata).', {name: n}), 'good');
    else this.msg(T('Set di caratteri dell’utente: {name}. Vale dal prossimo avvio.', {name: n}), 'good');
    this.changed();
    return true;
  }
  // torna al set di caratteri di ripiego (se gira una partita: avvio a freddo, come per il BIOS e lo standard)
  clearCharset() {
    const had = !!this.charset;
    this.charset = null; this.charsetName = '';
    if (had && this.con) this._restartCold('Set di caratteri di ripiego: la console riparte (avvio a freddo del gioco in uso; la partita precedente resta memorizzata).', '');
    this.changed();
  }
  get charsetSha() { return this.charset ? sha256(this.charset) : ''; }
  // (editor dei caratteri) mette in uso un set modificato a caldo: la partita in corso non si riavvia e i glifi cambiano dal quadro dopo. Dopo la
  // modifica il set e' «dell'utente» (niente avviso di set mancante). name: nome da mostrare (di solito «... (modificato)»).
  replaceCharsetLive(bytes, name) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 512) throw new Error('il set di caratteri deve essere di 512 byte');
    const b = Uint8Array.from(bytes), was = this.charset, oldName = this.charsetName;
    this.charset = b; this.charsetName = name || this.charsetName || 'modificato';
    if (this.con) this.con.replaceCharset(b);
    this.charRev++;
    if (!was || this.charsetName !== oldName) this.changed();            // un tratto di penna non rifa l'elenco dei giochi: solo il primo, o un nome nuovo
  }
  // torna al set GPL di ripiego senza riavviare
  revertCharsetLive() {
    this.charset = null; this.charsetName = '';
    if (this.con) this.con.replaceCharset(this.fallbackCharset);
    this.charRev++;
    this.changed();
  }

  // (tappa 5) ROM dei caratteri dell'EF9341 del Videopac+ G7400 (2560 byte): ingresso come il set del chip video; serve solo al G7400
  setEfCharset(name, bytes) {
    let b = bytes, n = name;
    if (isZip(b)) {
      try {
        const pk = pickEntry(b, ['.bin', '.rom']);
        b = extractEntry(b, pk.entry); n = pk.entry.name;
      } catch (e) {
        if (!(e instanceof ZipError)) throw e;
        this.msg(name + ': ' + e.message + '.', 'bad');
        return false;
      }
    }
    if (b.length !== 2560) { this.msg(T('Il set di caratteri dell’EF9341 deve essere di 2560 byte (questo ne ha {n}).', {n: b.length}), 'bad'); return false; }
    const same = !!this.efCharset && sha256(this.efCharset) === sha256(b);
    this.efCharset = b; this.efCharsetName = n;
    if (same) this.msg(T('Set di caratteri dell’EF9341: {name} (e’ gia’ quello in uso).', {name: n}), 'good');
    else if (this.con && this.con.g7400) this._restartCold(T('Set di caratteri dell’EF9341: {name}: la console riparte (avvio a freddo del gioco in uso; la partita precedente resta memorizzata).', {name: n}), 'good');
    else this.msg(T('Set di caratteri dell’EF9341: {name}. Vale per il Videopac+ G7400.', {name: n}), 'good');
    this.changed();
    return true;
  }
  clearEfCharset() {
    const had = !!this.efCharset;
    this.efCharset = null; this.efCharsetName = '';
    if (had && this.con && this.con.g7400) this._restartCold('Set di caratteri dell’EF9341 di ripiego: la console riparte (avvio a freddo del gioco in uso; la partita precedente resta memorizzata).', '');
    this.changed();
  }
  get efCharsetSha() { return this.efCharset ? sha256(this.efCharset) : ''; }
  replaceEfCharsetLive(bytes, name) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 2560) throw new Error('il set di caratteri dell’EF9341 deve essere di 2560 byte');
    const b = Uint8Array.from(bytes), was = this.efCharset, oldName = this.efCharsetName;
    this.efCharset = b; this.efCharsetName = name || this.efCharsetName || 'modificato';
    if (this.con && this.con.g7400) this.con.replaceEfRom(b);
    this.charRev++;
    if (!was || this.efCharsetName !== oldName) this.changed();
  }
  revertEfCharsetLive() {
    this.efCharset = null; this.efCharsetName = '';
    if (this.con && this.con.g7400 && this.fallbackEfCharset) this.con.replaceEfRom(this.fallbackEfCharset);
    this.charRev++;
    this.changed();
  }

  // pin B della cartuccia (Videopac+): non e' nel dump. 'auto' = acceso per i giochi della raccolta «Videopac+» e per le cartucce da 12 / 16 KB,
  // spento per gli altri; si puo' forzare. Solo il G7400 lo usa. DA VERIFICARE.
  setPinB(v) {
    if (v !== 'auto' && v !== 'low' && v !== 'high') return false;
    if (this.settings.pinB === v) return true;
    this.settings.pinB = v;
    if (this.con && this.con.g7400) this._restartCold(T('Pin B della cartuccia: {v}: la console riparte (avvio a freddo del gioco in uso).', {v: T(v === 'auto' ? 'automatico' : v === 'high' ? 'alto' : 'basso')}), '');
    this.changed();
    return true;
  }
  pinBFor(game, setting) {
    const p = setting || this.settings.pinB;
    if (p === 'high') return true;
    if (p === 'low') return false;
    return !!game && (/Videopac\+/i.test((game.platform || '') + ' ' + (game.folder || '')) || game.data.length >= 12288);
  }

  // memorizza la partita e riparte a freddo con lo stesso gioco (cambio di BIOS, standard o set di caratteri: il chip video e la CPU cambiano)
  _restartCold(text, kind) {
    const old = this.gameId;
    this.memorize(true);
    this.gameId = null;                    // lo stato e' gia' memorizzato (con le impronte di allora)
    this.msg(text, kind);
    if (!this.start(old)) this.gameId = old;
  }

  listGames(query, folder) { return filterGames(this.lib.games, {query, folder}); }

  // ---------------------------------------------------------------- elenco a voci (tappa 7): sigla + nome, dump identici fusi se mergeDuplicates
  _entries() {
    const key = this.lib.version + '|' + this.mergeDuplicates;
    if (this._entriesLib !== this.lib || this._entriesKey !== key) {
      this._entriesVal = buildEntries(this.lib.games, this.lib.names, {merge: this.mergeDuplicates});
      this._entriesKey = key; this._entriesLib = this.lib;
    }
    return this._entriesVal;
  }
  entryCount() { return this._entries().length; }
  listEntries(query, folder) { return filterEntries(this._entries(), {query, folder, order: this.listOrder}); }
  groupedEntries(entries) { return groupEntries(entries, this.listOrder); }
  setListOrder(order) {
    if (order !== 'device' && order !== 'name') return false;
    this.listOrder = order;
    this.changed();
    return true;
  }
  setMerge(on) { this.mergeDuplicates = !!on; this.changed(); return this.mergeDuplicates; }
  // il membro della voce con una partita memorizzata (il primo), o null
  entryStateId(entry) { const id = entry.ids.find((i) => this.states.has(i)); return id === undefined ? null : id; }
  entryIsCurrent(entry) { return this.gameId !== null && entry.ids.includes(this.gameId); }
  startEntry(entry) { return this.start(entry.rep.id); }
  resumeEntry(entry) { const id = this.entryStateId(entry); return id === null ? this.resume(entry.rep.id) : this.resume(id); }
  // toglie dall'elenco tutti i dump della voce (non quella in uso)
  removeEntry(entry) {
    if (this.entryIsCurrent(entry)) { this.msg('Il gioco in uso non si puo’ togliere dall’elenco.', 'warn'); return false; }
    let ok = false;
    for (const id of entry.ids) ok = this.removeGame(id) || ok;
    return ok;
  }

  // ---------------------------------------------------------------- anteprime (tappa 7)
  // il BIOS G7400 per il gioco, se il cambio automatico e' acceso e vale per questo gioco (solo Videopac+), altrimenti null
  _plusBios(g) {
    if (!this.autoMachine || this.machineManual || !this.gamePlusOnly(g)) return null;
    const c = this.machineCandidates('g7400');
    return c.length ? (c.find((x) => x.known) || c[0]) : null;
  }
  _previewContext() {
    const b = this.bios;
    const pb = this.autoMachine && !this.machineManual ? this.machineCandidates('g7400')[0] : null;
    return [b ? b.sha : '-', pb ? pb.sha : '-', this.charRev, this.charset ? 1 : 0, this.efCharset ? 1 : 0, this.settings.standard, this.settings.pinB, this.chessRom ? 1 : 0].join('|');
  }
  setPreviews(on) {
    this.previews.enabled = !!on;
    if (!on) this.previews.cancel();
    this.changed();
    return this.previews.enabled;
  }
  // chiede le anteprime delle voci date (le prime hanno la precedenza); sostituisce la richiesta precedente
  requestPreviews(entries) { this.previews.request(entries.map((e) => e.rep)); }
  previewFor(entry) { return this.previews.get(entry.rep); }

  removeGame(id) {
    if (id === this.gameId) { this.msg('Il gioco in uso non si puo’ togliere dall’elenco.', 'warn'); return false; }
    const ok = this.lib.remove('game', id);
    this.states.delete(id);
    this.changed();
    return ok;
  }
  removeBios(id) {
    if (id === this.biosId) { this.msg('Il BIOS in uso non si puo’ togliere dall’elenco.', 'warn'); return false; }
    const ok = this.lib.remove('bios', id);
    this.changed();
    return ok;
  }
  clearLibrary() {
    this.unload();
    this.lib.clear();
    this.states.clear();
    this.biosId = null; this.gameId = null;
    this.machinePref = 'auto';
    if (this.look.mono) this.look = Object.assign({}, this.look, {mono: false});     // il B/N e' della macchina (G7200): senza BIOS non c'e' nessuna macchina
    this.lookRev++;
    this.changed();
  }

  // ---------------------------------------------------------------- macchina
  // over (solo per le sessioni, che non hanno ancora sostituito i valori in uso): {charset, efCharset, pinB}
  _buildConsole(biosRec, gameRec, standard, over) {
    const opts = {bios: biosRec.data, cart: gameRec ? gameRec.data : null, charset: over ? over.charset || this.fallbackCharset : this.activeCharset, standard};
    const z80 = over ? over.chessRom : this.chessRom;
    if (gameRec && gameRec.chess && z80 && !(biosRec.known && biosRec.known.system === 'g7400')) opts.chessRom = z80;     // modulo scacchi C7010: solo G7000 / G7200
    if (biosRec.known && biosRec.known.system === 'g7400') {            // Videopac+ G7400: EF9340/41 con il suo set di caratteri e il pin B
      const ef = over ? over.efCharset || this.fallbackEfCharset : this.activeEfCharset;
      if (!ef) throw new Error('il Videopac+ G7400 ha bisogno del set di caratteri dell’EF9341 (2560 byte): aggiungilo con «Aggiungi file» in «Macchina e giochi»');
      opts.g7400 = true;
      opts.efRom = ef;
      opts.cartBHigh = this.pinBFor(gameRec, over ? over.pinB : null);
    }
    return new Console(opts);
  }

  // mette in uso una console gia' pronta (e valida): audio nuovo, orologio azzerato
  _install(con, gameId, notes) {
    if (this.audio) this.audio.detach();
    this.con = con;
    this.gameId = gameId;
    this.audio = null;
    if (this.sink) this.sink.flush();
    this.attachAudio();
    this.paused = false;
    this.acc = 0; this.last = null; this.runMs = 0; this.blackWarned = false; this.framesRun = 0;
    this.msPerFrame = [];
    this.input.releaseAll();
    if (!con.cartInfo.ok) this.msg(T('Cartuccia non supportata: {reason}.', {reason: T(con.cartInfo.reason)}), 'warn');
    for (const n of notes || []) this.msg(n, 'warn');
    this.changed();
  }

  // il suono parte solo dopo un gesto dell'utente (regole del browser): la pagina chiama enableAudio() in un clic
  enableAudio() {
    if (!this.sink || !this.sink.available) return false;
    try {
      this.sink.start();
      this.sink.setVolume(this.settings.volume);
      this.sink.setMuted(this.settings.muted);
    } catch (e) { this.msg(T('Audio non disponibile: {m}', {m: T(e.message)}), 'warn'); return false; }
    this.attachAudio();
    return true;
  }
  attachAudio() {
    if (!this.con || this.audio || !this.sink || !this.sink.ctx) return;
    this.audio = new Audio(this.con.vdc, this.con.cyclesPerSecond, this.sink.rate);
    this.audio.restart(this.con.cpu.now);
  }

  // memorizza lo stato del gioco in uso (slot unico per gioco). Con 'auto' non sovrascrive uno stato con una partita appena iniziata.
  memorize(auto) {
    if (!this.con || this.gameId === null) return false;
    if (auto && this.framesRun < MIN_RESUME_FRAMES) return false;
    this.states.set(this.gameId, this.con.saveState());
    this.changed();
    return true;
  }
  hasState(id) { return this.states.has(id); }
  forgetState(id) { const ok = this.states.delete(id); this.changed(); return ok; }
  stateInfo(id) {
    const s = this.states.get(id);
    if (!s) return null;
    const b = this.lib.findBiosBySha(s.hashes && s.hashes.bios);
    return {bios: s.hashes && s.hashes.bios, biosName: b ? b.display : '', standard: s.standard, sameBios: !!this.bios && this.bios.sha === (s.hashes && s.hashes.bios)};
  }

  // avvio a freddo del gioco 'id' (null = nessuna cartuccia) con il BIOS scelto
  start(id) {
    if (!this.bios) { this.msg('Scegli prima un BIOS utilizzabile (1024 byte, G7000 / Odyssey 2).', 'warn'); return false; }
    if (!this.bios.supported) { this.msg(T('Il BIOS scelto non e’ utilizzabile: {reason}.', {reason: T(this.bios.reason)}), 'warn'); return false; }
    const game = id === null || id === undefined ? null : this.lib.getGame(id);
    if (id !== null && id !== undefined && !game) { this.msg('Gioco non trovato nell’elenco.', 'bad'); return false; }
    this._autoMachineFor(game);                    // puo' cambiare BIOS e standard (gioco «solo Videopac+»): il BIOS si legge dopo
    const bios = this.bios;
    let con;
    try { con = this._buildConsole(bios, game, this.settings.standard); } catch (e) { this.msg(T('Avvio impossibile: {m}', {m: T(e.message)}), 'bad'); return false; }
    const leaving = this.gameId;
    if (this.con && leaving !== null && leaving !== (game ? game.id : null)) {
      if (this.memorize(true)) this.msg(T('Stato di «{name}» memorizzato.', {name: this.game.display}), '');
    }
    const notes = [];
    if (!this.charset) notes.push(T('Si usa il set di caratteri GPL incluso nella pagina (512 byte, disegnato da zero): va bene per il menu, ma i simboli speciali di alcuni giochi non coincidono e certi giochi possono risultare ingiocabili. Puoi correggerlo nell’«Editor dei caratteri» o aggiungere l’originale in «Macchina e giochi».'));
    if (con.g7400 && !this.efCharset) notes.push(T('Si usa la ROM dei caratteri GPL dell’EF9341 inclusa nella pagina (2560 byte, disegnata da zero): i testi del G7400 si leggono, ma i disegni non sono identici a quelli del chip. Puoi ritoccarla nell’«Editor dei caratteri» o aggiungere l’originale in «Macchina e giochi».'));
    if (game && game.chess) {
      if (con.g7400) notes.push(T('Il modulo scacchi C7010 e’ per il G7000 / G7200: sul Videopac+ G7400 non funziona. Scegli un BIOS G7000.'));
      else if (!con.chess) notes.push(T('Il modulo scacchi C7010 ha bisogno anche della ROM da 8 KB dello Z80 (di solito z80_c7010.bin): aggiungila con «Aggiungi file» in «Macchina e giochi». Senza, si vede la scacchiera ma il modulo non risponde.'));
      else if (this.settings.standard === 'NTSC') notes.push(T('Il modulo scacchi C7010 era venduto solo in Europa (PAL): in NTSC la scacchiera puo’ risultare disegnata male.'));
    }
    if (!game) notes.push(T('Nessuna cartuccia: senza cartuccia il BIOS puo’ lasciare lo schermo nero. Scegli un gioco dall’elenco.'));
    this._install(con, game ? game.id : null, notes);
    return true;
  }

  restart() { return this.start(this.gameId); }

  // Riprendi lo stato memorizzato di 'id' (con il BIOS in uso; altrimenti messaggio e niente)
  resume(id) {
    const s = this.states.get(id);
    const game = this.lib.getGame(id);
    if (!s || !game) { this.msg('Nessuno stato memorizzato per questo gioco.', 'warn'); return false; }
    if (this.bios && this.bios.supported) this._autoMachineFor(game);
    const bios = this.bios;
    if (!bios || !bios.supported) { this.msg('Scegli prima un BIOS utilizzabile.', 'warn'); return false; }
    if (s.hashes && s.hashes.bios !== bios.sha) {
      const other = this.lib.findBiosBySha(s.hashes.bios);
      this.msg(T('Lo stato di «{name}» e’ stato salvato con un altro BIOS', {name: game.display}) + (other ? ' («' + other.display + '»)' : ' (' + T('non e’ nell’elenco') + ')') +
        ': ' + T('scegli quel BIOS per riprenderlo. Lo stato resta memorizzato.'), 'warn');
      return false;
    }
    if (s.standard && s.standard !== this.settings.standard) {
      this.msg(T('Lo stato di «{name}» e’ stato salvato in {std}: scegli lo standard {std} per riprenderlo. Lo stato resta memorizzato.', {name: game.display, std: s.standard}), 'warn');
      return false;
    }
    let con, warnings;
    try {
      con = this._buildConsole(bios, game, this.settings.standard);
      warnings = con.loadState(s);
    } catch (e) {
      this.msg(e instanceof SnapshotError ? T(e.message) : T('Stato non ripreso: {m}', {m: T(e.message)}), 'bad');
      return false;
    }
    if (this.con && this.gameId !== null && this.gameId !== id) this.memorize(true);
    this._install(con, id, warnings);
    this.framesRun = MIN_RESUME_FRAMES;
    this.msg(T('Ripresa la partita di «{name}».', {name: game.display}), 'good');
    return true;
  }

  // tasto RESET della console (la cartuccia resta inserita)
  resetConsole() {
    if (!this.con) return false;
    this.con.resetButton();
    if (this.audio) this.audio.restart(this.con.cpu.now);
    if (this.sink) this.sink.flush();
    this.input.releaseAll();
    this.blackWarned = false; this.runMs = 0;
    this.msg('Reset della console.', '');
    return true;
  }

  // ---------------------------------------------------------------- cambio di macchina automatico per i giochi «solo Videopac+»
  setAutoMachine(on) {
    this.autoMachine = !!on;
    if (this.autoMachine) this.machineManual = false;       // riaccendere l'interruttore restituisce il comando alla pagina
    this.changed();
    return this.autoMachine;
  }
  // vero se la lista delle cartucce segna il gioco «solo Videopac+» (non funziona sul G7000)
  gamePlusOnly(game) {
    if (!game || !game.data) return false;
    const m = matchGame(gameInfo([game], [describeGame(game, this.lib.names)]));
    return !!(m && m.plusOnly);
  }
  // cambia macchina senza riavviare niente (serve a start / resume, che costruiscono la console subito dopo)
  _quietMachine(kind) {
    const cands = this.machineCandidates(kind);
    if (!cands.length) return false;
    const cur = this.bios;
    const b = cur && cands.some((x) => x.id === cur.id) ? cur : (cands.find((x) => x.known) || cands[0]);
    const mono = isMono(kind);
    this.machinePref = kind;
    if (this.look.mono !== mono) this.look = Object.assign({}, this.look, {mono});
    this.lookRev++;
    this.biosId = b.id;
    this.settings.standard = defaultStandard(kind);
    return true;
  }
  _autoMachineFor(game) {
    if (!game || !this.bios) return;
    const need = this.gamePlusOnly(game);
    const cur = this.machineKey;
    if (need) {
      if (cur === 'g7400') return;
      if (!this.autoMachine || this.machineManual) {
        this.msg(T('Questo gioco e’ segnato «solo Videopac+» nella lista delle cartucce: con la macchina in uso potrebbe non funzionare (scegli il Videopac+ G7400).'), 'warn');
        return;
      }
      if (!this.machineCandidates('g7400').length) {
        this.msg(T('Questo gioco e’ segnato «solo Videopac+» nella lista delle cartucce, ma manca il BIOS del Videopac+ G7400: aggiungilo con «Aggiungi file» in «Macchina e giochi».'), 'warn');
        return;
      }
      const prev = cur;
      if (this._quietMachine('g7400')) {
        this._autoPrev = prev;
        this.msg(T('Gioco «solo Videopac+» (dalla lista delle cartucce): passo al Videopac+ G7400.'), 'good');
      }
    } else if (this._autoPrev && cur === 'g7400' && this.autoMachine && !this.machineManual) {
      const back = this._autoPrev;
      this._autoPrev = null;
      if (this._quietMachine(back)) this.msg(T('Gioco normale: torno a «{label}».', {label: T(LABELS[back])}), '');
    }
  }

  selectBios(id) {
    const b = this.lib.getBios(id);
    if (!b) return false;
    this.machineManual = true; this._autoPrev = null;
    if (!b.supported) { this.msg(T('BIOS «{name}» non utilizzabile: {reason}.', {name: b.display, reason: T(b.reason)}), 'warn'); this.changed(); return false; }
    if (id === this.biosId) return true;
    const had = !!this.con;
    if (had) {
      // prova prima: se la console con il BIOS nuovo non si costruisce, non cambia niente
      try { this._buildConsole(b, this.game, this.settings.standard); } catch (e) { this.msg(T('BIOS non utilizzabile: {m}', {m: T(e.message)}), 'bad'); return false; }
      this.memorize(true);
    }
    this.biosId = id;
    this._syncMachine();
    if (had) {
      this.msg(T('BIOS «{name}»: la console riparte (avvio a freddo del gioco in uso).', {name: b.display}), '');
      const old = this.gameId;
      this.gameId = null;                    // lo stato del gioco e' gia' stato memorizzato sopra (con l'impronta del BIOS di allora)
      if (!this.start(old)) this.gameId = old;
    }
    this.changed();
    return true;
  }

  setStandard(std) {
    if (std !== 'PAL' && std !== 'NTSC') throw new Error('standard non valido');
    if (std === this.settings.standard) return;
    this._pinMachine();                       // la macchina scelta non cambia da sola con lo standard (G7000 resta G7000 anche in NTSC)
    this.settings.standard = std;
    if (this.con) {
      const old = this.gameId;
      this.memorize(true);
      this.gameId = null;
      this.msg(T('Standard {std}: la console riparte (avvio a freddo del gioco in uso).', {std}), '');
      if (!this.start(old)) this.gameId = old;
    }
    this.changed();
  }

  unload() {
    if (this.audio) this.audio.detach();
    if (this.sink) this.sink.flush();
    this.con = null; this.audio = null; this.gameId = null;
    this.changed();
  }

  setPaused(p) {
    this.paused = !!p;
    this.acc = 0; this.last = null;
    if (this.sink) { if (this.paused) this.sink.flush(); }
    this.changed();
  }

  setVolume(v) { this.settings.volume = v; if (this.sink && this.sink.ctx) this.sink.setVolume(v); }
  setMuted(m) { this.settings.muted = !!m; if (this.sink && this.sink.ctx) this.sink.setMuted(!!m); }

  // ---------------------------------------------------------------- aspetto (solo uscita: l'emulazione non cambia)
  // Cambia una o piu' impostazioni dell'aspetto ({blur: 30, mono: true, ...}); se un valore non e' valido non cambia niente e lo dice.
  // il pulsante «Filtri CRT» sotto lo schermo (copia del selettore dell'Aspetto): passa all'insieme pronto successivo; ritorna il nome del nuovo insieme
  // ('esatto' | 'leggero' | 'anni80' | 'custom'). Quando lascia un aspetto personalizzato lo mette da parte per ripresentarlo dopo «anni '80».
  cycleLook() {
    if (presetOf(this.look) === 'custom') this.customLook = pickFilters(this.look);
    const n = nextPreset(this.look, this.customLook);
    this.setLook(n.look);
    return n.name;
  }
  setLook(partial) {
    let c;
    try { c = checkLook(partial); } catch (e) {
      if (!(e instanceof LookError)) throw e;
      this.msg(T('Aspetto non cambiato: {m}.', {m: T(e.message)}), 'bad');
      return false;
    }
    this.look = Object.assign({}, this.look, c);
    this.lookRev++;
    return true;
  }
  // ---------------------------------------------------------------- macchina (tappa 5c: si sceglie la macchina, non il BIOS)
  // Le sei macchine (machines.js KINDS) con: se c'e' un BIOS per farla girare e che cosa manca altrimenti.
  machineChoices() {
    return KINDS.map((kind) => {
      const n = this.machineCandidates(kind).length;
      return {kind, label: LABELS[kind], available: n > 0, bios: n, reason: n > 0 ? '' : NEEDS[kind]};
    });
  }
  // I BIOS utilizzabili da una macchina (nell'ordine dell'elenco).
  machineCandidates(kind) {
    return this.lib.bios.filter((b) => b.supported && fitsBios(kind, b.sha));
  }
  // la macchina da mostrare: {kind, auto, why} oppure null (nessun BIOS)
  get machine() {
    const b = this.bios;
    if (!b) return null;
    return pickMachine({sha: b.sha, standard: this.settings.standard, mono: this.look.mono, override: this.machinePref});
  }
  get machineKey() { const m = this.machine; return m ? m.kind : null; }

  // Sceglie la macchina: fissa insieme BIOS (quello in uso se va bene, altrimenti il primo adatto), standard video (Odyssey 2 = NTSC, le altre PAL)
  // e schermo (G7200 = bianco e nero). Se BIOS o standard cambiano, il gioco in uso riparte a freddo (la partita si memorizza prima);
  // G7000 <-> G7200 cambia solo i colori. Se la console con la macchina nuova non si costruisce, non cambia niente.
  selectMachine(kind) {
    if (!KINDS.includes(kind)) { this.msg('Macchina sconosciuta.', 'bad'); return false; }
    this.machineManual = true; this._autoPrev = null;
    const cands = this.machineCandidates(kind);
    if (!cands.length) { this.msg(T('{label}: {needs}. Aggiungilo con «Aggiungi file».', {label: T(LABELS[kind]), needs: T(NEEDS[kind])}), 'warn'); this.changed(); return false; }
    const cur = this.bios;
    const b = cur && cands.some((x) => x.id === cur.id) ? cur : (cands.find((x) => x.known) || cands[0]);
    const std = defaultStandard(kind), mono = isMono(kind);
    const restart = !!this.con && (b.id !== this.biosId || std !== this.settings.standard);
    if (restart) {
      try { this._buildConsole(b, this.game, std); } catch (e) { this.msg(T('Macchina non utilizzabile: {m}', {m: T(e.message)}), 'bad'); return false; }
      this.memorize(true);
    }
    this.machinePref = kind;
    if (this.look.mono !== mono) this.look = Object.assign({}, this.look, {mono});
    this.lookRev++;
    this.biosId = b.id;
    this.settings.standard = std;
    if (restart) {
      this.msg(T('{label}: la console riparte (avvio a freddo del gioco in uso).', {label: T(LABELS[kind])}), '');
      const old = this.gameId;
      this.gameId = null;                    // lo stato del gioco e' gia' stato memorizzato sopra (con le impronte di BIOS e standard di allora)
      if (!this.start(old)) this.gameId = old;
    }
    this.changed();
    return true;
  }
  // fissa la macchina ricavata (se era 'auto'), cosi' non cambia piu' quando cambiano standard o BIOS
  _pinMachine() {
    if (this.machinePref === 'auto') { const m = this.machine; if (m) this.machinePref = m.kind; }
  }
  // una macchina che non va col BIOS in uso torna 'auto' (si ricava dal BIOS)
  _syncMachine() {
    const b = this.bios;
    if (this.machinePref !== 'auto' && b && !fitsBios(this.machinePref, b.sha)) { this.machinePref = 'auto'; this.lookRev++; }
  }

  setBindings(b) { this.input.setBindings(b); this.changed(); }

  // scambio dei comandi dei giocatori 1 e 2 (giochi a turni giocati da soli): i tasti e il gamepad del giocatore 1 muovono il joystick 2 e viceversa.
  // Resta acceso cambiando gioco e dopo il reset; si salva nella sessione.
  get swapPads() { return !!this.settings.swapPads; }
  setSwapPads(on) {
    const v = !!on;
    if (v === this.swapPads && this.input.swap === v) return true;
    this.settings.swapPads = v;
    this.input.setSwap(v);
    this.changed();
    return true;
  }
  get bindings() { return this.input.bindings; }

  // ---------------------------------------------------------------- stato su file (un solo gioco: stato + impronte, mai i dump)
  saveStateFile() {
    if (!this.con) return null;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const base = this.game ? this.game.display.replace(/[^A-Za-z0-9._ -]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) : 'o2web';
    return {name: (base || 'o2web') + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.o2state',
      bytes: Console.encodeState(this.con.saveState())};
  }

  // carica un .o2state: cerca nell'elenco il BIOS e la cartuccia con le impronte dello stato e li mette in uso
  loadStateFile(bytes, name) {
    let s;
    try { s = Console.decodeState(bytes); } catch (e) { this.msg((name || T('File')) + ': ' + T(e instanceof SnapshotError ? e.message : 'stato non valido: ' + e.message), 'bad'); return false; }
    if (!s || !s.hashes || typeof s.hashes.bios !== 'string' || typeof s.hashes.cart !== 'string') { this.msg((name || T('File')) + ': ' + T('non e’ uno stato di gioco di questo emulatore.'), 'bad'); return false; }
    const bios = this.lib.findBiosBySha(s.hashes.bios);
    const game = s.hashes.cart ? this.lib.findGameBySha(s.hashes.cart) : null;
    if (!bios) { this.msg((name || T('Stato')) + ': ' + T('e’ di un BIOS che non e’ nell’elenco: aggiungilo e riprova.'), 'bad'); return false; }
    if (s.hashes.cart && !game) { this.msg((name || T('Stato')) + ': ' + T('e’ di una cartuccia che non e’ nell’elenco: aggiungila e riprova.'), 'bad'); return false; }
    if (!bios.supported) { this.msg(T('BIOS dello stato non utilizzabile: {reason}.', {reason: T(bios.reason)}), 'bad'); return false; }
    const std = s.standard === 'NTSC' ? 'NTSC' : 'PAL';
    let con, warnings;
    try { con = this._buildConsole(bios, game, std); warnings = con.loadState(s); } catch (e) {
      this.msg(e instanceof SnapshotError ? T(e.message) : T('Stato non caricato: {m}', {m: T(e.message)}), 'bad');
      return false;
    }
    if (this.con && this.gameId !== null && (!game || this.gameId !== game.id)) this.memorize(true);
    this.biosId = bios.id;
    this.settings.standard = std;
    this._install(con, game ? game.id : null, warnings);
    this.framesRun = MIN_RESUME_FRAMES;
    this.msg(T('Stato caricato') + (name ? ': ' + name : '') + '.', 'good');
    return true;
  }

  // ---------------------------------------------------------------- sessione (contiene i dump: file personale)
  currentSettings() {
    return {scale: this.settings.scale, aspect: this.settings.aspect, integer: this.settings.integer, volume: this.settings.volume, muted: this.settings.muted, pinB: this.settings.pinB, swapPads: !!this.settings.swapPads, bindings: this.input.bindings,
      look: Object.assign({}, this.look), machine: this.machinePref};
  }

  saveSession(created) {
    if (this.con) this.memorize(false);
    return S.buildSession({lib: this.lib, activeGameId: this.gameId, activeBiosId: this.biosId, standard: this.settings.standard, states: this.states,
      charset: this.charset, efCharset: this.efCharset, chessRom: this.chessRom, settings: this.currentSettings(), created: created || new Date().toISOString()});
  }

  // Apre una sessione: valida tutto su copie; solo se va bene sostituisce elenco, stati, impostazioni e partita
  async loadSession(bytes, name) {
    let parsed, restored;
    try {
      parsed = S.parseSession(bytes);
      restored = S.restoreLibrary(parsed);
    } catch (e) {
      this.msg((name ? name + ': ' : T('Sessione') + ': ') + T(e instanceof S.SessionError ? e.message : 'non letta: ' + e.message) + ' ' + T('La partita in corso non e’ stata toccata.'), 'bad');
      return false;
    }
    const lib = restored.lib;
    const settings = Object.assign({}, this.settings, {standard: parsed.standard});
    for (const k of ['scale', 'aspect', 'integer', 'volume', 'muted', 'pinB', 'swapPads']) if (k in parsed.settings) settings[k] = parsed.settings[k];
    const look = Object.assign({}, this.look, parsed.settings.look || {});           // le chiavi mancanti (sessioni di prima della tappa 4b) restano come sono
    const machinePref = 'machine' in parsed.settings ? parsed.settings.machine : this.machinePref;
    const charset = parsed.charset, efCharset = parsed.efCharset, chessRom = parsed.chessRom;
    let biosId = restored.activeBiosId;
    if (biosId === null) { const b = firstUsableBios(lib.bios); biosId = b ? b.id : null; }
    const bios = biosId === null ? null : lib.getBios(biosId);
    // la macchina e' una sola scelta e BIOS, standard e schermo la seguono: una macchina che non va col BIOS (sessioni di prima della tappa 5c, che avevano solo
    // una scelta «mostrata») si ricava dal BIOS, dallo standard e dal B/N; il B/N e' acceso solo con il G7200
    let machineKind = machinePref, look2 = look;
    if (bios) {
      if (machineKind !== 'auto' && !fitsBios(machineKind, bios.sha)) machineKind = 'auto';
      if (machineKind === 'auto') machineKind = pickMachine({sha: bios.sha, standard: settings.standard, mono: look.mono}).kind;
      if (look.mono !== isMono(machineKind)) look2 = Object.assign({}, look, {mono: isMono(machineKind)});
    }
    // prepara la macchina sulla copia: se non si costruisce, la sessione si apre lo stesso ma ferma
    let con = null, gameId = null, notes = [], how = '';
    const game = restored.activeGameId === null ? null : lib.getGame(restored.activeGameId);
    if (bios && bios.supported && game) {
      const st = restored.states.get(game.id);
      const over = {charset, efCharset, chessRom, pinB: settings.pinB};
      try {
        con = this._buildConsole(bios, game, settings.standard, over);
        gameId = game.id;
        how = 'avviata a freddo';
        if (st) {
          if (st.hashes.bios === bios.sha && (!st.standard || st.standard === settings.standard)) {
            try { notes = con.loadState(st); how = 'ripresa dallo stato memorizzato'; } catch (e) {
              con = this._buildConsole(bios, game, settings.standard, over);
              notes = [T('Lo stato memorizzato del gioco in uso non si e’ potuto riprendere ({m}): avvio a freddo.', {m: T(e.message)})];
            }
          } else notes = [T('Lo stato memorizzato del gioco in uso e’ di un altro BIOS o standard: avvio a freddo (lo stato resta memorizzato).')];
        }
      } catch (e) { con = null; gameId = null; notes = [T('Il gioco in uso non si avvia: {m}', {m: T(e.message)})]; }
    }
    // tutto pronto: si sostituisce
    if (this.audio) this.audio.detach();
    this.lib = lib;
    this.states = restored.states;
    this.settings = settings;
    this.look = look2; this.machinePref = machineKind; this.lookRev++;
    this.charset = charset; this.charsetName = charset ? 'dalla sessione' : '';
    this.efCharset = efCharset; this.efCharsetName = efCharset ? 'dalla sessione' : '';
    this.chessRom = chessRom; this.chessRomName = chessRom ? 'dalla sessione' : '';
    this.biosId = biosId;
    this.gameId = null;
    this.con = null; this.audio = null;
    if (parsed.settings.bindings) this.input.setBindings(parsed.settings.bindings);
    this.input.setSwap(!!settings.swapPads);
    if (this.sink && this.sink.ctx) { this.sink.setVolume(settings.volume); this.sink.setMuted(settings.muted); }
    if (con) {
      this._install(con, gameId, notes);
      this.framesRun = how === 'ripresa dallo stato memorizzato' ? MIN_RESUME_FRAMES : 0;
    } else {
      for (const n of notes) this.msg(n, 'warn');
      if (this.sink) this.sink.flush();
    }
    this.msg(T('Sessione aperta') + (name ? ': ' + name : '') + ' (' + T('{g} giochi, {b} BIOS, {s} stati memorizzati', {g: lib.games.length, b: lib.bios.length, s: this.states.size}) + ')' +
      (con ? '; ' + T('partita ' + how) + '.' : '.'), 'good');
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- passo di temporizzazione
  pollPads(list) { this.input.setPads(assignPads(list, this.padPrefs)); }

  applyInputs() {
    const con = this.con;
    if (!con) return;
    const s = this.input.snapshot();
    con.keyRows.set(s.rows);
    con.joy[0] = s.joy[0];
    con.joy[1] = s.joy[1];
  }

  get audioPaced() { return !!(this.audio && this.sink && this.sink.running); }

  // chiamata a ogni rAF con l'ora in ms; ritorna il numero di fotogrammi emulati (0 = non ridisegnare)
  step(ts) {
    const con = this.con;
    if (!con) return 0;
    const dt = this.last === null ? 0 : Math.min(ts - this.last, 100);
    this.last = ts;
    if (this.paused) return 0;
    this.applyInputs();
    const period = con.frameCycles / con.cyclesPerSecond;
    let n = 0;
    if (this.audioPaced) {
      this.acc = 0;
      n = framesToRun(this.sink.queued(), LEAD, period, MAX_CATCHUP);
    } else {
      this.acc += dt / 1000;
      while (this.acc >= period && n < 3) { this.acc -= period; n++; }
    }
    for (let i = 0; i < n; i++) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      con.runFrame();
      this.msPerFrame.push((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      if (this.audio) {
        this.audio.advance(con.cpu.now);
        if (this.sink && this.sink.ctx) this.sink.push(this.audio.take());
        else this.audio.take();
      }
    }
    this.framesRun += n;
    this.runMs += dt;
    if (!this.blackWarned && this.runMs > 3000) {
      this.blackWarned = true;
      let any = false;
      for (let i = 0; i < con.fb.length; i++) if (con.fb[i] !== 0) { any = true; break; }
      if (!any) {
        this.msg(T('Lo schermo e’ ancora nero dopo 3 secondi. Controlla che il BIOS sia quello di Odyssey 2 / Videopac G7000 (1024 byte), che la cartuccia sia di un gioco per questa console (un gioco Videopac+ G7400 chiede il BIOS G7400), e prova l’altro standard (PAL / NTSC). Alcune schermate di gioco sono nere all’inizio: se il gioco risponde ai tasti, ignora questo messaggio.'), 'warn');
      }
    }
    return n;
  }

  takeStats() {
    const a = this.msPerFrame;
    this.msPerFrame = [];
    return a.length ? {avg: a.reduce((x, y) => x + y, 0) / a.length, n: a.length} : null;
  }
}

module.exports = {App, layoutSize, isImageFile, sniffSession, sniffState, LEAD, MAX_CATCHUP, MIN_RESUME_FRAMES, makeGame, makeBios, validateBindings};
