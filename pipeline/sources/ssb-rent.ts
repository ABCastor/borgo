// Average monthly rents in Oslo and Bærum by number of rooms, from Statistics Norway's rental market survey (table
// 09895, CC BY 4.0). Norwegian rooms leave out the kitchen: 2 rooms is one bedroom, 4 rooms three bedrooms.
// Every tenancy in the survey, old and new.
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const URL = "https://data.ssb.no/api/v0/en/table/09895";
const query = {
  query: [
    { code: "Soner2", selection: { filter: "item", values: ["01"] } },
    { code: "AntRom", selection: { filter: "item", values: ["2", "4"] } },
    { code: "ContentsCode", selection: { filter: "item", values: ["Husleie"] } },
    { code: "Tid", selection: { filter: "top", values: ["1"] } },
  ],
  response: { format: "json-stat2" },
};
const res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
if (!res.ok) throw new Error(`SSB ${res.status}`);
const d = (await res.json()) as { value: number[]; dimension: { Tid: { category: { label: Record<string, string> } } } };
const year = Object.keys(d.dimension.Tid.category.label)[0]!;
const [two, four] = d.value;
const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "ssb-rent", retrieved, observations: {} };
const oslo = cities.find((c) => c.id === "oslo-no");
if (oslo && two && four) {
  const base = { period: year, level: "metro" as const, source: "ssb-rent", retrieved };
  out.observations[oslo.id] = [
    { metric: "rent_1bed", value: two, ...base, note: "Oslo and Bærum, 2-room homes (one bedroom), average monthly rent of every tenancy surveyed (SSB table 09895)" },
    { metric: "rent_3bed", value: four, ...base, note: "Oslo and Bærum, 4-room homes (three bedrooms), average monthly rent of every tenancy surveyed (SSB table 09895)" },
  ];
}
console.log(year, out.observations);
await writeJson("data/observations/ssb-rent.json", out);
