// The kind of work a person does, and what "Work and ambition" weighs for it. With no kind chosen the group is what it
// always was (research output first). With a kind, two lines join it: what people in that kind of work earn there, and
// how many of the place's jobs are in its field; and the group's weight is shared over its parts by the kind's recipe,
// so a founder's group leans on young companies and developers, a nurse's on pay and jobs in health care.
// The kinds are the community figures' kinds of work (src/community/figures.ts OCCUPATIONS), less "Other work", plus
// founders, who earn no salary to compare. docs/work.md has the sources and what each figure counts. Browser-safe.
import type { Metric, Profile } from "./types.ts";

/**
 * The fields the job shares are counted in: the industry sections every labour-force survey publishes for a region.
 * Each scale runs from about the 10th to the 90th percentile of the 57 seed cities (November 2026 snapshot).
 */
export type Sector = "j" | "k" | "f" | "be" | "mn" | "oq" | "gi";

export const SECTORS: Record<Sector, { label: string; short: string; scale: [number, number] }> = {
  j: { label: "information and communication", short: "information and communication", scale: [25, 100] },
  k: { label: "finance and insurance", short: "finance", scale: [20, 70] },
  f: { label: "construction", short: "construction", scale: [35, 90] },
  be: { label: "industry: manufacturing, mining and utilities", short: "industry", scale: [50, 210] },
  mn: { label: "professional, scientific, technical and support services", short: "professional services", scale: [95, 175] },
  oq: { label: "public administration, education and health", short: "public services, education and health", scale: [200, 340] },
  gi: { label: "trade, transport, hotels and restaurants", short: "trade, transport and hospitality", scale: [190, 280] },
};

export interface WorkKind {
  id: string;
  label: string;
  /** Whether "Pay in your field" has a figure to read (`pay_<id>`): founders draw no comparable salary. */
  pay: boolean;
  /** The field its jobs are counted in, if one fits; office work and management are in every field. */
  sector?: Sector;
  /**
   * How the group's weight is shared over its parts for this kind: criterion id -> share, summing to 1. Parts not named
   * get none. The shares are a starting point; the person tunes any part afterwards.
   */
  recipe: Record<string, number>;
}

const local = { field_pay: 0.5, field_jobs: 0.3, jobs: 0.2 };

export const WORK_KINDS: WorkKind[] = [
  { id: "software", label: "Software and IT", pay: true, sector: "j", recipe: { field_pay: 0.35, field_jobs: 0.25, developers: 0.25, builders: 0.15 } },
  { id: "engineering", label: "Engineering, not software", pay: true, sector: "be", recipe: { field_pay: 0.35, field_jobs: 0.3, degrees: 0.15, builders: 0.2 } },
  { id: "science", label: "Research and science", pay: true, sector: "mn", recipe: { builders: 0.4, field_pay: 0.25, field_jobs: 0.2, degrees: 0.15 } },
  { id: "medicine", label: "Doctors and dentists", pay: true, sector: "oq", recipe: { field_pay: 0.55, field_jobs: 0.3, builders: 0.15 } },
  { id: "nursing", label: "Nursing and care", pay: true, sector: "oq", recipe: { field_pay: 0.6, field_jobs: 0.4 } },
  { id: "teaching", label: "Teaching and education", pay: true, sector: "oq", recipe: { field_pay: 0.55, field_jobs: 0.3, degrees: 0.15 } },
  { id: "finance", label: "Finance and accounting", pay: true, sector: "k", recipe: { field_pay: 0.45, field_jobs: 0.35, degrees: 0.2 } },
  { id: "law", label: "Law", pay: true, sector: "mn", recipe: { field_pay: 0.5, field_jobs: 0.3, degrees: 0.2 } },
  { id: "marketing", label: "Marketing, design and media", pay: true, sector: "mn", recipe: { field_pay: 0.4, field_jobs: 0.3, degrees: 0.2, young_companies: 0.1 } },
  { id: "office", label: "Office and administration", pay: true, recipe: { field_pay: 0.7, jobs: 0.3 } },
  { id: "sales", label: "Sales and retail", pay: true, sector: "gi", recipe: local },
  { id: "hospitality", label: "Hospitality and food", pay: true, sector: "gi", recipe: local },
  { id: "trades", label: "Construction and trades", pay: true, sector: "f", recipe: local },
  { id: "transport", label: "Transport and logistics", pay: true, sector: "gi", recipe: local },
  { id: "public", label: "Public sector", pay: true, sector: "oq", recipe: { field_pay: 0.6, field_jobs: 0.4 } },
  { id: "management", label: "Management", pay: true, recipe: { field_pay: 0.55, degrees: 0.2, young_companies: 0.25 } },
  { id: "founder", label: "Founding a company", pay: false, recipe: { young_companies: 0.35, developers: 0.25, degrees: 0.15, builders: 0.15, founders_run: 0.1 } },
];

export const WORK_BY_ID: Record<string, WorkKind> = Object.fromEntries(WORK_KINDS.map((k) => [k.id, k]));

/** The person's kind of work, if they chose one Borgo knows. */
export function kindOf(p: Profile): WorkKind | undefined {
  return p.work ? WORK_BY_ID[p.work] : undefined;
}

export const payMetric = (kind: string) => `pay_${kind}`;
export const jobsMetric = (s: Sector) => `jobs_${s}`;

/** "Software and IT" -> "software and IT", for the middle of a sentence. */
export const kindWords = (k: WorkKind) => (/^[A-Z][a-z]/.test(k.label) ? k.label[0]!.toLowerCase() + k.label.slice(1) : k.label);

const PAY_DESC = "Average gross pay a year of employees in this kind of work, before tax, from official earnings surveys (the metro area in the US, the region in the UK, Canada and Australia, the country elsewhere), each figure's note saying which occupations or industry it counts.";

/** The metrics the kinds read: one pay figure per kind (and all jobs), one jobs share per field. */
export const WORK_METRICS: Record<string, Metric> = {
  ...Object.fromEntries(
    [...WORK_KINDS.filter((k) => k.pay), { id: "all", label: "All jobs" }].map((k) => [
      payMetric(k.id),
      { id: payMetric(k.id), label: `Pay, ${k.id === "all" ? "all jobs" : kindWords(k as WorkKind)}`, unit: "/year", currency: "local", category: "opportunity", direction: "higher", shape: "scalar", description: PAY_DESC, decimals: 0, group: "ambition" } satisfies Metric,
    ]),
  ),
  ...Object.fromEntries(
    (Object.keys(SECTORS) as Sector[]).map((s) => [
      jobsMetric(s),
      { id: jobsMetric(s), label: `Jobs in ${SECTORS[s].short}`, unit: "per 1,000 jobs", category: "opportunity", direction: "higher", shape: "scalar", description: `How many of every 1,000 people in work there work in ${SECTORS[s].label}, from labour-force surveys by industry: the city in the US, the region around it in Europe, the province, state or country elsewhere.`, decimals: 0, group: "ambition" } satisfies Metric,
    ]),
  ),
  young_companies: { id: "young_companies", label: "Young companies nearby", unit: "companies within 50 km", category: "opportunity", direction: "higher", shape: "scalar", description: "Companies founded in 2010 or later whose headquarters is within 50 km of the centre, counting those Wikidata records with articles in at least two Wikipedias or other Wikimedia sites: a rough count of notable young companies, which follows how well each country's companies are written about.", decimals: 0, group: "ambition" },
};

/** The parts of Work and ambition, in their order (src/core/groups.ts reads this). */
export const AMBITION_MEMBERS = ["field_pay", "field_jobs", "builders", "degrees", "developers", "young_companies", "jobs", "internet", "coworking", "founders_run"];

/**
 * The profile with this kind of work (or none), its Work and ambition weight shared by the kind's recipe. The group
 * keeps the weight it had; with none yet, it takes `start` (the app's third priority starts there). Choosing no kind
 * shares the group's weight by the parts' default weights again, as before any kind was chosen. Pure: returns a copy.
 */
export function applyWork(p: Profile, kind: string | undefined, parts: { id: string; defaultWeight: number }[], weightOf: (p: Profile, id: string) => number, start = 0): Profile {
  const out: Profile = { ...p, weights: { ...p.weights } };
  const total = parts.reduce((t, c) => t + weightOf(p, c.id), 0) || start;
  const k = kind ? WORK_BY_ID[kind] : undefined;
  if (k) out.work = k.id;
  else delete out.work;
  const shares: Record<string, number> = k ? k.recipe : (() => {
    const d = parts.reduce((t, c) => t + Math.max(0, c.defaultWeight), 0);
    return Object.fromEntries(parts.map((c) => [c.id, d > 0 ? Math.max(0, c.defaultWeight) / d : 0]));
  })();
  for (const c of parts) out.weights[c.id] = Math.round(total * (shares[c.id] ?? 0) * 100) / 100;
  return out;
}
