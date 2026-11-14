// The Worker in front of the static files: one address per page for search engines (Search Console's "Page with
// redirect"): http to https for good, the host's temporary clean-address redirects made permanent, files untouched.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, type Env } from "../src/site/worker.ts";

/** A stand-in for the static host: /cities and /index.html redirect like Cloudflare's auto-trailing-slash does. */
const env: Env = {
  ASSETS: {
    async fetch(request) {
      const { pathname, origin } = new URL(request.url);
      if (pathname === "/cities") return new Response(null, { status: 307, headers: { location: `${origin}/cities/` } });
      if (pathname === "/index.html") return new Response(null, { status: 307, headers: { location: "/" } });
      if (pathname === "/nope/") return new Response("not found", { status: 404 });
      if (pathname.startsWith("/api/")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      return new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
    },
  },
};

test("plain http moves to the same address on https, permanently", async () => {
  const res = await handle(new Request("http://borgo.abcastor.com/city/turin-it/?x=1"), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://borgo.abcastor.com/city/turin-it/?x=1");
});

test("the host's clean-address redirects become permanent, to the same target", async () => {
  const a = await handle(new Request("https://borgo.abcastor.com/cities"), env);
  assert.equal(a.status, 301);
  assert.equal(a.headers.get("location"), "https://borgo.abcastor.com/cities/");
  const b = await handle(new Request("https://borgo.abcastor.com/index.html", { method: "HEAD" }), env);
  assert.equal(b.status, 301);
  assert.equal(b.headers.get("location"), "/");
  const post = await handle(new Request("https://borgo.abcastor.com/cities", { method: "POST" }), env);
  assert.equal(post.status, 308, "a redirect of a write keeps its method");
});

test("pages, 404s and open data pass through; the API keeps its open CORS header", async () => {
  const page = await handle(new Request("https://borgo.abcastor.com/"), env);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "<!doctype html>");
  assert.equal((await handle(new Request("https://borgo.abcastor.com/nope/"), env)).status, 404);
  const api = await handle(new Request("https://borgo.abcastor.com/api/city/turin-it.json"), env);
  assert.equal(api.headers.get("access-control-allow-origin"), "*");
  assert.equal(page.headers.get("access-control-allow-origin"), null);
});
