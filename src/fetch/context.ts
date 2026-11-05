// What a fetcher may use: the web fetch API with retries, a cache for large files, the clock and the runtime.
// No file system here, so the same fetchers run in the browser, the CLI, the MCP server and the snapshot build.
import type { City, Observation } from "../core/types.ts";
import type { Runtime } from "../registry/schema.ts";

export const USER_AGENT = "borgo/0.2 (open-source city comparison; https://github.com/ABCastor/borgo)";

/** Large files (a station list, a spreadsheet) fetched once and kept: on disk in Node, in memory in the browser. */
export interface BulkCache {
  get(url: string): Promise<Uint8Array | null>;
  set(url: string, data: Uint8Array): Promise<void>;
}

export interface FetchCtx {
  runtime: Runtime;
  json<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
  /** A large file, from the cache when present. */
  bulk(url: string): Promise<Uint8Array>;
  now(): Date;
}

export interface CtxOptions {
  runtime: Runtime;
  fetch?: typeof fetch;
  bulkCache?: BulkCache;
  now?: () => Date;
  /** Wait between retries, ms; tests set 0. */
  backoff?: number;
  /** Give up on one request after this long, ms; it then counts as a failed attempt. Large files get four times as long. */
  timeout?: number;
}

export function memoryBulkCache(): BulkCache {
  const m = new Map<string, Uint8Array>();
  return { get: async (u) => m.get(u) ?? null, set: async (u, d) => void m.set(u, d) };
}

export function makeCtx(o: CtxOptions): FetchCtx {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const cache = o.bulkCache ?? memoryBulkCache();
  const backoff = o.backoff ?? 1500;
  // Browsers forbid setting User-Agent; Node sends ours so publishers can see who asks.
  const headers = (init?: RequestInit): HeadersInit => (o.runtime === "node" ? { "User-Agent": USER_AGENT, ...(init?.headers as Record<string, string> | undefined) } : (init?.headers ?? {}));
  const timeout = o.timeout ?? 45_000;
  // A stalled connection would otherwise hang the whole fetch: every request has a deadline, and a timeout is retried.
  async function get(url: string, init?: RequestInit, ms = timeout): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, { ...init, headers: headers(init), signal: AbortSignal.timeout(ms) });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        if (!timedOut || attempt >= 3) throw new Error(timedOut ? `no answer within ${Math.round(ms / 1000)} s from ${new URL(url).host}` : `${(e as Error).message} (${new URL(url).host})`);
        continue;
      }
      if (res.ok) return res;
      if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${res.statusText || "error"} from ${new URL(url).host}${res.status === 429 ? " (rate limit: try again later)" : ""}`);
      // A server that says how long to wait is believed, up to a minute.
      const after = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : backoff * attempt));
    }
  }
  return {
    runtime: o.runtime,
    json: async (url, init) => (await get(url, init)).json(),
    text: async (url, init) => (await get(url, init)).text(),
    async bulk(url) {
      const hit = await cache.get(url);
      if (hit) return hit;
      const data = new Uint8Array(await (await get(url, undefined, timeout * 4)).arrayBuffer());
      await cache.set(url, data);
      return data;
    },
    now: o.now ?? (() => new Date()),
  };
}

/** One source's fetch for one place. */
export interface Fetcher {
  /** Registry id of the source. */
  source: string;
  /** Bumped when what it computes changes, so cached figures from older code can be told apart. */
  version: number;
  runtimes: Runtime[];
  /** Whether it can say anything about this place (a national rent table only covers its country). */
  covers?(city: City): boolean;
  /** Run only when this other source gave no figure (a fallback). */
  fallbackFor?: string;
  fetch(city: City, ctx: FetchCtx): Promise<Observation[]>;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** The last five full calendar years, e.g. 2021-2025 during 2026. */
export function lastFullYears(now: Date, n = 5): { start: string; end: string; period: string; years: number } {
  const last = now.getUTCFullYear() - 1;
  const first = last - n + 1;
  return { start: `${first}-01-01`, end: `${last}-12-31`, period: `${first}-${last}`, years: n };
}

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
