/* BLOCKOUT placeholder — cottage, windows, lantern */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout.house;
  HD.module('house', {
    lights(t, Lt) {
      for (const w of L.windows) {
        const cx = w.round ? w.cx : w.x + w.w / 2;
        const cy = w.round ? w.cy : w.y + w.h / 2;
        Lt.add({ x: cx, y: cy, r: 34, color: HD.LIGHT.candle, i: 0.7 + 0.2 * HD.time.flicker(t, 3 + cy), halo: { r: 14, a: 0.12 } });
      }
      const sw = HD.time.wave(t, 4) * 2;
      Lt.add({ x: L.lantern.hookX + sw, y: L.lantern.hookY + L.lantern.len + 4, r: 40, color: HD.LIGHT.lantern, i: 0.9 + 0.2 * HD.time.flicker(t, 9), halo: { r: 18, a: 0.2 } });
    },
    passes: [
      {
        layer: 'scene',
        z: 20,
        draw(g, t) {
          const b = L.body;
          g.rect(b.x0, b.eave, b.x1 - b.x0, b.base - b.eave, P.wood[4]);
          const r = L.roof;
          g.poly([[r.x0, r.eave], [r.peakX, r.peakY], [r.x1, r.eave]], P.stone[3]);
          const tu = L.turret;
          g.rect(tu.x0, tu.top, tu.x1 - tu.x0, tu.base - tu.top, P.wood[5]);
          g.poly([[tu.x0 - 2, tu.top], [tu.peakX, tu.peakY], [tu.x1 + 2, tu.top]], P.stone[3]);
          const ch = L.chimney;
          g.rect(ch.x0, ch.top, ch.x1 - ch.x0, 30, P.stone[4]);
          for (const w of L.windows) {
            const c = P.amber[5 + Math.round(HD.time.flicker(t, 3) * 1.5)];
            if (w.round) g.em.circle(w.cx, w.cy, w.r, c);
            else g.em.rect(w.x, w.y, w.w, w.h, c);
          }
          const d = L.door;
          g.rect(d.x, d.y, d.w, d.h, P.wood[2]);
          const sw = Math.round(HD.time.wave(t, 4) * 2);
          g.em.rect(L.lantern.hookX - 2 + sw, L.lantern.hookY + L.lantern.len, 5, 7, P.amber[6]);
        },
      },
    ],
  });
})();
