// A place's left-right figure from one official election result and ParlGov's party positions. Kept apart from
// pipeline/sources/politics.ts, which downloads ParlGov, so the arithmetic can be tested without a network.
import type { PlacePolitics } from "../src/fetch/politics.ts";

/** One party's ParlGov 2024 figure. `family` marks ParlGov's stand-in for parties no expert survey covers: the mean of their party family. */
export interface PartyEstimate {
  id: number;
  /** ISO alpha-2 country of the ParlGov party. */
  country: string;
  name: string;
  position: number;
  family: boolean;
}

/** An official result as entered in pipeline/inputs/politics.json. */
export interface ElectionResult {
  place: string;
  election: string;
  date: string;
  url: string;
  checked: string;
  /** All valid votes in the stated contest, including votes for parties without a position. */
  valid: number;
  votes: {
    name: string;
    votes: number;
    /** ParlGov party ids: one for a party, several for an alliance (its members' mean). None: no position. */
    parlgov?: number[];
    /** Why a party has no position, or how its ParlGov entry was matched. */
    note?: string;
  }[];
}

/** Below this share of the vote with a position, a place gets no figure: the parties left out could move it anywhere. */
export const MIN_COVERED = 0.75;

const round1 = (v: number) => Math.round(v * 10) / 10;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * The vote-weighted mean position of the parties with one. Nothing is imputed: a party without a ParlGov entry has no
 * position, and its votes stay in the denominator of the coverage share. Shares are of all valid votes.
 */
export function positionResult(r: ElectionResult, parlgov: ReadonlyMap<number, PartyEstimate>): PlacePolitics {
  if (!(r.valid > 0) || !r.url.startsWith("https://") || !isDate(r.checked) || !isDate(r.date) || r.date > r.checked) throw new Error(`Invalid election metadata: ${r.place}`);
  const country = r.place.slice(0, 2);
  let weighted = 0;
  let positioned = 0;
  let listed = 0;
  const names = new Set<string>();
  const parties = r.votes.map((v) => {
    if (!Number.isFinite(v.votes) || v.votes < 0 || names.has(v.name)) throw new Error(`Invalid or duplicate votes: ${r.place} ${v.name}`);
    names.add(v.name);
    listed += v.votes;
    const estimates = (v.parlgov ?? []).map((id) => {
      const p = parlgov.get(id);
      if (!p) throw new Error(`${r.place} ${v.name}: ParlGov party ${id} has no left-right figure`);
      if (p.country !== country) throw new Error(`${r.place} ${v.name}: ParlGov party ${id} is in ${p.country}`);
      return p;
    });
    const position = estimates.length ? estimates.reduce((s, p) => s + p.position, 0) / estimates.length : null;
    if (position !== null) {
      positioned += v.votes;
      weighted += v.votes * position;
    }
    const basis = estimates.length > 1 ? ("members" as const) : estimates[0] ? (estimates[0].family ? ("family" as const) : ("expert" as const)) : null;
    return { name: v.name, share: round1((100 * v.votes) / r.valid), position: position === null ? null : round1(position), basis };
  });
  // Party-strength tables (valid 100) and rounded percentages (valid 10,000) round each share on its own.
  const allowance = r.valid === 100 || r.valid === 10_000 ? r.valid * 0.002 : 0;
  if (listed > r.valid + allowance) throw new Error(`Listed votes exceed valid votes: ${r.place}`);
  const covered = Math.min(1, positioned / r.valid);
  return {
    position: covered >= MIN_COVERED ? round1(weighted / positioned) : null,
    election: r.election,
    date: r.date,
    source: "official",
    url: r.url,
    checked: r.checked,
    covered: Math.round(covered * 10000) / 10000,
    parties: parties.sort((a, b) => b.share - a.share),
  };
}
