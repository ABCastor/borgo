// Shared by the rent sources. Where a source publishes rent per square metre, a monthly rent is that rate times a
// fixed flat size, the same for every such source so their figures compare: a one-bedroom home is 50 m², a
// three-bedroom home 90 m². Each such figure's note gives the rate and the size used.
export const FLAT_M2 = { rent_1bed: 50, rent_3bed: 90 } as const;

export type RentMetric = keyof typeof FLAT_M2;

/** A monthly rent from a monthly rate per m², rounded to the unit. */
export const fromPerM2 = (perM2: number, metric: RentMetric) => Math.round(perM2 * FLAT_M2[metric]);

/** Weekly rent to monthly: 52 weeks over 12 months. */
export const weeklyToMonthly = (weekly: number) => Math.round((weekly * 52) / 12);
