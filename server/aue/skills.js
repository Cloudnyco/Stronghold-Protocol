// The automatic operations of a battle (docs/AUE.md §2; PRTS 卫戍协议/帮助 §作战阶段 技能操作): nobody commands a
// field, so every piece's MANUAL skill starts by its skill strategy (data/chess.json skills[].trigger) — for AUE an AUTO
// skill whose trigger is that strategy — and no sooner than 3 s after the battle starts or after its last start
// (Stronghold's AUTO_OP_COOLDOWN). The strategies, as the first measurement takes them [ASSUMED where marked]:
//   DEFAULT          AUE's own AUTO rule: as the piece is about to attack — at once for an instant skill or a piece that
//                    makes no normal attacks;
//   SP_FULL, ALWAYS  as soon as the skill is ready;
//   TAKE_DAMAGE      as soon as it is ready in a frame the piece took damage, else as DEFAULT [ASSUMED: else];
//   SEARCH, SKILL_RANGE, CUSTOM_RANGE, ACTIVE_RANGE   as soon as it is ready while an enemy is within the strategy's
//                    grid — as a radius around the piece [ASSUMED], the piece's own range when the strategy has none —,
//                    else as DEFAULT;
//   GDGLOW_SKILL_2   as soon as it is ready while an enemy is on the field.
import { bus, buffs, KIND } from '@aue/sim';

/** Stronghold's AUTO_OP_COOLDOWN, in frames. */
const OP_COOLDOWN = 90;
const RANGED_RULES = Object.freeze(['SEARCH', 'SKILL_RANGE', 'CUSTOM_RANGE', 'ACTIVE_RANGE']);

/** @typedef {{ w: any, hit: WeakMap<object, number> }} Box the world once made, the frame each unit last took damage */

/** @param {{ row: number, col: number }[] | number[][] | null | undefined} cells @returns {number} the farthest cell's distance, plus half a tile */
function radiusOf(cells) {
  let r = 0;
  for (const c of cells ?? []) {
    const [dr, dc] = Array.isArray(c) ? c : [c.row, c.col];
    r = Math.max(r, Math.sqrt(dr * dr + dc * dc));
  }
  return r + 0.5;
}

/** @param {any} w @param {any} u @param {number} radius @returns {boolean} whether a living enemy is within the radius of a unit */
const enemyNear = (w, u, radius) => w.units.some((e) => e.kind === KIND.ENEMY && e.hp > 0 && !e.hidden && (e.x - u.x) ** 2 + (e.y - u.y) ** 2 <= radius * radius);

/**
 * A strategy as an AUE trigger (see the header), or undefined for AUE's own rule.
 * @param {string} rule @param {any} trigger the skill's data/chess.json trigger @param {any} op the operator's AUE record @param {Box} box
 */
function triggerOf(rule, trigger, op, box) {
  if (rule === 'SP_FULL' || rule === 'ALWAYS') return 'ready';
  if (rule === 'TAKE_DAMAGE') return (/** @type {any} */ ctx) => ((box.hit.get(ctx.self) ?? -9) >= box.w.frame - 1 ? 'ready' : 'attack');
  if (rule === 'GDGLOW_SKILL_2') return (/** @type {any} */ ctx) => (enemyNear(box.w, ctx.self, 1e6) ? 'ready' : 'attack');
  if (RANGED_RULES.includes(rule)) {
    const radius = radiusOf(trigger?.customRangeGrid ?? op.range);
    return (/** @type {any} */ ctx) => (enemyNear(box.w, ctx.self, radius) ? 'ready' : 'attack');
  }
  return undefined;
}

/**
 * The content's MANUAL skills of the pieces made AUTO with their strategies' triggers.
 * @param {any} content an AUE match's content @param {Map<string, any>} pieces each operator key's chess record and skill index
 * @returns {{ keys: Set<string>, box: Box }} the operator keys whose skills start automatically; what their triggers read
 */
export function autoSkills(content, pieces) {
  const keys = new Set(), box = /** @type {Box} */ ({ w: null, hit: new WeakMap() });
  for (const [key, { chess, skill }] of pieces) {
    const op = content.operators[key], sk = op?.skill;
    if (!sk || sk.type !== 'MANUAL') continue;
    const trigger = chess.skills?.find((s) => s.index === skill)?.trigger;
    const t = triggerOf(trigger?.rule ?? 'DEFAULT', trigger, op, box);
    content.operators[key] = { ...op, skill: { ...sk, type: 'AUTO' } };
    if (t !== undefined) content.behaviors = { ...content.behaviors, skills: { ...content.behaviors?.skills, [sk.id]: { ...content.behaviors?.skills?.[sk.id], trigger: t } } };
    keys.add(key);
  }
  return { keys, box };
}

/**
 * The operation cooldown (Stronghold's AUTO_OP_COOLDOWN): a 3 s 静默 of the skill from the battle's start and after
 * each automatic start while a charge is ready at once; and the frame each unit last took damage, for TAKE_DAMAGE.
 * @param {any} w the AUE world @param {{ keys: Set<string>, box: Box }} auto
 */
export function opCooldown(w, { keys, box }) {
  box.w = w;
  const hold = (/** @type {any} */ u) => buffs.addBuff(u, buffs.makeBuff({ key: 'aue:opCooldown', left: OP_COOLDOWN, flags: { mute: true } }));
  bus.on(w, 'deploy', (k) => { if (w.frame <= 1 && keys.has(k.unit?.key)) hold(k.unit); });
  bus.on(w, 'skillStart', (k) => {
    const u = k.unit;
    if (keys.has(u?.key) && u.skill.cost > 0 && u.skill.sp >= u.skill.cost) hold(u);
  });
  bus.on(w, 'damaged', (k) => { if (k.target) box.hit.set(k.target, w.frame); });
}
