#!/usr/bin/env node
// Render still frames to PNG.
//   node tools/shot.mjs --t 0,12.5 --scale 2 --out /tmp/frame.png
//   [--only bg,house] [--skip weather] [--view light|scene|albedo|em]
//   [--crop x,y,w,h] [--loop 240]
// Multiple --t values produce <out>-t<T>.png files.
import fs from 'node:fs';
import path from 'node:path';
import { openDiorama, parseArgs, parseCrop, dataUrlToBuffer } from './lib.mjs';

const a = parseArgs();
const times = String(a.t ?? '0').split(',').map(Number);
const scale = Number(a.scale ?? 2);
const out = a.out || 'shot.png';
const crop = parseCrop(a.crop);
const { browser, page, errors } = await openDiorama({ only: a.only, skip: a.skip, view: a.view, loop: a.loop });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
for (const t of times) {
  const url = await page.evaluate(([t, k, c]) => {
    window.HD.renderAt(t);
    return window.HD.png(k, c);
  }, [t, scale, crop]);
  const file = times.length > 1 ? out.replace(/\.png$/i, '') + '-t' + t + '.png' : out;
  fs.writeFileSync(file, dataUrlToBuffer(url));
  console.log(file);
}
const hdErr = await page.evaluate(() => window.HD.errors);
for (const e of [...errors, ...hdErr]) console.error('ERROR', e);
await browser.close();
process.exit(errors.length || hdErr.length ? 2 : 0);
