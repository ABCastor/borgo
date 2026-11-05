// What a place lacks, said plainly: the models and rules the project has no version of for its country, and the
// scoring lines with no figure for it. The app shows these on a city's card and dossier; the CLI and the MCP server
// return them with a fetched place.
import type { CityResult } from "../core/engine.ts";
import type { City, Dataset } from "../core/types.ts";
import { TAX_MODELS } from "../tax/index.ts";

export interface Gap {
  /** What is missing: "Take-home pay", "Sunshine". */
  what: string;
  /** Why, in a few words: "only citizens count: no free-movement area covers Israel". */
  why: string;
  /** The gap in one short phrase, for a card: "no tax model for Israel yet". Absent for a line with no figure. */
  short?: string;
}

/** Gaps that hold whatever the person weighs: no tax model, no exchange rate, no free-movement rules. */
export function placeGaps(data: Dataset, city: City): Gap[] {
  const country = data.countries[city.country];
  const name = country?.name ?? city.country;
  const gaps: Gap[] = [];
  if (!TAX_MODELS[city.country]) gaps.push({ what: "Take-home pay", why: `no tax model for ${name} yet`, short: `no tax model for ${name} yet` });
  const cur = country?.currency;
  if (cur && cur !== data.fx.base && !data.fx.rates[cur]) gaps.push({ what: "Money", why: `no exchange rate for ${cur}, so nothing is converted`, short: `no exchange rate for ${cur}` });
  if (!data.rights.some((a) => a.territory.includes(city.country))) gaps.push({ what: "Residence rules", why: `only citizens count: no free-movement area covers ${name}`, short: "no free-movement rules" });
  return gaps;
}

/** The place's gaps plus every weighted scoring line with no figure for it, the heaviest first. */
export function resultGaps(data: Dataset, r: CityResult): Gap[] {
  const lines = r.lines
    .filter((l) => l.imputed && l.weight > 0 && !l.personal)
    .sort((a, b) => b.weight - a.weight)
    .map((l): Gap => ({ what: l.label, why: "no figure here yet" }));
  return [...placeGaps(data, r.city), ...lines];
}

const list = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? ""));

/** "take-home pay (no tax model for Israel yet), sunshine and rent" */
export function gapsText(gaps: Gap[]): string {
  return list(gaps.map((g) => (g.short ? `${g.what.toLowerCase()} (${g.why})` : g.what.toLowerCase())));
}

/** For a card, at most `max` items: "no tax model for Israel yet; no figure for sunshine, rent and 2 more" */
export function gapsShort(gaps: Gap[], max = 3): string {
  const rules = gaps.filter((g) => g.short).map((g) => g.short!);
  const lines = gaps.filter((g) => !g.short).map((g) => g.what.toLowerCase());
  const room = Math.max(1, max - rules.length);
  const shown = lines.slice(0, room);
  const more = lines.length - shown.length;
  const figs = shown.length ? `no figure for ${list(more ? [...shown, `${more} more`] : shown)}` : "";
  return [rules.join(", "), figs].filter(Boolean).join("; ");
}
