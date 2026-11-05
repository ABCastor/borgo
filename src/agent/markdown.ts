// Readable markdown for every report: what a chat shows when it cannot render the app view, and what a terminal prints.
import type { RightResult } from "../core/rights.ts";
import type { Catalogue, CatalogueKind, CityReport, CompareReport, CompareSummary, Figure, NetPayReport } from "./report.ts";

export function money(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n).replace("-", "−");
  } catch {
    return `${Math.round(n).toLocaleString("en-GB")} ${currency}`;
  }
}

const num = (n: number, d = 0) => n.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }).replace("-", "−");
const short = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 }).replace("-", "−");
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 1000) / 10}%`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(head: string[], rows: string[][], align: ("l" | "r")[] = []): string {
  const sep = head.map((_, i) => (align[i] === "r" ? "---:" : "---"));
  return [head, sep, ...rows].map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
}

/** A bar of block characters: renders in any chat or terminal that shows monospace text. */
export function textBar(value: number, max: number, width = 24): string {
  const eighths = Math.max(0, Math.round((value / (max || 1)) * width * 8));
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  return "█".repeat(full) + (part ? ("▏▎▍▌▋▊▉"[part - 1] ?? "") : "");
}

export function sourceLabel(f: Figure): string {
  if (f.origin === "you") return "your number";
  if (f.origin === "none" || !f.source) return "no open data yet";
  const level = f.level && f.level !== "city" ? `, ${f.level} level` : "";
  return `${f.source.publisher || f.source.name}, ${f.period}${level}`;
}

/** A person's right to live in a place, in a table cell. */
function rightCell(p: Pick<RightResult, "status" | "via">): string {
  return p.status === "yes" ? `yes (${p.via})` : p.status === "no" ? "no automatic right: needs a permit" : "not checked: add passports";
}

function figureValue(f: Figure): string {
  if (f.value === null) return f.note && f.origin === "source" ? f.note : "–";
  if (Array.isArray(f.value)) return f.value.map((v) => num(v, 1)).join(" · ");
  return `${num(f.value, Math.abs(f.value) < 100 ? 1 : 0)} ${f.unit}`.trim();
}

function sourcesUsed(figures: Figure[]): string[] {
  const seen = new Map<string, string>();
  for (const f of figures) {
    if (f.origin !== "source" || !f.source) continue;
    seen.set(f.source.id, `${f.source.name} (${f.source.publisher}), ${f.source.licence}: ${f.source.url}`);
  }
  return [...seen.values()];
}

type Cell = { score: number | null; points: number; text: string; approximate?: boolean; check?: string; dealBreaker?: boolean; imputed?: boolean; observed?: boolean; sources?: Figure[]; cite?: string };

/** A line's cell: points and the figure with who and when ("126 nice days a year (Open-Meteo, 2021-2025)"). */
function lineCell(x: Cell): string {
  const cite = x.cite ?? x.sources?.[0]?.cite;
  const mark = x.dealBreaker ? (x.check === "fail" ? " ✗ fails" : x.check === "unknown" ? " ? unknown" : "") : "";
  if (x.score === null) return `– (${x.text})${mark}`;
  if (x.observed === false) return `${num(x.points, 1)} pts · no figure (${x.text}), scored as the lowest city${mark}`;
  return `${num(x.points, 1)} pts · ${x.text}${cite ? ` (${cite})` : ""}${x.approximate ? " (country figure)" : ""}${mark}`;
}

function rankTable(ranking: CompareReport["ranking"], cur: string, mustPass: boolean): string {
  const anyMoney = ranking.some((x) => x.monthlyLeft !== null);
  return table(
    ["#", "City", "Score /100", "Observed", ...(mustPass ? ["Must-pass"] : []), ...(anyMoney ? [`Left a month (${cur})`] : [])],
    ranking.map((x) => [
      String(x.rank),
      x.name,
      num(x.total, 1),
      `${Math.round(x.requestedCoverage * 100)}%`,
      ...(mustPass ? [x.status === "ruled out" ? `fails: ${x.ruledOut.join(", ")}` : x.status === "unknown" ? `unknown: ${x.unresolved.join(", ")}` : "passes"] : []),
      ...(anyMoney ? [x.monthlyLeft === null && x.monthlyLeftAtMost !== undefined ? `at most ${money(x.monthlyLeftAtMost, cur)}` : money(x.monthlyLeft, cur)] : []),
    ]),
    ["r", "l", "r", "r", ...(mustPass ? ["l" as const] : []), "r"],
  );
}

/** The plain answer and its citations for each "no", once per country. */
function rightsNotes(cities: { name: string; rights: RightResult[] }[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cities)
    for (const p of c.rights) {
      if (p.status !== "no" || seen.has(p.text)) continue;
      seen.add(p.text);
      out.push(`- ${p.person}, ${c.name}: ${p.text}${p.sources.length ? ` Rules checked: ${p.sources.map((x) => `[${x.name}](${x.url})`).join(", ")}.` : ""}`);
    }
  return out.join("\n");
}

/** The compact comparison an agent gets by default: the answer, what qualifies it, what to add, and the citations. */
export function summaryMarkdown(r: CompareSummary, why: Record<string, string[]> = {}): string {
  const cur = r.displayCurrency;
  const out: string[] = [];
  out.push(`## Borgo: ${r.ranking.length + r.moreCities} ${r.ranking.length + r.moreCities === 1 ? "city" : "cities"} ranked`);
  // What keeps a provisional lead open is in the notes and each city's reasons; the structured answer lists it too.
  out.push(`**${r.verdict}**`);
  out.push(rankTable(r.ranking, cur, r.lines.some((l) => l.mustPass)) + (r.moreCities ? `\n\n${r.moreCities} more ${r.moreCities === 1 ? "city" : "cities"} ranked below; raise \`limit\` to see them.` : ""));
  if (r.notes.length) out.push("### How it was scored\n" + r.notes.map((x) => `- ${x}`).join("\n"));
  if (r.requiredUnknowns.length) out.push("### Must-pass not known yet\n" + r.requiredUnknowns.map((x) => `- ${x.name}: ${x.lines.join(", ")}`).join("\n"));
  out.push("### Why\n" + r.cities.map((c) => `**${c.rank}. ${c.name}.** ${(why[c.id] ?? []).join(" ") || "Close to the others on everything you weighted."}`).join("\n\n"));
  const lines = r.lines;
  const cellOf = (c: CompareSummary["cities"][number], id: string) => {
    const x = c.lines.find((y) => y.id === id)!;
    return lineCell({ ...x, observed: !x.noFigure, score: !x.noFigure || x.points > 0 ? 1 : null, dealBreaker: x.check !== undefined });
  };
  const head = (l: CompareSummary["lines"][number]) => `${l.label}${l.mustPass ? ", must pass" : ""}${l.cite ? ` (${l.cite})` : ""}`;
  if (lines.length && r.cities.length <= 6)
    out.push("### Points by line\n" + table(["Line", "Weight", ...r.cities.map((c) => c.name)], lines.map((l) => [head(l), String(l.weight), ...r.cities.map((c) => cellOf(c, l.id))]), ["l", "r", ...r.cities.map(() => "r" as const)]));
  else if (lines.length && lines.length <= 4)
    out.push("### Points by line\n" + table(["City", ...lines.map((l) => `${head(l)}, weight ${l.weight}`)], r.cities.map((c) => [c.name, ...lines.map((l) => cellOf(c, l.id))])));
  else if (lines.length) out.push("Points by line are in the structured result (`cities[].lines`), or ask for fewer cities.");
  const withMoney = r.cities.filter((c) => c.money);
  if (withMoney.length) {
    out.push(
      `### Money, in ${cur}\n` +
        table(
          ["City", "Take-home a month", "Tax and contributions", "Cost a month", "Left a month"],
          withMoney.map((c) => [c.name, money(c.money!.takeHomeMonth, cur), pct(c.money!.effectiveRate), money(c.money!.costMonth, cur), c.money!.incomplete ? `${c.money!.leftMonthAtMost !== undefined ? `at most ${money(c.money!.leftMonthAtMost, cur)}` : "–"} (${c.money!.incomplete})` : money(c.money!.leftMonth, cur)]),
          ["l", "r", "r", "r", "r"],
        ),
    );
    const notes = withMoney.flatMap((c) => [...(c.money!.regime ? [`${c.name}: ${c.money!.regime} counted.`] : []), ...(c.money!.pensionRelief ? [`${c.name}: pension, ${c.money!.pensionRelief}.`] : []), ...c.money!.gaps.map((g) => `${c.name}: ${g}.`)]);
    if (withMoney.some((c) => c.money!.paidChildcare === false)) notes.push("No paid childcare: no childcare cost is counted.");
    if (notes.length) out.push(notes.map((x) => `- ${x}`).join("\n"));
    const tax = Object.entries(r.taxSources);
    if (tax.length) out.push("Tax model sources (the first of each; detail \"full\" lists all): " + tax.map(([cc, xs]) => `${cc}: ${xs.map((x) => `[${x.label}](${x.url})`).join("; ")}`).join(". "));
  }
  const rights = r.cities.filter((c) => c.rights.length);
  if (rights.length) {
    out.push("### Who can move there\n" + table(["City", ...rights[0]!.rights.map((p) => p.person)], rights.map((c) => [c.name, ...c.rights.map(rightCell)])));
    const no = rightsNotes(rights.map((c) => ({ name: c.name, rights: c.rights.map((x) => ({ ...x, sources: x.sources ?? [], allowed: x.status === "yes" })) })));
    if (no) out.push(no);
  }
  if (r.nextInputs.length) out.push("### What to add next\n" + r.nextInputs.map((x) => `- ${x}`).join("\n"));
  if (r.assumptions.length) out.push("### Assumed\n" + r.assumptions.map((x) => `- ${x}`).join("\n"));
  if (r.sources.length) out.push("### Sources\n" + r.sources.map((x) => `- [${x.name}](${x.url}), ${x.licence.split(/[;(]/)[0]!.trim()}`).join("\n"));
  out.push(`Dataset ${r.dataset.version}, exchange rates of ${r.dataset.fxDate}, engine ${r.dataset.engine}, report ${r.reportVersion}. Scores use the person's weights; no ranking is objective. Ask with detail "full" for every line, tax line and source.`);
  return out.join("\n\n");
}

export function compareMarkdown(r: CompareReport): string {
  const cur = r.displayCurrency;
  const out: string[] = [];
  out.push(`## Borgo: ${r.cities.map((c) => c.name).join(", ")}`);
  out.push(`**${r.verdict}**`);
  if (r.provisional && r.provisionalReasons.length) out.push("### Why the lead is provisional\n" + r.provisionalReasons.map((x) => `- ${x}`).join("\n"));
  out.push(rankTable(r.ranking, cur, r.profile.dealBreakers.length > 0));
  if (r.notes.length) out.push("### How it was scored\n" + r.notes.map((x) => `- ${x}`).join("\n"));
  const nameW = Math.max(...r.cities.map((c) => c.name.length));
  out.push("```\n" + r.cities.map((c) => `${c.name.padEnd(nameW)}  ${textBar(c.total, 100).padEnd(24)} ${num(c.total, 0)}`).join("\n") + "\n```");

  out.push("### Why");
  for (const c of r.cities) out.push(`**${c.rank}. ${c.name}.** ${c.why.join(" ") || "Scores close to the others on everything you weighted."}`);

  out.push("### Points by line");
  const lines = r.cities[0]?.lines.filter((l) => l.weight > 0) ?? [];
  out.push(
    table(
      ["Line", "Weight", ...r.cities.map((c) => c.name)],
      lines.map((l) => [
        `${l.label}${l.dealBreaker ? " (deal-breaker)" : ""}`,
        String(l.weight),
        ...r.cities.map((c) => {
          const x = c.lines.find((y) => y.id === l.id)!;
          return lineCell(x);
        }),
      ]),
      ["l", "r", ...r.cities.map(() => "r" as const)],
    ),
  );

  out.push(`### Money, in ${cur}`);
  const m = (f: (c: CompareReport["cities"][number]) => string) => r.cities.map(f);
  out.push(
    table(
      ["", ...r.cities.map((c) => c.name)],
      [
        [r.cities.some((c) => c.money.earners.length > 1) ? "Gross a year, everyone" : "Gross a year", ...m((c) => money(c.money.yearly.gross.shown, cur))],
        ["Take-home a year", ...m((c) => money(c.money.yearly.net.shown, cur))],
        ["Tax and contributions", ...m((c) => pct(c.money.yearly.effectiveRate))],
        ...(r.cities.some((c) => c.money.monthly.pension.local) ? [["Into pensions a month (still yours)", ...m((c) => money(c.money.monthly.pension.shown, cur))]] : []),
        ["Take-home a month", ...m((c) => money(c.money.monthly.net.shown, cur))],
        ["Rent a month", ...m((c) => money(c.money.monthly.rent.shown, cur))],
        ["Everyday spending a month", ...m((c) => money(c.money.monthly.everyday.shown, cur))],
        ...(r.cities.some((c) => c.money.childcare || c.money.completeness.missing.some((o) => o.startsWith("childcare"))) ? [["Childcare a month, after support", ...m((c) => money(c.money.monthly.childcare.shown, cur))]] : []),
        ["Health a month, out of pocket", ...m((c) => money(c.money.monthly.health.shown, cur))],
        ["Cost a month", ...m((c) => money(c.money.monthly.cost.shown, cur))],
        ["**Left each month**", ...m((c) => `**${money(c.money.monthly.left.shown, cur)}**`)],
        ...(r.cities.some((c) => c.money.breakEven) ? [["Break-even gross a year", ...m((c) => (c.money.breakEven ? `${money(c.money.breakEven.gross.shown, cur)}${c.money.breakEven.vsCurrentPay !== null ? ` (${c.money.breakEven.vsCurrentPay > 0 ? "+" : ""}${pct(c.money.breakEven.vsCurrentPay)})` : ""}` : "–"))]] : []),
        ["Paid holiday by law + public holidays", ...m((c) => `${c.money.leave.holidayDays ?? "–"} + ${c.money.leave.publicHolidays ?? "–"} days`)],
        ["Parental leave, weeks at full pay", ...m((c) => (c.money.leave.mothersWeeks === null ? "–" : `mothers ${num(c.money.leave.mothersWeeks, 1)}, fathers ${c.money.leave.fathersWeeks === null ? "–" : num(c.money.leave.fathersWeeks, 1)}`))],
        ["Rent from", ...m((c) => (c.money.rentSource ? sourceLabel(c.money.rentSource) : "–"))],
        ["Spending from", ...m((c) => c.money.everydayHow ?? "–")],
      ],
      ["l", ...r.cities.map(() => "r" as const)],
    ),
  );
  const be = r.cities.find((c) => c.money.breakEven)?.money.breakEven;
  if (be) out.push(`Break-even: the gross a year that would leave you ${money(be.targetMonthlyShown, cur)} a month, what you keep where you live now; in brackets, against your pay in that city.`);
  const notes = r.cities.flatMap((c) => [...(c.money.filing?.note ? [`${c.name}: ${c.money.filing.mode === "joint" ? "filed jointly" : "filed separately"}. ${c.money.filing.note}`] : []), ...c.money.gaps.map((g) => `${c.name}: ${g}.`), ...(c.money.regime ? [`${c.name}: ${c.money.regime.name} counted${c.money.regime.status === "scenario" ? " as a scenario you chose, not established eligibility" : ""}, up to ${c.money.regime.years} years.`] : []), ...(c.money.completeness.status !== "complete" ? [`${c.name}: money is ${c.money.completeness.status}${c.money.completeness.missing.length ? `, leaving out ${c.money.completeness.missing.join("; ")}` : ""}${c.money.completeness.approximations.length ? `. ${c.money.completeness.approximations.join(" ")}` : ""}`] : [])]);
  if (notes.length) out.push(notes.map((x) => `- ${x}`).join("\n"));
  const incomplete = r.cities.filter((c) => c.money.incomplete);
  if (incomplete.length) out.push(incomplete.map((c) => `- ${c.name}: ${c.money.incomplete}; its money is not scored or shown as a total.`).join("\n"));
  const caveats = [...new Set(r.cities.flatMap((c) => c.money.taxModel?.caveats ?? []))];
  if (caveats.length) out.push(`Tax model caveats: ${caveats.join(" ")}`);
  const taxSources = new Map(r.cities.flatMap((c) => c.money.taxModel?.sources ?? []).map((x) => [x.url, x]));
  if (taxSources.size) out.push("Tax model sources: " + [...taxSources.values()].map((x) => `[${x.label}](${x.url})`).join("; "));

  const rights = r.cities.filter((c) => c.rights.length);
  if (rights.length) {
    out.push("### Who can move there");
    out.push(table(["City", ...rights[0]!.rights.map((p) => p.person)], rights.map((c) => [c.name, ...c.rights.map(rightCell)])));
    out.push(rightsNotes(rights.map((c) => ({ name: c.name, rights: c.rights }))));
  }

  if (r.requiredUnknowns.length) out.push("### Must-pass not known yet\n" + r.requiredUnknowns.map((x) => `- ${x.name}: ${x.lines.join(", ")}`).join("\n"));
  if (r.whatToAdd.length) out.push("### Missing data and what to add\n" + r.whatToAdd.map((x) => `- ${x}`).join("\n"));
  if (r.assumptions.length) out.push("### Assumed\n" + r.assumptions.map((x) => `- ${x}`).join("\n"));
  const figs = r.cities.flatMap((c) => [...c.lines.flatMap((l) => l.sources), ...(c.money.rentSource ? [c.money.rentSource] : []), ...c.money.everydaySources, ...(c.money.childcare?.sources ?? []), ...(c.money.health?.sources ?? []), ...c.money.leave.sources]);
  out.push("### Sources\n" + sourcesUsed(figs).map((x) => `- ${x}`).join("\n") + `\n\nDataset ${r.dataset.version}, exchange rates of ${r.dataset.fxDate}, engine ${r.dataset.engine}. Scores use your weights; no ranking is objective.`);
  return out.join("\n\n");
}

export function cityMarkdown(r: CityReport): string {
  const c = r.city;
  const out: string[] = [];
  out.push(`## ${c.name}, ${r.countryName}`);
  if (r.note) out.push(r.note);
  out.push(`${c.population ? `${num(c.population)} people · ` : ""}${num(c.lat, 3)}, ${num(c.lon, 3)} · currency ${r.currency} · id \`${c.id}\``);
  if (r.rights.length) out.push("### Who can live and work here\n" + r.rights.map((p) => `- ${p.person}: ${p.text}${p.sources.length ? ` Rules checked: ${p.sources.map((x) => `[${x.name}](${x.url})`).join(", ")}.` : ""}`).join("\n"));
  if (r.detail === "summary")
    out.push(table(["Figure", "Value", "Source"], r.figures.map((f) => [f.label, figureValue(f), f.origin === "source" ? `${f.cite ?? ""}${f.approximate ? " (wider area)" : ""}` : sourceLabel(f)])));
  else
    out.push(
      table(
        ["Figure", "Value", "Period", "Level", "Source", "Licence"],
        r.figures.map((f) => [f.label, figureValue(f), f.period ?? "–", f.level ?? "–", f.origin === "source" ? (f.source?.name ?? "") : sourceLabel(f), f.source?.licence ?? "–"]),
      ),
    );
  const h = (x: number) => `${Math.floor(x)} h ${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
  out.push(`Daylight (computed from latitude): shortest day ${h(r.daylight.shortest)}, longest ${h(r.daylight.longest)}.`);
  out.push(r.taxModel ? `Take-home pay model: ${r.taxModel.country} ${r.taxModel.year}. ${r.taxModel.scope}` : "No take-home pay model for this country yet.");
  out.push("### Elsewhere (link only: give the person the link, never read it yourself)\n" + r.linksOut.map((l) => `- [${l.label}](${l.url})`).join("\n"));
  const used = new Set(r.figures.map((f) => f.source?.id ?? "").concat(r.detail === "summary" ? r.sources.map((x) => x.id) : []));
  out.push("### Sources\n" + r.sources.filter((x) => used.has(x.id)).map((x) => (r.detail === "summary" ? `- [${x.name}](${x.url}), ${x.licence.split(/[;(]/)[0]!.trim()}` : `- ${x.name} (${x.publisher}), ${x.licence}: ${x.url}`)).join("\n"));
  return out.join("\n\n");
}

export function netPayMarkdown(r: NetPayReport): string {
  const cur = r.currency;
  const where = [r.cityName, r.region].filter(Boolean).join(", ");
  const out: string[] = [];
  out.push(`## Take-home pay in ${r.countryName}${where ? ` (${where})` : ""}, ${r.year}`);
  const shown = r.shown && r.shown.currency !== cur ? r.shown : null;
  const both = (local: number, s: number | null) => (shown ? `${money(local, cur)} (${money(s, shown.currency)})` : money(local, cur));
  out.push(
    table(
      ["", "A year"],
      [
        ["Gross", both(r.gross, shown?.gross ?? null)],
        ...r.lines.map((l) => [l.saving ? `${l.label} (saved, not a tax)` : l.label, money(-l.amount, cur)]),
        ["**Take-home**", `**${both(r.net, shown?.net ?? null)}**`],
        ["Take-home a month", both(r.monthlyNet, shown?.monthlyNet ?? null)],
        ["Tax and contributions", pct(r.effectiveRate)],
      ],
      ["l", "r"],
    ),
  );
  if (r.people) out.push(table(["", "Gross", "Pension", "Take-home"], r.people.map((p) => [p.label, money(p.gross, cur), money(p.pension, cur), money(p.net, cur)]), ["l", "r", "r", "r"]));
  if (r.filing?.note) out.push(`${r.filing.mode === "joint" ? "Filed jointly" : "Filed separately"}: ${r.filing.note}`);
  if (r.regime) out.push(r.regime.status === "scenario" ? `Regime counted as a scenario you chose, not established eligibility: ${r.regime.name}. Still to confirm: ${r.regime.unconfirmed.join(" ")}` : `Regime counted: ${r.regime.name}, every condition met.`);
  if (r.pensionRelief) out.push(`Pension: ${r.pensionRelief.text}.`);
  if (r.completeness.status !== "complete") out.push(`This figure is ${r.completeness.status}${r.completeness.missing.length ? `: it leaves out ${r.completeness.missing.join("; ")}` : ""}.${r.completeness.approximations.length ? ` ${r.completeness.approximations.join(" ")}` : ""}`);
  out.push(`Covers: ${r.scope}`);
  if (r.caveats.length) out.push("### Caveats\n" + r.caveats.map((x) => `- ${x}`).join("\n"));
  out.push("### Sources\n" + r.sources.map((s) => `- [${s.label}](${s.url})`).join("\n"));
  return out.join("\n\n");
}

const SECTIONS: Record<CatalogueKind, (c: Partial<Catalogue>, cities: number) => string> = {
  criteria: (c) => "### Scoring lines (criteria)\n" + table(["id", "Line", "Question", "Worst → best", "Default weight"], (c.criteria ?? []).map((x) => [x.id, x.label, x.question, `${short(x.worst)} → ${short(x.best)} ${x.unit}`, String(x.defaultWeight)])),
  metrics: (c, cities) => "### Metrics\n" + table(["id", "Metric", "Unit", "Better", "Cities with data"], (c.metrics ?? []).map((m) => [m.id, m.label, m.unit, m.direction, `${m.cities} of ${cities}`])),
  sources: (c) => "### Sources\n" + table(["id", "Source", "Publisher", "Licence", "Figures"], (c.sources ?? []).map((s) => [s.id, `[${s.name}](${s.url})`, s.publisher, s.licence, String(s.observations)])),
  taxModels: (c) => "### Take-home pay models\n" + table(["Country", "Year", "Covers"], (c.taxModels ?? []).map((t) => [t.country, String(t.year), t.scope])),
  pensions: (c) => "### Pension shares by country\n" + table(["Country", "Plan", "Treatment"], (c.pensions ?? []).map((g) => [g.country, g.plan, g.status === "modelled" ? "tax relief modelled" : g.status === "no relief" ? "no relief for employees" : "not modelled, counted as saving"])),
  regimes: (c) => "### Newcomer tax regimes\n" + table(["id", "Country", "Regime", "Up to"], (c.regimes ?? []).map((g) => [g.id, g.country, g.name, `${g.years} years`])),
  presets: (c) => `### Presets\n${(c.presets ?? []).map((p) => `- \`${p.id}\` (${p.label})`).join("\n")}`,
  linkOnly: (c) => `### Link only, never copied\n${(c.linkOnly ?? []).join(", ")}: their licences forbid redistribution and automated reading. Give the person the link; a figure they read there and tell you can be kept with record_observation, in their own cache only.`,
};

export function catalogueMarkdown(c: Catalogue): string {
  const out: string[] = [];
  out.push(`## What the dataset holds (${c.dataset.version}): ${c.dataset.cities} cities, ${c.dataset.observations} figures`);
  for (const k of Object.keys(SECTIONS) as CatalogueKind[]) out.push(SECTIONS[k](c, c.dataset.cities));
  return out.join("\n\n");
}

/** One part of the catalogue; for regimes, each condition with the id to answer it by. */
export function cataloguePartMarkdown(c: Partial<Catalogue> & { kind: CatalogueKind }): string {
  if (c.kind === "regimes")
    return (
      `### Newcomer tax regimes\n` +
      ((c.regimes ?? []).map((g) => `**${g.name}** (\`${g.id}\`, ${g.country}, up to ${g.years} years). ${g.summary}\n${g.conditions.map((x) => `- \`${x.id}\`${x.youConfirm ? " (you confirm)" : ""}: ${x.text}`).join("\n")}`).join("\n\n") || "None modelled for that country.") +
      "\n\nAnswer a condition the person told you about in `household[].regimeConfirmations`, e.g. `{ \"nl-recruited-abroad\": true }`."
    );
  return SECTIONS[c.kind](c, c.dataset?.cities ?? 0);
}
