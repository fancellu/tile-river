// Pure board logic: no DOM, so Node can verify the levels.
// Sides: 0 north, 1 east, 2 south, 3 west. A tile turned r quarter turns
// clockwise carries its local side s to wall side (s + r) % 4.

export type Kind = 'spring' | 'sea' | 'straight' | 'bend' | 'bridge' | 'lock' | 'whirl' | 'land';

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

/** Local exit side for water entering a tile at local side s, or -1. */
export function localExit(kind: Kind, s: number): number {
  switch (kind) {
    case 'straight':
    case 'lock':
      return s === 0 ? 2 : s === 2 ? 0 : -1;
    case 'bend':
      return s === 0 ? 1 : s === 1 ? 0 : -1;
    case 'bridge':
    case 'whirl':
      return (s + 2) % 4;
    default:
      return -1;
  }
}

export interface Tile {
  id: number;
  faces: Kind[]; // one face, or two for a sun-and-moon tile
  face: number;
  rot: number;
  fixed: boolean;
  seed: number;
  variant: number; // index among tiles of the same kind, picks the scenery
  x: number;
  y: number;
  busy: boolean; // in the air: water cannot pass
  sol: { x: number; y: number; rot: number; face: number };
}

export interface Board {
  w: number;
  h: number;
  cells: Tile[];
  tiles: Tile[];
}

export const kindOf = (t: Tile): Kind => t.faces[t.face];
export const at = (b: Board, x: number, y: number): Tile | null =>
  x < 0 || y < 0 || x >= b.w || y >= b.h ? null : b.cells[y * b.w + x];

export interface Step {
  tile: Tile;
  inSide: number; // wall side, -1 at the spring
  outSide: number; // wall side, -1 at the sea
}

export interface Trace {
  steps: Step[];
  reached: boolean;
  locks: number;
  locksTotal: number;
  solved: boolean;
}

/** Follow the water from the spring until it reaches the sea or stops. */
export function trace(b: Board): Trace {
  const steps: Step[] = [];
  const locksTotal = b.tiles.filter((t) => kindOf(t) === 'lock').length;
  const res: Trace = { steps, reached: false, locks: 0, locksTotal, solved: false };
  const spring = b.tiles.find((t) => kindOf(t) === 'spring');
  if (!spring || spring.busy) return res;
  let out = (2 + spring.rot) % 4;
  let x = spring.x;
  let y = spring.y;
  steps.push({ tile: spring, inSide: -1, outSide: out });
  for (let guard = 0; guard < 400; guard++) {
    x += DX[out];
    y += DY[out];
    const t = at(b, x, y);
    if (!t || t.busy) break;
    const inS = (out + 2) % 4;
    const k = kindOf(t);
    if (k === 'sea') {
      if (t.rot % 4 === inS) {
        steps.push({ tile: t, inSide: inS, outSide: -1 });
        res.reached = true;
      }
      break;
    }
    const lo = localExit(k, (inS - t.rot + 4) % 4);
    if (lo < 0) break;
    out = (lo + t.rot) % 4;
    steps.push({ tile: t, inSide: inS, outSide: out });
  }
  const seen = new Set<number>();
  for (const s of steps) if (kindOf(s.tile) === 'lock') seen.add(s.tile.id);
  res.locks = seen.size;
  res.solved = res.reached && res.locks === locksTotal;
  return res;
}

// ---- moves (logical state only; the view animates towards it) ----

export function opTurn(t: Tile, dir: number): void {
  t.rot = (t.rot + dir + 4) % 4;
}

export function opSwap(b: Board, a: Tile, c: Tile): void {
  const ax = a.x;
  const ay = a.y;
  a.x = c.x;
  a.y = c.y;
  c.x = ax;
  c.y = ay;
  b.cells[a.y * b.w + a.x] = a;
  b.cells[c.y * b.w + c.x] = c;
}

export function opFlip(t: Tile): void {
  if (t.faces.length === 2) t.face = 1 - t.face;
}

/** The eight tiles around a whirlpool, or null if the block cannot turn. */
export function ringOf(b: Board, w: Tile): Tile[] | null {
  const ring: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = at(b, w.x + dx, w.y + dy);
      if (!t || t.fixed || t.busy) return null;
      ring.push(t);
    }
  return ring;
}

/** Turn the 3 x 3 block around a whirlpool a quarter turn. */
export function opWhirl(b: Board, w: Tile, dir: number): boolean {
  const ring = ringOf(b, w);
  if (!ring) return false;
  for (const t of ring) {
    const dx = t.x - w.x;
    const dy = t.y - w.y;
    t.x = w.x + (dir > 0 ? -dy : dy);
    t.y = w.y + (dir > 0 ? dx : -dx);
    t.rot = (t.rot + dir + 4) % 4;
  }
  for (const t of ring) b.cells[t.y * b.w + t.x] = t;
  w.rot = (w.rot + dir + 4) % 4;
  return true;
}

/** Tiles caught beside a whirlpool cannot be lifted out by hand. */
export function inRing(b: Board, x: number, y: number): boolean {
  for (const w of b.tiles) {
    if (kindOf(w) !== 'whirl') continue;
    const dx = Math.abs(w.x - x);
    const dy = Math.abs(w.y - y);
    if (dx <= 1 && dy <= 1 && dx + dy > 0) return true;
  }
  return false;
}

export const canDrag = (b: Board, t: Tile): boolean => !t.fixed && !t.busy && !inRing(b, t.x, t.y);

/** Tiles of one class are interchangeable when solving. */
export const classOf = (t: Tile): string => [...t.faces].sort().join('|');

export function rotEquivalent(kind: Kind, a: number, c: number): boolean {
  switch (kind) {
    case 'straight':
    case 'lock':
      return (a - c + 4) % 2 === 0;
    case 'bend':
    case 'spring':
    case 'sea':
      return a === c;
    default:
      return true;
  }
}
