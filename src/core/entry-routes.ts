import type { Person } from "./types.ts";

export type EntryLevel = "already" | "straightforward" | "demanding" | "very-hard" | "not-checked";
export const ENTRY_POINTS: Record<EntryLevel, number | null> = { already: 1, straightforward: 0.75, demanding: 0.4, "very-hard": 0.1, "not-checked": null };
export const ENTRY_LABEL: Record<EntryLevel, string> = { already: "Already allowed", straightforward: "Straightforward route", demanding: "Demanding route", "very-hard": "Very hard", "not-checked": "Not checked" };

/** A curated interpretation of official procedural requirements, not a prediction of approval.
 * Only short factual summaries are encoded, not copied page text. Difficulty is Borgo's judgement.
 * Sources cover these routes, not every immigration route in a country.
 */
export const ENTRY_ROUTES = [
  { id: "gb-ancestry", country: "GB", label: "UK Ancestry", level: "straightforward", conditions: "Commonwealth citizen, 17 or older, eligible UK-born grandparent, able and planning to work, and able to support yourself", fact: "No employer sponsorship or annual lottery; ancestry and maintenance evidence are required.", source: "UK Home Office", url: "https://www.gov.uk/ancestry-visa", period: "2026-11", read: "2026-11-19", licence: "OGL-UK-3.0", licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
  { id: "gb-skilled", country: "GB", label: "Skilled Worker", level: "demanding", conditions: "Eligible job offer from an approved sponsor, applicable salary threshold and English requirement", fact: "An approved employer sponsors an eligible job; salary and English conditions apply.", source: "UK Home Office", url: "https://www.gov.uk/skilled-worker-visa", period: "2026-11", read: "2026-11-19", licence: "OGL-UK-3.0", licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
  { id: "us-h1b", country: "US", label: "Cap-subject H-1B", level: "very-hard", conditions: "Sponsoring employer and qualifying specialty occupation and qualification; cap-subject petition", fact: "Employer petition plus annual numerical limits and selection when registrations exceed the limit. Cap-exempt employment is different and is not covered here.", source: "US Citizenship and Immigration Services", url: "https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations", period: "2026-11", read: "2026-11-19", licence: "PD-USGov", licenceUrl: "https://www.uscis.gov/website-policies" },
] as const;

export function selectedEntryRoute(person: Person, country: string) {
  return ENTRY_ROUTES.find((r) => r.country === country && r.id === person.entryRoutes?.[country]);
}

/** Saved links are untrusted; a route must belong to the named country. */
export function cleanEntryRoutes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([cc, id]) => ENTRY_ROUTES.some((r) => r.country === cc && r.id === id)));
}
