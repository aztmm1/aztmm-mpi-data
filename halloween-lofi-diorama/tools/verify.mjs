#!/usr/bin/env node
// Automated checks for the 10-hour loop requirements.
//   node tools/verify.mjs [--loop 240] [--quick]
// 1. static scan: no Math.random / Date / wall-clock time, no anti-aliased canvas APIs
// 2. seamless loop: frame(t) == frame(t + LOOP) evaluated WITHOUT wrapping time
// 3. stateless: seeking gives identical pixels no matter what was rendered before,
//    and a fresh page load renders identical pixels (deterministic init)
// 4. seam smoothness: the LOOP->0 transition changes no more than a normal frame step
// 5. performance at 1920x1080 and JS heap stability over thousands of frames
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, openDiorama, parseArgs } from './lib.mjs';

const a = parseArgs();
const quick = !!a.quick;
let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const warn = (msg) => console.log('WARN ' + msg);

// ---------- 1. static scan ----------
const srcDir = path.join(ROOT, 'src');
const banned = [
  [/Math\.random\s*\(/, 'Math.random (use HD.hash / HD.rng)', 'error'],
  [/Date\.now\s*\(|new Date\s*\(/, 'wall-clock Date', 'error'],
  [/performance\.now\s*\(/, 'performance.now outside engine', 'error', 'engine.js'],
  [/imageSmoothingEnabled\s*=\s*true/, 'image smoothing enabled', 'error'],
  [/\b(ctx|context|c)\.(arc|arcTo|ellipse)\s*\(/, 'anti-aliased arc/ellipse path', 'warn'],
  [/create(Linear|Radial|Conic)Gradient/, 'smooth gradient (use dithered bands)', 'warn'],
  [/\.filter\s*=|shadowBlur/, 'canvas blur/filter', 'warn'],
  [/fillText|strokeText/, 'canvas text', 'warn'],
  [/\.stroke\s*\(/, 'anti-aliased stroke', 'warn'],
  [/requestAnimationFrame|setInterval|setTimeout/, 'timers in modules (rendering must be a pure function of t)', 'error', 'engine.js'],
];
let staticErr = 0;
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join(srcDir, f), 'utf8').split('\n');
  lines.forEach((ln, i) => {
    const code = ln.replace(/\/\/.*$/, '');
    for (const [re, what, level, allowIn] of banned) {
      if (allowIn && f === allowIn) continue;
      if (re.test(code)) {
        const msg = `${f}:${i + 1} ${what}: ${ln.trim().slice(0, 100)}`;
        if (level === 'error') {
          staticErr++;
          console.log('FAIL ' + msg);
        } else warn(msg);
      }
    }
  });
}
if (!staticErr) console.log('PASS static scan');
failed += staticErr;

// ---------- browser checks ----------
const { browser, page, errors } = await openDiorama(
  { loop: a.loop },
  { viewport: { width: 1920, height: 1080 }, args: ['--js-flags=--expose-gc'] },
);
await page.evaluate(() => {
  const HD = window.HD;
  const ctx = HD.buffers.main.getContext('2d');
  window.__frame = (t, nowrap) => {
    HD.renderAt(t, { nowrap });
    return ctx.getImageData(0, 0, HD.W, HD.H).data.slice();
  };
  window.__diff = (A, B) => {
    let n = 0;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d) {
        n++;
        sum += d;
        if (d > max) max = d;
      }
    }
    return { n, sum, max };
  };
  window.__hash = (D) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < D.length; i++) h = Math.imul(h ^ D[i], 16777619) >>> 0;
    return h.toString(16);
  };
});
const LOOP = await page.evaluate(() => window.HD.LOOP);
console.log(`edition ${await page.evaluate(() => window.HD.edition.id)}, loop length ${LOOP}s, modules: ${await page.evaluate(() => window.HD.moduleNames.join(', '))}`);

// ---------- 2. seamless loop ----------
const seam = await page.evaluate((L) => {
  const out = [];
  const ts = [0, 0.37, 1.234, 7.77, L * 0.25 + 0.11, L * 0.5 + 0.71, L * 0.75 + 0.4, L - 0.5, L - 1 / 30];
  for (const t of ts) {
    const A = window.__frame(t, false);
    const B = window.__frame(t + L, true);
    const C = window.__frame(t + 3 * L, true);
    const d1 = window.__diff(A, B);
    const d3 = window.__diff(A, C);
    out.push({ t, n1: d1.n, n3: d3.n });
  }
  return out;
}, LOOP);
const NP = 480 * 270;
for (const s of seam) {
  // tolerate float rounding flipping a handful of pixels on exact .5 boundaries
  ok(s.n1 <= NP * 0.0005 && s.n3 <= NP * 0.001, `loop-periodic at t=${s.t.toFixed(3)}: ${s.n1} px differ at t+LOOP, ${s.n3} at t+3*LOOP`);
}

// ---------- 3. stateless / deterministic ----------
const seek = await page.evaluate(() => {
  const A = window.__frame(5.0);
  for (let i = 0; i < 90; i++) window.__frame(100 + i / 30);
  const B = window.__frame(5.0);
  return { d: window.__diff(A, B).n, h: window.__hash(A) };
});
ok(seek.d === 0, `seek determinism: re-rendering t=5 after other frames differs in ${seek.d} px`);
{
  const second = await openDiorama({ loop: a.loop });
  const h2 = await second.page.evaluate(() => {
    const HD = window.HD;
    HD.renderAt(5.0);
    const D = HD.buffers.main.getContext('2d').getImageData(0, 0, HD.W, HD.H).data;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < D.length; i++) h = Math.imul(h ^ D[i], 16777619) >>> 0;
    return h.toString(16);
  });
  await second.browser.close();
  ok(h2 === seek.h, `fresh page load renders identical frame (hash ${seek.h} vs ${h2})`);
}

// ---------- 3b. live edition switching leaves no residue ----------
{
  const sw = await page.evaluate(() => {
    const HD = window.HD;
    const id = HD.edition.id;
    const A = window.__frame(5.0);
    for (const e of HD.EDITIONS) {
      HD.setEdition(e.id);
      window.__frame(7.3);
    }
    HD.setEdition(id);
    const B = window.__frame(5.0);
    return window.__diff(A, B).n;
  });
  ok(sw === 0, `switching through every edition and back changes ${sw} px`);
}

// ---------- 4. seam smoothness ----------
const smooth = await page.evaluate((L) => {
  const dt = 1 / 30;
  const steps = [];
  for (let k = 0; k < 40; k++) {
    const t = (k * L) / 40 + 0.5;
    steps.push(window.__diff(window.__frame(t), window.__frame(t + dt)).sum);
  }
  steps.sort((p, q) => p - q);
  const seamSum = window.__diff(window.__frame(L - dt), window.__frame(0)).sum;
  return { median: steps[20], p90: steps[36], max: steps[39], seam: seamSum };
}, LOOP);
ok(
  smooth.seam <= Math.max(smooth.max, smooth.p90 * 1.5),
  `seam step LOOP-1/30 -> 0 changes ${smooth.seam} (normal frame steps: median ${smooth.median}, p90 ${smooth.p90}, max ${smooth.max})`,
);

// ---------- 5. performance & heap ----------
const perf = await page.evaluate((n) => {
  const ts = [];
  for (let i = 0; i < n; i++) {
    const a0 = performance.now();
    window.HD.renderAt(17 + i / 30);
    ts.push(performance.now() - a0);
  }
  ts.sort((p, q) => p - q);
  return { avg: ts.reduce((s, v) => s + v, 0) / n, p50: ts[n >> 1], p95: ts[Math.floor(n * 0.95)], max: ts[n - 1] };
}, quick ? 120 : 400);
ok(perf.p95 < 16, `render+present at 1920x1080: avg ${perf.avg.toFixed(2)} ms, p50 ${perf.p50.toFixed(2)}, p95 ${perf.p95.toFixed(2)}, max ${perf.max.toFixed(2)} (budget 16 ms)`);
if (perf.p95 > 8) warn('p95 above 8 ms — fine for 60 fps on desktop, but leaves little headroom on slow machines');

const heap = await page.evaluate((n) => {
  const g = window.gc || (() => {});
  const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
  for (let i = 0; i < 300; i++) window.HD.renderAt(i / 30);
  g();
  const m0 = mem();
  for (let i = 0; i < n; i++) window.HD.renderAt(30 + i / 30);
  g();
  const m1 = mem();
  return { m0, m1 };
}, quick ? 600 : 3000);
const growth = (heap.m1 - heap.m0) / 1048576;
ok(growth < 4, `JS heap after ${quick ? 600 : 3000} frames: ${(heap.m0 / 1048576).toFixed(1)} -> ${(heap.m1 / 1048576).toFixed(1)} MiB (growth ${growth.toFixed(2)} MiB)`);

const hdErr = await page.evaluate(() => window.HD.errors);
ok(errors.length === 0 && hdErr.length === 0, `no runtime errors (${[...errors, ...hdErr].join(' | ') || 'none'})`);
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
