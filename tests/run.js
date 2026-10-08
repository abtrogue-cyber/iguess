#!/usr/bin/env node
/* Runs the engine's hand-calculated checks plus importer tests in Node. */
'use strict';
const path = require('path');
const fs = require('fs');
const src = p => path.join(__dirname, '..', 'src', p);
['engine-core.js', 'engine-calc.js', 'engine-import.js', 'engine-demo.js', 'engine-tests.js'].forEach(f => {
  if (fs.existsSync(src(f))) require(src(f));
});
const PT = globalThis.PT;

let fails = 0;
const fmt = (v, f) => f === 'pct' ? (v * 100).toFixed(4) + ' %' : f === 'num' ? String(+v.toFixed(6)) : v.toFixed(2) + ' €';
console.log('\nHand-calculated verification');
console.log('-'.repeat(110));
for (const t of PT.selfTests()) {
  if (!t.ok) fails++;
  console.log(`${t.ok ? 'PASS' : 'FAIL'}  [${t.group}] ${t.label.padEnd(72)} hand ${fmt(t.hand, t.fmt).padStart(12)}  engine ${fmt(t.engine, t.fmt).padStart(12)}`);
}

const extra = path.join(__dirname, 'import.test.js');
if (fs.existsSync(extra)) fails += require(extra)(PT);

console.log('-'.repeat(110));
console.log(fails ? `${fails} FAILED` : 'All checks passed');
process.exit(fails ? 1 : 0);
