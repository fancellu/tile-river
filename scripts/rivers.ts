// Searches used to prove a wall's par and to check what the wall teaches.
// Shared by verify-levels.ts and by the wall design harness.
import { type LevelDef, scramble, solvedBoard } from '../src/game/levels.ts';
import { type Limits, type Move, designedRiver, fitCost, nextMove, riverCost } from '../src/game/solver.ts';
import { type Board, DX, DY, at, canDrag, kindOf, localExit, opFlip, opSwap, opTurn, opWhirl, ringOf, trace } from '../src/game/tiles.ts';

/** A wall in its scrambled starting state, from any definition. */
export function boardOf(def: LevelDef, index: number): Board {
  const b = solvedBoard(def, index);
  scramble(b, def);
  return b;
}

/** Play a list of moves on a board; true if the water then reaches the sea through every lock. */
export function playOut(b: Board, plan: Move[]): boolean {
  for (const m of plan) {
    if (m.type === 'turn') opTurn(m.tile, m.dir);
    else if (m.type === 'swap') opSwap(b, m.a, m.b);
    else if (m.type === 'flip') opFlip(m.tile);
    else if (!opWhirl(b, m.tile, m.dir)) return false;
  }
  return trace(b).solved;
}

/** Moves the hint solver needs: an upper bound for par. */
export function solverMoves(b: Board): number {
  let n = 0;
  for (let m = nextMove(b); m && n < 400; m = nextMove(b), n++) playOut(b, [m]);
  return n;
}

/**
 * Breadth-first search over every move a player can make, to the first state
 * where the water reaches the sea through every lock, by any route. Identical
 * tiles count as the same state. Returns null when the search grows too large.
 */
export function trueMinimum(b: Board, limit: number, cap = 400_000): number | null {
  const key = () => b.cells.map((t) => `${t.faces.join('')}${t.face}${t.rot}`).join(',');
  const snap = () => {
    const s = new Int8Array(b.tiles.length * 4);
    b.tiles.forEach((t, i) => s.set([t.x, t.y, t.rot, t.face], i * 4));
    return s;
  };
  const load = (s: Int8Array) => {
    b.tiles.forEach((t, i) => {
      t.x = s[i * 4];
      t.y = s[i * 4 + 1];
      t.rot = s[i * 4 + 2];
      t.face = s[i * 4 + 3];
    });
    for (const t of b.tiles) b.cells[t.y * b.w + t.x] = t;
  };
  const start = snap();
  let frontier = [start];
  const seen = new Set([key()]);
  for (let d = 0; d <= limit; d++) {
    const next: Int8Array[] = [];
    for (const st of frontier) {
      load(st);
      if (trace(b).solved) {
        load(start);
        return d;
      }
      if (d === limit) continue;
      const tryMove = (apply: () => void, undo: () => void) => {
        apply();
        const k = key();
        if (!seen.has(k)) {
          seen.add(k);
          next.push(snap());
        }
        undo();
      };
      if (seen.size > cap) {
        load(start);
        return null;
      }
      const loose = b.tiles.filter((t) => canDrag(b, t));
      for (const t of b.tiles) {
        if (kindOf(t) === 'whirl') {
          if (!ringOf(b, t)) continue;
          for (const dir of [1, -1]) tryMove(() => opWhirl(b, t, dir), () => opWhirl(b, t, -dir));
          continue;
        }
        if (t.fixed) continue;
        for (const dir of [1, -1]) tryMove(() => opTurn(t, dir), () => opTurn(t, -dir));
        if (t.faces.length === 2) tryMove(() => opFlip(t), () => opFlip(t));
      }
      for (let i = 0; i < loose.length; i++)
        for (let j = i + 1; j < loose.length; j++) tryMove(() => opSwap(b, loose[i], loose[j]), () => opSwap(b, loose[i], loose[j]));
    }
    frontier = next;
  }
  load(start);
  return null;
}

export interface RiverLimits extends Limits {
  noCross?: boolean; // the river may not cross itself on a bridge tile
}

/**
 * Every finished wall has some river from the spring to the sea, and riverCost
 * is exact for a given river. So walk every river the tiles could make (pruned
 * by the tiles available and by the best cost so far) and keep the cheapest
 * below `bound`. Returns the cost (or `bound` if none is cheaper), its moves,
 * and whether the walk finished inside the time budget.
 */
export function cheapestRiver(b: Board, bound: number, budgetMs: number, lim: RiverLimits = {}): { cost: number; complete: boolean; plan: Move[] } {
  const spring = b.tiles.find((t) => kindOf(t) === 'spring')!;
  const lockCells = b.tiles.filter((t) => kindOf(t) === 'lock').map((t) => t.y * b.w + t.x);
  const ring = new Set<number>();
  for (const w of b.tiles)
    if (kindOf(w) === 'whirl')
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ring.add((w.y + dy) * b.w + w.x + dx);
  // what the movable tiles can do, for a quick count check
  const free = b.tiles.filter((t) => !t.fixed);
  const has = (t: (typeof free)[0], ks: string[]) => (lim.noFlip ? [t.faces[t.face]] : t.faces).some((f) => ks.includes(f));
  const cap = {
    any: free.filter((t) => has(t, ['straight', 'bend', 'bridge'])).length,
    bend: free.filter((t) => has(t, ['bend'])).length,
    straight: free.filter((t) => has(t, ['straight', 'bridge'])).length,
    cross: free.filter((t) => has(t, ['bridge'])).length,
  };
  const n = { s: 0, t: 0, x: 0 };
  const need = new Map<number, [number, number][]>();
  const order: number[] = [];
  let best = bound;
  let bestPlan: Move[] = [];
  let complete = true;
  let nodes = 0;
  const deadline = performance.now() + budgetMs;
  const lowerBound = () => {
    let bad = 0;
    for (const c of order) if (!b.cells[c].fixed && !ring.has(c) && fitCost(b.cells[c].faces, b.cells[c].face, b.cells[c].rot, need.get(c)!, lim.noFlip) > 0) bad++;
    return lim.noSwap ? bad : Math.ceil(bad / 2);
  };
  const feasible = () => n.x <= cap.cross && n.t <= cap.bend && n.s + n.x <= cap.straight && n.s + n.t + n.x <= cap.any;
  const walk = (x: number, y: number, inS: number): void => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) complete = false;
    if (!complete) return;
    const t = at(b, x, y);
    if (!t) return;
    const c = y * b.w + x;
    const k = kindOf(t);
    const prev = need.get(c);
    const enter = (out: number, move: () => void, unmove: () => void) => {
      if (prev) prev.push([inS, out]);
      else {
        need.set(c, [[inS, out]]);
        order.push(c);
      }
      move();
      if (feasible() && lowerBound() < best) walk(x + DX[out], y + DY[out], (out + 2) % 4);
      unmove();
      if (prev) prev.pop();
      else {
        need.delete(c);
        order.pop();
      }
    };
    if (t.fixed) {
      if (k === 'sea') {
        if (t.rot === inS && lockCells.every((l) => need.has(l))) {
          const plan: Move[] = [];
          const cost = riverCost(b, need, order, best, plan, lim);
          if (cost < best) {
            best = cost;
            bestPlan = plan;
          }
        }
        return;
      }
      if (k === 'spring' || (prev && (k !== 'whirl' || prev.length > 1 || prev[0][0] % 2 === inS % 2))) return;
      const lo = localExit(k, (inS - t.rot + 4) % 4);
      if (lo >= 0) enter((lo + t.rot) % 4, () => {}, () => {});
      return;
    }
    if (prev) {
      // a second pass: only straight across a straight first pass, on a bridge
      if (lim.noCross || prev.length > 1 || prev[0][0] % 2 === inS % 2 || (prev[0][0] + 2) % 4 !== prev[0][1]) return;
      enter((inS + 2) % 4, () => { n.s--; n.x++; }, () => { n.s++; n.x--; });
      return;
    }
    enter((inS + 2) % 4, () => n.s++, () => n.s--);
    for (const out of [(inS + 1) % 4, (inS + 3) % 4]) enter(out, () => n.t++, () => n.t--);
  };
  const out = (2 + spring.rot) % 4;
  walk(spring.x + DX[out], spring.y + DY[out], (out + 2) % 4);
  return { cost: best, complete, plan: bestPlan };
}

export type Lesson = 'swap' | 'bridge' | 'whirl' | 'flip';

/** The ideas a wall shows: each must be needed for its shortest solution. */
export function lessonsOf(def: LevelDef, index: number): Lesson[] {
  const sb = solvedBoard(def, index);
  const tr = trace(sb);
  const out: Lesson[] = [];
  if (def.scramble.swaps > 0) out.push('swap');
  const seen = new Set<number>();
  let crosses = false;
  for (const s of tr.steps) {
    if (seen.has(s.tile.id) && !s.tile.fixed) crosses = true;
    seen.add(s.tile.id);
  }
  if (crosses) out.push('bridge');
  if (sb.tiles.some((t) => kindOf(t) === 'whirl')) out.push('whirl');
  if (tr.steps.some((s) => s.tile.faces.length === 2)) out.push('flip');
  return out;
}

const LIMIT: Record<Lesson, RiverLimits> = {
  swap: { noSwap: true },
  bridge: { noCross: true },
  whirl: { noWhirl: true },
  flip: { noFlip: true },
};

export interface Analysis {
  par: number;
  designed: number; // cost of the river the wall was drawn around
  plan: Move[];
  complete: boolean; // the par search finished, so par is proved
  replayOk: boolean;
  unneeded: Lesson[]; // ideas the shortest solution can do without
  undecided: Lesson[]; // lesson checks that ran out of time
}

/** Par, the designed river's cost, and which of the wall's ideas are truly needed. */
export function analyse(def: LevelDef, index: number, budgetMs: number): Analysis {
  const b = boardOf(def, index);
  const designed = designedRiver(b);
  const designedPlan: Move[] = [];
  const designedCost = riverCost(b, designed.need, designed.order, solverMoves(boardOf(def, index)) + 1, designedPlan);
  const river = cheapestRiver(b, designedCost, budgetMs);
  let par = river.cost;
  let plan = river.plan;
  if (river.cost >= designedCost) {
    par = designedCost;
    plan = designedPlan;
  }
  const fresh = boardOf(def, index);
  const replayOk = playOut(fresh, relink(plan, b, fresh)) && plan.length === par;
  const unneeded: Lesson[] = [];
  const undecided: Lesson[] = [];
  for (const l of lessonsOf(def, index)) {
    const r = cheapestRiver(boardOf(def, index), par + 1, budgetMs, LIMIT[l]);
    if (!r.complete) undecided.push(l);
    else if (r.cost <= par) unneeded.push(l);
  }
  return { par, designed: designedCost, plan, complete: river.complete, replayOk, unneeded, undecided };
}

/** Moves found on one board, re-pointed at the same tiles of a fresh copy. */
function relink(plan: Move[], from: Board, to: Board): Move[] {
  const T = (t: { id: number }) => to.tiles[from.tiles.indexOf(from.tiles[t.id])];
  return plan.map((m) => (m.type === 'swap' ? { type: 'swap', a: T(m.a), b: T(m.b) } : { ...m, tile: T(m.tile) }) as Move);
}
