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
    parts: [{ part: "ink", fillRule: "evenodd", d: "M3.75 21.5V5L6.125 1.75L8.5 5V15.125A5.75 5.75 0 0 1 20 15.125V21.5ZM11.5 18.5H17V15.25A2.75 2.75 0 0 0 11.5 15.25Z" }],
  },
  /** A hill town's towers, which also read as a bar chart: places, compared. */
  torri: {
    id: "torri",
    name: "Torri",
    idea: "A village of towers, like San Gimignano's, that is also a bar chart of places compared.",
    top: 2.5,
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

/** A standalone favicon: ink on light tabs, light on dark tabs, the person's house in terracotta on both. */
export function faviconSvg(mark: Mark): string {
  const paths = mark.parts
    .map((p) => `<path class="${p.part}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ""} d="${p.d}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.ink{fill:#14130F}.you{fill:#C4552A}@media (prefers-color-scheme:dark){.ink{fill:#E9E6DF}}</style><g transform="translate(0 ${((24 - (GROUND - mark.top)) / 2 - mark.top).toFixed(2)})">${paths}</g></svg>`;
}
