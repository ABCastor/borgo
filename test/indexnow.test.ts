import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { changedUrls, INDEXNOW_MAX, indexNowBodies, indexNowKey, sitemapEntries, sitemapUrls } from "../scripts/indexnow.ts";

const ROOT = join(import.meta.dirname, "..");

test("indexnow: one key file at public/root/<key>.txt, holding the key, which the build puts at the site's root", () => {
  const { key, file } = indexNowKey();
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(file, `${key}.txt`);
  assert.equal(readFileSync(join(ROOT, "public/root", file), "utf8").trim(), key);
});

test("indexnow: the sitemap's addresses, on the site's host only, at most 10,000 a request", () => {
  const xml = `<urlset><url><loc>https://borgo.abcastor.com/</loc></url><url><loc> https://borgo.abcastor.com/cities/a?x=1&amp;y=2 </loc></url><url><loc>https://elsewhere.example/</loc></url><url><loc>https://borgo.abcastor.com/</loc></url></urlset>`;
  const urls = sitemapUrls(xml);
  assert.deepEqual(urls, ["https://borgo.abcastor.com/", "https://borgo.abcastor.com/cities/a?x=1&y=2", "https://elsewhere.example/", "https://borgo.abcastor.com/"]);
  const [body, ...rest] = indexNowBodies(urls, "k".repeat(32), "https://borgo.abcastor.com");
  assert.equal(rest.length, 0);
  assert.deepEqual(body, { host: "borgo.abcastor.com", key: "k".repeat(32), keyLocation: `https://borgo.abcastor.com/${"k".repeat(32)}.txt`, urlList: ["https://borgo.abcastor.com/", "https://borgo.abcastor.com/cities/a?x=1&y=2"] });
  const many = Array.from({ length: INDEXNOW_MAX + 1 }, (_, i) => `https://borgo.abcastor.com/p${i}/`);
  assert.deepEqual(indexNowBodies(many, "k", "https://borgo.abcastor.com").map((b) => b.urlList.length), [INDEXNOW_MAX, 1]);
  assert.deepEqual(indexNowBodies(["https://elsewhere.example/"], "k", "https://borgo.abcastor.com"), []);
});

/** Runs scripts/indexnow.ts against a local server standing in for both the site and the IndexNow endpoint. */
async function ping(endpointStatus: number | "down", args: string[] = []) {
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { key } = indexNowKey();
  const posts: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === `/${key}.txt`) return res.end(key);
    if (req.method === "POST" && req.url === "/indexnow") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        posts.push(JSON.parse(body));
        res.statusCode = endpointStatus === "down" ? 500 : endpointStatus;
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "borgo-indexnow-"));
  writeFileSync(join(dir, "sitemap.xml"), `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/cities/</loc></url></urlset>`);
  const endpoint = endpointStatus === "down" ? "http://127.0.0.1:9/indexnow" : `${origin}/indexnow`;
  const child = spawn(process.execPath, [join(ROOT, "scripts/indexnow.ts"), "--sitemap", join(dir, "sitemap.xml"), ...args], { env: { ...process.env, SITE_ORIGIN: origin, INDEXNOW_ENDPOINT: endpoint } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise<number | null>((ok) => child.on("exit", ok));
  server.close();
  rmSync(dir, { recursive: true, force: true });
  return { code, out, posts, origin, key };
}

test("indexnow: posts the sitemap with its host and key location", async () => {
  const r = await ping(200);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /sent 2 URLs/);
  assert.deepEqual(r.posts, [{ host: new URL(r.origin).host, key: r.key, keyLocation: `${r.origin}/${r.key}.txt`, urlList: [`${r.origin}/`, `${r.origin}/cities/`] }]);
});

test("indexnow: an endpoint that fails or does not answer warns and never fails the deploy", async () => {
  for (const status of [500, "down"] as const) {
    const r = await ping(status);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /IndexNow: .*the deploy itself is fine/);
  }
});

test("indexnow: --dry-run sends nothing", async () => {
  const r = await ping(200, ["--dry-run"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /dry run: would POST 2 URLs/);
  assert.deepEqual(r.posts, []);
});

test("indexnow: only addresses that are new or whose lastmod moved count as changed", () => {
  const before = `<urlset><url><loc>https://x.example/</loc><lastmod>2026-11-14</lastmod></url><url><loc>https://x.example/a/</loc><lastmod>2026-11-14</lastmod></url><url><loc>https://x.example/gone/</loc><lastmod>2026-11-14</lastmod></url></urlset>`;
  const now = `<urlset><url><loc>https://x.example/</loc><lastmod>2026-11-14</lastmod></url><url><loc>https://x.example/a/</loc><lastmod>2026-11-15</lastmod></url><url><loc>https://x.example/new/</loc><lastmod>2026-11-15</lastmod></url><url><loc>https://x.example/undated/</loc></url></urlset>`;
  assert.equal(sitemapEntries(now).get("https://x.example/a/"), "2026-11-15");
  assert.deepEqual(changedUrls(now, before), ["https://x.example/a/", "https://x.example/new/", "https://x.example/undated/"]);
  assert.deepEqual(changedUrls(before, before), []);
  assert.deepEqual(changedUrls(now, ""), sitemapUrls(now));
});

/** A deploy as npm run deploy does it: --save-live reads the site's sitemap before, the ping sends what changed after. */
async function deploy(liveSitemap: string | null, newSitemap: string) {
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const { existsSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { key } = indexNowKey();
  const posts: any[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === `/${key}.txt`) return res.end(key);
    if (req.method === "GET" && req.url === "/sitemap.xml" && liveSitemap !== null) return res.end(liveSitemap);
    if (req.method === "POST" && req.url === "/indexnow") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        posts.push(JSON.parse(body));
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "borgo-indexnow-"));
  const previous = join(dir, "live-sitemap.xml");
  writeFileSync(join(dir, "sitemap.xml"), newSitemap.replaceAll("ORIGIN", origin));
  const env = { ...process.env, SITE_ORIGIN: origin, INDEXNOW_ENDPOINT: `${origin}/indexnow` };
  const run = (args: string[]) =>
    new Promise<{ code: number | null; out: string }>((ok) => {
      const child = spawn(process.execPath, [join(ROOT, "scripts/indexnow.ts"), ...args], { env });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("exit", (code) => ok({ code, out }));
    });
  if (liveSitemap !== null) liveSitemap = liveSitemap.replaceAll("ORIGIN", origin);
  const saved = await run(["--save-live", "--previous", previous]);
  const keptFile = existsSync(previous);
  const ping = await run(["--sitemap", join(dir, "sitemap.xml"), "--previous", previous]);
  const leftOver = existsSync(previous);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  return { saved, keptFile, ping, leftOver, posts, origin };
}

test("indexnow: a deploy sends only the pages whose lastmod moved since the live sitemap", async () => {
  const live = `<urlset><url><loc>ORIGIN/</loc><lastmod>2026-11-14</lastmod></url><url><loc>ORIGIN/a/</loc><lastmod>2026-11-14</lastmod></url></urlset>`;
  const next = `<urlset><url><loc>ORIGIN/</loc><lastmod>2026-11-14</lastmod></url><url><loc>ORIGIN/a/</loc><lastmod>2026-11-15</lastmod></url><url><loc>ORIGIN/b/</loc><lastmod>2026-11-15</lastmod></url></urlset>`;
  const r = await deploy(live, next);
  assert.equal(r.saved.code, 0, r.saved.out);
  assert.ok(r.keptFile);
  assert.equal(r.ping.code, 0, r.ping.out);
  assert.match(r.ping.out, /sent 2 URLs changed since the last deploy \(of 3\)/);
  assert.deepEqual(r.posts.map((p) => p.urlList), [[`${r.origin}/a/`, `${r.origin}/b/`]]);
  assert.ok(!r.leftOver, "the saved sitemap is removed after a ping");
  const same = await deploy(live, live);
  assert.match(same.ping.out, /no page changed since the last deploy/);
  assert.deepEqual(same.posts, []);
});

test("indexnow: when the live sitemap cannot be read, the ping sends every URL", async () => {
  const r = await deploy(null, `<urlset><url><loc>ORIGIN/</loc><lastmod>2026-11-15</lastmod></url><url><loc>ORIGIN/a/</loc><lastmod>2026-11-15</lastmod></url></urlset>`);
  assert.equal(r.saved.code, 0, r.saved.out);
  assert.match(r.saved.out, /could not read the live sitemap/);
  assert.ok(!r.keptFile);
  assert.match(r.ping.out, /sent 2 URLs from the sitemap/);
  assert.equal(r.posts[0].urlList.length, 2);
});
