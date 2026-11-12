// Proves every hand-made wall: the written solution carries water from the
// spring to the sea through every lock, the scrambled start does not, and the
// hint solver can finish it. Run with: npm run verify-levels
import { LEVELS, makeBoard, solvedBoard } from '../src/game/levels.ts';
import { nextMove } from '../src/game/solver.ts';
import { kindOf, opFlip, opSwap, opTurn, opWhirl, trace } from '../src/game/tiles.ts';

let failed = false;
LEVELS.forEach((def, i) => {
  const solved = trace(solvedBoard(def, i));
  const b = makeBoard(i);
  const start = trace(b);
  let moves = 0;
  for (; moves < 200; moves++) {
    const m = nextMove(b);
    if (!m) break;
    if (m.type === 'turn') opTurn(m.tile, m.dir);
    else if (m.type === 'swap') opSwap(b, m.a, m.b);
    else if (m.type === 'flip') opFlip(m.tile);
    else opWhirl(b, m.tile, m.dir);
  }
  const end = trace(b);
  const whirlOk = b.tiles.filter((t) => kindOf(t) === 'whirl').every((w) => w.x > 0 && w.y > 0 && w.x < b.w - 1 && w.y < b.h - 1);
  const ok = solved.solved && !start.reached && end.solved && whirlOk;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${i + 1} ${def.name.padEnd(14)} ${b.w}x${b.h}  route ${solved.steps.length} tiles, locks ${solved.locks}/${solved.locksTotal}, ` +
      `start joined ${start.steps.length}, solver ${moves} moves, solved ${end.solved}`,
  );
});
process.exit(failed ? 1 : 0);
