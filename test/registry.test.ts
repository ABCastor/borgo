import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { METRICS } from "../src/core/metrics.ts";
import { BROWSER_FETCHERS } from "../src/fetch/index.ts";
import { NODE_FETCHERS } from "../src/fetch/node/index.ts";
import { loadRegistry, REGISTRY_DIR } from "../src/registry/load.ts";
import { validateEntry, type RegistryEntry } from "../src/registry/schema.ts";
import { LICENCES, PARTS, partFor, type LicenceManifest, type PartFile } from "../src/registry/licences.ts";

const { entries, errors } = loadRegistry();
const byId = new Map(entries.map((e) => [e.id, e]));

test("registry: every entry is complete and consistent", () => {
  assert.deepEqual(errors, []);
  assert.ok(entries.length >= 30);
});

test("registry: the validator refuses what a contributor could get wrong", () => {
  const ids = new Set(Object.keys(METRICS));
  const good = structuredClone(byId.get("numbeo")!);
  assert.deepEqual(validateEntry(good, ids, "numbeo.json"), []);
  const bad: RegistryEntry = { ...good, redistribute: "yes", fetch: { mode: "per-city", runtimes: ["browser"], endpoint: "https://x", cors: false, key: null } };
  const errs = validateEntry(bad, ids, "numbeo.json").join("\n");
  assert.match(errs, /link-out source is never redistributed/);
  assert.match(errs, /has no fetcher/);
  assert.match(errs, /without CORS cannot run in the browser/);
  assert.match(validateEntry({ ...good, measures: [{ metric: "charm", definition: "how charming it is" }] }, ids).join(), /unknown metric charm/);
  assert.match(validateEntry({ ...good, id: "numbeo" }, ids, "other.json").join(), /file name must be numbeo.json/);
});

test("registry: link-out sources (Numbeo, WeatherSpark) are never fetched or redistributed", () => {
  for (const id of ["numbeo", "weatherspark", "iqair", "world-happiness-report"]) {
    const e = byId.get(id)!;
    assert.equal(e.access, "link-out", id);
    assert.equal(e.redistribute, "no", id);
    assert.equal(e.fetch, undefined, id);
    assert.ok(e.linkOut && e.personalUse, id);
  }
});

test("registry: every fetcher has an entry that allows its runtimes, and every entry's fetcher file exists", () => {
  for (const f of NODE_FETCHERS) {
    const e = byId.get(f.source);
    assert.ok(e, `no registry entry for fetcher ${f.source}`);
    for (const r of f.runtimes) assert.ok(e.fetch!.runtimes.includes(r), `${f.source}: registry does not allow ${r}`);
    assert.equal(e.fetch!.mode, "per-city", `${f.source} runs per city, so its entry says so`);
  }
  // The browser's list also names sources it cannot read (the OECD refuses it CORS), so they show as skipped with
  // that reason; every one it does run needs CORS, and every one it lists but cannot run says it has none.
  for (const f of BROWSER_FETCHERS) {
    const cors = byId.get(f.source)!.fetch!.cors;
    if (f.runtimes.includes("browser")) assert.ok(cors, `${f.source} runs in the browser, so it needs CORS`);
    else assert.equal(cors, false, `${f.source} is listed for the browser but cannot run there: its entry says no CORS`);
  }
  // The CLI and the MCP server fetch everything a browser fetches, when the fetcher runs in Node too.
  for (const f of BROWSER_FETCHERS) if (f.runtimes.includes("node")) assert.ok(NODE_FETCHERS.includes(f), `${f.source} runs in Node, so NODE_FETCHERS carries it`);
  const root = join(REGISTRY_DIR, "..");
  for (const e of entries) if (e.fetch?.fetcher) assert.ok(readdirSync(join(root, e.fetch.fetcher, "..")).includes(e.fetch.fetcher.split("/").at(-1)!), `${e.id}: ${e.fetch.fetcher} missing`);
});

test("registry: every snapshot figure's metric is declared by its source", () => {
  for (const dir of ["data/observations", "data/observations-odbl", "data/observations-who", "data/observations-cmhc"]) {
    for (const f of readdirSync(join(REGISTRY_DIR, "..", dir))) {
      const file = JSON.parse(readFileSync(join(REGISTRY_DIR, "..", dir, f), "utf8"));
      for (const list of Object.values(file.observations) as { metric: string; source: string }[][]) {
        for (const o of list) {
          const e = byId.get(o.source);
          assert.ok(e, `${f}: unknown source ${o.source}`);
          assert.notEqual(e.redistribute, "no", `${f}: ${o.source} may not be redistributed`);
          assert.ok(e.measures.some((m) => m.metric === o.metric), `${f}: ${o.source} does not declare ${o.metric}`);
        }
      }
    }
  }
});

test("sunshine comes only from stations, never from a gridded model", () => {
  const sunshine = entries.filter((e) => e.measures.some((m) => m.metric === "sunshine_hours")).map((e) => e.id).sort();
  assert.deepEqual(sunshine, ["meteostat", "wmo-normals"]);
  assert.ok(!byId.get("open-meteo-era5")!.measures.some((m) => m.metric.startsWith("sunshine")));
});

test("metrics: every one has a single plain sentence of definition, and climate says air or feels-like", () => {
  for (const m of Object.values(METRICS)) {
    assert.ok(m.description.length >= 30, `${m.id}: definition too short`);
    assert.equal((m.description.match(/[.!?](\s|$)/g) ?? []).length, 1, `${m.id}: one sentence`);
  }
  assert.match(METRICS.temp_high!.description, /Air temperature/);
  assert.match(METRICS.feels_high!.description, /apparent temperature/);
  assert.match(METRICS.sunshine_hours!.description, /120 W\/m²/);
  assert.equal(METRICS.temp_hourly!.shape, "hourly");
});

test("rights: every published source names a known licence, its edition, the terms read and its attribution", () => {
  for (const e of entries) {
    if (e.redistribute === "no") {
      assert.equal(e.rights, undefined, `${e.id}: a source that is not redistributed has no rights block`);
      assert.ok("error" in partFor(e), `${e.id} must not be publishable`);
      continue;
    }
    const p = partFor(e);
    assert.ok("part" in p, `${e.id}: ${"error" in p ? p.error : ""}`);
    assert.ok(LICENCES[e.rights!.licenceId], e.id);
  }
  assert.equal((partFor(byId.get("osm")!) as { part: string }).part, "odbl");
  assert.equal((partFor(byId.get("who-aqdb")!) as { part: string }).part, "who");
});

test("rights: the validator refuses an unknown licence, a missing rights block and rights on a link-out source", () => {
  const ids = new Set(Object.keys(METRICS));
  const mlab = structuredClone(byId.get("mlab")!);
  assert.match(validateEntry({ ...mlab, rights: { ...mlab.rights!, licenceId: "made-up-1.0" } }, ids).join(), /not a known licence/);
  assert.match(validateEntry({ ...mlab, rights: undefined }, ids).join(), /needs a rights block/);
  assert.match(validateEntry({ ...mlab, redistribute: "share-alike" }, ids).join(), /disagree/);
  const numbeo = structuredClone(byId.get("numbeo")!);
  assert.match(validateEntry({ ...numbeo, rights: mlab.rights }, ids).join(), /not redistributed has no rights block/);
  assert.match(JSON.stringify(partFor({ ...numbeo, rights: mlab.rights })), /not cleared for redistribution/);
});

test("rights: the build refuses a figure whose source has an unknown licence", () => {
  const dir = mkdtempSync(join(tmpdir(), "borgo-registry-"));
  try {
    cpSync(REGISTRY_DIR, dir, { recursive: true });
    const e = JSON.parse(readFileSync(join(dir, "mlab.json"), "utf8"));
    e.rights.licenceId = "made-up-1.0";
    writeFileSync(join(dir, "mlab.json"), JSON.stringify(e));
    const r = spawnSync(process.execPath, [join(REGISTRY_DIR, "../pipeline/build-data.ts")], { env: { ...process.env, BORGO_REGISTRY_DIR: dir }, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mlab: unknown licence made-up-1.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rights: the published files keep each licence apart, and the manifest credits every exported source", () => {
  const read = (rel: string) => JSON.parse(readFileSync(join(REGISTRY_DIR, "../public", rel), "utf8"));
  const dataset = read("data/dataset.json");
  const manifest = read("data/licences.json") as LicenceManifest;
  const partOf = new Map(manifest.sources.map((s) => [s.source, s.part]));
  const open = Object.values(dataset.observations).flat() as { source: string }[];
  for (const o of open) assert.equal(partOf.get(o.source), "open", `${o.source} is in dataset.json but not licensed for it`);
  for (const p of dataset.parts as { part: "odbl" | "who" | "cmhc"; file: string }[]) {
    const file = read(p.file) as PartFile;
    assert.equal(file.licence.id, PARTS[p.part].licence.id);
    for (const o of Object.values(file.observations).flat()) assert.equal(partOf.get(o.source), p.part, `${o.source} in ${p.file}`);
  }
  assert.deepEqual(dataset.parts.map((p: { part: string }) => p.part).sort(), ["cmhc", "odbl", "who"]);
  for (const s of manifest.sources) {
    assert.ok(s.attribution && s.licenceId && s.edition && s.termsUrl, s.source);
    assert.notEqual(byId.get(s.source)!.access, "link-out", s.source);
  }
  for (const id of ["osm", "who-aqdb", "open-meteo-era5", "geonames", "ecb-fx", "natural-earth", "nasa-power"]) assert.ok(partOf.has(id), `${id} missing from the manifest`);
});
