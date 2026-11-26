// The MCP App view's program: runs in the host's sandboxed iframe in one script with src/agent/chart.ts, share-link.ts
// and src/mcp/view-draw.ts (src/mcp/chart-source.ts strips the types and the imports of one another, and the npm build
// compiles the same text ahead). It draws whichever piece of the site the answer calls for: a ranking as bars, the
// world map or month strips; a comparison as standings with each city's wins and losses, the points of every line and
// its weight, the money waterfall, the year's weather and the map; one city's dossier; take-home pay.
//
// It speaks JSON-RPC to the host over postMessage (the MCP Apps protocol, extension io.modelcontextprotocol/ui), ships no
// SDK and makes no network request; its fonts are bytes in the script, read by FontFace, so even a host's default CSP
// (font-src 'self') keeps them. Everything beyond drawing is offered only when the host's ui/initialize answer lists it:
// calling tools (serverTools), opening links (openLinks), writing a message into the chat (message), telling the model
// what the person sees (updateModelContext), full screen (availableDisplayModes). A host that lists none of them gets the
// same pieces with no controls.
import { esc, money } from "../agent/chart.ts";
import { BORGO_ORIGIN, shareLink } from "../agent/share-link.ts";
import {
  CHEVRON, climateChart, comfortOf, comparison, coverageText, figureText, fmt, fold, joinNames, landPaths, lineName, monthStrip, moneyLines, nextComfort, niceEditor,
  mapWindow, placeLabels, ramp, rangeButton, rangeLabel, sharedSource, sourcesList, sourceText, stretch, stretchSpan, testsShort, toX, toY, unpackLand, waterfall, winsLosses, winsLossesHtml,
  type Comfort, type ComfortChange, type Comparison, type Land, type PackedMap,
} from "./view-draw.ts";

export {};

interface Measure { key: string; group: string; label: string; arg: Record<string, unknown>; order: "asc" | "desc"; needs: string[]; months: boolean }
declare const BORGO: { protocol: string; version: string; measures: Measure[]; regions: { id: string; label: string }[]; limits: number[]; cardMetrics: string[]; climateMetrics: string[] };
declare const BORGO_MAP: PackedMap;
declare const BORGO_FONTS: Record<string, string>;

type Json = any;

// ---------- The site's fonts, from bytes ----------
const faces = ([["Bib", "bib600", "600"], ["Bib", "bib700", "700"], ["UI", "ui", "400 700"]] as const).flatMap(([family, key, weight]) => {
  try {
    const bin = atob(BORGO_FONTS[key] ?? "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const face = new FontFace(family, bytes, { weight, style: "normal" });
    (document.fonts as Json).add(face);
    return [face.load()];
  } catch {
    return [];
  }
});

// ---------- The wire: JSON-RPC over postMessage ----------
const host = window.parent;
let nextId = 1;
const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
const send = (msg: Record<string, unknown>) => host.postMessage({ jsonrpc: "2.0", ...msg }, "*");
const notify = (method: string, params: unknown) => send({ method, params });
function request(method: string, params: unknown, ms = 60_000): Promise<Json> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The chat did not answer.")); }, ms);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    send({ id, method, params });
  });
}

// ---------- What the host offers, read once from ui/initialize and kept current ----------
let caps: Json = {};
let ctx: Json = {};
const has = (v: unknown) => v !== undefined && v !== null && v !== false;
/** A capability that lists the kinds of content it takes must list this one; a bare {} takes anything. */
const takes = (c: Json, kind: string) => has(c) && (typeof c !== "object" || Object.keys(c).length === 0 || has(c[kind]));
const can = {
  tools: () => has(caps.serverTools),
  link: () => has(caps.openLinks),
  message: () => takes(caps.message, "text"),
  context: () => takes(caps.updateModelContext, "text") || takes(caps.updateModelContext, "structuredContent"),
  fullscreen: () => Array.isArray(ctx.availableDisplayModes) && ctx.availableDisplayModes.includes("fullscreen"),
};

// ---------- State ----------
type Kind = "ranking" | "compare" | "city" | "pay";
type Tab = "scores" | "money" | "weather" | "map";
const app = document.getElementById("app")!;
const S: Json = {
  kind: null as Kind | null,
  report: null, query: null, share: null, input: null, cmp: null as Comparison | null,
  selected: [] as string[], known: new Map<string, { name: string; country: string }>(),
  detail: null, busy: false, status: "", seq: 0, focus: undefined,
  weights: {} as Record<string, number>, baseWeights: {} as Record<string, number>, lines: [] as { id: string; label: string }[],
  mode: "inline", own: [] as string[], sentContext: "",
  comfort: null as Comfort | null, niceOpen: false, tab: "scores" as Tab, extra: {} as Record<string, Json>, why: new Set<string>(), folds: new Set<string>(),
};
const number = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const interactive = () => can.tools() || can.message() || can.link();
const canSelect = () => can.message() || can.link();
const requerying = () => can.tools() && !!S.query;
const nameOf = (id: string) => S.known.get(id)?.name ?? id;
const narrow = () => document.documentElement.clientWidth < 520;
const statusLine = () => `<p class="status" role="status" aria-live="polite" data-k="status">${esc(S.status)}</p>`;

// ---------- The definition of a nice day: where it counts, and who may change it ----------
const measureKey = (q: Json): string => (q?.score ? "score" : q?.criterion ? "criterion:" + q.criterion : q?.metric ? "metric:" + q.metric : "");
const satisfied = (q: Json, needs: string[]) => needs.every((n) => n === "salary" ? number(q?.salary?.amount) > 0 || Object.keys(q?.salaryByCity ?? {}).length > 0 : n === "spending" ? !!q?.spending : n === "home" ? !!q?.spending?.homeCity : n === "household" ? (q?.household ?? []).length > 0 : n === "work" ? !!q?.work : true);
/** The answer itself depends on the definition: asking again with a new one changes it. */
function niceCounts(): boolean {
  if (S.kind === "ranking") return S.report?.measure?.criterion === "nice_days" || (S.report?.measure?.score && number(S.share?.weights?.nice_days) > 0);
  if (S.kind === "compare") return !!S.cmp?.lines.some((l: Json) => l.id === "nice_days");
  return false;
}
/** Where the range button shows: wherever the answer counts nice days or draws the land by them. */
/** The land is coloured by the nice-day months only where the answer is about the weather; elsewhere it stays plain, so one map never mixes two measures. */
const landByWeather = () => S.kind === "city" || niceCounts() || (S.kind === "compare" && S.tab === "weather");
const niceShown = () => S.kind === "city" || niceCounts() || (S.kind === "compare" && S.tab === "weather");
const niceEditable = () => interactive() && (S.kind === "city" || (niceShown() && (!niceCounts() || requerying())));

function niceRow(): string {
  if (!niceShown() || !S.comfort) return "";
  const c: Comfort = S.comfort;
  const edit = niceEditable();
  const tests = niceCounts();
  return `<p class="vnice"><span class="quiet">A nice day:</span> ${edit ? rangeButton(c, S.niceOpen) : `<b>${esc(rangeLabel(c))}</b>`}${tests ? ` <span class="quiet">${esc(testsShort(c))}</span>` : ""}</p>` +
    (edit && S.niceOpen ? niceEditor(c, { tests, note: tests ? undefined : S.kind === "city" ? "The chart follows the range here; rain, sky and wind count where cities are ranked." : "The land follows the range: its months whose afternoon high sits in it." }) : "");
}

// ---------- Ranking ----------
function controlsHtml(r: Json): string {
  const fs = r.view === "world" && can.fullscreen();
  if (!requerying() && !fs) return "";
  let html = '<div class="vctl" role="group" aria-label="Change this chart">';
  if (requerying()) {
    const q = S.query;
    const current = measureKey(q);
    const groups = [...new Set(BORGO.measures.map((m) => m.group))];
    const known = BORGO.measures.some((m) => m.key === current);
    const options = (known ? "" : '<option value="current" selected>' + esc("Now: " + r.label) + "</option>") + groups.map((g) => {
      const items = BORGO.measures.filter((m) => m.group === g && (m.key === current || satisfied(q, m.needs)));
      return items.length ? '<optgroup label="' + esc(g) + '">' + items.map((m) => '<option value="' + esc(m.key) + '"' + (m.key === current ? " selected" : "") + ">" + esc(m.label) + "</option>").join("") + "</optgroup>" : "";
    }).join("");
    const region = q.filters?.region ?? "";
    const limit = q.limit ?? 20;
    const limits = [...new Set([...BORGO.limits, limit])].sort((a, b) => a - b);
    const hasMonths = (r.rows ?? []).some((x: Json) => Array.isArray(x.months) && x.months.length === 12);
    html += pick("Rank by", "measure", options) +
      pick("Order", "order", `<option value="desc"${r.order === "desc" ? " selected" : ""}>Highest first</option><option value="asc"${r.order === "asc" ? " selected" : ""}>Lowest first</option>`) +
      pick("Region", "region", '<option value="">Everywhere</option>' + BORGO.regions.map((x) => `<option value="${esc(x.id)}"${x.id === region ? " selected" : ""}>${esc(x.label)}</option>`).join("")) +
      pick("Show", "limit", limits.map((n) => `<option value="${n}"${n === limit ? " selected" : ""}>${n} cities</option>`).join(""));
    const views: [string, string][] = [["ranked", "Bars"], ["world", "Map"], ...(hasMonths || r.view === "months" ? [["months", "Months"] as [string, string]] : [])];
    html += `<span class="seg" role="radiogroup" aria-label="Show as">${views.map(([v, l]) => `<button type="button" role="radio" aria-checked="${r.view === v}" data-act="view" data-view="${v}" data-k="view:${v}">${l}</button>`).join("")}</span>`;
  }
  if (fs) html += fullscreenButton();
  return html + "</div>";
}
const pick = (label: string, id: string, options: string) => `<span class="pick"><label class="sr" for="ctl-${id}">${esc(label)}</label><select id="ctl-${id}" data-ctl="${id}" data-k="ctl:${id}">${options}</select></span>`;
const fullscreenButton = () => `<button type="button" class="pill-btn" data-act="fullscreen" data-k="act:fullscreen" aria-pressed="${S.mode === "fullscreen"}">${S.mode === "fullscreen" ? "Exit full screen" : "Full screen"}</button>`;

/** A row's name as the thing to press: it opens the city's card. */
const cityRow = (row: Json, inner: string) => interactive() ? `<button type="button" class="mr-go city-btn" data-open="${esc(row.id)}" data-k="open:${esc(row.id)}" aria-haspopup="dialog">${inner}</button>` : `<div class="mr-go">${inner}</div>`;
const tick = (row: Json) => canSelect() ? `<label class="vtick"><input type="checkbox" data-pick="${esc(row.id)}" data-k="pick:${esc(row.id)}"${S.selected.includes(row.id) ? " checked" : ""} aria-label="Select ${esc(row.name)}"></label>` : "";

function rankingHtml(r: Json): string {
  const rows: Json[] = r.rows;
  const shared = sharedSource(rows);
  const metric = !!r.measure?.metric;
  let piece = "";
  if (!rows.length) piece = "<p>No known cities have this figure and pass these filters.</p>";
  else if (r.view === "world") piece = mapHtml(rows.map((row) => ({ id: row.id, name: row.name, rank: row.rank, value: row.value, unit: row.unit, point: row.point, cite: shared ? "" : sourceText(row) })), r.order, r.label);
  else if (r.view === "months") {
    const nice = r.measure?.criterion === "nice_days";
    const top = nice ? 31 : Math.max(1, ...rows.flatMap((x) => x.months ?? []).map((x: unknown) => Math.abs(number(x))));
    piece = `<div class="vmonths">${rows.map((row) => `<div class="vm-row${S.selected.includes(row.id) ? " is-on" : ""}"><div class="vm-name">${cityRow(row, `<b class="mr-n">${row.rank}</b><span class="mr-name">${esc(row.name)}</span>`)}<span class="vm-total">${tick(row)}<b>${esc(figureText(row.value, row.unit).big)}</b> ${esc(figureText(row.value, row.unit).small)}</span></div>` +
      (row.months?.length === 12 ? monthStrip(row.months, { name: row.name, what: r.label, top, teal: !nice }) : '<p class="quiet">Monthly figures unavailable</p>') + cardHtml(row.id) + "</div>").join("")}</div>`;
  } else {
    const max = Math.max(1e-9, ...rows.map((x) => Math.abs(number(x.value))));
    piece = `<ol class="mrank vrows${metric ? " vbar-teal" : ""}">${rows.map((row) => {
      const f = figureText(row.value, row.unit);
      return `<li class="${S.selected.includes(row.id) ? "is-on" : ""}">${tick(row)}${cityRow(row, `<b class="mr-n">${row.rank}</b><span class="mr-name">${esc(row.name)}</span><span class="mr-v"><b>${esc(f.big)}</b> ${esc(f.small)}</span><span class="mr-bar rank-bar-track"><i class="rank-bar" style="width:${(Math.abs(number(row.value)) / max * 100).toFixed(1)}%"></i></span>${shared ? "" : `<span class="mr-cite">${esc(sourceText(row))}</span>`}`)}${cardHtml(row.id)}</li>`;
    }).join("")}</ol>`;
  }
  const c = r.coverage;
  const region = S.query?.filters?.region ? BORGO.regions.find((x) => x.id === S.query.filters.region)?.label : "";
  const sub = `Top ${c.returned} of ${c.matched} known cities${region ? " in " + region : ""} · ${r.order === "asc" ? "lowest" : "highest"} first`;
  const table = `<div class="tscroll"><table class="vt rank-table"><caption class="sr">${esc(r.label)}</caption><thead><tr><th class="n">#</th><th>City</th><th class="n">Value</th><th>Unit</th><th>Source and period</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="n">${row.rank}</td><td>${esc(row.name)}</td><td class="n">${fmt(row.value)}</td><td>${esc(row.unit)}</td><td>${esc(sourceText(row))}</td></tr>`).join("")}</tbody></table></div>`;
  const notes = [...(r.notes ?? []), ...rows.flatMap((row) => (row.notes ?? []).map((n: string) => row.name + ": " + n))];
  const open = can.link() && rows.length && S.share && !S.selected.length ? '<button type="button" class="ink-btn" data-act="open-shown" data-k="act:open-shown">Open these cities in Borgo</button>' : !can.link() && /^https:\/\/borgo\.abcastor\.com\//.test(r.link) ? `<a class="vlink" href="${esc(r.link)}" target="_blank" rel="noreferrer" data-borgo-link="1">Open these cities in Borgo</a>` : "";
  return `<section class="sheet vsheet"><header class="vhead"><h2 class="vtitle">${esc(r.label)}</h2><p class="vsub">${esc(sub)}</p></header>` + niceRow() + controlsHtml(r) + statusLine() + piece +
    (shared ? `<p class="vsrc">Source: <b>${esc(shared)}</b></p>` : "") + selectionHtml() +
    `<div class="vfoot">${open}<span class="quiet">Dataset ${esc(r.dataset?.version ?? "")}</span></div>` +
    fold("Sources and calculations", `<p>${esc(coverageText(c))}</p>${table}<h3>Sources</h3>${sourcesList(rows.flatMap((row) => row.sources ?? []))}${notes.length ? `<h3>Notes</h3><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`, "sources") + "</section>";
}

/** Rows picked for a comparison or for the site, with what to do with them. */
function selectionHtml(): string {
  const ids: string[] = S.selected;
  if (!ids.length || !canSelect()) return "";
  return `<div class="selection" role="group" aria-label="Selected cities"><p><b>${ids.length} selected</b> ${esc(joinNames(ids.map(nameOf)))}</p>` +
    (can.message() ? (ids.length >= 2 ? '<button type="button" class="ink-btn" data-act="compare-chat" data-k="act:compare-chat">Compare in chat</button>' : '<span class="hint">Pick two or more to compare them in chat.</span>') : "") +
    (can.link() && S.share ? `<button type="button" class="pill-btn" data-act="open-selected" data-k="act:open-selected">Open ${ids.length === 1 ? "this" : "these"} in Borgo</button>` : "") +
    '<button type="button" class="pill-btn" data-act="clear" data-k="act:clear">Clear</button></div>';
}

// ---------- The world map ----------
let land: Land | null = null;
let landCache = { key: "", svg: "" };
let plainCache = "";
/** The land with no measure on it: one path in the site's plain land colour. */
function plainLand(): string {
  land ??= unpackLand(BORGO_MAP);
  if (!plainCache) plainCache = `<path d="${landPaths(BORGO_MAP, land, comfortOf(null, null)).map((p) => p.d).join("")}" style="fill:var(--map-land)"/>`;
  return plainCache;
}
function landSvg(c: Comfort): string {
  land ??= unpackLand(BORGO_MAP);
  const key = c.min + ":" + c.max;
  if (landCache.key !== key) landCache = { key, svg: landPaths(BORGO_MAP, land, c).map((p) => `<path d="${p.d}" style="fill:${p.fill}"><title>${p.months} of 12 months in the range</title></path>`).join("") };
  return landCache.svg;
}

interface Dot { id: string; name: string; rank: number; value: number | null; unit: string; point: number[] | null; cite: string; text?: string }
function mapHtml(dots: Dot[], order: "asc" | "desc", label: string): string {
  land ??= unpackLand(BORGO_MAP);
  const c: Comfort = S.comfort ?? comfortOf(null, null);
  const weather = landByWeather();
  const located = dots.filter((d) => Array.isArray(d.point));
  const vb = mapWindow(land.box, located.map((d) => [toX(number(d.point![0])), toY(number(d.point![1]))]));
  // Dots, rings and labels keep their size on screen however far the window zooms in.
  const k = vb[2] / (land.box[2] - land.box[0] + 8);
  const values = dots.map((d) => d.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const span = stretchSpan(values) ?? [0, 1];
  const act = interactive();
  const shade = (v: number | null) => (v === null || !Number.isFinite(v) ? null : order === "asc" ? 1 - stretch(v, span) : stretch(v, span));
  const circles = located.slice().reverse().map((d) => {
    const x = toX(number(d.point![0])), y = toY(number(d.point![1]));
    const on = S.selected.includes(d.id);
    const t = shade(d.value);
    const text = d.text ?? (d.value === null ? "no figure" : `${figureText(d.value, d.unit).big} ${figureText(d.value, d.unit).small}`.trim());
    const said = `${d.rank}. ${d.name}: ${text}${d.cite ? ". " + d.cite : ""}`;
    return (on ? `<circle class="ring" cx="${x}" cy="${y}" r="${(8.5 * k).toFixed(2)}" vector-effect="non-scaling-stroke"/>` : "") +
      `<circle class="dot city-dot${t === null ? " is-none" : ""}${on ? " on" : ""}" cx="${x}" cy="${y}" r="${((on ? 6 : 5) * k).toFixed(2)}" vector-effect="non-scaling-stroke"${t === null ? "" : ` style="fill:${ramp(t)}"`} data-x="${x}" data-y="${y}" data-label="${esc(d.rank + "  " + d.name)}" data-id="${esc(d.id)}"` +
      (act ? ` tabindex="0" role="button" aria-label="${esc(said + ". Show details")}" data-open="${esc(d.id)}" data-k="dot:${esc(d.id)}"` : "") + `><title>${esc(said)}</title></circle>`;
  }).join("");
  const lo = values.length ? Math.min(...values) : null, hi = values.length ? Math.max(...values) : null;
  const end = (v: number | null) => (v === null ? "–" : figureText(v, dots[0]?.unit ?? "").big);
  const best = order === "asc" ? [hi, lo] : [lo, hi];
  return `<div class="vmap"><svg class="world-view" viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" role="${act ? "group" : "img"}" aria-label="${esc(label)}: the cities shown, on the Equal Earth world map${weather ? "; the land by the months in the nice-day range" : ""}" data-vb="${vb.join(" ")}">` +
    `<g class="land">${weather ? landSvg(c) : plainLand()}</g><g class="dots">${circles}</g><g class="lbls" aria-hidden="true"></g></svg></div>` +
    `<div class="vlegend"><div class="mlg-row"><span class="mlg-end">${esc(end(best[0]!))}</span><span class="mlg-ramp is-cities" aria-hidden="true"></span><span class="mlg-end">${esc(end(best[1]!))}</span><span class="mlg-what"><b>Cities:</b> ${esc(lineName(label).toLowerCase())}, greener is better</span></div>` +
    (weather ? `<div class="mlg-row"><span class="mlg-end">0</span><span class="mlg-ramp is-land" aria-hidden="true"></span><span class="mlg-end">12</span><span class="mlg-what"><b>Land:</b> months in the ${c.min}–${c.max} °C range, by each month's average afternoon high</span></div>` : "") + `</div>` +
    `<p class="vsrc">Equal Earth projection. ${esc(BORGO_MAP.source)}. The dots are the cities shown, not every place.</p>` + (S.detail && dots.some((d) => d.id === S.detail.id) ? cardHtml() : "");
}

/** Labels for the dots, once the iframe's width and the fonts are known: the site's collision-aware placement. */
function layoutLabels(): void {
  const measure = document.createElement("canvas").getContext("2d");
  for (const svg of app.querySelectorAll<SVGSVGElement>("svg.world-view")) {
    const vb = (svg.dataset.vb ?? "0 0 720 360").split(" ").map(Number);
    const scale = svg.getBoundingClientRect().width / vb[2]! || 1;
    const px = narrow() ? 11.5 : 12.5;
    if (measure) measure.font = `700 ${px}px Bib, "Barlow Condensed", "Arial Narrow", sans-serif`;
    const dots = [...svg.querySelectorAll<SVGCircleElement>("circle.dot")].reverse();
    const items = dots.map((d) => {
      const text = (d.dataset.label ?? "").toUpperCase();
      const w = ((measure?.measureText(text).width ?? text.length * px * 0.5) + text.length * px * 0.04) / scale;
      return { id: d.dataset.id!, x: Number(d.dataset.x), y: Number(d.dataset.y), gap: Number(d.getAttribute("r")) + 5 / scale, w, h: (px * 1.05) / scale, r: Number(d.getAttribute("r")), text };
    });
    const placed = placeLabels(items, [vb[0]!, vb[1]!, vb[0]! + vb[2]!, vb[1]! + vb[3]!], items.map((d) => ({ x: d.x, y: d.y, r: d.r + 1 / scale })));
    const g = svg.querySelector("g.lbls")!;
    g.innerHTML = placed.map((p) => {
      const it = items.find((x) => x.id === p.id)!;
      const [n, ...rest] = it.text.split("  ");
      return `<text class="lbl" x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" text-anchor="${p.anchor}" dominant-baseline="central" font-size="${(px / scale).toFixed(2)}" stroke-width="${(3.5 / scale).toFixed(2)}"><tspan class="n">${esc(n!)}</tspan> ${esc(rest.join("  "))}</text>`;
    }).join("");
  }
}

// ---------- One city: its card under a row, or its dossier when the answer is the city ----------
const KEY_FIGURES = () => BORGO.cardMetrics;
function figureCells(figures: Json[]): string {
  const key = KEY_FIGURES().map((id) => figures.find((f) => f.metric === id)).filter((f) => f && typeof f.value === "number");
  if (!key.length) return "";
  return `<div class="dcells">${key.map((f: Json) => {
    const t = figureText(f.value, f.unit);
    return `<div class="fig"><p class="lab">${esc(lineName(f.label))}</p><span class="val">${esc(t.big)} <small>${esc(t.small)}</small></span><span class="cite">${esc(f.cite ?? "")}${f.approximate ? " · wider area" : ""}</span></div>`;
  }).join("")}</div>`;
}
function climateOf(figures: Json[], name: string): string {
  const c: Comfort = S.comfort ?? comfortOf(null, null);
  const get = (id: string) => figures.find((f) => f.metric === id && Array.isArray(f.value) && f.value.length === 12);
  const feels = c.basis !== "air" && get("feels_high") && get("feels_low");
  const hi = feels ? get("feels_high") : get("temp_high"), lo = feels ? get("feels_low") : get("temp_low");
  if (!hi || !lo) return "";
  return `<figure class="dclim"><p class="lab">The year, ${feels ? "feels like" : "air"}</p>${climateChart(lo.value, hi.value, c, name, narrow())}<figcaption>Average daily low to high each month over the nice-day range; olive months sit in it. ${esc(hi.cite ?? "")}.</figcaption></figure>`;
}
function cityMoney(id: string): string {
  if (S.kind !== "compare" || !S.cmp) return "";
  const c = S.cmp.cities.find((x: Json) => x.id === id);
  const lines = moneyLines(c?.money);
  return lines.length ? `<div class="dmoney"><p class="lab">Money a month</p>${waterfall(lines, S.cmp.currency, c.name + ": money a month")}</div>` : "";
}
function cityActions(d: Json, card: boolean): string {
  return `<div class="dact">${can.link() && S.share ? `<button type="button" class="ink-btn" data-act="open-site" data-k="act:open-site">Open in Borgo</button>` : ""}` +
    (can.message() ? `<button type="button" class="pill-btn" data-act="ask" data-k="act:ask">Ask about ${esc(d.name)}</button>` : "") +
    (card && canSelect() && S.kind === "ranking" ? `<button type="button" class="pill-btn" data-act="toggle-select" data-k="act:toggle-select" aria-pressed="${S.selected.includes(d.id)}">${S.selected.includes(d.id) ? "Remove from comparison" : "Add to comparison"}</button>` : "") + "</div>";
}

/** A city's card, opened from a row or a dot. */
function cardHtml(id?: string): string {
  const d = S.detail;
  if (!d || (id !== undefined && d.id !== id)) return "";
  const row = d.row;
  const of = S.kind === "ranking" ? S.report.coverage?.returned : S.cmp?.cities.length;
  const meta = [d.country, row?.rank ? `No. ${row.rank} of ${of}` : ""].filter(Boolean).join(" · ");
  const fig = row && row.value !== undefined ? (() => { const t = figureText(row.value, row.unit); return `<p class="dfig"><span class="big">${esc(t.big)} <small>${esc(t.small)}</small></span><span class="src-line">${esc(S.report.label)}${sourceText(row) ? ". " + esc(sourceText(row)) : ""}</span></p>`; })() : "";
  return `<section class="card" tabindex="-1" data-k="card" role="dialog" aria-labelledby="card-title"><div class="dhead"><div><h3 class="dname" id="card-title">${esc(d.name)}</h3>${meta ? `<p class="dmeta">${esc(meta)}</p>` : ""}</div>` +
    `<button type="button" class="chip-x" data-act="close-card" data-k="act:close-card" aria-label="Close ${esc(d.name)} details"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button></div>` + fig +
    (d.status === "loading" ? '<p class="quiet" role="status">Loading figures…</p>' : d.status === "error" ? `<p class="quiet" role="status">${esc(d.error)}</p>` : figureCells(d.figures ?? []) + climateOf(d.figures ?? [], d.name)) +
    cityMoney(d.id) + cityActions(d, true) + "</section>";
}

/** The answer of get_city: the city's dossier, as the site's dossier sheet opens. */
function cityHtml(r: Json): string {
  const c = r.city;
  const figures: Json[] = r.figures ?? [];
  const meta = [r.countryName ?? c.country, c.population ? `${fmt(c.population, 0)} people` : "", r.daylight ? `${fmt(r.daylight.shortest, 1)} to ${fmt(r.daylight.longest, 1)} h of daylight` : ""].filter(Boolean).join(" · ");
  const rights = (r.rights ?? []).length ? `<div class="dmoney"><p class="lab">Who may live and work there</p><ul class="wl-list">${r.rights.map((x: Json) => `<li class="${x.status === "no" ? "fail" : ""}">${esc(x.person)}: ${esc(x.text)}</li>`).join("")}</ul></div>` : "";
  const all = figures.filter((f) => typeof f.value === "number");
  const table = `<div class="tscroll"><table class="vt"><caption class="sr">Every figure for ${esc(c.name)}</caption><thead><tr><th>Figure</th><th class="n">Value</th><th>Source and period</th></tr></thead><tbody>${all.map((f) => `<tr><td>${esc(f.label)}</td><td class="n">${fmt(f.value)} ${esc(f.unit)}</td><td>${esc(f.cite ?? "")}${f.approximate ? " (wider area)" : ""}</td></tr>`).join("")}</tbody></table></div>`;
  const d = { id: c.id, name: c.name };
  return `<section class="sheet vsheet dsheet"><div class="dhead"><div><h2 class="dname">${esc(c.name)}</h2><p class="dmeta">${esc(meta)}</p></div></div>` + niceRow() + statusLine() +
    figureCells(figures) + climateOf(figures, c.name) + rights + (interactive() ? cityActions(d, false) : "") +
    fold("Every figure", `${table}<h3>Sources</h3>${sourcesList(r.sources ?? [])}${r.note ? `<p>${esc(r.note)}</p>` : ""}`, "figures") + "</section>";
}

// ---------- Take-home pay ----------
function payHtml(r: Json): string {
  const cur = r.currency;
  const lines = [{ label: "Gross pay a year", amount: r.gross, kind: "in" as const }, ...(r.lines ?? []).map((l: Json) => ({ label: l.label, amount: -Math.abs(number(l.amount)), kind: "out" as const })), ...(number(r.pension) > 0 ? [{ label: "Pension saving", amount: -number(r.pension), kind: "out" as const }] : []), { label: "Take-home a year", amount: r.net, kind: "sum" as const }];
  const where = r.cityName ?? r.countryName ?? r.country;
  return `<section class="sheet vsheet"><header class="vhead"><h2 class="vtitle">Take-home pay in ${esc(where)}</h2><p class="vsub">${esc(money(r.gross, cur))} gross a year, ${esc(String(r.year))} rules · ${fmt(number(r.effectiveRate) * 100, 1)}% in tax and contributions · ${esc(money(number(r.monthlyNet), cur))} a month</p></header>` +
    `<div class="vpay">${waterfall(lines, cur, "Take-home pay")}</div>` +
    fold("Sources and calculations", `<p>${esc(r.scope ?? "")}</p>${(r.caveats ?? []).length ? `<ul>${r.caveats.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}<h3>Sources</h3>${sourcesList(r.sources ?? [])}`, "sources") + "</section>";
}

// ---------- A comparison ----------
function compareHtml(): string {
  const cmp: Comparison = S.cmp;
  const names = cmp.cities.map((c) => c.name);
  const hasMoney = cmp.cities.some((c) => moneyLines(c.money).length > 0);
  // A host that offers nothing gets no controls at all: the scores and the money, one under the other.
  const tabs: [Tab, string][] = !interactive() ? [] : [["scores", "Scores"], ...(hasMoney ? [["money", "Money"] as [Tab, string]] : []), ...(requerying() ? [["weather", "Weather"], ["map", "Map"]] as [Tab, string][] : [])];
  if (!tabs.some(([t]) => t === S.tab)) S.tab = "scores";
  const seg = tabs.length > 1 ? `<div class="vctl"><span class="seg" role="radiogroup" aria-label="Show">${tabs.map(([t, l]) => `<button type="button" role="radio" aria-checked="${S.tab === t}" data-act="tab" data-tab="${t}" data-k="tab:${t}">${l}</button>`).join("")}</span>${S.tab === "map" && can.fullscreen() ? fullscreenButton() : ""}</div>` : "";
  const piece = !tabs.length ? scoresPiece(cmp) + (hasMoney ? `<div class="vlines-h"><p class="sh">Money a month</p></div>` + moneyPiece(cmp) : "") : S.tab === "money" ? moneyPiece(cmp) : S.tab === "weather" ? weatherPiece(cmp) : S.tab === "map" ? comparedMap(cmp) : scoresPiece(cmp);
  const status = (x: Json) => x.status === "ruled out" ? "Ruled out: " + x.ruledOut.join(", ") : x.status === "unknown" ? "Must-pass unknown: " + x.unresolved.join(", ") : "Passes";
  const table = `<div class="tscroll"><table class="vt compare-table"><caption class="sr">Ranking</caption><thead><tr><th class="n">#</th><th>City</th><th class="n">Score</th><th class="n">Data</th><th class="n">Left a month (${esc(cmp.currency)})</th><th>Must-pass</th></tr></thead><tbody>${cmp.cities.map((x) => `<tr><td class="n">${x.rank}</td><td>${esc(x.name)}</td><td class="n">${x.total.toFixed(1)}</td><td class="n">${Math.round(x.coverage * 100)}%</td><td class="n">${x.left === null ? "–" : money(x.left, cmp.currency)}</td><td>${esc(status(x))}</td></tr>`).join("")}</tbody></table></div>`;
  const points = `<div class="tscroll"><table class="vt"><caption class="sr">Points by line and city</caption><thead><tr><th>Line</th><th class="n">Weight</th>${cmp.cities.map((c) => `<th class="n">${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${cmp.lines.map((l) => `<tr><th scope="row">${esc(l.label)}${l.cite ? `<br><span class="quiet">${esc(l.cite)}</span>` : ""}</th><td class="n">${fmt(l.weight, 0)}</td>${cmp.cities.map((c) => { const x = c.lines.find((y) => y.id === l.id); return `<td class="n">${x ? fmt(x.points) + `<br><span class="quiet">${esc(x.noFigure ? "no figure" : x.text)}${x.cite ? ", " + esc(x.cite) : ""}</span>` : "–"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
  return `<section class="sheet vsheet"><header class="vhead"><h2 class="vtitle">${esc(joinNames(names))}</h2></header>${cmp.verdict ? `<p class="vverdict">${esc(cmp.verdict)}</p>` : ""}` + niceRow() + seg + statusLine() + piece +
    `<div class="vfoot">${can.link() && S.share ? '<button type="button" class="ink-btn" data-act="open-shown" data-k="act:open-shown">Open this comparison in Borgo</button>' : ""}<span class="quiet">Dataset ${esc(cmp.dataset)}. Your weights; no ranking is objective.</span></div>` +
    fold("Sources and calculations", table + "<h3>Points by line</h3>" + points + (cmp.notes.length ? `<h3>Notes</h3><ul>${cmp.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "") + (cmp.next.length ? `<h3>What to add</h3><ul>${cmp.next.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "") + (cmp.sources.length ? `<h3>Sources</h3>${sourcesList(cmp.sources)}` : ""), "sources") + "</section>";
}

function scoresPiece(cmp: Comparison): string {
  const { scale, by } = winsLosses(cmp);
  const stand = `<ol class="vstand">${cmp.cities.map((c, i) => {
    const out = c.status === "ruled out";
    const open = S.why.has(c.id);
    const left = c.left !== null ? `<span><b>${esc(money(c.left, cmp.currency))}</b> left a month</span>` : c.leftAtMost !== undefined ? `<span>At most <b>${esc(money(c.leftAtMost, cmp.currency))}</b> left a month</span>` : "";
    const name = interactive() ? `<button type="button" class="cr-name city-btn" data-open="${esc(c.id)}" data-k="open:${esc(c.id)}" aria-haspopup="dialog">${esc(c.name)}</button>` : `<span class="cr-name">${esc(c.name)}</span>`;
    return `<li class="${i === 0 && !out ? "is-lead" : ""}${out ? " is-out" : ""}"><div class="cr"><b class="cr-n">${c.rank}</b>${name}<span class="cr-score" data-score="${esc(c.id)}">${Math.round(c.total)}<small>/ 100</small></span>` +
      `<div class="band" role="img" aria-label="${esc(c.name)}: ${c.total.toFixed(1)} of 100"><i style="width:${Math.max(0, Math.min(100, c.total)).toFixed(1)}%"></i></div>` +
      `<div class="cr-meta">${left}${c.coverage < 0.999 ? `<span>${Math.round(c.coverage * 100)}% of the weight on real figures</span>` : ""}${out ? `<span class="fail">Ruled out: ${esc(c.ruledOut.join(", "))}</span>` : c.status === "unknown" ? `<span>Must-pass unknown: ${esc(c.unresolved.join(", "))}</span>` : ""}` +
      (!interactive() ? "" : `<button type="button" class="cr-why" data-act="why" data-city="${esc(c.id)}" data-k="why:${esc(c.id)}" aria-expanded="${open}" aria-controls="wl-${esc(c.id)}">${cmp.cities.length > 1 ? "Wins and losses" : "Where it earns"} ${CHEVRON}</button>`) + "</div></div>" +
      (open ? `<div class="cr-wl glance" id="wl-${esc(c.id)}">${winsLossesHtml(by.get(c.id)!, scale)}</div>` : "") + cardHtml(c.id) + "</li>";
  }).join("")}</ol>`;
  return stand + linesGrid(cmp);
}

/** Every weighted line with its weight beside it (the input lives with its line) and the points each city earns on it. */
function linesGrid(cmp: Comparison): string {
  const edit = requerying() && S.lines.length;
  const n = cmp.cities.length;
  const head = `<div class="vl-row is-head" style="--n:${n}" aria-hidden="true"><span>Line${edit ? " and its weight" : ""}</span>${cmp.cities.map((c) => `<span title="${esc(c.name)}">${esc(c.name)}</span>`).join("")}</div>`;
  const rows = cmp.lines.map((l) => {
    const w = Math.round(number(edit ? S.weights[l.id] : l.weight));
    const pts = cmp.cities.map((c) => c.lines.find((x) => x.id === l.id));
    const top = Math.max(0.01, ...pts.map((x) => (x && !x.noFigure ? x.points : 0)));
    const label = `<label class="val-n" for="w-${esc(l.id)}">${esc(lineName(l.label))}</label>`;
    const dial = edit
      ? `<div class="slider">${label}<output for="w-${esc(l.id)}">${w}</output><input type="range" id="w-${esc(l.id)}" data-w="${esc(l.id)}" data-k="w:${esc(l.id)}" min="0" max="100" step="1" value="${w}" style="--fill:${w}%" aria-valuetext="${w} out of 100"></div>`
      : `<div class="slider"><span class="val-n">${esc(lineName(l.label))}</span><output>${w}</output></div>`;
    return `<div class="vl-row${w === 0 ? " is-zero" : ""}" style="--n:${n}">${dial}${cmp.cities.map((c, i) => {
      const x = pts[i];
      if (!x) return '<span class="vl-pts is-none"><b>–</b></span>';
      const best = !x.noFigure && x.points >= top - 1e-9 && x.points > 0 && n > 1;
      return `<span class="vl-pts${best ? " is-best" : ""}${x.noFigure ? " is-none" : ""}" title="${esc(c.name)}, ${esc(lineName(l.label))}: ${esc(x.noFigure ? "no figure" : x.text)}${x.cite ?? l.cite ? " (" + esc(String(x.cite ?? l.cite)) + ")" : ""}. ${fmt(x.points)} points."><b>${fmt(x.points)}</b><i style="--w:${x.noFigure ? 0 : ((x.points / top) * 100).toFixed(1)}%"></i></span>`;
    }).join("")}</div>`;
  }).join("");
  return `<div class="vlines-h"><p class="sh">What matters</p><p class="vs-lede">Points each city earns on each line, out of 100 in all.${edit ? " Drag a weight and the scores are worked out again here, with no message to the chat." : ""}</p></div><div class="vlines">${head}${rows}</div>` +
    (edit ? '<button type="button" class="pill-btn vl-reset" data-act="reset-weights" data-k="act:reset">Reset to the first answer</button>' : "");
}

function moneyPiece(cmp: Comparison): string {
  return `<div class="vmoney">${cmp.cities.map((c) => {
    const m = c.money;
    const lines = moneyLines(m);
    const head = m?.grossYear ? `${money(m.grossYear, cmp.currency)} gross a year${typeof m.effectiveRate === "number" ? ` · ${fmt(m.effectiveRate * 100, 0)}% tax` : ""}` : "";
    return `<div class="mcard"><div class="mcard-h"><b>${esc(c.name)}</b><span>${esc(head)}</span></div>${lines.length ? waterfall(lines, cmp.currency, c.name + ": money a month") : `<p class="mnote">No take-home figure here${m?.missing?.length ? ": needs " + esc(m.missing.join(", ")) : ""}.</p>`}${m?.missing?.length && lines.length ? `<p class="mnote">Not counted: ${esc(m.missing.join(", "))}.</p>` : ""}</div>`;
  }).join("")}</div><p class="vsrc">A month, in ${esc(cmp.currency)}: take-home pay after tax, then each cost Borgo counts.</p>`;
}

/** The arguments a comparison's weather and map ask rank_cities with: these cities, this profile. */
function extraArgs(tab: "weather" | "map"): Record<string, unknown> {
  const { detail: _d, limit: _l, cities: _c, ...profile } = S.query ?? {};
  const ids = S.cmp.cities.map((c: Json) => c.id);
  return tab === "weather"
    ? { cities: ids, criterion: "nice_days", view: "months", limit: ids.length, ...(S.query?.comfort ? { comfort: S.query.comfort } : {}) }
    : { ...profile, cities: ids, score: true, view: "world", limit: ids.length };
}
function weatherPiece(cmp: Comparison): string {
  const x = S.extra.weather;
  if (!x || x.status === "loading") return '<p class="quiet">Reading the year…</p>';
  if (x.status === "error") return `<p class="quiet">${esc(x.error)}</p>`;
  const rows: Json[] = x.result.rows;
  const shared = sharedSource(rows);
  return `<div class="vmonths">${cmp.cities.map((c) => {
    const row = rows.find((y) => y.id === c.id);
    return `<div class="vm-row"><div class="vm-name"><div class="mr-go"><b class="mr-n">${c.rank}</b><span class="mr-name">${esc(c.name)}</span></div><span class="vm-total">${row ? `<b>${fmt(row.value, 0)}</b> nice days a year` : "No weather figures"}</span></div>${row?.months?.length === 12 ? monthStrip(row.months, { name: c.name, what: "nice days", top: 31 }) : ""}</div>`;
  }).join("")}</div>${shared ? `<p class="vsrc">Source: <b>${esc(shared)}</b></p>` : ""}`;
}
function comparedMap(cmp: Comparison): string {
  const x = S.extra.map;
  if (!x || x.status === "loading") return '<p class="quiet">Drawing the map…</p>';
  if (x.status === "error") return `<p class="quiet">${esc(x.error)}</p>`;
  const rows: Json[] = x.result.rows;
  return mapHtml(cmp.cities.map((c) => { const row = rows.find((y) => y.id === c.id); return { id: c.id, name: c.name, rank: c.rank, value: c.total, unit: "points", point: row?.point ?? null, cite: "", text: `${Math.round(c.total)} of 100` }; }), "desc", "Your score");
}

// ---------- Drawing ----------
function draw(): void {
  const active = document.activeElement as HTMLElement | null;
  const key = S.focus ?? (active && app.contains(active) ? active.dataset.k : undefined);
  S.focus = undefined;
  try {
    app.innerHTML = S.kind === "ranking" ? rankingHtml(S.report) : S.kind === "compare" ? compareHtml() : S.kind === "city" ? cityHtml(S.report) : S.kind === "pay" ? payHtml(S.report) : "";
  } catch (e) {
    app.textContent = "Could not draw the answer: " + (e as Error).message;
    notify("notifications/message", { level: "error", logger: "borgo view", data: String(e) });
    return;
  }
  for (const f of app.querySelectorAll<HTMLDetailsElement>("details[data-fold]")) if (S.folds.has(f.dataset.fold)) f.open = true;
  app.setAttribute("aria-busy", String(S.busy));
  layoutLabels();
  if (key) (app.querySelector('[data-k="' + CSS.escape(key) + '"]') as HTMLElement | null)?.focus({ preventScroll: key === "card" ? false : true });
}

const kindOf = (report: Json): Kind | null => report?.kind === "ranking" ? "ranking" : report && Array.isArray(report.cities) && Array.isArray(report.ranking) ? "compare" : report?.city?.id && Array.isArray(report.figures) ? "city" : report && typeof report.gross === "number" && typeof report.net === "number" && Array.isArray(report.lines) ? "pay" : null;

/** Takes a result as the one on screen. A host's own result starts afresh; the answer to a click keeps what was picked. */
function adopt(result: Json, own: boolean): boolean {
  const report = result?.structuredContent;
  const kind = kindOf(report);
  if (!kind) return false;
  const meta = result._meta?.borgo;
  S.kind = kind;
  S.report = report;
  S.query = meta?.query ?? S.input ?? (own ? S.query : null);
  S.input = null;
  S.share = meta?.share ?? (own ? S.share : null);
  S.cmp = kind === "compare" ? comparison(report) : null;
  if (kind === "ranking") for (const row of report.rows) S.known.set(row.id, { name: row.name, country: row.country ?? "" });
  if (kind === "compare") for (const c of S.cmp.cities) S.known.set(c.id, { name: c.name, country: c.country });
  if (kind === "city") S.known.set(report.city.id, { name: report.city.name, country: report.city.country });
  if (!own) {
    S.selected = [];
    S.detail = null;
    S.status = "";
    S.niceOpen = false;
    S.tab = "scores";
    S.extra = {};
    S.why = new Set(S.cmp?.cities[0] ? [S.cmp.cities[0].id] : []);
    S.comfort = comfortOf(S.query, S.share);
    if (kind === "compare") {
      S.lines = S.cmp.lines.map((l: Json) => ({ id: l.id, label: l.label }));
      S.weights = Object.fromEntries(S.cmp.lines.map((l: Json) => [l.id, l.weight]));
      S.baseWeights = { ...S.weights };
    }
  }
  return true;
}

/** The result already on screen, kept as text so a host that repeats it back after a click does not undo the click. */
const signature = (result: Json) => JSON.stringify(result?.structuredContent ?? null);

// ---------- Asking the server again, from the frame ----------
async function callTool(name: string, args: Record<string, unknown>): Promise<Json> {
  const result = await request("tools/call", { name, arguments: args });
  if (result?.isError) throw new Error(String(result.content?.find((c: Json) => c.type === "text")?.text ?? "The call failed."));
  return result;
}

function say(text: string): void {
  S.status = text;
  const el = app.querySelector<HTMLElement>('[data-k="status"]');
  if (el) el.textContent = text;
}

async function requery(next: Record<string, unknown>, saying: string): Promise<void> {
  const seq = ++S.seq;
  S.busy = true;
  say(saying);
  app.setAttribute("aria-busy", "true");
  try {
    const result = await callTool(S.kind === "ranking" ? "rank_cities" : "compare_cities", next);
    if (seq !== S.seq) return;
    S.own = [signature(result), ...S.own].slice(0, 8);
    S.query = next;
    adopt(result, true);
    S.comfort = comfortOf(S.query, S.share);
    if (S.detail && S.kind === "ranking" && !S.report.rows.some((x: Json) => x.id === S.detail.id)) S.detail = null;
    if (S.kind === "ranking" && S.detail) S.detail.row = S.report.rows.find((x: Json) => x.id === S.detail.id);
    S.status = S.kind === "ranking" ? "Updated: " + S.report.label + "." : "Scores worked out again.";
    S.busy = false;
    if (S.kind === "compare" && (S.tab === "weather" || S.tab === "map")) void loadExtra(S.tab, true);
    draw();
    tellModel();
  } catch (e) {
    if (seq !== S.seq) return;
    S.busy = false;
    S.status = "Could not update: " + (e as Error).message;
    draw();
  }
}

async function loadExtra(tab: "weather" | "map", force = false): Promise<void> {
  const args = extraArgs(tab);
  const key = JSON.stringify(args);
  if (!force && S.extra[tab]?.key === key && S.extra[tab].status !== "error") return;
  S.extra[tab] = { key, status: "loading" };
  try {
    const result = await callTool("rank_cities", args);
    if (S.extra[tab]?.key !== key) return;
    S.extra[tab] = { key, status: "ready", result: result.structuredContent };
  } catch (e) {
    if (S.extra[tab]?.key !== key) return;
    S.extra[tab] = { key, status: "error", error: "Not available just now: " + (e as Error).message };
  }
  if (S.kind === "compare" && S.tab === tab) draw();
}

function patchRanking(ctl: string, value: string): Record<string, unknown> | null {
  const q: Json = { ...S.query };
  if (ctl === "measure") {
    const m = BORGO.measures.find((x) => x.key === value);
    if (!m) return null;
    for (const k of ["metric", "criterion", "score", "aggregate", "month"]) delete q[k];
    Object.assign(q, m.arg);
    q.order = m.order;
    q.view = m.months ? "months" : q.view === "months" ? "ranked" : q.view;
  } else if (ctl === "order") q.order = value;
  else if (ctl === "limit") q.limit = Number(value);
  else if (ctl === "view") q.view = value;
  else if (ctl === "region") {
    const filters: Json = { ...q.filters };
    if (value) filters.region = value; else delete filters.region;
    if (Object.keys(filters).length) q.filters = filters; else delete q.filters;
  } else return null;
  return q;
}

let slide: ReturnType<typeof setTimeout> | undefined;
function weightsChanged(): void {
  clearTimeout(slide);
  slide = setTimeout(() => void requery({ ...S.query, weights: { ...(S.query.weights ?? {}), ...S.weights } }, "Working out the scores…"), 250);
}

/** A change to the nice-day definition: drawn at once, then asked of the server where the answer depends on it. */
let niceTimer: ReturnType<typeof setTimeout> | undefined;
function comfortChanged(change: ComfortChange, focus?: string): void {
  S.comfort = nextComfort(S.comfort, change);
  S.focus = focus;
  draw();
  if (!niceCounts() || !requerying()) { tellModel(); return; }
  clearTimeout(niceTimer);
  say("Counting nice days again…");
  niceTimer = setTimeout(() => void requery({ ...S.query, comfort: { ...S.comfort } }, "Counting nice days again…"), 450);
}

// ---------- Opening a city ----------
async function openCity(id: string, trigger?: string): Promise<void> {
  const row = S.kind === "ranking" ? S.report.rows.find((x: Json) => x.id === id) : undefined;
  const info = S.known.get(id);
  S.detail = { id, name: row?.name ?? info?.name ?? id, country: row?.country ?? info?.country ?? "", row: S.kind === "ranking" ? row : S.cmp?.cities.find((c: Json) => c.id === id) ? { rank: S.cmp.cities.find((c: Json) => c.id === id).rank } : undefined, status: can.tools() ? "loading" : "ready", figures: [], trigger };
  S.focus = "card";
  draw();
  tellModel();
  if (!can.tools()) return;
  try {
    const metric = S.report?.measure?.metric;
    const result = await callTool("get_city", { city: id, metrics: [...new Set([...(metric ? [metric] : []), ...BORGO.cardMetrics, ...BORGO.climateMetrics])] });
    if (S.detail?.id !== id) return;
    S.detail.figures = result.structuredContent?.figures ?? [];
    S.detail.status = "ready";
  } catch (e) {
    if (S.detail?.id !== id) return;
    S.detail.status = "error";
    S.detail.error = "More figures are not available just now: " + (e as Error).message;
  }
  draw();
}

function closeCard(): void {
  const t = S.detail?.trigger;
  S.detail = null;
  S.focus = t;
  draw();
  tellModel();
}

// ---------- Handing over to the chat and the site ----------
const ok = (r: Json) => !r?.isError;
async function message(text: string): Promise<void> {
  try {
    const r = await request("ui/message", { role: "user", content: [{ type: "text", text }] });
    say(ok(r) ? "Sent to the chat." : "The chat did not take the message.");
  } catch (e) {
    say("The chat did not take the message: " + (e as Error).message);
  }
}
async function openSite(ids: string[]): Promise<void> {
  const cities = ids.map((id) => ({ id, name: S.known.get(id)?.name ?? id, country: S.known.get(id)?.country ?? "" })).filter((c) => c.country);
  const comfort = S.comfort ? { comfort: { ...(S.share?.prefs?.comfort ?? {}), ...S.comfort } } : {};
  const profile = { ...S.share, ...(S.share?.prefs ? { prefs: { ...S.share.prefs, ...comfort } } : {}), weights: { ...(S.share?.weights ?? {}), ...(S.kind === "compare" ? S.weights : {}) } };
  // A city whose country is unknown here is left to the id alone: the site reads ?cities= for those.
  const url = cities.length === ids.length ? shareLink(profile, cities) : BORGO_ORIGIN + "/?cities=" + ids.map(encodeURIComponent).join(",");
  try {
    const r = await request("ui/open-link", { url });
    say(ok(r) ? "Opened in Borgo." : "The host did not open the link.");
  } catch (e) {
    say("The host did not open the link: " + (e as Error).message);
  }
}

// ---------- Telling the model what the person is looking at ----------
let told: ReturnType<typeof setTimeout> | undefined;
function tellModel(): void {
  if (!can.context()) return;
  clearTimeout(told);
  told = setTimeout(() => {
    const r = S.report;
    if (!r) return;
    const sel = S.selected.map((id: string) => ({ id, name: nameOf(id) }));
    const open = S.detail ? { id: S.detail.id, name: S.detail.name } : null;
    const c: Comfort | null = S.comfort;
    const nice = c && niceShown() ? { min: c.min, max: c.max, basis: c.basis ?? "feels", tests: testsShort(c) } : null;
    const niceText = nice ? ` A nice day: ${nice.min} to ${nice.max} °C ${nice.basis === "air" ? "air" : "feels-like"}, ${nice.tests.toLowerCase()}.` : "";
    let text = "", structured: Json = {};
    if (S.kind === "ranking") {
      const rows = r.rows.slice(0, 10).map((x: Json) => ({ rank: x.rank, id: x.id, name: x.name, value: x.value, unit: x.unit }));
      const q = S.query ?? {};
      structured = { source: "Borgo chart in the chat", chart: "ranking", ranked: r.label, order: r.order, view: r.view, region: q.filters?.region ?? null, shown: r.coverage.returned, matched: r.coverage.matched, top: rows, selected: sel.map((x: Json) => x.id), openCity: open?.id ?? null, niceDay: nice };
      text = "What the person sees in Borgo's chart: " + r.label + ", " + (r.order === "asc" ? "lowest" : "highest") + " first" + (q.filters?.region ? ", " + BORGO.regions.find((x) => x.id === q.filters.region)?.label : "") + ", " + r.coverage.returned + " of " + r.coverage.matched + " matching cities as " + (r.view === "world" ? "a map" : r.view === "months" ? "month strips" : "bars") + ". Top: " + rows.map((x: Json) => x.rank + ". " + x.name + " " + fmt(x.value) + " " + x.unit).join("; ") + "." + niceText + (sel.length ? " Selected: " + joinNames(sel.map((x: Json) => x.name)) + "." : "") + (open ? " Looking at " + open.name + "'s card." : "");
    } else if (S.kind === "compare") {
      const rows = S.cmp.cities.slice(0, 10).map((x: Json) => ({ rank: x.rank, id: x.id, name: x.name, score: x.total }));
      structured = { source: "Borgo chart in the chat", chart: "comparison", showing: S.tab, weights: S.weights, ranking: rows, openCity: open?.id ?? null, niceDay: nice };
      text = "What the person sees in Borgo's comparison (" + S.tab + "), with their weights set to " + Object.entries(S.weights).map(([k, v]) => k + " " + v).join(", ") + ": " + rows.map((x: Json) => x.rank + ". " + x.name + " " + number(x.score).toFixed(1)).join("; ") + "." + niceText + (open ? " Looking at " + open.name + "'s card." : "");
    } else if (S.kind === "city") {
      structured = { source: "Borgo chart in the chat", chart: "city", city: r.city.id, niceDay: nice };
      text = "What the person sees in Borgo: " + r.city.name + "'s dossier." + niceText;
    } else return;
    const key = JSON.stringify(structured);
    if (key === S.sentContext) return;
    S.sentContext = key;
    const params: Json = {};
    if (takes(caps.updateModelContext, "text")) params.content = [{ type: "text", text }];
    if (takes(caps.updateModelContext, "structuredContent")) params.structuredContent = structured;
    request("ui/update-model-context", params).catch(() => undefined);
  }, 400);
}

// ---------- Events ----------
app.addEventListener("click", (e) => {
  const t = (e.target as Element).closest<HTMLElement>("[data-act],[data-open]");
  if (!t || !app.contains(t)) return;
  if (t.dataset.open) return void openCity(t.dataset.open, t.dataset.k);
  const act = t.dataset.act;
  const d = S.detail;
  if (act === "close-card") closeCard();
  else if (act === "ask" && (d || S.kind === "city")) void message("Tell me more about living in " + (d?.name ?? S.report.city.name) + " for me");
  else if (act === "open-site" && (d || S.kind === "city")) void openSite([d?.id ?? S.report.city.id]);
  else if (act === "toggle-select" && d) {
    S.selected = S.selected.includes(d.id) ? S.selected.filter((x: string) => x !== d.id) : [...S.selected, d.id];
    S.focus = t.dataset.k;
    draw();
    tellModel();
  } else if (act === "compare-chat") void message("Compare " + joinNames(S.selected.map(nameOf)) + " for me");
  else if (act === "open-selected") void openSite(S.selected);
  else if (act === "open-shown") void openSite(S.kind === "ranking" ? S.report.rows.map((x: Json) => x.id) : S.cmp.cities.map((x: Json) => x.id));
  else if (act === "clear") { S.selected = []; S.focus = undefined; draw(); tellModel(); }
  else if (act === "reset-weights") { S.weights = { ...S.baseWeights }; S.focus = t.dataset.k; draw(); weightsChanged(); }
  else if (act === "view" && S.query && t.getAttribute("aria-checked") !== "true") { const next = patchRanking("view", t.dataset.view!); if (next) void requery(next, "Updating the chart…"); }
  else if (act === "tab") {
    S.tab = t.dataset.tab as Tab;
    S.focus = t.dataset.k;
    if (S.tab === "weather" || S.tab === "map") void loadExtra(S.tab);
    draw();
    tellModel();
  } else if (act === "why") {
    const id = t.dataset.city!;
    S.why.has(id) ? S.why.delete(id) : S.why.add(id);
    S.focus = t.dataset.k;
    draw();
  } else if (act === "nice") { S.niceOpen = !S.niceOpen; S.focus = S.niceOpen ? "nice:min-" : "act:nice"; draw(); }
  else if (act === "nice-step") comfortChanged({ step: t.dataset.field as "min" | "max", d: Number(t.dataset.d) }, t.dataset.k);
  else if (act === "nice-basis" && t.getAttribute("aria-checked") !== "true") comfortChanged({ basis: t.dataset.basis === "air" ? "air" : "feels" }, t.dataset.k);
  else if (act === "fullscreen") {
    const want = S.mode === "fullscreen" ? "inline" : "fullscreen";
    request("ui/request-display-mode", { mode: want }).then((r) => { S.mode = r?.mode ?? S.mode; document.documentElement.dataset.mode = S.mode; S.focus = "act:fullscreen"; draw(); }, () => undefined);
  }
});
app.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.pick) {
    S.selected = t.checked ? [...new Set([...S.selected, t.dataset.pick])] : S.selected.filter((x: string) => x !== t.dataset.pick);
    S.focus = t.dataset.k;
    draw();
    tellModel();
  } else if (t.dataset.niceTest) comfortChanged({ test: t.dataset.niceTest as "dry", on: t.checked }, t.dataset.k);
  else if (t.dataset.niceDaylight) comfortChanged({ daylight: Number(t.value) }, t.dataset.k);
  else if (t.dataset.ctl && S.query) {
    const next = patchRanking(t.dataset.ctl, t.value);
    if (next) void requery(next, "Updating the chart…");
  } else if (t.dataset.w) weightsChanged();
});
app.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.dataset.w) return;
  S.weights[t.dataset.w] = Number(t.value);
  const out = t.parentElement?.querySelector("output");
  if (out) out.textContent = t.value;
  t.style.setProperty("--fill", t.value + "%");
  t.setAttribute("aria-valuetext", t.value + " out of 100");
});
app.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset?.open && t.tagName.toLowerCase() === "circle" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void openCity(t.dataset.open, t.dataset.k); }
  else if (e.key === "Escape" && S.detail) closeCard();
  else if (e.key === "Escape" && S.niceOpen) { S.niceOpen = false; S.focus = "act:nice"; draw(); }
});
app.addEventListener("toggle", (e) => {
  const f = e.target as HTMLDetailsElement;
  if (f.dataset?.fold) f.open ? S.folds.add(f.dataset.fold) : S.folds.delete(f.dataset.fold);
}, true);

// ---------- Theme ----------
function applyContext(c: Json): void {
  if (!c) return;
  ctx = { ...ctx, ...c };
  if (c.displayMode) S.mode = c.displayMode;
  // The host's theme decides light or dark; the look itself is Borgo's, so the host's style variables are not taken.
  if (c.theme === "light" || c.theme === "dark") document.documentElement.style.colorScheme = c.theme;
  document.documentElement.dataset.mode = S.mode;
}

// ---------- The host talks ----------
window.addEventListener("message", (event) => {
  if (event.source !== host) return;
  const m = event.data;
  if (!m || m.jsonrpc !== "2.0") return;
  if (m.id !== undefined && !m.method) {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === "ui/notifications/tool-input") S.input = m.params?.arguments ?? null;
  else if (m.method === "ui/notifications/tool-result") {
    try {
      if (S.own.includes(signature(m.params))) return;
      if (adopt(m.params, false)) draw();
    } catch (e) {
      app.textContent = "Could not draw the answer: " + (e as Error).message;
      notify("notifications/message", { level: "error", logger: "borgo view", data: String(e) });
    }
  } else if (m.method === "ui/notifications/host-context-changed") {
    // Only a change of display mode changes what is drawn; a redraw would close the sections the person opened or closed.
    const before = S.mode + JSON.stringify(ctx.availableDisplayModes);
    applyContext(m.params);
    if (S.report && before !== S.mode + JSON.stringify(ctx.availableDisplayModes)) draw();
  }
  else if (m.id !== undefined && (m.method === "ui/resource-teardown" || m.method === "ping")) send({ id: m.id, result: {} });
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: "Method not found: " + m.method } });
});

const init = await request("ui/initialize", {
  appInfo: { name: "borgo", version: BORGO.version },
  appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
  protocolVersion: BORGO.protocol,
});
caps = init?.hostCapabilities ?? {};
applyContext(init?.hostContext);
notify("ui/notifications/initialized", {});
let last = "";
let width = 0;
new ResizeObserver(() => {
  // The body's own height, not the document's: the document is never shorter than the frame, so it could never shrink.
  const size = { width: Math.ceil(document.documentElement.scrollWidth), height: Math.ceil(document.body.getBoundingClientRect().height) };
  const key = size.width + "x" + size.height;
  if (key !== last) { last = key; notify("ui/notifications/size-changed", size); }
  if (document.documentElement.clientWidth !== width) { width = document.documentElement.clientWidth; layoutLabels(); }
}).observe(document.body);
// Labels are measured in the site's condensed face: once it is ready, measure again.
void Promise.allSettled(faces).then(() => { if (S.report) layoutLabels(); });
