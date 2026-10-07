/*
 * Summer Story family cats (see SUMMER.md). Owned by the family module.
 *
 * Every family member is a small upright cat built from ASCII parts (head,
 * features, hair, outfit, arms) and baked once per pose into a sprite pair
 * (albedo + emissive eye-shine/glints), then blitted per frame. Poses are
 * chosen from t only (pure, loop-safe), idle life runs at 8 fps.
 *
 * Draws NOTHING unless HD.edition.story is true. The family adds no lights of
 * its own: the cats sit inside the pools the chapter's real sources cast
 * (porch lantern, cake candles, plaza lanterns, heater, heart lantern), and
 * the outfits are painted as mid-tones that still read at ambient.
 *
 *  match: you (red Spain-style jersey) + partner on the porch steps watching
 *    the TV in the ground-left window, cheering at the goal; the niece drops by.
 *  home: partner beside the series cat in the lit upper-right window
 *    (silhouette, z 29.7); the niece drops by.
 *  nyc / la / sandiego: the family outdoors at z 47.
 *  dc: a back row behind the birthday table (z 33) and a front row (z 47).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LAY = HD.layout;
  const SU = LAY.summer;
  const R = Math.round;

  // ---------------------------------------------------------------------
  // colour helpers: paint each outfit as its "night" colour. FILL is the
  // modest warm light the cats typically get from the chapter's sources, so
  // colours read at ambient and warm up (without blowing out) when lit.
  // ---------------------------------------------------------------------
  const FILL = 0.3;
  const AMB = HD.AMBIENT || [0.34, 0.38, 0.52];
  const LC = HD.LIGHT.candle;
  function rgb(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function hex(r, g, b) {
    const c = (x) => Math.max(0, Math.min(255, R(x))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  /** daytime colour -> night albedo that relights back to it under FILL */
  function nite(h, k) {
    const kk = k === undefined ? FILL : k;
    const [r, g, b] = rgb(h);
    return hex(r / (1 + (kk * LC[0]) / AMB[0]), g / (1 + (kk * LC[1]) / AMB[1]), b / (1 + (kk * LC[2]) / AMB[2]));
  }

  // ---------------------------------------------------------------------
  // grid helpers
  // ---------------------------------------------------------------------
  function grid(w, h) {
    const G = [];
    for (let y = 0; y < h; y++) G.push(new Array(w).fill('.'));
    return G;
  }
  function set(G, x, y, ch) {
    if (y >= 0 && y < G.length && x >= 0 && x < G[0].length) G[y][x] = ch;
  }
  function get(G, x, y) {
    return y >= 0 && y < G.length && x >= 0 && x < G[0].length ? G[y][x] : '.';
  }
  function stamp(G, rows, ox, oy) {
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) if (rows[y][x] !== '.') set(G, ox + x, oy + y, rows[y][x]);
  }
  const EMCH = 'zeyw';
  const OUTLINE = '#0b0910';
  function bake(G, map, emMap) {
    // pad by one cell and add a dark 1px outline (not under the feet) so the
    // small characters read against the lit grass
    const H0 = G.length;
    const W0 = G[0].length;
    const Q = grid(W0 + 2, H0 + 2);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) Q[y + 1][x + 1] = G[y][x];
    for (let y = 0; y < H0 + 1; y++)
      for (let x = 0; x < W0 + 2; x++) {
        if (Q[y][x] !== '.') continue;
        const n = (xx, yy) => yy >= 0 && yy < H0 + 2 && xx >= 0 && xx < W0 + 2 && Q[yy][xx] !== '.' && Q[yy][xx] !== 'o';
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) Q[y][x] = 'o';
      }
    map = Object.assign({ o: OUTLINE }, map);
    const rows = Q.map((r) => r.join(''));
    const alb = HD.sprite(rows, map);
    let em = null;
    if (emMap && rows.some((r) => [...r].some((c) => EMCH.includes(c) && emMap[c]))) em = HD.sprite(rows, emMap);
    return { alb, em, w: alb.width, h: alb.height };
  }
  function blit(g, s, x, y) {
    g.sprite(s.alb, x - 1, y - 1);
    if (s.em) g.em.sprite(s.em, x - 1, y - 1);
  }
  const cache = new Map();
  function memo(key, fn) {
    let s = cache.get(key);
    if (!s) cache.set(key, (s = fn()));
    return s;
  }

  // ---------------------------------------------------------------------
  // adult cat: 17x19 grid, head 9x7 at (HX0.., HY0..), body 9 wide at BX, BY.
  // Two rows of headroom above the ears for raised paws.
  // stand: feet on the last row (base); sit: lap row BY+3 = seat
  // ---------------------------------------------------------------------
  const AW = 17;
  const AH = 19;
  const CX = 8; // centre column
  const BX = 4;
  const BY = 12;
  const HX0 = 4;
  const HY0 = 5;
  const HEAD = ['.E.....E.', '.EI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const HEAD_FLICK = ['.......E.', 'EEI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  // ears pushed to the corners (a rider sits between them)
  const HEAD_WIDE = ['E.......E', 'EI.....IE', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const BODY = {
    stand: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hSSSSSh.', '..LLLLL..', '..LL.LL..', '..kk.kk..'],
    round: ['..SSSSS..', '.SSSSSSS.', 'SSSSSSSSS', 'hSSSSSSSh', '.LLLLLLL.', '..LL.LL..', '..kk.kk..'],
    sit: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hLLLLLh.', '..LL.LL..', '..kk.kk..'],
  };
  // raised arms, left side as [dx from BX, y, ch]; mirrored for the right
  const ARM = {
    // cheer: sleeve from the shoulder, forearm up beside the head, paw above the ears
    up: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'S'], [-1, BY - 2, 'h'], [-2, BY - 3, 'h'], [-2, BY - 4, 'h'], [-2, BY - 5, 'h'], [-2, BY - 6, 'h'], [-2, BY - 7, 'h'], [-2, BY - 8, 'h'], [-3, BY - 8, 'h']],
    // the other wave frame: the paw tips one pixel further out
    up2: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'S'], [-1, BY - 2, 'h'], [-2, BY - 3, 'h'], [-2, BY - 4, 'h'], [-2, BY - 5, 'h'], [-2, BY - 6, 'h'], [-3, BY - 7, 'h'], [-3, BY - 8, 'h'], [-4, BY - 8, 'h']],
    // holding the rider's sneakers at cheek height
    shoulder: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'h'], [-1, BY - 2, 'h']],
  };

  /**
   * sp: character spec (colours + traits), p: pose
   *  p.look -1|0|1, p.blink, p.ear, p.eyes 'open'|'happy'|'closed',
   *  p.mouth 'none'|'smile'|'laugh'|'o', p.arms 'down'|'up'|'shoulder'|
   *  'wave'|'wave2'|'offer'|'hold', p.sit, p.hx/p.hy head offset,
   *  p.br breeze px (-2..2), p.gust -1|0|1
   */
  function buildAdult(sp, p) {
    const G = grid(AW, AH);
    const HX = HX0 + (p.hx || 0);
    const HY = HY0 + (p.hy || 0);
    const sit = !!p.sit;
    // ---- body (does not move with the head) ----
    const body = sit ? BODY.sit : sp.round ? BODY.round : BODY.stand;
    stamp(G, body, BX, BY);
    // shirt pattern
    for (let y = BY; y < BY + 4; y++)
      for (let x = 0; x < AW; x++) {
        if (G[y][x] !== 'S') continue;
        const u = x - BX;
        const v = y - BY;
        if (sp.pattern === 'stripesV' && u % 2 === 1) G[y][x] = 'A';
        else if (sp.pattern === 'stripesH' && v % 2 === 1) G[y][x] = 'A';
        else if (sp.pattern === 'plaid' && (u % 3 === 1 || v === 2)) G[y][x] = 'A';
        else if (sp.pattern === 'floral' && (u * 3 + v * 5) % 7 === 2) G[y][x] = 'A';
      }
    if (sp.neck === 'tee') set(G, BX + 4, BY, 'h');
    if (sp.neck === 'polo' || sp.neck === 'shirt') {
      set(G, BX + 3, BY, 'C');
      set(G, BX + 5, BY, 'C');
      set(G, BX + 4, BY, 'h');
    }
    if (sp.neck === 'shirt') {
      set(G, BX + 4, BY + 1, 'A');
      set(G, BX + 4, BY + 2, 'A');
    }
    if (sp.sleeveTip) {
      const w = sp.round ? 0 : 1;
      set(G, BX + w, BY + 2, 'C');
      set(G, BX + 8 - w, BY + 2, 'C');
    }
    // waistband: separates a pale tee from pale shorts
    if (sp.belt && !sit) for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY + 4, 'Q');
    if (sp.belt && sit) for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY + 3, 'Q');
    // ---- arms ----
    const pawL = sp.round ? BX : BX + 1;
    const pawR = sp.round ? BX + 8 : BX + 7;
    const arms = p.arms || 'down';
    const raise = (side, kind) => {
      const sx = side < 0 ? pawL : pawR;
      for (let y = BY + 1; y <= BY + 3; y++) if ('ShAC'.includes(get(G, sx, y))) set(G, sx, y, '.');
      for (const [dx, y, ch] of ARM[kind]) set(G, side < 0 ? BX + dx : BX + 8 - dx, y, ch);
    };
    if (arms === 'up') {
      raise(-1, 'up');
      raise(1, 'up');
    } else if (arms === 'shoulder') {
      raise(-1, 'shoulder');
      raise(1, 'shoulder');
    } else if (arms === 'wave') raise(1, 'up');
    else if (arms === 'wave2') raise(1, 'up2');
    else if (arms === 'offer') {
      for (let y = BY + 1; y <= BY + 3; y++) set(G, pawL, y, '.');
      set(G, pawL, BY + 1, 'S');
      set(G, pawL - 1, BY + 2, 'h');
      set(G, pawL - 2, BY + 2, 'h');
    } else if (arms === 'hold') {
      set(G, pawL, BY + 3, '.');
    }
    // ---- head ----
    stamp(G, p.wide ? HEAD_WIDE : p.ear ? HEAD_FLICK : HEAD, HX, HY);
    if (sp.temples) for (const [x, y] of [[0, 3], [8, 3], [1, 2], [7, 2], [0, 4], [8, 4]]) set(G, HX + x, HY + y, 'x');
    if (sp.tabby) for (const [x, y] of [[3, 2], [5, 2], [4, 3], [0, 3], [8, 3], [1, 5], [7, 5]]) set(G, HX + x, HY + y, 'O');
    if (sp.sheen && sp.hair !== 'long') for (const [x, y] of [[2, 2], [3, 2]]) set(G, HX + x, HY + y, 'J');
    const L = HX + (p.look || 0);
    // muzzle
    if (sp.muzzle) {
      set(G, L + 3, HY + 5, sp.muzzle);
      set(G, L + 5, HY + 5, sp.muzzle);
      set(G, L + 4, HY + 6, sp.muzzle);
    }
    // eyes / glasses
    const eyes = p.blink ? 'closed' : p.eyes || 'open';
    const arc = sp.happyEm ? 'e' : 'q';
    if (sp.glasses) {
      const av = sp.glasses === 'aviator';
      if (eyes === 'happy') {
        // the frame stays on the eyes; happy arcs peek out under it
        for (let k = 1; k <= 7; k++) set(G, L + k, HY + 3, 'g');
        for (const ox of [2, 6]) {
          set(G, L + ox - 1, HY + 5, arc);
          set(G, L + ox, HY + 4, arc);
          set(G, L + ox + 1, HY + 5, arc);
        }
      } else {
        // two 2x2 lenses on a 1px bridge; outer head columns and muzzle stay clear
        for (const ox of [2, 5])
          for (let k = 0; k < 2; k++) {
            set(G, L + ox + k, HY + 3, 'G');
            set(G, L + ox + k, HY + 4, 'G');
          }
        set(G, L + 1, HY + 3, 'g');
        set(G, L + 4, HY + 3, 'g');
        set(G, L + 7, HY + 3, 'g');
        set(G, L + 2, HY + 3, 'z');
        set(G, L + 5, HY + 3, 'z');
        if (av) {
          // teardrop: the outer lower corner drops a pixel
          set(G, L + 2, HY + 5, 'G');
          set(G, L + 6, HY + 5, 'G');
        }
      }
    } else if (eyes === 'happy') {
      for (const ox of [2, 6]) {
        set(G, L + ox - 1, HY + 4, arc);
        set(G, L + ox, HY + 3, arc);
        set(G, L + ox + 1, HY + 4, arc);
      }
    } else {
      for (const ox of [2, 6]) set(G, L + ox, HY + 4, eyes === 'closed' ? 'q' : 'e');
    }
    set(G, L + 4, HY + 5, 'n');
    const mouth = p.mouth || sp.mouth || 'smile';
    if (mouth === 'smile') {
      set(G, L + 3, HY + 6, 'm');
      set(G, L + 5, HY + 6, 'm');
    } else if (mouth === 'laugh') {
      set(G, L + 3, HY + 6, 'm');
      set(G, L + 4, HY + 6, 'M');
      set(G, L + 5, HY + 6, 'm');
    } else if (mouth === 'o') {
      set(G, L + 4, HY + 6, 'm');
      set(G, HX - 1, HY + 5, 'F');
      set(G, HX + 9, HY + 5, 'F');
    }
    if (sp.whiskers && mouth !== 'o') {
      // one dim tick per side, on alternating rows
      set(G, HX - 1, HY + 5, 'w');
      set(G, HX + 9, HY + 4, 'w');
    }
    // ---- long straight hair (partner) ----
    if (sp.hair === 'long') {
      const br = p.br || 0;
      // crown cap down to the brows
      for (let x = 1; x <= 7; x++) set(G, HX + x, HY + 2, 'H');
      for (const x of [0, 1, 7, 8]) set(G, HX + x, HY + 3, 'H');
      set(G, HX + 2, HY + 2, 'J');
      set(G, HX + 3, HY + 2, 'J');
      // 2px curtains framing the face
      for (let y = HY + 3; y <= HY + 6; y++) {
        set(G, HX - 1, y, 'H');
        set(G, HX, y, 'H');
        set(G, HX + 8, y, 'H');
        set(G, HX + 9, y, 'H');
      }
      set(G, HX - 1, HY + 4, 'J');
      set(G, HX - 1, HY + 5, 'J');
      // over the shoulders onto the tee, down to the waist; the lower rows
      // trail with the breeze
      const sg = Math.sign(br);
      const ab = Math.abs(br);
      for (let i = 0; i < 4; i++) {
        const y = BY + i;
        const d = sg * Math.min(ab, i === 0 ? 0 : i < 3 ? 1 : 2);
        const lx = (i === 0 ? BX : BX + 1) + d;
        const rx = (i === 0 ? BX + 7 : BX + 6) + d;
        set(G, lx, y, i === 1 ? 'J' : 'H');
        set(G, lx + 1, y, 'H');
        set(G, rx, y, 'H');
        set(G, rx + 1, y, 'H');
      }
      // one strand lifts at the top of a gust
      if (p.gust) set(G, p.gust > 0 ? HX + 10 : HX - 2, HY + 3, 'H');
    }
    // ---- wavy hair (sister) ----
    if (sp.hair === 'wavy') {
      for (let y = HY + 2; y <= HY + 11; y++) {
        const k = y - HY;
        const drift = k >= 7 ? Math.sign(p.br || 0) : 0;
        const wv = k % 3 === 1 ? 1 : 0;
        if (k >= 3 && k <= 6) {
          set(G, HX + 0, HY + k, 'H');
          set(G, HX + 8, HY + k, 'H');
        }
        if (k >= 4) {
          set(G, HX - 1 - wv + drift, y, k === 5 ? 'J' : 'H');
          set(G, HX + 9 + wv + drift, y, 'H');
          if (k >= 9) {
            set(G, HX - 2 + drift, y, 'H');
            set(G, HX + 10 + drift, y, 'H');
          }
        }
      }
      set(G, HX + 1, HY + 2, 'H');
      set(G, HX + 7, HY + 2, 'H');
    }
    if (sp.headband) {
      for (let x = 1; x <= 7; x++) set(G, HX + x, HY + 2, 'B');
      // bow at the top left, beside the ear
      set(G, HX + 1, HY - 1, 'B');
      set(G, HX + 3, HY - 1, 'B');
      set(G, HX + 1, HY + 0, 'B');
      set(G, HX + 2, HY + 0, 'b');
      set(G, HX + 3, HY + 0, 'B');
      set(G, HX + 2, HY + 1, 'B');
    }
    return G;
  }

  function adultMap(sp) {
    const F = sp.fur;
    const m = {
      E: F,
      F,
      h: F,
      I: sp.inner || nite('#b06878'),
      O: sp.dark || F,
      x: sp.silver || F,
      w: sp.whisker || '#6a6c76',
      f: sp.light || F,
      J: sp.sheenC || F,
      H: sp.hairC || F,
      n: sp.nose || nite('#c07080'),
      m: sp.mouthC || '#0a070c',
      M: nite('#e07080'),
      q: sp.lid || '#07060a',
      S: sp.shirt,
      A: sp.shirtAlt || sp.shirt,
      C: sp.collar || sp.shirt,
      L: sp.pants,
      Q: sp.belt || sp.pants,
      k: sp.shoes || '#121218',
      g: sp.frame || '#2c3242',
      G: sp.lens || '#0c0f18',
      B: sp.bow || nite('#3a6ad0'),
      b: sp.bowDark || nite('#244a9a'),
    };
    const em = { e: sp.eye || '#d9b45a', z: sp.glint || '#a8c4e8' };
    return { m, em };
  }
  function adult(sp, p) {
    const key = sp.key + '|' + (p.look || 0) + (p.blink ? 'b' : '') + (p.ear ? 'e' : '') + (p.eyes || '') + '|' + (p.mouth || '') + '|' + (p.arms || '') + (p.sit ? 's' : '') + (p.wide ? 'w' : '') + '|' + (p.hx || 0) + ',' + (p.hy || 0) + ',' + (p.br || 0) + ',' + (p.gust || 0);
    return memo(key, () => {
      const mp = sp._map || (sp._map = adultMap(sp));
      return bake(buildAdult(sp, p), mp.m, mp.em);
    });
  }

  // ---------------------------------------------------------------------
  // niece kitten. Head 9x7 (pointed ears, top-knot) with a big pink bow on
  // the top-knot, tiny body. Head col c / row r -> world (x-4+c, base-9+r);
  // feet on base. Grid: head col 0 = KX, head row 0 = KR (+ extra rows)
  // ---------------------------------------------------------------------
  const NW = 15;
  const NH = 13;
  const KX = 3;
  const KR = 3;
  const KHEAD = ['.E..t..E.', '.EIFFFIE.', 'FFFfffFFF', 'FfwWfwWfF', 'FFWvnWvFF', '.cFlslFc.', '..FFFFF..'];
  const KHEAD_BLINK = ['.E..t..E.', '.EIFFFIE.', 'FFFfffFFF', 'FfFFfFFfF', 'FFqqnqqFF', '.cFlslFc.', '..FFFFF..'];
  const KFEAT = 'wWvnsql';
  // BIG pink bow: two lobes with a highlight each and a dark knot, sitting on
  // the brown top-knot tuft (head cols 2..6, rows -3..-1)
  const KBOW = ['Pp.pP', 'ppkpp', 'pp.pp'];
  // raised arms, left side [col, row, ch] in head coords; mirrored (8-col)
  const KARM = {
    up: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-2, 3, 'h'], [-2, 2, 'h'], [-2, 1, 'h'], [-2, 0, 'h'], [-2, -1, 'h'], [-2, -2, 'h']],
    up2: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-2, 3, 'h'], [-2, 2, 'h'], [-2, 1, 'h'], [-2, 0, 'h'], [-2, -1, 'h'], [-3, -2, 'h']],
    lift: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-1, 3, 'h'], [-1, 2, 'h'], [-1, 1, 'h'], [-1, 0, 'h'], [-1, -1, 'h'], [-1, -2, 'h'], [-1, -3, 'h'], [0, -4, 'h'], [0, -5, 'h']],
  };
  /**
   * p.pose: stand|walk|sit|ride|held|carry|lift
   * p.arms: down|up|wave|wave2 (lift/carry set their own)
   * p.blink, p.look
   */
  function buildKit(o, p) {
    const pose = p.pose || 'stand';
    const extra = pose === 'lift' ? 2 : 0;
    const G = grid(NW, NH + extra);
    const ox = KX;
    const oy = KR + extra;
    const S = (c, r, ch) => set(G, ox + c, oy + r, ch);
    const look = p.look || 0;
    // ---- body (rows 7..9) ----
    const top = pose === 'ride' ? ['...TTT...', '...TTT...'] : o.dress ? ['...TTT...', '..TUTUT..'] : ['...TTT...', '..TTTTT..'];
    stamp(G, top, ox, oy + 7);
    if (o.stripes) for (let c = 2; c <= 6; c++) if (get(G, ox + c, oy + 8) === 'T') S(c, 8, 'U');
    if (o.vest) {
      // tiny orange life vest: two strips and a strap across
      S(3, 7, 'V');
      S(5, 7, 'V');
      S(3, 8, 'V');
      S(5, 8, 'V');
      S(4, 8, 'V');
    }
    if (pose === 'walk' || pose === 'sit') stamp(G, ['..z...z..'], ox, oy + 9);
    else if (pose !== 'ride') stamp(G, ['...z.z...'], ox, oy + 9);
    // ---- arms ----
    let arms = p.arms || 'down';
    if (pose === 'lift') arms = 'lift';
    const raise = (side, kind) => {
      for (const [c, r, ch] of KARM[kind]) S(side < 0 ? c : 8 - c, r, ch);
    };
    if (arms === 'up' || arms === 'lift') {
      raise(-1, arms);
      raise(1, arms);
    } else if (arms === 'wave' || arms === 'wave2') {
      raise(1, arms === 'wave' ? 'up' : 'up2');
      if (pose !== 'ride') S(1, 8, 'h');
    } else if (pose === 'carry') {
      S(0, 7, 'h');
      S(8, 7, 'h');
    } else if (pose === 'ride') {
      // paws resting on the rider's knees: none drawn beside the body
    } else {
      S(1, 8, 'h');
      S(7, 8, 'h');
    }
    // ---- head ----
    const head = p.blink ? KHEAD_BLINK : KHEAD;
    for (let r = 0; r < head.length; r++)
      for (let c = 0; c < head[r].length; c++) {
        const ch = head[r][c];
        if (ch === '.') continue;
        // the face shape stays, features follow the look direction
        S(c, r, KFEAT.includes(ch) ? (r === 3 ? 'f' : 'F') : ch);
      }
    for (let r = 0; r < head.length; r++)
      for (let c = 0; c < head[r].length; c++) {
        const ch = head[r][c];
        if (KFEAT.includes(ch)) S(c + look, r, ch);
      }
    // ---- bow on the top-knot ----
    for (let r = 0; r < KBOW.length; r++)
      for (let c = 0; c < KBOW[r].length; c++) if (KBOW[r][c] !== '.') S(2 + c, r - 3, KBOW[r][c]);
    S(4, -1, 't');
    if (pose === 'held' && o.cup) {
      S(7, 7, 'Y');
      S(7, 8, 'y');
      S(6, 8, 'h');
    }
    return G;
  }
  const KIT_C = {
    F: nite('#6e4430'),
    E: nite('#6e4430'),
    I: nite('#e88aa0'),
    t: nite('#8a5638'),
    f: nite('#946247'),
    l: nite('#d6a888'),
    v: '#2a2a4a',
    h: nite('#6e4430'),
    p: nite('#ff5aa0', 0.22),
    P: nite('#ffc4e0', 0.22),
    k: nite('#b02a68', 0.22),
    W: '#0a070c',
    n: nite('#e08a96'),
    s: nite('#a03848'),
    c: nite('#f08a9a'),
    q: '#120c10',
    z: nite('#d83a3a'),
    Y: nite('#ffd23a'),
    V: nite('#ff7a1a', 0.22),
  };
  function kitMap(o) {
    const m = Object.assign({}, KIT_C, { T: o.top, U: o.alt || o.top });
    if (o.cup) m.y = nite('#f0e8d8');
    return { m, em: { w: '#ffffff' } };
  }
  function kit(o, p) {
    const key = 'kit|' + o.key + '|' + (p.pose || 'stand') + '|' + (p.arms || 'down') + (p.blink ? 'b' : '') + (p.look || 0);
    return memo(key, () => {
      const mp = o._map || (o._map = kitMap(o));
      return bake(buildKit(o, p), mp.m, mp.em);
    });
  }
  /** blit the kitten so her feet sit on base, centred on x */
  function blitKit(g, o, p, x, base) {
    const s = kit(o, p);
    const extra = p.pose === 'lift' ? 2 : 0;
    blit(g, s, x - 4 - KX, base - 9 - KR - extra);
  }

  // ---------------------------------------------------------------------
  // cast per chapter
  // ---------------------------------------------------------------------
  const BLACK = '#100d16';
  const WARM_WHITE = nite('#fff6e8');
  const KIT_OUT = {
    blue: { key: 'blue', top: nite('#3c66e0') },
    la: { key: 'stripe', top: nite('#26346a'), alt: nite('#fff6e8'), stripes: true },
    sandiego: { key: 'bay', top: nite('#26346a'), alt: nite('#fff6e8'), stripes: true, vest: true },
    dc: { key: 'dress', top: nite('#6a1830', 0.2), alt: nite('#f4c8d4'), dress: true, cup: true },
  };
  const YOU = {};
  function you(ed) {
    return YOU[ed] || (YOU[ed] = makeYou(ed));
  }
  function makeYou(ed) {
    const base = {
      fur: BLACK,
      light: '#241e2c',
      inner: nite('#7a4050'),
      nose: '#2a1a24',
      eye: HD.color.mix(P.amber[7], P.spirit[3], 0.45),
      mouth: 'smile',
      mouthC: '#6e5872',
      frame: '#454b60',
      lens: '#161c2a',
      happyEm: true,
      neck: 'tee',
    };
    if (ed === 'match')
      return Object.assign(base, { key: 'you-match', shirt: nite('#c8102e'), collar: nite('#ffc400'), neck: 'polo', sleeveTip: true, pants: nite('#2a2a34') });
    if (ed === 'nyc') return Object.assign(base, { key: 'you-nyc', shirt: nite('#f07a68'), pants: nite('#d8ccb0'), glasses: 'wayfarer' });
    if (ed === 'la')
      return Object.assign(base, { key: 'you-la', shirt: nite('#b8343c'), shirtAlt: nite('#2a3460'), pattern: 'plaid', neck: 'shirt', collar: nite('#c84450'), pants: nite('#3a3a44'), glasses: 'wayfarer' });
    if (ed === 'sandiego')
      return Object.assign(base, { key: 'you-sd', shirt: WARM_WHITE, pants: nite('#8e887a'), belt: nite('#3a3028'), glasses: 'wayfarer', shoes: nite('#e8e4dc') });
    return Object.assign(base, {
      key: 'you-dc',
      shirt: nite('#7aa6e8'),
      shirtAlt: nite('#a8c8f4'),
      collar: nite('#a8c8f4'),
      neck: 'shirt',
      pants: nite('#e8e0cc'),
      glasses: 'aviator',
      frame: nite('#b0b4c0'),
      lens: nite('#3a7ae0', 0.2),
      glint: '#bfe6ff',
    });
  }
  const PARTNER = {
    key: 'partner',
    fur: '#1a1418',
    hair: 'long',
    hairC: '#2a2236',
    happyEm: true,
    sheenC: nite('#6a6490'),
    light: '#2a1e24',
    eye: '#c8d870',
    nose: nite('#a05868'),
    mouth: 'smile',
    mouthC: '#3a1a22',
    shirt: WARM_WHITE,
    neck: 'tee',
    pants: nite('#2a2a34'),
  };
  const SISTER = {
    key: 'sister',
    fur: '#21171a',
    hair: 'wavy',
    hairC: '#2a1a17',
    happyEm: true,
    sheen: true,
    sheenC: '#4c3228',
    eye: '#d8c070',
    nose: nite('#b06070'),
    mouth: 'smile',
    mouthC: '#3a1a22',
    headband: true,
    bow: nite('#3a78e8', 0.5),
    bowDark: nite('#2050b0', 0.5),
    shirt: nite('#3a68c0'),
    shirtAlt: nite('#f0f2f6'),
    pattern: 'stripesV',
    neck: 'shirt',
    collar: nite('#f0f2f6'),
    pants: nite('#ece8e0'),
    shoes: nite('#c8b890'),
  };
  const BIL = {
    key: 'bil',
    fur: nite('#8a8a90'),
    dark: nite('#3e3e46'),
    light: nite('#c8c8cc'),
    muzzle: 'f',
    tabby: true,
    eye: '#d8c070',
    nose: nite('#a86070'),
    mouth: 'smile',
    mouthC: '#2a1a22',
    glasses: 'aviator',
    frame: nite('#f0c040', 0.3),
    lens: nite('#8a5a2a', 0.3),
    glint: '#ffe0a0',
    shirt: nite('#f2ead2'),
    collar: nite('#fff8e6'),
    neck: 'polo',
    pants: nite('#2a2a30'),
    shoes: nite('#7a5a3a'),
  };
  const BIL_LA = Object.assign({}, BIL, { key: 'bil-la', shirt: nite('#d8dce4'), shirtAlt: nite('#7a8aa8'), pattern: 'stripesV', neck: 'shirt', collar: nite('#e8ecf2') });
  const DAD = {
    key: 'dad',
    fur: '#1f181b',
    silver: nite('#9a9ca4'),
    muzzle: 'x',
    temples: true,
    whiskers: true,
    whisker: '#5c5e68',
    happyEm: true,
    eye: '#d8b060',
    nose: nite('#a86070'),
    mouth: 'laugh',
    round: true,
    shirt: nite('#d42a30'),
    collar: nite('#ffffff'),
    neck: 'polo',
    sleeveTip: true,
    pants: nite('#1c1c22'),
    shoes: nite('#2a2a30'),
  };

  // ---------------------------------------------------------------------
  // idle life (8 fps, staggered by seed)
  // ---------------------------------------------------------------------
  function idle(t, seed) {
    const ts = T.step(t, 8);
    const bc = T.cycle(ts, 0, 4.1 + (seed % 7) * 0.43, seed * 31 + 1);
    const bAge = bc.age * bc.P;
    const bAt = 0.4 + bc.rnd(1) * (bc.P - 1);
    const dbl = bc.rnd(2) < 0.25;
    const blink = (bAge > bAt && bAge < bAt + 0.15) || (dbl && bAge > bAt + 0.3 && bAge < bAt + 0.42);
    const ec = T.cycle(ts, 1, 7.7 + (seed % 5) * 0.61, seed * 31 + 2);
    const eAge = ec.age * ec.P;
    const eAt = 0.5 + ec.rnd(1) * (ec.P - 1.2);
    const ear = eAge > eAt && eAge < eAt + 0.25;
    const n = T.noise(ts, 9 + (seed % 4) * 1.9, seed * 31 + 3);
    const look = n > 0.66 ? 1 : n < 0.34 ? -1 : 0;
    const sw = T.wave(ts, 4.3 + (seed % 3) * 0.8, seed * 0.137);
    return { blink, ear, look, sw, ts };
  }
  /** cheer hop, staggered per cat (k = 0..3) at 6 fps */
  function hopAt(t, k) {
    return (Math.floor(T.step(t, 6) * 6) + k) % 4 < 2 ? 1 : 0;
  }
  /** long-hair breeze: px drift (-2..2) and a gust strand side */
  function hairWind(t) {
    const b = HD.summer.breeze(t);
    return { br: Math.max(-2, Math.min(2, R(b * 2))), gust: b > 0.78 ? 1 : b < -0.78 ? -1 : 0 };
  }

  // tail: short curl from the hip; side -1 = left, +1 = right
  const TAILS = [
    [[1, 0], [2, -1], [3, -2], [3, -3], [3, -4], [2, -5]],
    [[1, 0], [2, -1], [3, -1], [4, -2], [4, -3], [4, -4], [3, -5]],
    [[1, 0], [2, 0], [3, -1], [4, -2], [5, -3], [5, -4], [5, -5]],
  ];
  function tail(g, x, y, side, sw, c) {
    const k = sw < -0.33 ? 0 : sw > 0.33 ? 2 : 1;
    const pts = TAILS[k];
    for (let i = 0; i < pts.length; i++) {
      const px = x + side * pts[i][0];
      const py = y + pts[i][1];
      g.px(px, py, c);
      if (i < 2) g.px(px, py - 1, c);
    }
  }
  // long plume tail hanging down (partner seated), drifts with breeze
  function plume(g, x, y, side, br, c, hi) {
    for (let i = 0; i < 7; i++) {
      const dx = side * (1 + Math.min(i, 3)) + R(br * Math.max(0, i - 2) * 0.25);
      g.px(x + dx, y + i, c);
      g.px(x + dx + side, y + i, c);
      if (i === 2) g.px(x + dx, y + i, hi);
    }
  }
  function shadow(g, x, base, hw) {
    for (let dx = -hw; dx <= hw; dx++) {
      if (Math.abs(dx) === hw && HD.bayer(x + dx, base) > 0.5) continue;
      g.px(x + dx, base + 1, '#0a120e');
    }
  }

  // ---------------------------------------------------------------------
  // a standing / sitting adult with idle life
  // ---------------------------------------------------------------------
  function drawAdult(g, t, sp, x, base, seed, o) {
    const id = idle(t, seed);
    const p = Object.assign({ look: id.look, blink: id.blink, ear: id.ear }, o || {});
    if (p.look === undefined) p.look = id.look;
    const s = adult(sp, p);
    const sit = !!p.sit;
    const top = base - (sit ? BY + 3 : AH - 1);
    const left = x - CX;
    if (!sit) shadow(g, x, base, sp.round ? 4 : 3);
    if (sp.tailSide !== 0 && !(o && o.noTail)) {
      const side = sp.tailSide || (seed % 2 ? 1 : -1);
      if (sit && sp.hair) plume(g, x + side * 3, base + 1, side, p.br || 0, sp.hairC || sp.fur, sp.sheenC || sp.fur);
      else tail(g, x + side * (sp.round ? 4 : 3), sit ? base + 1 : base - 3, side, id.sw, sp.fur);
    }
    blit(g, s, left, top);
    return { top, left, id, p };
  }
  /** cheer pose shared by everyone at a happy beat */
  function cheer(extra) {
    return Object.assign({ arms: 'up', mouth: 'laugh', eyes: 'happy', look: 0 }, extra || {});
  }

  // ---------------------------------------------------------------------
  // the niece
  // ---------------------------------------------------------------------
  function drawKit(g, t, o, x, base, p) {
    if (p.pose !== 'ride') {
      shadow(g, x, base, 2);
      // tiny tail
      const sw = T.wave(T.step(t, 8), 3.3, 0.4);
      g.px(x + 4, base - 2, KIT_C.F);
      g.px(x + 5, base - 3 + (sw > 0.3 ? -1 : 0), KIT_C.F);
    }
    blitKit(g, o, p, x, base);
  }
  function kitIdle(t, seed) {
    const id = idle(t, seed);
    return { blink: id.blink, look: id.look };
  }
  /** waving arm frame at 5 fps */
  function waveArm(t) {
    return Math.floor(T.step(t, 5) * 5) % 2 ? 'wave2' : 'wave';
  }

  // small yellow toy crane, 8x7, facing right: wheels, body, cab with a pale
  // window, a 5px diagonal boom; string + red hook drawn per frame
  const CRANE_ROWS = [
    // boom low / mid / high
    ['........', '........', '.....YYY', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
    ['........', '......YY', '.....Y..', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
    ['.......Y', '......Y.', '.....Y..', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
  ];
  const CRANE_TIP = [[7, 2], [7, 1], [7, 0]];
  const CRANE_C = { Y: nite('#ffd02a', 0.22), y: nite('#d89a10', 0.22), K: '#141218', g: nite('#d8e8f0', 0.22) };
  const craneArt = (b) => memo('crane' + b, () => bake(CRANE_ROWS[b].map((r) => r.split('')), CRANE_C, null));
  /** (x, base) = bottom centre of the wheels; boom 0..2; drop = string px */
  function drawCrane(g, x, base, boom, drop) {
    x = R(x);
    base = R(base);
    const s = craneArt(boom);
    const ox = x - 4;
    const oy = base - 7;
    blit(g, s, ox, oy);
    const [tx, ty] = CRANE_TIP[boom];
    const n = Math.max(1, Math.min(3 - ty, R(drop === undefined ? 3 : drop)));
    for (let i = 1; i <= n; i++) g.px(ox + tx, oy + ty + i, '#141218');
    g.px(ox + tx, oy + ty + n + 1, nite('#e04030', 0.22));
    g.px(ox + tx - 1, oy + ty + n + 1, nite('#e04030', 0.22));
  }
  // wrapped present 7x5: pink paper, gold ribbon and bow; lid = top 3 rows
  const BOX_ROWS = ['..R.R..', 'BBBRBBB', 'bbbRbbb', 'BBBRBBB', 'BBBRBBB'];
  const BOX_C = { B: nite('#f070b0', 0.22), b: nite('#c04888', 0.22), R: nite('#ffd040', 0.22) };
  const boxArt = (part) =>
    memo('box' + part, () => {
      const rows = part === 'lid' ? BOX_ROWS.slice(0, 3) : part === 'body' ? BOX_ROWS.slice(3) : BOX_ROWS;
      return bake(rows.map((r) => r.split('')), BOX_C, null);
    });
  /** (x, base) = bottom centre */
  function drawBox(g, x, base, part) {
    part = part || 'full';
    const h = part === 'lid' ? 3 : part === 'body' ? 2 : 5;
    blit(g, boxArt(part), R(x) - 3, R(base) - h + 1);
  }
  function sparkle(g, t, x, y) {
    const sp = Math.floor(T.step(t, 8) * 8) % 3;
    const e = g.em;
    e.px(x - 4 + sp, y, '#fff2b0');
    e.px(x + 4 - sp, y + 1, '#ffe08a');
    e.px(x, y - 2 + (sp % 2), '#ffffff');
  }

  // ---------------------------------------------------------------------
  // chapter scenes
  // ---------------------------------------------------------------------
  // NYC: you + partner on the anniversary bench
  const BENCH = SU.bench;
  const SEAT = BENCH.base - 6;
  const NYC_YOU = BENCH.x - 5;
  const NYC_PARTNER = BENCH.x + 6;
  const NYC_LEANS = [[57, 70], [177, 190], [118, 126], [222, 228]];
  /** 0 apart, 1 leaning in, 2 heads together (eases over 2 frames) */
  function nycLean(t) {
    const s = HD.summer.sec(T.step(t, 8));
    for (const [a, b] of NYC_LEANS) {
      if (s < a || s >= b) continue;
      const d = Math.min(s - a, b - s);
      return d < 0.25 ? 1 : 2;
    }
    return 0;
  }
  function drawNYC(g, t) {
    const lean = nycLean(t);
    const w = hairWind(t);
    const ys = you('nyc');
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(ys, { tailSide: -1 }), NYC_YOU, SEAT, 3, {
      sit: true,
      hx: lean === 2 ? 1 : 0,
      look: lean ? 1 : yi.look,
      mouth: lean === 2 ? 'laugh' : 'smile',
    });
    const pi = idle(t, 8);
    drawAdult(g, t, Object.assign(PARTNER, { tailSide: 1 }), NYC_PARTNER, SEAT, 8, {
      sit: true,
      hx: -lean,
      hy: lean === 2 ? 1 : 0,
      look: lean ? -1 : pi.look,
      eyes: lean === 2 ? 'happy' : undefined,
      br: w.br,
      gust: w.gust,
    });
    drawHeart(g, t);
  }
  function drawHeart(g, t) {
    const u = HD.summer.heart(t);
    if (u < 0) return;
    // starts where the two heads meet
    const x0 = NYC_YOU + 5;
    const y0 = SEAT - BY - 3 + HY0 + 2;
    const x = R(x0 + T.wave(t, 2, 0.3) * (u > 0.15 ? 1 : 0));
    const y = R(y0 - u * 22);
    const e = g.em;
    const c1 = '#ff5a7a';
    const c2 = '#ffb0c4';
    const c0 = '#c0304e';
    if (u < 0.12) {
      e.px(x, y, c1);
      e.px(x - 1, y - 1, c1);
      e.px(x + 1, y - 1, c1);
      return;
    }
    const rows = ['.a.a.', 'abaaa', 'aaaaa', '.aaa.', '..a..'];
    const fade = u > 0.75 ? (u - 0.75) / 0.25 : 0;
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < 5; c++) {
        const ch = rows[r][c];
        if (ch === '.') continue;
        if (fade > 0 && HD.bayer(c + x, r + y) < fade) continue;
        e.px(x - 2 + c, y - 2 + r, ch === 'b' ? c2 : r >= 3 ? c0 : c1);
      }
  }

  // LA: you, niece, sister, brother-in-law, gathered in the patio heater's glow
  const LA_X = SU.heater.x - 10; // you, just left of the heater
  const LA_A = LA_X - 18; // between her mum and you
  const LA_B = LA_X - 7; // three px from your feet
  function laKit(t) {
    const s = HD.summer.sec(t);
    const trips = [
      [50, 53, LA_A, LA_B],
      [110, 113, LA_B, LA_A],
      [170, 173, LA_A, LA_B],
      [224, 227, LA_B, LA_A],
    ];
    let x = LA_A;
    let walking = false;
    for (const [a, b, from, to] of trips) {
      if (s >= b) x = to;
      else if (s >= a) {
        x = from + ((to - from) * (s - a)) / (b - a);
        walking = true;
        break;
      } else break;
    }
    return { x: R(x), walking, nearYou: x > (LA_A + LA_B) / 2 };
  }
  function drawLA(g, t) {
    const k = laKit(t);
    drawAdult(g, t, Object.assign(BIL_LA, { tailSide: -1 }), LA_X - 42, 228, 5, {});
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), LA_X - 29, 230, 6, { br: R(HD.summer.breeze(t)), look: k.nearYou ? undefined : 1 });
    const ys = you('la');
    const yi = idle(t, 3);
    const ts = T.step(t, 8);
    const hop = !k.walking && k.nearYou && T.cycle(ts, 2, 13, 77).age * 13 < 1.5;
    drawAdult(g, t, Object.assign(ys, { tailSide: -1 }), LA_X, 231, 3, { look: k.nearYou ? -1 : yi.look, mouth: hop ? 'laugh' : 'smile' });
    const ki = kitIdle(t, 11);
    const wf = Math.floor(ts * 8) % 2;
    const kp = k.walking ? (wf ? 'walk' : 'stand') : 'stand';
    const bob = (k.walking && wf) || (hop && wf) ? -1 : 0;
    drawKit(g, t, KIT_OUT.la, k.x, 235 + bob, {
      pose: kp,
      arms: hop ? 'up' : 'down',
      blink: ki.blink,
      look: k.walking ? 0 : k.nearYou ? 1 : -1,
    });
  }
  // San Diego: you with the niece on your shoulders, sister, brother-in-law,
  // in the porch lantern's pool
  function drawSD(g, t) {
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), 150, 230, 6, { br: R(HD.summer.breeze(t)) });
    drawAdult(g, t, Object.assign(BIL, { tailSide: -1 }), 163, 228, 5, { look: 1 });
    const x = 180;
    const base = 232;
    const ys = you('sandiego');
    const yi = idle(t, 3);
    const me = drawAdult(g, t, Object.assign(ys, { tailSide: 1 }), x, base, 3, { arms: 'shoulder', wide: true, look: yi.look > 0 ? 1 : 0, mouth: 'smile' });
    // niece: waves now and then (2.5 s every ~9 s), sometimes both paws up
    const ts = T.step(t, 6);
    const wc = T.cycle(ts, 3, 9.2, 515);
    const wa = wc.age * wc.P;
    const both = wc.rnd(1) < 0.3;
    const waving = wa < 2.5;
    const ki = kitIdle(t, 12);
    const hy = me.top + HY0; // your ear-tip row
    // she sits on your crown between your ears: her seat row = your skull top
    const kb = hy + 2;
    // legs over your cheeks, sneakers in your paws at shoulder height
    const leg = KIT_C.F;
    for (const side of [-1, 1]) {
      g.px(x + side * 3, hy + 2, leg);
      g.px(x + side * 4, hy + 3, leg);
      g.px(x + side * 5, hy + 4, KIT_C.z);
    }
    blitKit(g, KIT_OUT.sandiego, {
      pose: 'ride',
      arms: waving ? (both ? 'up' : waveArm(t)) : 'down',
      blink: ki.blink,
      look: waving ? 1 : ki.look,
    }, x, kb);
  }

  // DC: the birthday. Sister, brother-in-law and dad stand behind the table
  // (z 33, the props table and cake cover their legs); you, the niece and her
  // crane are in front (z 47). Positions follow layout.summer.table and keep
  // the faces clear of the cake (x ~107..118 on the table top).
  const TB = SU.table;
  const BACK = TB.base - 7; // back-row feet, hidden behind the tablecloth
  const DCP = {
    sister: [TB.x - 21, BACK],
    bil: [TB.x - 11, BACK],
    dad: [TB.x + 10, BACK],
    you: [TB.x + 24, TB.base + 2],
    kit: [TB.x - 3, TB.base + 7],
    crane: [TB.x + 6, TB.base + 7],
    held: [TB.x + 18, BACK - 3], // in dad's arms, at his right side
  };
  function dcState(t) {
    const s = HD.summer.sec(t);
    const gift = HD.summer.gift(t);
    const out = HD.summer.candlesOut(t);
    const blow = HD.summer.blowing(t);
    // niece: held | lower | stand | gift | play | tuck | wantup | raise
    let kit = 'play';
    if (s < 34 || s >= 234) kit = 'held';
    else if (s < 36) kit = 'lower';
    else if (s < 40) kit = 'stand';
    else if (gift >= 0) kit = 'gift';
    else if (s >= 226 && s < 229) kit = 'tuck';
    else if (s >= 229 && s < 231) kit = 'wantup';
    else if (s >= 231 && s < 234) kit = 'raise';
    const pc = T.cycle(T.step(t, 8), 4, 7.3, 91);
    return { s, gift, out, blow, kit, cheer: out >= 0 && out < 0.55, play: pc.age * pc.P < 1.6 };
  }
  function dadPose(t, st) {
    const g0 = st.gift;
    let dp = { look: -1 };
    // leans toward the cake, head up over the candles
    if (st.blow >= 0) dp = { hx: -2, hy: -2, mouth: 'o', eyes: 'closed', look: -1 };
    else if (st.cheer) dp = cheer();
    else if (st.kit === 'held') dp = { arms: 'hold', look: 1, mouth: st.play ? 'laugh' : 'smile', eyes: st.play ? 'happy' : undefined };
    else if (st.kit === 'lower' || st.kit === 'raise') dp = { arms: 'offer', hy: 1, look: -1, mouth: 'smile' };
    else if (st.kit === 'gift') dp = g0 < 0.1 ? { hy: 2, look: -1 } : g0 < 0.4 ? { arms: 'offer', hy: 1, look: -1, mouth: 'smile' } : { look: -1, mouth: 'laugh', eyes: g0 > 0.7 ? 'happy' : undefined };
    else if (st.kit === 'tuck') dp = { arms: 'offer', hy: 1, look: -1, mouth: 'smile' };
    else if (st.out >= 0) dp = { look: -1, mouth: 'laugh', eyes: 'happy' };
    if (dp.eyes === undefined && dp.blink === undefined) dp.blink = idle(t, 9).blink;
    return dp;
  }
  function drawDCBack(g, t) {
    const st = dcState(t);
    const hb = (k) => (st.cheer ? hopAt(t, k) : 0);
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), DCP.sister[0], DCP.sister[1] - hb(1), 6, st.cheer ? cheer() : { br: R(HD.summer.breeze(t)), look: 1 });
    drawAdult(g, t, Object.assign(BIL, { tailSide: -1 }), DCP.bil[0], DCP.bil[1] - hb(3), 5, st.cheer ? cheer() : { look: st.out >= 0 ? 1 : undefined, mouth: st.out >= 0 ? 'laugh' : 'smile' });
    const [dx, db] = DCP.dad;
    drawAdult(g, t, Object.assign(DAD, { tailSide: 1 }), dx, db - hb(2), 9, dadPose(t, st));
    if (st.kit === 'held') {
      // in his arms at his right side; he bounces her and they laugh
      const ki = kitIdle(t, 12);
      const [hx, hb0] = DCP.held;
      const bob = st.play && Math.floor(T.step(t, 4) * 4) % 2 ? -1 : 0;
      blitKit(g, KIT_OUT.dc, { pose: 'held', arms: st.play ? 'up' : 'down', blink: !st.play && ki.blink, look: -1 }, hx, hb0 + bob);
      g.px(hx - 3, hb0 - 1 + bob, DAD.fur); // dad's paw under her
      g.px(hx - 2, hb0 - 1 + bob, DAD.fur);
    }
  }
  function drawDC(g, t) {
    const st = dcState(t);
    const g0 = st.gift;
    const [dx, db] = DCP.dad;
    const dadTop = db - (AH - 1);

    // his breath: pale dithered puffs from his mouth up to the candles
    if (st.blow >= 0) {
      const mx = dx - CX + HX0 - 2 - 1 + 4;
      const my = dadTop + HY0 - 2 + 6;
      for (let i = 0; i < 3; i++) {
        const u = (st.blow * 2.4 + i * 0.34) % 1;
        const px = R(mx - 2 - 5 * u);
        const py = R(my - 1 - 5 * u + Math.sin(u * 6 + i) * 0.6);
        const a = 1 - u * 0.85;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]])
          if (HD.bayer(px + ox, py + oy) < a * (ox || oy ? 0.6 : 1)) g.px(px + ox, py + oy, i === 1 ? '#d8ecff' : '#9cc0e4');
      }
    }

    // you, at the right end of the table
    const yhop = st.cheer ? hopAt(t, 0) : 0;
    drawAdult(g, t, Object.assign(you('dc'), { tailSide: 1 }), DCP.you[0], DCP.you[1] - yhop, 3, st.cheer ? cheer() : { look: -1, mouth: st.out >= 0 || st.play ? 'laugh' : 'smile' });

    // the niece
    const ki = kitIdle(t, 12);
    const o = KIT_OUT.dc;
    const [kx, kb] = DCP.kit;
    const cup = () => {
      g.px(kx - 5, kb - 1, KIT_C.Y);
      g.px(kx - 5, kb, nite('#f0e8d8'));
    };
    if (st.kit === 'held') return;
    if (st.kit === 'lower' || st.kit === 'raise') {
      // dad lifts her over the table front to the grass (and back up)
      const u = st.kit === 'lower' ? (st.s - 34) / 2 : 1 - (st.s - 231) / 3;
      const q = Math.min(1, Math.max(0, u));
      const [hx, hb0] = DCP.held;
      const x = R(hx + (kx - hx) * q);
      const b = R(hb0 + (kb - hb0) * q - Math.sin(q * Math.PI) * 3);
      blitKit(g, o, { pose: 'held', arms: 'up', look: -1 }, x, b);
      if (q < 0.6) g.px(x + 4, b - 3, DAD.fur);
      return;
    }
    if (st.kit === 'gift') {
      let pose = 'stand';
      let arms = 'down';
      if (g0 >= 0.4 && g0 < 0.6) pose = 'carry';
      else if (g0 >= 0.6 && g0 < 0.85) pose = 'lift';
      else if (g0 >= 0.85) arms = 'up';
      drawKit(g, t, o, kx, kb, { pose, arms, blink: pose === 'stand' && ki.blink, look: pose === 'stand' ? 1 : 0 });
      if (g0 >= 0.1 && g0 < 0.4) {
        // dad brings the box up from behind the table and holds it out to her
        const q = Math.min(1, (g0 - 0.1) / 0.24);
        const px = dx - CX + 1;
        const py = db - 5;
        drawBox(g, R(px + (kx + 4 - px) * q), R(py + (kb - 1 - py) * q - Math.sin(q * Math.PI) * 3));
      } else if (pose === 'carry') drawBox(g, kx, kb + 1);
      else if (pose === 'lift') {
        const top = kb - 9 - 4;
        if (g0 < 0.75) drawBox(g, kx, top - 1);
        else {
          // the lid pops off: box in her paws, lid flies up, sparkle
          drawBox(g, kx, top - 1, 'body');
          const up = 2 + Math.min(2, Math.floor((g0 - 0.75) / 0.03));
          drawBox(g, kx, top - 3 - up, 'lid');
          sparkle(g, t, kx, top - 8);
        }
      } else if (g0 >= 0.85) {
        drawCrane(g, DCP.crane[0], DCP.crane[1], 2, 2);
        if (g0 < 0.97) sparkle(g, t, DCP.crane[0] + 1, DCP.crane[1] - 9);
      }
      cup();
      return;
    }
    // on the grass by the cake
    let pose = 'sit';
    let arms = 'down';
    let look = 1;
    if (st.kit === 'stand') pose = 'stand';
    if (st.kit === 'wantup') {
      pose = 'stand';
      arms = 'up';
      look = 1;
    }
    if (st.cheer) {
      pose = 'stand';
      arms = 'up';
      look = 0;
    }
    if (st.kit === 'play' && !st.cheer) {
      // mostly watching her crane, now and then glancing about
      const n = T.noise(T.step(t, 8), 11, 1201);
      look = n < 0.25 ? -1 : n < 0.4 ? 0 : 1;
    }
    const hop = st.cheer ? hopAt(t, 1) : 0;
    drawKit(g, t, o, kx, kb - hop, { pose, arms, blink: ki.blink, look });
    cup();
    if (st.kit === 'play' || st.kit === 'tuck') {
      // she plays with it by the cake: the boom goes up and down, hook bobs
      const tc = T.step(t, 6);
      const boom = st.cheer ? 2 : [0, 1, 2, 2, 1, 0][Math.floor(tc / 0.8) % 6];
      const drop = 2.5 + T.wave(tc, 2.4, 0.2) * 1.5;
      let cx = DCP.crane[0];
      let cb = DCP.crane[1];
      if (st.kit === 'tuck') {
        // she hands it back to dad to wrap again (loop-safe)
        const q = Math.min(1, (st.s - 226) / 2.4);
        const px = dx - CX + 1;
        const py = db - 4;
        cx = R(DCP.crane[0] + (px - DCP.crane[0]) * q);
        cb = R(DCP.crane[1] + (py - DCP.crane[1]) * q - Math.sin(q * Math.PI) * 4);
      }
      if (!(st.kit === 'tuck' && st.s >= 228.4)) drawCrane(g, cx, cb, boom, drop);
    }
  }

  // ---------------------------------------------------------------------
  // Match Night: you (Spain-style jersey) + partner on the porch steps,
  // watching the TV in the ground-left window; cheering at the goal
  // ---------------------------------------------------------------------
  const DOOR = LAY.house.door;
  const STEPS = LAY.house.steps;
  const MATCH_SEAT = STEPS.y0 + 2;
  const MATCH_YOU = 212;
  const MATCH_PARTNER = 223;
  const MATCH_LEANS = [[56, 78], [188, 206]];
  function matchLean(t) {
    const s = HD.summer.sec(T.step(t, 8));
    for (const [a, b] of MATCH_LEANS) {
      if (s < a || s >= b) continue;
      return Math.min(s - a, b - s) < 0.25 ? 1 : 2;
    }
    return 0;
  }
  function drawMatch(g, t) {
    const goal = HD.summer.goal(t);
    const cheering = goal >= 0 && goal < 0.6;
    const lean = cheering ? 0 : matchLean(t);
    const w = hairWind(t);
    // the niece passes behind them when she is up by the door
    const k = homeKit(t);
    if (k && k.base < MATCH_SEAT + 2) drawNiece(g, t, k);
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(you('match'), { tailSide: -1 }), MATCH_YOU, MATCH_SEAT - (cheering ? hopAt(t, 0) : 0), 3,
      cheering ? cheer() : { sit: true, look: lean === 2 ? 0 : -1, hx: lean === 2 ? 1 : 0, blink: yi.blink, mouth: 'smile' });
    const pi = idle(t, 8);
    drawAdult(g, t, Object.assign(PARTNER, { tailSide: 1 }), MATCH_PARTNER, MATCH_SEAT - (cheering ? hopAt(t, 2) : 0), 8,
      cheering
        ? cheer({ br: w.br })
        : { sit: true, look: -1, hx: -lean, hy: lean === 2 ? 1 : 0, eyes: lean === 2 ? 'happy' : undefined, blink: pi.blink, br: w.br, gust: w.gust });
    if (k && k.base >= MATCH_SEAT + 2) drawNiece(g, t, k);
  }

  // ---------------------------------------------------------------------
  // home: partner in the window beside the series cat
  // ---------------------------------------------------------------------
  const CATWIN = LAY.house.windows.find((w) => w.cat);
  // 6 wide, column 0 stays glass (a 1px gap to the series cat) until she leans
  const WP = [
    // upright
    ['.K...K', '.KK.KK', '.KKKKK', '.KKKKK', '.KKKKJ', '..KKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKK'],
    // tipping in: head one px left
    ['K...K.', 'KK.KKJ', 'KKKKKJ', 'KKKKKJ', 'KKKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKK'],
    // resting her head on his: one px left and one down
    ['......', 'K...KJ', 'KK.KKJ', 'KKKKKJ', 'KKKKKJ', 'KKKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKK'],
  ];
  const WP_EYES = [[[2, 3], [4, 3]], [[1, 3], [3, 3]], [[1, 4], [3, 4]]];
  const WP_EYE = '#c8d870';
  const winPartner = (k) => memo('winp' + k, () => HD.sprite(WP[k], { K: P.violet[1], J: P.violet[3] }));
  const WIN_LEANS = [[30, 52], [168, 196]];
  function winLean(t) {
    const s = HD.summer.sec(T.step(t, 8));
    for (const [a, b] of WIN_LEANS) {
      if (s < a || s >= b) continue;
      return Math.min(s - a, b - s) < 0.5 ? 1 : 2;
    }
    return 0;
  }
  function drawWindow(g, t) {
    if (!CATWIN) return;
    const gx = CATWIN.x;
    const gy = CATWIN.y;
    const x = gx + CATWIN.w - 6;
    const bot = gy + CATWIN.h - 1;
    const k = winLean(t);
    const spr = winPartner(k);
    const y = bot - spr.height + 1;
    g.sprite(spr, x, y);
    // a strand of her long fur lifts in the breeze
    const br = HD.summer.breeze(t);
    if (br > 0.6) g.px(x + 5, y + 9 + (br > 0.85 ? 0 : 1), P.violet[3]);
    const id = idle(t, 21);
    const s = HD.summer.sec(t);
    if (!id.blink && !(k === 2 && s % 20 < 9)) for (const [ex, ey] of WP_EYES[k]) g.px(x + ex, y + ey, WP_EYE);
  }

  // ---------------------------------------------------------------------
  // the niece dropping by (match, home): out of the front door and back
  // ---------------------------------------------------------------------
  function homePath(ed) {
    const door = [DOOR.x + DOOR.w / 2, STEPS.y0];
    if (ed === 'match') {
      // around the pair on the steps: along the porch to the right edge, then to the lawn
      return [door, [STEPS.x1 + 1, STEPS.y0 + 1], [STEPS.x1 + 3, STEPS.y1 + 2], [SU.football.x + 8, SU.football.base + 1]];
    }
    const foot = [DOOR.x + DOOR.w / 2 - 1, STEPS.y1 + 2];
    return [door, foot, [STEPS.x0 - 8, STEPS.y1 + 9]];
  }
  function along(pts, u) {
    let total = 0;
    const seg = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      seg.push(l);
      total += l;
    }
    let d = u * total;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const k = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
      }
      d -= seg[i];
    }
    return pts[pts.length - 1];
  }
  function homeKit(t) {
    const v = HD.summer.niece(t);
    if (!v.here) return null;
    const pts = homePath(HD.edition.id);
    let u = 1;
    let walking = false;
    if (v.phase === 'in') {
      u = v.u;
      walking = true;
    } else if (v.phase === 'out') {
      u = 1 - v.u;
      walking = true;
    }
    const [x, y] = along(pts, u);
    return { x: R(x), base: R(y), walking, v, u };
  }
  /** the front door opens from its hinge side as she comes and goes */
  function drawDoor(g, k) {
    if (!k || !k.walking) return;
    const u = k.u;
    const w = u < 0.03 ? 1 : u < 0.06 ? 2 : u < 0.16 ? 3 : u < 0.19 ? 2 : u < 0.22 ? 1 : 0;
    if (!w) return;
    const x0 = DOOR.x + 1;
    const y0 = DOOR.y + 3;
    const y1 = DOOR.y + DOOR.h - 1;
    const e = g.em;
    for (let x = x0; x < x0 + w; x++)
      for (let y = y0; y <= y1; y++) {
        const f = (x - x0 + 1) / (w + 1) + (y - y0) / (y1 - y0) * 0.25;
        e.px(x, y, HD.bayer(x, y) < f ? P.amber[5] : P.amber[6]);
      }
    g.vline(x0 + w, y0, y1, P.wood[2]);
  }
  function drawNiece(g, t, k) {
    const ed = HD.edition.id;
    const o = KIT_OUT.blue;
    const ts = T.step(t, 8);
    const wf = Math.floor(ts * 8) % 2;
    const ki = kitIdle(t, 14);
    let pose = 'stand';
    let arms = 'down';
    let look = ki.look;
    let bob = 0;
    if (k.walking) {
      pose = wf ? 'walk' : 'stand';
      bob = wf ? -1 : 0;
      look = 0;
    } else if (ed === 'match') {
      const goal = HD.summer.goal(t);
      if (goal >= 0 && goal < 0.7) {
        arms = 'up';
        bob = hopAt(t, 3) ? -1 : 0;
        look = 0;
      } else {
        look = -1; // watching her ball
        const pc = T.cycle(ts, 5, 11, 61);
        if (pc.age * pc.P < 1.6) {
          arms = waveArm(t); // waving to you on the steps
          look = -1;
        }
      }
    } else {
      // home: reaching up at the fireflies now and then
      const pc = T.cycle(ts, 5, 8.5, 63);
      if (pc.age * pc.P < 1.5) {
        arms = 'up';
        look = 0;
      }
    }
    drawKit(g, t, o, k.x, k.base + bob, { pose, arms, blink: ki.blink, look });
  }

  HD.module('family', {
    passes: [
      {
        layer: 'scene',
        z: 29.7,
        id: 'window',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story || ed.id !== 'home') return;
          drawWindow(g, t);
        },
      },
      {
        // back row: behind the props birthday table
        layer: 'scene',
        z: 33,
        id: 'family-back',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story || ed.id !== 'dc') return;
          drawDCBack(g, t);
        },
      },
      {
        layer: 'scene',
        z: 47,
        id: 'family',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story) return;
          const id = ed.id;
          if (id === 'nyc') drawNYC(g, t);
          else if (id === 'la') drawLA(g, t);
          else if (id === 'sandiego') drawSD(g, t);
          else if (id === 'dc') drawDC(g, t);
          else if (id === 'match' || id === 'home') {
            const k = homeKit(t);
            drawDoor(g, k);
            if (id === 'match') drawMatch(g, t);
            else if (k) drawNiece(g, t, k);
          }
        },
      },
    ],
  });
})();
