// The registry as a person or an agent reads it: which sources answer which question, under what terms, how to
// fetch each one, and which pages are link-only.
import type { Iso2 } from "../core/types.ts";
import { linkFor, type RegistryEntry } from "../registry/schema.ts";

export interface SourceRow {
  id: string;
  name: string;
  publisher: string;
  metrics: string[];
  definitions: Record<string, string>;
  coverage: string;
  level: string;
  licence: string;
  redistribute: RegistryEntry["redistribute"];
  access: RegistryEntry["access"];
  /** Where it runs on the person's side; empty for link-out and curated sources. */
  runtimes: string[];
  onDemand: boolean;
  cors: boolean | null;
  key: string | null;
  refreshDays: number;
  humanSelected: boolean;
  vettedBy: string;
  caveats: string[];
  /** The publisher's page for the place asked about, when one was given. */
  page?: string;
  homepage: string;
  personalUse?: string;
}

const covers = (e: RegistryEntry, country?: Iso2) => {
  if (!country) return true;
  const g = e.coverage.geography;
  return Array.isArray(g) ? g.includes(country) : true;
};

export function listSources(entries: RegistryEntry[], f: { metric?: string; country?: Iso2; access?: RegistryEntry["access"]; place?: { name: string; country: string; lat: number; lon: number } } = {}): SourceRow[] {
  return entries
    .filter((e) => !f.metric || e.measures.some((m) => m.metric === f.metric))
    .filter((e) => covers(e, f.country?.toUpperCase()))
    .filter((e) => !f.access || e.access === f.access)
    .map((e) => ({
      id: e.id,
      name: e.name,
      publisher: e.publisher,
      metrics: e.measures.map((m) => m.metric),
      definitions: Object.fromEntries(e.measures.map((m) => [m.metric, m.definition])),
      coverage: Array.isArray(e.coverage.geography) ? e.coverage.geography.join(", ") : e.coverage.geography,
      level: e.coverage.level,
      licence: e.licence,
      redistribute: e.redistribute,
      access: e.access,
      runtimes: e.fetch?.runtimes ?? [],
      onDemand: e.fetch?.mode === "per-city",
      cors: e.fetch ? e.fetch.cors : null,
      key: e.fetch?.key ?? null,
      refreshDays: e.refresh.maxAgeDays,
      humanSelected: e.vetted.humanSelected,
      vettedBy: `${e.vetted.by}, ${e.vetted.on}`,
      caveats: e.caveats ?? [],
      ...(f.place && e.linkOut ? { page: linkFor(e.linkOut, f.place) } : {}),
      homepage: e.homepage,
      ...(e.personalUse ? { personalUse: e.personalUse } : {}),
    }));
}

const ACCESS: Record<RegistryEntry["access"], string> = { api: "fetched", bulk: "fetched (file)", curated: "curated here", "link-out": "link only" };

export function sourcesMarkdown(rows: SourceRow[], title = "Sources"): string {
  const fetched = rows.filter((r) => r.access !== "link-out");
  const links = rows.filter((r) => r.access === "link-out");
  const out = [`## ${title}`, "", "Every figure comes from one of these. Fetched sources run on your side (browser, CLI or MCP server) and keep their provenance; link-only pages are for you or your own agent to read, never copied into this project.", ""];
  if (fetched.length) {
    out.push("| Source | Measures | Coverage | Licence | How | Where it runs | Vetted |", "|---|---|---|---|---|---|---|");
    for (const r of fetched) out.push(`| [${r.name}](${r.page ?? r.homepage}) (\`${r.id}\`) | ${r.metrics.join(", ")} | ${r.coverage} (${r.level}) | ${r.licence}${r.redistribute === "share-alike" ? ", share-alike" : ""} | ${ACCESS[r.access]}${r.onDemand ? ", any place" : r.access === "curated" ? "" : ", seed cities only for now"} | ${r.runtimes.join(", ") || "–"}${r.key ? `; needs ${r.key}` : ""} | ${r.humanSelected ? "by a person" : "by an agent, awaiting review"} |`);
  }
  if (links.length) {
    out.push("", "### Link only", "", "| Page | For | Why not copied |", "|---|---|---|");
    for (const r of links) out.push(`| [${r.name}](${r.page ?? r.homepage}) | ${r.metrics.join(", ") || "overall rankings"} | ${r.licence} |`);
  }
  const notes = rows.filter((r) => r.caveats.length);
  if (notes.length) out.push("", "### Caveats", "", ...notes.flatMap((r) => r.caveats.map((c) => `- **${r.name}:** ${c}`)));
  return out.join("\n");
}
