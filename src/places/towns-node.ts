// The towns the map knows, for the CLI and the MCP server: an island or a country resolves to one of them
// (src/places/resolve.ts). Read from the built map, else the committed one.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Town } from "./resolve.ts";

const FILES = ["../../public/data/map.json", "../../data/map/world.json"].map((f) => fileURLToPath(new URL(f, import.meta.url)));

let towns: Town[] | null = null;

export async function nodeTowns(): Promise<Town[]> {
  if (towns) return towns;
  const file = FILES.find((f) => existsSync(f));
  towns = file ? ((JSON.parse(readFileSync(file, "utf8")) as { places?: Town[] }).places ?? []) : [];
  return towns;
}
