/*
 * Palette — cold rainy night vs. warm pockets of firelight.
 * Ramps run dark -> light. Paint the scene in the COLD ramps (that is how
 * things look under rainy-night ambient light); the engine's relighting warms
 * whatever sits near a light. Use the WARM ramps only for things that emit
 * light themselves (flames, embers, lit windows, carved pumpkin faces).
 */
(function () {
  'use strict';
  const HD = (window.HD = window.HD || {});

  HD.PAL = {
    // --- cold -----------------------------------------------------------
    // deep night blues: sky, rain, far silhouettes
    night: ['#04050b', '#080a16', '#0d1122', '#121831', '#18203f', '#1f2a4f', '#283661', '#334474', '#41558a', '#5670a3', '#7790bd', '#a3b8d8', '#d2def0'],
    // violet shadows (Halloween mood in the darks)
    violet: ['#0e0a18', '#160f24', '#1f1532', '#2a1c42', '#372555', '#47306a', '#5c3f82'],
    // cool slate greys: stone, tombstones, roof slate, iron
    stone: ['#101219', '#171a24', '#20242f', '#2b303d', '#383e4e', '#4a5163', '#626a7e', '#8089a0'],
    // night grass & foliage (teal-leaning)
    moss: ['#0a1214', '#0f1b1d', '#152527', '#1c3132', '#253f3e', '#30504c', '#3f6460'],
    // wood at night (purple-brown)
    wood: ['#0f0b10', '#171117', '#20171f', '#2a1e27', '#362731', '#43313b', '#553f48', '#6a5059'],
    // earth cross-section & mud
    soil: ['#08060a', '#0e0a0f', '#151016', '#1d161c', '#271d23', '#33262b', '#413036'],
    // pumpkin skin in the dark (the relight makes it glow orange near flames)
    pumpkin: ['#24110f', '#3a1a14', '#55251a', '#73331f', '#934426', '#b1592e'],
    // stems, vines, dry leaves
    vine: ['#10140f', '#171f15', '#1f2b1c', '#2a3a25', '#384c30'],
    // bone, skull, pale stone accents (cold-tinted)
    bone: ['#3e3e44', '#5f5f66', '#86858a', '#adaaa8', '#d3cfc6'],
    // moon and moonlit rims
    moon: ['#6f86ad', '#9cb1d1', '#c4d4ea', '#e2ebf6', '#f7fafe'],
    // rain streaks (cold) — use with HD.LIGHT sampling to warm them near lights
    rain: ['#2c3c5e', '#3a4f78', '#55709e', '#7b97c2', '#a9c0e0', '#d6e4f5'],
    // cold spirit / wisp accent (sparingly)
    spirit: ['#1a3340', '#2b5868', '#4a8fa0', '#86c8d4', '#c8f0f4'],

    // --- warm (emissive) ------------------------------------------------
    // flames & embers, dark ember -> white-hot core
    fire: ['#2b0a08', '#4a110a', '#70190c', '#9a2610', '#c43a14', '#e4571a', '#f87a24', '#ff9f38', '#ffc25a', '#ffdf8f', '#fff4cc'],
    // candle-lit interiors & lantern glass (more amber than fire)
    amber: ['#2e160b', '#4f250f', '#7a3a14', '#a8521b', '#d67a26', '#f2a23f', '#ffc96a', '#ffe7aa', '#fff6dc'],
    // rain/smoke picking up warm light
    warmrain: ['#6a3a2a', '#9a5530', '#c97436', '#f0a050', '#ffd08a'],
  };

  // Light colours (multipliers used by HD.lights.add({color}))
  HD.LIGHT = {
    fire: [1.0, 0.5, 0.18],
    ember: [1.0, 0.38, 0.12],
    candle: [1.0, 0.66, 0.3],
    lantern: [1.0, 0.6, 0.26],
    pumpkin: [1.0, 0.45, 0.12],
    moon: [0.5, 0.62, 0.9],
    spirit: [0.4, 0.85, 0.95],
  };
})();
