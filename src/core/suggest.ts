import { scoreCandidates, type CityResult } from "./engine.ts";
import type { Dataset, Profile } from "./types.ts";

export interface Suggestion {
  id: string;
  name: string;
  country: string;
  score: number;
  coverage: number;
  requestedCoverage: number;
  missing: string[];
  reasons: { line: string; figure: string; points: number; sources: { publisher: string; period: string; url: string }[] }[];
}

/** Published candidates only, with the same score they receive when added. Unknown requirements are not passes. */
export function suggestCities(data: Dataset, profile: Profile, published = data.publishedCityIds ?? data.cities.map((c) => c.id)): Suggestion[] {
  const candidates = published.filter((id) => !profile.cities.includes(id));
  const ranked = [...scoreCandidates(data, profile, candidates).values()]
    .filter((r) => candidates.includes(r.city.id) && !r.ruledOut.length && !r.unresolved.length)
    .sort((a, b) => b.total - a.total || a.city.id.localeCompare(b.city.id));
  return ranked.slice(0, 5).map((r: CityResult) => ({
    id: r.city.id, name: r.city.name, country: r.city.country, score: r.total,
    coverage: r.coverage, requestedCoverage: r.requestedCoverage,
    missing: r.lines.filter((l) => l.weight > 0 && (l.raw.value === null || l.basis)).map((l) => l.label),
    reasons: r.lines.filter((l) => l.weight > 0 && l.observed)
      .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id)).slice(0, 2)
      .map((l) => ({ line: l.label, figure: l.raw.text, points: l.points, sources: l.raw.sources.map((s) => {
        if (s.origin.kind === "you") return { publisher: "Your figure", period: "yours", url: "" };
        const o = s.origin.observation;
        const source = data.sources[o.source];
        return { publisher: source?.publisher ?? o.source, period: o.period, url: source?.url ?? "" };
      }) })),
  }));
}
