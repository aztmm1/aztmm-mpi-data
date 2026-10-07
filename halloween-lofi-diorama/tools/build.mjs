#!/usr/bin/env node
// Inline every <script src> of index.html into one self-contained HTML file.
//   node tools/build.mjs [--out dist/kitty-diary-2026.html]
//   node tools/build.mjs --artifact [--out dist/kitty-diary-2026.artifact.html]
//     (--artifact emits head + body content without the html/head/body
//      wrappers, for hosts that supply their own document skeleton)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from './lib.mjs';

const a = parseArgs();
const artifact = !!a.artifact;
const out = path.resolve(ROOT, a.out || (artifact ? 'dist/kitty-diary-2026.artifact.html' : 'dist/kitty-diary-2026.html'));
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return '<script>\n/* ' + src + ' */\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
if (artifact) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/\s*<meta[^>]*>\s*/g, '\n');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024).toFixed(1) + ' KiB');
