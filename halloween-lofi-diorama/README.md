# Rainy Hollow: a pixel-art Halloween diorama for lofi

Rainy Hollow is an animated pixel-art Halloween diorama built to be the looping
cover of a 10-hour lofi music video. A crooked cottage glows on a cold, rainy
night. A campfire spits sparks, jack-o'-lanterns flicker, smoke drifts from
the chimney, and a black cat watches the rain from the window. The ground is
cut away like a diorama to show the soil, roots and a buried coffin.

- **Crisp at 1080p and 4K.** The art is drawn at 480x270 and scaled by whole
  numbers, so each pixel is an exact 4x4 block at 1920x1080 and 8x8 at 3840x2160.
- **Seamless loop.** Every frame is a pure function of time `t` in a 240 s loop.
  There is no simulation state, so the picture at `t = 240` is identical to
  `t = 0`. Back-to-back copies of the exported loop join without a seam, and the
  live page can run for days without drifting.
- **Warm against cold.** The scene is painted in cold night colours. A per-pixel
  relighting pass then warms everything near the fire, the windows, the lantern
  and the pumpkins, using banded, dithered light pools. Rain, smoke and mist
  sample the same light, so drops passing the fire glow orange.

## Watch it

Open `index.html` in a browser, or `dist/rainy-hollow.html` (the same page as one self-contained file).

| key | action |
|---|---|
| `F` or double-click | fullscreen |
| `Space` | pause / resume |
| `H` | stats overlay (time in loop, fps, render ms) |

URL options: `?t=42` start time, `?speed=0.5`, `?pause=1`, `?fit=stretch`
(fill non-16:9 windows instead of integer scaling), `?lightning=0`,
`?loop=240` loop length in seconds, `?hud=1`. These debug views exist too:
`?view=light`, `?view=albedo`, `?view=em`, `?only=bg,house` and `?skip=weather`.

## Make the 10-hour video

The renderer draws frames directly. There is no screen capture, so frames are
exact and never dropped. Requirements: Node 18+, Playwright with Chromium, and ffmpeg.

```bash
# 1. one seamless loop (240 s, 7200 frames) at 1080p, or --scale 8 for 4K
node tools/render-video.mjs --out out/rainy-hollow-loop-1080p.mp4 --scale 4 --fps 30

# 2. repeat it for 10 hours under your music, without re-encoding the picture
tools/make-long.sh out/rainy-hollow-loop-1080p.mp4 my-lofi-mix.m4a 10
```

If the loop was split into parts (for example `...-part1-of-6.mp4` to get under a
file-size limit), pass part 1 and the script joins the rest losslessly first.
In a video editor, place the parts in order and repeat that block.

Tips:
- Upload in 4K (`--scale 8`) even if most viewers watch at 1080p. YouTube gives
  4K uploads a much higher bitrate, which keeps the rain and the pixel edges sharp.
- Other codecs: `--codec h265`, `--codec prores` (`.mov` for editing), and
  `--codec lossless` (RGB, very large).
- Vertical 9:16 short (60 s seamless loop, centred on the cottage, 7x pixels):
  `node tools/render-video.mjs --loop 60 --crop 152,0,154,270 --scale 7 --pad 1080x1920 --out out/vertical.mp4`
- `--loop` changes the loop length. All motion re-snaps to fit the new length,
  so the loop stays seamless.

## How it is built

```
src/engine.js      loop-safe time helpers, pixel primitives, lights + relighting,
                   puddle reflections, halos, integer-scaled display, export hooks
src/palette.js     the cold/warm ramps and light colours
src/layout.js      shared anchors (house, windows, fire, puddles, surfaces...)
src/bg.js          sky, drifting cloud layers, moon, hills, far church, bats
src/ground.js      wet grass, path, puddle beds, soil cross-section, coffin
src/house.js       the cottage, lit windows, the cat, the swaying lantern
src/props.js       tree, crows, graveyard, fence, pumpkins, jack-o'-lanterns
src/fire.js        campfire flames, firelight, sparks and embers
src/weather.js     three rain layers, splashes, eave drips, puddle ripples
src/atmosphere.js  chimney and campfire smoke, ground mist, vignette
```

`ART.md` holds the art direction and the module contract.

### Tools

```bash
node tools/shot.mjs   --t 12.5 --scale 2 --out frame.png         # still frame
node tools/sheet.mjs  --t0 10 --n 12 --crop 70,180,60,50 --out s.png   # motion contact sheet
node tools/review-kit.mjs --out review/                          # full set of review images
node tools/perf.mjs                                              # per-pass frame time
node tools/verify.mjs                                            # loop / determinism / perf checks
node tools/build.mjs                                             # dist/rainy-hollow.html
```

`verify.mjs` checks these things:
- No `Math.random`, wall-clock time, timers or anti-aliased canvas calls appear in `src/`.
- Frames at `t` and `t + LOOP` are pixel-identical with time left unwrapped.
- Seeking never depends on previously rendered frames, and a fresh page load gives identical pixels.
- The LOOP to 0 transition changes no more pixels than a normal frame step.
- Frame time fits a 60 fps budget at 1080p.
- The JS heap stays flat over thousands of frames.
