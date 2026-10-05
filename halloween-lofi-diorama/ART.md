# Rainy Hollow: art direction and module contract

This is an animated pixel-art Halloween diorama used as the looping cover of a
10-hour lofi music video. It plays full-screen at 1080p (and 4K) for hours, so
it has to stay calm, cozy and readable. The animation should be lively but
never busy.

## The picture

It's a cold, rainy autumn night. A crooked little cottage with a witch-hat turret sits on a
slab of ground. The slab is cut away at the front, like a diorama, so you can
see the soil strata, roots and a buried coffin. Its windows glow amber, and a black cat sits in the
upper-right window watching the rain. A lantern sways under the porch. In the
left foreground a campfire burns with sparks. Carved jack-o'-lanterns
flicker around it and on the porch steps. Unlit pumpkins sit in a small patch at the far left. To
the right is a gnarled bare tree whose branches cross a pale moon above a small graveyard
with an iron fence. Behind everything are dark rolling hills and a pine line,
and a far-off church shows one tiny lit window. The rain falls steadily, a
little slanted by the wind. Smoke curls from the chimney and the fire.

**Palette idea: strong warm/cold contrast.** About 85% of the frame is cold:
navy, slate and violet, with rain in cool blue-grey. The remaining 15% is warm
pockets of firelight, windows and pumpkins. The warm pockets should feel
precious and inviting against the cold. Keep saturation for the warm light.
The cold side stays muted and deep. A little cold rim light from the moon
separates silhouettes on the right side.

**Mood references.** Cozy lofi covers, Eastward and Owlboy night scenes, and
pixel dioramas. The focal point is the cottage and campfire. The top-left sky
(`layout.titleSafe`) stays calm, because creators put a title there.

## Hard technical rules (the verifier enforces most of these)

1. **Native resolution is 480x270.** Each art pixel becomes a 4x4 block at
   1080p or 8x8 at 4K. Draw only with the `g.*` pixel API (`px`, `rect`,
   `hline`, `vline`, `line`, `circle`, `ring`, `ellipse`, `poly`, `dither`,
   `ditherCircle`, `sprite`, `blit`) or with `ImageData`. Don't use
   `ctx.arc`, paths, `stroke`, gradients, filters, text or `shadowBlur`, because
   they all anti-alias. Coordinates go through `Math.round`. For smooth
   transitions, use ordered dithering (`HD.bayer`, `g.dither`) or flat banded
   steps.
2. **Rendering is a pure function of `t`.** Don't use `Math.random`, `Date`,
   timers, or state carried from one frame to the next, such as accumulators,
   particle arrays updated per frame, or cellular automata. Use `HD.hash(a,b,c,d)`
   for per-frame randomness and `HD.rng(seed)` only inside `init()`.
3. **Everything loops seamlessly at `HD.LOOP` (240 s by default).** Get every
   periodic motion from `HD.time`:
   - `phase(t, period, off)` and `wave(t, period, off)` give oscillators.
   - `noise(t, period, seed)` and `fbm(...)` give smooth loop-safe noise.
   - `flicker(t, seed, speed)` gives fire and candle flicker.
   - `cycle(t, i, period, seed)` gives stateless particle lives: `.age` runs 0..1,
     `.rnd(k)` returns per-life randoms, and `.prev` gives the previous life.
     The returned object is shared, so read it before calling `cycle` again.
   - `step(t, fps)` quantises time for sprite frame-rates. Use 8-12 fps for
     flames and creatures. Leave rain and sparks continuous.

   The periods get snapped so that a whole number of them fits in the loop. Never
   write `Math.sin(t * k)` with an arbitrary `k`. Linear motion like cloud
   scrolling must move a whole number of tile widths per loop.
4. **Performance.** All seven modules plus the engine must render a frame in
   about 8 ms in headless Chromium (`node tools/perf.mjs`). Bake static art
   once in `init()` with `HD.bake(w, h, g => ...)` or `HD.sprite(rows, map)`,
   then blit it each frame. Per-frame per-pixel loops over large areas are
   expensive. Rough budget per module per frame: bg 1.0 ms, ground 0.3,
   house 0.8, props 0.8, fire 1.0, weather 1.5, atmosphere 1.0.
5. **Colours come from `HD.PAL` ramps** (see `src/palette.js`). Paint scene
   props in their night colours, meaning how they look under cold ambient light. Use the warm ramps
   (`fire`, `amber`, `warmrain`) only for things that emit light.

## How the engine composes a frame (`src/engine.js`)

```
lights(t, L)   ->  lightmap (banded, dithered pools of warm light)
bg passes      ->  main            unlit backdrop: sky, moon, clouds, hills, far rain
scene passes   ->  scene buffer    night-coloured props, then RELIT by the lightmap
                                   (pixels drawn with g.em.* are emissive: not relit)
fx passes      ->  main            smoke, sparks, rain, mist, post (z-ordered)
                                   engine: puddle reflections z=20, halos z=55
```

- **Relighting:** each lit pixel becomes `night + night/AMBIENT * light`. A dark
  colour stays dark and a mid-tone warms up strongly. So paint surfaces that
  should catch firelight (wall planks, stones, pumpkins, tree bark facing the
  fire) in mid-tones with some texture, and they will glow warm when a light is
  near.
- **Lights:** call `L.add({x, y, r, ry?, color: HD.LIGHT.fire, i, bands?, pow?, clip?, halo?: {r, a}})`
  in your module's `lights(t, L)`. `i` is the flicker-driven intensity. `clip`
  limits the light to a rectangle, for example window light spilling onto the ground.
  `halo` adds an additive glow sprite in the fx layer.
- **Sampling light in fx:** `HD.lights.rgb(x, y)` and `HD.lights.lum(x, y)` return
  the light at a pixel, so rain, smoke and mist can pick up warm light.
- **Emissive scene pixels:** `g.em.px/rect/...` draw into the scene and mark the
  pixel as emissive, so lit windows can sit behind window frames that are drawn
  later with the plain `g.*` calls.
- **Additive glow:** `HD.glow(g, x, y, r, color, alpha)` draws a banded glow in fx passes.

### z-order bands

| layer | z | used by |
|---|---|---|
| bg | 0-9 | sky, stars (none; it's overcast), moon, cloud layers |
| bg | 10-19 | distant hills, pines, far church, bats crossing the moon |
| bg | 20-29 | far rain (behind the house), distant ground mist |
| scene | 0-9 | ground top face, path, puddle beds, soil cross-section |
| scene | 10-19 | tree, fence, graveyard (behind/beside the house) |
| scene | 20-29 | house |
| scene | 30-39 | yard props in front: pumpkin patch, campfire stones and back logs |
| scene | 40-49 | flames (emissive), front logs, jack-o'-lanterns |
| fx | 10-19 | low mist behind smoke |
| fx | 20 | engine puddle reflections |
| fx | 25-29 | puddle ripples and splashes on the ground |
| fx | 30-39 | smoke, sparks and embers |
| fx | 40-49 | mid rain and drips |
| fx | 55 | engine halos |
| fx | 60-79 | foreground mist, near rain |
| fx | 90-99 | vignette and final grade |

## Modules and owners (one file each, in `src/`)

| file | module name | owns |
|---|---|---|
| `bg.js` | `bg` | sky gradient, overcast cloud layers that drift and loop, moon with halo veiled by clouds, rare soft cloud-glow lightning (at most once per loop, subtle), distant hills, pines, far church with a tiny warm window, bats crossing the moon now and then |
| `ground.js` | `ground` | ground top face (wet grass, mud, stepping-stone path, puddle beds), the front lip, the soil cross-section (strata, stones, roots under the tree, the coffin from `layout.coffin`, bones, a skull, a worm) |
| `house.js` | `house` | the cottage: walls, roof, turret, chimney, porch and steps, door, window frames and lit interiors (emissive, gently flickering candlelight, curtains), the black cat in the `cat` window (tail swish, blinks, ear twitch), the swaying porch lantern, and all the house lights including window spill onto the ground |
| `props.js` | `props` | gnarled tree with branches over the moon and roots, crows on branches with idle animation, iron fence, tombstones, pumpkin patch with vines, carved jack-o'-lanterns (emissive faces and their flickering lights), campfire stone ring and logs |
| `fire.js` | `fire` | campfire flames (emissive, procedural, loop-safe), fire light and halo, sparks and embers rising with the wind, occasional ember pops |
| `weather.js` | `weather` | rain in three depth layers (far in bg z 20-29, mid in fx 40s, near in fx 60s), drops warmed by nearby light (sample `HD.lights`), splashes on the ground band and on `layout.surfaces`, fat drips from `layout.drips`, ripple rings in `layout.puddles` |
| `atmosphere.js` | `atmosphere` | chimney and campfire smoke (dithered puffs, warm-lit near the fire, cold elsewhere, drifting with the wind), slow drifting ground mist and fog bands, a static dithered vignette and final touches |

Each module may define private constants in its own file. **Don't edit
`engine.js`, `palette.js`, `layout.js` or another module's file.** If you
believe a shared anchor or engine feature must change, say so in your final
report and work around it locally.

## Tools (run from `halloween-lofi-diorama/`)

```
node tools/shot.mjs  --t 12.5 --scale 2 --out <scratch>/full.png       # whole frame (960x540)
node tools/shot.mjs  --t 12.5 --scale 4 --crop 150,60,160,160 --out <scratch>/house.png
node tools/shot.mjs  --t 12.5 --only bg,house --out ...                # isolate modules
node tools/shot.mjs  --t 12.5 --view light|albedo|scene|em --out ...   # debug views
node tools/sheet.mjs --t0 10 --dt 0.0333 --n 12 --cols 4 --crop 70,180,60,50 --scale 4 --out <scratch>/fire.png
node tools/perf.mjs                                                    # per-pass ms
node tools/verify.mjs --quick                                          # loop/determinism/perf checks
```

Read the PNGs you produce. You can see images, so look at your work
critically at both full-frame and zoomed scale, and iterate until it looks
genuinely good. Write scratch images to your scratchpad directory, never into the
repo. Other modules may be in flux while you work. If another module throws, its
pass is skipped and the error shows up in the tool output. Ignore errors that
aren't in your file.
