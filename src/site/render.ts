// The published pages: HTML for people and crawlers, a markdown twin for agents (llms.txt v2), and the
// schema.org JSON-LD that describes them. Everything is built from src/site/facts.ts; nothing here computes.
import { ALL_TENANCIES, isRent } from "../core/rent-basis.ts";
import { qualityOfLife, QOL_PARTS } from "../core/qol.ts";
import { QOL_INDICES } from "../core/links.ts";
import { WORK_KINDS, payMetric } from "../core/work.ts";
import type { Dataset, Profile } from "../core/types.ts";
import { DEFAULT_COMFORT } from "../core/criteria.ts";
import { climateChart as sharedChart } from "../ui/climate-chart.ts";
import { html, raw, type Raw } from "../ui/dom.ts";
import { money, num } from "../ui/format.ts";
import { creditsFor, manifestOf, PARTS, type ManifestEntry } from "../registry/licences.ts";
import { communityForm } from "../community/view.ts";
import { countryLabel, hoursText, inSentence, levelText, referenceProfile, type CityFacts, type Climate, type CompareFacts, type Figure, type SourceRef } from "./facts.ts";

export interface Site {
  origin: string;
  name: string;
  creator: Record<string, string>;
  dataLicence: { id: string; url: string };
  /** The dataset version (its build date): every page says how fresh its numbers are. */
  version: string;
  /** The Castor signature's markup (castor-identity master/footer), the last thing on every page. */
  signature?: string;
}

export interface Page {
  path: string; // "/city/turin-it/"
  title: string;
  description: string;
  section: "cities" | "compare" | "sources" | null;
  body: Raw;
  markdown: string;
  jsonld: object[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "../../" from /city/x/ back to the site root, so pages work under any base path. */
export const toRoot = (path: string) => "../".repeat(path.split("/").filter(Boolean).length);
const abs = (site: Site, path: string) => `${site.origin}${path}`;

function clip(s: string, n = 158): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

// ---------- Shell ----------

export function shell(site: Site, page: Page, header: string): string {
  const root = toRoot(page.path);
  const url = abs(site, page.path);
  const ld = page.jsonld.length === 1 ? page.jsonld[0] : { "@context": "https://schema.org", "@graph": page.jsonld.map(({ "@context": _, ...rest }: any) => rest) };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" type="text/markdown" href="index.md">
<link rel="describedby" href="${root}llms.txt">
<meta property="og:type" content="${page.path.startsWith("/compare/") || page.path.startsWith("/city/") ? "article" : "website"}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${abs(site, "/og.png")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(site.name)}: compare cities on open data">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${abs(site, "/og.png")}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FAF9F4">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141311">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<link rel="preload" href="${root}fonts/archivo-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${root}app.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body class="static">
<div class="site">
${header}
<main class="page">${page.body.value}</main>
${siteFooter(site, root, { addFigures: page.path.startsWith("/city/") ? "#add-figures" : undefined }).value}
</div>
</body>
</html>
`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]!);

const REPO = "https://github.com/ABCastor/borgo";
const NPM = "https://www.npmjs.com/package/@abcastor/borgo";
/** The address assistants connect to (src/mcp/remote.ts). */
const MCP_URL = "https://borgo.abcastor.com/mcp";

/**
 * The footer of every page, the app's included: where everything else is (the pages, adding to the data, the ways in
 * for assistants, the code and its licences), how fresh the figures are, and last the Castor signature. `root` leads
 * back to the site root from the page ("" on the app, "../../" on a city page); `addFigures` is where "Add your
 * figures" goes on this page (a city page's own form), the guide to every way of adding them otherwise. `cities`,
 * on the app page, links every city page, so readers and crawlers reach them before the app has run.
 */
export function siteFooter(site: Site, root: string, o: { addFigures?: string; cities?: CityFacts[] } = {}): Raw {
  const groups: [string, Raw[]][] = [
    ["Borgo", [
      html`<a href="${root || "./"}">Compare your cities</a>`,
      html`<a href="${root}cities/">All cities</a>`,
      html`<a href="${root}compare/">All comparisons</a>`,
      html`<a href="${root}sources/">Sources and method</a>`,
      html`<a href="${root}privacy/">Privacy</a>`,
    ]],
    ["Add to it", [
      html`<a href="${o.addFigures ?? `${REPO}/blob/main/CONTRIBUTING.md#your-own-figures`}">Add your figures</a>`,
      html`<a href="${REPO}/issues/new?template=proposal.yml">Correct a figure</a>`,
      html`<a href="${root}api/community/dataset.json">Community figures (JSON)</a>`,
      html`<a href="${root}#/contact">Contact</a>`,
    ]],
    ["For assistants", [
      html`<a href="${root}docs/agents.md">MCP server</a><span class="bf-addr">${MCP_URL.replace("https://", "")}</span>`,
      html`<a href="${NPM}">npm package</a><span class="bf-addr">@abcastor/borgo</span>`,
      html`<a href="${root}llms.txt">Guide for AI assistants</a>`,
      html`<a href="${root}api/index.json">API</a>`,
    ]],
    ["Code and licences", [
      html`<a href="${REPO}">Source on GitHub</a>`,
      html`<a href="${REPO}/blob/main/LICENSE" rel="license">Code: Apache 2.0</a>`,
      html`<a href="${site.dataLicence.url}" rel="license">Data: CC BY 4.0</a>`,
      html`<a href="${root}sources/#licences">Each source's terms</a>`,
    ]],
  ];
  return html`<div class="bfoot">
${o.cities ? html`<details class="footer-links"><summary>Sources, tools and licences</summary>` : ''}<nav class="bf-nav" aria-label="Everything on ${site.name}">${groups.map(([h, links], i) => html`<div class="bf-group"><p class="bf-h" id="bf-${i}">${h}</p><ul aria-labelledby="bf-${i}">${links.map((l) => html`<li>${l}</li>`)}</ul></div>`)}</nav>
${o.cities ? html`</details>` : ''}
${o.cities ? html`<details><summary>Browse all city pages</summary><p class="bf-cities">Every city has its own page of sourced figures: ${[...o.cities].sort((a, b) => a.city.name.localeCompare(b.city.name)).map((f, i) => html`${i ? ", " : ""}<a href="${root}${f.path.slice(1)}">${f.city.name}</a>`)}.</p></details>` : ""}
${o.cities ? html`<details><summary>About these figures</summary>` : ''}<p class="bf-meta">Figures as of ${site.version}; every page names its sources and their licences. ${site.name} is made by <span translate="no">Castor</span>, which builds software and writes essays at <a href="https://abcastor.com/">abcastor.com</a>.</p>${o.cities ? html`</details>` : ''}
${raw(site.signature ?? "")}
</div>`;
}

// ---------- Pieces shared by the pages ----------

function srcLinks(sources: SourceRef[]): Raw {
  return html`${sources.map((s, i) => html`${i ? "; " : ""}${s.url ? html`<a href="${s.url}" rel="noopener">${s.name}</a>` : s.name}`)}`;
}

function licenceLinks(sources: SourceRef[]): Raw {
  const uniq = [...new Map(sources.map((s) => [s.licence, s])).values()];
  return html`${uniq.map((s, i) => html`${i ? ", " : ""}${s.licenceUrl ? html`<a href="${s.licenceUrl}" rel="noopener license">${s.licence}</a>` : s.licence}`)}`;
}

/** A rent figure that covers every tenancy (core/rent-basis.ts). */
const allTenancies = (f: Figure) => isRent(f.metric) && f.sources.some((s) => s.tenancies === "all");

function figureRow(f: Figure, country: string): Raw {
  return html`<tr>
    <th scope="row">${f.label}<span class="fig-v num">${f.text}${f.method === "median" && f.range ? html` <span class="quiet">(range ${num(f.range[0], 0)} to ${num(f.range[1], 0)})</span>` : ""}${allTenancies(f) ? html` <span class="quiet">(${ALL_TENANCIES})</span>` : ""}</span></th>
    <td class="fig-src">${f.method === "median" ? `Median of ${f.sources.length} sources: ` : ""}${srcLinks(f.sources)}<span class="quiet"> · ${f.period} · ${levelText(f.level, country)} · </span>${licenceLinks(f.sources)}</td>
  </tr>`;
}

function climateChart(c: Climate, name: string): Raw {
  return sharedChart({ ...c, source: c.source.name }, name, { ...DEFAULT_COMFORT, what: "The app's default comfortable daytime range (feels like)" }, { short: true });
}

function climateTable(c: Climate): Raw {
  return html`<table class="doc-table clim-table"><thead><tr><th>Month</th><th class="num">High °C (air)</th><th class="num">Low °C (air)</th>${c.recordLow && c.recordHigh ? html`<th class="num">Lowest °C</th><th class="num">Highest °C</th>` : ""}${c.nice ? html`<th class="num">Nice days</th>` : ""}${c.wetDays ? html`<th class="num">Wet days</th>` : ""}<th class="num">Daylight</th></tr></thead><tbody>
    ${c.high.map((h, i) => html`<tr><th scope="row">${MONTHS[i]}</th><td class="num">${num(h, 1)}</td><td class="num">${num(c.low[i]!, 1)}</td>${c.recordLow && c.recordHigh ? html`<td class="num">${num(c.recordLow[i]!, 1)}</td><td class="num">${num(c.recordHigh[i]!, 1)}</td>` : ""}${c.nice ? html`<td class="num">${num(c.nice[i]!, 0)}</td>` : ""}${c.wetDays ? html`<td class="num">${num(c.wetDays[i]!, 1)}</td>` : ""}<td class="num">${hoursText(c.daylight[i]!).replace(" min", "")}</td></tr>`)}
  </tbody></table>`;
}

function makeIt(root: string, param: string, label: string): Raw {
  return html`<p class="make-wrap"><a class="make" href="${root}?${param}">${label}</a></p>`;
}

const yours = (s: string | number) => html`<span class="set">${s}</span>`;

/** The reference profile in words; terracotta marks what a person would set for themselves. */
function assumptions(data: Dataset, p: Profile): Raw {
  const e = p.income.everyday;
  const home = e ? data.cities.find((c) => c.id === e.homeCity)?.name : null;
  return html`<p class="hint">Assumed: ${yours(p.household.length ? `${p.household.length} people` : "one person")}, ${yours(`${money(p.income.gross, p.income.currency)} gross a year`)}, renting a ${yours(p.housing.size === "1bed" ? "one-bedroom" : "three-bedroom")} home${e && home ? html`, and everyday spending of ${yours(`${money(e.amount, e.currency)} a month in ${home}`)} scaled by each country's price level` : ""}. These are the app's defaults; change any of them there.</p>`;
}

export function assumptionsText(data: Dataset, p: Profile): string {
  const e = p.income.everyday;
  const home = e ? data.cities.find((c) => c.id === e.homeCity)?.name : null;
  return `one person, ${money(p.income.gross, p.income.currency)} gross a year, a one-bedroom home${e && home ? `, everyday spending of ${money(e.amount, e.currency)} a month in ${home} scaled by each country's price level` : ""}`;
}

// ---------- City page ----------

export function cityPage(site: Site, data: Dataset, f: CityFacts, appParam: string): Page {
  const { city, country } = f;
  const root = toRoot(f.path);
  const cn = country.name;
  const b = f.budget;
  const title = `Living in ${city.name}, ${cn}: take-home pay, rent, climate and open data`;
  const description = clip(`${city.name} on open data: ${f.keyFacts.slice(1, 3).join(" ")}`);
  const body = html`<article class="doc static-doc">
    ${crumbs(root, [{ href: "cities/", label: "Every city" }], city.name)}
    <h1>Living in ${city.name}</h1>
    <p class="lede">${city.name}, ${cn}${city.population ? `, about ${num(city.population)} people` : ""}. What you would earn and keep, the climate month by month, and every open figure we hold, each with its source, period and licence.</p>
    ${makeIt(root, appParam, `Weigh ${city.name} against other cities, with your own numbers`)}

    <h2>Key facts</h2>
    <ul class="keyfacts">${f.keyFacts.map((s) => html`<li>${s}</li>`)}</ul>

    <h2>What you would take home</h2>
    ${f.takeHome
      ? html`<table class="doc-table"><thead><tr><th class="num">Gross a year</th><th class="num">Take-home a year</th><th class="num">A month</th><th class="num">Effective rate</th></tr></thead><tbody>
          ${f.takeHome.rows.map((r) => html`<tr><td class="num">${money(r.gross, f.takeHome!.currency)}</td><td class="num verdict">${money(r.net, f.takeHome!.currency)}</td><td class="num">${money(r.net / 12, f.takeHome!.currency)}</td><td class="num">${num(r.effectiveRate * 100, 1)}%</td></tr>`)}
        </tbody></table>
        ${f.takeHome.completeness.status === "partial" ? html`<p class="hint"><b>Partial:</b> these figures leave out ${f.takeHome.completeness.missing.join(", ")}, so the real take-home is lower.</p>` : ""}
        <p class="hint">${f.takeHome.scope} Rules for ${f.takeHome.year}. Sources: ${f.takeHome.sources.map((s, i) => html`${i ? ", " : ""}<a href="${s.url}" rel="noopener">${s.label}</a>`)}.</p>
        ${f.takeHome.caveats.length ? html`<ul class="caveats">${f.takeHome.caveats.map((c) => html`<li>${c}</li>`)}</ul>` : ""}`
      : html`<p class="quiet">Tax in ${inSentence(cn)} is not modelled yet, so take-home pay is not shown. Tax rules are added one country at a time.</p>`}

    <h2>A month in ${city.name}</h2>
    ${monthTable(b, city.name)}
    ${assumptions(data, referenceProfile(data, [city.id]))}

    <h2 id="community">From people who live here</h2>
    <p class="hint">Rents, everyday prices and take-home pay that people report for themselves, after an automated review. They stand beside the official figures and never change a score.</p>
    ${raw(`<!--community:${city.id}-->`)}<div class="cm-figs"><p class="cm-empty">Figures people add for ${city.name} appear here.</p></div>${raw("<!--/community-->")}
    <p><a class="cm-open" href="#add-figures">Add your own figures for ${city.name}</a></p>

    ${payByWork(f)}

    ${qolSection(data, f)}

    <h2>Who can live and work here freely</h2>
    <ul class="plain">
      <li>Citizens of ${inSentence(cn)}.</li>
      ${f.freeMovement.map((a) => html`<li>Citizens of ${a.members.map((m) => countryLabel(data, m)).join(", ")}, under ${a.name} (<a href="${a.source.url}" rel="noopener">${a.source.name}</a>).${a.note ? html` <span class="quiet">${a.note}</span>` : ""}</li>`)}
      ${f.freeMovement.length ? "" : html`<li class="quiet">Everyone else needs a visa or permit.</li>`}
    </ul>

    <h2>Climate</h2>
    ${f.climate
      ? html`${climateChart(f.climate, city.name)}${climateTable(f.climate)}
        <p class="hint">Daylight is computed from latitude: the shortest day lasts ${hoursText(f.shortestDay)}, the longest ${hoursText(f.longestDay)}.</p>`
      : html`<p class="quiet">Climate data for ${city.name} is not in the dataset yet.</p>`}

    <h2>Every figure</h2>
    <table class="doc-table figs-table"><tbody>${f.figures.map((x) => figureRow(x, cn))}</tbody></table>
    ${f.gaps.length ? html`<p class="hint">No open figure yet for: ${f.gaps.map((g) => g.label.toLowerCase()).join(", ")}. A country-wide figure is marked as such where it stands in for the city.</p>` : ""}

    ${f.comparisons.length
      ? html`<h2>Compare ${city.name} with</h2><ul class="pairs">${f.comparisons.map((c) => html`<li><a href="${root}${c.path.slice(1)}">${city.name} vs ${c.other.name}</a></li>`)}</ul>`
      : ""}

    <h2>Elsewhere</h2>
    <p class="hint">Sources we link to but do not copy, because their licences forbid it.</p>
    <ul class="plain">${f.linkOut.map((l) => html`<li><a href="${l.url}" rel="noopener nofollow">${l.label}</a></li>`)}</ul>

    <h2 id="add-figures">Add your own figures for ${city.name}</h2>
    ${communityForm({ id: city.id, name: city.name, currency: data.countries[city.country]?.currency ?? "EUR" })}

    <h2>Credits</h2>
    ${creditList(pageCredits(data, f))}

    <h2>Cite this page</h2>
    <p class="cite">${site.name}, “Living in ${city.name}”, ${abs(site, f.path)}, figures as of ${site.version}. Please also name the original source of any figure you use; each is listed above with its licence. Data: <a href="${root}api/city/${city.id}.json">${city.id}.json</a>.</p>
  </article>`;
  return {
    path: f.path,
    title: `${title} | ${site.name}`.length > 90 ? `Living in ${city.name}: pay, rent, climate | ${site.name}` : `${title} | ${site.name}`,
    description,
    section: "cities",
    body,
    markdown: cityMarkdown(site, data, f),
    jsonld: cityJsonLd(site, f),
  };
}

/** What each kind of work pays here, from the city's own figures: the metro, region or country the source covers. */
function payRows(f: CityFacts) {
  return [...WORK_KINDS.filter((k) => k.pay), { id: "all", label: "All jobs" }]
    .map((k) => ({ k, x: f.figures.find((x) => x.metric === payMetric(k.id)) }))
    .filter((r): r is { k: (typeof r)["k"]; x: NonNullable<(typeof r)["x"]> } => !!r.x);
}

function payByWork(f: CityFacts): Raw {
  const rows = payRows(f);
  if (!rows.length) return html``;
  const cur = f.figures.find((x) => x.metric === "pay_all")?.unit.replace("/year", "") ?? "";
  return html`<h2 id="pay-by-work">Pay by kind of work</h2>
    <p class="hint">Average gross pay a year, before tax, from official earnings surveys${cur ? `, in ${cur}` : ""}. Each row says which occupations or industry it counts and for which area; choose your kind of work in the app and it counts in Work and ambition.</p>
    <table class="doc-table"><thead><tr><th>Kind of work, and what the figure counts</th><th class="num">A year</th></tr></thead><tbody>
      ${rows.map(({ k, x }) => html`<tr><td>${k.label}${x.note ? html`<br><span class="quiet">${x.note}</span>` : ""}</td><td class="num">${x.text.replace(/ a year$/, "")}</td></tr>`)}
    </tbody></table>
    <p class="hint">Sources: ${[...new Map(rows.flatMap(({ x }) => x.sources).map((s) => [s.id, s])).values()].map((s, i) => html`${i ? "; " : ""}<a href="${s.url}" rel="noopener">${s.name}</a> (${s.publisher})`)}.</p>`;
}

/** Borgo's generic quality-of-life index for the city, its parts and their weights in view. */
function qolSection(data: Dataset, f: CityFacts): Raw {
  const q = qualityOfLife(data, f.city);
  return html`<h2 id="quality-of-life">Quality of life index</h2>
    <p class="hint">A generic view: the same fixed weights for everyone, from the figures on this page. In the app your own ranking weighs what you say matters; this index counts in it only if you turn it on.</p>
    <p class="keyfact">${q.score === null ? html`No index for ${f.city.name}: only ${Math.round(q.coverage * 100)}% of its weight has figures.` : html`<b>${num(q.score, 0)} of 100</b>${q.coverage < 1 ? html` <span class="quiet">(on ${Math.round(q.coverage * 100)}% of the weight; parts with no figure are left out)</span>` : ""}`}</p>
    <table class="doc-table"><thead><tr><th>Part</th><th class="num">Weight</th><th>Here</th><th class="num">Score</th></tr></thead><tbody>
      ${q.parts.map((p) => html`<tr><td>${p.label}<br><span class="quiet">${QOL_PARTS.find((x) => x.id === p.id)!.says}</span></td><td class="num">${p.weight}%</td><td>${p.text}</td><td class="num">${p.score === null ? "–" : num(100 * p.score, 0)}</td></tr>`)}
    </tbody></table>
    <p class="hint">Other indices weigh other things, by their own methods: ${QOL_INDICES.map((l, i) => html`${i ? (i === QOL_INDICES.length - 1 ? " and " : ", ") : ""}<a href="${l.url}" rel="noopener nofollow">${l.label}</a>`)}. Borgo links to them and copies none of their figures.</p>`;
}

/** The sources a city page shows figures from, plus GeoNames for the place itself. */
function pageCredits(data: Dataset, f: CityFacts): ManifestEntry[] {
  const ids = new Set(["geonames", ...f.figures.flatMap((x) => x.sources.map((s) => s.id))]);
  if (f.climate) ids.add(f.climate.source.id);
  for (const a of f.freeMovement) ids.add(a.source.id);
  return creditsFor(data, ids);
}

/** Each source's required attribution and notices, as its terms ask for wherever its figures are shown. */
function creditList(credits: ManifestEntry[]): Raw {
  return html`<ul class="plain credits">${credits.map((c) => html`<li>${c.attribution}${c.notices.length ? html` ${c.notices.join(" ")}` : ""} <small>(<a href="${c.licenceUrl}" rel="noopener license">${c.licence}</a>)</small></li>`)}</ul>`;
}

const creditMarkdown = (credits: ManifestEntry[]) => credits.map((c) => `- ${c.attribution}${c.notices.length ? ` ${c.notices.join(" ")}` : ""} ([${c.licence}](${c.licenceUrl}))`);

function monthTable(b: CityFacts["budget"], name: string): Raw {
  const row = (label: string, v: number | null, note: Raw | string = "", cls = "") =>
    html`<tr class="${cls}"><th scope="row">${label}${note ? html`<small>${note}</small>` : ""}</th><td class="num">${v === null ? html`<span class="quiet">not known</span>` : money(v, b.currency)}</td></tr>`;
  return html`<table class="doc-table wf-table"><tbody>
    ${row("Take-home pay", b.net === null ? null : b.net / 12, b.net === null ? "tax not modelled yet" : "after income tax and contributions")}
    ${row("Rent, one bedroom", b.rent === null ? null : -b.rent, b.rentFigure ? html`${srcLinks(b.rentFigure.sources)}, ${b.rentFigure.period}, ${levelText(b.rentFigure.level, "country")}${b.rentFigure.sources.some((s) => s.tenancies === "all") ? `; ${ALL_TENANCIES}` : ""}` : "no open rent data yet: add your own in the app")}
    ${row("Everyday spending", b.everyday === null ? null : -b.everyday, b.everydayHow ? `${b.everydayHow} by the World Bank price level` : "")}
    ${b.childcare !== null ? row("Childcare", -b.childcare, "after public support") : ""}
    ${b.health !== null ? row("Health care", -b.health, "out of pocket") : ""}
    ${row("Left each month", b.left, b.left === null ? `needs ${b.missing.join(" and ")}` : b.completeness.status === "partial" ? `partial: leaves out ${b.completeness.missing.join(", ")}` : "", "verdict-row")}
  </tbody></table>`;
}

function cityMarkdown(site: Site, data: Dataset, f: CityFacts): string {
  const { city, country } = f;
  const L: string[] = [];
  L.push(`# Living in ${city.name}, ${country.name}`, "");
  L.push(`> Open, sourced figures for ${city.name}: take-home pay, monthly costs, who may live there, climate, air, safety and health. Figures as of ${site.version}. Canonical page: ${abs(site, f.path)}`, "");
  L.push("## Key facts", "", ...f.keyFacts.map((s) => `- ${s}`), "");
  if (f.takeHome) {
    const t = f.takeHome;
    L.push(`## Take-home pay (${country.name}, ${t.year} rules)`, "", "| Gross a year | Take-home a year | A month | Effective rate |", "|---:|---:|---:|---:|");
    for (const r of t.rows) L.push(`| ${money(r.gross, t.currency)} | ${money(r.net, t.currency)} | ${money(r.net / 12, t.currency)} | ${num(r.effectiveRate * 100, 1)}% |`);
    L.push("", ...(t.completeness.status === "partial" ? [`Partial: these figures leave out ${t.completeness.missing.join(", ")}, so the real take-home is lower.`, ""] : []), `${t.scope} Sources: ${t.sources.map((s) => `[${s.label}](${s.url})`).join(", ")}.`, "");
  }
  const b = f.budget;
  const m = (v: number | null) => (v === null ? "not known" : money(v, b.currency));
  L.push("## A month on the reference profile", "", `Assumed: ${assumptionsText(data, referenceProfile(data, [city.id]))}.`, "");
  L.push(`- Take-home pay: ${m(b.net === null ? null : b.net / 12)}`, `- Rent: ${m(b.rent)}${b.rentFigure ? ` (${b.rentFigure.sources.map((s) => s.name).join(", ")}, ${b.rentFigure.period}${b.rentFigure.sources.some((s) => s.tenancies === "all") ? `; ${ALL_TENANCIES}` : ""})` : " (no open rent data yet)"}`, `- Everyday spending: ${m(b.everyday)}`, ...(b.childcare !== null ? [`- Childcare: ${m(b.childcare)}`] : []), ...(b.health !== null ? [`- Health care, out of pocket: ${m(b.health)}`] : []), `- Left each month: ${m(b.left)}${b.left !== null && b.completeness.status === "partial" ? ` (partial: leaves out ${b.completeness.missing.join(", ")})` : ""}`, "");
  L.push("## From people who live here", "", `Rents, everyday prices, take-home pay and a 1 to 5 rating that people report for themselves, after automated review, live as JSON: ${abs(site, `/api/community/city/${city.id}.json`)} (CC BY 4.0, Borgo contributors). Never mixed into the figures above. Add your own on the page, with \`borgo submit\` or the MCP tool submit_figures.`, "");
  const pays = payRows(f);
  if (pays.length) {
    L.push("## Pay by kind of work", "", "Average gross pay a year, before tax, from official earnings surveys.", "", "| Kind of work | A year | What it counts | Source |", "|---|---:|---|---|");
    for (const { k, x } of pays) L.push(`| ${k.label} | ${x.text} | ${x.note ?? ""} | ${x.sources.map((s) => `[${s.name}](${s.url})`).join("; ")} |`);
    L.push("");
  }
  const q = qualityOfLife(data, city);
  L.push("## Quality of life index (generic)", "", `${q.score === null ? `No index: only ${Math.round(q.coverage * 100)}% of the weight has figures.` : `${num(q.score, 0)} of 100${q.coverage < 1 ? ` on ${Math.round(q.coverage * 100)}% of the weight` : ""}.`} The same fixed weights for everyone; a person's own ranking in the app weighs what they say matters.`, "", "| Part | Weight | Here | Score |", "|---|---:|---|---:|");
  for (const p of q.parts) L.push(`| ${p.label} | ${p.weight}% | ${p.text} | ${p.score === null ? "–" : num(100 * p.score, 0)} |`);
  L.push("", `Other indices, by their own methods (linked, not copied): ${QOL_INDICES.map((l) => `[${l.label}](${l.url})`).join(", ")}.`, "");
  L.push("## Who can live and work here without a visa", "", `- Citizens of ${inSentence(country.name)}`);
  for (const a of f.freeMovement) L.push(`- Citizens of ${a.members.map((x) => countryLabel(data, x)).join(", ")} (${a.name}; source: [${a.source.name}](${a.source.url}))`);
  L.push("");
  if (f.climate) {
    const c = f.climate;
    const ext = !!(c.recordLow && c.recordHigh);
    L.push(`## Climate (${c.source.name}, ${c.period})`, "", `| Month | High °C (air) | Low °C (air) |${ext ? " Lowest °C | Highest °C |" : ""}${c.nice ? " Nice days |" : ""}${c.wetDays ? " Wet days |" : ""} Daylight |`, `|---|---:|---:|${ext ? "---:|---:|" : ""}${c.nice ? "---:|" : ""}${c.wetDays ? "---:|" : ""}---:|`);
    c.high.forEach((h, i) => L.push(`| ${MONTHS[i]} | ${num(h, 1)} | ${num(c.low[i]!, 1)} |${ext ? ` ${num(c.recordLow![i]!, 1)} | ${num(c.recordHigh![i]!, 1)} |` : ""}${c.nice ? ` ${num(c.nice[i]!, 0)} |` : ""}${c.wetDays ? ` ${num(c.wetDays[i]!, 1)} |` : ""} ${hoursText(c.daylight[i]!)} |`));
    if (c.nice) L.push("", `Nice days: dry, mostly clear and feeling ${DEFAULT_COMFORT.min} to ${DEFAULT_COMFORT.max} °C on average from 8 am to 8 pm. Lowest and highest: the extremes of ${c.period}.`);
    L.push("");
  }
  L.push("## Every figure", "", "| Figure | Value | Period | Level | Source | Licence |", "|---|---:|---|---|---|---|");
  for (const x of f.figures)
    L.push(`| ${x.label} | ${x.text}${x.method === "median" ? ` (median of ${x.sources.length})` : ""}${allTenancies(x) ? ` (${ALL_TENANCIES})` : ""} | ${x.period} | ${levelText(x.level, country.name)} | ${x.sources.map((s) => `[${s.name}](${s.url})`).join("; ")} | ${[...new Set(x.sources.map((s) => s.licence))].join(", ")} |`);
  L.push("");
  if (f.gaps.length) L.push(`No open figure yet for: ${f.gaps.map((g) => g.label.toLowerCase()).join(", ")}.`, "");
  if (f.comparisons.length) L.push("## Comparisons", "", ...f.comparisons.map((c) => `- [${city.name} vs ${c.other.name}](${abs(site, c.path)}index.md)`), "");
  L.push("## Credits", "", ...creditMarkdown(pageCredits(data, f)), "");
  L.push("## Cite", "", `${site.name}, "Living in ${city.name}", ${abs(site, f.path)}, figures as of ${site.version}. Name the original source of any figure you quote. JSON: ${abs(site, `/api/city/${city.id}.json`)}`, "");
  return L.join("\n");
}

function cityJsonLd(site: Site, f: CityFacts): object[] {
  const url = abs(site, f.path);
  const sameAs = [f.city.wikidata && `https://www.wikidata.org/wiki/${f.city.wikidata}`, f.city.geonames && `https://www.geonames.org/${f.city.geonames}`].filter(Boolean);
  const place = {
    "@context": "https://schema.org",
    "@type": "City",
    "@id": `${url}#place`,
    name: f.city.name,
    geo: { "@type": "GeoCoordinates", latitude: f.city.lat, longitude: f.city.lon },
    containedInPlace: { "@type": "Country", name: f.country.name, identifier: f.country.code },
    ...(sameAs.length ? { sameAs } : {}),
  };
  const sources = [...new Map(f.figures.flatMap((x) => x.sources).map((s) => [s.id, s])).values()];
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${url}#data`,
    name: `Open figures for ${f.city.name}, ${f.country.name}`,
    description: `Take-home pay, rent, climate, air quality, safety and health figures for ${f.city.name}, each with its source, period, geographic level and licence.`,
    url,
    license: site.dataLicence.url,
    creator: site.creator,
    isAccessibleForFree: true,
    dateModified: site.version,
    spatialCoverage: { "@id": `${url}#place` },
    isPartOf: { "@id": `${abs(site, "/sources/")}#dataset` },
    isBasedOn: sources.filter((s) => s.url).map((s) => ({ "@type": "CreativeWork", name: s.name, url: s.url, publisher: { "@type": "Organization", name: s.publisher }, license: s.licenceUrl ?? s.licence })),
    variableMeasured: f.figures.map((x) => ({ "@type": "PropertyValue", name: x.label, value: Number(x.value.toFixed(3)), unitText: x.unit, description: `${x.description} ${x.period}, ${x.level} level.` })),
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs(site, `/api/city/${f.city.id}.json`) }],
  };
  const page = { "@context": "https://schema.org", "@type": "WebPage", "@id": url, url, name: `Living in ${f.city.name}`, dateModified: site.version, about: { "@id": `${url}#place` }, mainEntity: { "@id": `${url}#data` }, isPartOf: { "@id": `${site.origin}/#website` } };
  return [page, place, dataset, breadcrumbLd(site, [{ path: "/cities/", name: "Every city" }, { path: f.path, name: f.city.name }])];
}

// ---------- Comparison page ----------

/** The title, H1 and opening of a comparison speak the searches it answers: "A vs B", "cost of living in A vs B", "A vs B weather". */
export function compareTitle(site: Site, a: string, b: string): string {
  const base = `${a} vs ${b}: cost of living, take-home pay and weather`;
  return base.length <= 60 ? `${base} | ${site.name}` : base;
}

export function comparePage(site: Site, data: Dataset, c: CompareFacts): Page {
  const A = c.a.city;
  const B = c.b.city;
  const root = toRoot(c.path);
  const [ra, rb] = c.results;
  const gross = ra.money.gross;
  const lead = c.winner
    ? `On balanced weights, ${c.winner.name} comes out ahead: ${Math.round(c.winner.id === A.id ? ra.total : rb.total)} against ${Math.round(c.winner.id === A.id ? rb.total : ra.total)} out of 100${c.drivers.length ? `, mostly on ${c.drivers.filter((d) => d.leader.id === c.winner!.id).map((d) => d.label.toLowerCase()).slice(0, 2).join(" and ") || "small margins"}` : ""}.`
    : `On balanced weights, ${A.name} and ${B.name} are too close to call: ${Math.round(ra.total)} and ${Math.round(rb.total)} out of 100.`;
  const title = compareTitle(site, A.name, B.name);
  const description = c.intent.description;
  const cov = (r: typeof ra) => Math.round(r.coverage * 100);
  const cell = (s: CompareFacts["lines"][number]["a"]) =>
    html`<td><span class="num">${s.text}</span>${s.sources.length ? html`<small>${srcLinks(s.sources)}${s.level === "country" ? html` <span class="quiet">(country)</span>` : ""}</small>` : ""}</td>`;
  const pairLinks = (city: string, list: CompareFacts["related"]["a"]) =>
    html`<h3>${city} against other cities</h3><ul class="pairs">${list.map((p) => html`<li><a href="${root}${p.path.slice(1)}">${city} vs ${p.other.name}</a></li>`)}</ul>`;
  const niceBoth = !!(c.a.climate?.nice && c.b.climate?.nice);
  const body = html`<article class="doc static-doc">
    ${crumbs(root, [{ href: "compare/", label: "Every comparison" }], `${A.name} vs ${B.name}`)}
    <h1>${A.name} vs ${B.name}: cost of living, pay and weather</h1>
    <p class="lede">${c.intent.answer.length ? `${c.intent.answer.join(" ")} ` : ""}${lead} Your own weights, salary and household can change the answer; every figure below names its source.</p>
    ${makeIt(root, c.appParam, `Make it yours: compare ${A.name} and ${B.name} with your own numbers`)}

    ${c.intent.moving ? html`<h2>Moving between ${A.name} and ${B.name}</h2>${c.intent.moving.map((s) => html`<p>${s}</p>`)}` : ""}

    <h2>The verdict on default settings</h2>
    <div class="duel">
      ${[ra, rb].map((r) => html`<div class="duel-side"><a class="duel-city" href="${root}${`city/${r.city.id}/`}">${r.city.name}</a><span class="duel-score num">${Math.round(r.total)}<small>/100</small></span><span class="hint">${cov(r)}% of the weight rests on real data for this city</span></div>`)}
    </div>
    ${c.drivers.length ? html`<p>The lines that move the score most: ${c.drivers.map((d, i) => html`${i ? "; " : ""}${d.label.toLowerCase()} (${d.leader.name}, +${num(d.points, 1)} points)`)}.</p>` : ""}
    <p class="hint">Balanced weights are the app's starting point, not a judgement: weights are set by you. Fixed scoring leaves out a city's missing lines; adding another city never changes its score. Check coverage and gaps, since fewer figures can favour an incomplete city.</p>

    <h2>Line by line</h2>
    <table class="doc-table cmp-table"><thead><tr><th>Line</th><th>${A.name}</th><th>${B.name}</th></tr></thead><tbody>
      ${c.lines.filter((l) => l.id !== "right_to_live").map((l) => html`<tr><th scope="row">${l.label}<small>${l.question}</small></th>${cell(l.a)}${cell(l.b)}</tr>`)}
    </tbody></table>
    <p class="hint">Who may move where depends on your passports: see each city's page, or add your household in the app.</p>

    <h2>Money on ${gross === null ? "the default salary" : money(c.profile.income.gross, c.profile.income.currency)} a year</h2>
    <table class="doc-table cmp-table"><thead><tr><th>A month</th><th class="num">${A.name}</th><th class="num">${B.name}</th></tr></thead><tbody>
      ${(["Take-home pay", "Rent and everyday spending", "Left each month"] as const).map((label) => {
        const v = (r: typeof ra) => (label === "Take-home pay" ? (r.money.display.net === null ? null : r.money.display.net / 12) : label === "Left each month" ? r.money.display.monthlyLeft : r.money.display.monthlyCost);
        return html`<tr class="${label === "Left each month" ? "verdict-row" : ""}"><th scope="row">${label}</th>${[ra, rb].map((r) => html`<td class="num">${v(r) === null ? html`<span class="quiet">not known</span>` : money(v(r), r.money.display.currency)}</td>`)}</tr>`;
      })}
    </tbody></table>
    ${assumptions(data, c.profile)}

    ${c.a.climate && c.b.climate
      ? html`<h2>Weather month by month</h2>
        <table class="doc-table clim-table"><thead><tr><th>Month</th><th class="num">${A.name}</th><th class="num">${B.name}</th></tr></thead><tbody>
          ${c.a.climate.high.map((h, i) => {
            const cell = (cl: NonNullable<typeof c.a.climate>, hi: number) =>
              html`<td class="num">${num(cl.low[i]!, 0)} to ${num(hi, 0)} °C${niceBoth ? html`<small>${num(cl.nice![i]!, 0)} nice ${Math.round(cl.nice![i]!) === 1 ? "day" : "days"}</small>` : ""}</td>`;
            return html`<tr><th scope="row">${MONTHS[i]}</th>${cell(c.a.climate!, h)}${cell(c.b.climate!, c.b.climate!.high[i]!)}</tr>`;
          })}
        </tbody></table>
        <p class="hint">Air temperature in the shade, average daily low to high${niceBoth ? `; nice days are dry, mostly clear days that feel ${DEFAULT_COMFORT.min} to ${DEFAULT_COMFORT.max} °C from 8 am to 8 pm, the app's default, which you can change` : ""} (${c.a.climate.source.name}, ${c.a.climate.period}).</p>`
      : ""}

    <h2>Questions this page answers</h2>
    <div class="qa">${c.qa.map((x) => html`<h3>${x.q}</h3><p>${x.a}</p>`)}</div>

    <h2>More comparisons</h2>
    <ul class="plain"><li><a href="${root}city/${A.id}/">Living in ${A.name}: every figure</a></li><li><a href="${root}city/${B.id}/">Living in ${B.name}: every figure</a></li><li><a href="${root}compare/">Every comparison</a></li></ul>
    ${c.related.a.length ? pairLinks(A.name, c.related.a) : ""}
    ${c.related.b.length ? pairLinks(B.name, c.related.b) : ""}

    <h2>Cite this page</h2>
    <p class="cite">${site.name}, “${A.name} vs ${B.name}”, ${abs(site, c.path)}, figures as of ${site.version}, reference profile. Name the original source of any figure you quote.</p>
  </article>`;
  return { path: c.path, title, description, section: "compare", body, markdown: compareMarkdown(site, data, c, lead), jsonld: compareJsonLd(site, c) };
}

function compareMarkdown(site: Site, data: Dataset, c: CompareFacts, lead: string): string {
  const A = c.a.city.name;
  const B = c.b.city.name;
  const [ra, rb] = c.results;
  const L = [`# ${A} vs ${B}: cost of living, pay and weather`, "", `> ${[...c.intent.answer, lead].join(" ")} Reference profile: ${assumptionsText(data, c.profile)}, balanced weights. Figures as of ${site.version}. Canonical page: ${abs(site, c.path)}`, ""];
  L.push(`Scores out of 100: ${A} ${Math.round(ra.total)}, ${B} ${Math.round(rb.total)}. Make it yours: ${abs(site, `/?${c.appParam}`)}`, "");
  if (c.intent.moving) L.push(`## Moving between ${A} and ${B}`, "", ...c.intent.moving.flatMap((s) => [s, ""]));
  L.push("## Line by line", "", `| Line | ${A} | ${B} |`, "|---|---|---|");
  const cell = (s: CompareFacts["lines"][number]["a"]) => `${s.text}${s.sources.length ? ` (${s.sources.map((x) => x.name).join("; ")})` : ""}`;
  for (const l of c.lines.filter((x) => x.id !== "right_to_live")) L.push(`| ${l.label} | ${cell(l.a)} | ${cell(l.b)} |`);
  L.push("", "## Questions", "");
  for (const x of c.qa) L.push(`### ${x.q}`, "", x.a, "");
  const more = (city: string, list: CompareFacts["related"]["a"]) => (list.length ? [`- ${city} against: ${list.map((p) => `[${p.other.name}](${abs(site, p.path)}index.md)`).join(", ")}`] : []);
  L.push("## More comparisons", "", ...more(A, c.related.a), ...more(B, c.related.b), "");
  L.push("## Cite", "", `${site.name}, "${A} vs ${B}", ${abs(site, c.path)}, figures as of ${site.version}.`, "");
  return L.join("\n");
}

/** A visible breadcrumb trail, the same one BreadcrumbList states. */
function crumbs(root: string, trail: { href: string; label: string }[], here: string): Raw {
  return html`<nav class="crumbs" aria-label="Breadcrumb"><a href="${root || "./"}">Borgo</a>${trail.map((t) => html` › <a href="${root}${t.href}">${t.label}</a>`)} › <span aria-current="page">${here}</span></nav>`;
}

/** BreadcrumbList for Google's breadcrumb feature (supported, desktop): home, the hub, this page. */
function breadcrumbLd(site: Site, trail: { path: string; name: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ path: "/", name: site.name }, ...trail].map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: abs(site, t.path) })),
  };
}

// FAQPage states the questions the page shows, for any reader of schema.org. Google has shown no FAQ rich result
// since 7 May 2026, so it brings no search feature; it is kept for meaning only.
function compareJsonLd(site: Site, c: CompareFacts): object[] {
  const url = abs(site, c.path);
  const name = `${c.a.city.name} vs ${c.b.city.name}`;
  const page = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": url,
    url,
    name,
    dateModified: site.version,
    about: [c.a, c.b].map((f) => ({ "@id": `${abs(site, f.path)}#place` })),
    isPartOf: { "@id": `${site.origin}/#website` },
  };
  const places = [c.a, c.b].map((f) => ({ "@context": "https://schema.org", "@type": "City", "@id": `${abs(site, f.path)}#place`, name: f.city.name, url: abs(site, f.path) }));
  const out: object[] = [page, ...places, breadcrumbLd(site, [{ path: "/compare/", name: "Every comparison" }, { path: c.path, name }])];
  if (c.qa.length)
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: c.qa.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
    });
  return out;
}

// ---------- Hubs: every city, every comparison, sources ----------

export function citiesPage(site: Site, data: Dataset, all: CityFacts[]): Page {
  const path = "/cities/";
  const byCountry = groupBy(all, (f) => f.country.name);
  const body = html`<article class="doc static-doc">
    <h1>Every city</h1>
    <p class="lede">${all.length} cities in ${byCountry.length} countries, each with its own page of open, sourced figures. Take-home pay is a gross salary worth about €60,000 a year, after tax, where the country's tax rules are modelled.</p>
    ${byCountry.map(
      ([country, list]) => html`<h2>${country}</h2>
      <table class="doc-table hub-table"><thead><tr><th>City</th><th class="num">Take-home a month</th><th class="num">PM2.5</th></tr></thead><tbody>
        ${list.map((f) => {
          const t = f.takeHome?.rows[1];
          const pm = f.figures.find((x) => x.metric === "pm25");
          return html`<tr><th scope="row"><a href="../${f.path.slice(1)}">${f.city.name}</a></th><td class="num">${t ? money(t.net / 12, f.takeHome!.currency) : html`<span class="quiet">not modelled</span>`}</td><td class="num">${pm ? `${num(pm.value, 1)} µg/m³` : html`<span class="quiet">no data</span>`}</td></tr>`;
        })}
      </tbody></table>`,
    )}
  </article>`;
  const md = [`# Every city`, "", `> ${all.length} cities with open, sourced figures. Figures as of ${site.version}.`, ""];
  for (const [country, list] of byCountry) md.push(`## ${country}`, "", ...list.map((f) => `- [${f.city.name}](${abs(site, f.path)}index.md)`), "");
  return {
    path,
    title: `Every city: open data on pay, rent, climate and more | ${site.name}`,
    description: clip(`${all.length} cities in ${byCountry.length} countries compared on open data: take-home pay, rent, climate, air, safety and health, each figure with its source and licence.`),
    section: "cities",
    body,
    markdown: md.join("\n"),
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": abs(site, path),
        url: abs(site, path),
        name: "Every city",
        isPartOf: { "@id": `${site.origin}/#website` },
        hasPart: all.map((f) => ({ "@type": "WebPage", "@id": abs(site, f.path), name: `Living in ${f.city.name}` })),
      },
    ],
  };
}

export function comparisonsPage(site: Site, data: Dataset, pairs: [string, string][]): Page {
  const path = "/compare/";
  const name = (id: string) => data.cities.find((c) => c.id === id)!.name;
  // Each city lists every pair it is in, so a pair shows under both of its cities, the other city named second.
  const byCity = groupBy(
    pairs.flatMap(([a, b]) => [{ city: a, other: b, id: `${a}-vs-${b}` }, { city: b, other: a, id: `${a}-vs-${b}` }]),
    (p) => name(p.city),
  ).map(([city, list]) => [city, list.sort((x, y) => name(x.other).localeCompare(name(y.other)))] as const);
  const body = html`<article class="doc static-doc">
    <h1>Every comparison</h1>
    <p class="lede">${pairs.length} pairs of cities people weigh against each other: same-country pairs, near neighbours, and cities of a similar size. Each page sets take-home pay, rent, money left and nice days side by side, and says what changes for someone moving from one to the other. Any other pair, or more than two cities, opens in <a href="../">the app</a>.</p>
    ${byCity.map(([city, list]) => html`<h2>${city}</h2><ul class="pairs">${list.map((p) => html`<li><a href="${p.id}/">${city} vs ${name(p.other)}</a></li>`)}</ul>`)}
  </article>`;
  const md = [`# Every comparison`, "", `> ${pairs.length} city pairs compared on open data. Figures as of ${site.version}.`, ""];
  for (const [a, b] of pairs) md.push(`- [${name(a)} vs ${name(b)}](${abs(site, `/compare/${a}-vs-${b}/`)}index.md)`);
  return {
    path,
    title: `Every comparison: city vs city on open data | ${site.name}`,
    description: clip(`${pairs.length} city-versus-city comparisons on open data: take-home pay, cost of living, climate, air quality and who can move there without a visa.`),
    section: "compare",
    body,
    markdown: md.join("\n"),
    jsonld: [{ "@context": "https://schema.org", "@type": "CollectionPage", "@id": abs(site, path), url: abs(site, path), name: "Every comparison", isPartOf: { "@id": `${site.origin}/#website` } }],
  };
}

export function sourcesPage(site: Site, data: Dataset, all: CityFacts[]): Page {
  const path = "/sources/";
  const used = new Map<string, { source: SourceRef; metrics: Set<string>; cities: Set<string> }>();
  for (const f of all)
    for (const x of f.figures)
      for (const s of x.sources) {
        const e = used.get(s.id) ?? { source: s, metrics: new Set(), cities: new Set() };
        e.metrics.add(x.label.toLowerCase());
        e.cities.add(f.city.id);
        used.set(s.id, e);
      }
  for (const f of all)
    if (f.climate) {
      const e = used.get(f.climate.source.id) ?? { source: f.climate.source, metrics: new Set(), cities: new Set() };
      e.metrics.add("monthly temperatures");
      e.cities.add(f.city.id);
      used.set(f.climate.source.id, e);
    }
  const rows = [...used.values()].sort((a, b) => b.cities.size - a.cities.size);
  const body = html`<article class="doc static-doc">
    <h1>Where the numbers come from</h1>
    <p class="lede">Every figure carries its source, the period it describes, whether it describes the city or only its country, and its licence. We store only data we may share; closed sources such as Numbeo and WeatherSpark are linked from each city page, never copied.</p>
    <h2>Sources</h2>
    <table class="doc-table"><thead><tr><th>Source</th><th>Provides</th><th>Licence</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td>${r.source.url ? html`<a href="${r.source.url}" rel="noopener">${r.source.name}</a>` : r.source.name}<small>${r.source.publisher}</small></td><td>${[...r.metrics].join(", ")}<small>${r.cities.size} cities</small></td><td>${r.source.licenceUrl ? html`<a href="${r.source.licenceUrl}" rel="noopener license">${r.source.licence}</a>` : r.source.licence}</td></tr>`)}
    </tbody></table>
    <p class="hint">Exchange rates: European Central Bank reference rates of ${data.fx.date}. Free-movement rules: ${data.rights.map((a) => a.name).filter((v, i, xs) => xs.indexOf(v) === i).join(", ")}.</p>
    <h2>How a figure is chosen</h2>
    <p>For each city and measure, the most local figure wins (city, then metro area, region, country), and among those the most recent. When several sources describe the city at the same level within two years, the page shows their median and their range. A country-wide figure standing in for a city is labelled as such.</p>
    <h2>How the score works</h2>
    <p>Each line turns a figure into a score from 0 to 1 against a fixed worst and best. Your weights decide how many of the 100 points each line can give. Comparison pages use the balanced weights and a reference profile (one person, a gross salary of €60,000 a year, a one-bedroom home); the app starts from no salary and lets you set all of it.</p>
    <h2 id="licences">Licences and attribution</h2>
    <p>The figures are published in files that each carry one set of terms:</p>
    <ul class="plain">${partsList(data).map((p) => html`<li><a href="../${p.file}">${p.file}</a>: <a href="${p.licence.url}" rel="license">${p.licence.name}</a>. ${p.notice}</li>`)}</ul>
    <p>Every source exported, with the edition read, its licence and the credit it requires, is listed in <a href="../data/licences.json">data/licences.json</a>. The required attributions:</p>
    ${creditList(manifestOf(data)?.sources ?? [])}
    <p>Code: Apache-2.0.</p>
    <h2>For software and AI agents</h2>
    <p>The same figures as JSON: <a href="../api/cities.json">cities</a>, one file per city (for example <a href="../api/city/${all[0]?.city.id ?? ""}.json">${all[0]?.city.id ?? ""}.json</a>), <a href="../api/sources.json">sources</a> and <a href="../api/metrics.json">metrics</a>; the whole dataset at <a href="../data/dataset.json">data/dataset.json</a>. A summary for language models is at <a href="../llms.txt">llms.txt</a>.</p>
  </article>`;
  const md = [`# Where the numbers come from`, "", `> Sources, licences and method behind ${site.name}. Figures as of ${site.version}.`, "", "## Sources", "", "| Source | Publisher | Provides | Cities | Licence |", "|---|---|---|---:|---|"];
  for (const r of rows) md.push(`| [${r.source.name}](${r.source.url}) | ${r.source.publisher} | ${[...r.metrics].join(", ")} | ${r.cities.size} | ${r.source.licence} |`);
  md.push("", "## Licences and attribution", "", ...partsList(data).map((p) => `- [${p.file}](${abs(site, `/${p.file}`)}): ${p.licence.name}. ${p.notice}`), "", `Every source exported, with its edition, licence and required credit: ${abs(site, "/data/licences.json")}.`, "", ...creditMarkdown(manifestOf(data)?.sources ?? []));
  md.push("", "## Method", "", "The most local figure wins (city, metro, region, country), then the most recent. Same-level sources within two years are combined as a median with their range. Country figures standing in for a city are labelled.", "");
  return {
    path,
    title: `Sources and method: where every figure comes from | ${site.name}`,
    description: clip("The open sources behind every figure, their licences, and how a figure is chosen and scored: city before country, newest first, medians where sources agree."),
    section: "sources",
    body,
    markdown: md.join("\n"),
    jsonld: [mainDataset(site, data, [...used.values()].map((u) => u.source))],
  };
}

/** What Borgo keeps about the people who use it, which is almost nothing: one page for people and for app directories. */
export function privacyPage(site: Site): Page {
  const path = "/privacy/";
  const items: [string, string][] = [
    ["No accounts, no tracking", "Borgo has no sign-in, sets no cookies and runs no analytics or advertising scripts. It does not keep request logs."],
    ["The website", "Your cities, priorities, pay and household are worked out in your browser and kept in its local storage, on your device. They are never sent to us. A share link carries your choices after the # sign, a part of the address browsers do not send to any server. Adding a place Borgo does not hold asks open-data services (such as Open-Meteo and the World Bank) for its figures straight from your browser, sending the place's name or coordinates."],
    ["Assistants (the MCP server)", "When an assistant such as Claude or ChatGPT uses Borgo at borgo.abcastor.com/mcp, what it sends (city names, and pay or household if you gave them) is used to work out that one answer and is not stored. Borgo counts, per day, how many times each tool was called and whether it failed; nothing else about the call is written. Your network address is used only to limit how many requests arrive in a minute, and is not stored."],
    ["Figures you send", "If you send a figure of your own (a rent, a price), Borgo keeps the place, the figure, the amount, its currency, the day, how it was sent and a hash of a removal code that lets you delete it. To limit sending, it keeps that day's salted hash of your network address, deleted after a day. Sent figures are published as open data under CC BY 4.0."],
    ["On your own computer", "The command-line tool and the local MCP server run on your machine and send nothing to us. They read public data files and, when asked, the same open-data services."],
    ["Sharing", "Borgo sells nothing and shares nothing about you. The only other parties are the host, below, and the open-data services your browser asks directly when you add a new place."],
    ["How long it is kept", "Daily tool counts are kept as totals. A figure you send stays until you remove it with its code, or until it is withdrawn in review. The network hash for limiting is deleted after a day. Nothing else is kept, so there is nothing else to delete."],
    ["Hosting", "The site runs on Cloudflare, which handles every request to deliver it, under Cloudflare's own privacy policy."],
    ["Questions", "Ask on GitHub, where Borgo's code and data are public."],
  ];
  const body = html`<article class="doc static-doc">
    <h1>Privacy</h1>
    <p class="lede">Borgo keeps nothing about you. It needs no account, and what you tell it stays in your browser.</p>
    ${items.map(([h, p]) => html`<h2>${h}</h2><p>${h === "Questions" ? html`Ask on <a href="${REPO}/issues/new" rel="noopener">GitHub</a>, where Borgo's code and data are public.` : p}</p>`)}
  </article>`;
  return {
    path,
    title: `Privacy | ${site.name}`,
    description: clip("Borgo keeps nothing about you: no account, no cookies, no analytics. Your choices stay in your browser; the assistant server stores only daily counts of tool calls."),
    section: null,
    body,
    markdown: ["# Privacy", "", "Borgo keeps nothing about you. It needs no account, and what you tell it stays in your browser.", "", ...items.flatMap(([h, p]) => [`## ${h}`, "", h === "Questions" ? `Ask on GitHub: ${REPO}/issues/new` : p, ""])].join("\n"),
    jsonld: [{ "@context": "https://schema.org", "@type": "WebPage", "@id": abs(site, path), url: abs(site, path), name: "Privacy", isPartOf: { "@id": `${site.origin}/#website` } }],
  };
}

/** The published files that hold figures, with their terms: dataset.json and the parts beside it. */
function partsList(data: Dataset) {
  const used = new Set((manifestOf(data)?.sources ?? []).filter((s) => s.observations > 0).map((s) => s.part));
  return Object.values(PARTS).filter((p) => p.id === "open" || used.has(p.id));
}

/** The whole compiled dataset, for Google Dataset Search and anyone citing it. */
export function mainDataset(site: Site, data: Dataset, sources: SourceRef[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${abs(site, "/sources/")}#dataset`,
    name: `${site.name}: open figures for ${data.cities.length} cities`,
    description: `Take-home pay models, rent, climate (monthly temperatures and wet days), air quality, safety, life expectancy, price levels and free-movement rights for ${data.cities.length} cities, compiled from open sources with each figure's source, period, geographic level and licence.`,
    url: abs(site, "/sources/"),
    license: site.dataLicence.url,
    creator: site.creator,
    isAccessibleForFree: true,
    dateModified: site.version,
    keywords: ["cost of living", "take-home pay", "climate", "air quality", "where to live", "city comparison", "open data", "Borgo"],
    spatialCoverage: data.cities.map((c) => ({ "@type": "City", name: c.name })),
    variableMeasured: Object.values(data.metrics).map((m) => ({ "@type": "PropertyValue", name: m.label, unitText: m.unit, description: m.description })),
    isBasedOn: sources.filter((s) => s.url).map((s) => ({ "@type": "CreativeWork", name: s.name, url: s.url, license: s.licenceUrl ?? s.licence })),
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs(site, "/data/dataset.json") },
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs(site, "/api/cities.json") },
    ],
  };
}

/** What the app's own page says to crawlers: the site, the app, the dataset. */
export function homeJsonLd(site: Site, data: Dataset): object[] {
  return [
    { "@context": "https://schema.org", "@type": "WebSite", "@id": `${site.origin}/#website`, url: `${site.origin}/`, name: site.name, inLanguage: "en", publisher: site.creator },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "@id": `${site.origin}/#app`,
      name: site.name,
      url: `${site.origin}/`,
      applicationCategory: "ReferenceApplication",
      operatingSystem: "Any (web browser)",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: `Compare any of ${data.cities.length} cities on open, sourced data, weighted by what you value: take-home pay after tax, what is left after rent and spending, who in your household can move there without a visa, climate, air, safety and research.`,
      creator: site.creator,
    },
  ];
}

function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

