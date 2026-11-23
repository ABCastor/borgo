import { scoreCandidates, criteriaFor, weightOf } from './engine.ts';
import type { Dataset, Profile, Observation } from './types.ts';

/** Country-only figures, never a nearby city's figures or the person's city overrides. */
export function countryLineScores(data: Dataset, profile: Profile) {
  const observations: Record<string, Observation[]> = {};
  for (const city of data.cities) {
    const id = `land-${city.country}`;
    const rows = observations[id] ??= [];
    for (const o of data.observations[city.id] ?? []) {
      if (o.level === 'country' && !rows.some(r => r.metric === o.metric && r.source === o.source && r.period === o.period)) rows.push(o);
    }
  }
  const cities = Object.keys(data.countries).map(country => ({ id: `land-${country}`, name: country, country, lat: 0, lon: 0 }));
  const p = { ...profile, prefs: { ...profile.prefs, normalise: 'absolute' as const }, overrides: {}, personal: [], dealBreakers: [] };
  const results = scoreCandidates({ ...data, cities, observations }, p, cities.map(c => c.id));
  const scores = new Map<string, Map<string, number>>();
  for (const r of results.values()) scores.set(r.city.country, new Map(r.lines.filter(l => l.score !== null && (l.id === 'right_to_live' || l.raw.sources.length > 0 && l.raw.sources.every(s => s.level === 'country')) && !['money_left', 'living_cost'].includes(l.id)).map(l => [l.id, l.score!])));
  return scores;
}

export function weightedLand(scores: Map<string, number> | undefined, profile: Profile) {
  let points = 0, covered = 0, total = 0, weather = 0;
  for (const c of criteriaFor(profile)) {
    const w = weightOf(profile, c);
    total += w;
    const score = scores?.get(c.id);
    if (score !== undefined) { points += w * score; covered += w; }
    else if (c.id === 'nice_days') weather = w;
  }
  return { score: covered ? points / covered : null, coverage: total ? covered / total : 0, points, covered, total, weather };
}

/** One land tile: the country's figures plus the nice-days weight, read on land as the share of the twelve months
 * whose average afternoon high sits in the person's range (the tiles hold monthly temperature, not daily weather). */
export function tileLand(country: ReturnType<typeof weightedLand> | undefined, monthsShare: number) {
  if (!country) return { score: null, coverage: 0 };
  const points = country.points + country.weather * monthsShare;
  const covered = country.covered + country.weather;
  return { score: covered ? points / covered : null, coverage: country.total ? covered / country.total : 0 };
}
