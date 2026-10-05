#!/usr/bin/env node
// Contact sheet of consecutive frames — review motion as a still image.
//   node tools/sheet.mjs --t0 10 --dt 0.0333 --n 12 --cols 4 --crop 60,180,80,60 --scale 3 --out /tmp/fire.png
//   [--only ...] [--skip ...] [--view ...]
import fs from 'node:fs';
import path from 'node:path';
import { openDiorama, parseArgs, parseCrop, dataUrlToBuffer } from './lib.mjs';

const a = parseArgs();
const t0 = Number(a.t0 ?? 0);
const dt = Number(a.dt ?? 1 / 30);
const n = Number(a.n ?? 12);
const cols = Number(a.cols ?? 4);
const scale = Number(a.scale ?? 2);
const crop = parseCrop(a.crop) || { x: 0, y: 0, w: 480, h: 270 };
const out = a.out || 'sheet.png';
const { browser, page, errors } = await openDiorama({ only: a.only, skip: a.skip, view: a.view, loop: a.loop });
const url = await page.evaluate(([t0, dt, n, cols, k, c]) => {
  const HD = window.HD;
  const rows = Math.ceil(n / cols);
  const gap = 2;
  const tw = c.w * k;
  const th = c.h * k;
  const cv = document.createElement('canvas');
  cv.width = cols * tw + (cols - 1) * gap;
  cv.height = rows * th + (rows - 1) * gap;
  const o = cv.getContext('2d');
  o.fillStyle = '#ff00ff';
  o.fillRect(0, 0, cv.width, cv.height);
  o.imageSmoothingEnabled = false;
  for (let i = 0; i < n; i++) {
    HD.renderAt(t0 + i * dt);
    const x = (i % cols) * (tw + gap);
    const y = Math.floor(i / cols) * (th + gap);
    o.drawImage(HD.buffers.main, c.x, c.y, c.w, c.h, x, y, tw, th);
  }
  return cv.toDataURL('image/png');
}, [t0, dt, n, cols, scale, crop]);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, dataUrlToBuffer(url));
console.log(out);
const hdErr = await page.evaluate(() => window.HD.errors);
for (const e of [...errors, ...hdErr]) console.error('ERROR', e);
await browser.close();
process.exit(errors.length || hdErr.length ? 2 : 0);
