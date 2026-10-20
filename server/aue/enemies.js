// Stronghold's enemy records (data/enemies.json) as AUE's (docs/AUE.md §2): the same official numbers under AUE's
// names, a spawn's multipliers applied, the talents' "<ability>.<key>" blackboard split by ability, the skills and the
// immunities as AUE reads them. AUE adds its own ability extras and attack timings by the enemy's key.

/** Stronghold's immunity names → AUE's. */
const IMMUNE = Object.freeze({ stun: 'stun', silence: 'silence', sleep: 'sleep', frozen: 'freeze', levitate: 'levitate' });

/** @param {Record<string, number | string>} bb a flat "<ability>.<key>" blackboard @returns {Record<string, Record<string, number | string>>} */
function talentsOf(bb) {
  /** @type {Record<string, Record<string, number | string>>} */
  const out = {};
  for (const [k, v] of Object.entries(bb ?? {})) {
    const dot = k.indexOf('.'), ability = dot > 0 ? k.slice(0, dot) : k, key = dot > 0 ? k.slice(dot + 1) : 'value';
    (out[ability] ??= {})[key] = v;
  }
  return out;
}

/**
 * An enemy as AUE's (敌人-1, 敌能-1), with a spawn's multipliers.
 * @param {any} rec a data/enemies.json record @param {{ hp: number, atk: number, speed: number }} mods
 * @returns {Record<string, any>}
 */
export function enemyOf(rec, mods) {
  const s = rec.stats;
  const immune = [...Object.entries(s.immunities ?? {}).filter(([, on]) => on).map(([k]) => IMMUNE[k] ?? k), ...(s.otherImmunities ?? [])];
  // a first cooldown below 0 is ready at once, as Stronghold counts it (content/enemies/helpers.js)
  const skills = (rec.skills ?? []).map((k) => ({ key: k.prefabKey, sp: k.spCost ?? 0, cooldown: k.cooldown ?? 0, initCooldown: Math.max(0, k.initCooldown ?? 0), bb: { ...k.bb, ...k.bbStr } }));
  return {
    name: rec.name, maxHp: s.maxHp * mods.hp, atk: s.atk * mods.atk, def: s.def, res: s.res, moveSpeed: s.moveSpeed * mods.speed, baseAttackTime: s.bat,
    rangeRadius: s.rangeRadius, applyWay: rec.applyWay, motion: s.motion === 'FLY' ? 'FLY' : 'WALK', massLevel: s.massLevel, levelType: rec.rank,
    lifePointReduce: s.lpr ?? 1, tags: rec.tags ?? [], talents: talentsOf({ ...rec.talents?.bb, ...rec.talents?.bbStr }), immune,
    ...(skills.length ? { skills } : {}), ...(s.dmgType === 'arts' ? { dmgType: 'arts' } : {}),
    ...(rec.attackAnim ? { attack: { duration: rec.attackAnim.dur, hit: rec.attackAnim.hit } } : {}),
  };
}
