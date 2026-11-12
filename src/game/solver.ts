import {
  type Board,
  type Tile,
  at,
  classOf,
  inRing,
  kindOf,
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
