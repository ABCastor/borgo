import type { City } from "./types.ts";

export interface LinkOut {
  label: string;
  url: string;
  /** Who publishes it; these sources may be linked to but not copied. */
  publisher: string;
}

/** Pages about a city on sites whose data we may not redistribute: a person can read them there. */
export function linksOut(city: City): LinkOut[] {
  const dashed = encodeURIComponent(city.name.replace(/ /g, "-"));
  return [
    { label: `Numbeo: cost of living in ${city.name}`, url: `https://www.numbeo.com/cost-of-living/in/${dashed}`, publisher: "Numbeo" },
    { label: "WeatherSpark: year-round weather", url: `https://weatherspark.com/search?q=${encodeURIComponent(city.name)}`, publisher: "WeatherSpark" },
    { label: "Wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(city.name.replace(/ /g, "_"))}`, publisher: "Wikipedia" },
  ];
}

/** Publishers whose data is proprietary or forbids redistribution: link out, never copy (decision D2). */
export const LINK_ONLY = [
  "Numbeo",
  "WeatherSpark",
  "IQAir",
  "Economist Intelligence Unit",
  "Oxford Economics",
  "InterNations",
  "Startup Genome",
  "Passport Index",
  "World Happiness Report",
];
