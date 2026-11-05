import { CRITERIA, DEFAULT_COMFORT, upgradeProfile } from "../core/criteria.ts";
import { monthlyFrom } from "../core/money.ts";
import { PRESETS } from "../core/presets.ts";
import type { Dataset, Profile } from "../core/types.ts";
import type { CityFetch } from "../fetch/index.ts";

export { PRESETS };

const STORAGE_KEY = "borgo:profile:v1";
/** The older key, still read when this browser holds no profile under the current one. */
const LEGACY_KEY = "where-to-live:profile:v1";

export type View = "cities" | "map" | "compare" | "money" | "city" | "data" | "about" | "contact";

export interface AppState {
  data: Dataset;
  profile: Profile;
  view: View;
  /** City whose dossier is open (the "city" view). */
  city: string | null;
  /** Which temperature the dossier's month chart shows (display only; the score uses air temperature). */
  measure: "air" | "feels";
  /** The values sheet is expanded on a phone. */
  valuesOpen: boolean;
  /** Value groups opened to tune their parts. */
  openGroups: string[];
  /** A place being looked up and fetched live, shown above the results while it loads. */
  live: LiveFetch | null;
  /** Places this browser fetched itself (not in the committed snapshot). */
  fetchedHere: string[];
  /** Cities whose tax and payroll lines are open in Money. */
  taxOpen: string[];
  /** "More priorities" is open on the values sheet. */
  moreOpen: boolean;
  /** The private parts the person chose to put in the share link (SharePart keys); none until they tick one. */
  shareInclude: SharePart[];
  /** Places the opened link named that this browser has no data for, until they are added again. */
  notFound?: string[];
  /** Problems of the last change, which was therefore not stored: shown beside its field. */
  refused?: string[];
}

export type LiveStatus = "waiting" | "running" | "ok" | "empty" | "failed" | "skipped";

export interface LiveFetch {
  query: string;
  /** What was found: "Palermo, Sicily, Italy, 648,260 people"; empty while searching. */
  label: string;
  sources: { source: string; status: LiveStatus; count?: number; reason?: string }[];
  error?: string;
}

// ---------- Places this browser fetched itself: kept here, never sent anywhere ----------

const CITY_PREFIX = "borgo:city:";
const LEGACY_CITY_PREFIX = "where-to-live:city:";

export function loadFetchedCities(): CityFetch[] {
  const out: CityFetch[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CITY_PREFIX) && !k?.startsWith(LEGACY_CITY_PREFIX)) continue;
      const f = JSON.parse(localStorage.getItem(k) ?? "null") as CityFetch | null;
      if (f?.city?.id && Array.isArray(f.observations)) out.push(f);
    }
  } catch {
    // storage unavailable: places are fetched again next time
  }
  return out;
}

export function saveFetchedCity(f: CityFetch): void {
  try {
    localStorage.setItem(CITY_PREFIX + f.city.id, JSON.stringify(f));
  } catch {
    // full or private storage: the place still works for this visit
  }
}

/**
 * What a first visit counts: money left and nice days, nothing else, so the score is built from the two dials on
 * screen. Every other line starts at 0 under "More priorities", where the presets fill them in.
 */
export const START_WEIGHTS: Record<string, number> = Object.fromEntries(CRITERIA.map((c) => [c.id, c.id === "money_left" || c.id === "nice_days" ? 20 : 0]));

/**
 * What an edited figure is stored as: a cost the person gave for a year is kept as a month (the metric's unit), and
 * anything else as typed. The app's number popover saves through here, the same conversion the CLI and the MCP use.
 */
export function storedOverride(unit: string, value: number, per: "month" | "year" = "month"): number {
  return unit === "/month" ? monthlyFrom(value, per) : value;
}

export function defaultProfile(data: Dataset): Profile {
  const pick = ["lisbon-pt", "barcelona-es", "amsterdam-nl", "berlin-de", "london-gb"].filter((id) => data.cities.some((c) => c.id === id));
  return {
    name: "",
    displayCurrency: "EUR",
    cities: pick,
    household: [],
    housing: { size: "1bed" },
    income: {
      mode: "same",
      // No salary is assumed: money waits for the person's own figure.
      gross: 0,
      currency: "EUR",
      perCity: {},
      taxTweaks: {},
      everyday: { amount: 1_200, currency: "EUR", homeCity: pick[0] ?? data.cities[0]!.id, assumed: true },
      savings: 0,
    },
    weights: { ...START_WEIGHTS },
    personal: [],
    prefs: { comfort: { ...DEFAULT_COMFORT }, normalise: "absolute", missing: "lowest" },
    overrides: {},
    dealBreakers: [],
  };
}

// ---------- What a share link carries ----------

/**
 * The private parts of a comparison, each left out of a share link unless the person ticks it. Without any, the link
 * carries only: the cities, the weights and must-pass lines, the nice-day range, the home size, the currency money is
 * shown in, and the settings (units, number and date style, how lines are scored and what a gap counts as).
 */
export type SharePart = "money" | "household" | "numbers" | "lines" | "stances";

export const SHARE_PARTS: { key: SharePart; label: string; what: string }[] = [
  { key: "money", label: "Pay, spending and savings", what: "every salary and pay per city, pension shares, spending and where you live now, savings, newcomer regimes and tax settings" },
  { key: "household", label: "Who is moving", what: "names, passports, ages, children, years since you lived in each country, answers to regime conditions" },
  { key: "numbers", label: "Your own numbers", what: "your rents and every figure you replaced" },
  { key: "lines", label: "Your own lines", what: "their names and your 1 to 5 scores" },
  { key: "stances", label: "Where you stand", what: "your politics and your stance on the laws" },
];

/** Which private parts this profile has anything in, so the share panel offers only those. */
export function sharePartsHeld(p: Profile): SharePart[] {
  const has: Record<SharePart, boolean> = {
    money: p.income.gross > 0 || Object.keys(p.income.perCity).length > 0 || p.household.some((h) => !!h.pay) || !!p.income.pension || !!(p.income.everyday && !p.income.everyday.assumed) || p.income.savings > 0 || Object.keys(p.income.regimes ?? {}).length > 0 || Object.keys(p.income.taxTweaks).length > 0,
    household: p.household.length > 0 || (p.children?.length ?? 0) > 0,
    numbers: Object.values(p.overrides).some((o) => Object.keys(o).length > 0),
    lines: p.personal.length > 0,
    stances: Object.keys(p.stances ?? {}).length > 0,
  };
  return SHARE_PARTS.map((x) => x.key).filter((k) => has[k]);
}

/** The profile as a share link carries it: the private parts not in `include` are left out (the opener gets the defaults). */
export function sharedProfile(p: Profile, include: SharePart[]): Partial<Profile> {
  const inc = new Set(include);
  const positions = CRITERIA.filter((c) => c.position).map((c) => c.id);
  const personal = new Set(p.personal.map((l) => l.id));
  const keep = (id: string) => (inc.has("stances") || !positions.includes(id)) && (inc.has("lines") || !personal.has(id));
  const out: Partial<Profile> = {
    displayCurrency: p.displayCurrency,
    cities: [...p.cities],
    housing: { ...p.housing },
    weights: Object.fromEntries(Object.entries(p.weights).filter(([id]) => keep(id))),
    dealBreakers: p.dealBreakers.filter(keep),
    prefs: { ...p.prefs, comfort: { ...p.prefs.comfort } },
  };
  if (inc.has("money")) {
    out.income = structuredClone(p.income);
    // Someone else's pay travels with the people, not on its own.
    if (inc.has("household")) out.household = structuredClone(p.household);
  } else if (inc.has("household")) out.household = p.household.map(({ pay: _pay, ...rest }) => structuredClone(rest));
  if (inc.has("household") && p.children) out.children = [...p.children];
  if (inc.has("household") && p.paidChildcare === false) out.paidChildcare = false;
  if (inc.has("numbers")) out.overrides = structuredClone(p.overrides);
  if (inc.has("lines")) out.personal = structuredClone(p.personal);
  if (inc.has("stances") && p.stances) out.stances = { ...p.stances };
  return out;
}

// ---------- Persistence: the browser, and a link the person chooses to share ----------

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * The share link: the shared profile rides in the fragment (after #share=), which browsers keep to themselves: it is
 * never sent to the server that serves the page, nor in a Referer.
 */
/**
 * The link for a profile. `places` names the cities fetched in this browser ("Malmö, SE"), so whoever opens the link
 * without them reads each name as written, accents and all, not rebuilt from its id.
 */
export function shareUrl(profile: Profile, include: SharePart[] = [], places: Record<string, string> = {}): string {
  const url = new URL(location.href);
  url.search = "";
  const named = Object.fromEntries(Object.entries(places).filter(([id]) => profile.cities.includes(id)));
  url.hash = `share=${toBase64Url(JSON.stringify({ ...sharedProfile(profile, include), ...(Object.keys(named).length ? { places: named } : {}) }))}`;
  return url.toString();
}

/** The names a link gives its fetched places, by id. */
export function fetchedNames(data: Dataset, ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => data.cities.find((c) => c.id === id)).filter((c) => !!c).map((c) => [c!.id, `${c!.name}, ${c!.country}`]));
}

/** The shared profile in this page's address: the fragment, or the older ?p= query. */
export function sharedParam(): string | null {
  const h = location.hash.match(/^#share=([A-Za-z0-9_-]+)/);
  return h ? h[1]! : new URLSearchParams(location.search).get("p");
}

/** A profile from the link, else from this browser, else the default. Cities neither in the data nor fetched in this browser are dropped. */
export function loadProfile(data: Dataset): Profile {
  const base = defaultProfile(data);
  let loaded: Partial<Profile> | null = null;
  const shared = sharedParam();
  if (shared) {
    try {
      loaded = JSON.parse(fromBase64Url(shared));
    } catch {
      loaded = null;
    }
  }
  if (!loaded) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = null;
    }
  }
  if (!loaded) return base;
  // A link's names for its fetched places are not part of the profile.
  const { places, ...profileOnly } = loaded as Partial<Profile> & { places?: unknown };
  loaded = profileOnly;
  // Not merged with the default: a saved range without a basis predates nice days, and upgradeProfile replaces it.
  const comfort = loaded.prefs?.comfort ? { ...loaded.prefs.comfort } : { ...base.prefs.comfort };
  const p: Profile = upgradeProfile({
    ...base,
    ...loaded,
    weights: { ...(loaded.weights ?? base.weights) },
    dealBreakers: [...(loaded.dealBreakers ?? base.dealBreakers)],
    income: { ...base.income, ...(loaded.income ?? {}) },
    prefs: { ...base.prefs, ...(loaded.prefs ?? {}), comfort },
    housing: { ...base.housing, ...(loaded.housing ?? {}) },
  });
  notFoundOnLoad = p.cities.filter((id) => !data.cities.some((c) => c.id === id));
  linkPlaces = places && typeof places === "object" ? Object.fromEntries(Object.entries(places).filter(([, v]) => typeof v === "string")) : {};
  p.cities = p.cities.filter((id) => data.cities.some((c) => c.id === id));
  return p;
}

/** Cities the loaded profile named that this browser has no data for (a place fetched in the sender's browser). */
export let notFoundOnLoad: string[] = [];

/** A readable name from a place id ("cambridge-massachusetts-us" reads "Cambridge Massachusetts, US"). */
/** The names the loaded link gave its fetched places. */
export let linkPlaces: Record<string, string> = {};

/** A place the link named but this browser lacks: the name the link gave it, else one rebuilt from its id. */
export const linkPlaceName = (id: string, names: Record<string, string> = linkPlaces) => names[id] ?? placeFromId(id);

export function placeFromId(id: string): string {
  const parts = id.split("-");
  const cc = parts.length > 1 && /^[a-z]{2}$/.test(parts.at(-1)!) ? parts.pop()!.toUpperCase() : "";
  const name = parts.filter((x) => !/^\d+$/.test(x)).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(" ");
  return cc ? `${name}, ${cc}` : name;
}

/** ?cities=a,b (from the static pages) opens those cities on top of the visitor's own saved profile. */
export function applyCitiesQuery(data: Dataset, profile: Profile): boolean {
  const q = new URLSearchParams(location.search).get("cities");
  if (!q) return false;
  const ids = q.split(",").filter((id) => data.cities.some((c) => c.id === id));
  if (ids.length) profile.cities = ids;
  return ids.length > 0;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // private mode or full storage: the link still works
  }
}
