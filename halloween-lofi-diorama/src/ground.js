/* BLOCKOUT placeholder — ground top face, puddle beds, soil cross-section */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout;
  HD.module('ground', {
    passes: [
      {
        layer: 'scene',
        z: 5,
        draw(g) {
          g.rect(0, L.ground.back, 480, L.ground.front - L.ground.back, P.moss[2]);
          g.rect(0, L.ground.front, 480, 270 - L.ground.front, P.soil[3]);
          for (const p of L.puddles) g.ellipse(p.x, p.y, p.rx, p.ry, P.night[2]);
          const c = L.coffin;
          g.rect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0, P.wood[3]);
        },
      },
    ],
  });
})();
