# Rainy Hollow: the seasons series

Rainy Hollow is one cottage seen on eight nights across the year. The
**same black cat sits in the same upper-right window in every edition, with
the same sprite and animation.** That cat is the series mascot, so don't give
it costumes, change its pose or move it. Everything else around the cat
changes with the season and its festival. ART.md still applies in full:
pixel rules, loop rules, the cold/warm palette idea and performance.

Editions are defined in `src/editions.js` (`HD.EDITIONS`, current: `HD.edition`).
Use `HD.tag('wreath')` to test decoration tags and `HD.edition.<field>` for
sky/weather/ground/tree/fire/fireworks.

| # | id | name | festival | sky / moon | weather | ground | tree | fire | fireworks |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `lunar` | Red Lanterns | Lunar New Year | clear, stars / none | light snow | thin snow | snowy (red lanterns hang in it; plum blossoms in a window vase, as Boston has none outdoors in February) | none | 0.45 red & gold |
| 2 | `spring` | Blossom Rain | Easter | broken / crescent | soft rain + petals | spring | blossom | none | - |
| 3 | `summer` | Firefly Midsummer | Midsummer | clear, Milky Way / full | fireflies | summer | summer | bonfire | - |
| 4 | `harvest` | Harvest Moon | Harvest & Mid-Autumn | broken / big harvest moon | falling leaves | leafy | autumn | campfire | - |
| 5 | `halloween` | Rainy Hollow | Halloween | overcast / full | rain | wet autumn | bare | campfire | - |
| 6 | `lights` | Festival of Lights | Diwali | clear / none (new moon) | none | dry autumn | autumn | none | 0.6 multicolour |
| 7 | `winter` | Snowed In | Christmas & Hanukkah | overcast snow clouds / none | snow | deep snow | snowy | none | - |
| 8 | `newyear` | Midnight Fireworks | New Year's Eve | clear / crescent | light snow | thin snow | snowy | campfire | 1.0 big show |

## Hard rules for the series

1. **Halloween must stay pixel-identical.** `node tools/regress.mjs` must print
   "pixel-identical". Put every change behind edition checks, so the Halloween
   code path renders exactly as before.
2. **Read `HD.edition` at draw time.** The page switches editions live
   (`HD.setEdition`), with no reload and no re-run of `init()`. Never capture
   edition-specific state only in `init()`. Cache per-edition art with
   `const art = HD.perEdition((ed) => HD.bake(...))` and call `art()` inside `draw`.
   `node tools/verify.mjs` checks that switching through every edition and back
   leaves no trace.
3. **Every edition loops at 240 s** using the same `HD.time` helpers. Verify
   each one with `node tools/verify.mjs --quick --edition <id>`.
4. **Performance:** each edition must stay within about 8.5 ms p50 for the
   whole frame (`node tools/perf.mjs --edition <id>`). Diyas, string lights,
   fireworks and fireflies add up fast. Aggregate lights rather than giving
   every bulb its own light.
5. **Shared helpers** live in `src/festive.js`. Use them so the decorations
   look the same across modules:
   - `flame` and `flameLight` for tiny flames.
   - `diya` and `diyaLight` for clay oil lamps.
   - `bulbs` and `bulbLights` for string lights along a polyline with sag.
   - `lantern` and `lanternLight` for swaying hanging lanterns: `red`, `paper` or `harvest`, small or big.
6. **Respect the festivals.** Depict the decorations people actually use at
   home: lamps, garlands, lanterns, rangoli, wreaths, a menorah, a tree. Don't
   draw religious figures or deities, and don't write words in any script. Red
   banners are plain red with gold flecks. Keep it warm and inclusive.
7. **Files:** each module owner owns `src/<module>.js` and `src/<module>-seasons.js`
   (already loaded by `index.html`). Seasonal additions may go in either file,
   and you may refactor your base file if Halloween stays identical. Edit no other file.
8. **Seasonal anchors** are in `HD.layout.seasonal`: the garden corner
   replacing the graveyard, snowman, sled, hay bales, scarecrow, sparklers,
   rangoli, the lantern-string hook and the fireworks zone.

## Who draws what

### bg (sky, moon, clouds, landscape)
- **Sky:**
  - `overcast`: as now, or heavier lilac-grey snow clouds in `winter`.
  - `broken`: soft drifting cloud banks with gaps of stars.
  - `clear`: stars at `edition.stars` density. Twinkle gently on a slow, loop-safe cycle, and use clusters, not noise.
  - `summer` adds a faint Milky Way band. Clear editions get one subtle shooting star per loop.
- **Moon:**
  - `full`: the existing moon.
  - `harvest`: bigger (r ~22), amber-tinted gold, still behind the tree.
  - `crescent`: a thin crescent.
  - `none`: no moon, and no moon halo or silver linings.
- **Distant landscape by season:**
  - Snowy hills and snow-capped pines for `lunar`, `winter` and `newyear`.
  - Fresh green with pale blossom specks for `spring`.
  - Deep lush green for `summer`.
  - Rust and gold forest for `harvest` and `lights`.

  The far chapel window glows in every edition. In `lights`, add a few tiny warm lamps to the chapel.
- Bats and lightning stay Halloween-only (tags `bats`, `lightning`).

### ground (top face, puddles, cut-away)
- **Ground variants:**
  - `wet-autumn`: Halloween, unchanged.
  - `leafy`: a thick, colourful leaf carpet.
  - `dry-autumn`: dry grass and a swept path.
  - `snow`: deep snow with soft drifts, a trodden footprint trail along the path, and snow overhanging the lip.
  - `thin-snow`: patchy snow with grass showing.
  - `spring`: fresh green with tulips and daffodils.
  - `summer`: a lush meadow with clover and wildflowers.
- **Puddles:**
  - Water in `halloween` and `spring`.
  - Ice where the tag is `frozen-puddles`: still reflective, with crack lines.
  - Lily-pond in `summer` (`lily-pond`): pads plus one flower.
  - Otherwise still dark water.
- **`rangoli`:** a colourful symmetric floor pattern in powder colours in front of the steps (`layout.seasonal.rangoli`, seen in perspective, so the ellipse is wide and flat).
- **The cut-away keeps a little secret per edition** (`secret-*` tag):
  - `coffin` (Halloween as now, with bones and skull only here).
  - `hibernating-frog`, curled in a mud pocket.
  - `rabbit-burrow`, a rabbit asleep in a tunnel.
  - `ant-colony`, tunnels with tiny ants that wiggle at 4 fps.
  - `squirrel-stash`, a cache of acorns.
  - `clay-pot` of gold coins.
  - `hedgehog`, asleep in a leaf nest.
  - `time-capsule`, a small tin box.

  In snow editions, add a frozen top layer.

### house (cottage, windows, decorations, cat)
- **Snow:**
  - `roof-snow` puts heavy snow on the roof, turret, porch roof and sills, plus `icicles`.
  - `roof-snow-light` is a thin dusting.
- **Windows:** keep the warm interiors and keep the cat identical. Vary small interior details:
  - `menorah` (a nine-branch menorah with all candles lit, the centre one raised) in `ground-left`.
  - `xmas-tree` (a small decorated tree with twinkling bulbs) in `ground-right`.
  - `tangerines` and `paper-cuts` (red paper flower cut-outs on panes).
  - `seedlings`, `pie-sill` and `party-windows` (streamers and balloons as silhouettes, warmer and busier light).
  - `open-windows` (the curtains drift outward).
- **Door, porch and eaves:**
  - `wreath`, `flower-wreath` and `leaf-wreath` on the door.
  - `red-lanterns`: a pair of big red lanterns at the porch.
  - `red-banners`: plain red vertical banners flanking the door.
  - `firecrackers`: a string of small red firecrackers hanging from a porch post.
  - `marigolds`: orange and yellow toran garlands over the door and windows.
  - `diyas-house`: diyas on every sill and on the steps.
  - `string-lights-color` and `string-lights-gold` along the eaves and porch.
  - `harvest-lanterns`: round orange lanterns under the porch eave.
  - `corn-bundles`: by the door posts.
  - `window-boxes`: flowers under the ground-floor windows.
  - `flower-garland`: over the door.
  - `bunting`: party pennants across the porch.
- **Lantern-string hook:** draw a small iron hook at `layout.seasonal.lanternString.from` whenever the tag is `paper-lantern-string`.
- All decoration lights come from the house's `lights()`.

### props (tree, yard sets, campfire stones)
- **Tree:**
  - `bare`: Halloween as now.
  - `autumn`: orange, red and gold foliage clusters with some bare twigs.
  - `blossom`: a pink cherry canopy.
  - `plum`: dark branches with red plum blossoms and a dusting of snow.
  - `summer`: a lush green canopy.
  - `snowy`: snow resting on the tops of the branches.

  The moon-crossing silhouette must still read. Foliage clusters leave gaps, so the moon shows through.
- **Garden and yard:**
  - The graveyard is Halloween-only. Elsewhere, draw a seasonal `garden` corner in `layout.seasonal.gardenCorner`: a bench, shrubs and a birdhouse post. Snow-capped in winter editions, blooming in spring, lush in summer and autumnal in autumn.
  - `crows` appear only in harvest and Halloween.
- **Yard sets:**
  - `jackolanterns` and `pumpkin-patch`: Halloween as now.
  - `harvest-pumpkins`: uncarved pumpkins and gourds near the fire.
  - `hay-bales` and an original `scarecrow`.
  - `eggs`: pastel painted eggs hidden in the grass, plus a basket.
  - `flower-beds`, `birdhouse` and a `frog` on a puddle edge that occasionally croaks.
  - `hammock`: in the summer tree.
  - `snowman` (coal eyes, carrot nose, scarf) and `sled`.
  - `diyas-yard`: diyas lining the path and the fence top.
  - `tree-red-lanterns`: small and big red lanterns hanging from branches.
  - `tree-fairy-lights`: warm bulbs wound along branches.
  - `paper-lantern-string`: from the house hook to a branch, with paper or harvest lanterns. Use harvest lanterns in `harvest` and paper in `summer`.
- **Campfire:** draw the campfire stones and logs only when `edition.fire !== 'none'`. Draw a bigger log pile for `bonfire`.

### fire (campfire, bonfire, sparklers, fireworks)
- **Campfire:** as now for `campfire`.
- **`bonfire`:** about 1.6x taller and wider flames, more sparks and a bigger light. The props log pile matches it.
- **`sparklers`:** at `layout.seasonal.sparklers`, fizzing sticks stuck in the snow with a white-gold core, radiating short sparks and small lights.
- **Fireworks (`edition.fireworks > 0`):** in the bg layer at z 9 (behind the hills and the house, over the clouds).
  - Rockets rise with a faint trail and burst inside `layout.seasonal.fireworks`.
  - Burst types: peony, chrysanthemum, ring, willow and crackle, using colours from `edition.fireworkColors`.
  - Each burst adds a short coloured light flash that subtly relights the scene.
  - Loop-safe via `HD.time.cycle`.
  - Busy-ness scales with `edition.fireworks`. It's a festive show but still calm enough to watch for hours, with no strobing.

### weather (rain, snow, leaves, petals, fireflies)
- **Rain:** Halloween stays unchanged. `spring` has softer, sparser rain with the same light interaction.
- **Snow:** three depth layers of gentle flakes that drift and wobble, warm-lit near lights. Intensity comes from `edition.weather.snow`. No splashes. Flakes vanish on landing.
- **Leaves:** tumbling, fluttering autumn leaves in two-frame flips, carried by the wind from the tree across the yard.
- **Petals:** soft pink petals drifting from the blossom tree. A few red plum petals in `lunar`.
- **Fireflies:** 30-60 slow blinking yellow-green lights wandering over the meadow and around the tree. Only a few aggregated lights.

### atmosphere (smoke, mist, vignette)
- **Chimney smoke:** in every edition. Denser in `winter`, thinner in `summer`.
- **Campfire smoke:** when `edition.fire !== 'none'`. Bigger for the bonfire.
- **Mist per season:**
  - `winter`: low snow haze and drifting powder.
  - `spring`: soft mist.
  - `summer`: a warm low haze over the meadow.
  - `harvest`: a golden dusk haze.
  - `lights`: a faint lamp-smoke haze.
  - `lunar` and `newyear`: frosty air and a faint firework smoke haze high in the sky.

  The vignette stays the same.
