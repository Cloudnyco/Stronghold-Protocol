# AUE.md — the `aue` branch: Stronghold on the AUE engine

The `aue` branch runs Stronghold's battles on the [Arknights Universal Engine](https://github.com/ArknightsDevs/Arknights-Universal-Engine)
(AUE) instead of `server/sim`, keeping the match layer, the client and the plugins. This file is the branch's reference:
how the engine gets in, how a battle is translated, and what the measurements say. The master branch is unaffected.

## 1. The engine in the repository

- `engine/` is a git submodule of AUE, pinned to a commit (`git submodule update --init`).
- AUE's packages name each other with pnpm's `workspace:*` protocol, which npm cannot install. `npm run link-aue`
  (`tools/link-aue.mjs`; once after `npm install` and after the submodule moves) links
  `node_modules/@aue/{math,schema,sim,content}` to `engine/packages/*` — a directory junction on Windows, a symbolic link
  elsewhere. It is not part of `postinstall`: the release packages ship no engine yet (`tools/package.mjs` checks that
  every npm script it ships starts shipped files). Without the submodule nothing is linked and the vanilla game runs as
  before.
- ESLint ignores `engine/**`: the engine has its own checks (its `pnpm run ci`).

## 2. A battle on AUE (`server/aue/`)

`runAue(spec, data, { kits?, cap? })` (`server/aue/battle.js`) plays a normal field's BattleSpec on AUE and returns
its outcome in Stronghold's terms (enemies spawned / killed / leaked by key, each piece's damage, attacks and skill
starts by board uid, the time).

| Part | File | What it does |
|---|---|---|
| Field | `field.js` | the stage's tiles inside the spec's `rect` (`grid.js normalizeLegendEntry`), moved so the rect's bottom-left is AUE's row 0, column 0; the routes; every spawn as one SPAWN action at its time; tiles a piece stands on are deployable (the prep placed it: 特制水上平台 on 深水区 too) |
| Enemies | `enemies.js` | `data/enemies.json` records under AUE's names: the spawn's HP / ATK / speed multipliers, talents split by ability, skills (a first cooldown below 0 is ready at once, as `content/enemies/helpers.js` counts it), immunities |
| Pieces | `units.js` | each chess piece as its operator at the chess record's `status` (精英化, level, skill rank, module stage), with the spec's skill and module (else the record's) and potential (else 6); no trust bonus; deployed at frame 0 on its tile and direction |
| Skill strategies | `skills.js` | MANUAL skills start by the chess record's strategy (`skills[].trigger`) as AUE AUTO skills, with the 3 s operation cooldown — see the file's header for how each strategy is taken [ASSUMED for the range ones] |
| Level flag | — | the level file says it is being tested (AUE 关卡-8): enemy abilities AUE has no behaviour for yet are listed (`uncovered`), not refused |

Not translated yet: bonds, garrisons (特质), items, bands, 机变 / map cards, bounties, 练度, stand-ins, 自选 pieces, summons
placed on the board, devices, boss / unite / hidden-core fields.

## 3. Measuring the engines side by side (`tools/aue-diff.mjs`)

```bash
node tools/aue-diff.mjs                       # the 49 golden roster battles, plain, on both engines
node tools/aue-diff.mjs --only roster-013     # one battle
node tools/aue-diff.mjs --json out.json       # every piece's numbers
node tools/aue-diff.mjs --chess-kits          # the pieces with Stronghold's own chess kits through AUE's compat layer
node tools/aue-diff.mjs --covered-only        # only the enemies AUE has every ability of (a control)
```

"Plain" is a golden roster battle without what AUE does not run yet (§2): chess pieces only, no items, bonds, band,
cards, bounties or 练度. `--chess-kits` and `--kits` read the Stronghold commit AUE pins (its oracle,
`engine/.cache/oracle/stronghold-<sha12>`, fetched by the engine's `aue-check oracle`, or `--kits <dir>`).

### First measurement (2026-10-20, AUE a21b4a1)

Median of AUE's total damage over Stronghold's, and enemies killed (AUE / Stronghold), by round band:

| Rounds | Battles | AUE's own operators | Stronghold's chess kits on AUE | AUE's operators, enemies AUE covers only | Chess kits, enemies AUE covers only |
|---|---|---|---|---|---|
| 2–4 | 8 | ×1.03, 146 / 189 | ×1.04, 144 / 189 | ×1.08, 147 / 139 | ×1.03, 138 / 139 |
| 6–8 | 14 | ×0.79, 420 / 752 | ×0.95, 475 / 752 | ×1.03, 195 / 236 | ×1.03, 199 / 236 |
| 10 | 10 | ×0.62, 267 / 484 | ×0.80, 382 / 484 | ×0.83, 272 / 296 | ×0.89, 285 / 296 |
| 12–13 | 17 | ×0.47, 380 / 968 | ×0.76, 672 / 968 | ×0.51, 395 / 836 | ×0.76, 719 / 836 |

- Early rounds agree. The gap grows with the round.
- The pieces matter: with Stronghold's own chess kits through AUE's compat layer the top rounds rise from ×0.47 to
  ×0.76. A chess kit holds a piece's special parts; the common skill mechanics (several targets, areas, projectiles,
  attack speed and interval changes …) are still AUE's, and that is where most of the remaining per-piece difference lies.
- The enemies matter too: the 49 battles meet 170 enemy abilities AUE has no behaviour for yet (the most frequent:
  `refracting`, `DeadSpawn`, `EpDamage`, `stuncombat`, `Shield`, `PollutedDie`, `Bleeding`). With only the enemies AUE
  covers and the chess kits, rounds 2–8 agree within 5 %.
- The top rounds still differ by a quarter: the top pieces' own mechanics (浊心斯卡蒂, 琳琅诗怀雅, 荒芜拉普兰德, 引星棘刺,
  缄默德克萨斯, 乌尔比安 …) and, at ×3.6 enemy HP, a small gap that snowballs.
