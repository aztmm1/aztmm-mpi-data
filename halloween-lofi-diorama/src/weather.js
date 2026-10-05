/* BLOCKOUT placeholder — rain */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const S = HD.layout.wind.slant;
  HD.module('weather', {
    passes: [
      {
        layer: 'fx',
        z: 40,
        draw(g, t) {
          for (let i = 0; i < 300; i++) {
            const c = HD.time.cycle(t, i, 0.6, 77);
            const x0 = c.rnd(0) * 540 - 60;
            const y = -10 + c.age * 250;
            const lum = HD.lights.lum(x0 + S * y, y);
            g.line(x0 + S * y, y, x0 + S * (y + 5), y + 5, lum > 0.35 ? P.warmrain[2] : P.rain[2]);
          }
        },
      },
    ],
  });
})();
