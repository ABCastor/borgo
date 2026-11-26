// Borgo's MCP server on the web: https://borgo.abcastor.com/mcp, Streamable HTTP at the SDK's latest protocol, so an assistant
// connects with one address and nothing to install. It is stateless: each POST carries one JSON-RPC message or a
// batch and gets its answer as JSON; there are no sessions and no stream to open (GET and DELETE answer 405).
// It carries the tools of tools.ts, which read Borgo's published data, plus the community tools: submit_figures sends
// nothing without the person's yes (confirm true), and goes through the same inbox, limits and review as the site.
// What it keeps: a count of calls per day for each method and tool, and how many failed. Never the arguments, the
// answers, the address or anything else about who asked. Each network may send MCP_PER_MINUTE requests a minute.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Dataset } from "../core/types.ts";
import { lazyFiles, partFiles, withParts, type PartFile } from "../registry/licences.ts";
import type { RegistryEntry } from "../registry/schema.ts";
import type { D1Like } from "../site/community-api.ts";
import { instructions, registerShared, SERVER_VERSION, SHARED_TOOLS } from "./tools.ts";

export const MCP_PATH = "/mcp";
/** Requests a minute from one network, set on the rate-limit binding in wrangler.jsonc. */
export const MCP_PER_MINUTE = 60;
/** The largest request body read: a full compare with a household is a few kilobytes. */
export const MCP_MAX_BODY = 65_536;
/** The site file the compare chart's MCP App document is read from (written by scripts/build.ts). */
export const VIEW_FILE = "/data/mcp-view.txt";

/** Cloudflare's rate-limit binding: one call per request, keyed by the network, nothing stored by us. */
export interface RateLimit {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

/** The parts of the Worker's environment the remote server uses. */
export interface McpEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** The community database, which also holds the call counts (migrations/0002_mcp_counts.sql). */
  COMMUNITY?: D1Like;
  MCP_LIMIT?: RateLimit;
}

export interface Waiter {
  waitUntil(p: Promise<unknown>): void;
}

interface Loaded {
  data: Dataset;
  registry: RegistryEntry[];
  view: () => Promise<string>;
}

// What a Worker instance keeps between requests is finished values, never a promise: a promise started by one request
// cannot settle in another (Workers compatibility flag handle_cross_request_promise_resolution), so a read whose request
// ended first, a client that hung up, would leave every later request waiting on it. A cold instance under concurrent
// first requests reads twice; that is cheaper than one stuck instance.
let loaded: Loaded | null = null;
/** For tests: forget the data read before. */
export const resetMcpData = () => void (loaded = null);

async function asset<T>(env: McpEnv, origin: string, path: string): Promise<T> {
  const res = await env.ASSETS.fetch(new Request(new URL(path, origin), { method: "GET" }));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** The published dataset with its part files, the registry and the chart view, read once per Worker instance. */
async function load(env: McpEnv, origin: string): Promise<Loaded> {
  if (loaded) return loaded;
  const [snapshot, registry] = await Promise.all([asset<Dataset>(env, origin, "/data/dataset.json"), asset<RegistryEntry[]>(env, origin, "/data/registry.json")]);
  const files = await Promise.all([...partFiles(snapshot), ...lazyFiles(snapshot).map((l) => l.file)].map((f) => asset<PartFile>(env, origin, `/${f.replace(/^\//, "")}`)));
  let view: string | null = null;
  const viewText = async () => {
    if (view !== null) return view;
    const r = await env.ASSETS.fetch(new Request(new URL(VIEW_FILE, origin)));
    if (!r.ok) throw new Error(`${VIEW_FILE}: ${r.status}`);
    return (view = await r.text());
  };
  // A failed read throws before this line, so it is tried again on the next request, not kept.
  return (loaded ??= { data: withParts(snapshot, files), registry, view: viewText });
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(res: Response, extra: Record<string, string> = {}): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...CORS, "cache-control": "no-store", ...extra })) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** A JSON-RPC error with no id, as the transport answers a request it cannot take. */
function rpcError(status: number, code: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store", ...extra } });
}

const KNOWN = new Set<string>(SHARED_TOOLS);

/** What a message is counted as: its method, or for a tool call `tools/call:<tool>`; a name we do not know is "other". */
export function countedAs(msg: unknown): string | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { method?: unknown; params?: { name?: unknown } };
  if (typeof m.method !== "string") return null;
  if (m.method === "tools/call") return `tools/call:${typeof m.params?.name === "string" && KNOWN.has(m.params.name) ? m.params.name : "other"}`;
  return /^[a-z/_]{1,40}$/i.test(m.method) ? m.method : "other";
}

/** One count per message: what it called and whether its answer was an error (JSON-RPC, or a tool result marked isError). */
export function tally(sent: unknown, reply: unknown): { what: string; failed: boolean }[] {
  const answers = (Array.isArray(reply) ? reply : [reply]) as { id?: unknown; error?: unknown; result?: { isError?: unknown } }[];
  const failedIds = new Set(answers.filter((r) => r && typeof r === "object" && (r.error !== undefined || r.result?.isError === true)).map((r) => r.id));
  return (Array.isArray(sent) ? sent : [sent]).flatMap((m) => {
    const what = countedAs(m);
    return what ? [{ what, failed: failedIds.has((m as { id?: unknown }).id ?? Symbol()) }] : [];
  });
}

const day = (now: Date) => now.toISOString().slice(0, 10);

/** Adds one to each counter: the day, what was called, and whether it failed. Nothing else is written. */
export async function count(env: McpEnv, rows: { what: string; failed: boolean }[], now = new Date()): Promise<void> {
  const db = env.COMMUNITY;
  if (!db || !rows.length) return;
  try {
    await db.batch(rows.map((r) => db.prepare("INSERT INTO mcp_counts (day, what, calls, errors) VALUES (?, ?, 1, ?) ON CONFLICT (day, what) DO UPDATE SET calls = calls + 1, errors = errors + excluded.errors").bind(day(now), r.what, r.failed ? 1 : 0)));
  } catch {
    // A counter that cannot be written costs the count, never the answer.
  }
}

/** Answers a request to /mcp. `community` is the Worker's own community inbox, called in place of the network. */
export async function mcpRemote(request: Request, env: McpEnv, wait: Waiter | undefined, community: (r: Request) => Promise<Response>): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST")
    return rpcError(405, -32000, "Borgo's MCP server is stateless: send JSON-RPC messages with POST (Streamable HTTP, MCP 2025-11-25). There is no stream to open and no session to end. Guide: https://borgo.abcastor.com/llms.txt", { allow: "POST, OPTIONS" });
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.MCP_LIMIT && !(await env.MCP_LIMIT.limit({ key: ip })).success) {
    wait?.waitUntil(count(env, [{ what: "limited", failed: false }]));
    return rpcError(429, -32000, `Too many requests from this network: at most ${MCP_PER_MINUTE} a minute. Try again in a minute.`, { "retry-after": "60" });
  }
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MCP_MAX_BODY) return rpcError(413, -32600, `The request is larger than ${MCP_MAX_BODY} bytes.`);
  const text = await request.text();
  if (text.length > MCP_MAX_BODY) return rpcError(413, -32600, `The request is larger than ${MCP_MAX_BODY} bytes.`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rpcError(400, -32700, "Parse error: the body is not JSON.");
  }
  const origin = new URL(request.url).origin;
  let loaded: Loaded;
  try {
    loaded = await load(env, origin);
  } catch {
    return rpcError(503, -32603, "Borgo's data could not be read just now; try again in a moment.", { "retry-after": "10" });
  }
  // The community tools reach the Worker's own inbox in place, with the caller's network for its daily limits.
  const communityFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const headers = new Headers(req.headers);
    headers.set("cf-connecting-ip", ip);
    return community(new Request(new URL(new URL(req.url).pathname + new URL(req.url).search, origin), { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text() }));
  }) as typeof fetch;
  const server = new McpServer({ name: "borgo", version: SERVER_VERSION }, { instructions: instructions(false) });
  registerShared(server, loaded.data, { registry: loaded.registry, view: loaded.view, local: false, communityFetch });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  // The transport reads the body itself unless given it: the copy read above is passed on as parsed.
  const headers = new Headers(request.headers);
  // Clients that ask only for JSON are answered in JSON too; the transport wants both types listed.
  if (!/text\/event-stream/.test(headers.get("accept") ?? "") || !/application\/json/.test(headers.get("accept") ?? "")) headers.set("accept", "application/json, text/event-stream");
  const res = await transport.handleRequest(new Request(request.url, { method: "POST", headers }), { parsedBody: body });
  let out = res;
  let answer: unknown = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const reply = await res.text();
    try {
      answer = JSON.parse(reply);
    } catch {
      answer = { error: true };
    }
    out = new Response(reply, { status: res.status, headers: res.headers });
  }
  // A reply that is no JSON-RPC answer at all (a 4xx from the transport) counts every message as failed.
  const rows = tally(body, answer).map((r) => (res.status >= 400 && !answer ? { ...r, failed: true } : r));
  wait?.waitUntil(Promise.all([count(env, rows), server.close()]));
  return withCors(out);
}
