import { html } from "./dom.ts";
import { fetchedNames, SHARE_PARTS, sharePartsHeld, shareUrl, type AppState } from "./state.ts";

export function sharePanel(s: AppState, copied = false): string {
  const p = s.profile;
  const held = sharePartsHeld(p);
  const include = s.shareInclude.filter(k => held.includes(k));
  const url = shareUrl(p, include, fetchedNames(s.data, s.fetchedHere));
  const fetched = p.cities.some(id => s.fetchedHere.includes(id));
  return html`<div class="pop-body share">
    <b id="share-title">Share</b>
    <p class="hint">Cities, priorities, weather range and settings. Private details excluded unless selected.</p>
    <label class="share-url"><span class="sr">The link</span><input readonly value="${url}" id="share-url"></label>
    <div class="pop-actions"><button class="ink-btn" data-act="share-copy" id="share-copy">Copy</button>${typeof navigator !== 'undefined' && 'share' in navigator ? html`<button class="pill-btn" data-act="share-native">Share on device</button>` : ''}<span role="status" aria-live="polite">${copied ? "Copied" : ""}</span></div>
    ${held.length ? html`<details><summary>Include private details (${include.length})</summary><fieldset class="share-parts"><legend class="sr">Include in this link</legend>${SHARE_PARTS.filter(x => held.includes(x.key)).map(x => html`<label class="check share-part"><input type="checkbox" id="share-${x.key}" data-act="share-include" data-part="${x.key}" ${include.includes(x.key) ? 'checked' : ''}><span>${x.label}</span></label>`)}</fieldset></details>` : ''}
    ${fetched ? html`<small>Fetched places must be added by name in the recipient's browser.</small>` : ''}
  </div>`.value;
}
