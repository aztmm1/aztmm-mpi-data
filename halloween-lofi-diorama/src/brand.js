/*
 * AZTMM marks, built into the diorama rather than stamped on top of it.
 *  1. The AZTMM HLDGS badge as a hanging inn-style sign on an iron bracket
 *     off the turret (every edition), plus an engraved AZTMM name plate on
 *     the front of the diorama base with a rare cyan-to-violet glint.
 *  2. "AZ" carved into the tree trunk (an easter egg, every edition).
 *  3. Midnight Fireworks only: once per loop one rocket bursts into the
 *     letters AZTMM in the brand gradient.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const C = HD.color;

  const BRAND = { cyan: '#22d3ee', violet: '#a78bfa' };
  const GRAD = C.ramp(BRAND.cyan, BRAND.violet, 6);
  const GRAD_HOT = C.ramp('#d6fbff', '#efe6ff', 6);
  const GRAD_EMBER = C.ramp('#0f5a68', '#4a3a78', 6);

  const SMALL = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'],
    Z: ['###', '..#', '.#.', '#..', '###'],
    T: ['###', '.#.', '.#.', '.#.', '.#.'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  };
  const BIG = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  };
  /** pixel coordinates of a word set in a glyph table */
  function word(font, text, gap) {
    const pts = [];
    let x = 0;
    for (const ch of text) {
      const g = font[ch];
      for (let y = 0; y < g.length; y++) for (let i = 0; i < g[y].length; i++) if (g[y][i] === '#') pts.push([x + i, y]);
      x += g[0].length + gap;
    }
    return { pts, w: x - gap, h: font[text[0]].length };
  }

  // ------------------------------------------------------------------
  // 1a. the AZTMM HLDGS badge (ring, lettering band, the two towers and
  //     the bridge pylons) as a pixel emblem: silver on black, like the
  //     silver-on-black logo.
  // ------------------------------------------------------------------
  const SILVER = ['#0c0d10', '#15161b', '#24262d', '#3a3d46', '#5d616c', '#8a8f9c', '#b4b9c4', '#d2d6de'];
  function bakeEmblem(R) {
    const D = R * 2 + 1;
    return HD.bake(D, D, (g) => {
      const c = R;
      for (let y = 0; y < D; y++) {
        for (let x = 0; x < D; x++) {
          const dx = x - c;
          const dy = y - c;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R + 0.45) continue;
          let col = SILVER[1];
          if (d > R - 0.85) {
            const lit = -dx - dy; // rim lit from the upper left
            col = lit > 4 ? SILVER[6] : lit < -4 ? SILVER[3] : SILVER[5];
          } else if (d > 6.9 && d < 7.9) col = SILVER[5]; // inner ring
          else if (d >= 7.9) {
            // lettering band: small raised marks stand in for the circular text
            const a = Math.atan2(dy, dx);
            const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 40);
            col = d > 8.3 && d < 9.4 && k % 2 === 0 && HD.hash(k, 3, 19) < 0.85 ? SILVER[4] : SILVER[1];
          }
          g.px(x, y, col);
        }
      }
      const L = SILVER[7];
      const M = SILVER[5];
      const K = SILVER[3];
      const P = (x, y, col) => {
        if (x * x + y * y > 6.8 * 6.8) return; // inside the inner ring only
        g.px(c + x, c + y, col);
      };
      // cable-stayed bridge pylons and deck
      for (const sx of [-6, 6]) {
        const o = Math.sign(sx);
        for (let y = -2; y <= 5; y++) P(sx, y, M);
        P(sx - o, -1, K);
        P(sx - o * 2, 0, K);
        P(sx - o * 3, 1, K);
      }
      for (const x of [-6, -5, 5, 6]) P(x, 3, M);
      // left tower: shaft, stepped crown, antenna
      for (let y = -2; y <= 7; y++) {
        P(-4, y, L);
        P(-3, y, y % 3 === 0 ? K : M);
        P(-2, y, L);
      }
      for (let x = -5; x <= -1; x++) P(x, -3, L);
      P(-4, -4, M);
      P(-3, -4, M);
      P(-2, -4, M);
      for (let y = -7; y <= -5; y++) P(-3, y, L);
      // right slab tower with its slanted roof and shaded face
      for (let y = -6; y <= 7; y++) {
        if (y > -6) P(0, y, M);
        P(1, y, L);
        P(2, y, y % 2 ? K : M);
        P(3, y, M);
        P(4, y, L);
      }
      for (let x = 1; x <= 4; x++) P(x, -6, L);
      P(0, -5, L);
    });
  }

  // ------------------------------------------------------------------
  // 1b. hanging inn-style sign on an iron bracket off the turret's right
  //     wall: the badge at eye level beside the house. Scene layer, so the
  //     turret windows warm it; it sways a little; snow settles on it in
  //     the snowy editions.
  // ------------------------------------------------------------------
  // dir -1: the bracket sticks out to the LEFT of the house's left wall, so
  // the campfire warms the sign and it never meets the turret lantern string
  const SIGN = { wallX: 165, dir: -1, armY: 150, armLen: 23, hangOff: 14, R: 10 };
  let emblem = null;
  function drawSign(g, t) {
    if (!emblem) emblem = bakeEmblem(SIGN.R);
    const iron = HD.PAL.stone;
    const S = SIGN;
    const d = S.dir;
    const end = S.wallX + d * S.armLen;
    const hangX = S.wallX + d * S.hangOff;
    const cy = S.armY + 8 + S.R;
    // bracket: arm, curled brace, finial and wall plate
    g.hline(S.wallX, end, S.armY, iron[1]);
    g.hline(S.wallX, end - d, S.armY - 1, iron[3]);
    g.px(end + d, S.armY - 1, iron[2]);
    g.px(end + d, S.armY - 2, iron[3]);
    g.line(S.wallX + d, S.armY + 7, S.wallX + d * 9, S.armY + 1, iron[1]);
    g.px(S.wallX + d * 4, S.armY + 2, iron[2]);
    g.px(S.wallX + d * 5, S.armY + 3, iron[1]);
    g.vline(S.wallX, S.armY - 2, S.armY + 8, iron[2]);
    // gentle sway: at most one pixel either way
    const dx = Math.round(1.15 * T.wave(t, 5.3, 0.2));
    const top = cy - S.R;
    g.line(hangX, S.armY + 1, hangX + dx, top - 2, iron[3]);
    g.px(hangX + dx, top - 1, iron[4]);
    g.sprite(emblem, hangX + dx - S.R, top);
    const ed = HD.edition;
    if (ed.ground === 'snow' || ed.ground === 'thin-snow') {
      const snow = HD.PAL.snow;
      g.hline(S.wallX + d, end, S.armY - 2, snow[6]);
      g.hline(hangX + dx - 4, hangX + dx + 4, top, snow[7]);
      g.hline(hangX + dx - 2, hangX + dx + 2, top - 1, snow[6]);
    }
  }

  // ------------------------------------------------------------------
  // 1c. engraved AZTMM name plate on the front of the diorama base
  // ------------------------------------------------------------------
  const PEWTER = ['#0f1013', '#1c1d22', '#2b2d34', '#40434c', '#5d616c', '#7e838f', '#a9adb8'];
  const TXT = word(SMALL, 'AZTMM', 1);
  const PW = TXT.w + 8;
  const PH = 11;
  const BADGE = { x: 436, y: 255, w: PW, h: PH };
  let badge = null;
  let glintable = null; // plate pixels the glint may light
  function bakeBadge() {
    glintable = new Set();
    badge = HD.bake(PW, PH, (g) => {
      g.rect(0, 0, PW, PH, PEWTER[0]);
      g.rect(1, 1, PW - 2, PH - 2, PEWTER[2]);
      g.hline(1, PW - 2, 1, PEWTER[5]);
      g.vline(1, 1, PH - 2, PEWTER[4]);
      g.hline(1, PW - 2, PH - 2, PEWTER[1]);
      g.vline(PW - 2, 2, PH - 2, PEWTER[1]);
      g.px(2, 5, PEWTER[6]);
      g.px(PW - 3, 5, PEWTER[6]);
      for (let y = 2; y < PH - 2; y++) for (let x = 2; x < PW - 2; x++) glintable.add(x + ',' + y);
      const cut = new Set(TXT.pts.map(([x, y]) => x + ',' + y));
      for (const [x, y] of TXT.pts) {
        g.px(4 + x, 3 + y, PEWTER[0]);
        glintable.delete(4 + x + ',' + (3 + y));
        if (!cut.has(x + ',' + (y + 1))) g.px(4 + x, 4 + y, PEWTER[5]); // lit lower lip of each cut
      }
    });
  }
  function drawPlate(g, t) {
    if (!badge) bakeBadge();
    g.sprite(badge, BADGE.x, BADGE.y);
    // now and then a slow glint in the AZTMM cyan-to-violet sweeps across it
    const ph = T.phase(t, 48, 0.31);
    if (ph < 0.04) {
      const pos = (ph / 0.04) * (BADGE.w + 16) - 8;
      for (let y = 0; y < BADGE.h; y++) {
        for (let x = 0; x < BADGE.w; x++) {
          const d = x + y * 0.6 - pos;
          if (d < 0 || d >= 2.2 || !glintable.has(x + ',' + y)) continue;
          const gi = Math.min(5, Math.floor((x / BADGE.w) * 6));
          g.px(BADGE.x + x, BADGE.y + y, d < 1.1 ? GRAD_HOT[gi] : GRAD[gi]);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 2. "AZ" carved into the trunk
  // ------------------------------------------------------------------
  const CARVE = word(SMALL, 'AZ', 1);
  const CARVE_AT = { x: 401, y: 186 };
  function drawCarving(g) {
    const W = HD.PAL.wood;
    for (const [x, y] of CARVE.pts) g.px(CARVE_AT.x + x, CARVE_AT.y + y, W[6]);
    for (const [x, y] of CARVE.pts) {
      const below = CARVE.pts.some(([a, b]) => a === x && b === y + 1);
      if (!below) g.px(CARVE_AT.x + x, CARVE_AT.y + y + 1, W[1]); // shadow under each cut
    }
  }

  // ------------------------------------------------------------------
  // 3. logo firework (newyear only), once per loop
  // ------------------------------------------------------------------
  const LOGO = word(BIG, 'AZTMM', 2);
  const SP = 2; // spark spacing in px
  const FW = { cx: 296, cy: 24, start: 118, launchY: 150 };
  const LW = LOGO.w * SP;
  const LH = LOGO.h * SP;
  function logoState(t) {
    const L = HD.LOOP;
    const s = (((t - FW.start) % L) + L) % L;
    return s < 5.5 ? s : -1;
  }
  function drawLogoFirework(g, t) {
    const s = logoState(t);
    if (s < 0) return;
    if (s < 1.1) {
      // rocket climbing with a short fading trail
      const u = s / 1.1;
      const e = 1 - (1 - u) * (1 - u);
      const y = Math.round(FW.launchY + (FW.cy - FW.launchY) * e);
      const wob = Math.round(Math.sin(u * 9) * 0.6);
      g.px(FW.cx + wob, y, '#fff6dc');
      for (let k = 1; k <= 4; k++) if (y + k * 2 < FW.launchY) g.px(FW.cx, y + k * 2, k < 2 ? '#ffc96a' : '#7a3a14');
      return;
    }
    const ox = FW.cx - (LW >> 1);
    const oy = FW.cy - (LH >> 1);
    const ts = T.step(t, 12);
    // soft flash behind the word, in the brand gradient
    const glowK = s < 1.5 ? 1 : s < 3.9 ? 0.7 : Math.max(0, 0.7 * (1 - (s - 3.9) / 1.6));
    if (glowK > 0) {
      HD.glow(g, FW.cx - 16, FW.cy, 34, [0.13, 0.6, 0.75], 0.32 * glowK);
      HD.glow(g, FW.cx + 16, FW.cy, 34, [0.45, 0.35, 0.8], 0.32 * glowK);
    }
    for (let i = 0; i < LOGO.pts.length; i++) {
      const [px, py] = LOGO.pts[i];
      const tx = ox + px * SP;
      const ty = oy + py * SP;
      const gi = Math.min(5, Math.floor((px / LOGO.w) * 6));
      let x;
      let y;
      let col;
      if (s < 1.5) {
        // sparks fly out from the burst centre to their letter positions
        const u = (s - 1.1) / 0.4;
        const e = 1 - Math.pow(1 - u, 3);
        x = FW.cx + (tx - FW.cx) * e;
        y = FW.cy + (ty - FW.cy) * e;
        col = GRAD_HOT[gi];
      } else if (s < 3.9) {
        x = tx;
        y = ty;
        col = HD.hash(i, Math.floor(ts * 12), 77) < 0.18 ? GRAD_HOT[gi] : GRAD[gi];
        // a trailing spark fills the gap to the next dot so the letters read solid
        if (HD.hash(i, Math.floor(ts * 12), 78) < 0.8) g.px(x + 1, y + 1, GRAD_EMBER[gi]);
      } else {
        // the letters droop and burn out
        const u = (s - 3.9) / 1.6;
        if (HD.hash(i, 5, 91) < u * 1.15) continue;
        x = tx;
        y = ty + 9 * u * u;
        col = u < 0.45 ? GRAD[gi] : GRAD_EMBER[gi];
      }
      g.px(x, y, col);
    }
  }
  function logoLight(t, L) {
    const s = logoState(t);
    if (s < 1.1) return;
    const k = s < 1.5 ? 1 : s < 3.9 ? 0.75 : Math.max(0, 0.75 * (1 - (s - 3.9) / 1.6));
    if (k > 0) L.add({ x: FW.cx, y: FW.cy, r: 150, color: [0.55, 0.72, 1.0], i: 0.5 * k, bands: 5 });
  }

  HD.module('brand', {
    lights(t, L) {
      if (HD.edition.id === 'newyear') logoLight(t, L);
    },
    passes: [
      { layer: 'bg', z: 9.6, id: 'logo-firework', draw: (g, t) => HD.edition.id === 'newyear' && drawLogoFirework(g, t) },
      { layer: 'scene', z: 12.5, id: 'carving', draw: (g) => drawCarving(g) },
      { layer: 'scene', z: 29.5, id: 'sign', draw: drawSign },
      { layer: 'fx', z: 96, id: 'nameplate', draw: drawPlate },
    ],
  });
})();
