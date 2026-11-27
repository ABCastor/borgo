// Builds the static site into dist/: bundles the app, joins the stylesheets, copies fonts and the dataset,
// puts the product header and the favicon into the page, then prerenders the crawlable
// pages, the JSON API and the files for search engines and AI agents (scripts/prerender.ts), and last the app page's
// first screen per region with the data split per city (scripts/first-page.ts).
// --serve also starts a local server.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import type { Published } from "../src/registry/licences.ts";
import { writeFirstPages } from "./first-page.ts";
import { viewHtml } from "../src/mcp/view.ts";
import type { Dataset } from "../src/core/types.ts";
import { prerender, type PageDates } from "./prerender.ts";
import { MARK } from "../src/ui/brand/index.ts";
import { faviconSvg } from "../src/ui/brand/marks.ts";
import { productHeader, serveDir } from "./site.ts";

const DIST = join(ROOT, "dist");
const serve = process.argv.includes("--serve");

// dist/ starts empty, so only what this build writes is ever deployed.
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await build({
  entryPoints: [join(ROOT, "src/ui/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !serve,
  sourcemap: serve,
  loader: { ".html": "text" },
  outfile: join(DIST, "app.js"),
});
const css = await Promise.all(["src/ui/castor/header.css", "src/ui/castor/footer.css", "src/ui/styles.css", "src/site/site.css", "src/ui/sheets.css", "src/ui/map.css", "src/ui/community.css", "src/ui/brand/brand.css", "src/ui/setup.css", "src/ui/controls.css", "src/ui/castor/castor-toolbar.css"].map((f) => readFile(join(ROOT, f), "utf8")));
await writeFile(join(DIST, "app.css"), css.join("\n"));

const header = productHeader("#/", [
  { href: "#/", label: "Cities", current: true },
  { href: "#/map", label: "Map" },
  { href: "#/compare", label: "Compare" },
  { href: "#/money", label: "Money" },
  { href: "#/data", label: "Data" },
  { href: "#/about", label: "About" },
], { settings: true });
// The first screen, its preload hints and the region pages are filled in last (scripts/first-page.ts).
const published = JSON.parse(await readFile(join(ROOT, "public/data/dataset.json"), "utf8")) as Dataset & Published;
const page = (await readFile(join(ROOT, "public/index.html"), "utf8")).replace("<!--HEADER-->", header);
await writeFile(join(DIST, "index.html"), page);
await writeFile(join(DIST, "favicon.svg"), faviconSvg(MARK, await readFile(join(ROOT, "src/ui/brand/castor-mark.svg"), "utf8")));
await cp(join(ROOT, "public/media"), join(DIST, "media"), { recursive: true });
await cp(join(ROOT, "public/fonts"), join(DIST, "fonts"), { recursive: true });
await cp(join(ROOT, "public/data"), join(DIST, "data"), { recursive: true });
// The compare chart's MCP App document, which the remote MCP server (/mcp) reads; the local one builds its own.
await writeFile(join(DIST, "data/mcp-view.txt"), viewHtml());
// Files that must sit at the site root as they are (search engine verification, the IndexNow key, the plugin
// reviewers' walkthrough at /review/walkthrough.mp4, linked from nowhere on the site).
if (existsSync(join(ROOT, "public/root"))) await cp(join(ROOT, "public/root"), DIST, { recursive: true });
// Open data stays open to other sites' browser code: the API and the data snapshot answer any origin.
await writeFile(join(DIST, "_headers"), ["/api/*", "/data/*"].map((p) => `${p}\n  Access-Control-Allow-Origin: *\n`).join(""));
// The pages show every published figure: dataset.json merged with the ODbL and WHO files beside it.
const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json"));
// When each page last changed (the sitemap's lastmod): kept in data/page-dates.json, which a build rewrites only when a
// page's content changes. Commit it with the change, so the deploy's own build finds nothing new.
const DATES = join(ROOT, "data/page-dates.json");
const before = existsSync(DATES) ? (await readFile(DATES, "utf8")) : "{}";
const manifest = await prerender(DIST, data, { dates: JSON.parse(before) as PageDates, today: process.env.BUILD_DATE });
const after = `${JSON.stringify(Object.fromEntries(Object.entries(manifest.dates).sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`;
const changed = Object.entries(manifest.dates).filter(([p, d]) => (JSON.parse(before) as PageDates)[p]?.hash !== d.hash).length;
if (after !== before) await writeFile(DATES, after);
// The app page with each region's first screen in it, and the data split per city that the app reads.
await writeFirstPages(DIST, published, data);
console.log(`built dist/: the app, ${manifest.pages.length} pages, ${manifest.files.length} files; ${changed} pages changed since the last recorded build`);

if (serve) {
  const port = Number(process.env.PORT ?? 8794);
  await serveDir(DIST, port);
  console.log(`http://127.0.0.1:${port}/`);
}
