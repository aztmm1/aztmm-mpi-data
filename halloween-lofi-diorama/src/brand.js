/*
 * AZTMM marks, built into the diorama rather than stamped on top of it.
 *  1. A brass nameplate on the front of the diorama base (every edition),
 *     with a slow cyan-to-violet glint in the AZTMM brand gradient.
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
  // brass derived from the AZTMM gold (#c9a961), dimmed for the night base
  const BRASS = ['#17120a', '#2a2214', '#463823', '#6b5836', '#8f7a4c', '#b39b66', '#c9a961'];
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
  // 1. nameplate
  // ------------------------------------------------------------------
  const PLATE = { x: 431, y: 254 };
  const TXT = word(SMALL, 'AZTMM', 1);
  const PW = TXT.w + 8;
  const PH = 11;
  let plate = null;
  let letterMask = null;
  function bakePlate() {
    letterMask = new Set(TXT.pts.map(([x, y]) => x + 4 + ',' + (y + 3)));
    plate = HD.bake(PW, PH, (g) => {
      g.rect(0, 0, PW, PH, BRASS[0]);
      g.rect(1, 1, PW - 2, PH - 2, BRASS[2]);
      g.hline(1, PW - 2, 1, BRASS[4]); // top bevel catches light
      g.vline(1, 1, PH - 2, BRASS[3]);
      g.hline(1, PW - 2, PH - 2, BRASS[1]); // bottom bevel in shadow
      g.vline(PW - 2, 2, PH - 2, BRASS[1]);
      g.px(2, 5, BRASS[5]); // screws
      g.px(PW - 3, 5, BRASS[5]);
      for (const [x, y] of TXT.pts) {
        g.px(x + 4, y + 3, BRASS[0]); // engraved letter
        const k = x + 4 + ',' + (y + 4);
        if (!letterMask.has(k) && y + 4 < PH - 2) g.px(x + 4, y + 4, BRASS[4]); // lit lower lip of the cut
      }
    });
  }
  function drawPlate(g, t) {
    if (!plate) bakePlate();
    g.sprite(plate, PLATE.x, PLATE.y);
    // a slow glint sweeps across the plate about every 24 s, in brand colours
    const ph = T.phase(t, 24, 0.31);
    if (ph < 0.07) {
      const pos = (ph / 0.07) * (PW + 12) - 6;
      for (let y = 1; y < PH - 1; y++) {
        for (let x = 1; x < PW - 1; x++) {
          const d = x + y * 0.6 - pos;
          if (d < 0 || d >= 2.2) continue;
          if (letterMask.has(x + ',' + y)) continue;
          const gi = Math.min(5, Math.floor((x / PW) * 6));
          g.px(PLATE.x + x, PLATE.y + y, d < 1.1 ? GRAD_HOT[gi] : GRAD[gi]);
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
      { layer: 'fx', z: 96, id: 'nameplate', draw: drawPlate },
    ],
  });
})();
