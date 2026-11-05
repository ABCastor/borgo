// Fine dust (PM2.5), modelled: the Copernicus atmosphere model (CAMS) through Open-Meteo, CC BY 4.0, averaged over
// the last full year at the city's coordinates. A fallback: the measured WHO figure (src/fetch/node/who-air.ts, CLI
// and MCP) is preferred, so this runs only where WHO has no station or cannot be read (the browser).
import { round, type Fetcher } from "./context.ts";

export const cams: Fetcher = {
  source: "open-meteo-cams",
  version: 1,
  runtimes: ["browser", "node"],
  fallbackFor: "who-aqdb",
  async fetch(city, ctx) {
    const year = ctx.now().getUTCFullYear() - 1;
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&start_date=${year}-01-01&end_date=${year}-12-31&hourly=pm2_5&timezone=auto`;
    const r = await ctx.json<{ hourly: { time: string[]; pm2_5: (number | null)[] } }>(url);
    const v = r.hourly.pm2_5.filter((x): x is number => x != null);
    // A year with large holes would bias the mean towards whichever season is present.
    if (v.length < r.hourly.time.length * 0.8) return [];
    return [{ metric: "pm25", value: round(v.reduce((a, b) => a + b, 0) / v.length), period: String(year), level: "city", source: "open-meteo-cams", retrieved: ctx.now().toISOString(), url, fetcher: "open-meteo-cams@1", note: "Modelled (CAMS), not measured: the mean of every hour of the year" }];
  },
};
