import { buildProfile, type QueryArgs } from "./profile.ts";
import { suggestCities } from "../core/suggest.ts";
import type { Dataset } from "../core/types.ts";

export function suggest(data: Dataset, args: Omit<QueryArgs, "cities"> & { cities?: string[] }) {
  const { profile, assumptions } = buildProfile(data, { ...args, cities: args.cities?.length ? args.cities : [data.cities[0]!.id] });
  if (!args.cities?.length) profile.cities = [];
  return { assumptions, cities: suggestCities(data, profile), note: "Top published cities not already chosen. Up to two biggest observed point contributions per city; fewer means fewer scored lines have figures. Missing lines do not count there. Entry difficulty is a rough guide, not legal advice." };
}
export function suggestionsMarkdown(result: ReturnType<typeof suggest>): string {
  return `${result.note}\n\n${result.cities.map((r, i) => `${i + 1}. ${r.name} (${r.id}): ${r.score.toFixed(1)}/100, ${Math.round(r.requestedCoverage * 100)}% requested-weight coverage\n   ${r.reasons.map((x) => `${x.line}: ${x.figure}${x.sources.length ? ` (${x.sources.map((s) => `${s.publisher}, ${s.period}`).join("; ")})` : ""}`).join("; ") || "No scored figures."}`).join("\n")}\n\n${result.assumptions.join("\n")}`;
}
