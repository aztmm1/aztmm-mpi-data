#!/usr/bin/env node
// Export the seamless loop as a video, rendering frame-exactly (no screen capture).
//   node tools/render-video.mjs --out out/kitty-diary-loop-1080p.mp4
//     [--fps 30] [--scale 4]          4 = 1920x1080, 8 = 3840x2160
//     [--codec h264|h265|prores|lossless] [--crf 14] [--preset slow]
//     [--seconds N] [--start S]       default: exactly one loop from t=0
//     [--loop 240]                    loop length in seconds (must match the page)
//     [--crop x,y,w,h]                render only this region of the 480x270 frame
//     [--pad WxH]                     centre the scaled picture on a black WxH canvas
//   e.g. vertical 9:16 short: --loop 60 --crop 152,0,154,270 --scale 7 --pad 1080x1920
//     [--fade S]                      fade in from / out to black over S seconds
//     [--edition id]                  which Rainy Hollow edition to render
// Frame i shows t = start + i/fps, and frame LOOP*fps would equal frame 0,
// so repeating the file back-to-back is seamless.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openDiorama, parseArgs, parseCrop } from './lib.mjs';

const a = parseArgs();
const fps = Number(a.fps ?? 30);
const scale = Number(a.scale ?? 4);
const codec = String(a.codec || 'h264');
const crop = parseCrop(a.crop) || { x: 0, y: 0, w: 480, h: 270 };
const pad = a.pad ? String(a.pad).split('x').map(Number) : null;
const { browser, page, errors } = await openDiorama({ loop: a.loop });
const LOOP = await page.evaluate(() => window.HD.LOOP);
const seconds = Number(a.seconds ?? LOOP);
const start = Number(a.start ?? 0);
const frames = Math.round(seconds * fps);
if (Math.abs(frames - seconds * fps) > 1e-6) throw new Error('seconds * fps must be a whole number of frames');
if (!a.seconds && Math.abs(LOOP * fps - Math.round(LOOP * fps)) > 1e-6) throw new Error(`LOOP (${LOOP}s) * fps (${fps}) is not whole: the loop would not be seamless`);
const ext = codec === 'prores' ? '.mov' : codec === 'lossless' ? '.mkv' : '.mp4';
const out = path.resolve(a.out || `out/kitty-diary-loop-${270 * scale}p${ext}`);
fs.mkdirSync(path.dirname(out), { recursive: true });

const SW = crop.w * scale;
const SH = crop.h * scale;
const [OW, OH] = pad || [SW, SH];
if (OW < SW || OH < SH) throw new Error(`--pad ${OW}x${OH} is smaller than the scaled picture ${SW}x${SH}`);
const fade = Number(a.fade || 0);
const padF =
  (pad ? `,pad=${OW}:${OH}:${(OW - SW) >> 1}:${(OH - SH) >> 1}:color=black` : '') +
  (fade > 0 ? `,fade=t=in:st=0:d=${fade},fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}` : '');
const color709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const vfYuv = `scale=${SW}:${SH}:flags=neighbor:out_color_matrix=bt709:out_range=tv${padF}`;
const enc = {
  h264: ['-vf', vfYuv + ',format=yuv420p', '-c:v', 'libx264', '-preset', a.preset || 'slow', '-crf', String(a.crf ?? 14), '-tune', 'animation', '-g', String(fps * 2), ...color709, '-movflags', '+faststart'],
  h265: ['-vf', vfYuv + ',format=yuv420p', '-c:v', 'libx265', '-preset', a.preset || 'slow', '-crf', String(a.crf ?? 16), '-tag:v', 'hvc1', '-x265-params', 'log-level=error', ...color709, '-movflags', '+faststart'],
  prores: ['-vf', vfYuv + ',format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', ...color709],
  lossless: ['-vf', `scale=${SW}:${SH}:flags=neighbor${padF},format=rgb24`, '-c:v', 'libx264rgb', '-crf', '0', '-preset', 'veryfast'],
}[codec];
if (!enc) throw new Error('unknown codec ' + codec);

const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${crop.w}x${crop.h}`, '-r', String(fps), '-i', '-', ...enc, '-r', String(fps), out], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));
const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

console.log(`rendering ${frames} frames (${seconds}s @ ${fps} fps, loop ${LOOP}s) -> ${OW}x${OH} ${codec}: ${out}`);
const BATCH = 8;
const t0 = Date.now();
let lastPct = -1;
for (let i = 0; i < frames; i += BATCH) {
  const n = Math.min(BATCH, frames - i);
  const list = await page.evaluate(
    ([i0, n, fps, start, c]) => {
      const HD = window.HD;
      const ctx = HD.buffers.main.getContext('2d');
      const r = [];
      for (let k = 0; k < n; k++) {
        HD.renderAt(start + (i0 + k) / fps);
        const d = ctx.getImageData(c.x, c.y, c.w, c.h).data;
        let s = '';
        for (let j = 0; j < d.length; j += 0x8000) s += String.fromCharCode.apply(null, d.subarray(j, j + 0x8000));
        r.push(btoa(s));
      }
      return r;
    },
    [i, n, fps, start, crop],
  );
  for (const b64 of list) await write(Buffer.from(b64, 'base64'));
  const pct = Math.floor(((i + n) / frames) * 100);
  if (pct !== lastPct && pct % 5 === 0) {
    lastPct = pct;
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`  ${pct}%  ${i + n}/${frames} frames  ${el.toFixed(0)}s elapsed\n`);
  }
}
ff.stdin.end();
await done;
const hdErr = await page.evaluate(() => window.HD.errors);
await browser.close();
for (const e of [...errors, ...hdErr]) console.error('ERROR', e);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MiB)`);
