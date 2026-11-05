// Is there a Founders Running Club chapter in the city? Read from the club's public communities page.
// A chapter's presence is a fact. robots.txt allows /communities, and the site's only terms (foundersrc.com/terms,
// February 2026) govern members' Strava and LinkedIn data, not this list. We store presence, the chapter's
// link and the date read; nothing about members.
import { getText, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import { chapters, fold } from "../parsers.ts";
import type { City } from "../../src/core/types.ts";

const PAGE = "https://foundersrc.com/communities";

const html = await getText(PAGE);
const found = chapters(html);
if (found.size < 10) throw new Error(`only ${found.size} chapters parsed from ${PAGE}: the page layout changed`);

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "foundersrc", retrieved, observations: {} };
for (const c of cities) {
  const name = [c.name, ...(c.aliases ?? [])].map(fold).find((n) => found.has(n));
  out.observations[c.id] = [
    {
      metric: "founders_running_club",
      value: name ? 1 : 0,
      period: retrieved,
      level: "city",
      source: "foundersrc",
      retrieved,
      note: name ? `Chapter: ${found.get(name)}` : `No chapter listed on ${PAGE}`,
    },
  ];
}
await writeJson("data/observations/foundersrc.json", out);
const yes = cities.filter((c) => out.observations[c.id]![0]!.value === 1).map((c) => c.name);
console.log(`${found.size} chapters listed; ${yes.length} of our cities have one: ${yes.join(", ")}`);
