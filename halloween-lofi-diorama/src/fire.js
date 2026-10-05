/* BLOCKOUT placeholder — campfire flames, light, sparks */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const C = HD.layout.campfire;
  HD.module('fire', {
    lights(t, Lt) {
      const f = HD.time.flicker(t, 1, 1.3);
      Lt.add({ x: C.x, y: C.base - 12, r: 120, color: HD.LIGHT.fire, i: 1.0 + 0.45 * f, halo: { r: 30, a: 0.25 } });
    },
    passes: [
      {
        layer: 'scene',
        z: 45,
        draw(g, t) {
          const ts = HD.time.step(t, 12);
          for (let k = 0; k < 6; k++) {
            const h = 10 + HD.time.noise(ts, 0.3, k) * 18;
            g.em.rect(C.x - 9 + k * 3, C.base - h, 3, h, P.fire[5 + (k % 3)]);
          }
        },
      },
      {
        layer: 'fx',
        z: 35,
        draw(g, t) {
          for (let i = 0; i < 24; i++) {
            const c = HD.time.cycle(t, i, 2.2, 5);
            const x = C.x + (c.rnd(0) - 0.5) * 16 + c.age * 20 * c.rnd(1);
            const y = C.base - 14 - c.age * 90;
            g.px(x, y, P.fire[Math.max(2, 9 - Math.floor(c.age * 8))]);
          }
        },
      },
    ],
  });
})();
