import type { Rng } from '../core/rng.ts';

// The brush. Everything painted on the wall goes through here.
// A canvas holds pigment density in its alpha channel; the glaze shader turns
// density into cobalt. Two tools, as on a real tile:
//   line  - a pointed liner brush: pressure swells the stroke, the load runs
//           down towards the end, pigment pools where the brush lands and lifts
//   wash  - a broad soft brush dragged along a path: a noisy tip stamped
//           closely so that its bristles leave streaks along the stroke

export type P = [number, number, number?]; // x, y, pressure

export interface LineOpt {
  dep?: number; // how far the load runs down along the stroke, 0..1
  wob?: number; // hand wobble, in stroke widths
  taper?: number; // 0 blunt ends .. 1 pointed ends
  raw?: boolean; // points are already dense, do not smooth
}

let TIPS: HTMLCanvasElement[] | null = null;

function makeTips(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < 4; v++) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const img = g.createImageData(64, 64);
    let s = 1234 + v * 77;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 8) / 16777216;
    };
    // bristle clumps: coarse cells of varying density
    const cell = 4;
    const n = 64 / cell;
    const clump = new Float32Array(n * n);
    for (let i = 0; i < clump.length; i++) clump[i] = 0.45 + 0.55 * rnd();
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const dx = (x - 31.5) / 32;
        const dy = (y - 31.5) / 32;
        const d = Math.sqrt(dx * dx + dy * dy);
        let a = d >= 1 ? 0 : d < 0.7 ? 1 : 1 - (d - 0.7) / 0.3;
        a = a * a * (3 - 2 * a);
        a *= clump[Math.floor(y / cell) * n + Math.floor(x / cell)] * (0.85 + 0.15 * rnd());
        img.data[(y * 64 + x) * 4 + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
    out.push(c);
  }
  return out;
}

export class Brush {
  ctx: CanvasRenderingContext2D;
  rng: Rng;
  px: number; // device pixels per unit, for sampling density
  lw: number; // one "hair" of line weight in current units
  lite = false; // skip the bleed halo and the pooled ends (cheaper, for the film on weak machines)

  constructor(ctx: CanvasRenderingContext2D, rng: Rng, px: number, lw = 0.0145) {
    this.ctx = ctx;
    this.rng = rng;
    this.px = px;
    this.lw = lw;
    if (!TIPS) TIPS = makeTips();
  }

  /** A brush working in a local frame: origin (x, y), unit = r, optional rotation. */
  sub(x: number, y: number, r: number, rot = 0, flipX = 1): Brush {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    if (rot) c.rotate(rot);
    c.scale(r * flipX, r);
    const b = new Brush(c, this.rng, this.px * r, this.lw / r);
    b.lite = this.lite;
    return b;
  }
  done(): void {
    this.ctx.restore();
  }

  /** Catmull-Rom through the points, n segments. */
  static smooth(pts: P[], n: number): P[] {
    if (pts.length < 3) {
      const out: P[] = [];
      const a = pts[0];
      const b = pts[pts.length - 1];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? 1) + ((b[2] ?? 1) - (a[2] ?? 1)) * t]);
      }
      return out;
    }
    const out: P[] = [];
    const m = pts.length - 1;
    for (let i = 0; i <= n; i++) {
      const f = (i / n) * m;
      const k = Math.min(m - 1, Math.floor(f));
      const t = f - k;
      const p0 = pts[Math.max(0, k - 1)];
      const p1 = pts[k];
      const p2 = pts[k + 1];
      const p3 = pts[Math.min(m, k + 2)];
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), (p1[2] ?? 1) + ((p2[2] ?? 1) - (p1[2] ?? 1)) * t]);
    }
    return out;
  }

  private static len(pts: P[]): number {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
  }

  /** Liner stroke. w is in hairs (1 = a normal contour line). */
  line(pts: P[], w = 1, a = 0.9, o: LineOpt = {}): void {
    const c = this.ctx;
    a *= 0.74 + 0.16 * this.rng(); // how full the brush was
    const rng = this.rng;
    const width = w * this.lw;
    const L = Brush.len(pts);
    if (L <= 0) return;
    const n = o.raw ? pts.length - 1 : Math.max(5, Math.min(40, Math.ceil((L * this.px) / 5)));
    const q = o.raw ? pts : Brush.smooth(pts, n);
    const dep = o.dep ?? 0.42;
    const wob = (o.wob ?? 0.35) * width;
    const taper = o.taper ?? 0.7;
    const ph1 = rng() * 6.28;
    const ph2 = rng() * 6.28;
    const f1 = 2 + rng() * 3;
    const lx: number[] = [];
    const ly: number[] = [];
    const rx: number[] = [];
    const ry: number[] = [];
    const cxs: number[] = [];
    const cys: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const pa = q[Math.max(0, i - 1)];
      const pb = q[Math.min(n, i + 1)];
      let tx = pb[0] - pa[0];
      let ty = pb[1] - pa[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const off = wob * (Math.sin(t * f1 * 6.28 + ph1) * 0.6 + Math.sin(t * 17 + ph2) * 0.25);
      const x = q[i][0] - ty * off;
      const y = q[i][1] + tx * off;
      // pressure: lands a little heavy, swells, lifts to a point
      const tin = Math.min(1, t / 0.12);
      const tout = Math.min(1, (1 - t) / 0.28);
      let pr = (1 - taper * 0.55 * (1 - tin)) * (1 - taper * 0.75 * (1 - tout) * (1 - tout));
      pr *= (q[i][2] ?? 1) * (0.72 + 0.5 * (0.5 + 0.5 * Math.sin(t * 7 + ph2)));
      const hw = Math.max(0.2 / this.px, width * pr * 0.5);
      lx.push(x - ty * hw);
      ly.push(y + tx * hw);
      rx.push(x + ty * hw);
      ry.push(y - tx * hw);
      cxs.push(x);
      cys.push(y);
    }
    const poly = (grow: number) => {
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        const x = cxs[i] + (lx[i] - cxs[i]) * grow;
        const y = cys[i] + (ly[i] - cys[i]) * grow;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      for (let i = n; i >= 0; i--) c.lineTo(cxs[i] + (rx[i] - cxs[i]) * grow, cys[i] + (ry[i] - cys[i]) * grow);
      c.closePath();
    };
    const x0 = cxs[0];
    const y0 = cys[0];
    const x1 = cxs[n];
    const y1 = cys[n];
    let fill: string | CanvasGradient;
    if (!this.lite && Math.hypot(x1 - x0, y1 - y0) > L * 0.3) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * (1 - dep * 0.35)})`);
      g.addColorStop(1, `rgba(0,0,0,${a * (1 - dep)})`);
      fill = g;
    } else fill = `rgba(0,0,0,${a * (1 - dep * 0.3)})`;
    // soft bleed of cobalt into the glaze, then the stroke itself
    if (!this.lite) {
      c.fillStyle = `rgba(0,0,0,${a * 0.16})`;
      poly(2.1);
      c.fill();
    }
    c.fillStyle = fill;
    poly(1);
    c.fill();
    // pooling where the brush touches down and where it lifts
    if (!this.lite && width * this.px > 1.1) {
      c.fillStyle = `rgba(0,0,0,${a * 0.5})`;
      c.beginPath();
      c.arc(x0, y0, width * 0.52, 0, 6.3);
      c.fill();
      const k = Math.max(1, n - 2);
      c.beginPath();
      c.arc(cxs[k], cys[k], width * 0.42, 0, 6.3);
      c.fill();
    }
  }

  /** Broad wash. w is the width in units, a the opacity built up in the middle. */
  wash(pts: P[], w: number, a = 0.2, dep = 0.25): void {
    const c = this.ctx;
    const rng = this.rng;
    const dense = Brush.smooth(pts, Math.max(8, pts.length * 6));
    const spacing = Math.max(w * 0.17, 1.2 / this.px);
    const tip = TIPS![Math.floor(rng() * TIPS!.length)];
    const sa = 1 - Math.pow(1 - Math.min(0.95, a), 0.3);
    const L = Brush.len(dense) || 1;
    let acc = 0;
    let travelled = 0;
    const prev = c.globalAlpha;
    const stamp = (x: number, y: number, pr: number, t: number) => {
      const r = w * 0.5 * pr * (0.92 + 0.16 * rng());
      c.globalAlpha = Math.max(0, sa * (1 - dep * t) * (0.75 + 0.5 * rng()));
      c.drawImage(tip, x - r, y - r, r * 2, r * 2);
    };
    stamp(dense[0][0], dense[0][1], dense[0][2] ?? 1, 0);
    for (let i = 1; i < dense.length; i++) {
      const ax = dense[i - 1][0];
      const ay = dense[i - 1][1];
      const bx = dense[i][0];
      const by = dense[i][1];
      const seg = Math.hypot(bx - ax, by - ay);
      let d = spacing - acc;
      while (d <= seg) {
        const f = d / seg;
        stamp(ax + (bx - ax) * f, ay + (by - ay) * f, (dense[i - 1][2] ?? 1) + ((dense[i][2] ?? 1) - (dense[i - 1][2] ?? 1)) * f, (travelled + d) / L);
        d += spacing;
      }
      acc = (acc + seg) % spacing;
      travelled += seg;
    }
    // the puddle left where the brush lifts
    const e = dense[dense.length - 1];
    c.globalAlpha = sa * 1.3;
    c.drawImage(tip, e[0] - w * 0.3, e[1] - w * 0.3, w * 0.6, w * 0.6);
    c.globalAlpha = prev;
  }

  /** A touch of the brush tip. r in hairs. */
  dot(x: number, y: number, r = 1, a = 0.85): void {
    const c = this.ctx;
    const rr = r * this.lw * (0.85 + 0.3 * this.rng());
    if (!this.lite) {
      c.fillStyle = `rgba(0,0,0,${a * 0.2})`;
      c.beginPath();
      c.arc(x, y, rr * 1.7, 0, 6.3);
      c.fill();
    }
    c.fillStyle = `rgba(0,0,0,${a})`;
    c.beginPath();
    c.ellipse(x, y, rr, rr * (0.7 + 0.3 * this.rng()), this.rng() * 3, 0, 6.3);
    c.fill();
  }

  /** Part of a circle or ellipse as a liner stroke. */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, w = 1, a = 0.9, o: LineOpt = {}): void {
    const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * 3));
    const pts: P[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    this.line(pts, w, a, o);
  }

  /** Remove paint inside a polygon (used where one thing passes over another). */
  erase(poly: [number, number][]): void {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.beginPath();
    poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
    c.restore();
  }
}
