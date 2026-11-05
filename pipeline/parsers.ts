// Parsers for what sources publish, kept apart from the fetching scripts so they can be tested offline.

export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Chapter name -> its link (Instagram or chat), from the page's buttons. Specials such as Burning Man are kept too; no city matches them. */
export function chapters(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*?href="([^"]+)"[^>]*>\s*<div class="t993__btn-text-wrapper">\s*<div class="t993__btn-text-title">([^<]+)<\/div>/g)) {
    out.set(fold(m[2]!), m[1]!);
  }
  return out;
}

// The Urban Audit's JSON-stat reader lives with its fetcher.
export { byCityYear, type JsonStat } from "../src/fetch/eurostat-urban.ts";

/**
 * Adults aged 25 to 64 with an associate's degree or higher, from B15001 (sex by age by attainment, 18 and over). Each
 * age group's total is followed by seven attainment lines, the last three being associate's, bachelor's and graduate.
 */
export function degreeShare(row: Record<string, number>): number {
  const groups = [11, 19, 27, 52, 60, 68]; // male 25-34, 35-44, 45-64; female the same
  const col = (n: number) => row[`B15001_E${String(n).padStart(3, "0")}`]!;
  let all = 0, tertiary = 0;
  for (const g of groups) (all += col(g)), (tertiary += col(g + 5) + col(g + 6) + col(g + 7));
  return Math.round((1000 * tertiary) / all) / 10;
}
