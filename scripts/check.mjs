// Headless check on the real GPU.
//   node scripts/check.mjs shot <name> "<query>" [waitMs] [w] [h]
//   node scripts/check.mjs fps "<query>" [seconds]
//   node scripts/check.mjs play            scripted input run with screenshots
//   node scripts/check.mjs dist            load dist/index.html from file://, list network requests
// Screenshots go to $SHOTS (default ./shots).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = process.env.SHOTS || 'shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5183/';
const [mode = 'shot', ...args] = process.argv.slice(2);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit=false'],
});
const open = async (url, w = 1920, h = 1080) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors };
};
const report = (errors) => console.log(errors.length ? errors.join('\n') : 'no console errors');

if (mode === 'shot') {
  const [name, query = '', wait = '1200', w = '1920', h = '1080'] = args;
  const { page, errors } = await open(BASE + query, Number(w), Number(h));
  await page.waitForTimeout(Number(wait));
  const jpg = name.endsWith('.jpg');
  await page.screenshot({ path: `${OUT}/${jpg ? name : name + '.png'}`, ...(jpg ? { quality: 86 } : {}) });
  report(errors);
} else if (mode === 'fps') {
  const [query = '', secs = '6'] = args;
  const { page, errors } = await open(BASE + query);
  await page.waitForTimeout(2500);
  const samples = [];
  for (let i = 0; i < Number(secs); i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => ({ fps: Math.round(window.__stats.fps), scale: window.__stats.scale })));
  }
  console.log(samples.map((s) => `${s.fps}fps@${s.scale.toFixed(2)}`).join('  '));
  console.log(await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown renderer';
  }));
  report(errors);
} else if (mode === 'play') {
  const { page, errors } = await open(BASE);
  const shot = (n) => page.screenshot({ path: `${OUT}/play-${n}.png` });
  const cell = (c, r, cols, rows) => page.evaluate(([c, r]) => window.__cellToScreen(c, r), [c, r]);
  await page.waitForTimeout(600);
  await shot('0-load');
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  await page.mouse.move(1100, 620, { steps: 10 });
  await page.waitForTimeout(400);
  await shot('1-pointer-moved');
  await page.mouse.click(960, 540); // first input: leave the attract mode
  await page.waitForTimeout(2600);
  await shot('2-level1');
  // level 1: click each tile of the middle row until the water joins
  for (const c of [0, 1, 2]) {
    for (let k = 0; k < 4; k++) {
      const s = await page.evaluate(() => window.__game.state);
      if (s !== 'play') break;
      const need = await page.evaluate((c) => window.__needsTurn(c, 1), c);
      if (!need) break;
      const p = await cell(c, 1);
      await page.mouse.click(p[0], p[1]);
      await page.waitForTimeout(160);
      if (c === 0 && k === 0) await shot('3-turning');
      await page.waitForTimeout(400);
    }
  }
  await page.waitForTimeout(1800);
  await shot('4-sailing');
  await page.waitForTimeout(4200);
  await shot('5-arrived');
  await page.mouse.click(960, 540);
  await page.waitForTimeout(3000);
  await shot('6-level2');
  // drag a tile onto another
  const a = await cell(0, 0);
  const b = await cell(1, 1);
  const a2 = await cell(1, 0);
  await page.mouse.move(a2[0], a2[1]);
  await page.mouse.down();
  await page.mouse.move((a2[0] + b[0]) / 2, (a2[1] + b[1]) / 2 + 30, { steps: 6 });
  await page.waitForTimeout(250);
  await shot('7-dragging');
  await page.mouse.move(b[0], b[1], { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.keyboard.press('h');
  await page.waitForTimeout(450);
  await shot('8-hint');
  await page.waitForTimeout(1200);
  await page.keyboard.press('z');
  await page.waitForTimeout(700);
  await page.keyboard.press('r');
  await page.waitForTimeout(800);
  await shot('9-restart');
  void a;
  report(errors);
} else if (mode === 'dist') {
  const url = pathToFileURL(resolve('dist/index.html')).href;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : 0));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/dist.png` });
  const audio = await page.evaluate(() => (window.__game.sfx.ctx ? 'audio context exists' : 'no audio context before the sound control is clicked'));
  console.log('requests:\n' + requests.map((u) => '  ' + (u.length > 110 ? u.slice(0, 110) + '…' : u)).join('\n'));
  console.log(audio);
  report(errors);
}
await browser.close();
