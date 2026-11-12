// Proves every hand-made wall: the written solution carries water from the
// spring to the sea through every lock, the scrambled start does not, and the
// hint solver can finish it. Run with: npm run verify-levels
import { LEVELS, makeBoard, solvedBoard } from '../src/game/levels.ts';
import { nextMove } from '../src/game/solver.ts';
import { at, kindOf, opFlip, opSwap, opTurn, opWhirl, trace } from '../src/game/tiles.ts';
import { ATLAS_COLS, ATLAS_ROWS } from '../src/render/shaders.ts';

// limits of the renderer: atlas cells for painted faces, and the wall size the camera frames
const FACES = ATLAS_COLS * ATLAS_ROWS - 12;
const MAX_W = 8;
const MAX_H = 6;

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
  // whirlpools: one tile in from the edge, no fixed tile in the ring, rings never overlap
  const sb = solvedBoard(def, i);
  const ringCells = new Set<number>();
  let whirlOk = true;
  for (const w of sb.tiles.filter((t) => kindOf(t) === 'whirl')) {
    if (!(w.x > 0 && w.y > 0 && w.x < sb.w - 1 && w.y < sb.h - 1)) whirlOk = false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = at(sb, w.x + dx, w.y + dy);
        if (!t) continue;
        const c = t.y * sb.w + t.x;
        if (ringCells.has(c) || ((dx || dy) && t.fixed)) whirlOk = false;
        ringCells.add(c);
      }
  }
  const faces = sb.tiles.reduce((n, t) => n + t.faces.length, 0);
  const sizeOk = faces <= FACES && sb.w <= MAX_W && sb.h <= MAX_H;
  const ok = solved.solved && !start.reached && end.solved && whirlOk && sizeOk;
  if (!whirlOk) console.log('     a whirlpool is on the edge, has a fixed tile in its ring, or overlaps another');
  if (!sizeOk) console.log(`     too big: ${sb.w}x${sb.h}, ${faces} faces (max ${MAX_W}x${MAX_H}, ${FACES} faces)`);
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(i + 1).padStart(2)} ${def.name.padEnd(16)} ${b.w}x${b.h}  route ${solved.steps.length} tiles, locks ${solved.locks}/${solved.locksTotal}, ` +
      `start joined ${start.steps.length}, solver ${moves} moves, solved ${end.solved}`,
  );
});
process.exit(failed ? 1 : 0);
