# Rainy Hollow: the Summer Story

The Summer Story is six extra summer editions that tell one family's summer, with the
family drawn as cats. These chapters follow every SEASONS.md and ART.md rule:
pixel-art craft, pure function of `t`, a seamless 240 s loop, live switching,
and Halloween staying pixel-identical. On top of that:

- **The cottage diorama stays.** Only the backdrop changes to the city where
  each chapter happens, so the diorama "travels".
- **No trademarks, logos, brand names or words.** Draw football, real national flags,
  generic skylines, zoo animals and a toy-brick castle. Don't draw official
  tournament marks, theme-park, zoo or restaurant names, the Hollywood sign,
  movie posters or brick-toy minifigures.
- **No real names anywhere.** The cats tell the story.

## The family (shared characters: `src/family.js`)

| role | cat | signature details |
|---|---|---|
| you | the series' black cat (short fur) | sunglasses (black wayfarers or gold aviators); outfits by chapter: a red Spain-style football jersey with yellow trim in Match Night (no crest, badge or logo), coral tee, plaid shirt, white tee, blue linen shirt |
| partner | long-haired dark cat, long flowing fur that drifts in the breeze | white tee; sits close to you |
| niece | super-cute baby kitten: oversized round head, tiny body, big shiny eyes, a small sweet smile, dark-brown fluffy fur, a little top-knot tied with a BIG PINK BOW (an original design: do NOT imitate any existing character, e.g. no white cat with a red ear-bow and no mouth) | outfit by chapter: blue tee, striped navy/white tee + tiny life vest, burgundy floral dress + yellow sippy cup; tiny red/black/white sneakers. **Comes and goes:** walks in, stays a while, walks off, loop-safe |
| sister | dark long-haired cat | blue bow headband, blue-and-white striped shirt |
| brother-in-law | salt-and-pepper tabby | gold aviators, cream polo or striped shirt |
| dad | older, slightly rounder cat; dark fur silvering at the muzzle and temples, grey whiskers, a big laugh | red polo with a white-tipped collar; carries the niece and plays with her; he gives her a SMALL YELLOW TOY CRANE (the gift moment: he hands it over, she plays with it by the cake); birthday chapter only |

The cats are 10-16 px tall, the niece about 7-9 px. They have readable
silhouettes and idle animation at 6-8 fps: blinks, tail swishes, ear flicks,
leaning together. Outdoors they sit in the lit yard (near lanterns, fire or the
porch light), so their colours read through the relighting. In the home chapter (`home`)
you and your partner sit together in the lit upper-right window as
silhouettes; in Match Night you sit outside on the porch in your Spain jersey. In travel chapters that window is empty (tag `cat-away`) and you
are out with the family.

## Chapters (editions, in story order)

| id | name | when | who | backdrop and props |
|---|---|---|---|---|
| `match` | Match Night | Jun 11 - Jul 3 | you (in your red Spain jersey) + partner OUTSIDE on the porch steps/bench, watching the match on the TV through the window and cheering at the goal; niece drops by; the series-cat window is empty (`cat-away`) | Boston skyline at night (Prudential-style tower with antenna, crown-topped glass tower, slab tower). flag bunting on the porch and eaves for the teams that played in Boston: USA, Ireland, Scotland, Norway, France and Germany, plus Spain (the team you supported; red-yellow-red, no coat of arms) (small accurate pixel flags, alternating), plus a big Scottish Saltire hanging from the upper window, a TV glowing green with a tiny match in the ground-left window, an original Irish-pub-style hanging sign (a painted shamrock and a pint, no words), a football in the yard. Once per loop a "goal": windows flash, a short cheer of confetti and 2-3 small green/white/gold fireworks |
| `nyc` | Anniversary in New York | Jul 4 - Jul 7 | you + partner on the porch bench | New York skyline with one tall spire tower and the Statue of Liberty far off in the harbour. July 4th red/white/blue fireworks. A retro orange propliner glides across now and then. Props: square pepperoni pizza box, two lemonades, a heart-shaped lantern. A small heart floats up between them once per loop. US flag on a pole |
| `la` | West Coast | Jul 8 - Jul 15 | you, niece, sister, brother-in-law | LA at night: palm silhouettes, a downtown skyline with one tall crowned tower, warm plaza string lights with hanging lanterns across the yard, a patio heater glow |
| `sandiego` | Zoo, Bricks & Bay | Jul 16 - Jul 31 | you (white tee) with the niece riding on your shoulders, waving; sister, brother-in-law | San Diego bay at dusk: palm-lined far shore, calm water band, a small boat. Two giraffes peek over the fence and an elephant silhouette stands far off. A toy-brick castle and an original brick cat sculpture in the yard (blocky primary colours, no minifigures) |
| `dc` | Birthday in DC | Aug 1 - Aug 24 | dad (guest of honour), you, niece, sister, brother-in-law | Washington skyline: Capitol dome and Washington Monument. A birthday table in the yard with a cake and flickering candles, balloons tied to the fence and party pennant bunting. Once per loop dad blows out the candles, everyone cheers, and the candles relight a little later (loop-safe) |
| `home` | Home to Boston | Aug 25 - Aug 31 | you + partner in the window; niece drops by | Boston skyline (as in Match Night) under a pink-violet late-dusk sky, plus the bridge pylons from the AZTMM logo. US flag on a pole. Fireflies. End-of-summer calm |

The existing `summer` edition (Firefly Midsummer) stays as May - Jun 10.

## Who draws what (module owners)

- **family** (new, `src/family.js`): every cat character, their per-chapter outfits,
  poses and animations, the niece's comings and goings, the shoulder ride, dad's
  candle moment and the anniversary heart. It also handles the cats' own small lights,
  if they have any.
- **house:** `cat-away` empties the series cat's window. It also draws:
  - bunting: `flags-matchday` (USA, Ireland, Scotland, Norway, France, Germany, Spain) and `bunting-party`;
  - `saltire-banner`: a big Scottish Saltire hanging from the upper window;
  - `tv-match` in the ground-left window;
  - `pub-sign`, an original hanging sign with a painted shamrock and a pint, hung off the porch;
  - `us-flag-pole`, if it's drawn on the house.
- **bg:** the city backdrops (`backdrop: boston | nyc | la | sandiego | dc`) replace
  the distant hills. They're cold night silhouettes with tiny warm window lights, plus
  the dusk skies for `sandiego` and `home`, and the retro propliner in `nyc`.
- **props:** summer tree (lush) in every chapter, plus these yard sets:
  - the football;
  - the anniversary bench with pizza box, lemonades and heart lantern;
  - plaza string lights with lanterns and a patio heater;
  - the giraffes, toy-brick castle and brick cat;
  - the birthday table with cake, balloons and candles. The candles' timing is shared with family through `HD.summer.candlesOut(t)`;
  - the flagpole with the US flag.
- **fire:** July 4th fireworks (red/white/blue) in `nyc`, the goal-cheer mini
  fireworks in `match`. No campfire in these chapters.
- **weather:** fireflies in `match`, `home` and `dc`. Clear, dry nights elsewhere, with a
  soft sea haze over the bay in `sandiego` (atmosphere).
- **atmosphere:** chimney smoke (thin), summer haze, sea mist for `sandiego`.
