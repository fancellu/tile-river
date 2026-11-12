import {
  type Board,
  type Kind,
  type Tile,
  at,
  classOf,
  inRing,
  kindOf,
  localExit,
  rotEquivalent,
  trace,
} from './tiles.ts';

export type Move =
  | { type: 'turn'; tile: Tile; dir: number }
  | { type: 'swap'; a: Tile; b: Tile }
  | { type: 'flip'; tile: Tile }
  | { type: 'whirl'; tile: Tile; dir: number };

/**
 * The next move towards the stored solution, or null when the water already
 * reaches the sea. Used by the hint and by the attract mode.
 */
export function nextMove(b: Board): Move | null {
  if (trace(b).solved) return null;

  // 1. Bring each whirlpool block round to its solved position.
  for (const w of b.tiles) {
    if (kindOf(w) !== 'whirl') continue;
    for (let k = 0; k < 4; k++) {
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -1; dx <= 1 && ok; dx++) {
          if (!dx && !dy) continue;
          const t = at(b, w.x + dx, w.y + dy);
          if (!t) continue;
          // position of this tile after k clockwise presses
          let rx = dx;
          let ry = dy;
          for (let i = 0; i < k; i++) [rx, ry] = [-ry, rx];
          if (t.sol.x !== w.x + rx || t.sol.y !== w.y + ry) ok = false;
        }
      if (ok) {
        if (k > 0) return { type: 'whirl', tile: w, dir: k === 3 ? -1 : 1 };
        break;
      }
    }
  }

  // 2. Walk the cells in the order of the solved route, then the rest.
  const want = new Map<number, Tile>();
  for (const t of b.tiles) want.set(t.sol.y * b.w + t.sol.x, t);
  const order: number[] = [];
  const spring = b.tiles.find((t) => kindOf(t) === 'spring');
  if (spring) order.push(spring.sol.y * b.w + spring.sol.x);
  for (let i = 0; i < b.w * b.h; i++) if (!order.includes(i)) order.push(i);

  for (const pass of ['swap', 'flip', 'turn'] as const)
    for (const c of order) {
      const cur = b.cells[c];
      const w = want.get(c)!;
      if (cur.fixed) continue;
      if (pass === 'swap') {
        if (classOf(cur) === classOf(w) || inRing(b, cur.x, cur.y)) continue;
        for (const d of order) {
          const o = b.cells[d];
          if (d === c || o.fixed || inRing(b, o.x, o.y)) continue;
          if (classOf(o) === classOf(w) && classOf(want.get(d)!) !== classOf(o)) return { type: 'swap', a: cur, b: o };
        }
      } else if (classOf(cur) === classOf(w)) {
        const wk = w.faces[w.sol.face];
        if (pass === 'flip') {
          if (kindOf(cur) !== wk) return { type: 'flip', tile: cur };
        } else if (kindOf(cur) === wk && !rotEquivalent(wk, cur.rot, w.sol.rot)) {
          const diff = (w.sol.rot - cur.rot + 4) % 4;
          return { type: 'turn', tile: cur, dir: diff === 3 ? -1 : 1 };
        }
      }
    }
  return null;
}

// ------------------------------------------------------------ par

/** Moves for a tile to carry the water through the side pairs of one cell (face flip + quarter turns). */
export function fitCost(faces: Kind[], face: number, rot: number, pairs: [number, number][], noFlip = false): number {
  let best = Infinity;
  for (let f = 0; f < faces.length; f++) {
    if (noFlip && f !== face) continue;
    for (let r = 0; r < 4; r++) {
      if (!pairs.every(([a, c]) => localExit(faces[f], (a - r + 4) % 4) === (c - r + 4) % 4)) continue;
      const d = (r - rot + 4) % 4;
      best = Math.min(best, (f !== face ? 1 : 0) + Math.min(d, 4 - d));
    }
  }
  return best;
}

/**
 * Par: the fewest moves (turn, swap, flip, whirl) that make the designed river
 * run from the spring to the sea. Only the cells of the river count; tiles off
 * the river may end anywhere. Exact for that goal, found by branch and bound.
 *
 * Moves commute in a useful way: a tile's turns and flips can be done before or
 * after it is swapped, and whirlpool rings can only move by whirling. So par is
 * the sum of each ring's best whirl count plus the best set of swaps among the
 * loose tiles, each tile then paying for its own turns and flips.
 */
export function parOf(b: Board): number {
  const { need, order } = designedRiver(b);
  return riverCost(b, need, order);
}

/** River cells as a map from cell index to the side pairs the water uses there, in river order. */
export interface River {
  need: Map<number, [number, number][]>;
  order: number[];
}

/** The river of the designed solution. */
export function designedRiver(b: Board): River {
  const ghost = b.tiles.map((t) => ({ ...t, x: t.sol.x, y: t.sol.y, rot: t.sol.rot, face: t.sol.face, busy: false }));
  const cells: Tile[] = new Array(b.w * b.h);
  for (const t of ghost) cells[t.y * b.w + t.x] = t;
  const tr = trace({ w: b.w, h: b.h, cells, tiles: ghost });
  const need = new Map<number, [number, number][]>();
  const order: number[] = [];
  for (const s of tr.steps) {
    if (s.inSide < 0 || s.outSide < 0) continue;
    const c = s.tile.y * b.w + s.tile.x;
    if (!need.has(c)) {
      need.set(c, []);
      order.push(c);
    }
    need.get(c)!.push([s.inSide, s.outSide]);
  }
  return { need, order };
}

/** Moves a search may be told not to use, to test whether a wall really needs them. */
export interface Limits {
  noSwap?: boolean;
  noFlip?: boolean;
  noWhirl?: boolean;
}

/** Exact fewest moves that make the water use these sides in these cells. Stops early at `bound`. */
export function riverCost(b: Board, need: Map<number, [number, number][]>, order: number[], bound = Infinity, plan?: Move[], lim: Limits = {}): number {
  let par = 0;
  const whirlPlan: { type: 'whirl'; tile: Tile; dir: number }[] = [];
  const ringCell = new Set<number>();

  // each whirlpool: try 0..3 quarter turns of its ring
  for (const w of b.tiles) {
    if (kindOf(w) !== 'whirl') continue;
    let best = Infinity;
    let bestK = 0;
    for (let k = 0; k < (lim.noWhirl ? 1 : 4); k++) {
      let cost = Math.min(k, 4 - k);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const t = at(b, w.x + dx, w.y + dy);
          if (!t) continue;
          ringCell.add(t.y * b.w + t.x);
          let rx = dx;
          let ry = dy;
          for (let i = 0; i < k; i++) [rx, ry] = [-ry, rx];
          const pairs = need.get((w.y + ry) * b.w + (w.x + rx));
          if (pairs) cost += fitCost(t.faces, t.face, (t.rot + k) % 4, pairs, lim.noFlip);
        }
      if (cost < best) {
        best = cost;
        bestK = k;
      }
    }
    par += best;
    for (let i = 0; i < Math.min(bestK, 4 - bestK); i++) whirlPlan.push({ type: 'whirl', tile: w, dir: bestK <= 2 ? 1 : -1 });
  }
  if (par >= bound) return Infinity;

  // the loose tiles: choose which tile ends in each river cell
  const arr = [...b.cells];
  const isLoose = (c: number) => !arr[c].fixed && !ringCell.has(c);
  const loose = arr.map((_, c) => c).filter(isLoose);
  const route = order.filter(isLoose);
  const cost = (t: Tile, c: number) => fitCost(t.faces, t.face, t.rot, need.get(c)!, lim.noFlip);
  const sig = (t: Tile) => `${t.faces.join('')}${t.face}${t.rot}`;
  const done = new Set<number>();
  const swaps: [number, number][] = [];
  let bestSwaps: [number, number][] = [];
  let best = bound - par;
  const dfs = (i: number, acc: number): void => {
    let bad = 0;
    for (let j = i; j < route.length; j++) if (cost(arr[route[j]], route[j]) > 0) bad++;
    if (acc + Math.ceil(bad / 2) >= best) return;
    if (i === route.length) {
      best = acc;
      bestSwaps = [...swaps];
      return;
    }
    const c = route[i];
    const cur = arr[c];
    const opts: { j: number; cost: number }[] = [];
    const keep = cost(cur, c);
    if (keep < Infinity) opts.push({ j: c, cost: keep });
    // bring in a tile from a cell not yet settled; identical tiles from cells off
    // the river are interchangeable, so try one of each
    const seen = new Set<string>();
    for (const j of lim.noSwap ? [] : loose) {
      if (j === c || done.has(j) || sig(arr[j]) === sig(cur)) continue; // swapping in a twin changes nothing
      const key = sig(arr[j]) + (need.has(j) ? '@' + j : '');
      if (seen.has(key)) continue;
      seen.add(key);
      const k = cost(arr[j], c);
      if (k < Infinity) opts.push({ j, cost: 1 + k });
    }
    opts.sort((a, z) => a.cost - z.cost);
    done.add(c);
    for (const o of opts) {
      [arr[c], arr[o.j]] = [arr[o.j], arr[c]];
      if (o.j !== c) swaps.push([c, o.j]);
      dfs(i + 1, acc + o.cost);
      if (o.j !== c) swaps.pop();
      [arr[c], arr[o.j]] = [arr[o.j], arr[c]];
    }
    done.delete(c);
  };
  dfs(0, 0);
  if (par + best >= bound) return Infinity;
  if (plan) {
    // write out the moves: whirls, then swaps, then each river tile's flips and turns
    plan.length = 0;
    plan.push(...whirlPlan);
    const cur = [...b.cells];
    const rot = new Map(b.tiles.map((t) => [t, t.rot]));
    for (const m of whirlPlan) {
      const w = m.tile;
      const moved: [Tile, number][] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const t = cur[(w.y + dy) * b.w + w.x + dx];
          const [nx, ny] = m.dir > 0 ? [-dy, dx] : [dy, -dx];
          moved.push([t, (w.y + ny) * b.w + w.x + nx]);
          rot.set(t, (rot.get(t)! + m.dir + 4) % 4);
        }
      for (const [t, c] of moved) cur[c] = t;
    }
    for (const [c, j] of bestSwaps) {
      plan.push({ type: 'swap', a: cur[c], b: cur[j] });
      [cur[c], cur[j]] = [cur[j], cur[c]];
    }
    for (const c of order) {
      const t = cur[c];
      if (t.fixed) continue;
      const pairs = need.get(c)!;
      const r0 = rot.get(t)!;
      let pick: [number, number, number] | null = null;
      for (let f = 0; f < t.faces.length; f++)
        for (let r = 0; r < 4; r++) {
          if (lim.noFlip && f !== t.face) continue;
          if (!pairs.every(([a, z]) => localExit(t.faces[f], (a - r + 4) % 4) === (z - r + 4) % 4)) continue;
          const d = (r - r0 + 4) % 4;
          const k = (f !== t.face ? 1 : 0) + Math.min(d, 4 - d);
          if (!pick || k < pick[0]) pick = [k, f, d];
        }
      if (!pick) continue;
      if (pick[1] !== t.face) plan.push({ type: 'flip', tile: t });
      const d = pick[2];
      for (let i = 0; i < Math.min(d, 4 - d); i++) plan.push({ type: 'turn', tile: t, dir: d <= 2 ? 1 : -1 });
    }
  }
  return par + best;
}
