/*
 * house.js - the cottage of Rainy Hollow (scene z 22) and every house light.
 *
 * A crooked two-storey cottage: clapboard ground floor on a stone footing, a
 * jettied half-timber upper storey, a steep sagging slate roof with a round
 * attic window, a stone chimney, a witch-hat turret (violet fish-scale slates,
 * bent tip, crescent finial), an arched plank door with iron straps, a little
 * porch with a swinging lantern, and warm candle-lit windows (one with a black
 * cat watching the rain).
 *
 * All static art is generated once in init() into an offscreen raster so that
 * material, rim-light and occlusion passes can work per pixel; the result is
 * one baked sprite. Per frame we only blit: the house, the window glass (one
 * of NL pre-baked flicker levels per window), the interiors, the door light,
 * the cat and the lantern.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LH = HD.layout.house;
  const clamp = HD.clamp;

  const S = P.stone;
  const W = P.wood;
  const V = P.violet;
  const N = P.night;
  const M = P.moss;
  const A = P.amber;
  const F = P.fire;

  // bake rectangle (covers finial .. steps)
  const BX = 150;
  const BY = 36;
  const BW = 162;
  const BH = 180;
  const HOLE = 'hole';

  // material tags (used by the rim / occlusion passes)
  const TG = { roof: 1, cone: 2, chim: 3, wall: 4, plaster: 5, timber: 6, turret: 7, frame: 8, door: 9, porch: 10, steps: 11, iron: 12, gutter: 13, found: 14, moss: 15, fin: 16, post: 17 };

  // neighbours inside a ramp: dk = one step darker, lt = one step lighter
  const DARK = new Map();
  const LITE = new Map();
  for (const r of [P.night, P.violet, P.stone, P.moss, P.wood, P.soil, P.vine, P.bone, P.moon, P.rain, P.amber, P.fire]) {
    for (let i = 0; i < r.length; i++) {
      if (!DARK.has(r[i])) DARK.set(r[i], r[Math.max(0, i - 1)]);
      if (!LITE.has(r[i])) LITE.set(r[i], r[Math.min(r.length - 1, i + 1)]);
    }
  }
  const dk = (c) => DARK.get(c) || c;
  const lt = (c) => LITE.get(c) || c;
  const at = (ramp, i) => ramp[clamp(Math.round(i), 0, ramp.length - 1)];
  const lum = (c) => {
    const v = HD.color.hex(c);
    return 0.3 * v[0] + 0.55 * v[1] + 0.15 * v[2];
  };
  /** moonlit version of a colour: the night/moon entry a few steps brighter */
  const COLD = N.concat(P.moon);
  function moonlit(c, steps) {
    const l = lum(c);
    let best = 0;
    for (let i = 0; i < COLD.length; i++) if (Math.abs(lum(COLD[i]) - l) < Math.abs(lum(COLD[best]) - l)) best = i;
    return COLD[clamp(best + steps, 0, COLD.length - 1)];
  }

  // ---------------------------------------------------------------------
  // tiny raster for build-time painting
  // ---------------------------------------------------------------------
  function raster() {
    const w = BW;
    const h = BH;
    const col = new Array(w * h).fill(null);
    const tag = new Uint8Array(w * h);
    const ix = (x, y) => {
      x = Math.round(x) - BX;
      y = Math.round(y) - BY;
      return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
    };
    const R = {
      set(x, y, c, tg) {
        const i = ix(x, y);
        if (i < 0) return;
        if (c === undefined) throw new Error('house: undefined colour at ' + x + ',' + y);
        col[i] = c;
        tag[i] = tg | 0;
      },
      get(x, y) {
        const i = ix(x, y);
        return i < 0 ? null : col[i];
      },
      tg(x, y) {
        const i = ix(x, y);
        return i < 0 ? 0 : tag[i];
      },
      mod(x, y, fn) {
        const i = ix(x, y);
        if (i >= 0 && col[i] !== null && col[i] !== HOLE) col[i] = fn(col[i], tag[i]);
      },
      hl(x0, x1, y, c, tg) {
        for (let x = x0; x <= x1; x++) R.set(x, y, c, tg);
      },
      vl(x, y0, y1, c, tg) {
        for (let y = y0; y <= y1; y++) R.set(x, y, c, tg);
      },
      line(x0, y0, x1, y1, c, tg) {
        const dx = Math.abs(x1 - x0);
        const dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let k = 0; k < 999; k++) {
          R.set(x0, y0, c, tg);
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
      /** ASCII stamp; `only` restricts painting to pixels already carrying that tag */
      rows(rows, x0, y0, map, tg, only) {
        for (let y = 0; y < rows.length; y++)
          for (let x = 0; x < rows[y].length; x++) {
            const ch = rows[y][x];
            if (ch === '.' || ch === ' ') continue;
            if (only && R.tg(x0 + x, y0 + y) !== only) continue;
            R.set(x0 + x, y0 + y, map[ch], tg);
          }
      },
      toCanvas() {
        return HD.bake(w, h, (g, cv) => {
          const cx = cv.getContext('2d');
          const im = cx.createImageData(w, h);
          for (let i = 0; i < w * h; i++) {
            const c = col[i];
            if (c === null || c === HOLE) continue;
            const v = HD.color.hex(c);
            im.data[i * 4] = v[0];
            im.data[i * 4 + 1] = v[1];
            im.data[i * 4 + 2] = v[2];
            im.data[i * 4 + 3] = 255;
          }
          cx.putImageData(im, 0, 0);
        });
      },
    };
    return R;
  }

  /** staggered course joints: returns row -> sorted joint x list */
  function courses(seed, x0, x1, minW, maxW) {
    const cache = new Map();
    return function (row) {
      let js = cache.get(row);
      if (!js) {
        const r = HD.rng(seed * 977 + row * 131 + 7);
        js = [];
        let x = x0 - 1 - Math.floor(r() * maxW);
        while (x <= x1 + maxW) {
          js.push(x);
          x += minW + Math.floor(r() * (maxW - minW + 1));
        }
        cache.set(row, js);
      }
      return js;
    };
  }
  function seg(js, x) {
    let k = 0;
    while (k + 1 < js.length && js[k + 1] <= x) k++;
    return k;
  }
  const chk = (x, y) => ((x + y) & 1) === 1;

  // ---------------------------------------------------------------------
  // geometry
  // ---------------------------------------------------------------------
  const BODY = LH.body;
  const RF = LH.roof;
  const TU = LH.turret;
  const CHM = LH.chimney;
  const DOOR = LH.door;
  const PO = LH.porch;
  const STP = LH.steps;
  const LAN = LH.lantern;

  const TX0 = TU.x0;
  const TX1 = TU.x1 - 1;
  const TCX = (TX0 + TX1) / 2;
  const THR = (TX1 - TX0) / 2;

  const SAG = 1.6; // concave roof slopes
  const DIP = 2.4; // slate courses sag in the middle
  function roofL(y) {
    const k = (RF.eave - y) / (RF.eave - RF.peakY);
    return RF.x0 + (RF.peakX - RF.x0) * k + SAG * Math.sin(Math.PI * k);
  }
  function roofR(y) {
    const k = (RF.eave - y) / (RF.eave - RF.peakY);
    const xr = RF.x1 - 1;
    return xr - (xr - RF.peakX) * k - SAG * Math.sin(Math.PI * k);
  }
  const roofDip = (x) => DIP * Math.sin(Math.PI * clamp((x - RF.x0) / (RF.x1 - 1 - RF.x0), 0, 1));
  function coneHW(y) {
    const t = (y - TU.peakY) / (TU.top - TU.peakY);
    if (t < 0) return -1;
    return 0.6 + 14.3 * Math.pow(t, 1.35) + 1.6 * Math.pow(HD.smoothstep(0.78, 1, t), 2);
  }
  const BEND = 4.2;
  function coneCX(y) {
    const k = clamp((TU.peakY + 22 - y) / 22, 0, 1);
    return TCX + BEND * k * k;
  }
  const boardV = (y) => (((y - 164) % 4) + 4) % 4;

  // ---------------------------------------------------------------------
  // window configuration (glass look, flicker, light)
  // ---------------------------------------------------------------------
  const NL = 6; // pre-baked flicker levels per window
  const WCFG = {
    'ground-left': {
      ramp: [F[3], F[4], F[5], F[6], F[7], F[8]],
      src: [0.8, 1.0],
      R: 24,
      seed: 41,
      speed: 1.2,
      amp: 1.0,
      light: { r: 32, i: 0.44, col: [1.0, 0.54, 0.22] },
      halo: 0.1,
      spill: { r: 22, ry: 7, i: 0.4 },
    },
    'ground-right': {
      ramp: [A[3], A[4], A[5], A[6], A[7]],
      src: [0.5, 0.6],
      R: 19,
      seed: 42,
      speed: 0.6,
      amp: 0.55,
      light: { r: 28, i: 0.36 },
      halo: 0.09,
      spill: { r: 18, ry: 6, i: 0.34 },
    },
    'upper-left': { ramp: [A[2], A[3], A[4], A[5]], src: [0.5, 0.75], R: 16, seed: 43, speed: 0.5, amp: 0.5, light: { r: 26, i: 0.32 }, halo: 0.06 },
    'upper-right': { ramp: [A[3], A[4], A[5], A[6], A[7]], src: [0.45, 0.8], R: 21, seed: 44, speed: 0.55, amp: 0.5, light: { r: 32, i: 0.46 }, halo: 0.1 },
    'turret-upper': { arch: true, ramp: [A[2], A[3], A[4], A[5], A[6]], src: [0.5, 0.55], R: 15, seed: 45, speed: 0.6, amp: 0.5, light: { r: 26, i: 0.32 }, halo: 0.07 },
    'turret-lower': {
      arch: true,
      ramp: [A[3], A[4], A[5], A[6], A[7]],
      src: [0.7, 0.82],
      R: 18,
      seed: 46,
      speed: 1.0,
      amp: 0.7,
      light: { r: 26, i: 0.36 },
      halo: 0.09,
      spill: { r: 15, ry: 5, i: 0.28 },
    },
    attic: { ramp: [A[1], A[2], A[3]], src: [0.5, 0.62], R: 8, seed: 47, speed: 0.5, amp: 0.5, light: { r: 16, i: 0.14 }, halo: 0.05 },
  };
  const WINS = LH.windows.map((w) => {
    const c = WCFG[w.id] || WCFG['ground-right'];
    if (w.round) return { w, c, gx: w.cx - 5, gy: w.cy - 5, gw: 11, gh: 11, cx: w.cx, cy: w.cy };
    return { w, c, gx: w.x, gy: w.y, gw: w.w, gh: w.h, cx: w.x + w.w / 2, cy: w.y + w.h / 2 };
  });
  /** shape test for a window grown by g pixels (0 = glass) */
  function winInside(win, x, y, g) {
    const w = win.w;
    if (w.round) {
      const dx = x - w.cx;
      const dy = y - w.cy;
      const r = w.r - 1.4 + g;
      return dx * dx + dy * dy <= r * r + r * 0.6;
    }
    if (x < w.x - g || x > w.x + w.w - 1 + g || y > w.y + w.h - 1 + g || y < w.y - g) return false;
    if (!win.c.arch) return true;
    const rr = w.w / 2;
    const cx = w.x + rr - 0.5;
    const ay = w.y + rr;
    if (y >= ay) return true;
    const dx = x - cx;
    const dy = y - ay;
    const R = rr + 0.4 + g;
    return dx * dx + dy * dy <= R * R;
  }

  /** flicker value 0..1 for a window / light config (quantised to 12 fps) */
  function wflick(t, c) {
    const f = T.flicker(T.step(t, 12), c.seed, c.speed);
    return clamp(0.5 + (f - 0.5) * 2 * c.amp, 0, 1);
  }

  // ---------------------------------------------------------------------
  // build-time painting
  // ---------------------------------------------------------------------
  function paintTurret(R) {
    const top = TU.top + 1;
    const base = TU.base - 1;
    const fnd = courses(3, TX0, TX1, 4, 7);
    for (let y = top; y <= base; y++) {
      for (let x = TX0; x <= TX1; x++) {
        const u = (x - TCX) / THR;
        const q = (u + 0.5) / 0.7 + (chk(x, y) ? 0.14 : -0.14);
        const sh = q < 0 ? -1 : q < 1 ? 0 : 1;
        let c;
        if (y >= 200) {
          const row = y < 203 ? 0 : 1;
          const v = (y - 200) % 3;
          const js = fnd(row);
          const k = seg(js, x);
          const bi = 3 + sh - (HD.hash(row, k, 61) < 0.25 ? 1 : 0);
          if (x === js[k] || (row === 0 && v === 2)) c = S[1];
          else c = at(S, v === 0 ? bi + 1 : row === 1 && v === 2 ? bi - 1 : bi);
        } else if (y >= 159 && y <= 162) {
          c = at(W, (y === 159 ? 4 : y === 162 ? 2 : 3) + sh);
        } else {
          const v = boardV(y);
          const bi = 4 + sh;
          c = at(W, v === 0 ? bi - 2 : v === 3 ? bi + 1 : bi);
        }
        R.set(x, y, c, TG.turret);
      }
    }
    // occlusion under the cone brim
    for (let x = TX0; x <= TX1; x++) {
      R.mod(x, top, (c) => dk(dk(c)));
      R.mod(x, top + 1, dk);
      if (chk(x, top + 2)) R.mod(x, top + 2, dk);
    }
  }

  function paintCone(R) {
    // fish-scale tile (6 x 4), staggered by half a scale per course:
    //   B base, H highlight, O outline (shadow under the scale edge)
    const TILE = ['BBBBBB', 'BBBBBB', 'OBHHBO', 'BOOOOB'];
    const SW = 6;
    for (let y = TU.peakY; y <= TU.top + 1; y++) {
      const hw = coneHW(Math.min(y, TU.top));
      const cx = coneCX(y);
      const xl = Math.round(cx - hw);
      const xr = Math.round(cx + hw);
      for (let x = xl; x <= xr; x++) {
        const u = clamp((x - cx) / Math.max(hw, 0.5), -1, 1);
        const ybot = TU.top + (Math.abs(u) > 0.8 ? 1 : 0);
        if (y > ybot) continue;
        const q = (u + 0.35) / 0.55 + (chk(x, y) ? 0.15 : -0.15);
        const sh = q < 0 ? -1 : q < 1 ? 0 : 1;
        const bi = 3 + sh;
        let c;
        if (y === ybot) c = V[1];
        else if (y === ybot - 1) c = at(V, bi + 1);
        else if (y === ybot - 2) c = at(V, bi - 1);
        else {
          const ry = ybot - 3 - y;
          const rr = Math.floor(ry / 4);
          const v = 3 - (ry % 4);
          const s = Math.asin(u) * hw;
          const pos = s / SW + rr * 0.5 + 0.25;
          const col = Math.floor((pos - Math.floor(pos)) * SW);
          const ch = TILE[v][col];
          c = ch === 'H' ? at(V, bi + 1) : ch === 'O' ? at(V, bi - 2) : at(V, bi);
        }
        R.set(x, y, c, TG.cone);
      }
    }
    // finial: knob, rod and an iron crescent facing the real moon
    const tx = Math.round(coneCX(TU.peakY));
    const ty = TU.peakY;
    R.hl(tx - 1, tx + 1, ty - 1, S[2], TG.fin);
    R.set(tx + 1, ty - 1, S[5], TG.fin);
    R.set(tx, ty - 2, S[2], TG.fin);
    R.vl(tx, ty - 8, ty - 3, S[3], TG.fin);
    R.rows(['..bbcd', '.bbc..', 'bbc...', 'bbc...', 'bbc...', '.bbc..', '..bbcd'], tx - 2, ty - 15, { b: N[7], c: P.moon[0], d: P.moon[1] }, TG.fin);
  }

  function paintChimney(R) {
    const x0 = CHM.x0;
    const x1 = CHM.x1 - 1;
    const top = CHM.top;
    const cs = courses(5, x0, x1, 3, 5);
    for (let y = top + 3; y <= 112; y++) {
      const ry = y - (top + 3);
      const row = Math.floor(ry / 3);
      const v = ry % 3;
      const js = cs(row);
      const lean = row < 2 ? 1 : 0; // the old stack has settled a little to the right
      for (let x = x0; x <= x1; x++) {
        const k = seg(js, x);
        // fieldstone: a mix of pale grey and blue-grey stones, sooty at the top
        const hh = HD.hash(row, k, 31);
        const FS = [S[2], S[3], S[4], P.bone[0], P.bone[1]];
        let tone = hh < 0.3 ? 1 : hh < 0.7 ? 3 : hh < 0.9 ? 2 : 4;
        if (row === 0) tone = 1;
        let c;
        if (v === 2 || x === js[k]) c = S[1];
        else c = FS[v === 0 ? Math.min(4, tone + 1) : tone];
        if (x === x0) c = dk(c);
        R.set(x + lean, y, c, TG.chim);
      }
    }
    R.hl(x0, x1 + 2, top, S[5], TG.chim);
    R.hl(x0, x1 + 2, top + 1, S[4], TG.chim);
    R.hl(x0, x1 + 2, top + 2, S[2], TG.chim);
    R.set(x0, top + 1, S[3], TG.chim);
    R.set(x0, top, S[4], TG.chim);
  }

  function paintBody(R) {
    // --- ground floor: clapboard -------------------------------------
    const x0 = BODY.x0;
    const x1 = BODY.x1 - 1;
    const cb = courses(9, x0, x1, 16, 30);
    for (let y = 163; y <= 199; y++) {
      const v = boardV(y);
      const row = Math.floor((y - 164) / 4);
      const js = cb(row + 10);
      for (let x = x0; x <= x1; x++) {
        const k = seg(js, x);
        const hh = HD.hash(row, k, 17);
        let bi = hh < 0.22 ? 3 : hh > 0.86 ? 5 : 4;
        if (y >= 192 && HD.hash(row, k, 18) < 0.6) bi = 3; // damp splash zone
        let c;
        if (v === 0) c = W[bi - 2];
        else if (x === js[k]) c = W[bi - 2];
        else c = W[v === 3 ? bi + 1 : bi];
        R.set(x, y, c, TG.wall);
      }
    }
    // corner boards
    for (let y = 163; y <= 199; y++) {
      R.set(x0, y, W[3], TG.wall);
      R.set(x0 + 1, y, W[4], TG.wall);
      R.set(x1 - 1, y, W[4], TG.wall);
      R.set(x1, y, W[3], TG.wall);
    }
    // --- foundation ---------------------------------------------------
    const fnd = courses(11, x0 - 1, x1 + 1, 5, 9);
    for (let y = 200; y <= 205; y++) {
      const row = y < 203 ? 0 : 1;
      const v = (y - 200) % 3;
      const js = fnd(row);
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const k = seg(js, x);
        const bi = 3 - (HD.hash(row, k, 62) < 0.3 ? 1 : 0);
        let c;
        if (x === js[k] || (row === 0 && v === 2)) c = S[1];
        else c = at(S, v === 0 ? bi + 1 : row === 1 && v === 2 ? bi - 1 : bi);
        R.set(x, y, c, TG.found);
      }
    }
    // a few moss tufts at the footing
    for (const mx of [171, 199, 243, 262]) {
      R.set(mx, 205, M[3], TG.moss);
      R.set(mx + 1, 205, M[4], TG.moss);
      R.set(mx + 1, 204, M[3], TG.moss);
      R.set(mx + 2, 205, M[2], TG.moss);
    }
    // --- upper storey: plaster + timber frame ------------------------
    const ux0 = x0 - 1;
    const ux1 = x1;
    for (let y = 129; y <= 158; y++) {
      for (let x = ux0; x <= ux1; x++) {
        let c = S[4];
        if (y >= 157) c = S[3];
        R.set(x, y, c, TG.plaster);
      }
    }
    // damp stains and hairline cracks in the plaster
    // solid, irregular damp stains (no dither speckle)
    const stain = (tpl, x, y) => R.rows(tpl, x, y, { s: S[3] }, TG.plaster, TG.plaster);
    stain(['.sss', 'ssss', 'sss.', '.ss.', '..s.'], 169, 150);
    stain(['ss..', 'sss.', '.sss', '..s.'], 257, 133);
    stain(['.ss', 'sss', '.s.'], 220, 150);
    R.line(201, 133, 203, 136, S[3], TG.plaster);
    R.line(203, 136, 202, 138, S[3], TG.plaster);
    R.line(262, 150, 265, 152, S[3], TG.plaster);
    const tim = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) R.set(xx, yy, xx === x ? W[4] : W[3], TG.timber);
    };
    tim(ux0, 129, ux1 - ux0 + 1, 2);
    for (const px of [165, 176, 196, 212, 228, 252]) tim(px, 131, 2, 28);
    tim(269, 131, 3, 28);
    tim(167, 146, 9, 2);
    tim(254, 146, 15, 2);
    // braces
    const brace = (xa, ya, xb, yb) => {
      R.line(xa, ya, xb, yb, W[3], TG.timber);
      R.line(xa + (xb > xa ? 1 : -1), ya, xb, yb + 1, W[2], TG.timber);
    };
    brace(198, 158, 211, 145);
    brace(227, 158, 214, 145);
    brace(254, 158, 268, 144);
    // jetty beam + joist ends
    for (let x = x0 - 2; x <= x1 + 1; x++) {
      R.set(x, 159, W[4], TG.timber);
      R.set(x, 160, W[3], TG.timber);
      R.set(x, 161, W[3], TG.timber);
      R.set(x, 162, W[2], TG.timber);
    }
    for (let x = x0 + 3; x < x1 - 2; x += 9) {
      R.set(x, 163, W[3], TG.timber);
      R.set(x + 1, 163, W[2], TG.timber);
      R.set(x, 164, W[2], TG.timber);
      R.set(x + 1, 164, W[1], TG.timber);
    }
    // occlusion: under the eave and the jetty
    for (let x = ux0; x <= ux1; x++) {
      R.mod(x, 131, dk);
      if (chk(x, 132)) R.mod(x, 132, dk);
      R.mod(x, 165, dk);
      if (chk(x, 166)) R.mod(x, 166, dk);
    }
  }

  function paintRoof(R) {
    const rows = courses(21, RF.x0 - 4, RF.x1 + 4, 6, 10);
    const slip = (rr, k) => HD.hash(rr, k, 9) < 0.06;
    for (let y = RF.peakY; y <= RF.eave + 1; y++) {
      const yy = Math.min(y, RF.eave);
      const xl = Math.round(roofL(yy));
      const xr = Math.round(roofR(yy));
      for (let x = xl; x <= xr; x++) {
        const dip = roofDip(x);
        const gy = RF.eave - 1 + (dip > 1.6 ? 1 : 0); // gutter sags a pixel in the middle
        if (y > gy + 1) continue;
        if (y >= gy) {
          R.set(x, y, y === gy ? S[5] : S[3], TG.gutter);
          continue;
        }
        const rc = RF.eave - 2 + Math.round(dip) - y;
        const rr = Math.floor(rc / 4);
        const v = ((rc % 4) + 4) % 4; // 0 = lip (bottom), 3 = shadow line (top)
        const js = rows(rr);
        const k = seg(js, x);
        const g = (x - RF.x0) / (RF.x1 - RF.x0);
        const h1 = HD.hash(rr, k, 5);
        let ti = 2 + (h1 < 0.05 + 0.75 * g ? 1 : 0);
        if (HD.hash(rr, k, 6) > 0.94) ti -= 1;
        let c;
        if (v === 3) {
          // shadow line - unless the slate above has slipped down over it
          const ja = rows(rr + 1);
          const ka = seg(ja, x);
          if (slip(rr + 1, ka) && x !== ja[ka]) {
            const ta = 2 + (HD.hash(rr + 1, ka, 5) < 0.05 + 0.75 * g ? 1 : 0);
            c = S[ta + 1];
          } else c = S[1];
        } else if (x === js[k]) c = S[1];
        else if (v === 0) {
          const glint = HD.hash(rr, k, 7) < g * 0.8 - 0.1 && k + 1 < js.length && x >= js[k + 1] - 2;
          c = S[ti + (glint ? 2 : 1)];
        } else if (v === 2 && slip(rr, k)) c = S[1];
        else c = S[ti];
        // a cold sheen along the moonward edge
        if (xr - x < 4 && v !== 3 && x !== js[k]) c = lt(c);
        R.set(x, y, c, TG.roof);
      }
    }
    // little ridge finial
    R.vl(RF.peakX, RF.peakY - 3, RF.peakY - 1, W[3], TG.roof);
    R.set(RF.peakX, RF.peakY - 4, W[4], TG.roof);
    // flashing where the roof meets the chimney
    for (let x = CHM.x0; x < CHM.x1; x++) {
      for (let y = RF.peakY; y <= RF.eave; y++) {
        if (R.tg(x, y) === TG.roof) {
          R.set(x, y, S[4], TG.roof);
          break;
        }
      }
    }
    // gutter brackets
    for (let x = RF.x0 + 6; x < RF.x1 - 2; x += 14) R.set(x, RF.eave, S[1], TG.gutter);
    // round attic window: dark slate ring around the frame (eyebrow)
    const a = LH.windows.find((w) => w.round);
    for (let y = a.cy - 9; y <= a.cy + 9; y++)
      for (let x = a.cx - 9; x <= a.cx + 9; x++) {
        const dx = x - a.cx;
        const dy = y - a.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= a.r + 1.7 && d > a.r + 0.7 && dy <= 1) R.set(x, y, S[1], TG.roof);
      }
  }

  function paintGutterPipe(R) {
    // downspout from the left gutter end down the corner of the house
    const pts = [
      [163, 129],
      [163, 130],
      [164, 131],
      [165, 132],
    ];
    for (const [x, y] of pts) {
      R.set(x, y, S[4], TG.gutter);
      R.set(x + 1, y, S[2], TG.gutter);
    }
    for (let y = 133; y <= 202; y++) {
      R.set(165, y, S[4], TG.gutter);
      R.set(166, y, S[3], TG.gutter);
      R.set(167, y, S[1], TG.gutter);
    }
    for (const y of [140, 158, 176, 194]) {
      R.set(165, y, S[2], TG.gutter);
      R.set(166, y, S[1], TG.gutter);
    }
    R.hl(163, 166, 203, S[3], TG.gutter);
    R.hl(163, 166, 204, S[2], TG.gutter);
    R.set(163, 203, S[4], TG.gutter);
  }

  function paintWindows(R) {
    for (const win of WINS) {
      const w = win.w;
      const x0 = win.gx - 4;
      const y0 = win.gy - 4;
      for (let y = y0; y <= y0 + win.gh + 8; y++)
        for (let x = x0; x <= x0 + win.gw + 8; x++) {
          if (winInside(win, x, y, 0)) R.set(x, y, HOLE, TG.frame);
          else if (winInside(win, x, y, 1)) R.set(x, y, W[1], TG.frame);
          else if (winInside(win, x, y, 2)) R.set(x, y, w.round ? W[4] : W[3], TG.frame);
          else if (w.round && winInside(win, x, y, 3)) R.set(x, y, W[2], TG.frame);
        }
      if (w.round) {
        R.hl(w.cx - 3, w.cx + 3, w.cy + w.r + 2, W[5], TG.frame);
        R.hl(w.cx - 2, w.cx + 2, w.cy + w.r + 3, W[2], TG.frame);
        continue;
      }
      const bx0 = w.x - 3;
      const bx1 = w.x + w.w + 2;
      if (!win.c.arch) {
        R.hl(bx0, bx1, w.y - 4, W[4], TG.frame);
        R.hl(bx0, bx1, w.y - 3, W[2], TG.frame);
      } else {
        // keystone over the arch
        R.rows(['.k.', 'kkk', '.k.'], w.x + w.w / 2 - 1.5, w.y - 4, { k: W[4] }, TG.frame);
      }
      const sy = w.y + w.h + 2;
      R.hl(bx0, bx1, sy, W[5], TG.frame);
      R.hl(bx0, bx1, sy + 1, W[2], TG.frame);
      for (let x = bx0 + 1; x <= bx1 - 1; x++) R.mod(x, sy + 2, dk);
    }
  }

  // door geometry
  const DX0 = DOOR.x;
  const DX1 = DOOR.x + DOOR.w - 1;
  const DY0 = DOOR.y;
  const DY1 = DOOR.y + DOOR.h - 1;
  const DCX = (DX0 + DX1) / 2;
  const DAY = DY0 + 8;
  function doorInside(x, y, g) {
    if (x < DX0 - g || x > DX1 + g || y > DY1) return false;
    if (y >= DAY) return true;
    const dx = x - DCX;
    const dy = y - DAY;
    const r = 8.3 + g;
    return dx * dx + dy * dy <= r * r;
  }
  const DOOR_LEAK = []; // [x, y, kind] pixels lit from inside (drawn per frame)
  const PEEP = ['.ooo.', 'oo.oo', 'oo.oo'];
  /** light leaks: peep window, threshold gap, plank crack, keyhole (geometry only) */
  function collectDoorLeak() {
    if (DOOR_LEAK.length) return;
    for (let y = 0; y < PEEP.length; y++)
      for (let x = 0; x < 5; x++) if (PEEP[y][x] === 'o') DOOR_LEAK.push([DX0 + 5 + x, DY0 + 3 + y, 'peep']);
    for (let x = DX0 + 1; x <= DX1 - 1; x++) DOOR_LEAK.push([x, DY1, 'gap']);
    for (let y = 200; y <= 203; y++) DOOR_LEAK.push([DX0 + 11, y, 'crack']);
    DOOR_LEAK.push([DX1 - 3, 194, 'key'], [DX1 - 3, 195, 'key']);
  }

  function paintDoor(R, ed) {
    collectDoorLeak();
    // stone surround (voussoirs on the arch, blocks on the jambs)
    for (let y = DY0 - 4; y <= DY1; y++)
      for (let x = DX0 - 4; x <= DX1 + 4; x++) {
        if (doorInside(x, y, 0) || !doorInside(x, y, 3)) continue;
        let c;
        const ring = doorInside(x, y, 1) ? 0 : doorInside(x, y, 2) ? 1 : 2;
        if (y < DAY + 1) {
          const ang = Math.atan2(y - DAY, x - DCX); // -PI..0 over the arch
          const sgm = (ang + Math.PI) / (Math.PI / 7);
          const fr = sgm - Math.floor(sgm);
          c = fr < 0.13 ? S[2] : ring === 2 ? S[3] : S[4];
          if (Math.floor(sgm) === 3 && ring < 2) c = S[5];
        } else {
          const row = Math.floor((y - DAY - 1) / 4);
          const v = (y - DAY - 1) % 4;
          c = v === 3 ? S[2] : ring === 2 ? S[3] : S[4];
          if (v === 0 && ring < 2) c = S[5];
          if ((row & 1) === 1 && ring === 2 && v !== 3) c = S[2];
        }
        if (ring === 0 && y >= DAY) c = dk(c);
        R.set(x, y, c, TG.door);
      }
    // planks
    for (let y = DY0; y <= DY1; y++)
      for (let x = DX0; x <= DX1; x++) {
        if (!doorInside(x, y, 0)) continue;
        const lx = x - DX0;
        const b = lx >> 2;
        const u = lx & 3;
        const tone = [3, 4, 3, 3][b];
        let c = u === 3 && b < 3 ? W[1] : u === 0 ? W[tone + 1] : W[tone];
        if (!doorInside(x, y - 1, 0)) c = W[1];
        R.set(x, y, c, TG.door);
      }
    // iron straps with rivets and arrow ends
    for (const sy of [185, 198]) {
      for (let x = DX0; x <= DX0 + 10; x++) {
        R.set(x, sy, S[3], TG.iron);
        R.set(x, sy + 1, S[1], TG.iron);
      }
      R.set(DX0 + 11, sy - 1, S[1], TG.iron);
      R.set(DX0 + 11, sy, S[3], TG.iron);
      R.set(DX0 + 11, sy + 1, S[1], TG.iron);
      R.set(DX0 + 11, sy + 2, S[1], TG.iron);
      R.set(DX0 + 12, sy, S[2], TG.iron);
      R.set(DX0 + 12, sy + 1, S[1], TG.iron);
      for (const rx of [DX0 + 2, DX0 + 6]) R.set(rx, sy, S[5], TG.iron);
    }
    // ring pull
    R.rows(['.r.', 'r.r', 'rrr'], DX1 - 4, 190, { r: S[3] }, TG.iron);
    R.set(DX1 - 3, 191, W[1], TG.door);
    // small arched peep window with a centre bar
    R.rows(['..www..', '.w...w.', 'w.....w', 'w.....w', 'wwwwwww'], DX0 + 4, DY0 + 2, { w: W[1] }, TG.door);
    for (let y = 0; y < PEEP.length; y++)
      for (let x = 0; x < 5; x++) if (PEEP[y][x] !== 'o' && x === 2 && y > 0) R.set(DX0 + 5 + x, DY0 + 3 + y, S[1], TG.iron);
    // light leaks: peep window, threshold gap, plank cracks, keyhole
    for (const [x, y] of DOOR_LEAK) R.set(x, y, HOLE, TG.door);
    // a small Halloween wreath: twigs and moss, pumpkin berries, violet bow
    if (ed.id === 'halloween')
      R.rows(
      ['..www..', '.wgwgw.', 'wo...ww', 'ww...gw', 'wg...ow', '.wwbww.', '..bbb..', '.b...b.'],
      DX0 + 4,
      DY0 + 9,
      { w: M[3], g: M[5], o: P.pumpkin[4], b: V[5] },
      TG.door,
    );
  }

  function paintPorch(R) {
    const x0 = PO.x0;
    const x1 = PO.x1 - 1;
    const y0 = PO.roofY;
    const yb = y0 + PO.roofH; // first row under the roof
    // posts with stone plinths and caps
    for (const px of [PO.postL, PO.postR - 1]) {
      for (let y = yb; y <= 205; y++) {
        R.set(px, y, W[4], TG.post);
        R.set(px + 1, y, W[3], TG.post);
      }
      R.hl(px - 1, px + 2, yb, W[3], TG.post);
      R.hl(px - 1, px + 2, 203, S[4], TG.steps);
      R.hl(px - 1, px + 2, 204, S[3], TG.steps);
      R.hl(px - 1, px + 2, 205, S[2], TG.steps);
    }
    // knee braces
    const bl = PO.postL + 2;
    const br = PO.postR - 2;
    for (let k = 0; k < 4; k++) {
      R.set(bl + k, yb + 4 - k, W[3], TG.post);
      R.set(bl + k, yb + 3 - k, W[4], TG.post);
      R.set(br - k, yb + 4 - k, W[3], TG.post);
      R.set(br - k, yb + 3 - k, W[4], TG.post);
    }
    // shingled roof: a shallow trapezoid (hipped ends) of two staggered tab courses
    for (let y = y0; y <= y0 + 3; y++) {
      const inset = Math.max(0, 2 - (y - y0));
      for (let x = x0 + inset; x <= x1 - inset; x++) {
        const v = y - y0;
        const lx = x - x0;
        let c;
        if (v === 0) c = S[5];
        else if (v === 1) c = lx % 3 === 0 ? S[1] : S[3];
        else if (v === 2) c = S[4];
        else c = lx % 3 === 1 ? S[1] : S[2];
        if (x === x0 + inset) c = dk(c);
        R.set(x, y, c, TG.porch);
      }
    }
    // fascia board + scalloped gingerbread trim, sagging a pixel in the middle
    for (let x = x0; x <= x1; x++) {
      const sag = x > x0 + 10 && x < x1 - 9 ? 1 : 0;
      R.set(x, y0 + 4 + sag, W[5], TG.porch);
      R.set(x, y0 + 5 + sag, W[3], TG.porch);
      if (sag) R.set(x, y0 + 4, S[3], TG.porch);
      const lx = x - x0;
      if (x > x0 + 2 && x < x1 - 2) {
        if (lx % 4 !== 0) R.set(x, y0 + 6 + sag, W[4], TG.porch);
        if (lx % 4 === 2) R.set(x, y0 + 7 + sag, W[3], TG.porch);
      }
    }
    // shadow under the porch roof on the wall and door surround
    for (let x = x0 + 1; x <= x1 - 1; x++) {
      for (let y = yb; y <= yb + 2; y++) {
        const tg = R.tg(x, y);
        if (tg === TG.wall || tg === TG.door || tg === TG.frame || tg === TG.timber) {
          if (y < yb + 2 || chk(x, y)) R.mod(x, y, dk);
        }
      }
    }
    // lantern hook
    R.set(LAN.hookX, LAN.hookY, S[2], TG.iron);
  }

  function paintSteps(R) {
    const x0 = STP.x0;
    const x1 = STP.x1 - 1;
    const sc = courses(13, x0, x1, 5, 8);
    // upper step
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      R.set(x, 206, S[5], TG.steps);
      const js = sc(0);
      const k = seg(js, x);
      const jt = x === js[k];
      R.set(x, 207, jt ? S[1] : S[3], TG.steps);
      R.set(x, 208, jt ? S[1] : S[2], TG.steps);
    }
    // lower step
    for (let x = x0; x <= x1; x++) {
      const js = sc(1);
      const k = seg(js, x);
      const jt = x === js[k];
      R.set(x, 209, x > x0 + 1 && x < x1 - 1 ? S[3] : S[4], TG.steps);
      R.set(x, 210, S[4], TG.steps);
      R.set(x, 211, jt ? S[1] : S[3], TG.steps);
      R.set(x, 212, jt ? S[1] : S[2], TG.steps);
    }
    // worn chip and a tuft of moss in a joint
    R.set(x0 + 9, 206, S[3], TG.steps);
    R.set(x1, 210, S[3], TG.steps);
    R.set(x0 + 15, 212, M[3], TG.moss);
    R.set(x0 + 16, 212, M[2], TG.moss);
  }

  function paintMoss(R) {
    const T1 = ['..aa...', '.abba..', 'abbbbba', '.c.cc..'];
    const T2 = ['.aa.', 'abba', '.cc.'];
    const T3 = ['...aa...', '.aabbaa.', 'abbbbbba', 'bbcbbcbb', '.c..c...'];
    const T4 = ['.a.', 'aba', '.c.'];
    const map = { a: M[5], b: M[3], c: M[2] };
    const put = (tpl, x, y) => R.rows(tpl, x, y, map, TG.moss, TG.roof);
    put(T3, 167, 119); // lower-left patch
    put(T1, 177, 122);
    put(T2, 186, 116);
    put(T1, 194, 104); // chimney foot
    put(T4, 183, 109);
    put(T2, 208, 121); // along the eave
    put(T4, 236, 118);
    put(T2, 255, 112);
  }

  function rimPass(R) {
    const rimTags = new Set([TG.roof, TG.cone, TG.chim, TG.turret, TG.porch, TG.gutter, TG.moss]);
    const marks = [];
    for (let y = BY; y < BY + BH; y++)
      for (let x = BX; x < BX + BW; x++) {
        const c = R.get(x, y);
        if (c === null || c === HOLE) continue;
        if (!rimTags.has(R.tg(x, y))) continue;
        if (R.get(x + 1, y) === null) marks.push([x, y, 2]);
        else if (R.get(x + 2, y) === null) marks.push([x, y, 1]);
      }
    for (const [x, y, k] of marks) {
      if (k === 2) R.mod(x, y, (c) => (lum(c) < 30 ? N[6] : P.moon[0]));
      else R.mod(x, y, (c) => moonlit(c, 2));
    }
    // roof edge casts a thin shadow onto the turret wall behind it
    for (let y = BY; y < BY + BH; y++)
      for (let x = BX; x < BX + BW; x++) {
        if (R.tg(x, y) !== TG.turret) continue;
        const l = R.tg(x - 1, y);
        if (l === TG.roof || l === TG.gutter || l === TG.timber || l === TG.plaster || l === TG.wall || l === TG.moss) {
          R.mod(x, y, dk);
          R.mod(x + 1, y, (c) => (chk(x + 1, y) ? dk(c) : c));
        }
      }
    // dark edge on the moon-averted (left) side of the roofs
    for (let y = BY; y < BY + BH; y++)
      for (let x = BX; x < BX + BW; x++) {
        const tg = R.tg(x, y);
        if (tg !== TG.roof && tg !== TG.cone) continue;
        if (R.get(x - 1, y) === null) R.mod(x, y, (c) => dk(dk(c)));
      }
  }

  // ---------------------------------------------------------------------
  // interiors (curtains, silhouettes, mullions) - drawn over the glass
  // ---------------------------------------------------------------------
  function paintInteriors(I, ed) {
    const omit = ed.id === 'halloween' || !KIT.seasons ? NONE : KIT.seasons.omit(ed);
    const byId = {};
    for (const win of WINS) byId[win.w.id] = win;
    const put = (win, lx, ly, c) => {
      if (winInside(win, win.gx + lx, win.gy + ly, 0)) I.set(win.gx + lx, win.gy + ly, c);
    };
    const rows = (win, list, lx, ly, map) => {
      for (let y = 0; y < list.length; y++)
        for (let x = 0; x < list[y].length; x++) {
          const ch = list[y][x];
          if (ch !== '.' && ch !== ' ') put(win, lx + x, ly + y, map[ch]);
        }
    };
    const curtain = (win, side, tie, wTop, wTie, wBot, ca, cb) => {
      for (let ly = 0; ly < win.gh; ly++) {
        let wd;
        if (ly <= tie) wd = wTop + (wTie - wTop) * Math.pow(ly / tie, 1.6);
        else wd = wTie + (wBot - wTie) * Math.pow((ly - tie) / (win.gh - 1 - tie), 0.7);
        wd = Math.round(wd);
        for (let k = 0; k < wd; k++) {
          const lx = side === 0 ? k : win.gw - 1 - k;
          let c = k === wd - 1 ? cb : ca;
          if (k === 1 && wd > 3 && ly > 1) c = cb;
          put(win, lx, ly, c);
        }
      }
      for (let k = 0; k < wTie + 1; k++) put(win, side === 0 ? k : win.gw - 1 - k, tie, A[1]);
    };
    const vbar = (win, lx, y0, y1, w2) => {
      for (let ly = y0; ly <= y1; ly++) {
        put(win, lx, ly, W[1]);
        if (w2) put(win, lx + 1, ly, W[2]);
      }
    };
    const hbar = (win, ly, x0, x1) => {
      for (let lx = x0; lx <= x1; lx++) put(win, lx, ly, W[1]);
    };

    // ground-left: hearth-lit parlour - wing chair and a side table, valance
    let w = byId['ground-left'];
    if (!omit.has('chair')) rows(
      w,
      ['.dddddd..', 'dddddddd.', 'dddddddd.', 'eddddddd.', 'eddddddde', 'eddddddde', 'edddddddd', 'edddddddd', '.d.....d.', '.d.....d.'],
      0,
      12,
      { d: A[0], e: A[1] },
    );
    if (!omit.has('chair')) rows(w, ['.tt..', 'tttt.', 'ssssss', '..s...', '..s...', '..s...', '.sss..'], 11, 15, { t: A[1], s: A[0] });
    for (let lx = 0; lx < w.gw; lx++) {
      put(w, lx, 0, F[2]);
      put(w, lx, 1, F[2]);
      if (lx % 4 !== 0) put(w, lx, 2, F[2]);
      if (lx % 4 === 2) put(w, lx, 3, F[2]);
    }
    vbar(w, 8, 0, w.gh - 1, true);
    hbar(w, 9, 0, w.gw - 1);

    // ground-right: red curtains + a carved pumpkin on the inside sill
    w = byId['ground-right'];
    if (!omit.has('gr-curtains')) {
      curtain(w, 0, 12, 4, 2, 4, F[3], F[2]);
      curtain(w, 1, 12, 4, 2, 4, F[3], F[2]);
    }
    if (!omit.has('pumpkin')) rows(w, ['...ss..', '..s....', '.ppppp.', 'pepppep', 'ppppppp', 'pmpmpmp', '.ppppp.'], 4, w.gh - 7, { s: A[1], p: A[0], e: F[8], m: F[7] });
    hbar(w, 7, 0, w.gw - 1);
    vbar(w, 7, 0, 6, true);

    // upper-left: hanging herb bundles (dim room)
    w = byId['upper-left'];
    hbar(w, 1, 0, w.gw - 1);
    if (!omit.has('herbs')) for (const hx of [2, 9]) rows(w, ['.s.', '.s.', 'hhh', 'hhh', 'hhh', '.h.'], hx - 1, 2, { s: A[0], h: A[1] });
    if (!omit.has('ul-plant')) rows(w, ['.l..l', 'l.ll.', '.lll.', 'l.l.l', '.ooo.', '.ooo.', '..o..'], 0, w.gh - 7, { l: A[1], o: A[0] });
    vbar(w, 6, 0, w.gh - 1, true);
    hbar(w, 8, 0, w.gw - 1);

    // upper-right: amber curtains, transom - the cat sits on the sill
    w = byId['upper-right'];
    curtain(w, 0, 13, 4, 2, 3, A[3], A[2]);
    curtain(w, 1, 13, 4, 2, 3, A[3], A[2]);
    hbar(w, 6, 0, w.gw - 1);
    vbar(w, 8, 0, 5, true);

    // turret-upper: leaded diamond lattice
    w = byId['turret-upper'];
    for (let ly = 0; ly < w.gh; ly++)
      for (let lx = 0; lx < w.gw; lx++) if ((lx + ly) % 6 === 3 || (lx - ly + 60) % 6 === 2) put(w, lx, ly, W[1]);

    // turret-lower: books on a shelf, candle on the sill
    w = byId['turret-lower'];
    rows(w, ['b.bb', 'bbbb', 'bbbbb', 'bbbbb', 'sssss'], 0, 8, { b: A[1], s: A[0] });
    put(w, 1, 8, A[0]);
    rows(w, ['cc', 'cc', 'cc', 'hh'], 7, w.gh - 4, { c: A[7], h: A[2] });
    vbar(w, 5, 0, w.gh - 1, true);

    // attic: cross mullion
    w = byId.attic;
    for (let k = -5; k <= 5; k++) {
      put(w, 5 + k, 5, W[1]);
      put(w, 5, 5 + k, W[1]);
    }
  }

  // ---------------------------------------------------------------------
  // cat (black silhouette, upper-right window)
  // ---------------------------------------------------------------------
  const CAT_HEAD = {
    front: ['.K.....K.', '.KK...KK.', '.KKKKKKK.', '.KeKKKeK.', '.KKKKKKK.', '..KKKKK..'],
    twitch: ['.......K.', 'KKK...KK.', '.KKKKKKK.', '.KeKKKeK.', '.KKKKKKK.', '..KKKKK..'],
    side: ['..K..K...', '..KK.KK..', '..KKKKKK.', '..KKKKKKK', '..KKKKKK.', '...KKKK..'],
  };
  const CAT_BODY = ['..KKKKK..', '.KKKKKKK.', '.KKKKKKKK', 'KKKKKKKKK', 'KKKKKKKKK', 'KKKKKKKKK'];
  const CAT_C = P.violet[0];
  const CAT_EYE = HD.color.mix(P.amber[7], P.spirit[3], 0.45);

  // ---------------------------------------------------------------------
  // lantern
  // ---------------------------------------------------------------------
  const LANT_ROWS = ['...a...', '..a.a..', '...a...', '..bcb..', '.bcccb.', 'bbbbbbb', '.d...d.', '.d...d.', '.d...d.', '.d...d.', 'bbbbbbb', '.bcccb.', '...b...'];

  // baked resources (house + interiors are baked per edition)
  let houseArt = null;
  let interiorArt = null;
  const NONE = new Set();
  function buildHouse(ed) {
    const R = raster();
    paintTurret(R);
    paintCone(R);
    paintChimney(R);
    paintBody(R);
    paintRoof(R);
    paintGutterPipe(R);
    paintWindows(R);
    paintDoor(R, ed);
    paintPorch(R);
    paintSteps(R);
    paintMoss(R);
    rimPass(R);
    if (ed.id !== 'halloween' && KIT.seasons) KIT.seasons.decorateHouse(R, ed);
    return R.toCanvas();
  }
  function buildInterior(ed) {
    const I = raster();
    paintInteriors(I, ed);
    if (ed.id !== 'halloween' && KIT.seasons) KIT.seasons.decorateInterior(I, ed);
    return { img: I.toCanvas(), drops: buildDrops(I) };
  }
  let glass = null; // per window: [levels]
  let doorImgs = null;
  let lanternImg = null;
  let lanternGlass = null;
  let catBody = null;
  let catHeads = null;

  /** candle-lit glass: banded radial glow from the light source, checker seams */
  function glassColor(win, lx, ly, level) {
    const c = win.c;
    const sx = c.src[0] * win.gw;
    const sy = c.src[1] * win.gh;
    const Rr = c.R * (0.8 + 0.08 * level);
    const n = c.ramp.length;
    const dx = lx + 0.5 - sx;
    const dy = (ly + 0.5 - sy) * 1.15;
    const v = clamp(1 - Math.sqrt(dx * dx + dy * dy) / Rr, 0, 1);
    const q = v * (n - 1) + 0.35;
    const i0 = Math.floor(q);
    const th = chk(lx, ly) ? 0.66 : 0.34;
    let k = i0 + (q - i0 > th ? 1 : 0);
    if (ly === 0) k -= 1;
    return c.ramp[clamp(k, 0, n - 1)];
  }
  function bakeGlass(win, level) {
    return HD.bake(win.gw, win.gh, (g) => {
      for (let ly = 0; ly < win.gh; ly++)
        for (let lx = 0; lx < win.gw; lx++) if (winInside(win, win.gx + lx, win.gy + ly, 0)) g.px(lx, ly, glassColor(win, lx, ly, level));
    });
  }

  /** raindrops on the panes: per window the visible colour per level + muntin mask */
  function buildDrops(I) {
    return WINS.map((win) => {
      if (win.w.round || win.w.id === 'turret-upper') return null;
      const gw = win.gw;
      const gh = win.gh;
      const vis = [];
      for (let l = 0; l < NL; l++) {
        const arr = new Array(gw * gh).fill(null);
        for (let ly = 0; ly < gh; ly++)
          for (let lx = 0; lx < gw; lx++) {
            if (!winInside(win, win.gx + lx, win.gy + ly, 0)) continue;
            arr[ly * gw + lx] = I.get(win.gx + lx, win.gy + ly) || glassColor(win, lx, ly, l);
          }
        vis.push(arr);
      }
      const solid = new Uint8Array(gw * gh);
      for (let ly = 0; ly < gh; ly++)
        for (let lx = 0; lx < gw; lx++) {
          // droplets only run over bare glass: muntins stop them, silhouettes hide them
          const c = I.get(win.gx + lx, win.gy + ly);
          if (c !== null || !winInside(win, win.gx + lx, win.gy + ly, 0)) solid[ly * gw + lx] = 1;
        }
      return { vis, solid, gw, gh, maxStart: win.w.cat ? 3 : Math.floor(gh * 0.6) };
    });
  }
  function drawDrops(g, t, levels, drops) {
    g.em.reset();
    for (let i = 0; i < WINS.length; i++) {
      const D = drops[i];
      if (!D) continue;
      const win = WINS[i];
      const vis = D.vis[levels[i]];
      for (let d = 0; d < 2; d++) {
        const c = T.cycle(t, d, 6.5 + d * 2.7 + i * 0.4, 700 + i * 13);
        const lx = Math.floor(c.rnd(0) * D.gw);
        const ly0 = Math.floor(c.rnd(1) * D.maxStart);
        const age = c.age;
        if (D.solid[ly0 * D.gw + lx]) continue;
        let fl = ly0;
        while (fl + 1 < D.gh && !D.solid[(fl + 1) * D.gw + lx]) fl++;
        // bead forms (still), then slides with growing speed, then rests on the muntin
        let ly = ly0;
        let slide = false;
        if (age > 0.85) ly = fl;
        else if (age > 0.4) {
          const k = (age - 0.4) / 0.45;
          ly = ly0 + Math.round((fl - ly0) * k * k);
          slide = true;
        }
        const gx = win.gx + lx;
        if (slide)
          for (let k2 = 1; k2 <= 2 && ly - k2 >= ly0; k2++) {
            const v = vis[(ly - k2) * D.gw + lx];
            if (v) g.em.px(gx, win.gy + ly - k2, dk(v));
          }
        const v = vis[ly * D.gw + lx];
        if (v) g.em.px(gx, win.gy + ly, dk(dk(v)));
      }
    }
  }

  const LV = new Array(WINS.length).fill(0);
  // shared with house-seasons.js (seasonal decorations; it sets KIT.seasons)
  const KIT = (HD.houseKit = {
    BX, BY, BW, BH, HOLE, TG, NL, WINS, WCFG,
    raster, winInside, wflick, glassColor, courses, seg, chk, dk, lt, at, lum,
    roofL, roofR, roofDip, coneHW, coneCX, TCX, TX0, TX1,
    DX0, DX1, DY0, DY1, DCX, DAY, doorInside,
    get glass() { return glass; },
    seasons: null,
  });
  const DOORC = { seed: 51, speed: 0.8, amp: 0.8 };
  const LANC = { seed: 52, speed: 1.1, amp: 0.9 };

  HD.module('house', {
    init() {
      houseArt = HD.perEdition(buildHouse);
      interiorArt = HD.perEdition(buildInterior);

      glass = WINS.map((win) => {
        const out = [];
        for (let l = 0; l < NL; l++) out.push(bakeGlass(win, l));
        return out;
      });

      collectDoorLeak();
      doorImgs = [];
      for (let l = 0; l < NL; l++) {
        doorImgs.push(
          HD.bake(BW, BH, (g) => {
            for (const [x, y, kind] of DOOR_LEAK) {
              let c;
              if (kind === 'peep') c = A[3 + Math.round(l / 2.5) + (y - DY0 > 3 ? 1 : 0)];
              else if (kind === 'gap') c = A[3 + Math.round(l / 2.5)];
              else if (kind === 'key') c = A[4 + Math.round(l / 3)];
              else c = A[1 + Math.round(l / 3)];
              g.px(x - BX, y - BY, c);
            }
          }),
        );
      }

      lanternImg = HD.sprite(LANT_ROWS, { a: S[3], b: S[1], c: S[3], d: S[2] });
      lanternGlass = [];
      for (let l = 0; l < NL; l++)
        lanternGlass.push(
          HD.bake(3, 4, (g) => {
            for (let y = 0; y < 4; y++)
              for (let x = 0; x < 3; x++) {
                const edge = x !== 1 || y === 0;
                g.px(x, y, edge ? A[4 + (l > 3 ? 1 : 0)] : A[6]);
              }
          }),
        );

      const catMap = { K: CAT_C, e: CAT_C };
      catBody = HD.sprite(CAT_BODY, catMap);
      catHeads = {};
      for (const k in CAT_HEAD) catHeads[k] = HD.sprite(CAT_HEAD[k], catMap);
    },

    lights(t, L) {
      const SE = HD.edition.id === 'halloween' ? null : KIT.seasons;
      for (const win of WINS) {
        const c = SE ? SE.winCfg(win) : win.c;
        const f = wflick(t, c);
        const k = (0.86 + 0.28 * f) * (SE ? SE.winBoost(win) : 1);
        L.add({ x: Math.round(win.cx), y: Math.round(win.cy), r: c.light.r, color: c.light.col || HD.LIGHT.candle, i: c.light.i * k, halo: { r: Math.round(Math.max(win.gw, win.gh) * 0.75), a: c.halo } });
        if (c.spill) {
          L.add({
            x: Math.round(win.cx),
            y: 213,
            r: c.spill.r,
            ry: c.spill.ry,
            color: c.light.col || HD.LIGHT.candle,
            i: c.spill.i * k,
            bands: 4,
            clip: { x0: 0, y0: 206, x1: 479, y1: 240 },
          });
        }
      }
      // door glow on the steps
      const fd = wflick(t, DOORC);
      L.add({ x: Math.round(DCX), y: 209, r: 16, ry: 6, color: HD.LIGHT.candle, i: 0.3 + 0.08 * fd, bands: 4, clip: { x0: 0, y0: 204, x1: 479, y1: 240 } });
      // lantern
      if (!SE || SE.ironLantern()) {
        const lp = lanternPos(t);
        const fl = wflick(t, LANC);
        L.add({ x: lp.x, y: lp.y + 8, r: 44, color: HD.LIGHT.lantern, i: 0.7 + 0.16 * fl, halo: { r: 16, a: 0.2 } });
      }
      if (SE) SE.lights(t, L);
    },

    passes: [
      {
        layer: 'scene',
        z: 22,
        draw(g, t) {
          const ed = HD.edition;
          const SE = ed.id === 'halloween' ? null : KIT.seasons;
          g.sprite(houseArt(), BX, BY);
          for (let i = 0; i < WINS.length; i++) {
            const win = WINS[i];
            const lv = Math.round(wflick(t, SE ? SE.winCfg(win) : win.c) * (NL - 1));
            LV[i] = lv;
            g.em.sprite(SE ? SE.glass(i, lv) : glass[i][lv], win.gx, win.gy);
          }
          const inter = interiorArt();
          g.sprite(inter.img, BX, BY);
          drawCandle(g, t);
          if (ed.weather.rain > 0) drawDrops(g, t, LV, inter.drops);
          if (SE) SE.drawInside(g, t);
          drawCat(g, t);
          g.em.sprite(doorImgs[Math.round(wflick(t, DOORC) * (NL - 1))], BX, BY);
          if (!SE || SE.ironLantern()) drawLantern(g, t);
          if (SE) SE.drawFront(g, t);
        },
      },
    ],
  });

  // ---------------------------------------------------------------------
  // per-frame pieces
  // ---------------------------------------------------------------------
  function lanternPos(t) {
    const dx = 1.7 * T.wave(t, 4.6);
    return { x: Math.round(LAN.hookX + dx), y: LAN.hookY + LAN.len, dx };
  }

  function drawLantern(g, t) {
    const lp = lanternPos(t);
    const hx = LAN.hookX;
    g.reset();
    for (let k = 1; k < LAN.len; k++) {
      const x = Math.round(hx + (lp.dx * k) / LAN.len);
      g.px(x, LAN.hookY + k, k & 1 ? S[3] : S[1]);
    }
    const sx = lp.x - 3;
    const sy = lp.y;
    g.sprite(lanternImg, sx, sy);
    // g and g.em cache fillStyle separately on the same context: resync on every switch
    g.em.reset();
    const f = wflick(t, LANC);
    g.em.sprite(lanternGlass[Math.round(f * (NL - 1))], sx + 2, sy + 6);
    const ts = T.step(t, 10);
    const fh = T.noise(ts, 0.35, 77);
    g.em.px(sx + 3, sy + 8, F[9]);
    g.em.px(sx + 3, sy + 7, fh > 0.45 ? F[10] : F[8]);
    if (fh > 0.7) g.em.px(sx + 3, sy + 6, F[8]);
  }

  function drawCandle(g, t) {
    const win = WINS.find((w) => w.w.id === 'turret-lower');
    const x = win.gx + 7;
    const y = win.gy + win.gh - 5;
    const ts = T.step(t, 10);
    const n = T.noise(ts, 0.4, 91);
    const lean = T.noise(ts, 1.3, 92);
    g.em.reset();
    g.em.px(x, y, F[9]);
    g.em.px(x + 1, y, F[8]);
    const tx = lean > 0.62 ? x + 1 : x;
    g.em.px(tx, y - 1, n > 0.35 ? F[10] : F[9]);
    if (n > 0.6) g.em.px(tx, y - 2, F[8]);
  }

  function drawCat(g, t) {
    const win = WINS.find((w) => w.w.cat);
    if (!win) return;
    const ts = T.step(t, 12);
    const bx = win.gx + 3;
    const by = win.gy + win.gh - 12;
    // head pose: occasionally turns to watch the rain on the right
    const look = T.noise(ts, 17, 303);
    const side = look > 0.7;
    // ear twitch: short, every ~9 s
    const ec = T.cycle(ts, 0, 9.3, 305);
    const eAge = ec.age * ec.P;
    const eAt = 1 + ec.rnd(1) * (ec.P - 2);
    const twitch = !side && eAge > eAt && eAge < eAt + 0.25;
    // blink: every ~5 s, sometimes a double blink
    const bc = T.cycle(ts, 1, 5.1, 307);
    const bAge = bc.age * bc.P;
    const bAt = 0.5 + bc.rnd(1) * (bc.P - 1.2);
    const dbl = bc.rnd(2) < 0.3;
    const blink = (bAge > bAt && bAge < bAt + 0.15) || (dbl && bAge > bAt + 0.3 && bAge < bAt + 0.42);
    g.reset();
    g.sprite(catBody, bx, by + 6);
    g.sprite(catHeads[side ? 'side' : twitch ? 'twitch' : 'front'], bx, by);
    if (!side && !blink) {
      g.px(bx + 2, by + 3, CAT_EYE);
      g.px(bx + 6, by + 3, CAT_EYE);
    }
    // tail: a tapered curl rising from the right haunch, slowly swishing
    const sw = T.wave(ts, 7.3);
    const fl = T.wave(ts, 2.45, 0.2) * 0.5 + 0.5;
    let x = bx + 8.6;
    let y = by + 10.4;
    let ang = 0.25;
    const curl = 0.27 + 0.09 * sw;
    for (let k = 0; k < 9; k++) {
      const rx = Math.round(x);
      const ry = Math.round(y);
      g.px(rx, ry, CAT_C);
      if (k < 7) {
        // 2px thick: widen across the direction of travel
        if (Math.abs(Math.sin(ang)) > Math.abs(Math.cos(ang))) g.px(rx - (Math.cos(ang) > 0 ? 1 : -1), ry, CAT_C);
        else g.px(rx, ry + 1, CAT_C);
      }
      ang += curl + (k > 5 ? 0.22 * fl : 0);
      x += Math.cos(ang);
      y -= Math.sin(ang);
    }
  }
})();
