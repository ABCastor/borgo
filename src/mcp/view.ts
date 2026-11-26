// Borgo's answers as an MCP App view (extension io.modelcontextprotocol/ui): one HTML document the host renders in a
// sandboxed iframe, fed the result of rank_cities, compare_cities, get_city or net_pay over postMessage, and, where the
// host allows it, asking Borgo's tools again from a click (the program is src/mcp/view-client.ts, what it draws
// src/mcp/view-draw.ts). It looks like the site because its CSS is built from the site's (src/mcp/view-style.ts) and it
// carries the site's fonts as bytes. It needs no network, so it declares no CSP domains.
import { chartSource, clientSource, literal, styleSource } from "./chart-source.ts";
import { CARD_METRICS, CLIMATE_METRICS, LIMIT_CHOICES, measures, REGION_CHOICES } from "./measures.ts";
import { SERVER_VERSION } from "./tools.ts";
import { APPS_PROTOCOL } from "./view-id.ts";

export { APPS_PROTOCOL, VIEW_MIME, VIEW_URI } from "./view-id.ts";

// What the view's program is told about Borgo at build time.
const BORGO = { protocol: APPS_PROTOCOL, version: SERVER_VERSION, measures: measures(), regions: REGION_CHOICES, limits: LIMIT_CHOICES, cardMetrics: CARD_METRICS, climateMetrics: CLIMATE_METRICS };

let cached: string | null = null;

/** The view document. The chart and client code are the sources themselves, with their types stripped. */
export function viewHtml(): string {
  if (cached) return cached;
  const { css, fonts } = styleSource();
  cached = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Borgo</title><style>${css}</style></head><body><div id="app"><p class="wait">Waiting for the answer…</p></div><script type="module">\nconst BORGO_FONTS = ${literal(fonts)};\n${chartSource()}\nconst BORGO = ${literal(BORGO)};\n${clientSource()}</script></body></html>`;
  return cached;
}
