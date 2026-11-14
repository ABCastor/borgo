// Why a city scores what it does on Work and ambition for the person's kind of work, in plain sentences: where it ranks
// among the compared cities, and what each part that counts reads there, with the figure's own description. The app's
// city sheet, the terminal and the agents all say it from here. Browser-safe.
import type { Evaluation, LineResult } from "./engine.ts";
import { groupOf } from "./groups.ts";
import { criterionById } from "./criteria.ts";
import { resolve, scalar } from "./lookup.ts";
import type { Dataset, Profile } from "./types.ts";
import { kindOf, kindWords } from "./work.ts";

export interface WorkWhy {
  /** "For software and IT, San Francisco ranks 1st of your 15 cities on Work and ambition (94 of 100), ahead of Seattle (91)." */
  lead: string;
  /** One sentence per part that counts, heaviest first. */
  parts: string[];
  /** The group's score for this city, 0 to 100, and its rank among the compared cities. */
  score: number;
  rank: number;
}

const OWN_NOTES = new Set(["field_pay", "field_jobs", "young_companies"]);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const isAmbition = (l: LineResult) => {
  const c = criterionById(l.id);
  return !!c && groupOf(c) === "ambition" && l.weight > 0;
};

/** The Work and ambition score of every compared city: its parts' scores, weighted, out of 100 (a gap scores as the engine scored it). */
export function ambitionScores(e: Evaluation): Map<string, number> {
  return new Map(
    e.results.map((r) => {
      const ls = r.lines.filter(isAmbition);
      const w = ls.reduce((t, l) => t + l.weight, 0);
      return [r.city.id, w ? (100 * ls.reduce((t, l) => t + l.weight * (l.score ?? 0), 0)) / w : 0];
    }),
  );
}

/** Null without a kind of work, or when nothing in Work and ambition counts. */
export function workWhy(data: Dataset, profile: Profile, e: Evaluation, cityId: string): WorkWhy | null {
  const k = kindOf(profile);
  const me = e.results.find((r) => r.city.id === cityId);
  if (!k || !me) return null;
  const mine = me.lines.filter(isAmbition).sort((a, b) => b.weight - a.weight);
  if (!mine.length) return null;
  const scores = ambitionScores(e);
  const order = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const rank = order.findIndex(([id]) => id === cityId) + 1;
  const score = scores.get(cityId)!;
  const name = (id: string) => e.results.find((r) => r.city.id === id)!.city.name;
  const n = order.length;
  const what = `For ${kindWords(k)}`;
  let lead = `${what}, ${me.city.name} scores ${Math.round(score)} of 100 on Work and ambition`;
  if (n > 1) {
    const other = rank === 1 ? order[1]! : order[0]!;
    lead += rank === 1 ? `, first of your ${n} cities, ahead of ${name(other[0])} (${Math.round(other[1])})` : `, ${ordinal(rank)} of your ${n} cities, behind ${name(other[0])} (${Math.round(other[1])})`;
  }
  lead += ".";

  const parts = mine.map((l) => {
    const label = l.label;
    if (l.imputed || l.raw.value === null) return `${label}: no figure for ${me.city.name}, so it scores as the lowest of your cities.`;
    const values = e.results.map((r) => r.lines.find((x) => x.id === l.id)).filter((x): x is LineResult => !!x && x.raw.value !== null && !x.imputed);
    const better = values.filter((x) => (x.score ?? 0) > (l.score ?? 0) + 1e-9).length;
    const place = values.length < 2 ? "" : better === 0 ? ", the best of your cities" : better === values.length - 1 ? ", the lowest of your cities" : `, ${ordinal(better + 1)} of ${values.length}`;
    // The kind's own figures say what they count; the other parts' notes are for their source popovers.
    const src = OWN_NOTES.has(l.id) ? l.raw.sources[0] : undefined;
    const note = src && src.origin.kind === "source" ? src.origin.observation.note : undefined;
    return `${label}: ${l.raw.text}${place}${note ? ` (${note.charAt(0).toLowerCase()}${note.slice(1)})` : ""}.`;
  });
  // Work in a language you may not speak: say so where most people speak no English.
  const en = scalar(resolve(data, profile, me.city, "english_share"));
  const official = scalar(resolve(data, profile, me.city, "english_official"));
  if (en !== null && en < 60 && official !== 1) parts.push(`About ${Math.round(en)}% of people in the country speak English, so many jobs ask for the local language.`);
  return { lead, parts, score, rank };
}
