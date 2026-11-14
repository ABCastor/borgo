// The community inbox on the Worker, end to end against a real SQLite database standing in for D1: what is stored
// (and what never is), the daily network limit, removal, the city page filled in, and the open dataset.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, worldBank } from "../src/site/worker.ts";
import { envWith } from "./fake-d1.ts";

const O = "https://borgo.abcastor.com";
const post = (path: string, body: unknown, ip = "203.0.113.7", type = "application/json") =>
  new Request(`${O}${path}`, { method: "POST", headers: { "content-type": type, "cf-connecting-ip": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
const SUB = { city: "turin-it", rent: { amount: 950, bedrooms: "1", area: "centre" }, prices: { cappuccino: 1.6 }, salary: { amount: 2400, occupation: "software" }, rating: 4, consent: true, via: "cli" };

test("a submission is stored without anything about the sender, reviewed, and shown at once", async () => {
  const env = envWith();
  const res = await handle(post("/api/community/submit", SUB), env);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { figures: { review: { status: string } }[]; removal: string };
  assert.equal(body.figures.length, 4);
  assert.ok(body.figures.every((f) => f.review.status === "shown"));
  assert.match(body.removal, /^[a-z0-9]{20}$/);
  const rows = env.db.raw.prepare("SELECT * FROM entries").all() as Record<string, unknown>[];
  assert.equal(rows.length, 4);
  const stored = JSON.stringify(rows);
  assert.ok(!stored.includes("203.0.113.7"), "no address in entries");
  assert.ok(!stored.includes(body.removal), "the removal code itself is not stored, only its hash");
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["city", "currency", "day", "figure", "id", "removal", "value", "via"]);
  const limits = JSON.stringify(env.db.raw.prepare("SELECT * FROM limits").all());
  assert.ok(!limits.includes("203.0.113"), "the limit keeps a hash, not the address");
  // Shown: the city's figures, the page and the open dataset.
  const city = (await (await handle(new Request(`${O}/api/community/city/turin-it.json`), env)).json()) as { figures: { figure: string; entries: number; value: number }[] };
  assert.deepEqual(city.figures.map((f) => [f.figure, f.entries, f.value]), [["rent.1.centre", 1, 950], ["price.cappuccino", 1, 1.6], ["salary.software", 1, 2400], ["rating.overall", 1, 4]]);
  const page = await (await handle(new Request(`${O}/city/turin-it/`), env)).text();
  assert.match(page, /Community<\/span> <span class="cm-n">1 entry, [A-Z][a-z]{2} \d{4}/);
  assert.ok(!page.includes("placeholder"));
  const ds = (await (await handle(new Request(`${O}/api/community/dataset.json`), env)).json()) as { licence: { id: string }; rows: Record<string, unknown>[] };
  assert.equal(ds.licence.id, "CC-BY-4.0");
  assert.equal(ds.rows.length, 4);
  assert.ok(ds.rows.every((r) => !("removal" in r) && !("day" in r)));
  const csv = await (await handle(new Request(`${O}/api/community/dataset.csv`), env)).text();
  assert.equal(csv.trim().split("\n").length, 5);
});

test("refused input never reaches the database, with a reason to act on", async () => {
  const env = envWith();
  for (const [body, status, re] of [
    [{ ...SUB, consent: false }, 400, /consent/],
    [{ ...SUB, rent: { amount: 99_999, bedrooms: "1", area: "centre" } }, 400, /plausible/],
    ["{not json", 400, /JSON/],
    [JSON.stringify({ ...SUB, pad: "x".repeat(5000) }), 413, /Too large/],
  ] as const) {
    const res = await handle(post("/api/community/submit", body), env);
    assert.equal(res.status, status);
    assert.match(((await res.json()) as { error: string }).error, re);
  }
  assert.equal((env.db.raw.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n, 0);
});

test("one network: three submissions a day for a place, then a 429 until tomorrow; another network is not affected", async () => {
  const env = envWith();
  for (let i = 0; i < 3; i++) assert.equal((await handle(post("/api/community/submit", SUB), env)).status, 201);
  const r = await handle(post("/api/community/submit", SUB), env);
  assert.equal(r.status, 429);
  assert.match(((await r.json()) as { error: string }).error, /tomorrow/);
  assert.equal((await handle(post("/api/community/submit", SUB, "198.51.100.2"), env)).status, 201);
});

test("the plain web form works without JavaScript: posted, redirected back to the page with its note and code", async () => {
  const env = envWith();
  const form = new URLSearchParams({ city: "turin-it", rent: "1000", bedrooms: "2", area: "outside", price_milk: "1,2", rating: "5", consent: "on", website: "" });
  const res = await handle(post("/api/community/submit", form.toString(), undefined, "application/x-www-form-urlencoded"), env);
  assert.equal(res.status, 303);
  const loc = new URL(res.headers.get("location")!);
  assert.equal(loc.pathname, "/city/turin-it/");
  assert.equal(loc.searchParams.get("sent"), "3");
  const code = loc.searchParams.get("code")!;
  const page = await handle(new Request(loc), env);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const text = await page.text();
  assert.match(text, /Thank you/);
  assert.ok(text.includes(code));
  assert.match(text, /Milk, 1 litre/);
  const rows = env.db.raw.prepare("SELECT via, value FROM entries WHERE figure = 'price.milk'").all() as { via: string; value: number }[];
  assert.deepEqual(rows.map((r) => [r.via, r.value]), [["web", 1.2]]);
  // A filled hidden field is a bot: it hears "sent" and nothing is kept.
  const bot = new URLSearchParams({ city: "turin-it", rating: "1", consent: "on", website: "http://spam" });
  assert.equal((await handle(post("/api/community/submit", bot.toString(), "192.0.2.9", "application/x-www-form-urlencoded"), env)).status, 303);
  assert.equal((env.db.raw.prepare("SELECT COUNT(*) AS n FROM entries WHERE value = 1").get() as { n: number }).n, 0);
  // A refused form goes back with the reason on the page.
  const bad = new URLSearchParams({ city: "turin-it", rating: "4" });
  const back = await handle(post("/api/community/submit", bad.toString(), "192.0.2.10", "application/x-www-form-urlencoded"), env);
  const note = await (await handle(new Request(back.headers.get("location")!), env)).text();
  assert.match(note, /Not sent\..*consent/);
});

test("a removal code deletes its own submission and nothing else", async () => {
  const env = envWith();
  const a = (await (await handle(post("/api/community/submit", SUB), env)).json()) as { removal: string };
  await handle(post("/api/community/submit", { city: "turin-it", rating: 3, consent: true }, "198.51.100.3"), env);
  const r = (await (await handle(post("/api/community/remove", { code: a.removal }), env)).json()) as { removed: number };
  assert.equal(r.removed, 4);
  assert.equal((env.db.raw.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n, 1);
  const again = (await (await handle(post("/api/community/remove", { code: a.removal }), env)).json()) as { removed: number };
  assert.equal(again.removed, 0);
  assert.equal((await handle(post("/api/community/remove", { code: "x" }), env)).status, 400);
});

test("a held figure is listed as held, not shown, on the page and in the API", async () => {
  const env = envWith();
  await handle(post("/api/community/submit", { city: "london-gb", rent: { amount: 300, bedrooms: "1", area: "centre" }, consent: true }), env);
  const city = (await (await handle(new Request(`${O}/api/community/city/london-gb.json`), env)).json()) as { figures: { entries: number; held: number; official: { value: number } }[] };
  assert.equal(city.figures[0]!.entries, 0);
  assert.equal(city.figures[0]!.held, 1);
  assert.equal(city.figures[0]!.official.value, 2200);
  const ds = (await (await handle(new Request(`${O}/api/community/dataset.json`), env)).json()) as { rows: { review: string; reason: string }[] };
  assert.equal(ds.rows[0]!.review, "held");
  assert.match(ds.rows[0]!.reason, /official/);
});

test("without the database the site still serves its pages, and the API says it is unavailable", async () => {
  const env = envWith();
  delete env.COMMUNITY;
  assert.equal((await handle(new Request(`${O}/api/community/city/turin-it.json`), env)).status, 503);
  const page = await (await handle(new Request(`${O}/city/turin-it/`), env)).text();
  assert.match(page, /placeholder/);
});

test("the World Bank passes through only for indicator reads, with an open CORS header", async () => {
  const env = envWith();
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    seen.push(String(u));
    return new Response("[{}]", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const ok = await handle(new Request(`${O}/api/wb/v2/country/IT/indicator/NY.GDP.PCAP.CD?format=json&per_page=100&date=2015:2026&evil=1`), env);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), "*");
    assert.equal(seen[0], "https://api.worldbank.org/v2/country/IT/indicator/NY.GDP.PCAP.CD?format=json&per_page=100&date=2015:2026");
    const no = await handle(new Request(`${O}/api/wb/v2/sources?format=json`), env);
    assert.equal(no.status, 404);
    assert.equal(seen.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test("a World Bank that does not answer becomes a quick 504 the app can read, not a hung request", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = ((_: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  try {
    const t0 = Date.now();
    const res = await worldBank(new URL(`${O}/api/wb/v2/country/GE/indicator/SP.DYN.LE00.IN?format=json`), "/v2/country/GE/indicator/SP.DYN.LE00.IN", 50);
    assert.equal(res.status, 504);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.ok(Date.now() - t0 < 2000);
  } finally {
    globalThis.fetch = real;
  }
});
