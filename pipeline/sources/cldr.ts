// English in daily life, by country, from the Unicode CLDR territory data (Unicode License v3).
// CLDR estimates the share of each territory's population that speaks a language, compiled from censuses and
// surveys such as the Eurobarometer, and marks official status. Country-wide and approximate: a capital usually
// speaks more English than the national figure suggests. Countries CLDR gives no English figure for stay missing.
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

const URL = "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/territoryInfo.json";

interface Language { _populationPercent?: string; _officialStatus?: string }
interface TerritoryInfo {
  supplemental: { version: { _cldrVersion: string }; territoryInfo: Record<string, { languagePopulation?: Record<string, Language> }> };
}

const data = await getJson<TerritoryInfo>(URL);
const version = data.supplemental.version._cldrVersion;
const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "cldr", retrieved, observations: {} };
for (const c of cities) {
  const en = data.supplemental.territoryInfo[c.country]?.languagePopulation?.en;
  const base = { period: `CLDR ${version}`, level: "country" as const, source: "cldr", retrieved };
  const official = en?._officialStatus === "official" || en?._officialStatus === "de_facto_official";
  const list: Observation[] = [{ metric: "english_official", value: official ? 1 : 0, ...base, note: official ? `English is ${en!._officialStatus!.replace(/_/g, " ")}` : "English is not an official language" }];
  if (en?._populationPercent) list.push({ metric: "english_share", value: Number(en._populationPercent), ...base, note: "share of the population that speaks English, any level" });
  out.observations[c.id] = list;
}
await writeJson("data/observations/cldr.json", out);
console.log(`CLDR ${version}: ${Object.values(out.observations).filter((l) => l.length > 1).length} of ${cities.length} cities have an English share`);
