// "Add any city" while typing: the seed cities are already in the list; any other place the geocoder knows is
// suggested as the person types, with its region, country and population, and an island or a country shows the town
// it stands for ("Arrecife, the main town of Lanzarote"). Picking a suggestion adds that exact place by GeoNames id.
import type { City, Country } from "../core/types.ts";
import { fold, makeCtx } from "../fetch/context.ts";
import { resolvePlace, type Town } from "../places/resolve.ts";

let towns: Promise<Town[]> | null = null;

/** The map's towns (Natural Earth), read once and only when a name turns out to be an island or a country. */
export function browserTowns(): Promise<Town[]> {
  towns ??= fetch("data/map.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ places?: Town[] }>) : { places: [] }))
    .then((m) => m.places ?? [])
    .catch(() => {
      towns = null;
      return [];
    });
  return towns;
}

/** Suggestion text -> GeoNames id, for the options this module added. */
const picked = new Map<string, string>();
let timer = 0;
let asked = 0;

/** The GeoNames query for a suggestion the person picked, or null when the text is their own. */
export function pickedPlace(text: string): string | null {
  const id = picked.get(text);
  return id ? `geonames:${id}` : null;
}

/**
 * A city already in the data for what was typed: "Lisbon", or "Cambridge, United Kingdom" from the list. A name with a
 * qualifier after the comma matches only when the qualifier is that city's country (code or name) or region, so
 * "Cambridge, US" or "London, CA" goes to the geocoder instead of to the seed city of the same name.
 */
export function knownCity(data: { countries: Record<string, Country>; cities: City[] }, text: string, countryName: (iso: string) => string = (iso) => iso): City | undefined {
  const [name = "", ...rest] = text.split(",").map((x) => x.trim());
  const qual = fold(rest.join(", "));
  const named = data.cities.filter((c) => fold(c.name) === fold(name) || c.aliases?.some((a) => fold(a) === fold(name)));
  if (!qual) return named.length === 1 ? named[0] : undefined;
  return named.find((c) => [c.country, countryName(c.country), data.countries[c.country]?.name ?? "", c.region ?? ""].some((x) => x && fold(x) === qual));
}

/** Suggests places for what is typed so far, after a short pause; stale answers are dropped. */
export function suggestPlaces(input: HTMLInputElement, data: { countries: Record<string, Country>; cities: City[] }): void {
  clearTimeout(timer);
  const text = input.value.trim();
  if (text.length < 3 || picked.has(text)) return;
  const list = document.getElementById(input.getAttribute("list") ?? "");
  if (!list) return;
  // A seed city's own name needs no geocoder; a name with a qualifier ("Cambridge, US") may be another place, so it asks.
  const seed = !text.includes(",") && data.cities.some((c) => fold(c.name) === fold(text) || c.aliases?.some((a) => fold(a) === fold(text)));
  if (seed) return;
  timer = window.setTimeout(async () => {
    const n = ++asked;
    let found;
    try {
      found = await resolvePlace(text, makeCtx({ runtime: "browser", timeout: 8_000 }), { countries: data.countries, known: data.cities, limit: 6, regions: false, towns: browserTowns });
    } catch {
      return; // suggestions are a help: a busy geocoder only means none
    }
    if (n !== asked || input.value.trim() !== text) return;
    list.querySelectorAll("option[data-found]").forEach((o) => o.remove());
    for (const r of found) {
      if (r.known || !r.city.geonames) continue;
      const value = `${r.city.name}, ${r.label}`;
      picked.set(value, r.city.geonames);
      const o = document.createElement("option");
      o.value = value;
      o.dataset.found = "";
      // Browsers match the typed text against the option: an older name or an island's name stays findable.
      if (!fold(value).includes(fold(text))) o.label = `${value} (${text})`;
      list.append(o);
    }
  }, 300);
}
