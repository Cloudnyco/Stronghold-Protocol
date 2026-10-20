// A Stronghold battle's field as an AUE level (docs/AUE.md §2): the stage's tiles inside the battle's rect, its routes
// and its spawns, moved so that the rect's bottom-left tile is the level's row 0, column 0. Rows count from the bottom
// in both engines; Stronghold's [row, col] pairs become AUE's { row, col }.
import { normalizeLegendEntry } from '../sim/grid.js';

/** Stronghold's ways through a tile → AUE's passable. */
const PASS = Object.freeze({ ALL: 'ALL', FLY: 'FLY_ONLY', NONE: 'NONE' });
/** tiles/s = moveSpeed × this, in both engines (Stronghold MOVE_SCALE, the official levels' moveMultiplier). */
const MOVE_MULTIPLIER = 0.5;
/** Pre-placed units cost nothing in Stronghold: AUE deploys them at frame 0 from a purse this large. [ASSUMED] */
const PURSE = 999;

/**
 * The rect's tiles as AUE's, row by row from the bottom.
 * @param {any} stage a data/stages.json record @param {{ r0: number, r1: number, c0: number, c1: number }} rect
 * @param {Set<string>} occupied the "row,col" tiles the spec's pieces stand on
 */
function tilesOf(stage, rect, occupied) {
  const legend = stage.legend ?? stage.tiles ?? {};
  const out = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const line = stage.rows[r] ?? '';
    const row = [];
    for (let c = rect.c0; c <= rect.c1; c++) {
      const t = normalizeLegendEntry(line[c] ?? 'X', legend[line[c]]);
      // a piece stands where the prep put it (a 特制水上平台 on 深水区 too): the battle does not check it again
      const build = occupied.has(`${r},${c}`) && t.build === 'NONE' ? 'ALL' : t.build;
      row.push({ key: t.key, height: t.height === 'HIGH' ? 'HIGHLAND' : 'LOWLAND', buildable: build, passable: PASS[t.pass] ?? 'NONE', side: 'ALL' });
    }
    out.push(row);
  }
  return out;
}

/** @param {[number, number]} p @param {{ r0: number, c0: number }} rect */
const at = ([r, c], rect) => ({ row: r - rect.r0, col: c - rect.c0 });

/**
 * A spec's routes as AUE's: start, end and the checkpoints between, each a MOVE.
 * @param {any[]} routes @param {{ r0: number, c0: number }} rect
 */
const routesOf = (routes, rect) => routes.map((r) => ({
  motion: r.motion === 'FLY' ? 'FLY' : 'WALK', start: at(r.start, rect), end: at(r.end, rect), allowDiagonal: false, spawnOffset: { x: 0, y: 0 },
  checkpoints: (r.checkpoints ?? []).map((p) => ({ type: 'MOVE', ...at(p, rect), time: 0, dx: 0, dy: 0 })),
}));

/**
 * The enemy key a spawn's units have in the level: the enemy's own key when every spawn of it has the same multipliers,
 * else one key per set of them ("<key>@<n>").
 * @param {any[]} spawns @returns {{ keyOf: (s: any) => string, variants: Map<string, { key: string, mods: Record<string, number> }> }}
 */
export function enemyVariants(spawns) {
  const sets = new Map();
  for (const s of spawns) {
    const m = JSON.stringify({ hp: s.mods?.hpMul ?? 1, atk: s.mods?.atkMul ?? 1, speed: s.mods?.speedMul ?? 1 });
    if (!sets.has(s.enemyKey)) sets.set(s.enemyKey, []);
    if (!sets.get(s.enemyKey).includes(m)) sets.get(s.enemyKey).push(m);
  }
  const variants = new Map();
  for (const [key, list] of sets) list.forEach((m, i) => variants.set(list.length === 1 ? key : `${key}@${i}`, { key, mods: JSON.parse(m) }));
  const keyOf = (/** @type {any} */ s) => {
    const list = sets.get(s.enemyKey), i = list.indexOf(JSON.stringify({ hp: s.mods?.hpMul ?? 1, atk: s.mods?.atkMul ?? 1, speed: s.mods?.speedMul ?? 1 }));
    return list.length === 1 ? s.enemyKey : `${s.enemyKey}@${i}`;
  };
  return { keyOf, variants };
}

/**
 * The level of a normal field's spec (AUE's level record, 关卡-1): the rect, its routes, one wave of every spawn at its
 * time, nothing that ends it but its enemies — the time limit is the caller's.
 * @param {any} spec a BattleSpec @param {any} stage its stage's data/stages.json record @param {(s: any) => string} keyOf
 */
export function levelOf(spec, stage, keyOf) {
  const occupied = new Set(spec.players.flatMap((p) => (p.units ?? []).map((u) => `${u.row},${u.col}`)));
  const rect = spec.rect, tiles = tilesOf(stage, rect, occupied);
  const actions = [...spec.spawns].sort((a, b) => a.time - b.time).map((s) => ({
    type: 'SPAWN', key: keyOf(s), route: s.routeIndex, count: s.count ?? 1, interval: s.interval ?? 0, preDelay: s.time,
  }));
  return {
    id: `sh:${spec.stageId}`, code: spec.stageId, name: stage.name ?? spec.stageId, width: rect.c1 - rect.c0 + 1, height: rect.r1 - rect.r0 + 1, bgm: '', view: [],
    options: { characterLimit: 99, costIncreaseTime: 1, initialCost: PURSE, maxCost: PURSE, maxLifePoint: 999, moveMultiplier: MOVE_MULTIPLIER },
    tiles, routes: routesOf(spec.routes, rect), predefines: [], stages: [],
    waves: [{ preDelay: 0, postDelay: 0, maxWait: -1, fragments: [{ preDelay: 0, actions }] }],
  };
}
