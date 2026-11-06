// A proposal to correct a Borgo figure, rule or source: one shape shared by every face. The app's "Suggest a
// correction" link, the MCP tool propose_change, the CLI's `borgo propose` and the GitHub issue form all write it, and
// the validation workflow reads it back from the issue. Pure: no Node or browser APIs, so the app can bundle it.
// What a proposal may cite: a primary, official text (statute, gazette, official table or page, or a source already
// in the registry). News and other pages are leads to that text, never the citation itself, and a link-only source
// (registry access "link-out": Numbeo, WeatherSpark) can never be cited.
import { plausibleRange, unitFor, valueLength } from "../core/metrics.ts";
import type { Level, Metric } from "../core/types.ts";
import type { RegistryEntry } from "../registry/schema.ts";

export const REPO = "ABCastor/borgo";
export const REPO_URL = `https://github.com/${REPO}`;
/** The issue form in .github/ISSUE_TEMPLATE/, generated from FIELDS by scripts/proposals/form.ts. */
export const FORM = "proposal.yml";
/** GitHub answers 414 above about 8 KB of URL; a prefilled link stays under this. */
export const MAX_URL = 8000;
/** The licence a contributor grants on the data they propose (CONTRIBUTING.md). */
export const LICENCE = "CC-BY-4.0";

export const KINDS = ["correction", "figure", "rule-change", "source", "link"] as const;
export type Kind = (typeof KINDS)[number];

/** What a cited page is. The first five are primary; news and other pages only lead to one. */
export const CITATION_TYPES = ["statute", "gazette", "official-table", "official-page", "registry", "news", "other"] as const;
export type CitationType = (typeof CITATION_TYPES)[number];
export const PRIMARY_TYPES: ReadonlySet<CitationType> = new Set(["statute", "gazette", "official-table", "official-page", "registry"]);
/** A rule changes only by a legal text. */
export const LEGAL_TYPES: ReadonlySet<CitationType> = new Set(["statute", "gazette"]);

export interface Citation {
  url: string;
  type: CitationType;
  publisher: string;
  title: string;
  /** The day it was read, YYYY-MM-DD. */
  accessed: string;
  /** A short passage that appears on the page, for the check to find. */
  quote?: string;
  primary: boolean;
}

export type Target = { city: string; metric: string; source?: string } | { file: string; path: string };

export type Proposer = { kind: "person" } | { kind: "agent"; agent: string; operator: string };

export interface Proposal {
  kind: Kind;
  target: Target;
  /** The value shown now, as shown. */
  current?: string;
  /** The value proposed: a number (or 12 for a monthly figure) in the metric's unit, or the changed rule in words. */
  proposed: string;
  unit?: string;
  period?: string;
  level?: Level;
  /** The primary citation first; leads after it. */
  citations: Citation[];
  proposer: Proposer;
  /** The grant the proposer accepted: always CC-BY-4.0. Absent until they accept it. */
  licence?: typeof LICENCE;
  note?: string;
}

// ---------- The form: one list of fields, shared by the issue form, the parser, the body and the prefilled URL ----------

export interface Field {
  id: string;
  label: string;
  type: "input" | "textarea" | "checkboxes";
  description: string;
  required?: boolean;
  placeholder?: string;
}

const GRANT = "I contribute this under CC BY 4.0, and I read it in the official source I cite (not copied from a closed site)";

export const FIELDS: Field[] = [
  { id: "kind", label: "Kind of change", type: "input", required: true, description: "One of: correction (a figure shown is wrong), figure (a figure Borgo lacks, from an official table), rule-change (a tax, leave, residence or law rule changed), source (a registry entry), link (a broken or missing link).", placeholder: "correction" },
  { id: "city", label: "City id", type: "input", description: "For a figure: the city's id (london-gb), as `borgo search` shows it.", placeholder: "london-gb" },
  { id: "metric", label: "Metric id", type: "input", description: "For a figure: the metric's id (rent_1bed). `borgo catalogue --kind metrics` lists them.", placeholder: "rent_1bed" },
  { id: "source", label: "Registry source id", type: "input", description: "For a figure: the registry source it comes from (ons-pipr), when there is one.", placeholder: "ons-pipr" },
  { id: "file", label: "File", type: "input", description: "For a rule, source or link: the file that holds it (src/tax/it.ts, registry/ons-pipr.json).", placeholder: "src/tax/it.ts" },
  { id: "path", label: "Path in the file", type: "input", description: "For a rule, source or link: what inside the file changes (IRPEF_2026, ABORTION.US-NY, homepage).", placeholder: "IRPEF_2026" },
  { id: "current", label: "Value shown now", type: "input", description: "As Borgo shows it today." },
  { id: "proposed", label: "Proposed value", type: "textarea", required: true, description: "For a figure: the number in the metric's unit (12 numbers, separated by spaces, for a monthly figure). For a rule: the new rule in a sentence." },
  { id: "unit", label: "Unit", type: "input", description: "The unit of the proposed figure (GBP/month).", placeholder: "GBP/month" },
  { id: "period", label: "Period", type: "input", description: "The time the value describes (2026-09, 2026, 2026-04-06).", placeholder: "2026-09" },
  { id: "level", label: "Level", type: "input", description: "What area the value describes: city, metro, region or country.", placeholder: "city" },
  { id: "citation_url", label: "Official source address", type: "input", required: true, description: "The primary text: the statute, the official gazette, the official table or page. Never a news article, a blog or a link-only site such as Numbeo." },
  { id: "citation_type", label: "What the source is", type: "input", required: true, description: "One of: statute, gazette, official-table, official-page, registry (a source already in Borgo's registry).", placeholder: "official-table" },
  { id: "citation_publisher", label: "Publisher", type: "input", required: true, description: "Who publishes it (Office for National Statistics).", placeholder: "Office for National Statistics" },
  { id: "citation_title", label: "Title", type: "input", required: true, description: "The table's or text's title." },
  { id: "citation_accessed", label: "Read on", type: "input", required: true, description: "The day you read it, YYYY-MM-DD.", placeholder: "2026-11-05" },
  { id: "citation_quote", label: "Quote", type: "textarea", description: "Optional: a short passage from the source that states the value, copied exactly. The check looks for it on the page." },
  { id: "leads", label: "Leads", type: "textarea", description: "Optional: news or other pages that pointed you to the change, one address per line. They are not citations." },
  { id: "proposer", label: "Proposed by", type: "input", description: "person, or agent for an AI agent.", placeholder: "person" },
  { id: "agent", label: "Agent", type: "input", description: "For an agent: its name and version (name@1.2).", placeholder: "name@1.0" },
  { id: "operator", label: "Operator", type: "input", description: "For an agent: the person or project that runs it and answers for it." },
  { id: "note", label: "Note", type: "textarea", description: "Optional: anything a reviewer should know. This issue is public: leave out personal details." },
  { id: "grant", label: "Licence", type: "checkboxes", required: true, description: "Contributed data is published under CC BY 4.0 (see CONTRIBUTING.md)." },
];

export const GRANT_LABEL = GRANT;
const BY_LABEL = new Map(FIELDS.map((f) => [f.label, f]));

export type Fields = Partial<Record<string, string>>;

/** A proposal as the form's fields, the way a person or a link fills them in. */
export function toFields(p: Proposal): Fields {
  const [primary, ...rest] = p.citations;
  const t = p.target;
  const f: Fields = {
    kind: p.kind,
    ...("city" in t ? { city: t.city, metric: t.metric, ...(t.source ? { source: t.source } : {}) } : { file: t.file, path: t.path }),
    current: p.current,
    proposed: p.proposed,
    unit: p.unit,
    period: p.period,
    level: p.level,
    citation_url: primary?.url,
    citation_type: primary?.type,
    citation_publisher: primary?.publisher,
    citation_title: primary?.title,
    citation_accessed: primary?.accessed,
    citation_quote: primary?.quote,
    leads: rest.map((c) => c.url).join("\n") || undefined,
    proposer: p.proposer.kind,
    ...(p.proposer.kind === "agent" ? { agent: p.proposer.agent, operator: p.proposer.operator } : {}),
    note: p.note,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ""));
}

const EMPTY = "_No response_";

/** The issue body GitHub writes for a submitted form: `### Label`, a blank line, the value. */
export function issueBody(p: Proposal): string {
  const f = toFields(p);
  return FIELDS.map((x) => {
    if (x.type === "checkboxes") return `### ${x.label}\n\n- [${p.licence === LICENCE ? "X" : " "}] ${GRANT}`;
    return `### ${x.label}\n\n${f[x.id]?.trim() || EMPTY}`;
  }).join("\n\n");
}

/** The fields of an issue body written by the form (or by issueBody); unknown headings are ignored. */
export function parseIssueBody(body: string): Fields {
  const out: Fields = {};
  const parts = body.replace(/\r\n/g, "\n").split(/^### +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = (nl < 0 ? part : part.slice(0, nl)).trim();
    const field = BY_LABEL.get(label);
    if (!field) continue;
    const value = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    if (field.type === "checkboxes") out[field.id] = /^- \[[xX]\]/m.test(value) ? "yes" : "";
    else if (value && value !== EMPTY) out[field.id] = value;
  }
  return out;
}

/** True when an issue body was written by the proposal form (or in its format). */
export function isProposalBody(body: string | null | undefined): boolean {
  return typeof body === "string" && /^### Kind of change\s*$/m.test(body) && /^### Official source address\s*$/m.test(body);
}

// ---------- From fields to a proposal ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS = new Set(["city", "metro", "region", "country"]);
/** Agents name a version: "name@1.2". */
const AGENT = /^[A-Za-z0-9._-]{1,60}@[A-Za-z0-9._-]{1,30}$/;

/** A user-typed value for a message: one line, no markup, short. */
export function shown(v: unknown, max = 80): string {
  const s = String(v ?? "").replace(/[\s`]+/g, " ").trim();
  return `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"`;
}

/**
 * The proposal the fields describe, and what is missing or malformed in words a contributor can act on. A proposal is
 * returned whenever the fields have a shape at all, so the other checks can add their reasons too.
 */
export function fromFields(f: Fields): { proposal: Proposal | null; problems: string[] } {
  const problems: string[] = [];
  const get = (id: string) => f[id]?.trim() || undefined;
  let kind = get("kind")?.toLowerCase() as Kind | undefined;
  if (!kind) problems.push(`Say what kind of change this is: ${KINDS.join(", ")}.`);
  else if (!KINDS.includes(kind)) {
    problems.push(`Kind of change ${shown(kind)} is not one of ${KINDS.join(", ")}.`);
    kind = undefined;
  }
  const city = get("city"), metric = get("metric"), file = get("file"), path = get("path");
  let target: Target | null = null;
  if (city || metric) {
    if (!city || !metric) problems.push("A figure needs both its city id and its metric id.");
    else target = { city, metric, ...(get("source") ? { source: get("source")! } : {}) };
  } else if (file || path) {
    if (!file || !path) problems.push("A rule, source or link needs both the file and the path inside it.");
    else target = { file, path };
  } else problems.push("Say what to change: a city id and metric id for a figure, or a file and path for a rule, source or link.");
  if (kind && target) {
    const isFigure = "city" in target;
    if ((kind === "correction" || kind === "figure") && !isFigure) problems.push(`A ${kind} is about a figure: give the city id and metric id, not a file.`);
    if ((kind === "rule-change" || kind === "source" || kind === "link") && isFigure) problems.push(`A ${kind} is about a file: give the file and the path inside it. To correct a figure, use kind correction.`);
  }
  const proposed = get("proposed");
  if (!proposed) problems.push("Give the proposed value.");

  const level = get("level")?.toLowerCase();
  if (level && !LEVELS.has(level)) problems.push(`Level ${shown(level)} is not one of city, metro, region, country.`);
  const period = get("period");
  if (period && !/^\d{4}(-\d{2}(-\d{2})?|-Q[1-4]|-\d{4})?$/.test(period)) problems.push(`Period ${shown(period)} is not a year, month or day (2026, 2026-09, 2026-09-30), a quarter (2026-Q3) or a range of years (1991-2020).`);

  const citations: Citation[] = [];
  const url = get("citation_url");
  const type = get("citation_type")?.toLowerCase() as CitationType | undefined;
  if (!url) problems.push("Give the address of the official source.");
  if (!type) problems.push(`Say what the source is: ${[...PRIMARY_TYPES].join(", ")}.`);
  else if (!CITATION_TYPES.includes(type)) problems.push(`What the source is, ${shown(type)}, is not one of ${CITATION_TYPES.join(", ")}.`);
  const accessed = get("citation_accessed");
  if (accessed && !DATE.test(accessed)) problems.push(`Read on ${shown(accessed)} is not a date (YYYY-MM-DD).`);
  if (!get("citation_publisher")) problems.push("Name the source's publisher.");
  if (!get("citation_title")) problems.push("Give the source's title.");
  if (!accessed) problems.push("Give the day you read the source (YYYY-MM-DD).");
  if (url) {
    // A citation without a known type is kept as "other", so the address and the rest are still checked.
    const known = type && CITATION_TYPES.includes(type) ? type : "other";
    citations.push({ url, type: known, publisher: get("citation_publisher") ?? "", title: get("citation_title") ?? "", accessed: accessed ?? "", ...(get("citation_quote") ? { quote: get("citation_quote")! } : {}), primary: PRIMARY_TYPES.has(known) });
  }
  for (const lead of (get("leads") ?? "").split(/\s+/).filter(Boolean)) citations.push({ url: lead, type: "news", publisher: "", title: "", accessed: accessed ?? "", primary: false });

  const who = get("proposer")?.toLowerCase() ?? "person";
  let proposer: Proposer = { kind: "person" };
  if (who === "agent") {
    const agent = get("agent"), operator = get("operator");
    if (!agent || !AGENT.test(agent)) problems.push(`An agent names itself with a version, name@1.0${agent ? `; got ${shown(agent)}` : ""}.`);
    if (!operator) problems.push("An agent names its operator: the person or project that runs it and answers for it.");
    proposer = { kind: "agent", agent: agent ?? "", operator: operator ?? "" };
  } else if (who !== "person") problems.push(`Proposed by ${shown(who)} is not person or agent.`);

  const granted = f.grant === "yes";
  if (!granted) problems.push("Tick the licence box: contributed data is published under CC BY 4.0.");

  if (!target || !proposed) return { proposal: null, problems };
  // An unknown kind is reported above; the rest is still checked as the kind its target implies.
  const p: Proposal = {
    kind: kind ?? ("city" in target ? "correction" : "rule-change"),
    target,
    proposed,
    citations,
    proposer,
    ...(get("current") ? { current: get("current") } : {}),
    ...(get("unit") ? { unit: get("unit") } : {}),
    ...(period ? { period } : {}),
    ...(level && LEVELS.has(level) ? { level: level as Level } : {}),
    ...(granted ? { licence: LICENCE } : {}),
    ...(get("note") ? { note: get("note") } : {}),
  };
  return { proposal: p, problems };
}

// ---------- The prefilled link ----------

/** The title an issue gets: what changes, in a few words. */
export function proposalTitle(p: Pick<Proposal, "kind" | "target">, names?: { metric?: string; city?: string }): string {
  const t = p.target;
  const what = "city" in t ? `${names?.metric ?? t.metric}, ${names?.city ?? t.city}` : `${t.file} ${t.path}`;
  const verb: Record<Kind, string> = { correction: "Correction", figure: "New figure", "rule-change": "Rule change", source: "Source", link: "Link" };
  return `${verb[p.kind]}: ${what}`.slice(0, 120);
}

/**
 * The address of the issue form with the fields filled in. Long free text (quote, note, current value) is shortened
 * until the address fits under MAX_URL; the person can complete it on the form.
 */
export function issueUrl(fields: Fields, title?: string, repoUrl = REPO_URL): string {
  const build = (f: Fields) => {
    const q = new URLSearchParams({ template: FORM });
    if (title) q.set("title", title);
    for (const x of FIELDS) {
      const v = f[x.id];
      if (x.type !== "checkboxes" && v) q.set(x.id, v);
    }
    return `${repoUrl}/issues/new?${q.toString()}`;
  };
  let f = { ...fields };
  let url = build(f);
  for (const id of ["note", "citation_quote", "leads", "current", "proposed"]) {
    if (url.length <= MAX_URL) break;
    const v = f[id];
    if (!v) continue;
    const over = url.length - MAX_URL;
    // Each character can take up to 9 in the address (a percent-encoded three-byte character).
    const keep = Math.max(0, v.length - Math.ceil(over / 3) - 4);
    f = { ...f, [id]: keep > 20 ? `${v.slice(0, keep)}…` : undefined };
    url = build(f);
    while (url.length > MAX_URL && f[id]) {
      const cur = f[id]!;
      f = { ...f, [id]: cur.length > 40 ? `${cur.slice(0, Math.floor(cur.length * 0.8))}…` : undefined };
      url = build(f);
    }
  }
  return url;
}

// ---------- Checks against the repository ----------

/** What the checks need to know about the repository: the browser has no use for them, Node builds this from disk. */
export interface RepoView {
  metrics: Record<string, Metric>;
  /** Cities with figures in the committed snapshot: id to country. */
  cities: Map<string, string>;
  /** Country to currency. */
  currency: (country: string) => string | undefined;
  registry: RegistryEntry[];
  /** A tracked file's text, or null when there is none. */
  read: (path: string) => string | null;
}

/** Facts the site depends on most: two independent reviews against the official text must agree. */
const LOCKED_FILES = [/^src\/tax\//, /^src\/fetch\/rights-law\.ts$/, /^src\/fetch\/politics(-table)?\.ts$/, /^pipeline\/inputs\/politics\.json$/, /^data\/rights\.json$/, /^src\/core\/rights\.ts$/];
const LOCKED_SOURCES = new Set(["politics", "abortion-law", "couples-law", "eu-free-movement", "ch-afmp", "cta", "ttta"]);
const LOCKED_METRICS = new Set(["politics_lr", "abortion_law", "same_sex_couples"]);
/** True for a file whose facts are locked: two independent reviews must agree. */
export function lockedFile(path: string): boolean {
  const regId = /^registry\/([a-z0-9-]+)\.json$/.exec(path)?.[1];
  return LOCKED_FILES.some((re) => re.test(path)) || (!!regId && LOCKED_SOURCES.has(regId));
}
/** Files a rule lives in: a change to them is encoded with tests by the reviewer, so the proposal stays an issue. */
const RULE_FILES = [...LOCKED_FILES, /^src\/fetch\/family\.ts$/, /^src\/core\//];
/** Registry fields a link proposal may replace in a pull request: addresses only. */
const LINK_PATHS = new Set(["homepage", "licenceUrl", "linkOut", "rights.termsUrl"]);
/** Where a figure's file lives once a correction is accepted. */
export const CORRECTIONS_FILE = "data/corrections.json";

export type Route = "pr" | "issue";

export interface Verdict {
  ok: boolean;
  problems: string[];
  warnings: string[];
  /** "pr": the change is ready as a branch for review; "issue": the reviewer encodes it with tests. */
  route: Route;
  /** Two independent reviews against the official text must agree. */
  locked: boolean;
  labels: string[];
  /** One line on what happens next. */
  next: string;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Hosts of the link-only sources: their pages may be linked to, never cited or copied. */
export function linkOnlyHosts(registry: RegistryEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of registry.filter((x) => x.access === "link-out")) {
    for (const u of [e.homepage, e.linkOut]) {
      const h = u && hostOf(u.replace(/\{[a-z_]+\}/g, "x"));
      if (h) out.set(h, e.id);
    }
  }
  return out;
}

function linkOnly(url: string, hosts: Map<string, string>): string | undefined {
  const h = hostOf(url);
  if (!h) return undefined;
  for (const [host, id] of hosts) if (h === host || h.endsWith(`.${host}`)) return id;
  return undefined;
}

/** The numbers a figure proposal gives, or a reason. */
export function parseValue(m: Metric, text: string): { value: number | number[] } | { problem: string } {
  const n = valueLength(m.shape);
  const one = (s: string) => {
    const t = s.trim().replace(/[\u202f\u00a0_]/g, "");
    // 1,800 and 12,345.6 are thousands; a lone comma is a decimal (12,5).
    const v = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, "")) : Number(t.replace(/^(-?\d+),(\d+)$/, "$1.$2"));
    return t === "" ? NaN : v;
  };
  if (!n) {
    const v = one(text);
    return Number.isFinite(v) ? { value: v } : { problem: `${m.id} takes one number; got ${shown(text)}.` };
  }
  const parts = text.split(/[\s;]+/).filter(Boolean).map(one);
  if (parts.length !== n || parts.some((v) => !Number.isFinite(v))) return { problem: `${m.id} takes ${n} numbers separated by spaces; got ${parts.length}.` };
  return { value: parts };
}

/** The file a curated metric's rule lives in, for a reviewer. */
const RULE_OF_SOURCE: Record<string, string> = {
  "abortion-law": "src/fetch/rights-law.ts (ABORTION)",
  "couples-law": "src/fetch/rights-law.ts (COUPLES)",
  "labour-law": "src/fetch/family.ts (STATUTORY_LEAVE)",
  politics: "pipeline/inputs/politics.json",
};

/**
 * Checks a proposal against the repository, without the network: the target exists, the value has the metric's shape
 * and unit, the citation is primary and not a link-only source, a rule cites its legal text. Says where it goes next.
 */
export function checkProposal(p: Proposal, repo: RepoView): Verdict {
  const problems: string[] = [];
  const warnings: string[] = [];
  const hosts = linkOnlyHosts(repo.registry);
  const byId = new Map(repo.registry.map((e) => [e.id, e]));
  let route: Route = "issue";
  let locked = false;
  let rule = p.kind === "rule-change";
  let fetched = false;

  // Citations: one primary, none link-only, a registry citation names a real, open source.
  const primary = p.citations.filter((c) => c.primary);
  if (!primary.length) problems.push(`Cite the official text itself (${[...PRIMARY_TYPES].join(", ")}). A news article or other page can only lead to it: put it under Leads.`);
  for (const c of p.citations) {
    if (!/^https?:\/\//i.test(c.url) || !hostOf(c.url)) problems.push(`${shown(c.url)} is not a web address (http or https).`);
    const lo = linkOnly(c.url, hosts);
    if (lo) problems.push(`${hostOf(c.url)} is a link-only source (${lo}): its terms forbid copying its figures, so it cannot be cited, even as a lead. Find the official figure instead.`);
    if (c.primary && c.type === "registry") {
      const e = [...byId.values()].find((x) => hostOf(x.homepage) === hostOf(c.url));
      if (!e && !(("city" in p.target) && p.target.source && byId.has(p.target.source))) warnings.push(`${hostOf(c.url)} is not the home of a registry source; a reviewer checks that it is official.`);
    }
    if (c.primary && c.publisher.trim() === "") problems.push("Name the source's publisher.");
    if (c.quote && c.quote.length > 600) problems.push("Keep the quote under 600 characters: a sentence or two that states the value.");
  }

  const t = p.target;
  if ("city" in t) {
    const m = repo.metrics[t.metric];
    if (!m) problems.push(`There is no metric ${shown(t.metric)}. \`borgo catalogue --kind metrics\` lists them.`);
    const country = repo.cities.get(t.city);
    if (!/^[a-z0-9-]{2,80}$/.test(t.city)) problems.push(`City id ${shown(t.city)} is not an id such as london-gb.`);
    else if (!country) {
      fetched = true;
      warnings.push(`${t.city} has no committed figures: its figures are read from each source when the page opens. A wrong figure there is fixed in the source or in how Borgo reads it, so this stays an issue.`);
    }
    const src = t.source ? byId.get(t.source) : undefined;
    if (t.source && !src) problems.push(`There is no registry source ${shown(t.source)}. \`borgo sources\` lists them.`);
    if (src?.access === "link-out") problems.push(`${src.name} is a link-only source: its figures are never copied into Borgo. Cite the official figure instead.`);
    if (m) {
      if (LOCKED_METRICS.has(m.id) || (src && LOCKED_SOURCES.has(src.id))) locked = true;
      const curated = src?.access === "curated" || LOCKED_METRICS.has(m.id) || m.id === "annual_leave";
      if (curated) rule = true;
      const parsed = curated ? null : parseValue(m, p.proposed);
      if (parsed && "problem" in parsed) problems.push(parsed.problem);
      if (parsed && "value" in parsed) {
        const unit = unitFor(m, (country && repo.currency(country)) ?? "");
        if (!p.unit) problems.push(`Give the unit: ${m.id} is in ${unit}${country ? "" : " (in the city's currency)"}.`);
        else if (country && p.unit.replace(/\s+/g, "") !== unit.replace(/\s+/g, "")) problems.push(`${m.id} is given in ${unit}, not ${shown(p.unit)}. Convert it first.`);
        const [lo, hi] = plausibleRange(m);
        const bad = (Array.isArray(parsed.value) ? parsed.value : [parsed.value]).filter((v) => v < lo || v > hi);
        if (bad.length) problems.push(`${m.id} runs from ${lo} to ${hi === Number.MAX_SAFE_INTEGER ? "any amount" : hi}; got ${bad.slice(0, 3).join(", ")}.`);
        if (src && !src.measures.some((x) => x.metric === m.id)) problems.push(`${src.id} does not measure ${m.id}; pick the registry source the figure comes from.`);
        if (!p.period) problems.push("Give the period the figure describes (2026-09, 2026).");
        if (!p.level) problems.push("Say what area the figure describes: city, metro, region or country.");
        if (!fetched && !rule && primary.length && !problems.length) {
          if (src && src.redistribute !== "no") route = "pr";
          else if (!t.source) warnings.push("Name the registry source the figure comes from (Registry source id) so the change can be committed for you; without it the reviewer works out where it belongs.");
          else if (src) warnings.push(`${src.name} may not be redistributed, so its figure cannot be committed.`);
        }
      }
      if (rule && src) warnings.push(`${m.label} is encoded by hand in ${RULE_OF_SOURCE[src.id] ?? "its rule file"}: the reviewer updates it, with tests.`);
    }
  } else {
    const file = t.file.replace(/^\.?\//, "");
    if (file.includes("..") || /^\//.test(t.file)) problems.push(`File ${shown(t.file)} must be a path inside the repository.`);
    else {
      const text = repo.read(file);
      const isNewSource = p.kind === "source" && /^registry\/[a-z0-9-]+\.json$/.test(file) && text === null;
      if (text === null && !isNewSource) problems.push(`There is no file ${shown(file)} in the repository.`);
      if (LOCKED_FILES.some((re) => re.test(file))) locked = true;
      const regId = /^registry\/([a-z0-9-]+)\.json$/.exec(file)?.[1];
      if (regId && LOCKED_SOURCES.has(regId)) locked = true;
      if (RULE_FILES.some((re) => re.test(file))) rule = true;
      if (text !== null && !isNewSource) {
        const head = t.path.split(/[.[\]]/)[0]!;
        if (!head || !text.includes(head)) problems.push(`${shown(t.path)} does not appear in ${file}: name the constant, key or field that changes.`);
      }
      if (p.kind === "link") {
        if (!/^https:\/\//.test(p.proposed.trim())) problems.push("A link proposal gives the new https address as the proposed value.");
        else if (linkOnly(p.proposed.trim(), hosts)) problems.push("The new address is a link-only source; propose an official page.");
        if (regId && text !== null && LINK_PATHS.has(t.path) && !problems.length) route = "pr";
      }
      if (p.kind === "source" && isNewSource) warnings.push("A new source is vetted by the reviewer (licence, terms, what it measures) before it joins the registry.");
      if (p.kind === "source" && !regId) problems.push("A source proposal is about a registry entry: file registry/<id>.json.");
    }
  }
  if (rule && !p.citations.some((c) => LEGAL_TYPES.has(c.type))) problems.push("A rule changes only by a legal text: cite the statute or the official gazette that sets it (type statute or gazette). An official page that explains it can be a second citation.");
  if (p.kind === "figure" && p.current) warnings.push("A figure proposal adds a value Borgo lacks; if Borgo shows one, use kind correction.");
  if (p.licence !== LICENCE) problems.push("Tick the licence box: contributed data is published under CC BY 4.0.");

  const ok = problems.length === 0;
  if (!ok) route = "issue";
  const labels = ["proposal", ok ? "valid" : "needs changes", rule ? "rule" : "data", ...(locked ? ["locked"] : [])];
  const review = locked ? "two independent reviews against the official text" : "one review against the cited source";
  const next = !ok
    ? "Edit the issue to fix what is listed; the check runs again on every edit."
    : route === "pr"
      ? `The change is prepared from this issue; it needs ${review} before it merges.`
      : `The reviewer encodes it${rule ? ", with tests," : ""} and opens the pull request; it needs ${review}.`;
  return { ok, problems: [...new Set(problems)], warnings: [...new Set(warnings)], route, locked, labels, next };
}

/** A short, stable fingerprint of a proposal: what the person agreed to post must be what is posted. */
export function fingerprint(p: Proposal): string {
  const s = canonical(p);
  // FNV-1a, 32-bit, twice with different seeds: a consent token, not a security hash.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 ^ 0x2f) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
