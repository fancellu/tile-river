// Wall design helper. For a hand-drawn layout (a river drawn as a list of
// cells), tries scramble settings and seeds, and prints the starts in which
// every idea the wall shows is needed for its shortest solution.
//
//   node scripts/design-walls.ts <spec.json>
//
// spec.json: [{ "name", "w", "h", "path": "x,y x,y ...", "kinds": {"x,y": "K"|"W"},
//               "faces": {"x,y": hidden face letter}, "swaps": [min,max], "flip": bool,
//               "whirl": n, "minPar": n, "maxPar": n, "seeds": n, "budgetMs": n, "exact": bool }]
import { readFileSync } from 'node:fs';
import type { LevelDef } from '../src/game/levels.ts';
import { analyse, boardOf } from './rivers.ts';
import { trace } from '../src/game/tiles.ts';

interface Spec {
  name: string;
  w: number;
  h: number;
  path: string;
  kinds?: Record<string, string>;
  faces?: Record<string, string>;
  swaps: [number, number];
  flip?: boolean;
  whirl?: number;
  minPar: number;
  maxPar: number;
  seeds?: number;
  budgetMs?: number;
  exact?: boolean; // also require the drawn river itself to be a shortest solution
}

/** River path -> rows of tile codes, as written in levels.ts. */
export function rowsOf(s: Spec): string[] {
  const path = s.path.trim().split(/\s+/).map((c) => c.split(',').map(Number));
  const side = (a: number[], b: number[]) => (b[1] < a[1] ? 0 : b[0] > a[0] ? 1 : b[1] > a[1] ? 2 : 3);
  const g = Array.from({ length: s.h }, () => Array(s.w).fill('G0'));
  const kinds = s.kinds ?? {};
  const seen = new Set<string>();
  path.forEach((c, i) => {
    const k = c.join(',');
    const inS = i > 0 ? side(c, path[i - 1]) : -1;
    const out = i < path.length - 1 ? side(c, path[i + 1]) : -1;
    let t: string;
    if (i === 0) t = 'S' + ((out + 2) % 4);
    else if (i === path.length - 1) t = 'E' + inS;
    else if (seen.has(k)) t = kinds[k] === 'W' ? 'W0' : 'B0';
    else {
      const a = Math.min(inS, out);
      const b = Math.max(inS, out);
      if (b - a === 2) t = (kinds[k] ?? 'I') + (a % 2);
      else {
        if (kinds[k]) throw new Error(`${s.name}: ${kinds[k]} on a bend at ${k}`);
        const r = [0, 1, 2, 3].find((r) => [r, (r + 1) % 4].includes(a) && [r, (r + 1) % 4].includes(b))!;
        t = 'L' + r;
      }
    }
    if (!seen.has(k) && g[c[1]][c[0]] !== 'G0') throw new Error(`${s.name}: river runs into ${k} again`);
    seen.add(k);
    g[c[1]][c[0]] = t;
  });
  for (const [k, hid] of Object.entries(s.faces ?? {})) {
    const [x, y] = k.split(',').map(Number);
    const t = g[y][x];
    g[y][x] = 'D' + t[1] + t[0] + hid;
  }
  return g.map((r) => r.join(' '));
}

const specs = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Spec[];
for (const s of specs) {
  const rows = rowsOf(s);
  console.log(`\n${s.name}\n  rows: ${JSON.stringify(rows)}`);
  const found: string[] = [];
  for (let swaps = s.swaps[0]; swaps <= s.swaps[1]; swaps++)
    for (let seed = 1; seed <= (s.seeds ?? 60); seed++) {
      const def: LevelDef = {
        name: s.name,
        hint: '',
        rows,
        par: 0,
        scramble: { turn: true, swaps, flip: !!s.flip, whirl: s.whirl ?? 0, seed: seed * 7 + 3 },
      };
      if (trace(boardOf(def, 20)).reached) continue;
      const a = analyse(def, 20, s.budgetMs ?? 4000);
      if (process.env.VERBOSE)
        console.log(`    swaps ${swaps} seed ${def.scramble.seed}: par ${a.par} designed ${a.designed} complete ${a.complete} unneeded [${a.unneeded}] undecided [${a.undecided}]`);
      if (!a.complete || !a.replayOk || a.unneeded.length || a.undecided.length) continue;
      if (a.par < s.minPar || a.par > s.maxPar || (s.exact && a.par !== a.designed)) continue;
      found.push(`swaps ${swaps} seed ${def.scramble.seed}: par ${a.par} (designed river ${a.designed})`);
      if (found.length >= 6) break;
    }
  console.log(found.length ? found.map((f) => '  ' + f).join('\n') : '  nothing passes');
}
