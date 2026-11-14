// D1's interface over node:sqlite, as much of it as the Worker uses, with the real migrations applied; and the
// Worker wired to it, for tests that drive the community inbox end to end.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { PlacesMeta } from "../src/community/figures.ts";
import { resetMetaCache, type D1Like, type D1Statement } from "../src/site/community-api.ts";
import { handle, type Env } from "../src/site/worker.ts";

export function fakeD1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../migrations/0001_community.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...v) => stmt(sql, v),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => raw.prepare(sql).run(...(args as never[])),
    first: async <T,>() => (raw.prepare(sql).get(...(args as never[])) as T) ?? null,
  });
  return { raw, prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

export const META: PlacesMeta = {
  places: { "turin-it": ["Turin", "IT", "EUR"], "london-gb": ["London", "GB", "GBP"] },
  fx: { GBP: 0.84 },
  official: { "london-gb": { rent_1bed: { value: 2200, source: "Office for National Statistics", period: "2026-09" } } },
};
const PAGE = `<!doctype html><h2 id="community">From people who live here</h2><!--community:turin-it--><div class="cm-figs"><p>placeholder</p></div><!--/community--><form></form>`;

export function envWith(db = fakeD1()): Env & { db: ReturnType<typeof fakeD1> } {
  resetMetaCache();
  return {
    db,
    COMMUNITY: db,
    ASSETS: {
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === "/api/community/places.json") return new Response(JSON.stringify(META), { headers: { "content-type": "application/json" } });
        if (pathname === "/city/turin-it/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
        return new Response("not found", { status: 404 });
      },
    },
  };
}

/** A fetch that answers from the Worker over the fake database, as if it were the live site. */
export function workerFetch(env: Env): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(`${req.method} ${new URL(req.url).pathname}`);
    const headers = new Headers(req.headers);
    headers.set("cf-connecting-ip", "192.0.2.50");
    return handle(new Request(req.url, { method: req.method, headers, body: req.method === "POST" ? await req.text() : undefined }), env);
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}
