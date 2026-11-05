// The year's temperature in one picture, shared by the app and the published pages: for each month the usual day
// (average low to average high), the spread around it (a cold night one day in ten to a hot afternoon one day in ten),
// the extremes of the period, and the person's comfortable range as a band. No fills of meaning beyond those.
import { html, type Raw } from "./dom.ts";
import { MONTHS, MONTH_NAMES, num } from "./format.ts";

export interface ClimateSeries {
  high: number[];
  low: number[];
  /** 10th percentile of daily lows and 90th of daily highs. */
  lowP10?: number[] | null;
  highP90?: number[] | null;
  recordLow?: number[] | null;
  recordHigh?: number[] | null;
  wetDays?: number[] | null;
  /** Nice days a month for the range shown. */
  nice?: number[] | null;
  period: string;
  source: string;
}

export function climateChart(c: ClimateSeries, name: string, band: { min: number; max: number; what: string }, opts: { short?: boolean } = {}): Raw {
  const lows = [...c.low, ...(c.lowP10 ?? []), ...(c.recordLow ?? [])];
  const highs = [...c.high, ...(c.highP90 ?? []), ...(c.recordHigh ?? [])];
  const tMin = Math.floor(Math.min(-5, ...lows) / 5) * 5 - 2;
  const tMax = Math.ceil(Math.max(35, ...highs) / 5) * 5 + 2;
  const W = 600, H = 220, pad = 28, bw = (W - pad) / 12;
  const y = (t: number) => 8 + (H - 30) * (1 - (t - tMin) / (tMax - tMin));
  const ticks = [-10, 0, 10, 20, 30, 40].filter((t) => t > tMin && t < tMax);
  const spread = !!(c.lowP10 && c.highP90);
  const extremes = !!(c.recordLow && c.recordHigh);
  const label = (i: number) => {
    const parts = [`${MONTH_NAMES[i]}: usually ${num(c.low[i]!, 1)} to ${num(c.high[i]!, 1)} °C`];
    if (spread) parts.push(`one night in ten below ${num(c.lowP10![i]!, 1)}, one afternoon in ten above ${num(c.highP90![i]!, 1)}`);
    if (extremes) parts.push(`lowest ${num(c.recordLow![i]!, 1)}, highest ${num(c.recordHigh![i]!, 1)} in ${c.period}`);
    if (c.nice) parts.push(`${num(c.nice[i]!, 0)} nice days`);
    if (c.wetDays) parts.push(`${num(c.wetDays[i]!, 1)} wet days`);
    return parts.join("; ");
  };
  return html`<figure class="clim">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperature by month in ${name}: average daily low and high${spread ? ", the usual spread" : ""}${extremes ? " and the extremes" : ""}">
      <rect x="${pad}" y="${y(band.max)}" width="${W - pad}" height="${Math.max(0, y(band.min) - y(band.max))}" class="clim-band"><title>${band.what}, ${band.min} to ${band.max} °C</title></rect>
      ${ticks.map((t) => html`<line x1="${pad}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="clim-grid"/><text x="${pad - 6}" y="${y(t) + 3.5}" text-anchor="end" class="clim-t">${t}°</text>`)}
      ${c.high.map((h, i) => {
        const l = c.low[i]!;
        const cx = pad + i * bw + bw / 2;
        const w = bw * 0.44;
        return html`<g class="clim-month"><title>${label(i)}</title>
          ${spread ? html`<rect x="${cx - w * 0.3}" y="${y(c.highP90![i]!)}" width="${w * 0.6}" height="${Math.max(2, y(c.lowP10![i]!) - y(c.highP90![i]!))}" rx="2" class="clim-spread"/>` : ""}
          <rect x="${cx - w / 2}" y="${y(h)}" width="${w}" height="${Math.max(2, y(l) - y(h))}" rx="3" class="clim-bar"/>
          ${extremes ? html`<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${y(c.recordHigh![i]!)}" y2="${y(c.recordHigh![i]!)}" class="clim-hot"/><line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${y(c.recordLow![i]!)}" y2="${y(c.recordLow![i]!)}" class="clim-cold"/>` : ""}
          <text x="${cx}" y="${H - 6}" text-anchor="middle" class="clim-t">${opts.short ? MONTHS[i]!.charAt(0) : MONTHS[i]}</text></g>`;
      })}
    </svg>
    <figcaption>Air temperature in the shade by month (${c.source}, ${c.period}). Solid bar: the average daily low to high.${spread ? " Pale bar: from a cold night one day in ten to a hot afternoon one day in ten." : ""}${extremes ? ` Short lines: the lowest low and highest high of ${c.period}.` : ""} Band: ${band.what.toLowerCase()}, ${band.min} to ${band.max} °C.</figcaption>
  </figure>`;
}
