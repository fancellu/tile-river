// Proves every hand-made wall. Run with: npm run verify-levels
//  - the written solution carries water from the spring to the sea through every lock
//  - the scrambled start does not, and the hint solver can finish it
//  - the wall fits the renderer (atlas space, size, whirlpool rings)
//  - the stored par is the true fewest moves, by any river (proved by search,
//    and the par moves are replayed on a fresh wall)
//  - every idea the wall shows (swap, bridge, whirlpool, two faces) is needed:
//    without it the wall cannot be finished in par
// Env: ONLY=3,9 checks some walls; BUDGET_MS sets the search time limit per search.
import { LEVELS, makeBoard, solvedBoard } from '../src/game/levels.ts';
import { nextMove } from '../src/game/solver.ts';
import { at, kindOf, opFlip, opSwap, opTurn, opWhirl, trace } from '../src/game/tiles.ts';
import { ATLAS_COLS, ATLAS_ROWS } from '../src/render/shaders.ts';
import { analyse, trueMinimum } from './rivers.ts';

// limits of the renderer: atlas cells for painted faces, and the wall size the camera frames
const FACES = ATLAS_COLS * ATLAS_ROWS - 12;
const MAX_W = 8;
const MAX_H = 6;
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 180_000);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

let failed = false;
LEVELS.forEach((def, i) => {
  if (ONLY && !ONLY.includes(i + 1)) return;
  const notes: string[] = [];
  const solved = trace(solvedBoard(def, i));
  const b = makeBoard(i);
  const start = trace(b);

  const t0 = performance.now();
  const a = analyse(def, i, BUDGET_MS);
  const secs = (performance.now() - t0) / 1000;
  const brute = trueMinimum(makeBoard(i), Math.min(a.par, 3));
  if (def.par !== a.par) notes.push(`stored par ${def.par}, computed ${a.par}`);
  if (!a.replayOk) notes.push('the par moves do not replay to a finished wall');
  if (brute !== null && brute !== a.par) notes.push(`exhaustive search found ${brute} moves`);
  if (!a.complete) notes.push('the river search ran out of time, so par is not proved minimal');
  if (a.unneeded.length) notes.push(`can be finished in par without: ${a.unneeded.join(', ')}`);
  if (a.undecided.length) notes.push(`ran out of time checking: ${a.undecided.join(', ')}`);

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
  if (!whirlOk) notes.push('a whirlpool is on the edge, has a fixed tile in its ring, or overlaps another');
  const faces = sb.tiles.reduce((n, t) => n + t.faces.length, 0);
  const sizeOk = faces <= FACES && sb.w <= MAX_W && sb.h <= MAX_H;
  if (!sizeOk) notes.push(`too big: ${sb.w}x${sb.h}, ${faces} faces (max ${MAX_W}x${MAX_H}, ${FACES} faces)`);
  if (!solved.solved) notes.push('the written solution does not reach the sea through every lock');
  if (start.reached) notes.push('the scrambled start already reaches the sea');
  if (!end.solved) notes.push('the hint solver cannot finish it');

  const ok = notes.length === 0 && a.par > 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(i + 1).padStart(2)} ${def.name.padEnd(16)} ${b.w}x${b.h}  par ${String(a.par).padStart(2)} ` +
      `(designed river ${a.designed}, hint solver ${moves}, ${secs.toFixed(1)} s)`,
  );
  for (const n of notes) console.log('       ' + n);
});
process.exit(failed ? 1 : 0);
