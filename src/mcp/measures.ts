// What the MCP App view offers to rank by, grouped as the site groups its priorities (src/core/groups.ts). Each entry is
// the arguments rank_cities takes for it, the order that puts the best first, and what a ranking needs from the person's
// own details before it can be answered (a take-home figure needs a salary): an entry the arguments cannot satisfy is
// not offered, so a click never lands on an error. test/mcp-app.test.ts runs every entry through rank_cities.
import { CRITERIA } from "../core/criteria.ts";
import { GROUPS, groupOf } from "../core/groups.ts";

export interface Measure {
  /** "criterion:nice_days", "metric:rent_1bed" or "score": how the view tells which entry a ranking is. */
  key: string;
  group: string;
  label: string;
  /** What rank_cities is called with, besides the person's own details. */
  arg: Record<string, unknown>;
  /** The direction that puts the best city first (the criterion's own scale says which end is better). */
  order: "asc" | "desc";
  /** Details of the person the ranking needs: salary, spending, home, household, work. */
  needs: string[];
  /** The ranking has twelve monthly figures to show as strips. */
  months: boolean;
}

const NEEDS: Record<string, string[]> = {
  money_left: ["salary", "spending"],
  living_cost: ["spending"],
  after_tax_rent: ["salary"],
  right_to_live: ["household"],
  field_pay: ["work"],
  field_jobs: ["work"],
  time_zone: ["home"],
  flight_home: ["home"],
};
/** Lines where fewer is better (a cost, a distance, a pollutant, a count of bad days): the ranking starts from the lowest. */
export const LOWER_IS_BETTER = new Set(["living_cost", "dry_days", "clean_air", "safety", "health_costs", "childcare", "time_zone", "flight_home", "airport", "short_commute", "way_out", "sea", "mountains", "jobs", "muggy", "grey", "hot_nights", "heat", "snow", "wind"]);
/** Lines that come with twelve monthly figures. */
export const MONTHLY = new Set(["nice_days", "beach", "run_ride", "muggy", "grey", "hot_nights", "heat", "snow", "wind"]);

export const REGION_CHOICES = [
  { id: "europe", label: "Europe" },
  { id: "north-america", label: "North America" },
  { id: "latin-america", label: "Latin America" },
  { id: "asia-pacific", label: "Asia and Oceania" },
  { id: "middle-east-africa", label: "Middle East and Africa" },
];
export const LIMIT_CHOICES = [5, 10, 20, 50];
/** The figures a city card shows beside the ranking: one of each kind, all with their sources in get_city. */
export const CARD_METRICS = ["rent_1bed", "sunshine_hours", "pm25", "homicide_rate", "life_expectancy", "life_evaluation", "price_level"];
/** The twelve-month lows and highs a city card draws its year from, air and feels-like. */
export const CLIMATE_METRICS = ["temp_low", "temp_high", "feels_low", "feels_high"];

export function measures(): Measure[] {
  const out: Measure[] = [];
  const add = (group: string, key: string, label: string, arg: Record<string, unknown>, order: "asc" | "desc", needs: string[] = [], months = false) => out.push({ key, group, label, arg, order, needs, months });
  for (const g of GROUPS) {
    if (g.id === "stand" || g.id === "own") continue;
    for (const c of CRITERIA.filter((x) => !x.position && groupOf(x) === g.id).sort((a, b) => (g.members.indexOf(a.id) + 1 || 99) - (g.members.indexOf(b.id) + 1 || 99)))
      add(g.label, `criterion:${c.id}`, c.label, { criterion: c.id }, LOWER_IS_BETTER.has(c.id) ? "asc" : "desc", NEEDS[c.id] ?? [], MONTHLY.has(c.id));
    if (g.id === "money") {
      add(g.label, "criterion:after_tax_rent", "Money after tax and rent", { criterion: "after_tax_rent" }, "desc", NEEDS.after_tax_rent);
      add(g.label, "metric:rent_1bed", "Rent, one bedroom", { metric: "rent_1bed" }, "asc");
    }
  }
  add("Overall", "score", "Your overall score", { score: true }, "desc");
  return out;
}
