// Query the same observations and priority recipes as the comparison engine, without inventing gaps.
import { CRITERIA, moneyGap, niceDays, type Context } from "../core/criteria.ts";
import { evaluate } from "../core/engine.ts";
import { project } from "../core/equal-earth.ts";
import { resolve, type Resolved } from "../core/lookup.ts";
import { convert, money } from "../core/money.ts";
import { ALL_TENANCIES } from "../core/rent-basis.ts";
import { householdRights } from "../core/rights.ts";
import type { City, Dataset } from "../core/types.ts";
import { regionOf, type RegionId } from "../core/visit-region.ts";
import { buildProfile, type QueryArgs } from "./profile.ts";
import { dsInfo, REPORT_VERSION } from "./report.ts";
import { findCity } from "./cities.ts";

export interface Measure {
  metric?: string;
  criterion?: string;
  aggregate?: "sum" | "mean" | "min" | "max";
  month?: number;
}
export interface RankArgs extends Omit<QueryArgs, "cities">, Measure {
  cities?: string[];
  score?: boolean;
  limit?: number;
  order?: "asc" | "desc";
  view?: "ranked" | "world" | "months";
  filters?: {
    countries?: string[];
    region?: RegionId;
    subdivision?: string;
    population?: { min?: number; max?: number };
    ranges?: (Measure & { min?: number; max?: number })[];
    rightToLive?: boolean;
  };
}
export interface Citation { id: string; label: string; year: string | null; url: string; level?: string }
export interface RankedRow {
  rank: number; id: string; name: string; country: string; value: number; unit: string;
  sources: Citation[]; months: number[] | null; point: [number, number]; text: string;
  coverage: number | null; notes: string[];
}

function citations(data: Dataset, rs: Resolved[]): Citation[] {
  const all = rs.flatMap((r): Citation[] => {
    if (r.origin.kind === "you") return [{ id: "you", label: "Your figure", year: null, url: "" }];
    const obs = r.origin.kind === "consensus" ? r.origin.observations : [r.origin.observation];
    return obs.map((o) => ({ id: o.source, label: data.sources[o.source]?.publisher || data.sources[o.source]?.name || o.source, year: o.period, url: data.sources[o.source]?.url ?? "", level: o.level }));
  });
  return [...new Map(all.map((s) => [`${s.id}:${s.year}`, s])).values()];
}
const UNITS: Record<string, string> = {
  nice_days: "days/year", winter_light: "h", right_to_live: "entry ease (0-1)", family_leave: "weeks",
  time_zone: "h", flight_home: "h", field_pay: "/year", field_jobs: "per 1,000 jobs", qol: "points/100",
};

/** Missing array reductions are errors, not silent choices between annual totals and monthly means. */
export function rankCities(data: Dataset, args: RankArgs) {
  if ([!!args.metric, !!args.criterion, !!args.score].filter(Boolean).length !== 1) throw new Error("Choose exactly one of metric, criterion or score.");
  const validate = (m: Measure) => {
    if (!!m.metric === !!m.criterion) throw new Error("Choose exactly one metric or criterion per measure.");
    if (m.month !== undefined && (!Number.isInteger(m.month) || m.month < 1 || m.month > 12)) throw new Error("month is 1 to 12.");
    if (m.month !== undefined && m.aggregate) throw new Error("Use month or aggregate, not both.");
    if (m.metric) {
      const metric = data.metrics[m.metric];
      if (!metric) throw new Error(`Unknown metric: ${m.metric}. Use list_metrics_and_sources.`);
      if (!["scalar", "monthly"].includes(metric.shape)) throw new Error(`${m.metric} holds ${metric.shape}, not comparable numbers. Use its priority line (nice_days for weather bins).`);
      if (metric.shape === "monthly" && !m.aggregate && !m.month) throw new Error(`${m.metric} is monthly: choose aggregate or month.`);
      if (metric.shape === "scalar" && (m.aggregate || m.month)) throw new Error(`${m.metric} is scalar: omit aggregate and month.`);
    } else if (m.criterion !== "after_tax_rent" && !CRITERIA.some((c) => c.id === m.criterion)) throw new Error(`Unknown criterion: ${m.criterion}. Use list_metrics_and_sources.`);
    else if ((m.month || m.aggregate) && m.criterion !== "nice_days") throw new Error("Month selection and aggregation on priority lines are supported for nice_days only.");
  };
  if (!args.score) validate(args);
  else if (args.month || args.aggregate) throw new Error("Overall scores do not support month or aggregate.");
  if (args.filters?.population?.min !== undefined && args.filters.population.max !== undefined && args.filters.population.min > args.filters.population.max) throw new Error("Population min exceeds max.");
  for (const r of args.filters?.ranges ?? []) {
    validate(r);
    if (r.min === undefined && r.max === undefined) throw new Error("A range needs min or max.");
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) throw new Error("Range min exceeds max.");
  }
  const ids = args.cities?.length ? [...new Set(args.cities.map((c) => findCity(data, c).id))] : data.cities.map((c) => c.id);
  const { profile, assumptions } = buildProfile(data, { ...args, cities: ids });
  if (profile.prefs.comfort.min > profile.prefs.comfort.max) throw new Error("Comfort min exceeds max.");
  const f = args.filters;
  const candidates = data.cities.filter((c) => ids.includes(c.id) &&
    (!f?.countries?.length || f.countries.map((s) => s.toUpperCase()).includes(c.country)) &&
    (!f?.region || (regionOf(c.country) === f.region && (f.region !== "europe" || "AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB AX".split(" ").includes(c.country)))) &&
    (!f?.subdivision || c.region === f.subdivision) &&
    (!f?.population || (c.population !== undefined && (f.population.min === undefined || c.population >= f.population.min) && (f.population.max === undefined || c.population <= f.population.max))));
  const reduce = (xs: number[], m: Measure): number => m.month ? xs[m.month - 1]! : m.aggregate === "mean" ? xs.reduce((a, b) => a + b, 0) / xs.length : m.aggregate === "min" ? Math.min(...xs) : m.aggregate === "max" ? Math.max(...xs) : xs.reduce((a, b) => a + b, 0);
  const ctxs = new Map<string, Context>();
  const context = (c: City) => {
    let ctx = ctxs.get(c.id);
    if (!ctx) { ctx = { data, profile, city: c, money: money(data, profile, c), rights: householdRights(data, profile.household, c.country) }; ctxs.set(c.id, ctx); }
    return ctx;
  };
  const read = (c: City, m: Measure) => {
    let value: number | null = null, unit = "", months: number[] | null = null, sources: Citation[] = [], text = "", notes: string[] = [];
    if (m.metric) {
      const metric = data.metrics[m.metric]!;
      const r = resolve(data, profile, c, m.metric);
      unit = metric.unit;
      if (r) {
        if (typeof r.value === "number") value = r.value;
        else if (r.value.length === 12 && r.value.every(Number.isFinite)) { months = r.value; value = reduce(months, m); }
        sources = citations(data, [r]);
      }
      const currency = metric.currency === "local" ? data.countries[c.country]?.currency : metric.currency;
      if (metric.currency === "local" && !currency) {
        value = null;
        months = null;
        notes.push("The local currency is unknown, so no comparable amount is returned.");
      }
      if (currency) {
        // Rank comparable amounts, never mix yen with euros.
        const target = profile.displayCurrency;
        const cv = (n: number) => convert(data, n, currency, target);
        value = value === null ? null : cv(value);
        months = months?.map((n) => cv(n) ?? NaN) ?? null;
        if (months?.some((n) => !Number.isFinite(n))) months = null;
        unit = `${target}${metric.unit.replace(/^(EUR|USD|GBP)/, "")}`;
        if (currency !== target) {
          notes.push(`Converted from ${currency} at ECB rates, ${data.fx.date}.`);
          sources.push({ id: "ecb-fx", label: "European Central Bank exchange rates", year: data.fx.date, url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" });
        }
      }
      text = `${m.aggregate ?? (m.month ? `month ${m.month}` : "figure")}: ${metric.label}`;
    } else if (m.criterion === "after_tax_rent") {
      const ctx = context(c), pay = ctx.money;
      unit = `${profile.displayCurrency}/month`;
      value = moneyGap(pay, "net") || pay.net === null || !pay.rent ? null : convert(data, pay.net / 12 - pay.rent.monthly, pay.localCurrency, profile.displayCurrency);
      sources = citations(data, pay.rent ? [pay.rent.resolved] : []);
      sources.push(...(pay.tax?.sources ?? []).map((s, i) => ({ id: `tax:${c.country}:${i + 1}`, label: s.label, year: String(pay.tax!.year), url: s.url })));
      text = "Take-home pay minus rent, a month";
      notes = ["After tax, pension contributions and rent only. Everyday spending, health premiums, childcare and other costs are not subtracted.", ...pay.taxCompleteness.approximations, ...pay.regimes.filter((r) => r.status === "scenario").map((r) => `${r.person}: ${r.name} is a scenario, not established eligibility: ${r.unconfirmed.join("; ")}`)];
    } else {
      const criterion = CRITERIA.find((x) => x.id === m.criterion)!;
      const ctx = context(c), raw = criterion.raw(ctx);
      value = raw.partial ? null : raw.value;
      sources = citations(data, raw.sources);
      text = raw.text;
      unit = criterion.position ? "distance from your stance" : UNITS[criterion.id] ?? (criterion.metric ? data.metrics[criterion.metric]?.unit : undefined) ?? "priority units";
      if (["money_left", "living_cost", "health_costs", "childcare"].includes(criterion.id)) unit = `${profile.displayCurrency}/month`;
      if (criterion.id === "field_pay") unit = `${profile.displayCurrency}/year`;
      if (criterion.category === "climate" && raw.sources.length === 1 && Array.isArray(raw.sources[0]!.value) && raw.sources[0]!.value.length === 12) months = raw.sources[0]!.value;
      if (criterion.id === "nice_days") {
        months = niceDays(data, profile, c)?.months ?? null;
        if (months && (m.month || m.aggregate)) value = reduce(months, m);
        unit = m.month || m.aggregate && m.aggregate !== "sum" ? "days/month" : "days/year";
      }
      if (["money_left", "living_cost"].includes(criterion.id)) {
        notes = [...ctx.money.gaps, ...ctx.money.completeness.approximations];
        sources.push(...(ctx.money.tax?.sources ?? []).map((s, i) => ({ id: `tax:${c.country}:${i + 1}`, label: s.label, year: String(ctx.money.tax!.year), url: s.url })));
      }
      if (criterion.id === "right_to_live") {
        sources.push(...ctx.rights.flatMap((r, i) => r.sources.map((s, j) => ({ id: `rights:${c.country}:${i + 1}:${j + 1}`, label: s.name, year: r.entryEvidence?.period ?? null, url: s.url }))));
      }
      if (!sources.length && value !== null) sources.push({ id: "profile-and-engine", label: "Borgo calculation from your profile and city metadata", year: null, url: "https://borgo.abcastor.com/methodology" });
    }
    if (sources.some((s) => data.sources[s.id]?.tenancies === "all")) notes.push(ALL_TENANCIES);
    return { value: value !== null && Number.isFinite(value) ? value : null, unit, sources, months, text, notes };
  };
  const scores = args.score ? evaluate(data, profile) : null;
  const missingIds: string[] = [], filterUnknownIds: string[] = [], excludedIds: string[] = [];
  const rows: RankedRow[] = [];
  for (const c of candidates) {
    let unknown = false, excluded = false;
    if (f?.rightToLive) {
      const rights = context(c).rights;
      if (!rights.length || rights.some((r) => r.status === "unknown")) unknown = true;
      if (rights.some((r) => r.status === "no")) excluded = true;
    }
    for (const range of f?.ranges ?? []) {
      const { value } = read(c, range);
      if (value === null) unknown = true;
      else if ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) excluded = true;
    }
    const score = scores?.results.find((r) => r.city.id === c.id);
    const result = score ? {
      value: score.coverage ? score.total : null, unit: "points/100", months: null,
      sources: citations(data, score.lines.filter((l) => l.observed && l.weight > 0).flatMap((l) => l.raw.sources)),
      text: "Your weighted overall score", notes: [...(scores?.notes ?? []), ...score.ruledOut.map((s) => `Ruled out: ${s}`), ...score.unresolved.map((s) => `Unknown must-pass: ${s}`)],
    } : read(c, args);
    if (result.value === null) missingIds.push(c.id);
    if (excluded) { excludedIds.push(c.id); continue; }
    if (unknown) { filterUnknownIds.push(c.id); continue; }
    if (result.value === null) continue;
    if (score) {
      result.sources.push({ id: "borgo-engine", label: "Borgo weighted scoring recipe", year: data.version, url: "https://borgo.abcastor.com/methodology" });
      result.sources.push(...(score.money.tax?.sources ?? []).map((s, i) => ({ id: `tax:${c.country}:${i + 1}`, label: s.label, year: String(score.money.tax!.year), url: s.url })));
    }
    rows.push({ rank: 0, id: c.id, name: c.name, country: c.country, ...result, value: result.value, point: project(c.lon, c.lat), coverage: score?.requestedCoverage ?? null });
  }
  const status = (id: string) => { const r = scores?.results.find((r) => r.city.id === id); return r?.ruledOut.length ? 2 : r?.unresolved.length ? 1 : 0; };
  rows.sort((a, b) => (args.score ? status(a.id) - status(b.id) : 0) || (args.order === "asc" ? a.value - b.value : b.value - a.value) || a.id.localeCompare(b.id));
  const shown = rows.slice(0, args.limit ?? 20).map((r, i) => ({ ...r, rank: i + 1 }));
  let link = `https://borgo.abcastor.com/?cities=${shown.map((r) => encodeURIComponent(r.id)).join(",")}`;
  if (data.publishedCityIds && shown.some((r) => !data.publishedCityIds!.includes(r.id))) {
    // The existing share-link reader offers to fetch named missing places. Never put salary or passports in a link.
    const places = Object.fromEntries(shown.map((r) => [r.id, `${r.name}, ${r.country}`]));
    const bytes = new TextEncoder().encode(JSON.stringify({ cities: shown.map((r) => r.id), places }));
    const encoded = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    link = `https://borgo.abcastor.com/#share=${encoded}`;
  }
  const label = args.score ? "Your overall score" : args.metric ? data.metrics[args.metric]!.label : args.criterion === "after_tax_rent" ? "Money after tax and rent" : CRITERIA.find((c) => c.id === args.criterion)!.label;
  return {
    reportVersion: REPORT_VERSION, kind: "ranking" as const, view: args.view ?? (args.criterion === "nice_days" ? "months" : "ranked"), label,
    measure: { metric: args.metric ?? null, criterion: args.criterion ?? null, score: args.score ?? false, aggregate: args.aggregate ?? null, month: args.month ?? null },
    definition: args.criterion === "nice_days" ? profile.prefs.comfort : null,
    dataset: dsInfo(data), order: args.order ?? "desc", rows: shown, link,
    coverage: { known: data.cities.length, candidates: candidates.length, matched: rows.length, returned: shown.length, missing: missingIds.length, missingIds, filterUnknown: filterUnknownIds.length, filterUnknownIds, excluded: excludedIds.length },
    notes: ["Known cities only, not a worldwide census. Missing figures never become zero. Range bounds are inclusive; missing filter figures and unknown rights do not pass.", "Geographic regions use Borgo's five country groups; subdivision is an exact ISO subdivision code. Population comes from city metadata; places without it do not pass population filters.", ...(args.score ? ["Overall scores may be provisional with missing lines. Check each row's coverage and must-pass notes."] : []), ...assumptions.filter((s) => args.score || (args.criterion === "after_tax_rent" ? !/^No monthly spending|Nice days|Weights are/.test(s) : args.criterion === "nice_days" ? /^Nice days/.test(s) : args.metric ? /^Amounts are/.test(s) : true))],
  };
}
export type Ranking = ReturnType<typeof rankCities>;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
export function rankingMarkdown(r: Ranking): string {
  const c = r.coverage;
  return `## ${r.label}\n\n${c.matched} match from ${c.candidates} candidates (${c.known} known cities); ${c.missing} lack the ranking figure; ${c.filterUnknown} cannot pass an unknown filter. Showing ${c.returned}.\n\n` +
    
    `| # | City | Value | Unit | Source and year |\n|---:|---|---:|---|---|\n` + r.rows.map((x) => `| ${x.rank} | ${cell(x.name)} (${x.country}) | ${x.value.toLocaleString("en-GB", { maximumFractionDigits: Math.abs(x.value) >= 100 ? 0 : 1 })} | ${cell(x.unit)} | ${x.sources.map((s) => `${cell(s.label.split(":")[0]!)} [${cell(s.id)}]${/^https?:\/\//.test(s.url) ? `(${s.url.replace(/\s/g, "%20").replace(/\)/g, "%29")})` : ""}, ${cell(s.year ?? "period not recorded")}${s.level && !["city", "metro"].includes(s.level) ? `, ${s.level} level` : ""}`).join("; ")} |`).join("\n") +
    `\n\n[Open these cities in Borgo](${r.link})\n\n` + [...r.notes, ...r.rows.flatMap((x) => x.notes.map((n) => `${x.name}: ${n}`))].map((n) => `- ${n}`).join("\n");
}
