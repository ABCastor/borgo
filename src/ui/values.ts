import { CRITERIA, politicsWord, stanceOf, type Criterion } from "../core/criteria.ts";
import { criteriaFor, weightOf } from "../core/engine.ts";
import { grouped, type Group } from "../core/groups.ts";
import type { Profile } from "../core/types.ts";
import { rangeButton } from "./cards.ts";
import { html, type Raw } from "./dom.ts";
import { passportOptions, problemsFor } from "./top.ts";
import { CURRENCIES, money } from "./format.ts";
import { shortLabel } from "./glance.ts";
import { PRESETS, type AppState } from "./state.ts";
import { term } from "./terms.ts";

// The sheets beside the cards. Each view carries the inputs that drive it: values on Cities and Compare,
// pay and spending on Money. Nothing is edited in a bar on top.

export function share(weight: number, total: number): string {
  return total > 0 ? `${Math.round((100 * weight) / total)}%` : "0%";
}

const PART_MAX = 40;
const GROUP_MAX = 60;

function dial(id: string, label: string, weight: number, total: number, o: { personal?: boolean; mustPass?: boolean; canBreak?: boolean; question?: string; stance?: Raw }): Raw {
  return html`<li class="vline ${o.personal ? "is-personal" : ""} ${o.stance ? "is-position" : ""} ${weight === 0 ? "is-zero" : ""}">
    <label class="val-n" for="w-${id}" title="${o.question ?? ""}">${label}</label>
    <output class="val-p num" id="o-${id}" for="w-${id}">${share(weight, total)}</output>
    <input type="range" id="w-${id}" min="0" max="${PART_MAX}" step="1" value="${weight}" data-weight="${id}" style="--fill:${((Math.min(weight, PART_MAX) / PART_MAX) * 100).toFixed(1)}%" aria-label="How much ${label} matters">
    ${o.canBreak ? html`<button class="must ${o.mustPass ? "is-on" : ""}" data-act="toggle-breaker" data-id="${id}" aria-pressed="${!!o.mustPass}" title="Rule out a city that fails this line">Must pass</button>` : ""}
    ${o.personal ? html`<button class="link val-x" data-act="remove-line" data-id="${id}">Remove</button>` : ""}
    ${o.stance ?? ""}
  </li>`;
}

/** Where you stand on a position line: a choice of steps, or a left-to-right slider. Unset until you set it. */
function stanceControl(c: Criterion, stance: number | undefined): Raw {
  const spec = c.position!;
  if (spec.levels) {
    return html`<label class="stance"><span class="stance-k">You want</span><select data-stance="${c.id}" aria-label="Where you stand: ${c.label}">
      <option value="" ${stance === undefined ? "selected" : ""}>Not said</option>
      ${spec.levels.map((l) => html`<option value="${l.value}" ${stance === l.value ? "selected" : ""}>${l.label}</option>`)}
    </select></label>`;
  }
  const v = stance ?? (spec.min + spec.max) / 2;
  return html`<div class="stance stance-range ${stance === undefined ? "is-unset" : ""}">
    <span class="stance-k">You</span>
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
  return html`<p class="nice-own">Nice days are yours to define. ${rangeButton(s, "values")}</p>`;
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

/** The dial's name on the first view: the lead line's own name while it is the only part that counts. */
function leadLabel(p: Profile, g: Group, parts: Criterion[]): string {
  const lead = LEADS[g.id];
  if (!lead) return g.label;
  const only = parts.every((c) => c.id === lead || weightOf(p, c) === 0);
  return only ? shortLabel(parts.find((c) => c.id === lead) ?? { id: lead, label: g.label }) : g.label;
}

/** The two groups every comparison starts from, each led by one line. */
const LEADS: Partial<Record<Group["id"], string>> = { money: "money_left", climate: "nice_days" };
/** Groups a "third priority" can be: not the two leads, not the eligibility check, not the lines that need a stance or a line of your own first. */
const NOT_THIRD = new Set(["money", "climate", "right_to_live", "stand", "own"]);
/** What a third priority starts at, shared over its parts by their default weights. */
export const THIRD_WEIGHT = 10;

function groupBlock(s: AppState, g: Group, parts: Criterion[], total: number, o: { first?: boolean; noMust?: boolean } = {}): Raw {
  const p = s.profile;
  const weight = parts.reduce((t, c) => t + weightOf(p, c), 0);
  const single = parts.length === 1 && g.id !== "own" && g.id !== "stand";
  const open = !single && s.openGroups.includes(g.id);
  const lead = o.first ? LEADS[g.id] : undefined;
  const label = o.first ? leadLabel(p, g, parts) : g.label;
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
  const only = single ? parts[0]! : null;
  return html`<li class="vgroup ${weight === 0 ? "is-zero" : ""} ${open ? "is-open" : ""}" data-group="${g.id}">
    <div class="vline vg-head">
      <label class="val-n" for="wg-${g.id}" title="${g.question}">${label}</label>
      <output class="val-p num" id="og-${g.id}" for="wg-${g.id}">${share(weight, total)}</output>
      <input type="range" id="wg-${g.id}" min="0" max="${max}" step="1" value="${Math.round(weight)}" data-group-weight="${g.id}" style="--fill:${((Math.min(weight, max) / max) * 100).toFixed(1)}%" aria-label="How much ${label} matters">
      ${only && only.fails && !o.noMust ? html`<button class="must ${p.dealBreakers.includes(only.id) ? "is-on" : ""}" data-act="toggle-breaker" data-id="${only.id}" aria-pressed="${p.dealBreakers.includes(only.id)}" title="Rule out a city that fails this line">Must pass</button>` : ""}
    </div>
    ${g.id === "climate" ? niceDaysLine(s) : ""}
    ${single
      ? ""
      : html`<button class="vg-toggle" data-act="group" data-id="${g.id}" aria-expanded="${open}" aria-controls="vg-${g.id}"><span>${open ? "Close" : g.id === "own" && !parts.length ? "Add a line of your own" : lead ? alsoSummary(p, parts, lead) || partsSummary(p, parts) : partsSummary(p, parts)}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg></button>`}
    ${open
      ? html`<div class="vg-parts" id="vg-${g.id}">
          ${g.id === "stand" ? html`<p class="vs-lede">Say where you stand and a place scores by how close it is; nothing is assumed about you.</p>` : ""}
          ${g.id === "own" ? html`<p class="vs-lede">What no dataset knows: family nearby, a partner's job, a feeling. Score each city 1 to 5 in its dossier or in Compare.</p>` : ""}
          ${parts.length ? html`<ul class="vals">${parts.map(part)}</ul>` : ""}
          ${g.pending ? html`<p class="vs-lede">${g.pending}</p>` : ""}
          ${g.id === "own" ? html`<form class="addline" data-act="add-line"><input name="label" placeholder="e.g. Family nearby" aria-label="New line of your own" maxlength="40"><button class="pill-btn">Add</button></form>` : ""}
        </div>`
      : ""}
  </li>`;
}

/** Who can move there: a check, not a dial. A passport per person; each sheet then says yes, no or not checked. */
function eligibility(s: AppState): Raw {
  const p = s.profile;
  const people = p.household.length ? p.household : [{ label: "You", citizenships: [] as string[] }];
  const must = p.dealBreakers.includes("right_to_live");
  return html`<section class="elig" aria-labelledby="elig-h">
    <div class="elig-head"><h3 class="val-n" id="elig-h">Who can move there</h3><button class="must ${must ? "is-on" : ""}" data-act="toggle-breaker" data-id="right_to_live" aria-pressed="${must}" title="Rule out a city where someone moving would need a visa or permit">Must pass</button></div>
    <ul class="elig-people">${people.map(
      (x, i) => html`<li><label for="e${i}-pass">${x.label || "Someone"}</label><select id="e${i}-pass" data-person="${i}" data-field="citizenship"><option value="">Passport not given</option>${passportOptions(x.citizenships[0] ?? "")}</select></li>`,
    )}</ul>
    <p class="vs-lede">Citizenship and free-movement areas only: visas and permits are not modelled. Each sheet says yes, no or not checked. <button class="link" data-act="household">${p.household.length > 1 ? "Edit who is moving" : "Add someone"}</button></p>
  </section>`;
}

export function valuesSheet(s: AppState): Raw {
  const p = s.profile;
  const crit = criteriaFor(p);
  const presetActive = PRESETS.find((pr) => CRITERIA.every((c) => (p.weights[c.id] ?? c.defaultWeight) === (pr.weights[c.id] ?? c.defaultWeight)))?.id;
  const total = crit.reduce((t, c) => t + weightOf(p, c), 0);
  const groups = grouped(crit).filter(({ group }) => !group.shows || group.shows(p));
  const wOf = (parts: Criterion[]) => parts.reduce((t, c) => t + weightOf(p, c), 0);
  const on = groups.filter(({ parts }) => wOf(parts) > 0).length;
  // The first view: money left, nice days, and the heaviest other group that counts, if any.
  const firstTwo = groups.filter(({ group }) => LEADS[group.id]);
  const thirdCandidates = groups.filter(({ group }) => !NOT_THIRD.has(group.id));
  const third = thirdCandidates.filter(({ parts }) => wOf(parts) > 0).sort((a, b) => wOf(b.parts) - wOf(a.parts))[0];
  const shown = new Set([...firstTwo, ...(third ? [third] : [])].map(({ group }) => group.id));
  const rest = groups.filter(({ group }) => !shown.has(group.id));
  const restOn = rest.filter(({ parts }) => wOf(parts) > 0);
  const restShare = rest.reduce((t, { parts }) => t + wOf(parts), 0);
  const picker = third
    ? ""
    : html`<li class="vgroup third-pick"><label class="val-n" for="third">A third priority</label><select id="third" data-third><option value="">Optional: choose one</option>${thirdCandidates.map(({ group }) => html`<option value="${group.id}">${group.label}</option>`)}</select></li>`;
  return html`<div class="vs-fold ${s.valuesOpen ? "is-open" : ""}"><button class="vs-sum" data-act="fold" aria-expanded="${s.valuesOpen}" aria-controls="vs-body"><span>What matters</span><span class="quiet">${on} of ${groups.length} count · ${s.valuesOpen ? "close" : "edit"}</span></button>
    <div class="vs-body" id="vs-body">
    <h2 class="sh">What matters</h2>
    <p class="vs-lede">Each dial controls a ${term("share", "share")} of the score. Money left and nice days start it; add a third if you like.</p>
    <ul class="vals vgroups">${firstTwo.map(({ group, parts }) => groupBlock(s, group, parts, total, { first: true }))}${third ? groupBlock(s, third.group, third.parts, total) : picker}</ul>
    ${eligibility(s)}
    <button class="more" data-act="more" aria-expanded="${s.moreOpen}" aria-controls="more-body">More priorities<span class="more-n">${restOn.length ? ` · ${restOn.length} more count, ${share(restShare, total)}` : " · nothing else counts"}</span></button>
    ${s.moreOpen
      ? html`<div class="more-body" id="more-body">
        <p class="vs-lede">Start from a set of weights, or tune any group.</p>
        <div class="presets" role="group" aria-label="Start from">
          ${PRESETS.map((pr) => html`<button class="pill-btn ${presetActive === pr.id ? "is-on" : ""}" aria-pressed="${presetActive === pr.id}" data-act="preset" data-id="${pr.id}">${pr.label}</button>`)}
        </div>
        <ul class="vals vgroups">${rest.map(({ group, parts }) => groupBlock(s, group, parts, total, { noMust: group.id === "right_to_live" }))}</ul>
        <h3 class="vs-h">How each line is scored</h3>
        <div class="seg" role="radiogroup" aria-label="How each line is scored">
          <button role="radio" aria-checked="${p.prefs.normalise === "absolute"}" data-act="normalise" data-mode="absolute" title="Each value against a fixed best and worst">Fixed</button>
          <button role="radio" aria-checked="${p.prefs.normalise === "relative"}" data-act="normalise" data-mode="relative" title="Best of your cities scores full marks">Against your cities</button>
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
  return html`<fieldset class="earner"><legend class="${alone ? "sr" : ""}">${own ? "You" : person?.label || "Someone"}</legend>
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
