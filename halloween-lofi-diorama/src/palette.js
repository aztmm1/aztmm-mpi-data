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

    // --- seasonal (Rainy Hollow series) ---------------------------------
    // snow at night: blue-lilac, relights to warm cream near lamps
    snow: ['#1a2036', '#262f4c', '#36425f', '#4a5878', '#627394', '#8193b2', '#a6b6d0', '#cdd8ea', '#eef3fa'],
    ice: ['#16243a', '#22385a', '#365477', '#557596', '#86a6c2', '#c2d8ea'],
    // cherry blossom pinks at night
    blossom: ['#2a1828', '#41213b', '#5e2f52', '#7e406b', '#a15886', '#c27aa2', '#e0a6c2', '#f6d2e2'],
    // red plum blossom
    plum: ['#33101c', '#561a2b', '#80263a', '#a83448', '#cf5462', '#ea8790'],
    // summer foliage & lush grass at night
    leaf: ['#08150f', '#0d2016', '#132c1e', '#1a3a27', '#234a32', '#2f5d3e', '#3e734c', '#518a5c'],
    // autumn foliage at night (relights to fiery orange)
    autumn: ['#24120f', '#3d1d17', '#5c2a1d', '#7d3822', '#9e4a27', '#bd632e', '#d5843a', '#e6a94e'],
    // festive red (lantern silk, banners, firecrackers) and gold trim
    red: ['#24080c', '#420d14', '#6b121c', '#951a25', '#bf2530', '#e2403f', '#ff6b5a'],
    gold: ['#33250a', '#5c4310', '#8c6618', '#bb8d22', '#e0b636', '#f7d969', '#fff2b0'],
    // marigold garlands (pigment, relit by lamps)
    marigold: ['#4a2207', '#753709', '#a5520c', '#d27213', '#f39a24', '#ffc04a'],
    // rangoli powder colours (pigment, relit by lamps)
    rangoli: ['#b8285f', '#e0701a', '#e8bf2e', '#2f9a5e', '#2f6cc4', '#7a3cc4', '#efe8dc'],
    // string-light bulbs (emissive) per colour: dim, mid, bright
    bulb: {
      red: ['#5a1414', '#c42a24', '#ff7a66'],
      green: ['#123c1c', '#2aa04a', '#8cf09a'],
      blue: ['#142450', '#2f62d2', '#8ab4ff'],
      gold: ['#4a3208', '#e0a22a', '#ffe28a'],
      pink: ['#4a1838', '#d8508e', '#ffb0d4'],
      white: ['#3a3a40', '#c8ccd8', '#ffffff'],
    },
    // fireworks (emissive) per colour: ember, body, core
    firework: {
      gold: ['#6a3a0a', '#f0a830', '#fff0b0'],
      red: ['#6a1010', '#ff4a3a', '#ffd0c0'],
      green: ['#0e4a1e', '#3ae06a', '#d0ffd8'],
      blue: ['#10204a', '#4a8aff', '#d8e8ff'],
      violet: ['#30104a', '#b05aff', '#f0d8ff'],
      magenta: ['#4a0a30', '#ff4aa8', '#ffd0ec'],
      white: ['#3a3a44', '#d8dcf0', '#ffffff'],
    },
    // fireflies (emissive yellow-green)
    firefly: ['#2a3608', '#6a8a14', '#b8e03a', '#eaff8a', '#fbffd8'],
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
    diya: [1.0, 0.6, 0.2],
    redLantern: [1.0, 0.3, 0.2],
    paperLantern: [1.0, 0.72, 0.4],
    firefly: [0.75, 1.0, 0.3],
    bulb: { red: [1, 0.25, 0.2], green: [0.3, 1, 0.4], blue: [0.35, 0.5, 1], gold: [1, 0.75, 0.3], pink: [1, 0.4, 0.7], white: [0.9, 0.9, 1] },
    firework: { gold: [1, 0.72, 0.3], red: [1, 0.3, 0.25], green: [0.35, 1, 0.5], blue: [0.4, 0.55, 1], violet: [0.75, 0.45, 1], magenta: [1, 0.35, 0.75], white: [0.9, 0.92, 1] },
  };
})();
