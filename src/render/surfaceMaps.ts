import * as THREE from 'three';
import { mulberry } from '../core/rng.ts';

// One tileable map of the glaze, made in code:
//   RG  slope of the glaze surface (broad waves, runs, fine orange peel)
//   B   craze: the fine net of cracks in an old tin glaze
//   A   pinholes: burst bubbles in the glaze
export function makeSurfaceMap(size = 1024): THREE.DataTexture {
  const N = size;
  const rng = mulberry(20241);
  const lattice = (period: number) => {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return (x: number, y: number) => {
      const fx = (x / N) * period;
      const fy = (y / N) * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      let tx = fx - x0;
      let ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const xa = x0 % period;
      const xb = (x0 + 1) % period;
      const ya = y0 % period;
      const yb = (y0 + 1) % period;
      const a = g[ya * period + xa];
      const b = g[ya * period + xb];
      const c = g[yb * period + xa];
      const d = g[yb * period + xb];
      return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
    };
  };
  const octs: [number, number][] = [
    [5, 1.0 / 5],
    [11, 1.0 / 11],
    [37, 0.55 / 37],
    [150, 0.2 / 150],
  ];
  const h = new Float32Array(N * N);
  for (const [period, amp] of octs) {
    const f = lattice(period);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] += f(x, y) * amp;
  }

  // craze: cell borders of a jittered grid (distance to second nearest minus nearest)
  const G = 34;
  const px = new Float32Array(G * G);
  const py = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) {
    px[i] = rng();
    py[i] = rng();
  }
  const data = new Uint8Array(N * N * 4);
  const mask = lattice(7);
  let gmax = 1e-9;
  const gx = new Float32Array(N * N);
  const gy = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      gx[i] = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      gy[i] = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      gmax = Math.max(gmax, Math.abs(gx[i]), Math.abs(gy[i]));
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const fx = (x / N) * G;
      const fy = (y / N) * G;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const k = ((cy + oy + G) % G) * G + ((cx + ox + G) % G);
          const dx = cx + ox + px[k] - fx;
          const dy = cy + oy + py[k] - fy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      const edge = f2 - f1;
      let craze = 1 - Math.min(1, Math.max(0, (edge - 0.012) / 0.045));
      craze *= 0.35 + 0.65 * mask(x, y);
      data[i * 4] = Math.round(127.5 + (gx[i] / gmax) * 120);
      data[i * 4 + 1] = Math.round(127.5 + (gy[i] / gmax) * 120);
      data[i * 4 + 2] = Math.round(craze * 255);
    }
  // pinholes
  for (let k = 0; k < 420; k++) {
    const cx = rng() * N;
    const cy = rng() * N;
    const r = k < 40 ? 2.2 + rng() * 2.2 : 0.9 + rng() * 1.3;
    const R = Math.ceil(r + 1);
    for (let oy = -R; oy <= R; oy++)
      for (let ox = -R; ox <= R; ox++) {
        const d = Math.hypot(ox, oy);
        const a = Math.max(0, Math.min(1, r + 0.5 - d));
        if (a <= 0) continue;
        const xx = (Math.floor(cx) + ox + N) % N;
        const yy = (Math.floor(cy) + oy + N) % N;
        const i = (yy * N + xx) * 4 + 3;
        data[i] = Math.max(data[i], Math.round(a * 255));
      }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
