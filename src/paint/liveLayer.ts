import * as THREE from 'three';
import { mulberry } from '../core/rng.ts';
import type { QualitySettings } from '../quality.ts';
import { Brush } from './brush.ts';

// The painted film. One canvas covers the panel and its border in wall space.
// Whatever moves in paint (the boat, wavelets, waking scenery, the sea
// creature) is redrawn here ten times a second and added to the tile paint
// in the glaze shader, so it only ever shows on glaze, never on grout.
// The next picture is painted on a second canvas, a little each frame, and
// swapped in whole when it is done, so a slow machine paints fewer pictures a
// second instead of stuttering.
export class Live {
  canvas = document.createElement('canvas'); // on show
  private back = document.createElement('canvas'); // being painted
  ctx = this.back.getContext('2d')!;
  tex = new THREE.CanvasTexture(this.canvas);
  px = 256;
  cols = 1;
  rows = 1;
  private q: QualitySettings;

  constructor(q: QualitySettings) {
    this.q = q;
    this.setup();
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
  }

  private setup(): void {
    this.tex.flipY = false;
    this.tex.premultiplyAlpha = false;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.NoColorSpace;
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.px = Math.min(this.q.filmPx, Math.floor((this.q.filmPx * 8) / cols));
    this.tex.dispose();
    for (const c of [this.canvas, this.back]) {
      c.width = cols * this.px;
      c.height = rows * this.px;
    }
    this.canvas.getContext('2d')!.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.setup();
  }

  begin(frame: number): Brush {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.back.width, this.back.height);
    c.setTransform(this.px, 0, 0, this.px, 0, 0);
    const b = new Brush(c, mulberry(77 + (frame % 3) * 911), this.px);
    b.lite = this.q.liteStrokes;
    return b;
  }

  /** The new picture is finished: put it on show. */
  end(): void {
    [this.canvas, this.back] = [this.back, this.canvas];
    this.ctx = this.back.getContext('2d')!;
    this.tex.image = this.canvas;
    this.tex.needsUpdate = true;
  }
}
