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
 *   z3   horizon cloud banks   (broken editions)
 *   z5   drifting cloud clumps (broken), or the lower snow-cloud deck (winter)
 *   z7   near clouds: overhead banks with gaps of stars (broken), or the
 *        heavy overhead snow-cloud deck (winter). Broken-sky layers are lit
 *        around the moon through dithered masks.
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
  // winter's snow-cloud deck: lilac-grey, heavy overhead, paler over the
  // horizon. The sky behind it (seen only in the gaps) is a touch lighter at
  // every height and brightens into a glow band just above the hills, so the
  // gradient stays monotonic under the deck.
  const WINTER_DECK = {
    top: mix(mix(V[5], P.stone[6], 0.5), V[1], 0.42),
    hor: mix(mix(V[5], P.stone[6], 0.6), P.snow[4], 0.2),
    belly: mix(V[2], N[2], 0.35),
  };
  const WINTER_GLOW = mix(P.snow[5], V[6], 0.3);
  const winterSky = () =>
    [12, 36, 60, 84, 107, 129, 151, 175].map((cy) => {
      const d = Math.min(1, Math.max(0, (cy - 15) / 120));
      return mix(mix(WINTER_DECK.top, WINTER_DECK.hor, Math.pow(d, 0.85)), WINTER_GLOW, 0.1 + 0.2 * d * d);
    });
  const LOOKS = {
    lunar: {
      // clear frosty night, a faint rosy glow of lanterns on the horizon
      sky: [N[1], mix(N[1], N[2], 0.5), N[2], mix(N[3], V[1], 0.35), mix(N[4], V[2], 0.35), mix(mix(N[4], V[3], 0.45), P.red[2], 0.2), mix(N[5], P.red[2], 0.38), mix(N[6], P.red[3], 0.42)],
      land: 'snow',
      redLanterns: true,
      // open sky between the turret finial and the plum tree
      shoot: { x: 312, y: 10, dx: -0.86, dy: 0.5, len: 38, at: 0.31 },
    },
    spring: {
      // soft rain night: lilac-blue with a blossom-pink horizon
      sky: [mix(N[2], V[1], 0.3), mix(N[2], N[3], 0.5), N[3], mix(N[4], V[2], 0.3), mix(N[5], V[3], 0.3), mix(N[5], P.blossom[2], 0.35), mix(N[6], P.blossom[3], 0.35), mix(N[6], P.blossom[3], 0.45)],
      land: 'spring',
      clouds: {
        far: [mix(N[4], V[3], 0.45), mix(N[6], V[4], 0.4), mix(N[6], P.blossom[3], 0.32), mix(N[6], P.blossom[4], 0.3)],
        mid: [mix(N[3], V[2], 0.45), mix(N[4], V[3], 0.35), mix(N[5], V[3], 0.3), mix(N[7], P.blossom[4], 0.25)],
        near: [mix(N[2], V[2], 0.5), mix(N[3], V[3], 0.45), mix(N[4], V[3], 0.45), mix(N[6], P.blossom[3], 0.3)],
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
        near: [mix(N[2], V[2], 0.5), mix(N[3], V[3], 0.5), mix(N[4], V[3], 0.5), mix(N[5], V[4], 0.5)],
        deep: 0.72,
        lit: { tgt: [P.amber[2], P.amber[3], P.amber[4]], k: [[0.08, 0.12, 0.2, 0.4], [0.14, 0.22, 0.36, 0.62], [0.24, 0.36, 0.52, 0.85]], r: [[84, 12], [56, 8], [34, 5]] },
      },
    },
    lights: {
      // new-moon indigo; the horizon warmed by thousands of little lamps
      sky: [mix(N[0], N[1], 0.5), mix(N[1], V[0], 0.5), mix(N[2], V[1], 0.5), mix(N[3], V[2], 0.5), mix(N[3], V[3], 0.5), mix(V[3], P.amber[1], 0.2), mix(V[4], P.amber[2], 0.24), mix(V[4], P.amber[2], 0.34)],
      land: 'autumn',
      lamps: true,
      // open sky above the roof, clear of the turret and the autumn tree
      shoot: { x: 300, y: 10, dx: -0.87, dy: 0.49, len: 48, at: 0.44 },
    },
    winter: {
      // heavy lilac-grey snow sky, softly bright
      sky: winterSky(),
      land: 'snow',
      clouds: { deck: WINTER_DECK },
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

  /**
   * summer Milky Way: a faint dusty band that climbs out of the far hills
   * behind the chapel, passes high behind the cottage and thins out toward
   * the top right. The spine bows gently, the width breathes, and the dark
   * rift is a few separate dust blotches rather than a line.
   */
  const MW = { ax: 34, ay: 152, bx: 336, by: -14 };
  const smooth01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
  function milkyField(x, y) {
    const vx = MW.bx - MW.ax;
    const vy = MW.by - MW.ay;
    const len = Math.sqrt(vx * vx + vy * vy);
    const ux = vx / len;
    const uy = vy / len;
    const px = x - MW.ax;
    const py = y - MW.ay;
    const along = (px * ux + py * uy) / len; // 0..1
    // signed distance from a bowed spine (+ = lower right, toward the roof)
    const bow = 6 * Math.sin(Math.PI * along) + 4 * Math.sin(along * 7.4 + 1.1);
    const d = px * -uy + py * ux - bow;
    const half = 17 + 8 * Math.sin(along * 4.6 + 0.4) + 5 * Math.sin(along * 12.3 + 2.2) + 6 * along;
    const n = 0.55 * vnoise(x, y, 11, 31) + 0.3 * vnoise(x, y, 5, 32) + 0.15 * vnoise(x, y, 2.5, 33);
    let dens = Math.exp(-((d / half) * (d / half))) * (0.42 + 0.78 * n);
    // dust rift: three or four separate dark blotches beside the spine
    const rift = d - (2 + 3 * Math.sin(along * 6.7));
    const rw = 2.2 + 2.2 * vnoise(x, y, 6, 34);
    const blot = smooth01((vnoise(x, y, 15, 35) - 0.54) / 0.12) * (along > 0.2 ? 1 : along / 0.2);
    dens *= 1 - 0.55 * Math.exp(-((rift / rw) * (rift / rw))) * blot;
    // the horizon haze swallows its foot
    if (y > 118) dens *= Math.max(0, 1 - (y - 118) / 34);
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
        x = 20 + rng() * 330;
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
        for (let x = 0; x < 400; x++) {
          const f = milkyField(x, y);
          if (f.dens < 0.1) continue;
          // flat tone levels with a narrow ordered-dither seam between them
          const q = f.dens * 3.2 + (HD.bayer(x, y) - 0.5) * 0.8;
          const lv = q < 0.6 ? 0 : q < 1.45 ? 1 : q < 2.3 ? 2 : 3;
          if (!lv) continue;
          const band = skyAt(lk, x, y);
          im.set(x, y, lv === 1 ? mix(band, glow, 0.05) : lv === 2 ? mix(band, glow, 0.1) : mix(band, core, 0.14));
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
  /**
   * Draw `tile` (scrolled by off) through a moonlight mask into the main
   * buffer. Each mask covers only its own box (bounds of its dithered disc,
   * aligned to the 8px Bayer grid of MR), and only the rows the layer
   * occupies are composited, so the three lit levels stay cheap.
   */
  function masked(ctx, tile, Ly, off, m) {
    const y0 = Math.max(m.y, Ly.y);
    const y1 = Math.min(m.y + m.h, Ly.y + Ly.h);
    if (y1 <= y0) return;
    const h = y1 - y0;
    if (!tmp) {
      tmp = HD.canvas(MR.w, MR.h, true);
      tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
    }
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, m.w, h);
    let sx = (((off - m.x) % Ly.w) + Ly.w) % Ly.w;
    if (sx > 0) sx -= Ly.w;
    for (; sx < m.w; sx += Ly.w) tctx.drawImage(tile, sx, Ly.y - y0);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(m.cv, 0, m.y - y0);
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0, m.w, h, m.x, y0, m.w, h);
  }
  /** moonlight mask for lit level [R, soft], cropped to its own box inside MR */
  function moonMask(R, soft) {
    const ex = Math.ceil(R + soft / 2) + 1;
    const ey = Math.ceil(ex / 1.15) + 1;
    const x = Math.max(MR.x, MR.x + (((MOON.x - ex - MR.x) >> 3) << 3));
    const y = Math.max(MR.y, MR.y + (((MOON.y - ey - MR.y) >> 3) << 3));
    const w = Math.min(MR.x + MR.w, MOON.x + ex + 1) - x;
    const h = Math.min(MR.y + MR.h, MOON.y + ey + 1) - y;
    return { x, y, w, h, cv: K.radialMask(w, h, MOON.x - x, MOON.y - y, R, soft) };
  }

  // ------------------------------------------------------------------
  // Snow-cloud deck (winter): a heavy ceiling of wide, overlapping, undulating
  // masses in two parallax layers. Nothing is outlined: every mass is a flat
  // body whose underside sinks into a dithered dark belly, and the masses are
  // painted from the horizon upward, so each nearer (higher) mass hangs its
  // belly over the body of the farther one. Row r owns tones 3r+1 (dark
  // belly), 3r+2 (belly half-tone) and 3r+3 (body); its colours run from the
  // dark overhead ceiling (depth 0) to pale lilac-grey at the horizon (1).
  // Geometry is edition independent; mass sizes and heights are hashed so the
  // rows never line up.
  // ------------------------------------------------------------------
  function deckMass(tn, puffs, tb, bd, hang) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of puffs) {
      x0 = Math.min(x0, Math.floor(p[0] - p[2] - 1));
      x1 = Math.max(x1, Math.ceil(p[0] + p[2] + 1));
      y0 = Math.min(y0, Math.floor(p[1] - p[3] - 1));
      y1 = Math.max(y1, Math.ceil(p[1] + p[3] + 1));
    }
    if (hang) y0 = 0;
    y0 = Math.max(y0, 0);
    y1 = Math.min(y1, tn.h - 1);
    // a hanging mass (the ceiling) continues straight up out of the frame
    const inM = (x, y) => {
      for (const p of puffs) {
        const dx = (x - p[0]) / p[2];
        const dy = (y - p[1]) / p[3];
        if (dx * dx + (hang && dy < 0 ? 0 : dy * dy) <= 1) return true;
      }
      return false;
    };
    for (let x = x0; x <= x1; x++) {
      // walk each column upward so we know the distance to the underside
      let d = -1;
      for (let y = y1; y >= y0; y--) {
        if (!inM(x, y)) {
          d = -1;
          continue;
        }
        d++;
        const q = d / bd + (HD.bayer(x, y) - 0.5) * 0.4;
        tn.put(x, y, tb + (q < 0.34 ? 1 : q < 1 ? 2 : 3));
      }
    }
  }
  function genDeck(seed, w, h, rows, r0) {
    const tn = new K.Tones(w, h);
    const hs = (a, b, c) => HD.hash(seed, a, b, c);
    const masses = [];
    rows.forEach((r, ri) => {
      // r: { y: underside (tile-local), rx/ry: [min, max], step: [min, max]
      //      spacing in mass widths (< 1 overlaps, > 1 leaves gaps), belly px }
      let x = hs(ri, 0, 1) * 60;
      const xEnd = x + w;
      for (let i = 0; x < xEnd; i++) {
        const rx = r.rx[0] + hs(ri, i, 2) * (r.rx[1] - r.rx[0]);
        const ry = r.ry[0] + hs(ri, i, 3) * (r.ry[1] - r.ry[0]);
        const yb = r.y + (hs(ri, i, 4) - 0.5) * 12; // +-6 px: the rows never line up
        const cx = x + rx;
        const n = 3 + Math.floor(hs(ri, i, 5) * 3);
        const puffs = [];
        for (let j = 0; j < n; j++) {
          const u = j / (n - 1);
          const hump = 0.5 + 0.5 * Math.sin(Math.PI * (0.08 + 0.84 * u));
          const pr = ry * hump * (0.75 + 0.45 * hs(ri, i, 10 + j));
          const px = cx + (u - 0.5) * rx * 1.35 + (hs(ri, i, 20 + j) - 0.5) * 10;
          const prx = rx * (0.3 + 0.24 * hs(ri, i, 30 + j));
          const sag = (hs(ri, i, 40 + j) - 0.35) * ry * 0.7; // undulating underside
          puffs.push([px, yb - pr + sag, prx, pr]);
        }
        masses.push({ yb, puffs, tb: (r0 + ri) * 3, bd: r.belly, hang: !!r.ceiling });
        x += 2 * rx * (r.step[0] + hs(ri, i, 6) * (r.step[1] - r.step[0]));
      }
    });
    // farthest (lowest underside) first, so nearer bellies hang over them
    masses.sort((a, b) => b.yb - a.yb);
    for (const m of masses) deckMass(tn, m.puffs, m.tb, m.bd, m.hang);
    return tn;
  }
  // rows: underside y in screen space (converted to tile-local below), depth
  // 0 = overhead .. 1 = horizon
  const DECK_ROWS = {
    near: [
      { y: 21, rx: [60, 90], ry: [14, 18], step: [0.42, 0.62], belly: 8, depth: 0, ceiling: true },
      { y: 36, rx: [52, 90], ry: [10, 14], step: [0.48, 0.72], belly: 7, depth: 0.12 },
      { y: 52, rx: [46, 84], ry: [8, 12], step: [0.5, 0.8], belly: 6, depth: 0.24 },
    ],
    mid: [
      { y: 67, rx: [44, 84], ry: [8, 11], step: [0.5, 0.8], belly: 6, depth: 0.36 },
      { y: 83, rx: [42, 78], ry: [7, 10], step: [0.55, 0.9], belly: 5, depth: 0.5 },
      { y: 98, rx: [40, 70], ry: [6, 8], step: [0.6, 1.0], belly: 4, depth: 0.64 },
      { y: 112, rx: [34, 60], ry: [5, 7], step: [0.7, 1.15], belly: 3, depth: 0.78 },
      { y: 124, rx: [28, 50], ry: [4, 6], step: [0.8, 1.35], belly: 3, depth: 0.9 },
      { y: 134, rx: [22, 40], ry: [3, 4], step: [1.0, 1.7], belly: 2, depth: 1 },
    ],
  };
  let deckGeo = null;
  function deckLayers() {
    if (deckGeo) return deckGeo;
    const local = (rows, y0) => rows.map((r) => Object.assign({}, r, { y: r.y - y0 }));
    deckGeo = {
      // overhead deck: big heavy masses hanging from the ceiling (2 tiles / loop)
      near: { y: 0, w: 480, h: 66, k: 2, rows: DECK_ROWS.near, tn: genDeck(7717, 480, 66, local(DECK_ROWS.near, 0), 0) },
      // lower deck towards the horizon: long flat masses (1 tile / loop)
      mid: { y: 28, w: 600, h: 116, k: 1, rows: DECK_ROWS.mid, tn: genDeck(9151, 600, 116, local(DECK_ROWS.mid, 28), 0) },
    };
    return deckGeo;
  }
  /** per-row palette [dark belly, belly half-tone, body] x rows */
  function deckPalette(rows, dk) {
    const pal = [];
    for (const r of rows) {
      // overhead bellies are softer (calm title area); far rows need the contrast
      const body = mix(dk.top, dk.hor, Math.pow(r.depth, 0.85));
      pal.push(mix(body, dk.belly, 0.46 + 0.16 * r.depth), mix(body, dk.belly, 0.2 + 0.1 * r.depth), body);
    }
    return pal;
  }

  // ------------------------------------------------------------------
  // Broken sky (spring, harvest): a third, near layer so the sky is mostly
  // cloud with gaps of stars. Wide banks hang from the top of the frame with
  // lumpy, uneven undersides; a few lower clumps drift beneath the moon's
  // height. Shaded with the classic cloud() so all three layers match, and
  // lit around the moon like the others. (2 tiles / loop, faster than mid.)
  // ------------------------------------------------------------------
  const brokenGeo = new Map();
  /** deep: how far the overhead banks hang down (spring 1, harvest less) */
  function brokenNear(deep) {
    let geo = brokenGeo.get(deep);
    if (geo) return geo;
    const w = 480;
    const h = 112;
    const rng = HD.rng(5309);
    const tn = new K.Tones(w, h);
    // overhead banks [x, width, depth]: tops run out of the frame, the lumpy
    // undersides hang deepest in the middle
    for (const b of [[0, 164, 1], [196, 120, 0.72], [348, 104, 0.9]]) {
      const x0 = b[0] + rng() * 12;
      const bw = b[1];
      const n = Math.max(5, Math.round(bw / 12));
      const body = [];
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const hump = Math.sin(Math.PI * Math.pow(u, 0.85));
        const ry = 4 + hump * 7 + rng() * 3;
        const bottom = 12 + (6 + 32 * b[2] * deep) * hump + (rng() - 0.5) * 6;
        const px = x0 + u * bw + (rng() - 0.5) * 6;
        const prx = ry * (1.3 + rng() * 0.5);
        body.push([px, bottom - ry, prx, ry, undefined, rng() < 0.45]);
        body.push([px, -24, prx * 0.9, 24 + bottom - ry, undefined, false]); // solid up out of the frame
      }
      K.cloud(tn, body, true, 3);
      // a straggling tail hanging under one end of the bank
      const tx = x0 + (rng() < 0.5 ? bw * 0.12 : bw * 0.72);
      const tail = [];
      const ty = 18 + 14 * b[2] * deep + rng() * 4;
      for (let j = 0; j < 3; j++) tail.push([tx + j * (8 + rng() * 5), ty + rng() * 3, 7 + rng() * 5, 2.5 + rng() * 2, undefined, j > 0]);
      K.cloud(tn, tail, true, 2);
    }
    // small flat clumps and streaks at mid height (fewer under shallow banks)
    for (const st of [[92, 62, 44], [262, 72, 52], [418, 56, 36], [176, 46, 40]].slice(0, deep >= 1 ? 4 : 2)) {
      const sx = st[0] + rng() * 16;
      const yb = st[1];
      const cw = st[2];
      const body = [];
      for (let i = 0; i < 4; i++) {
        const u = (i + 0.5) / 4;
        const ry = 2 + Math.sin(Math.PI * u) * 3.5 + rng() * 1.5;
        body.push([sx + u * cw, yb - ry * 0.6, ry * (1.6 + rng() * 0.6), ry, yb + 1, i > 0 && rng() < 0.5]);
      }
      K.cloud(tn, body, true, 2);
      K.cloud(tn, [[sx + cw * (rng() < 0.5 ? -0.1 : 1.05), yb + 1, 10 + rng() * 8, 1.6, yb + 1, false]], true, 1); // trailing streak
    }
    // lower clumps [x, width, base y], staggered under the gaps between banks
    for (const c of [[146, 88, 96], [292, 108, 104], [436, 80, 92]]) {
      const x0 = c[0] + rng() * 12;
      const cw = c[1];
      const yb = c[2];
      const body = [];
      const n = Math.max(4, Math.round(cw / 12));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const hump = Math.sin(Math.PI * Math.pow(u, 0.8));
        const ry = 3 + hump * 7 + rng() * 2;
        body.push([x0 + u * cw + (rng() - 0.5) * 5, yb - ry * 0.55 - rng() * 2, ry * (1.3 + rng() * 0.5), ry, yb + (rng() < 0.3 ? 2 : 0), rng() < 0.4]);
      }
      K.cloud(tn, body, true, 3);
    }
    K.tidy(tn, 2);
    geo = { y: 0, w, h, k: 2, tn };
    brokenGeo.set(deep, geo);
    return geo;
  }

  /** prefix sums of tile columns holding cloud within the rows mask m covers */
  function columnOcc(Ly, m) {
    const tn = Ly.tn;
    const y0 = Math.max(m.y, Ly.y) - Ly.y;
    const y1 = Math.min(m.y + m.h, Ly.y + tn.h) - Ly.y;
    const pre = new Uint16Array(tn.w + 1);
    for (let x = 0; x < tn.w; x++) {
      let any = 0;
      for (let y = y0; y < y1 && !any; y++) if (tn.a[y * tn.w + x]) any = 1;
      pre[x + 1] = pre[x] + any;
    }
    return pre;
  }
  /** does the scrolled tile have any cloud under mask box m? */
  function occupied(pre, Ly, off, m) {
    const w = Ly.w;
    const c0 = (((m.x - off) % w) + w) % w;
    const c1 = c0 + Math.min(m.w, w);
    return c1 <= w ? pre[c1] > pre[c0] : pre[w] > pre[c0] || pre[c1 - w] > 0;
  }

  function bakeClouds(ed) {
    const lk = lookOf(ed);
    const cl = lk.clouds;
    if (!cl || ed.sky === 'clear') return null;
    const out = {};
    const ids = ['far', 'mid', 'near'];
    let masks = null;
    if (cl.lit && ed.moon !== 'none') masks = cl.lit.r.map((r) => moonMask(r[0], r[1]));
    const deck = cl.deck ? deckLayers() : null;
    K.LAYERS.forEach((Ly0, i) => {
      const Ly = deck ? deck[ids[i]] : ids[i] === 'near' ? brokenNear(cl.deep || 1) : Ly0;
      const pal = deck ? Ly && deckPalette(Ly.rows, cl.deck) : cl[ids[i]];
      if (!pal) return;
      const L = { Ly, cv: K.tonesToCanvas(Ly.tn, pal), lit: null, masks, occ: null };
      if (masks) {
        L.lit = cl.lit.k.map((ks, j) => {
          const p2 = K.shade(pal, cl.lit.tgt[j], ks);
          return K.tonesToCanvas(Ly.tn, p2);
        });
        L.occ = masks.map((m) => columnOcc(Ly, m));
      }
      out[ids[i]] = L;
    });
    return out;
  }
  const cloudArt = HD.perEdition(bakeClouds);
  // read-only handle for the QA tools (cloud coverage, palette probes)
  HD._bgSeasons = { cloudArt, lookOf };

  // whole tiles per loop, like bg.js, but each layer gets its own fixed
  // sub-pixel phase so two layers never step on the same frame at the loop
  // point (a constant phase keeps it loop-safe)
  const LAYER_SUB = { far: 0, mid: 0.5, near: 0.25 };
  const layerOff = (t, Ly, id) => Math.floor(T.phase(t, HD.LOOP / Ly.k) * Ly.w + LAYER_SUB[id] + 1e-6) % Ly.w;

  function drawClouds(g, t, id) {
    const all = cloudArt();
    const L = all && all[id];
    if (!L) return;
    const ctx = g.ctx;
    const Ly = L.Ly;
    const off = layerOff(t, Ly, id);
    for (let x = off - Ly.w; x < W; x += Ly.w) ctx.drawImage(L.cv, x, Ly.y);
    if (L.lit) for (let i = 0; i < L.lit.length; i++) if (occupied(L.occ[i], Ly, off, L.masks[i])) masked(ctx, L.lit[i], Ly, off, L.masks[i]);
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
          { base: mix(P.blossom[3], N[4], 0.5), light: mix(P.blossom[4], N[6], 0.45), dark: mix(P.blossom[2], N[3], 0.5), blossom: true },
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
          { base: mix(mix(P.autumn[6], P.gold[3], 0.5), V[3], 0.5), light: mix(mix(P.gold[4], P.autumn[6], 0.4), V[4], 0.45), dark: mix(P.autumn[3], V[2], 0.5) },
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
        // no moon, no moon-side rim: the same faint dithered ridge everywhere
        const la = labAt(x, ta);
        const lb = labAt(x, tb);
        if (la === LB.hillA || la === LB.rimA) S(x, ta, HD.bayer(x, 0) < 0.5 ? mix(c.hillA, c.crestA, 0.55) : c.hillA);
        if (lb === LB.hillB || lb === LB.rimB) S(x, tb, HD.bayer(x + 3, 1) < 0.5 ? mix(c.hillB, c.crestB, 0.5) : c.hillB);
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
      // [x, width, trees]: hashed spacing, height and count, so no grid shows
      const orchards = [
        [104, 30, 6],
        [226, 26, 5],
        [350, 36, 7],
      ];
      const leaf = mix(c.hillB, mix(P.leaf[2], N[2], 0.4), 0.45);
      const leafLo = mix(leaf, N[1], 0.3);
      orchards.forEach((o, oi) => {
        const n = o[2] - (HD.hash(oi, 3, 71, 2) < 0.5 ? 1 : 0);
        let x = o[0];
        for (let i = 0; i < n && x < o[0] + o[1] + 6; i++) {
          const hs = (k) => HD.hash(oi, i, 72, k);
          const ty = L.topB[x] + 5 + Math.floor(hs(1) * 5);
          if (ty < L.topC[x] - 2 && labAt(x, ty) !== LB.hillA) {
            // a small dark-green tree blob ...
            S(x - 1, ty, leaf);
            S(x, ty, leaf);
            S(x + 1, ty, leaf);
            if (hs(2) < 0.5) S(x + 2, ty, leafLo);
            S(x, ty + 1, leafLo);
            // ... wearing an irregular 2-3 px cluster of pale blossom
            const lean = hs(3) < 0.5 ? 0 : -1;
            S(x + lean, ty - 1, c.speck);
            S(x + lean + 1, ty - 1, c.speck2);
            if (hs(4) < 0.6) S(x + (hs(5) < 0.5 ? -1 : 1), ty, c.speck);
            else if (hs(4) < 0.85) S(x + lean, ty - 2, c.speck);
          }
          x += 3 + Math.floor(hs(6) * 5);
        }
      });
    }
    return im.canvas();
  }

  function drawPine(S, tr, c, kind, rim, rimTint) {
    const snow = kind === 'snow';
    const rimC = mix(c.pine, rimTint, 0.14);
    // snowy pines: each tree's tier phase and base are hashed, so the snow
    // rows of neighbouring trees never line up into stripes across the forest
    const ph = snow ? Math.floor(HD.hash(tr.x, 61, 2, 7) * 3) : 0;
    const b = snow ? tr.b + Math.floor(HD.hash(tr.x, 62, 2, 7) * 3) - 1 : tr.b;
    const half = (r) => (r < 2 ? 0 : K.pineHalf(r + ph, tr.hw));
    for (let r = 0; r <= tr.h; r++) {
      const y = b - tr.h + r;
      const hw = half(r);
      const above = r === 0 ? -1 : half(r - 1);
      const m = (r + ph) % 3;
      // about one tier in three carries no snow on its top
      const bare = HD.hash(tr.x, Math.floor((r + ph) / 3), 63, 7) < 0.34;
      for (let xx = tr.x - hw; xx <= tr.x + hw; xx++) {
        let col = c.pine;
        if (snow) {
          const edge = Math.abs(xx - tr.x) === hw;
          if (r === 0) col = c.pineSnowTop;
          // drooping bough tips catch the snow: the main read
          else if (r > 1 && edge && hw > above && hw > 0) col = xx < tr.x ? c.pineSnow : c.pineSnowMid;
          // the top of a tier: snow on its upper-left only, centre and right stay dark
          else if (r > 1 && m === 0 && !bare && xx < tr.x && xx >= tr.x - hw) col = xx === tr.x - 1 && hw > 1 ? c.pineSnowMid : c.pineSnow;
        }
        S(xx, y, col);
      }
      if (rim && !snow && r > 1 && r % 3 !== 0 && hw > 0) S(tr.x + hw, y, rimC);
    }
  }

  // crown templates: leaf clumps as [u, v, r] in crown units (v < 0 = up)
  const CROWNS = [
    [[-0.5, 0.25, 0.55], [0.45, 0.2, 0.55], [-0.05, -0.42, 0.6], [0.15, 0.62, 0.42]],
    [[-0.55, 0.05, 0.5], [0.4, 0.35, 0.52], [-0.15, -0.45, 0.55], [0.5, -0.25, 0.45], [-0.1, 0.62, 0.4]],
    [[-0.35, 0.3, 0.6], [0.45, 0.1, 0.55], [0, -0.48, 0.52]],
    [[-0.5, -0.1, 0.5], [0.3, -0.4, 0.55], [0.5, 0.35, 0.5], [-0.2, 0.5, 0.5]],
  ];
  /**
   * A broadleaf (or blossoming) tree of the far forest: a crown of 3-5 leaf
   * clumps of hashed size. The upper clumps overlap the lower ones and every
   * clump's shadowed lower-left edge is dark, so the clumps separate with a
   * thin dark gap; a small lit patch sits on top of the upper clumps (pale
   * bloom in 2x2 clusters for blossom trees). A dark trunk shows beneath.
   */
  function drawCanopy(S, tr, c, kind, rim, rimTint) {
    const pick = HD.hash(tr.x, 991, 7, 2);
    const vi = Math.floor(pick * c.canopy.length) % c.canopy.length;
    const cp = c.canopy[vi];
    const bloom = !!cp.blossom;
    const rx = Math.max(2, tr.hw + (bloom ? 0 : 1));
    const ry = Math.max(2, Math.round(tr.h * (bloom ? 0.36 : 0.42)));
    const cy = tr.b - Math.round(tr.h * 0.5) - (bloom ? 1 : 0);
    const tpl = CROWNS[Math.floor(HD.hash(tr.x, 77, 3, 1) * CROWNS.length)];
    const flip = HD.hash(tr.x, 78, 3, 1) < 0.5 ? -1 : 1;
    const twins = c.canopy.filter((q) => !!q.blossom === bloom);
    const clumps = tpl
      .map((q, k) => {
        const R = Math.max(1.2, q[2] * (rx + ry) * (bloom ? 0.42 : 0.48) * (0.8 + 0.4 * HD.hash(tr.x, k, 33, 4)));
        // per-clump colour: mostly the tree's own, sometimes a neighbouring tint
        const col = HD.hash(tr.x, k, 34, 4) < 0.3 ? twins[(twins.indexOf(cp) + 1) % twins.length] : cp;
        return {
          x: tr.x + (q[0] * 1.2 * flip + (HD.hash(tr.x, k, 31, 4) - 0.5) * 0.35) * rx,
          y: cy + (q[1] * 1.15 + (HD.hash(tr.x, k, 32, 4) - 0.5) * 0.35) * ry,
          R,
          v: q[1],
          col,
        };
      })
      .sort((a, b) => b.v - a.v); // lowest first: the upper clumps sit in front
    const inC = (q, x, y) => {
      const dx = x - q.x;
      const dy = y - q.y;
      const r = q.R + 0.35;
      return dx * dx + dy * dy <= r * r;
    };
    // which clump owns each pixel (the last one painted there)
    const x0 = Math.floor(tr.x - rx * 2 - 4);
    const y0 = Math.floor(cy - ry * 2 - 4);
    const bw = rx * 4 + 9;
    const bh = ry * 4 + 9;
    const own = new Int8Array(bw * bh).fill(-1);
    const inBox = (x, y) => x >= x0 && y >= y0 && x < x0 + bw && y < y0 + bh;
    const ownAt = (x, y) => (inBox(x, y) ? own[(y - y0) * bw + (x - x0)] : -1);
    clumps.forEach((q, k) => {
      for (let y = Math.floor(q.y - q.R - 1); y <= q.y + q.R + 1; y++)
        for (let x = Math.floor(q.x - q.R - 1); x <= q.x + q.R + 1; x++) if (inBox(x, y) && inC(q, x, y)) own[(y - y0) * bw + (x - x0)] = k;
    });
    // trunk: darker than the forest band, peeking above it, with a twig
    const trunk = mix(c.forest, N[0], 0.5);
    let low = cy;
    for (let y = y0; y < y0 + bh; y++) if (ownAt(tr.x, y) >= 0) low = y;
    for (let y = low - 1; y <= tr.b; y++) S(tr.x, y, trunk);
    if (tr.h > 8) S(tr.x + flip, low, trunk);
    const rimC = mix(cp.light, rimTint, 0.25);
    for (let y = y0; y < y0 + bh; y++)
      for (let x = x0; x < x0 + bw; x++) {
        const k = ownAt(x, y);
        if (k < 0) continue;
        const q = clumps[k];
        let col = q.col.base;
        // shadowed lower-left edge of this clump's visible part: the dark gap
        if (ownAt(x - 1, y + 1) !== k || ownAt(x, y + 1) !== k) col = q.col.dark;
        if (rim && ownAt(x + 1, y) < 0 && y < cy) col = rimC;
        S(x, y, col);
      }
    // lit patches on top of the upper clumps (bloom clusters on blossom trees)
    for (let k = 0; k < clumps.length; k++) {
      const q = clumps[k];
      if (q.v > 0.3) continue;
      if (bloom && q.x < tr.x - 0.5) continue; // bloom only on the lit upper-right lobes
      const lx = Math.round(q.x + q.R * 0.3);
      const ly = Math.round(q.y - q.R * 0.45);
      const cells = q.R >= 1.9 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0]];
      const drop = Math.floor(HD.hash(tr.x, k, 41, 4) * 4); // knock a corner off the 2x2
      cells.forEach((d, i) => {
        const x = lx + d[0] - (q.R >= 1.9 ? 1 : 0);
        const y = ly + d[1];
        if (cells.length === 4 && i === drop) return;
        if (ownAt(x, y) !== k || ownAt(x, y - 1) < 0) return;
        S(x, y, bloom ? (d[1] === 0 ? c.speck2 : c.speck) : q.col.light);
      });
    }
    // spring: a few pale blossom specks resting on the green crowns
    if (kind === 'spring' && !bloom && HD.hash(tr.x, 13, 5, 1) < 0.55) {
      const top = clumps[clumps.length - 1];
      const sx = Math.round(top.x) + (pick > 0.5 ? 1 : -1);
      const sy = Math.round(top.y - top.R) + 1;
      if (ownAt(sx, sy) >= 0) S(sx, sy, c.speck2);
      if (ownAt(sx - 2, sy + 2) >= 0) S(sx - 2, sy + 2, c.speck);
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
      // a pair of red lanterns hangs by each far cottage door: a dark hook
      // and a 1x2 glowing body, breathing slowly out of step
      const hook = mix(N[1], V[1], 0.5);
      for (let i = 0; i < C.length; i++) {
        for (let j = 0; j < 2; j++) {
          const lx = C[i].x + (j ? 3 : -2);
          const f = T.flicker(T.step(t, 8), 360 + i * 2 + j, 0.6);
          g.px(lx, C[i].y - 1, hook);
          g.px(lx, C[i].y, f > 0.45 ? P.red[6] : P.red[5]);
          g.px(lx, C[i].y + 1, f > 0.7 ? P.red[5] : P.red[4]);
        }
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
