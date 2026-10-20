// The two engines side by side (docs/AUE.md §3): the golden roster battles (tools/golden.mjs) made plain — chess pieces
// only, without items, bonds, band, 机变 / map cards, bounties or 练度, none of which AUE runs yet — played on Stronghold's
// sim and on AUE (the pieces as AUE's own operators), and their outcomes compared: enemies killed and leaked, the
// time, each piece's damage, attacks and skill starts. With --kits, the operators AUE plays by Stronghold's own kits
// (the 72 自选 kits of the commit AUE pins, through its compat layer — as 促融共竞 plays them) fight with them; with
// --chess-kits, every piece fights with its own chess kit of that commit (server/sim/content/kits/ops/chess_*.js) through
// the same layer, Stronghold's scripts on AUE's engine.
// With --covered-only, both engines meet only the enemies whose abilities AUE all has behaviours for (a control: what
// is left differs in the engines' common mechanics and the pieces).
// Usage: node tools/aue-diff.mjs [--only <scenario id>] [--json <file>] [--cap <seconds>] [--kits [<Stronghold commit dir>]] [--chess-kits] [--covered-only]
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_SOURCE, loadKits, foeBehaviors } from '@aue/content';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { rosterScenarios } from './golden.mjs';
import { runAue } from '../server/aue/battle.js';

const QUIET = { info() {}, warn() {}, error() {}, log() {} };
const data = getData({ log: QUIET });
const ds = new DataSource(data, null);

/** @param {string[]} argv @param {string} name */
const option = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

/** A golden scenario without what AUE does not run yet: only chess pieces, no items, bonds, band, cards, bounties, 练度. @param {any} sc */
export function plain(sc) {
  const players = sc.players.map((p) => ({
    ...p, bonds: {}, bandId: null, playerEffects: [], deviceOverrides: {},
    units: (p.units ?? []).filter((u) => u.kind === 'chess').map(({ items, cultivate, ...u }) => u),
  }));
  const spawns = sc.spawns.map(({ tag, bounty, ...s }) => ({ ...s, mods: Object.fromEntries(Object.entries(s.mods ?? {}).filter(([k]) => k !== 'bountyCoins')) }));
  return { ...sc, players, spawns, enemyOverrides: {} };
}

/** Talents AUE covers without a behaviour of their own (its FOE_COVERED). */
const COVERED = new Set(['dead', 'Light', 'DmgUp', 'Stronger', 'storm']);
/** @param {string} key @returns {boolean} whether AUE has a behaviour for each ability of an enemy */
function coveredEnemy(key) {
  const e = data.enemies[key];
  if (!e) return false;
  const names = [...Object.keys({ ...e.talents?.bb, ...e.talents?.bbStr }).map((k) => k.split('.')[0]), ...(e.skills ?? []).map((s) => s.prefabKey)];
  return names.every((n) => Object.hasOwn(foeBehaviors, n) || COVERED.has(n));
}
/** A plain scenario with only the enemies AUE covers. @param {any} sc */
const coveredOnly = (sc) => ({ ...sc, spawns: sc.spawns.filter((s) => coveredEnemy(s.enemyKey)) });

/** @param {any} sc @returns {any} the scenario's BattleSpec */
const specOf = (sc) => buildBattleSpec({
  battleId: sc.id, fieldId: 'g', kind: sc.kind, seed: sc.seed, modeId: sc.modeId, round: sc.round, stageId: sc.stageId, rect: sc.rect, timeLimit: sc.timeLimit,
  players: sc.players, spawns: sc.spawns, routes: sc.routes, flags: sc.flags, enemyOverrides: {}, waveId: sc.waveId ?? null, bossId: null, boss: null, content: 'full',
});

/** A spec on Stronghold's sim, to its end. @param {any} spec */
function runStronghold(spec) {
  const b = createBattleFromSpec(spec, ds, { quiet: true, logger: QUIET, recordEvents: false });
  while (!b.finished) {
    if (b.time >= spec.timeLimit - 1e-9) { b.forceEnd('forced'); break; }
    b.step();
  }
  const res = b.result();
  /** @type {Record<string, number[]>} */
  const enemies = {};
  for (const u of b.units) {
    if (u.side !== 'enemy') continue;
    const e = (enemies[u.defId] ??= [0, 0, 0]);
    e[0]++;
    if (u.removeReason === 'killed') e[1]++;
    else if (u.removeReason === 'leak') e[2]++;
  }
  const units = b.allyUnits.filter((u) => u.uid != null).map((u) => ({ uid: u.uid, def: u.defId, dmg: u.stats?.dmg ?? 0, kills: u.stats?.kills ?? 0, attacks: u.stats?.attacks ?? 0,
    casts: u.skill && !u.skill.noSkill ? u.skill.activations : 0, alive: u.alive, taken: Math.round(u.stats?.taken ?? 0) }));
  const leaked = Object.values(enemies).reduce((n, e) => n + e[2], 0);
  return { time: res.time, killed: res.killed, total: res.total, leaked, enemies, units };
}

/** @param {number} a @param {number} b */
const ratio = (a, b) => (b === 0 ? (a === 0 ? 1 : Infinity) : a / b);

/**
 * The kits of a scenario's pieces from a Stronghold commit (AUE's 兼容-6), through AUE's compat hook registered once.
 * @param {string | null} dir @param {any} spec
 */
async function kitsOf(dir, spec) {
  if (!dir) return {};
  const root = pathToFileURL(`${dir}/`).href;
  if (!kitsOf.hooked) {
    register(new URL('./compat/hook.js', import.meta.resolve('@aue/content')), { data: { root, compat: new URL('./compat/', import.meta.resolve('@aue/content')).href } });
    kitsOf.hooked = true;
  }
  const ids = spec.players.flatMap((p) => p.units.map((u) => data.chess[u.chessId]?.charId)).filter(Boolean);
  const kits = (await loadKits(root, ids)).kits;
  if (!kitsOf.chess) return kits;
  const ops = join(dir, 'server', 'sim', 'content', 'kits', 'ops'), files = readdirSync(ops).filter((f) => f.startsWith('chess_'));
  for (const u of spec.players.flatMap((p) => p.units)) {
    const charId = data.chess[u.chessId]?.charId, file = files.find((f) => f.startsWith(`${String(u.chessId).replace(/_[ab]$/, '')}-`));
    if (!charId || !file) continue;
    const factory = (await import(pathToFileURL(join(ops, file)).href)).default?.[u.chessId];
    if (typeof factory === 'function') kits[charId] = factory;
  }
  return kits;
}
kitsOf.chess = false;
compare.covered = false;
kitsOf.hooked = false;

/** One scenario on both engines. @param {any} sc @param {number} cap @param {string | null} kitDir */
async function compare(sc, cap, kitDir) {
  const spec = specOf(compare.covered ? coveredOnly(plain(sc)) : plain(sc));
  const kits = await kitsOf(kitDir, spec);
  const sh = runStronghold(spec), aue = await runAue(spec, data, { ...(cap ? { cap } : {}), kits });
  const byUid = new Map(aue.units.map((u) => [u.uid, u]));
  const units = sh.units.map((u) => {
    const a = byUid.get(u.uid);
    return { uid: u.uid, def: u.def, sh: { dmg: Math.round(u.dmg), attacks: u.attacks, casts: u.casts, alive: u.alive, taken: u.taken }, aue: a ? { dmg: Math.round(a.dmg), attacks: a.attacks, casts: a.casts, died: a.died ?? null } : null };
  });
  const dmg = (/** @type {any[]} */ list) => list.reduce((n, u) => n + u.dmg, 0);
  return {
    id: sc.id, stage: sc.stageId, round: sc.round, pieces: units.length, refused: aue.refused, uncovered: aue.uncovered,
    sh: { time: +sh.time.toFixed(2), killed: sh.killed, total: sh.total, leaked: sh.leaked, dmg: Math.round(dmg(sh.units)) },
    aue: { time: +aue.time.toFixed(2), killed: aue.killed, total: aue.total, leaked: aue.leaked, dmg: Math.round(dmg(aue.units)) },
    dmgRatio: +ratio(dmg(aue.units), dmg(sh.units)).toFixed(3), kits: Object.keys(kits).sort(), units,
  };
}

async function main(argv) {
  const only = option(argv, '--only'), json = option(argv, '--json'), cap = Number(option(argv, '--cap')) || 0;
  kitsOf.chess = argv.includes('--chess-kits');
  compare.covered = argv.includes('--covered-only');
  const kitArg = option(argv, '--kits'), wanted = argv.includes('--kits') || kitsOf.chess;
  const kitDir = kitArg && !kitArg.startsWith('--') ? kitArg : wanted ? join('engine', '.cache', 'oracle', `stronghold-${KIT_SOURCE.sha.slice(0, 12)}`) : null;
  if (kitDir && !existsSync(join(kitDir, 'server', 'sim', 'content'))) throw new Error(`no Stronghold commit at ${kitDir} (the engine's aue-check oracle fetches it)`);
  const scenarios = rosterScenarios().filter((sc) => !only || sc.id === only);
  const rows = [];
  for (const sc of scenarios) {
    try {
      rows.push(await compare(sc, cap, kitDir));
      if (rows.at(-1).sh?.total === 0) rows.pop();
    } catch (e) {
      rows.push({ id: sc.id, error: e.stack ?? String(e) });
    }
    const r = rows.at(-1);
    console.log(r.error ? `${r.id}: ERROR ${String(r.error).split('\n')[0]}`
      : `${r.id} ${r.stage} r${r.round}: killed ${r.sh.killed}/${r.sh.total} vs ${r.aue.killed}/${r.aue.total}, leaked ${r.sh.leaked} vs ${r.aue.leaked}, time ${r.sh.time} vs ${r.aue.time}, dmg ×${r.dmgRatio}${r.refused.length ? `, refused ${r.refused.length}: ${r.refused[0]}` : ''}`);
  }
  if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main(process.argv.slice(2));
