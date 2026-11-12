import { mulberry, hashInt } from '../core/rng.ts';
import {
  type Board,
  type Kind,
  type Tile,
  canDrag,
  classOf,
  kindOf,
  opFlip,
  opSwap,
  opTurn,
  opWhirl,
  trace,
} from './tiles.ts';

// Each wall is written by hand in its solved state. A cell is a letter and a
// quarter-turn count:
//   S spring (flows out south at 0)   E sea (opens north at 0)
//   I straight (north-south at 0)     L bend (north-east at 0)
//   B bridge   K lock   W whirlpool   G land
//   D two-faced tile: D<rot><shown face><hidden face>, e.g. D2LI
export interface LevelDef {
  name: string;
  hint: string;
  rows: string[];
  scramble: { turn: boolean; swaps: number; flip: boolean; whirl: number; seed: number };
}

export const LEVELS: LevelDef[] = [
  {
    name: 'The spring',
    hint: 'Click a tile to turn it. Join the water from the spring to the sea.',
    rows: ['S0 G0 G0', 'L0 I1 L2', 'G0 G0 E0'],
    scramble: { turn: true, swaps: 0, flip: false, whirl: 0, seed: 11 },
  },
  {
    name: 'The meander',
    hint: 'Drag a tile onto another to swap them.',
    rows: ['S3 I1 L2 G0', 'L1 I1 L3 G0', 'L0 I1 I1 E3'],
    scramble: { turn: true, swaps: 3, flip: false, whirl: 0, seed: 23 },
  },
  {
    name: 'The aqueduct',
    hint: 'A bridge tile carries water over water, so the river may cross itself.',
    rows: ['G0 L1 I1 L2', 'S3 B0 L2 I0', 'G0 L0 L3 I0', 'G0 G0 G0 E0'],
    scramble: { turn: true, swaps: 3, flip: false, whirl: 0, seed: 37 },
  },
  {
    name: 'The lock',
    hint: 'Framed tiles are set in mortar. The boat must pass every lock.',
    rows: ['S0 L1 L2 G0 G0', 'L0 L3 K0 G0 G0', 'G0 G0 L0 K1 L2', 'G0 G0 G0 G0 E0'],
    scramble: { turn: true, swaps: 4, flip: false, whirl: 0, seed: 41 },
  },
  {
    name: 'The whirlpool',
    hint: 'Click the whirlpool to carry the eight tiles around it.',
    rows: ['G0 G0 G0 G0 G0', 'S3 I1 L2 G0 G0', 'G0 L1 W0 I1 L2', 'G0 L0 L3 G0 I0', 'G0 G0 G0 G0 E0'],
    scramble: { turn: true, swaps: 0, flip: false, whirl: 1, seed: 53 },
  },
  {
    name: 'Sun and moon',
    hint: 'A tile with a sun or a moon has two faces. Right-click it to flip it.',
    rows: ['S0 G0 G0 G0', 'D0LI I1 D2LI G0', 'G0 G0 I0 G0', 'G0 G0 D0LI E3'],
    scramble: { turn: true, swaps: 1, flip: true, whirl: 0, seed: 67 },
  },
  {
    name: 'The full wall',
    hint: 'Everything at once. Bring the boat from the spring to the sea.',
    rows: [
      'S0 L1 K1 D1IL L2 G0 G0',
      'L0 B0 L2 G0 I0 G0 G0',
      'G0 L0 L3 L1 W0 I1 D2LI',
      'G0 G0 G0 L0 L3 G0 K0',
      'G0 G0 G0 G0 G0 G0 E0',
    ],
    scramble: { turn: true, swaps: 4, flip: true, whirl: 1, seed: 79 },
  },
];

const LETTER: Record<string, Kind> = {
  S: 'spring',
  E: 'sea',
  I: 'straight',
  L: 'bend',
  B: 'bridge',
  K: 'lock',
  W: 'whirl',
  G: 'land',
};

/** Build a board in its solved state. */
export function solvedBoard(def: LevelDef, levelIndex: number): Board {
  const h = def.rows.length;
  const grid = def.rows.map((r) => r.trim().split(/\s+/));
  const w = grid[0].length;
  const tiles: Tile[] = [];
  const counts: Record<string, number> = {};
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const tok = grid[y][x];
      const rot = Number(tok[1]);
      const faces: Kind[] = tok[0] === 'D' ? [LETTER[tok[2]], LETTER[tok[3]]] : [LETTER[tok[0]]];
      const k = faces[0];
      const id = tiles.length;
      const variant = counts[k] ?? 0;
      counts[k] = variant + 1;
      tiles.push({
        id,
        faces,
        face: 0,
        rot,
        fixed: k === 'spring' || k === 'sea' || k === 'lock' || k === 'whirl',
        seed: hashInt(levelIndex * 131 + 7, id * 17 + 3) % 100000,
        variant: variant + levelIndex,
        x,
        y,
        busy: false,
        sol: { x, y, rot, face: 0 },
      });
    }
  return { w, h, cells: [...tiles], tiles };
}

/** Disturb a solved board using only the moves the level teaches. */
export function scramble(b: Board, def: LevelDef): void {
  const s = def.scramble;
  for (let attempt = 0; attempt < 20; attempt++) {
    const rng = mulberry(s.seed + attempt * 977);
    for (let k = 0; k < s.whirl; k++) for (const t of b.tiles) if (kindOf(t) === 'whirl') opWhirl(b, t, 1);
    if (s.flip) for (const t of b.tiles) opFlip(t);
    const loose = b.tiles.filter((t) => canDrag(b, t));
    for (let k = 0; k < s.swaps && loose.length > 1; k++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = loose[Math.floor(rng() * loose.length)];
        const c = loose[Math.floor(rng() * loose.length)];
        if (a !== c && classOf(a) !== classOf(c)) {
          opSwap(b, a, c);
          break;
        }
      }
    }
    if (s.turn)
      for (const t of b.tiles) {
        if (t.fixed) continue;
        const k = kindOf(t);
        if (k === 'land' || k === 'bridge') continue;
        if (rng() < 0.2) continue;
        opTurn(t, k === 'straight' ? 1 : 1 + Math.floor(rng() * 3));
      }
    if (!trace(b).reached) return;
  }
}

export function makeBoard(levelIndex: number): Board {
  const def = LEVELS[levelIndex];
  const b = solvedBoard(def, levelIndex);
  scramble(b, def);
  return b;
}
