# SABLE LINE

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/daring-falcon-58/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/daring-falcon-58/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

SABLE LINE is a round-based tactical first-person shooter in the style Counter-Strike made famous — built on three.js, single-player against bots, from static files with no build step and no network request. You lead four Viper bots against five Jackal bots on Kestrel Yard, a dusk rail yard with two bomb sites: plant the spike at A (Silos) or B (Depot), or eliminate the other team. Money earned each round buys rifles, SMGs, a DMR and frag grenades; gunfire rewards stopping to aim, with recoil, spread bloom, headshots and damage falloff. Bots patrol routes, hold angles, react to what they see and hear, push sites, and defuse the spike. The yard reads at dusk: a gradient sky with stars and a low western sun, painted asphalt with site letters on the ground, and a dark gunmetal view model per weapon with amber sights.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Click to play.

## How to play

- **W A S D** move, **mouse** look, **click** fire, **R** reload, **right-click** aim
- **1–4** switch weapon, **G** throw a frag grenade, **B** buy menu (buy phase), **E** plant the spike inside a site, **Ctrl** crouch, **Space** jump, **M** mute
- First to 5 rounds wins the match. Kills pay $300, a round win pays $3250.

## Layout

- `game/` — the playable game: `index.html` plus ES modules under `src/` (world, player, weapons, bots, rounds, grenades, effects, audio, HUD, input), three.js 0.187.0 vendored under `game/vendor/three/`
- `screenshots/` — real renders of the game's own code
- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged

---

<sub>Entered on [make.fun](https://make.fun/?ref=7053etrm&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
