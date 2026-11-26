// The MCP App view's program: runs in the host's sandboxed iframe, next to src/agent/chart.ts and share-link.ts, whose
// functions (esc, money, compareSvg, summaryChartInput, chartInput, shareLink) it uses as globals. Read from the sources
// and type-stripped like them (src/mcp/chart-source.ts); the npm build compiles the same text ahead of packaging.
//
// It speaks JSON-RPC to the host over postMessage (the MCP Apps protocol, extension io.modelcontextprotocol/ui) and
// ships no SDK and makes no network request. Everything it can do beyond drawing is offered only when the host's
// ui/initialize answer lists it: calling tools (serverTools), opening links (openLinks), writing a message into the chat
// (message), telling the model what the person sees (updateModelContext), full screen (availableDisplayModes). A host
// that lists none of them gets the same chart this view always drew.
export {};

interface Measure { key: string; group: string; label: string; arg: Record<string, unknown>; order: "asc" | "desc"; needs: string[]; months: boolean }
declare const BORGO: { protocol: string; version: string; measures: Measure[]; regions: { id: string; label: string }[]; limits: number[]; cardMetrics: string[] };
declare const borgoLand: string;
declare const BORGO_ORIGIN: string;
declare function esc(s: string): string;
declare function money(n: number, cur: string): string;
declare function compareSvg(input: unknown, width?: number): string;
declare function chartInput(report: unknown): unknown;
declare function summaryChartInput(report: unknown): unknown;
declare function shareLink(profile: Record<string, unknown>, cities: { id: string; name: string; country: string }[]): string;

type Json = any;

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
const app = document.getElementById("app")!;
const S: Json = {
  kind: null as null | "ranking" | "compare",
  report: null, query: null, share: null, input: null,
  selected: [] as string[], known: new Map<string, { name: string; country: string }>(),
  detail: null, busy: false, status: "", seq: 0, focus: undefined,
  weights: {} as Record<string, number>, baseWeights: {} as Record<string, number>, lines: [] as { id: string; label: string }[],
  mode: "inline", own: [] as string[], sentContext: "",
};
const number = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const formatValue = (n: unknown) => number(n).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const sourceLabel = (r: Json) => [...new Set((r.sources ?? []).map((s: Json) => String(s.label).split(":")[0] + ", " + (s.year ?? "period not recorded") + (s.level && !["city", "metro"].includes(s.level) ? ", " + s.level + " level" : "")))].join("; ");
const interactive = () => can.tools() || can.message() || can.link();
const canSelect = () => can.message() || can.link();
const requerying = () => can.tools() && !!S.query;
const nameOf = (id: string) => S.known.get(id)?.name ?? id;
const joined = (names: string[]) => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names.at(-1));

// ---------- Ranking ----------
const measureKey = (q: Json): string => (q.score ? "score" : q.criterion ? "criterion:" + q.criterion : q.metric ? "metric:" + q.metric : "");
const satisfied = (q: Json, needs: string[]) => needs.every((n) => n === "salary" ? number(q?.salary?.amount) > 0 || Object.keys(q?.salaryByCity ?? {}).length > 0 : n === "spending" ? !!q?.spending : n === "home" ? !!q?.spending?.homeCity : n === "household" ? (q?.household ?? []).length > 0 : n === "work" ? !!q?.work : true);

function controlsHtml(r: Json): string {
  const fs = r.view === "world" && can.fullscreen();
  if (!requerying() && !fs) return "";
  let html = '<div class="controls" role="group" aria-label="Change this chart">';
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
    const view = r.view;
    html += field("Rank by", "measure", '<select data-ctl="measure" data-k="ctl:measure">' + options + "</select>") +
      field("Order", "order", '<select data-ctl="order" data-k="ctl:order"><option value="desc"' + (r.order === "desc" ? " selected" : "") + ">Highest first</option><option value=\"asc\"" + (r.order === "asc" ? " selected" : "") + ">Lowest first</option></select>") +
      field("Region", "region", '<select data-ctl="region" data-k="ctl:region"><option value="">Everywhere</option>' + BORGO.regions.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === region ? " selected" : "") + ">" + esc(x.label) + "</option>").join("") + "</select>") +
      field("Show", "limit", '<select data-ctl="limit" data-k="ctl:limit">' + limits.map((n) => '<option value="' + n + '"' + (n === limit ? " selected" : "") + ">" + n + " cities</option>").join("") + "</select>") +
      field("As", "view", '<select data-ctl="view" data-k="ctl:view"><option value="ranked"' + (view === "ranked" ? " selected" : "") + '>Bars</option><option value="world"' + (view === "world" ? " selected" : "") + ">Map</option>" + (hasMonths || view === "months" ? '<option value="months"' + (view === "months" ? " selected" : "") + ">Months</option>" : "") + "</select>");
  }
  if (fs) html += '<button type="button" class="btn" data-act="fullscreen" data-k="act:fullscreen" aria-pressed="' + (S.mode === "fullscreen") + '">' + (S.mode === "fullscreen" ? "Exit full screen" : "Full screen") + "</button>";
  return html + '</div><p class="status quiet" role="status" aria-live="polite" data-k="status">' + esc(S.status) + "</p>";
}
const field = (label: string, id: string, control: string) => '<div class="field"><label for="ctl-' + id + '">' + esc(label) + "</label>" + control.replace("<select ", '<select id="ctl-' + id + '" ') + "</div>";

function rankingHtml(r: Json): string {
  const rows: Json[] = r.rows;
  const cite = (row: Json) => '<small class="quiet source">' + esc(sourceLabel(row)) + "</small>";
  const max = Math.max(1, ...rows.map((x) => Math.abs(number(x.value))));
  const act = interactive();
  const pick = (row: Json, inner: string) => act ? '<button type="button" class="city-btn" data-open="' + esc(row.id) + '" data-k="open:' + esc(row.id) + '">' + inner + "</button>" : inner;
  let visual = "";
  if (r.view === "world") {
    const dots = rows.map((row) => {
      const x = 360 + number(row.point?.[0]) * 125, y = 180 - number(row.point?.[1]) * 125;
      const on = S.selected.includes(row.id);
      const label = row.name + ": " + formatValue(row.value) + " " + row.unit + ". " + sourceLabel(row);
      return '<circle class="city-dot' + (on ? " on" : "") + '" cx="' + x + '" cy="' + y + '" r="' + (on ? 7 : 5) + '" fill="var(--rank-accent)" stroke="var(--color-text-primary)"' +
        (act ? ' tabindex="0" role="button" aria-label="' + esc(label + ". Show details") + '" data-open="' + esc(row.id) + '" data-k="dot:' + esc(row.id) + '"' : "") + "><title>" + esc(label) + "</title></circle>";
    }).join("");
    visual = '<svg class="world-view" role="' + (act ? "group" : "img") + '" aria-label="Known matching cities on the Equal Earth world map" viewBox="0 0 720 360"><path fill="var(--color-border-primary)" d="' + borgoLand + '"/>' + dots + '</svg><p class="quiet">Equal Earth projection. Dots mark the returned cities, not full worldwide coverage. Land: Natural Earth, public domain; Borgo map grid.</p>' + cardHtml();
  } else if (r.view === "months") {
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weatherMax = Math.max(1, ...rows.flatMap((x) => x.months ?? []).map((x: unknown) => Math.abs(number(x))));
    visual = '<div class="month-view"><table><caption class="sr">' + esc(r.label) + ", by month</caption><thead><tr><th>City / source</th>" + labels.map((m) => '<th class="n">' + m + "</th>").join("") + "</tr></thead><tbody>" + rows.map((row) => "<tr><th>" + pick(row, esc(row.name)) + cite(row) + "</th>" + (row.months?.length === 12 ? row.months.map((n: number, i: number) => '<td class="n month-cell" style="background:color-mix(in srgb,var(--rank-accent) ' + Math.round(Math.abs(number(n)) / weatherMax * 55) + '%,transparent)" title="' + esc(labels[i] + ": " + formatValue(n)) + '">' + formatValue(n) + "</td>").join("") : '<td colspan="12">Monthly figures unavailable</td>') + "</tr>" + (S.detail?.id === row.id ? '<tr class="card-row"><td colspan="13">' + cardHtml(row.id) + "</td></tr>" : "")).join("") + "</tbody></table></div>";
  } else {
    visual = '<div class="ranked-view">' + rows.map((row) => '<div class="bar-row"><div class="bar-head">' + pick(row, "<b>" + row.rank + ". " + esc(row.name) + "</b>") + '<span class="value">' + formatValue(row.value) + " " + esc(row.unit) + '</span></div><div class="bar-track"><div class="rank-bar" style="width:' + Math.abs(number(row.value)) / max * 100 + '%"></div></div>' + cite(row) + cardHtml(row.id) + "</div>").join("") + '<p class="quiet">Bar length shows magnitude; signed values remain labelled.</p></div>';
  }
  const c = r.coverage;
  const selectable = canSelect();
  const table = '<table class="rank-table"><caption class="sr">' + esc(r.label) + '</caption><thead><tr>' + (selectable ? '<th><span class="sr">Select</span></th>' : "") + '<th>#</th><th>City</th><th class="n">Value</th><th>Unit</th><th>Source and year</th></tr></thead><tbody>' + rows.map((row) =>
    "<tr" + (S.selected.includes(row.id) ? ' class="on"' : "") + ">" + (selectable ? '<td><label class="tick"><input type="checkbox" data-pick="' + esc(row.id) + '" data-k="pick:' + esc(row.id) + '"' + (S.selected.includes(row.id) ? " checked" : "") + ' aria-label="Select ' + esc(row.name) + '"></label></td>' : "") +
    "<td>" + row.rank + "</td><td>" + pick(row, esc(row.name)) + '</td><td class="n">' + formatValue(row.value) + "</td><td>" + esc(row.unit) + "</td><td>" + esc(sourceLabel(row)) + "</td></tr>").join("") + "</tbody></table>";
  return controlsHtml(r) + '<h2>' + esc(r.label) + "</h2>" +
    '<p class="quiet">' + c.matched + " match from " + c.candidates + " candidates (" + c.known + " known cities). " + c.missing + " lack the ranking figure; " + c.filterUnknown + " cannot pass an unknown filter. Showing " + c.returned + ".</p>" +
    (rows.length ? visual : "<p>No known cities have the requested figure and pass these filters.</p>") + selectionHtml() + table +
    "<details><summary>Sources and calculations</summary><ul>" + [...new Map(rows.flatMap((row) => row.sources).map((s: Json) => [s.id + ":" + s.year, s])).values()].map((s: Json) => "<li>" + (/^https?:\/\//.test(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noreferrer">' + esc(s.label) + "</a>" : esc(s.label)) + " [" + esc(s.id) + "], " + esc(s.year ?? "period not recorded") + "</li>").join("") + "</ul></details>" +
    "<ul>" + [...(r.notes ?? []), ...rows.flatMap((row) => (row.notes ?? []).map((n: string) => row.name + ": " + n))].map((n: string) => "<li>" + esc(n) + "</li>").join("") + "</ul>" +
    (can.link() && rows.length && S.share && !S.selected.length ? '<p><button type="button" class="btn" data-act="open-shown" data-k="act:open-shown">Open these cities in Borgo</button></p>' : !can.link() && /^https:\/\/borgo\.abcastor\.com\//.test(r.link) ? '<p><a href="' + esc(r.link) + '" target="_blank" rel="noreferrer">Open these cities in Borgo</a></p>' : "");
}

/** Rows picked for a comparison or for the site, with what to do with them. */
function selectionHtml(): string {
  const ids: string[] = S.selected;
  if (!ids.length || !canSelect()) return "";
  const names = ids.map(nameOf);
  return '<div class="selection" role="group" aria-label="Selected cities"><p><b>' + ids.length + " selected:</b> " + esc(joined(names)) + "</p>" +
    (can.message() ? (ids.length >= 2 ? '<button type="button" class="btn primary" data-act="compare-chat" data-k="act:compare-chat">Compare in chat</button>' : '<span class="quiet hint">Select two or more to compare them in chat.</span>') : "") +
    (can.link() && S.share ? '<button type="button" class="btn" data-act="open-selected" data-k="act:open-selected">Open ' + (ids.length === 1 ? "this" : "these") + " in Borgo</button>" : "") +
    '<button type="button" class="btn" data-act="clear" data-k="act:clear">Clear</button></div>';
}

/** One city, opened from a row or a dot: what the ranking says of it, its figures with their sources, and what to do next. */
function cardHtml(id?: string): string {
  const d = S.detail;
  if (!d || (id !== undefined && d.id !== id)) return "";
  const row = d.row;
  const on = S.selected.includes(d.id);
  const figures = (d.figures ?? []).map((f: Json) => "<tr><th>" + esc(f.label) + '</th><td class="n">' + formatValue(f.value) + " " + esc(f.unit) + "</td><td>" + esc(f.cite ?? "") + (f.approximate ? " (wider area)" : "") + "</td></tr>").join("");
  return '<section class="card" tabindex="-1" data-k="card" aria-labelledby="card-title"><div class="card-head"><h3 id="card-title">' + esc(d.name) + (d.country ? ", " + esc(d.country) : "") + '</h3><button type="button" class="btn" data-act="close-card" data-k="act:close-card" aria-label="Close ' + esc(d.name) + ' details">Close</button></div>' +
    (row ? "<p><b>" + (row.rank ? "#" + row.rank + ": " : "") + formatValue(row.value) + " " + esc(row.unit) + "</b><small class=\"quiet source\">" + esc(sourceLabel(row)) + "</small></p>" : "") +
    (d.status === "loading" ? '<p class="quiet" role="status">Loading figures…</p>' : d.status === "error" ? '<p class="quiet" role="status">' + esc(d.error) + "</p>" : figures ? '<table><caption class="sr">Figures for ' + esc(d.name) + '</caption><tbody>' + figures + "</tbody></table>" : "") +
    '<div class="actions">' + (can.link() && S.share ? '<button type="button" class="btn primary" data-act="open-site" data-k="act:open-site">Open in Borgo</button>' : "") +
    (can.message() ? '<button type="button" class="btn" data-act="ask" data-k="act:ask">Ask about ' + esc(d.name) + "</button>" : "") +
    (canSelect() && S.kind === "ranking" ? '<button type="button" class="btn" data-act="toggle-select" data-k="act:toggle-select" aria-pressed="' + on + '">' + (on ? "Remove from comparison" : "Add to comparison") + "</button>" : "") + "</div></section>";
}

// ---------- Comparison ----------
function compareHtml(r: Json): string {
  const cur = r.displayCurrency;
  const full = r.detail !== "summary";
  const sliders = requerying() && S.lines.length ? '<details class="weights" open><summary>What matters to you</summary><p class="quiet">Drag a slider to change its weight: the scores here are worked out again, nothing is asked of the chat.</p><div class="sliders">' + S.lines.map((l: Json) => {
    const v = Math.round(number(S.weights[l.id]));
    return '<div class="slider"><label for="w-' + esc(l.id) + '">' + esc(l.label.replace(/\s*\(.*$/, "")) + '</label><input type="range" id="w-' + esc(l.id) + '" data-w="' + esc(l.id) + '" data-k="w:' + esc(l.id) + '" min="0" max="100" step="1" value="' + v + '" aria-valuetext="' + v + ' out of 100"><output for="w-' + esc(l.id) + '">' + v + "</output></div>";
  }).join("") + '</div><button type="button" class="btn" data-act="reset-weights" data-k="act:reset">Reset to the first answer</button><p class="status quiet" role="status" aria-live="polite" data-k="status">' + esc(S.status) + "</p></details>" : "";
  const open = (row: Json) => interactive() ? '<button type="button" class="city-btn" data-open="' + esc(row.id) + '" data-k="open:' + esc(row.id) + '">' + esc(row.name) + "</button>" : esc(row.name);
  if (full) {
    const rows = r.ranking.map((x: Json) => '<tr><td class="n">' + x.rank + "</td><td>" + open(x) + '</td><td class="n">' + x.total.toFixed(1) + '</td><td class="n">' + Math.round(x.coverage * 100) + '%</td><td class="n">' + (x.monthlyLeft === null ? "–" : money(x.monthlyLeft, cur)) + "</td><td>" + esc(x.ruledOut.join(", ")) + "</td></tr>").join("");
    const why = r.cities.map((c: Json) => "<li><b>" + esc(c.name) + ".</b> " + esc(c.why.join(" ")) + "</li>").join("");
    const add = r.whatToAdd.map((x: string) => "<li>" + esc(x) + "</li>").join("");
    return "<h2>Borgo: " + esc(r.cities.map((c: Json) => c.name).join(", ")) + "</h2>" + compareSvg(chartInput(r), 720) + sliders + cardHtml() +
      '<table><thead><tr><th class="n">#</th><th>City</th><th class="n">Score</th><th class="n">Data</th><th class="n">Left a month (' + esc(cur) + ")</th><th>Ruled out by</th></tr></thead><tbody>" + rows + "</tbody></table><h3>Why</h3><ul>" + why + "</ul>" + (add ? "<h3>What to add</h3><ul>" + add + "</ul>" : "") +
      '<p class="quiet">Dataset ' + esc(r.dataset.version) + ". Your weights; no ranking is objective.</p>";
  }
  const status = (x: Json) => x.status === "ruled out" ? "Ruled out: " + x.ruledOut.join(", ") : x.status === "unknown" ? "Must-pass unknown: " + x.unresolved.join(", ") : "";
  const rows = r.ranking.map((x: Json) => '<tr><td class="n">' + x.rank + "</td><td>" + open(x) + '</td><td class="n">' + number(x.total).toFixed(1) + '</td><td class="n">' + Math.round(number(x.coverage) * 100) + '%</td><td class="n">' + (x.monthlyLeft === null || x.monthlyLeft === undefined ? "–" : money(x.monthlyLeft, cur)) + "</td><td>" + esc(status(x)) + "</td></tr>").join("");
  const cities: Json[] = r.cities;
  const lines = r.lines.map((l: Json) => '<tr><th scope="row">' + esc(l.label) + (l.cite ? '<small class="quiet source">' + esc(l.cite) + "</small>" : "") + '</th><td class="n">' + number(l.weight) + "</td>" + cities.map((c) => {
    const x = (c.lines ?? []).find((y: Json) => y.id === l.id);
    return '<td class="n">' + (x ? number(x.points).toFixed(1) + '<small class="quiet source">' + esc(x.noFigure ? "no figure" : x.text ?? "") + (x.cite ? ", " + esc(x.cite) : "") + "</small>" : "–") + "</td>";
  }).join("") + "</tr>").join("");
  const notes = [...(r.notes ?? []), ...(r.provisionalReasons ?? [])].map((n: string) => "<li>" + esc(n) + "</li>").join("");
  const add = (r.nextInputs ?? []).map((x: string) => "<li>" + esc(x) + "</li>").join("");
  return "<h2>Borgo: " + esc(cities.map((c) => c.name).join(", ")) + "</h2>" + (r.verdict ? "<p>" + esc(r.verdict) + "</p>" : "") + compareSvg(summaryChartInput(r), 720) + sliders + cardHtml() +
    '<table class="compare-table"><caption class="sr">Ranking</caption><thead><tr><th class="n">#</th><th>City</th><th class="n">Score</th><th class="n">Data</th><th class="n">Left a month (' + esc(cur) + ')</th><th>Must-pass</th></tr></thead><tbody>' + rows + "</tbody></table>" +
    '<details><summary>Points by line</summary><div class="month-view"><table><caption class="sr">Points by line and city</caption><thead><tr><th>Line</th><th class="n">Weight</th>' + cities.map((c) => '<th class="n">' + esc(c.name) + "</th>").join("") + "</tr></thead><tbody>" + lines + "</tbody></table></div></details>" +
    (notes ? "<ul>" + notes + "</ul>" : "") + (add ? "<h3>What to add</h3><ul>" + add + "</ul>" : "") +
    (can.link() && S.share ? '<p><button type="button" class="btn" data-act="open-shown" data-k="act:open-shown">Open this comparison in Borgo</button></p>' : "") +
    '<p class="quiet">Dataset ' + esc(r.dataset?.version ?? "") + ". Your weights; no ranking is objective.</p>";
}

// ---------- Drawing ----------
function draw(): void {
  const active = document.activeElement as HTMLElement | null;
  const key = S.focus ?? (active && app.contains(active) ? active.dataset.k : undefined);
  S.focus = undefined;
  try {
    app.innerHTML = S.kind === "ranking" ? rankingHtml(S.report) : S.kind === "compare" ? compareHtml(S.report) : "";
  } catch (e) {
    app.textContent = "Could not draw the answer: " + (e as Error).message;
    notify("notifications/message", { level: "error", logger: "borgo view", data: String(e) });
    return;
  }
  app.setAttribute("aria-busy", String(S.busy));
  if (key) (app.querySelector('[data-k="' + CSS.escape(key) + '"]') as HTMLElement | null)?.focus({ preventScroll: key === "card" ? false : true });
}

/** Takes a result as the one on screen. A host's own result starts afresh; the answer to a click keeps what was picked. */
function adopt(result: Json, own: boolean): boolean {
  const report = result?.structuredContent;
  const kind = report?.kind === "ranking" ? "ranking" : report && Array.isArray(report.cities) ? "compare" : null;
  if (!kind) return false;
  const meta = result._meta?.borgo;
  S.kind = kind;
  S.report = report;
  S.query = meta?.query ?? S.input ?? (own ? S.query : null);
  S.input = null;
  S.share = meta?.share ?? (own ? S.share : null);
  for (const row of kind === "ranking" ? report.rows : report.cities) if (row?.id) S.known.set(row.id, { name: row.name, country: row.country ?? S.known.get(row.id)?.country ?? "" });
  if (kind === "compare") for (const r of report.ranking ?? []) S.known.set(r.id, { name: r.name, country: r.country ?? "" });
  if (!own) {
    S.selected = [];
    S.detail = null;
    S.status = "";
    if (kind === "compare") {
      // The summary lists the lines once; the full report carries them on each city.
      const lines: Json[] = Array.isArray(report.lines) ? report.lines : report.cities[0]?.lines ?? [];
      S.lines = lines.filter((l) => l.id && l.label).map((l) => ({ id: l.id, label: l.label }));
      S.weights = Object.fromEntries(lines.filter((l) => l.id && l.label).map((l) => [l.id, number(l.weight)]));
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

async function requery(next: Record<string, unknown>, say: string): Promise<void> {
  const seq = ++S.seq;
  S.busy = true;
  S.status = say;
  const status = app.querySelector<HTMLElement>('[data-k="status"]');
  if (status) status.textContent = say;
  app.setAttribute("aria-busy", "true");
  try {
    const result = await callTool(S.kind === "ranking" ? "rank_cities" : "compare_cities", next);
    if (seq !== S.seq) return;
    S.own = [signature(result), ...S.own].slice(0, 8);
    S.query = next;
    adopt(result, true);
    if (S.detail && S.kind === "ranking" && !S.report.rows.some((x: Json) => x.id === S.detail.id)) S.detail = null;
    S.status = S.kind === "ranking" ? "Updated: " + S.report.label + "." : "Scores worked out again.";
    S.busy = false;
    draw();
    tellModel();
  } catch (e) {
    if (seq !== S.seq) return;
    S.busy = false;
    S.status = "Could not update: " + (e as Error).message;
    draw();
  }
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

// ---------- Opening a city ----------
async function openCity(id: string, trigger?: string): Promise<void> {
  const row = S.kind === "ranking" ? S.report.rows.find((x: Json) => x.id === id) : S.report.ranking?.find((x: Json) => x.id === id);
  const info = S.known.get(id);
  S.detail = { id, name: row?.name ?? info?.name ?? id, country: row?.country ?? info?.country ?? "", row: S.kind === "ranking" ? row : undefined, status: can.tools() ? "loading" : "ready", figures: [], trigger };
  S.focus = "card";
  draw();
  tellModel();
  if (!can.tools()) return;
  try {
    const metric = S.report?.measure?.metric;
    const result = await callTool("get_city", { city: id, metrics: [...new Set([...(metric ? [metric] : []), ...BORGO.cardMetrics])] });
    if (S.detail?.id !== id) return;
    S.detail.figures = (result.structuredContent?.figures ?? []).filter((f: Json) => typeof f.value === "number");
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
async function say(text: string): Promise<void> {
  try {
    const r = await request("ui/message", { role: "user", content: [{ type: "text", text }] });
    S.status = ok(r) ? "Sent to the chat." : "The chat did not take the message.";
  } catch (e) {
    S.status = "The chat did not take the message: " + (e as Error).message;
  }
  announce();
}
async function openSite(ids: string[]): Promise<void> {
  const cities = ids.map((id) => ({ id, name: S.known.get(id)?.name ?? id, country: S.known.get(id)?.country ?? "" })).filter((c) => c.country);
  const profile = { ...S.share, weights: { ...(S.share?.weights ?? {}), ...(S.kind === "compare" ? S.weights : {}) } };
  // A city whose country is unknown here is left to the id alone: the site reads ?cities= for those.
  const url = cities.length === ids.length ? shareLink(profile, cities) : BORGO_ORIGIN + "/?cities=" + ids.map(encodeURIComponent).join(",");
  try {
    const r = await request("ui/open-link", { url });
    S.status = ok(r) ? "Opened in Borgo." : "The host did not open the link.";
  } catch (e) {
    S.status = "The host did not open the link: " + (e as Error).message;
  }
  announce();
}
function announce(): void {
  const el = app.querySelector<HTMLElement>('[data-k="status"]');
  if (el) el.textContent = S.status;
  else { S.focus = undefined; draw(); }
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
    let text = "", structured: Json = {};
    if (S.kind === "ranking") {
      const rows = r.rows.slice(0, 10).map((x: Json) => ({ rank: x.rank, id: x.id, name: x.name, value: x.value, unit: x.unit }));
      const q = S.query ?? {};
      structured = { source: "Borgo chart in the chat", chart: "ranking", ranked: r.label, order: r.order, view: r.view, region: q.filters?.region ?? null, shown: r.coverage.returned, matched: r.coverage.matched, top: rows, selected: sel.map((x: Json) => x.id), openCity: open?.id ?? null };
      text = "What the person sees in Borgo's chart: " + r.label + ", " + (r.order === "asc" ? "lowest" : "highest") + " first" + (q.filters?.region ? ", " + BORGO.regions.find((x) => x.id === q.filters.region)?.label : "") + ", " + r.coverage.returned + " of " + r.coverage.matched + " matching cities as " + (r.view === "world" ? "a map" : r.view === "months" ? "month strips" : "bars") + ". Top: " + rows.map((x: Json) => x.rank + ". " + x.name + " " + formatValue(x.value) + " " + x.unit).join("; ") + "." + (sel.length ? " Selected: " + joined(sel.map((x: Json) => x.name)) + "." : "") + (open ? " Looking at " + open.name + "'s card." : "");
    } else {
      const rows = r.ranking.slice(0, 10).map((x: Json) => ({ rank: x.rank, id: x.id, name: x.name, score: x.total }));
      structured = { source: "Borgo chart in the chat", chart: "comparison", weights: S.weights, ranking: rows, openCity: open?.id ?? null };
      text = "What the person sees in Borgo's comparison, with their weights set to " + Object.entries(S.weights).map(([k, v]) => k + " " + v).join(", ") + ": " + rows.map((x: Json) => x.rank + ". " + x.name + " " + number(x.score).toFixed(1)).join("; ") + "." + (open ? " Looking at " + open.name + "'s card." : "");
    }
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
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-open]");
  if (!t || !app.contains(t)) return;
  if (t.dataset.open) return void openCity(t.dataset.open, t.dataset.k);
  const act = t.dataset.act;
  const d = S.detail;
  if (act === "close-card") closeCard();
  else if (act === "ask" && d) void say("Tell me more about living in " + d.name + " for me");
  else if (act === "open-site" && d) void openSite([d.id]);
  else if (act === "toggle-select" && d) {
    S.selected = S.selected.includes(d.id) ? S.selected.filter((x: string) => x !== d.id) : [...S.selected, d.id];
    S.focus = t.dataset.k;
    draw();
    tellModel();
  } else if (act === "compare-chat") void say("Compare " + joined(S.selected.map(nameOf)) + " for me");
  else if (act === "open-selected") void openSite(S.selected);
  else if (act === "open-shown") void openSite((S.kind === "ranking" ? S.report.rows : S.report.ranking).map((x: Json) => x.id));
  else if (act === "clear") { S.selected = []; S.focus = undefined; draw(); tellModel(); }
  else if (act === "reset-weights") { S.weights = { ...S.baseWeights }; S.focus = t.dataset.k; draw(); weightsChanged(); }
  else if (act === "fullscreen") {
    const want = S.mode === "fullscreen" ? "inline" : "fullscreen";
    request("ui/request-display-mode", { mode: want }).then((r) => { S.mode = r?.mode ?? S.mode; S.focus = "act:fullscreen"; draw(); }, () => undefined);
  }
});
app.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.pick) {
    S.selected = t.checked ? [...new Set([...S.selected, t.dataset.pick])] : S.selected.filter((x: string) => x !== t.dataset.pick);
    S.focus = t.dataset.k;
    draw();
    tellModel();
  } else if (t.dataset.ctl && S.query) {
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
  t.setAttribute("aria-valuetext", t.value + " out of 100");
});
app.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset?.open && t.tagName === "circle" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void openCity(t.dataset.open, t.dataset.k); }
  else if (e.key === "Escape" && S.detail) closeCard();
});

// ---------- Theme ----------
function applyContext(c: Json): void {
  if (!c) return;
  ctx = { ...ctx, ...c };
  if (c.displayMode) S.mode = c.displayMode;
  if (c.theme) document.documentElement.style.colorScheme = c.theme;
  document.documentElement.dataset.mode = S.mode;
  for (const [k, v] of Object.entries(c.styles?.variables ?? {})) if (v) document.documentElement.style.setProperty(k, v as string);
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
new ResizeObserver(() => {
  const size = { width: Math.ceil(document.documentElement.scrollWidth), height: Math.ceil(document.documentElement.scrollHeight) };
  const key = size.width + "x" + size.height;
  if (key !== last) { last = key; notify("ui/notifications/size-changed", size); }
}).observe(document.documentElement);
