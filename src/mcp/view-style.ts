// The MCP App view's look, built from the site's own stylesheets when the view is built, so the chart in a chat is the
// site's: its tokens (colours, fonts, shadow, temperature bands, map ramp) and its components (pills, ink buttons,
// segmented controls, sliders, steppers, the range button, wins and losses, the money waterfall, month strips), lifted
// rule by rule from src/ui. Only the view's own layout lives in src/mcp/view.css. A component the site renames makes
// test/mcp-app.test.ts fail, never the view drift quietly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The site's stylesheets, in the order the app loads them (later tokens win). */
export const SITE_CSS = ["src/ui/styles.css", "src/ui/sheets.css", "src/ui/map.css"];

/**
 * The site's components the view wears, by the class (or element) a rule starts from, after the app's own `.app`
 * scope. A rule is lifted when one of its selectors starts with one of these; its other selectors are dropped.
 */
export const LIFTED = [
  ".sheet", ".bib", ".dname", ".dmeta", ".stamp", ".band", ".pill-btn", ".ink-btn", ".seg", ".must", ".range", ".stepper",
  'input[type="range"]', ".legend", ".sw", ".chip-x", ".wl-h", ".wl-list", ".wl", ".wl-n", ".wl-d", ".win", ".loss", ".wl-v",
  ".wl-bar", ".wl-none", ".cell", ".tear", ".chart", ".nstrip", ".nm", ".nice-tests", ".mc-months", ".mc-highs", ".wf", ".wf-bar",
  ".wf-out", ".wf-sum", ".src", ".quiet", ".hint", ".sr", ".fail", ".mlg-row", ".mlg-ramp", ".mlg-end", ".mlg-what", ".mlg-dot",
  ".mrank", ".mr-go", ".mr-n", ".mr-name", ".mr-v", ".mr-bar", ".lab", ".val-n", ".val-p", ".v-lead", ".v-more", ".sh", ".vs-lede", ".glance",
];

/** Top-level rules of a stylesheet, comments removed; at-rules (media queries, font faces) are skipped. */
export function topRules(css: string): { selectors: string[]; body: string }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selectors: string[]; body: string }[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth) depth += src[j] === "{" ? 1 : src[j] === "}" ? -1 : 0, j++;
    const body = src.slice(open + 1, j - 1).trim();
    if (head && !head.startsWith("@")) out.push({ selectors: head.split(/,(?![^(]*\))/).map((s) => s.trim()), body });
    i = j;
  }
  return out;
}

/** The selector without the app's scope: ".app .stepper" is ".stepper", "body.app" is ":root". */
const unscoped = (s: string) => s.replace(/^body\.app\b/, ":root").replace(/^\.app\s+/, "");
const startsWith = (s: string, root: string) => s === root || (s.startsWith(root) && /^[\s.:[>,~+#)]/.test(s.slice(root.length)));

export interface SiteStyle {
  /** Every custom property the site declares on :root and on the app's body, last one wins. */
  tokens: Map<string, string>;
  /** The lifted rules, in the site's order. */
  rules: string[];
  /** Which LIFTED roots matched at least one rule. */
  matched: Set<string>;
}

export function siteStyle(root: string): SiteStyle {
  const tokens = new Map<string, string>();
  const rules: string[] = [];
  const matched = new Set<string>();
  for (const file of SITE_CSS) {
    for (const r of topRules(readFileSync(join(root, file), "utf8"))) {
      const sels = r.selectors.map(unscoped);
      if (sels.some((s) => s === ":root")) {
        for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) tokens.set(m[1]!, m[2]!.trim());
        continue;
      }
      const keep = sels.filter((s) => LIFTED.some((l) => startsWith(s, l) && matched.add(l)));
      if (keep.length) rules.push(`${keep.join(",")}{${r.body}}`);
    }
  }
  return { tokens, rules, matched };
}

/** The view's whole stylesheet: the site's tokens and components, then the view's own layout. */
export function viewCss(root: string): string {
  const { tokens, rules } = siteStyle(root);
  const own = readFileSync(join(root, "src/mcp/view.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = [...tokens].map(([k, v]) => `${k}:${v}`).join(";");
  return (`:root{color-scheme:light dark;${vars}}` + rules.join("") + own).replace(/\s*\n\s*/g, "").replace(/\s{2,}/g, " ");
}

/** The site's fonts cut for the view (scripts/view-fonts.ts), as base64, for FontFace to read without a request. */
export function viewFonts(root: string): Record<string, string> {
  const f = (name: string) => readFileSync(join(root, "src/mcp/fonts", name)).toString("base64");
  return { bib600: f("bib-600.woff2"), bib700: f("bib-700.woff2"), ui: f("ui.woff2") };
}
