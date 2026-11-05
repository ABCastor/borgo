import type { Dataset } from "../core/types.ts";
import { DEFAULT_UNITS, formatDate, formatDistance, formatMoney, formatNumber, formatTemp, localiseText, tempIn, type Units } from "../core/units.ts";

// Every figure the app shows goes through these, in the person's units (Settings): the data stays metric.

let units: Units = DEFAULT_UNITS;

/** The units the next render writes in; main.ts sets them from the profile before each render. */
export function useUnits(u: Units): void {
  units = u;
}

export const currentUnits = (): Units => units;

export function money(n: number | null | undefined, currency: string, opts: { signed?: boolean; compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return formatMoney(n, currency, units, opts);
}

export function num(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return formatNumber(n, units, d);
}

/** A temperature given in °C: "21 °C" or "70 °F"; `short` gives "21°". */
export function temp(c: number | null | undefined, o: { decimals?: number; short?: boolean } = {}): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return "–";
  return formatTemp(c, units, o);
}

/** A temperature given in °C, as a bare number in the person's unit (for chart labels and inputs). */
export const tempValue = (c: number) => Math.round(tempIn(c, units));

/** "°C" or "°F". */
export const tempUnit = () => `°${units.temp}`;

export function distance(km: number | null | undefined, d = 0): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return "–";
  return formatDistance(km, units, d);
}

export const date = (iso: string) => formatDate(iso, units);

/** Prose with figures in it (a line's text, a definition), rewritten in the person's units. */
export const local = (text: string) => localiseText(text, units);

export function hours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh} h ${String(mm).padStart(2, "0")}`;
}

export function countryName(data: Dataset, iso: string): string {
  return data.countries[iso]?.name ?? iso;
}

export const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const CURRENCIES = ["EUR", "GBP", "USD", "CHF", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "JPY", "SGD"];
