// Climate of the last five full years at the city's coordinates, from Open-Meteo's archive of the ERA5 reanalysis
// (CC BY 4.0). One hourly request (seven variables, so Open-Meteo counts it as about 130 calls, like the old one) gives
// air and "feels like" (apparent) temperature, their monthly averages, spreads and extremes, hourly temperature by
// month, cloud cover, wet days and the weather-day scores of src/core/weather-days.ts. Daily figures are derived here
// from the hours, as Open-Meteo derives its own. Sunshine is deliberately NOT taken from here: ERA5's
// sunshine_duration overstates measured hours by 30-90% (see registry/open-meteo-era5.json).
import type { Observation } from "../core/types.ts";
import { DAY_SCORES, daysPerMonth, mean, monthly, niceBins, quantile, toDays, type Hourly } from "../core/weather-days.ts";
import { lastFullYears, round, type Fetcher } from "./context.ts";

interface Archive {
  elevation?: number;
  hourly: Hourly;
}

const VERSION = 3;

export const HOURLY = ["temperature_2m", "apparent_temperature", "dew_point_2m", "precipitation", "snowfall", "cloud_cover", "wind_speed_10m"] as const;

export function archiveUrl(lat: number, lon: number, start: string, end: string): string {
  return `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&timezone=auto&hourly=${HOURLY.join(",")}`;
}

const finite = (v: number[]) => v.every(Number.isFinite);

/** Turns one archive response into observations. Exported for tests. */
export function climateObservations(a: Archive, meta: { period: string; years: number; retrieved: string; url: string }): Observation[] {
  const base = { period: meta.period, level: "city" as const, source: "open-meteo-era5", retrieved: meta.retrieved, url: meta.url, fetcher: `open-meteo-era5@${VERSION}` };
  const days = toDays(a.hourly);
  const m = (pick: Parameters<typeof monthly>[1], stat: Parameters<typeof monthly>[2], d = 1) => monthly(days, pick, stat).map((x) => round(x, d));
  const p = (q: number) => (xs: number[]) => quantile(xs, q);

  // Hourly times are local (timezone=auto): "T15:00" on a July date is 3 pm in July.
  const hours = Array.from({ length: 288 }, () => [] as number[]);
  const cloud = Array.from({ length: 12 }, () => [] as number[]);
  a.hourly.time.forEach((t, i) => {
    const mo = Number(t.slice(5, 7)) - 1;
    const h = Number(t.slice(11, 13));
    const v = a.hourly.temperature_2m[i];
    if (v != null) hours[mo * 24 + h]!.push(v);
    const c = a.hourly.cloud_cover[i];
    if (c != null) cloud[mo]!.push(c);
  });
  const wetPerMonth = daysPerMonth(days, (d) => d.precip >= 1);
  const note = "ERA5 reanalysis at the city's coordinates (a grid about 25 km wide)";
  const air = `Air temperature in the shade. ${note}`;
  const span = `${note}; ${meta.period} only, so a rarer extreme can lie outside it`;
  const scoreNote = `Days a month on average, ${meta.period}; the test is in docs/weather-scores.md. ${note}`;
  const obs: Observation[] = [
    { metric: "temp_high", value: m((d) => d.tmax, mean), ...base, note: air },
    { metric: "temp_low", value: m((d) => d.tmin, mean), ...base, note: air },
    { metric: "feels_high", value: m((d) => d.fmax, mean), ...base, note: `Apparent temperature: air temperature adjusted for humidity, wind and sun. ${note}` },
    { metric: "feels_low", value: m((d) => d.fmin, mean), ...base, note: `Apparent temperature: air temperature adjusted for humidity and wind. ${note}` },
    { metric: "temp_high_p10", value: m((d) => d.tmax, p(0.1)), ...base, note: air },
    { metric: "temp_high_p90", value: m((d) => d.tmax, p(0.9)), ...base, note: air },
    { metric: "temp_low_p10", value: m((d) => d.tmin, p(0.1)), ...base, note: air },
    { metric: "temp_low_p90", value: m((d) => d.tmin, p(0.9)), ...base, note: air },
    { metric: "temp_record_high", value: m((d) => d.tmax, (xs) => Math.max(...xs)), ...base, note: `Air temperature in the shade. ${span}` },
    { metric: "temp_record_low", value: m((d) => d.tmin, (xs) => Math.min(...xs)), ...base, note: `Air temperature in the shade. ${span}` },
    { metric: "temp_hourly", value: hours.map((h) => round(mean(h))), ...base, note: `Air temperature by local hour, January 0:00 to December 23:00. ${note}` },
    { metric: "cloud_cover", value: cloud.map((c) => Math.round(mean(c))), ...base, note },
    { metric: "wet_days_monthly", value: wetPerMonth.map((n) => round(n)), ...base, note },
    { metric: "wet_days", value: Math.round(wetPerMonth.reduce((x, y) => x + y, 0)), ...base, note },
    { metric: "nice_bins_feels", value: niceBins(days, "feels").map((x) => round(x)), ...base, note: `Dry, mostly clear days by their daytime feels-like temperature, whole degrees from -5 to 40 °C, by month. ${scoreNote}` },
    { metric: "nice_bins_air", value: niceBins(days, "air").map((x) => round(x)), ...base, note: `Dry, mostly clear days by their daytime air temperature, whole degrees from -5 to 40 °C, by month. ${scoreNote}` },
    ...DAY_SCORES.map((s) => ({ metric: s.metric, value: daysPerMonth(days, s.test).map((x) => round(x)), ...base, note: scoreNote })),
  ];
  return obs.filter((o) => (Array.isArray(o.value) ? finite(o.value) : Number.isFinite(o.value)));
}

export const openMeteo: Fetcher = {
  source: "open-meteo-era5",
  version: VERSION,
  runtimes: ["browser", "node"],
  async fetch(city, ctx) {
    const y = lastFullYears(ctx.now());
    const url = archiveUrl(city.lat, city.lon, y.start, y.end);
    const a = await ctx.json<Archive>(url);
    return climateObservations(a, { period: y.period, years: y.years, retrieved: ctx.now().toISOString(), url });
  },
};
