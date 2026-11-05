import { niceDays } from "../core/criteria.ts";
import { criteriaFor, scoreCandidates, weightOf, type CityResult } from "../core/engine.ts";
import { project } from "../core/equal-earth.ts";
import { rightToLiveWork } from "../core/rights.ts";
import type { City } from "../core/types.ts";
import { monthsInRange, tileCount, tileHighs, type WorldMap } from "../core/world-map.ts";
import { rangeButton } from "./cards.ts";
import { bandOf } from "./climate.ts";
import { html, raw, type Raw } from "./dom.ts";
import { countryName, distance, local as localText, MONTHS, num, tempUnit, tempValue } from "./format.ts";
import { shortLabel } from "./glance.ts";
import { CLOSE } from "./results.ts";
import type { AppState } from "./state.ts";
import { regionName } from "./top.ts";

// The Map: the whole world coloured by what the person values. Land tiles carry what is known everywhere (the
// average afternoon high of each month, from a global grid; who in the household may live in each country); city
// points carry everything else, each scored as it would be if the person added it. Their own cities are ringed and
// numbered, and the list beside the map ranks them by whatever the map is coloured by. Pointing at a place reads it;
// clicking pins it, with the action that fits: add, remove or open its dossier.

type Target = { kind: "city"; id: string } | { kind: "land"; tile: number; place: WorldMap["places"][number] | null };

interface Palette { lo: number[]; hi: number[]; land: number[]; faint: number[]; ink: string; sheet: string; quiet: string; bands: string[] }

const ui = {
  map: null as WorldMap | null,
  loading: null as Promise<void> | null,
  failed: "",
  byCell: new Map<number, number>(),
  view: { k: 1, cx: 0, cy: 0 },
  fitted: false,
  hover: null as Target | null,
  pinned: null as Target | null,
  lens: "score",
  /** 0 to 1: places below this share of the colour scale fade. */
  fade: 0,
  results: new Map<string, CityResult>(),
  /** The lowest and highest city on the current lens, which the colour scale spans. */
  span: null as { lo: CityResult; hi: CityResult; min: number; max: number } | null,
  /** The current value's worst and best ends, in its raw unit. */
  scale: null as [number, number] | null,
  palette: null as Palette | null,
  W: 0,
  H: 0,
  frame: 0,
  cardKey: "",
  drag: null as { x: number; y: number; cx: number; cy: number; moved: boolean } | null,
  pointers: new Map<number, { x: number; y: number }>(),
  pinch: null as { d: number; k: number } | null,
  state: null as AppState | null,
};

const cell = (col: number, row: number) => row * 1000 + col;

// ---------- Data ----------

function ensureMap(onReady: () => void): void {
  if (ui.map || ui.loading) return;
  ui.loading = fetch("data/map.json")
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<WorldMap>;
    })
    .then((m) => {
      ui.map = m;
      for (let i = 0; i < tileCount(m); i++) ui.byCell.set(cell(m.tiles[i * 3]!, m.tiles[i * 3 + 1]!), i);
      onReady();
    })
    .catch(() => {
      ui.failed = "The map's data did not load. Reload the page to try again.";
      onReady();
    });
}

// ---------- Lenses: what the map is coloured by ----------

interface Lens { id: string; label: string; unit?: string }

const FIXED = ["score", "nice_days", "right_to_live", "money_left"];

function lensLabel(id: string, s: AppState): string {
  if (id === "score") return "Your score";
  const c = criteriaFor(s.profile).find((x) => x.id === id);
  return c ? shortLabel(c) : id;
}

/** Every value the map can be coloured by: the four fixed ones, then each dial, the ones that count first. */
function lenses(s: AppState): Lens[] {
  const crit = criteriaFor(s.profile).filter((c) => !FIXED.includes(c.id));
  crit.sort((a, b) => weightOf(s.profile, b) - weightOf(s.profile, a) || shortLabel(a).localeCompare(shortLabel(b)));
  return [...FIXED.map((id) => ({ id, label: lensLabel(id, s) })), ...crit.map((c) => ({ id: c.id, label: shortLabel(c) }))];
}

/**
 * A city's position on the current lens: its score out of 100, or for one value its raw figure placed along that
 * value's own worst-to-best scale (not cut off at either end, so two cities past the worst end still differ).
 * Null where the value has no real data, or for a ruled-out city on the score.
 */
function lensValue(r: CityResult | undefined): number | null {
  if (!r) return null;
  if (ui.lens === "score") return r.ruledOut.length ? null : r.total / 100;
  const l = r.lines.find((x) => x.id === ui.lens);
  if (!l || l.score === null || l.imputed || l.raw.value === null) return null;
  const sc = ui.scale;
  if (!sc || sc[0] === sc[1]) return l.score;
  return (l.raw.value - sc[0]) / (sc[1] - sc[0]);
}

/** A city's shade: its value stretched over the lowest to highest city on the map, so differences show. */
function shade(v: number | null): number | null {
  if (v === null || !ui.span) return v;
  const { min, max } = ui.span;
  return max - min < 1e-9 ? 1 : (v - min) / (max - min);
}

function measureSpan(s: AppState): void {
  let lo: CityResult | null = null;
  let hi: CityResult | null = null;
  for (const c of s.data.cities) {
    const r = ui.results.get(c.id);
    const v = lensValue(r);
    if (v === null) continue;
    if (!lo || v < lensValue(lo)!) lo = r!;
    if (!hi || v > lensValue(hi)!) hi = r!;
  }
  ui.span = lo && hi ? { lo, hi, min: lensValue(lo)!, max: lensValue(hi)! } : null;
}

function lensText(r: CityResult): string {
  if (ui.lens === "score") return r.ruledOut.length ? "ruled out" : `${Math.round(r.total)} / 100`;
  const l = r.lines.find((x) => x.id === ui.lens);
  if (!l) return "";
  if (l.raw.value === null) return localText(l.raw.text || "no data");
  return l.imputed || l.score === null ? "no data" : localText(l.raw.text);
}

/** The person's cities, best first on the current lens. */
function ranked(s: AppState): CityResult[] {
  const mine = s.profile.cities.map((id) => ui.results.get(id)).filter((r): r is CityResult => !!r);
  if (ui.lens === "score") return mine.sort((a, b) => a.rank - b.rank);
  return mine.sort((a, b) => (lensValue(b) ?? -1) - (lensValue(a) ?? -1) || a.rank - b.rank);
}

function hasPassports(s: AppState): boolean {
  return s.profile.household.some((p) => p.citizenships.length > 0);
}

/** How many of the household may live and work in a country without a visa, or null when nobody has said. */
function allowedIn(s: AppState, cc: string): { yes: number; of: number } | null {
  const people = s.profile.household.filter((p) => p.citizenships.length > 0);
  if (!people.length || !cc) return null;
  return { yes: people.filter((p) => rightToLiveWork(s.data, p, cc).allowed).length, of: people.length };
}

// ---------- Colour ----------

function rgbOf(probe: HTMLElement, v: string): number[] {
  probe.style.color = v;
  const m = getComputedStyle(probe).color.match(/[\d.]+/g) ?? ["128", "128", "128"];
  return m.slice(0, 3).map(Number);
}

function readPalette(host: HTMLElement): Palette {
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.append(probe);
  const css = (v: string) => `rgb(${rgbOf(probe, v).join(" ")})`;
  const p: Palette = {
    lo: rgbOf(probe, "var(--map-lo)"),
    hi: rgbOf(probe, "var(--map-hi)"),
    land: rgbOf(probe, "var(--map-land)"),
    faint: rgbOf(probe, "var(--map-faint)"),
    ink: css("var(--ink)"),
    sheet: css("var(--sheet)"),
    quiet: css("var(--quiet)"),
    bands: ["b0", "b1", "b2", "b3", "b4", "b5", "b6"].map((b) => css(`var(--${b})`)),
  };
  probe.remove();
  return p;
}

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * t));
const rgb = (c: number[]) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
const ramp = (p: Palette, t: number) => rgb(mix(p.lo, p.hi, Math.max(0, Math.min(1, t))));

/** Each tile's colour key under the current lens: a share of the scale, or "land" (no value here), or "faint". */
function tileValue(s: AppState, map: WorldMap, i: number): number | "land" | "faint" {
  const cc = map.countries[map.tiles[i * 3 + 2]!] ?? "";
  if (ui.lens === "nice_days") {
    const k = s.profile.prefs.comfort;
    return monthsInRange(map, i, k.min, k.max) / 12;
  }
  if (ui.lens === "right_to_live") {
    const a = allowedIn(s, cc);
    return a ? a.yes / a.of : "land";
  }
  // Every other lens lives on the cities; the land only shows where a must-pass right to live rules a country out.
  if (s.profile.dealBreakers.includes("right_to_live")) {
    const a = allowedIn(s, cc);
    if (a && a.yes < a.of) return "faint";
  }
  return "land";
}

// ---------- View: zoom and centre, in projection units ----------

function worldBox(map: WorldMap) {
  return { x0: map.x0, x1: map.x0 + map.cols * map.pitch, y0: map.y0, y1: map.y0 - map.rows * map.pitch };
}

function scale(map: WorldMap): number {
  return (ui.W / (map.cols * map.pitch)) * ui.view.k;
}

function toScreen(map: WorldMap, X: number, Y: number): [number, number] {
  const s = scale(map);
  return [(X - ui.view.cx) * s + ui.W / 2, (ui.view.cy - Y) * s + ui.H / 2];
}

function toWorld(map: WorldMap, x: number, y: number): [number, number] {
  const s = scale(map);
  return [(x - ui.W / 2) / s + ui.view.cx, ui.view.cy - (y - ui.H / 2) / s];
}

/** Zoom stops when a tile is about 44 pixels: closer than that the grid has nothing more to say. */
function maxZoom(map: WorldMap): number {
  return Math.max(1, 44 / (ui.W / map.cols));
}

function clampView(map: WorldMap): void {
  const b = worldBox(map);
  const s = scale(map);
  const hw = ui.W / 2 / s;
  const hh = ui.H / 2 / s;
  ui.view.k = Math.max(1, Math.min(maxZoom(map), ui.view.k));
  ui.view.cx = b.x1 - b.x0 > 2 * hw ? Math.max(b.x0 + hw, Math.min(b.x1 - hw, ui.view.cx)) : (b.x0 + b.x1) / 2;
  ui.view.cy = b.y0 - b.y1 > 2 * hh ? Math.min(b.y0 - hh, Math.max(b.y1 + hh, ui.view.cy)) : (b.y0 + b.y1) / 2;
}

/** Frames the person's cities; the whole world when there are none, or when asked. */
function fit(s: AppState, map: WorldMap, to: "cities" | "world"): void {
  const b = worldBox(map);
  const pts = to === "world" ? [] : s.profile.cities.map((id) => s.data.cities.find((c) => c.id === id)).filter((c): c is City => !!c).map((c) => project(c.lon, c.lat));
  if (!pts.length) {
    ui.view = { k: 1, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
    return clampView(map);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = 0.18; // the least ground shown around a lone city, in projection units (about 1,100 km)
  const bw = Math.max(maxX - minX, span) * 1.5;
  const bh = Math.max(maxY - minY, span) * 1.6;
  const s1 = ui.W / (map.cols * map.pitch);
  // Close enough to tell the cities apart, never so close that a tile grows past about 15 pixels (10 on a phone).
  const tileCap = (ui.W < 600 ? 10 : 15) / (ui.W / map.cols);
  ui.view = { k: Math.min(ui.W / s1 / bw, ui.H / s1 / bh, tileCap), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  clampView(map);
}

// ---------- Painting ----------

function canvas(): HTMLCanvasElement | null {
  return document.getElementById("map-canvas") as HTMLCanvasElement | null;
}

export function paintMap(): void {
  cancelAnimationFrame(ui.frame);
  ui.frame = requestAnimationFrame(draw);
}

function draw(): void {
  const s = ui.state;
  const map = ui.map;
  const cv = canvas();
  if (!s || !map || !cv) return;
  const stage = cv.parentElement!;
  const W = stage.clientWidth;
  const H = Math.round(W < 600 ? W * 0.92 : W / 2.05);
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (W !== ui.W || H !== ui.H) {
    ui.W = W;
    ui.H = H;
    cv.style.height = `${H}px`;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    if (!ui.fitted) {
      fit(s, map, "cities");
      ui.fitted = true;
    }
    clampView(map);
  }
  if (!ui.palette) ui.palette = readPalette(stage);
  const p = ui.palette;
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Land tiles, grouped by colour so each colour is one fill. A wider gap where two countries meet.
  const size = map.pitch * scale(map);
  const base = size >= 4 ? size * 0.1 : Math.min(0.6, size * 0.15);
  const border = size >= 4 ? size * 0.24 : base;
  const radius = Math.min(3, size * 0.22);
  const paths = new Map<string, Path2D>();
  const n = tileCount(map);
  for (let i = 0; i < n; i++) {
    const col = map.tiles[i * 3]!;
    const row = map.tiles[i * 3 + 1]!;
    const [x, y] = toScreen(map, map.x0 + col * map.pitch, map.y0 - row * map.pitch);
    if (x > W || y > H || x + size < 0 || y + size < 0) continue;
    const k = map.tiles[i * 3 + 2]!;
    const side = (c: number, r: number) => {
      const j = ui.byCell.get(cell(c, r));
      return j !== undefined && map.tiles[j * 3 + 2] !== k ? border : base;
    };
    const l = side(col - 1, row) / 2;
    const r = side(col + 1, row) / 2;
    const t = side(col, row - 1) / 2;
    const b = side(col, row + 1) / 2;
    const v = tileValue(s, map, i);
    const key = typeof v === "number" ? (v < ui.fade - 1e-9 ? `f${Math.round(v * 48)}` : `v${Math.round(v * 48)}`) : v;
    let path = paths.get(key);
    if (!path) paths.set(key, (path = new Path2D()));
    if (radius >= 0.8) path.roundRect(x + l, y + t, size - l - r, size - t - b, radius);
    else path.rect(x + l, y + t, size - l - r, size - t - b);
  }
  for (const [key, path] of paths) {
    const v = Number(key.slice(1)) / 48;
    ctx.globalAlpha = key[0] === "f" ? 0.28 : 1;
    ctx.fillStyle = key === "land" ? rgb(p.land) : key === "faint" ? rgb(p.faint) : ramp(p, v);
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;

  // The pinned or pointed-at land tile and its place.
  const focus = ui.pinned ?? ui.hover;
  if (focus?.kind === "land") {
    const col = map.tiles[focus.tile * 3]!;
    const row = map.tiles[focus.tile * 3 + 1]!;
    const [x, y] = toScreen(map, map.x0 + col * map.pitch, map.y0 - row * map.pitch);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, size + 2, size + 2, radius + 1);
    ctx.stroke();
    if (focus.place) {
      const [px, py] = toScreen(map, ...project(focus.place[3], focus.place[2]));
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, p, focus.place[0], px, py, 7, true);
    }
  }

  // Cities: everyone else's first, faint where faded, then the person's own, ringed and numbered.
  const mine = ranked(s);
  const order = new Map(mine.map((r, i) => [r.city.id, i + 1]));
  const rd = Math.max(3.5, Math.min(7, 2.6 + ui.view.k * 0.7));
  const others = s.data.cities.filter((c) => !order.has(c.id)).map((c) => ({ c, v: shade(lensValue(ui.results.get(c.id))) }));
  others.sort((a, b) => (a.v ?? -1) - (b.v ?? -1));
  const placed: number[][] = [];
  for (const { c, v } of others) {
    const [x, y] = toScreen(map, ...project(c.lon, c.lat));
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
    dot(ctx, p, x, y, rd, v, false);
  }
  for (const r of mine) {
    const [x, y] = toScreen(map, ...project(r.city.lon, r.city.lat));
    dot(ctx, p, x, y, rd + 2.5, shade(lensValue(r)), true);
    // Labels keep off the person's own dots.
    const o = rd + 5;
    placed.push([x - o, y - o, x + o, y + o]);
  }
  // Labels: the person's cities always, the others once there is room; never on top of each other.
  for (const r of mine) {
    const [x, y] = toScreen(map, ...project(r.city.lon, r.city.lat));
    const box = label(ctx, p, `${order.get(r.city.id)}  ${r.city.name}`, x, y, rd + 7, true, placed, true);
    if (box) placed.push(box);
  }
  if (ui.view.k >= 2.2) {
    for (const { c, v } of [...others].reverse()) {
      if (v !== null && v < ui.fade) continue;
      const [x, y] = toScreen(map, ...project(c.lon, c.lat));
      if (x < 0 || y < 0 || x > W || y > H) continue;
      const box = label(ctx, p, c.name, x, y, rd + 4, false, placed);
      if (box) placed.push(box);
    }
  }
  const hc = focus?.kind === "city" ? s.data.cities.find((c) => c.id === focus.id) : null;
  if (hc) {
    const [x, y] = toScreen(map, ...project(hc.lon, hc.lat));
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, rd + (order.has(hc.id) ? 7 : 4.5), 0, Math.PI * 2);
    ctx.stroke();
  }
  placeCard();
}

function dot(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, r: number, v: number | null, mine: boolean): void {
  const faded = v !== null && v < ui.fade;
  ctx.globalAlpha = faded ? 0.3 : 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (v === null) {
    // No real data on this value, or ruled out: an open ring, so a gap never reads as a low score.
    ctx.fillStyle = p.sheet;
    ctx.fill();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = p.quiet;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = ramp(p, v);
    ctx.fill();
    ctx.strokeStyle = p.sheet;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (mine) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2.2, 0, Math.PI * 2);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * A condensed caps label for a point at (x, y), `gap` pixels from it, with a sheet-coloured halo. It tries the right,
 * the left, above and below, and takes the first spot that overlaps no label already placed; null when none is free.
 * `always` draws it on the right even when every spot is taken (the person's own cities are always named).
 */
function label(ctx: CanvasRenderingContext2D, p: Palette, text: string, x: number, y: number, gap: number, strong: boolean, placed?: number[][], always = false): number[] | null {
  ctx.font = `${strong ? 700 : 600} ${strong ? 14 : 12.5}px Bib, "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.letterSpacing = "0.6px";
  const t = text.toUpperCase();
  const w = ctx.measureText(t).width;
  const h = strong ? 14 : 12;
  const spots: [number, number][] = [
    [x + gap, y],
    [x - gap - w, y],
    [x - w / 2, y - gap - h / 2 - 2],
    [x - w / 2, y + gap + h / 2 + 2],
  ];
  const fits = ([lx, ly]: [number, number]) => lx >= 2 && lx + w <= ui.W - 2 && ly - h / 2 >= 0 && ly + h / 2 <= ui.H;
  const box = ([lx, ly]: [number, number]) => [lx - 2, ly - h / 2 - 2, lx + w + 2, ly + h / 2 + 2];
  const free = (b: number[]) => !placed?.some((o) => b[0]! < o[2]! && b[2]! > o[0]! && b[1]! < o[3]! && b[3]! > o[1]!);
  let spot = spots.find((sp) => fits(sp) && free(box(sp)));
  if (!spot && always) spot = spots.find(fits) ?? spots[0]!;
  if (!spot) {
    ctx.letterSpacing = "0px";
    return null;
  }
  const [lx, ly] = spot;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = p.sheet;
  ctx.strokeText(t, lx, ly + 0.5);
  ctx.fillStyle = strong ? p.ink : p.quiet;
  ctx.fillText(t, lx, ly + 0.5);
  ctx.letterSpacing = "0px";
  return box(spot);
}

// ---------- Pointing, dragging, pinching ----------

function at(map: WorldMap, s: AppState, x: number, y: number): Target | null {
  const rd = Math.max(3.5, Math.min(7, 2.6 + ui.view.k * 0.7));
  let best: Target | null = null;
  let bd = Infinity;
  for (const c of s.data.cities) {
    const [cx, cy] = toScreen(map, ...project(c.lon, c.lat));
    const d = Math.hypot(cx - x, cy - y);
    const reach = (s.profile.cities.includes(c.id) ? rd + 5 : rd + 3) + 4;
    if (d < reach && d < bd) [best, bd] = [{ kind: "city", id: c.id }, d];
  }
  if (best) return best;
  const [X, Y] = toWorld(map, x, y);
  const col = Math.floor((X - map.x0) / map.pitch);
  const row = Math.floor((map.y0 - Y) / map.pitch);
  const tile = ui.byCell.get(cell(col, row));
  if (tile === undefined) return null;
  return { kind: "land", tile, place: nearestPlace(map, x, y) };
}

/** The populated place nearest the pointer, within reach of it on screen (bigger reach when zoomed out). */
function nearestPlace(map: WorldMap, x: number, y: number): WorldMap["places"][number] | null {
  const reach = Math.max(28, 90 / ui.view.k);
  let best: WorldMap["places"][number] | null = null;
  let bd = Infinity;
  for (const pl of map.places) {
    const [px, py] = toScreen(map, ...project(pl[3], pl[2]));
    const d = Math.hypot(px - x, py - y);
    if (d < reach && d < bd) [best, bd] = [pl, d];
  }
  return best;
}

const same = (a: Target | null, b: Target | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === "city" ? a.id === (b as { id: string }).id : a.tile === (b as { tile: number }).tile && a.place?.[0] === (b as { place: unknown[] | null }).place?.[0]));

function local(e: PointerEvent): [number, number] {
  const r = canvas()!.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function onDown(e: PointerEvent): void {
  const map = ui.map;
  if (!map) return;
  const [x, y] = local(e);
  ui.pointers.set(e.pointerId, { x, y });
  try {
    (e.target as Element).setPointerCapture(e.pointerId);
  } catch {
    // a synthetic or already-released pointer: dragging still works while it stays over the map
  }
  if (ui.pointers.size === 2) {
    const [a, b] = [...ui.pointers.values()];
    ui.pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: ui.view.k };
    ui.drag = null;
    return;
  }
  ui.drag = { x, y, cx: ui.view.cx, cy: ui.view.cy, moved: false };
}

function onMove(e: PointerEvent): void {
  const map = ui.map;
  const s = ui.state;
  if (!map || !s) return;
  const [x, y] = local(e);
  if (ui.pointers.has(e.pointerId)) ui.pointers.set(e.pointerId, { x, y });
  if (ui.pinch && ui.pointers.size === 2) {
    const [a, b] = [...ui.pointers.values()];
    zoomAt(map, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, (ui.pinch.k * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / ui.pinch.d / ui.view.k);
    return;
  }
  if (ui.drag) {
    const dx = x - ui.drag.x;
    const dy = y - ui.drag.y;
    if (Math.hypot(dx, dy) > 4) ui.drag.moved = true;
    if (ui.drag.moved) {
      const sc = scale(map);
      ui.view.cx = ui.drag.cx - dx / sc;
      ui.view.cy = ui.drag.cy + dy / sc;
      clampView(map);
      canvas()!.classList.add("is-dragging");
      paintMap();
      return;
    }
  }
  if (e.pointerType !== "mouse") return;
  const t = at(map, s, x, y);
  canvas()!.style.cursor = t ? "pointer" : "grab";
  if (!same(t, ui.hover)) {
    ui.hover = t;
    if (!ui.pinned) renderCard();
    paintMap();
  }
}

function onUp(e: PointerEvent): void {
  const map = ui.map;
  const s = ui.state;
  ui.pointers.delete(e.pointerId);
  if (ui.pointers.size < 2) ui.pinch = null;
  canvas()?.classList.remove("is-dragging");
  const d = ui.drag;
  ui.drag = null;
  if (!map || !s || !d || d.moved || e.type === "pointercancel") return;
  const [x, y] = local(e);
  const t = at(map, s, x, y);
  ui.pinned = t && !same(t, ui.pinned) ? t : null;
  ui.hover = null;
  renderCard();
  paintMap();
}

function onLeave(): void {
  if (!ui.hover) return;
  ui.hover = null;
  if (!ui.pinned) renderCard();
  paintMap();
}

function onWheel(e: WheelEvent): void {
  // Zoom only on a pinch (trackpads send it as ctrl + wheel) or with ⌘/Ctrl held; plain scrolling scrolls the page.
  const map = ui.map;
  if (!map || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const r = canvas()!.getBoundingClientRect();
  zoomAt(map, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
}

function zoomAt(map: WorldMap, x: number, y: number, f: number): void {
  const [X, Y] = toWorld(map, x, y);
  ui.view.k = Math.max(1, Math.min(maxZoom(map), ui.view.k * f));
  const s = scale(map);
  ui.view.cx = X - (x - ui.W / 2) / s;
  ui.view.cy = Y + (y - ui.H / 2) / s;
  clampView(map);
  paintMap();
}

// ---------- The card: what a pointed-at or pinned place is, and what you can do with it ----------

function placeCard(): void {
  const card = document.getElementById("map-card");
  const map = ui.map;
  const t = ui.pinned ?? ui.hover;
  if (!card || !map || !t || card.hidden) return;
  if (innerWidth < 600) {
    card.style.left = card.style.top = "";
    return;
  }
  let X: number, Y: number;
  if (t.kind === "city") {
    const c = ui.state!.data.cities.find((x) => x.id === t.id);
    if (!c) return;
    [X, Y] = project(c.lon, c.lat);
  } else {
    X = map.x0 + (map.tiles[t.tile * 3]! + 0.5) * map.pitch;
    Y = map.y0 - (map.tiles[t.tile * 3 + 1]! + 0.5) * map.pitch;
  }
  const [x, y] = toScreen(map, X, Y);
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const left = Math.max(8, Math.min(ui.W - w - 8, x - w / 2));
  const above = y - h - 18 >= 0;
  card.style.left = `${left}px`;
  card.style.top = `${above ? y - h - 18 : Math.min(ui.H - h - 8, y + 18)}px`;
  card.dataset.side = above ? "above" : "below";
  card.style.setProperty("--arrow", `${Math.max(16, Math.min(w - 16, x - left))}px`);
}

export function renderCard(): void {
  const card = document.getElementById("map-card");
  const s = ui.state;
  const map = ui.map;
  if (!card || !s || !map) return;
  const t = ui.pinned ?? ui.hover;
  if (!t) {
    card.hidden = true;
    ui.cardKey = "";
    return;
  }
  const markup = (t.kind === "city" ? cityCard(s, t.id) : landCard(s, map, t)).value;
  const key = `${!!ui.pinned}|${markup}`;
  if (key !== ui.cardKey) {
    card.innerHTML = markup;
    card.classList.toggle("is-pinned", !!ui.pinned);
    ui.cardKey = key;
  }
  card.hidden = false;
  placeCard();
}

function monthBars(values: number[], max: number, title: string): Raw {
  return html`<div class="mc-months" role="img" aria-label="${title}">${values.map(
    (v, i) => html`<span><i style="height:${Math.round((100 * Math.min(v, max)) / max)}%"></i><b>${MONTHS[i]}</b></span>`,
  )}</div>`;
}

function cityCard(s: AppState, id: string): Raw {
  const r = ui.results.get(id);
  const city = s.data.cities.find((c) => c.id === id)!;
  const mine = s.profile.cities.includes(id);
  const evaluated = s.profile.cities.length + (mine ? 0 : 1);
  const nice = niceDays(s.data, s.profile, city)?.months ?? null;
  const k = s.profile.prefs.comfort;
  const head = html`<div class="mc-head"><b class="mc-name">${city.name}</b><span class="mc-meta">${countryName(s.data, city.country)}</span>${ui.pinned ? html`<button class="chip-x mc-x" data-act="map-unpin" aria-label="Close">${CLOSE}</button>` : ""}</div>`;
  if (!r) return html`${head}<p class="mc-line quiet">Not scored yet.</p>`;
  const out = r.ruledOut.length > 0;
  const score = html`<p class="mc-score"><span class="mc-big num">${Math.round(r.total)}</span><small>/ 100</small><span class="mc-rank">${out ? "ruled out" : mine ? `No. ${r.rank} of ${evaluated}` : `would be No. ${r.rank} of ${evaluated}`}</span></p>`;
  const lens = ui.lens !== "score" && ui.lens !== "nice_days" ? html`<p class="mc-line"><span class="mc-k">${lensLabel(ui.lens, s)}</span> ${lensText(r)}</p>` : "";
  const actions = ui.pinned
    ? html`<div class="mc-act">${mine
        ? html`<a class="ink-btn" href="#/city/${id}">Open dossier</a><button class="link" data-act="remove-city" data-city="${id}">Remove from your cities</button>`
        : html`<button class="ink-btn" data-act="add-known" data-city="${id}">Add ${city.name}</button>`}</div>`
    : html`<p class="mc-hint">${mine ? "Click for its dossier" : `Click to add ${city.name}`}</p>`;
  return html`${head}${score}${lens}
    ${nice ? html`<p class="mc-line"><span class="mc-k">Nice days</span> ${num(nice.reduce((a, b) => a + b, 0))} a year in your ${tempValue(k.min)}–${tempValue(k.max)}°</p>${monthBars(nice, 31, "Nice days by month")}` : ""}
    ${!mine && !out ? html`<p class="mc-note">If you add it. ${r.coverage < 0.999 ? `${Math.round(r.coverage * 100)}% of this score from real data.` : ""}</p>` : ""}
    ${actions}`;
}

function landCard(s: AppState, map: WorldMap, t: Extract<Target, { kind: "land" }>): Raw {
  const cc = map.countries[map.tiles[t.tile * 3 + 2]!] ?? "";
  const k = s.profile.prefs.comfort;
  const highs = tileHighs(map, t.tile);
  const inRange = monthsInRange(map, t.tile, k.min, k.max);
  const country = cc ? countryName(s.data, cc) : "No country code";
  const a = allowedIn(s, cc);
  const pl = t.place;
  const name = pl ? pl[0] : country;
  const rights = a
    ? html`<p class="mc-line"><span class="mc-k">Right to live</span> ${a.yes === a.of ? (a.of === 1 ? "you can live and work here" : "all of you can live and work here") : a.yes === 0 ? "a visa for everyone" : `${a.yes} of ${a.of} of you without a visa`}</p>`
    : "";
  // By GeoNames id where Natural Earth gives one: a name alone can find a namesake (Iraklio is also an Athens suburb).
  const q = pl ? (pl[5] ? `geonames:${pl[5]}` : `${pl[0]}, ${pl[1]}`) : "";
  const actions = ui.pinned
    ? pl
      ? html`<div class="mc-act"><button class="ink-btn" data-act="map-add-place" data-q="${q}" data-name="${pl[0]}">Add ${pl[0]}</button></div><p class="mc-note">Its figures are fetched from the open sources, as with Add any city.</p>`
      : html`<p class="mc-note">No town of 50,000 people near here. Zoom in, or type a place in Add any city.</p>`
    : html`<p class="mc-hint">${pl ? `Click to add ${pl[0]}` : "Zoom in to pick a town"}</p>`;
  return html`<div class="mc-head"><b class="mc-name">${name}</b><span class="mc-meta">${pl ? html`${regionName(pl[1])}${pl[4] >= 1000 ? html` · ${pl[4] >= 1e6 ? `${num(pl[4] / 1e6, 1)} million` : num(Math.round(pl[4] / 1000) * 1000)} people` : ""}` : "land"}</span>${ui.pinned ? html`<button class="chip-x mc-x" data-act="map-unpin" aria-label="Close">${CLOSE}</button>` : ""}</div>
    <p class="mc-line"><span class="mc-k">Afternoon highs</span> ${inRange} ${inRange === 1 ? "month" : "months"} in your ${tempValue(k.min)}–${tempValue(k.max)}°</p>
    <div class="mc-highs" role="img" aria-label="Average afternoon high by month: ${highs.map((h) => tempValue(h)).join(", ")} ${tempUnit()}">${highs.map(
      (h, i) => html`<span class="b${bandOf(h, k)} ${Math.round(h) >= k.min && Math.round(h) <= k.max ? "is-in" : ""}"><b>${tempValue(h)}°</b><i>${MONTHS[i]}</i></span>`,
    )}</div>
    <p class="mc-note">Air temperature, averaged over this tile's ground (about ${distance(150)}), 2001–2025.</p>
    ${rights}${actions}`;
}

// ---------- The page around the map: lens pills, legend, fade, ranked lists ----------

function lensPicker(s: AppState): Raw {
  const all = lenses(s);
  const extra = all.filter((l) => !FIXED.includes(l.id));
  const other = !FIXED.includes(ui.lens);
  return html`<div class="ml-row" role="group" aria-label="Colour the map by">
    ${all.filter((l) => FIXED.includes(l.id)).map((l) => html`<button class="pill-btn" data-act="map-lens" data-lens="${l.id}" aria-pressed="${ui.lens === l.id}">${l.label}</button>`)}
    <label class="ml-any ${other ? "is-on" : ""}"><span class="sr">Another value</span><select id="map-lens-any" data-map-lens="1">
      <option value="" ${other ? "" : "selected"}>Any other value…</option>
      ${extra.map((l) => html`<option value="${l.id}" ${ui.lens === l.id ? "selected" : ""}>${l.label}${weightOf(s.profile, criteriaFor(s.profile).find((c) => c.id === l.id)!) === 0 ? " (off)" : ""}</option>`)}
    </select></label>
  </div>`;
}

/** The two ends of the cities' colour scale: the lowest and the highest city on the map, in the value's own words. */
function scaleEnds(): [string, string] {
  if (!ui.span) return ["", ""];
  if (ui.lens === "score") return [`${Math.round(ui.span.lo.total)}`, `${Math.round(ui.span.hi.total)} / 100`];
  // Short ends: the unit's words ("nice days a year", "a month") are in the sentence beside the scale.
  const short = (r: CityResult) => lensText(r).replace(/ nice days a year$| days a year$| a year$| a month$/, "");
  return [short(ui.span.lo), short(ui.span.hi)];
}

function rampBar(lo: string, hi: string, what: Raw | string): Raw {
  return html`<div class="mlg-row"><span class="mlg-end num">${lo}</span><span class="mlg-ramp" aria-hidden="true"></span><span class="mlg-end num">${hi}</span><span class="mlg-what">${what}</span></div>`;
}

function legend(s: AppState): Raw {
  const [lo, hi] = scaleEnds();
  const ends = ui.span ? html` <span class="quiet">(${ui.span.lo.city.name} lowest, ${ui.span.hi.city.name} highest)</span>` : "";
  const rows: Raw[] = [];
  if (ui.lens === "nice_days") {
    rows.push(rampBar("0", "12 months", html`<b>Land:</b> months whose average afternoon high is in your ${rangeButton(s, "map")} <span class="quiet">(air)</span>`));
    rows.push(rampBar(lo, hi, html`<b>Cities:</b> nice days a year, dry and mostly clear with the day in your range${ends}`));
  } else if (ui.lens === "right_to_live") {
    rows.push(
      hasPassports(s)
        ? html`<div class="mlg-row"><span class="mlg-sw is-hi"></span>all of you <span class="mlg-sw is-mid"></span>some of you <span class="mlg-sw is-lo"></span>no one, without a visa <span class="mlg-what">by citizenship and free-movement areas (EU and EEA, Swiss-EU, Common Travel Area, Trans-Tasman)</span></div>`
        : html`<div class="mlg-row"><span class="mlg-what">Add your passports and the map shows where each of you may live and work without a visa.</span><button class="pill-btn" data-act="household">Add passports</button></div>`,
    );
  } else {
    rows.push(
      !ui.span
        ? html`<div class="mlg-row"><span class="mlg-what">${ui.lens === "score" ? "Every city on the map is ruled out by a must-pass line. Turn one off in What matters to see them scored." : `No city on the map has data on ${lensLabel(ui.lens, s).toLowerCase()} yet.`}</span></div>`
        : rampBar(lo, hi, ui.lens === "score" ? html`<b>Cities:</b> your score, as each would score among your cities${ends}` : html`<b>Cities:</b> ${lensLabel(ui.lens, s).toLowerCase()}${/ a (year|month)$/.test(lensText(ui.span.hi)) ? lensText(ui.span.hi).match(/ a (year|month)$/)![0] : ""}${ends}`),
    );
    if (s.profile.dealBreakers.includes("right_to_live") && hasPassports(s)) rows.push(html`<div class="mlg-row"><span class="mlg-sw is-faint"></span><span class="mlg-what">Faint land: countries your must-pass right to live rules out</span></div>`);
  }
  const fadeOut = Math.round(ui.fade * 100);
  return html`<div class="mlg">${rows}
    <div class="mlg-row mlg-keys"><span class="mlg-dot is-mine"></span>your cities, numbered in this order <span class="mlg-dot is-none"></span>${ui.lens === "score" ? "ruled out" : "no data"}</div>
    <label class="mlg-fade"><span>Fade the weakest</span><input type="range" id="map-fade" min="0" max="90" step="5" value="${fadeOut}" style="--fill:${(fadeOut / 90) * 100}%" aria-valuetext="${fadeOut ? `below ${fadeOut}% of the scale` : "nothing faded"}"><output class="num" for="map-fade">${fadeOut ? `below ${fadeOut}%` : "off"}</output></label>
  </div>`;
}

function sourcesLine(map: WorldMap | null): Raw {
  const power = map?.sources.find((x) => x.id === "nasa-power");
  const api = power?.what.match(/API (v[\d.]+)/)?.[1] ?? "";
  const period = power?.period.replace("-", "–") ?? "2001–2025";
  return html`<p class="msrc">Land climate: NASA Langley Research Center's <a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener">POWER</a> project (Climatology API ${api}, MERRA-2, ${period}, read ${power?.retrieved ?? ""}); each tile averages about 150 km of ground. Cities: the same open sources as their sheets. Countries and towns: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>. In the spirit of Nick Winans' <a href="https://github.com/Nicell/where-to-live" target="_blank" rel="noopener">Where to Live</a> map of the US.</p>`;
}

function lists(s: AppState): Raw {
  const mine = ranked(s);
  const mineIds = new Set(s.profile.cities);
  const rest = s.data.cities
    .filter((c) => !mineIds.has(c.id))
    .map((c) => ({ r: ui.results.get(c.id), v: lensValue(ui.results.get(c.id)) }))
    .filter((x): x is { r: CityResult; v: number } => !!x.r && x.v !== null)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  const label = lensLabel(ui.lens, s);
  return html`<h3 class="sh mr-h">Your cities</h3>
    <p class="vs-lede">${ui.lens === "score" ? "By your score" : `By ${label.toLowerCase()}`}</p>
    ${mine.length
      ? html`<ol class="mrank">${mine.map((r, i) => {
          const v = lensValue(r);
          return html`<li class="${ui.pinned?.kind === "city" && ui.pinned.id === r.city.id ? "is-on" : ""}"><button class="mr-go" data-act="map-pin" data-city="${r.city.id}"><b class="mr-n num">${i + 1}</b><span class="mr-name">${r.city.name}</span><span class="mr-v num">${lensText(r)}</span><span class="mr-bar"><i style="width:${v === null ? 0 : Math.max(3, Math.round(100 * shade(v)!))}%"></i></span></button><button class="chip-x" data-act="remove-city" data-city="${r.city.id}" aria-label="Remove ${r.city.name}">${CLOSE}</button></li>`;
        })}</ol>`
      : html`<p class="vs-lede">None yet. Click a city or a town on the map to add it.</p>`}
    ${rest.length
      ? html`<h3 class="vs-h">Not on your list yet</h3><p class="vs-lede">The best of the rest on ${ui.lens === "score" ? "your score" : label.toLowerCase()}</p>
      <ol class="mrank is-rest">${rest.map(({ r }) => html`<li><button class="mr-go" data-act="map-pin" data-city="${r.city.id}"><span class="mr-name">${r.city.name}</span><span class="mr-v num">${lensText(r)}</span></button><button class="pill-btn mr-add" data-act="add-known" data-city="${r.city.id}" aria-label="Add ${r.city.name}">Add</button></li>`)}</ol>`
      : ""}`;
}

/** The map page's main column. The canvas is created once; refreshMap() redraws everything around it. */
export function mapShell(s: AppState): Raw {
  ui.state = s;
  return html`<section class="sheet msheet" aria-label="Map">
    <div class="mhead">
      <h2 class="sh">Colour the world by</h2>
      <div id="map-lens" class="ml">${lensPicker(s)}</div>
    </div>
    <p class="mhow"><span class="for-mouse">Point at a place to read it, click to pin it and add it to your cities. Drag to move; pinch or ⌘ + scroll to zoom.</span><span class="for-touch">Tap a place to read it and add it to your cities. Drag sideways or pinch to move.</span></p>
    <div class="mstage" id="map-stage">
      <canvas id="map-canvas" role="img" aria-label="World map coloured by ${lensLabel(ui.lens, s).toLowerCase()}; your cities are listed under it"></canvas>
      <div class="mzoom" role="group" aria-label="Zoom">
        <button data-act="map-zoom" data-d="1" aria-label="Zoom in">${raw('<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9"/></svg>')}</button>
        <button data-act="map-zoom" data-d="-1" aria-label="Zoom out">${raw('<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6h9"/></svg>')}</button>
        <button class="mz-txt" data-act="map-fit" data-to="cities">Your cities</button>
        <button class="mz-txt" data-act="map-fit" data-to="world">World</button>
      </div>
      <div class="mcard" id="map-card" hidden role="status" aria-live="polite"></div>
      <p class="mload" id="map-load">${ui.failed || "Loading the map…"}</p>
    </div>
    <div class="mfoot">
      <div class="mkey"><div id="map-legend">${legend(s)}</div><div id="map-src">${sourcesLine(ui.map)}</div></div>
      <div class="mlist" id="map-list" role="region" aria-label="Your cities on this map">${lists(s)}</div>
    </div>
  </section>`;
}

/** Recomputes the scores the map shows and redraws it with the lists and the legend. */
export function refreshMap(s: AppState): void {
  ui.state = s;
  if (!ui.map) {
    ensureMap(() => refreshMap(ui.state!));
    const load = document.getElementById("map-load");
    if (load) load.textContent = ui.failed || "Loading the map…";
    return;
  }
  document.getElementById("map-load")?.remove();
  if (!lenses(s).some((l) => l.id === ui.lens)) ui.lens = "score";
  ui.results = scoreCandidates(s.data, s.profile, s.data.cities.map((c) => c.id));
  const crit = criteriaFor(s.profile).find((c) => c.id === ui.lens);
  ui.scale = crit ? crit.scale(s.profile, s.data) : null;
  measureSpan(s);
  if (ui.pinned?.kind === "city" && !s.data.cities.some((c) => c.id === (ui.pinned as { id: string }).id)) ui.pinned = null;
  swap("map-lens", lensPicker(s));
  swap("map-list", lists(s));
  swap("map-legend", legend(s));
  swap("map-src", sourcesLine(ui.map));
  canvas()?.setAttribute("aria-label", `World map coloured by ${lensLabel(ui.lens, s).toLowerCase()}; your cities are listed under it`);
  ui.cardKey = "";
  renderCard();
  paintMap();
}

/** Replaces a region's HTML, keeping focus on the control that had it. */
function swap(id: string, markup: Raw): void {
  const el = document.getElementById(id);
  if (!el) return;
  const active = document.activeElement as HTMLElement | null;
  const keep = active && el.contains(active) ? (active.id || (active.dataset.lens ? `[data-lens="${active.dataset.lens}"]` : active.dataset.city ? `[data-act="${active.dataset.act}"][data-city="${active.dataset.city}"]` : "")) : "";
  el.innerHTML = markup.value;
  if (keep) (keep.startsWith("[") ? el.querySelector<HTMLElement>(keep) : document.getElementById(keep))?.focus({ preventScroll: true });
}

/** Wires the canvas once it is in the page. */
export function mountMap(s: AppState): void {
  ui.state = s;
  ui.W = ui.H = 0;
  ui.palette = null;
  ui.hover = null;
  const cv = canvas();
  if (!cv) return;
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", onUp);
  cv.addEventListener("pointerleave", onLeave);
  cv.addEventListener("wheel", onWheel, { passive: false });
  refreshMap(s);
  document.fonts?.ready.then(paintMap);
}

/** A theme change: colours are read again from the page. */
export function repaletteMap(): void {
  ui.palette = null;
  paintMap();
}

/** Clicks on the map's own controls. True when handled. */
export function mapAction(s: AppState, act: string, el: HTMLElement): boolean {
  const map = ui.map;
  switch (act) {
    case "map-lens":
      ui.lens = el.dataset.lens ?? "score";
      refreshMap(s);
      return true;
    case "map-zoom":
      if (map) zoomAt(map, ui.W / 2, ui.H / 2, Number(el.dataset.d) > 0 ? 1.6 : 1 / 1.6);
      return true;
    case "map-fit":
      if (map) {
        fit(s, map, el.dataset.to === "world" ? "world" : "cities");
        paintMap();
      }
      return true;
    case "map-pin": {
      const id = el.dataset.city!;
      ui.pinned = ui.pinned?.kind === "city" && ui.pinned.id === id ? null : { kind: "city", id };
      const c = s.data.cities.find((x) => x.id === id);
      if (map && c && ui.pinned) {
        // Bring the pinned city into view if it is off the map.
        const [x, y] = toScreen(map, ...project(c.lon, c.lat));
        if (x < 20 || y < 20 || x > ui.W - 20 || y > ui.H - 20) {
          [ui.view.cx, ui.view.cy] = project(c.lon, c.lat);
          clampView(map);
        }
      }
      swap("map-list", lists(s));
      ui.cardKey = "";
      renderCard();
      paintMap();
      return true;
    }
    case "map-unpin":
      ui.pinned = null;
      renderCard();
      paintMap();
      return true;
  }
  return false;
}

/** The lens select and the fade slider. True when handled. */
export function mapInput(s: AppState, el: HTMLInputElement | HTMLSelectElement): boolean {
  if (el.dataset.mapLens) {
    ui.lens = el.value || "score";
    refreshMap(s);
    document.getElementById("map-lens-any")?.focus();
    return true;
  }
  if (el.id === "map-fade") {
    ui.fade = Number(el.value) / 100;
    el.style.setProperty("--fill", `${(Number(el.value) / 90) * 100}%`);
    el.setAttribute("aria-valuetext", ui.fade ? `below ${el.value}% of the scale` : "nothing faded");
    const out = el.parentElement?.querySelector("output");
    if (out) out.textContent = ui.fade ? `below ${el.value}%` : "off";
    paintMap();
    return true;
  }
  return false;
}

/** After a place is added from the map: pin it, so the card shows it among the person's cities. */
export function pinCity(id: string): void {
  ui.pinned = { kind: "city", id };
  ui.cardKey = "";
}

/** Escape closes the pinned card. True when there was one. */
export function unpinMap(): boolean {
  if (!ui.pinned) return false;
  ui.pinned = null;
  renderCard();
  paintMap();
  return true;
}

