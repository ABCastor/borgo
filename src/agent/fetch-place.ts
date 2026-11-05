// Fetching a place for a terminal or an agent: resolve the text, reuse the person's cache while it is fresh, else
// fetch every source that covers the place, save it with provenance, and add it to the session's dataset.
import type { Dataset } from "../core/types.ts";
import { makeCtx, type FetchCtx } from "../fetch/context.ts";
import { addFetched, fetchCity, type CityFetch, type SourceOutcome } from "../fetch/index.ts";
import { diskBulkCache, loadCity, saveCity } from "../fetch/node/cache.ts";
import { NODE_FETCHERS } from "../fetch/node/index.ts";
import { resolvePlace, type Resolved } from "../places/resolve.ts";
import { gapsText, placeGaps, type Gap } from "../places/gaps.ts";
import { nodeTowns } from "../places/towns-node.ts";

/** A fetched place is reused for this long unless a refresh is asked for. */
export const CACHE_DAYS = 30;

export interface PlaceFetch {
  fetched: CityFetch;
  fromCache: boolean;
  /** Other places the text could mean, so a person or agent can pick another by GeoNames id. */
  alternatives: Resolved[];
  savedTo: string | null;
  /** Set when the text named an island or a country: "the main town of Tenerife". */
  stands?: string;
  /** What the project has no model or rules for in this place's country. */
  lacks: Gap[];
}

export function nodeCtx(refresh = false): FetchCtx {
  return makeCtx({ runtime: "node", bulkCache: diskBulkCache(refresh ? 0 : CACHE_DAYS) });
}

export async function fetchPlace(data: Dataset, text: string, opts: { only?: string[]; refresh?: boolean; ctx?: FetchCtx; onProgress?: (o: SourceOutcome | { source: string; status: "running" }) => void } = {}): Promise<PlaceFetch> {
  const ctx = opts.ctx ?? nodeCtx(opts.refresh);
  const candidates = await resolvePlace(text, ctx, { countries: data.countries, known: data.cities, geonamesUser: process.env.GEONAMES_USERNAME, towns: nodeTowns });
  const pick = candidates[0];
  if (!pick) throw new Error(`No place called "${text}" was found. Add the country ("Palermo, IT") or give a GeoNames id (geonames:2523920).`);
  const alternatives = candidates.slice(1);
  const stands = { ...(pick.stands ? { stands: pick.stands } : {}), lacks: placeGaps(data, pick.city) };
  const cached = loadCity(pick.city.id);
  // A figure made by an older version of its fetcher (a fixed bug, a changed definition) makes the whole place stale.
  const current = new Map(NODE_FETCHERS.map((f) => [f.source, `${f.source}@${f.version}`]));
  const outdated = cached?.observations.some((o) => o.fetcher && o.fetcher !== "agent" && current.has(o.source) && o.fetcher !== current.get(o.source));
  // A cache entry that only holds figures an agent recorded (no source was ever fetched) is not a fetch.
  const fetchedBefore = !!cached?.outcomes.length;
  const fresh = cached && fetchedBefore && !outdated && Date.now() - Date.parse(cached.fetchedAt) < CACHE_DAYS * 86_400_000;
  if (cached && fresh && !opts.refresh && !opts.only) {
    addFetched(data, [cached]);
    return { fetched: cached, fromCache: true, alternatives, savedTo: null, ...stands };
  }
  const fetched = await fetchCity(pick.city, ctx, NODE_FETCHERS, { only: opts.only, onProgress: opts.onProgress });
  // Figures an agent recorded are kept; so, on a partial refresh, is what the other sources gave last time.
  if (cached) {
    const redone = new Set(opts.only ? fetched.outcomes.map((o) => o.source) : NODE_FETCHERS.map((f) => f.source));
    fetched.observations.push(...cached.observations.filter((o) => !redone.has(o.source)));
    fetched.outcomes.push(...cached.outcomes.filter((o) => !redone.has(o.source)));
  }
  const savedTo = saveCity(fetched);
  addFetched(data, [fetched]);
  return { fetched, fromCache: false, alternatives, savedTo, ...stands };
}

const STATUS: Record<SourceOutcome["status"], string> = { ok: "got", empty: "nothing for this place", failed: "failed", skipped: "skipped" };

/** A series longer than this is counted in the summary, not listed. */
const SERIES_IN_SUMMARY = 24;

/** The compact fetch result an agent gets by default: the id to use, what each source gave, what the place lacks. */
export interface PlaceFetchSummary {
  reportVersion: string;
  detail: "summary";
  id: string;
  name: string;
  country: string;
  stands: string | null;
  fromCache: boolean;
  fetchedAt: string;
  outcomes: { source: string; status: string; count: number; reason?: string }[];
  lacks: Gap[];
  /** Each figure in brief: long series (hourly temperature, nice-day bins) are counted, not listed. */
  figures: { metric: string; value: number | number[] | null; values?: number; unit: string; period: string; level: string; source: string }[];
  alternatives: { name: string; label: string; geonames: string | undefined }[];
}

export function placeFetchSummary(r: PlaceFetch, data: Dataset, reportVersion: string): PlaceFetchSummary {
  const c = r.fetched.city;
  return {
    reportVersion,
    detail: "summary",
    id: c.id,
    name: c.name,
    country: c.country,
    stands: r.stands ?? null,
    fromCache: r.fromCache,
    fetchedAt: r.fetched.fetchedAt,
    outcomes: r.fetched.outcomes.map((o) => ({ source: o.source, status: o.status, count: o.count, ...(o.reason ? { reason: o.reason } : {}) })),
    lacks: r.lacks,
    figures: r.fetched.observations.map((o) => {
      const long = Array.isArray(o.value) && o.value.length > SERIES_IN_SUMMARY;
      return { metric: o.metric, value: long ? null : o.value, ...(long ? { values: (o.value as number[]).length } : {}), unit: data.metrics[o.metric]?.unit ?? "", period: o.period, level: o.level, source: o.source };
    }),
    alternatives: r.alternatives.map((a) => ({ name: a.city.name, label: a.label, geonames: a.city.geonames })),
  };
}

export function placeFetchMarkdown(r: PlaceFetch, data: Dataset, detail: "summary" | "full" = "full"): string {
  const c = r.fetched.city;
  const lines = [
    `## ${c.name}, ${data.countries[c.country]?.name ?? c.country} (\`${c.id}\`)`,
    "",
    ...(r.stands ? [`"${c.aliases?.[0] ?? c.name}" is read as ${c.name}, ${r.stands}.`, ""] : []),
    `${c.region ? `Region ${c.region}. ` : ""}${c.population ? `${c.population.toLocaleString("en-GB")} people. ` : ""}${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}${c.elevation != null ? `, ${Math.round(c.elevation)} m` : ""}. GeoNames ${c.geonames ?? "–"}.`,
    ...(r.lacks.length ? [`**Partial data.** Lacks ${gapsText(r.lacks)}. Every source's result is below.`] : []),
    r.fromCache ? `From your cache, fetched ${r.fetched.fetchedAt.slice(0, 16).replace("T", " ")} UTC (add --refresh to fetch again).` : `Fetched ${r.fetched.fetchedAt.slice(0, 16).replace("T", " ")} UTC${r.savedTo ? `, saved to ${r.savedTo}` : ""}.`,
    "",
    "| Source | Result | Figures | Why |",
    "|---|---|---:|---|",
    ...r.fetched.outcomes.map((o) => `| ${data.sources[o.source]?.name ?? o.source} | ${STATUS[o.status]} | ${o.count} | ${o.reason ?? ""} |`),
    "",
    "| Figure | Value | Period | Level | Source |",
    "|---|---|---|---|---|",
    ...r.fetched.observations.map((o) => {
      const m = data.metrics[o.metric];
      const long = Array.isArray(o.value) && o.value.length > SERIES_IN_SUMMARY;
      const v = Array.isArray(o.value) ? (o.value.length === 288 ? "24 h x 12 months" : long && detail === "summary" ? `${o.value.length} values` : o.value.join(" · ")) : o.value.toLocaleString("en-GB", { maximumFractionDigits: m?.decimals ?? 2 });
      const src = data.sources[o.source]?.name ?? o.source;
      return `| ${m?.label ?? o.metric} | ${v}${m && !Array.isArray(o.value) ? ` ${m.unit}` : ""} | ${o.period} | ${o.level} | ${detail === "summary" ? src : `[${src}](${o.url ?? data.sources[o.source]?.url ?? ""})`} |`;
    }),
  ];
  if (r.alternatives.length) lines.push("", `Did you mean another place? ${r.alternatives.map((a) => `${a.city.name} (${a.label}; geonames:${a.city.geonames})`).join("; ")}.`);
  return lines.join("\n");
}
