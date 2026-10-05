/* BLOCKOUT placeholder — bg: sky, moon, distant hills */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  HD.module('bg', {
    passes: [
      {
        layer: 'bg',
        z: 0,
        draw(g, t) {
          for (let y = 0; y < 210; y++) {
            const k = y / 210;
            const i = Math.min(6, Math.floor(k * 5 + HD.bayer(0, y) * 0.0));
            g.rect(0, y, 480, 1, P.night[1 + i]);
          }
          const m = HD.layout.moon;
          g.circle(m.x, m.y, m.r, P.moon[3]);
          g.poly([[0, 205], [0, 170], [60, 150], [140, 175], [230, 160], [330, 178], [420, 158], [480, 170], [480, 205]], P.night[3]);
        },
      },
    ],
  });
})();
