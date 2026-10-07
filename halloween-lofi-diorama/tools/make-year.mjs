#!/usr/bin/env node
// "A Year in Rainy Hollow": every edition back to back, each fading through
// black into the next, in calendar order (Lunar New Year ... New Year's Eve).
//   node tools/make-year.mjs [--minutes 3] [--scale 4] [--crf 18] [--out out/a-year-in-rainy-hollow-3min.mp4]
//   node tools/make-year.mjs --whatsapp      35 s vertical montage, < 16 MB, for chats and Status
// Segments are rendered frame-exactly with tools/render-video.mjs and joined
// without re-encoding.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from './lib.mjs';

const a = parseArgs();
const ORDER = ['lunar', 'spring', 'summer', 'match', 'nyc', 'la', 'sandiego', 'dc', 'home', 'harvest', 'halloween', 'lights', 'winter', 'newyear'];
// the moment each segment starts at (seconds into that edition's loop): the
// goal cheer, the candles, the anniversary heart, the AZTMM logo firework...
const HIGHLIGHT = { lunar: 30, spring: 40, summer: 20, match: 146, nyc: 57, la: 30, sandiego: 30, dc: 94, home: 30, harvest: 60, halloween: 145, lights: 50, winter: 25, newyear: 115 };
// vertical crop (WhatsApp) misses the logo firework, so use a regular burst there
const HIGHLIGHT_WA = { ...HIGHLIGHT, newyear: 60 };

const wa = !!a.whatsapp;
const minutes = Number(a.minutes ?? 3);
// whole frames per segment at 30 fps so every segment cuts cleanly
const seg = Math.floor((wa ? Number(a.segment ?? 2.5) : (minutes * 60) / ORDER.length) * 30) / 30;
const out = path.resolve(ROOT, a.out || (wa ? 'out/rainy-hollow-year-whatsapp.mp4' : `out/a-year-in-rainy-hollow-${minutes}min.mp4`));
const work = path.resolve(ROOT, 'out', wa ? 'year-wa-parts' : 'year-parts');
fs.mkdirSync(work, { recursive: true });

const parts = [];
for (const [i, ed] of ORDER.entries()) {
  const file = path.join(work, `${String(i + 1).padStart(2, '0')}-${ed}.mp4`);
  const start = (wa ? HIGHLIGHT_WA : HIGHLIGHT)[ed];
  const args = ['tools/render-video.mjs', '--edition', ed, '--seconds', String(seg), '--start', String(start), '--fade', wa ? '0.35' : '0.8', '--out', file];
  if (wa) args.push('--crop', '152,0,154,270', '--scale', '7', '--pad', '1080x1920', '--crf', String(a.crf ?? 26), '--preset', 'slow');
  else args.push('--scale', String(a.scale ?? 4), '--crf', String(a.crf ?? 18), '--preset', a.preset || 'medium');
  if (!(a.resume && fs.existsSync(file))) {
    console.log(`[${i + 1}/${ORDER.length}] ${ed}: ${seg}s`);
    const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  parts.push(file);
}
const list = path.join(work, 'parts.txt');
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n') + '\n');
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`wrote ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MiB)`);
