/*
 * Halloween Lofi Diorama — core engine
 * ------------------------------------------------------------------
 * Everything is rendered into a 480x270 pixel buffer and scaled up by an
 * integer factor (x4 = 1920x1080, x8 = 3840x2160), so every art pixel stays
 * a perfectly sharp square.
 *
 * The whole picture is a pure function of time t in [0, LOOP). Nothing keeps
 * state between frames, so the animation can be seeked to any instant, loops
 * seamlessly at t = LOOP, and cannot drift no matter how long it runs.
 *
 * Frame pipeline:
 *   1. lights   modules add the light sources for this frame -> lightmap
 *   2. bg       unlit backdrop (sky, moon, clouds, hills, far rain) -> main
 *   3. scene    night-coloured props drawn on their own buffer, then warmed
 *               by the lightmap ("relit") and composited onto main.
 *               Pixels drawn with g.em.* are emissive and skip relighting.
 *   4. fx       particles / atmosphere / post drawn straight onto main
 *               (engine adds: puddle reflections z=20, light halos z=55)
 *   5. present  nearest-neighbour upscale to the on-screen canvas
 */
(function () {
  'use strict';

  const HD = (window.HD = window.HD || {});
  const params = new URLSearchParams(location.search);
  const W = 480;
  const H = 270;
  const NPIX = W * H;

  const num = (k, d) => {
    const v = parseFloat(params.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const flag = (k, d) => {
    if (!params.has(k)) return d;
    const v = params.get(k);
    return !(v === '0' || v === 'false' || v === 'off');
  };

  HD.W = W;
  HD.H = H;
  HD.params = params;
  HD.num = num;
  HD.flag = flag;
  HD.LOOP = Math.min(3600, Math.max(10, num('loop', 240)));
  HD.errors = [];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (k) => k * k * (3 - 2 * k);
  HD.clamp = clamp;
  HD.lerp = lerp;
  HD.smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));

  // ------------------------------------------------------------------
  // Hashing & seeded randomness (no Math.random anywhere at runtime)
  // ------------------------------------------------------------------
  function mix32(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
  }
  /** Deterministic hash of up to four integers -> [0, 1). */
  function hash(a, b, c, d) {
    let h = mix32((a | 0) + 0x9e3779b9);
    h = mix32(h ^ (((b | 0) + 0x85ebca6b) >>> 0));
    h = mix32(h ^ (((c | 0) + 0xc2b2ae35) >>> 0));
    h = mix32(h ^ (((d | 0) + 0x27d4eb2f) >>> 0));
    return h / 4294967296;
  }
  HD.hash = hash;
  /** Seeded PRNG (mulberry32) for build-time generation in init(). */
  HD.rng = function (seed) {
    let s = (seed | 0) ^ 0x5bd1e995;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ------------------------------------------------------------------
  // Loop-periodic time helpers.  Every period is snapped so that a whole
  // number of cycles fits into LOOP — that is what makes the loop seamless.
  // ------------------------------------------------------------------
  const TAU = Math.PI * 2;
  /** cycles per loop for a desired period (seconds) */
  function cyclesFor(period) {
    return Math.max(1, Math.round(HD.LOOP / Math.max(1e-6, period)));
  }
  /** phase in [0,1) of a loop-safe oscillator with ~period seconds */
  function phase(t, period, offset) {
    const u = (t * cyclesFor(period)) / HD.LOOP + (offset || 0);
    return u - Math.floor(u);
  }
  /** loop-safe sine in [-1,1] */
  function wave(t, period, offset) {
    return Math.sin(TAU * phase(t, period, offset));
  }
  /** loop-safe smooth value noise in [0,1]; features change every ~period seconds */
  function noise(t, period, seed) {
    const n = cyclesFor(period);
    const u = (t * n) / HD.LOOP;
    const fl = Math.floor(u);
    const f = u - fl;
    const i1 = ((fl % n) + n) % n;
    const i0 = (i1 - 1 + n) % n;
    const i2 = (i1 + 1) % n;
    const i3 = (i1 + 2) % n;
    const s = seed | 0;
    const p0 = hash(s, i0, 91);
    const p1 = hash(s, i1, 91);
    const p2 = hash(s, i2, 91);
    const p3 = hash(s, i3, 91);
    // Catmull-Rom spline through the lattice values (C1-smooth motion)
    const f2 = f * f;
    const f3 = f2 * f;
    const v =
      0.5 *
      (2 * p1 +
        (-p0 + p2) * f +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
    return clamp(v, 0, 1);
  }
  /** fractal loop-safe noise: octaves halve the period each step */
  function fbm(t, period, seed, octaves) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let p = period;
    const o = octaves || 3;
    for (let k = 0; k < o; k++) {
      sum += noise(t, p, (seed | 0) * 7 + k * 131) * amp;
      norm += amp;
      amp *= 0.5;
      p *= 0.5;
    }
    return sum / norm;
  }
  /**
   * Fire/candle flicker in roughly [0,1]: slow breathing + quick dances +
   * rare dips. `speed` > 1 makes it nervier.
   */
  function flicker(t, seed, speed) {
    const sp = speed || 1;
    const slow = noise(t, 1.7 / sp, seed * 13 + 1);
    const mid = noise(t, 0.42 / sp, seed * 13 + 2);
    const fast = noise(t, 0.11 / sp, seed * 13 + 3);
    return clamp(0.45 * slow + 0.35 * mid + 0.2 * fast, 0, 1);
  }
  /** quantise time to a frame-rate for "on-the-twos" sprite animation */
  function step(t, fps) {
    return Math.floor(t * fps + 1e-6) / fps;
  }

  /**
   * Stateless particle cycle. Particle `i` of a system restarts every
   * ~period seconds (snapped so it loops), staggered by a hashed offset.
   * Returns a SHARED object (overwritten by the next call):
   *   age  0..1 progress through the current life
   *   c    cycle index (wrapped, so it repeats after LOOP)
   *   prev previous cycle index (e.g. for splashes where the last drop landed)
   *   P    actual period in seconds
   *   rnd(k [,cycle]) per-cycle random in [0,1)
   */
  const CYC = {
    age: 0,
    c: 0,
    prev: 0,
    n: 1,
    P: 1,
    _s: 0,
    _i: 0,
    rnd(k, cyc) {
      return hash(this._s, this._i, cyc === undefined ? this.c : cyc, k);
    },
  };
  function cycle(t, i, period, seed) {
    const n = cyclesFor(period);
    const P = HD.LOOP / n;
    const off = hash(seed | 0, i | 0, 7777, 3);
    const u = t / P + off;
    const fl = Math.floor(u);
    CYC.age = u - fl;
    CYC.c = ((fl % n) + n) % n;
    CYC.prev = (CYC.c - 1 + n) % n;
    CYC.n = n;
    CYC.P = P;
    CYC._s = seed | 0;
    CYC._i = i | 0;
    return CYC;
  }

  HD.time = { TAU, cyclesFor, phase, wave, noise, fbm, flicker, step, cycle };

  // ------------------------------------------------------------------
  // Ordered dithering
  // ------------------------------------------------------------------
  const BAYER8 = new Float32Array(64);
  (function () {
    const m = [
      [0, 32, 8, 40, 2, 34, 10, 42],
      [48, 16, 56, 24, 50, 18, 58, 26],
      [12, 44, 4, 36, 14, 46, 6, 38],
      [60, 28, 52, 20, 62, 30, 54, 22],
      [3, 35, 11, 43, 1, 33, 9, 41],
      [51, 19, 59, 27, 49, 17, 57, 25],
      [15, 47, 7, 39, 13, 45, 5, 37],
      [63, 31, 55, 23, 61, 29, 53, 21],
    ];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) BAYER8[y * 8 + x] = (m[y][x] + 0.5) / 64;
  })();
  /** Bayer threshold in (0,1) for pixel (x,y) */
  function bayer(x, y) {
    return BAYER8[((y & 7) << 3) | (x & 7)];
  }
  HD.bayer = bayer;

  // ------------------------------------------------------------------
  // Colour helpers
  // ------------------------------------------------------------------
  const hexCache = new Map();
  function hex(c) {
    let v = hexCache.get(c);
    if (v) return v;
    let s = c.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    v = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    hexCache.set(c, v);
    return v;
  }
  function css(r, g, b) {
    const to = (v) => {
      const s = clamp(Math.round(v), 0, 255).toString(16);
      return s.length < 2 ? '0' + s : s;
    };
    return '#' + to(r) + to(g) + to(b);
  }
  /** mix two hex colours -> hex (use at init time / in ramps, not per pixel) */
  function mixHex(a, b, k) {
    const A = hex(a);
    const B = hex(b);
    return css(lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k));
  }
  /** n-step ramp of hex strings between a and b (inclusive) */
  function ramp(a, b, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(mixHex(a, b, n === 1 ? 0 : i / (n - 1)));
    return out;
  }
  HD.color = { hex, css, mix: mixHex, ramp };

  // ------------------------------------------------------------------
  // Pixel graphics API. Only integer-aligned fillRect / drawImage are
  // used, so nothing is ever anti-aliased.
  // ------------------------------------------------------------------
  function makeGfx(ctx, maskCtx) {
    let cur = null;
    const set = (c) => {
      if (c !== cur) {
        ctx.fillStyle = c;
        cur = c;
      }
    };
    const R = maskCtx
      ? (x, y, w, h) => {
          ctx.fillRect(x, y, w, h);
          maskCtx.fillRect(x, y, w, h);
        }
      : (x, y, w, h) => ctx.fillRect(x, y, w, h);
    const r = Math.round;

    const g = {
      ctx,
      W,
      H,
      /** forget cached fillStyle (call if you touched ctx.fillStyle directly) */
      reset() {
        cur = null;
        if (maskCtx) maskCtx.fillStyle = '#fff';
      },
      px(x, y, c) {
        set(c);
        R(r(x), r(y), 1, 1);
      },
      rect(x, y, w, h, c) {
        x = r(x);
        y = r(y);
        w = r(w);
        h = r(h);
        if (w <= 0 || h <= 0) return;
        set(c);
        R(x, y, w, h);
      },
      hline(x0, x1, y, c) {
        x0 = r(x0);
        x1 = r(x1);
        if (x1 < x0) {
          const tmp = x0;
          x0 = x1;
          x1 = tmp;
        }
        set(c);
        R(x0, r(y), x1 - x0 + 1, 1);
      },
      vline(x, y0, y1, c) {
        y0 = r(y0);
        y1 = r(y1);
        if (y1 < y0) {
          const tmp = y0;
          y0 = y1;
          y1 = tmp;
        }
        set(c);
        R(r(x), y0, 1, y1 - y0 + 1);
      },
      /** 1px Bresenham line */
      line(x0, y0, x1, y1, c) {
        x0 = r(x0);
        y0 = r(y0);
        x1 = r(x1);
        y1 = r(y1);
        set(c);
        const dx = Math.abs(x1 - x0);
        const dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < 4096; guard++) {
          R(x0, y0, 1, 1);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= dy) {
            err += dy;
            x0 += sx;
          }
          if (e2 <= dx) {
            err += dx;
            y0 += sy;
          }
        }
      },
      /** filled pixel circle (radius may be fractional) */
      circle(cx, cy, rad, c) {
        cx = r(cx);
        cy = r(cy);
        set(c);
        const rr = rad * rad + rad * 0.6;
        const ry = Math.ceil(rad);
        for (let dy = -ry; dy <= ry; dy++) {
          const s = rr - dy * dy;
          if (s < 0) continue;
          const hw = Math.floor(Math.sqrt(s));
          R(cx - hw, cy + dy, hw * 2 + 1, 1);
        }
      },
      /** 1px pixel-circle outline */
      ring(cx, cy, rad, c) {
        cx = r(cx);
        cy = r(cy);
        set(c);
        const rr = rad * rad + rad * 0.6;
        const ry = Math.ceil(rad);
        let prev = -1;
        for (let dy = -ry; dy <= ry; dy++) {
          const s = rr - dy * dy;
          if (s < 0) continue;
          const hw = Math.floor(Math.sqrt(s));
          const nxt = rr - (Math.abs(dy) + 1) * (Math.abs(dy) + 1);
          const inner = nxt < 0 ? -1 : Math.floor(Math.sqrt(nxt));
          const from = Math.max(inner + 1, 0);
          if (from > hw) {
            R(cx - hw, cy + dy, 1, 1);
            R(cx + hw, cy + dy, 1, 1);
          } else {
            R(cx - hw, cy + dy, hw - from + 1, 1);
            R(cx + from, cy + dy, hw - from + 1, 1);
          }
          prev = hw;
        }
        return prev;
      },
      /** filled ellipse */
      ellipse(cx, cy, rx, ry, c) {
        cx = r(cx);
        cy = r(cy);
        set(c);
        const iy = Math.ceil(ry);
        for (let dy = -iy; dy <= iy; dy++) {
          const k = 1 - (dy * dy) / ((ry + 0.35) * (ry + 0.35));
          if (k < 0) continue;
          const hw = Math.floor((rx + 0.35) * Math.sqrt(k));
          R(cx - hw, cy + dy, hw * 2 + 1, 1);
        }
      },
      /** filled polygon, pts = [[x,y], ...]; sampled at pixel centres */
      poly(pts, c) {
        set(c);
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of pts) {
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        minY = Math.floor(minY);
        maxY = Math.ceil(maxY);
        const xs = [];
        for (let y = minY; y <= maxY; y++) {
          const sy = y + 0.5;
          xs.length = 0;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i];
            const b = pts[j];
            if (a[1] <= sy !== b[1] <= sy) xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
          }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const xa = Math.ceil(xs[k] - 0.5);
            const xb = Math.floor(xs[k + 1] - 0.5);
            if (xb >= xa) R(xa, y, xb - xa + 1, 1);
          }
        }
      },
      /**
       * Ordered-dither fill: a pixel is drawn where bayer(x,y) < level.
       * level 0 = nothing, 1 = solid. (ox, oy) shifts the pattern.
       */
      dither(x, y, w, h, c, level, ox, oy) {
        if (level <= 0) return;
        if (level >= 1) return g.rect(x, y, w, h, c);
        x = r(x);
        y = r(y);
        w = r(w);
        h = r(h);
        const sx = ox | 0;
        const sy = oy | 0;
        set(c);
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++) if (bayer(xx + sx, yy + sy) < level) R(xx, yy, 1, 1);
      },
      /** dithered disc whose density fades towards the rim by `soft` (0..1) */
      ditherCircle(cx, cy, rad, c, level, soft, ox, oy) {
        if (level <= 0 || rad <= 0) return;
        cx = r(cx);
        cy = r(cy);
        const sx = ox | 0;
        const sy = oy | 0;
        const sf = soft || 0;
        set(c);
        const ir = Math.ceil(rad);
        const rr = rad * rad + rad * 0.6;
        for (let dy = -ir; dy <= ir; dy++) {
          for (let dx = -ir; dx <= ir; dx++) {
            const d2 = dx * dx + dy * dy;
            if (d2 > rr) continue;
            let lv = level;
            if (sf > 0) lv *= 1 - sf * Math.sqrt(d2 / rr);
            const px = cx + dx;
            const py = cy + dy;
            if (bayer(px + sx, py + sy) < lv) R(px, py, 1, 1);
          }
        }
      },
      /** blit a pre-rendered canvas/sprite at integer coordinates */
      sprite(img, x, y, flipX) {
        x = r(x);
        y = r(y);
        if (flipX) {
          ctx.save();
          ctx.translate(x + img.width, y);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          ctx.restore();
          if (maskCtx) {
            maskCtx.save();
            maskCtx.translate(x + img.width, y);
            maskCtx.scale(-1, 1);
            maskCtx.drawImage(img, 0, 0);
            maskCtx.restore();
          }
        } else {
          ctx.drawImage(img, x, y);
          if (maskCtx) maskCtx.drawImage(img, x, y);
        }
      },
      /** blit a sub-rectangle of a sprite (e.g. a frame of a sheet) */
      blit(img, sx, sy, sw, sh, x, y) {
        x = r(x);
        y = r(y);
        ctx.drawImage(img, sx, sy, sw, sh, x, y, sw, sh);
        if (maskCtx) maskCtx.drawImage(img, sx, sy, sw, sh, x, y, sw, sh);
      },
    };
    return g;
  }
  HD.makeGfx = makeGfx;

  function newCanvas(w, h, readback) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', readback ? { willReadFrequently: true } : undefined);
    ctx.imageSmoothingEnabled = false;
    return c;
  }
  HD.canvas = newCanvas;

  /** Render something once into an offscreen canvas: HD.bake(w, h, g => {...}) */
  HD.bake = function (w, h, fn) {
    const c = newCanvas(w, h, true);
    const g = makeGfx(c.getContext('2d'));
    fn(g, c);
    return c;
  };

  /**
   * Build a sprite from ASCII rows. `map` maps characters to hex colours;
   * '.' and ' ' are transparent.  HD.sprite(['.ab.', 'abba'], {a:'#123', b:'#456'})
   */
  HD.sprite = function (rows, map) {
    const h = rows.length;
    let w = 0;
    for (const row of rows) w = Math.max(w, row.length);
    return HD.bake(w, h, (g) => {
      for (let y = 0; y < h; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '.' || ch === ' ') continue;
          const c = map[ch];
          if (c) g.px(x, y, c);
        }
      }
    });
  };

  // ------------------------------------------------------------------
  // Buffers
  // ------------------------------------------------------------------
  const main = newCanvas(W, H, true);
  const mainCtx = main.getContext('2d');
  const scene = newCanvas(W, H, true);
  const sceneCtx = scene.getContext('2d');
  const emc = newCanvas(W, H, true);
  const emCtx = emc.getContext('2d');
  emCtx.fillStyle = '#fff';

  const gMain = makeGfx(mainCtx);
  const gScene = makeGfx(sceneCtx);
  gScene.em = makeGfx(sceneCtx, emCtx);
  HD.buffers = { main, scene, emissive: emc };

  // ------------------------------------------------------------------
  // Lights & relighting
  // ------------------------------------------------------------------
  // Night colours are painted as they look under cold ambient light. A light
  // adds   night * (1/AMBIENT) * lightColour * intensity * falloff
  // i.e. it reveals the "true" warm albedo hidden in the night colour.
  const AMB = [0.34, 0.38, 0.52];
  const INV_AMB = AMB.map((v) => 1 / v);
  HD.AMBIENT = AMB;

  const LR = new Float32Array(NPIX);
  const LG = new Float32Array(NPIX);
  const LB = new Float32Array(NPIX);
  const lights = [];
  const mapCache = new Map();

  /**
   * Banded falloff map (pixel-art light pools). Bands are flat with a narrow
   * ordered-dither seam between them; dither is in light-local coordinates so
   * moving lights carry their pattern with them.
   */
  function falloffMap(rx, ry, bands, ditherW, pow) {
    const key = rx + '|' + ry + '|' + bands + '|' + ditherW + '|' + pow;
    let m = mapCache.get(key);
    if (m) return m;
    const w = rx * 2 + 1;
    const h = ry * 2 + 1;
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - rx) / (rx + 0.5);
        const dy = (y - ry) / (ry + 0.5);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        let f = Math.pow(1 - d, pow);
        if (bands > 0) {
          const q = f * bands;
          const b = Math.floor(q);
          const fr = q - b;
          const th = 0.5 + (bayer(x, y) - 0.5) * ditherW;
          f = (b + (fr > th ? 1 : 0)) / bands;
        }
        data[y * w + x] = f;
      }
    }
    m = { w, h, rx, ry, data };
    mapCache.set(key, m);
    return m;
  }

  const LightAPI = {
    /**
     * Add a light for this frame.
     *  x, y      centre (integers recommended)
     *  r         radius in px (ry for an elliptical pool, defaults to r)
     *  color     [r,g,b] multipliers, e.g. HD.LIGHT.fire
     *  i         intensity (0..~2), usually driven by HD.time.flicker
     *  bands     number of flat bands (default 5), dither 0..1 seam width
     *  pow       falloff exponent (default 1.6)
     *  clip      {x0,y0,x1,y1} restrict to a rectangle (e.g. only the ground)
     *  halo      {r, a, color?} additive glow sprite drawn in fx at z=55
     */
    add(o) {
      if (!o || !(o.i > 0)) return;
      lights.push(o);
    },
    list: lights,
  };
  HD.lights = LightAPI;

  function buildLightmap() {
    LR.fill(0);
    LG.fill(0);
    LB.fill(0);
    for (const l of lights) {
      const rx = Math.max(1, Math.round(l.r));
      const ry = Math.max(1, Math.round(l.ry || l.r));
      const m = falloffMap(rx, ry, l.bands === undefined ? 5 : l.bands, l.dither === undefined ? 0.55 : l.dither, l.pow || 1.6);
      const cx = Math.round(l.x);
      const cy = Math.round(l.y);
      const col = l.color || [1, 0.6, 0.3];
      const kr = col[0] * l.i;
      const kg = col[1] * l.i;
      const kb = col[2] * l.i;
      let x0 = cx - rx;
      let y0 = cy - ry;
      let x1 = cx + rx;
      let y1 = cy + ry;
      const cl = l.clip;
      if (cl) {
        x0 = Math.max(x0, cl.x0);
        y0 = Math.max(y0, cl.y0);
        x1 = Math.min(x1, cl.x1);
        y1 = Math.min(y1, cl.y1);
      }
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(W - 1, x1);
      y1 = Math.min(H - 1, y1);
      for (let y = y0; y <= y1; y++) {
        const my = (y - cy + ry) * m.w;
        const row = y * W;
        for (let x = x0; x <= x1; x++) {
          const f = m.data[my + (x - cx + rx)];
          if (f === 0) continue;
          const p = row + x;
          LR[p] += kr * f;
          LG[p] += kg * f;
          LB[p] += kb * f;
        }
      }
    }
  }

  /** Sample the current lightmap (fx can tint rain/smoke by it). */
  const LS = [0, 0, 0];
  LightAPI.rgb = function (x, y) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) {
      LS[0] = LS[1] = LS[2] = 0;
      return LS;
    }
    const p = y * W + x;
    LS[0] = LR[p];
    LS[1] = LG[p];
    LS[2] = LB[p];
    return LS;
  };
  LightAPI.lum = function (x, y) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const p = y * W + x;
    return 0.4 * LR[p] + 0.45 * LG[p] + 0.15 * LB[p];
  };

  const view = params.get('view') || '';

  function relight() {
    const img = sceneCtx.getImageData(0, 0, W, H);
    const d = img.data;
    const em = emCtx.getImageData(0, 0, W, H).data;
    if (view === 'albedo') {
      sceneCtx.putImageData(img, 0, 0);
      return;
    }
    for (let p = 0, q = 0; p < NPIX; p++, q += 4) {
      if (d[q + 3] === 0 || em[q + 3] !== 0) continue;
      const lr = LR[p];
      const lg = LG[p];
      const lb = LB[p];
      if (lr + lg + lb < 0.004) continue;
      const r = d[q];
      const g = d[q + 1];
      const b = d[q + 2];
      d[q] = r + r * INV_AMB[0] * lr;
      d[q + 1] = g + g * INV_AMB[1] * lg;
      d[q + 2] = b + b * INV_AMB[2] * lb;
    }
    sceneCtx.putImageData(img, 0, 0);
  }

  // glow sprites (additive halos) — banded, dithered, cached per radius/colour
  const glowCache = new Map();
  function glowSprite(rad, col) {
    const key = rad + '|' + col.join(',');
    let s = glowCache.get(key);
    if (s) return s;
    const rr = Math.max(2, Math.round(rad));
    const m = falloffMap(rr, rr, 6, 0.8, 2.2);
    s = HD.bake(m.w, m.h, (g, c) => {
      const cx = c.getContext('2d');
      const im = cx.createImageData(m.w, m.h);
      for (let i = 0; i < m.data.length; i++) {
        const f = m.data[i];
        im.data[i * 4] = clamp(255 * col[0] * f, 0, 255);
        im.data[i * 4 + 1] = clamp(255 * col[1] * f, 0, 255);
        im.data[i * 4 + 2] = clamp(255 * col[2] * f, 0, 255);
        im.data[i * 4 + 3] = 255;
      }
      cx.putImageData(im, 0, 0);
    });
    glowCache.set(key, s);
    return s;
  }
  /** Additive banded glow around (x,y) on the fx layer. alpha 0..1 */
  HD.glow = function (g, x, y, rad, color, alpha) {
    if (!(alpha > 0)) return;
    const s = glowSprite(rad, color);
    const ctx = g.ctx;
    const pa = ctx.globalAlpha;
    const pc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(s, Math.round(x) - (s.width >> 1), Math.round(y) - (s.height >> 1));
    ctx.globalAlpha = pa;
    ctx.globalCompositeOperation = pc;
  };

  // ------------------------------------------------------------------
  // Puddle reflections (engine fx pass, z = 20)
  // layout.puddles: [{x, y, rx, ry, mirror, k}] — ellipse in screen space,
  // `mirror` = y of the line being reflected about (base of reflected
  // objects), k = reflectivity 0..1.
  // ------------------------------------------------------------------
  function reflections(g, t) {
    const pud = HD.layout && HD.layout.puddles;
    if (!pud || !pud.length) return;
    for (let pi = 0; pi < pud.length; pi++) {
      const P = pud[pi];
      const cx = Math.round(P.x);
      const cy = Math.round(P.y);
      const rx = Math.round(P.rx);
      const ry = Math.round(P.ry);
      const m = Math.round(P.mirror);
      const k = P.k === undefined ? 0.6 : P.k;
      const yTop = cy - ry;
      const yBot = cy + ry;
      const srcTop = Math.max(0, 2 * m - yBot - 1);
      const x0 = Math.max(0, cx - rx - 2);
      const x1 = Math.min(W - 1, cx + rx + 2);
      const bw = x1 - x0 + 1;
      const bh = yBot - srcTop + 1;
      if (bh <= 0 || bw <= 0) continue;
      const img = mainCtx.getImageData(x0, srcTop, bw, bh);
      const d = img.data;
      const src = new Uint8ClampedArray(d);
      for (let y = yTop; y <= yBot; y++) {
        const dy = (y - cy) / (ry + 0.5);
        const kk = 1 - dy * dy;
        if (kk <= 0) continue;
        const hw = Math.floor((rx + 0.4) * Math.sqrt(kk));
        // gentle horizontal ripple wobble per row (loop-safe)
        const wob = Math.round(0.9 * Math.sin(TAU * (phase(t, 1.9, pi * 0.37) + y * 0.29)));
        const sy = 2 * m - y - 1;
        for (let x = cx - hw; x <= cx + hw; x++) {
          const sx = clamp(x + wob, x0, x1);
          const di = ((y - srcTop) * bw + (x - x0)) * 4;
          const si = ((sy - srcTop) * bw + (sx - x0)) * 4;
          if (sy < srcTop) continue;
          // reflected colour is darker and slightly cooler
          const fr = src[si] * 0.82;
          const fg = src[si + 1] * 0.86;
          const fb = src[si + 2] * 0.95;
          d[di] = d[di] * (1 - k) + fr * k;
          d[di + 1] = d[di + 1] * (1 - k) + fg * k;
          d[di + 2] = d[di + 2] * (1 - k) + fb * k;
        }
      }
      mainCtx.putImageData(img, x0, srcTop);
    }
  }

  function halos(g) {
    for (const l of lights) {
      if (!l.halo) continue;
      const h = l.halo;
      HD.glow(g, h.x === undefined ? l.x : h.x, h.y === undefined ? l.y : h.y, h.r, h.color || l.color, (h.a || 0.2) * Math.min(1.5, l.i));
    }
  }

  // ------------------------------------------------------------------
  // Module registry
  // ------------------------------------------------------------------
  const passes = { bg: [], scene: [], fx: [] };
  const lightFns = [];
  const inits = [];
  const only = params.get('only') ? new Set(params.get('only').split(',')) : null;
  const skip = params.get('skip') ? new Set(params.get('skip').split(',')) : null;
  HD.moduleNames = [];

  /**
   * HD.module(name, {
   *   init(),                       // once, before the first frame (bake sprites here)
   *   lights(t, L),                 // add lights: L.add({...})
   *   passes: [{layer:'bg'|'scene'|'fx', z:Number, draw(g, t)}],
   * })
   * Skip/isolate modules with ?skip=a,b or ?only=a,b
   */
  HD.module = function (name, def) {
    if (only && !only.has(name)) return;
    if (skip && skip.has(name)) return;
    HD.moduleNames.push(name);
    if (def.init) inits.push({ name, fn: def.init });
    if (def.lights) lightFns.push({ name, fn: def.lights });
    for (const p of def.passes || []) {
      const list = passes[p.layer];
      if (!list) throw new Error('HD.module ' + name + ': unknown layer ' + p.layer);
      list.push({ name: name + ':' + (p.id || p.layer + p.z), z: p.z || 0, draw: p.draw });
    }
  };

  HD.module('engine-reflections', { passes: [{ layer: 'fx', z: 20, id: 'reflections', draw: reflections }] });
  HD.module('engine-halos', { passes: [{ layer: 'fx', z: 55, id: 'halos', draw: halos }] });

  const errSeen = new Set();
  function report(name, e) {
    if (errSeen.has(name)) return;
    errSeen.add(name);
    HD.errors.push(name + ': ' + (e && e.stack ? e.stack : e));
    console.error('[HD] ' + name, e);
  }
  function resetCtx(ctx, g) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    g.reset();
    if (g.em) g.em.reset();
  }
  // ?prof=1 records per-pass timings in HD.prof (used by tools/perf.mjs)
  const prof = flag('prof', false) ? (HD.prof = {}) : null;
  function run(list, g, t) {
    for (const p of list) {
      const a = prof ? performance.now() : 0;
      try {
        p.draw(g, t);
      } catch (e) {
        report(p.name, e);
      }
      resetCtx(g.ctx, g);
      if (prof) {
        const e = prof[p.name] || (prof[p.name] = { ms: 0, n: 0 });
        e.ms += performance.now() - a;
        e.n++;
      }
    }
  }

  // ------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------
  function wrapT(t) {
    const L = HD.LOOP;
    return ((t % L) + L) % L;
  }
  HD.wrap = wrapT;

  function render(t) {
    HD.t = t;
    lights.length = 0;
    for (const lf of lightFns) {
      try {
        lf.fn(t, LightAPI);
      } catch (e) {
        report(lf.name + ':lights', e);
      }
    }
    let pa = prof ? performance.now() : 0;
    buildLightmap();
    if (prof) {
      const e = prof['engine:lights+lightmap'] || (prof['engine:lights+lightmap'] = { ms: 0, n: 0 });
      e.ms += performance.now() - pa;
      e.n++;
    }

    resetCtx(mainCtx, gMain);
    mainCtx.fillStyle = '#000';
    mainCtx.fillRect(0, 0, W, H);
    gMain.reset();
    if (view !== 'scene' && view !== 'albedo') run(passes.bg, gMain, t);

    sceneCtx.clearRect(0, 0, W, H);
    emCtx.clearRect(0, 0, W, H);
    resetCtx(sceneCtx, gScene);
    run(passes.scene, gScene, t);
    pa = prof ? performance.now() : 0;
    relight();
    mainCtx.drawImage(scene, 0, 0);
    if (prof) {
      const e = prof['engine:relight'] || (prof['engine:relight'] = { ms: 0, n: 0 });
      e.ms += performance.now() - pa;
      e.n++;
    }

    if (view !== 'scene' && view !== 'albedo') run(passes.fx, gMain, t);

    if (view === 'light') {
      const img = mainCtx.getImageData(0, 0, W, H);
      for (let p = 0; p < NPIX; p++) {
        img.data[p * 4] = clamp(LR[p] * 160, 0, 255);
        img.data[p * 4 + 1] = clamp(LG[p] * 160, 0, 255);
        img.data[p * 4 + 2] = clamp(LB[p] * 160, 0, 255);
        img.data[p * 4 + 3] = 255;
      }
      mainCtx.putImageData(img, 0, 0);
    } else if (view === 'em') {
      mainCtx.fillStyle = '#000';
      mainCtx.fillRect(0, 0, W, H);
      mainCtx.drawImage(emc, 0, 0);
    }
  }

  // ------------------------------------------------------------------
  // Display: integer nearest-neighbour upscale, centred, letterboxed
  // ------------------------------------------------------------------
  let disp = null;
  let dctx = null;
  const fitMode = params.get('fit') || 'int';
  function resize() {
    if (!disp) return;
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.round(window.innerWidth * dpr);
    const vh = Math.round(window.innerHeight * dpr);
    let k = Math.min(vw / W, vh / H);
    if (fitMode !== 'stretch') k = Math.max(1, Math.floor(k + 1e-6));
    const cw = Math.max(W, Math.round(W * k));
    const ch = Math.max(H, Math.round(H * k));
    disp.width = cw;
    disp.height = ch;
    disp.style.width = cw / dpr + 'px';
    disp.style.height = ch / dpr + 'px';
    dctx.imageSmoothingEnabled = false;
  }
  function present() {
    if (!dctx) return;
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(main, 0, 0, disp.width, disp.height);
  }

  // ------------------------------------------------------------------
  // Hooks for tools (screenshots, verification, video export)
  // ------------------------------------------------------------------
  HD.renderAt = function (t, opts) {
    render(opts && opts.nowrap ? t : wrapT(t));
    present();
    return HD.errors.length;
  };
  /** base64 RGBA of the 480x270 frame */
  HD.pixels = function () {
    const d = mainCtx.getImageData(0, 0, W, H).data;
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
    return btoa(s);
  };
  /** PNG data URL of the frame scaled by integer k, optional crop {x,y,w,h} */
  HD.png = function (k, crop) {
    const c = crop || { x: 0, y: 0, w: W, h: H };
    const out = newCanvas(c.w * k, c.h * k);
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(main, c.x, c.y, c.w, c.h, 0, 0, c.w * k, c.h * k);
    return out.toDataURL('image/png');
  };

  // ------------------------------------------------------------------
  // Boot & live loop
  // ------------------------------------------------------------------
  const exportMode = flag('export', false);
  const speed = num('speed', 1);
  const startT = num('t', 0);
  let paused = flag('pause', false);
  let t0 = 0;
  let pausedT = startT;
  let hud = flag('hud', false);
  let hudEl = null;
  let fpsAcc = 0;
  let fpsN = 0;
  let fpsShow = 0;
  let msShow = 0;
  let lastNow = 0;
  let curT = startT;

  function liveT(now) {
    return wrapT(startT + ((now - t0) / 1000) * speed);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const t = paused ? pausedT : liveT(now);
    curT = t;
    const a = performance.now();
    render(t);
    present();
    const ms = performance.now() - a;
    if (hud && hudEl) {
      fpsAcc += now - lastNow;
      fpsN++;
      msShow = msShow * 0.95 + ms * 0.05;
      if (fpsAcc > 500) {
        fpsShow = (fpsN * 1000) / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
      }
      hudEl.textContent =
        't ' + t.toFixed(2) + ' / ' + HD.LOOP + 's   ' + fpsShow.toFixed(0) + ' fps   render ' + msShow.toFixed(2) + ' ms' + (HD.errors.length ? '   ERR ' + HD.errors.length : '');
    }
    lastNow = now;
  }

  function boot() {
    disp = document.getElementById('screen');
    if (disp) {
      dctx = disp.getContext('2d', { alpha: false });
      resize();
      window.addEventListener('resize', resize);
    }
    for (const k of ['bg', 'scene', 'fx']) passes[k].sort((a, b) => a.z - b.z);
    for (const it of inits) {
      try {
        it.fn();
      } catch (e) {
        report(it.name + ':init', e);
      }
    }
    HD.isReady = true;
    if (exportMode || !disp) {
      document.body.classList.add('export');
      return;
    }

    // Respect reduced-motion: start paused and say how to play.
    const hint = document.getElementById('hint');
    if (!params.has('pause') && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paused = true;
      if (hint) hint.textContent = 'Paused because reduced motion is on. Press Space to play.';
    }

    // Keep the screen awake for long sessions (may be refused; that's fine).
    let wakeLock = null;
    const askWake = () => {
      if (document.visibilityState !== 'visible' || !navigator.wakeLock) return;
      navigator.wakeLock
        .request('screen')
        .then((l) => (wakeLock = l))
        .catch(() => {});
    };
    askWake();
    document.addEventListener('visibilitychange', () => {
      if (!wakeLock || wakeLock.released) askWake();
    });

    hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = hud ? 'block' : 'none';
    t0 = performance.now();
    lastNow = t0;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === ' ') {
        if (paused) {
          t0 = performance.now() - ((pausedT - startT) / speed) * 1000;
          paused = false;
        } else {
          pausedT = curT;
          paused = true;
        }
        e.preventDefault();
      } else if (e.key === 'h' || e.key === 'H') {
        hud = !hud;
        if (hudEl) hudEl.style.display = hud ? 'block' : 'none';
      }
    });
    disp.addEventListener('dblclick', toggleFullscreen);
    let idle = null;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.add('idle'), 2000);
    };
    window.addEventListener('mousemove', wake);
    wake();
    requestAnimationFrame(frame);
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) document.exitFullscreen();
  }

  // Module scripts follow engine.js synchronously, so they have all registered
  // by DOMContentLoaded (no need to wait for fonts or other subresources).
  if (document.readyState !== 'loading') setTimeout(boot, 0);
  else document.addEventListener('DOMContentLoaded', boot);
})();
