/*
 * weather — the cold half of the palette and the main motion.
 *
 *   bg  z22   far rain: many short dim 1px streaks behind the house
 *   fx  z26   puddle ripples (expanding flat rings inside layout.puddles)
 *   fx  z27   splashes: where mid drops landed on the ground band, random
 *             pops along layout.surfaces, tombstone and jack-o'-lantern tops
 *   fx  z42   mid rain (lands at a random depth on the ground band) + eave drips
 *   fx  z66   near rain: sparse, long, fast; crosses the whole frame
 *
 * Every drop is a stateless HD.time.cycle life with per-life random x, so the
 * whole thing is a pure function of t and loops seamlessly. Each drop takes
 * its colour from the lightmap where it is (HD.lights.lum), quantised to a
 * few precomputed steps: cold blue-grey in the dark, warming through
 * PAL.warmrain around the campfire, the windows and the porch lantern.
 *
 * Seasons: rain runs only when HD.edition.weather.rain > 0. rain = 1 is the
 * original Halloween path, bit for bit; rain < 1 (spring) is sparser, softer
 * and slower, and skips the Halloween-only surfaces (tombstones, jacks).
 * Snow, leaves, petals and fireflies live in weather-seasons.js and plug in
 * through HD.weatherSeasons hooks (far / mid / near passes and lights).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const LY = HD.layout;
  const T = HD.time;
  const S = LY.wind.slant;
  const W = HD.W;
  const H = HD.H;
  const mix = HD.color.mix;
  const hash = HD.hash;
  const lum = HD.lights.lum;

  const G0 = LY.ground.houseBase; // 206: nearest ground behind which mid drops never land
  const G1 = LY.ground.front; // 238: front lip
  const TS = LY.titleSafe;
  const inTitle = (x, y) => x >= TS.x0 - 4 && x <= TS.x1 + 4 && y >= TS.y0 - 4 && y <= TS.y1 + 4;

  // ------------------------------------------------------------------
  // colour tables: [tone][lightLevel] -> css string (all precomputed)
  // ------------------------------------------------------------------
  const LVT = [0.035, 0.08, 0.15, 0.25, 0.38, 0.56];
  function lvOf(l) {
    let k = 0;
    while (k < 6 && l >= LVT[k]) k++;
    return k;
  }
  /** cold colour -> 7 light levels warming through PAL.warmrain */
  function warmRamp(cold, maxW, wk) {
    const out = [cold];
    for (let k = 1; k <= 6; k++) {
      const wi = Math.min(maxW, Math.ceil((k * maxW) / 6));
      out.push(mix(cold, P.warmrain[wi], Math.min(0.9, (0.26 + 0.12 * k) * wk)));
    }
    return out;
  }
  const R = P.rain;
  const FAR = [
    warmRamp(P.night[5], 1, 0.5),
    warmRamp(mix(P.night[5], R[0], 0.8), 1, 0.55),
    warmRamp(mix(R[0], R[1], 0.4), 2, 0.6),
  ];
  const MID = [warmRamp(mix(R[0], R[1], 0.6), 3, 0.9), warmRamp(mix(R[1], R[2], 0.3), 4, 1), warmRamp(mix(R[1], R[2], 0.7), 4, 1)];
  const NEAR = [warmRamp(R[1], 3, 1), warmRamp(mix(R[1], R[2], 0.7), 3, 1), warmRamp(mix(R[2], R[3], 0.45), 4, 1)];
  const SPL = [warmRamp(mix(R[0], R[1], 0.6), 2, 0.9), warmRamp(R[2], 3, 1), warmRamp(mix(R[2], R[3], 0.6), 4, 1)];
  const DRP = [warmRamp(R[1], 3, 1), warmRamp(R[2], 3, 1), warmRamp(R[3], 4, 1)];
  const RIP = [warmRamp(mix(R[0], R[1], 0.7), 2, 0.7), warmRamp(mix(R[1], R[2], 0.45), 3, 0.8), warmRamp(mix(R[2], R[3], 0.3), 3, 0.85)];

  // ------------------------------------------------------------------
  // density breathes slowly between ~80% and 100%; decided per life
  // (at the life's start time) so a drop never pops in or out mid-fall
  // ------------------------------------------------------------------
  const dens = (ts) => 0.8 + 0.2 * T.noise(ts, 47, 6119);

  // ------------------------------------------------------------------
  // edition switch. RK multiplies the density (exactly 1 for Halloween, so
  // the comparisons are bit-identical); SOFT selects the gentle spring rain.
  // ------------------------------------------------------------------
  let RK = 1;
  let SOFT = 0;
  function rainOn() {
    const r = HD.edition.weather.rain || 0;
    if (!(r > 0)) return false;
    RK = r >= 1 ? 1 : 0.3 + 0.7 * r; // spring 0.55 -> ~0.69 of the Halloween density
    SOFT = r >= 1 ? 0 : 1;
    return true;
  }

  // ------------------------------------------------------------------
  // drawing helpers
  // ------------------------------------------------------------------
  /** 1px slanted streak along x = ax + S*y, from row y0 to y1 (inclusive), as clean vertical runs */
  function streak(g, ax, y0, y1, c) {
    if (y0 < 0) y0 = 0;
    if (y1 >= H) y1 = H - 1;
    if (y1 < y0) return;
    let rs = y0;
    let rx = Math.round(ax + S * y0);
    for (let y = y0 + 1; y <= y1; y++) {
      const x = Math.round(ax + S * y);
      if (x !== rx) {
        g.rect(rx, rs, 1, y - rs, c);
        rs = y;
        rx = x;
      }
    }
    g.rect(rx, rs, 1, y1 - rs + 1, c);
  }

  // crown splashes: per size, per frame, [dx, dy, tone]
  const CROWN = [
    // tiny (far ground, roofs)
    [
      [[0, 0, 2], [-1, -1, 1], [1, -1, 1]],
      [[-1, -2, 0], [1, -2, 0]],
    ],
    // small
    [
      [[0, 0, 2], [-1, -1, 1], [1, -1, 1]],
      [[-2, -2, 1], [2, -2, 1], [0, -1, 0]],
      [[-2, -1, 0], [2, -1, 0]],
    ],
    // big (front of the ground band)
    [
      [[-1, 0, 1], [0, 0, 2], [1, 0, 1], [-1, -1, 2], [1, -1, 2]],
      [[-2, -2, 2], [2, -2, 2], [-1, -1, 0], [1, -1, 0], [0, -3, 1]],
      [[-3, -1, 0], [3, -1, 0], [0, -2, 0]],
    ],
  ];
  const SPL_F = 0.042; // seconds per splash frame
  function crown(g, x, y, size, f, tab, lv) {
    const fr = CROWN[size][f];
    if (!fr) return;
    for (let k = 0; k < fr.length; k++) {
      const p = fr[k];
      g.rect(x + p[0], y + p[1], 1, 1, tab[p[2]][lv]);
    }
  }

  // ------------------------------------------------------------------
  // puddles: same footprint as the engine's reflection (row half-widths)
  // ------------------------------------------------------------------
  const PUD = LY.puddles.map((p) => {
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const rx = Math.round(p.rx);
    const ry = Math.round(p.ry);
    const hw = [];
    for (let y = -ry; y <= ry; y++) {
      const dy = y / (ry + 0.5);
      hw.push(Math.floor((rx + 0.4) * Math.sqrt(Math.max(0, 1 - dy * dy))));
    }
    return { cx, cy, rx, ry, hw, n: Math.max(2, Math.round(rx / 6)), rmax: Math.max(3, Math.min(5, Math.round(rx / 4) + 1)) };
  });
  function inPud(pd, x, y) {
    const dy = y - pd.cy;
    if (dy < -pd.ry || dy > pd.ry) return false;
    const dx = x - pd.cx;
    const h = pd.hw[dy + pd.ry];
    return dx >= -h && dx <= h;
  }
  function puddleAt(x, y) {
    for (let k = 0; k < PUD.length; k++) if (inPud(PUD[k], x, y)) return PUD[k];
    return null;
  }
  /** flat 1px elliptical ring (ry ~ rx/3), clipped to a puddle */
  function ering(g, pd, cx, cy, r, c) {
    const ry = r / 3;
    for (let dx = -r; dx <= r; dx++) {
      const h = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (r * r))));
      const x = cx + dx;
      if (inPud(pd, x, cy - h)) g.rect(x, cy - h, 1, 1, c);
      if (h > 0 && inPud(pd, x, cy + h)) g.rect(x, cy + h, 1, 1, c);
    }
  }

  // ------------------------------------------------------------------
  // geometry mirrored from the finished house/props (for where splashes sit)
  // ------------------------------------------------------------------
  const RF = LY.house.roof;
  const TU = LY.house.turret;
  const CH = LY.house.chimney;
  const PO = LY.house.porch;
  const SAG = 1.6;
  const roofL = (y) => {
    const k = (RF.eave - y) / (RF.eave - RF.peakY);
    return RF.x0 + (RF.peakX - RF.x0) * k + SAG * Math.sin(Math.PI * k);
  };
  const roofR = (y) => {
    const k = (RF.eave - y) / (RF.eave - RF.peakY);
    const xr = RF.x1 - 1;
    return xr - (xr - RF.peakX) * k - SAG * Math.sin(Math.PI * k);
  };
  const coneHW = (y) => {
    const k = (y - TU.peakY) / (TU.top - TU.peakY);
    if (k < 0) return -1;
    return 0.6 + 14.3 * Math.pow(k, 1.35) + 1.6 * Math.pow(HD.smoothstep(0.78, 1, k), 2);
  };
  const TCX = (TU.x0 + TU.x1 - 1) / 2;
  const coneCX = (y) => {
    const k = HD.clamp((TU.peakY + 22 - y) / 22, 0, 1);
    return TCX + 4.2 * k * k;
  };
  const roofTop = (x) => {
    for (let y = RF.peakY; y <= RF.eave; y++) if (Math.round(roofL(y)) <= x && x <= Math.round(roofR(y))) return y;
    return -1;
  };
  const JSZ = { big: [9, 6.6], medium: [7, 5.4], small: [5, 4] };
  const JACKS = LY.jackolanterns.map((j) => {
    const s = JSZ[j.size] || JSZ.small;
    return { x: j.x, cy: Math.round(j.base - s[1] - 0.6), rx: s[0], ry: s[1] };
  });
  const jackTop = (J, x) => {
    const dx = x - J.x;
    if (Math.abs(dx) > J.rx) return -1;
    return Math.round(J.cy - J.ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / ((J.rx + 0.5) * (J.rx + 0.5)))));
  };
  function tombInside(kind) {
    if (kind === 'round')
      return (u, v) => (Math.abs(u) <= 7.5 && v >= 0 && v < 2.5) || (Math.abs(u) <= 6.2 && v >= 0 && (v <= 11 || (u * u) / 40 + ((v - 11) * (v - 11)) / 44 <= 1));
    if (kind === 'cross')
      return (u, v) => (Math.abs(u) <= 5.5 && v >= 0 && v < 3) || (Math.abs(u) <= 1.6 && v >= 0 && v <= 21) || (Math.abs(u) <= 6.2 && v >= 13.5 && v <= 16.6);
    if (kind === 'tall')
      return (u, v) => (Math.abs(u) <= 6.5 && v >= 0 && v < 3) || (Math.abs(u) <= 5.5 && v >= 3 && v < 4.5) || (Math.abs(u) <= 4.5 && v >= 4.5 && v <= 25 + (4.6 - Math.abs(u)) * 1.25);
    return (u, v) => Math.abs(u) <= 5.6 && v >= -3 && (v <= 11 || (Math.abs(u) <= 4.2 && v <= 13.2) || (Math.abs(u) <= 2.4 && v <= 14.4));
  }

  /** splash points along surfaces (flat arrays x, y, size) */
  const SX = [];
  const SY = [];
  function addPt(x, y) {
    SX.push(Math.round(x));
    SY.push(Math.round(y));
  }
  // main roof slopes (skip where the chimney and the turret stand in front)
  for (let y = RF.peakY + 2; y <= RF.eave - 1; y++) {
    const xl = Math.round(roofL(y));
    if (xl < CH.x0 - 2 || xl > CH.x1 + 2) addPt(xl, y);
    const xr = Math.round(roofR(y));
    if (xr < TU.x0 - 3) addPt(xr, y);
  }
  // along the roof's top rows too (rain hits the slates, not only the edge)
  for (let x = RF.x0 + 4; x < RF.x1 - 4; x += 3) {
    if ((x >= CH.x0 - 1 && x <= CH.x1 + 1) || x >= TU.x0 - 2) continue;
    const y = roofTop(x);
    if (y > 0) addPt(x, y);
  }
  // turret cone flanks (every other row: they are steep)
  for (let y = TU.peakY + 6; y <= TU.top - 1; y += 2) {
    const hw = coneHW(y);
    const cx = coneCX(y);
    addPt(cx - hw, y);
    addPt(cx + hw, y);
  }
  // porch roof and chimney cap
  for (let x = PO.x0 + 2; x <= PO.x1 - 3; x++) addPt(x, PO.roofY);
  for (let x = CH.x0; x <= CH.x1 + 1; x++) addPt(x, CH.top);
  const NS_HOUSE = SX.length; // house-only surfaces (the rest are Halloween props)
  // tombstone tops (every other column)
  for (const st of LY.tombstones) {
    const inside = tombInside(st.kind);
    const ang = st.kind === 'leaning' ? 0.22 : 0;
    const sink = st.kind === 'leaning' ? 2 : 0;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let x = st.x - 9; x <= st.x + 9; x += 2) {
      for (let y = st.base - 36; y <= st.base; y++) {
        const dx = x - st.x;
        const dy = st.base + sink - y;
        if (inside(dx * ca - dy * sa, dx * sa + dy * ca)) {
          addPt(x, y);
          break;
        }
      }
    }
  }
  // jack-o'-lantern shoulders (not on the stem)
  for (const J of JACKS) {
    for (let dx = -J.rx + 1; dx <= J.rx - 1; dx += 2) {
      if (Math.abs(dx) <= 1) continue;
      addPt(J.x + dx, jackTop(J, J.x + dx));
    }
  }
  const NS = SX.length;

  // ------------------------------------------------------------------
  // eave drips: each its own period, lands on whatever is below
  // ------------------------------------------------------------------
  const GRAV = 420; // px/s^2
  const DRIPS = LY.drips.map((d, j) => {
    let x = Math.round(d.x);
    let y0 = Math.round(d.y);
    if (Math.abs(y0 - (TU.top + 1)) <= 1) {
      // turret-cone lip: hang one pixel under the flare, just outside the wall
      x = x < TCX ? x - 1 : x;
      y0 = TU.top + 2;
    } else if (x > TU.x0 + 1 && x < TU.x1 - 1 && y0 > TU.top + 3) {
      // main-roof eave point hidden behind the turret: use the visible end of the eave
      x = TU.x0 - 4;
    }
    let land = G0 + 3;
    let size = 1;
    // main roof below (the turret-cone drips over the roof)
    if (y0 < RF.eave && x > RF.x0 && x < RF.x1) {
      const rt = roofTop(x);
      if (rt > y0) {
        land = rt;
        size = 0;
      }
    }
    if (size === 1) {
      for (const J of JACKS) {
        const jt = jackTop(J, x);
        if (jt > y0 && jt < land) land = jt;
      }
    }
    const per = 2.5 + 2 * hash(j, 17, 801);
    return { x, y0, land, size, per, td: Math.sqrt((2 * (land - y0 - 1)) / GRAV) };
  });
  // spring: no jack-o'-lanterns to land on, and a slower, lazier drip
  const DRIPS_SOFT = DRIPS.map((D) => {
    const land = D.size === 0 ? D.land : G0 + 3;
    return { x: D.x, y0: D.y0, land, size: D.size, per: D.per * 1.7, td: Math.sqrt((2 * (land - D.y0 - 1)) / GRAV) };
  });

  // per-slot periods (snapped by HD.time.cycle)
  const per = (n, a, b, seed) => Array.from({ length: n }, (_, i) => a + (b - a) * hash(i, seed, 3));
  const FAR_N = 360;
  const MID_N = 280;
  const NEAR_N = 22;
  const SURF_N = 34;
  const FAR_P = per(FAR_N, 1.05, 1.35, 11);
  const MID_P = per(MID_N, 0.5, 0.62, 12);
  const NEAR_P = per(NEAR_N, 0.34, 0.42, 13);
  const SURF_P = per(SURF_N, 0.8, 1.1, 14);
  // spring rain falls a little slower (longer lives) -> softer
  const FAR_PS = FAR_P.map((v) => v * 1.25);
  const MID_PS = MID_P.map((v) => v * 1.3);
  const NEAR_PS = NEAR_P.map((v) => v * 1.3);
  const FARP = () => (SOFT ? FAR_PS : FAR_P);
  const MIDP = () => (SOFT ? MID_PS : MID_P);
  const NEARP = () => (SOFT ? NEAR_PS : NEAR_P);
  const FIRE = LY.campfire;
  const nearFlame = (x, y) => Math.abs(x - FIRE.x) < FIRE.flameW * 0.6 && y > FIRE.base - 10 && y < FIRE.base + 3;

  // ------------------------------------------------------------------
  // passes
  // ------------------------------------------------------------------
  function drawFar(g, t) {
    for (let i = 0; i < FAR_N; i++) {
      const c = T.cycle(t, i, FARP()[i], 3301);
      const age = c.age;
      if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
      const yEnd = 200 + c.rnd(1) * 6;
      const xEnd = c.rnd(0) * (W + 24) - 12;
      const r3 = c.rnd(3);
      const len = c.rnd(2) < 0.55 ? 2 : 3;
      const ax = xEnd - S * yEnd;
      const yh = Math.round(-4 + (yEnd + 4) * age);
      const xh = ax + S * yh;
      let b = r3 < 0.3 ? 0 : r3 < 0.88 ? 1 : 2;
      if (b > 0 && ((SOFT && r3 > 0.7) || inTitle(xh, yh))) b--;
      streak(g, ax, yh - len + 1, yh, FAR[b][lvOf(lum(xh, yh) * 0.6)]);
    }
  }

  function drawMid(g, t) {
    for (let i = 0; i < MID_N; i++) {
      const c = T.cycle(t, i, MIDP()[i], 4409);
      const age = c.age;
      if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
      const d = c.rnd(1);
      const yl = G0 + Math.round(d * (G1 - 1 - G0));
      const xl = c.rnd(0) * (W + 30) - 15;
      const len = 3 + Math.round(d * 2 + c.rnd(2) * 1.2) - SOFT;
      const r3 = c.rnd(3);
      const ax = xl - S * yl;
      const yh = Math.round(-8 + (yl + 8) * age);
      const xh = ax + S * yh;
      let b = d > 0.6 ? (r3 < 0.6 ? 2 : 1) : r3 < 0.25 ? 0 : r3 < 0.85 ? 1 : 2;
      if (b > 0 && (inTitle(xh, yh) || (SOFT && r3 < 0.4))) b--;
      streak(g, ax, yh - len + 1, yh, MID[b][lvOf(lum(xh, yh))]);
    }
  }

  function drawGroundSplashes(g, t) {
    const SPL_T = SPL_F * 3;
    for (let i = 0; i < MID_N; i++) {
      const c = T.cycle(t, i, MIDP()[i], 4409);
      const ts = c.age * c.P;
      if (ts >= SPL_T) continue;
      const pc = c.prev;
      if (c.rnd(7, pc) > dens(t - ts - c.P) * RK) continue;
      const d = c.rnd(1, pc);
      const yl = G0 + Math.round(d * (G1 - 1 - G0));
      const xl = Math.round(c.rnd(0, pc) * (W + 30) - 15);
      if (xl < 1 || xl > W - 2 || nearFlame(xl, yl)) continue;
      const lv = lvOf(lum(xl, yl));
      const pd = puddleAt(xl, yl);
      const f = Math.floor(ts / SPL_F);
      if (pd) {
        // a drop into a puddle makes a tiny ring instead of a crown
        if (f === 0) g.rect(xl, yl, 1, 1, RIP[2][lv]);
        else ering(g, pd, xl, yl, f + 1, RIP[f === 1 ? 1 : 0][lv]);
        continue;
      }
      const size = d < 0.3 ? 0 : d < 0.7 || SOFT ? 1 : 2;
      crown(g, xl, yl, size, f, SPL, lv);
    }
  }

  function drawSurfaceSplashes(g, t) {
    for (let i = 0; i < SURF_N; i++) {
      const c = T.cycle(t, i, SURF_P[i], 5501);
      const ts = c.age * c.P;
      if (ts >= SPL_F * 2) continue;
      if (c.rnd(7) > dens(t - ts) * RK) continue;
      const k = Math.floor(c.rnd(0) * (SOFT ? NS_HOUSE : NS));
      const x = SX[k];
      const y = SY[k];
      crown(g, x, y, 0, Math.floor(ts / SPL_F), SPL, lvOf(lum(x, y - 1)));
    }
  }

  function drawRipples(g, t) {
    for (let k = 0; k < PUD.length; k++) {
      const pd = PUD[k];
      for (let s = 0; s < pd.n; s++) {
        const c = T.cycle(t, k * 16 + s, 0.85 + 0.4 * hash(k, s, 77), 7707);
        const age = c.age;
        if (age > 0.7) continue;
        if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
        const rmax = pd.rmax - (c.rnd(3) < 0.4 ? 1 : 0);
        const a = age / 0.7;
        const r = 1 + Math.floor(rmax * a * (1.6 - 0.6 * a));
        if (r > rmax) continue;
        const cx = Math.round(pd.cx + (c.rnd(0) * 2 - 1) * Math.max(0, pd.rx - rmax - 1));
        const cy = pd.cy + Math.round((c.rnd(1) * 2 - 1) * Math.max(0, pd.ry - 1.6));
        const tone = a < 0.3 ? 2 : a < 0.65 ? 1 : 0;
        ering(g, pd, cx, cy, r, RIP[tone][lvOf(lum(cx, cy))]);
      }
    }
  }

  function drawDrips(g, t) {
    const DR = SOFT ? DRIPS_SOFT : DRIPS;
    for (let j = 0; j < DR.length; j++) {
      const D = DR[j];
      const c = T.cycle(t, j, D.per, 8801);
      const Pd = c.P;
      const ts = c.age * Pd;
      const tr = Pd * 0.62; // let go
      const x = D.x;
      const y0 = D.y0;
      const lv = lvOf(lum(x, y0));
      if (ts < tr) {
        // the bead swells: 1px, then 2px, then stretches just before letting go
        const k = ts / tr;
        if (k < 0.18) continue;
        if (k < 0.55) g.rect(x, y0, 1, 1, DRP[k < 0.35 ? 0 : 1][lv]);
        else if (k < 0.92) {
          g.rect(x, y0, 1, 1, DRP[1][lv]);
          g.rect(x, y0 + 1, 1, 1, DRP[2][lv]);
        } else {
          g.rect(x, y0, 1, 1, DRP[0][lv]);
          g.rect(x, y0 + 1, 1, 1, DRP[1][lv]);
          g.rect(x, y0 + 2, 1, 1, DRP[2][lv]);
        }
        continue;
      }
      const tf = ts - tr;
      if (tf < D.td) {
        const yh = Math.round(y0 + 1 + 0.5 * GRAV * tf * tf);
        const len = 2 + Math.min(2, Math.floor((GRAV * tf) / 110));
        const lvf = lvOf(lum(x, yh));
        g.rect(x, yh - len + 1, 1, len - 1, DRP[1][lvf]);
        g.rect(x, yh, 1, 1, DRP[2][lvf]);
        continue;
      }
      const f = Math.floor((tf - D.td) / SPL_F);
      if (f < 3) crown(g, x, D.land, D.size, f, SPL, lvOf(lum(x, D.land)));
    }
  }

  function drawNear(g, t) {
    for (let i = 0; i < NEAR_N; i++) {
      const c = T.cycle(t, i, NEARP()[i], 6607);
      const age = c.age;
      if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
      const len = SOFT ? 5 + Math.floor(c.rnd(2) * 5) : 8 + Math.floor(c.rnd(2) * 7);
      const ax = c.rnd(0) * (W + 80) - 70;
      const r3 = c.rnd(3);
      const yh = Math.round(-18 + (H + 34) * age);
      const ym = yh - (len >> 1);
      const xm = ax + S * ym;
      const lv = lvOf(lum(xm, ym));
      let b = i < 4 ? 2 - SOFT : r3 < 0.4 ? 0 : 1;
      if (b > 0 && inTitle(xm, ym)) b--;
      streak(g, ax, yh - len + 1, yh, NEAR[b][lv]);
      if (i < 4 && !SOFT) streak(g, ax + 1, yh - len + 3, yh - 1, NEAR[0][lv]);
    }
  }

  // seasonal layers (weather-seasons.js fills these hooks; read at draw time)
  const SEA = (HD.weatherSeasons = HD.weatherSeasons || {});
  const hook = (k) => (g, t) => {
    const f = SEA[k];
    if (f) f(g, t);
  };

  HD.module('weather', {
    lights(t, L) {
      if (SEA.lights) SEA.lights(t, L);
    },
    passes: [
      {
        layer: 'bg',
        z: 22,
        id: 'far-rain',
        draw(g, t) {
          if (rainOn()) drawFar(g, t);
        },
      },
      { layer: 'bg', z: 23, id: 'far-season', draw: hook('far') },
      {
        layer: 'fx',
        z: 26,
        id: 'ripples',
        draw(g, t) {
          if (rainOn()) drawRipples(g, t);
        },
      },
      {
        layer: 'fx',
        z: 27,
        id: 'splashes',
        draw(g, t) {
          if (!rainOn()) return;
          drawGroundSplashes(g, t);
          drawSurfaceSplashes(g, t);
        },
      },
      {
        layer: 'fx',
        z: 42,
        id: 'mid-rain',
        draw(g, t) {
          if (!rainOn()) return;
          drawMid(g, t);
          drawDrips(g, t);
        },
      },
      { layer: 'fx', z: 43, id: 'mid-season', draw: hook('mid') },
      {
        layer: 'fx',
        z: 66,
        id: 'near-rain',
        draw(g, t) {
          if (rainOn()) drawNear(g, t);
        },
      },
      { layer: 'fx', z: 67, id: 'near-season', draw: hook('near') },
    ],
  });
})();
