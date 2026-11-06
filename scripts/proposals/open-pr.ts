// The proposal workflow's second job: for a valid proposal that changes a data file (a corrected figure, a registry
// address), puts the change on a branch and opens a pull request for review. It checks the issue again from the same
// event, offline, and changes only the file the checks name (data/corrections.json or one registry entry).
import { readFileSync } from "node:fs";
import { changeFor } from "../../src/community/apply.ts";
import { checkIssueBody } from "../../src/community/check.ts";
import { gitHub, proposePullRequest, upsertComment } from "../../src/community/github.ts";
import { CORRECTIONS_FILE } from "../../src/community/proposal.ts";
import { repoView } from "../../src/community/repo.ts";
import { inert } from "../../src/community/report.ts";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as { issue: { number: number; body: string | null }; repository: { full_name: string; default_branch: string } };
const view = repoView();
const { proposal, verdict } = await checkIssueBody(event.issue.body ?? "", { repo: view, offline: true });
if (!proposal || !verdict.ok || verdict.route !== "pr") {
  console.error("Not a data proposal that passes the checks; nothing to open.");
  process.exit(1);
}
const n = event.issue.number;
const target = "city" in proposal.target ? CORRECTIONS_FILE : proposal.target.file;
if (target !== CORRECTIONS_FILE && !/^registry\/[a-z0-9-]+\.json$/.test(target)) throw new Error(`refusing to change ${target}`);
const change = changeFor(proposal, view, { issue: n, on: new Date().toISOString().slice(0, 10), current: view.read(target) });
if (!change) {
  console.error("The proposal changes nothing in the file (the value may already be there).");
  process.exit(1);
}
const c = proposal.citations.find((x) => x.primary)!;
const body = [
  `Proposed in #${n}; the proposal workflow checked its shape, its target, its unit and its citation.`,
  `- Change: ${inert(change.summary)}`,
  `- Citation: ${inert(c.publisher)}, ${inert(c.title)}, ${inert(c.url)} (read ${inert(c.accessed)})`,
  ...(c.quote ? [`- Quote: ${inert(c.quote)}`] : []),
  `- Review: ${verdict.locked ? "locked fact: two independent reviews against the official text" : "one review against the cited source"}. The reviewer opens the citation and compares before merging.`,
  "",
  "Pull requests opened by a workflow do not start other workflows: close and reopen this one to run the checks.",
].join("\n");
const gh = gitHub(process.env.GITHUB_TOKEN ?? "", process.env.GITHUB_API_URL);
const pr = await proposePullRequest(gh, {
  repo: event.repository.full_name,
  base: event.repository.default_branch,
  branch: `proposal/issue-${n}`,
  path: change.path,
  content: change.content,
  message: `${change.summary}\n\nProposed in #${n}.`,
  title: change.summary,
  body,
});
if (pr.number) console.log(`#${n}: pull request #${pr.number}`);
else {
  await upsertComment(gh, event.repository.full_name, n, "<!-- borgo-proposal-branch -->", `<!-- borgo-proposal-branch -->\nThe change is ready on branch \`proposal/issue-${n}\`, but this repository does not let workflows open pull requests. A maintainer opens it here: ${pr.url}`);
  console.log(`#${n}: branch ready, pull request not opened (${pr.url})`);
}
