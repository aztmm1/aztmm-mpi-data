// Shared helpers for the CLI tools: launch headless Chromium on index.html.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const groot = execSync('npm root -g').toString().trim();
    return req(path.join(groot, 'playwright'));
  }
}

/** Parse --key value / --flag CLI arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) out[k] = true;
    else {
      out[k] = nxt;
      i++;
    }
  }
  return out;
}

/**
 * Open the diorama in export mode. `query` is merged into the URL
 * (e.g. {only:'house,bg'}, {view:'light'}, {loop:240}).
 */
export async function openDiorama(query = {}, { html = 'index.html', viewport = { width: 960, height: 540 }, args = [] } = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  // every tool accepts --edition <id> (see src/editions.js)
  const cli = parseArgs();
  if (cli.edition && query.edition === undefined) query = { ...query, edition: cli.edition };
  // never touch the network (the page only links an optional web font)
  await page.route(/^https?:\/\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const q = new URLSearchParams({ export: '1', ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')) });
  const url = pathToFileURL(path.isAbsolute(html) ? html : path.join(ROOT, html)).href + '?' + q.toString();
  await page.goto(url);
  await page.waitForFunction(() => window.HD && window.HD.isReady === true, null, { timeout: 30000 });
  return { browser, page, errors };
}

export function parseCrop(s) {
  if (!s || s === true) return null;
  const [x, y, w, h] = String(s).split(',').map(Number);
  return { x, y, w, h };
}

export function dataUrlToBuffer(u) {
  return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
}
