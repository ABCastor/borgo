// The agent faces of proposals, shared by the MCP server (propose_change, list_stale) and the CLI (propose, stale).
// A proposal is built and checked here, and the answer is the prefilled issue link for the person to open. Posting
// it under the person's own GitHub account happens only when they agreed to this exact proposal: the caller passes
// back the confirmation token of the proposal the person was shown, and the GitHub CLI must already be signed in.
import { spawnSync } from "node:child_process";
import type { Level } from "../core/types.ts";
import { checkFull } from "./check.ts";
import type { Http } from "./net.ts";
import { CITATION_TYPES, fingerprint, issueBody, issueUrl, LICENCE, PRIMARY_TYPES, proposalTitle, REPO, toFields, type CitationType, type Kind, type Proposal, type RepoView, type Verdict } from "./proposal.ts";
import { verdictMarkdown } from "./report.ts";
import { curatedFacts, staleFacts, staleMarkdown, type StaleQuery } from "./stale.ts";
import type { Correction } from "./apply.ts";
import type { RegistryEntry } from "../registry/schema.ts";

export interface ProposeInput {
  kind: Kind;
  city?: string;
  metric?: string;
  source?: string;
  file?: string;
  path?: string;
  current?: string;
  proposed: string | number | number[];
  unit?: string;
  period?: string;
  level?: Level;
  citation: { url: string; type: CitationType; publisher: string; title: string; accessed: string; quote?: string };
  leads?: string[];
  /** For an agent: name@version and the person or project that runs it. A person leaves both out. */
  agent?: string;
  operator?: string;
  note?: string;
  /** Skip opening the cited pages. */
  offline?: boolean;
  /** Post the issue under the person's GitHub account: the `confirm` token of the proposal they agreed to. */
  post?: { confirm: string };
}

export interface ProposeResult {
  valid: boolean;
  verdict: Verdict;
  proposal: Proposal;
  title: string;
  /** The prefilled issue form: the person opens it, ticks the licence box and submits. */
  issueUrl: string;
  body: string;
  /** Pass this back as post.confirm, only after the person agreed to post this exact proposal. */
  confirm: string;
  posted: { url: string } | null;
  /** Why a post was not made, when one was asked for. */
  notPosted?: string;
}

/** Posts an issue; the default uses the person's signed-in GitHub CLI. */
export type Poster = (o: { repo: string; title: string; body: string }) => { url: string } | { error: string };

export const ghPoster: Poster = ({ repo, title, body }) => {
  const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  if (auth.error || auth.status !== 0) return { error: "the GitHub CLI (gh) is not installed or not signed in; open the link instead" };
  // Arguments, never a shell; the body goes in on standard input.
  const r = spawnSync("gh", ["issue", "create", "--repo", repo, "--title", title, "--body-file", "-"], { input: body, encoding: "utf8" });
  if (r.status !== 0) return { error: (r.stderr || "gh issue create failed").trim().slice(0, 300) };
  return { url: r.stdout.trim().split(/\s+/).pop() ?? "" };
};

export function toProposal(i: ProposeInput): Proposal {
  const proposed = Array.isArray(i.proposed) ? i.proposed.join(" ") : String(i.proposed);
  const target = i.city || i.metric ? { city: i.city ?? "", metric: i.metric ?? "", ...(i.source ? { source: i.source } : {}) } : { file: i.file ?? "", path: i.path ?? "" };
  if (!CITATION_TYPES.includes(i.citation.type)) throw new Error(`citation.type is one of ${CITATION_TYPES.join(", ")}.`);
  return {
    kind: i.kind,
    target,
    proposed,
    citations: [
      { url: i.citation.url, type: i.citation.type, publisher: i.citation.publisher, title: i.citation.title, accessed: i.citation.accessed, ...(i.citation.quote ? { quote: i.citation.quote } : {}), primary: PRIMARY_TYPES.has(i.citation.type) },
      ...(i.leads ?? []).map((url) => ({ url, type: "news" as const, publisher: "", title: "", accessed: i.citation.accessed, primary: false })),
    ],
    proposer: i.agent || i.operator ? { kind: "agent", agent: i.agent ?? "", operator: i.operator ?? "" } : { kind: "person" },
    // The person accepts the grant by ticking the form's box, or by agreeing to have it posted; it is checked as given.
    licence: LICENCE,
    ...(i.current ? { current: i.current } : {}),
    ...(i.unit ? { unit: i.unit } : {}),
    ...(i.period ? { period: i.period } : {}),
    ...(i.level ? { level: i.level } : {}),
    ...(i.note ? { note: i.note } : {}),
  };
}

export async function proposeChange(i: ProposeInput, deps: { repo: RepoView; http?: Http; poster?: Poster }): Promise<ProposeResult> {
  const proposal = toProposal(i);
  const verdict = await checkFull(proposal, { repo: deps.repo, http: deps.http, offline: i.offline });
  const extra: string[] = [];
  if (proposal.proposer.kind === "agent") {
    if (!/^[A-Za-z0-9._-]{1,60}@[A-Za-z0-9._-]{1,30}$/.test(proposal.proposer.agent)) extra.push("An agent names itself with a version: agent \"name@1.0\".");
    if (!proposal.proposer.operator.trim()) extra.push("An agent names its operator: the person or project that runs it and answers for it.");
  }
  const v: Verdict = extra.length ? { ...verdict, ok: false, problems: [...extra, ...verdict.problems], route: "issue" } : verdict;
  const title = proposalTitle(proposal);
  const body = issueBody(proposal);
  // The link leaves the licence box for the person to tick.
  const url = issueUrl(toFields(proposal), title);
  const confirm = fingerprint(proposal);
  let posted: ProposeResult["posted"] = null;
  let notPosted: string | undefined;
  if (i.post) {
    if (!v.ok) notPosted = "it does not pass the checks yet";
    else if (i.post.confirm !== confirm) notPosted = "the confirmation does not match this proposal: show the person this exact proposal, and post only the one they agreed to";
    else {
      const r = (deps.poster ?? ghPoster)({ repo: REPO, title, body });
      if ("error" in r) notPosted = r.error;
      else posted = r;
    }
  }
  return { valid: v.ok, verdict: v, proposal, title, issueUrl: url, body, confirm, posted, ...(notPosted ? { notPosted } : {}) };
}

export function proposeMarkdown(r: ProposeResult): string {
  const p = r.proposal;
  const c = p.citations[0];
  const what = "city" in p.target ? `${p.target.metric} for ${p.target.city}${p.target.source ? ` (source ${p.target.source})` : ""}` : `${p.target.path} in ${p.target.file}`;
  const lines = [
    `**${r.title}**`,
    `- Change: ${what}${p.current ? `, from ${p.current}` : ""} to ${p.proposed}${p.unit ? ` ${p.unit}` : ""}${p.period ? ` for ${p.period}` : ""}`,
    ...(c ? [`- Cites: ${c.publisher}, ${c.title} (${c.type}), ${c.url}, read ${c.accessed}${c.quote ? `; quote: "${c.quote.slice(0, 200)}"` : ""}`] : []),
    `- Proposed by: ${p.proposer.kind === "agent" ? `${p.proposer.agent}, run by ${p.proposer.operator}` : "a person"}`,
    "",
    verdictMarkdown(r.verdict),
    "",
  ];
  if (r.posted) lines.push(`Posted as ${r.posted.url}. The workflow checks it again and comments on the issue.`);
  else {
    if (r.notPosted) lines.push(`Not posted: ${r.notPosted}.`);
    lines.push(
      r.valid
        ? `To file it, the person opens this link, ticks the licence box (CC BY 4.0) and submits; the issue is public under their GitHub account:\n${r.issueUrl}`
        : `Fix what is listed and call again. The link below files it as it is, and the check on GitHub will list the same problems:\n${r.issueUrl}`,
      ...(r.valid ? [`\nTo post it for them with their signed-in GitHub CLI instead: show them this proposal, and only after they say yes (which also grants the licence), call again with post.confirm = "${r.confirm}".`] : []),
    );
  }
  return lines.join("\n");
}

export function listStale(q: StaleQuery, deps: { corrections: Correction[]; registry: RegistryEntry[]; name?: (country: string) => string }) {
  const r = staleFacts(curatedFacts({ corrections: deps.corrections, registry: deps.registry, name: deps.name }), q);
  return { ...r, markdown: staleMarkdown(r) };
}
