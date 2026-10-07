/*
 * Editions — the Rainy Hollow series. Same cottage, same black cat in the
 * upper-right window, eight nights across the year.
 *
 * Every module reads HD.edition at DRAW time (never only at init), so the page
 * can switch editions live. Cache edition-specific art with HD.perEdition().
 *
 * Pick an edition with ?edition=<id> or #<id>. In the live page with neither,
 * the edition whose dates contain today is chosen (HD.todayMD, set by the page);
 * tools/export default to 'halloween'.
 */
(function () {
  'use strict';
  const HD = (window.HD = window.HD || {});

  // Field reference (what each module switches on):
  //  sky      'overcast' | 'broken' | 'clear'        (bg)
  //  stars    0..1 density of visible stars           (bg)
  //  moon     'full' | 'harvest' | 'crescent' | 'none'(bg)
  //  weather  { rain, snow, leaves, petals, fireflies }  intensities 0..1 (weather)
  //  ground   'wet-autumn' | 'leafy' | 'dry-autumn' | 'snow' | 'thin-snow' | 'spring' | 'summer' (ground)
  //  tree     'bare' | 'autumn' | 'blossom' | 'plum' | 'summer' | 'snowy'  (props)
  //  fire     'campfire' | 'bonfire' | 'none'         (fire)
  //  fireworks 0..1 how busy the sky is               (fire module owns fireworks)
  //  tags     decorations / yard sets, see SEASONS.md for who draws each
  const EDITIONS = [
    {
      id: 'lunar',
      name: 'Red Lanterns',
      festival: 'Lunar New Year',
      season: 'winter',
      when: 'late January - February',
      dates: [[1, 20], [2, 29]],
      blurb: 'Red lanterns glow in the plum tree while distant fireworks welcome the new year.',
      sky: 'clear',
      stars: 0.8,
      moon: 'none',
      weather: { rain: 0, snow: 0.3, leaves: 0, petals: 0.12, fireflies: 0 },
      ground: 'thin-snow',
      tree: 'plum',
      fire: 'none',
      fireworks: 0.45,
      fireworkColors: ['red', 'gold', 'gold', 'white'],
      tags: ['roof-snow-light', 'red-lanterns', 'red-banners', 'firecrackers', 'tree-red-lanterns', 'garden', 'tangerines', 'paper-cuts', 'secret-hibernating-frog'],
    },
    {
      id: 'spring',
      name: 'Blossom Rain',
      festival: 'Easter',
      season: 'spring',
      when: 'March - April',
      dates: [[3, 1], [4, 30]],
      blurb: 'A soft spring rain shakes petals from the cherry tree onto hidden painted eggs.',
      sky: 'broken',
      stars: 0.2,
      moon: 'crescent',
      weather: { rain: 0.55, snow: 0, leaves: 0, petals: 0.8, fireflies: 0 },
      ground: 'spring',
      tree: 'blossom',
      fire: 'none',
      fireworks: 0,
      tags: ['window-boxes', 'flower-wreath', 'seedlings', 'eggs', 'flower-beds', 'garden', 'birdhouse', 'frog', 'secret-rabbit-burrow'],
    },
    {
      id: 'summer',
      name: 'Firefly Midsummer',
      festival: 'Midsummer',
      season: 'summer',
      when: 'June - August',
      dates: [[5, 1], [8, 31]],
      blurb: 'The shortest night: a midsummer bonfire, paper lanterns and a meadow full of fireflies.',
      sky: 'clear',
      stars: 1,
      moon: 'full',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 1 },
      ground: 'summer',
      tree: 'summer',
      fire: 'bonfire',
      fireworks: 0,
      tags: ['window-boxes', 'flower-garland', 'open-windows', 'paper-lantern-string', 'flower-beds', 'hammock', 'garden', 'lily-pond', 'secret-ant-colony'],
    },
    {
      id: 'harvest',
      name: 'Harvest Moon',
      festival: 'Harvest & Mid-Autumn',
      season: 'autumn',
      when: 'September',
      dates: [[9, 1], [9, 30]],
      blurb: 'A huge golden moon over hay bales, lanterns and leaves tumbling on the breeze.',
      sky: 'broken',
      stars: 0.5,
      moon: 'harvest',
      weather: { rain: 0, snow: 0, leaves: 0.8, petals: 0, fireflies: 0 },
      ground: 'leafy',
      tree: 'autumn',
      fire: 'campfire',
      fireworks: 0,
      tags: ['harvest-lanterns', 'paper-lantern-string', 'corn-bundles', 'leaf-wreath', 'pie-sill', 'hay-bales', 'scarecrow', 'pumpkin-patch', 'harvest-pumpkins', 'crows', 'secret-squirrel-stash'],
    },
    {
      id: 'halloween',
      name: 'Rainy Hollow',
      festival: 'Halloween',
      season: 'autumn',
      when: 'October',
      dates: [[10, 1], [10, 31]],
      blurb: 'A cold rainy night, a crackling campfire and jack-o\'-lanterns flickering by the porch.',
      sky: 'overcast',
      stars: 0,
      moon: 'full',
      weather: { rain: 1, snow: 0, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'wet-autumn',
      tree: 'bare',
      fire: 'campfire',
      fireworks: 0,
      tags: ['graveyard', 'jackolanterns', 'pumpkin-patch', 'crows', 'bats', 'lightning', 'secret-coffin'],
    },
    {
      id: 'lights',
      name: 'Festival of Lights',
      festival: 'Diwali',
      season: 'autumn',
      when: 'October - November',
      dates: [[11, 1], [11, 20]],
      blurb: 'Rows of little clay lamps, marigold garlands, a rangoli by the door and fireworks far away.',
      sky: 'clear',
      stars: 0.9,
      moon: 'none',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'dry-autumn',
      tree: 'autumn',
      fire: 'none',
      fireworks: 0.6,
      fireworkColors: ['gold', 'magenta', 'green', 'gold', 'blue', 'white'],
      tags: ['diyas-house', 'diyas-yard', 'marigolds', 'string-lights-gold', 'tree-fairy-lights', 'rangoli', 'garden', 'secret-clay-pot'],
    },
    {
      id: 'winter',
      name: 'Snowed In',
      festival: 'Christmas & Hanukkah',
      season: 'winter',
      when: 'December',
      dates: [[11, 21], [12, 30]],
      blurb: 'Deep snow, icicles and twinkling lights, with a menorah and a decorated tree in the windows.',
      sky: 'overcast',
      stars: 0,
      moon: 'none',
      weather: { rain: 0, snow: 1, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'snow',
      tree: 'snowy',
      fire: 'none',
      fireworks: 0,
      tags: ['roof-snow', 'icicles', 'wreath', 'string-lights-color', 'xmas-tree', 'menorah', 'snowman', 'sled', 'garden', 'frozen-puddles', 'secret-hedgehog'],
    },
    {
      id: 'newyear',
      name: 'Midnight Fireworks',
      festival: "New Year's Eve",
      season: 'winter',
      when: 'December 31',
      dates: [[12, 31], [1, 19]],
      blurb: 'Fireworks burst over the snowy hills while sparklers fizz and the fire pit keeps everyone warm.',
      sky: 'clear',
      stars: 0.7,
      moon: 'crescent',
      weather: { rain: 0, snow: 0.25, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'thin-snow',
      tree: 'snowy',
      fire: 'campfire',
      fireworks: 1,
      fireworkColors: ['gold', 'white', 'red', 'blue', 'violet', 'green', 'gold'],
      tags: ['roof-snow-light', 'string-lights-gold', 'tree-fairy-lights', 'party-windows', 'bunting', 'snowman', 'sparklers', 'garden', 'frozen-puddles', 'secret-time-capsule'],
    },
  ];
  for (const e of EDITIONS) e.tagSet = new Set(e.tags);
  HD.EDITIONS = EDITIONS;
  const byId = new Map(EDITIONS.map((e) => [e.id, e]));
  HD.editionById = (id) => byId.get(id);

  function inRange(md, range) {
    const v = md[0] * 100 + md[1];
    const a = range[0][0] * 100 + range[0][1];
    const b = range[1][0] * 100 + range[1][1];
    return a <= b ? v >= a && v <= b : v >= a || v <= b; // ranges may wrap the new year
  }

  function initialId() {
    const p = new URLSearchParams(location.search);
    const q = p.get('edition');
    if (q && byId.has(q)) return q;
    const h = (location.hash || '').replace('#', '');
    if (h && byId.has(h)) return h;
    const exportMode = p.has('export') && p.get('export') !== '0';
    if (!exportMode && HD.todayMD) {
      const hit = EDITIONS.find((e) => inRange(HD.todayMD, e.dates));
      if (hit) return hit.id;
    }
    return 'halloween';
  }

  HD.edition = byId.get(initialId());
  /** true if the current edition carries decoration/yard tag `t` */
  HD.tag = (t) => HD.edition.tagSet.has(t);

  const listeners = [];
  /** subscribe to edition changes (UI only; drawing just reads HD.edition) */
  HD.onEdition = (fn) => listeners.push(fn);
  /** switch edition live */
  HD.setEdition = function (id) {
    const e = byId.get(id);
    if (!e || e === HD.edition) return;
    HD.edition = e;
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  };

  /**
   * Lazily build and cache something per edition:
   *   const art = HD.perEdition((ed) => HD.bake(...));   ...   g.sprite(art(), x, y)
   */
  HD.perEdition = function (build) {
    const cache = new Map();
    return function () {
      const e = HD.edition;
      let v = cache.get(e.id);
      if (v === undefined) {
        v = build(e);
        cache.set(e.id, v);
      }
      return v;
    };
  };
})();
