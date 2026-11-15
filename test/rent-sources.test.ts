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
function registered(id: string, file: { source: string; observations: Record<string, Observation[]> }): void {
  const r = registry(id);
  assert.equal(file.source, id);
  assert.ok(LICENCES[r.licence], `${id}: licence ${r.licence} is in LICENCES`);
  assert.equal(LICENCES[r.licence]!.part, "open", `${id} is open data`);
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
  };
  for (const [file, got] of Object.entries(parsed)) {
    const committed = JSON.parse(readFileSync(join(ROOT, "data/observations", `${file}.json`), "utf8")) as { observations: Record<string, Observation[]> };
    assert.deepEqual(Object.keys(committed.observations).sort(), Object.keys(got.observations).sort(), file);
    for (const id of Object.keys(got.observations)) assert.deepEqual(rents(committed.observations[id]), rents(got.observations[id]), `${file} ${id}`);
  }
});
