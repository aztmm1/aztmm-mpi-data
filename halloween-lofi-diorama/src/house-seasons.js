/*
 * house-seasons.js - seasonal dressing of the Rainy Hollow cottage.
 *
 * house.js bakes the cottage and its interiors once per edition (HD.perEdition)
 * and calls into this file (HD.houseKit.seasons) for every edition except
 * Halloween, which keeps its original code path pixel for pixel:
 *
 *   omit(ed)               interior pieces of the Halloween dressing to leave out
 *   decorateHouse(R, ed)   roof/turret/porch/sill snow, icicles, the lantern-string hook
 *   decorateInterior(I,ed) static decorations drawn over the glass (window
 *                          boxes, garlands, wreaths, banners, menorah, tree...)
 *   winCfg / winBoost / glass   per-edition window glow (party, menorah window)
 *   drawInside / drawFront      animated bits (flames, bulbs, lanterns, diyas)
 *   lights(t, L)                every decoration light (aggregated)
 *
 * The black cat is drawn by house.js and is identical in every edition;
 * nothing here paints over its window.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const K = HD.houseKit;
  if (!K) return;
  const P = HD.PAL;
  const T = HD.time;
  const FE = HD.festive;
  const LH = HD.layout.house;
  const LIGHT = HD.LIGHT;
  const clamp = HD.clamp;
  const RND = Math.round;

  const S = P.stone;
  const W = P.wood;
  const A = P.amber;
  const F = P.fire;
  const SN = P.snow;
  const IC = P.ice;
  const LF = P.leaf;
  const RD = P.red;
  const GD = P.gold;
  const MG = P.marigold;
  const BL = P.blossom;
  const AU = P.autumn;
  const BN = P.bone;
  const V = P.violet;
  const TG = K.TG;
  const HOLE = K.HOLE;

  const has = (ed, t) => ed.tagSet.has(t);
  const WIN = {};
  K.WINS.forEach((w, i) => {
    WIN[w.w.id] = w;
    w.index = i;
  });
  const RF = LH.roof;
  const TU = LH.turret;
  const CHM = LH.chimney;
  const PO = LH.porch;
  const STP = LH.steps;
  const DX0 = K.DX0;
  const DX1 = K.DX1;
  const DY0 = K.DY0;

  /** smooth 1D bump noise in [0,1] (build time only) */
  function bump(x, seed, period) {
    const u = x / period;
    const i = Math.floor(u);
    const f = u - i;
    const a = HD.hash(i, seed, 5);
    const b = HD.hash(i + 1, seed, 5);
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  }

  // ===================================================================
  // SNOW (baked into the house raster)
  // ===================================================================
  /**
   * Hang a run of icicles from y = yAt(x). `out` is the raster they are painted
   * into (the house itself, or the overlay drawn in front of the string
   * lights); `R` is the house (windows stop them). `avoid` holds the string
   * bulbs (key x*512+y): an icicle never touches a bulb, so the two read
   * separately, and next to a string the icicles are long enough (minLen) to
   * hang clear below the bulb row.
   */
  const key = (x, y) => x * 512 + y;
  function icicleRun(out, R, xa, xb, yAt, seed, minLen, maxLen, density, avoid) {
    let last = -9;
    for (let x = xa; x <= xb; x++) {
      const y = yAt(x);
      if (y === null) continue;
      const h = HD.hash(x, seed, 11);
      if (h > density || x - last < 2) continue;
      const len = minLen + Math.floor(Math.pow(HD.hash(x, seed, 12), 1.8) * (maxLen - minLen + 1));
      let clash = false;
      if (avoid && avoid.size)
        for (let dx = -1; dx <= 1 && !clash; dx++) for (let yy = y - 1; yy <= y + len; yy++) if (avoid.has(key(x + dx, yy))) clash = true;
      if (clash) continue;
      last = x;
      for (let k = 0; k < len; k++) {
        const yy = y + k;
        if (R.get(x, yy) === HOLE) break;
        const c = k === len - 1 ? IC[5] : k === 0 ? IC[4] : k === len - 2 ? IC[4] : IC[3];
        out.set(x, yy, c, TG.gutter);
      }
      if (len >= 4) out.set(x + 1, y, IC[2], TG.gutter);
    }
  }

  /** soft left->right sky-glow gradient on snow: level lo..lo+1, Bayer-dithered */
  const snowLvl = (x, y, lo) => lo + (HD.bayer(x, y) < HD.smoothstep(0.25, 0.8, (x - RF.x0) / (RF.x1 - RF.x0)) ? 1 : 0);

  function snowRoof(R, heavy, ice, avoid) {
    const rows = K.courses(21, RF.x0 - 4, RF.x1 + 4, 6, 10);
    const pillows = K.courses(61, RF.x0 - 4, RF.x1 + 4, 8, 17);
    const x0 = RF.x0 - 2;
    const x1 = RF.x1 + 2;
    const lipBottom = new Map();
    // where the slate shows through (thin snow at the verges, by the chimney)
    const nearEdge = (x, y) => {
      for (let k = 1; k <= 3; k++) if (R.get(x - k, y) === null || R.get(x + k, y) === null) return true;
      return false;
    };
    const nearChimney = (x, y) => x >= CHM.x0 - 2 && x <= CHM.x1 + 1 && y <= 114;
    // --- slope -----------------------------------------------------
    for (let y = RF.peakY - 5; y <= RF.eave + 2; y++)
      for (let x = x0; x <= x1; x++) {
        const tg = R.tg(x, y);
        if (tg !== TG.roof && tg !== TG.moss) continue;
        const dip = K.roofDip(x);
        if (heavy) {
          // a deep, even blanket (one plane, no seam: the night is overcast and
          // moonless) broken by pillows of drifted snow on every other band of
          // slates: a lit, rounded top, a body, and a shadow line under the
          // overhang. Kept a step darker than fresh snow so the roof stays in
          // the cold part of the frame and the windows stay the brightest thing.
          const rc = RF.eave - 2 + Math.round(dip) - y;
          let c = SN[4];
          const band = Math.floor(rc / 8);
          const v = ((rc % 8) + 8) % 8;
          const pj = pillows(band);
          const pk = K.seg(pj, x);
          const pa = pj[pk];
          const pb = pk + 1 < pj.length ? pj[pk + 1] : x + 99;
          if (HD.hash(band, pk, 63) < 0.6 && band > 0) {
            const tone = HD.hash(band, pk, 65) < 0.45 ? -1 : 0; // vary each pillow by a step
            if (v === 0 && x > pa + 1 && x < pb - 2) c = SN[3];
            else if (v === 1 && x > pa && x < pb - 1) c = SN[6 + tone];
            else if (v === 2 && x > pa + 1 && x < pb - 2) c = SN[6 + tone];
            else if (v === 3 && x > pa + 3 && x < pb - 4) c = SN[7 + tone];
          }
          // slate shadow lines peeking through where the snow is thin
          if (((rc % 4) + 4) % 4 === 3 && (nearEdge(x, y) || nearChimney(x, y))) {
            const rr = Math.floor(rc / 4);
            if (HD.hash(rr, K.seg(rows(rr), x), 66) < 0.55) c = S[2];
          }
          const up = R.tg(x, y - 1);
          if (up !== TG.roof && up !== TG.moss) c = SN[6];
          if (R.get(x - 1, y) === null) c = SN[3];
          else if (R.get(x + 1, y) === null) c = SN[6]; // a soft sky-glow edge (moonless: no rim)
          R.set(x, y, c, TG.roof);
        } else {
          // a dusting: snow resting on the lip of every other slate
          const gy = RF.eave - 1 + (dip > 1.6 ? 1 : 0);
          if (y >= gy) continue;
          const rc = RF.eave - 2 + Math.round(dip) - y;
          const rr = Math.floor(rc / 4);
          const v = ((rc % 4) + 4) % 4;
          const js = rows(rr);
          const k = K.seg(js, x);
          const nxt = k + 1 < js.length ? js[k + 1] : x + 99;
          if (x === js[k]) continue;
          const dens = 0.42 + 0.25 * (1 - (RF.eave - y) / (RF.eave - RF.peakY));
          if (HD.hash(rr, k, 77) > dens) continue;
          if (v === 0) R.set(x, y, SN[snowLvl(x, y, 5)], TG.roof);
          else if (v === 1 && x > js[k] + 1 && x < nxt - 2) R.set(x, y, SN[snowLvl(x, y, 4)], TG.roof);
        }
      }
    // --- ridge crest + eave lip ------------------------------------
    for (let x = x0; x <= x1; x++) {
      // top edge: the ridge line gets a crest
      let ytop = null;
      for (let y = RF.peakY - 5; y <= RF.eave; y++) {
        const tg = R.tg(x, y);
        if (tg === TG.roof || tg === TG.moss) {
          ytop = y;
          break;
        }
      }
      if (ytop !== null && heavy && R.get(x, ytop - 1) === null) R.set(x, ytop - 1, HD.hash(x >> 2, 7, 67) < 0.3 ? SN[7] : SN[6], TG.roof);
      else if (ytop !== null && !heavy) R.set(x, ytop, SN[snowLvl(x, ytop, 5)], TG.roof);
      // the gutter row
      let yb = null;
      for (let y = RF.eave + 2; y >= RF.eave - 3; y--) {
        if (R.tg(x, y) === TG.gutter) {
          yb = y;
          break;
        }
      }
      if (yb === null) continue;
      if (heavy) {
        // the thick front edge of the blanket, curling over the gutter
        for (let y = yb - 2; y <= yb; y++) if (R.tg(x, y) === TG.gutter || R.tg(x, y) === TG.roof) R.set(x, y, y === yb - 2 ? SN[6] : SN[5], TG.roof);
        const lip = bump(x, 3, 6) > 0.45 ? 2 : 1;
        for (let d = 1; d <= lip; d++) R.set(x, yb + d, d === lip ? SN[3] : SN[4], TG.roof);
        lipBottom.set(x, yb + lip + 1);
      } else {
        if (bump(x, 4, 5) > 0.3) R.set(x, yb - 1, SN[6], TG.roof);
        lipBottom.set(x, yb + 1);
      }
    }
    if (heavy) {
      // icicles along the eave hang in front of the string lights (overlay)
      icicleRun(ice, R, RF.x0 + 1, RF.x1 - 2, (x) => (lipBottom.has(x) ? lipBottom.get(x) : null), 41, 4, 7, 0.75, avoid);
      // the round attic window: a cap of snow on its frame, a shadow pocket under the sill
      const a = LH.windows.find((w) => w.round);
      R.rows(['..mmmmm..', '.mlllllm.', 'm.......m'], a.cx - 4, a.cy - a.r - 4, { m: SN[5], l: SN[6] }, TG.roof);
      R.hl(a.cx - 4, a.cx + 4, a.cy + a.r + 4, SN[3], TG.roof);
      R.hl(a.cx - 2, a.cx + 2, a.cy + a.r + 5, SN[4], TG.roof);
    }
  }

  const CONE_TILE = ['BBBBBB', 'BBBBBB', 'OBHHBO', 'BOOOOB'];
  function snowCone(R, heavy, ice, avoid) {
    const lip = new Map();
    for (let y = TU.peakY; y <= TU.top + 1; y++) {
      const hw = K.coneHW(Math.min(y, TU.top));
      const cx = K.coneCX(y);
      const xl = Math.round(cx - hw);
      const xr = Math.round(cx + hw);
      for (let x = xl; x <= xr; x++) {
        if (R.tg(x, y) !== TG.cone) continue;
        const u = clamp((x - cx) / Math.max(hw, 0.5), -1, 1);
        const ybot = TU.top + (Math.abs(u) > 0.8 ? 1 : 0);
        const q = (u + 0.35) / 0.55 + (K.chk(x, y) ? 0.15 : -0.15);
        const sh = q < 0 ? -1 : q < 1 ? 0 : 1;
        let ch;
        if (y === ybot) ch = 'L';
        else if (y >= ybot - 2) ch = 'T';
        else {
          const ry = ybot - 3 - y;
          const rr = Math.floor(ry / 4);
          const v = 3 - (ry % 4);
          const s = Math.asin(u) * hw;
          const pos = s / 6 + rr * 0.5 + 0.25;
          const col = Math.floor((pos - Math.floor(pos)) * 6);
          ch = CONE_TILE[v][col];
          if (!heavy && v === 2 && (col === 1 || col === 4)) ch = 'h';
        }
        const edgeR = R.get(x + 1, y) === null;
        if (heavy) {
          let c;
          // a step darker than fresh snow, like the main roof
          if (ch === 'L') c = SN[3];
          else if (ch === 'T') c = SN[5 + (sh > 0 ? 1 : 0)];
          else if (ch === 'O') c = SN[3 + Math.max(0, sh)];
          else if (ch === 'H') c = SN[6];
          else c = SN[4 + Math.max(0, sh)];
          if (edgeR) c = SN[6]; // soft sky-glow edge (the heavy-snow night is moonless)
          if (R.get(x - 1, y) === null && ch !== 'L') c = SN[4];
          R.set(x, y, c, TG.cone);
          if (ch === 'L') lip.set(x, y);
        } else {
          if (ch === 'H') R.set(x, y, sh > 0 ? SN[7] : SN[6], TG.cone);
          else if (ch === 'h' && sh >= 0) R.set(x, y, SN[5], TG.cone);
          else if (ch === 'T' && y === ybot - 1 && bump(x, 8, 4) > 0.35) R.set(x, y, SN[6], TG.cone);
        }
      }
    }
    // snow cap on the finial knob
    const tx = Math.round(K.coneCX(TU.peakY));
    R.set(tx, TU.peakY - 2, SN[7], TG.fin);
    if (heavy) {
      R.hl(tx - 1, tx + 1, TU.peakY - 1, SN[6], TG.fin);
      // droopy brim and icicles over the turret wall
      for (const [x, y] of lip) if (bump(x, 9, 4) > 0.5) R.set(x, y + 1, SN[3], TG.cone);
      icicleRun(ice, R, TU.x0 + 1, TU.x1 - 2, (x) => (lip.has(x) ? lip.get(x) + (bump(x, 9, 4) > 0.5 ? 2 : 1) : null), 43, 4, 6, 0.7, avoid);
    }
  }

  function snowChimney(R, heavy) {
    const xa = CHM.x0;
    const xb = CHM.x1 + 1;
    const top = CHM.top;
    if (heavy) {
      R.hl(xa, xb, top - 1, SN[6], TG.chim);
      R.hl(xa + 1, xb - 1, top - 2, SN[6], TG.chim);
      R.hl(xa + 3, xb - 2, top - 3, SN[7], TG.chim);
      R.set(xa, top - 1, SN[4], TG.chim);
      R.set(xb, top - 1, SN[7], TG.chim);
      R.set(xa + 1, top - 2, SN[7], TG.chim);
      R.set(xa + 3, top, SN[5], TG.chim);
      R.set(xa + 4, top, SN[4], TG.chim);
    } else {
      R.hl(xa + 1, xb - 2, top - 1, SN[6], TG.chim);
      R.set(xb - 1, top - 1, SN[5], TG.chim);
    }
  }

  function snowPorch(R, heavy, ice, avoid) {
    const x0 = PO.x0;
    const x1 = PO.x1 - 1;
    const y0 = PO.roofY;
    if (heavy) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const e = Math.min(x - x0, x1 - x);
        const h = e < 1 ? 1 : e < 4 ? 2 : 2 + (bump(x, 21, 6) > 0.5 ? 1 : 0);
        for (let k = 0; k < h; k++) R.set(x, y0 - 1 - k, k === h - 1 ? SN[7] : SN[6], TG.porch);
        R.set(x, y0, SN[5], TG.porch);
        if (bump(x, 22, 5) > 0.55) R.set(x, y0 + 1, SN[4], TG.porch);
      }
      R.set(x0 - 1, y0 - 1, SN[4], TG.porch);
      // (clear of the iron lantern's hook; the porch string rides the fascia above)
      icicleRun(R, R, x0 + 2, x1 - 2, (x) => (Math.abs(x - LH.lantern.hookX) <= 3 ? null : x > x0 + 10 && x < x1 - 9 ? y0 + 9 : y0 + 8), 47, 2, 5, 0.5, avoid);
    } else {
      for (let x = x0 + 1; x <= x1 - 1; x++) if (bump(x, 23, 4) > 0.25) R.set(x, y0, SN[6], TG.porch);
      for (let x = x0 + 4; x <= x1 - 4; x++) if (bump(x, 24, 5) > 0.55) R.set(x, y0 - 1, SN[6], TG.porch);
    }
  }

  function snowSills(R, heavy) {
    for (const win of K.WINS) {
      const w = win.w;
      if (w.round) continue;
      const bx0 = w.x - 3;
      const bx1 = w.x + w.w + 2;
      const sy = w.y + w.h + 2;
      if (heavy) {
        for (let x = bx0; x <= bx1; x++) {
          const mid = x > bx0 + 1 && x < bx1 - 1;
          R.set(x, sy - 1, mid ? SN[6] : SN[5], TG.frame);
          if (mid && bump(x, w.x, 4) > 0.4) {
            if (R.get(x, sy - 2) !== HOLE) R.set(x, sy - 2, SN[7], TG.frame);
          }
        }
        R.set(bx1, sy - 1, SN[7], TG.frame);
        // snow on the lintel / keystone
        if (!win.c.arch) {
          for (let x = bx0; x <= bx1; x++) R.set(x, w.y - 5, x === bx0 ? SN[5] : SN[6], TG.frame);
          for (let x = bx0 + 2; x <= bx1 - 3; x++) if (bump(x, w.y, 5) > 0.6) R.set(x, w.y - 6, SN[7], TG.frame);
        } else {
          const kx = Math.round(w.x + w.w / 2 - 0.5);
          R.hl(kx - 1, kx + 1, w.y - 5, SN[6], TG.frame);
          R.set(kx, w.y - 6, SN[7], TG.frame);
        }
      } else {
        for (let x = bx0 + 1; x <= bx1 - 1; x++) if (bump(x, w.x + 3, 4) > 0.3) R.set(x, sy - 1, SN[5], TG.frame);
      }
    }
  }

  function snowFooting(R, heavy) {
    const spans = [
      [LH.body.x0 - 2, PO.postL - 3],
      [PO.postR + 2, TU.x1 - 1],
    ];
    for (const [xa, xb] of spans)
      for (let x = xa; x <= xb; x++) {
        const b = bump(x, 31, heavy ? 7 : 5);
        const h = heavy ? 1 + Math.round(b * 3) : b > 0.62 ? 1 : 0;
        for (let k = 0; k < h; k++) {
          const y = 205 - k;
          if (R.get(x, y) === null || R.get(x, y) === HOLE) continue;
          R.set(x, y, k === h - 1 ? SN[6] : SN[5], TG.found);
        }
      }
    if (heavy) {
      // swept steps: snow only at the ends
      for (const [xa, xb] of [
        [STP.x0 + 2, STP.x0 + 4],
        [STP.x1 - 5, STP.x1 - 3],
      ]) {
        R.hl(xa, xb, 206, SN[6], TG.steps);
        R.hl(xa - 1, xb + 1, 205, SN[7], TG.steps);
      }
      for (const [xa, xb] of [
        [STP.x0, STP.x0 + 2],
        [STP.x1 - 3, STP.x1 - 1],
      ]) {
        R.hl(xa, xb, 209, SN[6], TG.steps);
        R.hl(xa, xb, 208, SN[7], TG.steps);
      }
    }
  }

  function snowAll(R, heavy, ice, avoid) {
    snowRoof(R, heavy, ice, avoid);
    snowCone(R, heavy, ice, avoid);
    snowChimney(R, heavy);
    snowPorch(R, heavy, ice, avoid);
    snowSills(R, heavy);
    snowFooting(R, heavy);
    // ridge finial cap
    R.set(RF.peakX, RF.peakY - 5, SN[7], TG.roof);
  }

  /** small iron bracket on the turret where the lantern string starts */
  const HOOK = HD.layout.seasonal.lanternString.from;
  function paintHook(R) {
    const [hx, hy] = HOOK;
    // p plate (cold iron, moonlit top), a arm, d drop, c curl, s shadow on the wall
    R.rows(['.P....', 'pPaaaa', 'p....d', 'p..c.d', 's...c.'], hx - 4, hy - 3, { P: S[6], p: S[4], a: S[5], d: S[4], c: S[3], s: S[1] }, TG.iron);
  }

  // ===================================================================
  // STATIC DECORATIONS (baked into the per-edition overlay = interior raster)
  // ===================================================================
  const stamp = (I, rows, x, y, map) => I.rows(rows, Math.round(x), Math.round(y), map, 0);

  // --- door wreaths (9 x 10, centred on the door) ---------------------
  const WREATH = ['..lmmml..', '.lmdmmmd.', 'lmd...mdd', 'lm.....dd', 'mm.....dd', 'md.....dd', '.md...dd.', '..mdddd..'];
  function wreath(I, kind) {
    const x = DX0 + 3;
    const y = DY0 + 8;
    let map;
    if (kind === 'evergreen') map = { l: LF[5], m: LF[3], d: LF[1] };
    else if (kind === 'flower') map = { l: LF[6], m: LF[4], d: LF[2] };
    else map = { l: AU[6], m: AU[4], d: AU[2] };
    stamp(I, WREATH, x, y, map);
    const put = (lx, ly, c) => I.set(x + lx, y + ly, c, 0);
    if (kind === 'evergreen') {
      // holly berries and a red bow with ribbon tails
      for (const [lx, ly] of [
        [1, 2],
        [7, 3],
        [2, 6],
        [6, 1],
      ])
        put(lx, ly, RD[5]);
      stamp(I, ['.RrR.', 'RRrRR', '.R.R.', 'R...R'], x + 2, y + 6, { R: RD[4], r: RD[2] });
    } else if (kind === 'flower') {
      const fl = [
        [2, 0, BL[6]],
        [6, 1, GD[5]],
        [0, 3, BN[4]],
        [8, 4, BL[6]],
        [1, 6, GD[5]],
        [7, 6, BN[4]],
        [4, 7, BL[5]],
        [4, 0, BN[4]],
      ];
      for (const [lx, ly, c] of fl) put(lx, ly, c);
      stamp(I, ['.b.b.', '..b..', '.b.b.'], x + 2, y + 7, { b: P.spirit[3] });
    } else {
      // harvest leaves, two acorns and a twine bow
      for (const [lx, ly, c] of [
        [1, 1, GD[4]],
        [7, 2, RD[4]],
        [0, 4, GD[4]],
        [8, 5, AU[7]],
        [2, 7, RD[4]],
        [5, 0, AU[7]],
      ])
        put(lx, ly, c);
      put(6, 7, W[5]);
      put(6, 8, W[3]);
      put(3, 1, W[5]);
      stamp(I, ['.t.t.', '..t..', '.t.t.'], x + 2, y + 7, { t: GD[3] });
    }
  }

  // --- garlands that sag between anchors ----------------------------
  function swagY(x, xs, y, sag) {
    for (let i = 0; i + 1 < xs.length; i++) {
      if (x >= xs[i] && x <= xs[i + 1]) {
        const u = (x - xs[i]) / Math.max(1, xs[i + 1] - xs[i]);
        return y + Math.round(sag * Math.sin(Math.PI * u));
      }
    }
    return y;
  }
  /** marigold toran: beaded swags with pendant strands ending in a mango leaf */
  function toran(I, x0, x1, y, n, sag) {
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(Math.round(x0 + ((x1 - x0) * i) / n));
    for (let x = x0; x <= x1; x++) {
      const yy = swagY(x, xs, y, sag);
      const k = (x + y) % 3;
      I.set(x, yy, k === 0 ? MG[5] : MG[4], 0);
      I.set(x, yy + 1, k === 1 ? MG[2] : MG[3], 0);
    }
    for (let i = 0; i <= n; i++) {
      const x = xs[i];
      const len = i === 0 || i === n ? 3 : 4;
      for (let k = 0; k < len; k++) I.set(x, y + 1 + k, k % 2 ? MG[3] : MG[5], 0);
      I.set(x, y + 1 + len, LF[5], 0);
      I.set(x, y + 2 + len, LF[3], 0);
    }
  }
  /** summer garland: leafy swag with white and pink flowers */
  function flowerGarland(I, x0, x1, y, n, sag) {
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(Math.round(x0 + ((x1 - x0) * i) / n));
    for (let x = x0; x <= x1; x++) {
      const yy = swagY(x, xs, y, sag);
      I.set(x, yy, (x & 1) === 0 ? LF[5] : LF[4], 0);
      I.set(x, yy + 1, (x & 1) === 0 ? LF[2] : LF[3], 0);
      if (x % 3 === 0) I.set(x, yy - 1, LF[4], 0);
      if (x % 5 === 1) I.set(x, yy, x % 10 === 1 ? BN[4] : BL[6], 0);
    }
    for (const x of xs) {
      I.set(x, y + 2, LF[3], 0);
      I.set(x, y + 3, LF[4], 0);
      I.set(x, y, GD[5], 0);
    }
  }

  // --- window boxes (planter under the ground-floor sills) -----------
  function windowBox(I, win, flowers, seed) {
    const w = win.w;
    const bx0 = w.x - 2;
    const bx1 = w.x + w.w + 1;
    const top = w.y + w.h + 3; // just under the sill board
    for (let x = bx0; x <= bx1; x++) {
      I.set(x, top, W[5], 0);
      for (let y = top + 1; y <= top + 3; y++) I.set(x, y, (y - top) % 2 ? W[4] : W[3], 0);
      I.set(x, top + 4, W[2], 0);
    }
    for (let y = top; y <= top + 4; y++) {
      I.set(bx0, y, W[3], 0);
      I.set(bx1, y, W[2], 0);
    }
    // foliage mound rising in front of the lower panes, trailing ivy over the box front
    for (let x = bx0 + 1; x <= bx1 - 1; x++) {
      const h = 2 + Math.round(bump(x, seed, 3) * 3);
      for (let k = 1; k <= h; k++) {
        const y = top - k;
        const c = k === h ? LF[5] : (x + k) % 3 === 0 ? LF[2] : LF[3];
        I.set(x, y, c, 0);
      }
      if (HD.hash(x, seed, 3) < 0.22) {
        const dl = 1 + Math.floor(HD.hash(x, seed, 4) * 3);
        for (let k = 1; k <= dl; k++) I.set(x, top + k, k === dl ? LF[4] : LF[3], 0);
      }
    }
    // flower heads
    let i = 0;
    for (let x = bx0 + 2; x <= bx1 - 2; x += 3 + (HD.hash(x, seed, 7) < 0.4 ? 1 : 0)) {
      const h = 2 + Math.round(bump(x, seed, 3) * 3);
      const fy = top - h - 1 - (HD.hash(x, seed, 8) < 0.5 ? 1 : 0);
      const kind = flowers[i++ % flowers.length];
      if (kind.tall) {
        I.set(x, fy + 1, LF[4], 0);
        I.set(x, fy + 2, LF[4], 0);
      }
      const c = kind.c;
      if (kind.shape === 'tulip') {
        I.set(x - 1, fy - 1, c[1], 0);
        I.set(x + 1, fy - 1, c[1], 0);
        I.set(x - 1, fy, c[0], 0);
        I.set(x, fy, c[1], 0);
        I.set(x + 1, fy, c[0], 0);
        I.set(x, fy - 1, c[2], 0);
      } else if (kind.shape === 'star') {
        I.set(x, fy - 1, c[1], 0);
        I.set(x - 1, fy, c[1], 0);
        I.set(x + 1, fy, c[0], 0);
        I.set(x, fy + 1, c[0], 0);
        I.set(x, fy, c[2], 0);
      } else {
        I.set(x, fy, c[1], 0);
        I.set(x + 1, fy, c[0], 0);
        I.set(x, fy - 1, c[2], 0);
        I.set(x + 1, fy - 1, c[1], 0);
      }
    }
  }

  // --- interiors (silhouettes on the glass, in local window coords) ---
  function putW(I, win, lx, ly, c) {
    if (K.winInside(win, win.gx + lx, win.gy + ly, 0)) I.set(win.gx + lx, win.gy + ly, c, 0);
  }
  function rowsW(I, win, list, lx, ly, map) {
    for (let y = 0; y < list.length; y++)
      for (let x = 0; x < list[y].length; x++) {
        const ch = list[y][x];
        if (ch !== '.' && ch !== ' ' && map[ch]) putW(I, win, lx + x, ly + y, map[ch]);
      }
  }

  // red paper-cut flowers. Neither may read as a glyph (no straight crossing
  // strokes: avoid shapes like 十 井 口 田 王 回): a round blossom of four notched
  // petals around a gold heart, and a small diamond ring.
  const BLOSSOM = ['.rrr.', 'rr.rr', 'r.g.r', 'rr.rr', '.rrr.'];
  const ROSETTE2 = ['..r..', '.rrr.', 'rr.rr', '.rrr.', '..r..'];

  // menorah, local coords in ground-left (18 x 22), centred on lx 8
  const MEN_X = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  function menorah(I, win) {
    const g1 = GD[1];
    const g2 = GD[2];
    for (let lx = 6; lx <= 10; lx++) putW(I, win, lx, 21, lx === 6 ? g1 : g2);
    for (let lx = 7; lx <= 9; lx++) putW(I, win, lx, 20, g1);
    for (let ly = 14; ly <= 19; ly++) putW(I, win, 8, ly, ly === 14 ? g2 : g1);
    for (let lx = 0; lx <= 16; lx++) putW(I, win, lx, 17, g1);
    for (const lx of MEN_X) {
      if (lx === 8) continue;
      putW(I, win, lx, 16, g2);
      putW(I, win, lx, 15, BN[3]);
      putW(I, win, lx, 14, BN[4]);
    }
    putW(I, win, 8, 13, BN[3]);
    putW(I, win, 8, 12, BN[4]);
  }

  // decorated tree, local coords in ground-right (16 x 22)
  const TREE = ['...gg...', '..gGgg..', '.gGgggg.', '..gggg..', '.gGgggg.', 'gGgggggg', '.gggggg.', 'gGgggggg', 'gggggggg', '...tt...', '..pppp..'];
  const TREE_X = 4;
  const TREE_Y = 11;
  const TREE_BULBS = [
    [4, 1, 'red'],
    [2, 3, 'gold'],
    [5, 4, 'blue'],
    [1, 6, 'green'],
    [6, 6, 'red'],
    [3, 7, 'gold'],
    [0, 8, 'blue'],
    [5, 8, 'gold'],
    [7, 9, 'green'],
    [2, 9, 'red'],
  ];
  function xmasTree(I, win) {
    rowsW(I, win, TREE, TREE_X, TREE_Y, { g: LF[1], G: LF[3], t: W[1], p: RD[2] });
  }

  function decorateInterior(I, ed) {
    const gl = WIN['ground-left'];
    const gr = WIN['ground-right'];
    const ul = WIN['upper-left'];
    const tl = WIN['turret-lower'];
    const tu = WIN['turret-upper'];
    // ---------------- windows ----------------
    if (has(ed, 'tangerines')) {
      // bowl of tangerines with a couple of leaves on the inner sill
      rowsW(I, gr, ['....ll....', '...oOol...', '..oOooOo..', '.oOoooOoo.', 'bbbbbbbbbb', '.bbbbbbbb.', '..bbbbbb..'], has(ed, 'plum-vase') ? 1 : 3, gr.gh - 7, {
        o: F[5],
        O: F[7],
        l: LF[5],
        b: A[0],
      });
      // (no second dish in the parlour: orange fruit vanish on its hearth-orange
      // glass, so the ground-right bowl carries the motif on its own)
    }
    if (has(ed, 'paper-cuts')) {
      const rc = { r: RD[4], g: GD[4] };
      rowsW(I, ul, BLOSSOM, 0, 2, rc);
      rowsW(I, ul, ROSETTE2, 8, 2, rc);
      rowsW(I, gl, ROSETTE2, 2, 4, rc);
      rowsW(I, gl, BLOSSOM, 11, 4, rc);
      rowsW(I, tl, ROSETTE2, 3, 2, rc);
    }
    if (has(ed, 'seedlings')) {
      for (const [lx, h] of [
        [1, 3],
        [6, 4],
        [11, 2],
      ]) {
        rowsW(I, gr, ['ppp', 'ppp', '.p.'], lx, gr.gh - 3, { p: A[0] });
        for (let k = 1; k <= h; k++) putW(I, gr, lx + 1, gr.gh - 3 - k, LF[4]);
        putW(I, gr, lx, gr.gh - 3 - h, LF[6]);
        putW(I, gr, lx + 2, gr.gh - 2 - h, LF[5]);
      }
      // a watering can on the turret sill
      rowsW(I, tl, ['..h..', 'cccc.', 'ccccs', 'cccc.'], 0, tl.gh - 4, { c: A[0], h: A[1], s: A[0] });
    }
    if (has(ed, 'pie-sill')) {
      // an uncarved pumpkin on the inner sill instead of a jack-o'-lantern
      rowsW(I, gr, ['...s...', '.ppppp.', 'ppppppp', 'ppppppp', '.ppppp.'], 4, gr.gh - 5, { s: LF[3], p: A[0] });
      // the pie cooling on the outside sill (lattice crust in a tin)
      const w = gl.w;
      const px = w.x + 5;
      const py = w.y + w.h + 1;
      stamp(I, ['..LLLLL..', '.LcLcLcL.', 'LcLcLcLcL', 'kkkkkkkkk', '.ddddddd.'], px, py - 4, { c: AU[4], L: AU[6], k: S[6], d: S[4] });
    }
    if (has(ed, 'party-windows')) {
      // balloons and streamers as silhouettes
      // a bunch of balloons tied to the curtain rail, backlit (dark rims, glowing skins)
      const BAL = ['.bb.', 'bhbb', 'bbbb', 'dbbd', '.dd.', '..s.'];
      const bal = (lx, ly, ramp, tail) => {
        rowsW(I, gr, BAL, lx, ly, { b: ramp[1], h: ramp[2], d: ramp[0], s: A[1] });
        for (let k = 0; k < tail; k++) putW(I, gr, lx + 2 + (k % 3 === 1 ? -1 : 0), ly + 6 + k, A[1]);
      };
      bal(1, 2, [RD[1], RD[3], RD[5]], 4);
      bal(6, 0, [GD[1], GD[3], GD[5]], 6);
      bal(10, 3, [P.night[4], P.night[7], P.night[9]], 3);
      // two raised glasses on the inner sill, where the pumpkin sat
      rowsW(I, gr, ['k.k..k.k', 'kkk..kkk', '.k....k.', '.k....k.', 'kkk..kkk'], 4, gr.gh - 5, { k: A[0] });
      for (let lx = 0; lx < ul.gw; lx++) {
        putW(I, ul, lx, 2 + ((lx >> 1) & 1), A[1]);
        if (lx % 4 === 1) putW(I, ul, lx, 4 + ((lx >> 2) & 1), A[1]);
      }
      for (let lx = 0; lx < gl.gw; lx++) putW(I, gl, lx, 4 + ((lx >> 1) % 3 === 0 ? 1 : 0), A[0]);
      for (const lx of [3, 13]) rowsW(I, gl, ['s', 's', '.', 's'], lx, 5, { s: A[0] });
      rowsW(I, tl, ['.bb.', 'bbbb', 'bbbb', '.bb.', '..s.', '.s..'], 4, 2, { b: A[0], s: A[1] });
      for (let lx = 0; lx < tu.gw; lx += 3) putW(I, tu, lx, 9 + (lx % 2), A[1]);
    }
    if (has(ed, 'menorah')) menorah(I, gl);
    if (has(ed, 'xmas-tree')) xmasTree(I, gr);
    if (ed.id === 'summer') {
      // a jug of meadow flowers where the jack-o'-lantern sat
      rowsW(I, gr, ['.f.g.r.', 'gltlflg', '.l.l.l.', '..lll..', '..jjj..', '.jJjjj.', '.jJjjj.', '..jjj..'], 4, gr.gh - 8, {
        f: BL[5],
        g: GD[5],
        r: RD[5],
        t: BN[4],
        l: LF[3],
        j: A[0],
        J: A[1],
      });
    }
    if (ed.id === 'lights') {
      // a brass pot of marigolds and a small lamp on the inner sill
      rowsW(I, gr, ['.m.m.m.', 'mmmmmmm', '.mmmmm.', '..ppp..', '.ppppp.', '..ppp..'], 4, gr.gh - 6, { m: MG[2], p: GD[1] });
    }
    // ---------------- outside: window boxes, garlands, wreaths ----------------
    if (has(ed, 'window-boxes')) {
      const spring = ed.id === 'spring';
      const fl = spring
        ? [
            { shape: 'tulip', c: [RD[3], RD[4], RD[5]], tall: true },
            { shape: 'star', c: [GD[3], GD[5], MG[4]] },
            { shape: 'tulip', c: [BL[4], BL[5], BL[6]], tall: true },
            { shape: 'star', c: [GD[4], GD[5], GD[6]] },
            { shape: 'round', c: [BN[2], BN[3], BN[4]] },
          ]
        : [
            { shape: 'round', c: [RD[3], RD[4], RD[5]] },
            { shape: 'star', c: [BN[2], BN[4], GD[5]] },
            { shape: 'round', c: [BL[4], BL[5], BL[6]] },
            { shape: 'tulip', c: [V[4], V[5], V[6]], tall: true },
            { shape: 'round', c: [RD[3], RD[5], RD[6]] },
          ];
      windowBox(I, gl, fl, spring ? 3 : 13);
      windowBox(I, gr, fl, spring ? 5 : 15);
    }
    if (has(ed, 'wreath')) wreath(I, 'evergreen');
    if (has(ed, 'flower-wreath')) wreath(I, 'flower');
    if (has(ed, 'leaf-wreath')) wreath(I, 'leaf');
    if (has(ed, 'flower-garland')) flowerGarland(I, PO.x0 + 3, PO.x1 - 4, PO.roofY + 8, 2, 3);
    if (has(ed, 'marigolds')) {
      toran(I, DX0 - 4, DX1 + 4, PO.roofY + 9, 3, 2);
      for (const id of ['ground-left', 'ground-right', 'upper-left', 'upper-right']) {
        const w = WIN[id].w;
        const n = w.w > 16 ? 3 : 2;
        toran(I, w.x - 3, w.x + w.w + 2, w.y - 3, n, id === 'upper-right' ? 1 : 2);
      }
    }
    if (has(ed, 'red-banners')) {
      // a plain red diamond on the door, gold edged (no characters)
      stamp(I, ['...g...', '..grg..', '.grRrg.', 'grRRRrg', '.grRrg.', '..grg..', '...g...'], DX0 + 4, DY0 + 10, { g: GD[3], r: RD[3], R: RD[4] });
      // plain red vertical banners pasted on the door frame (the inner jambs of
      // the stone surround), gold flecks; the porch posts stay clear
      for (const [bx, lit] of [
        [DX0 - 2, 1],
        [DX1 + 1, 0],
      ]) {
        for (let y = K.DAY; y <= 203; y++)
          for (let k = 0; k < 2; k++) {
            let c = y === K.DAY || y === 203 ? RD[2] : k === lit ? RD[4] : RD[3];
            if (y > K.DAY && y < 203 && HD.hash(bx + k, y, 51) < 0.08) c = GD[4];
            I.set(bx + k, y, c, 0);
          }
      }
    }
    if (has(ed, 'firecrackers')) {
      // a string of firecrackers tied to the right porch post, below its
      // lantern and well clear of the ground-right window
      const FC = ['..k..', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '..k..', '.ggg.', '.r.r.'];
      stamp(I, FC, PO.postR - 1, 191, { k: GD[2], r: RD[4], R: RD[3], g: GD[4] });
    }
    if (has(ed, 'corn-bundles')) {
      // corn shocks: a sheaf of dry stalks tied to each porch post. Above the
      // twine the stalk tops arch out and droop like a fountain; below it the
      // sheaf flares, lit gold on the side facing the door (the lanterns),
      // with a dark crease for volume and two ears leaning at the foot. Painted
      // in dark straw (night colours), so the lantern light relights it to
      // gold-tan instead of white. The right shock is mirrored.
      const SHOCK = [
        '.....a...',
        '.b..b..a.',
        'b.b.b.a.a',
        '..b.b.a..',
        '...bba...',
        'bb.bba.aa',
        'b.bbbaa.a',
        '...cba...',
        '...ttt...',
        '..lcbal..',
        '.l.cbaa.l',
        'l..cbaa..',
        '..dcbaab.',
        '..dcbaab.',
        '.cdcbaab.',
        '.cdcbaaba',
        'ccdcbaaba',
        'ccdcbaaba',
        'cdcdbabaa',
        'cdcdbabaa',
        'cdcdbabab',
        'ndndnbnbn',
      ];
      const EAR = ['.h', 'hy', 'yY', 'yY', 'yy', 'y.'];
      const map = { a: GD[2], b: GD[1], c: AU[2], d: W[2], n: W[2], l: AU[3], t: RD[3], h: AU[3], y: GD[1], Y: GD[2] };
      const flip = (rows) => rows.map((r) => r.split('').reverse().join(''));
      const baseY = 206 - SHOCK.length;
      stamp(I, SHOCK, PO.postL - 4, baseY, map);
      stamp(I, flip(SHOCK), PO.postR - 5, baseY, map);
      stamp(I, EAR, PO.postL - 5, 200, map);
      stamp(I, flip(EAR), PO.postR + 4, 200, map);
    }
    // ---------------- Summer Story + the Boston plum vase ----------------
    if (has(ed, 'cat-away')) paintAway(I);
    if (has(ed, 'tv-match')) paintTV(I);
    if (has(ed, 'flags-matchday') || has(ed, 'bunting-party')) paintCords(I, true, true);
    if (has(ed, 'pub-sign')) paintSignBracket(I);
    if (has(ed, 'bunting-usa')) paintFans(I);
    if (has(ed, 'plum-vase')) paintPlumVase(I);
    if (has(ed, 'bunting')) {
      // party pennants: little 5-3-1 triangles (dark leading edge, lit body)
      // on a sagging cord, hung under the porch string
      const flags = [
        [GD[3], GD[5]],
        [RD[3], RD[5]],
        [P.night[8], P.night[10]],
        [BN[2], BN[3]],
        [V[4], V[6]],
      ];
      const by = PO.roofY + 9;
      const xs = [PO.x0 + 6, Math.round((PO.x0 + PO.x1) / 2), PO.x1 - 5];
      for (let x = xs[0]; x <= xs[2]; x++) I.set(x, swagY(x, xs, by, 3), S[1], 0);
      const H = [1, 2, 3, 2, 1];
      let k = 0;
      for (let x = xs[0] + 1; x + 4 <= xs[2]; x += 6) {
        const [d, c] = flags[k++ % flags.length];
        for (let dx = 0; dx < 5; dx++) {
          const yy = swagY(x + dx, xs, by, 3);
          for (let h = 1; h <= H[dx]; h++) I.set(x + dx, yy + h, h === dx + 1 ? d : c, 0);
        }
      }
    }
  }

  // ===================================================================
  // per-edition window glow
  // ===================================================================
  // party light is WARMER, not paler: each amber glass step becomes the fire
  // step of about the same brightness (more orange, more saturated), and the
  // pale A[7] core is capped at A[6]. The extra brightness goes into the
  // light the window casts (winBoost), not into the glass.
  const WARM = new Map([
    [A[1], F[2]],
    [A[2], F[3]],
    [A[3], F[4]],
    [A[4], F[6]],
    [A[5], F[7]],
    [A[6], F[8]],
    [A[7], A[6]],
  ]);
  const warmRamp = (ramp) => ramp.map((c) => WARM.get(c) || c);
  const winSetup = HD.perEdition((ed) => {
    const cfg = K.WINS.map((w) => w.c);
    const boost = K.WINS.map(() => 1);
    if (has(ed, 'party-windows')) {
      K.WINS.forEach((w, i) => {
        if (w.w.cat) {
          boost[i] = 1.12;
          return;
        }
        boost[i] = 1.25;
        // the hearth window is already fire-coloured and the two candle
        // windows (hearth, turret-lower) already flicker nervously: keep both
        const liven = w.w.id !== 'ground-left' && w.w.id !== 'turret-lower';
        const ramp = warmRamp(w.c.ramp);
        const same = ramp.every((c, k) => c === w.c.ramp[k]);
        if (same && !liven) return;
        cfg[i] = Object.assign({}, w.c, { ramp }, liven ? { speed: w.c.speed * 1.25, amp: Math.min(0.7, w.c.amp * 1.3) } : null);
      });
    }
    if (has(ed, 'menorah')) {
      const i = WIN['ground-left'].index;
      cfg[i] = Object.assign({}, cfg[i], { ramp: [A[1], A[2], A[3], A[4], A[5], A[5]], src: [0.5, 0.9], R: 22 });
      boost[i] = 0.8;
    }
    if (has(ed, 'tv-match')) {
      // the parlour lamp is off for the match: the room glows TV-green
      const i = WIN['ground-left'].index;
      cfg[i] = Object.assign({}, cfg[i], {
        ramp: TV_GLASS,
        src: [0.5, 0.66],
        R: 19,
        seed: 48,
        speed: 1.6,
        amp: 0.5,
        light: { r: 30, i: 0.34, col: [0.5, 1.0, 0.62] },
        halo: 0.07,
        spill: { r: 22, ry: 7, i: 0.3 },
      });
    }
    if (ed.id === 'winter') {
      const i = WIN['ground-right'].index;
      cfg[i] = Object.assign({}, cfg[i], { ramp: [A[2], A[3], A[4], A[5], A[6]], R: 18 });
    }
    // bake overridden glass
    const glass = K.WINS.map((win, i) => {
      if (cfg[i] === win.c) return null;
      const w2 = Object.assign({}, win, { c: cfg[i] });
      const out = [];
      for (let l = 0; l < K.NL; l++)
        out.push(
          HD.bake(win.gw, win.gh, (g) => {
            for (let ly = 0; ly < win.gh; ly++)
              for (let lx = 0; lx < win.gw; lx++) if (K.winInside(win, win.gx + lx, win.gy + ly, 0)) g.px(lx, ly, K.glassColor(w2, lx, ly, l));
          }),
        );
      return out;
    });
    return { cfg, boost, glass };
  });

  // ===================================================================
  // animated decorations
  // ===================================================================
  const EAVE = [
    [163, 130],
    [180, 131],
    [197, 130],
    [214, 131],
    [231, 130],
    [248, 131],
    [265, 130],
    [271, 130],
  ];
  // the porch string rides the fascia board, above the toran / bunting /
  // icicles that hang from the bottom of the porch roof
  const PORCH = [
    [PO.x0 + 1, PO.roofY + 4],
    [Math.round((PO.x0 + PO.x1) / 2), PO.roofY + 5],
    [PO.x1 - 2, PO.roofY + 4],
  ];
  const TURRET = [
    [TU.x0 + 1, TU.top + 3],
    [TU.x0 + 15, TU.top + 4],
    [TU.x1 - 1, TU.top + 3],
  ];
  const STR_COLOR = { colors: ['red', 'gold', 'green', 'blue'], spacing: 4, sag: 2, twinkle: 0.8, wire: S[1] };
  const STR_GOLD = { colors: ['gold'], spacing: 4, sag: 2, twinkle: 0.45, wire: S[1] };
  const strings = (ed) => {
    if (has(ed, 'string-lights-color')) return { o: STR_COLOR, paths: [EAVE, PORCH, TURRET] };
    if (has(ed, 'string-lights-gold')) return { o: STR_GOLD, paths: [EAVE, PORCH] };
    return null;
  };
  /** every pixel a string bulb can light up (key x*512+y), from the real helper */
  function bulbMask(ed) {
    const m = new Set();
    const st = strings(ed);
    if (!st) return m;
    const cv = HD.bake(K.BX + K.BW, K.BY + K.BH, (g) => {
      for (const pts of st.paths) FE.bulbs(g, pts, 0, Object.assign({}, st.o, { wire: '#010203' }));
    });
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let p = 0, i = 0; p < d.length; p += 4, i++) {
      if (!d[p + 3] || (d[p] === 1 && d[p + 1] === 2 && d[p + 2] === 3)) continue;
      m.add(key(i % cv.width, Math.floor(i / cv.width)));
    }
    return m;
  }
  const ICE_ART = new Map(); // edition id -> icicle overlay (baked with the house)

  // lanterns per edition: [x, y, kind, size, len]
  // [hook x, hook y, kind, size, cord length, swing amplitude (rad)]: long
  // enough cords that each body swings about a pixel (a sway you can see),
  // hooked high so the bodies hang where they did; the two have different
  // seeds, so different periods and phases
  const LANTERNS = {
    lunar: [
      [PO.postL + 1, PO.roofY + 6, 'red', 'big', 5, 0.22],
      [PO.postR - 3, PO.roofY + 6, 'red', 'big', 5, 0.22],
    ],
    harvest: [
      [DX0, PO.roofY + 6, 'harvest', 'big', 4, 0.28],
      [DX1 + 1, PO.roofY + 6, 'harvest', 'big', 4, 0.28],
    ],
  };

  // diyas: [x, y(bottom)] on every sill and on the steps, grouped for lights
  const DIYA_GROUPS = (() => {
    const g = [];
    const sill = (id, xs) => {
      const w = WIN[id].w;
      const y = w.y + w.h + 1;
      g.push(xs.map((x) => [w.x + x, y]));
    };
    sill('ground-left', [2, 12]);
    sill('ground-right', [1, 10]);
    sill('upper-left', [1, 8]);
    sill('upper-right', [-3, 20]); // sill ends, clear of the cat
    sill('turret-lower', [3]);
    sill('turret-upper', [3]);
    // steps: one lamp at each end of each step, staggered so the clay bodies
    // (and the flames, which sit right of each spout) stay 2 px apart
    g.push([
      [STP.x0 + 2, 210],
      [STP.x0 + 9, 206],
    ]);
    g.push([
      [STP.x1 - 9, 206],
      [STP.x1 - 3, 210],
    ]);
    return g;
  })();

  function drawInside(g, t) {
    const ed = HD.edition;
    if (has(ed, 'menorah')) {
      const w = WIN['ground-left'];
      for (let i = 0; i < MEN_X.length; i++) {
        const lx = MEN_X[i];
        FE.flame(g, w.gx + lx, w.gy + (lx === 8 ? 12 : 14), t, 300 + i, 1);
      }
    }
    if (has(ed, 'tv-match')) drawTV(g, t);
    if (has(ed, 'xmas-tree')) {
      const w = WIN['ground-right'];
      const e = g.em;
      for (let i = 0; i < TREE_BULBS.length; i++) {
        const [bx, by, col] = TREE_BULBS[i];
        const n = T.noise(t, 2.6, 400 + i);
        const ramp = P.bulb[col];
        e.px(w.gx + TREE_X + bx, w.gy + TREE_Y + by, ramp[n < 0.3 ? 0 : n < 0.62 ? 1 : 2]);
      }
      // star on top
      const sx = w.gx + TREE_X + 3;
      const sy = w.gy + TREE_Y - 2;
      const s = T.noise(t, 3.1, 431);
      e.px(sx, sy, GD[6]);
      e.px(sx + 1, sy, GD[5]);
      e.px(sx, sy + 1, GD[5]);
      e.px(sx + 1, sy + 1, GD[4]);
      if (s > 0.55) {
        e.px(sx, sy - 1, GD[5]);
        e.px(sx - 1, sy, GD[4]);
        e.px(sx + 2, sy + 1, GD[4]);
      }
    }
  }

  // summer: curtains billow out of the open windows
  const CURTAINS = [
    ['ground-right', -1, 7.3, 501],
    ['ground-right', 1, 6.1, 502],
    ['upper-left', 1, 6.7, 503],
  ];
  function drawCurtains(g, t) {
    for (const [id, side, per, seed] of CURTAINS) {
      const win = WIN[id];
      const drift = 0.4 + 3.2 * T.fbm(t, per, seed, 2); // how far the hem blows out (px)
      const flut = T.wave(t, per * 0.37, seed * 0.13);
      const n = win.gh - 1; // rod (k = 0) .. hem
      const tie = Math.round(n * 0.38);
      const edge = side < 0 ? win.gx : win.gx + win.gw - 1;
      const fold = Math.round(drift * 1.5);
      for (let k = 0; k < n; k++) {
        // the upper third hangs straight inside the frame, the tie-back pinches
        // it, and only the lower half bells out of the open window
        let wd = 3;
        let o = 0;
        if (k === tie) wd = 2;
        else if (k > tie) {
          const u = (k - tie) / (n - 1 - tie);
          wd = Math.round(2 + 3 * Math.pow(u, 0.8));
          o = Math.round(drift * Math.pow(u, 1.5) + 0.6 * u * flut);
        }
        const y = win.gy + k;
        for (let j = 0; j < wd; j++) {
          const x = side < 0 ? edge - o + j : edge + o - j; // j = 0: the outer edge
          let c = j === 0 ? BN[3] : j === wd - 1 ? BN[1] : BN[2];
          // a fold line that rolls across the cloth as the breeze changes
          if (wd >= 4 && j === 1 + ((fold + (k >> 2)) % (wd - 2))) c = BN[1];
          if (k === tie) c = W[3];
          g.px(x, y, c);
        }
      }
    }
  }

  function drawFront(g, t) {
    const ed = HD.edition;
    const st = strings(ed);
    if (st) for (let i = 0; i < st.paths.length; i++) FE.bulbs(g, st.paths[i], t, Object.assign({ seed: 7 + i }, st.o));
    const ice = ICE_ART.get(ed.id);
    if (ice) g.sprite(ice, K.BX, K.BY);
    const ls = LANTERNS[ed.id];
    if (ls) for (let i = 0; i < ls.length; i++) FE.lantern(g, ls[i][0], ls[i][1], t, 60 + i, ls[i][2], { size: ls[i][3], len: ls[i][4], amp: ls[i][5] });
    if (has(ed, 'diyas-house')) {
      let s = 0;
      for (const grp of DIYA_GROUPS) for (const [x, y] of grp) FE.diya(g, x, y, t, 80 + s++);
    }
    if (has(ed, 'open-windows')) drawCurtains(g, t);
    // Summer Story: the saltire on the wall, the pub sign, then the bunting
    const sal = saltire();
    if (sal) drawSaltire(g, t, sal);
    if (has(ed, 'pub-sign')) drawSign(g, t);
    const mf = matchFlags();
    if (mf) drawHung(g, t, mf);
    const pp = partyPennants();
    if (pp) drawHung(g, t, pp);
  }

  function lights(t, L) {
    const ed = HD.edition;
    const st = strings(ed);
    if (st)
      for (let i = 0; i < st.paths.length; i++)
        FE.bulbLights(L, st.paths[i], t, { colors: st.o.colors, sag: st.o.sag, every: 20, r: 16, i: has(ed, 'string-lights-color') ? 0.15 : 0.17 });
    const ls = LANTERNS[ed.id];
    if (ls) for (let i = 0; i < ls.length; i++) FE.lanternLight(L, ls[i][0], ls[i][1], t, 60 + i, ls[i][2], { size: ls[i][3], len: ls[i][4], amp: ls[i][5], r: 34, i: 0.5 });
    if (has(ed, 'diyas-house')) {
      let s = 0;
      for (const grp of DIYA_GROUPS) {
        let sx = 0;
        let sy = 0;
        for (const [x, y] of grp) {
          sx += x + 3;
          sy += y - 3;
        }
        const f = T.flicker(T.step(t, 10), 80 + s, 1.4);
        s += grp.length;
        L.add({ x: RND(sx / grp.length), y: RND(sy / grp.length), r: grp.length > 1 ? 22 : 16, color: LIGHT.diya, i: (0.26 + 0.06 * grp.length) * (0.8 + 0.4 * f), bands: 4, halo: { r: 7, a: 0.1 } });
      }
    }
    if (has(ed, 'menorah')) {
      const w = WIN['ground-left'];
      const f = T.flicker(T.step(t, 10), 300, 1.2);
      L.add({ x: w.gx + 8, y: w.gy + 12, r: 26, color: LIGHT.candle, i: 0.22 * (0.85 + 0.3 * f), halo: { r: 9, a: 0.1 } });
    }
    if (has(ed, 'xmas-tree')) {
      const w = WIN['ground-right'];
      const n = T.noise(t, 2.6, 400);
      L.add({ x: w.gx + 8, y: w.gy + 16, r: 22, color: n > 0.5 ? LIGHT.bulb.red : LIGHT.bulb.gold, i: 0.12, bands: 4 });
    }
  }

  // ===================================================================
  // SUMMER STORY (SUMMER.md): the cat away, match-day flags, the saltire,
  // the TV, the pub sign, July 4th fans, birthday pennants; and the plum
  // vase of the Boston Lunar New Year
  // ===================================================================
  const NI = P.night;
  const RG = P.rangoli;
  const PLM = P.plum;
  const mixc = HD.color.mix;
  const SUM = HD.summer;
  const breeze = (t) => (SUM ? SUM.breeze(t) : 0);
  // flag cloth: pigments taken a step into the night (so they sit in the cold
  // frame and the house lights relight them to full colour). Upper case =
  // cloth, lower case = the same cloth in a fold.
  const CLOTH = {
    R: RD[4], r: RD[3],
    W: BN[3], w: BN[2],
    U: mixc(NI[5], RG[4], 0.32), u: mixc(NI[4], RG[4], 0.22), // navy (USA, Norway)
    V: mixc(NI[9], BN[3], 0.3), // a star in the canton
    S: mixc(RG[4], NI[7], 0.22), s: mixc(RG[4], NI[5], 0.45), // Scottish azure
    F: mixc(RG[4], NI[5], 0.42), f: mixc(RG[4], NI[4], 0.6), // French blue
    G: mixc(RG[3], NI[3], 0.28), g: mixc(RG[3], NI[2], 0.5), // Irish green
    O: mixc(RG[1], NI[3], 0.15), o: mixc(RG[1], NI[2], 0.38), // Irish orange
    K: NI[1], k: NI[0], // German black
    Y: GD[4], y: GD[3], // German gold, Spanish yellow
  };
  const rep = (row, n) => Array(n).fill(row);
  /** a white saltire on azure, arms about `th` px from the diagonals */
  function saltireRows(w, h, th) {
    const n = Math.hypot(w, h);
    const out = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) {
        const d1 = Math.abs(h * (x + 0.5) - w * (y + 0.5)) / n;
        const d2 = Math.abs(h * (x + 0.5) - w * (h - y - 0.5)) / n;
        r += Math.min(d1, d2) < th ? 'W' : 'S';
      }
      out.push(r);
    }
    return out;
  }
  // the seven teams, each drawn as accurately as its pixel size allows
  const FLAG = {
    usa: ['UUUURRRRR', 'UVUVWWWWW', 'UUUURRRRR', 'UVUVWWWWW', 'RRRRRRRRR', 'WWWWWWWWW', 'RRRRRRRRR'],
    ireland: rep('GGGWWWOOO', 6),
    scotland: saltireRows(9, 7, 0.62),
    norway: ['RRWUWRRRR', 'RRWUWRRRR', 'WWWUWWWWW', 'UUUUUUUUU', 'WWWUWWWWW', 'RRWUWRRRR', 'RRWUWRRRR'],
    france: rep('FFFWWWRRR', 6),
    germany: [...rep('KKKKKKKKK', 2), ...rep('RRRRRRRRR', 2), ...rep('YYYYYYYYY', 2)],
    spain: [...rep('RRRRRRRRRRRR', 2), ...rep('YYYYYYYYYYYY', 4), ...rep('RRRRRRRRRRRR', 2)],
  };
  // party pennants (birthday): little triangles, 5 wide
  const PENNANT = ['PPPPp', 'PPPPp', '.PPp.', '.PPp.', '..p..'];
  const PARTY = [
    [mixc(RG[0], NI[3], 0.12), mixc(RG[0], NI[2], 0.4)], // pink
    [GD[4], GD[3]], // yellow
    [mixc(RG[4], NI[7], 0.1), mixc(RG[4], NI[5], 0.4)], // blue
    [mixc(RG[1], NI[3], 0.1), mixc(RG[1], NI[2], 0.38)], // orange
    [mixc(RG[3], NI[5], 0.12), mixc(RG[3], NI[3], 0.42)], // green
    [mixc(RG[5], NI[6], 0.1), mixc(RG[5], NI[4], 0.4)], // violet
  ];

  /** a cord hung between anchors with a soft sag: Map x -> y */
  function cord(anchors, sag) {
    const ys = new Map();
    for (let i = 0; i + 1 < anchors.length; i++) {
      const [x0, y0] = anchors[i];
      const [x1, y1] = anchors[i + 1];
      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / (x1 - x0);
        ys.set(x, RND(y0 + (y1 - y0) * u + sag * Math.sin(Math.PI * u)));
      }
    }
    return ys;
  }
  // under the roof eave (gutter brackets at the ends and between the windows)
  const EAVE_CORD = cord(
    [
      [162, 130],
      [191, 131],
      [220, 131],
      [249, 131],
      [277, 130],
    ],
    3,
  );
  // under the porch fascia, post to post, clear of the iron lantern
  const PORCH_CORD = cord(
    [
      [209, 176],
      [235, 176],
    ],
    2,
  );
  const cordY = (cd, x) => (cd.has(x) ? cd.get(x) : null);

  /**
   * Bake one hung flag (or pennant) in three stir states (-1, 0, +1). The
   * cloth stays whole: in a breeze a fold (a shaded column with a lit one
   * beside it) rolls across it and the trailing bottom corner lifts. Pennant
   * tips swing a pixel. The top row of every column follows the cord.
   * Returns { x, y, frames }.
   */
  function hangFlag(cd, x, rows, colorOf) {
    const w = rows[0].length;
    const h = rows.length;
    let top = 1e9;
    for (let c = 0; c < w; c++) top = Math.min(top, cordY(cd, x + c));
    const dy = [];
    for (let c = 0; c < w; c++) dy.push(cordY(cd, x + c) - top);
    const md = Math.max(...dy);
    const frames = [-1, 0, 1].map((st) =>
      HD.bake(w + 2, h + md + 1, (g) => {
        const fc = st < 0 ? Math.floor(w / 3) : Math.ceil((2 * w) / 3) - 1;
        const tri = rows[h - 1].indexOf('.') >= 0; // a pennant (pointed tip)
        for (let r = 0; r < h; r++) {
          const sh = tri && st !== 0 && r >= h - 2 ? st : 0;
          for (let c = 0; c < w; c++) {
            let ch = rows[r][c];
            if (ch === '.') continue;
            if (!tri && st !== 0 && r === h - 1 && (st > 0 ? c === 0 : c === w - 1)) continue; // corner lifts
            let col;
            if (st !== 0 && r > 0 && c === fc) col = colorOf(ch.toLowerCase());
            else if (!tri && st !== 0 && r > 0 && c === fc - st) col = lift(colorOf(ch));
            else col = colorOf(ch);
            g.px(1 + c + sh, dy[c] + r, col);
          }
        }
      }),
    );
    return { x: x - 1, y: top + 1, frames };
  }
  const clothOf = (ch) => CLOTH[ch] || CLOTH[ch.toUpperCase()];
  const LIFT = new Map();
  /** the lit side of a fold: a touch towards pale cloth */
  const lift = (c) => {
    let v = LIFT.get(c);
    if (!v) LIFT.set(c, (v = mixc(c, BN[4], 0.16)));
    return v;
  };

  // ---- match-day bunting: the six teams that played in Boston + Spain ----
  const EAVE_FLAGS = [
    [165, 'usa'],
    [176, 'ireland'],
    [187, 'scotland'],
    [198, 'norway'],
    [209, 'france'],
    [220, 'germany'],
    [231, 'spain'],
    [245, 'usa'],
    [256, 'ireland'],
    [267, 'scotland'],
  ];
  const matchFlags = HD.perEdition((ed) => {
    if (!has(ed, 'flags-matchday')) return null;
    const out = EAVE_FLAGS.map(([x, k]) => hangFlag(EAVE_CORD, x, FLAG[k], clothOf));
    // Spain (the team you cheer for) over the front door
    out.push(hangFlag(PORCH_CORD, 216, FLAG.spain, clothOf));
    return out;
  });
  const partyPennants = HD.perEdition((ed) => {
    if (!has(ed, 'bunting-party')) return null;
    const out = [];
    let k = 0;
    const put = (cd, xa, xb) => {
      for (let x = xa; x + 4 <= xb; x += 7) {
        const [c, d] = PARTY[k++ % PARTY.length];
        out.push(hangFlag(cd, x, PENNANT, (ch) => (ch === 'P' ? c : d)));
      }
    };
    put(EAVE_CORD, 165, 275);
    put(PORCH_CORD, 211, 234);
    return out;
  });
  /** stir state of the i-th flag on a string: the breeze runs along it */
  function stir(t, i) {
    const b = breeze(T.step(t, 8) - i * 0.18);
    return b > 0.32 ? 2 : b < -0.32 ? 0 : 1;
  }
  function drawHung(g, t, list) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      g.sprite(f.frames[stir(t, i)], f.x, f.y);
    }
  }
  /** the cords, gutter hooks and porch-post ties (static, in the overlay) */
  function paintCords(I, eave, porch) {
    if (eave) {
      for (const [x, y] of EAVE_CORD) I.set(x, y, S[1], 0);
      for (const x of [162, 191, 220, 249, 277]) {
        I.set(x, EAVE_CORD.get(x) - 1, S[3], 0);
        I.set(x, EAVE_CORD.get(x), S[2], 0);
      }
    }
    if (porch) {
      for (const [x, y] of PORCH_CORD) I.set(x, y, S[1], 0);
      I.set(208, 176, S[2], 0);
      I.set(236, 176, S[2], 0);
    }
  }

  // ---- the big saltire hung from the upper-left window like a fan flag ----
  const SAL_W = 18;
  const SAL_H = 11;
  const SAL_ROWS = saltireRows(SAL_W, SAL_H, 0.95);
  const SALTIRE_AT = (() => {
    const w = WIN['upper-left'].w;
    return { x: w.x - 2, y: w.y + w.h + 3 }; // top edge over the sill
  })();
  const saltire = HD.perEdition((ed) => {
    if (!has(ed, 'saltire-banner')) return null;
    const frames = [];
    for (let k = 0; k < 4; k++)
      for (const st of [-1, 0, 1])
        frames.push(
          HD.bake(SAL_W + 2, SAL_H + 1, (g) => {
            for (let r = 0; r < SAL_H; r++) {
              // the top is tied to the sill; in a gust the trailing hem corner lifts
              const sh = 0;
              for (let c = 0; c < SAL_W; c++) {
                const cc = st > 0 ? c : SAL_W - 1 - c; // distance from the lifting corner
                if (st !== 0 && ((r === SAL_H - 1 && cc < 2) || (r === SAL_H - 2 && cc < 1))) continue;
                let ch = SAL_ROWS[r][c];
                // slow folds travelling across the cloth (deeper towards the hem)
                const fold = Math.sin(2 * Math.PI * (c / 7.5 - k / 4) + r * 0.08);
                if (r > 0 && fold < (r < 4 ? -0.8 : -0.55)) ch = ch.toLowerCase();
                let col = clothOf(ch);
                if (r > 0 && fold > 0.85 && ch === 'S') col = mixc(CLOTH.S, BN[3], 0.18);
                g.px(1 + c + sh, r, col);
              }
            }
            // tie cords at the top corners
            g.px(1, 0, S[2]);
            g.px(SAL_W, 0, S[2]);
          }),
        );
    return frames;
  });
  function drawSaltire(g, t, frames) {
    const ts = T.step(t, 6);
    const k = Math.floor(T.phase(ts, 3.2) * 4) % 4;
    const b = breeze(ts);
    const st = b > 0.3 ? 2 : b < -0.3 ? 0 : 1;
    g.sprite(frames[k * 3 + st], SALTIRE_AT.x - 1, SALTIRE_AT.y);
  }

  // ---- the TV in the ground-left window (Match Night) ----
  const TV = { lx: 2, ly: 11, w: 14, h: 9 }; // bezel; the screen is inset by 1
  const SCR_W = TV.w - 2;
  const SCR_H = TV.h - 2;
  const PG = P.bulb.green;
  const PITCH = [mixc(PG[1], NI[3], 0.42), mixc(PG[1], NI[3], 0.28)];
  const PITCH_LINE = mixc(PG[1], P.bulb.white[1], 0.45);
  const TV_GLASS = [0.1, 0.2, 0.32, 0.46, 0.62].map((k) => mixc(NI[2], PG[1], k));
  function paintTV(I) {
    const w = WIN['ground-left'];
    // bezel (a dark slab: it stays dark under the relight) and a low cabinet
    for (let ly = TV.ly; ly < TV.ly + TV.h; ly++)
      for (let lx = TV.lx; lx < TV.lx + TV.w; lx++) putW(I, w, lx, ly, NI[0]);
    rowsW(I, w, ['cccccccccccc', '.c........c.'], TV.lx + 1, TV.ly + TV.h, { c: A[0] });
    // a green-and-white scarf draped over the cabinet end
    rowsW(I, w, ['gwg', 'g..', 'w..'], TV.lx + 9, TV.ly + TV.h, { g: CLOTH.G, w: BN[3] });
    // the pelmet in the dark (the hearth is out): a plain dark band, no red glow
    for (let lx = 0; lx < w.gw; lx++) {
      putW(I, w, lx, 0, W[1]);
      putW(I, w, lx, 1, W[1]);
      if (lx % 4 !== 0) putW(I, w, lx, 2, W[1]);
      if (lx % 4 === 2) putW(I, w, lx, 3, W[1]);
    }
  }
  const pitchArt = HD.perEdition((ed) =>
    has(ed, 'tv-match')
      ? HD.bake(SCR_W, SCR_H, (g) => {
          for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) g.px(x, y, PITCH[(x >> 1) & 1]);
          g.vline(SCR_W >> 1, 0, SCR_H - 1, PITCH_LINE); // halfway line
          g.vline(0, 2, SCR_H - 3, PITCH_LINE); // goal mouths
          g.vline(SCR_W - 1, 2, SCR_H - 3, PITCH_LINE);
        })
      : null,
  );
  // player home spots on the 12 x 7 screen: [x, y, team]
  const PLAYERS = [
    [3, 2, 0],
    [4, 5, 0],
    [7, 3, 0],
    [5, 1, 1],
    [8, 5, 1],
    [9, 2, 1],
  ];
  const TEAM = [P.bulb.red[2], P.bulb.white[2]];
  function goalK(t) {
    if (!SUM || HD.edition.id !== 'match') return -1;
    return SUM.goal(t);
  }
  /** soft swells of light during the goal cheer (0..1, never a strobe) */
  function goalPulse(t) {
    const u = goalK(t);
    if (u < 0) return 0;
    return Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.cos(2 * Math.PI * 3 * u));
  }
  function drawTV(g, t) {
    const w = WIN['ground-left'];
    const sx = w.gx + TV.lx + 1;
    const sy = w.gy + TV.ly + 1;
    const e = g.em;
    e.reset();
    e.sprite(pitchArt(), sx, sy);
    const ts = T.step(t, 6);
    const u = goalK(t);
    // play sways from end to end; in the goal window it is all at the right goal
    const play = u >= 0 ? 2.5 : 3 * (T.noise(ts, 11, 771) * 2 - 1);
    for (let i = 0; i < PLAYERS.length; i++) {
      const [px, py, team] = PLAYERS[i];
      const x = clamp(RND(px + play + 1.3 * (T.noise(ts, 2.3, 780 + i) * 2 - 1)), 1, SCR_W - 2);
      const y = clamp(RND(py + 1.2 * (T.noise(ts, 2.9, 790 + i) * 2 - 1)), 0, SCR_H - 1);
      const jump = u >= 0 && u < 0.6 && team === 0 && Math.floor(ts * 3 + i) % 2 === 0 ? -1 : 0;
      e.px(sx + x, sy + clamp(y + jump, 0, SCR_H - 1), TEAM[team]);
    }
    // the ball: passed about, or nestled in the net
    let bx;
    let by;
    if (u >= 0) {
      bx = SCR_W - 2;
      by = 3;
    } else {
      bx = clamp(RND(5.5 + play + 3 * (T.noise(ts, 1.7, 799) * 2 - 1)), 1, SCR_W - 2);
      by = clamp(RND(3 + 2 * (T.noise(ts, 1.3, 798) * 2 - 1)), 0, SCR_H - 1);
    }
    e.px(sx + bx, sy + by, P.bulb.white[2]);
    // goal: the whole screen flares (the replay crowd shot) in soft beats
    if (goalPulse(t) > 0.55) {
      e.hline(sx, sx + SCR_W - 1, sy, PITCH_LINE);
      e.hline(sx, sx + SCR_W - 1, sy + SCR_H - 1, PITCH_LINE);
    }
  }

  // ---- the pub sign: an iron bracket off the right porch post ----
  const SIGN = { x: PO.postR + 2, y: PO.roofY + 11 }; // board top-left
  // board 14 x 10: a gold frame on bottle green, a painted three-leaf
  // shamrock and a pint of stout with its cream head (no words)
  const SIGN_ROWS = [
    '.FFFFFFFFFFFFF.',
    'F..lLL..bHHHHbf',
    'F..LLL..bhHHhbf',
    'FlL.L.lLbgkkgbf',
    'FLLLvLLLbgkkgbf',
    'FLL.s.LLbgkkgbf',
    'F...s...bgkkgbf',
    'F....s..b.gg.bf',
    'Fbbbbbbbbbbbbbf',
    '.fffffffffffff.',
  ];
  const signArt = HD.perEdition((ed) =>
    has(ed, 'pub-sign')
      ? HD.sprite(
          SIGN_ROWS.map((r, y) => (y > 0 && y < SIGN_ROWS.length - 1 ? r.replace(/\./g, 'b') : r)),
          { F: GD[3], f: GD[2], b: LF[1], L: LF[6], l: LF[7], v: LF[3], s: LF[5], H: BN[4], h: BN[3], g: BN[1], k: W[0] },
        )
      : null,
  );
  function paintSignBracket(I) {
    const x0 = PO.postR + 1;
    const y = PO.roofY + 7;
    // wall plate on the post, the arm, and a curled brace under it
    I.set(x0, y - 1, S[3], 0);
    I.set(x0, y, S[3], 0);
    I.set(x0, y + 1, S[2], 0);
    for (let x = x0; x <= x0 + 15; x++) I.set(x, y, x === x0 + 15 ? S[4] : S[3], 0);
    I.set(x0 + 15, y - 1, S[2], 0);
    stamp(I, ['....ss', '...s..', '..s...', '.s....', 's.....'], x0, y + 1, { s: S[2] });
    I.set(x0 + 6, y + 1, S[2], 0);
  }
  function drawSign(g, t) {
    const ts = T.step(t, 8);
    const b = breeze(ts - 0.4);
    const sh = b > 0.55 ? 1 : b < -0.55 ? -1 : 0;
    const x = SIGN.x + sh;
    const y = SIGN.y;
    // two short chains from the arm
    for (const cx of [2, 12]) {
      g.px(SIGN.x + cx, y - 3, S[3]);
      g.px(SIGN.x + cx + (sh > 0 ? 1 : 0), y - 2, S[2]);
      g.px(x + cx, y - 1, S[3]);
    }
    g.sprite(signArt(), x, y);
  }

  // ---- July 4th: pleated red-white-blue fans (NYC) ----
  function bakeFan(I, cx, top, w, h) {
    const hw = w / 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - hw) / hw;
        const dy = (y + 0.5) / h;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1.02) continue;
        const a = Math.atan2(dy, dx); // 0..PI
        const pleat = (((a / Math.PI) * 7) % 1) < 0.2;
        let ch;
        if (d < 0.42) ch = HD.hash(x, y, 77) < 0.22 && y > 0 ? 'V' : 'U';
        else if (d < 0.6) ch = 'R';
        else if (d < 0.78) ch = 'W';
        else ch = 'R';
        if (pleat && d >= 0.42) ch = ch.toLowerCase();
        I.set(RND(cx - hw) + x, top + y, clothOf(ch), 0);
      }
    // the rod it hangs from
    for (let x = RND(cx - hw) - 1; x <= RND(cx - hw) + w; x++) I.set(x, top - 1, W[4], 0);
  }
  function paintFans(I) {
    const ul = WIN['upper-left'].w;
    const ur = WIN['upper-right'].w;
    bakeFan(I, ul.x + ul.w / 2, ul.y + ul.h + 4, 17, 8);
    bakeFan(I, ur.x + ur.w / 2, ur.y + ur.h + 4, 17, 6);
    bakeFan(I, K.DCX + 0.5, PO.roofY + 5, 21, 7);
  }

  // ---- the series cat's window while the family is away ----
  function paintAway(I) {
    const w = WIN['upper-right'];
    // a potted geranium where the cat sits, and a little folded note with a heart
    rowsW(I, w, ['.r.l.r', 'rlrlll', '.llrl.', '..ll..', '..t...', '.pppp.', '.pppp.', '..pp..'], 3, w.gh - 8, {
      r: RD[5],
      l: LF[4],
      t: LF[3],
      p: P.pumpkin[2],
    });
    rowsW(I, w, ['..cc', '.ccc', 'chcc', 'cccc'], 10, w.gh - 4, { c: BN[4], h: RD[4] });
  }

  // ---- Lunar New Year (Boston): red plum branches in a vase indoors ----
  function paintPlumVase(I) {
    const w = WIN['ground-right'];
    // angular branches (silhouettes) from the vase mouth up across the glass
    const B = W[1];
    const br = [
      [12, 13, 11, 10],
      [11, 10, 9, 8],
      [9, 8, 8, 5],
      [8, 5, 6, 3],
      [6, 3, 5, 1],
      [11, 10, 7, 9],
      [7, 9, 5, 7],
      [12, 12, 14, 9],
      [14, 9, 13, 6],
      [9, 8, 10, 4],
    ];
    for (const [x0, y0, x1, y1] of br) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) putW(I, w, RND(x0 + ((x1 - x0) * k) / n), RND(y0 + ((y1 - y0) * k) / n), B);
    }
    // blossoms: five-petal dots in plum red with a pale heart
    const bl = [
      [5, 1, 1],
      [6, 3, 0],
      [8, 5, 1],
      [10, 4, 0],
      [9, 8, 0],
      [5, 7, 1],
      [7, 9, 0],
      [13, 6, 1],
      [14, 9, 0],
      [11, 11, 0],
      [3, 2, 0],
    ];
    for (const [x, y, big] of bl) {
      putW(I, w, x, y, PLM[5]);
      putW(I, w, x - 1, y, PLM[4]);
      putW(I, w, x + 1, y, PLM[4]);
      putW(I, w, x, y - 1, PLM[4]);
      if (big) putW(I, w, x, y + 1, PLM[3]);
    }
    // the vase: a slim meiping, dark against the glow
    rowsW(I, w, ['.nn.', 'vvvv', 'vVvv', 'vVvv', 'vvvv', '.vv.', 'vvvv'], 11, 15, { n: A[0], v: A[0], V: A[1] });
  }

  // ===================================================================
  // hooks used by house.js
  // ===================================================================
  const omitCache = new Map();
  function omit(ed) {
    let o = omitCache.get(ed.id);
    if (o) return o;
    o = new Set(['pumpkin']);
    if (has(ed, 'menorah')) o.add('chair');
    if (has(ed, 'paper-cuts') || has(ed, 'party-windows')) o.add('herbs');
    if (has(ed, 'open-windows')) o.add('gr-curtains');
    if (has(ed, 'tv-match')) {
      o.add('chair');
      o.add('gl-vbar');
    }
    omitCache.set(ed.id, o);
    return o;
  }

  K.seasons = {
    omit,
    decorateHouse(R, ed) {
      if (has(ed, 'roof-snow')) {
        // eave and turret icicles go on an overlay drawn in front of the
        // string lights, so the wire never cuts them at the root
        const ice = K.raster();
        snowAll(R, true, ice, bulbMask(ed));
        ICE_ART.set(ed.id, ice.toCanvas());
      } else if (has(ed, 'roof-snow-light')) snowAll(R, false, null, null);
      if (has(ed, 'paper-lantern-string')) paintHook(R);
    },
    decorateInterior,
    warm() {
      winSetup();
      matchFlags();
      partyPennants();
      saltire();
      pitchArt();
      signArt();
    },
    winCfg: (win) => winSetup().cfg[win.index],
    winBoost: (win, t) => winSetup().boost[win.index] * (1 + 0.6 * goalPulse(t)),
    /** window glass level: the goal cheer lifts every window for a few beats */
    level(i, lv, t) {
      const p = goalPulse(t);
      return p > 0 ? Math.min(K.NL - 1, lv + RND(p * 3)) : lv;
    },
    catAway: () => has(HD.edition, 'cat-away'),
    glass(i, lv) {
      const gl = winSetup().glass[i];
      return gl ? gl[lv] : K.glass[i][lv];
    },
    ironLantern: () => !has(HD.edition, 'red-lanterns') && !has(HD.edition, 'harvest-lanterns'),
    drawInside,
    drawFront,
    lights,
  };
})();
