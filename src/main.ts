import { Sfx } from './audio.ts';
import { Game } from './game/controller.ts';
import { LEVELS } from './game/levels.ts';
import { Wall } from './render/wall.ts';
import { type Quality, SETTINGS, detectQuality } from './quality.ts';

// URL controls:
//   ?t=<seconds>   run the (deterministic) simulation to that time and freeze it
//   ?level=<1-17>  start on that wall as the player, no attract mode
//   ?view=wall | close | raking   camera
//   ?view=sail     the wall solved, the boat setting out
//   ?view=solved   the boat arrived, the whole wall awake
const q = new URLSearchParams(location.search);
const tParam = q.has('t') ? Math.max(0, Number(q.get('t')) || 0) : null;
const levelParam = q.has('level') ? Math.min(LEVELS.length, Math.max(1, Number(q.get('level')) || 1)) : null;
const view = q.get('view') ?? 'wall';

const canvas = document.getElementById('wall') as HTMLCanvasElement;
let quality: Quality = detectQuality();
const wall = new Wall(canvas, quality);
const sfx = new Sfx();
const game = new Game(wall, sfx, SETTINGS[quality]);
if (view === 'close' || view === 'raking') wall.view = view;

const $ = (id: string) => document.getElementById(id)!;
game.onHud = (s) => {
  $('hint').textContent = s.hint;
  $('lvl').textContent = s.level;
  $('score').textContent = s.score;
};
game.onResult = (r) => {
  if (!r.perfect) return;
  const el = $('perfect');
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
};
$('perfect').addEventListener('animationend', () => ($('perfect').hidden = true));

const state = view === 'sail' || view === 'solved';
if (levelParam !== null || state) game.attract = false;
game.loadLevel(levelParam !== null ? levelParam - 1 : state ? LEVELS.length - 1 : 2);
if (state) {
  game.advance(20, () => game.state === 'play');
  game.solveInstant();
  game.advance(5, () => game.state === 'sail');
  if (view === 'solved') {
    game.advance(120, () => game.state === 'arrived');
    game.advance(3.2);
  }
}
const frozen = tParam !== null;
if (frozen) game.advance(tParam);

// ---- input
const ndc = (e: PointerEvent | MouseEvent) => {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
};
const world = (e: PointerEvent) => {
  const [x, y] = ndc(e);
  // the window's reflection follows a mouse; a finger only plays the game
  if (e.pointerType === 'mouse') wall.pointer.set(x, y);
  return wall.pick(x, y);
};
canvas.addEventListener('pointermove', (e) => {
  const w = world(e);
  if (!frozen) game.pointerMove(w.x, w.y);
});
// on a touch screen, pressing and holding a tile does what a right-click does
const HOLD_MS = 450;
let pressAt = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (frozen) return;
  pressAt = performance.now();
  canvas.setPointerCapture(e.pointerId);
  const w = world(e);
  game.pointerMove(w.x, w.y);
  game.pointerDown(w.x, w.y, e.button);
});
canvas.addEventListener('pointerup', (e) => {
  if (frozen) return;
  const w = world(e);
  const held = e.pointerType !== 'mouse' && performance.now() - pressAt > HOLD_MS;
  game.pointerUp(w.x, w.y, held);
  if (e.pointerType !== 'mouse') game.clearHover();
});
canvas.addEventListener('pointercancel', () => game.clearHover());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// the rules
const rules = $('rules');
const rulesBtn = $('rulesb');
const showRules = (open: boolean) => {
  rules.hidden = !open;
  rulesBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    $('rules-close').focus({ preventScroll: true });
    rules.querySelector('.card')!.scrollTop = 0;
  }
  else rulesBtn.focus();
};
rulesBtn.addEventListener('click', () => showRules(rules.hidden !== false));
$('rules-close').addEventListener('click', () => showRules(false));
rules.addEventListener('click', (e) => {
  if (e.target === rules) showRules(false); // a click outside the card
});

window.addEventListener('keydown', (e) => {
  if (!rules.hidden) {
    if (e.key === 'Escape') showRules(false);
    return; // the wall does not listen while the rules are open
  }
  if (frozen || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') e.preventDefault();
  game.key(e.key);
});
window.addEventListener('resize', () => wall.resize());
// keep the wall clear of the HUD: tell the camera how far down the HUD reaches
const textBox = (el: Element) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r.getBoundingClientRect();
};
const reserveHud = () => {
  const parts = ['#hud h1', '#hint', '#bar'].map((q) => textBox(document.querySelector(q)!));
  const bottom = Math.max(...parts.map((b) => b.bottom)) + 10;
  const right = Math.max(...parts.map((b) => b.right)) + 14;
  wall.setReserve(bottom / window.innerHeight, right / window.innerWidth);
};
new ResizeObserver(reserveHud).observe($('hud'));
window.addEventListener('resize', reserveHud);
reserveHud();

$('undo').addEventListener('click', () => game.undo());
$('hintb').addEventListener('click', () => game.showHint());
$('restart').addEventListener('click', () => game.restart());
$('sound').addEventListener('click', () => {
  if (sfx.on) {
    sfx.disable();
    $('sound').textContent = 'Enable sound';
  } else {
    sfx.enable();
    $('sound').textContent = 'Sound on';
  }
});

// ---- loop, with the internal resolution lowered when frames run long
let last = performance.now();
let slow = 0;
let quick = 0;
let wallTime = 0;
const stats = { fps: 0, frames: 0, t0: performance.now(), scale: 1, quality: quality as string };
(window as unknown as { __stats: typeof stats }).__stats = stats;

function tick(now: number): void {
  const ms = now - last;
  last = now;
  const dt = Math.min(0.05, ms / 1000);
  if (!frozen) {
    game.step(dt);
    wallTime = game.time;
  }
  wall.updateCamera(dt, wallTime);
  game.present();
  wall.render();

  if (ms > 21) {
    slow++;
    quick = 0;
  } else if (ms < 13) {
    quick++;
    slow = Math.max(0, slow - 1);
  }
  if (slow > 24 && wall.scale > 0.5) {
    wall.setScale(Math.max(0.5, wall.scale * 0.85));
    slow = 0;
  } else if (slow > 24 && quality === 'high') {
    // still too slow at half resolution: drop to the low level of detail
    quality = 'low';
    wall.setQuality(quality);
    game.setQuality(SETTINGS[quality]);
    stats.quality = quality;
  } else if (quick > 600 && wall.scale < 1) {
    wall.setScale(Math.min(1, wall.scale * 1.1));
    quick = 0;
  }
  stats.frames++;
  if (now - stats.t0 > 1000) {
    stats.fps = (stats.frames * 1000) / (now - stats.t0);
    stats.frames = 0;
    stats.t0 = now;
    stats.scale = wall.scale;
  }
  requestAnimationFrame(tick);
}
if (frozen) wallTime = game.time;
requestAnimationFrame(tick);

// hooks for the headless check (scripts/check.mjs)
import { kindOf, rotEquivalent } from './game/tiles.ts';
import * as THREE from 'three';
Object.assign(window, {
  __game: game,
  __cellToScreen: (c: number, r: number) => {
    const v = new THREE.Vector3(game.X0 + c, game.Y0 - r, 0).project(wall.camera);
    return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
  },
  __needsTurn: (c: number, r: number) => {
    const t = game.board.cells[r * game.board.w + c];
    const want = game.board.tiles.find((o) => o.sol.x === c && o.sol.y === r)!;
    return !rotEquivalent(kindOf(t), t.rot, want.sol.rot);
  },
});
