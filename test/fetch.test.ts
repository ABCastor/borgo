import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The person's cache goes to a temporary folder for these tests.
process.env.WHERE_TO_LIVE_HOME = mkdtempSync(join(tmpdir(), "wtl-test-cache-"));

const { evaluate } = await import("../src/core/engine.ts");
const { METRICS } = await import("../src/core/metrics.ts");
const { fetchCity, withFetched, BROWSER_FETCHERS } = await import("../src/fetch/index.ts");
const { NODE_FETCHERS } = await import("../src/fetch/node/index.ts");
const { loadCachedCities } = await import("../src/fetch/node/cache.ts");
const { fetchPlace } = await import("../src/agent/fetch-place.ts");
const { parsePlace, resolvePlace } = await import("../src/places/resolve.ts");
const { parseWmoTsun, nearestStation } = await import("../src/fetch/sunshine.ts");
const { csoArea } = await import("../src/fetch/rent.ts");
const { parseNormals } = await import("../src/fetch/node/meteostat.ts");
const { fixture } = await import("./fixture.ts");
const { createServer } = await import("../src/mcp/server.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { fakeCtx, palermoRoutes, WMO_CSV, NOW } = await import("./fake-network.ts");

const data = () => ({ ...fixture(), metrics: METRICS });

test("any place: 'Palermo, IT' resolves to Sicily's ISO code, the most populous Palermo first", async () => {
  const { ctx } = fakeCtx(palermoRoutes());
  const d = data();
  const r = await resolvePlace("Palermo, IT", ctx, { countries: { ...d.countries, AR: { code: "AR", name: "Argentina", currency: "ARS", areas: [] } }, known: d.cities });
  assert.equal(r.length, 1, "the country filter drops Buenos Aires' Palermo");
  assert.deepEqual(
    { id: r[0]!.city.id, region: r[0]!.city.region, tz: r[0]!.city.tz, geonames: r[0]!.city.geonames, pop: r[0]!.city.population, known: r[0]!.known },
    { id: "palermo-it", region: "IT-82", tz: "Europe/Rome", geonames: "2523920", pop: 648260, known: false },
  );
  const all = await resolvePlace("Palermo", ctx, { countries: d.countries, known: d.cities });
  assert.deepEqual(all.map((x) => x.city.id), ["palermo-it", "palermo-ar"]);
});

test("any place: a second place with a taken id gets its region in the id; a known GeoNames id keeps the seed id", async () => {
  const d = data();
  d.cities.push({ id: "palermo-it", name: "Palermo", country: "IT", lat: 0, lon: 0, geonames: "999" });
  const { ctx } = fakeCtx(palermoRoutes());
  const r = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  assert.equal(r[0]!.city.id, "palermo-sicily-it");
  d.cities.push({ id: "palermo-sicily-it", name: "Palermo", country: "IT", lat: 0, lon: 0, geonames: "998" });
  const third = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  assert.equal(third[0]!.city.id, "palermo-2523920-it", "a third holder of the same name and region gets its GeoNames id");
  d.cities.push({ id: "palermo-seed-it", name: "Palermo", country: "IT", lat: 38.1, lon: 13.4, geonames: "2523920" });
  const again = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  assert.equal(again[0]!.city.id, "palermo-seed-it");
  assert.equal(again[0]!.known, true);
});

test("any place: a region outside the committed table is read from Wikidata; a busy Wikidata only costs the region", async () => {
  const geo = { results: [{ id: 2961423, name: "Sligo", latitude: 54.27, longitude: -8.47, feature_code: "PPLA", country_code: "IE", admin1_id: 7521315, admin1: "Connacht", population: 20000 }] };
  const ok = fakeCtx([[/geocoding/, () => geo], [/wikidata/, () => ({ results: { bindings: [{ iso: { value: "IE-C" } }] } })]]);
  const d = data();
  const r = await resolvePlace("Sligo", ok.ctx, { countries: d.countries, known: d.cities });
  assert.equal(r[0]!.city.region, "IE-C");
  assert.ok(ok.asked.some((u) => u.includes("P1566") && u.includes("7521315")));
  const busy = fakeCtx([[/geocoding/, () => geo], [/wikidata/, () => new Response("slow down", { status: 429 })]]);
  const r2 = await resolvePlace("Sligo", busy.ctx, { countries: d.countries, known: d.cities });
  assert.equal(r2[0]!.city.id, "sligo-ie");
  assert.equal(r2[0]!.city.region, undefined);
});

test("any place: parsing 'Name, CC', a country name, and a GeoNames id", () => {
  const c = data().countries;
  assert.deepEqual(parsePlace("Palermo, IT", c), { name: "Palermo", country: "IT" });
  assert.deepEqual(parsePlace("Cork, Ireland", c), { name: "Cork", country: "IE" });
  assert.deepEqual(parsePlace("geonames:2523920", c), { name: "", geonamesId: "2523920" });
  assert.deepEqual(parsePlace("San Francisco", c), { name: "San Francisco" });
});

test("fetch: every Node source runs for Palermo, fallbacks only when needed, each figure with its provenance", async () => {
  const { ctx, asked } = fakeCtx(palermoRoutes());
  const d = data();
  const [place] = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  const f = await fetchCity(place!.city, ctx, NODE_FETCHERS, { only: ["open-meteo-era5", "wmo-normals", "open-meteo-cams", "worldbank-wdi", "oecd-wellbeing", "openalex", "cso-rtb"] });
  const status = Object.fromEntries(f.outcomes.map((o) => [o.source, o.status]));
  assert.deepEqual(status, { "open-meteo-era5": "ok", "wmo-normals": "ok", "open-meteo-cams": "ok", "worldbank-wdi": "ok", "oecd-wellbeing": "ok", openalex: "ok", "cso-rtb": "skipped" });
  for (const o of f.observations) {
    assert.ok(o.url && asked.includes(o.url), `${o.metric}: url ${o.url} was fetched`);
    assert.match(o.fetcher ?? "", new RegExp(`^${o.source}@\\d+$`));
    assert.ok(o.period && o.retrieved.startsWith("2026-10-27"));
    assert.ok(METRICS[o.metric], o.metric);
  }
  const get = (m: string) => f.observations.find((o) => o.metric === m)!;
  assert.equal(get("sunshine_hours").value, 2725);
  assert.match(get("sunshine_hours").note!, /Palermo Punta Raisi, 24 km away at 21 m/);
  assert.equal((get("temp_hourly").value as number[]).length, 288);
  const hi = get("temp_high").value as number[];
  const feels = get("feels_high").value as number[];
  assert.ok(hi[6]! > hi[0]! && feels[6]! > hi[6]!, "July is warmer than January, and feels warmer than the air");
  assert.equal(get("price_level").level, "country");
  assert.equal(get("price_level").value, 66.7);
  assert.equal(get("pm25").source, "open-meteo-cams", "WHO was not asked for, so its fallback ran");
});

test("fetch: a source that fails is reported with its reason, and the rest still arrive", async () => {
  const { ctx } = fakeCtx(palermoRoutes(["archive", "openalex"]));
  const d = data();
  const [place] = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  const f = await fetchCity(place!.city, ctx, BROWSER_FETCHERS);
  const by = Object.fromEntries(f.outcomes.map((o) => [o.source, o]));
  assert.equal(by["open-meteo-era5"]!.status, "failed");
  assert.match(by["open-meteo-era5"]!.reason!, /503/);
  assert.equal(by["openalex"]!.status, "failed");
  assert.equal(by["worldbank-wdi"]!.status, "ok");
  assert.ok(!f.observations.some((o) => o.source === "open-meteo-era5"));
});

test("fetch: in a browser, sources without CORS are skipped with a reason, and the fallbacks stand in", async () => {
  const { ctx } = fakeCtx(palermoRoutes(), "browser");
  const d = data();
  const [place] = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  const f = await fetchCity(place!.city, ctx, NODE_FETCHERS);
  const by = Object.fromEntries(f.outcomes.map((o) => [o.source, o]));
  assert.equal(by["who-aqdb"]!.status, "skipped");
  assert.match(by["who-aqdb"]!.reason!, /no CORS/);
  assert.equal(by["open-meteo-cams"]!.status, "ok");
  assert.equal(by["meteostat"]!.status, "skipped", "WMO already gave sunshine");
  // The app's own list: the OECD sources are named as skipped, never asked for (a browser would log their CORS refusal).
  const { ctx: app, asked } = fakeCtx(palermoRoutes(), "browser");
  const g = await fetchCity(place!.city, app, BROWSER_FETCHERS);
  for (const id of ["oecd-wellbeing", "oecd-childcare"]) {
    const o = g.outcomes.find((x) => x.source === id)!;
    assert.equal(o.status, "skipped", id);
    assert.match(o.reason!, /not readable from a browser \(no CORS\); the CLI or MCP server fetches it/);
  }
  assert.ok(!asked.some((u) => u.includes("sdmx.oecd.org")), "no request to the OECD from a browser");
});

test("engine: a fetched city is scored like a snapshot city, and its figures replace the snapshot's source by source", async () => {
  const { ctx } = fakeCtx(palermoRoutes());
  const d = data();
  const [place] = await resolvePlace("Palermo, IT", ctx, { countries: d.countries, known: d.cities });
  const f = await fetchCity(place!.city, ctx, BROWSER_FETCHERS);
  const merged = withFetched(d, [f]);
  assert.equal(merged.cities.length, d.cities.length + 1);
  assert.equal(d.cities.length, 4, "the snapshot itself is untouched");
  const { PRESETS } = await import("../src/core/presets.ts");
  const profile = { ...(await import("./fixture.ts")).profile(), cities: ["turin-it", "palermo-it"], weights: { ...PRESETS[0]!.weights } };
  const ev = evaluate(merged, profile);
  const palermo = ev.results.find((r) => r.city.id === "palermo-it")!;
  assert.ok(palermo.total > 0);
  const sun = palermo.lines.find((l) => l.id === "sunshine")!;
  assert.equal(sun.raw.value, 2725);
  assert.equal(sun.imputed, false, "Palermo's sunshine is its own figure, not the others' average");
  assert.equal(ev.results.find((r) => r.city.id === "turin-it")!.lines.find((l) => l.id === "sunshine")!.imputed, true);
  // Re-fetching Turin's PM2.5 from CAMS replaces only that source's figure, not the snapshot's other figures.
  const turin = { city: d.cities[0]!, observations: [{ metric: "pm25", value: 15, period: "2025", level: "city" as const, source: "test", retrieved: "2026-10-27" }], outcomes: [], fetchedAt: NOW.toISOString() };
  const again = withFetched(d, [turin]);
  const pm = again.observations["turin-it"]!.filter((o) => o.metric === "pm25");
  assert.deepEqual(pm.map((o) => o.value), [15]);
  assert.equal(again.observations["turin-it"]!.length, d.observations["turin-it"]!.length);
});

test("cache: a fetched place is saved with its provenance, survives a round trip, and is reused until refreshed", async () => {
  const net = fakeCtx(palermoRoutes());
  const d = data();
  const first = await fetchPlace(d, "Palermo, IT", { ctx: net.ctx, only: ["open-meteo-era5", "worldbank-wdi"] });
  assert.equal(first.fromCache, false);
  assert.ok(first.savedTo!.startsWith(process.env.WHERE_TO_LIVE_HOME!));
  const disk = JSON.parse(readFileSync(first.savedTo!, "utf8"));
  assert.equal(disk.city.region, "IT-82");
  assert.ok(disk.observations.every((o: { url?: string; fetcher?: string; retrieved?: string }) => o.url && o.fetcher && o.retrieved));
  assert.ok(d.cities.some((c) => c.id === "palermo-it"), "the session's dataset gains the place");
  const cached = loadCachedCities();
  assert.deepEqual(cached.map((c) => c.city.id), ["palermo-it"]);
  assert.deepEqual(cached[0]!.observations, first.fetched.observations);
  const asked = net.asked.length;
  const second = await fetchPlace(data(), "Palermo, IT", { ctx: net.ctx });
  assert.equal(second.fromCache, true);
  assert.equal(net.asked.length, asked + 1, "only the geocoder was asked again");
  const third = await fetchPlace(data(), "Palermo, IT", { ctx: net.ctx, refresh: true, only: ["worldbank-wdi"] });
  assert.equal(third.fromCache, false);
  assert.ok(third.fetched.observations.some((o) => o.source === "open-meteo-era5"), "a partial refresh keeps the other sources' figures");
  // Figures from an older version of a fetcher make the cached place stale, without any refresh asked for.
  const { saveCity } = await import("../src/fetch/node/cache.ts");
  saveCity({ ...third.fetched, observations: third.fetched.observations.map((o) => (o.source === "worldbank-wdi" ? { ...o, fetcher: "worldbank-wdi@0" } : o)) });
  const fourth = await fetchPlace(data(), "Palermo, IT", { ctx: net.ctx });
  assert.equal(fourth.fromCache, false);
});

test("stations: missing months are dropped, and a station too far, or too much higher, does not stand for the city", () => {
  const stations = parseWmoTsun(WMO_CSV + "\n008,6,1,x,38.2,13.3,100.0,Italy,Gaps,1,2,3,-99.9,5,6,7,8,9,10,11,12,-99.9");
  assert.deepEqual(stations.map((s) => s.name), ["Palermo Punta Raisi", "Ustica", "Heathrow"]);
  const palermo = { id: "p", name: "Palermo", country: "IT", lat: 38.1166, lon: 13.3636, elevation: 14 };
  const island = stations.filter((s) => s.name !== "Palermo Punta Raisi");
  assert.equal(nearestStation(palermo, island)!.station.name, "Ustica", "within Meteostat's 80 km");
  assert.equal(nearestStation(palermo, island, 50), null, "not within the WMO set's 50 km");
  assert.equal(nearestStation({ ...palermo, elevation: 900 }, stations), null, "every station is over 500 m lower");
  assert.deepEqual(parseNormals("1961,1990,1,,,,,,60\n1991,2020,1,,,,,,120\n" + Array.from({ length: 11 }, (_, i) => `1991,2020,${i + 2},,,,,,600`).join("\n")), { period: "1991-2020", months: [2, ...Array(11).fill(10)] });
});

test("Irish rents: the city, a town, a locality, else the county as a region figure", () => {
  const labels = ["Cork", "Cork City", "Ballincollig, Cork", "Dublin", "Galway City", "Sligo", "Sligo Town"];
  const c = (name: string) => ({ id: "x", name, country: "IE", lat: 0, lon: 0 });
  assert.deepEqual(csoArea(labels, c("Cork")), { label: "Cork City", level: "city" });
  assert.deepEqual(csoArea(labels, c("Sligo")), { label: "Sligo Town", level: "city" });
  assert.deepEqual(csoArea(labels, c("Ballincollig")), { label: "Ballincollig, Cork", level: "city" });
  assert.deepEqual(csoArea(labels, c("Dublin")), { label: "Dublin", level: "region" });
  assert.equal(csoArea(labels, c("Athlone")), null);
});

test("mcp: list_sources shows the registry, fetch_city adds any place, record_observation keeps an agent's figure privately", async () => {
  const d = data();
  const { ctx } = fakeCtx(palermoRoutes());
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer(d, { ctx: () => ctx }).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const text = (r: object) => (r as { content: { text: string }[] }).content[0]!.text;

  const rent = await client.callTool({ name: "list_sources", arguments: { metric: "rent_1bed", city: "Dublin" } });
  assert.match(text(rent), /Numbeo/);
  assert.match(text(rent), /numbeo\.com\/cost-of-living\/in\/Dublin/);
  assert.match(text(rent), /### Link only/);

  const fetched = await client.callTool({ name: "fetch_city", arguments: { place: "Palermo, IT", sources: ["open-meteo-era5", "worldbank-wdi"] } });
  assert.notEqual(fetched.isError, true, text(fetched));
  assert.match(text(fetched), /## Palermo, Italy \(`palermo-it`\)/);
  assert.match(text(fetched), /Region IT-82/);
  const cmp = await client.callTool({ name: "compare_cities", arguments: { cities: ["Palermo", "Turin"] } });
  assert.notEqual(cmp.isError, true, text(cmp));
  assert.match(text(cmp), /Palermo/);

  const kept = await client.callTool({ name: "record_observation", arguments: { city: "palermo-it", metric: "rent_1bed", value: 750, source: "numbeo", url: "https://www.numbeo.com/cost-of-living/in/Palermo", period: "2026-10" } });
  assert.notEqual(kept.isError, true, text(kept));
  assert.match(text(kept), /never publishes it/);
  assert.match(JSON.stringify(kept.structuredContent), /Reported by an agent, unverified/);
  const city = await client.callTool({ name: "get_city", arguments: { city: "Palermo" } });
  assert.match(text(city), /750/);
  const bad = await client.callTool({ name: "record_observation", arguments: { city: "palermo-it", metric: "temp_high", value: 20, source: "numbeo", url: "https://example.org", period: "2026" } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /takes 12 numbers/);
  assert.match(text(bad), /numbeo does not measure temp_high/);
  const unit = await client.callTool({ name: "record_observation", arguments: { city: "palermo-it", metric: "rent_1bed", value: 750, unit: "USD/month", source: "numbeo", url: "https://www.numbeo.com/cost-of-living/in/Palermo", period: "2026-10" } });
  assert.equal(unit.isError, true);
  assert.match(text(unit), /rent_1bed is given in EUR\/month, not USD\/month/);
  const range = await client.callTool({ name: "record_observation", arguments: { city: "palermo-it", metric: "rent_1bed", value: -750, unit: "EUR/month", source: "numbeo", url: "https://www.numbeo.com/cost-of-living/in/Palermo", period: "2026-10" } });
  assert.equal(range.isError, true);
  assert.match(text(range), /runs from 0/);
  const still = await client.callTool({ name: "get_city", arguments: { city: "Palermo" } });
  assert.match(text(still), /750/, "a refused figure leaves the kept one in place");
  await client.close();
});

test("money: a place in a country without an exchange rate or a tax model gets no money figures, and says why", async () => {
  const { compare } = await import("../src/agent/report.ts");
  const d = data();
  d.countries.CO = { code: "CO", name: "Colombia", currency: "COP", areas: [] };
  const bogota = { city: { id: "bogota-co", name: "Bogotá", country: "CO", lat: 4.6, lon: -74.08, population: 7_674_366 }, observations: [], outcomes: [], fetchedAt: NOW.toISOString() };
  const merged = withFetched(d, [bogota]);
  const r = compare(merged, { cities: ["Bogotá", "Turin"], salary: { amount: 60_000, currency: "EUR" }, spending: { amount: 1_200, homeCity: "Turin" } });
  const b = r.cities.find((c) => c.id === "bogota-co")!;
  assert.equal(b.money.monthly.net.local, null);
  assert.ok(r.whatToAdd.some((x) => /No exchange rate for COP/.test(x)));
  assert.ok(!r.whatToAdd.some((x) => /A gross yearly salary/.test(x)), "the salary was given");
});

test("cache: a place holding only a figure an agent recorded is still fetched, and the agent's figure is kept", async () => {
  const { saveCity } = await import("../src/fetch/node/cache.ts");
  const city = { id: "palermo-it", name: "Palermo", country: "IT", lat: 38.1166, lon: 13.3636, geonames: "2523920" };
  const agent = { metric: "rent_1bed", value: 750, period: "2026-10", level: "city" as const, source: "numbeo", retrieved: NOW.toISOString(), url: "https://www.numbeo.com/cost-of-living/in/Palermo", fetcher: "agent", note: "Reported by an agent, unverified" };
  saveCity({ city, observations: [agent], outcomes: [], fetchedAt: NOW.toISOString() });
  const net = fakeCtx(palermoRoutes());
  const r = await fetchPlace(data(), "Palermo, IT", { ctx: net.ctx, only: undefined });
  assert.equal(r.fromCache, false);
  assert.ok(r.fetched.observations.some((o) => o.source === "open-meteo-era5"));
  assert.ok(r.fetched.observations.some((o) => o.fetcher === "agent" && o.value === 750));
});
