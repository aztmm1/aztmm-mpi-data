/*
 * Summer Story family cats (see SUMMER.md). Owned by the family module.
 *
 * Every family member is a small upright cat built from ASCII parts (head,
 * features, hair, outfit, arms) and baked once per pose into a sprite pair
 * (albedo + emissive eye-shine/glints), then blitted per frame. Poses are
 * chosen from t only (pure, loop-safe), idle life runs at 8 fps.
 *
 * Draws NOTHING unless HD.edition.story is true.
 *
 *  home chapters (match, home): partner beside the series cat in the lit
 *    upper-right window (silhouette, z 29.7) and the niece visiting the yard
 *    (HD.summer.niece) at z 47.
 *  travel chapters (nyc, la, sandiego, dc): the family outdoors on
 *    layout.summer.stage / bench / table at z 47, with a small warm fill light
 *    that only tops up whatever light the other modules already cast there.
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
  // colour helpers: paint each outfit as its "night" colour so that under
  // ~FILL candle light it relights to the intended daytime colour
  // ---------------------------------------------------------------------
  const FILL = 0.5;
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
    if (rows.some((r) => [...r].some((c) => EMCH.includes(c) && emMap[c]))) em = HD.sprite(rows, emMap);
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
  // adult cat: 15x17 grid, head at (3..11, 3..9), body rows 10..16
  // stand anchor (7,16) = feet centre; sit anchor (7,13) = lap row
  // ---------------------------------------------------------------------
  const AW = 15;
  const AH = 17;
  const HEAD = ['.E.....E.', '.EI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const HEAD_FLICK = ['.......E.', 'EEI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const BODY = {
    stand: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hSSSSSh.', '..LLLLL..', '..LL.LL..', '..kk.kk..'],
    round: ['..SSSSS..', '.SSSSSSS.', 'SSSSSSSSS', 'hSSSSSSSh', '.LLLLLLL.', '..LL.LL..', '..kk.kk..'],
    sit: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hLLLLLh.', '..LL.LL..', '..kk.kk..'],
  };

  /**
   * sp: character spec (colours + traits), p: pose
   *  p.look -1|0|1, p.blink, p.ear, p.eyes 'open'|'happy'|'closed',
   *  p.mouth 'none'|'smile'|'laugh'|'o', p.arms 'down'|'up'|'shoulder'|
   *  'wave'|'wave2'|'offer'|'hold', p.sit, p.hx/p.hy head offset, p.br breeze px
   */
  function buildAdult(sp, p) {
    const G = grid(AW, AH);
    const HX = 3 + (p.hx || 0);
    const HY = 3 + (p.hy || 0);
    const BX = 3;
    const BY = 10;
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
    if (sp.neck === 'polo') {
      set(G, BX + 3, BY, 'C');
      set(G, BX + 5, BY, 'C');
      set(G, BX + 4, BY, 'h');
    }
    if (sp.neck === 'shirt') {
      set(G, BX + 3, BY, 'C');
      set(G, BX + 5, BY, 'C');
      set(G, BX + 4, BY, 'h');
      set(G, BX + 4, BY + 1, 'A');
      set(G, BX + 4, BY + 2, 'A');
    }
    if (sp.sleeveTip) {
      const w = sp.round ? 0 : 1;
      set(G, BX + w, BY + 2, 'C');
      set(G, BX + 8 - w, BY + 2, 'C');
    }
    // ---- arms ----
    const pawL = sp.round ? BX : BX + 1;
    const pawR = sp.round ? BX + 8 : BX + 7;
    const arms = p.arms || 'down';
    const raise = (side, top) => {
      // side -1 left, +1 right. shoulder sleeve, forearm, paw beside the head
      const sx = side < 0 ? pawL : pawR;
      for (let y = BY + 1; y <= BY + 3; y++) if ('Sh'.includes(get(G, sx, y)) || get(G, sx, y) === 'A' || get(G, sx, y) === 'C') set(G, sx, y, '.');
      const s0 = side < 0 ? BX + 1 : BX + 7;
      set(G, s0, BY, 'S');
      set(G, s0 + side, BY - 1, 'S');
      set(G, s0 + 2 * side, BY - 2, 'h');
      if (top >= 1) set(G, s0 + 2 * side, BY - 3, 'h');
      if (top >= 2) {
        set(G, s0 + 2 * side, BY - 3, '.');
        set(G, s0 + 3 * side, BY - 3, 'h');
        set(G, s0 + 3 * side, BY - 4, 'h');
      }
    };
    if (arms === 'up') {
      raise(-1, 1);
      raise(1, 1);
    } else if (arms === 'shoulder') {
      raise(-1, 0);
      raise(1, 0);
    } else if (arms === 'wave') raise(1, 1);
    else if (arms === 'wave2') raise(1, 2);
    else if (arms === 'offer') {
      for (let y = BY + 1; y <= BY + 3; y++) set(G, pawL, y, '.');
      set(G, pawL, BY + 1, 'S');
      set(G, pawL - 1, BY + 2, 'h');
      set(G, pawL - 2, BY + 2, 'h');
    } else if (arms === 'hold') {
      set(G, pawL, BY + 3, '.');
    }
    // ---- head ----
    stamp(G, p.ear ? HEAD_FLICK : HEAD, HX, HY);
    if (sp.temples) for (const [x, y] of [[0, 3], [8, 3], [1, 2], [7, 2], [0, 4], [8, 4]]) set(G, HX + x, HY + y, 'x');
    if (sp.tabby) for (const [x, y] of [[3, 2], [5, 2], [4, 3], [0, 3], [8, 3], [1, 5], [7, 5]]) set(G, HX + x, HY + y, 'O');
    if (sp.sheen) for (const [x, y] of [[2, 2], [3, 2]]) set(G, HX + x, HY + y, 'J');
    const L = HX + (p.look || 0);
    // muzzle
    if (sp.muzzle) {
      set(G, L + 3, HY + 5, sp.muzzle);
      set(G, L + 5, HY + 5, sp.muzzle);
      set(G, L + 4, HY + 6, sp.muzzle);
    }
    // eyes / glasses
    const eyes = p.blink ? 'closed' : p.eyes || 'open';
    if (sp.glasses && eyes !== 'happy') {
      const av = sp.glasses === 'aviator';
      for (const ox of [1, 5]) {
        for (let k = 0; k < 3; k++) {
          set(G, L + ox + k, HY + 3, 'g');
          set(G, L + ox + k, HY + 4, 'G');
        }
        if (av) set(G, L + ox + 1, HY + 5, 'G');
        set(G, L + ox, HY + 4, 'z');
      }
      set(G, L + 4, HY + 3, 'g');
      if (av) {
        set(G, L + 4, HY + 4, 'F');
      }
    } else if (eyes === 'happy') {
      for (const ox of [2, 6]) {
        set(G, L + ox - 1, HY + 4, 'q');
        set(G, L + ox, HY + 3, 'q');
        set(G, L + ox + 1, HY + 4, 'q');
      }
      if (sp.glasses) for (const ox of [1, 5]) for (let k = 0; k < 3; k++) set(G, L + ox + k, HY + 2, 'g');
    } else {
      for (const ox of [2, 6]) set(G, L + ox, HY + 4, eyes === 'closed' ? 'q' : 'e');
    }
    set(G, L + 4, HY + 5, 'n');
    const mouth = p.mouth || sp.mouth || 'smile';
    if (mouth === 'smile') set(G, L + 4, HY + 6, 'm');
    else if (mouth === 'laugh') {
      set(G, L + 3, HY + 6, 'm');
      set(G, L + 4, HY + 6, 'M');
      set(G, L + 5, HY + 6, 'm');
    } else if (mouth === 'o') {
      set(G, L + 4, HY + 6, 'm');
      set(G, HX - 1, HY + 5, 'F');
      set(G, HX + 9, HY + 5, 'F');
    }
    if (sp.whiskers) {
      set(G, HX - 1, HY + 5, 'w');
      set(G, HX + 9, HY + 5, 'w');
      set(G, HX - 1, HY + 4, 'w');
      set(G, HX + 9, HY + 4, 'w');
    }
    // ---- long hair (partner, sister) ----
    if (sp.hair) {
      const wavy = sp.hair === 'wavy';
      const bot = sit ? HY + 11 : HY + 11;
      for (let y = HY + 2; y <= bot; y++) {
        const k = y - HY;
        const drift = k >= 7 ? p.br || 0 : 0;
        const wv = wavy && k % 3 === 1 ? 1 : 0;
        // inner strands framing the face
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
      w: sp.whisker || '#8f939e',
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
    const key = sp.key + '|' + (p.look || 0) + (p.blink ? 'b' : '') + (p.ear ? 'e' : '') + (p.eyes || '') + '|' + (p.mouth || '') + '|' + (p.arms || '') + (p.sit ? 's' : '') + '|' + (p.hx || 0) + ',' + (p.hy || 0) + ',' + (p.br || 0);
    return memo(key, () => {
      const mp = sp._map || (sp._map = adultMap(sp));
      return bake(buildAdult(sp, p), mp.m, mp.em);
    });
  }

  // ---------------------------------------------------------------------
  // niece kitten: 11x10 grid, head (1..9, 0..5), anchor (5,9) = feet
  // ---------------------------------------------------------------------
  const NW = 11;
  const NH = 10;
  const KHEAD = ['..ppfpp..', '.EppkppE.', '.EFfffFE.', 'fFwWlwWFf', '.FWvnWvF.', '..clslc..'];
  const KHEAD_BLINK = ['..ppfpp..', '.EppkppE.', '.EFfffFE.', 'fFlllllFf', '.FqqnqqF.', '..clslc..'];
  /** p.pose: stand|walk|up|wave|wave2|sit|ride|held; p.blink; p.look; p.o outfit key */
  function buildKit(o, p) {
    const G = grid(NW, NH);
    const X = 1;
    const look = p.look || 0;
    const pose = p.pose || 'stand';
    // body first (head overlaps)
    const dress = o.dress;
    if (pose === 'sit') {
      stamp(G, dress ? ['...TTT...', '..TUTUT..', '..z...z..'] : ['...TTT...', '..TTTTT..', '..z...z..'], X, 6);
      set(G, X + 2, 6, 'h');
      set(G, X + 6, 6, 'h');
    } else if (pose === 'ride') {
      stamp(G, ['...TTT...', '..hTTTh..'], X, 6);
    } else {
      stamp(G, dress ? ['...TTT...', '..TUTUT..'] : ['...TTT...', '..TTTTT..'], X, 6);
      if (o.stripes) for (let x = 3; x <= 5; x++) set(G, X + x, 7, 'U');
      if (pose === 'walk') stamp(G, ['..z...z..'], X, 8);
      else if (pose === 'held') stamp(G, ['...z.z...'], X, 8);
      else stamp(G, ['...z.z...'], X, 8);
      if (pose === 'up') {
        set(G, X + 1, 5, 'h');
        set(G, X + 7, 5, 'h');
      } else if (pose === 'wave' || pose === 'wave2') {
        set(G, X + 2, 7, 'h');
        if (pose === 'wave') set(G, X + 7, 5, 'h');
        else set(G, X + 8, 4, 'h');
      } else {
        set(G, X + 2, 7, 'h');
        set(G, X + 6, 7, 'h');
      }
    }
    if (pose === 'ride' && p.wave) {
      set(G, X + 6, 7, 'T');
      if (p.wave === 1) set(G, X + 7, 5, 'h');
      else set(G, X + 8, 4, 'h');
    }
    if (pose === 'ride' && p.up) {
      set(G, X + 2, 7, 'T');
      set(G, X + 6, 7, 'T');
      set(G, X + 1, 5, 'h');
      set(G, X + 7, 5, 'h');
    }
    const head = p.blink ? KHEAD_BLINK : KHEAD;
    for (let y = 0; y < head.length; y++)
      for (let x = 0; x < head[y].length; x++) {
        const c = head[y][x];
        if (c === '.') continue;
        // features follow the look direction, the face shape does not
        const feat = 'wWnsqclv'.includes(c);
        if (feat) continue;
        set(G, X + x, y, c);
      }
    for (let y = 0; y < head.length; y++)
      for (let x = 0; x < head[y].length; x++) {
        const c = head[y][x];
        if (!'wWnsqclv'.includes(c)) continue;
        set(G, X + x + look, y, c);
      }
    if (pose === 'held' && o.cup) {
      set(G, X + 7, 6, 'Y');
      set(G, X + 7, 7, 'y');
      set(G, X + 6, 7, 'h');
    }
    return G;
  }
  const KIT_C = {
    F: nite('#6e4430'),
    E: nite('#6e4430'),
    f: nite('#946247'),
    l: nite('#d6a888'),
    v: '#2a2a4a',
    h: nite('#6e4430'),
    p: nite('#ff6aa8', 0.5),
    k: nite('#c83a7a', 0.5),
    W: '#0a070c',
    n: nite('#e08a96'),
    s: nite('#a03848'),
    c: nite('#f08a9a'),
    q: '#120c10',
    z: nite('#d83a3a'),
    Y: nite('#ffd23a'),
  };
  function kitMap(o) {
    const m = Object.assign({}, KIT_C, { T: o.top, U: o.alt || o.top });
    if (o.cup) m.y = nite('#f0e8d8');
    return { m, em: { w: '#ffffff' } };
  }
  function kit(o, p) {
    const key = 'kit|' + o.key + '|' + (p.pose || 'stand') + (p.blink ? 'b' : '') + (p.look || 0) + (p.wave || 0) + (p.up ? 'u' : '');
    return memo(key, () => {
      const mp = o._map || (o._map = kitMap(o));
      return bake(buildKit(o, p), mp.m, mp.em);
    });
  }

  // ---------------------------------------------------------------------
  // cast per chapter
  // ---------------------------------------------------------------------
  const BLACK = '#100d16';
  const KIT_OUT = {
    home: { key: 'pink', top: nite('#f07aa6') },
    la: { key: 'stripe', top: nite('#26346a'), alt: nite('#f2f2f4'), stripes: true },
    sandiego: { key: 'blue', top: nite('#3c66e0') },
    dc: { key: 'dress', top: nite('#8a2440'), alt: nite('#f2a0b8'), dress: true, cup: true },
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
      mouth: 'none',
      neck: 'tee',
    };
    if (ed === 'nyc') return Object.assign(base, { key: 'you-nyc', shirt: nite('#f07a68'), pants: nite('#d8ccb0'), glasses: 'wayfarer' });
    if (ed === 'la')
      return Object.assign(base, { key: 'you-la', shirt: nite('#b8343c'), shirtAlt: nite('#2a3460'), pattern: 'plaid', neck: 'shirt', collar: nite('#c84450'), pants: nite('#3a3a44'), glasses: 'wayfarer' });
    if (ed === 'sandiego') return Object.assign(base, { key: 'you-sd', shirt: nite('#f4f2ee'), pants: nite('#ecebe6'), glasses: 'wayfarer', shoes: nite('#e8e8ea') });
    return Object.assign(base, {
      key: 'you-dc',
      shirt: nite('#7aa6e8'),
      shirtAlt: nite('#a8c8f4'),
      collar: nite('#a8c8f4'),
      neck: 'shirt',
      pants: nite('#e8e0cc'),
      glasses: 'aviator',
      frame: '#8a8f9c',
      lens: nite('#3a7ae0', 0.3),
      glint: '#bfe6ff',
    });
  }
  const PARTNER = {
    key: 'partner',
    fur: '#1d1418',
    hair: 'long',
    hairC: '#120e15',
    sheen: true,
    sheenC: '#3a3550',
    sheenCol: true,
    light: '#2a1e24',
    eye: '#c8d870',
    nose: nite('#a05868'),
    mouth: 'smile',
    mouthC: '#3a1a22',
    shirt: nite('#f4f4f2'),
    neck: 'tee',
    pants: nite('#2a2a34'),
  };
  const SISTER = {
    key: 'sister',
    fur: '#21171a',
    hair: 'wavy',
    hairC: '#2a1a17',
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
    frame: nite('#f0c040', 0.4),
    lens: nite('#8a5a2a', 0.4),
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
    whisker: '#a0a4ae',
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
  // long plume tail hanging down (partner on the bench), drifts with breeze
  function plume(g, x, y, side, br, c, hi) {
    for (let i = 0; i < 7; i++) {
      const dx = side * (1 + Math.min(i, 3)) + R(br * Math.max(0, i - 2) * 0.5);
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
    const top = base - (sit ? 13 : 16);
    const left = x - 7;
    if (!sit) shadow(g, x, base, sp.round ? 4 : 3);
    if (sp.tailSide !== 0 && !(o && o.noTail)) {
      const side = sp.tailSide || (seed % 2 ? 1 : -1);
      if (sit && sp.hair) plume(g, x + side * 3, base + 1, side, p.br || 0, sp.fur, sp.sheenC || sp.fur);
      else tail(g, x + side * (sp.round ? 4 : 3), sit ? base + 1 : base - 3, side, id.sw, sp.fur);
    }
    blit(g, s, left, top);
    return { top, left, id };
  }

  // ---------------------------------------------------------------------
  // the niece
  // ---------------------------------------------------------------------
  function drawKit(g, t, o, x, base, p) {
    const s = kit(o, p);
    shadow(g, x, base, 2);
    // tiny tail
    const sw = T.wave(T.step(t, 8), 3.3, 0.4);
    g.px(x + 3, base - 2, KIT_C.F);
    g.px(x + 4, base - 3 + (sw > 0.3 ? -1 : 0), KIT_C.F);
    blit(g, s, x - 5, base - 9);
  }
  function kitIdle(t, seed) {
    const id = idle(t, seed);
    return { blink: id.blink, look: id.look };
  }

  // the small yellow toy crane: (x, base) = bottom centre; boom 0..2
  const CRANE_C = { Y: nite('#ffd02a'), y: nite('#d89a10'), K: '#141218', g: nite('#c8ccd4'), r: nite('#e04030') };
  function drawCrane(g, x, base, boom, hookY) {
    x = R(x);
    base = R(base);
    // wheels + chassis
    g.px(x - 2, base, CRANE_C.K);
    g.px(x + 1, base, CRANE_C.K);
    g.hline(x - 3, x + 2, base - 1, CRANE_C.y);
    g.hline(x - 2, x + 1, base - 2, CRANE_C.Y);
    g.px(x - 2, base - 3, CRANE_C.Y); // cab
    g.px(x - 3, base - 3, CRANE_C.g); // window
    // boom
    const b = [[0, -3], [1, -4], [2, -5], [3, -6]];
    const lift = boom === 0 ? 1 : boom === 2 ? -1 : 0;
    for (let i = 0; i < b.length; i++) g.px(x + b[i][0], base + b[i][1] + (i >= 2 ? lift * (i - 1) : 0), CRANE_C.Y);
    const tx = x + 3;
    const ty = base - 6 + lift * 2;
    const hy = Math.max(ty + 1, Math.min(base - 1, R(hookY === undefined ? ty + 2 : hookY)));
    g.vline(tx, ty + 1, hy, '#121016');
    g.px(tx, hy, CRANE_C.r);
  }
  // wrapped present: 4x3 box, pink paper, gold ribbon
  function drawBox(g, x, base) {
    x = R(x);
    base = R(base);
    g.rect(x - 2, base - 2, 4, 3, nite('#e86aa8'));
    g.vline(x, base - 2, base, nite('#ffd040', 0.5));
    g.px(x - 1, base - 3, nite('#ffd040', 0.5));
    g.px(x + 1, base - 3, nite('#ffd040', 0.5));
  }

  // ---------------------------------------------------------------------
  // chapter scenes
  // ---------------------------------------------------------------------
  const stage = SU.stage;
  // NYC: you + partner on the anniversary bench
  const BENCH = SU.bench;
  const SEAT = BENCH.base - 6;
  const NYC_YOU = BENCH.x - 7;
  const NYC_PARTNER = BENCH.x + 6;
  function nycLean(t) {
    // lean together around each heart, plus one quiet lean in between
    const s = HD.summer.sec(t);
    const near = (a, b) => s >= a && s < b;
    return near(57, 70) || near(177, 190) || near(118, 126) || near(222, 228);
  }
  function drawNYC(g, t) {
    const lean = nycLean(t);
    const br = R(HD.summer.breeze(t) * 1.2);
    const ys = you('nyc');
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(ys, { tailSide: -1 }), NYC_YOU, SEAT, 3, {
      sit: true,
      hx: lean ? 1 : 0,
      look: lean ? 1 : yi.look,
      mouth: lean ? 'smile' : 'none',
    });
    const pi = idle(t, 8);
    drawAdult(g, t, Object.assign(PARTNER, { tailSide: 1 }), NYC_PARTNER, SEAT, 8, {
      sit: true,
      hx: lean ? -1 : 0,
      hy: lean ? 1 : 0,
      look: lean ? -1 : pi.look,
      eyes: lean ? 'happy' : 'open',
      br,
    });
    drawHeart(g, t);
  }
  function drawHeart(g, t) {
    const u = HD.summer.heart(t);
    if (u < 0) return;
    const x = R((NYC_YOU + NYC_PARTNER) / 2 + 0.5 + T.wave(t, 2, 0.3) * (u > 0.15 ? 1 : 0));
    const y = R(SEAT - 15 - u * 22);
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

  // LA + San Diego: you, niece, sister, brother-in-law
  function laKit(t) {
    // the niece toddles between her mum (A) and you (B); loop-safe trips
    const A = 102;
    const B = 121;
    const s = HD.summer.sec(t);
    const trips = [
      [50, 54, A, B],
      [110, 114, B, A],
      [170, 174, A, B],
      [224, 228, B, A],
    ];
    let x = A;
    let walking = false;
    for (const [a, b, from, to] of trips) {
      if (s >= b) x = to;
      else if (s >= a) {
        x = from + ((to - from) * (s - a)) / (b - a);
        walking = true;
        break;
      } else break;
    }
    return { x: R(x), walking, nearYou: x > (A + B) / 2 };
  }
  function drawLA(g, t) {
    const k = laKit(t);
    drawAdult(g, t, Object.assign(BIL_LA, { tailSide: -1 }), 92, 228, 5, {});
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), 106, 230, 6, { br: R(HD.summer.breeze(t)), look: k.nearYou ? undefined : 1 });
    const ys = you('la');
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(ys, { tailSide: 1 }), 134, 231, 3, { look: k.nearYou ? -1 : yi.look, mouth: k.nearYou ? 'smile' : 'none' });
    const ki = kitIdle(t, 11);
    const ts = T.step(t, 8);
    const wf = Math.floor(ts * 8) % 2;
    const kp = k.walking ? (wf ? 'walk' : 'stand') : 'stand';
    const bob = k.walking && wf ? -1 : 0;
    const s = HD.summer.sec(t);
    const hop = !k.walking && k.nearYou && T.cycle(ts, 2, 13, 77).age * 13 < 1.5;
    drawKit(g, t, KIT_OUT.la, k.x, 235 + bob, {
      pose: hop ? 'up' : kp,
      blink: ki.blink,
      look: k.walking ? 0 : k.nearYou ? 1 : -1,
    });
    void s;
  }
  function drawSD(g, t) {
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), 94, 230, 6, { br: R(HD.summer.breeze(t)) });
    drawAdult(g, t, Object.assign(BIL, { tailSide: -1 }), 107, 228, 5, { look: 1 });
    // you + the niece on your shoulders
    const x = 133;
    const base = 232;
    const ys = you('sandiego');
    const yi = idle(t, 3);
    const top = base - 16;
    drawAdult(g, t, Object.assign(ys, { tailSide: 1 }), x, base, 3, { arms: 'shoulder', look: yi.look > 0 ? 1 : 0, mouth: 'smile' });
    // niece: waves now and then (2.5 s every ~9 s), sometimes both paws up
    const ts = T.step(t, 6);
    const wc = T.cycle(ts, 3, 9.2, 515);
    const wa = wc.age * wc.P;
    const both = wc.rnd(1) < 0.3;
    const waving = wa < 2.5;
    const wf = Math.floor(ts * 6) % 2;
    const ki = kitIdle(t, 12);
    const kx = x;
    const ky = top + 4 - 7;
    // legs straddle your head, sneakers held by your paws
    const leg = KIT_C.F;
    for (const side of [-1, 1]) {
      g.px(kx + side * 4, top + 4, KIT_OUT.sandiego.top);
      g.px(kx + side * 5, top + 5, leg);
      g.px(kx + side * 5, top + 6, leg);
      g.px(kx + side * 5, top + 7, KIT_C.z);
    }
    blit(g, kit(KIT_OUT.sandiego, {
      pose: 'ride',
      blink: ki.blink,
      look: waving ? 1 : ki.look,
      wave: waving && !both ? 1 + wf : 0,
      up: waving && both,
    }), kx - 5, ky);
    // your paws on her sneakers
    g.px(x - 5, top + 8, BLACK);
    g.px(x + 5, top + 8, BLACK);
  }

  // DC: the birthday. dad holds the niece, gives her the toy crane, blows
  // out the candles; everyone cheers.
  const TB = SU.table;
  const DCP = {
    bil: [75, 229],
    sister: [87, 233],
    dad: [139, 232],
    you: [156, 230],
    kit: [123, 236],
    crane: [116, 236],
    box: [130, 236],
  };
  function dcState(t) {
    const s = HD.summer.sec(t);
    const gift = HD.summer.gift(t);
    const out = HD.summer.candlesOut(t);
    const blow = HD.summer.blowing(t);
    // niece: held | lower | stand | gift | play | tuck | wantup | lift
    let kit = 'play';
    if (s < 34 || s >= 234) kit = 'held';
    else if (s < 36) kit = 'lower';
    else if (s < 40) kit = 'stand';
    else if (gift >= 0) kit = 'gift';
    else if (s >= 226 && s < 229) kit = 'tuck';
    else if (s >= 229 && s < 231) kit = 'wantup';
    else if (s >= 231 && s < 234) kit = 'lift';
    return { s, gift, out, blow, kit, cheer: out >= 0 && out < 0.55 };
  }
  function drawDC(g, t) {
    const st = dcState(t);
    const ts = T.step(t, 4);
    const hopF = Math.floor(ts * 4) % 2;
    const cheerPose = (seed) => (st.cheer ? { arms: 'up', mouth: 'laugh', eyes: 'happy', look: 0, hop: (hopF + seed) % 2 } : null);
    // gift box + crane on the ground (before they are picked up)
    const giftU = st.gift;
    const boxOnGround = st.kit === 'held' || st.kit === 'lower' || st.kit === 'stand' || (st.kit === 'gift' && giftU < 0.12) || st.kit === 'wantup' || st.kit === 'lift' || (st.kit === 'tuck' && st.s >= 228.4);
    if (boxOnGround) drawBox(g, DCP.box[0], DCP.box[1]);

    // back row
    const cb = cheerPose(0);
    drawAdult(g, t, Object.assign(BIL, { tailSide: -1 }), DCP.bil[0], DCP.bil[1] - (cb && cb.hop ? 1 : 0), 5, cb || { look: 1 });
    const cs = cheerPose(1);
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), DCP.sister[0], DCP.sister[1] - (cs && cs.hop ? 1 : 0), 6, cs || { br: R(HD.summer.breeze(t)), look: 1 });
    const cy = cheerPose(1);
    const ys = you('dc');
    drawAdult(g, t, Object.assign(ys, { tailSide: 1 }), DCP.you[0], DCP.you[1] - (cy && cy.hop ? 1 : 0), 3, cy || { look: -1, mouth: st.out >= 0 ? 'smile' : 'none' });

    // dad
    const [dx, db] = DCP.dad;
    const di = idle(t, 9);
    let dp = { look: -1 };
    if (st.blow >= 0) dp = { hx: -2, hy: 1, mouth: 'o', eyes: 'closed', look: -1 };
    else if (st.cheer) dp = { arms: 'up', mouth: 'laugh', eyes: 'happy', look: 0 };
    else if (st.kit === 'held') {
      // he bounces her and laughs now and then
      const pc = T.cycle(T.step(t, 8), 4, 7.3, 91);
      const pa = pc.age * pc.P;
      const play = pa < 1.6;
      dp = { arms: 'hold', look: -1, mouth: play ? 'laugh' : 'smile', eyes: play ? 'happy' : 'open' };
    } else if (st.kit === 'lower' || st.kit === 'lift') dp = { arms: 'offer', hy: 1, look: -1, mouth: 'smile' };
    else if (st.kit === 'gift') dp = giftU < 0.75 ? { arms: 'offer', hy: giftU < 0.3 ? 1 : 0, look: -1, mouth: 'smile' } : { look: -1, mouth: 'laugh', eyes: 'happy' };
    else if (st.out >= 0) dp = { look: -1, mouth: 'laugh', eyes: 'happy' };
    if (dp.eyes === undefined && dp.blink === undefined) dp.blink = di.blink;
    const dhop = st.cheer && hopF ? 1 : 0;
    const dad = drawAdult(g, t, Object.assign(DAD, { tailSide: 1 }), dx, db - dhop, 9, dp);

    // blowing puffs drift from his mouth to the candles
    if (st.blow >= 0) {
      const mx = dx - 7 + 3 - 2 + 4;
      const my = dad.top + 3 + 1 + 6;
      const tx = TB.x;
      const ty = TB.base - 10;
      for (let i = 0; i < 3; i++) {
        const u = (st.blow * 2.2 + i * 0.33) % 1;
        const px = R(mx - 2 + (tx - mx + 2) * u);
        const py = R(my + (ty - my) * u + Math.sin(u * 6 + i) * 0.8);
        g.em.px(px, py, i === 1 ? '#d8e4f4' : '#a8b8d0');
      }
    }

    // the niece
    const ki = kitIdle(t, 12);
    const o = KIT_OUT.dc;
    const heldX = dx - 8;
    const heldB = db - 2;
    if (st.kit === 'held') {
      const pc = T.cycle(T.step(t, 8), 4, 7.3, 91);
      const play = pc.age * pc.P < 1.6;
      const bob = play && Math.floor(T.step(t, 4) * 4) % 2 ? -1 : 0;
      blit(g, kit(o, { pose: play ? 'up' : 'held', blink: !play && ki.blink, look: 1 }), heldX - 5, heldB - 9 + bob - dhop);
      g.px(heldX + 2, heldB - 1 + bob - dhop, DAD.fur); // dad's paw under her
      g.px(heldX + 3, heldB - 1 + bob - dhop, DAD.fur);
    } else if (st.kit === 'lower' || st.kit === 'lift') {
      const u = st.kit === 'lower' ? (st.s - 34) / 2 : 1 - (st.s - 231) / 3;
      const q = Math.min(1, Math.max(0, u));
      const kx = R(heldX + (DCP.kit[0] - heldX) * q);
      const kb = R(heldB + (DCP.kit[1] - heldB) * q);
      blit(g, kit(o, { pose: 'up', look: 1 }), kx - 5, kb - 9);
      if (q < 0.95) g.px(kx + 3, kb - 4, DAD.fur);
    } else {
      // on the ground by the cake
      let pose = 'sit';
      let look = ki.look;
      if (st.kit === 'stand') pose = 'stand';
      if (st.kit === 'gift') pose = giftU < 0.55 ? 'stand' : 'up';
      if (st.kit === 'wantup') pose = 'up';
      if (st.cheer) pose = 'up';
      if (st.kit === 'stand' || (st.kit === 'gift' && giftU < 0.6)) look = 1;
      const [kx, kb] = DCP.kit;
      if (pose === 'sit') shadow(g, kx, kb, 2);
      drawKit(g, t, o, kx, kb, { pose, blink: ki.blink, look });
      // sippy cup on the ground beside her while she plays
      if (st.kit !== 'held') {
        g.px(kx + 4, kb - 1, KIT_C.Y);
        g.px(kx + 4, kb, nite('#f0e8d8'));
      }
    }

    // the gift moment and the crane
    if (st.kit === 'gift') {
      const u = giftU;
      if (u >= 0.12 && u < 0.62) {
        // dad lifts the box and holds it out
        const q = Math.min(1, (u - 0.12) / 0.2);
        const bx = R(DCP.box[0] + (dx - 9 - DCP.box[0]) * q);
        const by = R(DCP.box[1] + (db - 4 - DCP.box[1]) * q);
        drawBox(g, bx, by);
      } else if (u >= 0.62 && u < 0.8) {
        drawBox(g, DCP.kit[0] + 1, DCP.kit[1] - 10);
      } else if (u >= 0.8) {
        // unwrapped: sparkle, she holds the crane up
        drawCrane(g, DCP.kit[0] + 1, DCP.kit[1] - 9, 2);
        const sp = Math.floor(T.step(t, 8) * 8) % 3;
        const e = g.em;
        const cx = DCP.kit[0] + 1;
        const cy = DCP.kit[1] - 16;
        if (u < 0.95) {
          e.px(cx - 4 + sp, cy, '#fff2b0');
          e.px(cx + 4 - sp, cy + 1, '#ffe08a');
          e.px(cx, cy - 2 + (sp % 2), '#ffffff');
        }
      }
    } else if (st.kit === 'play' || st.kit === 'tuck') {
      // she plays with it by the cake: the boom goes up and down, hook bobs
      const tc = T.step(t, 6);
      const boom = st.cheer ? 1 : [0, 1, 2, 2, 1, 0][Math.floor(tc / 0.8) % 6];
      const hook = DCP.crane[1] - 4 + T.wave(tc, 2.4, 0.2) * 1.5;
      let cx = DCP.crane[0];
      let cbase = DCP.crane[1];
      if (st.s < 47) {
        // just opened: from her paws to the ground beside her
        const q = st.s - 46;
        cx = R(DCP.kit[0] + 1 + (DCP.crane[0] - DCP.kit[0] - 1) * q);
        cbase = R(DCP.kit[1] - 9 + 9 * q);
      }
      if (st.kit === 'tuck') {
        const q = Math.min(1, (st.s - 226) / 2.4);
        cx = R(DCP.crane[0] + (DCP.box[0] - DCP.crane[0]) * q);
        cbase = R(DCP.crane[1] - Math.sin(q * Math.PI) * 4);
      }
      if (!(st.kit === 'tuck' && st.s >= 228.4)) drawCrane(g, cx, cbase, boom, hook);
    }
  }

  // ---------------------------------------------------------------------
  // home chapters: partner in the window + the niece visiting
  // ---------------------------------------------------------------------
  const CATWIN = LAY.house.windows.find((w) => w.cat);
  const SIL = P.violet[0];
  const SIL_EYE = HD.color.mix(P.amber[7], P.spirit[3], 0.45);
  // partner silhouette, 8 wide: long fur falling past her shoulders
  const WIN_PARTNER = [
    '.K...K..',
    '.KK.KK..',
    'KKKKKKK.',
    'KKKKKKKH',
    'KKKKKKKH',
    'HKKKKKKH',
    'HKKKKKHH',
    'HKKKKKKH',
    'HKKKKKKH',
    'KKKKKKKK',
    'KKKKKKKK',
  ];
  const winPartner = (lean) =>
    memo('winp' + lean, () =>
      HD.sprite(
        lean ? WIN_PARTNER.map((r, i) => (i < 5 ? r : r)) : WIN_PARTNER,
        { K: SIL, H: SIL },
      ),
    );
  function drawWindow(g, t) {
    if (!CATWIN) return;
    const gx = CATWIN.x;
    const gy = CATWIN.y;
    const x = gx + CATWIN.w - 8; // right side of the glass, beside the cat
    const bot = gy + CATWIN.h - 1;
    const s = HD.summer.sec(t);
    const ts = T.step(t, 8);
    // she leans her head against him for a while, twice a loop
    const lean = (s > 30 && s < 52) || (s > 168 && s < 196);
    const hx = lean ? -1 : 0;
    const hy = lean ? 1 : 0;
    const spr = winPartner(0);
    // body
    g.sprite(spr, x, bot - spr.height + 1);
    // re-draw the head offset when leaning (head rows 0..4)
    if (lean) {
      g.rect(x, bot - spr.height + 1, 8, 2, SIL);
      g.blit(spr, 0, 0, 8, 5, x + hx, bot - spr.height + 1 + hy);
    }
    // hair drifts a touch
    const br = HD.summer.breeze(t);
    if (br > 0.45) g.px(Math.min(gx + CATWIN.w - 1, x + 8), bot - 3, SIL);
    // eyes + blink
    const id = idle(t, 21);
    const eyY = bot - spr.height + 1 + 3 + hy;
    if (!id.blink && !(lean && s % 20 < 9)) {
      g.px(x + 1 + hx, eyY, SIL_EYE);
      g.px(x + 5 + hx, eyY, SIL_EYE);
    }
    // goal cheer (Match Night): paws up in the window
    const goal = HD.edition.id === 'match' ? HD.summer.goal(t) : -1;
    if (goal >= 0 && goal < 0.7) {
      const up = Math.floor(ts * 4) % 2;
      const ty = bot - spr.height - 1 - up;
      g.px(x - 1, ty, SIL);
      g.px(x - 1, ty + 1, SIL);
      g.px(Math.min(gx + CATWIN.w - 1, x + 7), ty, SIL);
      g.px(Math.min(gx + CATWIN.w - 1, x + 7), ty + 1, SIL);
    }
  }

  // niece path for home chapters: out of the front door, down the steps, to her spot
  const DOOR = LAY.house.door;
  const STEPS = LAY.house.steps;
  function homePath(ed) {
    const door = [DOOR.x + DOOR.w / 2, STEPS.y0];
    const foot = [DOOR.x + DOOR.w / 2 - 1, STEPS.y1 + 2];
    const spot = ed === 'match' ? [SU.football.x - 10, SU.football.base] : [STEPS.x0 - 8, STEPS.y1 + 9];
    return [door, foot, spot];
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
  function drawHomeYard(g, t) {
    const k = homeKit(t);
    if (!k) return;
    const ed = HD.edition.id;
    const o = KIT_OUT.home;
    const ts = T.step(t, 8);
    const wf = Math.floor(ts * 8) % 2;
    // the front door opens a crack as she comes out / goes back in
    const atDoor = k.walking && k.u < 0.22;
    if (atDoor) {
      const e = g.em;
      const dx = DOOR.x + DOOR.w / 2 - 3;
      e.rect(dx, DOOR.y + 9, 6, DOOR.h - 9, P.amber[6]);
      e.rect(dx + 1, DOOR.y + 11, 4, DOOR.h - 12, P.amber[7]);
      g.vline(dx + 6, DOOR.y + 9, DOOR.y + DOOR.h - 1, P.wood[2]);
    }
    const ki = kitIdle(t, 14);
    let pose = 'stand';
    let look = ki.look;
    let bob = 0;
    if (k.walking) {
      pose = wf ? 'walk' : 'stand';
      bob = wf ? -1 : 0;
      look = 0;
    } else if (ed === 'match') {
      const goal = HD.summer.goal(t);
      if (goal >= 0) {
        pose = 'up';
        bob = Math.floor(T.step(t, 4) * 4) % 2 ? -1 : 0;
        look = 0;
      } else {
        look = 1; // watching her ball
        const pc = T.cycle(ts, 5, 11, 61);
        if (pc.age * pc.P < 1.2) pose = Math.floor(ts * 4) % 2 ? 'wave' : 'wave2';
      }
    } else {
      // home: reaching up at the fireflies now and then
      const pc = T.cycle(ts, 5, 8.5, 63);
      if (pc.age * pc.P < 1.5) {
        pose = 'up';
        look = 0;
      }
    }
    drawKit(g, t, o, k.x, k.base + bob, { pose, blink: ki.blink, look });
  }

  // ---------------------------------------------------------------------
  // lights: top up the light on each family member to ~FILL (adds only the
  // deficit after every other module's lights, so it never over-brightens)
  // ---------------------------------------------------------------------
  const LUMK = 0.4 * LC[0] + 0.45 * LC[1] + 0.15 * LC[2];
  function lightAt(list, x, y) {
    let s = 0;
    for (const l of list) {
      const rx = Math.max(1, l.r);
      const ry = Math.max(1, l.ry || l.r);
      const dx = (x - l.x) / (rx + 0.5);
      const dy = (y - l.y) / (ry + 0.5);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const cl = l.clip;
      if (cl && (x < cl.x0 || x > cl.x1 || y < cl.y0 || y > cl.y1)) continue;
      const c = l.color || [1, 0.6, 0.3];
      s += (l.i * Math.pow(1 - d, l.pow || 1.6) * (0.4 * c[0] + 0.45 * c[1] + 0.15 * c[2])) / LUMK;
    }
    return s;
  }
  function spots(t) {
    const id = HD.edition.id;
    if (id === 'nyc') return [[NYC_YOU, SEAT - 4], [NYC_PARTNER, SEAT - 4]];
    if (id === 'la') return [[92, 220], [106, 222], [134, 223], [laKit(t).x, 230]];
    if (id === 'sandiego') return [[94, 222], [107, 220], [133, 218]];
    if (id === 'dc') return [[DCP.bil[0], 221], [DCP.sister[0], 225], [DCP.dad[0] - 3, 224], [DCP.you[0], 222], [DCP.kit[0], 231]];
    const k = homeKit(t);
    return k ? [[k.x, k.base - 4]] : [];
  }
  const FILL_COL = [1.0, 0.7, 0.42];

  HD.module('family', {
    lights(t, L) {
      if (!HD.edition.story) return;
      const list = L.list;
      const home = HD.edition.id === 'match' || HD.edition.id === 'home';
      for (const [x, y] of spots(t)) {
        const have = lightAt(list, x, y);
        const need = (home ? 0.4 : FILL) - have;
        if (need <= 0.02) continue;
        L.add({ x, y: y + 1, r: 11, ry: 12, color: FILL_COL, i: Math.min(0.5, need), bands: 3, pow: 0.8 });
      }
    },
    passes: [
      {
        layer: 'scene',
        z: 29.7,
        id: 'window',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story || !(ed.id === 'match' || ed.id === 'home')) return;
          drawWindow(g, t);
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
          else if (id === 'match' || id === 'home') drawHomeYard(g, t);
        },
      },
    ],
  });
  void stage;
})();
