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
    { label: `Numbeo: quality of life in ${city.name}`, url: `https://www.numbeo.com/quality-of-life/in/${dashed}`, publisher: "Numbeo" },
    { label: `Crunchbase: companies in ${city.name}`, url: `https://www.crunchbase.com/hub/${encodeURIComponent(city.name.toLowerCase().replace(/ /g, "-"))}-companies`, publisher: "Crunchbase" },
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
  "Mercer",
  "Monocle",
  "Crunchbase",
  "Dealroom",
];

/** Quality-of-life indices made by others, with their own weights: read there, never copied. */
export const QOL_INDICES: LinkOut[] = [
  { label: "Numbeo Quality of Life Index", url: "https://www.numbeo.com/quality-of-life/", publisher: "Numbeo" },
  { label: "Mercer Quality of Living city ranking", url: "https://www.mercer.com/insights/total-rewards/talent-mobility-insights/quality-of-living-city-ranking/", publisher: "Mercer" },
  { label: "EIU Global Liveability Index", url: "https://www.eiu.com/n/campaigns/global-liveability-index/", publisher: "Economist Intelligence Unit" },
  { label: "Monocle Quality of Life Survey", url: "https://monocle.com/", publisher: "Monocle" },
];

/** Where founders read about startups and funding by city: proprietary, so linked, never copied. */
export const STARTUP_LINKS: LinkOut[] = [
  { label: "Startup Genome ecosystem rankings", url: "https://startupgenome.com/ecosystems", publisher: "Startup Genome" },
  { label: "Dealroom", url: "https://dealroom.co/", publisher: "Dealroom" },
  { label: "Y Combinator company directory", url: "https://www.ycombinator.com/companies", publisher: "Y Combinator" },
];
