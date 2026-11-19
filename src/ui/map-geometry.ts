/** Canvas drawing uses logical CSS pixels, never backing-store (device) pixels. */
export function canvasPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, width: number, height: number): [number, number] {
  return [(clientX - rect.left) * width / rect.width, (clientY - rect.top) * height / rect.height];
}

/** Recheck on every paint, including a DPR-only zoom change with unchanged rounded layout size. */
export function canvasBuffer(width: number, height: number, dpr: number): [number, number] {
  const ratio = Math.min(2, dpr || 1);
  return [Math.round(width * ratio), Math.round(height * ratio)];
}

/** Scores have a stable 0-100 scale. Do not stretch away the effect of changed priorities. */
export function scoreShade(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}
