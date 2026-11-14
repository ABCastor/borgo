// The community inbox on the Worker: people send their own figures, D1 keeps them without anything about the sender,
// and every read runs the automated review (src/community/figures.ts) before a figure is shown or published.
//
// POST /api/community/submit         JSON (CLI, MCP, app) or a plain form post (the static page without JavaScript)
// POST /api/community/remove         a removal code deletes the submission it came with
// GET  /api/community/city/<id>.json one place's figures after review
// GET  /api/community/dataset.json   every entry with its review verdict, CC BY 4.0 (also .csv)
//
// What is stored per figure: the place, the figure, the amount, its currency, the day (UTC), how it was sent, and a
// hash of the removal code. The daily limit keeps a hash of the network address salted with a random value for that
// day; salts and counts older than yesterday are deleted on every send.
import { datasetCsv, datasetRows, fromForm, LICENCE, LIMITS, parseSubmission, reviewAll, summarize, type Entry, type PlacesMeta } from "../community/figures.ts";

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

// The tables: migrations/0001_community.sql.

export interface CommunityEnv {
  COMMUNITY?: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body, null, 2), { status, headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extra } });

let metaCache: { at: number; meta: PlacesMeta } | null = null;
/** The places file the build wrote, read through the static host and kept for ten minutes. */
export async function loadMeta(env: CommunityEnv, origin: string): Promise<PlacesMeta> {
  if (metaCache && Date.now() - metaCache.at < 600_000) return metaCache.meta;
  const res = await env.ASSETS.fetch(new Request(`${origin}/api/community/places.json`));
  if (!res.ok) throw new Error(`places.json ${res.status}`);
  metaCache = { at: Date.now(), meta: (await res.json()) as PlacesMeta };
  return metaCache.meta;
}
export const resetMetaCache = () => void (metaCache = null);

const today = (now: Date) => now.toISOString().slice(0, 10);
const yesterday = (now: Date) => new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function token(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
}

/** Read at most LIMITS.bodyBytes of the body; null when it is larger. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.bodyBytes) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > LIMITS.bodyBytes ? null : text;
}

/** The day's salted hash of the sender's network, after deleting salts and counts older than yesterday. */
async function networkKey(db: D1Like, request: Request, now: Date): Promise<string> {
  const day = today(now);
  await db.batch([
    db.prepare("DELETE FROM salts WHERE day < ?").bind(yesterday(now)),
    db.prepare("DELETE FROM limits WHERE day < ?").bind(yesterday(now)),
    db.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").bind(day, token(32)),
  ]);
  const salt = (await db.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first<{ salt: string }>())?.salt ?? "";
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await sha256(`${salt}|${ip}`)).slice(0, 32);
}

async function entriesOf(db: D1Like, city?: string): Promise<Entry[]> {
  const q = city ? db.prepare("SELECT id, city, figure, value, currency, day, via FROM entries WHERE city = ?").bind(city) : db.prepare("SELECT id, city, figure, value, currency, day, via FROM entries LIMIT 100000");
  return (await q.all<Entry>()).results;
}

/** One place's community figures after review, as the city page, the app, the CLI and the MCP server read them. */
export async function cityFigures(db: D1Like, meta: PlacesMeta, city: string, now = new Date()) {
  const entries = await entriesOf(db, city);
  const verdicts = reviewAll(entries, now, meta);
  const place = meta.places[city]!;
  return {
    city,
    name: place[0],
    country: place[1],
    currency: place[2],
    licence: LICENCE,
    note: "Figures people report for themselves, after automated review: the median of shown entries (a rating: their mean), the middle half from 3 entries, the count and the months they arrived. Shown beside official figures, never mixed into them or into scores.",
    figures: summarize(entries, verdicts, meta, city),
  };
}

const FORM_TYPES = /^(application\/x-www-form-urlencoded|multipart\/form-data)/;

async function submit(request: Request, env: CommunityEnv, db: D1Like, origin: string, now: Date): Promise<Response> {
  const isForm = FORM_TYPES.test(request.headers.get("content-type") ?? "");
  const text = await readBody(request);
  if (text === null) return json({ error: `Too large: a submission is at most ${LIMITS.bodyBytes} bytes.` }, 413);
  let input: unknown;
  let honeypot = "";
  if (isForm) {
    const form = fromForm(new URLSearchParams(text));
    honeypot = form.honeypot;
    const { honeypot: _, ...rest } = form;
    input = rest;
  } else {
    try {
      input = JSON.parse(text);
    } catch {
      return json({ error: "Send JSON: {\"city\": \"turin-it\", \"rent\": {...}, \"consent\": true}." }, 400);
    }
  }
  const meta = await loadMeta(env, origin);
  const back = (city: string, q: string) => new Response(null, { status: 303, headers: { location: `${origin}/city/${city}/?${q}#community`, "cache-control": "no-store" } });
  // A filled hidden field is a bot: it is told it worked, and nothing is kept.
  if (honeypot) return isForm ? back(String((input as { city?: string }).city ?? ""), "sent=0") : json({ ok: true, figures: [] }, 201);
  const parsed = parseSubmission(input, meta);
  if (!parsed.ok) return isForm ? formError(parsed.problems, String((input as { city?: string }).city ?? ""), origin) : json({ error: parsed.problems.join(" "), problems: parsed.problems }, 400);
  const p = parsed.value;
  const key = await networkKey(db, request, now);
  const day = today(now);
  const counts = (await db.prepare("SELECT key, n FROM limits WHERE day = ? AND key IN (?, ?)").bind(day, `n:${key}`, `p:${key}:${p.city}`).all<{ key: string; n: number }>()).results;
  const all = counts.find((c) => c.key.startsWith("n:"))?.n ?? 0;
  const here = counts.find((c) => c.key.startsWith("p:"))?.n ?? 0;
  if (all >= LIMITS.perNetworkDay || here >= LIMITS.perNetworkPlaceDay) {
    const msg = here >= LIMITS.perNetworkPlaceDay ? `This network already sent ${here} submissions for this place today; try again tomorrow.` : `This network already sent ${all} submissions today; try again tomorrow.`;
    return isForm ? formError([msg], p.city, origin) : json({ error: msg }, 429, { "retry-after": "3600" });
  }
  const code = token(20);
  const removal = await sha256(code);
  const ids = p.figures.map(() => token(12));
  await db.batch([
    ...p.figures.map((f, i) => db.prepare("INSERT INTO entries (id, city, figure, value, currency, day, via, removal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(ids[i], p.city, f.figure, f.value, p.currency, day, isForm ? "web" : p.via, removal)),
    db.prepare("INSERT INTO limits (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1").bind(day, `n:${key}`),
    db.prepare("INSERT INTO limits (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1").bind(day, `p:${key}:${p.city}`),
  ]);
  const entries = await entriesOf(db, p.city);
  const verdicts = reviewAll(entries, now, meta);
  const figures = p.figures.map((f, i) => ({ id: ids[i]!, figure: f.figure, value: f.value, currency: p.currency, review: verdicts.get(ids[i]!) ?? { status: "shown" as const } }));
  const shown = figures.filter((f) => f.review.status === "shown").length;
  if (isForm) return back(p.city, `sent=${shown}&held=${figures.length - shown}&code=${code}`);
  return json(
    {
      ok: true,
      city: p.city,
      name: meta.places[p.city]![0],
      figures,
      removal: code,
      removalNote: "Keep this code to remove what you sent: POST {\"code\": \"...\"} to /api/community/remove, or borgo community remove <code>.",
      figuresUrl: `${origin}/api/community/city/${p.city}.json`,
      licence: LICENCE,
    },
    201,
  );
}

function formError(problems: string[], city: string, origin: string): Response {
  const q = new URLSearchParams({ problem: problems.join(" ") });
  return new Response(null, { status: 303, headers: { location: `${origin}/city/${encodeURIComponent(city)}/?${q}#community`, "cache-control": "no-store" } });
}

async function remove(request: Request, db: D1Like, origin: string): Promise<Response> {
  const isForm = FORM_TYPES.test(request.headers.get("content-type") ?? "");
  const text = await readBody(request);
  if (text === null) return json({ error: "Too large." }, 413);
  let code = "";
  let city = "";
  if (isForm) {
    const f = new URLSearchParams(text);
    code = (f.get("code") ?? "").trim();
    city = (f.get("city") ?? "").trim();
  } else {
    try {
      code = String((JSON.parse(text) as { code?: unknown }).code ?? "").trim();
    } catch {
      return json({ error: "Send JSON: {\"code\": \"...\"}." }, 400);
    }
  }
  if (!/^[a-z0-9]{20}$/.test(code)) return isForm ? formError(["That is not a removal code: 20 letters and digits."], city, origin) : json({ error: "A removal code is 20 letters and digits." }, 400);
  const removal = await sha256(code);
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM entries WHERE removal = ?").bind(removal).first<{ n: number }>())?.n ?? 0;
  await db.prepare("DELETE FROM entries WHERE removal = ?").bind(removal).run();
  if (isForm && /^[a-z0-9-]+$/.test(city)) return new Response(null, { status: 303, headers: { location: `${origin}/city/${city}/?removed=${n}#community`, "cache-control": "no-store" } });
  return json({ ok: true, removed: n });
}

/** Answers every /api/community/ request except places.json, which is a static file. */
export async function communityApi(request: Request, env: CommunityEnv, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/community/") || path === "/api/community/places.json") return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
  const db = env.COMMUNITY;
  if (!db) return json({ error: "Community figures are not available here." }, 503);
  try {
    if (path === "/api/community/submit") return request.method === "POST" ? await submit(request, env, db, url.origin, now) : json({ error: "POST a submission here; see /llms.txt for its fields." }, 405, { allow: "POST" });
    if (path === "/api/community/remove") return request.method === "POST" ? await remove(request, db, url.origin) : json({ error: "POST {\"code\": \"...\"} here." }, 405, { allow: "POST" });
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Read with GET." }, 405, { allow: "GET" });
    const meta = await loadMeta(env, url.origin);
    const city = /^\/api\/community\/city\/([a-z0-9-]+)\.json$/.exec(path)?.[1];
    if (city) {
      if (!meta.places[city]) return json({ error: `No place "${city}" takes community figures.` }, 404);
      return json(await cityFigures(db, meta, city, now), 200, { "cache-control": "public, max-age=30" });
    }
    const set = /^\/api\/community\/dataset\.(json|csv)$/.exec(path)?.[1];
    if (set) {
      const entries = await entriesOf(db);
      const rows = datasetRows(entries, reviewAll(entries, now, meta), meta);
      if (set === "csv") return new Response(datasetCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300", "content-disposition": "inline; filename=borgo-community.csv" } });
      return json(
        {
          name: "Borgo community figures",
          description: "Rents, everyday prices, take-home pay by kind of work, and a 1 to 5 rating of living there, as people report them for themselves on Borgo. Every entry with the automated review's verdict: shown entries make the figures on the site, held ones wait for others to report similar amounts. Amounts in the place's own currency, rounded to three significant digits; the month each arrived.",
          licence: LICENCE,
          generated: now.toISOString(),
          entries: rows.length,
          rows,
        },
        200,
        { "cache-control": "public, max-age=300" },
      );
    }
    return json({ error: "Not found. Read /api/community/city/<id>.json or /api/community/dataset.json; send to /api/community/submit." }, 404);
  } catch (e) {
    return json({ error: `Community figures are unavailable right now (${(e as Error).message}).` }, 503);
  }
}
