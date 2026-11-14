// The city sheet's community figures: read live from Borgo's Worker, sent from the same form the static page carries,
// and the removal codes of what this browser sent, kept here so the person can take it back.
import type { Summary } from "../community/figures.ts";
import { fromForm } from "../community/figures.ts";
import { communityFigures, communityForm } from "../community/view.ts";
import { html, type Raw } from "./dom.ts";

type Loaded = { status: "loading" } | { status: "ok"; name: string; figures: Summary[] } | { status: "none" } | { status: "error" };
const cache = new Map<string, Loaded>();
/** Places whose form the person opened, so a redraw of the sheet keeps it open. */
const opened = new Set<string>();

/** The button that shows or hides a place's form. */
export function toggleForm(button: HTMLElement): void {
  const form = document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLFormElement | null;
  if (!form) return;
  form.hidden = !form.hidden;
  button.setAttribute("aria-expanded", String(!form.hidden));
  const id = form.dataset.community!;
  form.hidden ? opened.delete(id) : opened.add(id);
  if (!form.hidden) form.querySelector<HTMLInputElement>("input[name=rent]")?.focus();
}
const SENT_KEY = "borgo.community.sent";

interface Sent {
  city: string;
  code: string;
  at: string;
}
function sentHere(): Sent[] {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as Sent[];
  } catch {
    return [];
  }
}
function keepSent(list: Sent[]): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // private mode: the code was shown once, as on the static page
  }
}

const api = (id: string) => `/api/community/city/${encodeURIComponent(id)}.json`;

function figuresBlock(id: string, name: string): Raw {
  const c = cache.get(id);
  if (!c || c.status === "loading") return html`<p class="cm-empty">Reading what people report for ${name}…</p>`;
  if (c.status === "none") return html`<p class="cm-empty">${name} does not take community figures yet: they are open for the cities and the towns on the map.</p>`;
  if (c.status === "error") return html`<p class="cm-empty">Community figures are unavailable right now.</p>`;
  return communityFigures(c.name, c.figures, api(id));
}

function mineBlock(id: string): Raw {
  const mine = sentHere().filter((s) => s.city === id);
  if (!mine.length) return html``;
  return html`<p class="cm-mine">You sent figures for this place from this browser${mine.length > 1 ? ` ${mine.length} times` : ""}.${mine.map((s) => html` <button type="button" class="link" data-act="community-remove" data-city="${id}" data-code="${s.code}">Remove what you sent on ${s.at}</button>`)}</p>`;
}

/** The section for the city sheet; it reads the figures the first time it is drawn, then draws itself again. */
export function communitySection(city: { id: string; name: string; country: string }, currency: string): Raw {
  if (!cache.has(city.id) && typeof document !== "undefined") void load(city.id, city.name);
  return html`<section class="part" id="community"><h2 class="ph">From people who live here</h2>
    <p class="note">Rents, everyday prices and take-home pay that people report for themselves, after an automated review. They stand beside the official figures and never change the score.</p>
    <div class="cm-figs" data-community-figs="${city.id}">${figuresBlock(city.id, city.name)}</div>
    <div data-community-mine="${city.id}">${mineBlock(city.id)}</div>
    ${communityForm({ id: city.id, name: city.name, currency }, { button: true, open: opened.has(city.id) })}
  </section>`;
}

function redraw(id: string, name: string): void {
  const el = document.querySelector<HTMLElement>(`[data-community-figs="${CSS.escape(id)}"]`);
  if (el) el.innerHTML = figuresBlock(id, name).value;
  const mine = document.querySelector<HTMLElement>(`[data-community-mine="${CSS.escape(id)}"]`);
  if (mine) mine.innerHTML = mineBlock(id).value;
}

async function load(id: string, name: string): Promise<void> {
  cache.set(id, { status: "loading" });
  try {
    const res = await fetch(api(id), { cache: "no-store" });
    if (res.status === 404) cache.set(id, { status: "none" });
    else if (!res.ok) cache.set(id, { status: "error" });
    else {
      const body = (await res.json()) as { name: string; figures: Summary[] };
      cache.set(id, { status: "ok", name, figures: body.figures });
    }
  } catch {
    cache.set(id, { status: "error" });
  }
  redraw(id, name);
}

/** Send the sheet's form as JSON; say what the review did, keep the removal code, and show the new figures. */
export async function sendCommunity(form: HTMLFormElement, name: string): Promise<void> {
  const status = form.querySelector<HTMLElement>(".cm-status");
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  const say = (text: string, bad = false) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-bad", bad);
  };
  const fields = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
  const { honeypot, ...sub } = fromForm(fields);
  if (honeypot) return;
  const id = sub.city;
  if (button) button.disabled = true;
  say("Sending…");
  try {
    const res = await fetch("/api/community/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sub, via: "app" }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; removal?: string; figures?: { review: { status: string } }[] };
    if (!res.ok) return say(body.error ?? `Not sent (${res.status}).`, true);
    const shown = body.figures?.filter((f) => f.review.status === "shown").length ?? 0;
    const held = (body.figures?.length ?? 0) - shown;
    if (body.removal) keepSent([...sentHere(), { city: id, code: body.removal, at: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) }]);
    form.reset();
    say(`Thank you: ${shown} shown${held ? `, ${held} held by the review until others report similar amounts` : ""}. You can remove it from this browser.`);
    await load(id, name);
  } catch {
    say("Not sent: the connection failed. Try again in a moment.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

export async function removeCommunity(id: string, code: string, name: string): Promise<void> {
  try {
    const res = await fetch("/api/community/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    if (!res.ok) return;
  } catch {
    return;
  }
  keepSent(sentHere().filter((s) => s.code !== code));
  await load(id, name);
}

/** What the person has typed in a community form, so a redraw of the sheet keeps it. */
export function keepTyped(root: ParentNode): () => void {
  const forms = [...root.querySelectorAll<HTMLFormElement>("form[data-community]")].map((f) => ({ id: f.dataset.community!, data: [...new FormData(f)] as [string, string][] }));
  return () => {
    for (const k of forms) {
      const f = document.querySelector<HTMLFormElement>(`form[data-community="${CSS.escape(k.id)}"]`);
      if (!f) continue;
      for (const [n, v] of k.data) {
        const el = f.elements.namedItem(n);
        if (el instanceof RadioNodeList) for (const r of el) (r as HTMLInputElement).checked = (r as HTMLInputElement).value === v;
        else if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = true;
        else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = v;
      }
    }
  };
}
