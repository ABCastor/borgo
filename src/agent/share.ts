// The part of a profile a Borgo link carries when the MCP App opens cities on the site: what the ranking was scored by,
// never the person's pay, passports, spending, household or own numbers (the same default as the site's share panel,
// src/ui/state.ts sharedProfile with nothing private included). The fragment stays in the browser, but a chat is a place
// to be careful: nothing here identifies anyone.
import { CRITERIA } from "../core/criteria.ts";
import type { Dataset, Profile } from "../core/types.ts";
import { buildProfile, type QueryArgs } from "./profile.ts";

export type SharedProfile = Pick<Profile, "displayCurrency" | "housing" | "weights" | "dealBreakers" | "prefs"> & { work?: string };

/** `sharedProfile(profile, [])` of the site, without the cities (the view adds the ones the person picks). */
export function sharedPart(p: Profile): SharedProfile {
  const positions = new Set(CRITERIA.filter((c) => c.position).map((c) => c.id));
  const personal = new Set(p.personal.map((l) => l.id));
  const keep = (id: string) => !positions.has(id) && !personal.has(id);
  return {
    displayCurrency: p.displayCurrency,
    housing: { ...p.housing },
    weights: Object.fromEntries(Object.entries(p.weights).filter(([id]) => keep(id))),
    dealBreakers: p.dealBreakers.filter(keep),
    prefs: { ...p.prefs, comfort: { ...p.prefs.comfort } },
    ...(p.work ? { work: p.work } : {}),
  };
}

/** The shared part of the profile the arguments of a compare or rank call describe. */
export function shareFor(data: Dataset, args: Omit<QueryArgs, "cities"> & { cities?: string[] }): SharedProfile {
  const first = args.cities?.[0] ?? data.cities[0]!.id;
  return sharedPart(buildProfile(data, { ...args, cities: [first] }).profile);
}
