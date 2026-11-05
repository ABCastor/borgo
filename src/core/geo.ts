// Distance, flight time and clock difference between two places, from coordinates and time zones alone.

const R_KM = 6371;
const RAD = Math.PI / 180;

export interface Point {
  lat: number;
  lon: number;
}

export function greatCircleKm(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A nonstop airliner averages about 830 km/h over the ground, plus half an hour for taxi, climb and approach.
// Checked against scheduled block times: London-New York 7.2 h (7-8 h), Turin-London 1.6 h (1 h 50).
const CRUISE_KMH = 830;
const OVERHEAD_H = 0.5;

/** Hours of a nonstop flight along the great circle; under 150 km there is no flight worth taking. */
export function flightHours(a: Point, b: Point): number {
  const km = greatCircleKm(a, b);
  return km < 150 ? 0 : OVERHEAD_H + km / CRUISE_KMH;
}

/** UTC offset in hours of an IANA time zone at a given instant, daylight saving included. */
export function utcOffset(tz: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT+05:30", or "GMT" at zero
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
}

/** Hours between two clocks, the short way round the day: 17 hours ahead is 7 hours behind. */
function gap(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

export interface ClockGap {
  january: number;
  july: number;
  /** The mean of the two, which absorbs daylight-saving switches on different dates or hemispheres. */
  typical: number;
}

/** How far apart two clocks are in mid-January and mid-July of a given year. */
export function clockGap(tzA: string, tzB: string, year = new Date().getUTCFullYear()): ClockGap {
  const jan = new Date(Date.UTC(year, 0, 15, 12));
  const jul = new Date(Date.UTC(year, 6, 15, 12));
  const january = gap(utcOffset(tzA, jan), utcOffset(tzB, jan));
  const july = gap(utcOffset(tzA, jul), utcOffset(tzB, jul));
  return { january, july, typical: (january + july) / 2 };
}
