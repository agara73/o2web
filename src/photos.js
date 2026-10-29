'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
//
// photos.js - le FOTO delle macchine (web/photos, con licenza libera scelta e fornita dall'utente) e i loro CREDITI.
// Le foto NON sono coperte dalla GPL del codice: ognuna resta con la propria licenza e va attribuita (autore, licenza, fonte,
// modifiche fatte). Il file web/photos/CREDITS.json elenca per ogni macchina: file, SHA-256, titolo, autore, licenza, indirizzi, modifiche,
// `verified` (true solo se autore e licenza sono stati controllati sulla pagina della fonte) e una nota. Il build (tools/build.js) controlla
// tutto con checkCredits() e mette le immagini nella pagina come indirizzi `data:` (modulo './photos_data.js' generato).
//   FREE_LICENCES                  licenze libere ammesse, con nome e indirizzo
//   checkCredits(credits, kinds)   controlla il contenuto di CREDITS.json (lancia PhotoError); ritorna l'elenco normalizzato
//   creditLine(entry)              riga di credito da mostrare ("autore · licenza"); dice chiaramente quando manca qualcosa
//   needsReview(entry)             true se autore o licenza non sono confermati
const FREE_LICENCES = {
  'CC0-1.0': {label: 'CC0 1.0 (pubblico dominio)', url: 'https://creativecommons.org/publicdomain/zero/1.0/'},
  'PD': {label: 'pubblico dominio', url: null},
  'CC-BY-2.0': {label: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/'},
  'CC-BY-2.5': {label: 'CC BY 2.5', url: 'https://creativecommons.org/licenses/by/2.5/'},
  'CC-BY-3.0': {label: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/'},
  'CC-BY-4.0': {label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/'},
  'CC-BY-SA-2.0': {label: 'CC BY-SA 2.0', url: 'https://creativecommons.org/licenses/by-sa/2.0/'},
  'CC-BY-SA-2.5': {label: 'CC BY-SA 2.5', url: 'https://creativecommons.org/licenses/by-sa/2.5/'},
  'CC-BY-SA-3.0': {label: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/'},
  'CC-BY-SA-4.0': {label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/'},
};
const PENDING = 'da-confermare';                 // licenza non ancora controllata: ammessa solo con verified === false
const MAX_FILE = 120 * 1024;                     // una foto pesa nella pagina: oltre 120 KB si ridimensiona
const FIELDS = ['file', 'sha256', 'title', 'author', 'licence', 'licenceUrl', 'sourceUrl', 'changes', 'verified', 'note'];

class PhotoError extends Error {}

function isHttps(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u); }

// credits: l'oggetto letto da CREDITS.json ({_nota, photos: {tipo: {...}}}); kinds: i tipi di macchina ammessi (machines.js KINDS)
function checkCredits(credits, kinds) {
  if (!credits || typeof credits !== 'object' || Array.isArray(credits) || !credits.photos || typeof credits.photos !== 'object' || Array.isArray(credits.photos)) {
    throw new PhotoError('CREDITS.json: manca l\'elenco «photos»');
  }
  const out = {};
  for (const kind of Object.keys(credits.photos)) {
    const e = credits.photos[kind], at = 'CREDITS.json, ' + kind + ': ';
    if (!kinds.includes(kind)) throw new PhotoError(at + 'macchina sconosciuta');
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new PhotoError(at + 'voce non valida');
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) throw new PhotoError(at + 'campo sconosciuto «' + k + '»');
    for (const k of FIELDS) if (!(k in e)) throw new PhotoError(at + 'manca «' + k + '»');
    if (typeof e.file !== 'string' || !/^[a-z0-9_-]+\.webp$/.test(e.file)) throw new PhotoError(at + 'file non valido (serve un .webp con nome semplice)');
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) throw new PhotoError(at + 'sha256 non valido');
    for (const k of ['title', 'changes', 'note']) if (typeof e[k] !== 'string' || !e[k].trim()) throw new PhotoError(at + '«' + k + '» deve essere un testo non vuoto');
    if (e.author !== null && (typeof e.author !== 'string' || !e.author.trim())) throw new PhotoError(at + 'autore non valido');
    if (typeof e.verified !== 'boolean') throw new PhotoError(at + '«verified» deve essere vero o falso');
    if (e.licence !== PENDING && !Object.prototype.hasOwnProperty.call(FREE_LICENCES, e.licence)) throw new PhotoError(at + 'licenza non libera o sconosciuta «' + e.licence + '»');
    if (e.licence === PENDING && e.verified) throw new PhotoError(at + 'una foto con licenza da confermare non puo\' essere «verified»');
    if (e.verified && !e.author) throw new PhotoError(at + 'una foto «verified» ha bisogno dell\'autore');
    for (const k of ['licenceUrl', 'sourceUrl']) if (e[k] !== null && !isHttps(e[k])) throw new PhotoError(at + k + ' deve essere un indirizzo https');
    if (e.verified && !e.sourceUrl) throw new PhotoError(at + 'una foto «verified» ha bisogno dell\'indirizzo della fonte');
    out[kind] = Object.assign({}, e);
  }
  return out;
}

function licenceLabel(e) {
  if (e.licence === PENDING) return 'licenza da confermare';
  return FREE_LICENCES[e.licence].label;
}
function needsReview(e) { return !e.verified || e.licence === PENDING || !e.author; }
function creditLine(e) {
  return 'Foto: ' + (e.author || 'autore da completare') + ' · ' + licenceLabel(e) + (needsReview(e) ? ' (da verificare)' : '');
}

module.exports = {FREE_LICENCES, MAX_FILE, PENDING, PhotoError, checkCredits, creditLine, licenceLabel, needsReview};
