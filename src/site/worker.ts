// The Worker in front of Borgo's static files (wrangler.jsonc). It answers every request before the files do, for two
// reasons that search engines read as one: a page has one address. Plain http moves to https for good (301), and the
// clean-address redirects the static host makes (/cities to /cities/, /index.html to /) become permanent (301) instead
// of its temporary 307. Everything else is the file as the host serves it.

/** The static-files binding, as much of it as this Worker uses. */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Assets;
}

/** A redirect the host made temporary, made permanent: same target, status 301 for a read, 308 for anything else. */
function permanent(res: Response, method: string): Response {
  const location = res.headers.get("location");
  if (!location || (res.status !== 307 && res.status !== 302)) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", "public, max-age=3600");
  return new Response(null, { status: method === "GET" || method === "HEAD" ? 301 : 308, headers });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return new Response(null, { status: 301, headers: { location: url.toString(), "cache-control": "public, max-age=86400" } });
  }
  const res = permanent(await env.ASSETS.fetch(request), request.method);
  // Open data stays open to other sites' browser code (as dist/_headers says), also when the file passes through here.
  if (/^\/(api|data)\//.test(url.pathname) && res.status < 300 && !res.headers.has("access-control-allow-origin")) {
    const out = new Response(res.body, res);
    out.headers.set("access-control-allow-origin", "*");
    return out;
  }
  return res;
}

export default { fetch: handle };
