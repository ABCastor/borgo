// Median rents in Stockholm municipality by number of rooms, from Statistics Sweden's rents for dwellings (BO0406,
// table BO0406Tab03, CC0). Swedish rooms leave out the kitchen: 2 rooms is one bedroom, "4 rooms or more" three
// bedrooms or more. Annual rent per dwelling, every rented dwelling (mostly rents set by negotiation), divided by 12.
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const URL = "https://api.scb.se/OV0104/v1/doris/en/ssd/BO/BO0406/BO0406E/BO0406Tab03";
const query = {
  query: [
    { code: "Region", selection: { filter: "item", values: ["0180"] } },
    { code: "AntalRum", selection: { filter: "item", values: ["2", "4"] } },
    { code: "Hyresuppg", selection: { filter: "item", values: ["Ah_lgh"] } },
    { code: "ContentsCode", selection: { filter: "item", values: ["00000126"] } },
    { code: "Tid", selection: { filter: "top", values: ["1"] } },
  ],
  response: { format: "json" },
};
const res = await fetch(URL, { method: "POST", body: JSON.stringify(query) });
if (!res.ok) throw new Error(`SCB ${res.status}`);
const d = (await res.json()) as { data: { key: string[]; values: string[] }[] };
const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "scb-rent", retrieved, observations: {} };
const stockholm = cities.find((c) => c.id === "stockholm-se");
const row = (rooms: string) => d.data.find((r) => r.key[1] === rooms);
if (stockholm) {
  out.observations[stockholm.id] = [];
  for (const [metric, rooms, words] of [["rent_1bed", "2", "2-room homes (one bedroom)"], ["rent_3bed", "4", "homes of 4 rooms or more (three bedrooms or more)"]] as const) {
    const r = row(rooms);
    const annual = Number(r?.values[0]);
    if (!r || !Number.isFinite(annual) || annual <= 0) continue;
    out.observations[stockholm.id]!.push({ metric, value: Math.round(annual / 12), period: r.key[3]!, level: "city", source: "scb-rent", retrieved, note: `Stockholm municipality, ${words}, median annual rent of every rented dwelling (${annual} SEK) divided by 12 (SCB BO0406)` });
  }
}
console.log(out.observations);
await writeJson("data/observations/scb-rent.json", out);
