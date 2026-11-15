import { profileProblems, type Evaluation } from "../core/engine.ts";
import type { Person } from "../core/types.ts";
import { hasRightsGiven, PERMIT_KIND_IDS, PERMIT_KINDS } from "../core/rights.ts";
import { html, type Raw } from "./dom.ts";
import { CURRENCIES, money } from "./format.ts";
import { moneyGap } from "../core/criteria.ts";
import { failText } from "./glance.ts";
import { CLOSE, moneyAdds } from "./results.ts";
import { linkPlaceName, type AppState } from "./state.ts";
import { niceTestsShort, rangeButton } from "./cards.ts";
import { exampleMoney } from "./first-visit.ts";

// The top of the app, under the Castor mast: who the comparison is for, which cities are in it, and the
// answer so far, stated in words.

const PASSPORTS = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH GB US CA AU NZ JP KR SG IN CN BR MX AR CL CO ZA NG EG MA TR UA RS AL IL AE SA PK BD PH ID VN TH MY RU".split(" ");
export const regionName = (() => {
  try {
    const d = new Intl.DisplayNames(["en"], { type: "region" });
    return (iso: string) => d.of(iso) ?? iso;
  } catch {
    return (iso: string) => iso;
  }
})();
/** The passport list in the order it is shown: by country name. */
const PASSPORTS_SORTED = PASSPORTS.map((c) => [c, regionName(c)] as const).sort((a, b) => a[1].localeCompare(b[1])).map(([c]) => c);
export const passportOptions = (selected: string) => PASSPORTS_SORTED.map((c) => html`<option value="${c}" ${c === selected ? "selected" : ""}>${regionName(c)}</option>`);

/** The one answer given for every country: where you live now is stored as 0 years, so it is skipped whatever its place. */
export function awayOf(person: Person | undefined): string {
  const v = Object.values(person?.newcomer?.yearsSinceResident ?? {}).find((x) => x !== 0);
  return v === undefined ? "" : String(v);
}

/** "You", or "You and Anna", or "You and 2 others". */
export function whoText(s: AppState): string {
  const others = s.profile.household.slice(1);
  if (!others.length) return "You";
  if (others.length === 1) return `You and ${others[0]!.label || "one more"}`;
  return `You and ${others.length} others`;
}

/** Where a right can hold: every country Borgo knows, and the free-movement areas, by name. */
function whereOptions(s: AppState, selected: string): Raw[] {
  const areas = [...new Map((s.data.rights ?? []).filter((a) => a.territory.length > 2).map((a) => [a.id, a.name])).entries()];
  const countries = Object.keys(s.data.countries).map((c) => [c, regionName(c)] as const).sort((a, b) => a[1].localeCompare(b[1]));
  return [
    html`<option value="" ${selected ? "" : "selected"}>Where…</option>`,
    ...areas.map(([id, name]) => html`<option value="${id}" ${id === selected ? "selected" : ""}>${name} (all of it)</option>`),
    ...countries.map(([c, n]) => html`<option value="${c}" ${c === selected ? "selected" : ""}>${n}</option>`),
  ];
}

/**
 * A person's right to live and work: every passport they hold, and the rights that are not citizenship (permanent
 * residence, settled status, a residence or work permit, an EU Blue Card), each with where it holds and until when.
 */
function rightsEditor(s: AppState, person: Person | undefined, i: number): Raw {
  const passports = person?.citizenships ?? [];
  const permits = person?.permits ?? [];
  const who = i === 0 ? "your" : `${person?.label || "their"}'s`;
  return html`<div class="rtl" role="group" aria-labelledby="rtl-h-${i}">
    <p class="rtl-h" id="rtl-h-${i}">Right to live and work</p>
    <ul class="rtl-pass" aria-label="Passports">${passports.map((c, j) => html`<li class="pchip">${regionName(c)}<button class="chip-x" data-act="remove-passport" data-person="${i}" data-i="${j}" aria-label="Remove the ${regionName(c)} passport">${CLOSE}</button></li>`)}
      <li><label class="sr" for="p${i}-pass">${passports.length ? "Add another passport" : `Add ${who} passport`}</label><select id="p${i}-pass" class="add-pass" data-person="${i}" data-field="add-passport"><option value="">${passports.length ? "+ Another passport" : "+ Passport"}</option>${passportOptions("").filter((_, k) => !passports.includes(PASSPORTS_SORTED[k]!))}</select></li></ul>
    ${permits.map(
      (r, j) => html`<div class="permit" role="group" aria-label="Right ${j + 1}">
        <label><span class="sr">Kind of right</span><select id="p${i}-r${j}-kind" data-person="${i}" data-permit="${j}" data-field="kind">${PERMIT_KIND_IDS.map((k) => html`<option value="${k}" ${k === r.kind ? "selected" : ""} title="${PERMIT_KINDS[k].example}">${PERMIT_KINDS[k].label}</option>`)}</select></label>
        <label><span class="sr">Where it holds</span><select id="p${i}-r${j}-where" data-person="${i}" data-permit="${j}" data-field="where">${whereOptions(s, r.where)}</select></label>
        <label class="until">Until<input type="date" id="p${i}-r${j}-until" value="${r.until ?? ""}" data-person="${i}" data-permit="${j}" data-field="until" aria-label="Last valid day (leave empty if it does not end)"></label>
        <label class="work"><input type="checkbox" id="p${i}-r${j}-work" data-person="${i}" data-permit="${j}" data-field="work" ${r.work === false ? "" : "checked"}> Can work</label>
        <button class="chip-x" data-act="remove-permit" data-person="${i}" data-i="${j}" aria-label="Remove this right">${CLOSE}</button>
      </div>`,
    )}
    <button class="link" data-act="add-permit" data-person="${i}">+ Another right: permanent residence, a work visa, an EU Blue Card…</button>
  </div>`;
}

/** Who is moving, in the popover the "You" button opens. Just you unless you add someone. */
export function householdPanel(s: AppState): string {
  const hh = s.profile.household;
  const me = hh[0];
  const others = hh.slice(1);
  return html`<div class="pop-body hh">
    <b id="hh-title">Who is moving</b>
    <p class="hint">Just you, unless you add someone. Passports, free movement and the rights each person already holds decide where they can live and work without applying for a visa.</p>
    <fieldset class="person"><legend>You</legend>
      ${rightsEditor(s, me, 0)}
      <p class="hint">For newcomer tax regimes, age-dependent tax and childcare (optional):</p>
      <div class="row3"><label>Age<input id="p0-age" type="number" min="16" max="99" value="${me?.newcomer?.age ?? ""}" data-person="0" data-field="age"></label>
        <label>Children's ages<input id="p0-kids" inputmode="numeric" value="${(s.profile.children ?? []).join(", ")}" placeholder="e.g. 2, 5" data-field="children"></label>
        <label>Last lived in the others<select id="p0-away" data-person="0" data-field="away"><option value="">not sure</option>${[["never", "never"], ["10", "10+ years ago"], ["5", "5-9 years ago"], ["3", "3-4 years ago"], ["1", "1-2 years ago"]].map(([v, l]) => html`<option value="${v}" ${awayOf(me) === v ? "selected" : ""}>${l}</option>`)}</select></label></div>
    </fieldset>
    ${others.map(
      (p, j) => html`<fieldset class="person"><legend>${p.label || "Someone"}</legend>
        <div class="row2"><label>Name<input id="p${j + 1}-name" value="${p.label}" data-person="${j + 1}" data-field="label" maxlength="24"></label></div>
        ${rightsEditor(s, p, j + 1)}
        <button class="link" data-act="remove-person" data-i="${j + 1}">Remove ${p.label || "this person"}</button></fieldset>`,
    )}
    <div class="hh-add"><span class="quiet">Add</span>${["Partner", "Family member", "Co-founder"].map((l) => html`<button class="pill-btn" data-act="add-person" data-label="${l}">${l}</button>`)}</div>
  </div>`.value;
}

const LIVE_WORD: Record<string, string> = { waiting: "waiting", running: "fetching…", ok: "done", empty: "no figure here", failed: "failed", skipped: "skipped" };

/** One line per source of a place being fetched, so the wait is visible and every gap has its reason. */
export function liveSources(s: AppState): Raw {
  const l = s.live;
  if (!l?.sources.length) return html``;
  const name = (id: string) => s.data.sources[id]?.name ?? id;
  return html`<ul class="live-list">${l.sources.map((x) => html`<li class="is-${x.status}"><span>${name(x.source)}</span><span>${LIVE_WORD[x.status] ?? x.status}${x.count ? ` · ${x.count} figure${x.count > 1 ? "s" : ""}` : ""}${x.reason && x.status !== "ok" ? html` <span class="quiet">(${x.reason})</span>` : ""}</span></li>`)}</ul>
        <p class="hint">Measured air quality (WHO), UK rents and some station sunshine cannot be read from a browser; the command line and the MCP server fetch them.</p>`;
}

/** What the fetch is doing, in one sentence. */
export function liveHead(s: AppState): Raw {
  const l = s.live;
  if (!l) return html``;
  return l.error
    ? html`<b>Could not add ${l.label || `"${l.query}"`}.</b> ${l.error} <button class="link" data-act="dismiss-live">Dismiss</button>`
    : l.label
      ? html`Fetching <b>${l.label}</b> from the sources, in your browser…`
      : html`Looking for "${l.query}"…`;
}

/** A place being fetched live, above the results: on the Cities view its own sheet carries this instead. */
function livePanel(s: AppState): Raw {
  if (!s.live || s.view === "cities") return html``;
  return html`<div class="live" role="status" aria-live="polite"><p class="live-head">${liveHead(s)}</p>${liveSources(s)}</div>`;
}

function addField(s: AppState): Raw {
  const available = s.data.cities.filter((c) => !s.profile.cities.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  return html`<label class="add"><span class="sr">Add any city</span><span class="add-plus" aria-hidden="true">+</span>
    <input id="add-city" list="all-cities" placeholder="${s.profile.cities.length ? "Add any city" : "Add a city to start"}" autocomplete="off" ${s.live && !s.live.error ? "disabled" : ""}>
    <datalist id="all-cities">${available.map((c) => html`<option value="${c.name}, ${regionName(c.country)}"></option>`)}</datalist></label>`;
}

const whoButton = (s: AppState) =>
  html`<button class="who" data-act="household" aria-haspopup="dialog"><span class="who-k">For</span> <b>${whoText(s)}</b><span class="who-add" aria-hidden="true">${s.profile.household.length > 1 ? "edit" : "+ someone"}</span></button>`;

const names = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The problems with these fields, beside them: the profile's own, and a change just refused (so never stored). The
 * engine names fields as an agent passes them ("salary.amount must be..."); here the field is the place, so the
 * sentence starts at what is wrong.
 */
export function problemsFor(s: AppState, ...fields: string[]): Raw {
  // The profile's own problems, and a change just refused (not stored, so not in the profile).
  const mine = [...new Set([...profileProblems(s.profile), ...(s.refused ?? [])])].filter((m) => fields.some((f) => m.startsWith(f)));
  return html`${mine.map((m) => {
    const said = m.replace(/^[\w.[\]]+( \(a month\))? /, "");
    return html`<p class="fld-err" role="alert">${said.charAt(0).toUpperCase()}${said.slice(1)}</p>`;
  })}`;
}

/**
 * The one input that would make the answer more supportable, as a control in the answer itself: a salary field when no
 * salary is given, the first missing rent, a passport. Null when money and eligibility are both settled.
 */
function nextInput(s: AppState, e: Evaluation): Raw | null {
  const p = s.profile;
  const w = (id: string) => e.results[0]?.lines.find((l) => l.id === id)?.weight ?? 0;
  const moneyCounts = w("money_left") + w("living_cost") > 0;
  const noSalary = e.results.every((r) => r.money.missing.includes("salary"));
  // On a first visit the greeting asks for the salary and the passport itself; rent comes once there is pay to set it against.
  if (s.intro && noSalary) return null;
  if (moneyCounts && noSalary) {
    return html`<p class="v-next"><label for="verdict-salary">Money is not in the score yet: add your salary</label><span class="v-field"><input type="number" inputmode="numeric" min="0" step="1000" id="verdict-salary" placeholder="Gross a year" data-field="gross"><select data-field="income-currency" aria-label="Currency of your salary">${CURRENCIES.map((c) => html`<option ${c === p.income.currency ? "selected" : ""}>${c}</option>`)}</select></span><span class="quiet">the same everywhere; set it per city on each sheet.</span>${problemsFor(s, "salary")}</p>`;
  }
  const noRent = e.results.filter((r) => !r.ruledOut.length && r.money.missing.includes("rent") && !r.money.missing.some((x) => x.startsWith("a tax model") || x.startsWith("an exchange rate")));
  if (moneyCounts && noRent.length) {
    const r = noRent[0]!;
    return html`<p class="v-next"><button class="link-next" data-act="focus" data-target="rent-${r.city.id}">Add your rent for ${r.city.name}</button>${noRent.length > 1 ? html`<span class="quiet"> and ${noRent.length - 1} more: no open rent figure covers ${noRent.length > 2 ? "them" : "it"}.</span>` : html`<span class="quiet">No open rent figure covers it.</span>`}</p>`;
  }
  // A cost that is due but has no figure (a premium bought outside pay, childcare): the figure waits for it.
  const leaves = e.results.find((r) => !r.ruledOut.length && r.money.completeness.status === "partial" && r.money.completeness.missing.length);
  if (moneyCounts && leaves) return html`<p class="v-next"><span>${leaves.city.name}'s money leaves out ${moneyAdds(s, leaves)}.</span></p>`;
  const unchecked = p.household.length === 0 || p.household.some((h) => !hasRightsGiven(h));
  if (unchecked) {
    const i = Math.max(0, p.household.findIndex((h) => !hasRightsGiven(h)));
    return html`<p class="v-next"><button class="link-next" data-act="focus" data-target="e${i}-pass">Add ${i === 0 ? "your passport" : `${p.household[i]!.label}'s passport`}</button><span class="quiet"> or another right to live and work, to see where you can move without applying for a visa.</span></p>`;
  }
  return null;
}

/** The answer so far, in words: who leads, what money says, who cannot move where, and the next input. */
/** The link's places this browser lacks, said by name until a place of that name is among the cities again. */
function notFoundNote(s: AppState): Raw | "" {
  const have = new Set(s.profile.cities.map((id) => s.data.cities.find((c) => c.id === id)?.name.toLowerCase()));
  const lost = (s.notFound ?? []).map((id) => linkPlaceName(id)).filter((n) => ![...have].some((h) => h && n.toLowerCase().startsWith(h)));
  if (!lost.length) return "";
  const one = lost.length === 1;
  return html`<p class="v-more">The link also named ${names(lost)}, fetched in the sender's browser and not in this one: add ${one ? "it" : "them"} by name to compare ${one ? "it" : "them"} here.</p>`;
}

export function verdict(s: AppState, e: Evaluation): Raw {
  if (!e.results.length) return html`<div class="answer" aria-live="polite"><p class="v-lead">Add the cities you are weighing.</p>${notFoundNote(s)}</div>`;
  const passing = e.results.filter((r) => !r.ruledOut.length && !r.unresolved.length);
  const unknown = e.results.filter((r) => !r.ruledOut.length && r.unresolved.length);
  const out = e.results.filter((r) => r.ruledOut.length);
  const lead = passing[0];
  const next = passing[1];
  const gap = lead && next ? Math.round(lead.total - next.total) : 0;
  // Before any salary, money (the biggest default dial) counts for nobody: the lead rests on the other lines, said plainly.
  const noPay = e.results.every((r) => r.money.missing.includes("salary")) && shareOf(e, ["money_left", "living_cost"]) > 0;
  const restingOn = names([...new Set((e.results[0]?.lines ?? []).filter((l) => l.weight > 0 && l.id !== "money_left" && l.id !== "living_cost").map((l) => l.label.toLowerCase()))]);
  const headline = !lead
    ? unknown.length
      ? html`No city can be ranked yet: a must-pass line is not known`
      : html`Every city is ruled out by a must-pass line`
    : e.provisional && noPay
      ? html`So far, <b>${lead.city.name}</b> fits you best`
      : e.provisional
      ? html`Provisional: <b>${lead.city.name}</b> leads for now`
      : !next
      ? html`<b>${lead.city.name}</b> fits you best`
      : gap < 1
        ? html`<b>${lead.city.name}</b> and <b>${next.city.name}</b> are level`
        : html`<b>${lead.city.name}</b> fits you best, ${gap} point${gap === 1 ? "" : "s"} ahead of ${next.city.name}`;
  // Who keeps the most is claimed only among cities whose figure is whole; the others are named.
  const whole = e.results.filter((r) => !r.ruledOut.length && r.money.display.monthlyLeft !== null && !moneyGap(r.money));
  const kept = whole.sort((a, b) => b.money.display.monthlyLeft! - a.money.display.monthlyLeft!)[0];
  const without = e.results.filter((r) => !r.ruledOut.length && !whole.includes(r)).map((r) => r.city.name);
  const amount = kept ? html`<b class="num">${money(kept.money.display.monthlyLeft, kept.money.display.currency)}</b>` : "";
  const money_ = !kept
    ? ""
    : without.length
      ? html`Of the cities with a whole money figure, <b>${kept.city.name}</b> leaves you the most each month: ${amount}; ${names(without)} not yet.`
      : kept === lead
        ? html`It also leaves you the most each month: ${amount}.`
        : html`<b>${kept.city.name}</b> leaves you the most each month: ${amount}.`;
  // Someone who would need a visa where the answer points is said here, not left to a weight.
  const visa = lead ? lead.rights.filter((x) => x.status === "no").map((x) => (x.person === "You" ? "you" : x.person)) : [];
  const visaText = visa.length ? html`In ${lead!.city.name}, ${names(visa)} would need a visa or permit.` : "";
  const unknownText = unknown.length ? html`Not known yet for ${names(unknown.map((r) => r.city.name))}: ${names([...new Set(unknown.flatMap((r) => r.unresolved))].map((l) => l.toLowerCase()))}, which you marked must pass.` : "";
  const ruled = out.length ? html`${out.map((r, i) => html`${i ? " " : ""}<b>${r.city.name}</b> is ruled out: ${failText(r.ruledOut, r.lines)}.`)}` : "";
  // A lead that missing figures could still change is said so, with what is missing; so is money on another basis.
  // Without pay, money can still count on what a month costs where every city has its costs: said so, not hidden.
  const onCosts = noPay && e.moneyBasis?.used === "cost";
  const open = lead && e.provisional && onCosts
    ? html`Money is ${shareOf(e, ["money_left", "living_cost"])}% of your score; until your salary is in, it compares what a month costs (rent and everyday spending), not what you keep. ${e.provisionalReasons.filter((r) => !/salary|money|take-home|pay/i.test(r)).join(" ")}`
    : lead && e.provisional && noPay
    ? html`Money is ${shareOf(e, ["money_left", "living_cost"])}% of your score and counts once your salary is in; until then the ranking rests on ${restingOn || "the other lines"}. ${e.provisionalReasons.filter((r) => !/salary|money|take-home|pay/i.test(r)).join(" ")}`
    : lead && e.provisional ? html`The lead is not settled: ${names(e.rivals)} could still overtake it once what is missing is known. ${e.provisionalReasons.join(" ")}` : "";
  const basis = e.moneyBasis?.used === "net_pay" ? html`Money was compared on take-home pay only, without costs.` : e.moneyBasis?.used === "cost" && !onCosts ? html`Money was compared on costs only, without pay.` : "";
  const more = [open, basis, money_, visaText, unknownText, ruled].filter(Boolean);
  const ask = nextInput(s, e);
  // While the salary itself is the next input, the engine's note on money says the same thing less directly.
  const noSalary = e.results.every((r) => r.money.missing.includes("salary"));
  const notes = e.notes.filter((n) => !(noSalary && /^(Money left|Cost of living)/.test(n)));
  // Before a salary, a first visit still sees what money is left after rent: at an example salary, said so.
  const example = s.intro && noSalary ? exampleMoney(s.data, s.profile, s.visit) : "";
  return html`<div class="answer" aria-live="polite"><p class="v-lead">${headline}</p>${notFoundNote(s)}${more.length ? html`<p class="v-more">${more.map((x, i) => html`${i ? " " : ""}${x}`)}</p>` : ""}${example}
    ${notes.length ? html`<ul class="v-notes">${notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}
    ${ask ?? ""}</div>`;
}

/** The share of the score a set of lines holds, in whole percent, from the weights the engine used. */
function shareOf(e: Evaluation, ids: string[]): number {
  const lines = e.results[0]?.lines ?? [];
  const total = lines.reduce((t, l) => t + l.weight, 0);
  return total ? Math.round((100 * lines.filter((l) => ids.includes(l.id)).reduce((t, l) => t + l.weight, 0)) / total) : 0;
}

/**
 * A first visit: what Borgo is, in two sentences, then the answers that move the ranking most, each in place: the
 * salary (money is the biggest dial and counts for nothing without it), the nice-day range (the other default dial) and
 * a passport (who may live and work where). Each step shows what was given once it is.
 */
function intro(s: AppState, e: Evaluation): Raw {
  if (!s.intro) return html``;
  const p = s.profile;
  const money = shareOf(e, ["money_left", "living_cost"]);
  const nice = shareOf(e, ["nice_days"]);
  const me = p.household[0];
  const salaryDone = p.income.gross > 0;
  return html`<section class="intro" aria-labelledby="intro-h">
    <h1 class="intro-h" id="intro-h">The best place to live, <span>for you</span></h1>
    <p class="intro-lede">Borgo is yours. It ranks cities on what you value: what you keep after tax and rent, days that feel the way you like, where you have the right to live and work. Every number shows its source, and nothing you enter leaves your browser.</p>
    <ol class="intro-steps" aria-label="Start with what moves the ranking most">
      <li class="step ${salaryDone ? "is-done" : ""}"><span class="step-n num" aria-hidden="true">1</span><label class="step-k" for="intro-salary">Your salary</label>
        <span class="v-field"><input type="number" inputmode="numeric" min="0" step="1000" id="intro-salary" placeholder="Gross a year" value="${salaryDone ? p.income.gross : ""}" data-field="gross"><select data-field="income-currency" aria-label="Currency of your salary">${CURRENCIES.map((c) => html`<option ${c === p.income.currency ? "selected" : ""}>${c}</option>`)}</select></span>
        <span class="step-why">${money ? `Money is ${money}% of your score and needs it` : "For what you keep after tax and rent"}</span>${problemsFor(s, "salary")}</li>
      <li class="step"><span class="step-n num" aria-hidden="true">2</span><span class="step-k">Your nice days</span>
        <span class="step-in">${rangeButton(s, "intro")} <button class="link nice-sum" data-act="comfort" data-where="intro-tests" aria-haspopup="dialog">${niceTestsShort(p.prefs.comfort)}</button></span>
        <span class="step-why">${nice ? `Nice days are ${nice}% of your score` : "Days that feel the way you like"}</span></li>
      <li class="step ${me?.citizenships.length ? "is-done" : ""}"><span class="step-n num" aria-hidden="true">3</span><label class="step-k" for="intro-pass">Your passport</label>
        <select id="intro-pass" data-person="0" data-field="citizenship"><option value="">Not given</option>${passportOptions(me?.citizenships[0] ?? "")}</select>
        <span class="step-why">Where you can live and work without applying for a visa. <button class="link" data-act="household">More passports, permanent residence, a work visa…</button></span></li>
    </ol>
    <button class="link intro-x" data-act="intro-hide">Hide this</button>
  </section>`;
}

export function topQuestion(s: AppState, e: Evaluation): Raw {
  const rank = new Map(e.results.map((r) => [r.city.id, r]));
  const chosen = s.profile.cities.map((id) => s.data.cities.find((c) => c.id === id)).filter((c) => !!c).sort((a, b) => (rank.get(a!.id)?.rank ?? 99) - (rank.get(b!.id)?.rank ?? 99));
  return html`${intro(s, e)}<section class="ask" aria-label="Your comparison">
    <div class="ask-row">
      ${whoButton(s)}
      <ul class="roster" aria-label="Your cities, best first">${chosen.map((c) => {
        const r = rank.get(c!.id);
        return html`<li class="cchip ${r?.ruledOut.length ? "is-out" : ""}" data-flip="chip-${c!.id}"><a href="#/city/${c!.id}">${r ? html`<b class="chip-r num">${r.ruledOut.length ? "Out" : r.rank}</b>` : ""}${c!.name}</a><button class="chip-x" data-act="remove-city" data-city="${c!.id}" aria-label="Remove ${c!.name}">${CLOSE}</button></li>`;
      })}${s.live && !s.live.error ? html`<li class="cchip is-loading" aria-busy="true"><span class="chip-wait" aria-hidden="true"></span>${s.live.name ?? s.live.query}<span class="sr">, being added</span></li>` : ""}</ul>
      ${addField(s)}
      <button class="share-btn" data-act="share">Share</button>
    </div>
    ${verdict(s, e)}
    ${livePanel(s)}
  </section>`;
}
