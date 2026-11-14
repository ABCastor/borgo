// Sending and reading community figures from the CLI and the MCP server. Nothing is sent without the person's
// explicit yes to the exact figures: without it the answer is the draft, what it would publish and how to send it.
import { COMMUNITY_ORIGIN, FIGURE_BY_ID, LICENCE, OCCUPATIONS, PRICES, BEDROOMS, AREAS, entriesText, lowerFirst, periodText, unitWords, type Submission, type Summary } from "./figures.ts";
import { PRIVACY } from "./view.ts";

export const origin = () => (process.env.BORGO_ORIGIN ?? COMMUNITY_ORIGIN).replace(/\/$/, "");

type Fetch = typeof fetch;

export interface SendResult {
  sent: boolean;
  /** What is (or would be) sent, as JSON. */
  submission: Submission;
  /** When not sent: why, and how to send it. */
  notSent?: string;
  privacy: string[];
  /** When sent: the server's answer (figures with their review, the removal code). */
  answer?: { city: string; name: string; figures: { figure: string; value: number; currency: string; review: { status: string; reason?: string } }[]; removal: string; figuresUrl: string };
}

async function call<T>(f: Fetch, path: string, init?: RequestInit): Promise<T> {
  const res = await f(`${origin()}${path}`, { ...init, headers: { "content-type": "application/json", "user-agent": "borgo-cli (https://github.com/ABCastor/borgo)", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} from ${new URL(origin()).host}`);
  return body;
}

/** Send a submission, only with confirm true; otherwise return it as a draft. */
export async function sendFigures(sub: Omit<Submission, "consent">, confirm: boolean, f: Fetch = fetch): Promise<SendResult> {
  const submission: Submission = { ...sub, consent: confirm };
  if (!confirm)
    return {
      sent: false,
      submission: { ...submission, consent: true },
      notSent: "Not sent. Show the person these exact figures and what happens to them; send only after they say yes (CLI: the same command with --yes; MCP: the same call with confirm true).",
      privacy: PRIVACY,
    };
  const answer = await call<NonNullable<SendResult["answer"]>>(f, "/api/community/submit", { method: "POST", body: JSON.stringify(submission) });
  return { sent: true, submission, privacy: PRIVACY, answer };
}

export interface CityCommunity {
  city: string;
  name: string;
  currency: string;
  note: string;
  licence: typeof LICENCE;
  figures: Summary[];
}

export const readFigures = (city: string, f: Fetch = fetch) => call<CityCommunity>(f, `/api/community/city/${encodeURIComponent(city)}.json`);
export const removeFigures = (code: string, f: Fetch = fetch) => call<{ removed: number }>(f, "/api/community/remove", { method: "POST", body: JSON.stringify({ code }) });

const amount = (v: number, cur: string) => `${v.toLocaleString("en-GB", { maximumFractionDigits: v >= 100 ? 0 : 2 })} ${cur}`;

export function figuresMarkdown(c: CityCommunity): string {
  const L = [`# Community figures for ${c.name}`, "", c.note, ""];
  const rows = c.figures.filter((s) => s.entries || s.held);
  if (!rows.length) L.push(`No one has added figures for ${c.name} yet.`, "");
  else {
    L.push("| Figure | Community | Entries | Official |", "|---|---:|---|---|");
    for (const s of rows) {
      const v = !s.entries ? "held" : s.kind === "rating" ? `${s.value} of 5` : `${amount(s.value, s.currency)}${s.range ? ` (${amount(s.range[0], s.currency)} to ${amount(s.range[1], s.currency)})` : ""}`;
      L.push(`| ${s.label}${unitWords(s) ? `, ${unitWords(s)}` : ""} | ${v} | ${s.entries ? `${entriesText(s.entries)}, ${periodText(s.from, s.to)}` : ""}${s.held ? `${s.entries ? "; " : ""}${s.held} held` : ""} | ${s.official ? `${amount(s.official.value, s.currency)} (${s.official.source}, ${s.official.period})` : ""} |`);
    }
    L.push("");
  }
  L.push(`Licence: CC BY 4.0, ${c.licence.credit}. Add yours: borgo submit ${c.city} --rent 950 --bedrooms 1 --area centre --yes`);
  return L.join("\n");
}

export function sendMarkdown(r: SendResult, name = r.submission.city): string {
  const L: string[] = [];
  const s = r.submission;
  const lines: string[] = [];
  if (s.rent) lines.push(`- Rent: ${s.rent.amount} a month, ${BEDROOMS.find((b) => b.id === s.rent!.bedrooms)?.label.toLowerCase() ?? s.rent.bedrooms} ${AREAS.find((a) => a.id === s.rent!.area)?.label ?? s.rent.area}`);
  for (const [k, v] of Object.entries(s.prices ?? {})) lines.push(`- ${PRICES.find((p) => p.id === k)?.label ?? k}: ${v}`);
  if (s.salary) lines.push(`- Take-home pay: ${s.salary.amount} a month after tax, ${lowerFirst(OCCUPATIONS.find((o) => o.id === s.salary!.occupation)?.label ?? s.salary.occupation)}`);
  if (s.rating !== undefined) lines.push(`- Living there, all things considered: ${s.rating} of 5`);
  if (!r.sent) {
    L.push(`# Draft: your figures for ${name}`, "", ...lines, "", `Amounts in ${s.currency ?? "the place's own currency"}.`, "", ...r.privacy, "", r.notSent!);
    return L.join("\n");
  }
  const a = r.answer!;
  L.push(`# Sent: your figures for ${a.name}`, "");
  for (const x of a.figures) L.push(`- ${FIGURE_BY_ID[x.figure]?.label ?? x.figure}: ${x.value} ${FIGURE_BY_ID[x.figure]?.kind === "rating" ? "of 5" : x.currency}, ${x.review.status === "shown" ? "shown" : `held (${x.review.reason})`}`);
  L.push("", `Removal code: ${a.removal} (borgo community remove ${a.removal}).`, `Figures: ${a.figuresUrl}`);
  return L.join("\n");
}
