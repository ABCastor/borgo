// Writes the crawlable side of the site into dist/: a static page and a markdown twin per city, per comparison
// and per hub; the JSON API; sitemap.xml, robots.txt, llms.txt and llms-full.txt; the app page's metadata; and
// the not-found page the host serves for any missing address (wrangler.jsonc).
// Called by scripts/build.ts after the app is built. Everything comes from src/site/facts.ts and the dataset.
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { CRITERIA } from "../src/core/criteria.ts";
import type { Dataset } from "../src/core/types.ts";
import { cityFacts, compareFacts, comparisonPairs, levelText, appQuery, referenceProfile, summaryLine, type CityFacts } from "../src/site/facts.ts";
import { assumptionsText, citiesPage, cityPage, comparePage, comparisonsPage, homeFooter, homeJsonLd, mainDataset, shell, sourcesPage, toRoot, type Page, type Site } from "../src/site/render.ts";
import { TAX_MODELS } from "../src/tax/index.ts";
import { html } from "../src/ui/dom.ts";
import { abs, productHeader, CREATOR, DATA_LICENCE, SITE_NAME, SITE_ORIGIN, type NavLink } from "./site.ts";
import { manifestOf, PARTS, type PartId } from "../src/registry/licences.ts";
import { placesMeta, type MapPlace } from "../src/community/meta.ts";
import { FIGURES } from "../src/community/figures.ts";
import { WORK_KINDS } from "../src/core/work.ts";
import { QOL_PARTS, qualityOfLife } from "../src/core/qol.ts";
import { QOL_INDICES } from "../src/core/links.ts";

export interface Manifest {
  /** Site paths of every HTML page, "/" first. */
  pages: string[];
  /** Every other file written, relative to dist. */
  files: string[];
  /** When each page's content last changed: the sitemap's lastmod, kept in data/page-dates.json by scripts/build.ts. */
  dates: PageDates;
}

/** A page's content hash and the day it last changed. */
export interface PageDate { hash: string; lastmod: string }
export type PageDates = Record<string, PageDate>;

/** What a page says, hashed: its title, description, body, markdown twin and structured data, not the header and footer every page shares. */
export const pageHash = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

/** Each page keeps its last-changed day while its hash holds, and takes `today` when it changes or is new; pages gone drop out. */
export function datePages(previous: PageDates, hashes: Record<string, string>, today: string): PageDates {
  const out: PageDates = {};
  for (const [path, hash] of Object.entries(hashes)) out[path] = previous[path]?.hash === hash ? previous[path]! : { hash, lastmod: today };
  return out;
}

export interface PrerenderOptions {
  /** The dates the last build recorded; without them every page counts as changed today. */
  dates?: PageDates;
  /** The build's day, YYYY-MM-DD (UTC); today by default. */
  today?: string;
}

/** The docs/ pages published on the site, beside the API; llms.txt links to agents.md. */
export const PUBLIC_DOCS = ["agents.md", "architecture.md", "data-sources.md", "pension-leave-audit.md", "positions.md", "positions-audit.md", "tax-regimes.md", "values-research.md", "weather-scores.md", "work.md"];

/** AI and search crawlers we welcome by name; robots.txt "*" already allows them, naming them states intent. */
export const WELCOME_BOTS = [
  "Googlebot", "Bingbot", "Applebot", "DuckDuckBot",
  "OAI-SearchBot", "ChatGPT-User", "GPTBot",
  "Claude-SearchBot", "Claude-User", "ClaudeBot",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended", "CCBot", "Amazonbot", "MistralAI-User",
];

export async function prerender(dist: string, data: Dataset, opts: PrerenderOptions = {}): Promise<Manifest> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const hashes: Record<string, string> = {};
  const site: Site = { origin: SITE_ORIGIN, name: SITE_NAME, creator: { ...CREATOR }, dataLicence: { ...DATA_LICENCE }, version: data.version };
  const files: string[] = [];
  const write = async (rel: string, body: string) => {
    const path = join(dist, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    files.push(rel);
  };

  const pairs = comparisonPairs(data);
  const all: CityFacts[] = data.cities.map((c) => cityFacts(data, c.id, pairs)).sort((a, b) => a.city.name.localeCompare(b.city.name));
  const neighbours = (f: CityFacts) => f.comparisons.slice(0, 3).map((c) => c.other.id);

  const pages: Page[] = [
    citiesPage(site, data, all),
    comparisonsPage(site, data, pairs),
    sourcesPage(site, data, all),
    ...all.map((f) => cityPage(site, data, f, appQuery([f.city.id, ...neighbours(f)]))),
    ...pairs.map(([a, b]) => comparePage(site, data, compareFacts(data, a, b, pairs))),
  ];

  // Pages, each with its markdown twin at index.md (llms.txt v2).
  for (const page of pages) {
    const root = toRoot(page.path);
    const nav: NavLink[] = [
      { href: root || "./", label: "Compare" },
      { href: `${root}cities/`, label: "Cities", current: page.section === "cities" },
      { href: `${root}#/map`, label: "Map" },
      { href: `${root}sources/`, label: "Data", current: page.section === "sources" },
      { href: `${root}#/about`, label: "About" },
    ];
    const header = productHeader(root || "./", nav);
    const dir = page.path.slice(1);
    await write(`${dir}index.html`, shell(site, page, header));
    await write(`${dir}index.md`, page.markdown);
    hashes[page.path] = pageHash(page.title, page.description, page.body.value, page.markdown, JSON.stringify(page.jsonld));
  }

  // The page a missing address gets. The host serves 404.html with status 404 at whatever address was asked for, so
  // <base> resolves every relative link from the site root. It is never indexed and has no canonical URL or twin.
  const notFound: Page = {
    path: "/",
    title: `Page not found · ${SITE_NAME}`,
    description: "There is no page at this address.",
    section: null,
    body: html`<article class="doc static-doc">
    <h1>Page not found</h1>
    <p class="lede">There is no page at this address. The comparison is on the <a href="./">home page</a>, and every city and every comparison has its own page.</p>
    <ul><li><a href="cities/">All cities</a></li><li><a href="compare/">All comparisons</a></li><li><a href="sources/">Where the numbers come from</a></li></ul>
  </article>`,
    markdown: "",
    jsonld: [],
  };
  const rootNav: NavLink[] = [
    { href: "./", label: "Compare" },
    { href: "cities/", label: "Cities" },
    { href: "#/map", label: "Map" },
    { href: "sources/", label: "Data" },
    { href: "#/about", label: "About" },
  ];
  await write(
    "404.html",
    shell(site, notFound, productHeader("./", rootNav))
      .replace("<head>\n", `<head>\n<base href="/">\n<meta name="robots" content="noindex">\n`)
      .replace(/<link rel="(canonical|alternate|describedby)"[^>]*>\n/g, "")
      .replace(/<meta property="og:url"[^>]*>\n/, "")
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n/, ""),
  );

  // The app page: same app, plus what crawlers need to understand it and links to every static page.
  const appHtml = await readFile(join(dist, "index.html"), "utf8");
  const appTitle = "Borgo: the best place to live for you, on open data";
  const appDesc = "Borgo ranks cities on your own values: what you keep after tax and rent, days that feel the way you like, where you have the right to live and work. Every figure shows its source, and it runs privately in your browser.";
  const head = [
    `<link rel="canonical" href="${SITE_ORIGIN}/">`,
    `<link rel="describedby" href="llms.txt">`,
    `<link rel="alternate" type="text/markdown" href="index.md">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${appTitle}">`,
    `<meta property="og:description" content="${appDesc}">`,
    `<meta property="og:url" content="${SITE_ORIGIN}/">`,
    `<meta property="og:image" content="${abs("/og.png")}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${appTitle}">`,
    `<meta name="twitter:description" content="${appDesc}">`,
    `<meta name="twitter:image" content="${abs("/og.png")}">`,
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": homeJsonLd(site, data).map(({ "@context": _, ...r }: any) => r) }).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
  const app = appHtml.replace("</head>", `${head}\n</head>`).replace(/<\/div>\s*<aside id="sheet"/, `${homeFooter(site, all).value}\n</div>\n<aside id="sheet"`);
  await writeFile(join(dist, "index.html"), app);
  // The app page changes when its page or its script does.
  hashes["/"] = pageHash(app, existsSync(join(dist, "app.js")) ? await readFile(join(dist, "app.js"), "utf8") : "");

  // The static JSON API. Each file holds figures under one set of terms: the city files only the CC BY 4.0 part
  // (dataset.json), and api/<part>/city/<id>.json the figures published under ODbL or WHO terms, with their notice.
  const sourcesUsed = new Set(Object.values(data.observations).flat().map((o) => o.source));
  for (const a of data.rights) sourcesUsed.add(a.source);
  sourcesUsed.add(data.fx.source);
  const licences = manifestOf(data);
  const partOf = new Map<string, PartId>((licences?.sources ?? []).map((s) => [s.source, s.part]));
  const inPart = (p: PartId) => (id: string) => (partOf.get(id) ?? "open") === p;
  const otherParts = (Object.keys(PARTS) as PartId[]).filter((p) => p !== "open" && Object.values(data.observations).flat().some((o) => inPart(p)(o.source)));
  const openData: Dataset = { ...data, observations: Object.fromEntries(Object.entries(data.observations).map(([k, l]) => [k, l.filter((o) => inPart("open")(o.source))])) };
  const openFacts = new Map(data.cities.map((c) => [c.id, cityFacts(openData, c.id, pairs)]));
  const meta = {
    dataset: {
      version: data.version,
      builtAt: data.builtAt,
      licence: DATA_LICENCE.id,
      licenceUrl: DATA_LICENCE.url,
      licenceNote: PARTS.open.notice,
      licences: abs("/data/licences.json"),
      otherParts: otherParts.map((p) => ({ part: p, licence: PARTS[p].licence, file: abs(`/${PARTS[p].file}`), city: abs(`/api/${p}/city/{id}.json`) })),
      creator: CREATOR.name,
      fx: { base: "EUR", date: data.fx.date, source: data.fx.source },
    },
  };
  await write(
    "api/index.json",
    json({
      ...meta,
      description: `Open, sourced figures for ${data.cities.length} cities. Every figure carries source, period, geographic level and licence.`,
      endpoints: {
        cities: abs("/api/cities.json"),
        city: abs("/api/city/{id}.json"),
        sources: abs("/api/sources.json"),
        metrics: abs("/api/metrics.json"),
        dataset: abs("/data/dataset.json"),
        licences: abs("/data/licences.json"),
        ...Object.fromEntries(otherParts.map((p) => [`dataset-${p}`, abs(`/${PARTS[p].file}`)])),
        ...Object.fromEntries(otherParts.map((p) => [`city-${p}`, abs(`/api/${p}/city/{id}.json`)])),
        communityCity: abs("/api/community/city/{id}.json"),
        communityDataset: abs("/api/community/dataset.json"),
        communityDatasetCsv: abs("/api/community/dataset.csv"),
        communityPlaces: abs("/api/community/places.json"),
        communitySubmit: abs("/api/community/submit"),
      },
      mcp: { url: abs("/mcp"), transport: "streamable-http" },
      docs: { llms: abs("/llms.txt"), agents: abs("/docs/agents.md") },
    }),
  );
  // The places that take community figures, their currencies and the official figures beside them, read by the Worker.
  const towns = (JSON.parse(await readFile(join(ROOT, "public/data/map.json"), "utf8")) as { places: MapPlace[] }).places;
  await write("api/community/places.json", JSON.stringify(placesMeta(data, towns)));
  await write(
    "api/cities.json",
    json({
      ...meta,
      count: all.length,
      cities: all.map((f) => ({
        id: f.city.id,
        name: f.city.name,
        country: f.country.code,
        countryName: f.country.name,
        region: f.city.region ?? null,
        lat: f.city.lat,
        lon: f.city.lon,
        population: f.city.population ?? null,
        currency: f.country.currency,
        taxModelled: !!f.takeHome,
        figures: f.figures.length,
        page: abs(f.path),
        api: abs(`/api/city/${f.city.id}.json`),
      })),
    }),
  );
  for (const f of all) {
    await write(`api/city/${f.city.id}.json`, json({ ...meta, ...cityApi(openFacts.get(f.city.id)!, openData) }));
    for (const p of otherParts) {
      const observations = (data.observations[f.city.id] ?? []).filter((o) => inPart(p)(o.source));
      if (!observations.length) continue;
      await write(
        `api/${p}/city/${f.city.id}.json`,
        json({
          licence: PARTS[p].licence,
          notice: PARTS[p].notice,
          id: f.city.id,
          name: f.city.name,
          figures: f.figures.filter((x) => x.sources.every((s) => inPart(p)(s.id))).map((x) => ({ ...x, levelText: levelText(x.level, f.country.name) })),
          observations: observations.map((o) => ({ ...o, sourceName: data.sources[o.source]?.name ?? o.source, licence: data.sources[o.source]?.licence ?? null })),
          attribution: (licences?.sources ?? []).filter((s) => inPart(p)(s.source)).map((s) => ({ source: s.source, attribution: s.attribution, notices: s.notices })),
        }),
      );
    }
  }
  const credit = new Map((licences?.sources ?? []).map((s) => [s.source, s]));
  await write(
    "api/sources.json",
    json({
      ...meta,
      sources: Object.values(data.sources)
        .filter((s) => sourcesUsed.has(s.id))
        .map((s) => {
          const c = credit.get(s.id);
          return c ? { ...s, edition: c.edition, licenceId: c.licenceId, attribution: c.attribution, notices: c.notices, publishedIn: c.file } : s;
        }),
      linkOutOnly: ["Numbeo", "WeatherSpark", "Oxford Economics", "EIU", "IQAir", "InterNations", "Startup Genome", "World Happiness Report"],
    }),
  );
  await write(
    "api/metrics.json",
    json({
      ...meta,
      metrics: Object.values(data.metrics),
      criteria: CRITERIA.map((c) => {
        const [worst, best] = c.scale(referenceProfile(data, []), data);
        return { id: c.id, label: c.label, question: c.question, category: c.category, metric: c.metric ?? null, defaultWeight: c.defaultWeight, worst, best, scaleCurrency: c.category === "money" ? "EUR" : null };
      }),
      taxModels: Object.values(TAX_MODELS).map((m) => ({ country: m.country, year: m.year, currency: m.currency, scope: m.scope, sources: m.sources })),
    }),
  );

  // Crawling: sitemap, robots, llms.txt and its full companion.
  // lastmod is the day a page's own content last changed (datePages), so a crawler can tell which pages are new.
  const sitePaths = ["/", ...pages.map((p) => p.path)];
  const dates = datePages(opts.dates ?? {}, hashes, today);
  await write(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitePaths.map((p) => `<url><loc>${abs(p)}</loc><lastmod>${dates[p]!.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`,
  );
  await write(
    "robots.txt",
    [
      "# Search engines and AI assistants are welcome to read, index and cite every page.",
      "# Figures are open data (CC BY 4.0 for our compilation; each source keeps its own licence).",
      "User-agent: *",
      "Allow: /",
      "",
      ...WELCOME_BOTS.flatMap((b) => [`User-agent: ${b}`, "Allow: /", ""]),
      `Sitemap: ${abs("/sitemap.xml")}`,
      "",
    ].join("\n"),
  );
  const llms = llmsTxt(data, all, pairs.length);
  await write("llms.txt", llms);
  // The app page's markdown twin is the site guide itself, so "every page has a twin" holds for / too.
  await write("index.md", llms);
  await write("llms-full.txt", llmsFull(data, all, pages));

  // The social card and the agent docs the llms.txt links to.
  if (existsSync(join(ROOT, "public/og.png"))) {
    await cp(join(ROOT, "public/og.png"), join(dist, "og.png"));
    files.push("og.png");
  }
  for (const f of PUBLIC_DOCS) {
    await cp(join(ROOT, "docs", f), join(dist, "docs", f));
    files.push(`docs/${f}`);
  }

  return { pages: sitePaths, files, dates };
}

const json = (v: unknown) => `${JSON.stringify(v, null, 1)}\n`;

function cityApi(f: CityFacts, data: Dataset) {
  return {
    id: f.city.id,
    name: f.city.name,
    country: { code: f.country.code, name: f.country.name, currency: f.country.currency },
    region: f.city.region ?? null,
    lat: f.city.lat,
    lon: f.city.lon,
    population: f.city.population ?? null,
    wikidata: f.city.wikidata ?? null,
    geonames: f.city.geonames ?? null,
    page: abs(f.path),
    markdown: abs(`${f.path}index.md`),
    keyFacts: f.keyFacts,
    figures: f.figures.map((x) => ({ ...x, levelText: levelText(x.level, f.country.name) })),
    gaps: f.gaps,
    climate: f.climate && {
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      tempHighC: f.climate.high,
      tempLowC: f.climate.low,
      wetDays: f.climate.wetDays,
      daylightHours: f.climate.daylight.map((h) => Math.round(h * 100) / 100),
      period: f.climate.period,
      source: f.climate.source,
    },
    daylight: { shortestDayHours: Math.round(f.shortestDay * 100) / 100, longestDayHours: Math.round(f.longestDay * 100) / 100, method: "computed from latitude" },
    takeHome: f.takeHome,
    freeMovement: { citizensOf: f.country.code, areas: f.freeMovement },
    defaultProfile: { assumptions: assumptionsText(data, referenceProfile(data, [f.city.id])), month: f.budget },
    observations: (data.observations[f.city.id] ?? []).map((o) => ({ ...o, sourceName: data.sources[o.source]?.name ?? o.source, licence: data.sources[o.source]?.licence ?? null })),
    comparisons: f.comparisons.map((c) => ({ with: c.other.id, page: abs(c.path) })),
    linkOut: f.linkOut,
    cite: `${SITE_NAME}, "Living in ${f.city.name}", ${abs(f.path)}, figures as of ${data.version}. Name the original source of any figure you quote.`,
  };
}

function llmsTxt(data: Dataset, all: CityFacts[], pairCount: number): string {
  const L: string[] = [];
  const example = all.find((f) => f.takeHome && f.figures.some((x) => x.metric === "rent_1bed")) ?? all[0]!;
  L.push(`# ${SITE_NAME}`, "");
  L.push(
    `> An open-source, open-data comparison of cities to live in. For any set of cities it shows take-home pay after tax, what is left after rent and everyday spending, who in a household can live and work there without a visa, nice days a year and the climate month by month, air quality, safety, health, work and ambition for a person's own kind of work, and a generic quality-of-life index. People also add their own rent, prices and pay, published openly beside the official figures. Every figure carries its source, period, geographic level and licence. ${data.cities.length} cities, figures as of ${data.version}.`,
    "",
  );
  L.push(
    "Use it to answer questions such as \"where should I live?\", \"is it cheaper to live in A or B?\", \"what changes if I move from A to B?\", \"how much would I take home on X in city Y?\", \"where would a software engineer do best?\", \"can I move to Y with my passport?\" or \"what is the weather like in Y each month?\". Point people to the app when the answer depends on their own salary, household, weights or rent: it computes everything in their browser and keeps their profile private.",
    "",
    `Cite a figure by the page it appears on and its original source, for example: "${example.keyFacts.find((k) => k.includes("rents for")) ?? example.keyFacts[0]}" (${abs(example.path)}). Figures are CC BY 4.0 as compiled here, except OpenStreetMap counts (ODbL 1.0, in ${abs("/data/dataset-odbl.json")}), WHO air measurements (WHO's terms, in ${abs("/data/dataset-who.json")}) CMHC rents for Canadian cities (CMHC's licence, in ${abs("/data/dataset-cmhc.json")}) and OMI rents for Italian cities (the Agenzia delle Entrate's terms, in ${abs("/data/dataset-omi.json")}); each source's licence and required attribution is in ${abs("/data/licences.json")}. Pages use a fixed reference profile (${assumptionsText(data, referenceProfile(data, []))}, balanced weights); a person's own answer may differ.`,
    "",
    `Every HTML page has a markdown twin at the same URL with index.md appended.`,
    "",
  );
  L.push("## Use it", "", `- [The app](${abs("/")}): compare any cities with your own salary, household, weights and numbers. A comparison opens pre-filled with ?cities=<id>,<id> (the visitor keeps their own saved settings). Its Map tab (#/map) colours the whole world by the visitor's own values (score, nice days in their range, who may live where, money kept or any other line), ranks their cities on it, and adds any town in one click`, `- [MCP server on the web](${abs("/docs/agents.md")}): connect an assistant with one address, ${abs("/mcp")}, nothing to install (Streamable HTTP, MCP 2025-11-25, no account): compare_cities, get_city, net_pay, search_cities, list_sources, methodology, list_metrics_and_sources, community_figures, and submit_figures, which sends a person's own figures only after their yes. It keeps no arguments, only a count of calls per tool. For places beyond the published cities, the same server runs locally with \`npx -y @abcastor/borgo mcp\` and adds fetch_city`,
    `- [Agents: MCP server and CLI](${abs("/docs/agents.md")}): the same engine as tools for AI assistants and the command line`, `- [Sources and method](${abs("/sources/index.md")}): where every figure comes from, how figures are chosen and scored`, "");
  const kinds = WORK_KINDS.map((k) => k.id);
  L.push(
    "## Work and quality of life",
    "",
    `- [Work and ambition by kind of work](${abs("/docs/work.md")}): a person picks one of ${kinds.length} kinds of work (${kinds.join(", ")}) and the Work and ambition group is weighed for it: pay in that field, jobs in that field, developers, degrees, research output and young companies, each from an official or open source. In the app it is "Your kind of work"; in the CLI \`--work software\`; in MCP \`compare_cities\` with \`work\`, which adds plain sentences saying why each city scores as it does. Every city page has a "Pay by kind of work" table. Without a kind, every ranking is the same as before`,
    `- [Quality of life index](${abs("/docs/work.md")}): a generic index out of 100 on every city page, in MCP \`get_city\` (\`qualityOfLife\`) and the CLI \`city\` command, with fixed weights in view (${QOL_PARTS.map((q) => `${q.label.toLowerCase()} ${q.weight}`).join(", ")}). It is the same for everyone; a person's own ranking stays primary and counts the index only when they turn its line on. Indices by ${QOL_INDICES.map((q) => q.publisher).join(", ")} are linked, never copied`,
    "",
  );
  L.push(
    "## Data API (static JSON)",
    "",
    `- [API index](${abs("/api/index.json")}): endpoints and dataset version`,
    `- [Cities](${abs("/api/cities.json")}): every city with its id, country, coordinates and links`,
    `- [One city](${abs(`/api/city/${all[0]?.city.id ?? "turin-it"}.json`)}): figures with provenance, climate, take-home pay at reference salaries, free movement, raw observations; pattern /api/city/{id}.json`,
    `- [Sources](${abs("/api/sources.json")}): publishers, URLs and licences`,
    `- [Metrics](${abs("/api/metrics.json")}): what each measure means, its unit, and how scoring lines use it`,
    `- [Full dataset](${abs("/data/dataset.json")}): everything the app computes from, under CC BY 4.0, except the figures in the next two files`,
    `- [OpenStreetMap figures](${abs("/data/dataset-odbl.json")}): counts of places and lengths of paths, © OpenStreetMap contributors, ODbL 1.0`,
    `- [WHO air figures](${abs("/data/dataset-who.json")}): measured PM2.5 from the WHO Ambient Air Quality Database, under WHO's terms for data compilations`,
    `- [CMHC rents](${abs("/data/dataset-cmhc.json")}): average rents for Toronto, Vancouver and Montréal from CMHC's Rental Market Survey, under CMHC's Licence Agreement for the Use of Data`,
    `- [OMI rents](${abs("/data/dataset-omi.json")}): rents of new leases in Turin, Milan, Rome, Naples, Bologna and Florence from the Agenzia delle Entrate's OMI, under its terms (use with the source cited; the data may not be sold or handed on)`,
    `- [Licence manifest](${abs("/data/licences.json")}): for every source exported, its edition, licence, attribution and the file its figures are in`,
    `- [World map](${abs("/data/map.json")}): land tiles on the Equal Earth projection with each month's average afternoon high (NASA POWER) and the towns the map can add (Natural Earth)`,
    "",
  );
  L.push(
    "## Community figures (live)",
    "",
    "People add their own figures, like Numbeo's contributors but as open data: rent by bedrooms and area, six everyday prices, take-home pay by kind of work, and a 1 to 5 rating of living there. An automated review holds amounts far from what others report or from the official figure; what passes is shown from the first entry, labelled as community with its count and months, beside the official figures and never mixed into them or into scores. CC BY 4.0, credited to Borgo contributors. These answer live from the Worker, so they are not files in the snapshot.",
    "",
    `One place after review: ${abs("/api/community/city/turin-it.json")} (pattern /api/community/city/{id}.json, for the ${data.cities.length} cities and the towns on the map; ids and currencies in ${abs("/api/community/places.json")}). Every entry with its review verdict, amounts rounded to three significant digits, the month each arrived: ${abs("/api/community/dataset.json")} and ${abs("/api/community/dataset.csv")}.`,
    "",
    `To send, POST JSON to ${abs("/api/community/submit")}: {"city": "turin-it", "rent": {"amount": 950, "bedrooms": "1", "area": "centre"}, "prices": {"cappuccino": 1.6}, "salary": {"amount": 2400, "occupation": "software"}, "rating": 4, "consent": true}. Amounts in the place's own currency, a month; bedrooms 0 (studio) to 3 (3 or more); area centre or outside; prices ${FIGURES.filter((f) => f.kind === "price").map((f) => f.id.slice(6)).join(", ")}; occupations ${FIGURES.filter((f) => f.kind === "salary").map((f) => f.id.slice(7)).join(", ")}. consent true means the person agreed to publish these exact figures as their own under CC BY 4.0: an agent sends only after the person said yes to them. The answer carries a removal code; POST {"code": "..."} to ${abs("/api/community/remove")} deletes that submission.`,
    "",
  );

  const qol = (f: CityFacts) => {
    const q = qualityOfLife(data, f.city);
    return q.score === null ? "" : `; quality-of-life index ${Math.round(q.score)} of 100`;
  };
  L.push("## Cities", "", ...all.map((f) => `- [${f.city.name}](${abs(f.path)}index.md): ${summaryLine(f)}${qol(f)}`), "");
  L.push("## Optional", "", `- [Every comparison](${abs("/compare/index.md")}): ${pairCount} city-versus-city pages, each with take-home pay, rent, money left and nice days side by side and what changes for someone moving from one city to the other`, `- [Every city](${abs("/cities/index.md")})`, `- [Full text](${abs("/llms-full.txt")}): every city page in one file`, "");
  return L.join("\n");
}

function llmsFull(data: Dataset, all: CityFacts[], pages: Page[]): string {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const parts = [
    `# ${SITE_NAME}: every city, in full`,
    "",
    `> The full text of every city page, figures as of ${data.version}. Each section is also available on its own at the URL given in it. Licence of the compilation: CC BY 4.0; each figure keeps its source's licence (${abs("/data/licences.json")}). OpenStreetMap figures are © OpenStreetMap contributors, ODbL 1.0; WHO air figures are used under WHO's terms; CMHC rents under CMHC's licence.`,
    "",
    byPath.get("/sources/")?.markdown ?? "",
    "",
    ...all.map((f) => byPath.get(f.path)?.markdown ?? ""),
  ];
  // Every heading after the first line drops one level, so the file keeps a single H1.
  return `${parts.join("\n").replace(/\n(#{1,5}) /g, "\n#$1 ")}\n`;
}
