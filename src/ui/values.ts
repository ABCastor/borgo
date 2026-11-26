import { CRITERIA, politicsWord, stanceOf, type Criterion } from "../core/criteria.ts";
import { criteriaFor, evaluate, weightOf } from "../core/engine.ts";
import { grouped, priorityGroups, type Group } from "../core/groups.ts";
import type { Profile } from "../core/types.ts";
import { niceTestsShort, rangeButton } from "./cards.ts";
import { html, type Raw } from "./dom.ts";
import { CLOSE } from "./results.ts";
import { passportOptions, problemsFor } from "./top.ts";
import { CURRENCIES, money } from "./format.ts";
import { shortLabel } from "./glance.ts";
import { PRESETS, type AppState } from "./state.ts";
import { term } from "./terms.ts";
import { kindOf, WORK_KINDS } from "../core/work.ts";

// The sheets beside the cards. Each view carries the inputs that drive it: values on Cities and Compare,
// pay and spending on Money. Nothing is edited in a bar on top.

export function share(weight: number, total: number): string {
  if (!(total > 0)) return "0%";
  const pct = Math.round((100 * weight) / total);
  // A line that counts never reads as 0%: under half a percent is said as under 1%.
  return weight > 0 && pct === 0 ? "<1%" : `${pct}%`;
}

const PART_MAX = 100;
const GROUP_MAX = 100;

/** The remove X beside a priority or a line: a 44 px target, named for what it removes. */
export function removeX(act: string, id: string, what: string): Raw {
  return html`<button class="prio-x" data-act="${act}" data-id="${id}" aria-label="Remove ${what}" title="Remove ${what}">${CLOSE}</button>`;
}

function dial(id: string, label: string, weight: number, total: number, o: { personal?: boolean; mustPass?: boolean; canBreak?: boolean; question?: string; stance?: Raw; missing?: string[]; x?: boolean; extra?: Raw }): Raw {
  return html`<li class="vline ${o.personal ? "is-personal" : ""} ${o.stance ? "is-position" : ""} ${weight === 0 ? "is-zero" : ""} ${o.x || o.personal ? "has-x" : ""}">
    <label class="val-n" for="w-${id}" title="${o.question ?? ""}">${label}${o.personal ? html`<span class="yours">Yours</span>` : ""}</label>
    <output class="val-p num" id="o-${id}" for="w-${id}">${o.mustPass ? "requirement, not scored" : `${share(weight, total)} of score`}</output>
    ${o.personal ? removeX("remove-line", id, label) : o.x ? removeX("line", id, label) : ""}
    <input type="range" id="w-${id}" min="0" max="${PART_MAX}" step="1" value="${weight}" data-weight="${id}" ${o.mustPass ? "disabled" : ""} style="--fill:${((Math.min(weight, PART_MAX) / PART_MAX) * 100).toFixed(1)}%" aria-label="How much ${label} matters">
    ${o.extra ?? ""}
    ${o.stance ?? ""}
    ${o.canBreak ? html`<label class="check"><input type="checkbox" data-act="toggle-breaker" data-id="${id}" ${o.mustPass ? "checked" : ""}> Required: rule out cities that fail</label><small class="hint">A requirement filters cities; it takes no share of the score.</small>` : ""}
  </li>`;
}

/** Where you stand on a position line: a choice of steps, or a left-to-right slider. Unset until you set it. */
function stanceControl(c: Criterion, stance: number | undefined): Raw {
  const spec = c.position!;
  const toggle = html`<label class="check"><input type="checkbox" data-act="stance-toggle" data-id="${c.id}" ${stance === undefined ? "" : "checked"}> On</label>`;
  if (spec.levels) {
    return html`<div class="stance">${toggle}<label><span class="stance-k">You want</span><select data-stance="${c.id}" aria-label="Where you stand: ${c.label}">
      <option value="" ${stance === undefined ? "selected" : ""}>Not said</option>
      ${spec.levels.map((l) => html`<option value="${l.value}" ${stance === l.value ? "selected" : ""}>${l.label}</option>`)}
    </select></label></div>`;
  }
  const v = stance ?? (spec.min + spec.max) / 2;
  return html`<div class="stance stance-range ${stance === undefined ? "is-unset" : ""}">
    ${toggle}<span class="stance-k">You want</span>
    <span class="stance-end">${spec.ends![0]}</span>
    <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${v}" data-stance="${c.id}" aria-label="Where you stand: ${c.label}, ${spec.ends![0]} ${spec.min} to ${spec.ends![1]} ${spec.max}" aria-valuetext="${stance === undefined ? "not said" : `${politicsWord(v)}, ${v}`}">
    <span class="stance-end">${spec.ends![1]}</span>
    <output class="stance-v" id="sv-${c.id}">${stance === undefined ? "not said" : `${politicsWord(v)} ${v}`}</output>
    ${stance === undefined ? "" : html`<button class="link" data-act="clear-stance" data-id="${c.id}">Clear</button>`}
  </div>`;
}

/** The lines that make up a group, in its own order: the ones that count, and the standard ones that do not yet. */
const counts = (p: Profile, c: Criterion) => weightOf(p, c) > 0 || p.dealBreakers.includes(c.id);
/** A standard line that can be switched on with one click: it applies to this person as they are (a stance or a kind of work comes first). */
const addable = (p: Profile, c: Criterion) => c.category !== "personal" && !c.position && (!c.applies || c.applies(p));
const lineName = (c: Criterion) => (c.category === "personal" ? c.label : shortLabel(c));

/** Nice days are the person's own weather: its range and tests, edited in place on the nice-days line. */
function niceDef(s: AppState): Raw {
  return html`<span class="vg-def">${rangeButton(s, "values")}<button class="link nice-sum" data-act="comfort" data-where="values-tests" aria-haspopup="dialog">Edit weather tests: ${niceTestsShort(s.profile.prefs.comfort)}</button></span>`;
}

/** A line that counts, in a closed group: its name and share, read-only; nice days carries its own definition. */
function onLine(s: AppState, c: Criterion, total: number): Raw {
  const p = s.profile;
  const req = p.dealBreakers.includes(c.id);
  return html`<li class="vg-line ${c.id === "nice_days" ? "is-nice" : ""}"><span class="vg-ln">${lineName(c)}${c.category === "personal" ? html`<span class="yours">Yours</span>` : ""}</span><span class="vg-lp num" id="ol-${c.id}">${req ? "required" : share(weightOf(p, c), total)}</span>${c.id === "nice_days" ? niceDef(s) : ""}</li>`;
}

/** One click to add a standard line, or to take it out again: pressed while it counts. */
export function lineChip(p: Profile, c: Criterion): Raw {
  const on = counts(p, c);
  return html`<button class="add-chip" data-act="line" data-id="${c.id}" aria-pressed="${String(on)}" ${p.dealBreakers.includes(c.id) ? "disabled" : ""}><span aria-hidden="true">${on ? "✓" : "+"}</span> ${lineName(c)}</button>`;
}

/** The kind of work, said once at the head of Work and ambition: it decides which of the group's parts count. */
function workLine(s: AppState): Raw {
  const k = kindOf(s.profile);
  return html`<p class="nice-own work-own"><label for="work-kind">Your kind of work</label><select id="work-kind" data-work aria-describedby="work-note">
      <option value="" ${k ? "" : "selected"}>Not said</option>
      ${WORK_KINDS.map((w) => html`<option value="${w.id}" ${k?.id === w.id ? "selected" : ""}>${w.label}</option>`)}
    </select></p>
    <p class="vs-lede" id="work-note">${k ? (k.pay ? "Pay and jobs in your field count here, from official earnings and labour surveys." : "Young companies, developers and graduates around you count most.") : "Choose it and pay and jobs in your field count here."}</p>`;
}


/** What a third priority starts at, shared over its parts by their default weights. */
export const THIRD_WEIGHT = 10;

/** Missing scoring inputs belong to the group, not every dial and requirement. */
export function groupMissing(s: AppState, g: Group, parts: Criterion[], missing: Record<string, string[]>): Raw {
  const active = parts.filter(c => weightOf(s.profile, c) > 0);
  const absent = [...new Set(active.flatMap(c => missing[c.id] ?? []))];
  if (!absent.length) return html``;
  const list = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  const noPay = g.id === "money" && !s.profile.income.gross && !Object.values(s.profile.income.perCity).some(v => (typeof v === "number" ? v : v.gross) > 0);
  const allMissing = s.profile.cities.length > 0 && active.every(c => (missing[c.id]?.length ?? 0) === s.profile.cities.length);
  const wholeAbsent = absent.filter(name => active.every(c => missing[c.id]?.includes(name)));
  const covered = s.profile.cities.map(id => s.data.cities.find(c => c.id === id)?.name).filter((n): n is string => !!n && !wholeAbsent.includes(n));
  const text = noPay ? "Money counts once you add your salary." : allMissing
    ? `No figures for ${list(absent)}: ${g.label} counts once you add its missing inputs or figures.`
    : wholeAbsent.length === absent.length && covered.length
      ? `No figure for ${list(absent)}: ${g.label} counts only for ${list(covered)}.`
      : `Some ${g.label.toLowerCase()} figures are missing for ${list(absent)}; only known lines count there.`;
  return html`<p class="hint group-missing">${text}</p>`;
}


function groupBlock(s: AppState, g: Group, parts: Criterion[], total: number, o: { missing?: Record<string, string[]> } = {}): Raw {
  const p = s.profile;
  const weight = parts.reduce((t, c) => t + weightOf(p, c), 0);
  const on = parts.filter((c) => counts(p, c));
  const open = s.openGroups.includes(g.id);
  const label = g.label;
  const max = Math.max(GROUP_MAX, Math.ceil(weight));
  const part = (c: Criterion) =>
    c.category === "personal"
      ? dial(c.id, c.label, weightOf(p, c), total, { personal: true })
      : dial(c.id, shortLabel(c), weightOf(p, c), total, {
          canBreak: !!c.fails || !!c.position,
          mustPass: p.dealBreakers.includes(c.id),
          question: c.question,
          stance: c.position ? stanceControl(c, stanceOf(p, c.id)) : undefined,
          x: !c.position && counts(p, c) && !p.dealBreakers.includes(c.id),
          extra: c.id === "nice_days" ? niceDef(s) : undefined,
        });
  // Open: every line that counts as a dial; the group's other standard lines, one click each. Where you stand keeps
  // every stance beside its line, since a stance is what switches the line on; your own lines all stay, at 0 too.
  const shown = g.id === "stand" || g.id === "own" ? parts : on;
  const more = g.id === "stand" ? [] : parts.filter((c) => !counts(p, c) && addable(p, c));
  // A priority that is one line (Safety) is its own dial: nothing to list or open under it, unless it can be Required.
  const single = parts.length === 1 && g.id !== "own" && !parts[0]!.fails && !parts[0]!.position;
  return html`<li class="vgroup ${weight === 0 ? "is-zero" : ""} ${open ? "is-open" : ""}" data-group="${g.id}" data-flip-row="g-${g.id}">
    <div class="vline vg-head has-x">
      <label class="val-n" for="wg-${g.id}" title="${g.question}">${label}</label>
      <output class="val-p num" id="og-${g.id}" for="wg-${g.id}">${share(weight, total)} of score</output>
      ${removeX("remove-priority", g.id, label)}
      <input type="range" id="wg-${g.id}" min="0" max="${max}" step="1" value="${Math.round(weight)}" data-group-weight="${g.id}" ${parts.length && parts.every((c) => p.dealBreakers.includes(c.id)) ? "disabled" : ""} style="--fill:${((Math.min(weight, max) / max) * 100).toFixed(1)}%" aria-label="How much ${label} matters">
    </div>
    ${groupMissing(s, g, parts, o.missing ?? {})}
    ${g.id === "ambition" ? workLine(s) : ""}
    ${single && !open ? "" : open
      ? html`<div class="vg-parts" id="vg-${g.id}"><p class="vs-lede">Lines split ${g.label}'s <span id="sg-${g.id}">${share(weight, total)}</span> share; moving one changes the total.</p>
          ${g.id === "stand" ? html`<p class="vs-lede">Say where you stand and a place scores by how close it is; nothing is assumed about you.</p>` : ""}
          ${g.id === "own" ? html`<p class="vs-lede">What no dataset knows: family nearby, a partner's job, a feeling. Score each city 1 to 5 in its dossier or in Compare.</p>` : ""}
          ${shown.length ? html`<ul class="vals">${shown.map(part)}</ul>` : ""}
          ${more.length ? html`<p class="vg-more-h">More ${g.label.toLowerCase()} lines</p><div class="chips">${more.map((c) => lineChip(p, c))}</div>` : ""}
          ${g.pending ? html`<p class="vs-lede">${g.pending}</p>` : ""}
          ${g.id === "own" ? html`<form class="addline" data-act="add-line"><input name="label" placeholder="e.g. Family nearby" aria-label="New line of your own" maxlength="40"><button class="pill-btn">Add</button></form>` : ""}
        </div>`
      : on.length
        ? html`<ul class="vg-on" aria-label="What counts in ${label}">${on.map((c) => onLine(s, c, total))}</ul>`
        : html`<p class="hint">Nothing counts here yet.</p>`}
    ${single && !open ? "" : html`<div class="priority-actions"><button class="link" data-act="group" data-id="${g.id}" aria-expanded="${String(open)}" aria-controls="vg-${g.id}">${open ? "Done" : more.length ? "Edit or add lines" : "Edit"}</button></div>`}
  </li>`;
}

/** Right to live and work: a check, not a dial. A passport per person here; more passports and other rights behind "For You". */
function eligibility(s: AppState): Raw {
  const p = s.profile;
  const people = p.household.length ? p.household : [{ label: "You", citizenships: [] as string[] }];
  const must = p.dealBreakers.includes("right_to_live");
  return html`<section class="elig" aria-labelledby="elig-h">
    <div class="elig-head"><h3 class="val-n" id="elig-h">Right to live and work</h3><button class="must ${must ? "is-on" : ""}" data-act="toggle-breaker" data-id="right_to_live" aria-pressed="${must}" title="Rule out a city where someone moving would need to apply for a visa or permit">Required: rule out cities that fail</button></div>
    <ul class="elig-people">${people.map(
      (x, i) => html`<li><label for="e${i}-pass">${x.label || "Someone"}</label><select id="e${i}-pass" data-person="${i}" data-field="citizenship"><option value="">Passport not given</option>${passportOptions(x.citizenships[0] ?? "")}</select>${i > 0 ? html`<button class="chip-x" data-act="remove-person" data-i="${i}" aria-label="Remove ${x.label || "this person"}">×</button>` : ""}</li>`,
    )}</ul>
    <p class="vs-lede">Rule out cities that fail: everyone must already be allowed. Entry difficulty is a rough guide, not legal advice. <button class="link" data-act="household">${(p.household[0]?.citizenships.length ?? 0) > 1 || p.household.some((h) => h.permits?.length) ? "Edit passports and rights" : "Add another passport or right"}</button>${p.household.length > 1 ? "" : html` · <button class="link" data-act="household">Add someone</button>`}</p>
  </section>`;
}

/** The few standard lines most people start from, offered first in Add priority. */
export const START_WITH = ["money_left", "nice_days", "safety", "clean_air", "right_to_live"];

/** Undo for the last priority or line taken out with its X. */
function undoLine(s: AppState, crit: Criterion[]): Raw {
  if (s.removedPriority) {
    const g = grouped(crit).find((x) => x.group.id === s.removedPriority)?.group;
    return html`<p class="undo" role="status">${g?.label ?? "Priority"} removed. <button class="link" data-act="undo-priority" data-id="${s.removedPriority}">Undo</button></p>`;
  }
  if (s.removedLine) return html`<p class="undo" role="status">${s.removedLine.label} removed. <button class="link" data-act="undo-line" data-id="${s.removedLine.id}">Undo</button></p>`;
  return html``;
}

/**
 * Add priority: Borgo's standard catalogue, grouped as the list is, with the lines most people start from first. A
 * line is one click to add or take out again; a group's Add starts its usual lines. The person's own lines come last.
 */
function catalogueBlock(s: AppState, crit: Criterion[]): Raw {
  const p = s.profile;
  const open = !!s.catalogueOpen;
  const q = (s.catalogueQuery ?? "").trim().toLowerCase();
  const all = grouped(crit).filter(({ group }) => !group.shows || group.shows(p));
  const { active } = priorityGroups(p, crit);
  const start = START_WITH.map((id) => crit.find((c) => c.id === id)).filter((c): c is Criterion => !!c && addable(p, c));
  const words = (g: Group, parts: Criterion[]) => [g.label, g.question, ...parts.filter((c) => c.category !== "personal").map(lineName)].join(" ").toLowerCase();
  return html`<div class="priority-catalogue"><button class="pill-btn" data-act="catalogue" aria-controls="priority-options" aria-expanded="${String(open)}"><span aria-hidden="true">+</span> Add priority</button>
    <div id="priority-options" class="catalogue" ${open ? "" : "hidden"}>
      <label class="cat-search">Search priorities<input type="search" data-priority-search value="${s.catalogueQuery ?? ""}" placeholder="Rent, sunshine, schools…"></label>
      <section class="cat-g cat-start" data-catalogue-label="${start.map(lineName).join(" ").toLowerCase()} start" ${q && !start.some((c) => lineName(c).toLowerCase().includes(q)) ? "hidden" : ""}><h3 class="cat-h">Most people start with</h3><div class="chips">${start.map((c) => lineChip(p, c))}</div></section>
      <ul class="cat-list" aria-label="Standard priorities">${all.filter(({ group }) => group.id !== "own").map(({ group, parts }) => {
        const isOn = active.some((x) => x.group.id === group.id);
        const lines = parts.filter((c) => addable(p, c));
        return html`<li class="cat-g" data-catalogue-label="${words(group, parts)}" ${q && !words(group, parts).includes(q) ? "hidden" : ""}>
          <div class="cat-gh"><h3 class="cat-h">${group.label}</h3>${isOn ? html`<span class="cat-on">Counts</span>` : html`<button id="wg-${group.id}" class="pill-btn" data-act="add-priority" data-id="${group.id}" aria-label="Add ${group.label}">Add</button>`}</div>
          <p class="hint">${group.question}</p>
          ${lines.length > 1 || (lines.length === 1 && lines[0]!.id !== group.id) ? html`<div class="chips">${lines.map((c) => lineChip(p, c))}</div>` : ""}
        </li>`;
      })}
      ${(() => {
        const own = all.find(({ group }) => group.id === "own");
        if (!own) return "";
        const isOn = active.some((x) => x.group.id === "own");
        return html`<li class="cat-g cat-own" data-catalogue-label="your own lines ${words(own.group, own.parts)}" ${q && !`your own lines ${words(own.group, own.parts)}`.includes(q) ? "hidden" : ""}><div class="cat-gh"><h3 class="cat-h">Your own lines</h3>${isOn ? html`<span class="cat-on">Counts</span>` : html`<button id="wg-own" class="pill-btn" data-act="add-priority" data-id="own" aria-label="Add Your own lines">Add</button>`}</div><p class="hint">What no dataset knows, such as family nearby. You score each city 1 to 5.</p></li>`;
      })()}</ul>
    </div></div>`;
}

export function valuesSheet(s: AppState): Raw {
  const p = s.profile;
  const crit = criteriaFor(p);
  const missing: Record<string, string[]> = {};
  for (const r of evaluate(s.data, p).results) for (const l of r.lines) {
    const c = crit.find((c) => c.id === l.id)!;
    if (l.raw.value === null && (!c.applies || c.applies(p))) (missing[l.id] ??= []).push(r.city.name);
  }
  const presetActive = PRESETS.find((pr) => CRITERIA.every((c) => (p.weights[c.id] ?? c.defaultWeight) === (pr.weights[c.id] ?? c.defaultWeight)))?.id;
  const total = crit.reduce((t, c) => t + weightOf(p, c), 0);
  const groups = grouped(crit).filter(({ group }) => !group.shows || group.shows(p));
  const { active } = priorityGroups(p, crit);
  const on = active.length;
  return html`<div class="vs-fold ${s.valuesOpen ? "is-open" : ""}"><button class="vs-sum" data-act="fold" aria-expanded="${s.valuesOpen}" aria-controls="vs-body"><span>What matters</span><span class="quiet">${on} of ${groups.length} count · ${s.valuesOpen ? "close" : "edit"}</span></button>
    <div class="vs-body" id="vs-body">
    <h2 class="sh">What matters</h2>
    <p class="vs-lede">Set relative importance; each percentage is a ${term("share", "Share")} of your score, not money.</p>
    <ul class="vals vgroups">${active.map(({ group, parts }) => groupBlock(s, group, parts, total, { missing }))}</ul>
    ${undoLine(s, crit)}
    ${catalogueBlock(s, crit)}
    <section class="requirements"><h3>Required</h3><p class="hint">Rule out cities that fail. Requirements take no share of the score.</p><ul>${crit.filter(c => p.dealBreakers.includes(c.id)).map(c => html`<li>${c.label} <button class="link" data-act="toggle-breaker" data-id="${c.id}">Remove requirement</button></li>`)}</ul></section>
    ${eligibility(s)}

    <button class="more" data-act="more" aria-expanded="${s.moreOpen}" aria-controls="more-body">Presets and scoring</button>
    ${s.moreOpen
      ? html`<div class="more-body" id="more-body">
        <p class="vs-lede">Start from a set of weights, or tune any group.</p>
        <div class="presets" role="group" aria-label="Start from">
          ${PRESETS.map((pr) => html`<button class="pill-btn ${presetActive === pr.id ? "is-on" : ""}" aria-pressed="${presetActive === pr.id}" data-act="preset" data-id="${pr.id}">${pr.label}</button>`)}
        </div>

        <h3 class="vs-h">How each line is scored</h3>
        <div class="seg" role="radiogroup" aria-label="How each line is scored">
          <button role="radio" aria-checked="${p.prefs.normalise === "absolute"}" data-act="normalise" data-mode="absolute" title="Each value against a fixed best and worst">Fixed</button>
          <button role="radio" aria-checked="${p.prefs.normalise === "relative"}" data-act="normalise" data-mode="relative" title="Best of your cities scores full marks">Relative (opt-in): against your cities</button>
        </div>
      </div>`
      : ""}
    </div></div>`;
}

/** One earner's pay: gross and currency, the tick for a figure per city, and the pension share. */
function payFields(s: AppState, i: number): Raw {
  const p = s.profile;
  const own = i === 0;
  const person = p.household[i];
  const pay = own ? { gross: p.income.gross, currency: p.income.currency, mode: p.income.mode, pension: p.income.pension } : (person?.pay ?? { gross: 0, currency: p.displayCurrency });
  const who = own ? "Your" : `${person?.label || "Their"}'s`;
  const perCity = pay.mode === "per-city";
  const cur = html`<select data-pay="${i}" data-pay-field="currency" aria-label="Currency of ${who.toLowerCase()} pay">${CURRENCIES.map((c) => html`<option ${c === pay.currency ? "selected" : ""}>${c}</option>`)}</select>`;
  const alone = own && p.household.slice(1).every((x) => !x.pay && !x.spouse);
  return html`<fieldset class="earner"><legend class="${alone ? "sr" : ""}">${own ? "You" : person?.label || "Someone"}${!own ? html` <button type="button" class="chip-x" data-act="remove-person" data-i="${i}" aria-label="Remove ${person?.label || "this person"}">×</button>` : ""}</legend>
    <label class="fld">Gross pay a year${perCity ? ", where not set per city" : ""}<span class="fld-row"><input id="pay-${i}" type="number" inputmode="numeric" min="0" step="1000" value="${pay.gross || ""}" placeholder="${own ? "e.g. 60000" : "0 if they do not earn"}" data-pay="${i}" data-pay-field="gross">${cur}</span></label>
    ${problemsFor(s, own ? "salary" : `household[${i}].salary`)}
    <label class="check tick"><input type="checkbox" id="per-city-${i}" data-act="pay-mode" data-i="${i}" ${perCity ? "checked" : ""}> Differs by city</label>${perCity ? html`<p class="vs-lede">Set it on each city, here in Money or on its sheet.</p>` : ""}
    <label class="fld fld-age">Age<input id="age-${i}" type="number" inputmode="numeric" min="16" max="99" value="${person?.newcomer?.age ?? ""}" placeholder="optional" data-person="${i}" data-field="age"></label>
    ${!own ? html`<label class="check"><input type="checkbox" data-act="spouse" data-i="${i}" ${person?.spouse ? "checked" : ""}> Married or registered partners</label><p class="vs-lede">For ${term("joint", "joint filing")}, where the country has it.</p>` : ""}
  </fieldset>`;
}

/** Money's own inputs: who earns what, children, what you spend and where, in fields you edit in place. */
/** Pension shares: one per earner, the same in every city; each city's money sheet says which plan and relief apply there. */
function pensionFields(s: AppState): Raw {
  const p = s.profile;
  const earners = [0, ...p.household.slice(1).map((x, j) => (x.pay ? j + 1 : -1)).filter((i) => i > 0)];
  const set = earners.some((i) => (i === 0 ? p.income.pension : p.household[i]?.pay?.pension));
  return html`<details class="adv adv-side" ${set ? "open" : ""}><summary>Pension${set ? html` <span class="quiet">· set</span>` : ""}</summary>
    <p class="vs-lede">A share of gross pay into a pension, the same in every city. Each city's money sheet names the plan and its tax relief there; where no plan is modelled, the share is counted as saving, with no relief.</p>
    ${earners.map((i) => {
      const who = i === 0 ? "You" : p.household[i]?.label || "Someone";
      const v = i === 0 ? p.income.pension : p.household[i]?.pay?.pension;
      return html`<label class="fld">${term("pension", "Pension")}, % of gross${earners.length > 1 ? `: ${who}` : ""}<input id="pension-${i}" type="number" inputmode="decimal" min="0" max="50" step="0.5" value="${v ? +(v * 100).toFixed(2) : ""}" placeholder="0" data-pay="${i}" data-pay-field="pension"></label>${problemsFor(s, i === 0 ? "pension" : `household[${i}].pension`)}`;
    })}
  </details>`;
}

export function moneySheet(s: AppState): Raw {
  const p = s.profile;
  const inc = p.income;
  const home = inc.everyday?.assumed ? "" : (inc.everyday?.homeCity ?? "");
  const cur = (field: string, v: string, label: string) => html`<select data-field="${field}" aria-label="${label}">${CURRENCIES.map((c) => html`<option ${c === v ? "selected" : ""}>${c}</option>`)}</select>`;
  const others = p.household.slice(1).map((_, j) => j + 1);
  return html`<div class="vs-fold ${s.valuesOpen ? "is-open" : ""}"><button class="vs-sum" data-act="fold" aria-expanded="${s.valuesOpen}" aria-controls="vs-body"><span>Your money</span><span class="quiet">${s.valuesOpen ? "close" : "edit"}</span></button>
    <div class="vs-body" id="vs-body">
    <h2 class="sh">Your money</h2>
    ${payFields(s, 0)}
    ${others.map((i) => payFields(s, i))}
    <div class="hh-add earn-add"><span class="quiet">Someone else earns</span>${["Partner", "Co-founder"].map((l) => html`<button class="pill-btn" data-act="add-earner" data-label="${l}">${l}</button>`)}</div>
    <label class="fld">Children's ages <span class="quiet">for childcare and child credits</span><input id="m-kids" inputmode="numeric" value="${(p.children ?? []).join(", ")}" placeholder="e.g. 2, 5" data-field="children"></label>
    ${problemsFor(s, "children")}
    <label class="fld">${term("everyday", "Spending a month")}, rent, childcare and health aside<span class="fld-row"><input id="m-every" type="number" inputmode="numeric" min="0" step="50" value="${inc.everyday?.amount ?? 0}" data-field="everyday">${cur("everyday-currency", inc.everyday?.currency ?? "EUR", "Currency of your spending")}</span></label>
    ${inc.everyday?.assumed ? html`<p class="vs-lede">${money(inc.everyday.amount, inc.everyday.currency)} is a starting guess, not yours: set your own.</p>` : ""}
    ${problemsFor(s, "spending")}
    <label class="fld">Where you live now<select id="m-home" data-field="home">${home === "" ? html`<option value="" selected>Not set</option>` : ""}${s.data.cities
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => html`<option value="${c.id}" ${c.id === home ? "selected" : ""}>${c.name}</option>`)}</select></label>
    ${home ? "" : html`<p class="vs-lede">Set it to see the ${term("breakeven", "pay you would need")} in each city to keep what you keep there.</p>`}
    <label class="fld">Your rent there now<input id="m-rent" type="number" inputmode="numeric" min="0" step="10" value="${home ? (p.overrides[home]?.[`rent_${p.housing.size}`] ?? "") : ""}" placeholder="${home ? "a month, optional" : "set where you live first"}" ${home ? "" : "disabled"} data-field="home-rent"></label>
    <div class="seg" role="radiogroup" aria-label="Home size">
      <button role="radio" aria-checked="${p.housing.size === "1bed"}" data-act="housing" data-size="1bed">One bedroom</button>
      <button role="radio" aria-checked="${p.housing.size === "3bed"}" data-act="housing" data-size="3bed">Three bedrooms</button>
    </div>
    <label class="fld">Savings, for runway <span class="quiet">months of expenses covered with no income</span><input id="m-save" type="number" inputmode="numeric" min="0" step="1000" value="${inc.savings}" data-field="savings"></label>
    ${problemsFor(s, "savings")}
    ${pensionFields(s)}
    </div></div>`;
}
