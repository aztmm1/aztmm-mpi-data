/*
 * Summer Story timing shared by several modules (see SUMMER.md), so the cats
 * (family), the cake candles (props), the goal cheer (house/fire) and the
 * anniversary heart all agree on when things happen. Everything is a pure,
 * loop-safe function of t.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;

  /** seconds into the loop, wrapped */
  const sec = (t) => (((t % HD.LOOP) + HD.LOOP) % HD.LOOP);
  /** 0..1 progress inside [a, b) of the loop, or -1 outside */
  function win(t, a, b) {
    const s = sec(t);
    return s >= a && s < b ? (s - a) / (b - a) : -1;
  }

  HD.summer = {
    sec,
    win,
    /**
     * Niece visits: she walks in, stays, walks out. Returns
     *  { here: bool, phase: 'in' | 'stay' | 'out', u: 0..1 progress in phase }
     * Two visits per loop in home chapters; she stays all loop on trips.
     */
    niece(t) {
      const ed = HD.edition.id;
      if (ed === 'la' || ed === 'sandiego' || ed === 'dc') return { here: true, phase: 'stay', u: 0 };
      const visits = [
        [20, 4, 70, 4],
        [140, 4, 60, 4],
      ]; // [start, walk-in s, stay s, walk-out s]
      const s = sec(t);
      for (const [a, wi, st, wo] of visits) {
        if (s >= a && s < a + wi) return { here: true, phase: 'in', u: (s - a) / wi };
        if (s >= a + wi && s < a + wi + st) return { here: true, phase: 'stay', u: (s - a - wi) / st };
        if (s >= a + wi + st && s < a + wi + st + wo) return { here: true, phase: 'out', u: (s - a - wi - st) / wo };
      }
      return { here: false, phase: 'away', u: 0 };
    },
    /** DC birthday: candles are out (and everyone cheers) in this window; -1 otherwise */
    candlesOut(t) {
      return win(t, 100, 112);
    },
    /** the moment dad leans in to blow (just before candlesOut) */
    blowing(t) {
      return win(t, 98, 100);
    },
    /** Match Night goal: windows flash, cheer and mini fireworks */
    goal(t) {
      return win(t, 150, 158);
    },
    /** NYC anniversary: a little heart floats up between the two cats */
    heart(t) {
      return win(t, 60, 66) >= 0 ? win(t, 60, 66) : win(t, 180, 186);
    },
    /** gentle shared breeze for long fur, flags and bunting (-1..1) */
    breeze(t) {
      return 0.6 * T.wave(t, 6.5, 0.1) + 0.4 * (T.noise(t, 3.1, 4242) * 2 - 1);
    },
  };
})();
