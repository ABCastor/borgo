// The facts encoded by hand in this repository, each with the day it is due to be compared with its source again
// (`reviewBy`), so anyone's agent knows where to look first: tax models (the next tax year), laws (a year after they
// were checked, or now when they never were), paid leave, election results (the next regular election), residence
// rules, and figures corrected through proposals (the source's next release).
import { ABORTION, COUPLES, lawReviewBy } from "../fetch/rights-law.ts";
import { LEAVE_CHECKED, STATUTORY_LEAVE } from "../fetch/family.ts";
import { POLITICS } from "../fetch/politics-table.ts";
import type { RegistryEntry } from "../registry/schema.ts";
import { TAX_MODELS } from "../tax/index.ts";
import type { Correction } from "./apply.ts";
import type { Kind, Target } from "./proposal.ts";

export const FACT_KINDS = ["tax", "law", "leave", "politics", "rights", "correction"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface CuratedFact {
  /** Stable id, e.g. law:abortion:US-NY, tax:IT, politics:SE. */
  id: string;
  kind: FactKind;
  /** ISO alpha-2 country (or the country of a region). */
  country: string;
  what: string;
  /** What Borgo holds now, in words. */
  value: string;
  sources: { label: string; url?: string }[];
  /** The day it was last compared with its source, when it was. */
  checked: string | null;
  reviewBy: string;
  /** Why it is due then. */
  why: string;
  /** Two reviewers, or a named steward for the country. */
  locked: boolean;
  /** Where a proposal about it points. */
  propose: { kind: Kind; target: Target; current: string };
}

const addYears = (date: string, years: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

/**
 * The longest a legislature runs before the next regular election, in years, from each country's constitution or
 * election law. An early election comes sooner; this is when the result is due to change at the latest.
 */
const TERM_YEARS: Record<string, number> = { AT: 5, AU: 3, BE: 5, CA: 4, CH: 4, CZ: 4, DE: 4, DK: 4, EE: 4, FI: 4, FR: 5, GB: 5, HU: 4, IE: 5, IT: 5, JP: 4, NL: 4, NO: 4, PL: 4, PT: 4, SE: 4 };

const TAX_EXPORT: Record<string, string> = { AE: "unitedArabEmirates", AT: "austria", AU: "australia", BE: "belgium", CA: "canada", CH: "switzerland", CZ: "czechia", DE: "germany", DK: "denmark", EE: "estonia", ES: "spain", FI: "finland", FR: "france", GB: "unitedKingdom", GR: "greece", HU: "hungary", IE: "ireland", IT: "italy", JP: "japan", NL: "netherlands", NO: "norway", PL: "poland", PT: "portugal", SE: "sweden", SG: "singapore", US: "unitedStates" };

const ABORTION_WORDS = ["not allowed, or only to save her life", "also for her health or after rape", "also on social or economic grounds", "on request in the first weeks only", "on request to 10 weeks or later"];
const COUPLES_WORDS = ["criminalised", "legal, no union in law", "civil union or partnership", "marriage"];

/** Every curated fact with its review date. `corrections` are the accepted ones in data/corrections.json. */
export function curatedFacts(o: { corrections?: Correction[]; registry?: RegistryEntry[]; name?: (country: string) => string } = {}): CuratedFact[] {
  const name = (c: string) => o.name?.(c) ?? c;
  const out: CuratedFact[] = [];
  const place = (key: string) => (key.includes("-") ? `${key} (${name(key.slice(0, 2))})` : name(key));

  for (const [c, m] of Object.entries(TAX_MODELS)) {
    const reviewBy = m.reviewBy ?? `${m.year + 1}-01-01`;
    out.push({
      id: `tax:${c}`,
      kind: "tax",
      country: c,
      what: `Take-home pay model, ${name(c)} (${m.year})`,
      value: m.scope,
      sources: m.sources.map((s) => ({ label: s.label, url: s.url })),
      checked: null,
      reviewBy,
      why: `the next tax year's rules take effect on ${reviewBy}; its budget law is usually published before then`,
      locked: true,
      propose: { kind: "rule-change", target: { file: `src/tax/${c.toLowerCase()}.ts`, path: TAX_EXPORT[c] ?? "year" }, current: `${m.year} rules` },
    });
  }

  for (const [key, f] of Object.entries(ABORTION)) {
    out.push({
      id: `law:abortion:${key}`,
      kind: "law",
      country: key.slice(0, 2),
      what: `Abortion in law, ${place(key)}`,
      value: `${f.level}: ${ABORTION_WORDS[f.level]}; ${f.text} (${f.law})`,
      sources: [{ label: f.law, url: f.url }],
      checked: f.checked ?? null,
      reviewBy: lawReviewBy(f),
      why: f.reviewBy ? "a change is pending" : f.checked ? "a year since it was compared with its source" : "never compared with its source: stated from the law cited",
      locked: true,
      propose: { kind: "rule-change", target: { file: "src/fetch/rights-law.ts", path: `ABORTION.${key}` }, current: `${f.level}: ${f.text}` },
    });
  }

  for (const [key, f] of Object.entries(COUPLES)) {
    out.push({
      id: `law:couples:${key}`,
      kind: "law",
      country: key,
      what: `Same-sex couples in law, ${name(key)}`,
      value: `${f.standing}: ${COUPLES_WORDS[f.standing]}; ${f.law}${f.note ? `; ${f.note}` : ""}`,
      sources: [{ label: f.law, ...(f.url ? { url: f.url } : {}) }],
      checked: f.checked ?? null,
      reviewBy: lawReviewBy(f),
      why: f.reviewBy ? "a change is pending" : f.checked ? "a year since it was compared with its source" : `never compared with its source${f.url ? "" : ", and no address for it"}: stated from the law cited`,
      locked: true,
      propose: { kind: "rule-change", target: { file: "src/fetch/rights-law.ts", path: `COUPLES.${key}` }, current: `${f.standing}: ${f.law}` },
    });
  }

  for (const [c, l] of Object.entries(STATUTORY_LEAVE)) {
    out.push({
      id: `leave:${c}`,
      kind: "leave",
      country: c,
      what: `Paid holiday by law, ${name(c)}`,
      value: `${Math.round(l.days * 10) / 10} working days: ${l.note}`,
      sources: [{ label: l.source.label, url: l.source.url }],
      checked: LEAVE_CHECKED,
      reviewBy: addYears(LEAVE_CHECKED, 1),
      why: "a year since it was compared with its source",
      locked: false,
      propose: { kind: "rule-change", target: { file: "src/fetch/family.ts", path: `STATUTORY_LEAVE.${c}` }, current: `${Math.round(l.days * 10) / 10} days: ${l.note}` },
    });
  }

  for (const [key, p] of Object.entries(POLITICS)) {
    if (key.includes("-")) continue; // regions share their country's election
    const term = TERM_YEARS[key] ?? 4;
    out.push({
      id: `politics:${key}`,
      kind: "politics",
      country: key,
      what: `Politics, left to right, ${name(key)}: ${p.election}, ${p.date}`,
      value: `${p.position ?? "no figure"} (0 left to 10 right)`,
      sources: [{ label: `Official result, ${p.election}`, url: p.url }],
      checked: p.checked,
      reviewBy: addYears(p.date, term),
      why: `the next regular election is due by then (a ${term}-year term); an early election comes sooner`,
      locked: true,
      propose: { kind: "rule-change", target: { file: "pipeline/inputs/politics.json", path: key }, current: `${p.election}, ${p.date}` },
    });
  }

  for (const e of o.registry ?? []) {
    if (e.access !== "curated" || !["eu-free-movement", "ch-afmp", "cta", "ttta"].includes(e.id)) continue;
    const reviewBy = new Date(Date.parse(`${e.vetted.on}T00:00:00Z`) + e.refresh.maxAgeDays * 86_400_000).toISOString().slice(0, 10);
    out.push({
      id: `rights:${e.id}`,
      kind: "rights",
      country: "",
      what: `Residence rules: ${e.name}`,
      value: e.measures.map((m) => m.definition).join(" "),
      sources: [{ label: e.publisher, url: e.homepage }],
      checked: e.vetted.on,
      reviewBy,
      why: `${e.refresh.maxAgeDays} days since it was vetted`,
      locked: true,
      propose: { kind: "rule-change", target: { file: "data/rights.json", path: e.id }, current: e.name },
    });
  }

  for (const c of o.corrections ?? []) {
    out.push({
      id: `correction:${c.city}:${c.metric}:${c.source}`,
      kind: "correction",
      country: "",
      what: `Corrected ${c.metric}, ${c.city} (#${c.correction.issue})`,
      value: `${Array.isArray(c.value) ? c.value.join(" ") : c.value} for ${c.period}`,
      sources: [{ label: `${c.correction.citation.publisher}, ${c.correction.citation.title}`, url: c.url }],
      checked: c.correction.on,
      reviewBy: c.reviewBy,
      why: "the source's next release may replace the corrected figure",
      locked: false,
      propose: { kind: "correction", target: { city: c.city, metric: c.metric, source: c.source }, current: String(Array.isArray(c.value) ? c.value.join(" ") : c.value) },
    });
  }
  return out;
}

export interface StaleQuery {
  /** The day to compare against, YYYY-MM-DD; default today. */
  asOf?: string;
  /** Also list facts due within this many days. */
  within?: number;
  kind?: FactKind;
  country?: string;
  limit?: number;
}

/** Facts due for review by `asOf` (plus `within` days), the most overdue first. */
export function staleFacts(facts: CuratedFact[], q: StaleQuery = {}): { asOf: string; until: string; total: number; facts: CuratedFact[] } {
  const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf must be a date, YYYY-MM-DD; got "${asOf}".`);
  if (q.within !== undefined && !(q.within >= 0 && q.within <= 3650)) throw new Error("within is a number of days from 0 to 3650.");
  const until = new Date(Date.parse(`${asOf}T00:00:00Z`) + (q.within ?? 0) * 86_400_000).toISOString().slice(0, 10);
  const country = q.country?.toUpperCase();
  const due = facts
    .filter((f) => f.reviewBy <= until && (!q.kind || f.kind === q.kind) && (!country || f.country === country))
    .sort((a, b) => a.reviewBy.localeCompare(b.reviewBy) || a.id.localeCompare(b.id));
  return { asOf, until, total: due.length, facts: due.slice(0, q.limit ?? 50) };
}

/** A list of due facts in markdown, with what to do about each. */
export function staleMarkdown(r: ReturnType<typeof staleFacts>): string {
  if (!r.total) return `Nothing is due for review by ${r.until}.`;
  const cell = (x: string) => x.replace(/\|/g, "/").replace(/\[/g, "(").replace(/\]/g, ")");
  const rows = r.facts.map((f) => `| ${f.id} | ${cell(f.what)} | ${f.reviewBy} | ${cell(f.why)} | ${f.sources[0]?.url ? `[${cell(f.sources[0].label.slice(0, 60))}](${f.sources[0].url})` : cell(f.sources[0]?.label ?? "")} |`);
  const more = r.total > r.facts.length ? `\n\n${r.total - r.facts.length} more are due; raise the limit or filter by kind or country.` : "";
  return `${r.total} curated ${r.total === 1 ? "fact is" : "facts are"} due for review by ${r.until}${r.until === r.asOf ? "" : ` (as of ${r.asOf})`}, the most overdue first.\n\n| id | What | Review by | Why | Source |\n|---|---|---|---|---|\n${rows.join("\n")}${more}\n\nTo propose a change: read the official text (the statute, gazette or official table, never a news article alone), then call propose_change with the fact's target, the new value and the citation. Locked facts (tax, laws, elections, residence rules) need two reviewers.`;
}
