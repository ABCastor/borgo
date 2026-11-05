// How a person reads figures: temperature in °C or °F, distances in km or miles, their own way of writing numbers and
// dates. The data and the engine stay metric (°C, km, ISO dates); these functions turn a figure into the person's
// units only where it is shown. Money's display currency is Profile.displayCurrency.

export type TempUnit = "C" | "F";
export type DistanceUnit = "km" | "mi";
/** How a number is written, shown by example. */
export type NumberStyle = "1,234.5" | "1.234,5" | "1 234,5" | "1'234.5";
/** How a date is written, shown by example. */
export type DateStyle = "5 Nov 2026" | "Nov 5, 2026" | "2026-11-05";

export interface Units {
  temp: TempUnit;
  distance: DistanceUnit;
  numbers: NumberStyle;
  dates: DateStyle;
}

export const DEFAULT_UNITS: Units = { temp: "C", distance: "km", numbers: "1,234.5", dates: "5 Nov 2026" };

export const NUMBER_STYLES: NumberStyle[] = ["1,234.5", "1.234,5", "1 234,5", "1'234.5"];
export const DATE_STYLES: DateStyle[] = ["5 Nov 2026", "Nov 5, 2026", "2026-11-05"];

/** The locale whose number format each style is. */
const NUMBER_LOCALE: Record<NumberStyle, string> = { "1,234.5": "en-GB", "1.234,5": "de-DE", "1 234,5": "fr-FR", "1'234.5": "de-CH" };

/** A saved or shared profile's units, completed with the defaults and cleaned of anything unknown. */
export function unitsOf(u: Partial<Units> | undefined): Units {
  return {
    temp: u?.temp === "F" ? "F" : "C",
    distance: u?.distance === "mi" ? "mi" : "km",
    numbers: NUMBER_STYLES.includes(u?.numbers as NumberStyle) ? (u!.numbers as NumberStyle) : DEFAULT_UNITS.numbers,
    dates: DATE_STYLES.includes(u?.dates as DateStyle) ? (u!.dates as DateStyle) : DEFAULT_UNITS.dates,
  };
}

export const KM_PER_MILE = 1.609344;
export const FT_PER_M = 1 / 0.3048;
export const IN_PER_MM = 1 / 25.4;

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

/** A temperature in °C, in the person's unit. */
export const tempIn = (c: number, u: Units) => (u.temp === "F" ? cToF(c) : c);
/** A temperature typed in the person's unit, in °C. */
export const tempFrom = (v: number, u: Units) => (u.temp === "F" ? fToC(v) : v);
/** A distance in km, in the person's unit. */
export const distanceIn = (km: number, u: Units) => (u.distance === "mi" ? km / KM_PER_MILE : km);

/** A number written the person's way: grouping, decimal mark, and a true minus sign. */
export function formatNumber(n: number, u: Units, decimals = 0): string {
  if (!Number.isFinite(n)) return "–";
  return new Intl.NumberFormat(NUMBER_LOCALE[u.numbers], { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n).replace(/[-‐]/, "−").replace(/\u202f/g, "\u00a0").replace(/’/g, "'");
}

/** Money in a currency, written the person's way: "€1,240", "1.240 €", "CHF 1'240". */
export function formatMoney(n: number, currency: string, u: Units, o: { signed?: boolean; compact?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(n)) return "–";
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    maximumFractionDigits: o.decimals ?? 0,
    notation: o.compact && Math.abs(n) >= 100_000 ? "compact" : "standard",
    signDisplay: o.signed ? "exceptZero" : "auto",
  };
  // The en-GB style keeps its symbols before the amount ("€1,240"); the others follow their own locale.
  try {
    return new Intl.NumberFormat(NUMBER_LOCALE[u.numbers], opts).format(n).replace(/[-‐]/, "−").replace(/\u202f/g, "\u00a0").replace(/’/g, "'");
  } catch {
    return `${formatNumber(n, u, o.decimals ?? 0)} ${currency}`;
  }
}

/** "21 °C" or "70 °F"; `short` gives "21°". */
export function formatTemp(c: number, u: Units, o: { decimals?: number; short?: boolean } = {}): string {
  const v = formatNumber(tempIn(c, u), u, o.decimals ?? 0);
  return o.short ? `${v}°` : `${v}\u00a0°${u.temp}`;
}

/** "12 km" or "7 mi". */
export function formatDistance(km: number, u: Units, decimals = 0): string {
  return `${formatNumber(distanceIn(km, u), u, decimals)}\u00a0${u.distance}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An ISO date (YYYY-MM-DD, or with a time) written the person's way. A partial date (a year, a quarter) is kept. */
export function formatDate(iso: string, u: Units): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const mon = MON[Number(mo) - 1] ?? mo;
  if (u.dates === "2026-11-05") return `${y}-${mo}-${d}`;
  if (u.dates === "Nov 5, 2026") return `${mon} ${Number(d)}, ${y}`;
  return `${Number(d)} ${mon} ${y}`;
}

/** A number as en-GB writes it ("2,869", "7.6", "−3"), read back. */
const parseGb = (s: string) => Number(s.replace(/,/g, "").replace("−", "-"));

/**
 * Figures inside prose, as the data and the definitions write them (en-GB numbers, °C, km, km/h, m, mm, cm and ISO
 * dates), rewritten in the person's units. Plain integers below 1,000 and years are left as they are.
 */
export function localiseText(text: string, u: Units): string {
  if (u.temp === "C" && u.distance === "km" && u.numbers === "1,234.5" && u.dates === "5 Nov 2026" && !/\d{4}-\d{2}-\d{2}/.test(text)) return text;
  const num = "[−-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?";
  const dec = (s: string) => (s.includes(".") ? s.split(".")[1]!.length : 0);
  let out = text;
  // Dates first, so their digits are not read as numbers.
  const dates: string[] = [];
  out = out.replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, (d) => {
    dates.push(formatDate(d, u));
    return `\u0000${dates.length - 1}\u0000`;
  });
  const keep: string[] = [];
  const hold = (s: string) => {
    keep.push(s);
    return `\u0001${keep.length - 1}\u0001`;
  };
  // Temperatures: "20 °C", "18 to 30 °C" (the first number of a range follows the unit after it).
  out = out.replace(new RegExp(`(${num})(\\s?(?:to|and|–|-)\\s?)(${num})\\s?°C`, "g"), (_, a: string, mid: string, b: string) =>
    hold(`${formatNumber(tempIn(parseGb(a), u), u, dec(a))}${mid}${formatNumber(tempIn(parseGb(b), u), u, dec(b))}\u00a0°${u.temp}`));
  out = out.replace(new RegExp(`(${num})\\s?°C`, "g"), (_, a: string) => hold(`${formatNumber(tempIn(parseGb(a), u), u, dec(a))}\u00a0°${u.temp}`));
  if (u.distance === "mi") {
    out = out.replace(new RegExp(`(${num})\\s?km/h`, "g"), (_, a: string) => hold(`${formatNumber(parseGb(a) / KM_PER_MILE, u, dec(a))}\u00a0mph`));
    // Under a mile keeps a decimal, so 1 km reads 0.6 mi, not 1 mi.
    out = out.replace(new RegExp(`(${num})\\s?km\\b`, "g"), (_, a: string) => {
      const mi = parseGb(a) / KM_PER_MILE;
      return hold(`${formatNumber(mi, u, Math.max(dec(a), mi < 1 ? 1 : 0))}\u00a0mi`);
    });
    out = out.replace(new RegExp(`(${num})\\s?mm\\b`, "g"), (_, a: string) => hold(`${formatNumber(parseGb(a) * IN_PER_MM, u, 2)}\u00a0in`));
    out = out.replace(new RegExp(`(${num})\\s?cm\\b`, "g"), (_, a: string) => hold(`${formatNumber((parseGb(a) * 10) * IN_PER_MM, u, 1)}\u00a0in`));
    out = out.replace(new RegExp(`(${num})\\s?m\\b(?![²³/])`, "g"), (_, a: string) => hold(`${formatNumber(parseGb(a) * FT_PER_M, u, 0)}\u00a0ft`));
  }
  if (u.numbers !== "1,234.5") {
    // Any other number with a grouping comma or a decimal point.
    out = out.replace(/(?<![\d\u0000\u0001])[−-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|(?<![\d.\u0000\u0001])\d+\.\d+(?![\d.])/g, (s) => formatNumber(parseGb(s), u, dec(s)));
  }
  out = out.replace(/\u0001(\d+)\u0001/g, (_, i: string) => keep[Number(i)]!);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => dates[Number(i)]!);
}
