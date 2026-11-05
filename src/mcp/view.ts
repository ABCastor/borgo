// The compare chart as an MCP App view (extension io.modelcontextprotocol/ui, January 2026 spec): one HTML
// document the host renders in a sandboxed iframe, fed the compare_cities result over postMessage.
// It needs no network, so it declares no CSP domains.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { ROOT } from "../agent/dataset.ts";

export const VIEW_URI = "ui://borgo/compare.html";
export const VIEW_MIME = "text/html;profile=mcp-app";
export const APPS_PROTOCOL = "2026-01-26";

const STYLE = `
:root{color-scheme:light dark;
--color-text-primary:light-dark(#1f1d1a,#efebe4);--color-text-secondary:light-dark(#5f5a52,#b7b0a5);
--color-background-primary:transparent;--color-border-primary:light-dark(#dcd6cc,#3a3732);
--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--border-radius-md:8px}
body{margin:0;padding:12px 14px;font:13px/1.45 var(--font-sans);color:var(--color-text-primary);background:var(--color-background-primary)}
h2{font-size:15px;margin:0 0 8px}h3{font-size:13px;margin:14px 0 6px}
.quiet{color:var(--color-text-secondary)}
table{border-collapse:collapse;width:100%;margin:6px 0}
td,th{padding:4px 6px;border-bottom:1px solid var(--color-border-primary);text-align:left;vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
svg{max-width:100%;height:auto;display:block;margin:6px 0}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0}
`;

// Runs in the view, after chart.ts (which provides compareSvg, chartInput, esc and money). A minimal
// JSON-RPC client over postMessage, as the spec allows, so the view ships no SDK.
const BRIDGE = `
const host = window.parent;
let nextId = 1;
const pending = new Map();
const send = (msg) => host.postMessage({ jsonrpc: "2.0", ...msg }, "*");
const request = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); send({ id, method, params }); });
const notify = (method, params) => send({ method, params });

function applyContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) document.documentElement.style.colorScheme = ctx.theme;
  for (const [k, v] of Object.entries(ctx.styles?.variables ?? {})) if (v) document.documentElement.style.setProperty(k, v);
}

const app = document.getElementById("app");
function render(report) {
  if (!report || !Array.isArray(report.cities)) return;
  const cur = report.displayCurrency;
  const rows = report.ranking.map((r) => "<tr><td class=n>" + r.rank + "</td><td>" + esc(r.name) + "</td><td class=n>" + r.total.toFixed(1) +
    "</td><td class=n>" + Math.round(r.coverage * 100) + "%</td><td class=n>" + (r.monthlyLeft === null ? "–" : money(r.monthlyLeft, cur)) + "</td><td>" + esc(r.ruledOut.join(", ")) + "</td></tr>").join("");
  const why = report.cities.map((c) => "<li><b>" + esc(c.name) + ".</b> " + esc(c.why.join(" ")) + "</li>").join("");
  const add = report.whatToAdd.map((x) => "<li>" + esc(x) + "</li>").join("");
  app.innerHTML = "<h2>Borgo: " + esc(report.cities.map((c) => c.name).join(", ")) + "</h2>" +
    compareSvg(chartInput(report), 720) +
    "<table><thead><tr><th class=n>#</th><th>City</th><th class=n>Score</th><th class=n>Data</th><th class=n>Left a month (" + esc(cur) + ")</th><th>Ruled out by</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    "<h3>Why</h3><ul>" + why + "</ul>" + (add ? "<h3>What to add</h3><ul>" + add + "</ul>" : "") +
    "<p class=quiet>Dataset " + esc(report.dataset.version) + ". Your weights; no ranking is objective.</p>";
}

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
  if (m.method === "ui/notifications/tool-result") {
    try {
      render(m.params?.structuredContent);
    } catch (e) {
      app.textContent = "Could not draw the comparison: " + e.message;
      notify("notifications/message", { level: "error", logger: "borgo view", data: String(e) });
    }
  }
  else if (m.method === "ui/notifications/host-context-changed") applyContext(m.params);
  else if (m.method === "ui/resource-teardown" || m.method === "ping") send({ id: m.id, result: {} });
});

const init = await request("ui/initialize", {
  appInfo: { name: "borgo compare", version: "0.1.0" },
  appCapabilities: { availableDisplayModes: ["inline"] },
  protocolVersion: "${APPS_PROTOCOL}",
});
applyContext(init?.hostContext);
notify("ui/notifications/initialized", {});
let last = "";
new ResizeObserver(() => {
  const size = { width: Math.ceil(document.documentElement.scrollWidth), height: Math.ceil(document.documentElement.scrollHeight) };
  const key = size.width + "x" + size.height;
  if (key !== last) { last = key; notify("ui/notifications/size-changed", size); }
}).observe(document.documentElement);
`;

let cached: string | null = null;

/** The view document. The chart code is src/agent/chart.ts itself, with its types stripped. */
export function viewHtml(): string {
  if (cached) return cached;
  const chart = stripTypeScriptTypes(readFileSync(join(ROOT, "src/agent/chart.ts"), "utf8"));
  cached = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Borgo comparison</title><style>${STYLE}</style></head><body><div id="app"><p class="quiet">Waiting for the comparison…</p></div><script type="module">\n${chart}\n${BRIDGE}</script></body></html>`;
  return cached;
}
