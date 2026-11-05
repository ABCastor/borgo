import { CRITERIA } from "./criteria.ts";

/**
 * Starting weights a person can pick and then change. None of them is "the" right answer. Cost of living is left at 0:
 * money left already counts every cost (and is scored on cost alone when no salary is given), so weighting both would
 * count a cheap rent twice.
 */
export interface Preset {
  id: string;
  label: string;
  weights: Record<string, number>;
}

export const PRESETS: Preset[] = [
  { id: "balanced", label: "Balanced", weights: Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight])) },
  {
    id: "founder",
    label: "Founder",
    weights: { money_left: 30, right_to_live: 15, builders: 15, degrees: 6, developers: 6, nice_days: 4, winter_light: 2, sunshine: 2, dry_days: 1, clean_air: 6, safety: 4, long_life: 3, happiness: 6 },
  },
  {
    id: "family",
    label: "Family",
    weights: { money_left: 30, right_to_live: 15, builders: 2, nice_days: 6, winter_light: 3, sunshine: 3, dry_days: 2, clean_air: 12, safety: 14, long_life: 8, happiness: 8 },
  },
  {
    id: "saver",
    label: "Saving money",
    weights: { money_left: 55, right_to_live: 15, builders: 3, nice_days: 4, winter_light: 2, sunshine: 2, dry_days: 1, clean_air: 5, safety: 5, long_life: 2, happiness: 3 },
  },
];
