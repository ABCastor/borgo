// Weather scores as plain day counts: each day of the last five years passes or fails a few tests, computed from hourly
// ERA5 at the city's grid point, and the score is how many days a month pass on average. One home for every threshold;
// docs/weather-scores.md explains where each comes from. Pure functions: the fetcher, the engine and the tests share them.

/** Every threshold of every score, in the units people read: °C, mm, cm, km/h, % of the sky, local clock hours. */
export const RULES = {
  /** "Daytime" is the clock hours 08:00 to 20:00 local, the span WeatherSpark scores (8 am to 9 pm) less its last hour. */
  daytime: { from: 8, to: 20 },
  /** Dry: under 1 mm of rain or snow (as water) falls during the daytime; 1 mm is the usual wet-day line. */
  dryMm: 1,
  /** Nice: dry, at most this share of the sky covered on average in the daytime, and the person's temperature range. */
  niceCloud: 50,
  /** The starting range for the daytime feels-like temperature; each person sets their own (DEFAULT_COMFORT in criteria.ts). */
  comfort: { min: 18, max: 30 },
  /** Beach and pool: dry, sunnier than nice, and the daytime feels hot, after WeatherSpark's beach/pool score. */
  beach: { cloud: 40, min: 24, max: 32 },
  /** Run or ride: two hours in a row between 06:00 and 21:00 without rain or strong wind, feeling cool to mild. */
  active: { from: 6, to: 21, hours: 2, rainMm: 0.1, windKmh: 30, min: 5, max: 22 },
  /** Muggy: the day's average dew point at or above 18 °C, where humid air starts to feel sticky. */
  muggyDew: 18,
  /** Grey: the sky is at least this share covered on average through the daytime. */
  greyCloud: 80,
  /** Hot night: the temperature never drops below 20 °C (the climatologists' "tropical night"). */
  hotNight: 20,
  /** Hot day: the daytime feels-like peaks at 32 °C or more, where strong heat stress begins. */
  hotDay: 32,
  /** Snow day: at least 1 cm of fresh snow. */
  snowCm: 1,
  /** Windy: the daytime wind averages at least this speed (Beaufort 5, "fresh breeze": small trees sway). */
  windyKmh: 30,
} as const;

/** Temperatures binned for live editing of the comfortable range: one bin per whole degree, ends open. */
export const BINS = { from: -5, to: 40 } as const;
export const BIN_COUNT = BINS.to - BINS.from + 1;

/** Hourly series as Open-Meteo returns them, in local time ("YYYY-MM-DDTHH:MM"). Precipitation and snowfall are for the hour before. */
export interface Hourly {
  time: string[];
  temperature_2m: (number | null)[];
  apparent_temperature: (number | null)[];
  dew_point_2m: (number | null)[];
  precipitation: (number | null)[];
  snowfall: (number | null)[];
  cloud_cover: (number | null)[];
  wind_speed_10m: (number | null)[];
}

/** One local day reduced to what the scores read. */
export interface Day {
  date: string;
  /** 0 = January. */
  month: number;
  tmax: number;
  tmin: number;
  fmax: number;
  fmin: number;
  /** Mean air and feels-like temperature over the daytime hours. */
  dayAir: number;
  dayFeels: number;
  /** Peak feels-like temperature in the daytime. */
  dayFeelsMax: number;
  dayCloud: number;
  dayWind: number;
  /** Rain or snow (as water) falling during the daytime, and over the whole day, mm. */
  dayPrecip: number;
  precip: number;
  snow: number;
  dew: number;
  /** A window for a run or a ride exists (RULES.active). */
  active: boolean;
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

interface H {
  temp: number | null;
  feels: number | null;
  dew: number | null;
  precip: number | null;
  snow: number | null;
  cloud: number | null;
  wind: number | null;
}

/**
 * Reduces hourly series to days. A day counts only when it has every hour's air temperature (22 or more hours, to allow
 * for clock changes) and every daytime value; an incomplete day is left out rather than half-read.
 */
export function toDays(h: Hourly): Day[] {
  const byDate = new Map<string, Map<number, H>>();
  h.time.forEach((t, i) => {
    const date = t.slice(0, 10);
    const hour = Number(t.slice(11, 13));
    let m = byDate.get(date);
    if (!m) byDate.set(date, (m = new Map()));
    // A repeated clock hour (autumn clock change) keeps its first reading.
    if (!m.has(hour))
      m.set(hour, {
        temp: h.temperature_2m[i] ?? null,
        feels: h.apparent_temperature[i] ?? null,
        dew: h.dew_point_2m[i] ?? null,
        precip: h.precipitation[i] ?? null,
        snow: h.snowfall[i] ?? null,
        cloud: h.cloud_cover[i] ?? null,
        wind: h.wind_speed_10m[i] ?? null,
      });
  });
  const out: Day[] = [];
  const { from, to } = RULES.daytime;
  for (const [date, hours] of byDate) {
    const all = [...hours.values()];
    if (all.length < 22 || all.some((x) => x.temp === null || x.feels === null)) continue;
    const day: H[] = [];
    for (let k = from; k <= to; k++) {
      const x = hours.get(k);
      if (!x || x.cloud === null || x.wind === null) break;
      day.push(x);
    }
    // Precipitation is stamped at the end of its hour: 09:00 to 20:00 covers the daytime 08:00 to 20:00.
    const rain: number[] = [];
    for (let k = from + 1; k <= to; k++) {
      const p = hours.get(k)?.precip;
      if (p == null) break;
      rain.push(p);
    }
    if (day.length !== to - from + 1 || rain.length !== to - from) continue;
    const dews = all.map((x) => x.dew).filter((x): x is number => x !== null);
    if (dews.length < 22) continue;
    out.push({
      date,
      month: Number(date.slice(5, 7)) - 1,
      tmax: Math.max(...all.map((x) => x.temp!)),
      tmin: Math.min(...all.map((x) => x.temp!)),
      fmax: Math.max(...all.map((x) => x.feels!)),
      fmin: Math.min(...all.map((x) => x.feels!)),
      dayAir: avg(day.map((x) => x.temp!)),
      dayFeels: avg(day.map((x) => x.feels!)),
      dayFeelsMax: Math.max(...day.map((x) => x.feels!)),
      dayCloud: avg(day.map((x) => x.cloud!)),
      dayWind: avg(day.map((x) => x.wind!)),
      dayPrecip: sum(rain),
      precip: sum(all.map((x) => x.precip ?? 0)),
      snow: sum(all.map((x) => x.snow ?? 0)),
      dew: avg(dews),
      active: hasActiveWindow(hours),
    });
  }
  return out;
}

/** Two clock hours in a row (RULES.active) that feel cool to mild, without strong wind, and with no rain in the hour after. */
function hasActiveWindow(hours: Map<number, H>): boolean {
  const a = RULES.active;
  let run = 0;
  for (let k = a.from; k < a.to; k++) {
    const x = hours.get(k);
    const next = hours.get(k + 1);
    const ok = !!x && x.feels !== null && x.wind !== null && x.feels >= a.min && x.feels <= a.max && x.wind < a.windKmh && (next?.precip ?? Infinity) < a.rainMm;
    run = ok ? run + 1 : 0;
    if (run >= a.hours) return true;
  }
  return false;
}

/** The sky and rain tests of a nice day, before temperature (which the person sets). */
export const niceSky = (d: Day) => d.dayPrecip < RULES.dryMm && d.dayCloud <= RULES.niceCloud;

/** The fixed scores: a test per day, with the metric it fills. */
export const DAY_SCORES: { metric: string; test: (d: Day) => boolean }[] = [
  { metric: "beach_days", test: (d) => d.dayPrecip < RULES.dryMm && d.dayCloud <= RULES.beach.cloud && d.dayFeels >= RULES.beach.min && d.dayFeels <= RULES.beach.max },
  { metric: "active_days", test: (d) => d.active },
  { metric: "muggy_days", test: (d) => d.dew >= RULES.muggyDew },
  { metric: "grey_days", test: (d) => d.dayCloud >= RULES.greyCloud },
  { metric: "hot_nights", test: (d) => d.tmin > RULES.hotNight },
  { metric: "hot_days", test: (d) => d.dayFeelsMax >= RULES.hotDay },
  { metric: "snow_days", test: (d) => d.snow >= RULES.snowCm },
  { metric: "windy_days", test: (d) => d.dayWind >= RULES.windyKmh },
];

/** Average calendar days in each month over the period the days cover (February 28.2 over 2021-2025). */
function calendarDays(days: Day[]): number[] {
  const years = new Set(days.map((d) => d.date.slice(0, 4)));
  const n = years.size || 1;
  return Array.from({ length: 12 }, (_, m) => {
    let total = 0;
    for (const y of years) total += new Date(Date.UTC(Number(y), m + 1, 0)).getUTCDate();
    return total / n;
  });
}

/**
 * Days a month that pass `test`, on average: the share of readable days that pass, times the month's length, so a
 * missing day neither adds nor removes a nice one.
 */
export function daysPerMonth(days: Day[], test: (d: Day) => boolean): number[] {
  const len = calendarDays(days);
  const pass = new Array(12).fill(0);
  const seen = new Array(12).fill(0);
  for (const d of days) {
    seen[d.month]++;
    if (test(d)) pass[d.month]++;
  }
  return pass.map((p, m) => (seen[m] ? (p / seen[m]) * len[m]! : NaN));
}

export const binOf = (t: number) => Math.min(BIN_COUNT - 1, Math.max(0, Math.round(t) - BINS.from));

/**
 * Days a month that pass the nice-day sky tests, by their daytime temperature in whole degrees: 12 months of BIN_COUNT
 * bins, January first, the first bin holding everything colder and the last everything hotter. Summing the bins inside a
 * range gives that range's nice days, so the range can change without fetching again.
 */
export function niceBins(days: Day[], basis: "feels" | "air"): number[] {
  const len = calendarDays(days);
  const seen = new Array(12).fill(0);
  const bins = new Array(12 * BIN_COUNT).fill(0);
  for (const d of days) {
    seen[d.month]++;
    if (niceSky(d)) bins[d.month * BIN_COUNT + binOf(basis === "feels" ? d.dayFeels : d.dayAir)]++;
  }
  return bins.map((b, i) => {
    const m = Math.floor(i / BIN_COUNT);
    return seen[m] ? (b / seen[m]) * len[m]! : NaN;
  });
}

/** Nice days by month for a comfortable range, from the bins. A whole-degree range includes both ends. */
export function niceDaysByMonth(bins: number[], min: number, max: number): number[] {
  const lo = Math.ceil(min), hi = Math.floor(max);
  return Array.from({ length: 12 }, (_, m) => {
    let n = 0;
    for (let b = 0; b < BIN_COUNT; b++) {
      const t = BINS.from + b;
      // The open ends: the first bin is "this or colder", the last "this or hotter".
      const inRange = (t >= lo || (b === 0 && lo <= BINS.from)) && (t <= hi || (b === BIN_COUNT - 1 && hi >= BINS.to));
      if (inRange) n += bins[m * BIN_COUNT + b] ?? 0;
    }
    return n;
  });
}

/** The q-quantile (0..1) of a list, linear between neighbours. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** A per-month statistic of a daily value: mean, a percentile, the lowest or the highest. */
export function monthly(days: Day[], pick: (d: Day) => number, stat: (xs: number[]) => number): number[] {
  const acc = Array.from({ length: 12 }, () => [] as number[]);
  for (const d of days) acc[d.month]!.push(pick(d));
  return acc.map((a) => (a.length ? stat(a) : NaN));
}

export const mean = (xs: number[]) => (xs.length ? avg(xs) : NaN);
