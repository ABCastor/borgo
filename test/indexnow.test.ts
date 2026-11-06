import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { INDEXNOW_MAX, indexNowBodies, indexNowKey, sitemapUrls } from "../scripts/indexnow.ts";

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
