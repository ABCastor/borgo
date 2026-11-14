// A quality-of-life index: one generic number per place, from Borgo's own sourced lines, with the same fixed weights
// for everyone. It is a second view beside the person's own ranking, never instead of it: the ranking weighs what they
// say matters, this index weighs what it says here. Each part is scored on its line's fixed scale (src/core/criteria.ts)
// for a generic person: a single full-time employee on the place's average pay, with today's nice day (dry, mostly clear,
// 18 to 30 °C feels like). A part with no figure is left out and the rest share its weight; under 60% of the weight
// with figures, there is no index. Browser-safe; the criteria are read at call time (criteria.ts imports this file).
import { CRITERIA, DEFAULT_COMFORT, type Criterion } from "./criteria.ts";
import { resolve, scalar } from "./lookup.ts";
import { convert, money } from "./money.ts";
import type { City, Dataset, Profile } from "./types.ts";
import { payMetric } from "./work.ts";

export interface QolPart {
  id: string;
  label: string;
  /** Share of the index, in points out of 100. */
  weight: number;
  /** What the part reads, in plain words. */
  says: string;
}

/** The parts and their weights: money and the basics of a healthy, safe, pleasant life first. */
export const QOL_PARTS: QolPart[] = [
  { id: "pay_prices", label: "Take-home pay against prices", weight: 20, says: "what a single full-time employee on the place's average pay takes home after tax, divided by the country's price level" },
  { id: "nice_days", label: "Nice days", weight: 15, says: "days a year that are dry, mostly clear and feel 18 to 30 °C" },
  { id: "clean_air", label: "Clean air", weight: 15, says: "fine dust (PM2.5) in the air over a year" },
  { id: "safety", label: "Safety", weight: 15, says: "homicides per 100,000 people a year" },
  { id: "long_life", label: "Long lives", weight: 10, says: "life expectancy at birth" },
  { id: "happiness", label: "Happiness", weight: 10, says: "how people rate their own lives, 0 to 10" },
  { id: "clean_government", label: "Clean government", weight: 10, says: "how well corruption is kept out of public life" },
  { id: "doctors", label: "Doctors", weight: 5, says: "doctors per 1,000 people" },
];

/** Below this share of the weight with figures, a place gets no index. */
export const QOL_MIN_COVERAGE = 0.6;
/** Take-home pay in euros at US price levels a year: the worst and best ends of the money part. */
const PAY_SCALE: [number, number] = [12_000, 60_000];

export interface QolResult {
  /** 0 to 100, or null when under QOL_MIN_COVERAGE of the weight has figures. */
  score: number | null;
  /** Share of the weight with figures, 0 to 1. */
  coverage: number;
  parts: { id: string; label: string; weight: number; score: number | null; text: string }[];
}

/** The generic person the index is for: nobody's own numbers, today's nice day, the place's average pay. */
function generic(city: City, pay: { gross: number; currency: string } | null): Profile {
  return {
    name: "",
    displayCurrency: "EUR",
    cities: [city.id],
    household: [],
    housing: { size: "1bed" },
    income: { mode: "per-city", gross: 0, currency: "EUR", perCity: pay ? { [city.id]: pay } : {}, taxTweaks: {}, everyday: null, savings: 0 },
    weights: {},
    personal: [],
    prefs: { comfort: { ...DEFAULT_COMFORT }, normalise: "absolute", missing: "lowest" },
    overrides: {},
    dealBreakers: [],
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const eur = (n: number) => `€${Math.round(n).toLocaleString("en-GB")}`;

/** The take-home pay part: average pay through Borgo's tax model for a single employee, over the price level. */
function payAgainstPrices(data: Dataset, city: City): { value: number | null; text: string } {
  const empty = generic(city, null);
  const local = data.countries[city.country]?.currency ?? "EUR";
  const gross = scalar(resolve(data, empty, city, payMetric("all")));
  const level = scalar(resolve(data, empty, city, "price_level"));
  if (gross === null) return { value: null, text: "no average pay figure" };
  if (level === null) return { value: null, text: "no price level" };
  const m = money(data, generic(city, { gross, currency: local }), city);
  const usable = m.taxCompleteness.status === "complete" || m.taxCompleteness.status === "approximate";
  const net = usable ? m.display.net : null;
  if (net === null) return { value: null, text: "no complete tax model here" };
  const atUsPrices = net / (level / 100);
  const grossEur = convert(data, gross, local, "EUR");
  return { value: atUsPrices, text: `${eur(net)} take-home a year${grossEur === null ? "" : ` from ${eur(grossEur)} gross`}, worth ${eur(atUsPrices)} at US prices` };
}

/** The index for one place. The person's own numbers never enter it: it is the same for everyone. */
export function qualityOfLife(data: Dataset, city: City, criteria: Criterion[] = CRITERIA): QolResult {
  const profile = generic(city, null);
  const parts = QOL_PARTS.map((p) => {
    if (p.id === "pay_prices") {
      const r = payAgainstPrices(data, city);
      return { id: p.id, label: p.label, weight: p.weight, score: r.value === null ? null : clamp01((r.value - PAY_SCALE[0]) / (PAY_SCALE[1] - PAY_SCALE[0])), text: r.text };
    }
    const c = criteria.find((x) => x.id === p.id)!;
    const raw = c.raw({ data, profile, city, money: null as never, rights: [] });
    const [worst, best] = c.scale(profile, data);
    const score = raw.value === null ? null : best === worst ? 1 : clamp01((raw.value - worst) / (best - worst));
    return { id: p.id, label: p.label, weight: p.weight, score, text: raw.text };
  });
  const have = parts.filter((p) => p.score !== null);
  const w = have.reduce((t, p) => t + p.weight, 0);
  const total = QOL_PARTS.reduce((t, p) => t + p.weight, 0);
  const coverage = w / total;
  const score = coverage >= QOL_MIN_COVERAGE && w > 0 ? (100 * have.reduce((t, p) => t + p.weight * p.score!, 0)) / w : null;
  return { score, coverage, parts };
}
