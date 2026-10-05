/* BLOCKOUT placeholder — tree, graveyard, fence, pumpkins, campfire stones */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout;
  const SIZE = { big: 9, medium: 7, small: 5 };
  HD.module('props', {
    lights(t, Lt) {
      L.jackolanterns.forEach((j, i) => {
        const r = SIZE[j.size];
        Lt.add({ x: j.x, y: j.base - r, r: 26 + r * 2, color: HD.LIGHT.pumpkin, i: 0.6 + 0.4 * HD.time.flicker(t, 20 + i), halo: { r: 10, a: 0.15 } });
      });
    },
    passes: [
      {
        layer: 'scene',
        z: 30,
        draw(g, t) {
          const tr = L.tree;
          g.rect(tr.x - 9, 120, 18, tr.base - 120, P.wood[2]);
          g.line(tr.x, 125, 340, 40, P.wood[2]);
          g.line(tr.x, 125, 470, 30, P.wood[2]);
          g.line(tr.x, 140, 360, 20, P.wood[2]);
          for (const s of L.tombstones) g.rect(s.x - 6, s.base - 16, 12, 16, P.stone[4]);
          const f = L.fence;
          for (let x = f.x0; x < f.x1; x += 6) g.vline(x, f.top, f.base, P.stone[2]);
          g.hline(f.x0, f.x1, f.top + 4, P.stone[2]);
          L.jackolanterns.forEach((j, i) => {
            const r = SIZE[j.size];
            g.ellipse(j.x, j.base - r, r + 2, r, P.pumpkin[3]);
            g.em.rect(j.x - r / 2, j.base - r - 2, r, 3, P.fire[7 + Math.round(HD.time.flicker(t, 20 + i) * 2)]);
          });
          const c = L.campfire;
          for (let k = -2; k <= 2; k++) g.ellipse(c.x + k * 7, c.base - 1, 3, 2, P.stone[4]);
        },
      },
    ],
  });
})();
