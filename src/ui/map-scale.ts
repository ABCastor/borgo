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
// Deliberately increasing luminance: red, amber-yellow, light green, not hue alone.
export const MAP_COLOURS = [[143,18,49], [220,168,43], [165,227,174]];
