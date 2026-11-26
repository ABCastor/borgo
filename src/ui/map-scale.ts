/** Robust visible spread: outliers saturate rather than washing out every other city. */
export function stretchScale(values: number[]): [number, number] | null {
  const a = values.filter(Number.isFinite).sort((x,y) => x-y);
  if (!a.length) return null;
  const q = (p: number) => {
    const i = (a.length - 1) * p, lo = Math.floor(i);
    return a[lo]! + (a[Math.ceil(i)]! - a[lo]!) * (i-lo);
  };
  return [q(.05), q(.95)];
}
export function stretched(value: number, span: [number, number]): number {
  return span[1] - span[0] < 1e-9 ? .5 : Math.max(0, Math.min(1, (value-span[0])/(span[1]-span[0])));
}
/**
 * The map's colour ramp, worst to best fit: one sequential run to green, monotonic in lightness so it reads without
 * hue (colour-blind vision, greyscale). On the light page the best is the darkest, a deep green; on the dark page the
 * brightest. src/ui/map.css sets the same values as --map-lo, --map-mid and --map-hi (tested).
 */
export const MAP_RAMP = {
  light: [[0xfa, 0xe0, 0x8a], [0x8e, 0xb0, 0x45], [0x0b, 0x5d, 0x2a]],
  dark: [[0x60, 0x51, 0x20], [0x6f, 0x98, 0x3d], [0x79, 0xdf, 0x83]],
} as const;
