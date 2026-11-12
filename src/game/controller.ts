import type { Sfx } from '../audio.ts';
import { hash01, hashInt } from '../core/rng.ts';
import { HW, POND, channel, motifSpots, rotPt } from '../paint/geom.ts';
import { Live } from '../paint/liveLayer.ts';
import { drawBoat, drawCreature, drawMotif } from '../paint/motifs.ts';
import { type FaceSpec, TilePainter } from '../paint/tilePainter.ts';
import type { QualitySettings } from '../quality.ts';
import type { Piece, Wall } from '../render/wall.ts';
import { LEVELS, type LevelDef, makeBoard } from './levels.ts';
import { type Move, nextMove } from './solver.ts';
import {
  type Board,
  type Step,
  type Tile,
  type Trace,
  at,
  canDrag,
  kindOf,
  opFlip,
  opSwap,
  opTurn,
  opWhirl,
  ringOf,
  trace,
} from './tiles.ts';

const HALF = Math.PI / 2;
const FIX_SURROUND = 0; // atlas cells 0..5
const FIX_BORDER = 6; // 6..9
const FIX_CORNER = 10; // 10..11
const FIRST_GAME_CELL = 12;
const ease = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

interface Tween {
  p: Piece;
  t: number;
  dur: number;
  delay: number;
  begun: boolean;
  begin?: () => void;
  step: (k: number, p: Piece) => void;
  done?: () => void;
}

type Undo = { type: 'turn'; id: number; dir: number } | { type: 'swap'; a: number; b: number } | { type: 'flip'; id: number } | { type: 'whirl'; id: number; dir: number };

export interface HudState {
  level: string;
  score: string;
  hint: string;
}

export class Game {
  wall: Wall;
  sfx: Sfx;
  painter = new TilePainter();
  live: Live;
  /** The next film picture, painted a few milliseconds per frame, then shown whole. */
  private film: Generator<void, void, void> | null = null;
  private filmBudgetMs = 6;
  private awakeSeconds = Infinity;
  onHud: (s: HudState) => void = () => {};
  /** Called once when the player finishes a wall. */
  onResult: (r: { moves: number; par: number; perfect: boolean }) => void = () => {};
  moves = 0;
  private scoring = true; // false when a wall was solved by the ?view= shortcuts
  private result: { moves: number; par: number; perfect: boolean } | null = null;

  levelIndex = -1;
  pending = -1;
  def!: LevelDef;
  board!: Board;
  tr!: Trace;
  X0 = 0;
  Y0 = 0;
  private oldRect: [number, number, number, number] | null = null;
  state: 'idle' | 'out' | 'in' | 'play' | 'sail' | 'arrived' = 'idle';
  stateT = 0;
  time = 0;
  frame = -1;
  attract = true;
  private attractT = 0;
  fast = false; // fast-forwarding: no sound, no drawing

  private tp = new Map<number, Piece>();
  private cells = new Map<number, number[]>();
  private paintedRot = new Map<number, number[]>();
  private data = new Map<number, Uint8Array<ArrayBuffer>>();
  private painted = new Set<number>();
  private jobs: Tile[] = [];
  private start: { x: number; y: number; rot: number; face: number }[] = [];
  private tweens: Tween[] = [];
  private undoStack: Undo[] = [];
  private flow = new Map<number, number[]>(); // tile id -> fill of its two channels
  private awake = new Map<number, number>();
  private gates = new Map<number, number>();
  private boat = { i: 0, u: 0, x: 0, y: 0, facing: 1, moving: false };
  private wakeQueue: Tile[] = [];
  private hoverTile: Tile | null = null;
  private press: { tile: Tile; wx: number; wy: number; ox: number; oy: number; button: number } | null = null;
  private drag: Tile | null = null;
  private ptr = { x: 0, y: 0 };
  private liveDirty = true;
  private lockNote = false;

  constructor(wall: Wall, sfx: Sfx, quality: QualitySettings) {
    this.wall = wall;
    this.sfx = sfx;
    this.live = new Live(quality);
    this.filmBudgetMs = quality.filmBudgetMs;
    this.awakeSeconds = quality.awakeSeconds;
    // the lasting tiles of the wall
    for (let v = 0; v < 6; v++) wall.uploadCell(FIX_SURROUND + v, this.painter.fixture('surround', v));
    for (let v = 0; v < 4; v++) wall.uploadCell(FIX_BORDER + v, this.painter.fixture('border', v));
    for (let v = 0; v < 2; v++) wall.uploadCell(FIX_CORNER + v, this.painter.fixture('corner', v));
    for (const p of wall.pieces) {
      p.cell = FIX_SURROUND + (hashInt(p.gx * 31 + 5, p.gy * 17 + 3) % 6);
    }
    wall.syncAll();
  }

  // ------------------------------------------------------------ levels

  loadLevel(i: number): void {
    this.pending = i;
    if (this.state === 'out') return;
    if (this.levelIndex < 0) {
      this.applyLevel();
      return;
    }
    this.state = 'out';
    this.stateT = 0;
    this.endDrag();
    this.tweens = [];
    const [x0, y0, x1, y1] = this.oldRect!;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        const home = this.wall.pieceAt(gx, gy);
        if (!home) continue;
        const p = home;
        const h = hash01(p.inst, 3);
        const y = p.y;
        const a = p.ang;
        p.hover = 0;
        p.motif = 1; // woken scenery is painted back onto the tile so it leaves with it
        this.tween(p, 0.42, h * 0.28, (k) => {
          p.z = 3.2 * k * k;
          p.y = y - 1.4 * k * k;
          p.ang = a + k * (h - 0.5) * 1.2;
          p.tiltX = k * (h - 0.3) * 1.5;
        }, () => {
          p.hidden = true;
        });
      }
    if (!this.fast) this.sfx.lift();
  }

  private spec(t: Tile, face: number): FaceSpec {
    return {
      kind: t.faces[face],
      seed: t.seed + face * 5003,
      variant: t.variant,
      rot: t.rot,
      mark: t.faces.length === 2 ? (face === 0 ? 'sun' : 'moon') : null,
      fixed: t.fixed,
    };
  }

  private paintTile(t: Tile): void {
    if (this.painted.has(t.id)) return;
    this.painted.add(t.id);
    const cells = this.cells.get(t.id)!;
    const rots: number[] = [];
    for (let f = 0; f < t.faces.length; f++) {
      const d = this.painter.face(this.spec(t, f));
      this.data.set(cells[f], d);
      this.wall.uploadCell(cells[f], d);
      rots.push(t.rot);
    }
    this.paintedRot.set(t.id, rots);
  }

  /** Scenery stands upright on the wall: repaint it if the tile has turned. */
  private uprightScenery(t: Tile): void {
    const rots = this.paintedRot.get(t.id);
    if (!rots || rots[t.face] === t.rot) return;
    const cell = this.cells.get(t.id)![t.face];
    const d = this.data.get(cell)!;
    this.painter.scenery(this.spec(t, t.face), d);
    this.wall.uploadCell(cell, d);
    rots[t.face] = t.rot;
  }

  private applyLevel(): void {
    const first = this.levelIndex < 0;
    const i = this.pending;
    this.levelIndex = i;
    this.def = LEVELS[i];
    const b = (this.board = makeBoard(i));
    this.start = b.tiles.map((t) => ({ x: t.x, y: t.y, rot: t.rot, face: t.face }));
    this.X0 = -Math.floor((b.w - 1) / 2);
    this.Y0 = Math.floor((b.h - 1) / 2);
    const rect: [number, number, number, number] = [this.X0 - 1, this.Y0 - b.h, this.X0 + b.w, this.Y0 + 1];
    const old = this.oldRect ?? rect;
    const union: [number, number, number, number] = [Math.min(old[0], rect[0]), Math.min(old[1], rect[1]), Math.max(old[2], rect[2]), Math.max(old[3], rect[3])];
    this.oldRect = rect;

    this.tp.clear();
    this.cells.clear();
    this.paintedRot.clear();
    this.data.clear();
    this.painted.clear();
    this.flow.clear();
    this.awake.clear();
    this.gates.clear();
    this.wakeQueue = [];
    this.undoStack = [];
    this.moves = 0;
    this.result = null;
    this.scoring = true;
    this.tweens = [];
    this.hoverTile = null;
    this.lockNote = false;

    let nextCell = FIRST_GAME_CELL;
    const arriving: Piece[] = [];
    for (let gy = union[1]; gy <= union[3]; gy++)
      for (let gx = union[0]; gx <= union[2]; gx++) {
        const p = this.wall.pieceAt(gx, gy);
        if (!p) continue;
        const c = gx - this.X0;
        const r = this.Y0 - gy;
        p.x = gx;
        p.y = gy;
        p.z = p.hover = p.flip = p.tiltX = p.tiltY = 0;
        p.wet = p.wet2 = 0;
        p.motif = 1;
        const inX = c >= 0 && c < b.w;
        const inY = r >= 0 && r < b.h;
        if (inX && inY) {
          const t = at(b, c, r)!;
          p.role = 2;
          const cs = [nextCell++];
          if (t.faces.length === 2) cs.push(nextCell++);
          this.cells.set(t.id, cs);
          p.cell = cs[t.face];
          p.ang = t.rot * HALF;
          this.tp.set(t.id, p);
        } else if (c >= -1 && c <= b.w && r >= -1 && r <= b.h) {
          p.role = 1;
          const corner = !inX && !inY;
          if (corner) {
            p.cell = FIX_CORNER + (hashInt(gx, gy) % 2);
            p.ang = (r < 0 ? (c < 0 ? 0 : 1) : c < 0 ? 3 : 2) * HALF;
          } else {
            p.cell = FIX_BORDER + (hashInt(gx * 7, gy * 13) % 4);
            p.ang = (r < 0 ? 0 : c >= b.w ? 1 : r >= b.h ? 2 : 3) * HALF;
          }
        } else {
          p.role = 0;
          p.cell = FIX_SURROUND + (hashInt(p.gx * 31 + 5, p.gy * 17 + 3) % 6);
          p.ang = 0;
        }
        p.hidden = true;
        arriving.push(p);
        this.wall.sync(p);
      }

    // the tiler sets the wall from the top left corner
    const key = (p: Piece) => p.gx - union[0] + (union[3] - p.gy) + hash01(p.inst, 9) * 1.5;
    arriving.sort((a, c) => key(a) - key(c));
    const span = Math.min(1.15, arriving.length * 0.03);
    const byPiece = new Map<Piece, Tile>();
    for (const t of b.tiles) byPiece.set(this.tp.get(t.id)!, t);
    this.jobs = arriving.filter((p) => byPiece.has(p)).map((p) => byPiece.get(p)!);
    arriving.forEach((p, n) => {
      const x = p.x;
      const y = p.y;
      const a = p.ang;
      const h = hash01(p.inst, 4) - 0.5;
      const tile = byPiece.get(p);
      const tw = this.tween(p, 0.36, (n / arriving.length) * span, (k) => {
        const e = 1 - Math.pow(1 - k, 3);
        p.z = 2.6 * (1 - e);
        p.y = y - 0.55 * (1 - e);
        p.x = x + h * 0.5 * (1 - e);
        p.ang = a + h * 0.7 * (1 - e);
        p.tiltX = (1 - e) * 0.5;
      }, () => {
        p.z = 0;
        p.tiltX = 0;
        if (!this.fast) this.sfx.clink(0.5);
      });
      tw.begin = () => {
        if (tile) this.paintTile(tile);
        p.hidden = false;
      };
    });

    this.film = null; // a picture half painted for the old wall is dropped
    this.live.resize(b.w + 2, b.h + 2);
    this.wall.uniforms.uLive.value = this.live.tex;
    this.wall.uniforms.uLiveRect.value.set(this.X0 - 1.5, this.Y0 + 1.5, 1 / (b.w + 2), 1 / (b.h + 2));
    this.wall.frame(this.X0 + (b.w - 1) / 2, this.Y0 - (b.h - 1) / 2, b.w, b.h, first);
    this.tr = trace(b);
    this.state = 'in';
    this.stateT = 0;
    this.liveDirty = true;
    this.hud();
  }

  private hud(): void {
    let hint = this.def.hint;
    if (this.attract) hint = 'Click anywhere to play. For now the wall is solving itself.';
    else if (this.state === 'sail') hint = 'The water joins. The boat sails for the sea.';
    else if (this.state === 'arrived') hint = 'The boat has reached the sea. Click for the next wall.';
    else if (this.lockNote) hint = 'The water reaches the sea, but the boat must pass every lock.';
    const r = this.result;
    if (r && (this.state === 'sail' || this.state === 'arrived'))
      hint = r.perfect
        ? `Perfect: ${r.moves} ${r.moves === 1 ? 'move' : 'moves'}, as few as the wall allows.`
        : `Solved in ${r.moves} moves. This wall can be done in ${r.par}.`;
    const best = this.best(this.levelIndex);
    const score = this.attract ? '' : `Moves ${this.moves} · Par ${this.def.par}${best !== null ? ` · Best ${best}` : ''}`;
    this.onHud({ level: `Wall ${this.levelIndex + 1} of ${LEVELS.length} · ${this.def.name}`, score, hint });
  }

  // ------------------------------------------------------------ best scores (this browser only)

  private bests(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem('tile-river-best') ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  private best(i: number): number | null {
    return this.bests()[LEVELS[i].name] ?? null;
  }

  private saveBest(i: number, moves: number): void {
    const all = this.bests();
    const k = LEVELS[i].name;
    if (all[k] !== undefined && all[k] <= moves) return;
    all[k] = moves;
    try {
      localStorage.setItem('tile-river-best', JSON.stringify(all));
    } catch {
      /* storage blocked: the score simply is not remembered */
    }
  }

  // ------------------------------------------------------------ tweens

  private tween(p: Piece, dur: number, delay: number, step: (k: number, p: Piece) => void, done?: () => void): Tween {
    const tw: Tween = { p, t: 0, dur, delay, begun: false, step, done };
    this.tweens.push(tw);
    return tw;
  }

  private runTweens(dt: number): void {
    if (!this.tweens.length) return;
    const list = this.tweens;
    const keep: Tween[] = [];
    for (const tw of list) {
      tw.t += dt;
      if (tw.t < tw.delay) {
        keep.push(tw);
        continue;
      }
      if (!tw.begun) {
        tw.begun = true;
        tw.begin?.();
      }
      const k = clamp01((tw.t - tw.delay) / tw.dur);
      tw.step(k, tw.p);
      this.wall.sync(tw.p);
      if (k >= 1) {
        tw.done?.();
        this.wall.sync(tw.p);
      } else keep.push(tw);
    }
    // tweens started from a done() callback were pushed onto this.tweens
    this.tweens = this.tweens === list ? keep : keep.concat(this.tweens.filter((t) => !list.includes(t)));
  }

  private rest(t: Tile): { x: number; y: number; ang: number } {
    return { x: this.X0 + t.x, y: this.Y0 - t.y, ang: t.rot * HALF };
  }

  private land(t: Tile, quiet = false): void {
    const p = this.tp.get(t.id)!;
    const r = this.rest(t);
    t.busy = false;
    p.x = r.x;
    p.y = r.y;
    p.z = 0;
    p.ang = r.ang;
    p.flip = p.tiltX = p.tiltY = 0;
    p.cell = this.cells.get(t.id)![t.face];
    this.uprightScenery(t);
    this.wall.sync(p);
    if (!quiet && !this.fast) this.sfx.clink();
    this.flowChanged();
  }

  // ------------------------------------------------------------ moves

  private wobble(t: Tile): void {
    const p = this.tp.get(t.id)!;
    const a = t.rot * HALF;
    this.tween(p, 0.32, 0, (k) => {
      p.ang = a + Math.sin(k * Math.PI * 4) * 0.07 * (1 - k);
      p.z = 0.02 * Math.sin(Math.PI * k);
    });
    if (!this.fast) this.sfx.thud();
  }

  private turn(t: Tile, dir: number): boolean {
    if (t.fixed || t.busy) {
      if (!t.busy) this.wobble(t);
      return false;
    }
    const p = this.tp.get(t.id)!;
    const a = t.rot * HALF;
    opTurn(t, dir);
    t.busy = true;
    this.tween(p, 0.27, 0, (k) => {
      p.ang = a + dir * HALF * ease(k);
      p.z = 0.17 * Math.sin(Math.PI * k);
    }, () => this.land(t));
    if (!this.fast) this.sfx.lift();
    this.flowChanged();
    return true;
  }

  private swap(a: Tile, c: Tile): boolean {
    if (a === c || c.busy || !canDrag(this.board, c) || a.fixed) return false;
    const pa = this.tp.get(a.id)!;
    const pc = this.tp.get(c.id)!;
    opSwap(this.board, a, c);
    a.busy = c.busy = true;
    for (const [t, p, arc] of [[a, pa, 0.24], [c, pc, 0.34]] as [Tile, Piece, number][]) {
      const x = p.x;
      const y = p.y;
      const z = p.z;
      const r = this.rest(t);
      this.tween(p, 0.32, 0, (k) => {
        const e = ease(k);
        p.x = x + (r.x - x) * e;
        p.y = y + (r.y - y) * e;
        p.z = z * (1 - e) + arc * Math.sin(Math.PI * k);
        p.tiltX *= 1 - e;
        p.tiltY *= 1 - e;
      }, () => this.land(t));
    }
    if (!this.fast) this.sfx.lift();
    this.flowChanged();
    return true;
  }

  private flipTile(t: Tile): boolean {
    if (t.faces.length < 2 || t.busy) return false;
    const p = this.tp.get(t.id)!;
    opFlip(t);
    t.busy = true;
    let turned = false;
    this.tween(p, 0.46, 0, (k) => {
      const e = ease(k);
      if (e >= 0.5 && !turned) {
        turned = true;
        p.cell = this.cells.get(t.id)![t.face];
        this.uprightScenery(t);
      }
      p.flip = e < 0.5 ? e * Math.PI : (e - 1) * Math.PI;
      p.z = 0.58 * Math.sin(Math.PI * k);
    }, () => this.land(t));
    if (!this.fast) this.sfx.lift();
    this.flowChanged();
    return true;
  }

  private whirl(w: Tile, dir: number): boolean {
    if (w.busy) return false;
    const ring = ringOf(this.board, w);
    if (!ring) {
      this.wobble(w);
      return false;
    }
    const cx = this.X0 + w.x;
    const cy = this.Y0 - w.y;
    const from = ring.map((t) => {
      const p = this.tp.get(t.id)!;
      return { t, p, dx: p.x - cx, dy: p.y - cy, a: t.rot * HALF };
    });
    const wa = w.rot * HALF;
    opWhirl(this.board, w, dir);
    w.busy = true;
    const pw = this.tp.get(w.id)!;
    this.tween(pw, 0.52, 0, (k) => {
      pw.ang = wa + dir * HALF * ease(k);
      pw.z = 0.06 * Math.sin(Math.PI * k);
    }, () => this.land(w, true));
    for (const f of from) {
      f.t.busy = true;
      this.tween(f.p, 0.52, 0, (k) => {
        const th = dir * HALF * ease(k);
        const c = Math.cos(th);
        const s = Math.sin(th);
        f.p.x = cx + f.dx * c + f.dy * s;
        f.p.y = cy - f.dx * s + f.dy * c;
        f.p.ang = f.a + th;
        f.p.z = 0.15 * Math.sin(Math.PI * k);
      }, () => this.land(f.t));
    }
    if (!this.fast) this.sfx.lift();
    this.flowChanged();
    return true;
  }

  private doMove(m: Move, record = true): boolean {
    let ok = false;
    if (m.type === 'turn') {
      ok = this.turn(m.tile, m.dir);
      if (ok && record) this.undoStack.push({ type: 'turn', id: m.tile.id, dir: m.dir });
    } else if (m.type === 'swap') {
      ok = this.swap(m.a, m.b);
      if (ok && record) this.undoStack.push({ type: 'swap', a: m.a.id, b: m.b.id });
    } else if (m.type === 'flip') {
      ok = this.flipTile(m.tile);
      if (ok && record) this.undoStack.push({ type: 'flip', id: m.tile.id });
    } else {
      ok = this.whirl(m.tile, m.dir);
      if (ok && record) this.undoStack.push({ type: 'whirl', id: m.tile.id, dir: m.dir });
    }
    if (ok && record) this.countMove(1);
    return ok;
  }

  private countMove(n: number): void {
    this.moves = Math.max(0, this.moves + n);
    this.hud();
  }

  private anyBusy(): boolean {
    return this.board.tiles.some((t) => t.busy);
  }

  undo(): void {
    if (this.state !== 'play' || this.attract || this.anyBusy()) return;
    const u = this.undoStack.pop();
    if (!u) return;
    const T = (id: number) => this.board.tiles[id];
    let ok: boolean;
    if (u.type === 'turn') ok = this.turn(T(u.id), -u.dir);
    else if (u.type === 'swap') ok = this.swap(T(u.a), T(u.b));
    else if (u.type === 'flip') ok = this.flipTile(T(u.id));
    else ok = this.whirl(T(u.id), -u.dir);
    if (ok) this.countMove(-1); // undo takes the move back
    else this.undoStack.push(u);
  }

  restart(): void {
    if (this.attract || (this.state !== 'play' && this.state !== 'sail' && this.state !== 'arrived')) return;
    const b = this.board;
    this.tweens = [];
    this.endDrag();
    b.tiles.forEach((t, i) => {
      const s = this.start[i];
      t.x = s.x;
      t.y = s.y;
      t.rot = s.rot;
      t.face = s.face;
      b.cells[t.y * b.w + t.x] = t;
    });
    this.undoStack = [];
    this.moves = 0;
    this.result = null;
    this.awake.clear();
    this.gates.clear();
    this.wakeQueue = [];
    this.state = 'play';
    this.restoreBorderWaves();
    for (const t of b.tiles) {
      const p = this.tp.get(t.id)!;
      p.motif = 1;
      const x = p.x;
      const y = p.y;
      const z = p.z;
      let a = p.ang % (Math.PI * 2);
      const r = this.rest(t);
      if (r.ang - a > Math.PI) a += Math.PI * 2;
      if (a - r.ang > Math.PI) a -= Math.PI * 2;
      const moved = Math.abs(x - r.x) + Math.abs(y - r.y) + Math.abs(a - r.ang) > 0.01 || p.cell !== this.cells.get(t.id)![t.face];
      if (!moved) {
        this.land(t, true);
        continue;
      }
      t.busy = true;
      this.tween(p, 0.3, hash01(t.id, 2) * 0.08, (k) => {
        const e = ease(k);
        p.x = x + (r.x - x) * e;
        p.y = y + (r.y - y) * e;
        p.ang = a + (r.ang - a) * e;
        p.z = z * (1 - e) + 0.2 * Math.sin(Math.PI * k);
      }, () => this.land(t));
    }
    this.flowChanged();
    this.hud();
  }

  /** Lift the next wrong tile and show its move. */
  showHint(): void {
    if (this.state !== 'play' || this.attract || this.anyBusy()) return;
    const m = nextMove(this.board);
    if (!m) return;
    const wiggle = (t: Tile, dir: number, tx = 0, ty = 0) => {
      const p = this.tp.get(t.id)!;
      const r = this.rest(t);
      this.tween(p, 1.25, 0, (k) => {
        const s = Math.sin(k * Math.PI);
        const beat = Math.max(0, Math.sin(k * Math.PI * 4 - 0.6));
        p.z = 0.1 * s;
        p.ang = r.ang + dir * 0.42 * beat * s;
        p.x = r.x + tx * 0.16 * beat * s;
        p.y = r.y + ty * 0.16 * beat * s;
        p.flip = m.type === 'flip' ? 0.5 * beat * s : 0;
      }, () => {
        p.z = 0;
        p.ang = r.ang;
        p.x = r.x;
        p.y = r.y;
        p.flip = 0;
      });
    };
    if (m.type === 'turn' || m.type === 'whirl') wiggle(m.tile, m.dir);
    else if (m.type === 'flip') wiggle(m.tile, 0);
    else {
      const dx = Math.sign(m.b.x - m.a.x);
      const dy = -Math.sign(m.b.y - m.a.y);
      wiggle(m.a, 0, dx, dy);
      wiggle(m.b, 0, -dx, -dy);
    }
    if (!this.fast) this.sfx.lift();
  }

  /** Put every tile where the solution has it (for ?view=sail). */
  solveInstant(): void {
    this.scoring = false;
    const b = this.board;
    for (const t of b.tiles) {
      t.x = t.sol.x;
      t.y = t.sol.y;
      t.rot = t.sol.rot;
      t.face = t.sol.face;
      t.busy = false;
      b.cells[t.y * b.w + t.x] = t;
    }
    this.tweens = [];
    for (const t of b.tiles) {
      this.paintTile(t);
      this.tp.get(t.id)!.hidden = false;
      this.land(t, true);
    }
    for (const s of this.tr.steps) this.flow.set(s.tile.id, [1, 1]);
    this.applyFlow();
  }

  // ------------------------------------------------------------ water

  private chan(s: Step): number {
    const k = kindOf(s.tile);
    if (k !== 'bridge' && k !== 'whirl') return 0;
    return ((s.inSide - s.tile.rot + 4) % 4) % 2;
  }

  private flowChanged(): void {
    this.tr = trace(this.board);
    const note = this.tr.reached && !this.tr.solved;
    if (note !== this.lockNote) {
      this.lockNote = note;
      this.hud();
    }
    this.liveDirty = true;
  }

  /** Ten times a second the water creeps one tile further along the route. */
  private flowTick(): void {
    const want = new Map<number, number[]>();
    let open = true;
    let n = 0;
    for (const s of this.tr.steps) {
      const id = s.tile.id;
      const ch = this.chan(s);
      const w = want.get(id) ?? [0, 0];
      want.set(id, w);
      const cur = this.flow.get(id) ?? [0, 0];
      this.flow.set(id, cur);
      if (open) {
        w[ch] = 1;
        const before = cur[ch];
        open = before >= 0.5;
        cur[ch] = Math.min(1, before + 0.5);
        if (before < 1 && cur[ch] >= 1 && n > 0 && !this.fast && this.state === 'play') this.sfx.ping(n);
      }
      n++;
    }
    for (const [id, cur] of this.flow) {
      const w = want.get(id);
      for (let c = 0; c < 2; c++) if (!w || !w[c]) cur[c] = 0;
    }
    this.applyFlow();
    if (!this.fast) this.sfx.setWater(this.tr.steps.length / Math.max(1, this.board.tiles.length));
  }

  private applyFlow(): void {
    for (const t of this.board.tiles) {
      const p = this.tp.get(t.id)!;
      const k = kindOf(t);
      const f = this.flow.get(t.id);
      let a = f ? f[0] : 0;
      const c = f ? f[1] : 0;
      if (k === 'spring' || k === 'sea') a = 1;
      if (p.wet !== a || p.wet2 !== c) {
        p.wet = a;
        p.wet2 = c;
        this.wall.sync(p);
      }
    }
  }

  private flowFull(): boolean {
    for (const s of this.tr.steps) {
      const f = this.flow.get(s.tile.id);
      if (!f || f[this.chan(s)] < 1) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ the sail

  private stepPoint(s: Step, u: number): [number, number] {
    const t = s.tile;
    const k = kindOf(t);
    const la = s.inSide < 0 ? -1 : (s.inSide - t.rot + 4) % 4;
    const lb = s.outSide < 0 ? -1 : (s.outSide - t.rot + 4) % 4;
    const l = channel(k, la, lb, u, t.seed + t.face * 5003);
    const w = rotPt(l[0], l[1], t.rot);
    return [t.x + 1 + w[0], t.y + 1 + w[1]];
  }

  private wake(t: Tile): void {
    if (this.awake.has(t.id)) return;
    this.awake.set(t.id, this.time);
    const p = this.tp.get(t.id)!;
    p.motif = 0;
    this.wall.sync(p);
    if (!this.fast && kindOf(t) !== 'whirl') this.sfx.chime(this.awake.size);
  }

  private wakeAround(t: Tile): void {
    this.wake(t);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = at(this.board, t.x + dx, t.y + dy);
        if (n && !this.awake.has(n.id) && !this.wakeQueue.includes(n)) this.wakeQueue.push(n);
      }
  }

  private startSail(): void {
    this.state = 'sail';
    this.stateT = 0;
    this.boat = { i: 0, u: 0.15, x: 0, y: 0, facing: 1, moving: true };
    const p = this.stepPoint(this.tr.steps[0], 0.15);
    this.boat.x = p[0];
    this.boat.y = p[1];
    this.wakeAround(this.tr.steps[0].tile);
    this.endDrag();
    if (!this.fast) this.sfx.fanfare();
    if (!this.attract && this.scoring) {
      const par = this.def.par;
      this.result = { moves: this.moves, par, perfect: this.moves <= par };
      this.saveBest(this.levelIndex, this.moves);
      if (this.result.perfect && !this.fast) this.sfx.perfect();
      this.onResult(this.result);
    }
    this.hud();
  }

  /** The border waves part for the sea creature; put them all back. */
  private restoreBorderWaves(): void {
    for (const p of this.wall.pieces)
      if (p.role === 1 && p.motif !== 1) {
        p.motif = 1;
        this.wall.sync(p);
      }
  }

  private sail(dt: number): void {
    const steps = this.tr.steps;
    const bt = this.boat;
    const s = steps[bt.i];
    const k = kindOf(s.tile);
    let speed = 1.3;
    if (k === 'whirl') speed = 0.6;
    if (k === 'spring') speed = 2.0;
    if (k === 'lock') {
      const g = this.gates.get(s.tile.id) ?? 0;
      if (bt.u > 0.2 && g < 1) {
        this.gates.set(s.tile.id, Math.min(1, g + dt / 0.9));
        speed = 0.12;
      }
    }
    bt.u += dt * speed;
    bt.moving = true;
    if (bt.u >= 1) {
      if (bt.i >= steps.length - 1) {
        bt.u = 1;
        bt.moving = false;
        this.state = 'arrived';
        this.stateT = 0;
        // the whole wall wakes; on a weak machine the scenery near the boat is enough
        if (this.awakeSeconds === Infinity)
          for (const t of this.board.tiles) if (!this.awake.has(t.id) && !this.wakeQueue.includes(t)) this.wakeQueue.push(t);
        if (!this.fast) this.sfx.creature();
        this.hud();
      } else {
        bt.i++;
        bt.u -= 1;
        this.wakeAround(steps[bt.i].tile);
      }
    }
    const p = this.stepPoint(steps[bt.i], Math.min(1, bt.u));
    const dx = p[0] - bt.x;
    if (Math.abs(dx) > 0.004) bt.facing = dx > 0 ? 1 : -1;
    bt.x = p[0];
    bt.y = p[1];
  }

  // ------------------------------------------------------------ the painted film

  /** Change the level of detail of the painted film at run time. */
  setQuality(q: QualitySettings): void {
    this.filmBudgetMs = q.filmBudgetMs;
    this.awakeSeconds = q.awakeSeconds;
    this.live.setQuality(q);
    this.film = null;
    if (this.board) {
      this.live.resize(this.board.w + 2, this.board.h + 2);
      this.wall.uniforms.uLive.value = this.live.tex;
    }
    this.liveDirty = true;
  }

  /** One film picture; yields between pieces so the work can be spread over frames. */
  private *paintFilm(): Generator<void, void, void> {
    const b = this.live.begin(this.frame);
    const f = this.frame;
    const time = this.time;
    const B = this.board;
    for (const t of B.tiles) {
      if (t.busy) continue;
      const p = this.tp.get(t.id)!;
      if (p.hidden || p.z > 0.01) continue;
      const k = kindOf(t);
      const ox = t.x + 1;
      const oy = t.y + 1;
      if (k === 'spring') {
        // the spring leaps, upright, wherever the tile sits
        const c = rotPt(POND[0], POND[1], t.rot);
        const m = b.sub(ox + c[0], oy + c[1], 0.1);
        for (let i = -1; i <= 1; i++) {
          const hgt = 1.0 + 0.3 * Math.sin(f * 1.7 + i * 2);
          m.line([[i * 0.12, 0.1], [i * 0.3, -hgt], [i * 0.85, -hgt * 0.75], [i * 1.15 + 0.05, 0.1]], 0.8, 0.9, { dep: 0.4 });
        }
        m.line([[0, 0.1], [0.03, -1.45 - 0.2 * Math.sin(f * 2.3)]], 0.9, 0.9);
        for (let i = 0; i < 4; i++) m.dot(Math.sin(f * 3.1 + i * 1.9) * 1.1, -0.4 - ((f * 0.37 + i * 0.25) % 1) * 1.1, 0.7, 0.8);
        const ring = ((f % 6) / 6) * 0.9;
        m.arc(0, 0.35, 0.8 + ring, 0.3 + ring * 0.35, 0.2, 2.9, 0.6, 0.75 * (1 - ring));
        m.done();
      } else if (k === 'sea') {
        const u = b.sub(ox + 0.5, oy + 0.5, 1, t.rot * HALF);
        for (let i = 0; i < 5; i++) {
          const x = ((hash01(t.seed, i) + f * 0.012 * (i % 2 ? 1 : -1) + 4) % 1) - 0.5;
          const y = 0.08 + i * 0.085;
          u.line([[x - 0.05, y], [x - 0.017, y - 0.014], [x + 0.017, y + 0.01], [x + 0.05, y - 0.004]], 0.7, 0.85, { dep: 0.4 });
        }
        u.done();
      } else if (k === 'whirl') {
        const u = b.sub(ox + 0.5, oy + 0.5, 1, 0);
        for (let i = 0; i < 3; i++) {
          const r = 0.09 + i * 0.07;
          const a = f * (0.5 - i * 0.1) + i * 2.1;
          u.arc(0, 0, r, r, a, a + 1.9, 0.9, 0.85, { dep: 0.5 });
        }
        u.done();
      } else if (k === 'lock') {
        const g = this.gates.get(t.id) ?? 0;
        const u = b.sub(ox + 0.5, oy + 0.5, 1, t.rot * HALF);
        const phi = 0.42 + g * 1.05;
        for (const y of [-0.18, 0.18])
          for (const side of [-1, 1]) {
            const hx = side * HW;
            u.line([[hx, y, 1.3], [hx - side * Math.cos(phi) * 0.128, y - Math.sin(phi) * 0.128, 1]], 1.9, 0.95, { wob: 0.1, taper: 0.2 });
            u.dot(hx, y, 1.5, 0.9);
          }
        u.done();
      }
      if (k === 'spring' || k === 'sea' || k === 'whirl' || k === 'lock') yield;
    }
    // wavelets run down every joined channel
    const flowing = this.state === 'play' || this.state === 'sail' || this.state === 'arrived';
    for (const [n, s] of this.tr.steps.entries()) {
      const fl = this.flow.get(s.tile.id);
      if (!flowing || !fl || fl[this.chan(s)] < 1 || s.tile.busy) continue;
      for (let j = 0; j < 2; j++) {
        const tt = (f * 0.055 + j * 0.5 + hash01(n, 3)) % 1;
        const a = this.stepPoint(s, Math.max(0, tt - 0.035));
        const c = this.stepPoint(s, Math.min(1, tt + 0.035));
        const tx = c[0] - a[0];
        const ty = c[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        const nx = -ty / l;
        const ny = tx / l;
        const lat = (hash01(n, 7 + j) - 0.5) * HW * 1.1;
        const mx = (a[0] + c[0]) / 2 + nx * lat;
        const my = (a[1] + c[1]) / 2 + ny * lat;
        b.line([[a[0] + nx * (lat + 0.012), a[1] + ny * (lat + 0.012)], [mx - nx * 0.012, my - ny * 0.012], [c[0] + nx * (lat + 0.01), c[1] + ny * (lat + 0.01)]], 0.8, 0.85, { dep: 0.4 });
      }
      if (n % 4 === 3) yield;
    }
    // scenery that the boat has woken
    for (const [id, t0] of this.awake) {
      const t = B.tiles[id];
      const sp = this.spec(t, t.face);
      for (const m of motifSpots(sp.kind, sp.seed, sp.variant, sp.mark)) {
        const w = rotPt(m.x, m.y, t.rot);
        drawMotif(b, m.type, t.x + 1 + w[0], t.y + 1 + w[1], m.r, m.seed, { t: time - t0, f });
        yield;
      }
    }
    if (this.state === 'sail' || this.state === 'arrived') {
      const bt = this.boat;
      drawBoat(b, bt.x, bt.y + 0.03, 0.2, bt.facing, time, f, bt.moving);
      yield;
    }
    if (this.state === 'arrived') {
      // the creature rolls along the bottom border, right to left, then back
      const span = B.w + 2 + 9;
      const T = span / 0.85; // a steady roll, whatever the width of the wall
      const lap = Math.floor(this.stateT / T);
      const k = (this.stateT % T) / T;
      const dir = lap % 2 === 0 ? -1 : 1;
      const x = dir < 0 ? B.w + 2 + 0.6 - k * span : -0.6 + k * span;
      const up = clamp01(Math.min(k * 9, (1 - k) * 9));
      const S = 0.36;
      drawCreature(b, x, B.h + 1.76, S, dir, time, f, up);
      // the painted waves of the border part where the creature surfaces
      const lo = dir < 0 ? x - 1.1 * S : x - 6.2 * S;
      const hi = dir < 0 ? x + 6.2 * S : x + 1.1 * S;
      for (let c = 0; c < B.w; c++) {
        const p = this.wall.pieceAt(this.X0 + c, this.Y0 - B.h);
        if (!p) continue;
        const m = up > 0.05 && c + 2 > lo && c + 1 < hi ? 0 : 1;
        if (p.motif !== m) {
          p.motif = m;
          this.wall.sync(p);
        }
      }
    }
    this.live.end();
  }

  // ------------------------------------------------------------ input

  private tileAt(wx: number, wy: number): Tile | null {
    return at(this.board, Math.round(wx - this.X0), Math.round(this.Y0 - wy));
  }

  /** Any real input ends the attract mode and hands the first wall to the player. */
  private wakePlayer(): boolean {
    if (!this.attract) return false;
    this.attract = false;
    this.loadLevel(0);
    this.hud();
    return true;
  }

  pointerMove(wx: number, wy: number): void {
    this.ptr.x = wx;
    this.ptr.y = wy;
    if (this.state !== 'play' || this.attract) {
      this.hoverTile = null;
      return;
    }
    const pr = this.press;
    if (pr && !this.drag && pr.button === 0 && Math.hypot(wx - pr.wx, wy - pr.wy) > 0.17) {
      if (canDrag(this.board, pr.tile)) {
        this.drag = pr.tile;
        pr.tile.busy = true;
        this.tweens = this.tweens.filter((tw) => tw.p !== this.tp.get(pr.tile.id));
        if (!this.fast) this.sfx.lift();
        this.flowChanged();
      } else {
        this.wobble(pr.tile);
        this.press = null;
      }
    }
    this.hoverTile = this.drag ? null : this.tileAt(wx, wy);
  }

  /** A finger has left the glass: nothing stays lifted under it. */
  clearHover(): void {
    this.hoverTile = null;
  }

  pointerDown(wx: number, wy: number, button: number): void {
    if (this.wakePlayer()) return;
    if (this.state === 'arrived' && this.stateT > 1.2) {
      this.loadLevel((this.levelIndex + 1) % LEVELS.length);
      return;
    }
    if (this.state !== 'play') return;
    const t = this.tileAt(wx, wy);
    if (!t || t.busy) return;
    const p = this.tp.get(t.id)!;
    this.press = { tile: t, wx, wy, ox: wx - p.x, oy: wy - p.y, button };
  }

  /** `alt`: the press was held long on a touch screen, which stands in for a right-click. */
  pointerUp(wx: number, wy: number, alt = false): void {
    const pr = this.press;
    this.press = null;
    if (!pr || this.state !== 'play') {
      this.endDrag();
      return;
    }
    const t = pr.tile;
    if (this.drag) {
      this.drag = null;
      const u = this.tileAt(wx, wy);
      if (u && u !== t && this.swap(t, u)) {
        this.undoStack.push({ type: 'swap', a: t.id, b: u.id });
        this.countMove(1);
        return;
      }
      this.settle(t);
      return;
    }
    const k = kindOf(t);
    const second = pr.button === 2 || alt;
    const dir = second ? -1 : 1;
    if (k === 'whirl') this.doMove({ type: 'whirl', tile: t, dir });
    else if (second && t.faces.length === 2) this.doMove({ type: 'flip', tile: t });
    else this.doMove({ type: 'turn', tile: t, dir });
  }

  private settle(t: Tile): void {
    const p = this.tp.get(t.id)!;
    const x = p.x;
    const y = p.y;
    const z = p.z;
    const r = this.rest(t);
    this.tween(p, 0.22, 0, (k) => {
      const e = ease(k);
      p.x = x + (r.x - x) * e;
      p.y = y + (r.y - y) * e;
      p.z = z * (1 - e);
      p.tiltX *= 1 - e;
      p.tiltY *= 1 - e;
    }, () => this.land(t));
  }

  private endDrag(): void {
    if (this.drag) {
      const t = this.drag;
      this.drag = null;
      this.settle(t);
    }
    this.press = null;
  }

  key(k: string): void {
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Tab') return;
    if (this.wakePlayer()) return;
    if (k.length === 1 && k >= '0' && k <= '9') {
      const i = k === '0' ? 9 : Number(k) - 1; // 1-9 walls 1-9, 0 wall 10
      if (i < LEVELS.length) this.loadLevel(i);
    } else if (k === 'p' || k === 'P') this.loadLevel((this.pending - 1 + LEVELS.length) % LEVELS.length);
    else if (k === 'z' || k === 'Z' || k === 'Backspace') this.undo();
    else if (k === 'h' || k === 'H') this.showHint();
    else if (k === 'r' || k === 'R') this.restart();
    else if (k === 'n' || k === 'N') this.loadLevel((this.pending + 1) % LEVELS.length); // pending: the wall asked for, even mid-transition
    else if ((k === 'f' || k === 'F' || k === ' ') && this.hoverTile && this.state === 'play' && !this.hoverTile.busy) {
      const t = this.hoverTile;
      if (t.faces.length === 2) this.doMove({ type: 'flip', tile: t });
      else if (kindOf(t) === 'whirl') this.doMove({ type: 'whirl', tile: t, dir: 1 });
      else this.doMove({ type: 'turn', tile: t, dir: 1 });
    }
  }

  // ------------------------------------------------------------ the clock

  step(dt: number): void {
    this.time += dt;
    this.stateT += dt;

    // paint a few tiles ahead of the tiler without stalling a frame
    if (this.jobs.length) {
      const t0 = performance.now();
      while (this.jobs.length && (this.fast || performance.now() - t0 < 5)) this.paintTile(this.jobs.shift()!);
    }

    const hadTweens = this.tweens.length > 0;
    this.runTweens(dt);

    if (this.state === 'out' && !this.tweens.length) this.applyLevel();
    else if (this.state === 'in' && !this.tweens.length && hadTweens) {
      this.state = 'play';
      this.stateT = 0;
      this.attractT = -0.5;
      this.flowChanged();
    } else if (this.state === 'play') {
      if (this.tr.solved && !this.tweens.length && !this.drag && !this.anyBusy() && this.flowFull()) this.startSail();
      else if (this.attract && !this.tweens.length) {
        this.attractT += dt;
        if (this.attractT > 0.62) {
          this.attractT = 0;
          const m = nextMove(this.board);
          if (m) this.doMove(m, false);
        }
      }
    } else if (this.state === 'sail') this.sail(dt);
    else if (this.state === 'arrived') {
      if (this.stateT > (this.attract ? 9.5 : 18)) this.loadLevel((this.levelIndex + 1) % LEVELS.length);
    }

    // the dragged tile follows the hand, leaning into its motion
    if (this.drag && this.press) {
      const p = this.tp.get(this.drag.id)!;
      const k = 1 - Math.exp(-dt * 22);
      const tx = this.ptr.x - this.press.ox;
      const ty = this.ptr.y - this.press.oy;
      const vx = (tx - p.x) * k;
      const vy = (ty - p.y) * k;
      p.x += vx;
      p.y += vy;
      p.z += (0.34 - p.z) * k;
      p.tiltY += (clamp01(Math.abs(vx) * 6) * Math.sign(vx) * 0.5 - p.tiltY) * 0.2;
      p.tiltX += (-clamp01(Math.abs(vy) * 6) * Math.sign(vy) * 0.5 - p.tiltX) * 0.2;
      this.wall.sync(p);
    }

    // the tile under the pointer lifts a little
    if (this.state === 'play' || this.hoverTile === null)
      for (const t of this.board.tiles) {
        const p = this.tp.get(t.id)!;
        const goal = t === this.hoverTile && !t.busy && this.state === 'play' ? 0.03 : 0;
        if (Math.abs(p.hover - goal) > 0.0005) {
          p.hover += (goal - p.hover) * (1 - Math.exp(-dt * 16));
          this.wall.sync(p);
        } else if (p.hover !== goal) {
          p.hover = goal;
          this.wall.sync(p);
        }
      }

    // ten pictures a second
    const frame = Math.floor(this.time * 10);
    if (frame !== this.frame) {
      this.frame = frame;
      if (this.state === 'play' || this.state === 'sail' || this.state === 'arrived') this.flowTick();
      if (this.wakeQueue.length && frame % 2 === 0) this.wake(this.wakeQueue.shift()!);
      // on a weak machine, woken scenery settles back into its painted pose after a while
      if (this.awakeSeconds !== Infinity)
        for (const [id, t0] of this.awake)
          if (this.time - t0 > this.awakeSeconds) {
            this.awake.delete(id);
            const p = this.tp.get(id);
            if (p) {
              p.motif = 1;
              this.wall.sync(p);
            }
          }
      this.liveDirty = true;
    }
  }

  /** Draw the painted film if a new picture is due, and place the shadows. */
  present(): void {
    if (!this.fast) {
      // a new picture is due: start painting it behind the one on show
      if (!this.film && this.liveDirty) {
        this.liveDirty = false;
        this.film = this.paintFilm();
      }
      if (this.film) {
        const t0 = performance.now();
        for (;;) {
          if (this.film.next().done) {
            this.film = null;
            break;
          }
          if (performance.now() - t0 > this.filmBudgetMs) break;
        }
      }
      this.wall.uniforms.uLive.value = this.live.tex;
    }
    this.wall.castShadows(this.wall.pieces);
  }

  /** Run the simulation forward without drawing (for ?t= and ?view=). */
  advance(seconds: number, until?: () => boolean): void {
    this.fast = true;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      this.step(1 / 60);
      if (until?.()) break;
    }
    this.fast = false;
    this.liveDirty = true;
  }
}
