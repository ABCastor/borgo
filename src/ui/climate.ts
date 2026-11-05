import { niceDays } from "../core/criteria.ts";
import { resolve, series, type Resolved } from "../core/lookup.ts";
import { monthlyDaylight } from "../core/sun.ts";
import type { City } from "../core/types.ts";
import { html, raw, type Raw } from "./dom.ts";
import { local, MONTHS, MONTH_NAMES, num, temp, tempUnit, tempValue } from "./format.ts";
import type { AppState } from "./state.ts";
import { term } from "./terms.ts";

// The climate views, drawn from whatever the city's data holds. Average highs and lows always; feels-like,
// the hour-by-hour year, cloud, rain and sunshine when present; the typical range and the records when a
// source provides them (matched by metric id, so new fields show up without touching this file).

export const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Climate {
  hi: number[];
  lo: number[];
  fhi: number[] | null;
  flo: number[] | null;
  /** 288 values: 24 local hours for each month, January first. */
  hourly: number[] | null;
  cloud: number[] | null;
  wet: number[] | null;
  /** Measured sunshine hours per month, from a station. */
  sun: number[] | null;
  sunYear: number | null;
  sunNote: string | null;
  daylight: number[];
  recHi: number[] | null;
  recLo: number[] | null;
  typHi: number[] | null;
  typLo: number[] | null;
  /** Nice days a month for the person's range and basis; null until the city has the nice-day counts. */
  nice: number[] | null;
  /** Other weather-day counts by month (beach, run or ride, muggy…), by metric id, where the data has them. */
  days: Record<string, number[]>;
  source: Resolved;
}

/** The weather-day counts shown in a dossier, in reading order: the good kinds first. */
export const DAY_METRICS = ["beach_days", "active_days", "grey_days", "muggy_days", "hot_days", "hot_nights", "snow_days", "windy_days"];

type Comfort = { min: number; max: number; basis?: "feels" | "air" };

/** Charts are drawn narrower on a phone so their labels stay readable at the screen's width. */
export const narrow = () => typeof innerWidth === "number" && innerWidth < 600;

/** Monthly metric ids the data may carry for the extremes, found by name (records and typical ranges). */
function extremeIds(s: AppState): { recHi?: string; recLo?: string; typHi?: string; typLo?: string } {
  const ids = Object.values(s.data.metrics).filter((m) => m.shape === "monthly" && m.category === "climate").map((m) => m.id);
  const find = (re: RegExp) => ids.find((id) => re.test(id) && !/feels/.test(id));
  return {
    recHi: find(/^(temp_)?(record|extreme|max)_?high|^temp_high_(record|max|extreme)|^temp_max_(record|extreme)/),
    recLo: find(/^(temp_)?(record|extreme|min)_?low|^temp_low_(record|min|extreme)|^temp_min_(record|extreme)/),
    typHi: find(/^temp_high_p(9\d)|^temp_high_typical|^temp_(typical|p9\d)_high/),
    typLo: find(/^temp_low_p(0?\d|1\d)$|^temp_low_typical|^temp_(typical|p0?\d|p1\d)_low/),
  };
}

export function climateOf(s: AppState, city: City): Climate | null {
  const get = (id: string | undefined) => (id ? series(resolve(s.data, s.profile, city, id)) : null);
  const hiR = resolve(s.data, s.profile, city, "temp_high");
  const hi = series(hiR);
  const lo = get("temp_low");
  if (!hi || !lo || !hiR) return null;
  const x = extremeIds(s);
  const sunR = resolve(s.data, s.profile, city, "sunshine_monthly");
  const sun = series(sunR);
  const hourly = get("temp_hourly");
  return {
    hi,
    lo,
    fhi: get("feels_high"),
    flo: get("feels_low"),
    hourly: hourly && hourly.length === 288 ? hourly : null,
    cloud: get("cloud_cover"),
    wet: get("wet_days_monthly"),
    sun,
    sunYear: sun ? sun.reduce((a, b) => a + b, 0) : null,
    sunNote: sunR?.origin.kind === "source" ? sunR.origin.observation.note ?? null : null,
    daylight: monthlyDaylight(city.lat),
    recHi: get(x.recHi),
    recLo: get(x.recLo),
    typHi: get(x.typHi),
    typLo: get(x.typLo),
    nice: niceDays(s.data, s.profile, city)?.months ?? null,
    days: Object.fromEntries(DAY_METRICS.map((id) => [id, get(id)]).filter((e): e is [string, number[]] => !!e[1])),
    source: hiR,
  };
}

// ---------- Temperature bands, set from the person's own range ----------

export function bands(k: Comfort) {
  return [
    { k: "b0", to: k.min - 16, name: "freezing" },
    { k: "b1", to: k.min - 8, name: "cold" },
    { k: "b2", to: k.min, name: "cool" },
    { k: "b3", to: k.max, name: "comfortable" },
    { k: "b4", to: k.max + 5, name: "warm" },
    { k: "b5", to: k.max + 10, name: "hot" },
    { k: "b6", to: Infinity, name: "sweltering" },
  ];
}

export function bandOf(t: number, k: Comfort): number {
  const b = bands(k);
  const i = b.findIndex((x, j) => t < x.to || (j === 3 && t <= x.to));
  return i < 0 ? b.length - 1 : i;
}

export function bandLegend(k: Comfort): Raw {
  const b = bands(k);
  return html`<ul class="legend">${b.map((x, i) => {
    const lo = i === 0 ? null : b[i - 1]!.to;
    const r = lo === null ? `below ${temp(x.to, { short: true })}` : x.to === Infinity ? `above ${temp(lo, { short: true })}` : `${tempValue(lo)} to ${temp(x.to, { short: true })}`;
    return html`<li><i class="sw ${x.k}"></i>${x.name} <span>${r}</span></li>`;
  })}</ul>`;
}

/** Temperature at a day of the year (0-364) and hour, interpolated between the month averages. */
export function hourAt(hourly: number[], day: number, hour: number): number {
  const p = ((day + 0.5) / 365) * 12 - 0.5;
  const f = p - Math.floor(p);
  const m0 = (Math.floor(p) + 12) % 12;
  const m1 = (m0 + 1) % 12;
  return hourly[m0 * 24 + hour]! * (1 - f) + hourly[m1 * 24 + hour]! * f;
}

/** The band colours as the page resolves them (light or dark), read once per paint through a probe element. */
function bandColours(host: Element): string[] {
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.parentElement?.append(probe);
  const out = ["b0", "b1", "b2", "b3", "b4", "b5", "b6"].map((k) => {
    probe.style.color = `var(--${k})`;
    return getComputedStyle(probe).color || "#999";
  });
  probe.remove();
  return out;
}

/** Paints the year, day by day across and hour by hour down, in the person's bands. Colours come from CSS. */
export function drawHours(canvas: HTMLCanvasElement, hourly: number[], k: Comfort): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 60;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const x = canvas.getContext("2d");
  if (!x) return;
  x.scale(dpr, dpr);
  const cols = bandColours(canvas);
  const days = Math.max(52, Math.min(365, Math.round(w)));
  const cw = w / days;
  const ch = h / 24;
  for (let d = 0; d < days; d++) {
    const day = (d / days) * 365;
    for (let hr = 0; hr < 24; hr++) {
      x.fillStyle = cols[bandOf(hourAt(hourly, day, hr), k)]!;
      x.fillRect(Math.floor(d * cw), Math.floor(hr * ch), Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
    }
  }
}

/** What the person is pointing at on the hour map. */
export function hourReadout(hourly: number[], k: Comfort, fx: number, fy: number): string {
  const day = Math.max(0, Math.min(364, Math.floor(fx * 365)));
  const hour = Math.max(0, Math.min(23, Math.floor(fy * 24)));
  const d = new Date(Date.UTC(2025, 0, 1 + day));
  const t = hourAt(hourly, day, hour);
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}, ${String(hour).padStart(2, "0")}:00 · ${temp(t, { decimals: 1 })} in the air · ${bands(k)[bandOf(t, k)]!.name} for you`;
}

export function hourCanvas(cityId: string, kind: "strip" | "map", label: string): Raw {
  return html`<canvas class="hours hours-${kind}" data-hours="${cityId}" role="img" aria-label="${label}"></canvas>`;
}

/** Nice days in each month as twelve small columns, so the good season shows at a glance. */
export function niceStrip(c: Climate, cityName: string, k?: Comfort): Raw {
  if (!c.nice) {
    // Until the nice-day counts arrive: the usual afternoon high of each month against the range, from data the city has.
    if (!k) return html``;
    const feels = (k.basis ?? "feels") === "feels" && !!c.fhi;
    const hi = feels ? c.fhi! : c.hi;
    return html`<span class="mstrip" role="img" aria-label="${cityName}: usual afternoon high against your range, by month">${hi.map((t, i) => {
      const st = t < k.min ? "below" : t > k.max ? "above" : "in";
      return html`<i class="${st}" title="${MONTH_NAMES[i]}: usual high ${temp(t, { short: true })}${feels ? " (feels like)" : ""}, ${st === "in" ? "in your range" : st === "below" ? "below your range" : "above your range"}">${MONTHS[i]}</i>`;
    })}</span>`;
  }
  const total = Math.round(c.nice.reduce((a, b) => a + b, 0));
  return html`<span class="nstrip" role="img" aria-label="${cityName}: ${total} nice days a year, by month">${c.nice.map(
    (n, i) => html`<span class="nm" title="${MONTH_NAMES[i]}: ${num(n, 0)} nice days"><i style="height:${Math.max(4, Math.min(100, (n / 31) * 100)).toFixed(1)}%"></i><b>${MONTHS[i]}</b></span>`,
  )}</span>`;
}

export const niceTotal = (c: Climate | null) => (c?.nice ? Math.round(c.nice.reduce((a, b) => a + b, 0)) : null);

export function warmCold(c: Climate): { warm: string; cold: string } {
  const w = c.hi.indexOf(Math.max(...c.hi));
  const k = c.lo.indexOf(Math.min(...c.lo));
  return { warm: `${MON3[w]} ${temp(c.hi[w]!, { short: true })}`, cold: `${MON3[k]} ${temp(c.lo[k]!, { short: true })}` };
}

// ---------- The chart he likes: each month's low to high, over his comfortable band ----------

export function monthChart(c: Climate, k: Comfort, o: { measure?: "air" | "feels"; editable?: boolean; cityName: string }): Raw {
  const feels = o.measure === "feels" && !!c.fhi && !!c.flo;
  const hi = feels ? c.fhi! : c.hi;
  const lo = feels ? c.flo! : c.lo;
  const recHi = feels ? null : c.recHi;
  const recLo = feels ? null : c.recLo;
  const typHi = feels ? null : c.typHi;
  const typLo = feels ? null : c.typLo;
  const W = narrow() ? 400 : 680, H = narrow() ? 296 : 318, padL = 30, padR = o.editable ? 46 : 8, top = 22, bot = c.nice ? 44 : 26;
  const all = [...hi, ...lo, ...(recHi ?? []), ...(recLo ?? []), ...(typHi ?? []), ...(typLo ?? []), k.min, k.max];
  const tMin = Math.floor((Math.min(-5, ...all) - 2) / 5) * 5;
  const tMax = Math.ceil((Math.max(32, ...all) + 2) / 5) * 5;
  const y = (t: number) => top + (H - top - bot) * (1 - (t - tMin) / (tMax - tMin));
  const plotR = W - padR;
  const bw = (plotR - padL) / 12;
  const nice = c.nice;
  const ticks: Raw[] = [];
  for (let t = Math.ceil(tMin / 10) * 10; t <= tMax; t += 10)
    ticks.push(html`<line x1="${padL}" x2="${plotR}" y1="${y(t)}" y2="${y(t)}" class="grid ${t === 0 ? "zero" : ""}"/><text x="${padL - 7}" y="${y(t) + 3.5}" class="ax" text-anchor="end">${tempValue(t)}°</text>`);
  const band = html`<rect class="cband" x="${padL}" width="${plotR - padL}" y="${y(k.max)}" height="${Math.max(0, y(k.min) - y(k.max))}"/>
    <line class="cedge" x1="${padL}" x2="${plotR}" y1="${y(k.max)}" y2="${y(k.max)}"/><line class="cedge" x1="${padL}" x2="${plotR}" y1="${y(k.min)}" y2="${y(k.min)}"/>`;
  const months = hi.map((h, i) => {
    const l = lo[i]!;
    const cx = padL + i * bw + bw / 2;
    const w = Math.min(18, bw * 0.5);
    const rec = recHi && recLo ? html`<line class="rec" x1="${cx}" x2="${cx}" y1="${y(recHi[i]!)}" y2="${y(recLo[i]!)}"/><line class="rec-cap" x1="${cx - 4}" x2="${cx + 4}" y1="${y(recHi[i]!)}" y2="${y(recHi[i]!)}"/><line class="rec-cap" x1="${cx - 4}" x2="${cx + 4}" y1="${y(recLo[i]!)}" y2="${y(recLo[i]!)}"/>` : "";
    const typ = typHi && typLo ? html`<rect class="typ" x="${cx - w / 2 - 4}" width="${w + 8}" y="${y(typHi[i]!)}" height="${Math.max(2, y(typLo[i]!) - y(typHi[i]!))}" rx="${(w + 8) / 2}"/>` : "";
    const n = nice ? nice[i]! : null;
    const tip = `${MONTH_NAMES[i]}: average daily low ${temp(l, { decimals: 1, short: true })}, high ${temp(h, { decimals: 1, short: true })} (${feels ? "feels like" : "air"})${typHi && typLo ? `; one night in ten below ${temp(typLo[i]!, { short: true })}, one afternoon in ten above ${temp(typHi[i]!, { short: true })}` : ""}${recHi && recLo ? `; lowest ${temp(recLo[i]!, { short: true })}, highest ${temp(recHi[i]!, { short: true })}` : ""}${n !== null ? `. ${num(n, 0)} nice days for you` : ""}.`;
    const share = n === null ? 0 : Math.min(100, (n / 20) * 100);
    return html`<g class="mb"><title>${tip}</title>${rec}${typ}<rect class="bar" x="${cx - w / 2}" y="${y(h)}" width="${w}" height="${Math.max(3, y(l) - y(h))}" rx="${w / 2}" style="fill:color-mix(in oklab, var(--between) ${share.toFixed(0)}%, var(--bar-out))"/>
      <text x="${cx}" y="${y(h) - 6}" class="v hi" text-anchor="middle">${tempValue(h)}</text><text x="${cx}" y="${y(l) + 13}" class="v lo" text-anchor="middle">${tempValue(l)}</text>
      <text x="${cx}" y="${H - (nice ? 24 : 6)}" class="ax mo" text-anchor="middle">${narrow() ? MON3[i]!.slice(0, 1) : MON3[i]}</text>
      ${n !== null ? html`<text x="${cx}" y="${H - 5}" class="nice-n" text-anchor="middle">${num(n, 0)}</text>` : ""}</g>`;
  });
  const notes: Raw[] = [];
  const handle = (f: "min" | "max") => {
    const t = k[f];
    return html`<g class="chandle" tabindex="0" role="slider" aria-label="${f === "max" ? "Warmest" : "Coolest"} nice daytime temperature, ${tempUnit()}" aria-valuenow="${tempValue(t)}" aria-valuemin="${tempValue(-20)}" aria-valuemax="${tempValue(45)}" data-comfort-handle="${f}" id="comfort-handle-${f}">
      <rect x="${plotR + 4}" y="${y(t) - 11}" width="38" height="22" rx="11"/><text x="${plotR + 23}" y="${y(t) + 4.5}" text-anchor="middle">${tempValue(t)}°</text></g>`;
  };
  if (nice) notes.push(html`<text x="${padL - 7}" y="${H - 5}" class="nice-k" text-anchor="end">nice</text>`);
  return html`<svg class="chart monthchart ${o.editable ? "is-editable" : ""} ${narrow() ? "is-narrow" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.cityName}: average daily low and high by month, ${feels ? "feels like" : "air temperature"}, over your nice-day range ${tempValue(k.min)} to ${temp(k.max)}" data-tmin="${tMin}" data-tmax="${tMax}" data-top="${top}" data-bot="${bot}">
    ${ticks}${band}${months}${notes}${o.editable ? html`${handle("max")}${handle("min")}` : ""}</svg>`;
}

/** The year's extremes in words, for the line under the chart. */
export function extremesText(c: Climate): string {
  if (!c.recHi || !c.recLo) return "";
  const mh = c.recHi.indexOf(Math.max(...c.recHi));
  const ml = c.recLo.indexOf(Math.min(...c.recLo));
  return `Lowest ${temp(c.recLo[ml]!, { short: true })} (${MON3[ml]}), highest ${temp(c.recHi[mh]!, { short: true })} (${MON3[mh]}).`;
}

/** The legend under the month chart: only what the chart actually shows. */
export function monthLegend(c: Climate, measure: "air" | "feels"): Raw {
  const ext = measure === "air";
  return html`<ul class="legend">
    <li><i class="sw bar-out"></i>usual day, average low to high</li>
    ${c.nice ? html`<li><i class="sw bar-in"></i>greener with more ${term("comfortable", "nice days")}</li>` : ""}
    ${ext && c.typHi && c.typLo ? html`<li><i class="sw typ"></i>${term("typical", "one day in ten beyond")}</li>` : ""}
    ${ext && c.recHi && c.recLo ? html`<li><i class="sw rec"></i>${term("record", "lowest and highest")}</li>` : ""}
    <li><i class="sw cband"></i>your nice-day range</li>
  </ul>`;
}

// ---------- Smaller monthly charts ----------

function columns(values: (number | null)[], o: { max: number; unit: string; cls: string; label: (i: number, v: number) => string; H?: number; fmt?: (v: number) => string }): Raw {
  const W = narrow() ? 400 : 680, H = o.H ?? 150, padL = 30, top = 16, bot = 22, bw = (W - padL) / 12, ih = H - top - bot;
  const y = (v: number) => top + ih * (1 - Math.min(1, v / o.max));
  return html`${values.map((v, i) => {
    if (v === null) return "";
    const x = padL + i * bw + bw * 0.22;
    const w = bw * 0.56;
    return html`<g><title>${o.label(i, v)}</title><rect class="${o.cls}" x="${x}" y="${y(v)}" width="${w}" height="${Math.max(1, y(0) - y(v))}" rx="2"/><text x="${x + w / 2}" y="${y(v) - 4}" class="v" text-anchor="middle">${o.fmt ? o.fmt(v) : num(v, 0)}</text></g>`;
  })}${MON3.map((m, i) => html`<text x="${padL + (i + 0.5) * bw}" y="${H - 6}" class="ax" text-anchor="middle">${narrow() ? m.slice(0, 1) : m}</text>`)}
    <line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="grid"/>`;
}

export function cloudChart(c: Climate, name: string): Raw {
  if (!c.cloud) return html``;
  return html`<svg class="chart small ${narrow() ? "is-narrow" : ""}" viewBox="0 0 ${narrow() ? 400 : 680} 150" role="img" aria-label="${name}: cloud cover by month">${columns(c.cloud, { max: 100, unit: "%", cls: "cloud", label: (i, v) => `${MONTH_NAMES[i]}: ${num(v, 0)}% of the sky covered on average`, fmt: (v) => `${num(v, 0)}%` })}</svg>`;
}

export function wetChart(c: Climate, name: string): Raw {
  if (!c.wet) return html``;
  return html`<svg class="chart small ${narrow() ? "is-narrow" : ""}" viewBox="0 0 ${narrow() ? 400 : 680} 130" role="img" aria-label="${name}: wet days by month">${columns(c.wet, { max: Math.max(20, ...c.wet), unit: "days", cls: "wetbar", H: 130, label: (i, v) => `${MONTH_NAMES[i]}: ${num(v, 1)} wet days` })}</svg>`;
}

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Sunshine against the daylight it could have had, hours a day. */
export function sunChart(c: Climate, name: string): Raw {
  const W = narrow() ? 400 : 680, H = 160, padL = 30, top = 16, bot = 22, bw = (W - padL) / 12, ih = H - top - bot;
  const y = (v: number) => top + ih * (1 - v / 18);
  const cols = c.daylight.map((d, i) => {
    const x = padL + i * bw + bw * 0.2;
    const w = bw * 0.6;
    const s = c.sun ? c.sun[i]! / DAYS[i]! : null;
    return html`<g><title>${MONTH_NAMES[i]}: ${num(d, 1)} h of daylight a day${s !== null ? `, ${num(s, 1)} h of it sunny` : ""}</title>
      <rect class="daylen" x="${x}" y="${y(d)}" width="${w}" height="${y(0) - y(d)}" rx="2"/>
      ${s !== null ? html`<rect class="sunlen" x="${x}" y="${y(s)}" width="${w}" height="${y(0) - y(s)}" rx="2"/><text x="${x + w / 2}" y="${y(s) - 4}" class="v" text-anchor="middle">${num(s, 1)}</text>` : html`<text x="${x + w / 2}" y="${y(d) - 4}" class="v" text-anchor="middle">${num(d, 0)}</text>`}</g>`;
  });
  const grid = [0, 6, 12, 18].map((t) => html`<line class="grid" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 7}" y="${y(t) + 3.5}" class="ax" text-anchor="end">${t} h</text>`);
  return html`<svg class="chart small ${narrow() ? "is-narrow" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${name}: hours of ${c.sun ? "sunshine and " : ""}daylight a day, by month">${grid}${cols}${MON3.map((m, i) => html`<text x="${padL + (i + 0.5) * bw}" y="${H - 6}" class="ax" text-anchor="middle">${narrow() ? m.slice(0, 1) : m}</text>`)}</svg>`;
}

/** The other weather days as small multiples: days a year, and how they fall through the months. */
export function dayCounts(c: Climate, labels: Record<string, { label: string; description: string }>): Raw {
  const ids = DAY_METRICS.filter((id) => c.days[id]);
  if (!ids.length) return html``;
  return html`<div class="dgrid">${ids.map((id) => {
    const v = c.days[id]!;
    const total = Math.round(v.reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...v);
    return html`<div class="dcell" title="${local(labels[id]?.description ?? "")}"><span class="dl">${labels[id]?.label ?? id}</span><span class="dv num">${total}<small> a year</small></span>
      <span class="dbars" aria-hidden="true">${v.map((n, i) => html`<i style="height:${Math.max(3, (n / max) * 100).toFixed(1)}%" title="${MONTH_NAMES[i]}: ${num(n, 1)}"></i>`)}</span></div>`;
  })}</div>`;
}

export { raw };
