// Borgo's mark: three drawings on one 24-unit grid, each standing on the same baseline (y 21.5), so any of them
// stands on the header's line, fills a browser tab and scales to an app icon without other changes.
// Which one the product wears is set in ./index.ts, and only there.

export interface MarkPart {
  d: string;
  /** "ink" follows the text colour; "you" is the person's place, in the human terracotta. */
  part: "ink" | "you";
  fillRule?: "evenodd";
}

export interface Mark {
  id: string;
  name: string;
  /** What it shows, in one sentence. */
  idea: string;
  /** Where the ink starts at the top, on the 24-unit grid: lets a square icon centre the drawing. */
  top: number;
  /** Where the ink starts and ends across, on the same grid: lets a lockup size and centre the drawing. */
  left: number;
  right: number;
  parts: MarkPart[];
}

/** The grid's floor: every mark's ground line. The header crops the drawing here so it stands on its line. */
export const GROUND = 21.5;

export const MARKS = {
  /** Three houses of a village; the middle one, yours, in terracotta. */
  posto: {
    id: "posto",
    name: "Il tuo posto",
    idea: "Three houses of a village, and one of them is yours.",
    top: 5.5,
    left: 1.5,
    right: 22.5,
    parts: [
      { part: "ink", d: "M1.5 21.5V15.5L5.25 11.75L9 15.5V21.5ZM15 21.5V13.75L18.75 10L22.5 13.75V21.5Z" },
      { part: "you", d: "M8.25 21.5V9.25L12 5.5L15.75 9.25V21.5Z" },
    ],
  },
  /** A lowercase b: its stem a bell tower, its bowl a house with an arched door. */
  campanile: {
    id: "campanile",
    name: "Campanile",
    idea: "The letter b, drawn as a bell tower beside a house with an arched door.",
    top: 1.75,
    left: 3.75,
    right: 20,
    parts: [{ part: "ink", fillRule: "evenodd", d: "M3.75 21.5V5L6.125 1.75L8.5 5V15.125A5.75 5.75 0 0 1 20 15.125V21.5ZM11.5 18.5H17V15.25A2.75 2.75 0 0 0 11.5 15.25Z" }],
  },
  /** A hill town's towers, which also read as a bar chart: places, compared. */
  torri: {
    id: "torri",
    name: "Torri",
    idea: "A village of towers, like San Gimignano's, that is also a bar chart of places compared.",
    top: 2.5,
    left: 2,
    right: 22.5,
    parts: [{ part: "ink", d: "M2 21.5V10H6.25V17.5H7.75V2.5H12V17.5H13.5V7H17.75V17.5H18V14.25L20.25 12L22.5 14.25V21.5Z" }],
  },
} satisfies Record<string, Mark>;

export type MarkId = keyof typeof MARKS;

/** The mark as inline SVG for a page: ink follows `currentColor`, "you" takes `--human`. */
export function markSvg(mark: Mark, o: { cls?: string; title?: string; crop?: boolean } = {}): string {
  const box = o.crop === false ? "0 0 24 24" : `0 0 24 ${GROUND}`;
  const label = o.title ? ` role="img" aria-label="${o.title}"` : ` aria-hidden="true"`;
  const paths = mark.parts
    .map((p) => `<path class="mk-${p.part}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ""} d="${p.d}"/>`)
    .join("");
  return `<svg class="${o.cls ?? "mark"}" xmlns="http://www.w3.org/2000/svg" viewBox="${box}"${label}>${paths}</svg>`;
}

/**
 * The Castor standard for a product logo (Design Library section 20, measured from Descant's shipped icons): the Castor
 * mark at the top right of the product's mark, at one size and place for every product. Numbers are per cent of the
 * square: the Castor drawing's centre and height, the product mark's ground line and its largest width and height.
 * "tile" is the app icon (paper ground, the platform rounds it); "tight" is the favicon and the header lockup.
 */
export const CASTOR_ON = {
  tile: { cx: 77.05, cy: 18.55, h: 20.3, ground: 83.5, maxW: 72, maxH: 62 },
  tight: { cx: 78, cy: 14.5, h: 26.4, ground: 100, maxW: 86, maxH: 66 },
} as const;

/** The Castor drawing, as `castor` (./castor-mark.svg) holds it, placed by the standard. */
function castorAt(castor: string, at: { cx: number; cy: number; h: number }, themed: boolean): string {
  let inner = castor.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  // On a page the disc and its keyline follow the theme (the same two colours the Castor master's light and dark files use).
  if (themed) inner = inner.replace('fill="#006770"', 'fill="var(--machine)"').replace('stroke="#FAF9F4"', 'stroke="var(--paper)"');
  return `<svg class="castor" x="${(at.cx - at.h / 2).toFixed(2)}" y="${(at.cy - at.h / 2).toFixed(2)}" width="${at.h}" height="${at.h}" viewBox="2.2 2.2 19.6 19.6" aria-hidden="true">${inner}</svg>`;
}

/** The product mark's transform into a 100-unit square: as large as the standard allows, centred, on the ground line. */
function markPlace(mark: Mark, s: { ground: number; maxW: number; maxH: number }): string {
  const k = Math.min(s.maxW / (mark.right - mark.left), s.maxH / (GROUND - mark.top));
  const x = 50 - ((mark.left + mark.right) / 2) * k;
  const y = s.ground - GROUND * k;
  return `translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${k.toFixed(4)})`;
}

/**
 * The logo for a page header: the mark with the Castor mark at its top right ("tight"). The box is the mark's own
 * 24 by 21.5 grid, so the mark keeps the size and the foot it has alone and stands on the header's line; the Castor mark
 * reaches above the box (the svg must not clip: overflow visible). Ink follows `currentColor`, "you" takes `--human`.
 */
export function lockupSvg(mark: Mark, castor: string, o: { cls?: string; title?: string } = {}): string {
  const s = CASTOR_ON.tight;
  const k = Math.min(s.maxW / (mark.right - mark.left), s.maxH / (GROUND - mark.top));
  const x = 50 - 12 * k, w = 24 * k, top = s.ground - GROUND * k;
  const label = o.title ? ` role="img" aria-label="${o.title}"` : ` aria-hidden="true"`;
  const paths = mark.parts
    .map((p) => `<path class="mk-${p.part}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ""} d="${p.d}"/>`)
    .join("");
  return `<svg class="${o.cls ?? "mark lockup"}" xmlns="http://www.w3.org/2000/svg" viewBox="${x.toFixed(2)} ${top.toFixed(2)} ${w.toFixed(2)} ${(s.ground - top).toFixed(2)}" overflow="visible"${label}><g transform="${markPlace(mark, s)}">${paths}</g>${castorAt(castor, s, true)}</svg>`;
}

/** A standalone favicon: the "tight" lockup; ink on light tabs, light on dark tabs, the person's house in terracotta. */
export function faviconSvg(mark: Mark, castor: string): string {
  const paths = mark.parts
    .map((p) => `<path class="${p.part}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ""} d="${p.d}"/>`)
    .join("");
  const s = CASTOR_ON.tight;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.ink{fill:#14130F}.you{fill:#C4552A}@media (prefers-color-scheme:dark){.ink{fill:#E9E6DF}}</style><g transform="${markPlace(mark, s)}">${paths}</g>${castorAt(castor, s, false)}</svg>`;
}

/**
 * The app icon (connector directories, home screens): the mark on paper with the Castor mark at its top right, as
 * Descant wears it, placed by the standard (CASTOR_ON.tile). `castor` is ./castor-mark.svg, a copy of castor-identity's
 * master/mark-solid-light.svg.
 */
export function appIconSvg(mark: Mark, castor: string): string {
  const paths = mark.parts
    .map((p) => `<path fill="${p.part === "you" ? "#C4552A" : "#14130F"}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ""} d="${p.d}"/>`)
    .join("");
  const s = CASTOR_ON.tile;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F7F4EC"/><g transform="${markPlace(mark, s)}">${paths}</g>${castorAt(castor, s, false)}</svg>`;
}
