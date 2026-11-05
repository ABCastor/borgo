// The whole check of a proposal, the same for an issue the workflow reads and a proposal an agent builds: its shape,
// the repository (target, value, unit, citation kind, lock) and, unless offline, the network (the cited pages answer
// and hold the quote). Link-only pages are never fetched: citing one is refused before any request.
import { checkCitations, type Http } from "./net.ts";
import { checkProposal, fromFields, linkOnlyHosts, parseIssueBody, type Proposal, type RepoView, type Verdict } from "./proposal.ts";

export interface CheckOptions {
  repo: RepoView;
  /** How pages are read; default the guarded real network. */
  http?: Http;
  /** Skip the network checks (they are then listed as not done). */
  offline?: boolean;
}

export async function checkFull(p: Proposal, o: CheckOptions, extra: string[] = []): Promise<Verdict> {
  const v = checkProposal(p, o.repo);
  const problems = [...extra, ...v.problems];
  const warnings = [...v.warnings];
  if (o.offline) warnings.push("The cited pages were not opened (offline check): the workflow opens them when the issue is filed.");
  else {
    const hosts = linkOnlyHosts(o.repo.registry);
    const host = (u: string) => {
      try {
        return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        return "";
      }
    };
    const fetchable = p.citations.filter((c) => /^https?:\/\//i.test(c.url) && ![...hosts.keys()].some((h) => host(c.url) === h || host(c.url).endsWith(`.${h}`)));
    const net = await checkCitations({ ...p, citations: fetchable }, o.http);
    problems.push(...net.problems);
    warnings.push(...net.warnings);
  }
  const ok = problems.length === 0;
  return {
    ...v,
    ok,
    problems: [...new Set(problems)],
    warnings: [...new Set(warnings)],
    route: ok ? v.route : "issue",
    labels: v.labels.map((l) => (l === "valid" || l === "needs changes" ? (ok ? "valid" : "needs changes") : l)),
    next: ok ? v.next : "Edit the issue to fix what is listed; the check runs again on every edit.",
  };
}

/** Checks an issue body written by the form. */
export async function checkIssueBody(body: string, o: CheckOptions): Promise<{ proposal: Proposal | null; verdict: Verdict }> {
  const { proposal, problems } = fromFields(parseIssueBody(body));
  if (!proposal) {
    return { proposal: null, verdict: { ok: false, problems: [...new Set(problems)], warnings: [], route: "issue", locked: false, labels: ["proposal", "needs changes"], next: "Edit the issue to fix what is listed; the check runs again on every edit." } };
  }
  return { proposal, verdict: await checkFull(proposal, o, problems) };
}
