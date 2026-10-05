#!/usr/bin/env node
// Render a standard set of review images (full frames, zoomed crops, motion
// contact sheets, light view) into one directory, plus an index.md.
//   node tools/review-kit.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';
import { openDiorama, parseArgs, dataUrlToBuffer } from './lib.mjs';

const a = parseArgs();
const out = path.resolve(a.out || 'review');
fs.mkdirSync(out, { recursive: true });

const FULL = [0, 37.3, 91.6, 150.2, 211.9];
const CROPS = [
  ['house', { x: 150, y: 50, w: 160, h: 170 }, 4],
  ['fire-pumpkins', { x: 40, y: 170, w: 140, h: 70 }, 5],
  ['tree-moon-graveyard', { x: 300, y: 0, w: 180, h: 240 }, 3],
  ['soil-section', { x: 0, y: 228, w: 480, h: 42 }, 3],
  ['sky-title-area', { x: 0, y: 0, w: 240, h: 130 }, 3],
  ['porch-steps', { x: 190, y: 160, w: 70, h: 60 }, 6],
  ['far-church-hills', { x: 0, y: 110, w: 180, h: 100 }, 4],
];
const SHEETS = [
  ['fire-motion', 30, 1 / 12, 12, 4, { x: 72, y: 186, w: 48, h: 44 }, 5],
  ['sparks-motion', 30, 1 / 10, 8, 4, { x: 50, y: 80, w: 120, h: 150 }, 2],
  ['rain-motion', 30, 1 / 30, 8, 4, { x: 120, y: 150, w: 140, h: 90 }, 3],
  ['cat-window', 30, 0.4, 16, 8, { x: 226, y: 130, w: 30, h: 34 }, 5],
  ['lantern-swing', 30, 0.3, 12, 6, { x: 192, y: 164, w: 30, h: 40 }, 5],
  ['chimney-smoke', 30, 0.5, 12, 4, { x: 160, y: 20, w: 160, h: 90 }, 2],
  ['jack-flicker', 30, 0.12, 12, 6, { x: 108, y: 206, w: 50, h: 30 }, 5],
  ['moon-clouds-slow', 0, 20, 12, 4, { x: 330, y: 10, w: 140, h: 90 }, 2],
  ['whole-scene-over-loop', 0, 20, 12, 4, { x: 0, y: 0, w: 480, h: 270 }, 1],
];

const { browser, page, errors } = await openDiorama({ loop: a.loop });
const lines = ['# Review kit', ''];
const save = (name, url) => {
  const f = path.join(out, name + '.png');
  fs.writeFileSync(f, dataUrlToBuffer(url));
  return f;
};

for (const t of FULL) {
  const u = await page.evaluate((t) => (window.HD.renderAt(t), window.HD.png(2)), t);
  lines.push(`- full frame t=${t}s (960x540): ${save('full-t' + t, u)}`);
}
{
  const u = await page.evaluate(() => (window.HD.renderAt(91.6), window.HD.png(4)));
  lines.push(`- full frame at true 1080p (1920x1080), t=91.6: ${save('full-1080p-t91.6', u)}`);
}
for (const [name, crop, k] of CROPS) {
  const u = await page.evaluate(([c, k]) => (window.HD.renderAt(91.6), window.HD.png(k, c)), [crop, k]);
  lines.push(`- crop ${name} ${JSON.stringify(crop)} x${k} at t=91.6: ${save('crop-' + name, u)}`);
}
for (const [name, t0, dt, n, cols, c, k] of SHEETS) {
  const u = await page.evaluate(
    ([t0, dt, n, cols, k, c]) => {
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
        o.drawImage(HD.buffers.main, c.x, c.y, c.w, c.h, (i % cols) * (tw + gap), Math.floor(i / cols) * (th + gap), tw, th);
      }
      return cv.toDataURL('image/png');
    },
    [t0, dt, n, cols, k, c],
  );
  lines.push(`- motion sheet ${name}: ${n} frames from t=${t0}s every ${dt.toFixed(3)}s, crop ${JSON.stringify(c)} x${k}, left-to-right then top-to-bottom: ${save('sheet-' + name, u)}`);
}
await browser.close();
for (const v of ['light', 'albedo']) {
  const s = await openDiorama({ view: v, loop: a.loop });
  const u = await s.page.evaluate(() => (window.HD.renderAt(91.6), window.HD.png(2)));
  lines.push(`- debug view "${v}" t=91.6: ${save('view-' + v, u)}`);
  await s.browser.close();
}
fs.writeFileSync(path.join(out, 'index.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
if (errors.length) console.error(errors.join('\n'));
