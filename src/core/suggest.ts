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

/** A suggestion needs figures for most of what the person weighted, or a city with gaps outranks one fully known. */
export const SUGGEST_MIN_COVERAGE = 0.75;

/** Published candidates only, with the same score they receive when added. Unknown requirements are not passes.
 * Coverage counts only lines some candidate has a figure for: a salary not yet given, or a 1-5 line the person has
 * not rated anywhere, is a gap for every city and says nothing about one of them. Cities short of
 * SUGGEST_MIN_COVERAGE come after the well-covered ones, ordered by score times coverage. */
export function suggestCities(data: Dataset, profile: Profile, published = data.publishedCityIds ?? data.cities.map((c) => c.id)): Suggestion[] {
  const candidates = published.filter((id) => !profile.cities.includes(id));
  const eligible = [...scoreCandidates(data, profile, candidates).values()]
    .filter((r) => candidates.includes(r.city.id) && !r.ruledOut.length && !r.unresolved.length);
  const known = new Set(eligible.flatMap((r) => r.lines.filter((l) => l.weight > 0 && l.observed).map((l) => l.id)));
  const cover = (r: CityResult): number => {
    const lines = r.lines.filter((l) => l.weight > 0 && known.has(l.id));
    const all = lines.reduce((t, l) => t + l.weight, 0);
    return all === 0 ? 0 : lines.filter((l) => l.observed).reduce((t, l) => t + l.weight, 0) / all;
  };
  const scored = eligible.map((r) => ({ r, c: cover(r) }));
  const rank = (x: { r: CityResult; c: number }): [number, number] => x.c >= SUGGEST_MIN_COVERAGE ? [1, x.r.total] : [0, x.r.total * x.c];
  const ranked = scored.sort((a, b) => { const [ga, sa] = rank(a), [gb, sb] = rank(b); return gb - ga || sb - sa || a.r.city.id.localeCompare(b.r.city.id); })
    .map((x) => x.r);
  return ranked.slice(0, 5).map((r: CityResult) => ({
    id: r.city.id, name: r.city.name, country: r.city.country, score: r.total,
    coverage: r.coverage, requestedCoverage: r.requestedCoverage,
    missing: r.lines.filter((l) => l.weight > 0 && known.has(l.id) && (l.raw.value === null || l.basis)).map((l) => l.label),
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
