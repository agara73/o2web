'use strict';
// (c) 2026 by Agara73 - SPDX-License-Identifier: GPL-3.0-only - emulatore Odyssey 2 / Videopac per browser
// run_cases.js IN.json OUT.json [--vectors]  - esegue i casi di difftest.py sul nucleo JavaScript
const fs = require('fs');
const {runCase} = require('./lib_case.js');
const [, , inFile, outFile, flag] = process.argv;
const cases = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const res = cases.map((c) => runCase(c, flag === '--vectors'));
fs.writeFileSync(outFile, JSON.stringify(res));
