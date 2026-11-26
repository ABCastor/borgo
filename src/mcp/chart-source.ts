// The code the MCP App view runs: src/agent/chart.ts, share-link.ts and view-client.ts with their types stripped, read
// from the sources.
// The npm package has no sources to read: scripts/build-npm.ts swaps this module for the same code compiled ahead.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import type { WorldMap } from "../core/world-map.ts";
import { ROOT } from "../agent/dataset.ts";

/** The chart and the share link, which the view's program uses as globals, and the land they are drawn over. */
export function chartSource(): string {
  const map = JSON.parse(readFileSync(join(ROOT, "public/data/map.json"), "utf8")) as WorldMap;
  // One compact path of the published land grid, in the same Equal Earth coordinates as city dots.
  const f = (n: number) => Number(n.toFixed(2));
  const d: string[] = [];
  for (let i = 0; i < map.tiles.length; i += 3) {
    const x = 360 + (map.x0 + map.tiles[i]! * map.pitch) * 125;
    const y = 180 - (map.y0 - map.tiles[i + 1]! * map.pitch) * 125;
    const p = f(map.pitch * 125);
    d.push(`M${f(x)},${f(y)}h${p}v${p}h${-p}z`);
  }
  const strip = (file: string) => stripTypeScriptTypes(readFileSync(join(ROOT, file), "utf8"));
  return strip("src/agent/chart.ts") + "\n" + strip("src/agent/share-link.ts") + `\nconst borgoLand = ${JSON.stringify(d.join(""))};`;
}

/** The view's own program (src/mcp/view-client.ts). */
export function clientSource(): string {
  return stripTypeScriptTypes(readFileSync(join(ROOT, "src/mcp/view-client.ts"), "utf8"));
}
