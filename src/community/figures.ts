// Figures people add themselves: what they pay in rent and for everyday things, what they take home, and how living
// in a place feels to them. This module is the whole contract, shared by the Worker that stores entries, the site and
// app that show them, and the CLI and MCP server that send them: what may be sent, the bounds that refuse it at the
// door, the automated review that decides what is shown, and the open dataset's rows.
//
// Review runs when figures are read, never stored as a verdict: every entry of a city and figure is judged against the
// others each time, so an entry held as unusual is shown once later entries agree with it, and a burst that was held
// is judged like the rest once it is two days old.

export type FigureKind = "rent" | "price" | "salary" | "rating";

export interface FigureDef {
  id: string;
  kind: FigureKind;
  label: string;
  /** What one entry is, in words for the form and the dataset. */
  unit: string;
  /** Plausible range in euros (converted to the place's currency); a rating is 1 to 5 whatever the currency. */
  min: number;
  max: number;
  /** The official metric the same thing is measured by, shown beside it and used in review. */
  official?: string;
}

export const BEDROOMS = [
  { id: "0", label: "Studio" },
  { id: "1", label: "1 bedroom" },
  { id: "2", label: "2 bedrooms" },
  { id: "3", label: "3 or more bedrooms" },
] as const;
export const AREAS = [
  { id: "centre", label: "in the centre" },
  { id: "outside", label: "outside the centre" },
] as const;
export const PRICES = [
  { id: "meal", label: "Meal at an inexpensive restaurant", unit: "one meal", min: 1, max: 150 },
  { id: "cappuccino", label: "Cappuccino in a café", unit: "one cup", min: 0.3, max: 15 },
  { id: "milk", label: "Milk, 1 litre", unit: "1 litre", min: 0.2, max: 8 },
  { id: "transit", label: "Monthly public transport pass", unit: "a month", min: 0, max: 500, official: "transit_pass" },
  { id: "gym", label: "Gym membership", unit: "a month", min: 3, max: 400 },
  { id: "internet", label: "Home internet", unit: "a month", min: 3, max: 300 },
] as const;
export const OCCUPATIONS = [
  { id: "software", label: "Software and IT" },
  { id: "engineering", label: "Engineering, not software" },
  { id: "science", label: "Research and science" },
  { id: "medicine", label: "Doctors and dentists" },
  { id: "nursing", label: "Nursing and care" },
  { id: "teaching", label: "Teaching and education" },
  { id: "finance", label: "Finance and accounting" },
  { id: "law", label: "Law" },
  { id: "marketing", label: "Marketing, design and media" },
  { id: "office", label: "Office and administration" },
  { id: "sales", label: "Sales and retail" },
  { id: "hospitality", label: "Hospitality and food" },
  { id: "trades", label: "Construction and trades" },
  { id: "transport", label: "Transport and logistics" },
  { id: "public", label: "Public sector" },
  { id: "management", label: "Management" },
  { id: "other", label: "Other work" },
] as const;

/** "Software and IT" -> "software and IT": lower case for the middle of a sentence, keeping acronyms. */
export const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

export const FIGURES: FigureDef[] = [
  ...BEDROOMS.flatMap((b) =>
    AREAS.map((a) => ({
      id: `rent.${b.id}.${a.id}`,
      kind: "rent" as const,
      label: `Rent, ${b.label.toLowerCase()} ${a.label}`,
      unit: "a month",
      min: 50,
      max: 20_000,
      official: b.id === "1" ? "rent_1bed" : b.id === "3" ? "rent_3bed" : undefined,
    })),
  ),
  ...PRICES.map((p) => ({ id: `price.${p.id}`, kind: "price" as const, label: p.label, unit: p.unit, min: p.min, max: p.max, official: "official" in p ? p.official : undefined })),
  ...OCCUPATIONS.map((o) => ({ id: `salary.${o.id}`, kind: "salary" as const, label: `Take-home pay, ${lowerFirst(o.label)}`, unit: "a month, after tax", min: 100, max: 100_000 })),
  { id: "rating.overall", kind: "rating", label: "Living here, all things considered", unit: "1 to 5", min: 1, max: 5 },
];
export const FIGURE_BY_ID: Record<string, FigureDef> = Object.fromEntries(FIGURES.map((f) => [f.id, f]));

/** The places that take figures, the euro rates that turn bounds into their currencies, and official figures to compare. */
export interface PlacesMeta {
  /** id -> [name, country ISO alpha-2, currency] */
  places: Record<string, [string, string, string]>;
  /** Units of each currency per euro. */
  fx: Record<string, number>;
  /** id -> official metric -> value in the place's currency, with its source's short name and period. */
  official: Record<string, Record<string, { value: number; source: string; period: string }>>;
}

export const LIMITS = {
  /** Largest request body the endpoint reads. */
  bodyBytes: 4096,
  /** Submissions one network may send a day, in all. */
  perNetworkDay: 12,
  /** Submissions one network may send a day for one place. */
  perNetworkPlaceDay: 3,
} as const;

export const LICENCE = { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/", credit: "Borgo contributors" } as const;

export type Via = "web" | "app" | "cli" | "mcp" | "api";
const VIAS: Via[] = ["web", "app", "cli", "mcp", "api"];

/** What a person sends: one place, at most one rent, any of the prices, at most one pay, at most one rating. */
export interface Submission {
  city: string;
  rent?: { amount: number; bedrooms: string; area: string };
  prices?: Partial<Record<(typeof PRICES)[number]["id"], number>>;
  salary?: { amount: number; occupation: string };
  rating?: number;
  /** The person agrees to publish it under CC BY 4.0 and says it is their own figure. */
  consent: boolean;
  /** Amounts' currency; must be the place's own. Left out means the place's own. */
  currency?: string;
  via?: Via;
}

export interface Parsed {
  city: string;
  currency: string;
  via: Via;
  figures: { figure: string; value: number }[];
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[\s,]/g, (m) => (m === "," ? "." : "")));
  return Number.isFinite(n) ? n : NaN;
};

/** A submission from the web form (application/x-www-form-urlencoded) in the same shape as the JSON one. */
export function fromForm(f: URLSearchParams): Submission & { honeypot: string } {
  const prices: Record<string, unknown> = {};
  for (const p of PRICES) if (f.get(`price_${p.id}`)) prices[p.id] = f.get(`price_${p.id}`);
  return {
    city: f.get("city") ?? "",
    rent: f.get("rent") ? { amount: f.get("rent") as unknown as number, bedrooms: f.get("bedrooms") ?? "", area: f.get("area") ?? "" } : undefined,
    prices: Object.keys(prices).length ? (prices as Submission["prices"]) : undefined,
    salary: f.get("salary") ? { amount: f.get("salary") as unknown as number, occupation: f.get("occupation") ?? "" } : undefined,
    rating: f.get("rating") ? (f.get("rating") as unknown as number) : undefined,
    consent: f.get("consent") === "on" || f.get("consent") === "yes" || f.get("consent") === "true",
    via: "web",
    honeypot: f.get("website") ?? "",
  };
}

/** Check a submission against the contract and the place's currency; problems are sentences a person can act on. */
export function parseSubmission(input: unknown, meta: PlacesMeta): { ok: true; value: Parsed } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, problems: ["Send one JSON object."] };
  const s = input as Record<string, unknown>;
  const known = new Set(["city", "rent", "prices", "salary", "rating", "consent", "currency", "via", "honeypot"]);
  for (const k of Object.keys(s)) if (!known.has(k)) problems.push(`Unknown field "${k}": only city, rent, prices, salary, rating, consent, currency and via are taken.`);
  const city = typeof s.city === "string" ? s.city.trim().toLowerCase() : "";
  const place = meta.places[city];
  if (!place) return { ok: false, problems: [city ? `No place "${city}" takes community figures: use a city id from the site or borgo search, such as turin-it.` : "Say which place: city, such as turin-it."] };
  const currency = place[2];
  if (s.currency !== undefined && String(s.currency).toUpperCase() !== currency) problems.push(`Amounts for ${place[0]} are in ${currency}, its own currency; convert yours to ${currency} first.`);
  if (s.consent !== true) problems.push("Tick the box that these are your own figures and that you publish them openly under CC BY 4.0 (in the API: consent true).");
  const via = VIAS.includes(s.via as Via) ? (s.via as Via) : "api";
  const perEuro = currency === "EUR" ? 1 : meta.fx[currency];
  const figures: Parsed["figures"] = [];
  const add = (id: string, raw: unknown, what: string) => {
    const def = FIGURE_BY_ID[id]!;
    const v = num(raw);
    if (v === undefined) return;
    if (!Number.isFinite(v)) return problems.push(`${what}: give a number.`);
    if (def.kind === "rating") {
      if (!Number.isInteger(v) || v < 1 || v > 5) return problems.push(`${what}: a whole number from 1 to 5.`);
    } else if (v < 0) return problems.push(`${what}: cannot be negative.`);
    else if (perEuro) {
      const lo = def.min * perEuro;
      const hi = def.max * perEuro;
      if (v < lo || v > hi) return problems.push(`${what}: ${fmt(v)} ${currency} is outside what is plausible (${fmt(lo)} to ${fmt(hi)} ${currency} ${def.unit}).`);
    } else if (v > 1e10) return problems.push(`${what}: ${fmt(v)} is not plausible.`);
    figures.push({ figure: id, value: v });
  };
  if (s.rent !== undefined) {
    const r = s.rent as Record<string, unknown> | null;
    const b = String(r?.bedrooms ?? "");
    const a = String(r?.area ?? "");
    if (!r || typeof r !== "object") problems.push("rent: an object with amount, bedrooms and area.");
    else if (!BEDROOMS.some((x) => x.id === b)) problems.push(`rent.bedrooms: one of ${BEDROOMS.map((x) => `${x.id} (${x.label.toLowerCase()})`).join(", ")}.`);
    else if (!AREAS.some((x) => x.id === a)) problems.push(`rent.area: centre or outside.`);
    else if (num(r.amount) === undefined) problems.push("rent.amount: what you pay a month, without bills.");
    else add(`rent.${b}.${a}`, r.amount, "Rent");
  }
  if (s.prices !== undefined) {
    const p = s.prices as Record<string, unknown> | null;
    if (!p || typeof p !== "object") problems.push("prices: an object such as {\"cappuccino\": 1.6}.");
    else
      for (const [k, v] of Object.entries(p)) {
        const def = PRICES.find((x) => x.id === k);
        if (!def) problems.push(`prices.${k}: not asked; prices are ${PRICES.map((x) => x.id).join(", ")}.`);
        else add(`price.${k}`, v, def.label);
      }
  }
  if (s.salary !== undefined) {
    const r = s.salary as Record<string, unknown> | null;
    const o = String(r?.occupation ?? "");
    if (!r || typeof r !== "object") problems.push("salary: an object with amount and occupation.");
    else if (!OCCUPATIONS.some((x) => x.id === o)) problems.push(`salary.occupation: one of ${OCCUPATIONS.map((x) => x.id).join(", ")}.`);
    else if (num(r.amount) === undefined) problems.push("salary.amount: what you take home a month, after tax.");
    else add(`salary.${o}`, r.amount, "Take-home pay");
  }
  if (s.rating !== undefined) add("rating.overall", s.rating, "Rating");
  if (!problems.length && !figures.length) problems.push("Add at least one figure: a rent, a price, your take-home pay or a rating.");
  return problems.length ? { ok: false, problems } : { ok: true, value: { city, currency, via, figures } };
}

const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-GB") : String(Math.round(n * 100) / 100));

// ---------- Review ----------

export interface Entry {
  id: string;
  city: string;
  figure: string;
  value: number;
  currency: string;
  /** The day it arrived, YYYY-MM-DD (UTC). */
  day: string;
  via: string;
}

export type Verdict = { status: "shown" } | { status: "held"; reason: string };

const DAY = 86_400_000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** The q-quantile by linear interpolation between order statistics. */
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (i - lo);
};

export const REVIEW = {
  /** Others needed before an entry is judged against them. */
  peers: 4,
  /** Robust standard deviations from the others' median, on the log of the amount. */
  sigmas: 3,
  /** Never hold within a factor of 2 of the others' median, however tight they are. */
  minFactor: 2,
  /** Without enough others: hold beyond this factor of the official figure. */
  officialFactor: 3,
  burst: { hours: 48, minGroup: 6, share: 0.5, move: 0.15 },
} as const;

/**
 * The automated review of one place's entries for one figure (all of the same figure and place).
 * `official` is the official figure in the same currency and unit, if there is one; `now` is today.
 */
export function review(entries: Entry[], now: Date, official?: number): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const def = FIGURE_BY_ID[entries[0]?.figure ?? ""];
  const rating = def?.kind === "rating";
  // First the burst: many new entries at once that move the figure are held until they are two days old, so a
  // flood can never outvote what was there before it (the Lund case). Entries keep only their day, so "the last
  // 48 hours" is today and yesterday (UTC).
  const b = REVIEW.burst;
  const since = new Date(now.getTime() - (b.hours / 24 - 1) * DAY).toISOString().slice(0, 10);
  const recent = entries.filter((e) => e.day >= since);
  const older = entries.filter((e) => e.day < since);
  if (entries.length >= b.minGroup && recent.length > entries.length * b.share && older.length) {
    const before = median(older.map((e) => e.value));
    if (Math.abs(median(entries.map((e) => e.value)) / before - 1) > b.move)
      for (const e of recent) out.set(e.id, { status: "held", reason: "many entries arrived at once; they are reviewed again when two days old" });
  }
  // Then each remaining entry against the other remaining ones, or against the official figure while they are few.
  const rest = entries.filter((e) => !out.has(e.id));
  const logs = rest.map((e) => Math.log(Math.max(e.value, 0.01)));
  rest.forEach((e, i) => {
    if (rating) return out.set(e.id, { status: "shown" });
    const others = logs.filter((_, j) => j !== i);
    if (others.length >= REVIEW.peers) {
      const m = median(others);
      const mad = median(others.map((x) => Math.abs(x - m))) * 1.4826;
      const limit = Math.max(REVIEW.sigmas * mad, Math.log(REVIEW.minFactor));
      if (Math.abs(logs[i]! - m) > limit) return out.set(e.id, { status: "held", reason: "far from what others report for this place" });
    } else if (official && official > 0 && Math.abs(Math.log(Math.max(e.value, 0.01) / official)) > Math.log(REVIEW.officialFactor)) {
      return out.set(e.id, { status: "held", reason: "far from the official figure, until others report similar amounts" });
    }
    out.set(e.id, { status: "shown" });
  });
  return out;
}

/** Group entries by place and figure, and review each group. */
export function reviewAll(entries: Entry[], now: Date, meta: Pick<PlacesMeta, "official" | "fx" | "places">): Map<string, Verdict> {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = `${e.city}\u0000${e.figure}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  const out = new Map<string, Verdict>();
  for (const list of groups.values()) {
    const { city, figure } = list[0]!;
    const off = officialFor(meta, city, figure);
    for (const [id, v] of review(list, now, off?.value)) out.set(id, v);
  }
  return out;
}

/** The official figure a community figure stands beside, in the place's currency. */
export function officialFor(meta: Pick<PlacesMeta, "official">, city: string, figure: string): { value: number; source: string; period: string; metric: string } | null {
  const metric = FIGURE_BY_ID[figure]?.official;
  const o = metric ? meta.official[city]?.[metric] : undefined;
  return metric && o ? { ...o, metric } : null;
}

// ---------- What is shown and published ----------

/** Three significant digits: what is shown and published, so no one's exact amount is. */
export function rounded(v: number): number {
  if (v === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 2);
  return Math.round(Math.round(v / p) * p * 100) / 100;
}

export interface Summary {
  figure: string;
  kind: FigureKind;
  label: string;
  unit: string;
  currency: string;
  /** Entries shown, after review. */
  entries: number;
  /** Entries held by review. */
  held: number;
  /** The median of shown entries (a rating: their mean), rounded. */
  value: number;
  /** The middle half of shown entries, from 3 entries. */
  range: [number, number] | null;
  /** First and latest month an entry arrived, YYYY-MM. */
  from: string;
  to: string;
  official: { value: number; source: string; period: string; metric: string } | null;
}

/** One place's community figures: every figure with at least one entry, in the catalogue's order. */
export function summarize(entries: Entry[], verdicts: Map<string, Verdict>, meta: Pick<PlacesMeta, "official">, city: string): Summary[] {
  const out: Summary[] = [];
  for (const def of FIGURES) {
    const all = entries.filter((e) => e.city === city && e.figure === def.id);
    if (!all.length) continue;
    const shown = all.filter((e) => verdicts.get(e.id)?.status === "shown");
    const held = all.length - shown.length;
    if (!shown.length) {
      out.push({ figure: def.id, kind: def.kind, label: def.label, unit: def.unit, currency: all[0]!.currency, entries: 0, held, value: 0, range: null, from: "", to: "", official: officialFor(meta, city, def.id) });
      continue;
    }
    const vs = shown.map((e) => e.value);
    const days = shown.map((e) => e.day).sort();
    const value = def.kind === "rating" ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10 : rounded(median(vs));
    out.push({
      figure: def.id,
      kind: def.kind,
      label: def.label,
      unit: def.unit,
      currency: shown[0]!.currency,
      entries: shown.length,
      held,
      value,
      range: def.kind !== "rating" && vs.length >= 3 && rounded(quantile(vs, 0.25)) !== rounded(quantile(vs, 0.75)) ? [rounded(quantile(vs, 0.25)), rounded(quantile(vs, 0.75))] : null,
      from: days[0]!.slice(0, 7),
      to: days.at(-1)!.slice(0, 7),
      official: officialFor(meta, city, def.id),
    });
  }
  return out;
}

/** A row of the open dataset: no removal code, no day, the amount rounded. */
export interface DatasetRow {
  id: string;
  city: string;
  name: string;
  country: string;
  figure: string;
  label: string;
  value: number;
  currency: string;
  month: string;
  via: string;
  review: "shown" | "held";
  reason?: string;
}

export function datasetRows(entries: Entry[], verdicts: Map<string, Verdict>, meta: Pick<PlacesMeta, "places">): DatasetRow[] {
  return entries
    .filter((e) => FIGURE_BY_ID[e.figure])
    .map((e) => {
      const v = verdicts.get(e.id) ?? { status: "shown" as const };
      const p = meta.places[e.city];
      return {
        id: e.id,
        city: e.city,
        name: p?.[0] ?? e.city,
        country: p?.[1] ?? "",
        figure: e.figure,
        label: FIGURE_BY_ID[e.figure]!.label,
        value: FIGURE_BY_ID[e.figure]!.kind === "rating" ? e.value : rounded(e.value),
        currency: FIGURE_BY_ID[e.figure]!.kind === "rating" ? "" : e.currency,
        month: e.day.slice(0, 7),
        via: e.via,
        review: v.status,
        ...(v.status === "held" ? { reason: v.reason } : {}),
      };
    })
    .sort((a, b) => a.city.localeCompare(b.city) || a.figure.localeCompare(b.figure) || a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
}

const CSV_COLS: (keyof DatasetRow)[] = ["id", "city", "name", "country", "figure", "label", "value", "currency", "month", "via", "review", "reason"];
export function datasetCsv(rows: DatasetRow[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** The unit worth saying beside a label: "a month" and the like; a cup or a litre is in the label already. */
export const unitWords = (s: { kind: FigureKind; unit: string }) => (s.kind === "rating" || (s.kind === "price" && !s.unit.startsWith("a month")) ? "" : s.unit);

/** "1 entry", "3 entries". */
export const entriesText = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 2026" from "2026-11". */
export const monthText = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : ym);

/** "Nov 2026", or "Sep to Nov 2026", or "Dec 2025 to Jan 2026". */
export function periodText(from: string, to: string): string {
  if (from === to) return monthText(to);
  return from.slice(0, 4) === to.slice(0, 4) ? `${monthText(from).slice(0, 3)} to ${monthText(to)}` : `${monthText(from)} to ${monthText(to)}`;
}

/** The address the CLI and MCP server send to. */
export const COMMUNITY_ORIGIN = "https://borgo.abcastor.com";
