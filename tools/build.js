#!/usr/bin/env node
/* Inlines src/ into one self-contained HTML file: ./index.html */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const js = ['engine-core.js', 'engine-calc.js', 'engine-import.js', 'engine-demo.js', 'engine-tests.js', 'app-core.js', 'app-views.js', 'app-data.js']
  .map(f => `/* ---- ${f} ---- */\n` + read(f)).join('\n') + '\nwindow.addEventListener("DOMContentLoaded", function () { App.boot(); });\n';
if (/<\/script/i.test(js)) throw new Error('JS contains </script>');
const html = read('index.template.html').replace('/*__CSS__*/', () => read('styles.css')).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB');
