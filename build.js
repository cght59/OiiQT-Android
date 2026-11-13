#!/usr/bin/env node
/* Copy the static web app into dist/ for Capacitor. No bundler needed. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const INCLUDE = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'
];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(n => copy(path.join(src, n), path.join(dst, n)));
  } else fs.copyFileSync(src, dst);
}
INCLUDE.forEach(n => {
  const p = path.join(ROOT, n);
  if (fs.existsSync(p)) copy(p, path.join(OUT, n));
});
// Capacitor serves from capacitor://localhost; SW is unnecessary inside the APK.
const sw = path.join(OUT, 'sw.js');
if (fs.existsSync(sw)) fs.rmSync(sw);
console.log('dist/ ready (' + fs.readdirSync(OUT).join(', ') + ')');
