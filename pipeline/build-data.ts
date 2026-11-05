// Assembles the committed snapshot (the seed cities' figures) into the published data, and refuses anything it cannot
// vouch for: an unknown city, metric or source, a metric its source does not declare, a value of the wrong shape, and
// any figure whose rights are not established.
// Rights (src/registry/licences.ts): a source's figures may be published only when its registry entry has a rights
// block with a known licence, an edition and an attribution. A link-out source can have no rights block, so it cannot
// enter. The licence decides the published file, and the figures must sit in that file's folder:
//   data/observations/      -> public/data/dataset.json       CC BY 4.0 compilation, each figure keeps its source's terms
//   data/observations-odbl/ -> public/data/dataset-odbl.json  ODbL 1.0 (OpenStreetMap)
//   data/observations-who/  -> public/data/dataset-who.json   WHO terms for data compilations
// public/data/licences.json is the manifest: for every source actually exported, its edition, licence, attribution,
// notices, file and what it contributes. The registry is also written to public/data/registry.json for the browser.
// The world map (data/map/world.json, built by pipeline/sources/world-map.ts) is checked the same way and written to
// public/data/map.json.
import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, readJson, writeJson, type ObservationFile } from "./lib.ts";
import { METRICS, valueLength } from "../src/core/metrics.ts";
import type { City, Country, Dataset, FxTable, Metric, Observation, RightsArea } from "../src/core/types.ts";
import { loadRegistry, registrySources } from "../src/registry/load.ts";
import { LICENCES, PARTS, partFor, type LicenceManifest, type ManifestEntry, type PartFile, type PartId, type Published } from "../src/registry/licences.ts";
import type { RegistryEntry } from "../src/registry/schema.ts";
import type { CorrectionsFile } from "../src/community/apply.ts";
import { validateMap, type WorldMap } from "../src/core/world-map.ts";

const cities = await readJson<City[]>("data/cities.json");
const countries = await readJson<Record<string, Country>>("data/countries.json");
const registry = loadRegistry(process.env.BORGO_REGISTRY_DIR || undefined);
const entries = new Map(registry.entries.map((e) => [e.id, e]));
const sources = registrySources(registry.entries);
const declared = new Map(registry.entries.map((e) => [e.id, new Set(e.measures.map((m) => m.metric))]));
const rights = await readJson<RightsArea[]>("data/rights.json");
const fx = await readJson<FxTable>("data/fx.json");

const errors: string[] = [...registry.errors];
const PART_IDS = Object.keys(PARTS) as PartId[];
const byPart = Object.fromEntries(PART_IDS.map((p) => [p, Object.fromEntries(cities.map((c) => [c.id, [] as Observation[]]))])) as Record<PartId, Record<string, Observation[]>>;
const ids = new Set(cities.map((c) => c.id));

for (const c of cities) if (!countries[c.country]) errors.push(`${c.id}: country ${c.country} missing from data/countries.json`);
// Every country a seed city is in needs a rate; elsewhere a missing rate only means no money figures for that city.
for (const code of new Set(cities.map((c) => c.country))) {
  const cur = countries[code]?.currency;
  if (cur && cur !== "EUR" && !fx.rates[cur]) errors.push(`${code}: no exchange rate for ${cur}`);
}
for (const a of rights) if (!sources[a.source]) errors.push(`rights ${a.id}: unknown source ${a.source}`);

/** The part a source's figures belong to, or an error naming why it cannot be published. */
function publishable(id: string, where: string): PartId | null {
  const e = entries.get(id);
  if (!e) {
    errors.push(`${where}: unknown source ${id}`);
    return null;
  }
  const p = partFor(e);
  if ("error" in p) {
    errors.push(`${where}: ${p.error}`);
    return null;
  }
  return p.part;
}

const files: string[] = [];
let corrected = 0;
for (const part of PART_IDS) {
  const dir = PARTS[part].folder;
  if (!existsSync(join(ROOT, dir))) continue;
  for (const name of (await readdir(join(ROOT, dir))).filter((f) => f.endsWith(".json")).sort()) {
    const f = `${dir}/${name}`;
    files.push(f);
    check(f, await readJson<ObservationFile>(f), part);
  }
}

// Figures corrected through reviewed proposals (CONTRIBUTING.md): each replaces the same source's figure for that city
// and metric, or adds it, and keeps the official text it cites. The same checks apply as to any other figure.
const CORRECTIONS = "data/corrections.json";
if (existsSync(join(ROOT, CORRECTIONS))) {
  const { corrections } = await readJson<CorrectionsFile>(CORRECTIONS);
  for (const c of corrections) {
    const where = `${CORRECTIONS} ${c.city} ${c.metric}`;
    const o: Observation = { metric: c.metric, value: c.value, period: c.period, level: c.level, source: c.source, retrieved: c.correction?.on, url: c.url, fetcher: "correction", ...(c.note ? { note: c.note } : {}), correction: { on: c.correction?.on, issue: c.correction?.issue, citation: { publisher: c.correction?.citation?.publisher, title: c.correction?.citation?.title, url: c.correction?.citation?.url } } };
    if (!Number.isInteger(c.correction?.issue) || !/^https:\/\//.test(c.url ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(c.correction?.on ?? "") || !c.correction?.citation?.publisher) {
      errors.push(`${where}: a correction needs its issue number, the https address it cites, the day (YYYY-MM-DD) and the citation's publisher`);
      continue;
    }
    const part = publishable(c.source, where);
    if (!part) continue;
    // Checked like a file of that part, then put in place of the figure it corrects.
    const before = errors.length;
    check(CORRECTIONS, { source: c.source, retrieved: o.retrieved, observations: { [c.city]: [o] } }, part, false);
    if (errors.length > before) continue;
    const list = byPart[part][c.city]!;
    // A newer release from the source wins: the correction has done its work and can be removed.
    const newer = list.find((x) => x.metric === c.metric && x.source === c.source && x.period > c.period);
    if (newer) {
      console.warn(`${where}: ${c.source} now has ${newer.period}, newer than the correction's ${c.period}; the correction is not used and can be removed`);
      continue;
    }
    byPart[part][c.city] = [...list.filter((x) => !(x.metric === c.metric && x.source === c.source)), o];
    corrected++;
  }
}

function shapeOk(shape: Metric["shape"] | undefined, v: unknown): boolean {
  const n = valueLength(shape);
  if (n) return Array.isArray(v) && v.length === n && v.every(Number.isFinite);
  return typeof v === "number" && Number.isFinite(v);
}

function check(f: string, file: ObservationFile, folderPart: PartId, keep = true): void {
  for (const [cityId, list] of Object.entries(file.observations)) {
    if (!ids.has(cityId)) {
      errors.push(`${f}: unknown city ${cityId}`);
      continue;
    }
    for (const o of list) {
      const m = METRICS[o.metric];
      const where = `${f} ${cityId}`;
      if (!m) errors.push(`${where}: unknown metric ${o.metric}`);
      const part = publishable(o.source, where);
      if (part && !declared.get(o.source)?.has(o.metric)) errors.push(`${where}: registry/${o.source}.json does not declare ${o.metric} in measures`);
      if (m && !shapeOk(m.shape, o.value)) errors.push(`${where}: ${o.metric} has the wrong shape`);
      if (!o.period || !o.retrieved) errors.push(`${where}: ${o.metric} lacks period or retrieval date`);
      if (part && part !== folderPart) errors.push(`${where}: ${o.source} is licensed ${entries.get(o.source)!.rights!.licenceId}, so its figures belong in ${PARTS[part].folder}, not ${PARTS[folderPart].folder}`);
      if (part && keep) byPart[part][cityId]!.push(o);
    }
  }
}

// What else goes into the published data, and from which source: each must be publishable in the open part.
const provides = new Map<string, Set<string>>();
const provide = (id: string, what: string) => {
  const part = publishable(id, `published ${what}`);
  if (part === "open") (provides.get(id) ?? provides.set(id, new Set()).get(id)!).add(what);
  else if (part) errors.push(`published ${what}: ${id} is licensed for ${PARTS[part].file}, so it cannot sit in dataset.json`);
};
provide("geonames", "cities and countries (names, coordinates, population, time zones, currencies)");
provide(fx.source, "exchange rates");
for (const a of rights) provide(a.source, `residence rules (${a.name})`);

// The world map: its land, places and climate tiles, from sources that declare them and may be published.
const map = await readJson<WorldMap>("data/map/world.json");
errors.push(...validateMap(map, new Set(Object.keys(countries))).map((e) => `data/map/world.json: ${e}`));
const MAP_MEASURES: Record<string, string[]> = { "natural-earth": ["map_land", "map_places"], "nasa-power": ["map_climate"] };
for (const [id, measures] of Object.entries(MAP_MEASURES)) {
  provide(id, "the world map (public/data/map.json)");
  for (const m of measures) if (!declared.get(id)?.has(m)) errors.push(`data/map/world.json: registry/${id}.json does not declare ${m}`);
  if (!map.sources.some((s) => s.id === id)) errors.push(`data/map/world.json: does not name ${id} among its sources`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

// The manifest: every source whose figures or records are exported, with the terms they travel under.
const builtAt = new Date().toISOString();
const exported = new Map<string, Observation[]>();
for (const part of PART_IDS) for (const list of Object.values(byPart[part])) for (const o of list) (exported.get(o.source) ?? exported.set(o.source, []).get(o.source)!).push(o);
const manifestIds = [...new Set([...exported.keys(), ...provides.keys()])].sort();
const manifest: LicenceManifest = {
  builtAt,
  parts: PART_IDS.map((p) => PARTS[p]),
  sources: manifestIds.map((id): ManifestEntry => {
    const e = entries.get(id) as RegistryEntry & { rights: NonNullable<RegistryEntry["rights"]> };
    const obs = exported.get(id) ?? [];
    const lic = LICENCES[e.rights.licenceId]!;
    const dates = obs.map((o) => o.retrieved.slice(0, 10)).sort();
    return {
      source: id,
      name: e.name,
      publisher: e.publisher,
      url: e.homepage,
      edition: e.rights.edition,
      licenceId: lic.id,
      licence: lic.name,
      licenceUrl: lic.url,
      termsUrl: e.rights.termsUrl,
      termsRead: e.rights.termsRead,
      attribution: e.rights.attribution,
      notices: e.rights.notices ?? [],
      part: lic.part,
      file: PARTS[lic.part].file,
      observations: obs.length,
      metrics: [...new Set(obs.map((o) => o.metric))].sort(),
      retrieved: dates.length ? [dates[0]!, dates.at(-1)!] : null,
      provides: [...(provides.get(id) ?? [])],
    };
  }),
};

const partSources = (p: PartId) => manifest.sources.filter((s) => s.part === p && s.observations > 0).map((s) => s.source);
const others = PART_IDS.filter((p) => p !== "open" && partSources(p).length);
const dataset: Dataset & Published = {
  version: builtAt.slice(0, 10),
  builtAt,
  cities,
  countries,
  sources,
  metrics: METRICS,
  observations: byPart.open,
  fx,
  rights,
  shareAlike: partSources("odbl"),
  parts: others.map((p) => ({ part: p, file: PARTS[p].file, licence: PARTS[p].licence, sources: partSources(p) })),
  manifest,
};
await writeJson("public/data/dataset.json", dataset);
for (const p of others) {
  const file: PartFile = { part: p, licence: PARTS[p].licence, notice: PARTS[p].notice, sources: partSources(p), observations: Object.fromEntries(Object.entries(byPart[p]).filter(([, l]) => l.length)) };
  await writeJson(`public/${PARTS[p].file}`, file);
}
await writeJson("public/data/licences.json", manifest);
await writeJson("public/data/registry.json", registry.entries);
await writeFile(join(ROOT, "public/data/map.json"), JSON.stringify(map));
const count = (p: PartId) => Object.values(byPart[p]).reduce((s, l) => s + l.length, 0);
console.log(
  `dataset: ${cities.length} cities, ${PART_IDS.map((p) => `${count(p)} observations in ${PARTS[p].file}`).join(", ")}, from ${files.length} source files${corrected ? ` and ${corrected} correction${corrected > 1 ? "s" : ""}` : ""}; ${manifest.sources.length} sources in the licence manifest; map: ${map.tiles.length / 3} tiles, ${map.places.length} places`,
);
