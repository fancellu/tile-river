import * as THREE from 'three';
import { CELL } from '../paint/tilePainter.ts';
import { ATLAS_COLS, ATLAS_H, ATLAS_W, groutFrag, groutVert, shadowFrag, shadowVert, tileFrag, tileVert } from './shaders.ts';
import { makeSurfaceMap } from './surfaceMaps.ts';

// The physical wall: every tile is one instance of a clay slab. The wall is a
// fixed grid in world space (tile centres on integers, y up); the camera
// travels to frame whichever panel is being played.

export const GW = 33;
export const GH = 19;
const GX0 = -(GW - 1) / 2;
const GY0 = -(GH - 1) / 2;
const MAX_SHADOWS = 96;

export interface Piece {
  inst: number;
  gx: number; // home cell in the world grid (for fixtures)
  gy: number;
  role: number; // 0 surround, 1 border, 2 game tile
  cell: number; // atlas cell shown
  x: number;
  y: number;
  z: number; // lift off the wall
  hover: number; // extra lift under the pointer
  ang: number; // clockwise turn, radians
  flip: number;
  tiltX: number;
  tiltY: number;
  scale: number;
  seed: number;
  wet: number;
  wet2: number;
  motif: number;
  hidden: boolean;
  jx: number; // how the tiler set it: a little off, a little turned
  jy: number;
  ja: number;
}

export class Wall {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  pieces: Piece[] = [];
  atlas: THREE.DataTexture;
  uniforms: Record<string, THREE.IUniform>;
  private mesh: THREE.InstancedMesh;
  private shadows: THREE.InstancedMesh;
  private aCell: THREE.InstancedBufferAttribute;
  private aSeed: THREE.InstancedBufferAttribute;
  private aFx: THREE.InstancedBufferAttribute;
  private aSh: THREE.InstancedBufferAttribute;
  private m4 = new THREE.Matrix4();
  private m4b = new THREE.Matrix4();
  // camera
  target = new THREE.Vector2();
  dist = 12;
  goalTarget = new THREE.Vector2();
  goalDist = 12;
  pointer = new THREE.Vector2();
  private smoothPtr = new THREE.Vector2();
  view = 'wall';
  private baseRatio = 1;
  scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.baseRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.baseRatio);

    this.atlas = new THREE.DataTexture(new Uint8Array(ATLAS_W * ATLAS_H * 4), ATLAS_W, ATLAS_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.atlas.needsUpdate = true;
    this.renderer.initTexture(this.atlas);

    const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    blank.needsUpdate = true;
    this.uniforms = {
      uAtlas: { value: this.atlas },
      uLive: { value: blank },
      uSurf: { value: makeSurfaceMap() },
      uLiveRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uWin: { value: new THREE.Vector3(-8, 4, 10) },
      uWinSize: { value: new THREE.Vector2(4.6, 6.6) },
      uWinGain: { value: 48 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uExpo: { value: 0.86 },
      uSun: { value: new THREE.Vector4(3, -1, 2, 3) },
    };

    // slab geometry: a top face and four clay sides
    const pos: number[] = [];
    const nor: number[] = [];
    const side: number[] = [];
    const idx: number[] = [];
    const quad = (v: number[][], n: number[], s: number) => {
      const b = pos.length / 3;
      for (const p of v) {
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        side.push(s);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const T = 0.09;
    const S = 0.488;
    quad([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [0, 0, 1], 0);
    quad([[S, -S, 0], [S, S, 0], [S, S, -T], [S, -S, -T]], [1, 0, 0], 1);
    quad([[-S, S, 0], [-S, -S, 0], [-S, -S, -T], [-S, S, -T]], [-1, 0, 0], 1);
    quad([[S, S, 0], [-S, S, 0], [-S, S, -T], [S, S, -T]], [0, 1, 0], 1);
    quad([[-S, -S, 0], [S, -S, 0], [S, -S, -T], [-S, -S, -T]], [0, -1, 0], 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    geo.setIndex(idx);
    const count = GW * GH;
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.aFx = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    geo.setAttribute('aCell', this.aCell);
    geo.setAttribute('aSeed', this.aSeed);
    geo.setAttribute('aFx', this.aFx);
    const mat = new THREE.ShaderMaterial({ vertexShader: tileVert, fragmentShader: tileFrag, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    const grout = new THREE.Mesh(
      new THREE.PlaneGeometry(GW + 40, GH + 40),
      new THREE.ShaderMaterial({ vertexShader: groutVert, fragmentShader: groutFrag, uniforms: this.uniforms }),
    );
    grout.position.z = -0.03;
    this.scene.add(grout);

    const sgeo = new THREE.PlaneGeometry(1.6, 1.6);
    this.aSh = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHADOWS * 2), 2);
    sgeo.setAttribute('aSh', this.aSh);
    this.shadows = new THREE.InstancedMesh(
      sgeo,
      new THREE.ShaderMaterial({ vertexShader: shadowVert, fragmentShader: shadowFrag, transparent: true, depthWrite: false }),
      MAX_SHADOWS,
    );
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 2;
    this.scene.add(this.shadows);

    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const inst = j * GW + i;
        const seed = ((i * 73 + j * 151 + i * j * 7) % 997) + 1;
        const h = (n: number) => {
          const v = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
          return v - Math.floor(v);
        };
        const p: Piece = {
          inst,
          gx: GX0 + i,
          gy: GY0 + j,
          role: 0,
          cell: 0,
          x: GX0 + i,
          y: GY0 + j,
          z: 0,
          hover: 0,
          ang: 0,
          flip: 0,
          tiltX: 0,
          tiltY: 0,
          scale: 0.957 + h(1) * 0.016,
          seed,
          wet: 0,
          wet2: 0,
          motif: 1,
          hidden: false,
          jx: (h(2) - 0.5) * 0.012,
          jy: (h(3) - 0.5) * 0.012,
          ja: (h(4) - 0.5) * 0.022,
        };
        this.pieces.push(p);
      }
    this.resize();
  }

  pieceAt(gx: number, gy: number): Piece | null {
    const i = gx - GX0;
    const j = gy - GY0;
    if (i < 0 || j < 0 || i >= GW || j >= GH) return null;
    return this.pieces[j * GW + i];
  }

  /** Upload one painted cell (CELL x CELL RGBA) into the atlas. */
  uploadCell(cell: number, data: Uint8Array<ArrayBuffer>): void {
    const src = new THREE.DataTexture(data, CELL, CELL, THREE.RGBAFormat, THREE.UnsignedByteType);
    const cx = cell % ATLAS_COLS;
    const cy = Math.floor(cell / ATLAS_COLS);
    this.renderer.copyTextureToTexture(src, this.atlas, null, new THREE.Vector2(cx * CELL, cy * CELL));
    src.dispose();
  }

  /** Write a piece's transform and paint state to the GPU. */
  sync(p: Piece): void {
    const m = this.m4;
    if (p.hidden) m.makeScale(0, 0, 0);
    else {
      m.makeRotationZ(-(p.ang + p.ja));
      if (p.flip) m.multiply(this.m4b.makeRotationY(p.flip));
      if (p.tiltX) m.multiply(this.m4b.makeRotationX(p.tiltX));
      if (p.tiltY) m.multiply(this.m4b.makeRotationY(p.tiltY));
      m.scale(new THREE.Vector3(p.scale, p.scale, 1));
      m.setPosition(p.x + p.jx, p.y + p.jy, p.z + p.hover);
    }
    this.mesh.setMatrixAt(p.inst, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aCell.setXY(p.inst, p.cell % ATLAS_COLS, Math.floor(p.cell / ATLAS_COLS));
    this.aSeed.setX(p.inst, p.seed);
    this.aFx.setXYZW(p.inst, p.wet, p.motif, p.wet2, p.role > 0 ? 1 : 0);
    this.aCell.needsUpdate = this.aSeed.needsUpdate = this.aFx.needsUpdate = true;
  }

  syncAll(): void {
    for (const p of this.pieces) this.sync(p);
  }

  /** Soft shadows under every tile that is off the wall. */
  castShadows(lifted: Piece[]): void {
    const w = this.uniforms.uWin.value as THREE.Vector3;
    let n = 0;
    for (const p of lifted) {
      if (n >= MAX_SHADOWS) break;
      const z = p.z + p.hover;
      if (p.hidden || z < 0.004 || z > 2.2) continue;
      const dx = p.x - w.x;
      const dy = p.y - w.y;
      const k = z / Math.max(1, w.z - z);
      const m = this.m4.makeRotationZ(-(p.ang + p.ja));
      m.setPosition(p.x + dx * k * 1.3, p.y + dy * k * 1.3, 0.004);
      this.shadows.setMatrixAt(n, m);
      this.aSh.setXY(n, 0.02 + z * 0.42, Math.min(0.42, 0.18 + z * 2.2) * Math.max(0, 1 - z / 2.2));
      n++;
    }
    this.shadows.count = n;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.aSh.needsUpdate = true;
  }

  /** Aim the camera at a panel of w x h tiles (plus its border) centred on (cx, cy). */
  frame(cx: number, cy: number, w: number, h: number, snap = false): void {
    const aspect = this.camera.aspect;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const needH = h + 2 + 1.15;
    const needW = w + 2 + 1.3;
    this.goalDist = Math.max(needH / 2 / tan, needW / 2 / (tan * aspect));
    this.goalTarget.set(cx, cy + 0.2);
    if (snap) {
      this.dist = this.goalDist;
      this.target.copy(this.goalTarget);
    }
  }

  setScale(s: number): void {
    this.scale = s;
    this.renderer.setPixelRatio(this.baseRatio * s);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    (this.uniforms.uRes.value as THREE.Vector2).copy(s);
  }

  /** World point on the wall under a pointer position given in NDC. */
  pick(nx: number, ny: number): THREE.Vector2 {
    const v = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const k = -o.z / (v.z - o.z);
    return new THREE.Vector2(o.x + (v.x - o.x) * k, o.y + (v.y - o.y) * k);
  }

  updateCamera(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 3.2);
    this.target.lerp(this.goalTarget, k);
    this.dist += (this.goalDist - this.dist) * k;
    this.smoothPtr.lerp(this.pointer, 1 - Math.exp(-dt * 7));
    const px = this.smoothPtr.x;
    const py = this.smoothPtr.y;
    const cam = this.camera;
    const t = this.target;
    if (this.view === 'close') {
      cam.position.set(t.x - 1.5 + px * 0.5, t.y - 1.2 + py * 0.3, 3.1);
      cam.lookAt(t.x + 0.1, t.y + 0.1, 0);
    } else if (this.view === 'raking') {
      cam.position.set(t.x - this.dist * 0.55 + px, t.y - 0.6 + py * 0.4, this.dist * 0.6);
      cam.lookAt(t.x + 0.4, t.y, 0);
    } else {
      cam.position.set(t.x + px * 0.75 + 0.35, t.y + py * 0.42 - 0.45, this.dist);
      cam.lookAt(t.x, t.y, 0);
    }
    cam.updateMatrixWorld();
    // the window stands to the upper left of the viewer; it follows the pointer
    // and breathes slowly as clouds pass
    const w = this.uniforms.uWin.value as THREE.Vector3;
    const wd = 9 + this.dist * 0.25;
    const refl = this.view === 'wall' ? this.dist / (this.dist + wd) : 0.5;
    const rx = t.x + (-0.62 + px * 0.5) * this.dist * 0.268 * cam.aspect + Math.sin(time * 0.11) * 0.25;
    const ry = t.y + (0.54 + py * 0.45) * this.dist * 0.268 + Math.sin(time * 0.083 + 1) * 0.15;
    w.set(cam.position.x + (rx - cam.position.x) / refl, cam.position.y + (ry - cam.position.y) / refl, wd);
    this.uniforms.uWinGain.value = 25 + 3 * Math.sin(time * 0.17);
    const halfH = this.dist * 0.268;
    (this.uniforms.uSun.value as THREE.Vector4).set(t.x + halfH * cam.aspect * 0.42, t.y - halfH * 0.18, halfH * cam.aspect * 0.27, halfH * 0.62);
    this.uniforms.uTime.value = time;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
