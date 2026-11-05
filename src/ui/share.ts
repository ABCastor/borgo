// The share panel: what the link carries, said field by field before it is copied. The private parts (pay, the
// household, your own numbers, your own lines, where you stand) stay out unless ticked here.
import { html } from "./dom.ts";
import { fetchedNames, SHARE_PARTS, sharePartsHeld, shareUrl, type AppState } from "./state.ts";

export function sharePanel(s: AppState, copied = false): string {
  const p = s.profile;
  const held = sharePartsHeld(p);
  const include = s.shareInclude.filter((k) => held.includes(k));
  const url = shareUrl(p, include, fetchedNames(s.data, s.fetchedHere));
  const n = p.cities.length;
  const fetched = p.cities.filter((id) => s.fetchedHere.includes(id)).length;
  const left = SHARE_PARTS.filter((x) => held.includes(x.key) && !include.includes(x.key));
  return html`<div class="pop-body share">
    <b id="share-title">Share this comparison</b>
    <p class="hint">The link carries your ${n} ${n === 1 ? "city" : "cities"}, what matters (the weights and must-pass lines), your nice-day range, the home size and your settings. It rides after the # in the address, which browsers never send to a server; it reaches only whoever you give it to.</p>
    ${held.length
      ? html`<fieldset class="share-parts"><legend>Also put in the link</legend>${SHARE_PARTS.filter((x) => held.includes(x.key)).map(
          (x) => html`<label class="check share-part"><input type="checkbox" id="share-${x.key}" data-act="share-include" data-part="${x.key}" ${include.includes(x.key) ? "checked" : ""}><span><b>${x.label}</b> <span class="quiet">${x.what}</span></span></label>`,
        )}</fieldset>`
      : ""}
    ${left.length ? html`<p class="hint">Left out: ${left.map((x) => x.label.toLowerCase()).join(", ")}. Whoever opens the link sees the comparison without them.</p>` : ""}
    ${fetched ? html`<p class="hint">${fetched} of your places ${fetched === 1 ? "was" : "were"} fetched in this browser and ${fetched === 1 ? "is" : "are"} not in the link's data: whoever opens it adds ${fetched === 1 ? "it" : "them"} again by name.</p>` : ""}
    <div class="pop-actions"><button class="ink-btn" data-act="share-copy" id="share-copy">Copy link</button><span class="share-done" role="status" aria-live="polite">${copied ? "Copied" : ""}</span></div>
    <label class="share-url"><span class="sr">The link</span><input readonly value="${url}" id="share-url"></label>
  </div>`.value;
}
