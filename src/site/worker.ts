// The Worker in front of Borgo's static files (wrangler.jsonc). It answers every request before the files do:
// - a page has one address, for search engines: plain http moves to https for good (301), and the clean-address
//   redirects the static host makes (/cities to /cities/, /index.html to /) become permanent (301), not 307;
// - the community inbox (src/site/community-api.ts) takes and serves the figures people add, and each city page gets
//   that city's community figures filled in where the page marks them;
// - the World Bank's API, which answers browsers without the header that lets another site read it, is passed
//   through for the app's place fetch (/api/wb/), cached for a day;
// - the app page (/) starts where the visitor is: the page prerendered for the region of the request's country
//   (src/core/visit-region.ts), with that country named in why its cities are shown. The country is read for this one
//   answer and never stored or logged; the region pages themselves (/r/...) are not addresses anyone else can open;
// - /mcp is Borgo's MCP server for assistants (src/mcp/remote.ts): Streamable HTTP, stateless, rate-limited per
//   network, counting calls per tool and nothing else.
// Everything else is the file as the host serves it; the app's own files (script, styles, fonts, data) skip this script
// altogether (wrangler.jsonc run_worker_first), so the Worker costs them nothing.
import { cityFigures, communityApi, loadMeta, type CommunityEnv, type D1Like } from "./community-api.ts";
import { communityFigures, removedNote, sentNote } from "../community/view.ts";
import { html } from "../ui/dom.ts";
import { countryName, fromText, regionOf, regionPage, type VisitSpread } from "../core/visit-region.ts";
import { MCP_PATH, mcpRemote, type RateLimit, type Waiter } from "../mcp/remote.ts";

/** The static-files binding, as much of it as this Worker uses. */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env extends CommunityEnv {
  ASSETS: Assets;
  COMMUNITY?: D1Like;
  /** Requests a minute per network to /mcp (wrangler.jsonc ratelimits). */
  MCP_LIMIT?: RateLimit;
  /** OpenAI's plugin-directory domain check: the exact token its portal shows, served as plain text (a Worker secret). */
  OPENAI_APPS_CHALLENGE?: string;
}

/** The path OpenAI reads the domain-verification token from. */
export const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

/** A redirect the host made temporary, made permanent: same target, status 301 for a read, 308 for anything else. */
function permanent(res: Response, method: string): Response {
  const location = res.headers.get("location");
  if (!location || (res.status !== 307 && res.status !== 302)) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", "public, max-age=3600");
  return new Response(null, { status: method === "GET" || method === "HEAD" ? 301 : 308, headers });
}

/** Only the indicator reads the app's fetchers make: /api/wb/v2/country/<iso>/indicator/<code>?format=json&... */
const WB_PATH = /^\/api\/wb(\/v2\/country\/[A-Za-z]{2,3}\/indicator\/[A-Za-z0-9._]{2,40})$/;
const WB_PARAMS = new Set(["format", "per_page", "date", "source", "mrv", "page"]);

/** One World Bank read, given up after `timeoutMs` so a slow upstream answers as a 504 the app can read and retry. */
export async function worldBank(url: URL, path: string, timeoutMs = 20_000): Promise<Response> {
  // Only known parameters with plain values pass, written as the app wrote them (a date range keeps its colon).
  const query = [...url.searchParams].filter(([k, v]) => WB_PARAMS.has(k) && /^[A-Za-z0-9:.]{1,20}$/.test(v)).map(([k, v]) => `${k}=${v}`).join("&");
  const up = `https://api.worldbank.org${path}${query ? `?${query}` : ""}`;
  const cf = { cacheTtl: 86_400, cacheEverything: true };
  let res: Response;
  try {
    res = await fetch(up, { headers: { "user-agent": "borgo/0.2 (open-source city comparison; https://github.com/ABCastor/borgo)", accept: "application/json" }, cf, signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
  } catch (e) {
    const slow = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return new Response(JSON.stringify({ error: slow ? `The World Bank did not answer within ${Math.round(timeoutMs / 1000)} s` : `World Bank unreachable: ${(e as Error).message}` }), { status: slow ? 504 : 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" } });
  }
  const out = new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "access-control-allow-origin": "*", "cache-control": res.ok ? "public, max-age=86400" : "no-store" } });
  return out;
}

const CITY_PAGE = /^\/city\/([a-z0-9-]+)\/$/;
const MARK = /<!--community:([a-z0-9-]+)-->[\s\S]*?<!--\/community-->/;

/** A city page with its community figures in place, and the note after a plain-form send or removal. */
async function cityPage(request: Request, env: Env, res: Response): Promise<Response> {
  if (!env.COMMUNITY || res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const page = await res.text();
  const m = MARK.exec(page);
  if (!m) return new Response(page, res);
  const url = new URL(request.url);
  const q = url.searchParams;
  let body: string;
  try {
    const meta = await loadMeta(env, url.origin);
    const figs = await cityFigures(env.COMMUNITY, meta, m[1]!);
    body = communityFigures(figs.name, figs.figures, `/api/community/city/${m[1]}.json`).value;
  } catch {
    body = html`<p class="cm-empty">Community figures are unavailable right now.</p>`.value;
  }
  const code = q.get("code") ?? "";
  const note = q.has("problem")
    ? html`<div class="cm-sent cm-problem" role="alert"><p><b>Not sent.</b> ${q.get("problem")!.slice(0, 600)}</p></div>`.value
    : q.has("sent")
      ? sentNote(Number(q.get("sent")) || 0, Number(q.get("held")) || 0, /^[a-z0-9]{20}$/.test(code) ? code : "", m[1]!).value
      : q.has("removed")
        ? removedNote(Number(q.get("removed")) || 0).value
        : "";
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  // The figures change as people add them: a short shared cache, and none for a page carrying someone's code.
  headers.set("cache-control", note ? "no-store" : "public, max-age=60");
  if (note) headers.set("x-robots-tag", "noindex");
  return new Response(page.replace(MARK, `${note}<div class="cm-figs" data-community-figs="${m[1]}">${body}</div>`), { status: 200, headers });
}

const FROM = /<span class="v-from" data-where="(in|mixed|out)">[^<]*<\/span>/;

/** The app page for the request's country: its region's prerendered page, with the country in the html element and the reason. */
async function appPage(request: Request, env: Env, url: URL): Promise<Response> {
  const country = ((request as Request & { cf?: { country?: string } }).cf?.country ?? "").toUpperCase();
  const region = regionOf(country);
  // A plain read of the region's file: the visitor's conditional headers belong to whichever variant they saw last.
  const res = await env.ASSETS.fetch(new Request(new URL(regionPage(region), url), { method: "GET" }));
  if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  // Only a code that names a country is passed on (Cloudflare sends XX when it cannot tell, T1 for Tor).
  const code = countryName(country) ? country : "";
  let page = await res.text();
  if (code) page = page.replace(/<html([^>]*) data-country=""/, `<html$1 data-country="${code}"`).replace(FROM, (_, w: VisitSpread) => `<span class="v-from" data-where="${w}">${fromText(region, code, w)}</span>`);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  // The page depends on where the request comes from: never kept by a shared cache, checked again by the browser.
  headers.set("cache-control", "private, no-cache");
  return new Response(request.method === "HEAD" ? null : page, { status: 200, headers });
}

export async function handle(request: Request, env: Env, ctx?: Waiter): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return new Response(null, { status: 301, headers: { location: url.toString(), "cache-control": "public, max-age=86400" } });
  }
  if (url.pathname === OPENAI_CHALLENGE_PATH) {
    const token = env.OPENAI_APPS_CHALLENGE?.trim();
    return token ? new Response(token, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }) : new Response("Not found", { status: 404 });
  }
  if (url.pathname === MCP_PATH || url.pathname === `${MCP_PATH}/`) return mcpRemote(request, env, ctx, async (r) => (await communityApi(r, env)) ?? new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } }));
  const community = await communityApi(request, env);
  if (community) return community;
  const wb = WB_PATH.exec(url.pathname);
  if (wb && (request.method === "GET" || request.method === "HEAD")) return worldBank(url, wb[1]!);
  // The region pages are served as / only.
  if (url.pathname.startsWith("/r/")) return env.ASSETS.fetch(new Request(new URL("/r/-", url), { method: request.method }));
  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return appPage(request, env, url);
  let res = permanent(await env.ASSETS.fetch(request), request.method);
  if (CITY_PAGE.test(url.pathname) && request.method === "GET") res = await cityPage(request, env, res);
  // Open data stays open to other sites' browser code (as dist/_headers says), also when the file passes through here.
  if (/^\/(api|data)\//.test(url.pathname) && res.status < 300 && !res.headers.has("access-control-allow-origin")) {
    const out = new Response(res.body, res);
    out.headers.set("access-control-allow-origin", "*");
    return out;
  }
  return res;
}

export default { fetch: (request: Request, env: Env, ctx: Waiter) => handle(request, env, ctx) };
