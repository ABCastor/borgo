// A proposal check in words: the comment the workflow leaves on an issue, and the text the CLI and MCP print.
import type { Verdict } from "./proposal.ts";

export const COMMENT_MARKER = "<!-- borgo-proposal-check -->";

/**
 * Text that came from an issue, made inert for a GitHub comment: no mentions, no HTML, no images or links that load,
 * no headings or tables that break the layout. Our own words pass through the same filter, which they survive.
 */
export function inert(s: string): string {
  return s
    .replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))
    .replace(/@/g, "@\u200b")
    .replace(/!\[/g, "!\u200b[")
    .replace(/\]\(/g, "]\u200b(")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .slice(0, 600);
}

/** What happened, for a person reading the issue. */
export function verdictMarkdown(v: Verdict, o: { forGitHub?: boolean } = {}): string {
  const t = o.forGitHub ? inert : (s: string) => s;
  const head = v.ok ? "**This proposal passes the checks.**" : "**This proposal needs changes before review.**";
  const list = (xs: string[]) => xs.map((x) => `- ${t(x)}`).join("\n");
  return [
    ...(o.forGitHub ? [COMMENT_MARKER] : []),
    head,
    ...(v.problems.length ? ["What to fix:", list(v.problems)] : []),
    ...(v.warnings.length ? ["For the reviewer:", list(v.warnings)] : []),
    `Next: ${t(v.next)}`,
    ...(o.forGitHub ? ["<sub>Checked by the proposal workflow (CONTRIBUTING.md). Nothing reaches the site until a reviewed pull request merges.</sub>"] : []),
  ].join("\n\n");
}
