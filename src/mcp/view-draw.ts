// What the MCP App view draws: every piece of the site a chat answer can call for, as HTML strings in the site's own
// classes (the view's CSS lifts them from src/ui, src/mcp/view-style.ts). Pure on purpose: no DOM, no host, no state,
// so test/mcp-app.test.ts checks the arithmetic (nice-day edits, wins and losses, label placement, the land's months)
// without a browser. It runs in the host's iframe in one script with src/agent/chart.ts, share-link.ts and
// view-client.ts (src/mcp/chart-source.ts drops the imports of one another), so its names must not clash with theirs.
import { esc, money } from "../agent/chart.ts";

type Json = any;

// ---------- Numbers and words ----------
export const fmt = (n: unknown, d = 1) => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: d }) : "–");
export const MONTH_LETTER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
export const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const lineName = (label: string) => String(label).replace(/\s*\(.*$/, "");
export const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
const nameList = (names: string[]) => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names.at(-1));

/** A figure with its unit: money as money ("€872 a month"), everything else as a number and its unit. */
export function figureText(value: number, unit: string): { big: string; small: string } {
  const cur = /^([A-Z]{3})(?:\/(\w+))?$/.exec(unit ?? "");
  if (cur) return { big: money(value, cur[1]!), small: cur[2] ? "a " + cur[2] : "" };
  // Days are counted whole, as the site counts them; other figures keep a decimal while they are small.
  return { big: fmt(value, Math.abs(value) >= 100 || /\bdays?\b/.test(unit ?? "") ? 0 : 1), small: unit ?? "" };
}

// ---------- Nice days: the person's definition, as the site holds it (core/types.ts Comfort) ----------
export interface Comfort { min: number; max: number; basis?: "feels" | "air"; dry?: boolean; clear?: boolean; notMuggy?: boolean; calm?: boolean; daylight?: number }
export const DEFAULT_COMFORT: Comfort = { min: 18, max: 30, basis: "feels" };
/** The tests a nice day can pass besides temperature, worded as the site's "Your nice days" (src/ui/cards.ts). */
export const NICE_TESTS: { id: "dry" | "clear" | "notMuggy" | "calm"; label: string; what: string; on: (c: Comfort) => boolean }[] = [
  { id: "dry", label: "Dry", what: "under 1 mm of rain from 8 am to 8 pm", on: (c) => c.dry !== false },
  { id: "clear", label: "Sunny", what: "at most half the sky clouded from 8 am to 8 pm", on: (c) => c.clear !== false },
  { id: "notMuggy", label: "Not muggy", what: "the day's dew point under 18 °C", on: (c) => !!c.notMuggy },
  { id: "calm", label: "Calm", what: "the daytime wind under 20 km/h", on: (c) => !!c.calm },
];
export const DAYLIGHT_CHOICES = [0, 9, 10, 11, 12, 13, 14, 15];

/** The definition in force: the call's own, else the one the profile was scored with, else the site's start. */
export function comfortOf(query: Json, share: Json): Comfort {
  const c = query?.comfort ?? share?.prefs?.comfort;
  if (!c || typeof c.min !== "number" || typeof c.max !== "number") return { ...DEFAULT_COMFORT };
  const out: Comfort = { min: c.min, max: c.max, basis: c.basis === "air" ? "air" : "feels" };
  for (const k of ["dry", "clear", "notMuggy", "calm"] as const) if (typeof c[k] === "boolean") out[k] = c[k];
  if (typeof c.daylight === "number" && c.daylight > 0) out.daylight = c.daylight;
  return out;
}

export type ComfortChange = { step: "min" | "max"; d: number } | { basis: "feels" | "air" } | { test: "dry" | "clear" | "notMuggy" | "calm"; on: boolean } | { daylight: number };

/** One edit of the definition, the way the site makes it (src/ui/main.ts setComfort and the nice-test handler). */
export function nextComfort(c: Comfort, change: ComfortChange): Comfort {
  const n: Comfort = { ...c };
  if ("step" in change) {
    n[change.step] = Math.max(-20, Math.min(45, Math.round(c[change.step] + change.d)));
    if (n.min > n.max) n[change.step === "min" ? "max" : "min"] = n[change.step];
  } else if ("basis" in change) n.basis = change.basis;
  else if ("test" in change) {
    const k = change.test;
    if (k === "dry" || k === "clear") change.on ? delete n[k] : (n[k] = false);
    else change.on ? (n[k] = true) : delete n[k];
  } else if ("daylight" in change) change.daylight > 0 ? (n.daylight = change.daylight) : delete n.daylight;
  return n;
}

export const rangeLabel = (c: Comfort) => `${c.min}–${c.max}° ${c.basis === "air" ? "air" : "feels"}`;
/** "Dry, sunny" or "Any weather": the tests a nice day passes, said short. */
export function testsShort(c: Comfort): string {
  const t = [...NICE_TESTS.filter((x) => x.on(c)).map((x) => x.label.toLowerCase()), c.daylight ? `${c.daylight} h of daylight` : ""].filter(Boolean);
  const s = t.length ? t.join(", ") : "any weather";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The range button: the site's dashed terracotta pill, which opens the editor in place. */
export const rangeButton = (c: Comfort, open: boolean, key = "act:nice") =>
  `<button type="button" class="range" data-act="nice" data-k="${key}" aria-expanded="${open}" aria-controls="niced" aria-label="Your nice days: ${esc(rangeLabel(c))}, ${esc(testsShort(c).toLowerCase())}. Change">${esc(rangeLabel(c))}</button>`;

/** "Your nice days": the range as steppers, feels like or air, and (where a ranking counts them) the weather tests. */
export function niceEditor(c: Comfort, o: { tests: boolean; note?: string }): string {
  const step = (f: "min" | "max", label: string) =>
    `<span class="stepper"><button type="button" data-act="nice-step" data-field="${f}" data-d="-1" data-k="nice:${f}-" aria-label="${label} colder">−</button><output aria-live="polite" aria-label="${label}">${c[f]}</output><button type="button" data-act="nice-step" data-field="${f}" data-d="1" data-k="nice:${f}+" aria-label="${label} warmer">+</button></span>`;
  const b = c.basis === "air" ? "air" : "feels";
  const seg = `<span class="seg" role="radiogroup" aria-label="Which temperature the range is on">${[["air", "Air"], ["feels", "Feels like"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${b === v}" data-act="nice-basis" data-basis="${v}" data-k="nice:${v}">${l}</button>`).join("")}</span>`;
  const tests = o.tests
    ? `<fieldset class="nice-tests"><legend>And the day is</legend>${NICE_TESTS.map((t) => `<label class="nt"><input type="checkbox" data-nice-test="${t.id}" data-k="nice:${t.id}"${t.on(c) ? " checked" : ""}><b>${t.label}</b><span>${esc(t.what)}</span></label>`).join("")}<label class="nt nt-day"><b>Daylight</b><select data-nice-daylight="1" data-k="nice:daylight" aria-label="Hours of daylight a nice day has at least">${DAYLIGHT_CHOICES.map((h) => `<option value="${h}"${(c.daylight ?? 0) === h ? " selected" : ""}>${h ? `At least ${h} h` : "Any length"}</option>`).join("")}</select></label></fieldset>
      <p class="hint">Rain, sky, humidity and wind: hourly ERA5 reanalysis 2021–2025, via Open-Meteo (CC BY 4.0). Daylight from each city's latitude. Every test must pass on the same day.</p>`
    : "";
  return `<section class="niced" id="niced" aria-label="Your nice days"><p class="niced-h">Your nice days</p><p class="niced-t">${step("min", "Coolest nice daytime temperature")} to ${step("max", "Warmest nice daytime temperature")} °C ${seg}</p>${tests}${o.note ? `<p class="hint">${esc(o.note)}</p>` : ""}</section>`;
}

// ---------- The map's colour: the site's ramp (map.css), stretched over what is shown ----------
/** 5% to 95% of the values, so one outlier does not wash out the rest (src/ui/map-scale.ts stretchScale). */
export function stretchSpan(values: number[]): [number, number] | null {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const q = (p: number) => {
    const i = (a.length - 1) * p, lo = Math.floor(i);
    return a[lo]! + (a[Math.ceil(i)]! - a[lo]!) * (i - lo);
  };
  return [q(0.05), q(0.95)];
}
export const stretch = (v: number, s: [number, number]) => (s[1] - s[0] < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (v - s[0]) / (s[1] - s[0]))));
/** The site's ramp, worst to best, as a CSS colour from its own tokens. */
export function ramp(t: number): string {
  const v = Math.max(0, Math.min(1, t));
  return v < 0.5 ? `color-mix(in srgb, var(--map-mid) ${(v * 200).toFixed(1)}%, var(--map-lo))` : `color-mix(in srgb, var(--map-hi) ${((v - 0.5) * 200).toFixed(1)}%, var(--map-mid))`;
}

// ---------- The land: the published grid, packed at build time (chart-source.ts packedMap) ----------
export interface PackedMap { x0: number; y0: number; pitch: number; runs: number[]; highs: string; digits: string; floor: number; source: string }
export interface Land { n: number; col: Int16Array; row: Int16Array; k: Int16Array; highs: Int8Array; box: [number, number, number, number]; cell: Map<number, number> }
const UNIT = 125;
export const toX = (X: number) => 360 + X * UNIT;
export const toY = (Y: number) => 180 - Y * UNIT;

export function unpackLand(m: PackedMap): Land {
  const n = m.highs.length / 12;
  const col = new Int16Array(n), row = new Int16Array(n), k = new Int16Array(n), highs = new Int8Array(n * 12);
  const digit = new Map([...m.digits].map((c, i) => [c, i + m.floor]));
  let t = 0;
  for (let i = 0; i < m.runs.length; i += 4) for (let j = 0; j < m.runs[i + 2]!; j++, t++) { row[t] = m.runs[i]!; col[t] = m.runs[i + 1]! + j; k[t] = m.runs[i + 3]!; }
  for (let i = 0; i < n * 12; i++) highs[i] = digit.get(m.highs[i]!) ?? 0;
  const cell = new Map<number, number>();
  for (let i = 0; i < n; i++) cell.set(row[i]! * 1000 + col[i]!, i);
  const p = m.pitch * UNIT;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = toX(m.x0 + col[i]! * m.pitch), y = toY(m.y0 - row[i]! * m.pitch);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + p); y1 = Math.max(y1, y + p);
  }
  return { n, col, row, k, highs, box: [x0, y0, x1, y1], cell };
}

/** Months of tile i whose average afternoon high, to the whole degree, sits in [min, max] (core/world-map.ts). */
export function tileMonths(land: Land, i: number, min: number, max: number): number {
  let c = 0;
  for (let m = 0; m < 12; m++) { const h = land.highs[i * 12 + m]!; if (h >= min && h <= max) c++; }
  return c;
}

/** The land as one path per count of months in range (0 to 12), with the site's gaps: wider where countries meet. */
export function landPaths(m: PackedMap, land: Land, c: Comfort): { months: number; d: string; fill: string }[] {
  const size = m.pitch * UNIT, base = size * 0.1, border = size * 0.24;
  const counts = new Int8Array(land.n);
  for (let i = 0; i < land.n; i++) counts[i] = tileMonths(land, i, c.min, c.max);
  const span = stretchSpan([...counts].map((x) => x / 12)) ?? [0, 1];
  const d: string[][] = Array.from({ length: 13 }, () => []);
  const f = (v: number) => Math.round(v * 100) / 100;
  for (let i = 0; i < land.n; i++) {
    const cc = land.col[i]!, rr = land.row[i]!, kk = land.k[i]!;
    const side = (dc: number, dr: number) => { const j = land.cell.get((rr + dr) * 1000 + cc + dc); return (j !== undefined && land.k[j] !== kk ? border : base) / 2; };
    const l = side(-1, 0), r = side(1, 0), t = side(0, -1), b = side(0, 1);
    const x = toX(m.x0 + cc * m.pitch) + l, y = toY(m.y0 - rr * m.pitch) + t;
    d[counts[i]!]!.push(`M${f(x)} ${f(y)}h${f(size - l - r)}v${f(size - t - b)}h${f(-(size - l - r))}z`);
  }
  return d.map((parts, months) => ({ months, d: parts.join(""), fill: ramp(stretch(months / 12, span)) })).filter((x) => x.d);
}

/**
 * The part of the world to show: all of it, or, when the cities sit close together (a comparison in one country or
 * continent), a window around them at the world's own proportions, kept inside the land's box.
 */
export function mapWindow(box: [number, number, number, number], points: [number, number][]): [number, number, number, number] {
  const world: [number, number, number, number] = [box[0] - 4, box[1] - 4, box[2] - box[0] + 8, box[3] - box[1] + 8];
  if (!points.length) return world;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const aspect = world[2] / world[3];
  let w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  w = Math.max(w + 2 * Math.max(40, w * 0.3), 150);
  h = Math.max(h + 2 * Math.max(25, h * 0.3), 150 / aspect);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  if (w > world[2] * 0.6) return world;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const x = Math.max(world[0], Math.min(world[0] + world[2] - w, cx - w / 2));
  const y = Math.max(world[1], Math.min(world[1] + world[3] - h, cy - h / 2));
  return [x, y, w, h];
}

// ---------- Labels that never sit on one another (the site's map labels, src/ui/map.ts) ----------
export interface LabelIn { id: string; x: number; y: number; gap: number; w: number; h: number }
export interface LabelOut { id: string; x: number; y: number; anchor: "start" | "end" | "middle" }
/**
 * Places each label, in the order given (the best city first), at the first of right, left, above and below of its
 * dot that stays inside `box` and overlaps no label placed before nor any dot in `dots`; a label with no free spot is
 * left out (its dot still names the city to a pointer and a screen reader).
 */
export function placeLabels(items: LabelIn[], box: [number, number, number, number], dots: { x: number; y: number; r: number }[]): LabelOut[] {
  const placed: number[][] = dots.map((d) => [d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r]);
  const out: LabelOut[] = [];
  for (const it of items) {
    const spots: [number, number, LabelOut["anchor"]][] = [
      [it.x + it.gap, it.y, "start"],
      [it.x - it.gap - it.w, it.y, "end"],
      [it.x - it.w / 2, it.y - it.gap - it.h / 2, "middle"],
      [it.x - it.w / 2, it.y + it.gap + it.h / 2, "middle"],
    ];
    for (const [lx, ly, anchor] of spots) {
      // A margin in proportion to the label, so it holds at any zoom.
      const pad = it.h * 0.1;
      const b = [lx - pad, ly - it.h / 2 - pad, lx + it.w + pad, ly + it.h / 2 + pad];
      if (b[0]! < box[0] || b[2]! > box[2] || b[1]! < box[1] || b[3]! > box[3]) continue;
      // `gap` is wider than the dot, so a dot's own disc is never in the way of its own label.
      if (placed.some((o) => b[0]! < o[2]! && b[2]! > o[0]! && b[1]! < o[3]! && b[3]! > o[1]!)) continue;
      placed.push(b);
      out.push({ id: it.id, x: anchor === "start" ? lx : anchor === "end" ? lx + it.w : lx + it.w / 2, y: ly, anchor });
      break;
    }
  }
  return out;
}

// ---------- A comparison, read from either shape compare_cities returns ----------
export interface CLine { id: string; label: string; weight: number; mustPass: boolean; cite?: string }
export interface CCity { id: string; name: string; country: string; rank: number; total: number; coverage: number; status: string; ruledOut: string[]; unresolved: string[]; left: number | null; leftAtMost?: number; lines: { id: string; points: number; text: string; noFigure: boolean; cite?: string }[]; money: Json | null }
export interface Comparison { currency: string; verdict: string; lines: CLine[]; cities: CCity[]; notes: string[]; next: string[]; dataset: string; sources: Json[] }

export function comparison(r: Json): Comparison {
  const full = r.detail === "full" || !Array.isArray(r.lines);
  const lines: CLine[] = full
    // The summary's own rule (src/agent/report.ts summarize): must-pass lines, and weighted lines some city has a score on.
    ? (r.cities[0]?.lines ?? []).filter((l: Json) => l.id && l.label && (l.dealBreaker || (l.weight > 0 && r.cities.some((c: Json) => c.lines?.find((x: Json) => x.id === l.id)?.score != null)))).map((l: Json) => ({ id: l.id, label: l.label, weight: Number(l.weight) || 0, mustPass: !!l.dealBreaker }))
    : r.lines.filter((l: Json) => l.id && l.label).map((l: Json) => ({ id: l.id, label: l.label, weight: Number(l.weight) || 0, mustPass: !!l.mustPass, cite: l.cite }));
  const order: Json[] = r.ranking ?? r.cities;
  const cities = order.map((x: Json) => {
    const c = r.cities.find((y: Json) => y.id === x.id) ?? x;
    const m = c.money;
    const money = !m ? null : full
      ? { takeHomeYear: m.yearly?.net?.shown ?? null, grossYear: m.salaryFrom === "none" ? null : m.yearly?.gross?.shown ?? null, effectiveRate: m.yearly?.effectiveRate ?? null, takeHomeMonth: m.monthly?.net?.shown ?? null, costMonth: m.monthly?.cost?.shown ?? null, leftMonth: m.incomplete ? null : m.monthly?.left?.shown ?? null, leftMonthAtMost: m.leftAtMost ?? undefined, incomplete: m.incomplete ?? null, missing: m.missing ?? [], costs: { pension: m.monthly?.pension?.shown ?? null, rent: m.monthly?.rent?.shown ?? null, everyday: m.monthly?.everyday?.shown ?? null, childcare: m.monthly?.childcare?.shown ?? null, health: m.monthly?.health?.shown ?? null } }
      : m;
    return {
      id: x.id, name: x.name ?? c.name, country: x.country ?? c.country ?? "", rank: x.rank ?? c.rank, total: Number(x.total ?? c.total) || 0, coverage: Number(x.coverage ?? c.coverage) || 0,
      status: x.status ?? (x.ruledOut?.length ? "ruled out" : "passes"), ruledOut: x.ruledOut ?? [], unresolved: x.unresolved ?? [],
      left: x.monthlyLeft ?? money?.leftMonth ?? null, leftAtMost: money?.leftMonthAtMost,
      lines: (c.lines ?? []).filter((l: Json) => l.id).map((l: Json) => ({ id: l.id, points: Number(l.points) || 0, text: String(l.text ?? ""), noFigure: full ? l.observed === false || !!l.imputed : !!l.noFigure, cite: l.cite ?? l.sources?.[0]?.cite })),
      money,
    } as CCity;
  });
  const notes = [...(r.notes ?? []), ...(r.provisionalReasons ?? [])];
  const next = r.nextInputs ?? r.whatToAdd ?? [];
  return { currency: r.displayCurrency, verdict: r.verdict ?? "", lines, cities, notes, next, dataset: r.dataset?.version ?? "", sources: r.sources ?? [] };
}

export interface WL { id: string; label: string; d: number; text: string; cite?: string; failing: boolean }
/**
 * Where each city wins and loses against the others, on the engine's points: a line's points here less the average of
 * the other cities' (src/ui/glance.ts deltas). Lines with no figure here are left out; a must-pass line that rules the
 * city out comes first among its losses. Up to three of each, as the site's dossier sheets show.
 */
export function winsLosses(cmp: Comparison): { scale: number; by: Map<string, { wins: WL[]; losses: WL[]; alone: boolean }> } {
  const by = new Map<string, { wins: WL[]; losses: WL[]; alone: boolean }>();
  let scale = 1;
  const all = cmp.cities.map((c) => {
    const others = cmp.cities.filter((o) => o.id !== c.id);
    const ds = cmp.lines.filter((l) => l.weight > 0 || l.mustPass).flatMap((l) => {
      const x = c.lines.find((y) => y.id === l.id);
      if (!x || x.noFigure) return [];
      const pts = others.map((o) => o.lines.find((y) => y.id === l.id)?.points ?? 0);
      const d = others.length ? x.points - pts.reduce((a, b) => a + b, 0) / pts.length : x.points;
      return [{ id: l.id, label: lineName(l.label), d, text: x.text, cite: x.cite ?? l.cite, failing: l.mustPass && c.ruledOut.includes(l.label) }];
    });
    for (const x of ds) scale = Math.max(scale, Math.abs(x.d));
    return { c, ds, alone: !others.length };
  });
  for (const { c, ds, alone } of all) {
    // A must-pass the city fails has no figure to compare, so it is named from the ruling itself.
    const failing: WL[] = cmp.lines.filter((l) => l.mustPass && c.ruledOut.includes(l.label)).map((l) => ds.find((x) => x.id === l.id) ?? { id: l.id, label: lineName(l.label), d: 0, text: "Required, fails", failing: true });
    if (alone) { by.set(c.id, { wins: ds.sort((a, b) => b.d - a.d).slice(0, 3), losses: [], alone }); continue; }
    const wins = ds.filter((x) => x.d > 0.25 && !failing.some((f) => f.id === x.id)).sort((a, b) => b.d - a.d).slice(0, 3);
    const losses = [...failing.map((f) => ({ ...f, failing: true })), ...ds.filter((x) => x.d < -0.25 && !failing.some((f) => f.id === x.id)).sort((a, b) => a.d - b.d)].slice(0, Math.max(3, failing.length));
    by.set(c.id, { wins, losses, alone });
  }
  return { scale, by };
}

function wlRow(x: WL, scale: number, kind: "win" | "loss", alone: boolean): string {
  const w = Math.min(100, (Math.abs(x.d) / scale) * 100);
  const sign = alone ? "" : x.d > 0 ? "+" : "−";
  const said = alone ? `${fmt(x.d)} points of the score` : `${sign}${fmt(Math.abs(x.d))} points against the average of the other cities`;
  return `<li class="wl ${kind}${x.failing ? " is-fail" : ""}" title="${esc(x.label)}: ${esc(x.text)}${x.cite ? ` (${esc(x.cite)})` : ""}. ${said}."><span class="wl-n">${esc(x.label)}</span><span class="wl-v">${x.failing ? "Required, fails" : esc(x.text) + (x.cite ? " · " + esc(x.cite) : "")}</span><span class="wl-d">${x.failing && !x.d ? "" : sign + fmt(Math.abs(x.d))}</span><span class="wl-bar" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i></span></li>`;
}

export function winsLossesHtml(e: { wins: WL[]; losses: WL[]; alone: boolean }, scale: number): string {
  if (e.alone) return `<div><p class="wl-h">Earns most on</p><ol class="wl-list">${e.wins.map((x) => wlRow(x, scale, "win", true)).join("")}</ol></div>`;
  return `<div><p class="wl-h">Wins on</p>${e.wins.length ? `<ol class="wl-list">${e.wins.map((x) => wlRow(x, scale, "win", false)).join("")}</ol>` : '<p class="wl-none">Ahead on nothing weighed.</p>'}</div>` +
    `<div><p class="wl-h">Loses on</p>${e.losses.length ? `<ol class="wl-list">${e.losses.map((x) => wlRow(x, scale, "loss", false)).join("")}</ol>` : '<p class="wl-none">Behind on nothing weighed.</p>'}</div>`;
}

// ---------- Money: the money page's waterfall (styles.css .wf) ----------
export interface WfLine { label: string; amount: number | null; kind: "in" | "out" | "sum"; note?: string }

/** From take-home pay to money left a month, one line per cost; a cost that is not known is said, never a zero. */
export function moneyLines(m: Json): WfLine[] {
  if (!m || m.takeHomeMonth == null) return [];
  const c = m.costs ?? {};
  const out: WfLine[] = [{ label: "Take-home pay", amount: m.takeHomeMonth, kind: "in" }];
  const cost = (label: string, v: unknown) => { if (typeof v === "number" && v !== 0) out.push({ label, amount: -v, kind: "out" }); };
  cost("Pension saving", c.pension);
  cost("Rent", c.rent);
  cost("Everyday spending", c.everyday);
  cost("Childcare", c.childcare);
  cost("Health", c.health);
  if (!m.costs && typeof m.costMonth === "number") cost("Rent and living costs", m.costMonth);
  const left = m.leftMonth ?? (m.leftMonthAtMost !== undefined ? m.leftMonthAtMost : null);
  out.push({ label: m.leftMonth == null && m.leftMonthAtMost !== undefined ? "Left, at most" : "Left a month", amount: m.leftMonth == null && m.costMonth == null ? null : left, kind: "sum", note: m.incomplete ?? undefined });
  return out;
}

export function waterfall(lines: WfLine[], cur: string, label: string): string {
  const top = Math.max(1, ...lines.map((l) => Math.abs(l.amount ?? 0)));
  return `<table class="wf"><caption class="sr">${esc(label)}</caption><tbody>${lines.map((l) => {
    const neg = (l.amount ?? 0) < 0 && l.kind === "sum";
    const cls = l.kind === "sum" ? `wf-sum wf-left${neg ? " wf-neg" : ""}` : l.kind === "out" ? "wf-out" : "";
    const amount = l.amount === null ? "–" : (l.kind === "out" ? "−" + money(Math.abs(l.amount), cur) : money(l.amount, cur));
    return `<tr class="${cls}"><th scope="row">${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</th><td class="wf-bar"><i style="width:${(Math.abs(l.amount ?? 0) / top * 100).toFixed(1)}%"></i></td><td class="num">${amount}</td></tr>`;
  }).join("")}</tbody></table>`;
}

// ---------- Weather: the nice-day strip (src/ui/climate.ts niceStrip) and the climate chart ----------
/** Twelve months as the site's strip: a bar a month, its letter and its count. `top` is the value of a full bar. */
export function monthStrip(months: number[], o: { name: string; what: string; top: number; teal?: boolean }): string {
  const vals = months.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0));
  return `<span class="nstrip" role="img" aria-label="${esc(o.name)}: ${esc(o.what)} by month. ${vals.map((n, i) => `${MONTH_NAME[i]}: ${fmt(n, 0)}`).join("; ")}">${vals.map((n, i) =>
    `<span class="nm month-cell${o.teal ? " is-teal" : ""}" title="${MONTH_NAME[i]}: ${fmt(n, 1)}"><i style="height:${Math.max(n > 0 ? 4 : 0, Math.min(100, (n / Math.max(1e-9, o.top)) * 100)).toFixed(1)}%"></i><b aria-hidden="true">${MONTH_LETTER[i]}</b><small aria-hidden="true">${fmt(n, 0)}</small></span>`).join("")}</span>`;
}

/**
 * The dossier's climate chart: each month's average low to high over the nice-day band, months whose high sits in the
 * range in olive, the rest in bar-out (src/ui/climate.ts monthChart, without the record ticks a chat has no room for).
 */
export function climateChart(low: number[], high: number[], c: Comfort, name: string, narrow: boolean): string {
  const W = narrow ? 360 : 640, H = narrow ? 210 : 220, padL = 30, padR = 8, top = 14, bot = 26;
  const all = [...low, ...high, c.min, c.max].filter(Number.isFinite);
  const tMin = Math.floor((Math.min(...all) - 2) / 5) * 5, tMax = Math.ceil((Math.max(...all) + 2) / 5) * 5;
  const y = (t: number) => top + (H - top - bot) * (1 - (t - tMin) / (tMax - tMin));
  const bw = (W - padL - padR) / 12;
  const grid: string[] = [];
  for (let t = tMin; t <= tMax; t += 5) grid.push(`<line class="grid${t === 0 ? " zero" : ""}" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${padL - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}°</text>`);
  const band = `<rect class="cband" x="${padL}" y="${y(c.max).toFixed(1)}" width="${W - padL - padR}" height="${Math.max(1, y(c.min) - y(c.max)).toFixed(1)}"/><line class="cedge" x1="${padL}" x2="${W - padR}" y1="${y(c.max).toFixed(1)}" y2="${y(c.max).toFixed(1)}"/><line class="cedge" x1="${padL}" x2="${W - padR}" y1="${y(c.min).toFixed(1)}" y2="${y(c.min).toFixed(1)}"/>`;
  const bars = high.map((h, i) => {
    const l = low[i]!, inRange = h >= c.min - 0.5 && h < c.max + 0.5;
    const x = padL + i * bw + bw * 0.22, w = bw * 0.56;
    return `<g class="mb${inRange ? " in" : ""}"><title>${MONTH_NAME[i]}: ${fmt(l)} to ${fmt(h)} °C${inRange ? ", in your range" : ""}</title><rect class="bar" x="${x.toFixed(1)}" y="${y(h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(2, y(l) - y(h)).toFixed(1)}" rx="2"/><text class="ax mo${inRange ? " in" : ""}" x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${narrow ? MONTH_LETTER[i] : MONTH_NAME[i]!.slice(0, 3)}</text></g>`;
  }).join("");
  const inCount = high.filter((h) => h >= c.min - 0.5 && h < c.max + 0.5).length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}: average daily low and high by month, ${c.basis === "air" ? "air" : "feels-like"} temperature, over the nice-day range ${c.min} to ${c.max} °C; ${inCount} months in range">${grid.join("")}${band}${bars}</svg>`;
}

// ---------- Small shared pieces ----------
export const fold = (label: string, body: string, key: string) =>
  `<details class="fold" data-fold="${esc(key)}"><summary data-k="fold:${esc(key)}">${esc(label)} ${CHEVRON}</summary><div class="fold-body">${body}</div></details>`;

/** One "Source:" line when every row shares its sources; otherwise none (each row then names its own). */
export function sharedSource(rows: Json[]): string | null {
  const key = (r: Json) => sourceText(r);
  if (!rows.length) return null;
  const first = key(rows[0]);
  return first && rows.every((r) => key(r) === first) ? first : null;
}
export const sourceText = (r: Json) => [...new Set((r.sources ?? []).map((s: Json) => String(s.label).split(":")[0] + ", " + (s.year ?? "period not recorded") + (s.level && !["city", "metro"].includes(s.level) ? ", " + s.level + " level" : "")))].join("; ");

export function sourcesList(sources: Json[]): string {
  const seen = new Map<string, Json>();
  for (const s of sources) if (s) seen.set((s.id ?? s.label ?? s.name) + ":" + (s.year ?? ""), s);
  return `<ul>${[...seen.values()].map((s) => {
    const label = esc(String(s.label ?? s.name ?? s.id));
    return `<li>${/^https?:\/\//.test(String(s.url ?? "")) ? `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${label}</a>` : label}${s.year ? ", " + esc(String(s.year)) : ""}${s.licence ? ", " + esc(String(s.licence)) : ""}</li>`;
  }).join("")}</ul>`;
}

export const coverageText = (c: Json) => `${c.matched} of ${c.known} known cities have the figure and pass the filters (${c.candidates} candidates; ${c.missing} lack the figure; ${c.filterUnknown} cannot pass an unknown filter). Showing ${c.returned}. Known cities only, not a worldwide list.`;

export const joinNames = nameList;
