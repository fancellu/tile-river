// Rasterises favicon.svg into public/favicon.ico (16, 32, 48) and
// public/apple-touch-icon.png (180), using the installed Chrome.
// Run after editing favicon.svg: node scripts/make-icons.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('favicon.svg', 'utf8');
mkdirSync('public', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const png = async (size, bg = 'transparent') => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: bg === 'transparent' });
};

// ICO with embedded PNG images (supported by every current browser)
const images = await Promise.all([16, 32, 48].map((s) => png(s)));
const head = Buffer.alloc(6 + 16 * images.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(images.length, 4);
let offset = head.length;
images.forEach((img, i) => {
  const s = [16, 32, 48][i];
  const e = 6 + i * 16;
  head.writeUInt8(s, e);
  head.writeUInt8(s, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(img.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
writeFileSync('public/favicon.ico', Buffer.concat([head, ...images]));
// iOS draws its own rounded mask, so give the touch icon the wall's grey ground
writeFileSync('public/apple-touch-icon.png', await png(180, '#d4d6d7'));
await browser.close();
console.log('wrote public/favicon.ico and public/apple-touch-icon.png');
