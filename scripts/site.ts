// What the published site says about itself: where it lives, who makes it, under what licence, and the
// header every page wears. One home for each, so the domain or the name changes in one place.
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { MARK, PRODUCT_NAME } from "../src/ui/brand/index.ts";
import { markSvg } from "../src/ui/brand/marks.ts";

/** Where the site is served. Every canonical URL, sitemap entry, JSON-LD id, llms.txt and API link is built from it; set SITE_ORIGIN to build for another host. */
export const SITE_ORIGIN = (process.env.SITE_ORIGIN ?? "https://borgo.abcastor.com").replace(/\/$/, "");
export const SITE_NAME = PRODUCT_NAME;
/** The repository: issues, discussions and the source. */
export const REPO_URL = "https://github.com/ABCastor/borgo";
/** The publisher named in structured data. */
export const CREATOR = { "@type": "Organization", name: "Castor" } as const;
export const DATA_LICENCE = { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" } as const;
export const CODE_LICENCE = { id: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" } as const;

/** Absolute URL of a site path ("/city/turin-it/"). */
export const abs = (path: string) => `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;

export interface NavLink {
  href: string;
  label: string;
  current?: boolean;
}

/** The Castor signature (Chip, "Castor*" and "we give a dam*" on the two-colour line), copied byte for byte from castor-identity master/footer. */
export const SIGNATURE = (await readFile(join(ROOT, "src/ui/castor/footer.html"), "utf8")).trim();

/** Where Chip's two large drawings are published, from the site root. */
export const CHIP_FILE = "castor/chip.svg";
/** Chip's body and tail: 33 KB of the signature's 36, the same on every page, so one cached file carries them. */
const SPRITED = /<g class="(c-body|c-tail)">((?:<path [^>]*\/>)+)<\/g>/g;

/**
 * The signature as a page carries it: the master's markup with the paths of Chip's body and tail moved, byte for byte, into
 * CHIP_FILE, each group keeping its class and referencing its own paths there. The groups stay in the page, so the
 * master's rules still move them (the tail's wag, the eye's blink) and the drawing is the master's. Kept inline, the whole
 * drawing makes the smallest pages too big to arrive in one round trip, which delays their first paint on a slow link.
 * `root` leads from the page back to the site root.
 */
export function signatureAt(root: string): string {
  return SIGNATURE.replace(SPRITED, (_, id: string) => `<g class="${id}"><use href="${root}${CHIP_FILE}#${id}"/></g>`);
}

/** CHIP_FILE: the groups signatureAt() refers to, each with the master's own paths. */
export function chipFile(): string {
  const groups = [...SIGNATURE.matchAll(SPRITED)].map((m) => `<g id="${m[1]}">${m[2]}</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 92">${groups.join("")}</svg>\n`;
}

/** The settings gear, copied from castor-identity master/toolbar. */
const SETTINGS_ICON = (await readFile(join(ROOT, "src/ui/castor/settings.svg"), "utf8")).trim();

/**
 * The product header: the Castor header's line and navigation (castor/header.css), with Borgo's own mark at the left
 * standing on the line, and the name with Castor's typed asterisk at the right. `settings` adds the app's gear.
 */
export function productHeader(home: string, nav: NavLink[], o: { settings?: boolean } = {}): string {
  const links = nav.map((l) => `<a href="${l.href}"${l.current ? ' aria-current="page"' : ""}>${l.label}</a>`).join("");
  const tools = o.settings
    ? `<span class="bar-tools"><button type="button" class="settings-toggle" data-act="settings" aria-haspopup="dialog" aria-label="Settings: units and formats">${SETTINGS_ICON}</button></span>`
    : "";
  // The mark, then the name right beside it, then the sections; the gear, when there is one, at the far right.
  return `<header class="mast bmast"><a class="bmark" href="${home}" aria-label="${SITE_NAME}, home">${markSvg(MARK)}</a>` +
    `<a class="bname" href="${home}" tabindex="-1" aria-hidden="true">${SITE_NAME}<span class="star">*</span></a>` +
    `<nav class="nav" aria-label="Sections">${links}</nav>${tools}</header>`;
}

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** A static file server for dist/, for local checks only. */
export function serveDir(dir: string, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = join(dir, path.endsWith("/") ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}
