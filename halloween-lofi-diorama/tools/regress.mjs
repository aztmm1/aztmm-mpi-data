#!/usr/bin/env node
// Pixel-exact regression guard for an edition.
//   node tools/regress.mjs --save [--edition halloween]   record frame hashes
//   node tools/regress.mjs [--edition halloween]          compare against them
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, openDiorama, parseArgs } from './lib.mjs';

const a = parseArgs();
const edition = a.edition || 'halloween';
const file = path.join(ROOT, 'tools', `regress-${edition}.json`);
const TIMES = [0, 3.3, 17.25, 46.3, 91.6, 132.4, 148.9, 199.95, 239.9];
const { browser, page } = await openDiorama({ edition });
const hashes = await page.evaluate((ts) => {
  const HD = window.HD;
  const ctx = HD.buffers.main.getContext('2d');
  return ts.map((t) => {
    HD.renderAt(t);
    const D = ctx.getImageData(0, 0, HD.W, HD.H).data;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < D.length; i++) h = Math.imul(h ^ D[i], 16777619) >>> 0;
    return h.toString(16);
  });
}, TIMES);
await browser.close();
if (a.save) {
  fs.writeFileSync(file, JSON.stringify({ edition, times: TIMES, hashes }, null, 2) + '\n');
  console.log('saved', file);
  process.exit(0);
}
const ref = JSON.parse(fs.readFileSync(file, 'utf8'));
let bad = 0;
ref.times.forEach((t, i) => {
  const same = ref.hashes[i] === hashes[i];
  if (!same) bad++;
  console.log((same ? 'SAME ' : 'DIFF ') + `${edition} t=${t}`);
});
console.log(bad ? `${bad} frame(s) changed` : `${edition} edition is pixel-identical to the reference`);
process.exit(bad ? 1 : 0);
