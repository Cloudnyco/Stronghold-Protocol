// A Stronghold normal field run on the AUE engine (docs/AUE.md §2): its spec's stage, routes, spawns and pieces made
// into an AUE match — the level added to the official content as an extra level, the pieces as the seats' decks
// deployed at frame 0 — and run to its end or its time limit; the outcome in the terms of Stronghold's result.
import { FPS } from '@aue/math';
import { OFFICIAL_SOURCE, matchContent } from '@aue/content';
import { createWorld, step, deployProblem, KIND } from '@aue/sim';
import { enemyOf } from './enemies.js';
import { enemyVariants, levelOf } from './field.js';
import { decksOf } from './units.js';
import { autoSkills, opCooldown } from './skills.js';

/** The difficulty AUE plays the level at: it changes nothing here (the spec carries the spawns' multipliers). */
const PLAIN = Object.freeze({ enemyMul: [], hiddenGroups: [], replace: {}, unsupported: [] });

/**
 * The AUE content of a normal field's spec: the level file added to a content source, the match made from it.
 * @param {any} spec @param {{ chess: any, enemies: any, stages: any }} data Stronghold's data/*.json
 * @param {{ kits?: Record<string, any> }} [o] kit factories by character id (Stronghold's own kits through AUE's compat layer)
 */
export async function aueContent(spec, data, o = {}) {
  const stage = data.stages[spec.stageId];
  if (!stage) throw new Error(`no stage ${spec.stageId}`);
  const { keyOf, variants } = enemyVariants(spec.spawns);
  const level = levelOf(spec, stage, keyOf);
  const enemies = Object.fromEntries([...variants].map(([k, v]) => {
    const rec = data.enemies[v.key];
    if (!rec) throw new Error(`no enemy ${v.key}`);
    return [k, enemyOf(rec, v.mods)];
  }));
  // being tested (AUE 关卡-8): enemy abilities AUE has no behaviour for yet are named on the level, not refused
  const file = { level, difficulties: { NORMAL: PLAIN, FOUR_STAR: PLAIN }, enemies, devices: {}, testing: true };
  const source = { ...OFFICIAL_SOURCE, levels: { ...OFFICIAL_SOURCE.levels, [level.id]: file } };
  const { decks, deploys, pieces } = await decksOf(spec, data.chess, (id) => source.training(id));
  const content = /** @type {any} */ (await matchContent({ level: level.id, difficulty: 'NORMAL', seed: spec.seed >>> 0, decks }, { source, kits: o.kits ?? {} }));
  const auto = autoSkills(content, pieces);
  return { content, deploys, auto, total: spec.spawns.reduce((n, s) => n + (s.count ?? 1), 0) };
}

/**
 * A normal field's spec played on AUE to its end or its time limit: Stronghold's result in its terms — the enemies
 * spawned, killed and leaked by key, the pieces' damage, kills, attacks and skill starts by board uid —, the time, and
 * the deploys AUE refused.
 * @param {any} spec @param {{ chess: any, enemies: any, stages: any }} data @param {{ kits?: Record<string, any>, cap?: number }} [o]
 */
export async function runAue(spec, data, o = {}) {
  const { content, deploys, auto, total } = await aueContent(spec, data, o);
  const w = createWorld(content, { seed: spec.seed >>> 0, players: content.decks?.length ?? 1 });
  opCooldown(w, auto);
  const limit = Math.round((o.cap ?? spec.timeLimit ?? 90) * FPS);
  const keys = new Map(), uids = new Map(deploys.map((d) => [d.cmd.op, d.uid]));
  /** @type {Record<string, number[]>} spawned, killed, leaked */
  const enemies = {};
  /** @type {Map<number, { uid: any, def: string, dmg: number, kills: number, attacks: number, casts: number }>} */
  const units = new Map();
  // what AUE would refuse of each piece's deploy at frame 0 (部署-1), in the order the pieces go
  const refused = deploys.flatMap((d) => {
    const why = deployProblem(w, content, d.seat, d.cmd);
    return why ? [`${d.cmd.op} (${d.cmd.row},${d.cmd.col}): ${why}`] : [];
  });
  step(w, content, deploys.map((d) => [d.seat, d.cmd]));
  for (;;) {
    for (const e of w.events) tally(e, { keys, uids, enemies, units, w });
    if (w.result >= 0 || w.frame >= limit) break;
    step(w, content, []);
  }
  const killed = Object.values(enemies).reduce((n, e) => n + e[1], 0), leaked = Object.values(enemies).reduce((n, e) => n + e[2], 0);
  const uncovered = /** @type {any} */ (content.level).uncovered ?? [];
  return { time: w.frame / FPS, result: w.result, total, killed, leaked, enemies, units: [...units.values()], refused, uncovered };
}

/**
 * One presentation event counted.
 * @param {Record<string, any>} e @param {{ keys: Map<number, string>, uids: Map<string, any>, enemies: Record<string, number[]>, units: Map<number, any>, w: any }} s
 */
function tally(e, s) {
  const unit = (/** @type {number} */ id) => s.units.get(id);
  if (e.type === 'spawn') {
    const base = String(e.key).split('@')[0];
    s.keys.set(e.id, base);
    (s.enemies[base] ??= [0, 0, 0])[0]++;
  } else if (e.type === 'deploy') {
    const u = s.w.units.find((x) => x.id === e.id);
    if (u?.kind === KIND.OPERATOR && s.uids.has(e.key)) s.units.set(e.id, { uid: s.uids.get(e.key), def: e.key, dmg: 0, kills: 0, attacks: 0, casts: 0 });
  } else if (e.type === 'death' && s.keys.has(e.id)) {
    s.enemies[/** @type {string} */ (s.keys.get(e.id))][1]++;
  } else if (e.type === 'death' && unit(e.id)) {
    unit(e.id).died = +(s.w.frame / FPS).toFixed(1);
  } else if (e.type === 'goal' && s.keys.has(e.id)) {
    s.enemies[/** @type {string} */ (s.keys.get(e.id))][2]++;
  } else if (e.type === 'hit' && unit(e.id)) {
    unit(e.id).dmg += Number(e.damage) || 0;
  } else if (e.type === 'attack' && unit(e.id)) {
    unit(e.id).attacks++;
  } else if (e.type === 'skill' && e.active === 1 && unit(e.id)) {
    unit(e.id).casts++;
  }
}
