// Where a place sits from left to right, read from the table pipeline/sources/politics.ts builds from official election
// results and ParlGov's party positions (method in docs/positions.md). A region with its own count (a Swiss canton, a
// Canadian province, an Australian state) gets its own figure; anywhere else the country's.
import type { City, Observation } from "../core/types.ts";
import type { Fetcher } from "./context.ts";
import { POLITICS } from "./politics-table.ts";

export interface PlacePolitics {
  /** 0 left to 10 right; null when parties with a position took under 75% of the vote. */
  position: number | null;
  election: string;
  date: string;
  source: string;
  url: string;
  /** The date the result was last compared with its source. */
  checked: string;
  /** Share of valid votes cast for parties with a position. */
  covered: number;
  /**
   * Each party: name, share of valid votes, position, and its basis: "expert" (ParlGov's mean of expert surveys),
   * "family" (ParlGov's mean for the party's family, where no survey covers it), "members" (an alliance, its members' mean).
   */
  parties: { name: string; share: number; position: number | null; basis: "expert" | "family" | "members" | null }[];
}

export function politicsFor(city: City): { place: string; level: "region" | "country"; p: PlacePolitics } | null {
  const region = city.region && POLITICS[city.region];
  if (region) return { place: city.region!, level: "region", p: region };
  const country = POLITICS[city.country];
  return country ? { place: city.country, level: "country", p: country } : null;
}

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "Name 12.3% (4.5)", with the position's basis where it is not an expert estimate. */
function partyText(x: PlacePolitics["parties"][number]): string {
  if (x.position === null) return `${x.name} ${x.share}% (no position)`;
  const basis = x.basis === "family" ? ", party-family average" : x.basis === "members" ? ", members' average" : "";
  return `${x.name} ${x.share}% (${x.position}${basis})`;
}

export const politics: Fetcher = {
  source: "politics",
  version: 2,
  runtimes: ["browser", "node"],
  covers: (c) => !!politicsFor(c),
  async fetch(city, ctx) {
    const hit = politicsFor(city);
    if (!hit || hit.p.position === null) return [];
    const { p, level } = hit;
    const parties = p.parties.slice(0, 6).map(partyText).join(", ");
    const obs: Observation = {
      metric: "politics_lr",
      value: p.position!,
      period: p.date,
      level,
      source: "politics",
      retrieved: ctx.now().toISOString(),
      url: p.url,
      fetcher: "politics@2",
      note: `Estimate from the official result of ${p.election}, ${longDate(p.date)}, with ParlGov party positions: ${parties}. Parties with a position took ${Math.round(p.covered * 100)}% of the vote.`,
    };
    return [obs];
  },
};
