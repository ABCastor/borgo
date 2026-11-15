// What a rent figure covers, in plain words beside it. Official rents measure different things (docs/data-sources.md,
// "Rent: what each source measures"): some count only new lets or asking rents, which is what someone moving in pays;
// others count every tenancy, however long ago it began, which sits below that wherever rents have risen. A figure of
// the second kind says so wherever it is shown, so a comparison against a new-let rent elsewhere reads honestly.
import type { Dataset } from "./types.ts";

export const ALL_TENANCIES = "all tenancies; newcomers usually pay more";

export const isRent = (metric: string) => metric === "rent_1bed" || metric === "rent_3bed";

/** The words to show beside a rent figure from these sources, or null when they count new lets only (or it is no rent). */
export function rentBasis(data: Pick<Dataset, "sources">, metric: string, sources: (string | undefined)[]): string | null {
  if (!isRent(metric)) return null;
  return sources.some((id) => id && data.sources[id]?.tenancies === "all") ? ALL_TENANCIES : null;
}
