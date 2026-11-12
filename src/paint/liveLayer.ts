import * as THREE from 'three';
import { mulberry } from '../core/rng.ts';
import { Brush } from './brush.ts';

// The painted film. One canvas covers the panel and its border in wall space.
// Whatever moves in paint (the boat, wavelets, waking scenery, the sea
// creature) is redrawn here ten times a second and added to the tile paint
// in the glaze shader, so it only ever shows on glaze, never on grout.
export class Live {
  canvas = document.createElement('canvas');
  ctx = this.canvas.getContext('2d')!;
  tex = new THREE.CanvasTexture(this.canvas);
  px = 256;
  cols = 1;
  rows = 1;

  constructor() {
    this.setup();
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
    this.px = Math.min(256, Math.floor(2048 / cols));
    this.tex.dispose();
    this.canvas.width = cols * this.px;
    this.canvas.height = rows * this.px;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.setup();
  }

  begin(frame: number): Brush {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.px, 0, 0, this.px, 0, 0);
    return new Brush(c, mulberry(77 + (frame % 3) * 911), this.px);
  }

  end(): void {
    this.tex.needsUpdate = true;
  }
}
