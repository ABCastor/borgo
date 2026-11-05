import assert from "node:assert/strict";
import { test } from "node:test";
import { upgradeProfile } from "../src/core/criteria.ts";
import { cToF, distanceIn, fToC, formatDate, formatDistance, formatMoney, formatNumber, formatTemp, localiseText, tempFrom, tempIn, unitsOf } from "../src/core/units.ts";
import { profile } from "./fixture.ts";

// Units stay on the line with their number: a no-break space joins them. Compared here as plain spaces.
const sp = (s: string) => s.replace(/\u00a0/g, " ");
const metric = unitsOf(undefined);
const us = unitsOf({ temp: "F", distance: "mi", dates: "Nov 5, 2026" });
const de = unitsOf({ numbers: "1.234,5" });

test("temperature: °C and °F convert both ways, exactly", () => {
  assert.equal(cToF(0), 32);
  assert.equal(cToF(100), 212);
  assert.equal(cToF(-40), -40);
  assert.equal(fToC(212), 100);
  for (const c of [-20, 0, 18, 30, 45]) assert.ok(Math.abs(fToC(cToF(c)) - c) < 1e-12);
  assert.equal(tempIn(18, us), 64.4);
  assert.ok(Math.abs(tempFrom(86, us) - 30) < 1e-12);
  assert.equal(tempIn(18, metric), 18);
  assert.equal(sp(formatTemp(18, us)), "64 °F");
  assert.equal(sp(formatTemp(30, us, { short: true })), "86°");
  assert.equal(sp(formatTemp(-3.5, metric, { decimals: 1 })), "−3.5 °C");
});

test("distance: kilometres and miles", () => {
  assert.ok(Math.abs(distanceIn(1.609344, us) - 1) < 1e-12);
  assert.equal(sp(formatDistance(10, us)), "6 mi");
  assert.equal(sp(formatDistance(10, metric)), "10 km");
  assert.equal(sp(formatDistance(150, us)), "93 mi");
});

test("numbers, money and dates are written the person's way", () => {
  assert.equal(sp(formatNumber(12345.6, metric, 1)), "12,345.6");
  assert.equal(sp(formatNumber(12345.6, de, 1)), "12.345,6");
  assert.equal(sp(formatNumber(12345.6, unitsOf({ numbers: "1 234,5" }), 1)), "12 345,6");
  assert.equal(sp(formatNumber(12345.6, unitsOf({ numbers: "1'234.5" }), 1)), "12'345.6");
  assert.equal(sp(formatNumber(-3, metric)), "−3");
  assert.equal(sp(formatMoney(1240, "EUR", metric)), "€1,240");
  assert.equal(sp(formatMoney(1240, "EUR", de)), "1.240 €");
  assert.equal(formatDate("2026-11-05", metric), "5 Nov 2026");
  assert.equal(formatDate("2026-11-05T10:00:00Z", us), "Nov 5, 2026");
  assert.equal(formatDate("2026-11-05", unitsOf({ dates: "2026-11-05" })), "2026-11-05");
  assert.equal(formatDate("2021-2025", us), "2021-2025", "a period is not a date");
});

test("figures inside prose follow the person's units, years and small integers stay", () => {
  assert.equal(sp(localiseText("Nights when the air never cools below 20 °C.", us)), "Nights when the air never cools below 68 °F.");
  assert.equal(sp(localiseText("feel 18 to 30 °C from 8 am to 8 pm", us)), "feel 64 to 86 °F from 8 am to 8 pm");
  assert.equal(sp(localiseText("within 10 km of the centre, wind of 30 km/h", us)), "within 6 mi of the centre, wind of 19 mph");
  assert.equal(sp(localiseText("2,869 h a year, 7.30 of 10, period 2021-2025", de)), "2.869 h a year, 7,30 of 10, period 2021-2025");
  assert.equal(sp(localiseText("read on 2026-10-27", us)), "read on Oct 27, 2026");
  assert.equal(sp(localiseText("2,869 h a year at 20 °C", metric)), "2,869 h a year at 20 °C", "metric and en-GB: unchanged");
});

test("units are kept in the profile, so a saved or shared link carries them; unknown values fall back", () => {
  const p = upgradeProfile(profile({ prefs: { comfort: { min: 18, max: 30, basis: "feels" }, normalise: "absolute", missing: "average", units: { temp: "F", distance: "mi" } } }));
  const back = JSON.parse(JSON.stringify(p));
  assert.deepEqual(unitsOf(back.prefs.units), { temp: "F", distance: "mi", numbers: "1,234.5", dates: "5 Nov 2026" });
  assert.deepEqual(unitsOf({ temp: "K" as never, numbers: "x" as never }), metric);
});
