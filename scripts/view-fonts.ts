// The MCP App view's fonts: the site's own faces (public/fonts), cut to the letters a chat answer uses, so the view can
// carry them inline and still make no network request. Regenerate when the site's fonts change:
//   SUBSET_FONT_MODULE=/path/to/node_modules/subset-font/index.js node scripts/view-fonts.ts
// subset-font (harfbuzz) is not a dependency of Borgo: install it anywhere outside the repository and point at it.
// The faces stay under the SIL Open Font License 1.1 (src/mcp/fonts/*-OFL.txt); neither declares a Reserved Font Name.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const mod = process.env.SUBSET_FONT_MODULE;
if (!mod) throw new Error("Set SUBSET_FONT_MODULE to subset-font's index.js");
const subsetFont = createRequire(import.meta.url)(mod) as (buf: Buffer, text: string, o: Record<string, unknown>) => Promise<Buffer>;

/** Latin with its accents (Latin-1, Extended-A, the comma-below letters), punctuation, arrows, currency signs. */
const ranges: [number, number][] = [[0x20, 0x7e], [0xa0, 0x17f], [0x218, 0x21b], [0x2009, 0x200a], [0x2010, 0x2027], [0x202f, 0x202f], [0x2030, 0x203a], [0x20a0, 0x20c0], [0x2190, 0x2193], [0x2212, 0x2212], [0x2248, 0x2248], [0x2264, 0x2265]];
const text = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i))).join("");

const out = join(ROOT, "src/mcp/fonts");
mkdirSync(out, { recursive: true });
const jobs: [string, string, Record<string, unknown>][] = [
  ["barlow-condensed-600.woff2", "bib-600.woff2", {}],
  ["barlow-condensed-700.woff2", "bib-700.woff2", {}],
  // The body face keeps its weight axis (400 to 700, what the view sets) and drops its width axis at the default.
  ["archivo-variable.woff2", "ui.woff2", { variationAxes: { wdth: 100, wght: { min: 400, max: 700 } } }],
];
for (const [from, to, o] of jobs) {
  const buf = await subsetFont(readFileSync(join(ROOT, "public/fonts", from)), text, { targetFormat: "woff2", ...o });
  writeFileSync(join(out, to), buf);
  console.log(to, buf.length);
}
