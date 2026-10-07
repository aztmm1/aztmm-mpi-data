/*
 * bg-seasons — the backdrop for every Rainy Hollow edition except Halloween
 * (Halloween keeps the classic passes in bg.js, untouched).
 *
 * Everything is baked lazily per edition (HD.perEdition) and selected at draw
 * time from HD.edition, so live switching just picks another cached bake:
 *   z0   sky: per-edition banded gradient, star clusters (static part), the
 *        summer Milky Way, the moon variant (full / harvest / crescent / none)
 *        + per frame: a few dozen twinkling stars
 *   z2   one subtle shooting star per loop (clear editions)
 *   z3   horizon cloud banks   (broken / overcast editions)
 *   z5   drifting cloud clumps (broken / overcast), lit around the moon
 *   z7   overcast ceiling      (winter snow clouds)
 *   z10  the same hills, chapel and forest line, recoloured and redecorated per
 *        season (snow caps, blossom specks, lush canopies, rust & gold forest)
 *        + per frame: the chapel window, far cottages, chapel lamps in "lights"
 * The cloud shapes and the landscape geometry come from bg.js (HD._bgKit), so
 * every edition is visibly the same place.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const K = HD._bgKit;
  if (!K) return;
  const P = HD.PAL;
  const T = HD.time;
  const LAY = HD.layout;
  const MOON = LAY.moon;
  const W = HD.W;
  const SKY_H = 210;
  const mix = HD.color.mix;
  const seasonal = () => HD.edition.id !== 'halloween';

  const idSeed = (s) => {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  };

  // ------------------------------------------------------------------
  // Looks: the per-edition colour script. Sky type, moon and star density
  // come from the edition fields; this table only picks colours and the
  // landscape season.
  // ------------------------------------------------------------------
  const N = P.night;
  const V = P.violet;
  const LOOKS = {
    lunar: {
      // clear frosty night, a faint rosy glow of lanterns on the horizon
      sky: [N[1], mix(N[1], N[2], 0.5), N[2], mix(N[3], V[1], 0.35), mix(N[4], V[2], 0.35), mix(N[4], V[3], 0.45), mix(N[5], P.red[2], 0.2), mix(N[6], P.red[3], 0.2)],
      land: 'snow',
      redLanterns: true,
      shoot: { x: 336, y: 20, dx: -0.86, dy: 0.5, len: 58, at: 0.31 },
    },
    spring: {
      // soft rain night: lilac-blue with a blossom-pink horizon
      sky: [mix(N[2], V[1], 0.3), mix(N[2], N[3], 0.5), N[3], mix(N[4], V[2], 0.3), mix(N[5], V[3], 0.3), mix(N[5], P.blossom[2], 0.35), mix(N[6], P.blossom[3], 0.35), mix(N[6], P.blossom[3], 0.45)],
      land: 'spring',
      clouds: {
        far: [mix(N[4], V[3], 0.45), mix(N[6], V[4], 0.4), mix(N[6], P.blossom[3], 0.32), mix(N[6], P.blossom[4], 0.3)],
        mid: [mix(N[3], V[2], 0.45), mix(N[4], V[3], 0.35), mix(N[5], V[3], 0.3), mix(N[7], P.blossom[4], 0.25)],
        lit: { tgt: [P.moon[0], P.moon[0], P.moon[1]], k: [[0.04, 0.07, 0.12, 0.24], [0.08, 0.13, 0.22, 0.42], [0.14, 0.22, 0.36, 0.6]], r: [[52, 10], [34, 7], [20, 4]] },
      },
    },
    summer: {
      // the shortest night: deep blue with a teal twilight that never quite leaves
      sky: [N[1], mix(N[1], N[2], 0.6), mix(N[2], N[3], 0.5), N[3], mix(N[4], P.spirit[0], 0.3), mix(N[5], P.spirit[1], 0.28), mix(N[6], P.spirit[1], 0.34), mix(N[6], P.spirit[2], 0.3)],
      land: 'summer',
      milky: true,
      shoot: { x: 262, y: 12, dx: -0.8, dy: 0.6, len: 52, at: 0.57 },
    },
    harvest: {
      // violet dusk-night, warm at the horizon, the big amber moon
      sky: [N[1], mix(N[1], V[1], 0.5), mix(N[2], V[1], 0.4), mix(N[3], V[2], 0.45), mix(N[4], V[3], 0.5), mix(V[4], P.autumn[2], 0.3), mix(V[4], P.autumn[3], 0.4), mix(V[5], P.autumn[3], 0.45)],
      land: 'autumn',
      rimTint: P.amber[4],
      clouds: {
        far: [mix(N[4], V[3], 0.5), mix(V[4], P.autumn[3], 0.32), mix(V[5], P.autumn[3], 0.34), mix(V[5], P.autumn[4], 0.3)],
        mid: [mix(N[2], V[2], 0.5), mix(N[3], V[3], 0.45), mix(N[4], V[3], 0.45), mix(N[5], V[4], 0.45)],
        lit: { tgt: [P.amber[2], P.amber[3], P.amber[4]], k: [[0.08, 0.12, 0.2, 0.4], [0.14, 0.22, 0.36, 0.62], [0.24, 0.36, 0.52, 0.85]], r: [[84, 12], [56, 8], [34, 5]] },
      },
    },
    lights: {
      // new-moon indigo; the horizon warmed by thousands of little lamps
      sky: [mix(N[0], N[1], 0.5), mix(N[1], V[0], 0.5), mix(N[2], V[1], 0.5), mix(N[3], V[2], 0.5), mix(N[3], V[3], 0.5), mix(V[3], P.amber[1], 0.2), mix(V[4], P.amber[2], 0.24), mix(V[4], P.amber[2], 0.34)],
      land: 'autumn',
      lamps: true,
      shoot: { x: 430, y: 16, dx: -0.87, dy: 0.49, len: 64, at: 0.44 },
    },
    winter: {
      // heavy lilac-grey snow sky, softly bright
      sky: [mix(N[2], V[2], 0.5), mix(N[3], V[2], 0.5), mix(N[3], V[3], 0.5), mix(N[4], V[3], 0.5), mix(N[5], V[4], 0.5), mix(N[5], V[4], 0.4), mix(N[6], V[5], 0.45), mix(P.snow[4], V[5], 0.45)],
      land: 'snow',
      clouds: {
        deck: true,
        mid: [mix(N[4], V[3], 0.55), mix(N[5], V[4], 0.45), mix(N[6], V[4], 0.42), mix(N[6], V[5], 0.42)],
        near: [mix(N[3], V[2], 0.55), mix(N[4], V[3], 0.5), mix(N[5], V[4], 0.5), mix(N[5], V[4], 0.3)],
      },
    },
    newyear: {
      // crisp, deep navy midnight
      sky: [N[0], N[1], mix(N[1], N[2], 0.6), N[2], mix(N[3], V[1], 0.3), mix(N[4], V[2], 0.3), mix(N[5], V[3], 0.3), mix(N[6], V[3], 0.3)],
      land: 'snow',
      shoot: { x: 352, y: 26, dx: -0.84, dy: 0.54, len: 56, at: 0.71 },
    },
  };
  const lookOf = (ed) => LOOKS[ed.id] || (ed.season === 'winter' ? LOOKS.winter : ed.season === 'summer' ? LOOKS.summer : ed.season === 'spring' ? LOOKS.spring : LOOKS.harvest);

  // ------------------------------------------------------------------
  // small value noise for baking (hash lattice, bilinear)
  // ------------------------------------------------------------------
  function vnoise(x, y, cell, seed) {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (i, j) => HD.hash(x0 + i, y0 + j, seed, 5);
    const a = h(0, 0) + (h(1, 0) - h(0, 0)) * sx;
    const b = h(0, 1) + (h(1, 1) - h(0, 1)) * sx;
    return a + (b - a) * sy;
  }

  // ------------------------------------------------------------------
  // Sky: gradient, Milky Way, stars, moon
  // ------------------------------------------------------------------
  const skyAt = (lk, x, y) => lk.sky[K.skyBand(x, y)];

  // the moon variants
  const HARVEST_R = 22;
  const CRESCENT_R = 14;
  const HARVEST_RAMP = [mix(P.amber[2], V[4], 0.35), mix(P.amber[3], P.amber[4], 0.55), mix(P.amber[5], P.amber[4], 0.35), mix(P.amber[6], P.amber[5], 0.3), mix(P.amber[7], P.amber[6], 0.35)];
  const moonRadius = (m) => (m === 'harvest' ? HARVEST_R : m === 'crescent' ? CRESCENT_R : m === 'full' ? MOON.r : 0);

  function paintHalo(im, lk, moon) {
    if (moon === 'none') return;
    let bands;
    let tgt;
    if (moon === 'harvest') {
      bands = [[30, 0.26], [40, 0.16], [56, 0.09], [84, 0.04]];
      tgt = mix(P.amber[4], V[5], 0.3);
    } else if (moon === 'crescent') {
      bands = [[19, 0.12], [28, 0.065], [42, 0.03]];
      tgt = P.moon[0];
    } else {
      bands = [[23, 0.22], [31, 0.14], [44, 0.08], [64, 0.035]];
      tgt = P.moon[0];
    }
    const R = bands[bands.length - 1][0];
    for (let y = Math.max(0, MOON.y - R - 3); y < Math.min(SKY_H, MOON.y + R + 3); y++)
      for (let x = Math.max(0, MOON.x - R - 3); x < Math.min(W, MOON.x + R + 3); x++) {
        const dx = x - MOON.x;
        const dy = y - MOON.y;
        const d = Math.sqrt(dx * dx + dy * dy) + (HD.bayer(x + 3, y + 5) - 0.5) * 5;
        if (d >= R) continue;
        let k = 0;
        for (const b of bands)
          if (d < b[0]) {
            k = b[1];
            break;
          }
        im.set(x, y, mix(skyAt(lk, x, y), tgt, k));
      }
  }

  function paintCrescent(im, lk) {
    const r = CRESCENT_R;
    const rr = r * r + r * 0.6;
    const inD = (dx, dy) => dx * dx + dy * dy <= rr;
    // shadow disc offset up-left -> a waxing crescent lit on the lower right
    const sx = -6.5;
    const sy = -3.5;
    const inS = (dx, dy) => (dx - sx) * (dx - sx) + (dy - sy) * (dy - sy) <= rr * 0.98;
    for (let dy = -r - 1; dy <= r + 1; dy++)
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        if (!inD(dx, dy)) continue;
        const x = MOON.x + dx;
        const y = MOON.y + dy;
        if (inS(dx, dy)) {
          // earthshine: the dark limb barely shows against the sky
          im.set(x, y, mix(skyAt(lk, x, y), P.moon[0], 0.13));
          continue;
        }
        let c = P.moon[3];
        if (!inD(dx + 1.2, dy + 0.6) || !inD(dx + 0.6, dy + 1.2)) c = P.moon[4]; // bright outer limb
        else if (inS(dx - 1.3, dy - 0.8)) c = P.moon[2]; // soft terminator
        im.set(x, y, c);
      }
    // a couple of mare shadows in the thick part
    im.set(MOON.x + 6, MOON.y + 4, P.moon[2]);
    im.set(MOON.x + 7, MOON.y + 3, P.moon[2]);
    im.set(MOON.x + 3, MOON.y + 9, P.moon[2]);
  }

  /** summer Milky Way: a soft dusty band rising behind the cottage */
  const MW = { ax: 150, ay: 168, bx: 352, by: -12 };
  function milkyField(x, y) {
    const vx = MW.bx - MW.ax;
    const vy = MW.by - MW.ay;
    const len = Math.sqrt(vx * vx + vy * vy);
    const ux = vx / len;
    const uy = vy / len;
    const px = x - MW.ax;
    const py = y - MW.ay;
    const along = (px * ux + py * uy) / len; // 0..1
    const d = px * -uy + py * ux; // signed distance from the spine
    const half = 22 + 7 * Math.sin(along * 5.1 + 0.6) + 7 * along;
    const n = 0.55 * vnoise(x, y, 11, 31) + 0.3 * vnoise(x, y, 5, 32) + 0.15 * vnoise(x, y, 2.5, 33);
    let dens = Math.exp(-((d / half) * (d / half))) * (0.45 + 0.75 * n);
    // dark dust rift running along one side of the spine
    const rift = d - (3 + 4 * Math.sin(along * 7.3));
    const rw = 3.2 + 2.5 * vnoise(x, y, 9, 34);
    dens *= 1 - 0.75 * Math.exp(-((rift / rw) * (rift / rw))) * (along > 0.18 ? 1 : along / 0.18);
    // fade near the horizon haze
    if (y > 130) dens *= Math.max(0, 1 - (y - 130) / 30);
    return { dens, along, d, half };
  }

  function genStars(ed, lk, im) {
    const dens = ed.stars || 0;
    const tw = [];
    if (dens <= 0) return tw;
    const rng = HD.rng(idSeed(ed.id) ^ 0x51a2);
    const moon = ed.moon;
    const mr = moonRadius(moon);
    const clusters = [];
    for (let i = 0; i < 11; i++) clusters.push([16 + rng() * 448, 10 + rng() * 100, 9 + rng() * 16]);
    const occ = new Uint8Array(W * SKY_H);
    const free = (x, y, sp) => {
      for (let yy = y - sp; yy <= y + sp; yy++)
        for (let xx = x - sp; xx <= x + sp; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < SKY_H && occ[yy * W + xx]) return false;
      return true;
    };
    const ts = LAY.titleSafe;
    const want = Math.round(dens * 230) + (lk.milky ? 120 : 0);
    let made = 0;
    for (let k = 0; k < want * 8 && made < want; k++) {
      let x;
      let y;
      const r0 = rng();
      if (lk.milky && r0 < 0.34) {
        // extra fine stars packed into the Milky Way
        x = 140 + rng() * 240;
        y = rng() * 150;
        const f = milkyField(x, y);
        if (rng() > f.dens * 1.3) continue;
      } else if (r0 < 0.62) {
        const c = clusters[(rng() * clusters.length) | 0];
        const gs = () => (rng() + rng() + rng() - 1.5) * 1.2;
        x = c[0] + gs() * c[2];
        y = c[1] + gs() * c[2] * 0.7;
      } else {
        x = rng() * W;
        y = Math.pow(rng(), 1.3) * 150;
      }
      x = Math.round(x);
      y = Math.round(y);
      if (x < 2 || x >= W - 2 || y < 2 || y > 140) continue;
      if (y > 90 && rng() < (y - 90) / 40) continue; // horizon haze swallows the faint ones
      if (x > 34 && x < 104 && y > 92) continue; // leave the chapel's silhouette clean
      if (x >= ts.x0 && x <= ts.x1 && y >= ts.y0 && y <= ts.y1 && rng() < 0.7) continue; // calm title area
      if (mr) {
        const dx = x - MOON.x;
        const dy = y - MOON.y;
        if (dx * dx + dy * dy < (mr + 12) * (mr + 12)) continue;
      }
      const rc = rng();
      let cls = rc < 0.62 ? 0 : rc < 0.9 ? 1 : rc < 0.978 ? 2 : 3;
      if (lk.milky && r0 < 0.34) cls = rc < 0.8 ? 0 : 1;
      if (!free(x, y, cls >= 2 ? 3 : 1)) continue;
      occ[y * W + x] = 1;
      made++;
      const tint = rng();
      const band = skyAt(lk, x, y);
      const base = tint < 0.18 ? mix(P.moon[3], P.amber[7], 0.4) : tint > 0.84 ? mix(P.moon[2], P.spirit[3], 0.35) : P.moon[2];
      const s = {
        x,
        y,
        cls,
        per: 5 + rng() * 10,
        seed: (rng() * 1e6) | 0,
        c0: mix(band, base, 0.34),
        c1: mix(band, base, 0.62),
        c2: mix(band, P.moon[4], 0.92),
        arm: mix(band, base, 0.36),
        arm2: mix(band, base, 0.16),
      };
      const twinkles = rng() < (cls === 0 ? 0.08 : cls === 1 ? 0.4 : 0.85);
      if (twinkles) {
        tw.push(s);
        if (cls >= 2) {
          // keep the steady core in the bake so a twinkle never fully vanishes
          im.set(x, y, s.c1);
        }
        continue;
      }
      if (cls === 0) im.set(x, y, s.c0);
      else if (cls === 1) im.set(x, y, s.c1);
      else {
        im.set(x, y, s.c2);
        im.set(x - 1, y, s.arm);
        im.set(x + 1, y, s.arm);
        im.set(x, y - 1, s.arm);
        im.set(x, y + 1, s.arm);
      }
    }
    return tw;
  }

  function drawTwinkles(g, t, list) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const v = T.noise(t, s.per, s.seed);
      if (s.cls === 0) {
        if (v > 0.32) g.px(s.x, s.y, s.c0);
      } else if (s.cls === 1) {
        g.px(s.x, s.y, v < 0.3 ? s.c0 : v < 0.72 ? s.c1 : s.c2);
      } else {
        g.px(s.x, s.y, v < 0.28 ? s.c1 : s.c2);
        if (v > (s.cls === 3 ? 0.22 : 0.48)) {
          g.px(s.x - 1, s.y, s.arm);
          g.px(s.x + 1, s.y, s.arm);
          g.px(s.x, s.y - 1, s.arm);
          g.px(s.x, s.y + 1, s.arm);
        }
        if (s.cls === 3 && v > 0.68) {
          g.px(s.x - 2, s.y, s.arm2);
          g.px(s.x + 2, s.y, s.arm2);
          g.px(s.x, s.y - 2, s.arm2);
          g.px(s.x, s.y + 2, s.arm2);
        }
      }
    }
  }

  function bakeSky(ed) {
    const lk = lookOf(ed);
    const im = new K.Img(W, SKY_H);
    for (let y = 0; y < SKY_H; y++) for (let x = 0; x < W; x++) im.set(x, y, skyAt(lk, x, y));
    if (lk.milky) {
      const glow = mix(P.moon[2], P.spirit[3], 0.3);
      const core = mix(P.moon[3], P.amber[7], 0.25);
      for (let y = 0; y < 165; y++)
        for (let x = 100; x < 420; x++) {
          const f = milkyField(x, y);
          if (f.dens < 0.1) continue;
          // flat tone levels with a narrow ordered-dither seam between them
          const q = f.dens * 3.2 + (HD.bayer(x, y) - 0.5) * 0.8;
          const lv = q < 0.6 ? 0 : q < 1.45 ? 1 : q < 2.3 ? 2 : 3;
          if (!lv) continue;
          const band = skyAt(lk, x, y);
          im.set(x, y, lv === 1 ? mix(band, glow, 0.07) : lv === 2 ? mix(band, glow, 0.14) : mix(band, core, 0.22));
        }
    }
    paintHalo(im, lk, ed.moon);
    const twinkles = genStars(ed, lk, im);
    if (ed.moon === 'full') K.paintMoon(im, MOON.x, MOON.y, MOON.r, P.moon);
    else if (ed.moon === 'harvest') K.paintMoon(im, MOON.x, MOON.y, HARVEST_R, HARVEST_RAMP);
    else if (ed.moon === 'crescent') paintCrescent(im, lk);
    return { cv: im.canvas(), twinkles };
  }
  const skyArt = HD.perEdition(bakeSky);

  // ------------------------------------------------------------------
  // Shooting star: once per loop, ~1 s, clear editions only
  // ------------------------------------------------------------------
  const SHOOT_DUR = 1.1;
  function drawShootingStar(g, t, ed, lk) {
    const sh = lk.shoot;
    if (!sh || ed.sky !== 'clear') return;
    const s = (T.phase(t, HD.LOOP) - sh.at) * HD.LOOP;
    if (s < 0 || s > SHOOT_DUR) return;
    const u = s / SHOOT_DUR;
    const ease = 1 - (1 - u) * (1 - u);
    const hx = sh.x + sh.dx * sh.len * ease;
    const hy = sh.y + sh.dy * sh.len * ease;
    // the trail grows, then the head burns out first
    const tail = Math.round(12 * Math.min(1, u * 4) * (u > 0.75 ? 1 - (u - 0.75) * 2.4 : 1));
    const bright = u < 0.8;
    for (let k = tail; k >= 0; k--) {
      const x = Math.round(hx - sh.dx * k);
      const y = Math.round(hy - sh.dy * k);
      const band = skyAt(lk, x, y);
      let c;
      if (k === 0) {
        if (!bright) continue;
        c = P.moon[4];
      } else if (k <= 2) c = mix(band, P.moon[3], bright ? 0.85 : 0.5);
      else if (k <= 6) c = mix(band, P.moon[2], 0.5);
      else {
        if ((k & 1) === 1) continue;
        c = mix(band, P.moon[1], 0.32);
      }
      g.px(x, y, c);
    }
  }

  // ------------------------------------------------------------------
  // Clouds: recoloured copies of the classic cloud tone maps
  // ------------------------------------------------------------------
  const MR = { x: MOON.x - 96, y: 0, w: 192, h: MOON.y + 96 };
  let tmp = null;
  let tctx = null;
  function masked(ctx, tile, Ly, off, mask) {
    if (!tmp) {
      tmp = HD.canvas(MR.w, MR.h, true);
      tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
    }
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, MR.w, MR.h);
    let sx = (((off - MR.x) % Ly.w) + Ly.w) % Ly.w;
    if (sx > 0) sx -= Ly.w;
    for (; sx < MR.w; sx += Ly.w) tctx.drawImage(tile, sx, Ly.y - MR.y);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(mask, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0, MR.w, MR.h, MR.x, MR.y, MR.w, MR.h);
  }

  // ------------------------------------------------------------------
  // Snow-cloud deck (winter): a heavy, lumpy ceiling of overlapping cloud
  // masses in two parallax layers, few gaps. Rows are painted from the
  // horizon upward so the nearer (higher) masses hang their dark bellies over
  // the lit tops of the farther ones. Geometry is edition independent.
  // ------------------------------------------------------------------
  function genDeck(seed, w, h, rows, fillTo) {
    const rng = HD.rng(seed);
    const tn = new K.Tones(w, h);
    // a continuous ceiling down to a gently lumpy line: the masses below only
    // add lit tops and dark bellies, so the deck reads as one heavy sky
    if (fillTo) {
      const ph = rng() * 6.28;
      for (let x = 0; x < w; x++) {
        const yb = Math.round(fillTo + 3 * Math.sin((x / w) * 6.283 * 3 + ph) + 2 * Math.sin((x / w) * 6.283 * 7 + ph * 2));
        for (let y = 0; y <= yb; y++) tn.put(x, y, 2);
      }
    }
    for (const r of rows) {
      // r: [yBase, ryMin, ryMax, stretch, under, gap]
      let x = rng() * 40;
      const x0 = x;
      while (x < x0 + w) {
        const ry = r[1] + rng() * (r[2] - r[1]);
        const rx = ry * (r[3] + rng() * 1.2);
        const yb = r[0] + (rng() - 0.5) * ry * 0.9;
        const mass = [];
        const n = 2 + Math.floor(rng() * 2);
        for (let j = 0; j < n; j++) {
          const u = j / (n - 1);
          const hump = Math.sin(Math.PI * (0.15 + 0.7 * u));
          const pr = ry * (0.55 + 0.45 * hump) * (0.85 + rng() * 0.3);
          mass.push([x + u * rx * 2 + (rng() - 0.5) * 4, yb - pr * 0.5 - rng() * 2, pr * (1.7 + rng() * 0.6), pr, yb + (rng() < 0.4 ? 2 : 0), j > 0 && rng() < 0.35]);
        }
        K.cloud(tn, mass, true, r[4]);
        x += rx * 2 + ry * r[5] * (0.2 + rng());
      }
    }
    K.tidy(tn, 2);
    return tn;
  }
  let deckGeo = null;
  function deckLayers() {
    if (deckGeo) return deckGeo;
    deckGeo = {
      // low deck towards the horizon: long flat masses (1 tile / loop)
      mid: { y: 40, w: 600, h: 96, k: 1, tn: genDeck(9151, 600, 96, [[90, 3, 5, 4, 2, 1.4], [76, 5, 8, 3.2, 2, 0.8], [60, 7, 10, 2.8, 3, 0.6], [40, 9, 13, 2.8, 3, 0.9]], 56) },
      // overhead deck: a few big, heavy masses (2 tiles / loop)
      near: { y: 0, w: 480, h: 52, k: 2, tn: genDeck(7717, 480, 52, [[42, 9, 12, 2.8, 3, 0.9], [20, 12, 15, 2.6, 3, 1.1]], 46) },
    };
    return deckGeo;
  }

  function bakeClouds(ed) {
    const lk = lookOf(ed);
    const cl = lk.clouds;
    if (!cl || ed.sky === 'clear') return null;
    const out = {};
    const ids = ['far', 'mid', 'near'];
    let masks = null;
    if (cl.lit && ed.moon !== 'none') masks = cl.lit.r.map((r) => K.radialMask(MR.w, MR.h, MOON.x - MR.x, MOON.y - MR.y, r[0], r[1]));
    const deck = cl.deck ? deckLayers() : null;
    K.LAYERS.forEach((Ly0, i) => {
      const pal = cl[ids[i]];
      if (!pal) return;
      const Ly = deck && deck[ids[i]] ? deck[ids[i]] : Ly0;
      const L = { Ly, cv: K.tonesToCanvas(Ly.tn, pal), lit: null, masks };
      if (masks)
        L.lit = cl.lit.k.map((ks, j) => {
          const p2 = K.shade(pal, cl.lit.tgt[j], ks);
          return K.tonesToCanvas(Ly.tn, p2);
        });
      out[ids[i]] = L;
    });
    return out;
  }
  const cloudArt = HD.perEdition(bakeClouds);

  function drawClouds(g, t, id) {
    const all = cloudArt();
    const L = all && all[id];
    if (!L) return;
    const ctx = g.ctx;
    const Ly = L.Ly;
    const off = K.layerOff(t, Ly);
    for (let x = off - Ly.w; x < W; x += Ly.w) ctx.drawImage(L.cv, x, Ly.y);
    if (L.lit && Ly.y < MR.y + MR.h) for (let i = 0; i < L.lit.length; i++) masked(ctx, L.lit[i], Ly, off, L.masks[i]);
  }

  // ------------------------------------------------------------------
  // Landscape: same geometry, seasonal colour + decoration
  // ------------------------------------------------------------------
  const LB = K.LB;
  const LAND_Y = K.LAND_Y;

  /** per-season landscape colours */
  function landPalette(kind, lk) {
    const hz = lk.sky[7];
    const hz6 = lk.sky[6];
    let c;
    if (kind === 'snow') {
      c = {
        hillA: mix(P.snow[3], V[3], 0.3),
        crestA: mix(P.snow[5], V[4], 0.2),
        hillB: mix(P.snow[2], N[3], 0.35),
        crestB: mix(P.snow[4], V[4], 0.2),
        chapel: mix(N[2], V[2], 0.45),
        forest: mix(P.leaf[1], N[2], 0.55),
        pine: mix(P.leaf[1], N[2], 0.45),
        pineSnow: mix(P.snow[5], V[3], 0.2),
        pineSnowTop: mix(P.snow[6], V[4], 0.1),
        pineSnowMid: mix(mix(P.leaf[1], N[2], 0.45), P.snow[4], 0.45),
        roofSnow: mix(P.snow[6], V[4], 0.12),
        cotRoof: mix(P.snow[5], V[4], 0.2),
        cotWall: mix(N[2], V[2], 0.4),
      };
    } else if (kind === 'spring') {
      const fresh = mix(P.leaf[6], P.vine[4], 0.35);
      c = {
        hillA: mix(fresh, N[7], 0.32),
        crestA: mix(P.leaf[7], N[9], 0.3),
        hillB: mix(mix(P.leaf[4], P.vine[3], 0.35), N[3], 0.3),
        crestB: mix(P.leaf[5], N[5], 0.35),
        chapel: mix(N[2], V[2], 0.45),
        forest: mix(P.leaf[2], N[2], 0.4),
        pine: mix(P.leaf[2], N[2], 0.35),
        canopy: [
          { base: mix(P.leaf[4], N[4], 0.3), light: mix(P.leaf[6], N[6], 0.3), dark: mix(P.leaf[2], N[3], 0.3) },
          { base: mix(mix(P.leaf[5], P.vine[4], 0.4), N[4], 0.3), light: mix(P.leaf[7], N[7], 0.3), dark: mix(P.leaf[3], N[3], 0.3) },
          { base: mix(P.leaf[4], N[4], 0.3), light: mix(P.leaf[6], N[6], 0.3), dark: mix(P.leaf[2], N[3], 0.3) },
          { base: mix(P.blossom[4], N[5], 0.42), light: mix(P.blossom[5], N[8], 0.3), dark: mix(P.blossom[2], N[3], 0.4), blossom: true },
        ],
        speck: mix(P.blossom[6], N[8], 0.4),
        speck2: mix(P.blossom[7], N[10], 0.3),
        cotRoof: mix(N[3], P.stone[3], 0.5),
        cotWall: mix(N[3], P.stone[2], 0.4),
      };
    } else if (kind === 'summer') {
      c = {
        hillA: mix(P.leaf[4], N[5], 0.5),
        crestA: mix(P.leaf[5], P.moon[0], 0.25),
        hillB: mix(P.leaf[3], N[2], 0.4),
        crestB: mix(P.leaf[4], P.moon[0], 0.2),
        chapel: mix(N[2], V[2], 0.4),
        forest: mix(P.leaf[1], N[1], 0.35),
        pine: mix(P.leaf[1], N[2], 0.3),
        canopy: [
          { base: mix(P.leaf[2], N[3], 0.25), light: mix(P.leaf[4], N[4], 0.2), dark: mix(P.leaf[1], N[1], 0.3) },
          { base: mix(P.leaf[3], N[3], 0.3), light: mix(P.leaf[5], N[5], 0.25), dark: mix(P.leaf[1], N[2], 0.3) },
        ],
        cotRoof: mix(N[3], P.stone[3], 0.5),
        cotWall: mix(N[3], P.stone[2], 0.4),
      };
    } else {
      // autumn: rust and gold
      c = {
        hillA: mix(P.autumn[2], V[3], 0.5),
        crestA: mix(P.autumn[4], V[4], 0.5),
        hillB: mix(P.autumn[1], N[2], 0.5),
        crestB: mix(P.autumn[3], V[3], 0.5),
        chapel: mix(N[1], V[1], 0.5),
        forest: mix(P.autumn[0], N[1], 0.5),
        pine: mix(P.leaf[1], N[2], 0.5),
        canopy: [
          { base: mix(P.autumn[3], N[3], 0.42), light: mix(P.autumn[5], N[4], 0.4), dark: mix(P.autumn[1], N[2], 0.45) },
          { base: mix(P.autumn[4], N[3], 0.45), light: mix(P.autumn[6], N[5], 0.42), dark: mix(P.autumn[2], N[2], 0.45) },
          { base: mix(P.autumn[3], N[3], 0.42), light: mix(P.autumn[5], N[4], 0.4), dark: mix(P.autumn[1], N[2], 0.45) },
          { base: mix(mix(P.autumn[6], P.gold[3], 0.5), N[4], 0.5), light: mix(P.gold[4], N[6], 0.45), dark: mix(P.autumn[3], N[3], 0.45) },
        ],
        cotRoof: mix(N[3], P.stone[3], 0.5),
        cotWall: mix(N[3], P.stone[2], 0.4),
      };
    }
    c.hazeA = mix(c.hillA, hz, 0.45);
    c.hazeB = mix(c.hillB, c.hillA, 0.6);
    c.horizon = hz6;
    return c;
  }

  function bakeLand(ed) {
    const lk = lookOf(ed);
    const kind = lk.land;
    const c = landPalette(kind, lk);
    const L = K.LAND;
    const moonSide = ed.moon !== 'none';
    const rimTint = lk.rimTint || P.moon[0];
    const pal = [];
    pal[LB.hillA] = c.hillA;
    pal[LB.hazeA] = c.hazeA;
    pal[LB.rimA] = c.crestA;
    pal[LB.chapel] = c.chapel;
    pal[LB.slit] = mix(c.chapel, N[0], 0.5);
    pal[LB.rimCh] = moonSide ? mix(c.chapel, rimTint, 0.2) : c.chapel;
    pal[LB.spill] = mix(c.chapel, P.amber[2], 0.25);
    pal[LB.hillB] = c.hillB;
    pal[LB.hazeB] = c.hazeB;
    pal[LB.rimB] = c.crestB;
    pal[LB.cotRoof] = c.cotRoof;
    pal[LB.cotWall] = c.cotWall;
    pal[LB.yard] = c.chapel;
    const im = K.landCanvas(L.pre, pal);
    const S = (x, y, col) => im.set(x, y - LAND_Y, col);
    const labAt = (x, y) => (x < 0 || x >= W || y < LAND_Y || y >= 210 ? 0 : L.pre[(y - LAND_Y) * W + x]);

    // hill crests: a soft lit band under each ridge (snow catches the sky,
    // grass and woods catch the moon on the right)
    for (let x = 0; x < W; x++) {
      const ta = L.topA[x];
      const tb = L.topB[x];
      const lit = kind === 'snow' ? 1 : moonSide ? (x > 250 ? 0.8 : 0.35) : 0.3;
      for (let d = 1; d <= 4; d++) {
        if (labAt(x, ta + d) === LB.hillA && HD.bayer(x, ta + d) < lit * (1 - d / 4.5)) S(x, ta + d, mix(c.hillA, c.crestA, 0.5));
        if (labAt(x, tb + d) === LB.hillB && HD.bayer(x + 3, tb + d) < lit * (1 - d / 4.5) * 0.8) S(x, tb + d, mix(c.hillB, c.crestB, 0.5));
      }
      // ridge line itself: continuous for snow, moon side only otherwise
      if (kind === 'snow' || (moonSide && x > 250)) {
        if (labAt(x, ta) === LB.hillA || labAt(x, ta) === LB.rimA) S(x, ta, c.crestA);
        if (labAt(x, tb) === LB.hillB || labAt(x, tb) === LB.rimB) S(x, tb, c.crestB);
      } else if (!moonSide) {
        if (labAt(x, ta) === LB.rimA) S(x, ta, mix(c.hillA, c.crestA, 0.55));
        if (labAt(x, tb) === LB.rimB) S(x, tb, mix(c.hillB, c.crestB, 0.5));
      }
    }

    // chapel & churchyard dressing
    if (kind === 'snow') {
      const sn = c.roofSnow;
      for (let i = 0; i <= 6; i++) {
        S(56 + i, 129 - i, sn);
        S(76 - i, 129 - i, sn);
      }
      for (let x = 62; x <= 70; x++) S(x, 123, sn);
      for (let x = 48; x <= 57; x++) S(x, 119, sn); // tower cornice
      S(51, 118, sn);
      S(52, 118, sn);
      S(53, 118, sn);
      for (let x = 76; x <= 78; x++) S(x, 132, sn); // apse
      for (const gx of [82, 86, 44]) S(gx, 137, sn);
      S(89, 128, sn);
      S(94, 128, sn);
      // snowy cottage roofs read as small pale wedges
      for (const ct of K.COTTAGES) {
        S(ct.x - 2, ct.y - 1, c.cotRoof);
        S(ct.x - 1, ct.y - 2, c.cotRoof);
        S(ct.x, ct.y - 2, c.cotRoof);
      }
    } else if (c.canopy) {
      // the bare far tree beside the chapel is in leaf
      const cp = c.canopy[kind === 'spring' ? 2 : 0];
      for (let dy = -4; dy <= 3; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const e = (dx * dx) / 14 + ((dy + 0.5) * (dy + 0.5)) / 13;
          if (e > 1) continue;
          S(91 + dx, 131 + dy, e > 0.55 && dy < 0 && dx >= 0 ? cp.light : dy > 1 ? cp.dark : cp.base);
        }
    }

    // forest band + trees
    for (let x = 0; x < W; x++) for (let y = L.topC[x]; y < 210; y++) S(x, y, c.forest);
    const seed = idSeed(kind);
    for (const tr of L.trees) {
      const r = HD.hash(tr.x, seed, 3, 1);
      const pine = kind === 'snow' || !c.canopy || r < (kind === 'summer' ? 0.32 : kind === 'spring' ? 0.25 : 0.22);
      if (pine) drawPine(S, tr, c, kind, moonSide && tr.x > 300, rimTint);
      else drawCanopy(S, tr, c, kind, moonSide && tr.x > 290, rimTint);
    }

    // spring: two or three small orchards of blossoming trees on the near hills
    if (kind === 'spring') {
      const orchards = [
        [106, 6, 5],
        [228, 5, 5],
        [352, 7, 5],
      ];
      for (const o of orchards)
        for (let i = 0; i < o[1]; i++) {
          const x = o[0] + i * o[2] + (i & 1);
          const ty = L.topB[x] + 6 + ((i * 3) % 4);
          if (ty >= L.topC[x] - 2 || labAt(x, ty) === LB.hillA) continue;
          // [.ab] [aab] [.s.] : a 3px crown with a lit top-right, on a dark stem
          S(x, ty - 1, c.speck);
          S(x + 1, ty - 1, c.speck2);
          S(x - 1, ty, mix(c.speck, c.hillB, 0.4));
          S(x, ty, c.speck);
          S(x + 1, ty, c.speck);
          S(x + 2, ty, mix(c.speck, c.hillB, 0.4));
          S(x, ty + 1, mix(c.hillB, N[1], 0.45));
          S(x + 1, ty + 1, mix(c.hillB, N[1], 0.3));
        }
    }
    return im.canvas();
  }

  function drawPine(S, tr, c, kind, rim, rimTint) {
    const snow = kind === 'snow';
    const rimC = mix(c.pine, rimTint, 0.14);
    for (let r = 0; r <= tr.h; r++) {
      const y = tr.b - tr.h + r;
      const half = K.pineHalf(r, tr.hw);
      const above = r === 0 ? -1 : K.pineHalf(r - 1, tr.hw);
      for (let xx = tr.x - half; xx <= tr.x + half; xx++) {
        let col = c.pine;
        if (snow) {
          // dark boughs with snow resting on each tier: the narrow first row of
          // a tier is snow (shaded on the right), the drooping tips catch some too
          const m = r % 3;
          const edge = Math.abs(xx - tr.x) === half;
          if (r === 0) col = c.pineSnowTop;
          else if (r === 1) col = c.pine;
          else if (m === 0) col = xx > tr.x && edge ? c.pineSnowMid : c.pineSnow;
          else if (m === 1) col = edge && half > above ? (xx < tr.x ? c.pineSnow : c.pineSnowMid) : c.pine;
        }
        S(xx, y, col);
      }
      if (rim && !snow && r > 1 && r % 3 !== 0 && half > 0) S(tr.x + half, y, rimC);
    }
  }

  function drawCanopy(S, tr, c, kind, rim, rimTint) {
    const pick = HD.hash(tr.x, 991, 7, 2);
    const cp = c.canopy[Math.floor(pick * c.canopy.length) % c.canopy.length];
    const small = cp.blossom ? 1 : 0; // blossom trees: smaller crowns on a visible trunk
    const rx = Math.max(2, tr.hw + 1 - small);
    const ry = Math.max(2, Math.round(tr.h * 0.42) - small);
    const cy = tr.b - Math.round(tr.h * 0.48) - small;
    const twin = tr.h > 9 && pick > 0.5 && !cp.blossom; // wide crowns get a second lobe
    const lobes = [[tr.x, cy, rx, ry]];
    if (twin) lobes.push([tr.x + (pick > 0.75 ? 2 : -2), cy - 2, rx - 1, ry - 1]);
    const inside = (x, y) => {
      for (const l of lobes) {
        const dx = (x - l[0]) / (l[2] + 0.4);
        const dy = (y - l[1]) / (l[3] + 0.4);
        if (dx * dx + dy * dy <= 1) return true;
      }
      return false;
    };
    // trunk
    for (let y = cy + ry - 1; y <= tr.b; y++) S(tr.x, y, c.forest);
    const x0 = tr.x - rx - 3;
    const x1 = tr.x + rx + 3;
    const y0 = cy - ry - 3;
    const y1 = cy + ry + 1;
    const rimC = mix(cp.light, rimTint, 0.25);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        let col = cp.base;
        const upR = !inside(x + 1, y - 1) || !inside(x, y - 2);
        const low = !inside(x - 1, y + 2) || !inside(x, y + 2);
        if (low) col = cp.dark;
        if (upR) col = cp.light;
        if (rim && !inside(x + 1, y) && y < cy + 1) col = rimC;
        S(x, y, col);
      }
    // spring: pale blossom specks resting on top of the green crowns
    if (kind === 'spring' && !cp.blossom && HD.hash(tr.x, 13, 5, 1) < 0.55) {
      const sx = tr.x + (pick > 0.5 ? 1 : -1);
      const sy = cy - ry + 1;
      S(sx, sy, c.speck2);
      S(sx + 1, sy + 1, c.speck);
      if (rx > 2) S(sx - 2, sy + 2, c.speck);
    } else if (cp.blossom) {
      // little clusters of pale bloom scattered through the pink crown
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (!inside(x, y) || !inside(x + 1, y) || !inside(x, y + 1)) continue;
          if (HD.hash(x >> 1, y >> 1, tr.x, 17) < 0.3 && ((x + y) & 1) === 0) S(x, y, HD.hash(x, y, 3, 9) < 0.5 ? c.speck2 : c.speck);
        }
    }
  }
  const landArt = HD.perEdition(bakeLand);

  // chapel lamps for the festival of lights: tiny diyas along the eaves and sill
  // (they trace the silhouette: the gable, the tower cornice and the footing)
  const CHAPEL_LAMPS = [
    [56, 128],
    [59, 125],
    [62, 122],
    [66, 122],
    [70, 122],
    [73, 125],
    [76, 128],
    [48, 119],
    [57, 119],
    [50, 140],
    [53, 140],
    [58, 140],
    [61, 140],
    [64, 140],
    [70, 140],
    [73, 140],
    [77, 140],
  ];

  function drawLandLights(g, t, lk) {
    const W0 = K.CHAPEL_WIN;
    const v = T.noise(t, 9, 77);
    g.px(W0.x, W0.y, v > 0.35 ? P.amber[5] : P.amber[4]);
    g.px(W0.x, W0.y + 1, v > 0.7 ? P.amber[5] : P.amber[4]);
    const C = K.COTTAGES;
    for (let i = 0; i < C.length; i++) {
      const k = T.noise(t, 13, 91 + i);
      g.px(C[i].x, C[i].y, k > 0.5 ? P.amber[4] : P.amber[3]);
    }
    if (lk.redLanterns) {
      // a red lantern glows by each far cottage door
      for (let i = 0; i < C.length; i++) {
        const f = T.flicker(T.step(t, 8), 360 + i, 0.6);
        g.px(C[i].x + 2, C[i].y, f > 0.45 ? P.red[6] : P.red[5]);
      }
    }
    if (lk.lamps) {
      for (let i = 0; i < CHAPEL_LAMPS.length; i++) {
        const p = CHAPEL_LAMPS[i];
        const f = T.flicker(T.step(t, 8), 300 + i, 0.8);
        g.px(p[0], p[1], f > 0.55 ? P.fire[8] : f > 0.25 ? P.amber[5] : P.amber[4]);
      }
      // the far cottages are lit up too: a lamp either side of each door
      for (let i = 0; i < C.length; i++) {
        const f = T.flicker(T.step(t, 8), 340 + i, 0.8);
        g.px(C[i].x - 2, C[i].y + 1, f > 0.4 ? P.amber[5] : P.amber[4]);
        g.px(C[i].x + 2, C[i].y + 1, f > 0.6 ? P.amber[4] : P.amber[5]);
      }
    }
  }

  // ------------------------------------------------------------------
  // module
  // ------------------------------------------------------------------
  HD.module('bg', {
    passes: [
      {
        layer: 'bg',
        z: 0,
        id: 'season-sky',
        draw(g, t) {
          if (!seasonal()) return;
          const art = skyArt();
          g.ctx.drawImage(art.cv, 0, 0);
          drawTwinkles(g, t, art.twinkles);
        },
      },
      {
        layer: 'bg',
        z: 2,
        id: 'season-shooting-star',
        draw(g, t) {
          if (!seasonal()) return;
          const ed = HD.edition;
          drawShootingStar(g, t, ed, lookOf(ed));
        },
      },
      { layer: 'bg', z: 3, id: 'season-clouds-far', draw: (g, t) => seasonal() && drawClouds(g, t, 'far') },
      { layer: 'bg', z: 5, id: 'season-clouds-mid', draw: (g, t) => seasonal() && drawClouds(g, t, 'mid') },
      { layer: 'bg', z: 7, id: 'season-clouds-near', draw: (g, t) => seasonal() && drawClouds(g, t, 'near') },
      {
        layer: 'bg',
        z: 10,
        id: 'season-land',
        draw(g, t) {
          if (!seasonal()) return;
          g.ctx.drawImage(landArt(), 0, LAND_Y);
          drawLandLights(g, t, lookOf(HD.edition));
        },
      },
    ],
  });
})();
