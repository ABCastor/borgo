// How community figures look, wherever they appear: the city's static page (filled in by the Worker), the app's
// city sheet, and the form that sends them. One renderer, so the label, count and date read the same everywhere.
import { html, type Raw } from "../ui/dom.ts";
import { AREAS, BEDROOMS, entriesText, LICENCE, OCCUPATIONS, periodText, PRICES, unitWords, type Summary } from "./figures.ts";

const money = (v: number, currency: string) => {
  // Cents only where they matter: €1.60 for a coffee, €1,010 for a rent.
  const d = v < 100 && !Number.isInteger(v) ? 2 : 0;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
  } catch {
    return `${v.toLocaleString("en-GB")} ${currency}`;
  }
};

const valueText = (s: Summary) => (s.kind === "rating" ? `${s.value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} of 5` : money(s.value, s.currency));

/** One figure's line: the community value, its count and months, and the official figure beside it when one exists. */
function row(s: Summary): Raw {
  if (!s.entries)
    return html`<tr class="cm-held"><th scope="row">${s.label}</th><td class="num quiet">held</td><td><span class="cm-n">${entriesText(s.held)} under review</span></td><td></td></tr>`;
  return html`<tr>
    <th scope="row">${s.label}${unitWords(s) ? html`<span class="cm-unit">${unitWords(s)}</span>` : ""}</th>
    <td class="num"><b>${valueText(s)}</b>${s.range ? html`<span class="cm-range">${money(s.range[0], s.currency)} to ${money(s.range[1], s.currency)}</span>` : ""}</td>
    <td><span class="cm-badge">Community</span> <span class="cm-n">${entriesText(s.entries)}, ${periodText(s.from, s.to)}${s.held ? `; ${s.held} held` : ""}</span></td>
    <td class="cm-off">${s.official ? html`Official: <b class="num">${money(s.official.value, s.currency)}</b> <span class="quiet">${s.official.source}, ${s.official.period}</span>` : ""}</td>
  </tr>`;
}

/** Every community figure of a place, or a line saying none has arrived yet. */
export function communityFigures(name: string, list: Summary[], api: string): Raw {
  const shown = list.filter((s) => s.entries || s.held);
  if (!shown.length) return html`<p class="cm-empty">No one has added figures for ${name} yet. Yours would be the first, shown on its own as “1 entry”.</p>`;
  const total = Math.max(...list.map((s) => s.entries));
  return html`<table class="cm-table" aria-label="What people who live in ${name} report"><tbody>${shown.map(row)}</tbody></table>
    <p class="cm-foot">Middle half shown from 3 entries. ${total === 1 ? "With one entry, the figure is that person's own, rounded. " : ""}Open data: <a href="${api}">this place's entries</a> and <a href="/api/community/dataset.json">every place</a> (<a href="${LICENCE.url}" rel="license">CC BY 4.0</a>, ${LICENCE.credit}).</p>`;
}

/** What a sender reads before sending, in plain words. */
export const PRIVACY = [
  "What you send is published, rounded, as open data anyone may reuse (CC BY 4.0). While there are few entries, yours is shown on its own.",
  "Borgo keeps no name, email, account or IP address. To stop floods it counts how often a network sends figures, under a scrambled code that changes every day and is deleted after two days.",
  "Cloudflare, which runs the site, sees your address in transit, as it does for any page. You get a code to remove what you sent.",
];

/**
 * The form. It works without JavaScript (a plain post the Worker answers); the app sends the same fields itself.
 * `button`: the app shows a button that reveals it; the static page shows it open, under its own heading.
 */
export function communityForm(place: { id: string; name: string; currency: string }, opts: { button?: boolean; open?: boolean } = {}): Raw {
  const cur = place.currency;
  const field = (name: string, label: string, hint = "") =>
    html`<label class="cm-field"><span>${label}</span><span class="cm-in"><input name="${name}" inputmode="decimal" autocomplete="off" pattern="[0-9]+([.,][0-9]+)?" ${hint ? html`placeholder="${hint}"` : ""}><span class="cm-cur">${cur}</span></span></label>`;
  const id = `cm-form-${place.id}`;
  return html`${opts.button ? html`<button type="button" class="cm-open" data-act="community-open" aria-expanded="${opts.open ? "true" : "false"}" aria-controls="${id}">Add your own figures for ${place.name}</button>` : ""}
  <form class="cm-form" id="${id}" method="post" action="/api/community/submit" data-community="${place.id}" data-act="community-send" ${opts.button && !opts.open ? "hidden" : ""}>
    <input type="hidden" name="city" value="${place.id}">
    <p class="cm-lede">Every field is optional: fill in what you know from your own life in ${place.name}. Amounts in ${cur}.</p>
    <fieldset><legend>Rent</legend>
      <div class="cm-row">${field("rent", "What you pay a month, without bills", "e.g. 950")}
      <label class="cm-field"><span>Home</span><select name="bedrooms">${BEDROOMS.map((b) => html`<option value="${b.id}" ${b.id === "1" ? "selected" : ""}>${b.label}</option>`)}</select></label>
      <label class="cm-field"><span>Where</span><select name="area">${AREAS.map((a) => html`<option value="${a.id}">${a.label.replace(/^in the /, "In the ").replace(/^outside/, "Outside")}</option>`)}</select></label></div>
    </fieldset>
    <fieldset><legend>Everyday prices</legend>
      <div class="cm-grid">${PRICES.map((p) => field(`price_${p.id}`, p.unit === "a month" && !p.label.startsWith("Monthly") ? `${p.label}, a month` : p.label))}</div>
    </fieldset>
    <fieldset><legend>Take-home pay</legend>
      <div class="cm-row">${field("salary", "What you take home a month, after tax", "e.g. 2400")}
      <label class="cm-field"><span>Your kind of work</span><select name="occupation">${OCCUPATIONS.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select></label></div>
    </fieldset>
    <fieldset class="cm-rate"><legend>Living in ${place.name}, all things considered</legend>
      <div class="cm-stars">${[1, 2, 3, 4, 5].map((n) => html`<label><input type="radio" name="rating" value="${n}"><span>${n}</span></label>`)}<span class="cm-scale">1 poor, 5 excellent</span></div>
    </fieldset>
    <div class="cm-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="cm-privacy"><p><b>Your privacy.</b> ${PRIVACY[0]}</p><p>${PRIVACY[1]}</p><p>${PRIVACY[2]}</p></div>
    <label class="cm-consent"><input type="checkbox" name="consent" required> These are my own figures, not copied from another site, and I publish them under CC BY 4.0.</label>
    <div class="cm-send"><button type="submit" class="cm-btn">Send</button><span class="cm-status" role="status" aria-live="polite"></span></div>
  </form>`;
}

/** The form that removes a submission by its code, without JavaScript too. */
export function removeForm(city: string, code = ""): Raw {
  return html`<form class="cm-remove" method="post" action="/api/community/remove"><input type="hidden" name="city" value="${city}"><label class="cm-field"><span>Removal code</span><input name="code" value="${code}" autocomplete="off" spellcheck="false" required></label><button type="submit" class="cm-btn quiet-btn">Remove what I sent</button></form>`;
}

/** The note after a plain-form send: what happened, and the code that removes it. */
export function sentNote(shown: number, held: number, code: string, city: string): Raw {
  return html`<div class="cm-sent" role="status"><p><b>Thank you.</b> ${shown ? `${shown} ${shown === 1 ? "figure is" : "figures are"} shown here` : "Nothing is shown yet"}${held ? `; ${held} ${held === 1 ? "is" : "are"} held by the automated review until others report similar amounts` : ""}.</p>
    ${code ? html`<p>Your removal code is <code class="cm-code">${code}</code>. Keep it to take back what you sent, here or with <code>borgo community remove ${code}</code>.</p>${removeForm(city, code)}` : ""}</div>`;
}

export function removedNote(n: number): Raw {
  return html`<div class="cm-sent" role="status"><p>${n ? `Removed: ${entriesText(n)} deleted for good.` : "Nothing to remove: that code matches no entry, or it was removed already."}</p></div>`;
}
