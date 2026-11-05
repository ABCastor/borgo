// The work-and-ambition and getting-around metrics: each computation on hand-made inputs, and each fetcher on a
// recorded network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA } from "../src/core/criteria.ts";
import { evaluate } from "../src/core/engine.ts";
import { groupOf } from "../src/core/groups.ts";
import { METRICS } from "../src/core/metrics.ts";
import type { Observation } from "../src/core/types.ts";
import { worldBank } from "../src/fetch/country.ts";
import { activeCommute, byCityYear, codeFor, eurostatUrban, figures, type JsonStat } from "../src/fetch/eurostat-urban.ts";
import { github, namesakes, qualified, rivalShare, searchNames, type Geo } from "../src/fetch/github.ts";
import { cityEdge, compass, fromMollweide, gpkgRings, toMollweide } from "../src/fetch/node/ghsl.ts";
import { bikeQuery, lackingWords, landArea, parseWalk, thinMap, walkable, walkQuery } from "../src/fetch/node/osm-walk-cycle.ts";
import { degreeShare } from "../pipeline/parsers.ts";
import { fakeCtx, worldBankResponse } from "./fake-network.ts";
import { fixture, profile } from "./fixture.ts";

const square = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

test("metrics: the new lines carry their group, and every scored line sits in the group its metric names", () => {
  for (const id of ["degree_share", "github_developers", "builder_density", "founders_running_club"]) assert.equal(METRICS[id]!.group, "ambition", id);
  for (const id of ["walkable_share", "bike_network", "active_commute_share", "city_edge_km"]) assert.equal(METRICS[id]!.group, "getting_around", id);
  for (const c of CRITERIA) {
    const g = c.metric ? METRICS[c.metric]?.group : undefined;
    if (g) assert.equal(groupOf(c), g, `${c.id} reads ${c.metric}`);
  }
});

// ---------- the edge of the dense city (GHSL) ----------

test("ghsl: Mollweide coordinates go there and back", () => {
  for (const [lon, lat] of [[7.69, 45.07], [-122.42, 37.77], [139.7, 35.7], [151.2, -33.87]] as const) {
    const [x, y] = toMollweide(lon, lat);
    const [lon2, lat2] = fromMollweide(x, y);
    assert.ok(Math.abs(lon2 - lon) < 1e-7 && Math.abs(lat2 - lat) < 1e-7, `${lon},${lat}`);
  }
  // The projection's fixed points: the origin, the pole at √2 R and the equator's edge at 2√2 R.
  const R = 6_378_137;
  assert.deepEqual(toMollweide(0, 0), [0, 0]);
  assert.ok(Math.abs(toMollweide(0, 90)[1] - Math.SQRT2 * R) < 1e-3);
  assert.ok(Math.abs(toMollweide(180, 0)[0] - 2 * Math.SQRT2 * R) < 1e-3);
});

test("ghsl: a GeoPackage multipolygon blob is read ring by ring", () => {
  const ring = square(0, 0, 10, 10);
  const wkb = new DataView(new ArrayBuffer(9 + 9 + 4 + 4 + ring.length * 16));
  let o = 0;
  wkb.setUint8(o, 1), wkb.setUint32(o + 1, 6, true), wkb.setUint32(o + 5, 1, true), (o += 9);
  wkb.setUint8(o, 1), wkb.setUint32(o + 1, 3, true), wkb.setUint32(o + 5, 1, true), wkb.setUint32(o + 9, ring.length, true), (o += 13);
  for (const [x, y] of ring) wkb.setFloat64(o, x!, true), wkb.setFloat64(o + 8, y!, true), (o += 16);
  const header = new Uint8Array([0x47, 0x50, 0, 0b0000_0011, 0, 0, 0, 0, ...new Uint8Array(32)]); // little-endian, xy envelope
  const blob = new Uint8Array([...header, ...new Uint8Array(wkb.buffer)]);
  assert.deepEqual(gpkgRings(blob), [[ring]]);
});

test("ghsl: the nearest edge is the shortest way out over land, never into the water", () => {
  // A dense city from 3 km west to 8 km east and 6 km south to 6 km north of its centre.
  const city = [square(-3, -6, 8, 6)];
  const all = cityEdge(city, () => true)!;
  assert.ok(Math.abs(all.nearestKm - 3) < 1e-9);
  assert.equal(compass(all.bearing), "west");
  assert.equal(all.landRays, 72);
  // The sea to the west: the way out is now south or north, 6 km.
  const sea = cityEdge(city, (x) => x > -3.2)!;
  assert.ok(Math.abs(sea.nearestKm - 6) < 0.01, `${sea.nearestKm}`);
  assert.ok(["north", "south"].includes(compass(sea.bearing)));
  // A large park 2 km east of the centre counts as a way out; a strip of fields that ends within 3 km does not.
  const park = cityEdge([...city, square(2, -1, 7.5, 1)], () => true)!;
  assert.ok(Math.abs(park.nearestKm - 2) < 1e-9);
  const strip = cityEdge([...city, square(2, -1, 3, 1)], (x) => x > -3.2)!;
  assert.ok(strip.nearestKm > 3, `${strip.nearestKm}`);
  assert.equal(cityEdge(city, () => false), null);
});

// ---------- walking and cycling (OpenStreetMap) ----------

test("osm: a street counts only when every need is within 1 km", () => {
  const p = (x: number, y: number): [number, number, number, number] => [x, y, x, y];
  const sets = {
    street: [p(0, 0), p(5, 0), p(10, 0)],
    food: [p(0.5, 0), p(5.2, 0), p(10, 0.9)],
    health: [p(0, 0.9), p(5, 0.5), p(9, 0)],
    school: [p(0.3, 0.3), p(4.5, 0), p(10.2, 0.2)],
    park: [[1.5, -1, 3, 1] as [number, number, number, number], p(5, 0.1), p(12, 0)], // the first is a park box 1.5 km east
    stop: [p(0, 0.1), p(5, 0.1), p(10, 0.1)],
  };
  const r = walkable(sets);
  // Street 1: park edge at 1.5 km, too far. Street 2: all close. Street 3: park 2 km away.
  assert.equal(r.streets, 3);
  assert.equal(r.share, 33);
  assert.deepEqual(r.lacking, { food: 0, health: 0, school: 0, park: 2, stop: 0 });
  assert.match(lackingWords(r), /a park \(67% of streets\)/);
  assert.equal(thinMap(r), true); // parks missing for two streets in three: the map is likelier thin
  sets.park[0] = [0.8, -1, 3, 1];
  assert.equal(walkable(sets).lacking.park, 1);
  assert.equal(thinMap(walkable(sets)), false);
});

test("osm: an Overpass answer splits at its markers into boxes around the centre", () => {
  const c = { lat: 45, lon: 7 };
  const els = [
    { type: "cat", tags: { n: "street" } },
    { type: "way", center: { lat: 45.009, lon: 7 } },
    { type: "cat", tags: { n: "park" } },
    { type: "way", bounds: { minlat: 45, minlon: 7, maxlat: 45.01, maxlon: 7.01 } },
    { type: "cat", tags: { n: "stop" } },
    { type: "node", lat: 45, lon: 7.0127 },
  ];
  const sets = parseWalk(els, c);
  assert.ok(Math.abs(sets.street![0]![1] - 0.995) < 0.01);
  assert.ok(Math.abs(sets.park![0]![2] - 0.787) < 0.01);
  assert.ok(Math.abs(sets.stop![0]![0] - 1.0) < 0.01);
  assert.match(walkQuery(c), /around:5000,45,7.*around:6000,45,7/);
  assert.match(bikeQuery(c), /around:10000,45,7/);
  assert.match(bikeQuery(c), /cycleway\(:both\|:left\|:right\)\?\$"~"\^\(track\|opposite_track\)\$"/);
});

test("osm: land area leaves the sea out", () => {
  const c = { lat: 45, lon: 7 };
  const all = landArea(c, [square(6, 44, 8, 46)]);
  assert.ok(Math.abs(all - Math.PI * 100) / (Math.PI * 100) < 0.01, `${all}`);
  const half = landArea(c, [square(6, 44, 7, 46)]); // land west of the centre only
  assert.ok(Math.abs(half - all / 2) / all < 0.02, `${half}`);
});

// ---------- the Urban Audit, the ACS and the World Bank ----------

/** A JSON-stat answer: freq x indic_ur x cities x time, one frequency. */
function jsonStat(indics: string[], cities: Record<string, string>, years: string[], value: (i: string, c: string, y: string) => number | undefined): JsonStat {
  const cs = Object.keys(cities);
  const values: Record<string, number> = {};
  indics.forEach((ind, a) => cs.forEach((c, b) => years.forEach((y, t) => {
    const v = value(ind, c, y);
    if (v !== undefined) values[String((a * cs.length + b) * years.length + t)] = v;
  })));
  const idx = (xs: string[]) => Object.fromEntries(xs.map((x, i) => [x, i]));
  return {
    id: ["freq", "indic_ur", "cities", "time"],
    size: [1, indics.length, cs.length, years.length],
    dimension: { freq: { category: { index: { A: 0 }, label: { A: "Annual" } } }, indic_ur: { category: { index: idx(indics), label: {} } }, cities: { category: { index: idx(cs), label: cities } }, time: { category: { index: idx(years), label: {} } } },
    value: values,
  };
}

test("urban audit: walking and cycling to work add up from one year; degrees only from 2014", () => {
  const bike = new Map([["2003", 22], ["2011", 4.3], ["2018", 5]]), walk = new Map([["2003", 4], ["2011", 9.3]]);
  assert.deepEqual(activeCommute(bike, walk), { year: "2011", value: 13.6, bike: 4.3, walk: 9.3 });
  assert.equal(activeCommute(new Map([["2003", 22]]), new Map([["2003", 4]])), null); // too old
  assert.equal(activeCommute(new Map([["2011", 1]]), new Map([["2011", 50713]])), null); // a count reported as a share
  const ctran = jsonStat(["TT1007V", "TT1008V"], { IT004C: "Torino" }, ["2011", "2021"], (i, _c, y) => (y === "2011" ? (i === "TT1007V" ? 2.65 : 10.67) : undefined));
  const educ = jsonStat(["TE2031I"], { IT004C: "Torino" }, ["2011", "2018"], (_i, _c, y) => (y === "2011" ? 20 : 26.1));
  assert.equal(byCityYear(educ, "TE2031I").get("IT004C")!.get("2018"), 26.1);
  const got = figures("IT004C", new Map([["urb_ctran", ctran], ["urb_ceduc", educ]]));
  assert.deepEqual(got.map((o) => [o.metric, o.value, o.period]), [["degree_share", 26.1, "2018"], ["active_commute_share", 13.3, "2011"]]);
  assert.match(got[1]!.note!, /on foot 10.7%, by bicycle 2.7%/);
});

test("urban audit: a place is found by its local name within its country", () => {
  const labels = { IT004C: "Torino", AT001C: "Wien (greater city)", EL001C: "Athina", UK001K: "Greater London", UK001C: "London" };
  assert.equal(codeFor({ name: "Turin", aliases: ["Torino"], country: "IT" }, labels), "IT004C");
  assert.equal(codeFor({ name: "Vienna", aliases: ["Wien"], country: "AT" }, labels), "AT001C");
  assert.equal(codeFor({ name: "Athina", country: "GR" }, labels), "EL001C");
  assert.equal(codeFor({ name: "London", country: "GB" }, labels), "UK001C");
  assert.equal(codeFor({ name: "Torino", country: "AT" }, labels), null);
});

test("urban audit: the fetcher reads any place it can name, with the address of each figure", async () => {
  const index = jsonStat(["DE1001V"], { IT005C: "Palermo", IT004C: "Torino" }, ["2024"], () => 600_000);
  const { ctx, asked } = fakeCtx([
    [/urb_cpop1.*lastTimePeriod/, () => index],
    [/urb_ceduc/, () => jsonStat(["TE2031I"], { IT005C: "Palermo" }, ["2018"], () => 19.6)],
    [/urb_ctran/, () => jsonStat(["TT1010V", "TT1007V", "TT1008V"], { IT005C: "Palermo" }, ["2011"], (i) => ({ TT1010V: 9.5, TT1007V: 0.4, TT1008V: 13.7 })[i])],
    [/eurostat/, () => jsonStat(["X"], { IT005C: "Palermo" }, ["2011"], () => undefined)],
  ]);
  const got = await eurostatUrban.fetch({ id: "palermo-it", name: "Palermo", country: "IT", lat: 38.1, lon: 13.4 }, ctx);
  const by = new Map(got.map((o) => [o.metric, o]));
  assert.equal(by.get("degree_share")!.value, 19.6);
  assert.equal(by.get("active_commute_share")!.value, 14.1);
  assert.match(by.get("degree_share")!.url!, /urb_ceduc.*cities=IT005C/);
  assert.match(by.get("active_commute_share")!.url!, /urb_ctran/);
  assert.ok(asked.every((u) => u.startsWith("https://ec.europa.eu/eurostat/")));
  assert.deepEqual(await eurostatUrban.fetch({ id: "x", name: "Nowhere", country: "IT", lat: 0, lon: 0 }, ctx), []);
  assert.equal(eurostatUrban.covers!({ id: "t", name: "Tokyo", country: "JP", lat: 35, lon: 139 }), false);
});

test("acs: degrees are an associate's or higher, at ages 25 to 64 only", () => {
  const row: Record<string, number> = {};
  for (let i = 1; i <= 83; i++) row[`B15001_E${String(i).padStart(3, "0")}`] = 0;
  // Men 25-34: 100 people, 10 associate's, 30 bachelor's, 10 graduate. Women 45-64: 100 people, 20 bachelor's.
  Object.assign(row, { B15001_E011: 100, B15001_E016: 10, B15001_E017: 30, B15001_E018: 10, B15001_E068: 100, B15001_E074: 20 });
  // People under 25 and over 64 must not count: 100 graduates aged 65+ among the men.
  Object.assign(row, { B15001_E035: 100, B15001_E042: 100 });
  assert.equal(degreeShare(row), 35);
});

test("world bank: tertiary attainment is a country figure for any place", async () => {
  const { ctx } = fakeCtx([[/api\.worldbank\.org/, (u) => (/SE\.TER\.CUAT\.ST\.ZS/.test(u) ? [{ page: 1 }, [{ date: "2024", value: 53.24 }, { date: "2023", value: 52 }]] : worldBankResponse(u))]]);
  const got = (await worldBank.fetch({ id: "singapore-sg", name: "Singapore", country: "SG", lat: 1.29, lon: 103.85 }, ctx)).find((o) => o.metric === "degree_share")!;
  assert.deepEqual([got.value, got.period, got.level], [53.2, "2024", "country"]);
  assert.match(got.note!, /25 and over/);
});

// ---------- developers on GitHub ----------

const geo = (name: string, country_code: string, country: string, population: number, latitude: number, longitude: number, admin1?: string): Geo => ({ id: latitude, name, country_code, country, population, latitude, longitude, admin1 });
const CAMBRIDGE = [geo("Cambridge", "GB", "United Kingdom", 145_674, 52.2, 0.12, "England"), geo("Cambridge", "US", "United States", 118_403, 42.37, -71.11, "Massachusetts"), geo("Cambridge", "NZ", "New Zealand", 4_000, -37.9, 175.47)];
const BARCELONA = [geo("Barcelona", "ES", "Spain", 1_686_208, 41.39, 2.16, "Catalonia"), geo("Barcelona", "VE", "Venezuela", 815_141, 10.14, -64.69, "Anzoátegui")];

test("github: names are searched once each, and rivals are places of the same name with a tenth of our people", () => {
  assert.deepEqual(searchNames({ name: "Zurich", aliases: ["Zürich", "Zuerich"] }), ["Zurich", "Zuerich"]);
  const cam = namesakes({ lat: 52.2, lon: 0.12, population: 145_674 }, "Cambridge", CAMBRIDGE);
  assert.equal(cam.ours!.country_code, "GB");
  assert.deepEqual(cam.rivals.map((r) => r.country_code), ["US"]);
  assert.deepEqual(qualified("Cambridge", cam.ours!), ["Cambridge, United Kingdom", "Cambridge, England"]);
  assert.equal(rivalShare(0, 0), null);
  assert.equal(rivalShare(90, 10), 0.1);
});

function githubRoutes(counts: Record<string, number>, places: Geo[]) {
  return fakeCtx(
    [
      [/geocoding-api\.open-meteo\.com/, () => ({ results: places })],
      [/api\.github\.com\/search\/users/, (u) => ({ total_count: counts[/location:"([^"]+)"/.exec(decodeURIComponent(new URL(u).searchParams.get("q")!))![1]!] ?? 0 })],
    ],
    "browser",
  );
}

test("github: the count is per 1,000 residents, and a name shared with a rival place gives no figure", async () => {
  const bcn = githubRoutes({ Barcelona: 39_709, "Barcelona, Spain": 2_000, "Barcelona, Catalonia": 300, "Barcelona, Venezuela": 42, "Barcelona, Anzoátegui": 1 }, BARCELONA);
  const [o] = await github.fetch({ id: "barcelona-es", name: "Barcelona", country: "ES", lat: 41.39, lon: 2.16, population: 1_686_208 }, bcn.ctx);
  assert.equal(o!.value, 23.5);
  assert.match(o!.note!, /39,709 accounts.*Venezuela \(2% of profiles naming a country\)/);
  assert.ok(bcn.asked.some((u) => u.includes("api.github.com")));
  const cam = githubRoutes({ Cambridge: 18_169, "Cambridge, United Kingdom": 800, "Cambridge, England": 400, "Cambridge, United States": 300, "Cambridge, Massachusetts": 900 }, CAMBRIDGE);
  assert.deepEqual(await github.fetch({ id: "cambridge-gb", name: "Cambridge", country: "GB", lat: 52.2, lon: 0.12, population: 145_674 }, cam.ctx), []);
  const turin = githubRoutes({ Torino: 2_563, Turin: 4_537 }, [geo("Turin", "IT", "Italy", 847_287, 45.07, 7.69)]);
  const [t] = await github.fetch({ id: "turin-it", name: "Torino", aliases: ["Turin"], country: "IT", lat: 45.07, lon: 7.69, population: 847_287 }, turin.ctx);
  assert.equal(t!.value, 8.4);
});

test("github: profiles naming a larger place whose name holds ours are taken away (Porto Alegre from Porto)", async () => {
  const places = [geo("Porto", "PT", "Portugal", 252_687, 41.15, -8.61), geo("Porto Alegre", "BR", "Brazil", 1_488_252, -30.03, -51.23), geo("Porto-Novo", "BJ", "Benin", 264_320, 6.5, 2.6), geo("Portoviejo", "EC", "Ecuador", 321_800, -1.05, -80.45)];
  assert.deepEqual(namesakes({ lat: 41.15, lon: -8.61, population: 252_687 }, "Porto", places).longer, ["Porto Alegre", "Porto-Novo"]);
  const net = githubRoutes({ Porto: 24_260, "Porto Alegre": 20_000, "Porto-Novo": 260 }, places);
  const [o] = await github.fetch({ id: "porto-pt", name: "Porto", country: "PT", lat: 41.15, lon: -8.61, population: 252_687 }, net.ctx);
  assert.equal(o!.value, 15.8);
  assert.match(o!.note!, /less 20,000 naming Porto Alegre and 260 naming Porto-Novo/);
});

// ---------- scoring ----------

test("scoring: the new lines read their metrics, and the way out is told in minutes by bike", () => {
  const data = fixture();
  const o = (metric: string, value: number): Observation => ({ metric, value, period: "2025", level: "city", source: "test", retrieved: "2026-11-05" });
  data.observations["turin-it"]!.push(o("city_edge_km", 1.8), o("bike_network", 1.31), o("walkable_share", 97), o("degree_share", 26.1), o("github_developers", 8.4), o("active_commute_share", 13.3));
  data.observations["london-gb"]!.push(o("city_edge_km", 15.5), o("bike_network", 0.9));
  const r = evaluate(data, profile({ weights: { way_out: 10, cycling: 10, walkable: 5, degrees: 5, developers: 5, active_commute: 5 } }));
  const line = (city: string, id: string) => { const l = r.results.find((x) => x.city.id === city)!.lines.find((l) => l.id === id)!; return { ...l, text: l.raw.text }; };
  assert.equal(line("turin-it", "way_out").text, "1.8 km, about 7 min by bike");
  assert.equal(line("london-gb", "way_out").text, "15.5 km, about 62 min by bike");
  assert.ok(line("turin-it", "way_out").score! > line("london-gb", "way_out").score!);
  assert.equal(line("turin-it", "cycling").text, "1.31 km per km²");
  assert.equal(line("turin-it", "walkable").text, "97 % of streets");
  assert.equal(line("turin-it", "developers").text, "8.4 per 1,000");
});
