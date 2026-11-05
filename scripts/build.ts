// Builds the static site into dist/: bundles the app, joins the stylesheets, copies fonts and the dataset,
// puts the product header and the favicon into the page, then prerenders the crawlable
// pages, the JSON API and the files for search engines and AI agents (scripts/prerender.ts).
// --serve also starts a local server.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { prerender } from "./prerender.ts";
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
const css = await Promise.all(["src/ui/castor/header.css", "src/ui/castor/footer.css", "src/ui/styles.css", "src/site/site.css", "src/ui/sheets.css", "src/ui/map.css", "src/ui/brand/brand.css"].map((f) => readFile(join(ROOT, f), "utf8")));
await writeFile(join(DIST, "app.css"), css.join("\n"));

const header = productHeader("#/", [
  { href: "#/", label: "Cities", current: true },
  { href: "#/map", label: "Map" },
  { href: "#/compare", label: "Compare" },
  { href: "#/money", label: "Money" },
  { href: "#/data", label: "Data" },
  { href: "#/about", label: "About" },
], { settings: true });
const page = (await readFile(join(ROOT, "public/index.html"), "utf8")).replace("<!--HEADER-->", header);
await writeFile(join(DIST, "index.html"), page);
await writeFile(join(DIST, "favicon.svg"), faviconSvg(MARK));
await cp(join(ROOT, "public/fonts"), join(DIST, "fonts"), { recursive: true });
await cp(join(ROOT, "public/data"), join(DIST, "data"), { recursive: true });
// Open data stays open to other sites' browser code: the API and the data snapshot answer any origin.
await writeFile(join(DIST, "_headers"), ["/api/*", "/data/*"].map((p) => `${p}\n  Access-Control-Allow-Origin: *\n`).join(""));
// The pages show every published figure: dataset.json merged with the ODbL and WHO files beside it.
const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json"));
const manifest = await prerender(DIST, data);
console.log(`built dist/: the app, ${manifest.pages.length} pages, ${manifest.files.length} files`);

if (serve) {
  const port = Number(process.env.PORT ?? 8794);
  await serveDir(DIST, port);
  console.log(`http://127.0.0.1:${port}/`);
}
