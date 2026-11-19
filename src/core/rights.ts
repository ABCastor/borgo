import { ENTRY_LABEL, ENTRY_POINTS, selectedEntryRoute, type EntryLevel } from "./entry-routes.ts";
import type { Dataset, Iso2, Permit, PermitKind, Person } from "./types.ts";

/** "yes": a right through citizenship, free movement or a permit the person holds; "no": none applies; "unknown": nothing given to check. */
export type RightStatus = "yes" | "no" | "unknown";

export interface RightResult {
  person: string;
  entryLevel?: EntryLevel;
  entryScore?: number | null;
  entryEvidence?: { route: string; source: string; url: string; period: string; retrieved: string; licence: string; licenceUrl: string; level: "country"; country: string };
  /** True only when the right is established (status "yes"). */
  allowed: boolean;
  status: RightStatus;
  /** Why: "citizen", the free-movement area that grants it, or the permit ("permanent residence"). Empty otherwise. */
  via: string;
  /** What it means, in one plain sentence a person can act on. */
  text: string;
  /** The rules that were checked, with where they are written. */
  sources: { name: string; url: string }[];
  /** The last day the right that grants it is valid, when it is a permit with an end date. */
  until?: string;
}

/** Every kind of right that is not citizenship, as people name it, with an example of each. */
export const PERMIT_KINDS: Record<PermitKind, { label: string; noun: string; example: string }> = {
  permanent: { label: "Permanent residence", noun: "permanent residence", example: "a green card, Niederlassungserlaubnis, EU long-term residence, indefinite leave to remain" },
  settled: { label: "Settled status", noun: "settled status", example: "the UK's EU Settlement Scheme" },
  residence: { label: "Residence permit", noun: "a residence permit", example: "a residence card as a family member, a permit for self-employment" },
  work: { label: "Work visa or permit", noun: "a work visa", example: "an H-1B, a Skilled Worker visa, a Critical Skills permit" },
  "blue-card": { label: "EU Blue Card", noun: "an EU Blue Card", example: "the EU's permit for highly qualified work" },
  other: { label: "Other right to live and work", noun: "a right to live and work", example: "a treaty right, a youth mobility visa" },
};

export const PERMIT_KIND_IDS = Object.keys(PERMIT_KINDS) as PermitKind[];

const today = () => new Date().toISOString().slice(0, 10);

/** The countries a permit covers: its country, or every country of the free-movement area it names. */
export function permitTerritory(data: Dataset, p: Permit): Iso2[] {
  const area = (data.rights ?? []).find((a) => a.id === p.where);
  return area ? area.territory : [p.where.toUpperCase()];
}

/** Problems with a permit as given, in plain words; none when it can be checked. */
export function permitProblems(data: Dataset, p: Permit, where = "permit"): string[] {
  const out: string[] = [];
  if (!PERMIT_KINDS[p.kind]) out.push(`${where}.kind must be one of ${PERMIT_KIND_IDS.join(", ")}`);
  const area = (data.rights ?? []).some((a) => a.id === p.where);
  if (!area && !(typeof p.where === "string" && /^[A-Za-z]{2}$/.test(p.where))) out.push(`${where}.where must be a country code (ISO alpha-2, such as DE) or a free-movement area (${[...new Set((data.rights ?? []).map((a) => a.id))].join(", ")})`);
  if (p.until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.until)) out.push(`${where}.until must be a date, YYYY-MM-DD`);
  return out;
}

const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * Can this person live and work in `country` without applying for a visa or permit? Checked: their citizenships, the
 * free-movement areas in the dataset, and the rights they say they hold that are not citizenship (permanent residence,
 * a residence or work permit, an EU Blue Card, settled status). A permit counts until its end date; one that ended, or
 * that bars work, does not. Someone with nothing given is not checked at all. `on` is the day it is judged for.
 */
export function rightToLiveWork(data: Dataset, person: Person, country: Iso2, on = today()): RightResult {
  const place = data.countries[country]?.name ?? country;
  const cite = (sourceId: string, name: string) => {
    const s = data.sources?.[sourceId];
    return { name: s?.name ?? name, url: s?.url ?? "" };
  };
  const areas = (data.rights ?? []).filter((a) => a.territory.includes(country));
  const permits = (person.permits ?? []).filter((p) => PERMIT_KINDS[p.kind] && permitTerritory(data, p).includes(country));
  const whose = person.label === "You" ? "your" : `${person.label}'s`;
  if (!person.citizenships.length && !(person.permits ?? []).length)
    return { person: person.label, allowed: false, status: "unknown", via: "", text: `Not checked: add ${whose} passports or other rights to live and work.`, sources: [] };
  if (person.citizenships.includes(country)) return { person: person.label, allowed: true, status: "yes", via: "citizen", text: `Can live and work in ${place} as a citizen.`, sources: [] };
  for (const area of areas) {
    if (person.citizenships.some((c) => area.members.includes(c)))
      return { person: person.label, allowed: true, status: "yes", via: area.name, text: `Can live and work in ${place} through ${area.name}${area.note ? ` (${area.note})` : ""}.`, sources: [cite(area.source, area.name)] };
  }
  // A right the person holds: one without an end beats one that ends; among those that end, the latest.
  const valid = permits.filter((p) => p.work !== false && (!p.until || p.until >= on)).sort((a, b) => (a.until ? 1 : 0) - (b.until ? 1 : 0) || (b.until ?? "").localeCompare(a.until ?? ""));
  const best = valid[0];
  if (best) {
    const k = PERMIT_KINDS[best.kind];
    const scope = best.where.length > 2 ? ` (held across ${(data.rights ?? []).find((a) => a.id === best.where)?.name ?? best.where})` : "";
    return {
      person: person.label,
      allowed: true,
      status: "yes",
      via: best.until ? `${k.noun.replace(/^an? /, "")} until ${longDate(best.until)}` : k.noun.replace(/^an? /, ""),
      text: best.until
        ? `Can live and work in ${place} with ${k.noun}${scope}, valid until ${longDate(best.until)}; whether it can be renewed is not checked.`
        : `Can live and work in ${place} with ${k.noun}${scope}.`,
      sources: [],
      ...(best.until ? { until: best.until } : {}),
    };
  }
  // Nothing grants it: say which rights were looked at and why each does not count.
  const ended = permits.filter((p) => p.until && p.until < on);
  const noWork = permits.filter((p) => p.work === false && (!p.until || p.until >= on));
  if (!person.citizenships.length && !ended.length && !noWork.length)
    return { person: person.label, allowed: false, status: "unknown", via: "", text: `Not checked for ${place}: no right given covers it; add ${whose} passports.`, sources: [] };
  const checked = areas.map((a) => a.name);
  const why = [
    person.citizenships.length
      ? `${person.citizenships.join(", ")} ${person.citizenships.length > 1 ? "passports give" : "passport gives"} neither citizenship${checked.length ? ` nor ${[...new Set(checked)].join(" or ")}` : " nor any free-movement area covering it"}`
      : "",
    ...ended.map((p) => `${PERMIT_KINDS[p.kind].noun} there ended on ${longDate(p.until!)}`),
    ...noWork.map((p) => `${PERMIT_KINDS[p.kind].noun} there does not allow work`),
  ].filter(Boolean);
  return {
    person: person.label,
    allowed: false,
    status: "no",
    via: "",
    text: `No automatic right to live and work in ${place}: ${why.join("; ")}. Living there needs a residence and work permit from ${place}.`,
    sources: [...new Map(areas.map((a) => [a.source, cite(a.source, a.name)])).values()],
  };
}

export function householdRights(data: Dataset, household: Person[], country: Iso2, on?: string): RightResult[] {
  return household.map((p) => {
    const right = rightToLiveWork(data, p, country, on);
    const route = selectedEntryRoute(p, country);
    const level: EntryLevel = right.allowed ? "already" : route ? route.level : "not-checked";
    return {
      ...right, entryLevel: level, entryScore: ENTRY_POINTS[level],
      ...(route && !right.allowed ? { entryEvidence: { route: route.id, source: route.source, url: route.url, period: route.period, retrieved: route.read, licence: route.licence, licenceUrl: route.licenceUrl, level: "country" as const, country } } : {}),
      text: `${right.text}${route && !right.allowed ? ` Entry difficulty: ${ENTRY_LABEL[level]}. ${route.label}: ${route.fact} Assumes you confirm: ${route.conditions}. Rough guide, not legal advice (${route.period}).` : !right.allowed && right.status !== "unknown" ? " Entry difficulty: not checked; no applicable route is confirmed." : ""}`,
      sources: [...right.sources, ...(route && !right.allowed ? [{ name: `${route.source} · ${route.period} · ${route.licence}`, url: route.url }] : [])],
    };
  });
}

/** Whether anything is given for this person to check: a passport or another right. */
export const hasRightsGiven = (p: Person) => p.citizenships.length > 0 || (p.permits?.length ?? 0) > 0;

/** Rights read from a share link or an old saved profile, kept only when well formed: a link is untrusted input. */
export function cleanPermits(list: unknown): Permit[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is Permit => !!x && typeof x === "object" && (x as Permit).kind in PERMIT_KINDS && typeof (x as Permit).where === "string" && (x as Permit).where.length <= 12)
    .map((x) => ({ kind: x.kind, where: x.where, ...(typeof x.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.until) ? { until: x.until } : {}), ...(x.work === false ? { work: false } : {}) }))
    .slice(0, 12);
}
