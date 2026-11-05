// Day length from latitude alone: no data source needed, so it works for every city.

const RAD = Math.PI / 180;
const TILT = 23.44;

/** Hours of daylight at a given solar declination, with the standard -0.833° horizon for refraction and the sun's disc. */
export function dayLength(latDeg: number, declinationDeg: number): number {
  const phi = latDeg * RAD;
  const d = declinationDeg * RAD;
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  return (2 * Math.acos(cosH)) / (15 * RAD);
}

export function shortestDay(lat: number): number {
  return dayLength(lat, lat >= 0 ? -TILT : TILT);
}

export function longestDay(lat: number): number {
  return dayLength(lat, lat >= 0 ? TILT : -TILT);
}

/** Mid-month daylight, January to December. */
export function monthlyDaylight(lat: number): number[] {
  return Array.from({ length: 12 }, (_, m) => {
    const day = 15 + m * 30.42;
    const decl = -TILT * Math.cos((2 * Math.PI * (day + 10)) / 365);
    return dayLength(lat, decl);
  });
}
