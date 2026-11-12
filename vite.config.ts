import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// In the build the favicon becomes a data: URI, so dist/index.html stays one file.
function inlineFavicon(): Plugin {
  return {
    name: 'inline-favicon',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const svg = readFileSync(new URL('./favicon.svg', import.meta.url), 'utf8');
        const uri = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
        return html.replace('href="/favicon.svg"', `href="${uri}"`);
      },
    },
  };
}

// `npm run dev` serves index.html + src/ with hot reload.
// `npm run build` writes one standalone file: dist/index.html (all JS and CSS inlined).
export default defineConfig({
  base: './',
  plugins: [inlineFavicon(), viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 8000,
    cssCodeSplit: false,
  },
  server: { port: 5183, strictPort: true },
});
