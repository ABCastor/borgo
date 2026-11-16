// The official rent sources, one test each, against slices of their real files (test/fixtures/rent/): the parser
// reads the figure the publisher gives, for the right city, period and unit, and the note says how it was derived.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { City, Observation } from "../src/core/types.ts";
import { scotObservations, scotRents } from "../pipeline/sources/scot-rent.ts";
import { serpaviObservations, serpaviRates } from "../pipeline/sources/es-rent.ts";
import { zensusObservations, zensusRates } from "../pipeline/sources/de-rent.ts";
import { cbsObservations, type CbsRow } from "../pipeline/sources/nl-rent.ts";
import { bfsObservations } from "../pipeline/sources/ch-rent.ts";
import { uraObservations, uraRate, type UraRow } from "../pipeline/sources/sg-rent.ts";
import { nswObservations, quarterOf } from "../pipeline/sources/au-rent.ts";
import { microcensusObservations, microcensusRate } from "../pipeline/sources/at-rent.ts";
import { ineObservations, ineRates, quarterOf as ineQuarter, type IneIndicator } from "../pipeline/sources/pt-rent.ts";
import { omiObservations, omiRates } from "../pipeline/sources/it-rent.ts";
import { estatObservations, estatRents, form } from "../pipeline/sources/jp-rent.ts";
import { quarterOf as vicQuarter, vicObservations, vicRent } from "../pipeline/sources/vic-rent.ts";
import { halfYearValue, kshObservations, kshRate } from "../pipeline/sources/hu-rent.ts";
import { gunzipSync } from "node:zlib";
import { LICENCES } from "../src/registry/licences.ts";

const ROOT = join(import.meta.dirname, "..");
const cities = JSON.parse(readFileSync(join(ROOT, "data/cities.json"), "utf8")) as City[];
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(ROOT, "test/fixtures/rent", `${name}.json`), "utf8")) as T;
const registry = (id: string) => JSON.parse(readFileSync(join(ROOT, "registry", `${id}.json`), "utf8")) as { id: string; licence: string; measures: { metric: string }[] };
const DAY = "2026-11-15";

/** rent_1bed and rent_3bed of one city, as [value, period]. */
function rents(list: Observation[] | undefined): Record<string, [number, string]> {
  return Object.fromEntries((list ?? []).map((o) => [o.metric, [o.value as number, o.period]]));
}

/** Every rent source is open, registered for both rent metrics, and its file's observations carry its id. */
function registered(id: string, file: { source: string; observations: Record<string, Observation[]> }, part = "open"): void {
  const r = registry(id);
  assert.equal(file.source, id);
  assert.ok(LICENCES[r.licence], `${id}: licence ${r.licence} is in LICENCES`);
  assert.equal(LICENCES[r.licence]!.part, part, `${id} goes into the ${part} file`);
  for (const m of ["rent_1bed", "rent_3bed"]) assert.ok(r.measures.some((x) => x.metric === m), `${id} defines ${m}`);
  for (const o of Object.values(file.observations).flat()) assert.equal(o.source, id);
}

test("scot-prs: Edinburgh is the Lothian area's mean rent for the latest year, never Glasgow's", () => {
  const { csv } = fixture<{ csv: string }>("scot-prs");
  const r = scotRents(csv, "Lothian")!;
  assert.equal(r.year, "2025");
  assert.deepEqual(r.rent_1bed, { value: 1057, records: 1754 });
  assert.deepEqual(r.rent_3bed, { value: 1802, records: 1077 });
  const file = scotObservations(csv, cities, DAY);
  registered("scot-prs", file);
  assert.deepEqual(Object.keys(file.observations), ["edinburgh-gb"]);
  assert.deepEqual(rents(file.observations["edinburgh-gb"]), { rent_1bed: [1057, "2025"], rent_3bed: [1802, "2025"] });
  assert.match(file.observations["edinburgh-gb"]![0]!.note!, /Lothian Broad Rental Market Area.*mean monthly rent.*1754 records/);
  assert.equal(scotRents(csv, "Nowhere"), null);
});

test("es-serpavi: the 2024 median rent per m² of flats, times 50 and 90 m², for the four Spanish seeds only", () => {
  const { rows } = fixture<{ rows: (string | number | null)[][] }>("es-serpavi");
  const rates = serpaviRates(rows, ["28079", "41091"]);
  assert.equal(rates["28079"]!.year, "2024", "the newest year's column, not 2023's");
  assert.equal(rates["28079"]!.leases, 300447);
  const file = serpaviObservations(rows, cities, DAY);
  registered("es-serpavi", file);
  assert.deepEqual(Object.keys(file.observations).sort(), ["barcelona-es", "madrid-es", "malaga-es", "valencia-es"], "Seville is no seed city");
  assert.deepEqual(rents(file.observations["madrid-es"]), { rent_1bed: [698, "2024"], rent_3bed: [1257, "2024"] });
  assert.deepEqual(rents(file.observations["barcelona-es"]), { rent_1bed: [684, "2024"], rent_3bed: [1231, "2024"] });
  assert.deepEqual(rents(file.observations["valencia-es"]), { rent_1bed: [409, "2024"], rent_3bed: [736, "2024"] });
  assert.deepEqual(rents(file.observations["malaga-es"]), { rent_1bed: [478, "2024"], rent_3bed: [860, "2024"] });
  assert.match(file.observations["madrid-es"]![0]!.note!, /13\.97 €\/m² × 50 m²/);
});

test("de-zensus: the census-day net cold rent per m² of the 40-59 and 80-99 m² bands, said to be sitting rents", () => {
  const { csv } = fixture<{ csv: string }>("de-zensus");
  const rates = zensusRates(csv);
  assert.deepEqual(Object.keys(rates).sort(), ["020000000000", "091620000000", "110000000000"]);
  const file = zensusObservations(csv, cities, DAY);
  registered("de-zensus", file);
  assert.deepEqual(rents(file.observations["berlin-de"]), { rent_1bed: [382, "2022"], rent_3bed: [677, "2022"] });
  assert.deepEqual(rents(file.observations["munich-de"]), { rent_1bed: [617, "2022"], rent_3bed: [1071, "2022"] });
  assert.deepEqual(rents(file.observations["hamburg-de"]), { rent_1bed: [453, "2022"], rent_3bed: [815, "2022"] });
  assert.match(file.observations["berlin-de"]![0]!.note!, /every rented flat of 40 - 59 m² on census day 15 May 2022/);
});

test("cbs-woonlasten: the latest year's median rent from private landlords, not every tenant's", () => {
  const { rows } = fixture<{ rows: CbsRow[] }>("cbs-woonlasten");
  assert.ok(rows.some((r) => r.EigenaarHuurder === "A047047" && typeof r.NettoWoonlasten_7 === "number"), "the fixture holds housing-association rents too");
  const file = cbsObservations(rows, cities, DAY);
  registered("cbs-woonlasten", file);
  assert.deepEqual(rents(file.observations["amsterdam-nl"]), { rent_1bed: [988, "2023"], rent_3bed: [1309, "2023"] });
  assert.deepEqual(rents(file.observations["rotterdam-nl"]), { rent_1bed: [741, "2024"], rent_3bed: [986, "2024"] });
  assert.match(file.observations["amsterdam-nl"]![0]!.note!, /private landlord in 2023/);
});

test("ch-bfs-rent: a Swiss 2-room flat is a one-bedroom home and a 4-room flat a three-bedroom one", () => {
  const { rows } = fixture<{ rows: (string | number | null)[][] }>("ch-bfs-rent");
  const file = bfsObservations(rows, cities, DAY);
  registered("ch-bfs-rent", file);
  assert.deepEqual(Object.keys(file.observations).sort(), ["geneva-ch", "zurich-ch"]);
  assert.deepEqual(rents(file.observations["zurich-ch"]), { rent_1bed: [1537, "2022-2024"], rent_3bed: [2085, "2022-2024"] });
  assert.deepEqual(rents(file.observations["geneva-ch"]), { rent_1bed: [1242, "2022-2024"], rent_3bed: [1773, "2022-2024"] });
});

test("sg-ura-rentals: the contract-weighted median of project medians in the latest quarter, per sq ft to m²", () => {
  const row = (qtr: string, median: string, n: string): UraRow => ({ qtr, project_name: "P", median, rental_contracts: n });
  // Half the contracts are reached at the 5.00 project: the median is 5.00, not the mean of the medians.
  const rows = [row("2026-Q3", "4.00", "10"), row("2026-Q3", "5.00", "30"), row("2026-Q3", "9.00", "20"), row("2026-Q2", "20.00", "100"), row("2026-Q3", "7.00", "0")];
  assert.deepEqual(uraRate(rows), { quarter: "2026-Q3", psf: 5, projects: 3, contracts: 60 });
  const file = uraObservations(rows, cities, DAY);
  registered("sg-ura-rentals", file);
  assert.deepEqual(rents(file.observations["singapore-sg"]), { rent_1bed: [Math.round(5 * 10.7639 * 50), "2026-Q3"], rent_3bed: [Math.round(5 * 10.7639 * 90), "2026-Q3"] });
  assert.match(file.observations["singapore-sg"]![0]!.note!, /Private non-landed homes/);
  assert.equal(uraRate([]), null);
});

test("nsw-rent-sales: Greater Sydney's median weekly rent of new bonds, as a month, for its quarter", () => {
  const { rows } = fixture<{ rows: (string | number | null)[][] }>("nsw-rent-sales");
  assert.equal(quarterOf("April to June 2026"), "2026-Q2");
  assert.equal(quarterOf("October to December 2025"), "2025-Q4");
  const file = nswObservations(rows, cities, DAY);
  registered("nsw-rent-sales", file);
  assert.deepEqual(rents(file.observations["sydney-au"]), { rent_1bed: [2990, "2026-Q2"], rent_3bed: [3467, "2026-Q2"] });
  assert.match(file.observations["sydney-au"]![0]!.note!, /A\$690 a week \(11782 bonds\), × 52 \/ 12/);
});

test("at-mikrozensus: Vienna's latest rent per m² of main tenancies, service charges included, marked as edited", () => {
  const { rows } = fixture<{ rows: (string | number | null)[][] }>("at-mikrozensus");
  const r = microcensusRate(rows, "Wien")!;
  assert.equal(r.year, "2025");
  const file = microcensusObservations(rows, cities, DAY);
  registered("at-mikrozensus", file);
  assert.deepEqual(rents(file.observations["vienna-at"]), { rent_1bed: [529, "2025"], rent_3bed: [952, "2025"] });
  assert.match(file.observations["vienna-at"]![0]!.note!, /edited: rate times a flat size/);
  assert.equal(microcensusRate(rows, "Atlantis"), null);
});

test("pt-ine-rent: the median rent per m² of new leases in Lisbon's and Porto's municipalities, not their metro areas", () => {
  const { indicator } = fixture<{ indicator: IneIndicator }>("pt-ine-rent");
  assert.equal(ineQuarter("2.º Trimestre de 2026"), "2026-Q2");
  const r = ineRates(indicator, ["1A01106", "11A1312"]);
  assert.deepEqual(r.rates, { "1A01106": 17.43, "11A1312": 14.48 }, "the metro area 11A (10.53) is not Porto");
  const file = ineObservations(indicator, cities, DAY);
  registered("pt-ine-rent", file);
  assert.deepEqual(rents(file.observations["lisbon-pt"]), { rent_1bed: [872, "2026-Q2"], rent_3bed: [1569, "2026-Q2"] });
  assert.deepEqual(rents(file.observations["porto-pt"]), { rent_1bed: [724, "2026-Q2"], rent_3bed: [1303, "2026-Q2"] });
  assert.match(file.observations["lisbon-pt"]![0]!.note!, /new lease contracts.*17\.43 €\/m² × 50 m²/);
});

test("it-omi-locazioni: new long-term open-market leases of 2025 in each Italian seed, rent per m² from the totals, in their own file", () => {
  const { csv } = fixture<{ csv: string }>("it-omi-locazioni");
  const r = omiRates(csv, ["F205", "L219", "A182"]);
  assert.equal(r.F205!.year, "2025", "the newest year, not 2024");
  assert.equal(r.F205!.homes, 29173);
  assert.equal(Math.round(r.F205!.perM2 * 100) / 100, 17.17, "412,543,596.1 € a year over 2,002,563.5 m², a twelfth");
  assert.equal(Math.round(r.L219!.perM2 * 100) / 100, 9.44);
  const file = omiObservations(csv, cities, DAY);
  registered("it-omi-locazioni", file, "omi");
  assert.deepEqual(Object.keys(file.observations).sort(), ["bologna-it", "florence-it", "milan-it", "naples-it", "rome-it", "turin-it"], "Alessandria is no seed");
  assert.deepEqual(rents(file.observations["milan-it"]), { rent_1bed: [859, "2025"], rent_3bed: [1545, "2025"] });
  assert.deepEqual(rents(file.observations["turin-it"]), { rent_1bed: [472, "2025"], rent_3bed: [850, "2025"] });
  assert.match(file.observations["rome-it"]![0]!.note!, /new leases registered in 2025, long-term open-market contracts \(ORD_L.*€13\.51 per m² a month.*× 50 m²/);
  assert.equal(LICENCES["AdE-OMI"]!.part, "omi", "not CC BY: the terms forbid handing on the data");
});

test("jp-estat-housing: Tokyo's special wards, private rents by floor area from the 2023 survey, every tenancy", () => {
  const { reply } = fixture<{ reply: Parameters<typeof estatRents>[0] }>("jp-estat-housing");
  assert.deepEqual(estatRents(reply), { rent_1bed: 105273, rent_3bed: 168226 });
  assert.throws(() => estatRents({ ...reply, requestData: { rowItemList1: "2,4", rowItemList3: "13000" } }), /other rows/, "all of Tokyo-to is not the wards");
  const file = estatObservations(reply, cities, DAY);
  registered("jp-estat-housing", file);
  assert.deepEqual(rents(file.observations["tokyo-jp"]), { rent_1bed: [105273, "2023-10"], rent_3bed: [168226, "2023-10"] });
  assert.match(file.observations["tokyo-jp"]![0]!.note!, /23 special wards.*30-49 m².*every tenancy/);
  // The form asks for exactly the wards, the two bands and rents above zero.
  const rows = JSON.parse(gunzipSync(Buffer.from(form().get("rows")!, "base64")).toString()) as { dispTableName: string; listData: { code: string }[] }[];
  assert.deepEqual(rows.map((d) => [d.dispTableName.split("_").at(-1), d.listData.map((x) => x.code)]), [["BUN01", ["0"]], ["BUN02", ["2", "4"]], ["AREA", ["13100"]]]);
});

test("vic-rental-report: the City of Melbourne's median weekly rent of new bonds for its newest quarter, as a month", () => {
  const fx = fixture<{ rent_1bed: (string | number | null)[][]; rent_3bed: (string | number | null)[][] }>("vic-rental-report");
  assert.equal(vicQuarter("Jun 2026"), "2026-Q2");
  assert.deepEqual(vicRent(fx.rent_1bed), { quarter: "Jun 2026", bonds: 2152, weekly: 580 }, "the newest quarter, not March's 600");
  assert.equal(vicRent(fx.rent_1bed, "Atlantis"), null);
  const file = vicObservations(fx, cities, DAY);
  registered("vic-rental-report", file);
  assert.deepEqual(rents(file.observations["melbourne-au"]), { rent_1bed: [2513, "2026-Q2"], rent_3bed: [4333, "2026-Q2"] });
  assert.match(file.observations["melbourne-au"]![0]!.note!, /City of Melbourne.*new bonds.*A\$580 a week \(2152 bonds\), × 52 \/ 12/);
});

test("hu-ksh-rent: Budapest's average asking rent over its average floor area for the newest half-year, not Pest county's", async () => {
  const fx = fixture<{ rent: (string | number | null)[][]; size: (string | number | null)[][] }>("hu-ksh-rent");
  assert.deepEqual(halfYearValue(fx.rent), { period: "2026-H1", value: 273 }, "the newest half-year, not 2025's 272");
  assert.deepEqual(halfYearValue(fx.size), { period: "2026-H1", value: 53 });
  assert.equal(halfYearValue(fx.rent, "Pest Régió")!.value, 281, "the next column is Pest county, not the city");
  assert.equal(halfYearValue(fx.rent, "Atlantis"), null);
  assert.equal(Math.round(kshRate(fx.rent, fx.size)!.perM2), 5151, "273 thousand Ft over 53 m²");
  assert.equal(kshRate(fx.rent, fx.size.slice(0, -2)), null, "the two tables must give the same half-year");
  const file = kshObservations(fx, cities, DAY);
  registered("hu-ksh-rent", file);
  assert.deepEqual(Object.keys(file.observations), ["budapest-hu"]);
  assert.deepEqual(rents(file.observations["budapest-hu"]), { rent_1bed: [257547, "2026-H1"], rent_3bed: [463585, "2026-H1"] });
  // ingatlan.com's listings, which KSH's figure is computed from, are proprietary: Budapest's page links them only.
  const { cityFacts } = await import("../src/site/facts.ts");
  const { loadPublishedDataset } = await import("../src/registry/load.ts");
  const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json"));
  assert.deepEqual(cityFacts(data, "budapest-hu").linkOut.filter((l) => /ingatlan/.test(l.url)), [{ label: "ingatlan.com: flats to rent in Budapest", url: "https://ingatlan.com/lista/kiado+lakas+budapest" }]);
  assert.ok(!cityFacts(data, "prague-cz").linkOut.some((l) => /ingatlan/.test(l.url)));
  assert.match(file.observations["budapest-hu"]![0]!.note!, /asking rent of flats advertised.*first half of 2026: 273 thousand Ft over an average 53 m², 5,151 Ft\/m² × 50 m² \(Forrás: KSH/);
});

test("each committed rent file holds what its parser reads from the source's file (re-fetch to update both)", () => {
  const parsed: Record<string, { observations: Record<string, Observation[]> }> = {
    "scot-rent": scotObservations(fixture<{ csv: string }>("scot-prs").csv, cities, DAY),
    "es-rent": serpaviObservations(fixture<{ rows: (string | number | null)[][] }>("es-serpavi").rows, cities, DAY),
    "de-rent": zensusObservations(fixture<{ csv: string }>("de-zensus").csv, cities, DAY),
    "nl-rent": cbsObservations(fixture<{ rows: CbsRow[] }>("cbs-woonlasten").rows, cities, DAY),
    "ch-rent": bfsObservations(fixture<{ rows: (string | number | null)[][] }>("ch-bfs-rent").rows, cities, DAY),
    "au-rent": nswObservations(fixture<{ rows: (string | number | null)[][] }>("nsw-rent-sales").rows, cities, DAY),
    "pt-rent": ineObservations(fixture<{ indicator: IneIndicator }>("pt-ine-rent").indicator, cities, DAY),
    "at-rent": microcensusObservations(fixture<{ rows: (string | number | null)[][] }>("at-mikrozensus").rows, cities, DAY),
    "jp-rent": estatObservations(fixture<{ reply: Parameters<typeof estatRents>[0] }>("jp-estat-housing").reply, cities, DAY),
    "hu-rent": kshObservations(fixture<{ rent: (string | number | null)[][]; size: (string | number | null)[][] }>("hu-ksh-rent"), cities, DAY),
    "vic-rent": vicObservations(fixture<{ rent_1bed: (string | number | null)[][]; rent_3bed: (string | number | null)[][] }>("vic-rental-report"), cities, DAY),
    "../observations-omi/it-rent": omiObservations(fixture<{ csv: string }>("it-omi-locazioni").csv, cities, DAY),
  };
  for (const [file, got] of Object.entries(parsed)) {
    const committed = JSON.parse(readFileSync(join(ROOT, "data/observations", `${file}.json`), "utf8")) as { observations: Record<string, Observation[]> };
    assert.deepEqual(Object.keys(committed.observations).sort(), Object.keys(got.observations).sort(), file);
    for (const id of Object.keys(got.observations)) assert.deepEqual(rents(committed.observations[id]), rents(got.observations[id]), `${file} ${id}`);
  }
});

test("a rent that covers every tenancy says, beside it, that newcomers usually pay more; a new-let rent does not", async () => {
  const { rentBasis, ALL_TENANCIES } = await import("../src/core/rent-basis.ts");
  const { loadPublishedDataset } = await import("../src/registry/load.ts");
  const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json"));
  // Every rent source in the registry says which kind it is (the registry refuses one that does not).
  const kinds = Object.fromEntries(Object.values(data.sources).filter((s) => s.tenancies).map((s) => [s.id, s.tenancies]));
  for (const id of ["de-zensus", "es-serpavi", "ons-pipr", "acs", "jp-estat-housing"]) assert.equal(kinds[id], "all", id);
  for (const id of ["pt-ine-rent", "it-omi-locazioni", "vic-rental-report", "nsw-rent-sales", "cso-rtb", "hu-ksh-rent"]) assert.equal(kinds[id], "new", id);
  assert.equal(rentBasis(data, "rent_1bed", ["de-zensus"]), ALL_TENANCIES);
  assert.equal(rentBasis(data, "rent_1bed", ["pt-ine-rent"]), null);
  assert.equal(rentBasis(data, "pm25", ["de-zensus"]), null, "only rents");
  // On the page a person reads: Berlin's rent (Zensus) carries the words, Lisbon's (new leases) does not.
  const { cityMarkdown } = await import("../src/agent/markdown.ts");
  const { cityReport } = await import("../src/agent/report.ts");
  const berlin = cityMarkdown(cityReport(data, "berlin-de", { metrics: ["rent_1bed"] }));
  assert.match(berlin, /\| Rent, one bedroom \| 382 EUR\/month \(all tenancies; newcomers usually pay more\) \|/);
  assert.doesNotMatch(cityMarkdown(cityReport(data, "lisbon-pt", { metrics: ["rent_1bed"] })), /newcomers usually pay more/);
  // The compact answer (MCP get_city's default) keeps the words in the citation it shows.
  assert.match(cityMarkdown(cityReport(data, "tokyo-jp", { metrics: ["rent_1bed"], detail: "summary" })), /\| Rent, one bedroom \| 105,273 JPY\/month \| Statistics Bureau of Japan, 2023-10; all tenancies; newcomers usually pay more \|/);
  assert.doesNotMatch(cityMarkdown(cityReport(data, "milan-it", { metrics: ["rent_1bed"], detail: "summary" })), /newcomers/);
  const { validateEntry } = await import("../src/registry/schema.ts");
  const entry = registry("nsw-rent-sales") as unknown as Parameters<typeof validateEntry>[0];
  const metrics = new Set(Object.keys(data.metrics));
  assert.deepEqual(validateEntry(entry, metrics), []);
  assert.match(validateEntry({ ...entry, tenancies: undefined }, metrics).join(" "), /tenancies: a rent source says/);
});
