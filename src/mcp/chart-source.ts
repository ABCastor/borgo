// The code and the look the MCP App view carries, read from the sources: src/agent/chart.ts, share-link.ts and the
// view's own modules (src/mcp/view-draw.ts, view-client.ts) with their types stripped and their imports of one another
// removed, since they run as one script in the host's iframe; the world map's land and monthly highs, packed; the CSS
// built from the site's stylesheets (view-style.ts) and the site's fonts.
// The npm package has no sources to read: scripts/build-npm.ts swaps this module for the same text built ahead.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import type { WorldMap } from "../core/world-map.ts";
import { ROOT } from "../agent/dataset.ts";
import { viewCss, viewFonts } from "./view-style.ts";

/** An import of a sibling module the view also carries: in one script they share a scope, so the line goes. */
const LOCAL_IMPORT = /^import\s[^;]*?from\s+"\.{1,2}\/[^"]+";[ \t]*$/gm;

function strip(file: string): string {
  const code = stripTypeScriptTypes(readFileSync(join(ROOT, file), "utf8")).replace(LOCAL_IMPORT, "");
  if (/^\s*import\s/m.test(code)) throw new Error(`${file}: the view runs without a module loader, so it can import only the files it carries`);
  return code;
}

/** Digits of the packed monthly highs: printable ASCII without the quote, the backslash and the angle bracket. */
export const HIGH_DIGITS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).filter((c) => !`"\\<> `.includes(c)).join("");
/** The lowest whole degree the packing holds; the published grid's highs run from about -37 to 48 °C. */
export const HIGH_FLOOR = -40;

/**
 * The published land grid for the view: runs of tiles of one country along a row (row, first column, length, country
 * index), and each tile's twelve monthly afternoon highs in whole degrees, one character each, in the same order. A
 * month counts as in a range by its rounded high, so whole degrees keep the site's own test (core/world-map.ts).
 */
export function packedMap(map: WorldMap): { x0: number; y0: number; pitch: number; runs: number[]; highs: string } {
  const n = map.tiles.length / 3;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => map.tiles[a * 3 + 1]! - map.tiles[b * 3 + 1]! || map.tiles[a * 3]! - map.tiles[b * 3]!);
  const runs: number[] = [];
  let highs = "";
  for (let p = 0; p < order.length; p++) {
    const i = order[p]!;
    const [c, r, k] = [map.tiles[i * 3]!, map.tiles[i * 3 + 1]!, map.tiles[i * 3 + 2]!];
    const last = runs.length - 4;
    if (last >= 0 && runs[last] === r && runs[last + 3] === k && runs[last + 1]! + runs[last + 2]! === c) runs[last + 2]!++;
    else runs.push(r, c, 1, k);
    for (let m = 0; m < 12; m++) {
      const d = Math.floor(map.highs[i * 12 + m]! / 10 + 0.5) - HIGH_FLOOR;
      if (d < 0 || d >= HIGH_DIGITS.length) throw new Error(`tile ${i}: a monthly high of ${map.highs[i * 12 + m]! / 10} °C does not fit the packing`);
      highs += HIGH_DIGITS[d];
    }
  }
  return { x0: map.x0, y0: map.y0, pitch: map.pitch, runs, highs };
}

/** Data as a script literal that cannot close the script it sits in. */
export const literal = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** The chart, the share link and the world map, which the view's program uses as globals. */
export function chartSource(): string {
  const map = JSON.parse(readFileSync(join(ROOT, "public/data/map.json"), "utf8")) as WorldMap;
  const packed = { ...packedMap(map), digits: HIGH_DIGITS, floor: HIGH_FLOOR, source: `Land: ${map.sources.find((s) => s.id === "natural-earth")?.period ?? "Natural Earth"}, public domain; monthly highs: NASA POWER (MERRA-2), ${map.sources.find((s) => s.id === "nasa-power")?.period ?? ""}` };
  return strip("src/agent/chart.ts") + "\n" + strip("src/agent/share-link.ts") + `\nconst BORGO_MAP = ${literal(packed)};`;
}

/** The view's own program: what it draws (view-draw.ts), then how it talks to the host (view-client.ts). */
export function clientSource(): string {
  return strip("src/mcp/view-draw.ts") + "\n" + strip("src/mcp/view-client.ts");
}

/** The view's stylesheet and its fonts (base64 woff2 by face), built from the site's (view-style.ts). */
export function styleSource(): { css: string; fonts: Record<string, string> } {
  return { css: viewCss(ROOT), fonts: viewFonts(ROOT) };
}
