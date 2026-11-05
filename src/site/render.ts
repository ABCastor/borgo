// The published pages: HTML for people and crawlers, a markdown twin for agents (llms.txt v2), and the
// schema.org JSON-LD that describes them. Everything is built from src/site/facts.ts; nothing here computes.
import type { Dataset, Profile } from "../core/types.ts";
import { DEFAULT_COMFORT } from "../core/criteria.ts";
import { climateChart as sharedChart } from "../ui/climate-chart.ts";
import { html, raw, type Raw } from "../ui/dom.ts";
import { money, num } from "../ui/format.ts";
import { creditsFor, manifestOf, PARTS, type ManifestEntry } from "../registry/licences.ts";
import { countryLabel, hoursText, inSentence, levelText, referenceProfile, type CityFacts, type Climate, type CompareFacts, type Figure, type SourceRef } from "./facts.ts";

export interface Site {
  origin: string;
  name: string;
  creator: Record<string, string>;
  dataLicence: { id: string; url: string };
  /** The dataset version (its build date): every page says how fresh its numbers are. */
  version: string;
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
<link rel="preload" href="${root}fonts/archivo-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${root}app.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body class="static">
<div class="site">
${header}
<main class="page">${page.body.value}</main>
${siteFoot(site, root).value}
</div>
</body>
</html>
`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]!);

export function siteFoot(site: Site, root: string): Raw {
  return html`<footer class="site-foot"><p>Open data, open code. Figures as of ${site.version}; each page names its sources and licences. <a href="${root}cities/">All cities</a> · <a href="${root}compare/">All comparisons</a> · <a href="${root}sources/">Sources and method</a> · <a href="${root}llms.txt">For AI agents</a> · <a href="${root}api/index.json">API</a></p></footer>`;
}

// ---------- Pieces shared by the pages ----------

function srcLinks(sources: SourceRef[]): Raw {
  return html`${sources.map((s, i) => html`${i ? "; " : ""}${s.url ? html`<a href="${s.url}" rel="noopener">${s.name}</a>` : s.name}`)}`;
}

function licenceLinks(sources: SourceRef[]): Raw {
  const uniq = [...new Map(sources.map((s) => [s.licence, s])).values()];
  return html`${uniq.map((s, i) => html`${i ? ", " : ""}${s.licenceUrl ? html`<a href="${s.licenceUrl}" rel="noopener license">${s.licence}</a>` : s.licence}`)}`;
}

function figureRow(f: Figure, country: string): Raw {
  return html`<tr>
    <th scope="row">${f.label}<span class="fig-v num">${f.text}${f.method === "median" && f.range ? html` <span class="quiet">(range ${num(f.range[0], 0)} to ${num(f.range[1], 0)})</span>` : ""}</span></th>
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
    ${row("Rent, one bedroom", b.rent === null ? null : -b.rent, b.rentFigure ? html`${srcLinks(b.rentFigure.sources)}, ${b.rentFigure.period}, ${levelText(b.rentFigure.level, "country")}` : "no open rent data yet: add your own in the app")}
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
  L.push(`- Take-home pay: ${m(b.net === null ? null : b.net / 12)}`, `- Rent: ${m(b.rent)}${b.rentFigure ? ` (${b.rentFigure.sources.map((s) => s.name).join(", ")}, ${b.rentFigure.period})` : " (no open rent data yet)"}`, `- Everyday spending: ${m(b.everyday)}`, ...(b.childcare !== null ? [`- Childcare: ${m(b.childcare)}`] : []), ...(b.health !== null ? [`- Health care, out of pocket: ${m(b.health)}`] : []), `- Left each month: ${m(b.left)}${b.left !== null && b.completeness.status === "partial" ? ` (partial: leaves out ${b.completeness.missing.join(", ")})` : ""}`, "");
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
    L.push(`| ${x.label} | ${x.text}${x.method === "median" ? ` (median of ${x.sources.length})` : ""} | ${x.period} | ${levelText(x.level, country.name)} | ${x.sources.map((s) => `[${s.name}](${s.url})`).join("; ")} | ${[...new Set(x.sources.map((s) => s.licence))].join(", ")} |`);
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
  return [page, place, dataset];
}

// ---------- Comparison page ----------

export function comparePage(site: Site, data: Dataset, c: CompareFacts): Page {
  const A = c.a.city;
  const B = c.b.city;
  const root = toRoot(c.path);
  const [ra, rb] = c.results;
  const gross = ra.money.gross;
  const lead = c.winner
    ? `On balanced weights, ${c.winner.name} comes out ahead: ${Math.round(c.winner.id === A.id ? ra.total : rb.total)} against ${Math.round(c.winner.id === A.id ? rb.total : ra.total)} out of 100${c.drivers.length ? `, mostly on ${c.drivers.filter((d) => d.leader.id === c.winner!.id).map((d) => d.label.toLowerCase()).slice(0, 2).join(" and ") || "small margins"}` : ""}.`
    : `On balanced weights, ${A.name} and ${B.name} are too close to call: ${Math.round(ra.total)} and ${Math.round(rb.total)} out of 100.`;
  const title = `${A.name} vs ${B.name}: take-home pay, cost of living and climate compared | ${site.name}`;
  const description = clip(`${A.name} or ${B.name}? ${lead} Every figure from open data, with its source.`);
  const cov = (r: typeof ra) => Math.round(r.coverage * 100);
  const cell = (s: CompareFacts["lines"][number]["a"]) =>
    html`<td><span class="num">${s.text}</span>${s.sources.length ? html`<small>${srcLinks(s.sources)}${s.level === "country" ? html` <span class="quiet">(country)</span>` : ""}</small>` : ""}</td>`;
  const body = html`<article class="doc static-doc">
    <h1>${A.name} vs ${B.name}</h1>
    <p class="lede">${lead} Your own weights, salary and household can change the answer; every figure below names its source.</p>
    ${makeIt(root, c.appParam, `Make it yours: compare ${A.name} and ${B.name} with your own numbers`)}

    <h2>The verdict on default settings</h2>
    <div class="duel">
      ${[ra, rb].map((r) => html`<div class="duel-side"><a class="duel-city" href="${root}${`city/${r.city.id}/`}">${r.city.name}</a><span class="duel-score num">${Math.round(r.total)}<small>/100</small></span><span class="hint">${cov(r)}% of the weight rests on real data for this city</span></div>`)}
    </div>
    ${c.drivers.length ? html`<p>The lines that move the score most: ${c.drivers.map((d, i) => html`${i ? "; " : ""}${d.label.toLowerCase()} (${d.leader.name}, +${num(d.points, 1)} points)`)}.</p>` : ""}
    <p class="hint">Balanced weights are the app's starting point, not a judgement: weights are set by you. Where a city lacks a figure, it gets the average score of the two on that line, so missing data neither helps nor hurts.</p>

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
      ? html`<h2>Climate month by month</h2>
        <table class="doc-table clim-table"><thead><tr><th>Month</th><th class="num">${A.name}</th><th class="num">${B.name}</th></tr></thead><tbody>
          ${c.a.climate.high.map((h, i) => html`<tr><th scope="row">${MONTHS[i]}</th><td class="num">${num(c.a.climate!.low[i]!, 0)} to ${num(h, 0)} °C</td><td class="num">${num(c.b.climate!.low[i]!, 0)} to ${num(c.b.climate!.high[i]!, 0)} °C</td></tr>`)}
        </tbody></table>
        <p class="hint">Air temperature in the shade, average daily low to high (${c.a.climate.source.name}, ${c.a.climate.period}).</p>`
      : ""}

    <h2>Questions this page answers</h2>
    <div class="qa">${c.qa.map((x) => html`<h3>${x.q}</h3><p>${x.a}</p>`)}</div>

    <h2>More</h2>
    <ul class="plain"><li><a href="${root}city/${A.id}/">Living in ${A.name}: every figure</a></li><li><a href="${root}city/${B.id}/">Living in ${B.name}: every figure</a></li><li><a href="${root}compare/">Every comparison</a></li></ul>

    <h2>Cite this page</h2>
    <p class="cite">${site.name}, “${A.name} vs ${B.name}”, ${abs(site, c.path)}, figures as of ${site.version}, reference profile. Name the original source of any figure you quote.</p>
  </article>`;
  return { path: c.path, title: title.length > 90 ? `${A.name} vs ${B.name}: pay, costs, climate | ${site.name}` : title, description, section: "compare", body, markdown: compareMarkdown(site, data, c, lead), jsonld: compareJsonLd(site, c) };
}

function compareMarkdown(site: Site, data: Dataset, c: CompareFacts, lead: string): string {
  const A = c.a.city.name;
  const B = c.b.city.name;
  const [ra, rb] = c.results;
  const L = [`# ${A} vs ${B}`, "", `> ${lead} Reference profile: ${assumptionsText(data, c.profile)}, balanced weights. Figures as of ${site.version}. Canonical page: ${abs(site, c.path)}`, ""];
  L.push(`Scores out of 100: ${A} ${Math.round(ra.total)}, ${B} ${Math.round(rb.total)}. Make it yours: ${abs(site, `/?${c.appParam}`)}`, "");
  L.push("## Line by line", "", `| Line | ${A} | ${B} |`, "|---|---|---|");
  const cell = (s: CompareFacts["lines"][number]["a"]) => `${s.text}${s.sources.length ? ` (${s.sources.map((x) => x.name).join("; ")})` : ""}`;
  for (const l of c.lines.filter((x) => x.id !== "right_to_live")) L.push(`| ${l.label} | ${cell(l.a)} | ${cell(l.b)} |`);
  L.push("", "## Questions", "");
  for (const x of c.qa) L.push(`### ${x.q}`, "", x.a, "");
  L.push("## Cite", "", `${site.name}, "${A} vs ${B}", ${abs(site, c.path)}, figures as of ${site.version}.`, "");
  return L.join("\n");
}

function compareJsonLd(site: Site, c: CompareFacts): object[] {
  const url = abs(site, c.path);
  const page = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": url,
    url,
    name: `${c.a.city.name} vs ${c.b.city.name}`,
    dateModified: site.version,
    about: [c.a, c.b].map((f) => ({ "@id": `${abs(site, f.path)}#place` })),
    isPartOf: { "@id": `${site.origin}/#website` },
  };
  const places = [c.a, c.b].map((f) => ({ "@context": "https://schema.org", "@type": "City", "@id": `${abs(site, f.path)}#place`, name: f.city.name, url: abs(site, f.path) }));
  const out: object[] = [page, ...places];
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
  const byFirst = groupBy(
    pairs.map(([a, b]) => ({ a, b })),
    (p) => name(p.a),
  );
  const body = html`<article class="doc static-doc">
    <h1>Every comparison</h1>
    <p class="lede">${pairs.length} pairs of cities people weigh against each other: same-country pairs, near neighbours, and cities of a similar size. Any other pair, or more than two cities, opens in <a href="../">the app</a>.</p>
    ${byFirst.map(([first, list]) => html`<h2>${first}</h2><ul class="pairs">${list.map((p) => html`<li><a href="${p.a < p.b ? `${p.a}-vs-${p.b}` : `${p.b}-vs-${p.a}`}/">${name(p.a)} vs ${name(p.b)}</a></li>`)}</ul>`)}
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
    <h2>Licences and attribution</h2>
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

/** The app page's footer: links every crawler and person can follow to the static pages. */
export function homeFooter(site: Site, all: CityFacts[]): Raw {
  const list = [...all].sort((a, b) => a.city.name.localeCompare(b.city.name));
  return html`<footer class="site-foot"><p>Every city has its own page of sourced figures: ${list.map((f, i) => html`${i ? ", " : ""}<a href="${f.path.slice(1)}">${f.city.name}</a>`)}. See also <a href="compare/">every comparison</a>, <a href="sources/">sources and method</a>, and <a href="llms.txt">the guide for AI agents</a>. Figures as of ${site.version}.</p></footer>`;
}

function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

