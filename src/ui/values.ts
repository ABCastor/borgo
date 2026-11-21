import { CRITERIA, politicsWord, stanceOf, type Criterion } from "../core/criteria.ts";
import { criteriaFor, evaluate, weightOf } from "../core/engine.ts";
import { grouped, priorityGroups, type Group } from "../core/groups.ts";
import type { Profile } from "../core/types.ts";
import { niceTestsShort, rangeButton } from "./cards.ts";
import { html, type Raw } from "./dom.ts";
import { passportOptions, problemsFor } from "./top.ts";
import { CURRENCIES, money } from "./format.ts";
import { shortLabel } from "./glance.ts";
import { PRESETS, type AppState } from "./state.ts";
import { term } from "./terms.ts";
import { kindOf, WORK_KINDS } from "../core/work.ts";

// The sheets beside the cards. Each view carries the inputs that drive it: values on Cities and Compare,
// pay and spending on Money. Nothing is edited in a bar on top.

export function share(weight: number, total: number): string {
  return total > 0 ? `${Math.round((100 * weight) / total)}%` : "0%";
}

const PART_MAX = 100;
const GROUP_MAX = 100;

function dial(id: string, label: string, weight: number, total: number, o: { personal?: boolean; mustPass?: boolean; canBreak?: boolean; question?: string; stance?: Raw; missing?: string[] }): Raw {
  return html`<li class="vline ${o.personal ? "is-personal" : ""} ${o.stance ? "is-position" : ""} ${weight === 0 ? "is-zero" : ""}">
    <label class="val-n" for="w-${id}" title="${o.question ?? ""}">${label}</label>
    <output class="val-p num" id="o-${id}" for="w-${id}">${o.mustPass ? "requirement, not scored" : `${share(weight, total)} of score`}</output>
    <input type="range" id="w-${id}" min="0" max="${PART_MAX}" step="1" value="${weight}" data-weight="${id}" ${o.mustPass ? "disabled" : ""} style="--fill:${((Math.min(weight, PART_MAX) / PART_MAX) * 100).toFixed(1)}%" aria-label="How much ${label} matters">

    ${o.personal ? html`<button class="link val-x" data-act="remove-line" data-id="${id}">Remove</button>` : ""}
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

/** The parts a closed group holds, in a few words: the ones that count first. */
function partsSummary(p: Profile, parts: Criterion[]): string {
  const on = parts.filter((c) => weightOf(p, c) > 0);
  const off = parts.length - on.length;
  // Mid-sentence, a label takes a small first letter, unless it is a name (Founders Running Club, English).
  const mid = (l: string) => (/ [A-Z]/.test(l) || /^English/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1));
  const names = on.slice(0, 3).map((c, i) => (i === 0 ? shortLabel(c) : mid(shortLabel(c))));
  const rest = on.length - names.length;
  const counted = names.length ? `${names.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}` : "Nothing counts yet";
  return off > 0 ? `${counted} · ${off} off` : counted;
}

/** Nice days are the person's own: the range, said once at the head of Climate, where everyone looks for it. */
function niceDaysLine(s: AppState): Raw {
  return html`<p class="nice-own">Nice days means the weather you enjoy. ${rangeButton(s, "values")} <button class="link nice-sum" data-act="comfort" data-where="values-tests" aria-haspopup="dialog">Edit weather tests: ${niceTestsShort(s.profile.prefs.comfort)}</button></p>`;
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

/** The other parts of a group led by one line (money left, nice days), in a few words: what else counts, or what is off. */
function alsoSummary(p: Profile, parts: Criterion[], lead: string): string {
  const rest = parts.filter((c) => c.id !== lead);
  const on = rest.filter((c) => weightOf(p, c) > 0);
  const mid = (l: string) => (/ [A-Z]/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1));
  const name = (cs: Criterion[]) => {
    const n = cs.slice(0, 2).map((c, i) => (i === 0 ? shortLabel(c) : mid(shortLabel(c))));
    return cs.length > 2 ? `${n.join(", ")} and ${cs.length - 2} more` : n.join(" and ");
  };
  if (on.length) return `Also counts: ${name(on).charAt(0).toLowerCase()}${name(on).slice(1)}`;
  return rest.length ? `${name(rest)}: off` : "";
}

/** Headline lines within their groups, never a fixed ordering of priorities. */
const LEADS: Partial<Record<Group["id"], string>> = { money: "money_left", climate: "nice_days" };
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
  const open = s.openGroups.includes(g.id);
  const lead = LEADS[g.id];
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
        });
  return html`<li class="vgroup ${weight === 0 ? "is-zero" : ""} ${open ? "is-open" : ""}" data-group="${g.id}">
    <div class="vline vg-head">
      <label class="val-n" for="wg-${g.id}" title="${g.question}">${label}</label>
      <output class="val-p num" id="og-${g.id}" for="wg-${g.id}">${share(weight, total)} of score</output>
      <input type="range" id="wg-${g.id}" min="0" max="${max}" step="1" value="${Math.round(weight)}" data-group-weight="${g.id}" ${parts.length && parts.every((c) => p.dealBreakers.includes(c.id)) ? "disabled" : ""} style="--fill:${((Math.min(weight, max) / max) * 100).toFixed(1)}%" aria-label="How much ${label} matters">

    </div>
    ${groupMissing(s, g, parts, o.missing ?? {})}
    <div class="priority-actions"><button class="link" data-act="group" data-id="${g.id}" aria-expanded="${open}" aria-controls="vg-${g.id}">Edit</button><button class="link" data-act="remove-priority" data-id="${g.id}">Remove</button></div>
    ${g.id === "climate" ? html`<h3 class="nice-headline">Nice days</h3>${niceDaysLine(s)}` : ""}
    ${g.id === "ambition" ? workLine(s) : ""}
    <p class="hint">${lead ? alsoSummary(p, parts, lead) || partsSummary(p, parts) : partsSummary(p, parts)}</p>
    ${open
      ? html`<div class="vg-parts" id="vg-${g.id}"><p class="vs-lede">Lines split ${g.label}'s <span id="sg-${g.id}">${share(weight, total)}</span> share; moving one changes the total.</p>
          ${g.id === "stand" ? html`<p class="vs-lede">Say where you stand and a place scores by how close it is; nothing is assumed about you.</p>` : ""}
          ${g.id === "own" ? html`<p class="vs-lede">What no dataset knows: family nearby, a partner's job, a feeling. Score each city 1 to 5 in its dossier or in Compare.</p>` : ""}
          ${parts.length ? html`<ul class="vals">${parts.map(part)}</ul>` : ""}
          ${g.pending ? html`<p class="vs-lede">${g.pending}</p>` : ""}
          ${g.id === "own" ? html`<form class="addline" data-act="add-line"><input name="label" placeholder="e.g. Family nearby" aria-label="New line of your own" maxlength="40"><button class="pill-btn">Add</button></form>` : ""}
        </div>`
      : ""}
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
  const { active, catalogue } = priorityGroups(p, crit);
  const on = active.length;
  return html`<div class="vs-fold ${s.valuesOpen ? "is-open" : ""}"><button class="vs-sum" data-act="fold" aria-expanded="${s.valuesOpen}" aria-controls="vs-body"><span>What matters</span><span class="quiet">${on} of ${groups.length} count · ${s.valuesOpen ? "close" : "edit"}</span></button>
    <div class="vs-body" id="vs-body">
    <h2 class="sh">What matters</h2>
    <p class="vs-lede">Set relative importance; each percentage is a ${term("share", "Share")} of your score, not money.</p>
    <ul class="vals vgroups">${active.map(({ group, parts }) => groupBlock(s, group, parts, total, { missing }))}</ul>
    ${s.removedPriority ? html`<p role="status">Priority removed. <button class="link" data-act="undo-priority" data-id="${s.removedPriority}">Undo</button></p>` : ""}
    <details class="priority-catalogue"><summary>Add priority</summary><label>Search priorities<input type="search" data-priority-search placeholder="People, Nature, your own lines…"></label><ul>${catalogue.map(({group}) => html`<li data-catalogue-label="${group.label.toLowerCase()}"><label for="wg-${group.id}">${group.label}</label> <button id="wg-${group.id}" class="pill-btn" data-act="add-priority" data-id="${group.id}" aria-label="Add ${group.label}">Add</button><p class="hint">${group.question}</p></li>`)}</ul></details>
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
