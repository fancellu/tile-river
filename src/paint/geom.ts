import type { Kind } from '../game/tiles.ts';
import { hash01 } from '../core/rng.ts';

// Geometry of the painted water, shared by the tile painter (banks, washes)
// and by the boat, so the boat sails exactly down the painted channel.
// Tile-local coordinates: x right, y down, 0..1.

export const MID: [number, number][] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];
export const HW = 0.118; // half width of a channel where it meets a tile edge
export const POND: [number, number] = [0.5, 0.4]; // spring basin
export const SEAPT: [number, number] = [0.5, 0.66]; // where the boat comes to rest

/** Turn a local point r quarter turns clockwise about the tile centre. */
export function rotPt(x: number, y: number, r: number): [number, number] {
  for (let i = 0; i < (r & 3); i++) [x, y] = [1 - y, x];
  return [x, y];
}

/** Centre line of the water in a tile from local side la to local side lb. */
export function channel(kind: Kind, la: number, lb: number, t: number, seed: number): [number, number] {
  if (kind === 'spring') return [POND[0], POND[1] + (1 - POND[1]) * t];
  if (kind === 'sea') return [0.5 + (SEAPT[0] - 0.5) * t, SEAPT[1] * t];
  if (kind === 'bend') {
    if (la > lb) t = 1 - t;
    const th = Math.PI - (t * Math.PI) / 2;
    const r = 0.5 + Math.sin(Math.PI * t) * (hash01(seed, 5) - 0.5) * 0.07;
    return [1 + Math.cos(th) * r, Math.sin(th) * r];
  }
  if (kind === 'whirl') {
    const a = MID[la];
    const b = MID[lb];
    const R = 0.17;
    // run in, go once round the eye, run out
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (t < 0.28) {
      const k = t / 0.28;
      return [a[0] + dx * (0.5 - R) * k, a[1] + dy * (0.5 - R) * k];
    }
    if (t > 0.72) {
      const k = (t - 0.72) / 0.28;
      return [0.5 + dx * R + dx * (0.5 - R) * k, 0.5 + dy * R + dy * (0.5 - R) * k];
    }
    // enter at centre - d*R, sweep round to centre + d*R, one and a half turns
    const k = (t - 0.28) / 0.44;
    const ang = Math.atan2(-dy, -dx) + k * Math.PI * 3;
    return [0.5 + Math.cos(ang) * R, 0.5 + Math.sin(ang) * R];
  }
  // straight runs: north-south meanders a little, other runs are built walls
  const rev = la > lb;
  const k = rev ? 1 - t : t;
  const a = MID[rev ? lb : la];
  const b = MID[rev ? la : lb];
  let x = a[0] + (b[0] - a[0]) * k;
  let y = a[1] + (b[1] - a[1]) * k;
  if ((kind === 'straight' || kind === 'bridge') && (la === 0 || la === 2)) {
    const amp = (0.025 + 0.035 * hash01(seed, 7)) * (hash01(seed, 9) < 0.5 ? -1 : 1);
    x += amp * Math.sin(2 * Math.PI * k) * Math.sin(Math.PI * k);
  }
  return [x, y];
}

export interface MotifSpot {
  type: string;
  x: number;
  y: number;
  r: number;
  seed: number;
}

const pick = <T>(list: T[], n: number): T => list[((n % list.length) + list.length) % list.length];

/** Where the upright scenery sits on a tile face (local coordinates). */
export function motifSpots(kind: Kind, seed: number, variant: number, mark: string | null): MotifSpot[] {
  const out: MotifSpot[] = [];
  const s = (i: number) => seed * 13 + i * 101;
  const h = (i: number) => Math.floor(hash01(seed, 20 + i) * 1000);
  const small = ['tree', 'poplar', 'reeds', 'bush', 'haystack', 'tree'];
  switch (kind) {
    case 'land':
      out.push({ type: pick(['windmill', 'cottage', 'church', 'trees', 'windmill', 'haystack2'], variant), x: 0.5, y: 0.5, r: 0.36, seed: s(1) });
      break;
    case 'straight': {
      const spots: [number, number][] = [
        [0.17, 0.27],
        [0.83, 0.73],
        [0.17, 0.74],
        [0.83, 0.26],
      ];
      const first = h(1) % 4;
      const count = mark ? 2 : 2 + (h(2) % 2);
      for (let i = 0; i < count; i++) {
        const p = spots[(first + i) % 4];
        if (mark && p[0] < 0.5 && p[1] > 0.5) continue;
        out.push({ type: pick(small, h(3) + i * 2 + variant), x: p[0], y: p[1], r: 0.125, seed: s(2 + i) });
      }
      out.push({ type: 'fish', x: 0.5, y: 0.5, r: 0.1, seed: s(9) });
      break;
    }
    case 'bend':
      if (!mark) out.push({ type: pick(['cottage', 'trees', 'haystack2', 'windmill', 'trees', 'church'], variant + h(1)), x: 0.29, y: 0.71, r: 0.215, seed: s(1) });
      else out.push({ type: pick(small, h(3)), x: 0.42, y: 0.6, r: 0.12, seed: s(1) });
      out.push({ type: 'bush', x: 0.885, y: 0.115, r: 0.07, seed: s(2) });
      out.push({ type: 'fish', x: 0.66, y: 0.34, r: 0.1, seed: s(9) });
      break;
    case 'bridge':
      out.push({ type: pick(small, h(1)), x: 0.17, y: 0.2, r: 0.115, seed: s(1) });
      out.push({ type: pick(small, h(2) + 1), x: 0.83, y: 0.8, r: 0.115, seed: s(2) });
      break;
    case 'lock':
      out.push({ type: 'cottage', x: 0.15, y: 0.5, r: 0.12, seed: s(1) });
      out.push({ type: 'tree', x: 0.86, y: 0.5, r: 0.11, seed: s(2) });
      break;
    case 'spring':
      out.push({ type: 'reeds', x: 0.17, y: 0.8, r: 0.12, seed: s(1) });
      out.push({ type: 'tree', x: 0.83, y: 0.8, r: 0.12, seed: s(2) });
      break;
    case 'sea':
      out.push({ type: 'beacon', x: 0.17, y: 0.2, r: 0.13, seed: s(1) });
      out.push({ type: 'bush', x: 0.84, y: 0.22, r: 0.09, seed: s(2) });
      out.push({ type: 'fish', x: 0.3, y: 0.78, r: 0.1, seed: s(9) });
      break;
    default:
      break;
  }
  if (mark) out.push({ type: mark, x: 0.15, y: 0.85, r: 0.085, seed: s(30) });
  return out;
}
