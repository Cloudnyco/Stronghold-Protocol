// A player's pieces as AUE operators (docs/AUE.md §2): each chess piece is its operator at the chess record's training
// (精英化, level, skill rank, module stage — data/chess.json `status`), with the piece's skill and module (DESIGN §16:
// the spec's `skillIndex` / `moduleId`, else the record's own) and its potential (else 6). No trust bonus: a chess
// record's numbers carry none (DATA.md §2).
import { DIR } from '@aue/schema';

/** Stronghold's deploy directions → AUE's. */
export const DIRS = Object.freeze({ UP: DIR.UP, RIGHT: DIR.RIGHT, DOWN: DIR.DOWN, LEFT: DIR.LEFT });

/**
 * The training AUE fields a piece at (干员-1): its record's status, its skill and module.
 * @param {any} unit a spec's players[].units[] entry @param {any} chess its data/chess.json record
 * @param {{ modules: { id: string }[], skills: ({ id: string } | null)[] }} training the operator's AUE record
 */
export function buildOf(unit, chess, training) {
  const st = chess.status, skillId = chess.skill?.skillId;
  const skill = Number.isInteger(unit.skillIndex) ? unit.skillIndex : Math.max(-1, training.skills.findIndex((s) => s?.id === skillId));
  const wanted = typeof unit.moduleId === 'string' ? unit.moduleId : chess.module?.active ? chess.module.id : 'none';
  const module = wanted === 'none' ? -1 : training.modules.findIndex((m) => m.id === wanted);
  return {
    elite: st.phase, level: st.level, potential: Number.isInteger(unit.potential) ? unit.potential : 6, trust: 0, skill, skillLevel: Math.max(1, st.skillLevel),
    ...(module >= 0 ? { module, moduleLevel: Math.max(1, st.equipLevel) } : {}),
  };
}

/**
 * A spec's players as AUE decks, seat by seat (同步-9), each piece's deploy at frame 0 — its tile in the level (the
 * rect's bottom-left is 0, 0) and its direction —, and each operator key's chess record and skill. Pieces that are not
 * chess (summons on the board, items) are left out.
 * @param {any} spec @param {Record<string, any>} chessData data/chess.json @param {(charId: string) => Promise<any>} training
 */
export async function decksOf(spec, chessData, training) {
  const decks = [], deploys = [], pieces = new Map();
  for (const [seat, p] of spec.players.entries()) {
    const deck = [];
    for (const u of p.units ?? []) {
      const chess = u.kind === 'chess' ? chessData[u.chessId] : null;
      if (!chess?.charId || deck.some((d) => d.id === chess.charId)) continue;
      const build = buildOf(u, chess, await training(chess.charId));
      deck.push({ id: chess.charId, build });
      pieces.set(`${chess.charId}#${seat}`, { chess, skill: build.skill });
      deploys.push({ seat, cmd: { type: 'deploy', op: `${chess.charId}#${seat}`, row: u.row - spec.rect.r0, col: u.col - spec.rect.c0, dir: DIRS[u.dir] ?? DIR.RIGHT }, uid: u.uid });
    }
    decks.push(deck);
  }
  return { decks, deploys, pieces };
}
