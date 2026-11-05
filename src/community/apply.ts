// What an accepted data proposal changes in the repository: a corrected figure in data/corrections.json, or a new
// address in a registry entry. Pure text in, text out, so the workflow and the tests share it. Rules (tax modules,
// laws, positions) are never changed here: a person encodes them, with tests.
import type { Level, Value } from "../core/types.ts";
import type { RegistryEntry } from "../registry/schema.ts";
import { CORRECTIONS_FILE, parseValue, type Proposal, type RepoView } from "./proposal.ts";

/** One accepted correction: build-data puts it in place of the same source's figure for that city and metric. */
export interface Correction {
  city: string;
  metric: string;
  source: string;
  value: Value;
  period: string;
  level: Level;
  /** The primary citation's address: what the figure was read from. */
  url: string;
  note?: string;
  correction: {
    /** The day the change was proposed and checked. */
    on: string;
    /** The issue that proposed it. */
    issue: number;
    citation: { publisher: string; title: string; url: string; accessed: string; quote?: string };
  };
  /** When to compare it with the source again: the source's next release may replace it. */
  reviewBy: string;
}

export interface CorrectionsFile {
  /** What this file is, for someone who opens it. */
  about: string;
  corrections: Correction[];
}

export const CORRECTIONS_ABOUT = "Figures corrected through reviewed proposals (CONTRIBUTING.md). pipeline/build-data.ts puts each in place of the same source's figure for that city and metric, keeping the citation; reviewBy is when to compare it with the source again.";

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface Change {
  path: string;
  content: string;
  /** The commit message's first line. */
  summary: string;
}

/**
 * The file change a valid data proposal makes, or null when it is not one a pull request can carry. `current` is the
 * file's text now (null when it does not exist yet).
 */
export function changeFor(p: Proposal, repo: RepoView, o: { issue: number; on: string; current: string | null }): Change | null {
  const t = p.target;
  if ((p.kind === "correction" || p.kind === "figure") && "city" in t) {
    const m = repo.metrics[t.metric];
    const src = repo.registry.find((e) => e.id === t.source);
    const primary = p.citations.find((c) => c.primary);
    if (!m || !src || !primary || !p.period || !p.level) return null;
    const parsed = parseValue(m, p.proposed);
    if (!("value" in parsed)) return null;
    const file: CorrectionsFile = o.current ? (JSON.parse(o.current) as CorrectionsFile) : { about: CORRECTIONS_ABOUT, corrections: [] };
    const entry: Correction = {
      city: t.city,
      metric: t.metric,
      source: src.id,
      value: parsed.value,
      period: p.period,
      level: p.level,
      url: primary.url,
      ...(p.current ? { note: `Before the correction: ${p.current}` } : {}),
      correction: { on: o.on, issue: o.issue, citation: { publisher: primary.publisher, title: primary.title, url: primary.url, accessed: primary.accessed, ...(primary.quote ? { quote: primary.quote } : {}) } },
      reviewBy: addDays(o.on, reviewDays(src)),
    };
    const rest = file.corrections.filter((c) => !(c.city === entry.city && c.metric === entry.metric && c.source === entry.source));
    const corrections = [...rest, entry].sort((a, b) => a.city.localeCompare(b.city) || a.metric.localeCompare(b.metric) || a.source.localeCompare(b.source));
    return { path: CORRECTIONS_FILE, content: `${JSON.stringify({ about: file.about || CORRECTIONS_ABOUT, corrections }, null, 2)}\n`, summary: `Correct ${t.metric} for ${t.city} from ${src.id} (#${o.issue})` };
  }
  if (p.kind === "link" && "file" in t) {
    const id = /^registry\/([a-z0-9-]+)\.json$/.exec(t.file)?.[1];
    if (!id || o.current === null) return null;
    const content = setString(o.current, t.path, p.proposed.trim());
    return content === null ? null : { path: t.file, content, summary: `Update ${t.path} in registry/${id}.json (#${o.issue})` };
  }
  return null;
}

/** A corrected figure stays until the source's next release could replace it, and at least 90 days. */
function reviewDays(src: RegistryEntry): number {
  return Math.max(90, Math.min(src.refresh?.maxAgeDays ?? 365, 730));
}

/** Replaces one string value at a dotted path in a JSON text, keeping the rest of the text as it is written. */
export function setString(text: string, path: string, value: string): string | null {
  const obj = JSON.parse(text) as Record<string, unknown>;
  const keys = path.split(".");
  let at: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) {
    const next = at[k];
    if (!next || typeof next !== "object") return null;
    at = next as Record<string, unknown>;
  }
  const last = keys.at(-1)!;
  const old = at[last];
  if (old !== undefined && typeof old !== "string") return null;
  if (old === value) return null;
  if (typeof old === "string") {
    const needle = `${JSON.stringify(last)}: ${JSON.stringify(old)}`;
    const first = text.indexOf(needle);
    if (first >= 0 && text.indexOf(needle, first + 1) < 0) return text.replace(needle, () => `${JSON.stringify(last)}: ${JSON.stringify(value)}`);
  }
  at[last] = value;
  return `${JSON.stringify(obj, null, 2)}\n`;
}
