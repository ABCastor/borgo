// Typical home internet download speed per city, from Measurement Lab's NDT speed tests, CC0.
// M-Lab's public statistics (daily aggregates by city, located by IP) stopped updating in March 2024, so the
// last complete year is 2023: a dated figure, shown as such. NDT measures one TCP stream to M-Lab's servers,
// so it reads lower than multi-stream tests such as Ookla's; compare cities with each other, not with your plan.
// Ookla's open data would be fresher, but its CC BY-NC-SA licence is incompatible with this dataset.
import { getText, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import { fold } from "../parsers.ts";
import type { City } from "../../src/core/types.ts";

const BASE = "https://statistics.measurementlab.net";
const YEAR = 2023;
const CONTINENT: Record<string, string> = { US: "NA", CA: "NA", SG: "AS", JP: "AS", AE: "AS", AU: "OC", NZ: "OC" };

interface Day { date: string; download_MED: number; dl_samples_day: number }

/** First-level regions M-Lab files the country's cities under, e.g. "IT-21". */
async function regions(cont: string, cc: string): Promise<string[]> {
  const xml = await getText(`${BASE}/?prefix=v0/${cont}/${cc}/&delimiter=/`);
  return [...xml.matchAll(/<Prefix>v0\/[A-Z]+\/[A-Z]+\/([^/<]+-[^/<]+)\/<\/Prefix>/g)].map((m) => m[1]!);
}

async function year(cont: string, cc: string, region: string, name: string): Promise<Day[] | null> {
  const url = `${BASE}/v0/${cont}/${cc}/${region}/${encodeURIComponent(name)}/${YEAR}/histogram_daily_stats.json`;
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) return null;
  const rows = JSON.parse(await getText(url)) as Day[];
  // One row per day and histogram bucket; the day's median and sample count repeat in each.
  const days = new Map<string, Day>();
  for (const r of rows) days.set(r.date, r);
  return [...days.values()];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "mlab", retrieved, observations: {} };
const regionCache = new Map<string, string[]>();
for (const c of cities) {
  const cont = CONTINENT[c.country] ?? "EU";
  if (!regionCache.has(c.country)) regionCache.set(c.country, await regions(cont, c.country));
  const all = regionCache.get(c.country)!;
  const ordered = c.region && all.includes(c.region) ? [c.region, ...all.filter((r) => r !== c.region)] : all;
  const names = [...new Set([c.name, ...(c.aliases ?? [])])];
  // The busiest match wins: a big city's name can also belong to a village in another region.
  let best: { region: string; name: string; days: Day[]; tests: number } | null = null;
  for (const region of ordered) {
    for (const name of names) {
      const days = await year(cont, c.country, region, name);
      if (!days) continue;
      const tests = days.reduce((s, d) => s + d.dl_samples_day, 0);
      if (!best || tests > best.tests) best = { region, name, days, tests };
    }
  }
  if (!best || best.days.length < 200) {
    out.observations[c.id] = [];
    console.log(`${c.id}: no M-Lab city series for ${YEAR}`);
    continue;
  }
  const mbps = Math.round(median(best.days.map((d) => d.download_MED)) * 10) / 10;
  out.observations[c.id] = [
    {
      metric: "download_mbps",
      value: mbps,
      period: String(YEAR),
      level: "city",
      source: "mlab",
      retrieved,
      note: `median of daily median NDT download speeds, ${best.days.length} days, ${best.tests.toLocaleString("en-GB")} tests (${best.name}, ${best.region})`,
    },
  ];
  console.log(c.id.padEnd(18), mbps, best.days.length, best.tests, best.region, fold(best.name));
}
await writeJson("data/observations/mlab.json", out);
