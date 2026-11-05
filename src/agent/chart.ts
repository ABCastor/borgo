// The comparison chart as one SVG string. Self-contained on purpose (no imports, no Node or DOM APIs):
// the MCP App view inlines this very file, type-stripped, so the chart in a chat, the one the CLI writes
// and the one a test checks are drawn by the same code.

export interface ChartInput {
  currency: string;
  cities: {
    name: string;
    total: number;
    coverage: number;
    ruledOut: boolean;
    monthlyLeft: number | null;
    /** Points by line, out of 100. */
    lines: { label: string; points: number }[];
  }[];
}

/** The chart's data from a compare report's structured content. */
export function chartInput(report: {
  displayCurrency: string;
  cities: { name: string; total: number; coverage: number; ruledOut: string[]; money: { monthly: { left: { shown: number | null } } }; lines: { label: string; points: number }[] }[];
}): ChartInput {
  return {
    currency: report.displayCurrency,
    cities: report.cities.map((c) => ({
      name: c.name,
      total: c.total,
      coverage: c.coverage,
      ruledOut: c.ruledOut.length > 0,
      monthlyLeft: c.money.monthly.left.shown,
      lines: c.lines.filter((l) => l.points > 0).map((l) => ({ label: l.label, points: l.points })),
    })),
  };
}

const PALETTE = ["#006770", "#C4552A", "#667D2F", "#00858F", "#9A6B3F", "#4F6D8A", "#8A5A83", "#B08A2E", "#3F7F5F", "#7A7A7A", "#A04545", "#5E8C99"];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function money(n: number, cur: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n).replace("-", "−");
  } catch {
    return `${Math.round(n)} ${cur}`;
  }
}

/**
 * Stacked bars of each city's score, one colour per line, and a second panel with the money left
 * each month. Colours sit in the SVG itself; text uses currentColor so it follows the host's theme.
 */
export function compareSvg(input: ChartInput, width = 720): string {
  const labels = [...new Set(input.cities.flatMap((c) => c.lines.map((l) => l.label)))];
  const colour = (label: string) => PALETTE[labels.indexOf(label) % PALETTE.length]!;
  const nameW = 130;
  const barW = width - nameW - 110; // room on the right for the total and the data note
  const rowH = 30;
  const top = 26;
  const scoreH = top + input.cities.length * rowH;
  const legendRows = Math.ceil(labels.length / 3);
  const legendTop = scoreH + 14;
  const moneyTop = legendTop + legendRows * 18 + 30;
  const withMoney = input.cities.some((c) => c.monthlyLeft !== null);
  const height = withMoney ? moneyTop + input.cities.length * rowH + 10 : legendTop + legendRows * 18 + 6;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Score out of 100 by city, split by what earned the points" font-family="system-ui, sans-serif" font-size="12" fill="currentColor">`);
  out.push(`<text x="0" y="14" font-weight="600">Score out of 100, by what earned it</text>`);
  input.cities.forEach((c, i) => {
    const y = top + i * rowH;
    out.push(`<text x="${nameW - 8}" y="${y + 17}" text-anchor="end"${c.ruledOut ? ' opacity="0.55"' : ""}>${esc(c.name)}</text>`);
    out.push(`<rect x="${nameW}" y="${y + 4}" width="${barW}" height="18" rx="3" fill="currentColor" opacity="0.08"/>`);
    let x = nameW;
    for (const l of c.lines) {
      const w = (barW * l.points) / 100;
      out.push(`<rect x="${x.toFixed(1)}" y="${y + 4}" width="${Math.max(0, w).toFixed(1)}" height="18" fill="${colour(l.label)}"${c.ruledOut ? ' opacity="0.4"' : ""}><title>${esc(c.name)}: ${esc(l.label)}, ${l.points.toFixed(1)} points</title></rect>`);
      x += w;
    }
    const note = c.ruledOut ? " ruled out" : c.coverage < 0.999 ? ` · ${Math.round(c.coverage * 100)}% data` : "";
    out.push(`<text x="${nameW + barW + 6}" y="${y + 17}" font-weight="600">${c.total.toFixed(0)}<tspan font-weight="400" opacity="0.65" font-size="10">${esc(note)}</tspan></text>`);
  });
  labels.forEach((label, i) => {
    const x = (i % 3) * (width / 3);
    const y = legendTop + Math.floor(i / 3) * 18;
    out.push(`<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${colour(label)}"/><text x="${x + 15}" y="${y + 9}" font-size="11">${esc(label)}</text>`);
  });
  if (withMoney) {
    const vals = input.cities.map((c) => c.monthlyLeft ?? 0);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    const zero = nameW + (barW * (0 - lo)) / span;
    out.push(`<text x="0" y="${moneyTop - 10}" font-weight="600">Money left each month, ${esc(input.currency)}</text>`);
    input.cities.forEach((c, i) => {
      const y = moneyTop + i * rowH;
      out.push(`<text x="${nameW - 8}" y="${y + 17}" text-anchor="end">${esc(c.name)}</text>`);
      if (c.monthlyLeft === null) {
        out.push(`<text x="${nameW}" y="${y + 17}" opacity="0.6">missing data</text>`);
        return;
      }
      const w = (barW * Math.abs(c.monthlyLeft)) / span;
      const x = c.monthlyLeft >= 0 ? zero : zero - w;
      out.push(`<rect x="${x.toFixed(1)}" y="${y + 4}" width="${w.toFixed(1)}" height="18" rx="3" fill="${c.monthlyLeft >= 0 ? "#667D2F" : "#A04545"}"/>`);
      out.push(`<text x="${(c.monthlyLeft >= 0 ? x + w + 6 : zero + 6).toFixed(1)}" y="${y + 17}">${money(c.monthlyLeft, input.currency)}</text>`);
    });
    out.push(`<line x1="${zero.toFixed(1)}" x2="${zero.toFixed(1)}" y1="${moneyTop}" y2="${moneyTop + input.cities.length * rowH}" stroke="currentColor" opacity="0.3"/>`);
  }
  out.push(`</svg>`);
  return out.join("");
}
