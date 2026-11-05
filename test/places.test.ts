// Any place, including the ones a geocoder files as an island, a country or under another name, with what it lacks
// said plainly; and the small islands on the world map. Network answers are recorded, never live.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.WHERE_TO_LIVE_HOME = mkdtempSync(join(tmpdir(), "wtl-places-cache-"));

const { evaluate } = await import("../src/core/engine.ts");
const { METRICS } = await import("../src/core/metrics.ts");
const { project } = await import("../src/core/equal-earth.ts");
const { resolvePlace } = await import("../src/places/resolve.ts");
const { placeGaps, resultGaps, gapsShort } = await import("../src/places/gaps.ts");
const { fetchPlace, placeFetchMarkdown } = await import("../src/agent/fetch-place.ts");
const { createServer } = await import("../src/mcp/server.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { fixture, profile } = await import("./fixture.ts");
const { fakeCtx, worldBankResponse, archiveResponse } = await import("./fake-network.ts");
type Route = import("./fake-network.ts").Route;
type Town = import("../src/places/resolve.ts").Town;
type WorldMap = import("../src/core/world-map.ts").WorldMap;
type Country = import("../src/core/types.ts").Country;

const root = join(import.meta.dirname, "..");
const COUNTRIES = JSON.parse(readFileSync(join(root, "data/countries.json"), "utf8")) as Record<string, Country>;
const data = () => ({ ...fixture(), metrics: METRICS, countries: COUNTRIES });

// ---------- Recorded geocoder and Wikidata answers ----------

const hit = (id: number, name: string, code: string, cc: string, lat: number, lon: number, population?: number, extra: object = {}) => ({
  id, name, feature_code: code, country_code: cc, latitude: lat, longitude: lon, timezone: "UTC", ...(population ? { population } : {}), ...extra,
});

const TEL_AVIV = hit(293397, "Tel Aviv", "PPLA", "IL", 32.08088, 34.78057, 432892, { admin1: "Tel Aviv", admin1_id: 293396, timezone: "Asia/Jerusalem", elevation: 15 });
const HYDERABAD_IN = hit(1269843, "Hyderabad", "PPLA", "IN", 17.38405, 78.45636, 6993262, { admin1: "Telangana", admin1_id: 1254788 });
const HYDERABAD_PK = hit(1176734, "Hyderābād", "PPLA2", "PK", 25.39242, 68.37366, 1921275, { admin1: "Sindh" });
const TENERIFE = hit(2510529, "Tenerife", "ISL", "ES", 28.27, -16.6, 906854, { admin1: "Canary Islands", elevation: 1100 });
const TENERIFE_CO = hit(3667298, "Tenerife", "PPLA2", "CO", 9.9, -74.86);
const SANTA_CRUZ = hit(2511174, "Santa Cruz de Tenerife", "PPLA", "ES", 28.46824, -16.25462, 211359, { admin1: "Canary Islands", admin1_id: 2593110, timezone: "Atlantic/Canary", elevation: 10 });
const LAS_PALMAS = hit(2515270, "Las Palmas de Gran Canaria", "PPLA", "ES", 28.09973, -15.41343, 383516, { admin1: "Canary Islands", admin1_id: 2593110 });
const LANZAROTE = hit(2515699, "Lanzarote", "ISL", "ES", 29.03, -13.63, 150000, { admin1: "Canary Islands", elevation: 200 });
const LANZAROTE_MX = hit(3525310, "Lanzarote", "PPL", "MX", 19.4, -99.1);
const ARRECIFE = hit(2521570, "Arrecife", "PPLA3", "ES", 28.96302, -13.54769, 61351, { admin1: "Canary Islands", admin1_id: 2593110, timezone: "Atlantic/Canary" });
const MALTA = hit(2562770, "Malta", "PCLI", "MT", 35.91667, 14.43333, 579704);
const MALTA_BR = hit(3457817, "Malta", "PPL", "BR", -6.9, -37.5, 6046);
const VALLETTA = hit(2562305, "Valletta", "PPLC", "MT", 35.89968, 14.5148, 6794, { timezone: "Europe/Malta" });
const BIRKIRKARA = hit(2563191, "Birkirkara", "PPLA", "MT", 35.8972, 14.4611, 22247);
const FUERTEVENTURA = hit(2517481, "Fuerteventura", "ISL", "ES", 28.38113, -14.03074, 113000, { elevation: 150 });
const BIG_ISLAND = hit(5855799, "Island of Hawai‘i", "ISL", "US", 19.6, -155.5, 185079, { elevation: 2400 });
const HAWAII_KAI = hit(5855051, "Hawai‘i Kai", "PPL", "US", 21.29, -157.7, 30620);
const BANGALORE_PK = hit(1185099, "Bangalore Town", "PPL", "PK", 24.9, 67.1);
const BENGALURU = hit(1277333, "Bengaluru", "PPLA", "IN", 12.97194, 77.59369, 8495492, { admin1: "Karnataka", admin1_id: 1267701 });

/** The map's towns these tests need: name, country, lat, lon, population, GeoNames id, capital. */
const TOWNS: Town[] = [
  ["Las Palmas", "ES", 28.1, -15.43, 378495, 2515270],
  ["Santa Cruz de Tenerife", "ES", 28.47, -16.25, 336061, 2511174],
  ["Arrecife", "ES", 28.969, -13.538, 52944, 2521570],
  ["Valletta", "MT", 35.9, 14.515, 368250, 2562305, 1],
  ["Madrid", "ES", 40.4, -3.68, 5567000, 3117735, 1],
];

const BY_ID = new Map([TEL_AVIV, HYDERABAD_IN, SANTA_CRUZ, LAS_PALMAS, ARRECIFE, VALLETTA, BENGALURU].map((h) => [String(h.id), h]));

function routes(search: Record<string, object[]>, wikidata: { search?: object[]; entities?: object } = {}): Route[] {
  return [
    [/geocoding-api\.open-meteo\.com\/v1\/search/, (u) => ({ results: search[new URL(u).searchParams.get("name")!] ?? [] })],
    [/geocoding-api\.open-meteo\.com\/v1\/get/, (u) => BY_ID.get(new URL(u).searchParams.get("id")!) ?? new Response('{"error":true}', { status: 400 })],
    [/wbsearchentities/, () => ({ search: wikidata.search ?? [] })],
    [/wbgetentities/, () => ({ entities: wikidata.entities ?? {} })],
    [/query\.wikidata\.org/, () => ({ results: { bindings: [] } })],
  ];
}

const opts = (extra: object = {}) => ({ countries: COUNTRIES, known: fixture().cities, towns: async () => TOWNS, ...extra });

// ---------- Resolving ----------

test("places: Tel Aviv and Hyderabad resolve, the most populous Hyderabad first", async () => {
  const { ctx } = fakeCtx(routes({ "Tel Aviv": [TEL_AVIV], Hyderabad: [HYDERABAD_PK, HYDERABAD_IN] }));
  const [tlv] = await resolvePlace("Tel Aviv", ctx, opts());
  assert.deepEqual({ id: tlv!.city.id, country: tlv!.city.country, tz: tlv!.city.tz }, { id: "tel-aviv-il", country: "IL", tz: "Asia/Jerusalem" });
  const hyd = await resolvePlace("Hyderabad", ctx, opts());
  assert.deepEqual(hyd.map((r) => r.city.id), ["hyderabad-in", "hyderabad-pk"]);
});

test("places: Tenerife is an island, so it stands for its main town, Santa Cruz, not a Colombian namesake", async () => {
  const { ctx, asked } = fakeCtx(routes({ Tenerife: [TENERIFE, TENERIFE_CO] }));
  const r = await resolvePlace("Tenerife", ctx, opts());
  assert.equal(r[0]!.city.id, "santa-cruz-de-tenerife-es");
  assert.equal(r[0]!.city.geonames, "2511174");
  assert.deepEqual(r[0]!.city.aliases, ["Tenerife"], "typing Tenerife again finds it");
  assert.equal(r[0]!.stands, "the main town of Tenerife");
  assert.match(r[0]!.label, /^the main town of Tenerife, Canary Islands, Spain/);
  assert.ok(asked.some((u) => u.includes("get?id=2511174")), "the town is read by its GeoNames id, not its name");
  assert.ok(Math.abs(r[0]!.city.lat - 28.468) < 0.01 && r[0]!.city.elevation === 10, "the town's own coordinates, not the island's summit");
  assert.equal(r[1]!.city.country, "CO", "the namesake stays as an alternative");
});

test("places: Lanzarote stands for Arrecife; a bigger town on the next island does not win", async () => {
  const { ctx } = fakeCtx(routes({ Lanzarote: [LANZAROTE, LANZAROTE_MX] }));
  const [r] = await resolvePlace("Lanzarote", ctx, opts());
  assert.equal(r!.city.id, "arrecife-es");
  assert.equal(r!.stands, "the main town of Lanzarote");
});

test("places: a country's name stands for its capital, even where another town is bigger", async () => {
  const towns: Town[] = [...TOWNS, ["Birkirkara", "MT", 35.897, 14.461, 400000, 2563191]];
  const { ctx } = fakeCtx(routes({ Malta: [MALTA, MALTA_BR], Birkirkara: [BIRKIRKARA] }));
  const [r] = await resolvePlace("Malta", ctx, opts({ towns: async () => towns }));
  assert.equal(r!.city.id, "valletta-mt");
  assert.equal(r!.stands, "the capital of Malta");
});

test("places: a low island with no known town stands for its centre; a mountainous one does not", async () => {
  const { ctx } = fakeCtx(routes({ Fuerteventura: [FUERTEVENTURA], Hawaii: [BIG_ISLAND, HAWAII_KAI] }));
  const [f] = await resolvePlace("Fuerteventura", ctx, opts());
  assert.equal(f!.city.id, "fuerteventura-es");
  assert.equal(f!.stands, "the centre of the island (no town found on it)");
  const h = await resolvePlace("Hawaii", ctx, opts());
  assert.equal(h[0]!.city.name, "Hawai‘i Kai", "a summit's climate is never passed off as a town's");
  assert.equal(h[0]!.stands, undefined);
});

test("places: with no town list (it failed to load) an island still resolves through the geocoder's own towns", async () => {
  const { ctx } = fakeCtx(routes({ Tenerife: [TENERIFE, SANTA_CRUZ, TENERIFE_CO] }));
  const [r] = await resolvePlace("Tenerife", ctx, opts({ towns: async () => { throw new Error("offline"); } }));
  assert.equal(r!.city.id, "santa-cruz-de-tenerife-es");
});

test("places: an older name (Bangalore) is found through Wikidata's aliases; a prefix match never is", async () => {
  const wd = {
    search: [{ id: "Q1355", match: { type: "alias", text: "Bangalore" } }, { id: "Q99", match: { type: "label", text: "Bangalore Palace" } }],
    entities: { Q1355: { claims: { P1566: [{ mainsnak: { datavalue: { value: "1277333" } } }] } }, Q99: { claims: { P1566: [{ mainsnak: { datavalue: { value: "1269843" } } }] } } },
  };
  const { ctx, asked } = fakeCtx(routes({ Bangalore: [BANGALORE_PK] }, wd));
  const [r] = await resolvePlace("Bangalore", ctx, opts());
  assert.equal(r!.city.id, "bengaluru-in");
  assert.ok(asked.some((u) => u.includes("wbgetentities") && u.includes("Q1355") && !u.includes("Q99")), "only exact label or alias matches are read");
  // A busy Wikidata costs only the other names: the geocoder's answer stands.
  const busy = fakeCtx([[/wikidata/, () => new Response("slow down", { status: 429 })], ...routes({ Bangalore: [BANGALORE_PK] })]);
  const [b] = await resolvePlace("Bangalore", busy.ctx, opts());
  assert.equal(b!.city.country, "PK");
});

test("places: with a country named, Wikidata's namesakes elsewhere are never read back (no geocoder 400 for an Irish county)", async () => {
  // The re-test's "Dublin, US": Wikidata's "Dublin" label and alias are the Irish city (Q1761, GeoNames 2964574) and
  // County Dublin (Q173500, 2964573, which the geocoder does not hold and answers 400). Both are in Ireland (Q27, IE).
  const DUBLIN_OH = hit(4519095, "Dublin", "PPL", "US", 40.0992, -83.1141, 49328);
  const wd = {
    search: [{ id: "Q1761", match: { text: "Dublin" } }, { id: "Q173500", match: { text: "Dublin" } }, { id: "Q988937", match: { text: "Dublin" } }],
    entities: {
      Q1761: { claims: { P1566: [{ mainsnak: { datavalue: { value: "2964574" } } }], P17: [{ mainsnak: { datavalue: { value: { id: "Q27" } } } }] } },
      Q173500: { claims: { P1566: [{ mainsnak: { datavalue: { value: "2964573" } } }], P17: [{ mainsnak: { datavalue: { value: { id: "Q27" } } } }] } },
      Q988937: { claims: { P1566: [{ mainsnak: { datavalue: { value: "4519095" } } }], P17: [{ mainsnak: { datavalue: { value: { id: "Q30" } } } }] } },
      Q27: { claims: { P297: [{ mainsnak: { datavalue: { value: "IE" } } }] } },
      Q30: { claims: { P297: [{ mainsnak: { datavalue: { value: "US" } } }] } },
    },
  };
  const { ctx, asked } = fakeCtx(routes({ Dublin: [DUBLIN_OH] }, wd));
  const [r] = await resolvePlace("Dublin, US", ctx, opts());
  assert.equal(r!.city.country, "US");
  const gets = asked.filter((u) => u.includes("/v1/get?id="));
  assert.ok(!gets.some((u) => /id=296457[34]/.test(u)), gets.join("\n"));
  assert.ok(!gets.some((u) => u.includes("id=4519095")), "an id the search already returned is not read again");
});

test("places: a sizeable town by that name never asks Wikidata", async () => {
  const { ctx, asked } = fakeCtx(routes({ "Tel Aviv": [TEL_AVIV] }));
  await resolvePlace("Tel Aviv", ctx, opts({ regions: false }));
  assert.ok(!asked.some((u) => u.includes("wikidata")), asked.join("\n"));
});

// ---------- Partial data, said plainly ----------

test("gaps: a place in a country without a tax model or free-movement rules says so; a modelled EU city does not", () => {
  const d = data();
  const tlv = { id: "tel-aviv-il", name: "Tel Aviv", country: "IL", lat: 32.08, lon: 34.78 };
  assert.deepEqual(placeGaps(d, tlv).map((g) => g.short), ["no tax model for Israel yet", "no exchange rate for ILS", "no free-movement rules"]);
  assert.deepEqual(placeGaps(d, d.cities.find((c) => c.id === "turin-it")!), []);
  d.cities.push(tlv);
  const ev = evaluate(d, profile({ cities: ["turin-it", "tel-aviv-il"] }));
  const r = ev.results.find((x) => x.city.id === "tel-aviv-il")!;
  assert.ok(r.coverage < 1);
  const gaps = resultGaps(d, r);
  assert.ok(gaps.some((g) => g.why === "no figure here yet"), "lines with no figure are listed too");
  assert.match(gapsShort(gaps), /^no tax model for Israel yet, no exchange rate for ILS, no free-movement rules; no figure for .+/);
});

const telAvivRoutes = (): Route[] => [
  ...routes({ "Tel Aviv": [TEL_AVIV] }),
  [/archive-api\.open-meteo\.com/, () => archiveResponse()],
  [/api\.worldbank\.org/, worldBankResponse],
];

test("cli: fetching Tel Aviv marks partial data and names the missing tax model", async () => {
  const d = data();
  const { ctx } = fakeCtx(telAvivRoutes());
  const r = await fetchPlace(d, "Tel Aviv", { ctx, only: ["open-meteo-era5", "worldbank-wdi"] });
  assert.equal(r.fetched.city.id, "tel-aviv-il");
  assert.ok(r.fetched.outcomes.some((o) => o.status === "ok"));
  const md = placeFetchMarkdown(r, d);
  assert.match(md, /\*\*Partial data\.\*\* Lacks take-home pay \(no tax model for Israel yet\)/);
  assert.ok(d.cities.some((c) => c.id === "tel-aviv-il"), "the place joins the session's dataset, so compare and get_city see it");
});

test("mcp: fetch_city reads Tenerife as Santa Cruz, from the committed map's towns, and says so", async () => {
  const d = data();
  const { ctx } = fakeCtx([...routes({ Tenerife: [TENERIFE, TENERIFE_CO] }), [/archive-api\.open-meteo\.com/, () => archiveResponse()]]);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer(d, { ctx: () => ctx }).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const res = await client.callTool({ name: "fetch_city", arguments: { place: "Tenerife", sources: ["open-meteo-era5"], detail: "full" } });
  const text = (res as { content: { text: string }[] }).content[0]!.text;
  assert.notEqual(res.isError, true, text);
  assert.match(text, /## Santa Cruz de Tenerife, Spain \(`santa-cruz-de-tenerife-es`\)/);
  assert.match(text, /"Tenerife" is read as Santa Cruz de Tenerife, the main town of Tenerife\./);
  assert.match(text, /latitude=28\.46824&longitude=-16\.25462/, "the climate is the town's own");
  await client.close();
});

// ---------- The map keeps small islands ----------

test("map: every island with a town of 50,000 or more has a land tile, and its towns carry GeoNames ids", () => {
  const map = JSON.parse(readFileSync(join(root, "data/map/world.json"), "utf8")) as WorldMap;
  const land = new Set<string>();
  for (let i = 0; i < map.tiles.length; i += 3) land.add(`${map.tiles[i]},${map.tiles[i + 1]}`);
  const tileOf = (lon: number, lat: number) => {
    const [x, y] = project(lon, lat);
    return `${Math.floor((x - map.x0) / map.pitch)},${Math.floor((map.y0 - y) / map.pitch)}`;
  };
  const islands: [string, number, number][] = [
    ["Santa Cruz de Tenerife", 28.47, -16.25],
    ["Las Palmas", 28.1, -15.43],
    ["Arrecife", 28.969, -13.538],
    ["Funchal", 32.65, -16.88],
    ["Ponta Delgada", 37.748, -25.667],
    ["Palma", 39.574, 2.654],
    ["Valletta", 35.9, 14.515],
    ["Port Louis", -20.167, 57.5],
  ];
  for (const [name, lat, lon] of islands) {
    assert.ok(land.has(tileOf(lon, lat)), `${name}'s island is on the map`);
    const place = map.places.find((p) => p[0] === name);
    assert.ok(place, `${name} can be clicked`);
    assert.ok(place![5] > 0, `${name} has a GeoNames id`);
  }
  assert.ok(map.places.every((p) => p[4] >= 50_000 || p[6] === 1), "towns of 50,000 or more, and capitals");
});
