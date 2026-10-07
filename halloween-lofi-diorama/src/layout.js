/*
 * Shared layout — the anchors every module agrees on (480x270 pixel space,
 * y grows downward). Modules draw their own detail around these anchors but
 * must keep the anchors themselves where they are, because other modules
 * (lights, rain splashes, drips, smoke, reflections) depend on them.
 *
 *   y   0 ............ sky / clouds / moon
 *   y 150 - 205 ...... distant hills, forest, far church (unlit backdrop)
 *   y 200 - 238 ...... ground top face (seen slightly from above; back -> front)
 *   y 238 - 270 ...... diorama cross-section: soil strata, roots, coffin, bones
 */
(function () {
  'use strict';
  const HD = (window.HD = window.HD || {});

  HD.layout = {
    // ---- global ----------------------------------------------------------
    ground: {
      back: 200, // far edge of the walkable ground (meets hills/mist)
      houseBase: 206, // y where the house walls meet the ground
      front: 238, // front lip of the diorama; soil cross-section below
      bottom: 270,
    },
    // keep this region visually calm (sky + soft clouds) — room for a title
    titleSafe: { x0: 8, y0: 8, x1: 170, y1: 70 },
    // wind: rain slant (px right per px fallen) and smoke drift (px/s)
    wind: { slant: 0.22, smokeDrift: 5 },

    // ---- sky ---------------------------------------------------------------
    moon: { x: 398, y: 52, r: 16 },

    // ---- house (cottage with turret) ------------------------------------
    house: {
      body: { x0: 166, x1: 272, base: 206, eave: 128 }, // two storeys
      roof: { x0: 160, x1: 278, eave: 128, peakX: 219, peakY: 74 }, // steep gable
      turret: { x0: 270, x1: 300, base: 206, top: 112, peakX: 285, peakY: 58 },
      chimney: { x0: 184, x1: 194, top: 84 },
      windows: [
        // rect windows: x,y = top-left of the glass, w,h = glass size
        { id: 'ground-left', x: 178, y: 174, w: 18, h: 22 },
        { id: 'ground-right', x: 246, y: 174, w: 16, h: 22 },
        { id: 'upper-left', x: 180, y: 138, w: 14, h: 18 },
        { id: 'upper-right', x: 232, y: 136, w: 18, h: 22, cat: true }, // black cat sits here
        { id: 'turret-upper', x: 279, y: 126, w: 12, h: 18 },
        { id: 'turret-lower', x: 279, y: 170, w: 12, h: 22 },
        // round attic window
        { id: 'attic', cx: 219, cy: 103, r: 6, round: true },
      ],
      door: { x: 212, y: 178, w: 16, h: 28 },
      porch: { x0: 202, x1: 240, roofY: 168, roofH: 6, postL: 204, postR: 237 },
      steps: { x0: 206, x1: 234, y0: 206, y1: 213 },
      lantern: { hookX: 205, hookY: 174, len: 7 }, // hangs below the porch roof, sways
    },

    // ---- yard -------------------------------------------------------------
    tree: { x: 405, base: 214, trunkW: 18 }, // gnarled bare tree, branches cross the moon
    fence: { x0: 312, x1: 480, base: 210, top: 192 },
    tombstones: [
      { x: 340, base: 216, kind: 'round' },
      { x: 364, base: 213, kind: 'cross' },
      { x: 437, base: 221, kind: 'tall' },
      { x: 462, base: 215, kind: 'leaning' },
    ],
    campfire: { x: 96, base: 226, flameW: 22, flameH: 30 }, // x = centre, base = ground contact
    jackolanterns: [
      { x: 128, base: 226, size: 'big' },
      { x: 147, base: 231, size: 'small' },
      { x: 62, base: 232, size: 'medium' },
      { x: 207, base: 206, size: 'small' }, // left side of porch steps
      { x: 234, base: 206, size: 'small' }, // right side of porch steps
    ],
    pumpkinPatch: { x0: 4, x1: 48, y0: 214, y1: 236 },
    path: [
      [220, 213],
      [214, 220],
      [206, 227],
      [198, 235],
    ],
    // puddle ellipses (engine reflects the scene about `mirror` into them)
    puddles: [
      { x: 236, y: 228, rx: 22, ry: 3, mirror: 206, k: 0.62 },
      { x: 152, y: 235, rx: 12, ry: 2, mirror: 226, k: 0.55 },
      { x: 318, y: 229, rx: 14, ry: 2, mirror: 210, k: 0.55 },
    ],

    // ---- underground (cross-section) -------------------------------------
    coffin: { x0: 350, x1: 384, y0: 247, y1: 259 },

    // ---- weather hooks ------------------------------------------------------
    // where rain visibly splashes (line segments x0,y0 -> x1,y1). The ground
    // top face (y 206..238) also receives splashes everywhere.
    surfaces: [
      [160, 128, 219, 74], // main roof, left slope
      [219, 74, 278, 128], // main roof, right slope
      [270, 112, 285, 58], // turret cone left
      [285, 58, 300, 112], // turret cone right
      [202, 168, 240, 168], // porch roof
      [184, 84, 194, 84], // chimney cap
    ],
    // ---- seasonal anchors (Rainy Hollow series, see SEASONS.md) ----------
    seasonal: {
      // replaces the graveyard in every edition except Halloween
      gardenCorner: { x0: 312, x1: 474, y0: 204, y1: 228 },
      snowman: { x: 352, base: 223 },
      sled: { x: 330, base: 214 },
      hayBales: [
        { x: 330, base: 221 },
        { x: 354, base: 225 },
      ],
      scarecrow: { x: 447, base: 220 },
      sparklers: [
        { x: 126, base: 229 },
        { x: 142, base: 232 },
      ],
      rangoli: { x: 220, y: 221, rx: 18, ry: 5 },
      // lantern string: the house draws a hook at `from`, props draws the
      // string and lanterns from there to a branch of the tree
      lanternString: { from: [300, 150] },
      // fireworks burst zone (fire module); keep clear of titleSafe and the moon
      fireworks: { x0: 150, x1: 470, y0: 14, y1: 112 },
    },

    // ---- Summer Story anchors (SUMMER.md) ---------------------------------
    // No campfire in these chapters, so the left yard is the family's stage.
    summer: {
      stage: { x0: 66, x1: 196, y0: 214, y1: 236 }, // where the family cats gather (family module)
      table: { x: 112, base: 229, w: 34 }, // DC birthday table (props); cats sit/stand around it
      bench: { x: 118, base: 227, w: 30 }, // NYC anniversary bench (props); you + partner sit on it
      heater: { x: 182, base: 224 }, // LA patio heater (props)
      flagpole: { x: 34, base: 224 }, // US flag on a pole (props)
      football: { x: 262, base: 233 }, // Match Night ball (props)
      castle: { x: 338, base: 223 }, // San Diego toy-brick castle (props, garden corner)
      brickCat: { x: 300, base: 228 }, // original brick cat sculpture (props)
      giraffes: { x: 452, base: 213 }, // two giraffes peeking over the fence (props)
      boat: { x: 236, y: 228 }, // little boat on the big puddle in San Diego (props), puddle = bay
    },

    // eave points where fat drips fall from
    drips: [
      { x: 161, y: 129 },
      { x: 277, y: 129 },
      { x: 203, y: 175 },
      { x: 239, y: 175 },
      { x: 270, y: 113 },
      { x: 300, y: 113 },
    ],
  };
})();
