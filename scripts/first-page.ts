// The first page and the data it needs, written into dist/ after the rest of the site (scripts/build.ts):
// - the published dataset split for the app: data/core.json (everything but the figures, plus each region's first-visit
//   shortlist, computed here with every city's figures) and data/city/<id>.json (one city's figures), so the app reads
//   the cities it shows instead of all of them;
// - the app page once per region of src/core/visit-region.ts, with that region's first screen (the greeting, its five
//   cities and the answer with what an example salary leaves) already in the HTML, and preload hints for exactly the
//   files that screen needs. dist/index.html is Europe's; dist/r/<region>/index.html the others, which the Worker
//   serves as / to requests from that region.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../src/core/engine.ts";
import type { Dataset } from "../src/core/types.ts";
import { REGIONS, regionPage, type RegionId } from "../src/core/visit-region.ts";
import { partFiles, type Published } from "../src/registry/licences.ts";
import { html } from "../src/ui/dom.ts";
import { shortlist } from "../src/ui/first-visit.ts";
import { defaultProfile, firstProfile, type AppState } from "../src/ui/state.ts";
import { topQuestion } from "../src/ui/top.ts";

export const CORE_FILE = "data/core.json";
export const cityFile = (id: string) => `data/city/${id}.json`;

/** Each region's shortlist, from the full data: the same list the app starts a first visit with. */
export function shortlists(data: Dataset): Record<RegionId, string[]> {
  const base = defaultProfile(data);
  return Object.fromEntries(REGIONS.map((r) => [r.id, shortlist(data, r.id, base)])) as Record<RegionId, string[]>;
}

/** The open dataset split into its core (no figures, with the shortlists) and one list of figures per city. */
export function splitDataset(published: Dataset & Published, lists: Record<RegionId, string[]>): { core: Dataset & Published & { shortlists: Record<RegionId, string[]>; perCity: string }; cities: Record<string, Dataset["observations"][string]> } {
  return { core: { ...published, observations: {}, shortlists: lists, perCity: "data/city/" }, cities: published.observations };
}

// Links into the crawlable side, for readers and crawlers before the app has run.
const MORE = html`<p class="intro-more">Browse <a href="sources/">the sources</a>, a city such as <a href="city/lisbon-pt/">Lisbon</a> or <a href="city/berlin-de/">Berlin</a>, a comparison such as <a href="compare/amsterdam-nl-vs-berlin-de/">Amsterdam vs Berlin</a>, or the <a href="llms.txt">guide for AI assistants</a>; the same engine answers from the command line and as an MCP server. The code is open at <a href="https://github.com/ABCastor/borgo">github.com/ABCastor/borgo</a>.</p>`;

/** The app's first screen for a region, as the app itself draws it before anything is typed. */
export function firstScreen(data: Dataset, region: RegionId): string {
  const profile = firstProfile(data, region);
  const s: AppState = { data, profile, view: "cities", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [], intro: true, visit: { region } };
  return html`<div class="first-only"><div id="top" class="top-slot">${topQuestion(s, evaluate(data, profile))}</div>${MORE}</div><p class="intro-wait quiet" role="status">Loading your comparison…</p>`.value;
}

/** Writes the split data and the region pages. `data` is the published dataset with its parts merged, as the pages read it. */
export async function writeFirstPages(dist: string, published: Dataset & Published, data: Dataset): Promise<{ files: string[] }> {
  const lists = shortlists(data);
  const { core, cities } = splitDataset(published, lists);
  const files: string[] = [CORE_FILE];
  await writeFile(join(dist, CORE_FILE), JSON.stringify({ ...core, shortlists: lists }));
  await mkdir(join(dist, "data/city"), { recursive: true });
  for (const [id, list] of Object.entries(cities)) {
    await writeFile(join(dist, cityFile(id)), JSON.stringify({ city: id, observations: list }));
    files.push(cityFile(id));
  }
  const page = await readFile(join(dist, "index.html"), "utf8");
  for (const r of REGIONS) {
    const preload = [CORE_FILE, ...lists[r.id].map(cityFile), ...partFiles(published)].map((f) => `<link rel="preload" href="${f}" as="fetch" crossorigin fetchpriority="high">`).join("\n");
    const out = page
      .replace("<html lang=\"en\">", `<html lang="en" data-region="${r.id}" data-country="">`)
      .replace("<!--PRELOAD-->", preload)
      .replace("<!--FIRST-->", firstScreen({ ...data, shortlists: lists } as Dataset, r.id));
    const dir = join(dist, regionPage(r.id));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), out);
    files.push(`${regionPage(r.id).slice(1)}index.html`);
  }
  return { files };
}
