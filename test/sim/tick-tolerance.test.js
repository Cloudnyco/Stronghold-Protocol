// An attack interval or a time-SP cost that is a whole number of ticks takes exactly that many ticks. Floating point
// alone left a residue (1/30 is not a binary fraction): 1 s counted down in thirty steps of 1/30 stops at 2.1e-16, so an
// attack with a 1 s interval came every 31 ticks; 300 gains of 1/30 SP sum to 9.999999999999975, so a 10-SP charge took
// 301. ai.js attackCountdown and SkillRuntime.gainSp treat what is within 1e-9 as reached (docs/SIM.md §2, §7.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackCountdown } from '../../server/sim/ai.js';
import { TICK } from '../../server/sim/constants.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

test('the residue: thirty steps of 1/30 leave 1 s above 0, 300 gains of 1/30 leave 10 SP short', () => {
  let cd = 1;
  for (let i = 0; i < 30; i++) cd = Math.max(0, cd - TICK);
  assert.ok(cd > 0 && cd < 1e-15, `${cd}`);
  let sp = 0;
  for (let i = 0; i < 300; i++) sp += TICK;
  assert.ok(sp < 10 && sp > 10 - 1e-13, `${sp}`);
});

test('attackCountdown: every interval bat × 100 / aspd (bat 0.1 … 10 s, aspd 20 … 600) takes ⌈30 × interval⌉ ticks', () => {
  const wrong = [];
  for (let j = 1; j <= 100; j++) {
    const bat = j / 10;
    for (const aspd of [20, 50, 60, 75, 80, 100, 110, 120, 125, 150, 200, 240, 300, 600]) {
      const interval = (bat * 100) / aspd;                          // units.js _recalc
      const exact = 300 * j;                                        // 30 × interval = 300 j / aspd, in integers
      const want = exact % aspd === 0 ? exact / aspd : Math.ceil(exact / aspd);
      let left = interval, n = 0;
      while (left > 0) { left = attackCountdown(left, TICK); n++; }
      if (n !== want) wrong.push(`${bat} s @ ${aspd}: ${n} ticks, want ${want}`);
    }
  }
  assert.deepEqual(wrong, []);
});

/** Ticks between consecutive normal attacks of `id` (hook `attack`), over `seconds` of battle. */
function attackGaps(h, id, seconds) {
  h.run(seconds);
  const t = h.hooksOf('attack').filter((c) => c.attacker.id === id && !c.isSkill).map((c) => Math.round(c.t / TICK));
  return t.slice(1).map((x, i) => x - t[i]);
}

test('a 1 s operator attacks every 30 ticks, a 3 s ranged enemy every 90', () => {
  const h = makeBattle({
    defs: {
      chess: { t_one: chessRec({ id: 't_one', stats: { bat: 1, maxHp: 1e6 }, skill: null }) },
      enemies: { enemy_t_three: enemyRec({ key: 'enemy_t_three', hp: 1e9, speed: 0, bat: 3, atk: 1, range: 2.5 }) },
    },
    units: [{ chessId: 't_one', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_t_three', pos: [10, 5] }],
    hooks: ['attack'], captureNoisy: true, timeLimit: 60,
  });
  h.run(0.5);                                    // both deployed / spawned and fighting from here on
  const u = h.unit('t_one'), e = h.enemy('enemy_t_three');
  assert.equal(u.s.interval, 1);
  assert.equal(e.s.interval, 3);
  const ally = attackGaps(h, u.id, 20), enemy = h.hooksOf('attack').filter((c) => c.attacker.id === e.id).map((c) => Math.round(c.t / TICK));
  assert.ok(ally.length >= 15, `${ally.length} operator attacks`);
  assert.deepEqual([...new Set(ally)], [30]);
  const eg = enemy.slice(1).map((x, i) => x - enemy[i]);
  assert.ok(eg.length >= 5, `${eg.length} enemy attacks`);
  assert.deepEqual([...new Set(eg)], [90]);
  checkInvariants(h.b);
});

test('a time skill of cost N at 1 SP/s gets each charge after exactly 30 × N more gains (one and two charges)', () => {
  // 4, 10, 16 and 50 were a tick late (their float sums fall short); a second charge counts on from the first's remainder
  for (const charges of [1, 2]) for (const cost of [4, 10, 16, 20, 30, 50]) {
    const h = makeBattle({
      defs: { chess: { t_sp: chessRec({ id: 't_sp', skill: { spCost: cost, initSp: 0, maxChargeTime: charges } }) } },
      units: [{ chessId: 't_sp', row: 10, col: 4 }],
      timeLimit: charges * cost + 10, autoFinish: false,
    });
    const u = h.unit('t_sp');
    const at = [];
    let gains = 0;
    while (u.skill.charges < charges && gains < 30 * charges * cost + 5) {
      const sp = u.skill.sp, n = u.skill.charges;
      h.step(1);
      if (u.skill.sp !== sp || u.skill.charges > n) gains++;
      if (u.skill.charges > n) at.push(gains);
    }
    assert.deepEqual(at, Array.from({ length: charges }, (_, i) => 30 * cost * (i + 1)), `cost ${cost}, ${charges} charge(s)`);
    checkInvariants(h.b);
  }
});
