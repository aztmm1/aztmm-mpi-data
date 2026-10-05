#!/usr/bin/env node
// Per-pass frame-time profile (headless Chromium, software canvas — real
// browsers with a GPU are faster, so treat these as upper bounds).
//   node tools/perf.mjs [--frames 300] [--only ...] [--skip ...]
import { openDiorama, parseArgs } from './lib.mjs';

const a = parseArgs();
const n = Number(a.frames ?? 300);
const { browser, page } = await openDiorama({ prof: 1, only: a.only, skip: a.skip }, { viewport: { width: 1920, height: 1080 } });
const r = await page.evaluate((n) => {
  const HD = window.HD;
  for (let i = 0; i < 30; i++) HD.renderAt(i / 30);
  for (const k in HD.prof) delete HD.prof[k];
  const ts = [];
  for (let i = 0; i < n; i++) {
    const a0 = performance.now();
    HD.renderAt(11 + i * 0.7919);
    ts.push(performance.now() - a0);
  }
  ts.sort((p, q) => p - q);
  const rows = Object.entries(HD.prof).map(([k, v]) => [k, v.ms / v.n]);
  rows.sort((p, q) => q[1] - p[1]);
  return { rows, p50: ts[n >> 1], p95: ts[Math.floor(n * 0.95)], avg: ts.reduce((s, v) => s + v, 0) / n };
}, n);
for (const [k, ms] of r.rows) console.log(ms.toFixed(3).padStart(8) + ' ms  ' + k);
console.log(`frame total (incl. 1080p present): avg ${r.avg.toFixed(2)} ms, p50 ${r.p50.toFixed(2)}, p95 ${r.p95.toFixed(2)}`);
await browser.close();
