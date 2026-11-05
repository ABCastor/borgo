// Median monthly rent of non-subsidised two-room flats in Helsinki, from Statistics Finland's rents of dwellings
// (table 15fc, CC BY 4.0). Finnish rooms leave out the kitchen: a two-room flat is one bedroom. The table's largest
// class is "three rooms or more" (two bedrooms or more), so it gives no three-bedroom figure. Every tenancy.
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const URL = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/asvu/15fc.px";
const query = {
  query: [
    { code: "alue_44_20260101", selection: { filter: "item", values: ["091"] } },
    { code: "huoneluku_5_20260101", selection: { filter: "item", values: ["2"] } },
    { code: "timeperiod_q", selection: { filter: "top", values: ["1"] } },
    { code: "contentscode", selection: { filter: "item", values: ["asvu_mediaani"] } },
  ],
  response: { format: "json" },
};
const res = await fetch(URL, { method: "POST", body: JSON.stringify(query) });
if (!res.ok) throw new Error(`Statistics Finland ${res.status}`);
const d = (await res.json()) as { data: { key: string[]; values: string[] }[] };
const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "statfin-rent", retrieved, observations: {} };
const r = d.data[0];
const v = Number(r?.values[0]);
if (r && Number.isFinite(v) && v > 0 && cities.some((c) => c.id === "helsinki-fi"))
  out.observations["helsinki-fi"] = [{ metric: "rent_1bed", value: v, period: r.key[2]!, level: "city", source: "statfin-rent", retrieved, note: "Helsinki, non-subsidised two-room flats (one bedroom), median monthly rent of every tenancy (Statistics Finland table 15fc)" }];
console.log(out.observations);
await writeJson("data/observations/statfin-rent.json", out);
