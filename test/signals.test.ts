import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { evaluate } from "../src/core/engine.ts";
import { clockGap, flightHours, greatCircleKm, utcOffset } from "../src/core/geo.ts";
import { decodePng } from "../pipeline/png.ts";
import { byCityYear, chapters } from "../pipeline/parsers.ts";
import { Grid, joinRings } from "../pipeline/raster.ts";
import { distanceToLines, fromPixel, terrarium, tilesAround, toPixel } from "../pipeline/terrain.ts";
import { fixture, profile } from "./fixture.ts";

const LONDON = { lat: 51.5085, lon: -0.1257 };
const NEW_YORK = { lat: 40.7143, lon: -74.006 };
const TURIN = { lat: 45.0705, lon: 7.6868 };

const line = (r: ReturnType<typeof evaluate>, city: string, id: string) => r.results.find((x) => x.city.id === city)!.lines.find((l) => l.id === id)!;

test("great-circle distance and nonstop flight time match published figures", () => {
  assert.ok(Math.abs(greatCircleKm(LONDON, NEW_YORK) - 5_570) < 20);
  const ny = flightHours(LONDON, NEW_YORK);
  assert.ok(ny > 7 && ny < 7.5, `London-New York ${ny} h`);
  const turin = flightHours(TURIN, LONDON);
  assert.ok(turin > 1.4 && turin < 2, `Turin-London ${turin} h`);
  assert.equal(flightHours(LONDON, { lat: 51.75, lon: -1.26 }), 0); // Oxford: no flight worth taking
});

test("UTC offsets follow daylight saving, half hours included", () => {
  const jan = new Date(Date.UTC(2026, 0, 15, 12));
  const jul = new Date(Date.UTC(2026, 6, 15, 12));
  assert.equal(utcOffset("Europe/Rome", jan), 1);
  assert.equal(utcOffset("Europe/Rome", jul), 2);
  assert.equal(utcOffset("Europe/London", jan), 0);
  assert.equal(utcOffset("Asia/Kolkata", jan), 5.5);
  assert.equal(utcOffset("America/Los_Angeles", jul), -7);
});

test("clock gaps go the short way round and average the seasons", () => {
  assert.deepEqual(clockGap("Europe/Rome", "Europe/London", 2026), { january: 1, july: 1, typical: 1 });
  // Los Angeles is UTC-8/-7 and Tokyo UTC+9 without daylight saving: 17 and 16 hours ahead is 7 and 8 behind.
  assert.deepEqual(clockGap("America/Los_Angeles", "Asia/Tokyo", 2026), { january: 7, july: 8, typical: 7.5 });
  // Opposite hemispheres switch in opposite directions: London-Sydney is 11 h in January, 9 h in July.
  assert.deepEqual(clockGap("Europe/London", "Australia/Sydney", 2026), { january: 11, july: 9, typical: 10 });
});

test("time zone and flight lines measure from the chosen home, default where you live now", () => {
  const data = fixture();
  for (const [id, tz] of [["turin-it", "Europe/Rome"], ["dublin-ie", "Europe/Dublin"], ["london-gb", "Europe/London"], ["san-francisco-us", "America/Los_Angeles"]] as const) {
    data.cities.find((c) => c.id === id)!.tz = tz;
  }
  const r = evaluate(data, profile({ weights: { time_zone: 10, flight_home: 10 } }));
  assert.equal(line(r, "turin-it", "time_zone").raw.value, 0);
  assert.equal(line(r, "london-gb", "time_zone").raw.value, 1);
  assert.equal(line(r, "san-francisco-us", "time_zone").raw.value, 9);
  assert.equal(line(r, "turin-it", "flight_home").raw.text, "you are home");
  assert.ok(line(r, "san-francisco-us", "flight_home").raw.value! > 11);

  const fromSf = evaluate(data, profile({ home: "san-francisco-us", weights: { time_zone: 10 } }));
  assert.equal(line(fromSf, "san-francisco-us", "time_zone").raw.value, 0);
  assert.equal(line(fromSf, "turin-it", "time_zone").raw.value, 9);
});

test("opt-in lines start at weight 0, so they never move a ranking until the person turns them up", () => {
  const data = fixture();
  const plain = evaluate(fixture(), profile()).results.map((x) => [x.city.id, x.total]);
  data.observations["london-gb"]!.push({ metric: "founders_running_club", value: 1, period: "2026-10-27", level: "city", source: "test", retrieved: "2026-10-27" });
  data.observations["turin-it"]!.push({ metric: "founders_running_club", value: 0, period: "2026-10-27", level: "city", source: "test", retrieved: "2026-10-27" });
  const before = evaluate(data, profile());
  assert.deepEqual(before.results.map((x) => [x.city.id, x.total]), plain);
  assert.equal(line(before, "london-gb", "founders_run").weight, 0);
  assert.equal(line(before, "london-gb", "founders_run").raw.text, "a chapter");
  const ruled = evaluate(data, profile({ weights: { founders_run: 10 }, dealBreakers: ["founders_run"] }));
  assert.deepEqual(ruled.results.find((x) => x.city.id === "turin-it")!.ruledOut, ["Founders Running Club"]);
});

test("PNG decoding undoes every scanline filter", () => {
  // A 2 x 2 RGB image, rows filtered with Sub (1) and Paeth (4), wrapped in minimal PNG chunks.
  const rows = [
    [1, 10, 20, 30, 5, 5, 5], // Sub: second pixel = first + (5, 5, 5)
    [4, 1, 1, 1, 2, 2, 2], // Paeth: first pixel predicts from above, second from the left or above
  ];
  const chunk = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(12 + body.length);
    new DataView(b.buffer).setUint32(0, body.length);
    b.set(Buffer.from(type, "latin1"), 4);
    b.set(body, 8);
    return b;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 2);
  new DataView(ihdr.buffer).setUint32(4, 2);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows.flat()))), chunk("IEND", new Uint8Array())]);
  const img = decodePng(png);
  assert.deepEqual([...img.pixels], [10, 20, 30, 15, 25, 35, 11, 21, 31, 17, 27, 37]);
});

test("terrain arithmetic: Terrarium heights, pixels and tiles", () => {
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(131, 232, 0), 1_000);
  const px = toPixel(TURIN, 8);
  const back = fromPixel(px.x, px.y, 8);
  assert.ok(Math.abs(back.lat - TURIN.lat) < 1e-9 && Math.abs(back.lon - TURIN.lon) < 1e-9);
  const tiles = tilesAround(TURIN, 100, 8);
  assert.equal(tiles[0]!.minKm, 0); // the tile holding the city comes first
  assert.ok(tiles.every((t, i) => i === 0 || t.minKm >= tiles[i - 1]!.minKm));
});

test("distance to a coastline is the distance to its nearest segment, not its nearest vertex", () => {
  // A north-south line 1° of longitude east of the point, with vertices far to the north and south.
  const d = distanceToLines({ lat: 0, lon: 0 }, [[[1, -10], [1, 10]]]);
  assert.ok(Math.abs(d - 111.32) < 0.01);
});

test("green share grid: overlaps count once, the circle and land masks apply", () => {
  const g = new Grid({ lat: 0, lon: 0 }, 1, 0.1); // 20 x 20 cells of 100 m
  const box = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n]];
  const deg = 1 / 111.32; // about a km at the equator
  g.fill(box(0, 0, deg, deg)); // the north-east quarter of the square
  g.fill(box(0, 0, deg / 2, deg / 2)); // inside the first: no double counting
  const set = g.cells.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(set - 100) <= 10, `${set} cells`);
  const inCircle = [...g.cells.keys()].filter((i) => g.inCircle(i)).length;
  assert.ok(Math.abs(inCircle - Math.PI * 100) < 12, `${inCircle} cells in the circle`);
});

test("rings are joined from open ways in either direction", () => {
  const rings = joinRings([
    [[0, 0], [1, 0]],
    [[1, 1], [1, 0]], // reversed
    [[1, 1], [0, 1], [0, 0]],
  ]);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0]![0], rings[0]!.at(-1));
  assert.equal(rings[0]!.length, 5);
});

test("the Founders Running Club page parser reads chapter names and links", () => {
  const button = (href: string, name: string) =>
    `<a class="t-btn" href="${href}" data-lid="1"> <div class="t993__btn-text-wrapper"> <div class="t993__btn-text-title">${name}</div> </div> </a>`;
  const found = chapters(button("https://www.instagram.com/frczurich", "Zürich") + button("https://chat.example/x", "Poznań"));
  assert.equal(found.get("zurich"), "https://www.instagram.com/frczurich");
  assert.equal(found.get("poznan"), "https://chat.example/x");
});

test("JSON-stat cells are found by their position in every dimension", () => {
  const js = {
    id: ["freq", "indic_ur", "cities", "time"],
    size: [1, 2, 2, 2],
    dimension: {
      freq: { category: { index: { A: 0 }, label: { A: "Annual" } } },
      indic_ur: { category: { index: { X: 0, Y: 1 }, label: { X: "x", Y: "y" } } },
      cities: { category: { index: { C1: 0, C2: 1 }, label: { C1: "One", C2: "Two" } } },
      time: { category: { index: { "2020": 0, "2021": 1 }, label: { "2020": "2020", "2021": "2021" } } },
    },
    value: { "5": 42, "7": 43 }, // Y, C1, 2021 = 1*4 + 0*2 + 1; Y, C2, 2021 = 1*4 + 1*2 + 1
  };
  const y = byCityYear(js, "Y");
  assert.equal(y.get("C1")!.get("2021"), 42);
  assert.equal(y.get("C2")!.get("2021"), 43);
  assert.equal(y.get("C1")!.get("2020"), undefined);
  assert.equal(byCityYear(js, "X").size, 0);
});
