'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// run_cached.js CACHE.json  - confronta il nucleo JS con i digest del riferimento salvati da difftest.py --save-cache
// (senza rieseguire Python: serve alla prova di mutazione). Esce con 1 alla prima differenza.
const fs = require('fs');
const {runCase} = require('./lib_case.js');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (let i = 0; i < d.cases.length; i++) {
  let got;
  try { got = runCase(d.cases[i], false); } catch (e) { console.log('caso ' + i + ': eccezione ' + e.message); process.exit(1); }
  const exp = d.expected[i];
  for (let k = 0; k < exp.length; k++) {
    if (got[k] !== exp[k]) { console.log('caso ' + i + ' (' + d.cases[i].kind + '), istruzione ' + k + ': stato diverso'); process.exit(1); }
  }
}
console.log('OK: ' + d.cases.length + ' casi');
