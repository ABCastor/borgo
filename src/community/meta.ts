// The places that take community figures, built with the site into api/community/places.json: the dataset's cities
// and the towns on the map, with the ids the app gives them, each place's currency, the euro rates that turn the
// plausibility bounds into it, and the official figures a community figure stands beside.
import { resolve } from "../core/lookup.ts";
import { convert } from "../core/money.ts";
import type { Dataset } from "../core/types.ts";
import { cityId } from "../places/resolve.ts";
import { referenceProfile } from "../site/facts.ts";
import { FIGURES, type PlacesMeta } from "./figures.ts";

/** A map town as public/data/map.json lists it: name, country, lat, lon, population, GeoNames id, ... */
export type MapPlace = [string, string, number, number, number, number, ...unknown[]];

export function placesMeta(data: Dataset, towns: MapPlace[]): PlacesMeta {
  const places: PlacesMeta["places"] = {};
  const currency = (cc: string) => data.countries[cc]?.currency;
  for (const c of data.cities) {
    const cur = currency(c.country);
    if (cur) places[c.id] = [c.name, c.country, cur];
  }
  const known = new Set(data.cities.map((c) => `${c.name.toLowerCase()}|${c.country}`));
  for (const [name, cc, , , , geonames] of towns) {
    const cur = currency(cc);
    if (!cur || known.has(`${name.toLowerCase()}|${cc}`)) continue;
    const id = cityId(name, cc, undefined, String(geonames), (x) => x in places);
    places[id] = [name, cc, cur];
  }
  const official: PlacesMeta["official"] = {};
  const profile = referenceProfile(data, []);
  const metrics = [...new Set(FIGURES.map((f) => f.official).filter((m): m is string => !!m))];
  for (const c of data.cities) {
    const cur = currency(c.country);
    for (const m of metrics) {
      const r = resolve(data, profile, c, m);
      if (!r || typeof r.value !== "number" || r.origin.kind === "you") continue;
      const unitCur = data.metrics[m]?.currency;
      const value = unitCur && unitCur !== "local" && cur ? convert(data, r.value, unitCur, cur) : r.value;
      if (value === null || !cur) continue;
      const o = r.origin.observation;
      (official[c.id] ??= {})[m] = { value: Math.round(value * 100) / 100, source: data.sources[o.source]?.publisher ?? o.source, period: o.period };
    }
  }
  return { places, fx: { ...data.fx.rates }, official };
}
