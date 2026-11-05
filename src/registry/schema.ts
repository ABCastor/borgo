// The source registry: the human-vetted list of where each figure can come from, what it means, under which terms,
// and how to fetch it. One JSON file per source in registry/. This is the project's data layer (docs/architecture.md);
// the figures themselves are fetched on the person's side.
import type { Level, Source } from "../core/types.ts";
import { LICENCES, partFor, type Rights } from "./licences.ts";

export type Runtime = "browser" | "node";

export interface RegistryEntry {
  id: string;
  name: string;
  publisher: string;
  homepage: string;
  /** Metric ids this source fills, each with what *this source* counts, in plain words. */
  measures: { metric: string; definition: string }[];
  coverage: { geography: string | string[]; level: Level; period: string };
  licence: string;
  licenceUrl?: string;
  /** "yes": may go in the committed snapshot and public pages. "share-alike": the same, kept apart under its licence (ODbL). "no": never stored by us. */
  redistribute: "yes" | "share-alike" | "no";
  /** Required when redistribute is not "no": the licence, edition and attribution the published figures carry (src/registry/licences.ts). A link-out source has none, so it can never be exported. */
  rights?: Rights;
  /** "api" and "bulk": our fetchers read it. "curated": encoded by hand in this repository from the cited texts. "link-out": a page a person (or their agent) reads; we never fetch it. */
  access: "api" | "bulk" | "curated" | "link-out";
  fetch?: {
    /** "per-city": fetched for one place on demand. "batch": a pipeline script over the seed cities, not yet on demand. */
    mode: "per-city" | "batch";
    runtimes: Runtime[];
    /** URL template; {lat} {lon} {name} {country} {iso3} {start} {end} are filled per place. */
    endpoint: string;
    /** Whether a browser may read it from another origin (checked with an Origin header). */
    cors: boolean;
    /** null when no key is needed; otherwise what key and where to get it. */
    key: string | null;
    rateLimit?: string;
    /** The code that fetches it. */
    fetcher?: string;
  };
  alternatives?: { endpoint: string; cors: boolean; key?: string; note?: string }[];
  /** The publisher's own page about a place: the human-readable page for API sources, the only access for link-out ones. */
  linkOut?: string;
  refresh: { cadence: "daily" | "monthly" | "yearly" | "static" | "irregular"; maxAgeDays: number };
  vetted: { humanSelected: boolean; by: string; on: string; notes: string };
  caveats?: string[];
  /** Link-out sources: what a person's own agent may do with the page. */
  personalUse?: string;
}

/** Things a source can provide that are not scored metrics: where a place is, its region code, exchange rates, residence rights, the world map's land, places and climate tiles. */
export const REFERENCE_MEASURES = new Set(["place", "region_code", "fx", "right_to_live", "map_land", "map_places", "map_climate"]);

const LEVELS = new Set(["city", "metro", "region", "country"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every problem with one entry, in words a contributor can act on. Empty when the entry is sound. */
export function validateEntry(e: RegistryEntry, metricIds: Set<string>, file?: string): string[] {
  const at = file ?? e.id ?? "(entry)";
  const errs: string[] = [];
  const need = (ok: unknown, msg: string) => {
    if (!ok) errs.push(`${at}: ${msg}`);
  };
  need(/^[a-z0-9-]+$/.test(e.id ?? ""), "id must be kebab-case");
  if (file) need(file === `${e.id}.json`, `file name must be ${e.id}.json`);
  for (const k of ["name", "publisher", "homepage", "licence"] as const) need(typeof e[k] === "string" && e[k].length > 0, `${k} is required`);
  need(/^https:\/\//.test(e.homepage ?? ""), "homepage must be an https URL");
  need(Array.isArray(e.measures), "measures must be a list");
  for (const m of e.measures ?? []) {
    need(metricIds.has(m.metric) || REFERENCE_MEASURES.has(m.metric), `measures: unknown metric ${m.metric}`);
    need(typeof m.definition === "string" && m.definition.length >= 12, `measures ${m.metric}: needs a plain-words definition`);
  }
  need(e.coverage && LEVELS.has(e.coverage.level), "coverage.level must be city, metro, region or country");
  need(["yes", "share-alike", "no"].includes(e.redistribute), "redistribute must be yes, share-alike or no");
  need(["api", "bulk", "curated", "link-out"].includes(e.access), "access must be api, bulk, curated or link-out");
  if (e.access === "link-out") {
    need(e.redistribute === "no", "a link-out source is never redistributed");
    need(!e.fetch, "a link-out source has no fetcher: we never fetch it");
    need(typeof e.linkOut === "string", "a link-out source needs its linkOut page template");
    need(typeof e.personalUse === "string", "a link-out source says what a person's own agent may do (personalUse)");
  }
  if (e.redistribute === "no") need(!e.rights, "a source that is not redistributed has no rights block, so nothing from it can be published");
  else {
    const r = e.rights;
    need(!!r, "a redistributed source needs a rights block: licenceId, edition, termsUrl, termsRead, attribution");
    if (r) {
      need(!!LICENCES[r.licenceId], `rights.licenceId ${r.licenceId} is not a known licence (src/registry/licences.ts)`);
      need(typeof r.edition === "string" && r.edition.length > 0, "rights.edition names the release read");
      need(/^https:\/\//.test(r.termsUrl ?? ""), "rights.termsUrl must be the https page whose terms were read");
      need(DATE.test(r.termsRead ?? ""), "rights.termsRead is the date the terms were read (YYYY-MM-DD)");
      need(typeof r.attribution === "string" && r.attribution.length >= 8, "rights.attribution is the credit line its figures need");
      const p = partFor(e);
      if ("error" in p && LICENCES[r.licenceId]) errs.push(`${at}: ${p.error}`);
    }
  }
  if (e.access === "api" || e.access === "bulk") need(!!e.fetch, "an api or bulk source needs fetch details");
  if (e.fetch) {
    const f = e.fetch;
    need(f.mode === "per-city" || f.mode === "batch", "fetch.mode must be per-city or batch");
    need(Array.isArray(f.runtimes) && f.runtimes.length > 0 && f.runtimes.every((r) => r === "browser" || r === "node"), "fetch.runtimes lists browser and/or node");
    need(typeof f.cors === "boolean", "fetch.cors must say whether a browser may read it");
    if (f.runtimes?.includes("browser")) need(f.cors, "a source without CORS cannot run in the browser");
    need(f.key === null || typeof f.key === "string", "fetch.key is null or says which key");
    need(typeof f.endpoint === "string" && f.endpoint.length > 0, "fetch.endpoint is required");
  }
  need(e.refresh && Number.isFinite(e.refresh.maxAgeDays) && e.refresh.maxAgeDays > 0, "refresh.maxAgeDays must be a positive number");
  need(e.vetted && typeof e.vetted.humanSelected === "boolean" && typeof e.vetted.by === "string" && DATE.test(e.vetted.on ?? "") && !!e.vetted.notes, "vetted needs humanSelected, by, on (YYYY-MM-DD) and notes");
  return errs;
}

/** The dataset's view of a source: what a figure's popover and credit line need. */
export function toSource(e: RegistryEntry): Source {
  const s: Source = { id: e.id, name: e.name, publisher: e.publisher, url: e.homepage, licence: e.licence, redistributable: e.redistribute !== "no" };
  if (e.licenceUrl) s.licenceUrl = e.licenceUrl;
  if (e.redistribute === "share-alike") s.shareAlike = true;
  return s;
}

/** Fills a link-out template for a place. */
export function linkFor(template: string, place: { name: string; country: string; lat: number; lon: number }): string {
  return template
    .replace("{name_dashed}", encodeURIComponent(place.name.replace(/ /g, "-")))
    .replace("{name_underscored}", encodeURIComponent(place.name.replace(/ /g, "_")))
    .replace("{name}", encodeURIComponent(place.name))
    .replace("{country}", place.country)
    .replace("{lat}", String(place.lat))
    .replace("{lon}", String(place.lon));
}
