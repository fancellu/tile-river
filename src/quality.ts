// Two levels of detail. 'high' is the full picture; 'low' is for phones and
// other weak machines: fewer pixels, a cheaper glaze shader, and a lighter
// painted film. The look is the same at a glance; it is the cost that drops.
export type Quality = 'high' | 'low';

export interface QualitySettings {
  maxPixelRatio: number; // cap on device pixels per CSS pixel
  fbmOctaves: number; // layers of noise in the glaze and grout
  filmPx: number; // painted-film pixels per tile
  liteStrokes: boolean; // film strokes without the bleed halo and end pooling
  filmBudgetMs: number; // time per frame spent painting the next film picture
  awakeSeconds: number; // how long woken scenery stays animated (Infinity: for good)
}

export const SETTINGS: Record<Quality, QualitySettings> = {
  high: { maxPixelRatio: 2, fbmOctaves: 4, filmPx: 256, liteStrokes: false, filmBudgetMs: 6, awakeSeconds: Infinity },
  low: { maxPixelRatio: 1.5, fbmOctaves: 2, filmPx: 128, liteStrokes: true, filmBudgetMs: 3, awakeSeconds: 5 },
};

/**
 * ?quality=low or ?quality=high forces a level. Otherwise phones and tablets
 * (a touch screen and no mouse), and machines with few cores or little memory,
 * start on 'low'. A 'high' machine that cannot keep up drops to 'low' at run time.
 */
export function detectQuality(): Quality {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const cores = navigator.hardwareConcurrency || 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return touchOnly || cores <= 4 || memory <= 4 ? 'low' : 'high';
}
