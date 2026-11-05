import type { Dataset, Iso2, Person } from "./types.ts";

/** "yes": a right through citizenship or free movement; "no": neither applies; "unknown": no passport given. */
export type RightStatus = "yes" | "no" | "unknown";

export interface RightResult {
  person: string;
  /** True only when the right is established (status "yes"). */
  allowed: boolean;
  status: RightStatus;
  /** Why: "citizen", or the free-movement area that grants it. Empty otherwise. */
  via: string;
  /** What it means, in one plain sentence a person can act on. */
  text: string;
  /** The rules that were checked, with where they are written. */
  sources: { name: string; url: string }[];
}

/**
 * Can this person live and work in `country` without applying for a visa or permit? Only citizenship and the
 * free-movement areas in the dataset are checked; a person with no passport given is not checked at all.
 */
export function rightToLiveWork(data: Dataset, person: Person, country: Iso2): RightResult {
  const place = data.countries[country]?.name ?? country;
  const cite = (sourceId: string, name: string) => {
    const s = data.sources?.[sourceId];
    return { name: s?.name ?? name, url: s?.url ?? "" };
  };
  const areas = (data.rights ?? []).filter((a) => a.territory.includes(country));
  if (!person.citizenships.length)
    return { person: person.label, allowed: false, status: "unknown", via: "", text: `Not checked: add ${person.label === "You" ? "your" : `${person.label}'s`} passports.`, sources: [] };
  if (person.citizenships.includes(country)) return { person: person.label, allowed: true, status: "yes", via: "citizen", text: `Can live and work in ${place} as a citizen.`, sources: [] };
  for (const area of areas) {
    if (person.citizenships.some((c) => area.members.includes(c)))
      return { person: person.label, allowed: true, status: "yes", via: area.name, text: `Can live and work in ${place} through ${area.name}${area.note ? ` (${area.note})` : ""}.`, sources: [cite(area.source, area.name)] };
  }
  const checked = areas.map((a) => a.name);
  return {
    person: person.label,
    allowed: false,
    status: "no",
    via: "",
    text: `No automatic right to live and work in ${place}: ${person.citizenships.join(", ")} ${person.citizenships.length > 1 ? "passports give" : "passport gives"} neither citizenship${checked.length ? ` nor ${[...new Set(checked)].join(" or ")}` : " nor any free-movement area covering it"}. Living there needs a residence and work permit from ${place}; Borgo does not model permits.`,
    sources: [...new Map(areas.map((a) => [a.source, cite(a.source, a.name)])).values()],
  };
}

export function householdRights(data: Dataset, household: Person[], country: Iso2): RightResult[] {
  return household.map((p) => rightToLiveWork(data, p, country));
}
