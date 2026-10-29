'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only
// vplist_infos.js CARTELLA_DEI_DUMP OUT.json - per ogni dump distinto della cartella ricava quello che il programma darebbe all'abbinamento
// (sigla, sigle di rincalzo, titoli, indizio Plus) e lo scrive; serve a test/vplist_vectors.py. Nessun byte di ROM nel file di uscita (solo nomi).
const fs = require('fs');
const path = require('path');
const SRC = process.env.O2_SRC_DIR || path.join(__dirname, '..', 'src');
const {Library} = require(path.join(SRC, 'library.js'));
const {describeGame, stemOf} = require(path.join(SRC, 'gamenames.js'));
const {gameInfo} = require(path.join(SRC, 'gamelist.js'));
function walk(d, out) {
  for (const e of fs.readdirSync(d, {withFileTypes: true})) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(bin|zip|rom)$/i.test(e.name)) out.push(p);
  }
  return out;
}
(async () => {
  const lib = new Library();
  for (const f of walk(process.argv[2], [])) await lib.addFile(path.basename(f), new Uint8Array(fs.readFileSync(f)));
  const seen = new Set(), out = [];
  for (const g of lib.games) {
    if (seen.has(g.sha) || g.chess) continue;
    seen.add(g.sha);
    out.push(gameInfo([g], describeGame(g, null)));
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  if (fs.statSync(process.argv[3]).size === 0) process.exit(1);
  console.log(out.length + ' dump distinti -> ' + process.argv[3]);
})();
