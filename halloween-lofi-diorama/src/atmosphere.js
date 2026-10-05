/* BLOCKOUT placeholder — smoke, mist, vignette */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  HD.module('atmosphere', {
    passes: [
      {
        layer: 'fx',
        z: 95,
        draw(g) {
          for (let y = 0; y < 270; y++)
            for (let x = 0; x < 480; x += 1) {
              const dx = (x - 240) / 260;
              const dy = (y - 135) / 160;
              const v = dx * dx + dy * dy;
              if (v > 0.8 && HD.bayer(x, y) < (v - 0.8) * 1.2) g.px(x, y, P.night[0]);
            }
        },
      },
    ],
  });
})();
