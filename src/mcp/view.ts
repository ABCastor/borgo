// The Borgo chart as an MCP App view (extension io.modelcontextprotocol/ui): one HTML document the host renders in a
// sandboxed iframe, fed the compare_cities or rank_cities result over postMessage, and, where the host allows it,
// asking Borgo's tools again from a click (the program is src/mcp/view-client.ts). It needs no network, so it declares
// no CSP domains.
import { chartSource, clientSource } from "./chart-source.ts";
import { CARD_METRICS, LIMIT_CHOICES, measures, REGION_CHOICES } from "./measures.ts";
import { SERVER_VERSION } from "./tools.ts";
import { APPS_PROTOCOL } from "./view-id.ts";

export { APPS_PROTOCOL, VIEW_MIME, VIEW_URI } from "./view-id.ts";

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
:root{--rank-accent:light-dark(#287069,#75c8bb);--on-accent:light-dark(#ffffff,#10201e)}
.source{display:block;font-size:11px}.bar-row{margin:12px 0}.bar-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.bar-track{height:9px;background:var(--color-border-primary);margin:5px 0}.rank-bar{height:100%;background:var(--rank-accent)}
.month-view{overflow-x:auto}.month-cell{font-variant-numeric:tabular-nums}small{font-weight:normal}a{color:inherit}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
button,select,input{font:inherit;color:inherit}
.btn,.city-btn,select{min-height:44px;box-sizing:border-box;border-radius:var(--border-radius-md);border:1px solid var(--color-border-primary);background:transparent;cursor:pointer}
.btn{padding:0 14px}.btn.primary{background:var(--rank-accent);border-color:var(--rank-accent);color:var(--on-accent)}
.btn[aria-pressed=true]{border-color:var(--rank-accent);box-shadow:inset 0 0 0 1px var(--rank-accent)}
.city-btn{padding:0 6px;border-color:transparent;text-align:left;text-decoration:underline;text-decoration-color:var(--color-border-primary);text-underline-offset:3px}
.city-btn:hover{border-color:var(--color-border-primary)}
select{padding:0 8px;max-width:100%}
:is(button,select,input,summary,[tabindex]):focus-visible{outline:2px solid var(--rank-accent);outline-offset:2px}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:0 0 8px}
.field{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--color-text-secondary)}
.status{min-height:1.4em;margin:2px 0 6px}
.rank-table td,.rank-table th,.compare-table td{vertical-align:middle}
.tick{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin:-8px -6px;cursor:pointer}
.tick input{width:20px;height:20px;accent-color:var(--rank-accent)}
tr.on{background:color-mix(in srgb,var(--rank-accent) 12%,transparent)}
.city-dot{cursor:pointer}.city-dot.on{stroke-width:2.5}
.selection,.card{border:1px solid var(--color-border-primary);border-radius:var(--border-radius-md);padding:8px 12px;margin:10px 0}
.selection{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.selection p{flex:1 1 100%;margin:0}
.hint{font-size:12px}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.card-head h3{margin:0;font-size:15px}
.card p{margin:6px 0}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.weights{display:block;border:1px solid var(--color-border-primary);border-radius:var(--border-radius-md);padding:6px 12px}
.weights summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}
.sliders{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));column-gap:24px}
.slider{display:grid;grid-template-columns:minmax(90px,140px) 1fr 3ch;gap:8px;align-items:center;min-height:44px}
.slider input[type=range]{width:100%;min-height:44px;accent-color:var(--rank-accent);margin:0}
.slider output{font-variant-numeric:tabular-nums;text-align:right}
:root[data-mode=fullscreen] svg.world-view{max-height:calc(100vh - 220px)}
@media (max-width:420px){.sliders{grid-template-columns:1fr}.slider{grid-template-columns:1fr 3ch}.slider label{grid-column:1/-1}}
@media (prefers-reduced-motion:no-preference){.btn,.city-btn{transition:border-color .12s}}
`;

// The view's program is src/mcp/view-client.ts; this is what it is told about Borgo at build time.
const BORGO = { protocol: APPS_PROTOCOL, version: SERVER_VERSION, measures: measures(), regions: REGION_CHOICES, limits: LIMIT_CHOICES, cardMetrics: CARD_METRICS };

let cached: string | null = null;

/** The view document. The chart and client code are the sources themselves, with their types stripped. */
export function viewHtml(): string {
  if (cached) return cached;
  const json = JSON.stringify(BORGO).replace(/</g, "\\u003c");
  cached = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Borgo</title><style>${STYLE}</style></head><body><div id="app"><p class="quiet">Waiting for the answer…</p></div><script type="module">\n${chartSource()}\nconst BORGO = ${json};\n${clientSource()}</script></body></html>`;
  return cached;
}
