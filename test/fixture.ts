import type { Dataset, Observation, Profile } from "../src/core/types.ts";

const obs = (metric: string, value: number | number[], level: Observation["level"] = "city", period = "2025"): Observation => ({
  metric,
  value,
  period,
  level,
  source: "test",
  retrieved: "2026-10-27",
});

export function fixture(): Dataset {
  return {
    version: "test",
    builtAt: "2026-10-27",
    cities: [
      { id: "turin-it", name: "Torino", country: "IT", region: "IT-21", lat: 45.07, lon: 7.69 },
      { id: "dublin-ie", name: "Dublin", country: "IE", lat: 53.35, lon: -6.26 },
      { id: "london-gb", name: "London", country: "GB", region: "GB-ENG", lat: 51.51, lon: -0.13 },
      { id: "san-francisco-us", name: "San Francisco", country: "US", region: "US-CA", lat: 37.77, lon: -122.42 },
    ],
    countries: {
      IT: { code: "IT", name: "Italy", currency: "EUR", areas: ["EU"] },
      IE: { code: "IE", name: "Ireland", currency: "EUR", areas: ["EU", "CTA"] },
      GB: { code: "GB", name: "United Kingdom", currency: "GBP", areas: ["CTA"] },
      US: { code: "US", name: "United States", currency: "USD", areas: [] },
    },
    sources: { test: { id: "test", name: "Test", publisher: "Test", url: "https://example.org", licence: "CC0-1.0", redistributable: true } },
    metrics: {},
    observations: {
      "turin-it": [obs("rent_1bed", 800), obs("price_level", 100, "country"), obs("pm25", 20), obs("temp_high", [6, 9, 14, 17, 21, 26, 28, 28, 23, 17, 11, 7]), obs("temp_low", [-1, 1, 4, 8, 12, 16, 18, 18, 14, 9, 4, 0])],
      "dublin-ie": [obs("rent_1bed", 2200), obs("price_level", 125, "country"), obs("pm25", 8), obs("pm25", 9, "country", "2026")],
      "london-gb": [obs("rent_1bed", 2100), obs("price_level", 120, "country"), obs("pm25", 12)],
      "san-francisco-us": [obs("rent_1bed", 3600), obs("price_level", 140, "country"), obs("pm25", 8)],
    },
    fx: { base: "EUR", date: "2026-10-26", source: "test", rates: { GBP: 0.85, USD: 1.1 } },
    rights: [
      { id: "EU", name: "EU free movement", members: ["IT", "IE"], territory: ["IT", "IE"], source: "test" },
      { id: "CTA", name: "Common Travel Area", members: ["IE", "GB"], territory: ["IE", "GB"], source: "test" },
    ],
  };
}

export function profile(over: Partial<Profile> = {}): Profile {
  return {
    name: "test",
    displayCurrency: "EUR",
    cities: ["turin-it", "dublin-ie", "london-gb", "san-francisco-us"],
    household: [
      { label: "Me", citizenships: ["IT"] },
      { label: "Partner", citizenships: ["IT"] },
    ],
    housing: { size: "1bed" },
    income: {
      mode: "same",
      gross: 60_000,
      currency: "EUR",
      perCity: {},
      taxTweaks: {},
      everyday: { amount: 900, currency: "EUR", homeCity: "turin-it" },
      savings: 20_000,
    },
    weights: {},
    personal: [],
    prefs: { comfort: { min: 12, max: 24 }, normalise: "absolute", missing: "average" },
    overrides: {},
    dealBreakers: [],
    ...over,
  };
}
