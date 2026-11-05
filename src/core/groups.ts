// Values come in a few groups, so the list a person tunes is short: one dial per group, its parts inside. The engine
// still scores every part on its own weight; a group's weight is the sum of its parts' weights, and moving the group's
// dial shares the new weight over its parts in the proportions they had (tested in test/groups.test.ts).
import type { Criterion } from "./criteria.ts";
import type { Profile } from "./types.ts";

export type GroupId =
  | "money" | "right_to_live" | "climate" | "health" | "safety" | "children" | "people"
  | "ambition" | "getting_around" | "nature" | "stand" | "own";

export interface Group {
  id: GroupId;
  label: string;
  /** What the group answers, in plain words. */
  question: string;
  /** Its parts, in the order they are listed. A criterion not named here joins by its category (CATEGORY_GROUP). */
  members: string[];
  /** Shown only when this holds: the children's group appears once the household has children. */
  shows?: (p: Profile) => boolean;
  /** What the group will hold that no open source gives yet, said where its parts are listed. */
  pending?: string;
}

export const hasChildren = (p: Profile) => (p.children ?? []).length > 0;

export const GROUPS: Group[] = [
  { id: "money", label: "Money", question: "What you keep each month, and what a month costs.", members: ["money_left", "living_cost"] },
  { id: "right_to_live", label: "Right to live there", question: "Whether everyone moving with you can live and work there without a visa.", members: ["right_to_live"] },
  {
    id: "climate",
    label: "Climate",
    question: "How the weather feels through the year, by your own idea of a nice day.",
    members: ["nice_days", "sunshine", "winter_light", "dry_days", "beach", "run_ride", "muggy", "grey", "hot_nights", "heat", "snow", "wind"],
  },
  { id: "health", label: "Health", question: "How long and how healthily people live, the care around you, and the air.", members: ["long_life", "clean_air", "doctors", "health_costs"] },
  { id: "safety", label: "Safety", question: "How rare violent crime is.", members: ["safety"] },
  {
    id: "children",
    label: "Children",
    question: "What childcare costs and what parents are given.",
    members: ["childcare", "family_leave"],
    shows: hasChildren,
    pending: "Schools: no open source compares them across countries yet.",
  },
  { id: "people", label: "People and society", question: "How content people are, how open the place is, how clean its government.", members: ["happiness", "english", "international", "clean_government"] },
  { id: "ambition", label: "Work and ambition", question: "Jobs, research and ambitious people around you.", members: ["builders", "degrees", "developers", "jobs", "internet", "coworking", "founders_run"] },
  { id: "getting_around", label: "Getting around", question: "Getting about the city, and away from it.", members: ["walkable", "cycling", "active_commute", "way_out", "public_transport", "rail", "short_commute", "airport", "flight_home", "time_zone"] },
  { id: "nature", label: "Nature and leisure", question: "The sea, the mountains, green space and things to do.", members: ["sea", "mountains", "green", "climbing", "swimming"] },
  { id: "stand", label: "Where you stand", question: "How the place votes and what its law allows, scored by how close it is to you.", members: ["politics", "abortion", "couples_law"] },
  { id: "own", label: "Your own lines", question: "What no dataset knows, scored by you.", members: [] },
];

/** Where a criterion that no group names goes, by its category, so a new line lands somewhere sensible. */
const CATEGORY_GROUP: Record<Criterion["category"], GroupId> = {
  money: "money",
  housing: "money",
  access: "right_to_live",
  climate: "climate",
  environment: "nature",
  safety: "safety",
  health: "health",
  society: "people",
  opportunity: "ambition",
  mobility: "getting_around",
  lifestyle: "nature",
  personal: "own",
};

export function groupOf(c: Criterion): GroupId {
  if (c.category === "personal") return "own";
  if (c.position) return "stand";
  return GROUPS.find((g) => g.members.includes(c.id))?.id ?? CATEGORY_GROUP[c.category];
}

/** Each group with its criteria, in the group's order; groups with no criteria are kept (the person's own lines). */
export function grouped(criteria: Criterion[]): { group: Group; parts: Criterion[] }[] {
  return GROUPS.map((group) => {
    const parts = criteria.filter((c) => groupOf(c) === group.id);
    const rank = (c: Criterion) => {
      const i = group.members.indexOf(c.id);
      return i === -1 ? group.members.length : i;
    };
    return { group, parts: parts.sort((a, b) => rank(a) - rank(b)) };
  });
}

/**
 * New weights for a group's parts when the group's dial moves to `total`. Parts keep their proportions; when every
 * part is at 0, the new weight is shared by their default weights, or equally when those are 0 too. A part that does
 * not apply to the person (`applies: false`: a position line with no stance, childcare without a young child) never
 * takes weight; when none applies, every part stays at 0. The parts add up to exactly `total`, in hundredths (the
 * precision weights are kept at), each rounded by largest remainder.
 */
export function splitGroupWeight(parts: { id: string; weight: number; defaultWeight: number; applies?: boolean }[], total: number): Record<string, number> {
  const t = Math.round(Math.max(0, Number.isFinite(total) ? total : 0) * 100);
  if (!parts.length) return {};
  const live = parts.filter((p) => p.applies !== false);
  const share = (p: { weight: number }) => Math.max(0, p.weight);
  const sum = live.reduce((s, p) => s + share(p), 0);
  const defaults = live.reduce((s, p) => s + Math.max(0, p.defaultWeight), 0);
  const basis = (p: (typeof parts)[number]) =>
    p.applies === false ? 0 : sum > 0 ? share(p) / sum : defaults > 0 ? Math.max(0, p.defaultWeight) / defaults : 1 / live.length;
  const exact = parts.map((p) => (live.length ? t * basis(p) : 0));
  const out = exact.map(Math.floor);
  let left = live.length ? t - out.reduce((a, b) => a + b, 0) : 0;
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).filter(({ i }) => parts[i]!.applies !== false).sort((a, b) => b.r - a.r || exact[b.i]! - exact[a.i]!);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return Object.fromEntries(parts.map((p, i) => [p.id, out[i]! / 100]));
}
