// Tells search engines which pages changed in a deploy, through IndexNow (https://www.indexnow.org): the URLs in
// dist/sitemap.xml whose lastmod differs from the sitemap the live site served before the deploy, posted to
// api.indexnow.org, which shares them with every engine that takes part (Bing, Yandex, Seznam, Naver, Yep). Without
// that earlier sitemap, every URL goes. The key is public by design: public/root/<key>.txt, which scripts/build.ts
// copies to the site's root, proves the site sent it.
// npm run deploy runs `--save-live --previous build/live-sitemap.xml` before wrangler deploys and the ping with the
// same --previous after it. A failure here only warns: the deploy has already happened.
// Usage: node scripts/indexnow.ts [--save-live] [--dry-run] [--all] [--sitemap dist/sitemap.xml] [--previous <file>]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT } from "../pipeline/lib.ts";
import { SITE_ORIGIN } from "./site.ts";

/** Where pings go; INDEXNOW_ENDPOINT points it elsewhere (the tests use a local server). */
export const INDEXNOW_ENDPOINT = process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";
/** The most URLs IndexNow takes in one request. */
export const INDEXNOW_MAX = 10_000;

/** The key and its file name, from public/root/<32 hex characters>.txt, whose content must be the key itself. */
export function indexNowKey(dir = join(ROOT, "public/root")): { key: string; file: string } {
  const files = readdirSync(dir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (files.length !== 1) throw new Error(`Expected one IndexNow key file public/root/<32 hex>.txt, found ${files.length}.`);
  const file = files[0]!;
  const key = file.slice(0, -4);
  if (readFileSync(join(dir, file), "utf8").trim() !== key) throw new Error(`public/root/${file} must hold the key ${key} and nothing else.`);
  return { key, file };
}

/** The <loc> addresses of a sitemap. */
export function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

/** Each address of a sitemap with its lastmod ("" when it has none). */
export function sitemapEntries(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1]!.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (loc) out.set(loc.replace(/&amp;/g, "&"), m[1]!.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? "");
  }
  return out;
}

/** The addresses that are new or whose lastmod moved since the earlier sitemap. */
export function changedUrls(xml: string, previous: string): string[] {
  const before = sitemapEntries(previous);
  return [...sitemapEntries(xml)].filter(([loc, lastmod]) => !before.has(loc) || before.get(loc) !== lastmod || !lastmod).map(([loc]) => loc);
}

export interface IndexNowBody { host: string; key: string; keyLocation: string; urlList: string[] }

/** The request bodies for the site's URLs: only addresses on the site's own host, at most INDEXNOW_MAX in each. */
export function indexNowBodies(urls: string[], key: string, origin = SITE_ORIGIN): IndexNowBody[] {
  const host = new URL(origin).host;
  const own = [...new Set(urls)].filter((u) => URL.canParse(u) && new URL(u).host === host);
  const bodies: IndexNowBody[] = [];
  for (let i = 0; i < own.length; i += INDEXNOW_MAX) bodies.push({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: own.slice(i, i + INDEXNOW_MAX) });
  return bodies;
}

const warn = (msg: string) => console.warn(`IndexNow: ${msg}; the deploy itself is fine.`);

async function main(): Promise<number> {
  const { values: f } = parseArgs({ options: { "dry-run": { type: "boolean" }, sitemap: { type: "string" }, previous: { type: "string" }, "save-live": { type: "boolean" }, all: { type: "boolean" } } });
  const dry = !!f["dry-run"];
  const previousFile = f.previous ?? null;
  // Before a deploy: keep the sitemap the site serves now, so the ping after it can send only what changed.
  if (f["save-live"]) {
    if (!previousFile) {
      console.error("IndexNow: --save-live needs --previous <file>");
      return 1;
    }
    try {
      const res = await fetch(`${SITE_ORIGIN}/sitemap.xml`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mkdirSync(dirname(previousFile), { recursive: true });
      writeFileSync(previousFile, await res.text());
      console.log(`IndexNow: kept the live sitemap in ${previousFile}`);
    } catch (e) {
      rmSync(previousFile, { force: true });
      console.warn(`IndexNow: could not read the live sitemap (${(e as Error).message}); the ping will send every URL.`);
    }
    return 0;
  }
  let bodies: IndexNowBody[];
  let scope = "from the sitemap";
  try {
    const { key } = indexNowKey();
    const xml = readFileSync(f.sitemap ?? join(ROOT, "dist/sitemap.xml"), "utf8");
    const all = sitemapUrls(xml);
    let urls = all;
    if (!f.all && previousFile && existsSync(previousFile)) {
      urls = changedUrls(xml, readFileSync(previousFile, "utf8"));
      scope = `changed since the last deploy (of ${all.length})`;
      if (!urls.length) {
        console.log(`IndexNow: no page changed since the last deploy (${all.length} in the sitemap), so nothing was sent.`);
        if (!dry) rmSync(previousFile!, { force: true });
        return 0;
      }
    }
    bodies = indexNowBodies(urls, key);
    if (!bodies.length) throw new Error("the sitemap lists no address on the site's host");
  } catch (e) {
    if (dry) {
      console.error(`IndexNow: ${(e as Error).message}`);
      return 1;
    }
    warn(`nothing sent (${(e as Error).message})`);
    return 0;
  }
  const count = bodies.reduce((n, b) => n + b.urlList.length, 0);
  if (dry) {
    const b = bodies[0]!;
    console.log(`IndexNow dry run: would POST ${count} URLs ${scope} in ${bodies.length} request(s) to ${INDEXNOW_ENDPOINT}`);
    console.log(`  host ${b.host}, keyLocation ${b.keyLocation}`);
    for (const u of b.urlList.slice(0, 3)) console.log(`  ${u}`);
    if (count > 3) console.log(`  … and ${count - 3} more`);
    return 0;
  }
  // The engines fetch the key file to check the ping: say so plainly if the live site does not serve it.
  try {
    const live = await fetch(bodies[0]!.keyLocation, { signal: AbortSignal.timeout(15_000) });
    if (!live.ok || (await live.text()).trim() !== bodies[0]!.key) {
      warn(`${bodies[0]!.keyLocation} does not answer the key (${live.status}), so nothing was sent`);
      return 0;
    }
  } catch (e) {
    warn(`could not read ${bodies[0]!.keyLocation} (${(e as Error).message}), so nothing was sent`);
    return 0;
  }
  const answers: number[] = [];
  for (const body of bodies) {
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      answers.push(res.status);
      // 200: received; 202: received, the key is still being checked.
      if (res.status !== 200 && res.status !== 202) {
        warn(`${INDEXNOW_ENDPOINT} answered ${res.status} ${res.statusText} for ${body.urlList.length} URLs`);
        return 0;
      }
    } catch (e) {
      warn(`${INDEXNOW_ENDPOINT} did not answer (${(e as Error).message})`);
      return 0;
    }
  }
  if (previousFile) rmSync(previousFile, { force: true });
  console.log(`IndexNow: sent ${count} URLs ${scope} to ${INDEXNOW_ENDPOINT}, which answered ${answers.join(", ")}`);
  return 0;
}

if (import.meta.main) process.exit(await main());
