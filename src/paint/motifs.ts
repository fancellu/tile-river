import { mulberry } from '../core/rng.ts';
import { Brush, type P } from './brush.ts';

// Upright scenery, the boat and the sea creature. Every motif is drawn in a
// frame whose unit is the motif radius, with the ground near y = +0.72.
// `A` is null for a sleeping motif (painted once into the tile) and carries
// the time since waking for a live one. A live motif is redrawn 10 times a
// second from three alternating hands (line boil), like a painted film.

export interface Anim {
  t: number; // seconds since the motif woke
  f: number; // picture number
}

const TAU = Math.PI * 2;

function bird(m: Brush, x: number, y: number, s: number, flap: number, w: number): void {
  m.line([[x - s, y - s * flap], [x - s * 0.45, y - s * (flap * 0.5 + 0.35)], [x, y]], w, 0.9, { taper: 0.9, wob: 0.1 });
  m.line([[x, y], [x + s * 0.45, y - s * (flap * 0.5 + 0.35)], [x + s, y - s * flap]], w, 0.9, { taper: 0.9, wob: 0.1 });
}

function ground(m: Brush, x0: number, x1: number, w: number): void {
  m.line([[x0, 0.72], [(x0 + x1) / 2, 0.735], [x1, 0.72]], w * 0.9, 0.8, { dep: 0.5 });
  const g = m.rng;
  for (let i = 0; i < 3; i++) {
    const x = x0 + (x1 - x0) * (0.15 + 0.7 * g());
    m.line([[x, 0.8], [x + 0.1, 0.81]], w * 0.6, 0.55, { dep: 0.6 });
  }
}

function crown(m: Brush, g: () => number, cx: number, cy: number, r: number, w: number): void {
  m.wash([[cx + r * 0.15, cy - r * 0.2], [cx + r * 0.25, cy + r * 0.35]], r * 1.25, 0.2);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + g() * 0.5;
    const rr = r * (0.8 + 0.25 * g());
    m.arc(cx + Math.cos(a) * rr * 0.45, cy + Math.sin(a) * rr * 0.45, rr * 0.55, rr * 0.5, a - 1.3, a + 1.2, w * 0.85, 0.85, { dep: 0.4 });
  }
  for (let i = 0; i < 4; i++) m.arc(cx + (g() - 0.3) * r, cy + (g() - 0.2) * r, r * 0.22, r * 0.18, 0.3, 2.6, w * 0.7, 0.75);
}

function tree(m: Brush, g: () => number, x: number, r: number, top: number, w: number, sway: number): void {
  m.line([[x - 0.02, 0.72, 1.3], [x + 0.01, top + r * 1.2, 1], [x + sway * 0.5, top + r * 0.6, 0.7]], w * 1.2, 0.92);
  m.line([[x + 0.02, top + r * 1.5], [x + r * 0.5 + sway, top + r * 0.9]], w * 0.7, 0.8);
  crown(m, g, x + sway, top + r * 0.3, r, w);
}

export function drawMotif(b: Brush, type: string, x: number, y: number, r: number, seed: number, A: Anim | null): void {
  const g = mulberry(seed);
  const m = b.sub(x, y, r);
  m.rng = mulberry(seed * 31 + (A ? (A.f % 3) * 7919 : 0));
  const W = Math.min(1, 0.5 + r * 1.6);
  const t = A ? A.t : 0;
  switch (type) {
    case 'windmill': {
      ground(m, -0.75, 0.75, W);
      m.wash([[0.12, -0.05], [0.2, 0.62]], 0.24, 0.24);
      m.line([[-0.32, 0.72, 1.2], [-0.24, 0.3], [-0.15, -0.14, 0.8]], W, 0.95);
      m.line([[0.32, 0.72, 1.2], [0.24, 0.3], [0.15, -0.14, 0.8]], W * 1.15, 0.95);
      m.arc(0, -0.13, 0.2, 0.2, Math.PI, TAU, W, 0.95);
      m.line([[-0.2, -0.13], [0.2, -0.13]], W * 0.8, 0.85);
      m.line([[-0.36, 0.32], [0.36, 0.32]], W * 0.9, 0.9);
      for (let i = -3; i <= 3; i++) m.line([[i * 0.1, 0.32], [i * 0.1, 0.24]], W * 0.5, 0.7);
      m.arc(0, 0.72, 0.08, 0.2, Math.PI, TAU, W * 0.9, 0.9);
      m.dot(0.02, 0.1, W * 1.4, 0.8);
      const th = 0.5 + g() * 1.2 + t * 1.25;
      for (let k = 0; k < 4; k++) {
        const a = th + (k * Math.PI) / 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const px = -dy;
        const py = dx;
        const hx = 0;
        const hy = -0.2;
        m.line([[hx, hy, 1.2], [hx + dx * 0.9, hy + dy * 0.9, 0.9]], W * 1.1, 0.95, { taper: 0.3, wob: 0.15 });
        const o = 0.19;
        m.line([[hx + dx * 0.24 + px * o, hy + dy * 0.24 + py * o], [hx + dx * 0.9 + px * o, hy + dy * 0.9 + py * o]], W * 0.7, 0.85, { wob: 0.15 });
        for (let j = 0; j < 4; j++) {
          const d = 0.24 + j * 0.22;
          m.line([[hx + dx * d, hy + dy * d], [hx + dx * d + px * o, hy + dy * d + py * o]], W * 0.6, 0.8, { wob: 0.1 });
        }
      }
      m.dot(0, -0.2, W * 1.6, 0.95);
      break;
    }
    case 'cottage': {
      ground(m, -0.85, 0.85, W);
      m.wash([[-0.4, 0.0], [0.45, 0.02]], 0.42, 0.22);
      m.line([[-0.52, 0.72], [-0.52, 0.2]], W, 0.92);
      m.line([[0.52, 0.72], [0.52, 0.2]], W * 1.1, 0.92);
      m.line([[-0.68, 0.24, 0.8], [-0.36, -0.28], [0.36, -0.28], [0.68, 0.24, 0.8]].map((p) => p as P), W * 1.1, 0.95, { raw: false });
      m.line([[-0.68, 0.24], [0.68, 0.24]], W * 0.9, 0.9);
      for (let i = 0; i < 8; i++) {
        const xx = -0.5 + i * 0.14 + g() * 0.04;
        m.line([[xx * 0.75, -0.2], [xx, 0.18]], W * 0.55, 0.7, { dep: 0.6 });
      }
      m.line([[0.2, -0.28], [0.2, -0.5], [0.34, -0.5], [0.34, -0.28]], W * 0.9, 0.9, { raw: true });
      m.line([[-0.12, 0.72], [-0.12, 0.42], [0.1, 0.42], [0.1, 0.72]], W * 0.8, 0.9, { raw: true });
      m.line([[0.24, 0.4], [0.42, 0.4], [0.42, 0.56], [0.24, 0.56], [0.24, 0.4]], W * 0.6, 0.85, { raw: true });
      m.wash([[0.33, 0.48], [0.34, 0.49]], 0.14, 0.3);
      if (A)
        for (let i = 0; i < 3; i++) {
          const age = (t * 0.45 + i / 3) % 1;
          const sx = 0.27 + age * 0.4 + 0.08 * Math.sin(age * 7 + i);
          const sy = -0.55 - age * 0.75;
          const rr = 0.06 + 0.1 * age;
          m.arc(sx, sy, rr, rr * 0.8, age * 5, age * 5 + 4.4, W * 0.7, 0.75 * (1 - age * 0.8), { dep: 0.5 });
        }
      break;
    }
    case 'church': {
      ground(m, -0.85, 0.8, W);
      m.wash([[0.32, -0.2], [0.34, 0.6]], 0.2, 0.26);
      m.line([[-0.66, 0.72], [-0.66, 0.26]], W, 0.92);
      m.line([[-0.7, 0.27], [-0.55, -0.04], [0.1, -0.04]], W, 0.92, { raw: true });
      m.line([[-0.7, 0.27], [0.1, 0.27]], W * 0.8, 0.85);
      for (let i = 0; i < 3; i++) m.arc(-0.48 + i * 0.22, 0.52, 0.055, 0.12, Math.PI, TAU, W * 0.7, 0.85);
      m.line([[0.1, 0.72], [0.1, -0.28]], W, 0.95);
      m.line([[0.42, 0.72], [0.42, -0.28]], W * 1.15, 0.95);
      m.line([[0.06, -0.28], [0.46, -0.28]], W * 0.9, 0.9);
      m.line([[0.08, -0.28, 1.1], [0.26, -0.84, 0.6]], W, 0.95);
      m.line([[0.44, -0.28, 1.1], [0.26, -0.84, 0.6]], W, 0.95);
      m.line([[0.26, -0.84], [0.26, -0.98]], W * 0.6, 0.85);
      m.arc(0.26, 0.0, 0.06, 0.1, Math.PI, TAU, W * 0.7, 0.85);
      m.arc(0.26, 0.72, 0.07, 0.18, Math.PI, TAU, W * 0.8, 0.9);
      if (A)
        for (let i = 0; i < 3; i++) {
          const a = t * 0.9 + i * 2.1;
          bird(m, 0.26 + Math.cos(a) * 0.5, -0.72 + Math.sin(a) * 0.16 - 0.1 * i, 0.09, Math.sin(t * 9 + i * 2) * 0.7 + 0.2, W * 0.7);
        }
      break;
    }
    case 'trees': {
      ground(m, -0.85, 0.85, W);
      const sw = A ? Math.sin(t * 1.7) * 0.035 : 0;
      tree(m, g, -0.45, 0.27, -0.2, W, sw);
      tree(m, g, 0.42, 0.24, -0.02, W, sw * 0.7);
      tree(m, g, 0.0, 0.33, -0.48, W, sw * 1.2);
      if (A && t < 5)
        for (let i = 0; i < 3; i++) {
          const k = Math.max(0, t - 0.2 - i * 0.25);
          if (k <= 0) continue;
          bird(m, -0.1 + i * 0.2 + k * 0.55, -0.6 - k * 0.5 + 0.06 * Math.sin(k * 5 + i), 0.1, Math.sin(t * 10 + i * 2) * 0.7 + 0.2, W * 0.7);
        }
      break;
    }
    case 'tree': {
      ground(m, -0.6, 0.6, W);
      tree(m, g, 0, 0.42, -0.5, W, A ? Math.sin(t * 1.7 + seed) * 0.04 : 0);
      break;
    }
    case 'poplar': {
      ground(m, -0.5, 0.5, W);
      const sw = A ? Math.sin(t * 1.5 + seed) * 0.06 : 0;
      m.line([[0, 0.72, 1.2], [0, 0.3]], W, 0.9);
      m.wash([[0.05, 0.3], [0.06 + sw * 0.5, -0.5]], 0.3, 0.2);
      for (let s = -1; s <= 1; s += 2) {
        const pts: P[] = [];
        for (let i = 0; i <= 7; i++) {
          const k = i / 7;
          const wdt = Math.sin(Math.PI * Math.pow(k, 0.8)) * 0.22;
          pts.push([s * wdt * (i % 2 ? 1 : 0.7) + sw * k, 0.42 - k * 1.3]);
        }
        m.line(pts, W * 0.85, 0.88, { dep: 0.4 });
      }
      for (let i = 0; i < 3; i++) m.line([[(g() - 0.5) * 0.14, 0.3 - i * 0.3], [(g() - 0.5) * 0.14 + sw * 0.5, 0.05 - i * 0.3]], W * 0.6, 0.7);
      break;
    }
    case 'bush': {
      m.line([[-0.75, 0.72], [0.75, 0.72]], W * 0.8, 0.75, { dep: 0.5 });
      for (let i = 0; i < 3; i++) m.arc(-0.42 + i * 0.42, 0.7, 0.3, 0.42 + g() * 0.2, Math.PI * 1.05, Math.PI * 1.95, W * 0.9, 0.88, { dep: 0.4 });
      m.wash([[-0.2, 0.5], [0.4, 0.52]], 0.3, 0.2);
      for (let i = 0; i < 3; i++) {
        const xx = -0.5 + i * 0.5 + g() * 0.1;
        const sw = A ? Math.sin(t * 2 + i) * 0.05 : 0;
        m.line([[xx, 0.3], [xx + 0.03 + sw, 0.02]], W * 0.6, 0.75);
      }
      break;
    }
    case 'reeds': {
      m.line([[-0.7, 0.72], [0.7, 0.74]], W * 0.8, 0.7, { dep: 0.5 });
      for (let i = 0; i < 6; i++) {
        const xx = -0.6 + i * 0.16 + g() * 0.06;
        const lean = (g() - 0.4) * 0.3 + (A ? Math.sin(t * 2.2 + i) * 0.05 : 0);
        const top = -0.35 + g() * 0.5;
        m.line([[xx, 0.72, 1.1], [xx + lean * 0.4, 0.2], [xx + lean, top, 0.6]], W * 0.75, 0.88);
        if (i % 2 === 0) m.line([[xx + lean, top + 0.02], [xx + lean * 1.1, top + 0.2]], W * 1.6, 0.9, { taper: 0.4 });
      }
      // a heron stands in the reeds; it lifts off when the boat wakes it
      if (!A || t < 0.5) {
        m.line([[0.38, 0.72], [0.4, 0.38]], W * 0.6, 0.85);
        m.line([[0.48, 0.72], [0.45, 0.38]], W * 0.6, 0.85);
        m.arc(0.42, 0.26, 0.2, 0.13, 0, TAU, W * 0.9, 0.9);
        m.wash([[0.36, 0.28], [0.5, 0.3]], 0.16, 0.25);
        m.line([[0.56, 0.2], [0.68, -0.02], [0.58, -0.2], [0.66, -0.36]], W * 0.9, 0.92);
        m.line([[0.66, -0.36], [0.88, -0.3]], W * 0.7, 0.9);
      } else if (t < 6) {
        const k = t - 0.5;
        bird(m, 0.5 + k * 0.75, 0.1 - k * 0.6, 0.26, Math.sin(t * 7) * 0.75 + 0.15, W * 0.9);
        m.line([[0.5 + k * 0.75 - 0.12, 0.14 - k * 0.6], [0.5 + k * 0.75 - 0.34, 0.24 - k * 0.6]], W * 0.6, 0.8);
      }
      break;
    }
    case 'haystack':
    case 'haystack2': {
      ground(m, -0.8, 0.8, W);
      m.wash([[0.15, 0.1], [0.3, 0.6]], 0.4, 0.22);
      m.line([[-0.5, 0.72, 1.1], [-0.42, 0.1], [0, -0.3], [0.42, 0.1], [0.5, 0.72, 1.1]], W, 0.93);
      for (let i = 0; i < 7; i++) {
        const xx = -0.36 + i * 0.12;
        m.line([[xx * 0.5, -0.12 + Math.abs(xx) * 0.5], [xx, 0.6]], W * 0.55, 0.7, { dep: 0.6 });
      }
      m.line([[0, -0.3], [0.02, -0.62]], W * 0.7, 0.85);
      if (type === 'haystack2') {
        // a cart beside the stack
        m.arc(-0.72, 0.6, 0.11, 0.11, 0, TAU, W * 0.7, 0.85);
        m.line([[-0.95, 0.44], [-0.55, 0.44]], W * 0.8, 0.9);
        m.line([[-0.55, 0.44], [-0.4, 0.3]], W * 0.6, 0.8);
        if (A) for (let i = 0; i < 2; i++) bird(m, -0.2 + i * 0.5 + Math.sin(t * 0.8 + i) * 0.3, -0.7 - 0.1 * i + Math.cos(t * 1.1 + i) * 0.08, 0.1, Math.sin(t * 9 + i) * 0.7 + 0.2, W * 0.7);
      }
      break;
    }
    case 'beacon': {
      ground(m, -0.6, 0.6, W);
      m.line([[0, 0.72, 1.2], [0, -0.55]], W * 1.1, 0.95, { wob: 0.15 });
      m.line([[-0.3, 0.72], [0, 0.2]], W * 0.7, 0.85);
      m.line([[0.3, 0.72], [0, 0.2]], W * 0.7, 0.85);
      m.line([[-0.16, -0.55], [0, -0.78], [0.16, -0.55], [-0.16, -0.55]], W * 0.8, 0.9, { raw: true });
      const fl = A ? Math.sin(t * 6) * 0.07 : 0;
      m.line([[0, -0.8], [0.25, -0.86 + fl], [0.5, -0.78 - fl], [0.7, -0.84 + fl]], W * 0.9, 0.9);
      break;
    }
    case 'fish': {
      if (!A) {
        m.arc(0, 0.1, 0.35, 0.12, 0.3, 2.8, W * 0.6, 0.6);
        break;
      }
      const T = 2.8;
      const u = ((t + (seed % 17) * 0.31) % T) / 0.8;
      if (u < 1) {
        const fx = -0.9 + 1.8 * u;
        const fy = 0.15 - Math.sin(Math.PI * u) * 1.25;
        const ang = Math.atan2(-Math.cos(Math.PI * u) * 1.25 * Math.PI, 1.8);
        const f = m.sub(fx, fy, 1, ang);
        f.line([[-0.42, 0], [-0.1, -0.2], [0.3, -0.1], [0.45, 0]], W * 0.9, 0.95, { wob: 0.1 });
        f.line([[-0.42, 0], [-0.1, 0.18], [0.3, 0.1], [0.45, 0]], W * 0.9, 0.95, { wob: 0.1 });
        f.line([[-0.42, 0], [-0.66, -0.2]], W, 0.9);
        f.line([[-0.42, 0], [-0.66, 0.2]], W, 0.9);
        f.wash([[-0.2, 0.02], [0.25, 0.02]], 0.22, 0.3);
        f.dot(0.3, -0.03, W * 0.9, 0.95);
        f.done();
        for (const sx of [-0.9, 0.9]) {
          if ((sx < 0 && u > 0.35) || (sx > 0 && u < 0.65)) continue;
          for (let i = -1; i <= 1; i++) m.line([[sx + i * 0.1, 0.12], [sx + i * 0.26, -0.18 - (i === 0 ? 0.12 : 0)]], W * 0.6, 0.8);
        }
      } else {
        const k = Math.min(1, (u - 1) / 1.6);
        for (let i = 0; i < 2; i++) {
          const rr = 0.15 + k * 0.5 + i * 0.2;
          m.arc(0.9, 0.15, rr, rr * 0.35, 0.2, 2.9, W * 0.6, 0.7 * (1 - k));
        }
      }
      break;
    }
    case 'sun': {
      m.arc(0, 0, 0.42, 0.42, 0, TAU, W, 0.92);
      m.wash([[-0.05, 0], [0.1, 0.05]], 0.6, 0.25);
      const sp = A ? t * 0.5 : 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + sp;
        m.line([[Math.cos(a) * 0.58, Math.sin(a) * 0.58], [Math.cos(a) * (i % 2 ? 0.82 : 0.98), Math.sin(a) * (i % 2 ? 0.82 : 0.98)]], W * 0.9, 0.9);
      }
      break;
    }
    case 'moon': {
      m.arc(0, 0, 0.6, 0.6, 0.9, 5.4, W, 0.92);
      m.arc(0.3, 0, 0.5, 0.52, 1.35, 4.95, W * 0.85, 0.9);
      m.wash([[-0.35, -0.3], [-0.42, 0.25]], 0.26, 0.3);
      const tw = A ? Math.sin(t * 3) * 0.4 : 0;
      m.dot(0.55, -0.5, W * (1.1 + tw), 0.9);
      m.dot(0.7, 0.35, W * (0.9 - tw), 0.85);
      break;
    }
    default:
      break;
  }
  m.done();
}

/** The sailing boat. x, y: where the hull sits on the water. s: half length. */
export function drawBoat(b: Brush, x: number, y: number, s: number, facing: number, t: number, f: number, moving: boolean): void {
  const tilt = Math.sin(t * 2.3) * 0.045;
  const m = b.sub(x, y + Math.sin(t * 3.1) * s * 0.05, s, tilt * facing, facing);
  m.rng = mulberry(4711 + (f % 3) * 131);
  const W = 0.95;
  // hull
  m.wash([[-0.7, 0.3], [0.7, 0.27]], 0.36, 0.42);
  m.line([[-0.95, 0.1, 0.9], [-0.3, 0.17], [0.5, 0.14], [1.02, 0.0, 0.8]], W, 0.95);
  m.line([[-0.95, 0.1, 1], [-0.72, 0.44], [0.0, 0.52, 1.3], [0.62, 0.46], [1.02, 0.0, 0.9]], W * 1.25, 0.97);
  m.line([[-0.8, 0.28], [0.0, 0.34], [0.8, 0.24]], W * 0.55, 0.75, { dep: 0.5 });
  m.line([[-0.95, 0.1], [-1.06, -0.2]], W, 0.9);
  // mast and sails
  m.line([[0.06, 0.14, 1.2], [0.05, -1.5, 0.8]], W * 1.1, 0.96, { wob: 0.1, taper: 0.3 });
  const bil = 0.08 * Math.sin(t * 1.9);
  m.wash([[0.36, -1.0], [0.45, -0.4]], 0.5, 0.17);
  m.line([[0.1, -1.38], [0.62 + bil, -1.0], [0.84 + bil, -0.5], [0.82, -0.2]], W, 0.94);
  m.line([[0.1, -0.16], [0.82, -0.2]], W * 0.9, 0.92);
  m.line([[0.12, -0.98], [0.5 + bil, -0.9], [0.74 + bil, -0.74]], W * 0.5, 0.65, { dep: 0.6 });
  m.line([[0.12, -0.58], [0.5 + bil, -0.52], [0.8 + bil, -0.42]], W * 0.5, 0.65, { dep: 0.6 });
  m.wash([[-0.28, -0.75], [-0.36, -0.35]], 0.32, 0.22);
  m.line([[0.0, -1.22], [-0.42 - bil, -0.7], [-0.76 - bil, -0.2]], W * 0.95, 0.94);
  m.line([[0.0, -0.2], [-0.76 - bil, -0.2]], W * 0.85, 0.9);
  // pennant
  const fl = Math.sin(t * 7) * 0.05;
  m.line([[0.05, -1.5], [-0.2, -1.56 + fl], [-0.42, -1.48 - fl], [-0.6, -1.54 + fl]], W * 1.1, 0.95);
  // water at the bow and the wake
  m.arc(1.08, 0.46, 0.14, 0.1, 3.4, 5.6, W * 0.7, 0.8);
  if (moving)
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.9 + i * 0.25) % 1;
      const wx = -1.05 - k * 1.3;
      m.line([[wx, 0.5], [wx - 0.12, 0.44], [wx - 0.24, 0.5], [wx - 0.36, 0.45]], W * 0.6, 0.8 * (1 - k));
    }
  else m.arc(0, 0.6, 1.25, 0.12, 0.2, 2.95, W * 0.6, 0.6);
  m.done();
}

/**
 * The sea creature that rolls through the border. x, y: head position on the
 * water line. s: scale. dir: +1 swims right, -1 left. up: 0 under .. 1 risen.
 */
export function drawCreature(b: Brush, x: number, y: number, s: number, dir: number, t: number, f: number, up: number): void {
  if (up <= 0.02) return;
  const m = b.sub(x, y, s, 0, dir);
  m.rng = mulberry(977 + (f % 3) * 53);
  const W = 1;
  const roll = t * 2.4;
  // head
  const hy = -0.55 * up - 0.12 * Math.sin(roll);
  m.wash([[-0.55, hy + 0.32], [0.15, hy + 0.02]], 0.56, 0.45);
  m.line([[-0.85, 0.05, 1.2], [-0.7, hy - 0.05], [-0.25, hy - 0.42], [0.3, hy - 0.3], [0.62, hy + 0.02, 0.8]], W * 1.2, 0.96);
  m.line([[0.62, hy + 0.02], [0.25, hy + 0.14], [-0.05, hy + 0.3], [-0.2, 0.05]], W, 0.94);
  m.line([[0.6, hy + 0.03], [0.3, hy + 0.0], [0.12, hy + 0.06]], W * 0.7, 0.85);
  m.dot(0.18, hy - 0.14, 1.5, 0.95);
  m.arc(0.18, hy - 0.14, 0.09, 0.08, 0, TAU, W * 0.6, 0.85);
  m.line([[-0.3, hy - 0.42], [-0.48, hy - 0.7], [-0.36, hy - 0.52]], W * 0.9, 0.9);
  m.line([[-0.5, hy - 0.3], [-0.72, hy - 0.52], [-0.58, hy - 0.34]], W * 0.9, 0.9);
  for (let i = 0; i < 3; i++) m.arc(-0.45 + i * 0.22, hy + 0.02, 0.09, 0.08, 0.3, 2.9, W * 0.55, 0.7);
  // spout
  for (let i = -1; i <= 1; i++) {
    const k = 0.75 + 0.25 * Math.sin(roll * 1.7 + i);
    m.line([[0.0, hy - 0.45], [0.02 + i * 0.12, hy - 0.45 - 0.45 * k], [i * 0.34, hy - 0.42 - 0.38 * k]], W * 0.7, 0.85, { dep: 0.5 });
    m.dot(i * 0.4, hy - 0.3 - 0.3 * k, 0.8, 0.8);
  }
  // rolling humps
  for (let k = 0; k < 4; k++) {
    const cx = -1.45 - k * 1.05;
    const h = (0.2 + 0.5 * Math.abs(Math.sin(roll * 0.5 - k * 0.8))) * up * (1 - k * 0.13);
    const wd = 0.46;
    m.wash([[cx - wd * 0.55, -h * 0.4], [cx + wd * 0.55, -h * 0.42]], h * 0.95 + 0.1, 0.45);
    m.arc(cx, 0.05, wd, h + 0.05, Math.PI, TAU, W * 1.15, 0.95);
    for (let i = 0; i < 3; i++) m.arc(cx - 0.22 + i * 0.2, -h * 0.45, 0.085, 0.075, 0.3, 2.9, W * 0.55, 0.7);
    m.line([[cx - wd - 0.12, 0.08], [cx - wd, 0.02], [cx - wd + 0.1, 0.09]], W * 0.6, 0.7);
    m.line([[cx + wd - 0.1, 0.09], [cx + wd, 0.02], [cx + wd + 0.12, 0.08]], W * 0.6, 0.7);
  }
  // tail
  const tx = -1.45 - 4 * 1.05 + 0.2;
  const ty = -0.35 * up - 0.18 * Math.sin(roll * 0.5 - 3.4);
  m.line([[tx + 0.35, 0.06, 1.2], [tx + 0.1, ty], [tx - 0.15, ty - 0.2, 0.7]], W * 1.1, 0.95);
  m.line([[tx - 0.15, ty - 0.2], [tx - 0.45, ty - 0.42], [tx - 0.3, ty - 0.12], [tx - 0.15, ty - 0.2]], W * 0.9, 0.92);
  m.line([[tx - 0.15, ty - 0.2], [tx - 0.02, ty - 0.55], [tx + 0.02, ty - 0.22]], W * 0.9, 0.92);
  m.done();
}
