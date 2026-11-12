import { mulberry } from '../core/rng.ts';
import type { Kind } from '../game/tiles.ts';
import { Brush, type P } from './brush.ts';
import { HW, MID, POND, channel, motifSpots, rotPt } from './geom.ts';
import { drawMotif } from './motifs.ts';

// Paints one tile face into four density layers:
//   R  the lasting picture: banks, pale under-wash, walls, frames
//   G  upright scenery (repainted upright whenever the tile lands turned)
//   B  the deeper wash and wavelets shown when water flows north-south
//   A  the same for the second channel of a bridge or whirlpool

export const CELL = 400;
export const PAD = 8;
export const INNER = CELL - PAD * 2;

export interface FaceSpec {
  kind: Kind;
  seed: number;
  variant: number;
  rot: number;
  mark: string | null; // 'sun' | 'moon' on two-faced tiles
  fixed: boolean;
}

type Fn = (t: number) => [number, number];

function sample(fn: Fn, t0 = -0.05, t1 = 1.05, n = 14): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const p = fn(t0 + ((t1 - t0) * i) / n);
    out.push([p[0], p[1]]);
  }
  return out;
}

function offset(pts: P[], d: number | ((k: number) => number)): P[] {
  const n = pts.length - 1;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n, i + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    const dd = typeof d === 'number' ? d : d(i / n);
    return [p[0] - (ty / l) * dd, p[1] + (tx / l) * dd] as P;
  });
}

function wavelet(b: Brush, x: number, y: number, tx: number, ty: number, s: number, a = 0.8): void {
  const nx = -ty;
  const ny = tx;
  b.line(
    [
      [x - tx * s + nx * s * 0.3, y - ty * s + ny * s * 0.3],
      [x - tx * s * 0.35 - nx * s * 0.35, y - ty * s * 0.35 - ny * s * 0.35],
      [x + tx * s * 0.35 + nx * s * 0.35, y + ty * s * 0.35 + ny * s * 0.35],
      [x + tx * s - nx * s * 0.3, y + ty * s - ny * s * 0.3],
    ],
    0.75,
    a,
    { dep: 0.4 },
  );
}

/** Natural water: wobbling banks, a pale under-wash, and the flow layer. */
function river(R: Brush, F: Brush, fn: Fn, rng: () => number, t0 = -0.05, t1 = 1.05): void {
  const pts = sample(fn, t0, t1);
  const bulge = 0.012 + rng() * 0.02;
  const hw = (k: number) => HW + bulge * Math.sin(Math.PI * Math.min(1, Math.max(0, (k - 0.045) / 0.91)));
  R.wash(pts, HW * 2.15, 0.15);
  R.wash(offset(pts, HW * 0.4), HW * 0.9, 0.1);
  const shade = rng() < 0.5 ? -1 : 1;
  for (const side of [-1, 1]) {
    const o = offset(pts, (k) => side * hw(k));
    R.line(o.slice(0, 9), 1.3, 0.95, { dep: 0.2, wob: 0.5, taper: 0.4 });
    R.line(o.slice(7), 1.25, 0.93, { dep: 0.3, wob: 0.5, taper: 0.4 });
    // shore: short touches of the brush leaning away from the water
    const shore = offset(pts, (k) => side * (hw(k) + 0.016));
    for (let i = 1; i < shore.length - 1; i++) {
      if (rng() < (side === shade ? 0.25 : 0.6)) continue;
      const a = shore[i - 1];
      const c = shore[i + 1];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const nx = (-(c[1] - a[1]) / l) * side;
      const ny = ((c[0] - a[0]) / l) * side;
      const len = 0.018 + rng() * 0.03;
      const j = (rng() - 0.5) * 0.03;
      R.line([[shore[i][0] + j, shore[i][1] + j], [shore[i][0] + j + nx * len, shore[i][1] + j + ny * len]], 0.65, 0.75, { dep: 0.5 });
    }
    for (let i = 0; i < 2; i++) {
      const p = shore[1 + Math.floor(rng() * (shore.length - 2))];
      R.dot(p[0] + (rng() - 0.5) * 0.05, p[1] + (rng() - 0.5) * 0.05, 0.8, 0.7);
    }
  }
  F.wash(pts, HW * 1.5, 0.34);
  F.wash(offset(pts, -HW * 0.35), HW * 0.75, 0.2);
  for (let i = 0; i < 6; i++) {
    const t = t0 + (t1 - t0) * ((i + 0.3 + rng() * 0.4) / 6);
    const p = fn(t);
    const q = fn(t + 0.02);
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const tx = (q[0] - p[0]) / l;
    const ty = (q[1] - p[1]) / l;
    const lat = (rng() - 0.5) * HW * 1.1;
    wavelet(F, p[0] - ty * lat, p[1] + tx * lat, tx, ty, 0.036);
  }
}

/** Built water: straight walls of dressed stone. s is the local entry side. */
function canal(R: Brush, F: Brush, s: number, rng: () => number, joints: boolean): void {
  const a = MID[s];
  const c = MID[(s + 2) % 4];
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const nx = -dy;
  const ny = dx;
  const P0 = (k: number, o: number): P => [a[0] + dx * k + nx * o, a[1] + dy * k + ny * o];
  R.wash([P0(-0.05, 0), P0(1.05, 0)], HW * 2.15, 0.15);
  for (const side of [-1, 1]) {
    R.line([P0(-0.05, side * HW), P0(0.5, side * HW), P0(1.05, side * HW)], 1.5, 0.96, { wob: 0.15, dep: 0.15, taper: 0.2 });
    if (joints) {
      R.line([P0(-0.05, side * 0.168), P0(0.5, side * 0.168), P0(1.05, side * 0.168)], 1.0, 0.92, { wob: 0.15, dep: 0.2, taper: 0.2 });
      for (let i = 0; i < 15; i++) {
        const k = (i + 0.5 + (rng() - 0.5) * 0.3) / 15;
        R.line([P0(k, side * (HW + 0.006)), P0(k, side * 0.162)], 0.6, 0.8, { wob: 0.1 });
      }
    }
  }
  F.wash([P0(-0.05, 0), P0(1.05, 0)], HW * 1.5, 0.34);
  for (let i = 0; i < 5; i++) {
    const k = (i + 0.3 + rng() * 0.4) / 5;
    const p = P0(k, (rng() - 0.5) * HW * 1.1);
    wavelet(F, p[0], p[1], dx, dy, 0.036);
  }
}

function frame(R: Brush): void {
  const rect = (i: number, w: number, a: number) => {
    const o = 0.03;
    R.line([[i - o, i], [0.5, i], [1 - i + o, i]], w, a, { wob: 0.25, dep: 0.25, taper: 0.3 });
    R.line([[1 - i, i - o], [1 - i, 0.5], [1 - i, 1 - i + o]], w, a, { wob: 0.25, dep: 0.25, taper: 0.3 });
    R.line([[1 - i + o, 1 - i], [0.5, 1 - i], [i - o, 1 - i]], w, a, { wob: 0.25, dep: 0.25, taper: 0.3 });
    R.line([[i, 1 - i + o], [i, 0.5], [i, i - o]], w, a, { wob: 0.25, dep: 0.25, taper: 0.3 });
  };
  rect(0.035, 1.5, 0.93);
  rect(0.062, 0.6, 0.8);
}

function paintBase(R: Brush, F1: Brush, F2: Brush, s: FaceSpec): void {
  const rng = mulberry(s.seed * 7 + 1);
  const { kind, seed } = s;
  switch (kind) {
    case 'straight':
      river(R, F1, (t) => channel('straight', 0, 2, t, seed), rng);
      break;
    case 'bend':
      river(R, F1, (t) => channel('bend', 0, 1, t, seed), rng);
      break;
    case 'bridge': {
      river(R, F1, (t) => channel('bridge', 0, 2, t, seed), rng);
      const band: [number, number][] = [
        [-0.1, 0.5 - 0.19],
        [1.1, 0.5 - 0.19],
        [1.1, 0.5 + 0.19],
        [-0.1, 0.5 + 0.19],
      ];
      R.erase(band);
      F1.erase(band);
      canal(R, F2, 3, rng, true);
      // the dark mouths of the arch where the river goes under
      for (const sgn of [-1, 1]) {
        const cx = channel('bridge', 0, 2, 0.5 + sgn * 0.21, seed)[0];
        const y = 0.5 + sgn * 0.2;
        R.wash([[cx - 0.07, y], [cx + 0.07, y]], 0.075, 0.55, 0);
        R.arc(cx, 0.5 + sgn * 0.176, HW * 1.02, 0.07, sgn > 0 ? 0 : Math.PI, sgn > 0 ? Math.PI : Math.PI * 2, 1.1, 0.92);
      }
      break;
    }
    case 'lock': {
      canal(R, F1, 0, rng, false);
      for (const side of [-1, 1]) {
        const x = 0.5 + side * 0.176;
        R.line([[0.5 + side * HW, 0.2], [x, 0.2], [x, 0.5], [x, 0.8], [0.5 + side * HW, 0.8]], 1.1, 0.93, { raw: true, wob: 0.15 });
        for (let i = 0; i < 8; i++) {
          const y = 0.24 + i * 0.075 + (rng() - 0.5) * 0.02;
          R.line([[0.5 + side * (HW + 0.008), y], [x - side * 0.006, y]], 0.6, 0.8, { wob: 0.1 });
        }
        R.wash([[0.5 + side * 0.147, 0.24], [0.5 + side * 0.147, 0.76]], 0.05, 0.16);
      }
      break;
    }
    case 'whirl': {
      const RAD = 0.3;
      const gap = Math.asin(HW / RAD);
      const reach = 0.5 - Math.sqrt(RAD * RAD - HW * HW);
      R.wash([[0.4, 0.42], [0.6, 0.58]], 0.5, 0.16);
      for (let k = 0; k < 4; k++) {
        const P1 = (x: number, y: number): P => rotPt(x, y, k) as P;
        R.wash([P1(0.5, -0.05), P1(0.5, reach + 0.05)], HW * 2.15, 0.15);
        for (const side of [-1, 1]) R.line([P1(0.5 + side * HW, -0.05), P1(0.5 + side * (HW + 0.004), reach * 0.5), P1(0.5 + side * HW, reach + 0.01)], 1.3, 0.95, { wob: 0.4, taper: 0.3 });
        const a0 = -Math.PI / 2 + (k * Math.PI) / 2;
        R.arc(0.5, 0.5, RAD, RAD, a0 + gap, a0 + Math.PI / 2 - gap, 1.3, 0.95, { wob: 0.4, taper: 0.4 });
        const F = k % 2 === 0 ? F1 : F2;
        F.wash([P1(0.5, -0.05), P1(0.5, reach + 0.08)], HW * 1.5, 0.34);
      }
      for (let j = 0; j < 2; j++) {
        const pts: P[] = [];
        for (let i = 0; i <= 26; i++) {
          const u = i / 26;
          const a = j * Math.PI + u * Math.PI * 3.6 + rng() * 0.05;
          const r = 0.255 - u * 0.225;
          pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 1.2 - u * 0.5]);
        }
        R.line(pts, 1.25, 0.92, { raw: true, dep: 0.35, wob: 0.2 });
      }
      R.dot(0.5, 0.5, 1.6, 0.9);
      F1.wash([[0.42, 0.44], [0.58, 0.56]], 0.42, 0.3);
      F2.wash([[0.44, 0.58], [0.56, 0.42]], 0.42, 0.3);
      break;
    }
    case 'spring': {
      const [px, py] = POND;
      const RAD = 0.2;
      const gap = Math.asin(HW / RAD);
      R.wash([[px - 0.06, py - 0.03], [px + 0.07, py + 0.04]], 0.34, 0.17);
      R.wash([[0.5, py + 0.1], [0.5, 1.05]], HW * 2.15, 0.15);
      R.arc(px, py, RAD, RAD, Math.PI / 2 + gap, Math.PI * 1.55, 1.35, 0.95, { wob: 0.4, taper: 0.4 });
      R.arc(px, py, RAD, RAD, Math.PI * 1.5, Math.PI * 2.5 - gap, 1.3, 0.94, { wob: 0.4, taper: 0.4 });
      for (let i = 0; i < 11; i++) {
        const a = Math.PI / 2 + gap + 0.25 + (i / 10) * (Math.PI * 2 - 2 * gap - 0.5);
        const rr = RAD + 0.04 + rng() * 0.02;
        R.arc(px + Math.cos(a) * rr, py + Math.sin(a) * rr, 0.026 + rng() * 0.012, 0.02 + rng() * 0.008, 0, 6.3, 0.75, 0.88, { wob: 0.2 });
      }
      for (const side of [-1, 1]) {
        const x = 0.5 + side * HW;
        R.line([[x, py + RAD * Math.cos(gap) - 0.01], [x + side * 0.006, 0.8], [x, 1.05]], 1.3, 0.95, { wob: 0.45, taper: 0.3 });
        for (let i = 0; i < 4; i++) {
          const y = 0.66 + i * 0.09 + rng() * 0.03;
          R.line([[x + side * 0.016, y], [x + side * (0.04 + rng() * 0.02), y + 0.012]], 0.65, 0.75);
        }
      }
      F1.wash([[px - 0.05, py - 0.02], [px + 0.05, py + 0.03]], 0.28, 0.32);
      F1.wash([[0.5, py + 0.12], [0.5, 1.05]], HW * 1.5, 0.34);
      F1.arc(px, py, 0.12, 0.1, 0.4, 2.7, 0.7, 0.75);
      F1.arc(px, py, 0.07, 0.055, 3.4, 5.9, 0.7, 0.75);
      for (let i = 0; i < 3; i++) wavelet(F1, 0.5 + (rng() - 0.5) * 0.1, 0.68 + i * 0.12, 0, 1, 0.036);
      break;
    }
    case 'sea': {
      R.wash([[0.5, -0.05], [0.5, 0.42]], 0.27, 0.15);
      for (let i = 0; i < 3; i++) R.wash([[-0.05, 0.56 + i * 0.17], [0.5, 0.58 + i * 0.17], [1.05, 0.56 + i * 0.17]], 0.24, 0.13);
      for (const side of [-1, 1]) {
        const X = (d: number) => 0.5 + side * d;
        R.line([[X(HW), -0.05], [X(HW + 0.012), 0.16], [X(0.2), 0.31], [X(0.36), 0.38]], 1.3, 0.95, { wob: 0.45, taper: 0.3 });
        R.line([[X(0.33), 0.37], [X(0.44), 0.4], [X(0.56), 0.41]], 1.25, 0.93, { wob: 0.45, taper: 0.3 });
        for (let i = 0; i < 5; i++) {
          const d = 0.2 + i * 0.07 + rng() * 0.02;
          R.line([[X(d), 0.31 + (d - 0.2) * 0.3 - 0.03], [X(d + 0.015), 0.27 + (d - 0.2) * 0.3 - 0.03 - rng() * 0.03]], 0.65, 0.75);
        }
      }
      for (let row = 0; row < 4; row++) {
        const y = 0.53 + row * 0.125;
        for (let i = -1; i < 8; i++) {
          const cx = i * 0.135 + (row % 2) * 0.067 + (rng() - 0.5) * 0.02;
          R.arc(cx, y, 0.06, 0.036, 0.2, Math.PI - 0.2, 0.8, 0.82, { dep: 0.4 });
        }
      }
      F1.wash([[0.5, -0.05], [0.5, 0.45]], 0.2, 0.34);
      for (let i = 0; i < 3; i++) F1.wash([[-0.05, 0.58 + i * 0.16], [0.5, 0.6 + i * 0.16], [1.05, 0.58 + i * 0.16]], 0.2, 0.26);
      for (let i = 0; i < 3; i++) wavelet(F1, 0.5 + (rng() - 0.5) * 0.12, 0.08 + i * 0.12, 0, 1, 0.036);
      break;
    }
    case 'land':
      for (let i = 0; i < 5; i++) R.dot(0.08 + rng() * 0.84, 0.08 + rng() * 0.84, 0.45, 0.45);
      break;
  }
  if (s.fixed && kind !== 'whirl') frame(R);
}

function paintScenery(G: Brush, s: FaceSpec): void {
  for (const m of motifSpots(s.kind, s.seed, s.variant, s.mark)) {
    const u = G.sub(m.x, m.y, 1, (-s.rot * Math.PI) / 2);
    drawMotif(u, m.type, 0, 0, m.r, m.seed, null);
    u.done();
  }
}

function sprig(R: Brush, x: number, y: number, r: number, a: number): void {
  const m = R.sub(x, y, r);
  m.arc(0, 0, 1, 1, 0.12, Math.PI / 2 - 0.12, 0.9, a);
  m.arc(0, 0, 0.62, 0.62, 0.2, Math.PI / 2 - 0.2, 0.6, a * 0.9);
  for (let i = 0; i < 3; i++) {
    const an = 0.25 + i * 0.52;
    m.line([[Math.cos(an) * 1.12, Math.sin(an) * 1.12], [Math.cos(an) * 1.55, Math.sin(an) * 1.55]], 0.8, a, { taper: 0.9 });
  }
  m.dot(1.38, 1.38, 0.9, a);
  m.done();
}

function paintSurround(R: Brush, v: number): void {
  const a = 0.6;
  for (let k = 0; k < 4; k++) {
    const m = R.sub(0.5, 0.5, 1, (k * Math.PI) / 2);
    sprig(m, -0.5, -0.5, 0.07, a);
    m.done();
  }
  const rng = mulberry(900 + v);
  if (v === 2) {
    // a small flower
    R.line([[0.5, 0.6], [0.49, 0.5], [0.5, 0.45]], 0.8, a);
    for (let i = 0; i < 5; i++) {
      const an = (i / 5) * 6.283 + 0.3;
      R.arc(0.5 + Math.cos(an) * 0.022, 0.43 + Math.sin(an) * 0.022, 0.016, 0.012, 0, 6.3, 0.6, a);
    }
    R.line([[0.495, 0.55], [0.46, 0.52]], 0.7, a);
    R.line([[0.5, 0.57], [0.535, 0.54]], 0.7, a);
  } else if (v === 4) {
    // a small bird
    R.arc(0.5, 0.5, 0.04, 0.026, 0, 6.3, 0.75, a);
    R.line([[0.535, 0.49], [0.56, 0.47], [0.575, 0.475]], 0.7, a);
    R.line([[0.465, 0.5], [0.42, 0.51], [0.4, 0.5]], 0.7, a);
    R.line([[0.495, 0.525], [0.495, 0.56]], 0.55, a);
    R.line([[0.51, 0.525], [0.512, 0.56]], 0.55, a);
    R.line([[0.46, 0.565], [0.55, 0.565]], 0.55, a * 0.8);
  } else if (v === 5) {
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * 6.283 + rng() * 0.1;
      R.line([[0.5, 0.5], [0.5 + Math.cos(an) * 0.035, 0.5 + Math.sin(an) * 0.035]], 0.75, a, { taper: 0.9 });
    }
    R.dot(0.5, 0.5, 0.9, a);
  }
}

function paintBorder(R: Brush, S: Brush, v: number): void {
  const rng = mulberry(500 + v * 17);
  const run = (y: number, w: number, a: number) => R.line([[-0.05, y], [0.5, y + (rng() - 0.5) * 0.006], [1.05, y]], w, a, { wob: 0.3, dep: 0.2, taper: 0.2 });
  run(0.085, 1.6, 0.95);
  run(0.125, 0.6, 0.82);
  run(0.915, 1.6, 0.95);
  run(0.875, 0.6, 0.82);
  R.wash([[-0.05, 0.62], [0.5, 0.63], [1.05, 0.62]], 0.2, 0.15);
  R.wash([[-0.05, 0.72], [1.05, 0.72]], 0.1, 0.12);
  for (let i = -1; i < 3; i++) {
    const x = i * 0.5 + 0.02;
    const j = () => (rng() - 0.5) * 0.012;
    // a running wave: the crest curls over, the back slopes down to the next
    S.line(
      [
        [x - 0.06, 0.7, 0.7],
        [x + 0.14, 0.62 + j(), 1],
        [x + 0.32, 0.4 + j(), 1.25],
        [x + 0.33, 0.28 + j(), 1.2],
        [x + 0.24, 0.25, 1],
        [x + 0.18, 0.33 + j(), 0.9],
        [x + 0.22, 0.42, 0.8],
        [x + 0.275, 0.4, 0.6],
      ],
      1.35,
      0.95,
      { dep: 0.3, wob: 0.25 },
    );
    S.line([[x + 0.35, 0.34, 1.1], [x + 0.42, 0.56, 1], [x + 0.5, 0.69, 0.7]], 1.2, 0.93, { wob: 0.25 });
    S.line([[x + 0.1, 0.76], [x + 0.2, 0.73], [x + 0.3, 0.77]], 0.65, 0.75);
    S.dot(x + 0.46, 0.3 + j(), 0.9, 0.85);
    S.dot(x + 0.03, 0.5 + j(), 0.6, 0.7);
  }
}

function paintCorner(R: Brush, v: number): void {
  const rng = mulberry(700 + v * 31);
  const bendLine = (i: number, w: number, a: number) =>
    R.line([[1.05, i], [i + 0.05, i], [i + 0.006, i + 0.006], [i, i + 0.05], [i, 1.05]], w, a, { wob: 0.25, dep: 0.2, taper: 0.2 });
  bendLine(0.085, 1.6, 0.95);
  bendLine(0.125, 0.6, 0.82);
  for (const [i, w, a] of [[0.915, 1.6, 0.95], [0.875, 0.6, 0.82]] as [number, number, number][])
    R.line([[1.05, i], [i + 0.01, i], [i, i + 0.01], [i, 1.05]], w, a, { raw: true, wob: 0.2, taper: 0.2 });
  // a shell fanning out from the inner corner
  const cx = 0.83;
  const cy = 0.83;
  R.wash([[0.62, 0.5], [0.5, 0.62]], 0.3, 0.15);
  const n = 7;
  const tips: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * (Math.PI / 2);
    const r = 0.56 + 0.05 * Math.sin((i / n) * Math.PI) + (rng() - 0.5) * 0.02;
    const tx = cx + Math.cos(a) * r;
    const ty = cy + Math.sin(a) * r;
    tips.push([tx, ty]);
    R.line([[cx + Math.cos(a) * 0.08, cy + Math.sin(a) * 0.08, 0.7], [(cx + tx) / 2 + (rng() - 0.5) * 0.02, (cy + ty) / 2, 1.1], [tx, ty, 0.9]], 1.1, 0.93, { dep: 0.3 });
  }
  for (let i = 0; i < n; i++) {
    const a = tips[i];
    const c = tips[i + 1];
    const mx = (a[0] + c[0]) / 2 - (cx - (a[0] + c[0]) / 2) * 0.12;
    const my = (a[1] + c[1]) / 2 - (cy - (a[1] + c[1]) / 2) * 0.12;
    R.line([a, [mx, my], c], 1.2, 0.94, { wob: 0.2 });
  }
  R.arc(cx, cy, 0.09, 0.09, Math.PI * 0.9, Math.PI * 1.6, 1.1, 0.92);
  R.dot(cx - 0.02, cy - 0.02, 1.4, 0.9);
}

export class TilePainter {
  private cv: HTMLCanvasElement[] = [];
  private cx: CanvasRenderingContext2D[] = [];

  constructor() {
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = c.height = CELL;
      this.cv.push(c);
      this.cx.push(c.getContext('2d', { willReadFrequently: true })!);
    }
  }

  private begin(i: number, seed: number): Brush {
    const c = this.cx[i];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, CELL, CELL);
    c.setTransform(INNER, 0, 0, INNER, PAD, PAD);
    return new Brush(c, mulberry(seed * 4 + i), INNER);
  }

  private pack(i: number, out: Uint8Array): void {
    const d = this.cx[i].getImageData(0, 0, CELL, CELL).data;
    for (let k = 0, n = CELL * CELL; k < n; k++) out[k * 4 + i] = d[k * 4 + 3];
  }

  /** Paint all four layers of a game tile face. */
  face(s: FaceSpec): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(CELL * CELL * 4);
    const R = this.begin(0, s.seed);
    const G = this.begin(1, s.seed);
    const F1 = this.begin(2, s.seed);
    const F2 = this.begin(3, s.seed);
    paintBase(R, F1, F2, s);
    paintScenery(G, s);
    for (let i = 0; i < 4; i++) this.pack(i, out);
    return out;
  }

  /** Repaint only the upright scenery after the tile has been turned. */
  scenery(s: FaceSpec, out: Uint8Array): void {
    paintScenery(this.begin(1, s.seed), s);
    this.pack(1, out);
  }

  /** The lasting tiles of the wall: plain surround, border runs, border corners. */
  fixture(kind: 'surround' | 'border' | 'corner', v: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(CELL * CELL * 4);
    const R = this.begin(0, 300 + v);
    const S = this.begin(1, 300 + v);
    if (kind === 'surround') paintSurround(R, v);
    else if (kind === 'border') paintBorder(R, S, v);
    else paintCorner(R, v);
    this.pack(0, out);
    this.pack(1, out);
    return out;
  }
}
