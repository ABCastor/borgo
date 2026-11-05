// The regions the tax rules name, by the GeoNames id of the first-level division: lets a fetched city get its
// ISO 3166-2 code even when Wikidata is busy. Read from Wikidata (P1566 -> P300) on 27 Oct 2026. Any other region
// is looked up live; a region missing from both only means the national rates apply.
export const REGION_BY_GEONAMES: Record<string, string> = {
  "3170831": "IT-21", // Piedmont
  "3182306": "IT-77", // Basilicata
  "2523119": "IT-82", // Sicily
  "3117732": "ES-MD",
  "3125609": "ES-CT",
  "2593113": "ES-VC",
  "2593109": "ES-AN",
  "2657895": "CH-ZH",
  "2660645": "CH-GE",
  "6115047": "CA-QC",
  "6093943": "CA-ON",
  "5909050": "CA-BC",
  "6269131": "GB-ENG",
  "2638360": "GB-SCT",
  "2634895": "GB-WLS",
  "2641364": "GB-NIR",
  "5332921": "US-CA",
  "5815135": "US-WA",
  "4736286": "US-TX",
  "4662168": "US-TN",
  "5128638": "US-NY",
  "5509151": "US-NV",
  "6254926": "US-MA",
  "4896861": "US-IL",
  "4155751": "US-FL",
  "5417618": "US-CO",
};
