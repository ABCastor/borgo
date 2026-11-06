import { politicsWord } from "../core/criteria.ts";
import { criteriaFor, evaluate, profileProblems, weightOf, type Evaluation } from "../core/engine.ts";
import { grouped, splitGroupWeight } from "../core/groups.ts";
import { resolve } from "../core/lookup.ts";
import { convert } from "../core/money.ts";
import type { Dataset, Profile } from "../core/types.ts";
import { makeCtx } from "../fetch/context.ts";
import { BROWSER_FETCHERS, fetchCity, withFetched } from "../fetch/index.ts";
import { resolvePlace } from "../places/resolve.ts";
import { partFiles, withParts, type PartFile } from "../registry/licences.ts";
import { citiesView, comfortEditor } from "./cards.ts";
import { climateOf, drawHours, hourReadout, narrow } from "./climate.ts";
import { cityView } from "./detail.ts";
import { html } from "./dom.ts";
import { mapAction, mapInput, mapShell, mountMap, paintMap, pinCity, refreshMap, repaletteMap, unpinMap } from "./map.ts";
import { aboutPage, contactPage, dataPage } from "./pages.ts";
import { compareView, moneyView, sourcePopover } from "./results.ts";
import { applyCitiesQuery, fetchedNames, loadFetchedCities, loadProfile, notFoundOnLoad, PRESETS, saveFetchedCity, saveProfile, sharedParam, storedOverride, shareUrl, sharePartsHeld, type AppState, type LiveStatus, type SharePart, type View } from "./state.ts";
import { sharePanel } from "./share.ts";
import { settingsPanel } from "./settings.ts";
import { TERMS } from "./terms.ts";
import { local, num, useUnits } from "./format.ts";
import { KM_PER_MILE, tempFrom, tempIn, unitsOf, type Units } from "../core/units.ts";
import { browserTowns, knownCity, pickedPlace, suggestPlaces } from "./place-search.ts";
import { householdPanel, regionName, topQuestion } from "./top.ts";
import { moneySheet, share, THIRD_WEIGHT, valuesSheet } from "./values.ts";
import { exploreShell } from "./cards.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let state: AppState;
let evaluation: Evaluation;

// ---------- Routes: #/ cities, #/map, #/compare, #/money, #/city/<id>, #/data, #/about, #/contact ----------

function readRoute(): void {
  const h = location.hash.replace(/^#\/?/, "");
  const [head, rest] = [h.split("/")[0] ?? "", h.split("/").slice(1).join("/")];
  const views: Record<string, View> = { "": "cities", map: "map", compare: "compare", money: "money", city: "city", data: "data", about: "about", contact: "contact" };
  state.view = views[head] ?? "cities";
  state.city = state.view === "city" ? decodeURIComponent(rest) : null;
}

const NAV_OF: Record<View, string> = { cities: "#/", map: "#/map", city: "#/", compare: "#/compare", money: "#/money", data: "#/data", about: "#/about", contact: "#/contact" };

/**
 * A profile change: save it, then redraw what it touches. "values" spares the sheet being dragged. A change that is not
 * allowed (a negative salary) is not stored: the field keeps what was typed and says why (AppState.refused).
 *
 * A field saves when it loses focus, so the redraw a change causes waits until focus has moved and any click has
 * landed: drawn at once, it would replace the field the person just clicked or tabbed into, losing what they type
 * there. The redraw then gives focus back to that field, with what it holds so far (redraw()).
 */
function setProfile(mut: (p: Profile) => void, scope: "all" | "values" = "all"): void {
  const trial = structuredClone(state.profile);
  mut(trial);
  const before = new Set(profileProblems(state.profile));
  const fresh = profileProblems(trial).filter((m) => !before.has(m));
  state.refused = fresh;
  if (!fresh.length) {
    mut(state.profile);
    saveProfile(state.profile);
  }
  if (inChange) return later(scope);
  redraw(scope);
}

let inChange = false;
let pointerIsDown = false;
let pending: "all" | "values" | null = null;

/** Draws once focus has settled: after this event, and after the pointer that started it is released. */
function later(scope: "all" | "values"): void {
  const first = pending === null;
  pending = pending === "all" || scope === "all" ? "all" : "values";
  if (first && !pointerIsDown) setTimeout(flush, 0);
}

function flush(): void {
  if (pending === null) return;
  const scope = pending;
  pending = null;
  redraw(scope);
}

/** A control the next redraw can find again: its id, else its tag, name, label and data attributes, else a link's address. */
function focusKey(el: Element): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const h = el as HTMLElement;
  const data = Object.entries(h.dataset ?? {}).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(v ?? "")}"]`).join("");
  const attr = (a: string) => (el.getAttribute(a) ? `[${a}="${CSS.escape(el.getAttribute(a)!)}"]` : "");
  const name = attr("name");
  const label = attr("aria-label");
  const href = el.tagName === "A" ? attr("href") : "";
  return data || name || label || href ? `${el.tagName.toLowerCase()}${name}${label}${href}${data}` : null;
}

/** Focus a control if it can take it (present, shown, enabled); says whether it did. */
function focusOn(el: HTMLElement | null): boolean {
  if (!el) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where focus is, what its field holds so far, and the controls after and before it, to land on if it goes away. */
interface FocusSnap {
  key: string | null;
  at: number;
  value?: string;
  sel?: [number, number];
  /** The innermost drawn region around it (an element with an id), and its place among that region's controls. */
  region: string | null;
  inRegion: number;
  /** Controls after it (then a few before), each with whether it sat in the same region. */
  near: { key: string; at: number; same: boolean }[];
}

function focusSnapshot(): FocusSnap | null {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  const all = [...document.querySelectorAll(TABBABLE)];
  const i = all.indexOf(a);
  const box = a.parentElement?.closest("[id]:not(body):not(#page)") ?? null;
  const region = box ? `#${CSS.escape(box.id)}` : null;
  const inRegion = box ? [...box.querySelectorAll(TABBABLE)].indexOf(a) : -1;
  // Forward first, in reading order, so focus moves on as Tab would; back only when nothing after it is left.
  const keyed = (from: number, to: number) =>
    all
      .slice(from, to)
      .map((e, j) => ({ key: focusKey(e), at: from + j, same: !!box?.contains(e) }))
      .filter((x): x is { key: string; at: number; same: boolean } => !!x.key);
  const near = i < 0 ? [] : [...keyed(i + 1, i + 60), ...keyed(Math.max(0, i - 4), i).reverse()];
  const field = a as HTMLInputElement;
  const typed = (a.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit"].includes(field.type)) || a.tagName === "TEXTAREA";
  let sel: [number, number] | undefined;
  try {
    if (typed && field.selectionStart !== null && field.selectionEnd !== null) sel = [field.selectionStart, field.selectionEnd];
  } catch {}
  return { key: focusKey(a), at: i, ...(typed ? { value: field.value } : {}), ...(sel ? { sel } : {}), region, inRegion, near };
}

function focusRestore(snap: FocusSnap | null): void {
  if (!snap) return;
  const a = document.activeElement;
  if (a && a !== document.body && document.contains(a) && focusKey(a) === snap.key && (snap.value === undefined || (a as HTMLInputElement).value === snap.value)) return;
  // Two controls can share a key (a city's chip and its "Open dossier" link): the one nearest where focus was.
  const now = [...document.querySelectorAll(TABBABLE)];
  const nearest = <T extends Element>(key: string, at: number) => [...document.querySelectorAll<T & HTMLElement>(key)].sort((x, y) => Math.abs(now.indexOf(x) - at) - Math.abs(now.indexOf(y) - at));
  const el = snap.key ? (nearest<HTMLInputElement>(snap.key, snap.at)[0] ?? null) : null;
  if (el) {
    if (snap.value !== undefined && el.value !== snap.value) el.value = snap.value;
    if (focusOn(el)) {
      try {
        if (snap.sel) el.setSelectionRange(snap.sel[0], snap.sel[1]);
      } catch {}
      return;
    }
  }
  // The control went away (a removed city, a question answered). In order: the next one after it in the same region
  // that is still there; else what now stands in its place there (the next step that replaced an answered question);
  // else the next one anywhere, then one just before it.
  const tryNear = (same: boolean) => snap.near.some(({ key, at, same: s }) => s === same && nearest<HTMLElement>(key, at).some(focusOn));
  const forward = snap.near.filter((n) => n.at > snap.at);
  if (forward.some(({ key, at, same }) => same && nearest<HTMLElement>(key, at).some(focusOn))) return;
  const box = snap.region ? document.querySelector(snap.region) : null;
  if (box && snap.inRegion >= 0) {
    const here = [...box.querySelectorAll<HTMLElement>(TABBABLE)];
    for (const n of here.slice(Math.min(snap.inRegion, here.length - 1))) if (focusOn(n)) return;
  }
  if (tryNear(false)) return;
  tryNear(true);
}

function redraw(scope: "all" | "values"): void {
  const snap = focusSnapshot();
  scope === "all" ? renderApp() : renderLive();
  focusRestore(snap);
  // A refused figure stays in its field, beside the reason, so it can be corrected rather than typed again.
  if (refusedField && state.refused?.length) {
    const f = document.querySelector<HTMLInputElement>(refusedField.key);
    if (f && f !== document.activeElement) f.value = refusedField.value;
  } else refusedField = null;
}

// ---------- Rendering ----------

/** Replaces a region's HTML and gives focus back to the control that had it. */
function place(el: HTMLElement | null, markup: string): void {
  if (!el) return;
  const active = document.activeElement as HTMLElement | null;
  const id = active && el.contains(active) ? active.id : "";
  el.innerHTML = markup;
  if (id) document.getElementById(id)?.focus({ preventScroll: true });
}

/** The person's units, for every figure the next render writes. */
function applyUnits(): void {
  useUnits(unitsOf(state.profile.prefs.units));
}

function render(): void {
  readRoute();
  applyUnits();
  const v = state.view;
  document.body.dataset.route = v;
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".nav a")) {
    a.getAttribute("href") === NAV_OF[v] ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  }
  closePopover();
  if (v === "data" || v === "about" || v === "contact") {
    $("#page").innerHTML = (v === "data" ? dataPage(state) : v === "about" ? aboutPage(state) : contactPage()).value;
    return;
  }
  const side = v !== "city";
  $("#page").innerHTML = html`<div id="top" class="top-slot"></div>
    <div class="layout ${side ? "has-side" : "no-side"} view-${v}">${side ? html`<aside class="sheet side" id="side" aria-label="${v === "money" ? "Your money" : "What matters to you"}"></aside>` : ""}<main id="main" class="main"></main></div>
    ${v === "cities" ? html`<section class="explore" id="explore" aria-labelledby="explore-h"></section>` : ""}`.value;
  renderApp();
  if (v === "cities") watchExplore();
}

// ---------- Explore more places: the world map under the first results, drawn once it scrolls into view ----------

let exploreSeen: IntersectionObserver | null = null;

function watchExplore(): void {
  exploreSeen?.disconnect();
  const el = document.getElementById("explore");
  if (!el) return;
  el.innerHTML = exploreShell(state, false).value;
  if (!("IntersectionObserver" in window)) return mountExplore();
  exploreSeen = new IntersectionObserver((seen) => {
    if (!seen.some((x) => x.isIntersecting)) return;
    exploreSeen?.disconnect();
    mountExplore();
  }, { rootMargin: "400px 0px" });
  exploreSeen.observe(el);
}

function mountExplore(): void {
  const el = document.getElementById("explore");
  if (!el || document.getElementById("map-stage")) return;
  el.innerHTML = exploreShell(state, true).value;
  mountMap(state);
}

/** The map on this page, if it is drawn. */
const mapHere = () => !!document.getElementById("map-stage");

/** Everything the profile drives: the top, the side sheet and the main view. */
function renderApp(): void {
  if (state.view === "data" || state.view === "about" || state.view === "contact") return render();
  const side = document.getElementById("side");
  if (side) place(side, (state.view === "money" ? moneySheet(state) : valuesSheet(state)).value);
  renderLive();
}

/** The top and the main view, recomputed live (a dial moving, the comfortable range, a rent). */
function renderLive(): void {
  const before = flipFirst();
  applyUnits();
  evaluation = evaluate(state.data, state.profile);
  // Each line's text carries its figure in the data's units; it is shown in the person's.
  for (const r of evaluation.results) for (const l of r.lines) l.raw = { ...l.raw, text: local(l.raw.text) };
  place(document.getElementById("top"), topQuestion(state, evaluation).value);
  const main = document.getElementById("main");
  const v = state.view;
  if (v === "map") {
    // The map keeps its canvas, zoom and pinned place across redraws; only what it shows is recomputed.
    if (document.getElementById("map-stage")) refreshMap(state);
    else if (main) {
      main.innerHTML = mapShell(state).value;
      mountMap(state);
    }
    refreshPopover();
    return;
  }
  place(main, (v === "compare" ? compareView(state, evaluation) : v === "money" ? moneyView(state, evaluation) : v === "city" ? cityView(state, evaluation, state.city ?? "") : citiesView(state, evaluation)).value);
  if (v === "cities" && mapHere()) refreshMap(state);
  paintCanvases();
  flipPlay(before);
  refreshPopover();
}

function paintCanvases(): void {
  for (const cv of document.querySelectorAll<HTMLCanvasElement>("canvas[data-hours]")) {
    const city = state.data.cities.find((c) => c.id === cv.dataset.hours);
    const hourly = city ? climateOf(state, city)?.hourly : null;
    if (hourly) drawHours(cv, hourly, state.profile.prefs.comfort);
  }
}

// The ranking moves rather than jumps when a value changes it: First, Last, Invert, Play.
function flipFirst(): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-flip]")) m.set(el.dataset.flip!, offset(el));
  return m;
}

/** Position inside its own list, so a panel opening above moves nothing that did not change place. */
function offset(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const p = el.parentElement!.getBoundingClientRect();
  return { x: r.left - p.left, y: r.top - p.top };
}

function flipPlay(first: Map<string, { x: number; y: number }>): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of document.querySelectorAll<HTMLElement>("[data-flip]")) {
    const a = first.get(el.dataset.flip!);
    if (!a) continue;
    const b = offset(el);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.45,0,.55,1)" });
  }
}

// ---------- Popover: sources, your own numbers, who is moving, the comfortable range ----------

function openPopover(anchor: HTMLElement, content: string, kind = ""): void {
  const pop = $("#pop");
  pop.innerHTML = content;
  pop.dataset.kind = kind;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(kind === "household" || kind === "share" ? 440 : 360, innerWidth - 24);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left + scrollX - 12))}px`;
  pop.style.top = `${r.bottom + scrollY + 8}px`;
  pop.setAttribute("aria-label", kind === "household" ? "Who is moving" : kind === "comfort" ? "Your nice days" : kind === "settings" ? "Settings" : kind === "share" ? "Share this comparison" : "Details");
  pop.querySelector<HTMLElement>("input, select, a, button")?.focus();
}

function closePopover(): void {
  const pop = document.getElementById("pop");
  if (pop) pop.hidden = true;
  document.querySelector(".settings-toggle")?.setAttribute("aria-expanded", "false");
}

/** An open popover that shows profile values follows them. */
function refreshPopover(): void {
  const pop = document.getElementById("pop");
  if (!pop || pop.hidden) return;
  if (pop.dataset.kind === "household") place(pop, householdPanel(state));
  if (pop.dataset.kind === "comfort") place(pop, comfortEditor(state));
  if (pop.dataset.kind === "settings") place(pop, settingsPanel(state));
  if (pop.dataset.kind === "share") place(pop, sharePanel(state));
}

/** A metric's unit as the person reads it, with the conversions to and from the stored (metric) value. */
function personUnit(unit: string): { unit: string; show: (v: number) => number; store: (v: number) => number } {
  const u = unitsOf(state.profile.prefs.units);
  if (unit === "°C" && u.temp === "F") return { unit: "°F", show: (v) => tempIn(v, u), store: (v) => tempFrom(v, u) };
  if (unit === "km" && u.distance === "mi") return { unit: "mi", show: (v) => v / KM_PER_MILE, store: (v) => v * KM_PER_MILE };
  return { unit, show: (v) => v, store: (v) => v };
}

function editPopover(cityId: string, metric: string): string {
  const city = state.data.cities.find((c) => c.id === cityId)!;
  const m = state.data.metrics[metric];
  const r = resolve(state.data, null, city, metric);
  const mine = state.profile.overrides[cityId]?.[metric];
  const pu = personUnit(m?.unit ?? "");
  const per = m?.unit === "/year" ? " a year" : m?.unit === "/month" ? " a month" : "";
  const unit = m?.currency === "local" ? `${state.data.countries[city.country]?.currency ?? ""}${per}` : pu.unit;
  const shown = (v: number) => +pu.show(v).toFixed(2);
  return html`<form class="pop-body" data-act="save-override" data-city="${cityId}" data-metric="${metric}">
    <b>${m?.label ?? metric}, ${city.name}</b>
    <p class="hint">${r && typeof r.value === "number" ? `The data says ${num(pu.show(r.value), 2)} ${unit}. ` : "No open data yet. "}Your number replaces it in every view and stays in your browser.</p>
    ${m?.unit === "/month" && m.currency === "local"
      ? html`<label class="fld">Your number <span class="quiet">${state.data.countries[city.country]?.currency ?? ""}</span><span class="fld-row"><input name="v" type="number" step="any" min="0" value="${mine === undefined ? "" : shown(mine)}" required><select name="per" aria-label="Is this a month or a year?"><option value="month" selected>a month</option><option value="year">a year</option></select></span></label><p class="hint">A figure for a year is kept as a twelfth of it each month.</p>`
      : html`<label class="fld">Your number <span class="quiet">${unit}</span><input name="v" type="number" step="any" value="${mine === undefined ? "" : shown(mine)}" required></label>`}
    <div class="pop-actions"><button class="ink-btn">Use mine</button>${mine !== undefined ? html`<button type="button" class="link" data-act="clear-override" data-city="${cityId}" data-metric="${metric}">Back to the data</button>` : ""}</div>
  </form>`.value;
}

// ---------- Definitions: one floating tip for every dotted term ----------

function showTip(el: HTMLElement): void {
  const tip = $("#tip");
  const text = TERMS[el.dataset.term ?? ""];
  if (!text) return;
  tip.textContent = local(text);
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = Math.min(340, innerWidth - 24);
  tip.style.width = `${w}px`;
  tip.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + scrollX}px`;
  const th = tip.offsetHeight;
  tip.style.top = `${(r.top - th - 10 > 0 ? r.top - th - 10 : r.bottom + 10) + scrollY}px`;
  el.setAttribute("aria-describedby", "tip");
}

function hideTip(): void {
  const tip = document.getElementById("tip");
  if (tip) tip.hidden = true;
}

// ---------- Events ----------

function setComfort(field: "min" | "max", v: number): void {
  if (!Number.isFinite(v)) return;
  setProfile((p) => {
    const c = p.prefs.comfort;
    c[field] = Math.max(-20, Math.min(45, Math.round(v)));
    if (c.min > c.max) c[field === "min" ? "max" : "min"] = c[field];
  }, "values");
}

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const termEl = target.closest<HTMLElement>(".term");
  if (termEl) {
    e.preventDefault();
    $("#tip").hidden ? showTip(termEl) : hideTip();
    return;
  }
  const t = target.closest<HTMLElement>("[data-act]");
  if (!t) {
    if (!target.closest("#pop")) closePopover();
    return;
  }
  if (t.tagName === "FORM") return;
  const act = t.dataset.act!;
  const p = state.profile;
  if (act === "map-add-place") {
    if (!state.live) void fetchLive(t.dataset.q ?? "", t.dataset.name, true);
    return;
  }
  if (act.startsWith("map-") && mapAction(state, act, t)) return;
  switch (act) {
    case "remove-city":
      setProfile((p) => (p.cities = p.cities.filter((c) => c !== t.dataset.city)));
      break;
    case "add-known":
      setProfile((p) => p.cities.push(t.dataset.city!));
      break;
    case "dismiss-live":
      state.live = null;
      renderLive();
      break;
    case "open-city":
      location.hash = `#/city/${t.dataset.city}`;
      break;
    case "preset": {
      const pr = PRESETS.find((x) => x.id === t.dataset.id)!;
      setProfile((p) => (p.weights = { ...p.weights, ...pr.weights }));
      break;
    }
    case "toggle-breaker":
      setProfile((p) => {
        const id = t.dataset.id!;
        p.dealBreakers = p.dealBreakers.includes(id) ? p.dealBreakers.filter((x) => x !== id) : [...p.dealBreakers, id];
      });
      break;
    case "clear-stance": {
      const id = t.dataset.id!;
      setProfile((p) => {
        const rest = { ...p.stances };
        delete rest[id];
        p.stances = rest;
      });
      break;
    }
    case "remove-line":
      setProfile((p) => (p.personal = p.personal.filter((l) => l.id !== t.dataset.id)));
      break;
    case "score":
      setProfile((p) => {
        const line = p.personal.find((l) => l.id === t.dataset.line)!;
        line.scores[t.dataset.city!] = Number(t.dataset.v);
      }, "values");
      break;
    case "household":
      openPopover(t, householdPanel(state), "household");
      return;
    case "add-person":
      setProfile((p) => {
        if (!p.household.length) p.household.push({ label: "You", citizenships: [] });
        const l = t.dataset.label ?? "Someone";
        p.household.push({ label: l, citizenships: [], relation: l === "Partner" ? "partner" : l === "Co-founder" ? "cofounder" : "family" });
      });
      document.getElementById(`p${state.profile.household.length - 1}-pass`)?.focus();
      return;
    case "remove-person":
      setProfile((p) => p.household.splice(Number(t.dataset.i), 1));
      return;
    case "income-mode":
      setProfile((p) => (p.income.mode = t.dataset.mode as "same" | "per-city"));
      break;
    case "tax-lines": {
      const id = t.dataset.city!;
      state.taxOpen = state.taxOpen.includes(id) ? state.taxOpen.filter((x) => x !== id) : [...state.taxOpen, id];
      renderLive();
      document.querySelector<HTMLElement>(`[data-act="tax-lines"][data-city="${id}"]`)?.focus();
      return;
    }
    case "pay-here": {
      // The tick on a city's money line: your own gross for this city, starting from your usual pay in its currency.
      const id = t.dataset.city!;
      const on = (t as HTMLInputElement).checked;
      setProfile((p) => {
        if (!on) {
          delete p.income.perCity[id];
          return;
        }
        const c = state.data.cities.find((x) => x.id === id)!;
        const local = state.data.countries[c.country]?.currency ?? p.income.currency;
        const g = convert(state.data, p.income.gross, p.income.currency, local);
        p.income.mode = "per-city";
        p.income.perCity[id] = g === null ? { gross: p.income.gross, currency: p.income.currency } : { gross: Math.round(g / 1000) * 1000, currency: local };
      });
      document.getElementById(on ? `g-0-${id}-card` : `pay-here-${id}`)?.focus();
      return;
    }
    case "pay-mode": {
      const i = Number(t.dataset.i);
      const on = (t as HTMLInputElement).checked;
      setProfile((p) => {
        if (i === 0) p.income.mode = on ? "per-city" : "same";
        else {
          const person = p.household[i];
          if (person) (person.pay ??= { gross: 0, currency: p.displayCurrency }).mode = on ? "per-city" : "same";
        }
      });
      document.getElementById(`per-city-${i}`)?.focus();
      return;
    }
    case "spouse": {
      const i = Number(t.dataset.i);
      const on = (t as HTMLInputElement).checked;
      setProfile((p) => p.household.forEach((x, j) => j > 0 && (x.spouse = j === i ? on : on ? false : x.spouse)));
      return;
    }
    case "add-earner":
      setProfile((p) => {
        if (!p.household.length) p.household.push({ label: "You", citizenships: [] });
        const partner = t.dataset.label === "Partner";
        p.household.push({ label: t.dataset.label ?? "Someone", citizenships: [], relation: partner ? "partner" : "cofounder", pay: { gross: 0, currency: p.income.currency } });
      });
      document.getElementById(`pay-${state.profile.household.length - 1}`)?.focus();
      return;
    case "housing":
      setProfile((p) => (p.housing.size = t.dataset.size as "1bed" | "3bed"));
      break;
    case "normalise":
      setProfile((p) => (p.prefs.normalise = t.dataset.mode as "absolute" | "relative"));
      break;
    case "measure":
      state.measure = t.dataset.m as "air" | "feels";
      renderLive();
      break;
    case "fold":
      state.valuesOpen = !state.valuesOpen;
      renderApp();
      document.querySelector<HTMLElement>(".vs-sum")?.focus();
      break;
    case "share":
      openPopover(t, sharePanel(state), "share");
      return;
    case "share-include": {
      const part = t.dataset.part as SharePart;
      const on = (t as HTMLInputElement).checked;
      state.shareInclude = on ? [...new Set([...state.shareInclude, part])] : state.shareInclude.filter((x) => x !== part);
      refreshPopover();
      document.getElementById(`share-${part}`)?.focus();
      return;
    }
    case "share-copy": {
      const url = shareUrl(p, state.shareInclude.filter((k) => sharePartsHeld(p).includes(k)), fetchedNames(state.data, state.fetchedHere));
      const done = () => {
        place($("#pop"), sharePanel(state, true));
        document.getElementById("share-copy")?.focus();
      };
      navigator.clipboard?.writeText(url).then(done, () => document.querySelector<HTMLInputElement>("#share-url")?.select()) ?? document.querySelector<HTMLInputElement>("#share-url")?.select();
      return;
    }
    case "more":
      state.moreOpen = !state.moreOpen;
      renderApp();
      document.querySelector<HTMLElement>('[data-act="more"]')?.focus();
      return;
    case "focus": {
      // A next input named in the answer: the field it means, scrolled to and focused.
      const target = t.dataset.target ?? "";
      if (/^e\d+-pass$/.test(target) && !state.valuesOpen && innerWidth < 820) {
        // On a phone the values sheet is folded: open it to reach the passport.
        state.valuesOpen = true;
        renderApp();
      }
      const el = document.getElementById(target);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
      }
      return;
    }
    case "source": {
      const city = state.data.cities.find((c) => c.id === t.dataset.city)!;
      openPopover(t, sourcePopover(state, city.id, t.dataset.metric!, resolve(state.data, state.profile, city, t.dataset.metric!)).value, "source");
      return;
    }
    case "edit":
      openPopover(t, editPopover(t.dataset.city!, t.dataset.metric!), "edit");
      return;
    case "comfort":
      openPopover(t, comfortEditor(state), "comfort");
      return;
    case "settings":
      openPopover(t, settingsPanel(state), "settings");
      t.setAttribute("aria-expanded", "true");
      return;
    case "set-unit": {
      const key = t.dataset.unit as keyof Units;
      setProfile((p) => (p.prefs.units = { ...unitsOf(p.prefs.units), [key]: t.dataset.v }));
      document.getElementById(t.id)?.focus();
      return;
    }
    case "group": {
      const id = t.dataset.id!;
      state.openGroups = state.openGroups.includes(id) ? state.openGroups.filter((x) => x !== id) : [...state.openGroups, id];
      renderApp();
      document.querySelector<HTMLElement>(`[data-act="group"][data-id="${id}"]`)?.focus();
      break;
    }
    case "comfort-step": {
      const f = t.dataset.field as "min" | "max";
      setComfort(f, p.prefs.comfort[f] + Number(t.dataset.d));
      refreshPopover();
      return;
    }
    case "comfort-basis":
      setProfile((p) => {
        p.prefs.comfort.basis = t.dataset.basis === "air" ? "air" : "feels";
      }, "values");
      document.getElementById(t.id)?.focus();
      return;
    case "regime":
      setProfile((p) => {
        (p.income.regimes ??= {})[t.dataset.country!] = t.dataset.id!;
      });
      break;
    case "tax-option":
      setProfile((p) => {
        const tw = (p.income.taxTweaks[t.dataset.country!] ??= {});
        const f = t.dataset.field as "noSocialContributions";
        if ((t as HTMLInputElement).checked) tw[f] = true;
        else delete tw[f];
      });
      break;
    case "confirm-cond":
      setProfile((p) => {
        if (!p.household.length) p.household.push({ label: "You", citizenships: [] });
        const me = p.household[0]!;
        const c = ((me.newcomer ??= {}).confirmed ??= {});
        const v = t.dataset.v === "yes";
        if (c[t.dataset.id!] === v) delete c[t.dataset.id!];
        else c[t.dataset.id!] = v;
      });
      break;
    case "clear-override":
      closePopover();
      setProfile((p) => {
        const o = p.overrides[t.dataset.city!];
        if (o) delete o[t.dataset.metric!];
      });
      break;
  }
  if (!t.closest("#pop")) closePopover();
}

function onSubmit(e: SubmitEvent): void {
  const f = e.target as HTMLFormElement;
  const act = f.dataset.act;
  if (!act) return;
  e.preventDefault();
  if (act === "add-line") {
    const label = String(new FormData(f).get("label") ?? "").trim();
    if (!label) return;
    setProfile((p) => p.personal.push({ id: `mine-${Date.now().toString(36)}`, label, scores: {} }));
  }
  if (act === "save-override") {
    const form = new FormData(f);
    const v = Number(form.get("v"));
    if (!Number.isFinite(v)) return;
    closePopover();
    const unit = state.data.metrics[f.dataset.metric!]?.unit ?? "";
    const per = form.get("per") === "year" ? "year" : "month";
    const store = personUnit(unit).store;
    setProfile((p) => {
      (p.overrides[f.dataset.city!] ??= {})[f.dataset.metric!] = storedOverride(unit, store(v), per);
    });
  }
}

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.id === "add-city") {
    suggestPlaces(t, state.data);
    return;
  }
  if ((state.view === "map" || state.view === "cities") && (t.dataset.mapLens || t.id === "map-fade")) {
    mapInput(state, t);
    return;
  }
  if (t.dataset.stance && t.type === "range") {
    const out = document.getElementById(`sv-${t.dataset.stance}`);
    if (out) out.textContent = `${politicsWord(Number(t.value))} ${t.value}`;
    return;
  }
  if (!t.dataset.weight && !t.dataset.groupWeight) return;
  const v = Number(t.value);
  document.querySelectorAll(".presets .is-on").forEach((b) => {
    b.classList.remove("is-on");
    b.setAttribute("aria-pressed", "false");
  });
  if (t.dataset.groupWeight) {
    // A group's dial: its new weight is shared over its parts in the proportions they had.
    const parts = grouped(criteriaFor(state.profile)).find((g) => g.group.id === t.dataset.groupWeight)?.parts ?? [];
    const split = splitGroupWeight(parts.map((c) => ({ id: c.id, weight: weightOf(state.profile, c), defaultWeight: c.defaultWeight, applies: !c.applies || c.applies(state.profile) })), v);
    setProfile((p) => Object.assign(p.weights, split), "values");
  } else {
    const id = t.dataset.weight!;
    setProfile((p) => (p.weights[id] = v), "values");
  }
  refreshShares(t);
}

/** After a weight moves: every dial, group and part, shows its new value and share, except the one being dragged. */
function refreshShares(active: HTMLInputElement | null): void {
  const p = state.profile;
  const crit = criteriaFor(p);
  const total = crit.reduce((s, c) => s + weightOf(p, c), 0);
  const fill = (el: HTMLInputElement, w: number) => el.style.setProperty("--fill", `${(Math.min(w, Number(el.max)) / Number(el.max)) * 100}%`);
  for (const c of crit) {
    const w = weightOf(p, c);
    const out = document.getElementById(`o-${c.id}`);
    if (out) out.textContent = share(w, total);
    const el = document.getElementById(`w-${c.id}`) as HTMLInputElement | null;
    if (el && el !== active) el.value = String(w);
    if (el) fill(el, w);
    el?.closest(".vline")?.classList.toggle("is-zero", w === 0);
  }
  for (const { group, parts } of grouped(crit)) {
    const w = parts.reduce((s, c) => s + weightOf(p, c), 0);
    const out = document.getElementById(`og-${group.id}`);
    if (out) out.textContent = share(w, total);
    const el = document.getElementById(`wg-${group.id}`) as HTMLInputElement | null;
    if (el && el !== active) el.value = String(Math.round(w));
    if (el) fill(el, w);
    el?.closest(".vgroup")?.classList.toggle("is-zero", w === 0);
  }
}

/** The field whose change was just refused and what it held, so the redraw gives it back with the reason beside it. */
let refusedField: { key: string; value: string } | null = null;

function onChange(e: Event): void {
  inChange = true;
  const t = e.target as HTMLInputElement;
  try {
    changed(e);
  } finally {
    inChange = false;
  }
  const key = t instanceof HTMLInputElement ? focusKey(t) : null;
  refusedField = state.refused?.length && key ? { key, value: t.value } : null;
}

function changed(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (t.dataset.mapLens || t.id === "map-fade") return;
  if (t.dataset.actChange === "paid-childcare") {
    const on = (t as HTMLInputElement).checked;
    setProfile((p) => {
      if (on) delete p.paidChildcare;
      else p.paidChildcare = false;
    });
    return;
  }
  if (t.id === "add-city") {
    const text = t.value.trim();
    t.value = "";
    const picked = pickedPlace(text);
    const city = picked ? undefined : knownCity(state.data, text, regionName);
    if (city) {
      if (!state.profile.cities.includes(city.id)) setProfile((p) => p.cities.push(city.id));
    } else if (text.length >= 2 && !state.live) void fetchLive(picked ?? text, text.split(",")[0]);
    document.getElementById("add-city")?.focus();
    return;
  }
  if (t.dataset.third !== undefined) {
    // A third priority: its group starts at a small weight, shared over its parts by their default weights.
    const id = t.value;
    if (!id) return;
    const parts = grouped(criteriaFor(state.profile)).find((g) => g.group.id === id)?.parts ?? [];
    const split = splitGroupWeight(parts.map((c) => ({ id: c.id, weight: 0, defaultWeight: c.defaultWeight, applies: !c.applies || c.applies(state.profile) })), THIRD_WEIGHT);
    setProfile((p) => Object.assign(p.weights, split));
    document.getElementById(`wg-${id}`)?.focus();
    return;
  }
  const n = Number(t.value);
  const f = t.dataset.field;
  if (t.dataset.unitSelect) {
    const key = t.dataset.unitSelect as keyof Units;
    setProfile((p) => (p.prefs.units = { ...unitsOf(p.prefs.units), [key]: t.value }));
    document.getElementById(t.id)?.focus();
    return;
  }
  if (t.dataset.stance) {
    const id = t.dataset.stance;
    setProfile((p) => {
      const rest = { ...p.stances };
      delete rest[id];
      p.stances = t.value === "" ? rest : { ...rest, [id]: n };
    });
    return;
  }
  if (t.dataset.person !== undefined) {
    const i = Number(t.dataset.person);
    setProfile((p) => {
      if (!p.household.length) p.household.push({ label: "You", citizenships: [] });
      const person = p.household[i]!;
      if (f === "label") person.label = t.value;
      if (f === "citizenship") person.citizenships = [t.value, ...person.citizenships.slice(1)].filter(Boolean);
      if (f === "citizenship2") person.citizenships = [person.citizenships[0] ?? "", t.value].filter(Boolean);
      const nc = (person.newcomer ??= {});
      if (f === "age") nc.age = t.value === "" ? undefined : n;
      if (f === "away") {
        // One answer for every country being compared; where you live now is 0 years by definition.
        const home = p.income.everyday?.assumed ? undefined : state.data.cities.find((c) => c.id === p.income.everyday?.homeCity)?.country;
        const v = t.value === "" ? undefined : t.value === "never" ? "never" : Number(t.value);
        nc.yearsSinceResident = v === undefined ? {} : Object.fromEntries(Object.keys(state.data.countries).map((cc) => [cc, cc === home ? 0 : v]));
      }
      // "Just you" with nothing set is the same as no household: rights are not checked.
      if (p.household.length === 1 && !p.household[0]!.citizenships.length && !Object.values(p.household[0]!.newcomer ?? {}).some((x) => x !== undefined && !(typeof x === "object" && !Object.keys(x).length))) p.household = [];
    });
    return;
  }
  if (t.dataset.rentCity) {
    const id = t.dataset.rentCity;
    if (t.value === "" || !Number.isFinite(n)) return;
    setProfile((p) => {
      (p.overrides[id] ??= {})[`rent_${p.housing.size}`] = n;
    });
    return;
  }
  if (t.dataset.pay !== undefined) {
    const i = Number(t.dataset.pay);
    const field = t.dataset.payField;
    setProfile((p) => {
      if (i === 0) {
        if (field === "gross") p.income.gross = t.value === "" ? 0 : n;
        if (field === "currency") p.income.currency = t.value;
        if (field === "pension") p.income.pension = t.value === "" ? undefined : Math.max(0, Math.min(50, n)) / 100;
        return;
      }
      const person = p.household[i];
      if (!person) return;
      const pay = (person.pay ??= { gross: 0, currency: p.displayCurrency });
      if (field === "gross") pay.gross = t.value === "" ? 0 : n;
      if (field === "currency") pay.currency = t.value;
      if (field === "pension") pay.pension = t.value === "" ? undefined : Math.max(0, Math.min(50, n)) / 100;
    });
    return;
  }
  if (t.dataset.grossCity) {
    const id = t.dataset.grossCity;
    const i = Number(t.dataset.earner ?? 0);
    setProfile((p) => {
      const table = i === 0 ? p.income.perCity : ((p.household[i]!.pay ??= { gross: 0, currency: p.displayCurrency }).perCity ??= {});
      const cur = table[id]?.currency ?? state.data.countries[state.data.cities.find((c) => c.id === id)!.country]?.currency ?? "EUR";
      if (t.value === "") delete table[id];
      else table[id] = { gross: n, currency: cur };
    });
    return;
  }
  if (t.dataset.grossCurrency) {
    const id = t.dataset.grossCurrency;
    const i = Number(t.dataset.earner ?? 0);
    setProfile((p) => {
      const g = i === 0 ? p.income.perCity[id] : p.household[i]?.pay?.perCity?.[id];
      if (g) g.currency = t.value;
    });
    return;
  }
  if (f === "children") {
    const ages = t.value.split(/[^0-9.]+/).filter(Boolean).map(Number).filter((a) => Number.isFinite(a) && a >= 0 && a < 30).map(Math.floor);
    setProfile((p) => {
      p.children = ages.length ? ages : undefined;
      if (p.household[0]) {
        const minors = ages.filter((a) => a < 18).length;
        (p.household[0].newcomer ??= {}).minorChildren = ages.length ? minors : undefined;
      }
    });
    return;
  }
  if (t.dataset.tweak) {
    const cc = t.dataset.tweak;
    const field = t.dataset.tweakField as "taxableShare" | "flatRate";
    setProfile((p) => {
      const tw = (p.income.taxTweaks[cc] ??= {});
      if (t.value === "") delete tw[field];
      else tw[field] = n;
    });
    return;
  }
  if (f === "comfort-min" || f === "comfort-max") {
    setComfort(f === "comfort-min" ? "min" : "max", tempFrom(n, unitsOf(state.profile.prefs.units)));
    return;
  }
  setProfile((p) => {
    const inc = p.income;
    switch (f) {
      case "gross": inc.gross = n; break;
      case "income-currency": inc.currency = t.value; break;
      case "savings": inc.savings = n; break;
      case "everyday": inc.everyday = { ...(inc.everyday ?? { currency: "EUR", homeCity: p.cities[0] ?? "" }), amount: n, assumed: false }; break;
      case "everyday-currency": if (inc.everyday) { inc.everyday.currency = t.value; inc.everyday.assumed = false; } break;
      case "home": if (inc.everyday) { inc.everyday.homeCity = t.value; inc.everyday.assumed = false; } break;
      case "home-rent": {
        const home = inc.everyday?.assumed ? undefined : inc.everyday?.homeCity;
        if (!home) break;
        const o = (p.overrides[home] ??= {});
        if (t.value === "") delete o[`rent_${p.housing.size}`];
        else o[`rent_${p.housing.size}`] = n;
        break;
      }
      case "display-currency": p.displayCurrency = t.value; break;
    }
  });
}

function onKey(e: KeyboardEvent): void {
  const h = (e.target as HTMLElement).closest?.<HTMLElement>("[data-comfort-handle]");
  if (h) {
    const f = h.dataset.comfortHandle as "min" | "max";
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
    if (d) {
      e.preventDefault();
      setComfort(f, state.profile.prefs.comfort[f] + d);
      document.getElementById(`comfort-handle-${f}`)?.focus();
    }
    return;
  }
  if (e.key !== "Escape") return;
  hideTip();
  if ((state.view === "map" || mapHere()) && $("#pop").hidden && unpinMap()) return;
  const pop = $("#pop");
  if (!pop.hidden) {
    const kind = pop.dataset.kind;
    closePopover();
    if (kind === "household") document.querySelector<HTMLElement>(".who")?.focus();
  }
}

// Dragging an end of the comfortable band on a month chart: the range follows the pointer, everything else follows the range.
let drag: { field: "min" | "max" } | null = null;

function tempAt(clientY: number): number | null {
  const svg = document.querySelector<SVGSVGElement>(".monthchart.is-editable");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const yv = ((clientY - r.top) / r.height) * vb.height;
  const top = Number(svg.dataset.top), bot = Number(svg.dataset.bot), tMin = Number(svg.dataset.tmin), tMax = Number(svg.dataset.tmax);
  return tMin + (1 - (yv - top) / (vb.height - top - bot)) * (tMax - tMin);
}

function onPointerDown(e: PointerEvent): void {
  const h = (e.target as Element).closest?.<SVGGElement>("[data-comfort-handle]");
  if (!h) return;
  e.preventDefault();
  drag = { field: h.dataset.comfortHandle as "min" | "max" };
  document.body.classList.add("is-dragging");
}

function onPointerMove(e: PointerEvent): void {
  if (drag) {
    const t = tempAt(e.clientY);
    if (t === null) return;
    const v = Math.round(t);
    const k = state.profile.prefs.comfort;
    const next = drag.field === "min" ? Math.min(v, k.max) : Math.max(v, k.min);
    if (next !== k[drag.field]) setComfort(drag.field, next);
    return;
  }
  const cv = (e.target as Element).closest?.<HTMLCanvasElement>("canvas.hours-map");
  if (!cv) return;
  const city = state.data.cities.find((c) => c.id === cv.dataset.hours);
  const hourly = city ? climateOf(state, city)?.hourly : null;
  const out = document.getElementById("readout");
  if (!hourly || !out) return;
  const r = cv.getBoundingClientRect();
  out.textContent = hourReadout(hourly, state.profile.prefs.comfort, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
}

function onPointerUp(): void {
  if (!drag) return;
  const f = drag.field;
  drag = null;
  document.body.classList.remove("is-dragging");
  document.getElementById(`comfort-handle-${f}`)?.focus({ preventScroll: true });
}

// ---------- Any place, fetched live from the sources that allow a browser to read them ----------

/** `text` is what the geocoder is asked (a name, or geonames:<id>); `shown` is what the person sees while it looks; `fromMap` pins the added place on the map. */
async function fetchLive(text: string, shown = text, fromMap = false): Promise<void> {
  state.live = { query: shown, label: "", sources: [] };
  renderLive();
  const ctx = makeCtx({ runtime: "browser" });
  try {
    const found = await resolvePlace(text, ctx, { countries: state.data.countries, known: state.data.cities, limit: 1, towns: browserTowns });
    const pick = found[0];
    if (!pick) throw new Error(`No place called "${shown}" was found. Try adding the country: "${shown}, IT".`);
    if (pick.known) {
      state.live = null;
      if (state.view === "map" || fromMap) pinCity(pick.city.id);
      if (!state.profile.cities.includes(pick.city.id)) setProfile((p) => p.cities.push(pick.city.id));
      else renderLive();
      return;
    }
    state.live = { query: text, label: `${pick.city.name}, ${pick.label}`, sources: BROWSER_FETCHERS.map((f) => ({ source: f.source, status: "waiting" as LiveStatus })) };
    renderLive();
    const fetched = await fetchCity(pick.city, ctx, BROWSER_FETCHERS, {
      onProgress: (o) => {
        const row = state.live?.sources.find((x) => x.source === o.source);
        if (!row) return;
        Object.assign(row, o);
        renderLive();
      },
    });
    if (!fetched.outcomes.some((o) => o.status === "ok")) throw new Error(`None of the sources answered for ${pick.city.name}. Check the connection and try again.`);
    saveFetchedCity(fetched);
    state.data = withFetched(state.data, [fetched]);
    state.fetchedHere.push(fetched.city.id);
    state.live = null;
    if (state.view === "map" || fromMap) pinCity(fetched.city.id);
    setProfile((p) => p.cities.push(fetched.city.id));
  } catch (err) {
    if (state.live) state.live.error = err instanceof Error ? err.message : String(err);
    renderLive();
  }
}

async function boot(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const res = await fetch("data/dataset.json");
  const snapshot = (await res.json()) as Dataset;
  // The figures published under other terms (ODbL, WHO) sit in files of their own; a part that fails costs only its figures.
  const parts = await Promise.all(partFiles(snapshot).map((f) => fetch(f).then((r) => (r.ok ? (r.json() as Promise<PartFile>) : null)).catch(() => null)));
  // The committed snapshot, plus every place this browser fetched before.
  const here = loadFetchedCities();
  const data = withFetched(withParts(snapshot, parts.filter((p): p is PartFile => !!p)), here);
  state = {
    data,
    profile: loadProfile(data),
    view: "cities",
    city: null,
    measure: "air",
    valuesOpen: false,
    openGroups: [],
    live: null,
    fetchedHere: here.map((f) => f.city.id),
    taxOpen: [],
    moreOpen: false,
    shareInclude: [],
    notFound: notFoundOnLoad,
  };
  const shared = !!sharedParam();
  if (applyCitiesQuery(data, state.profile) || shared) {
    saveProfile(state.profile);
    q.delete("p");
    q.delete("cities");
    // The shared profile leaves the address as soon as it is read: what stays is the route.
    history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "") + (location.hash.startsWith("#share=") ? "#/" : location.hash));
  }
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  // A redraw waits for a press to end, so the control pressed is still there when the click lands.
  document.addEventListener("pointerdown", () => (pointerIsDown = true), true);
  for (const end of ["pointerup", "pointercancel"]) addEventListener(end, () => {
    pointerIsDown = false;
    if (pending !== null) setTimeout(flush, 0);
  }, true);
  document.addEventListener("pointerdown", onPointerDown);
  addEventListener("pointermove", onPointerMove);
  addEventListener("pointerup", onPointerUp);
  addEventListener("pointercancel", onPointerUp);
  document.addEventListener("pointerover", (e) => {
    const t = (e.target as Element).closest?.<HTMLElement>(".term");
    if (t && e.pointerType === "mouse") showTip(t);
  });
  document.addEventListener("pointerout", (e) => {
    if ((e.target as Element).closest?.(".term") && e.pointerType === "mouse") hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = (e.target as Element).closest?.<HTMLElement>(".term");
    t ? showTip(t) : hideTip();
  });
  addEventListener("scroll", hideTip, { passive: true });
  let resize = 0;
  let wasNarrow = narrow();
  addEventListener("resize", () => {
    cancelAnimationFrame(resize);
    resize = requestAnimationFrame(() => {
      // Charts are drawn for the screen's width class; crossing it redraws them.
      if (narrow() !== wasNarrow) {
        wasNarrow = narrow();
        renderLive();
      } else paintCanvases();
      if (state.view === "map" || mapHere()) paintMap();
    });
  });
  // A sheet's details hold an hour strip: drawn when they open.
  document.addEventListener("toggle", (e) => {
    if ((e.target as Element).matches?.("details.d-more")) paintCanvases();
  }, true);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    paintCanvases();
    repaletteMap();
  });
  addEventListener("hashchange", () => {
    render();
    scrollTo(0, 0);
  });
  render();
}

boot().catch((err) => {
  console.error(err);
  $("#page").innerHTML = html`<div class="empty"><h2>The data did not load</h2><p>Reload the page. If it keeps happening, this copy of the site is missing its data file.</p></div>`.value;
});
