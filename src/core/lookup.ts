import type { City, Dataset, Level, Observation, Profile, Value } from "./types.ts";

export type Origin =
  | { kind: "source"; observation: Observation }
  /** Several sources describe the city at the same level within a few years: their median, and their spread. */
  | { kind: "consensus"; observation: Observation; observations: Observation[]; min: number; max: number }
  | { kind: "you" };

export interface Resolved {
  value: Value;
  origin: Origin;
  level: Level;
  /** Every other observation of this metric for the city, for the "other sources" view. */
  others: Observation[];
}

const LEVEL_RANK: Record<Level, number> = { city: 0, metro: 1, region: 2, country: 3 };
const SAME_TIME_YEARS = 2;

const year = (period: string) => Number(period.slice(0, 4));

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The best value for a metric in a city: the person's own number first; otherwise the most local level,
 * the most recent period at that level, and, when other sources agree in level and time, their median.
 */
export function resolve(data: Dataset, profile: Profile | null, city: City, metric: string): Resolved | null {
  const obs = (data.observations[city.id] ?? []).filter((o) => o.metric === metric);
  const own = profile?.overrides[city.id]?.[metric];
  if (own !== undefined && Number.isFinite(own)) return { value: own, origin: { kind: "you" }, level: "city", others: obs };
  if (obs.length === 0) return null;
  obs.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.period.localeCompare(a.period));
  const best = obs[0]!;
  const peers = obs.filter(
    (o) => o.level === best.level && o.source !== best.source && typeof o.value === "number" && Math.abs(year(o.period) - year(best.period)) <= SAME_TIME_YEARS,
  );
  // One value per source: the most recent, which sorting already put first.
  const bySource = new Map<string, Observation>();
  for (const o of [best, ...peers]) if (!bySource.has(o.source)) bySource.set(o.source, o);
  const group = [...bySource.values()];
  if (group.length > 1 && typeof best.value === "number") {
    const values = group.map((o) => o.value as number);
    return {
      value: median(values),
      origin: { kind: "consensus", observation: best, observations: group, min: Math.min(...values), max: Math.max(...values) },
      level: best.level,
      others: obs.filter((o) => !group.includes(o)),
    };
  }
  return { value: best.value, origin: { kind: "source", observation: best }, level: best.level, others: obs.slice(1) };
}

export function scalar(r: Resolved | null): number | null {
  if (!r) return null;
  return typeof r.value === "number" ? r.value : null;
}

export function series(r: Resolved | null): number[] | null {
  if (!r) return null;
  return Array.isArray(r.value) ? r.value : null;
}

export function cityById(data: Dataset, id: string): City | undefined {
  return data.cities.find((c) => c.id === id);
}
